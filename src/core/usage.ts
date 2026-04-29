import type {
  ProviderDefinition,
  ProviderTokenRefresh,
  ProviderUsageProbe,
  UsageSnapshot,
  VaultEntry,
} from "../types/index.js";
import { writeCredentials } from "../providers/writer.js";
import { readCredentials } from "../providers/reader.js";
import { resolveTemplatePath } from "../platform/index.js";
import { fileExists } from "../platform/fs.js";

// ── Helpers ──────────────────────────────────────────────

/** Nested get by "a.b.c" path. */
export function getByPath(obj: unknown, dotPath: string): unknown {
  let cur: unknown = obj;
  for (const key of dotPath.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Nested set by "a.b.c" path, creating intermediate objects. */
export function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

/** `${credentials.foo}` → credentials.foo. Literal otherwise. */
export function interpolate(template: string, credentials: Record<string, unknown>): string {
  return template.replace(/\$\{credentials\.([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    const v = credentials[key];
    return v == null ? "" : String(v);
  });
}

function interpolateMap(
  map: Record<string, string> | undefined,
  credentials: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!map) return out;
  for (const [k, v] of Object.entries(map)) out[k] = interpolate(v, credentials);
  return out;
}

/**
 * Decode a JWT payload (middle segment). Unsigned-read: we trust the source
 * (our own credential file), we just want claims like `email`, `sub`.
 */
function decodeJwtPayload(jwt: unknown): Record<string, unknown> | undefined {
  if (typeof jwt !== "string") return undefined;
  const parts = jwt.split(".");
  if (parts.length < 2) return undefined;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json);
    return typeof payload === "object" && payload !== null ? payload : undefined;
  } catch {
    return undefined;
  }
}

/** Apply minimal transform DSL: "path" or "path | transform[:arg]". */
export function applyMapExpr(response: unknown, expr: string): unknown {
  const [rawPath, transformExpr] = expr.split("|").map((s) => s.trim());
  const value = getByPath(response, rawPath);
  if (value === undefined) return undefined;

  if (!transformExpr) return value;

  // Transforms may carry an argument after `:` (e.g. `jwt_claim:email`).
  const [transform, arg] = transformExpr.split(":").map((s) => s.trim());

  switch (transform) {
    case "now_ms_plus_seconds": {
      // Relative seconds-from-now → absolute epoch ms. (Claude: expires_in)
      const n = Number(value);
      if (!Number.isFinite(n)) return undefined;
      return Date.now() + n * 1000;
    }
    case "epoch_seconds_to_ms": {
      // Absolute epoch seconds → epoch ms. (Codex: reset_at)
      const n = Number(value);
      if (!Number.isFinite(n)) return undefined;
      return n * 1000;
    }
    case "iso_to_ms": {
      // ISO 8601 string → epoch ms. (Claude: resets_at)
      if (typeof value !== "string") return undefined;
      const n = Date.parse(value);
      return Number.isFinite(n) ? n : undefined;
    }
    case "jwt_claim": {
      // JWT payload claim extraction. (Codex: email lives in id_token)
      // Requires `:<claim>` arg, e.g. `id_token | jwt_claim:email`.
      if (!arg) throw new Error(`jwt_claim requires a claim name (e.g. "jwt_claim:email")`);
      const payload = decodeJwtPayload(value);
      return payload?.[arg];
    }
    default:
      throw new Error(`Unknown transform: "${transform}"`);
  }
}

// ── Refresh ──────────────────────────────────────────────

type RefreshResult =
  | { ok: true; credentials: Record<string, unknown> }
  | { ok: false; status: number; error?: string };

function stringifyRefreshError(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Perform OAuth refresh per provider's `token_refresh` spec.
 *
 * On failure returns structured info (not null) so the caller can surface
 * *why* refresh failed. Silent null was hiding `invalid_grant` (dead refresh
 * token) and making 401 loops impossible to diagnose.
 */
async function refreshTokens(
  spec: ProviderTokenRefresh,
  credentials: Record<string, unknown>,
): Promise<RefreshResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...interpolateMap(spec.headers, credentials),
  };
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(spec.body)) {
    body[k] = interpolate(v, credentials);
  }

  let res: Response;
  try {
    res = await fetch(spec.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network" };
  }

  if (!res.ok) {
    // Try to surface OAuth error code (invalid_grant, invalid_client, …)
    let err: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown; error_description?: unknown };
      err = stringifyRefreshError(body.error_description) || stringifyRefreshError(body.error);
    } catch { /* body not JSON */ }
    return { ok: false, status: res.status, error: err };
  }

  const json = (await res.json()) as unknown;

  // Start with a copy of existing creds so we preserve anything the refresh
  // response doesn't return (Codex refresh doesn't return expires_in, etc.)
  const updated: Record<string, unknown> = { ...credentials };
  for (const [normKey, expr] of Object.entries(spec.update)) {
    const v = applyMapExpr(json, expr);
    if (v !== undefined) updated[normKey] = v;
  }
  return { ok: true, credentials: updated };
}

