import type { ProviderCredentialFile, ProviderCredentialSecret, ProfileCredentials } from "../types/index.js";
import { resolveTemplatePath } from "../platform/index.js";
import { writeJsonFile, writeBinaryFile, fileExists } from "../platform/fs.js";
import { pathSegments } from "../core/path.js";
import { setKeytarPassword } from "./keytar.js";
import { readProviderJsonFile } from "./json.js";
import { sanitizeCredentials, mergeCredentials } from "../core/credential-policy.js";
import { hasDynamicBucket, resolveBucketPath, detectBucketKey } from "./bucket.js";

/** Set a nested value by path, creating intermediate objects. */
function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = pathSegments(dotPath);
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/** Get a nested value by path (mirrors reader + usage; needed for existingCreds extraction). */
function getByPath(obj: Record<string, unknown>, dotPath: string): unknown {
  let current: unknown = obj;
  for (const key of pathSegments(dotPath)) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function interpolateSecretTemplate(
  template: string,
  credentials: Record<string, unknown>,
  grabData: Record<string, unknown>,
): string {
  return template.replace(/\$\{(credentials|grab_data)\.([^}]+)\}/g, (_match, scope: string, key: string) => {
    const source = scope === "credentials" ? credentials : grabData;
    return String(source[key] ?? "");
  });
}

/**
 * Merge-on-write: read existing file, overlay auth fields, write back.
 * Unknown fields are preserved (mcpOAuth etc.).
 *
 * @param targetPath  Override the resolved credential file path (used for satellites).
 *                    When omitted the path from `credFile.path` is used.
 */
export async function writeCredentials(
  credFile: ProviderCredentialFile,
  data: ProfileCredentials,
  credentialSecrets: ProviderCredentialSecret[] = [],
  targetPath?: string,
): Promise<void> {
  const filePath = targetPath ?? resolveTemplatePath(credFile.path);

  // binary-passthrough: write the single mapping field whose path is "."
  // as raw UTF-8, overwriting any existing file. No merge, no grab_fields,
  // no keytar. The provider's CLI reads the file verbatim, so ai-revolver
  // only needs to relay the bytes it grabbed earlier.
  if (credFile.format === "binary-passthrough") {
    let blob: string | undefined;
    for (const [normKey, jsonPath] of Object.entries(credFile.mapping)) {
      if (jsonPath === ".") {
        const v = data.credentials[normKey];
        if (typeof v === "string") blob = v;
      }
    }
    if (blob === undefined) {
      throw new Error(
        `binary-passthrough: credentials missing mapped blob field (expected one of: ${Object.keys(credFile.mapping).join(", ")})`,
      );
    }
    const perms = typeof credFile.permissions === "number" ? credFile.permissions : 0o600;
    await writeBinaryFile(filePath, blob, perms);
    return;
  }

  // Read current file (or start empty if first run)
  let existing: Record<string, unknown> = {};
  if (await fileExists(filePath)) {
    existing = await readProviderJsonFile<Record<string, unknown>>(filePath, credFile.format);
  }

  // Dynamic bucket: use _auth_bucket_key from grab_data (set by reader on prior grab)
  // to resolve relative mapping/grab paths and to prune sibling buckets.
  const dyn = hasDynamicBucket(credFile);
  const prefix = hasDynamicBucket(credFile) ? credFile.dynamic_bucket_prefix : undefined;
  const incomingBucketKey = (data.grab_data && (data.grab_data._auth_bucket_key as string | undefined)) || undefined;
  let bucketKey = incomingBucketKey;
  if (dyn && prefix && !bucketKey) {
    // legacy: infer bucket from bracketed grab_data keys e.g. "['https://auth.x.ai::...'].user_id"
    for (const k of Object.keys(data.grab_data || {})) {
      if (typeof k === "string") {
        const m = k.match(/\['(https:\/\/auth\.x\.ai::[^']+)'\]/);
        if (m && m[1]) {
          bucketKey = m[1];
          break;
        }
      }
    }
  }
  if (dyn && prefix && !bucketKey) {
    // legacy grab_data without _auth_bucket_key: fallback to detect from disk
    try {
      bucketKey = detectBucketKey(existing, prefix);
    } catch {
      bucketKey = undefined;
    }
  }
  if (dyn && prefix && !bucketKey) {
    const paths = [
      ...Object.values(credFile.mapping || {}),
      ...(credFile.grab_fields || []),
    ].filter((p): p is string => typeof p === "string");
    const anyRelative = paths.some(
      (p) => !p.startsWith("[") && !p.includes("['") && !p.includes('["'),
    );
    if (anyRelative) {
      throw new Error("re-grab profile: missing _auth_bucket_key");
    }
  }

  // Extract existing mapped credentials (from the file we just read for preserve_unknown).
  // Then merge with sanitized incoming: sensitive empty values never clobber a live
  // existing value. This is the second defense (writer merge guard) against vault→FS
  // poison and FS→vault empty clobber on grab/sync/switch/usage.
  const existingCreds: Record<string, unknown> = {};
  for (const [normKey, jsonPath] of Object.entries(credFile.mapping)) {
    const eff = (dyn && bucketKey) ? resolveBucketPath(jsonPath, bucketKey) : jsonPath;
    const v = getByPath(existing, eff);
    if (v !== undefined) existingCreds[normKey] = v;
  }
  const mergedCreds = mergeCredentials(existingCreds, sanitizeCredentials(data.credentials));

  // Write mapping fields from the *merged* set (not raw incoming).
  for (const [normKey, jsonPath] of Object.entries(credFile.mapping)) {
    if (normKey in mergedCreds) {
      const eff = (dyn && bucketKey) ? resolveBucketPath(jsonPath, bucketKey) : jsonPath;
      setByPath(existing, eff, mergedCreds[normKey]);
    }
  }

  // Write only credential-file grab_fields (extra_files use writeExtraFiles).
  // grab_fields are pass-through and not subject to the sensitive merge guard in v1.
  for (const fieldPath of credFile.grab_fields) {
    if (fieldPath in data.grab_data) {
      const eff = (dyn && bucketKey) ? resolveBucketPath(fieldPath, bucketKey) : fieldPath;
      setByPath(existing, eff, data.grab_data[fieldPath]);
    }
  }

  // Prune other buckets with same prefix (account switch cleanup). Only when dyn + bucketKey known.
  if (dyn && prefix && bucketKey) {
    for (const k of Object.keys(existing)) {
      if (typeof k === "string" && k.startsWith(prefix) && k !== bucketKey) {
        delete existing[k];
      }
    }
  }

  const perms = typeof credFile.permissions === "number" ? credFile.permissions : 0o600;
  await writeJsonFile(filePath, existing, perms);

  for (const secret of credentialSecrets) {
    if (secret.backend !== "keytar") continue;
    const account = interpolateSecretTemplate(secret.account, data.credentials, data.grab_data);
    if (!account) continue;
    for (const [normKey, target] of Object.entries(secret.mapping)) {
      if (target !== "password") continue;
      const value = data.credentials[normKey];
      if (value !== undefined) await setKeytarPassword(secret.service, account, String(value));
    }
  }
}
