import type { ProviderCredentialFile, ProviderCredentialSecret, ProfileCredentials } from "../types/index.js";
import { resolveTemplatePath } from "../platform/index.js";
import { pathSegments } from "../core/path.js";
import { getKeytarPassword } from "./keytar.js";
import { readProviderJsonFile } from "./json.js";
import { sanitizeCredentials } from "../core/credential-policy.js";
import fs from "node:fs/promises";
import { hasDynamicBucket, detectBucketKey, resolveBucketPath } from "./bucket.js";

/** Get a nested value by path: "tokens.access_token" or "['github.com'].oauth_token". */
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
 * Read credentials from a provider's credential file.
 * Extracts `mapping` fields → `credentials` and `grab_fields` → `grab_data`.
 *
 * @param targetPath  Override the resolved credential file path (used for satellites).
 *                    When omitted the path from `credFile.path` is used.
 */
export async function readCredentials(
  credFile: ProviderCredentialFile,
  credentialSecrets: ProviderCredentialSecret[] = [],
  targetPath?: string,
  preferredBucketKey?: string,
): Promise<ProfileCredentials> {
  const filePath = targetPath ?? resolveTemplatePath(credFile.path);

  // binary-passthrough: file content IS the credential. No JSON parse, no
  // grab_fields, no keytar. The single mapping entry must use path "."
  // whose value becomes the whole file content (UTF-8). Used for opaque
  // credential blobs (qodercli's ~/.qoder/.auth/user) where the on-disk
  // format is undocumented and ai-revolver only needs to relay it.
  if (credFile.format === "binary-passthrough") {
    const content = await fs.readFile(filePath, "utf-8");
    const credentials: Record<string, unknown> = {};
    for (const [normKey, jsonPath] of Object.entries(credFile.mapping)) {
      if (jsonPath === ".") credentials[normKey] = content;
    }
    return { credentials: sanitizeCredentials(credentials), grab_data: {} };
  }

  const raw = await readProviderJsonFile<Record<string, unknown>>(filePath, credFile.format);

  // Dynamic bucket support: detect once, resolve relative paths ("key") to ['<bucket>'].key
  let bucketKey: string | undefined;
  if (hasDynamicBucket(credFile)) {
    bucketKey = detectBucketKey(raw, credFile.dynamic_bucket_prefix!, preferredBucketKey);
  }

  // Extract mapping → credentials (normalised keys)
  const credentials: Record<string, unknown> = {};
  for (const [normKey, jsonPath] of Object.entries(credFile.mapping)) {
    const effPath = bucketKey ? resolveBucketPath(jsonPath, bucketKey) : jsonPath;
    const value = getByPath(raw, effPath);
    if (value !== undefined) {
      credentials[normKey] = value;
    }
  }

  // Extract grab_fields → grab_data (original declared paths as keys; relative when dynamic)
  const grab_data: Record<string, unknown> = {};
  for (const fieldPath of credFile.grab_fields) {
    const effPath = bucketKey ? resolveBucketPath(fieldPath, bucketKey) : fieldPath;
    const value = getByPath(raw, effPath);
    if (value !== undefined) {
      grab_data[fieldPath] = value;
    }
  }

  if (bucketKey) {
    grab_data._auth_bucket_key = bucketKey;
  }

  for (const secret of credentialSecrets) {
    if (secret.backend !== "keytar") continue;
    const account = interpolateSecretTemplate(secret.account, credentials, grab_data);
    if (!account) {
      throw new Error(`System credential store secret account is empty for service=${secret.service}`);
    }

    let password: string | null;
    try {
      password = await getKeytarPassword(secret.service, account);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`System credential store unavailable for backend=keytar service=${secret.service}: ${detail}`, { cause: err });
    }

    if (!password) {
      throw new Error(`System credential store secret not found: backend=keytar service=${secret.service} account=${account}`);
    }

    for (const [normKey, source] of Object.entries(secret.mapping)) {
      if (source === "password") credentials[normKey] = password;
    }
  }

  // Apply universal sanitize (treat empty sensitive tokens as absent) after full extraction
  // (mapping + keytar). This is the first defense against poison from CLI refresh failures.
  const sanitizedCredentials = sanitizeCredentials(credentials);
  return { credentials: sanitizedCredentials, grab_data };
}
