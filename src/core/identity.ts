import { createHash } from "node:crypto";
import type { ProviderDefinition } from "../types/index.js";
import { getByPath } from "./usage.js";
import { hasDynamicBucket, detectBucketKey, resolveBucketPath } from "../providers/bucket.js";
import { pathSegments } from "./path.js";

// ── Result types ─────────────────────────────────────────────

export interface IdentityCheckOk {
  ok: true;
}

export interface IdentityCheckErr {
  ok: false;
  reason: "missing-in-vault" | "missing-in-fs" | "mismatch";
  vaultDisplay: string;
  fsDisplay: string;
}

export type IdentityCheck = IdentityCheckOk | IdentityCheckErr;

// ── Identity check ───────────────────────────────────────────

/**
 * Compare the stored vault identity against the current FS credential file.
 *
 * @param provider     Provider definition (supplies identity.fields + identity.display).
 * @param vaultIdentity Pre-computed identity snapshot stored in the vault entry
 *                      (Record keyed by dotted field path, e.g. `"tokens.account_id"`).
 * @param fsRawJson    Raw (unmodified) JSON from the FS credential file.
 *
 * Returns `{ ok: true }` when:
 *   - provider has no identity schema, OR
 *   - declared identity fields satisfy the provider's match policy.
 *
 * Returns `{ ok: false, reason, vaultDisplay, fsDisplay }` otherwise.
 */
export function checkIdentity(
  provider: ProviderDefinition,
  vaultIdentity: Record<string, unknown> | undefined,
  fsRawJson: Record<string, unknown>,
  fsGrabData: Record<string, unknown> = {},
): IdentityCheck {
  if (!provider.identity) return { ok: true };

  const fsIdentity = extractIdentityFromRaw(provider, fsRawJson, fsGrabData);
  if (!vaultIdentity) {
    return mkErr(provider, "missing-in-vault", {}, fsIdentity ?? {});
  }

  if (!fsIdentity) {
    return mkErr(provider, "missing-in-fs", vaultIdentity, {});
  }

  const normalizedVault = normalizeVaultIdentity(provider, vaultIdentity);
  const fields = provider.identity.fields;

  if (provider.identity.match === "overlap") {
    const common = fields.filter(
      (field) => normalizedVault[field] != null && fsIdentity[field] != null,
    );
    if (common.length === 0) {
      return mkErr(provider, "missing-in-fs", normalizedVault, fsIdentity);
    }
    for (const field of common) {
      if (String(normalizedVault[field]) !== String(fsIdentity[field])) {
        return mkErr(provider, "mismatch", normalizedVault, fsIdentity);
      }
    }
    return { ok: true };
  }

  for (const field of fields) {
    if (normalizedVault[field] == null) {
      return mkErr(provider, "missing-in-vault", normalizedVault, fsIdentity);
    }
    if (fsIdentity[field] == null) {
      return mkErr(provider, "missing-in-fs", normalizedVault, fsIdentity);
    }
    if (String(normalizedVault[field]) !== String(fsIdentity[field])) {
      return mkErr(provider, "mismatch", normalizedVault, fsIdentity);
    }
  }

  return { ok: true };
}

// ── Display rendering ────────────────────────────────────────

/**
 * Render human-readable identity display string using the provider's display templates.
 *
 * Works with EITHER:
 *   - nested raw JSON (`{ tokens: { account_id: "acc_A" } }`)
 *   - flat vault identity dict (`{ "tokens.account_id": "acc_A" }`)
 *
 * Template forms supported:
 *   - `${tokens.account_id}` — prefixed (legacy; fullPath = "tokens.account_id")
 *   - `${organizationUuid}` — bare field name (direct lookup, no prefix required)
 *   - `${lastLoggedInUser.login}` — bare dotted path
 *
 * Templates referencing keys not present in `source` render as `?` (best-effort display).
 */
export function renderIdentityDisplay(
  provider: ProviderDefinition,
  source: Record<string, unknown>,
): string {
  if (!provider.identity) return "";
  const dynCred = provider.auth_methods?.oauth?.credential_file;
  const dynPrefix = dynCred && hasDynamicBucket(dynCred) ? dynCred.dynamic_bucket_prefix : undefined;
  let dynBucket: string | undefined;
  if (dynPrefix) {
    try { dynBucket = detectBucketKey(source, dynPrefix); } catch { /* ignore, bare lookup will be tried */ }
  }
  return provider.identity.display
    .map((tpl) =>
      tpl.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
        // For dyn bucket on raw source, resolve bare/relative expr
        const effExpr = (dynBucket && !(expr.startsWith("[") || expr.includes("['"))) ? resolveBucketPath(expr, dynBucket) : expr;
        // Prefixed form: "tokens.x", "credentials.x", "grab_fields.x"
        // Try full path traversal first (nested raw JSON), then flat key (vault identity)
        const v = getByPath(source, effExpr) ?? source[expr] ?? source[effExpr];
        return String(v ?? "?");
      }),
    )
    .join(", ");
}

// ── Helpers ──────────────────────────────────────────────────