// ── Probes ───────────────────────────────────────────────

interface ProbeOutcome {
  status: number;
  json?: unknown;
}

async function runProbe(
  probe: ProviderUsageProbe,
  credentials: Record<string, unknown>,
): Promise<ProbeOutcome> {
  const url = interpolate(probe.url, credentials);
  const headers = interpolateMap(probe.headers, credentials);

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) return { status: res.status };

  try {
    return { status: res.status, json: await res.json() };
  } catch {
    return { status: res.status };
  }
}

function applyProbeMap(
  snapshot: UsageSnapshot,
  probe: ProviderUsageProbe,
  json: unknown,
): void {
  for (const [field, expr] of Object.entries(probe.map)) {
    const value = applyMapExpr(json, expr);
    if (value === undefined) continue;
    setByPath(snapshot as unknown as Record<string, unknown>, field, value);
  }
}

// ── Public entry ─────────────────────────────────────────

export type CredentialsSource = "vault" | "file" | "refresh";

export interface FetchUsageResult {
  snapshot: UsageSnapshot;
  /** Did we perform an OAuth refresh (i.e. consume a refresh_token)? */
  refreshed: boolean;
  /**
   * Final credentials if they differ from `entry.credentials`.
   * May come from the CLI file (file-read-through) or from a refresh call.
   * Caller is responsible for persistence; see `source` to know where it's
   * safe to write back.
   */
  updatedCredentials?: Record<string, unknown>;
  /**
   * Where `updatedCredentials` came from:
   *   `vault`   — no change; `updatedCredentials` absent.
   *   `file`    — read from CLI credential file (active profile only).
   *               Vault should be updated. DO NOT write back to file (would be a no-op round-trip).
   *   `refresh` — we called the token endpoint. Write to vault always, and
   *               (if active) also to the CLI file — the refresh consumed
   *               the file's refresh_token, so file must be resynced.
   */
  source: CredentialsSource;
  /** Probes that still failed after (optional) refresh. */
  errors: Array<{ probe: string; status: number }>;
  /**
   * Refresh attempt outcome — present only when refresh was triggered.
   * `ok:false` means at least one probe hit 401 AND refresh itself failed
   * (e.g. invalid_grant = rotating refresh_token was consumed elsewhere).
   */
  refreshError?: { status: number; error?: string };
}

export interface FetchUsageOptions {
  /**
   * Read credentials from the provider's CLI credential file before probing.
   * Caller sets this true for the **active** profile: the CLI is the owner
   * of that file and may have rotated tokens since our vault snapshot was
   * taken (critical for rotating refresh_tokens à la Anthropic).
   *
   * For non-active profiles leave false — vault is the only source of
   * truth, and the CLI file currently belongs to a different profile.
   */
  liveFromFile?: boolean;
}

/**
 * Attempt to read credentials from the provider's CLI credential file.
 * Returns null if the provider has no oauth def, file doesn't exist, or
 * read fails — caller falls back to vault.
 */
async function tryReadLiveCredentials(
  provider: ProviderDefinition,
): Promise<Record<string, unknown> | null> {
  const oauth = provider.auth_methods.oauth;
  if (!oauth) return null;
  const filePath = resolveTemplatePath(oauth.credential_file.path);
  if (!(await fileExists(filePath))) return null;
  try {
    const result = await readCredentials(oauth.credential_file);
    return result.credentials;
  } catch {
    return null;
  }
}

/**
 * Shallow equality on credentials — we only care whether the key set + values
 * match. Values are strings/numbers/booleans in practice; deep objects would
 * need JSON compare but none of our providers nest credentials.
 */
