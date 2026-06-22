import type { ProviderCredentialFile } from "../types/index.js";

/** Return true if the credential file declares dynamic bucket prefix. */
export function hasDynamicBucket(credFile: ProviderCredentialFile): boolean {
  return typeof credFile.dynamic_bucket_prefix === "string" && credFile.dynamic_bucket_prefix.length > 0;
}

/**
 * Detect the active bucket top-level key.
 * Order:
 *  1. If preferredKey provided and present in raw, use it.
 *  2. If exactly one key starts with prefix, use it.
 *  3. Error (zero or >1 without preferred).
 */
export function detectBucketKey(
  raw: Record<string, unknown>,
  prefix: string,
  preferredKey?: string,
): string {
  if (preferredKey != null && raw[preferredKey] != null) {
    return preferredKey;
  }
  const candidates = Object.keys(raw || {}).filter(
    (k) => typeof k === "string" && k.startsWith(prefix),
  );
  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length === 0) {
    throw new Error(`dynamic_bucket: no top-level key with prefix "${prefix}" in credential file`);
  }
  // >1 without (matching) preferred: prefer the one with non-empty .key if unique
  const withKey = candidates.filter((k) => {
    const b = (raw as any)[k];
    return b && typeof b === "object" && typeof (b as any).key === "string" && (b as any).key.length > 0;
  });
  if (withKey.length === 1) {
    return withKey[0];
  }
  throw new Error(
    `dynamic_bucket: multiple keys match prefix "${prefix}": ${candidates.join(", ")}. ` +
      `Use "airev grok grab --force" or manually remove extra keys from the credential file.`,
  );
}

/**
 * Resolve a declared path (from mapping/grab_fields/identity.fields) to effective
 * path for getByPath/setByPath against raw top-level object.
 * - If no bucketKey, return as-is.
 * - If path already bracketed (starts with [ or contains [' ), return as-is.
 * - Else (relative e.g. "key", "user_id"), return "['${bucketKey}'].${path}"
 *   Single quotes used; ' and \ inside bucketKey are escaped as \' and \\ for parser.
 */
export function resolveBucketPath(path: string, bucketKey: string | undefined): string {
  if (!bucketKey) return path;
  if (path.startsWith("[") || path.includes("['") || path.includes('["')) {
    return path;
  }
  const escaped = bucketKey.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `['${escaped}'].${path}`;
}

/**
 * Given provider credFile (may have dynamic), and the raw json, return the
 * effective (resolved) path for a declared fieldPath.
 */
export function getEffectivePath(credFile: ProviderCredentialFile, fieldPath: string, raw?: Record<string, unknown>): string {
  if (!hasDynamicBucket(credFile)) {
    return fieldPath;
  }
  const prefix = credFile.dynamic_bucket_prefix!;
  // To resolve we need the bucketKey; if raw given, detect (no preferred here)
  let bucketKey: string | undefined;
  try {
    bucketKey = detectBucketKey(raw || {}, prefix);
  } catch {
    // fall back to original (will likely miss); caller may supply via other means
    return fieldPath;
  }
  return resolveBucketPath(fieldPath, bucketKey);
}