function mkErr(
  provider: ProviderDefinition,
  reason: IdentityCheckErr["reason"],
  vaultIdentity: Record<string, unknown>,
  fsRawJson: Record<string, unknown>,
): IdentityCheckErr {
  return {
    ok: false,
    reason,
    vaultDisplay: renderIdentityDisplay(provider, vaultIdentity),
    fsDisplay: renderIdentityDisplay(provider, fsRawJson),
  };
}

function getEffectiveIdentityPath(
  provider: ProviderDefinition,
  raw: Record<string, unknown>,
  field: string,
): string {
  const cred = provider.auth_methods?.oauth?.credential_file;
  if (!cred || !hasDynamicBucket(cred) || !cred.dynamic_bucket_prefix) return field;
  try {
    const bk = detectBucketKey(raw, cred.dynamic_bucket_prefix);
    return resolveBucketPath(field, bk);
  } catch {
    return field;
  }
}

// ── Identity extraction (DRY) ────────────────────────────────

function getIdentityValue(
  provider: ProviderDefinition,
  rawJson: Record<string, unknown>,
  grabData: Record<string, unknown>,
  field: string,
): unknown {
  const effectivePath = getEffectiveIdentityPath(provider, rawJson, field);
  return (
    getByPath(rawJson, effectivePath)
    ?? getByPath(grabData, field)
    ?? grabData[field]
  );
}

function applyIdentityTransform(
  transform: string | undefined,
  value: unknown,
): unknown {
  if (!transform) return value;
  if (transform === "sha256") {
    const digest = createHash("sha256").update(String(value), "utf8").digest("hex");
    return `sha256:${digest}`;
  }
  if (transform.startsWith("jwt_claim:")) {
    if (typeof value !== "string") return undefined;
    const claim = transform.slice("jwt_claim:".length);
    const parts = value.split(".");
    if (parts.length !== 3) return undefined;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
      if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
      return getByPath(payload, claim);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeVaultIdentity(
  provider: ProviderDefinition,
  vaultIdentity: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of provider.identity?.fields ?? []) {
    let value = vaultIdentity[field];
    if (value == null) {
      // Legacy vault identity support (pre-dynamic Grok).
      const legacyKey = Object.keys(vaultIdentity).find((key) => {
        if (key.endsWith(`.${field}`) && key.includes("auth.x.ai")) return true;
        const match = key.match(/\['(https:\/\/auth\.x\.ai::[^']+)'\]\.(.+)$/);
        return !!match && match[2] === field;
      });
      if (legacyKey) value = vaultIdentity[legacyKey];
    }
    if (value == null) continue;

    const transform = provider.identity?.transforms?.[field];
    if (transform === "sha256" && typeof value === "string" && /^sha256:[a-f0-9]{64}$/i.test(value)) {
      out[field] = value.toLowerCase();
      continue;
    }
    if (transform?.startsWith("jwt_claim:") && typeof value === "string" && value.split(".").length !== 3) {
      out[field] = value;
      continue;
    }
    out[field] = applyIdentityTransform(transform, value);
  }
  return out;
}

function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const segments = pathSegments(dotPath);
  if (segments.length === 0) return;
  let current = obj;
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index];
    if (current[segment] == null || typeof current[segment] !== "object") {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]] = value;
}

/**
 * Extract identity snapshot for vault from raw credential JSON.
 * Resolves dynamic bucket if declared; stores values under bare field names.
 * With the default `all` policy, every field is required. `overlap` stores all
 * available fields and lets native and satellite locations share a subset.
 */
export function extractIdentityFromRaw(
  provider: ProviderDefinition,
  rawJson: Record<string, unknown>,
  grabData: Record<string, unknown> = {},
): Record<string, unknown> | undefined {
  if (!provider.identity) return undefined;
  const out: Record<string, unknown> = {};
  for (const field of provider.identity.fields) {
    const value = getIdentityValue(provider, rawJson, grabData, field);
    const normalized = value == null
      ? undefined
      : applyIdentityTransform(provider.identity.transforms?.[field], value);
    if (normalized == null) {
      if (provider.identity.match !== "overlap") return undefined;
      continue;
    }
    out[field] = normalized;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Rebuild a provider-shaped identity source from normalized vault data. */
export function extractIdentityFromProfile(
  provider: ProviderDefinition,
  credentials: Record<string, unknown>,
  grabData: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const credFile = provider.auth_methods.oauth?.credential_file;
  if (!credFile) return undefined;

  const rawJson: Record<string, unknown> = {};
  const bucketKey = typeof grabData._auth_bucket_key === "string"
    ? grabData._auth_bucket_key
    : undefined;
  for (const [normalizedKey, declaredPath] of Object.entries(credFile.mapping)) {
    const value = credentials[normalizedKey];
    if (value == null) continue;
    if (declaredPath === ".") {
      rawJson[normalizedKey] = value;
      continue;
    }
    const effectivePath = bucketKey && hasDynamicBucket(credFile)
      ? resolveBucketPath(declaredPath, bucketKey)
      : declaredPath;
    setByPath(rawJson, effectivePath, value);
  }
  return extractIdentityFromRaw(provider, rawJson, grabData);
}