export function credsEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Run all usage probes for a provider.
 *
 * Strategy:
 *   1. For active profiles (`opts.liveFromFile`), read credentials from the
 *      CLI file first — the CLI may have rotated tokens. Vault is treated
 *      as a stale cache in that case.
 *   2. Run probes. If any returns 401 and the provider has a refresh spec,
 *      refresh once, then re-run that probe.
 *
 * The `source` field in the result tells the caller where final credentials
 * came from, which determines *where* persistence is safe:
 *   - refresh → write to both vault and file (file's rt was consumed)
 *   - file    → write to vault only (file already has these; round-trip would race)
 *   - vault   → nothing to write
 */
export async function fetchUsage(
  provider: ProviderDefinition,
  entry: VaultEntry,
  opts: FetchUsageOptions = {},
): Promise<FetchUsageResult> {
  if (!provider.usage?.probes?.length) {
    throw new Error(`Provider "${provider.name}" has no usage probes configured.`);
  }

  let credentials = entry.credentials;
  let source: CredentialsSource = "vault";

  // Read-through: if this is the active profile, prefer the live file.
  // The CLI is the de-facto owner of the file, and for providers with
  // rotating refresh_tokens (Anthropic) the vault's copy goes stale the
  // moment the CLI refreshes.
  if (opts.liveFromFile) {
    const live = await tryReadLiveCredentials(provider);
    if (live && !credsEqual(live, credentials)) {
      credentials = live;
      source = "file";
    }
  }

  const snapshot: UsageSnapshot = {};
  const errors: Array<{ probe: string; status: number }> = [];
  let refreshed = false;
  let refreshAttempted = false;
  let refreshError: { status: number; error?: string } | undefined;

  // Static map: derive snapshot fields directly from credentials (no HTTP).
  // Used for JWT-embedded claims like Codex's `email` in `id_token`.
  if (provider.usage.static) {
    for (const [field, expr] of Object.entries(provider.usage.static)) {
      const v = applyMapExpr(credentials, expr);
      if (v !== undefined) {
        setByPath(snapshot as unknown as Record<string, unknown>, field, v);
      }
    }
  }

  const refreshSpec = provider.auth_methods.oauth?.token_refresh;

  for (const probe of provider.usage.probes) {
    let outcome = await runProbe(probe, credentials);

    // Refresh is attempted at most once per fetchUsage call — whether it
    // succeeded or failed. Retrying a failed refresh across subsequent probes
    // just burns more API quota for the same invalid_grant.
    if (outcome.status === 401 && !refreshAttempted && refreshSpec) {
      refreshAttempted = true;
      const result = await refreshTokens(refreshSpec, credentials);
      if (result.ok) {
        credentials = result.credentials;
        refreshed = true;
        // Refresh *replaces* any previous source: the file's refresh_token
        // (if we'd read live) just got consumed, so file is now stale too.
        source = "refresh";
        outcome = await runProbe(probe, credentials);
      } else {
        refreshError = { status: result.status, error: result.error };
      }
    }

    if (outcome.json !== undefined && outcome.status >= 200 && outcome.status < 300) {
      applyProbeMap(snapshot, probe, outcome.json);
    } else {
      errors.push({ probe: probe.url, status: outcome.status });
    }
  }

  // Expose updatedCredentials only when the final credentials are both
  //   (a) different from vault (`source !== "vault"`), and
  //   (b) not proven dead — if a refresh attempt on these creds returned
  //       invalid_grant / 400, writing them to vault would poison the
  //       cache with tokens the server has already rejected.
  //
  // `source === "refresh"` is never set unless refresh succeeded, so
  // (b) only bites when source="file" and refreshError is set — i.e. we
  // read the CLI file, tried to refresh with its rt, and the server said
  // no. In that case we leave vault untouched.
  const updatedCredentials =
    source !== "vault" && !refreshError ? credentials : undefined;

  return { snapshot, refreshed, source, updatedCredentials, errors, refreshError };
}

/**
 * Persist updated credentials back to storage.
 *
 * The `source` argument decides *which* storages to touch — this is the
 * rotating-refresh-token fix: writing the file back when we merely *read*
 * from it would be a no-op round-trip at best, and if the CLI rotated the
 * token between our read and our write, we'd clobber a freshly-issued
 * refresh_token with a stale copy of itself.
 *
 *   source="refresh" + isActive  → vault + file (file's rt was consumed)
 *   source="refresh" + !isActive → vault only   (file belongs to someone else)
 *   source="file"                → vault only   (file already has it)
 *   source="vault"               → noop         (nothing changed)
 */
export async function persistCredentials(
  provider: ProviderDefinition,
  entry: VaultEntry,
  newCredentials: Record<string, unknown>,
  source: CredentialsSource,
  isActive: boolean,
): Promise<VaultEntry> {
  if (source === "vault") return entry; // defensive — caller shouldn't call us

  if (source === "refresh" && isActive) {
    const oauth = provider.auth_methods.oauth;
    if (!oauth) throw new Error(`Provider has no oauth method`);
    await writeCredentials(oauth.credential_file, {
      credentials: newCredentials,
      grab_data: entry.grab_data,
    });
  }

  return { ...entry, credentials: newCredentials };
}

/** @deprecated Use `persistCredentials` with explicit `source`. Kept for back-compat. */
export async function persistRefreshedCredentials(
  provider: ProviderDefinition,
  entry: VaultEntry,
  newCredentials: Record<string, unknown>,
  isActive: boolean,
): Promise<VaultEntry> {
  return persistCredentials(provider, entry, newCredentials, "refresh", isActive);
}
