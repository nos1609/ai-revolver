// ── Profile ──────────────────────────────────────────────

export type AuthType = "oauth" | "api_key";

export interface Profile {
  id: string;
  name: string;
  provider: string;
  auth_type: AuthType;
  created_at: string;
}

export interface ProfileCredentials {
  /** Normalised auth core (access_token, refresh_token, expires_at, …) */
  credentials: Record<string, unknown>;
  /** Pass-through context grabbed from the CLI file */
  grab_data: Record<string, unknown>;
}

export interface ProfileEntry extends Profile {
  /** Stored only in vault, never in registry */
  secrets?: ProfileCredentials;
}

// ── Provider YAML schema ─────────────────────────────────

export interface ProviderCredentialFile {
  path: string;
  format: "json";
  mapping: Record<string, string>;
  grab_fields: string[];
  permissions: number;
  atomic_write: boolean;
  preserve_unknown_fields: boolean;
}

export interface ProviderExtraFile {
  path: string;
  format: "json";
  grab_fields: string[];
  permissions: number;
}

export interface ProviderOAuthMethod {
  credential_file: ProviderCredentialFile;
  extra_files?: ProviderExtraFile[];
  env_on_switch?: Record<string, string>;
  token_refresh?: ProviderTokenRefresh;
}

/** Declarative OAuth refresh: POST JSON, extract new tokens by JSON-path. */
export interface ProviderTokenRefresh {
  url: string;
  /** Header name → template string. `${credentials.field}` interpolation. */
  headers?: Record<string, string>;
  /** JSON body: key → template string (literal or `${credentials.field}`). */
  body: Record<string, string>;
  /**
   * How to merge the response back into `credentials`.
   *   normKey → "json.path" or "json.path | transform"
   * Supported transforms:
   *   - `now_ms_plus_seconds`  (Claude: expires_in sec → expiresAt ms)
   */
  update: Record<string, string>;
}

export interface ProviderApiKeyMethod {
  env: Record<string, string>;
  env_extra?: Record<string, string>;
}

export interface ProviderDefinition {
  name: string;
  version: number;
  auth_methods: {
    oauth?: ProviderOAuthMethod;
    api_key?: ProviderApiKeyMethod;
  };
  detection: {
    commands: string[];
    paths: string[];
  };
  usage?: ProviderUsage;
}

// ── Usage probe schema ───────────────────────────────────

/** A single HTTP probe that produces part of a UsageSnapshot. */
export interface ProviderUsageProbe {
  url: string;
  /** HTTP method for the probe. Defaults to GET. */
  method?: "GET" | "POST";
  /** Header name → template. `${credentials.field}` interpolation. */
  headers?: Record<string, string>;
  /** Built-in parser for provider responses that are not simple JSON paths. */
  parser?: "copilot_internal_user";
  /**
   * Map a snapshot field to a JSON-path in the response.
   *   e.g. `email: "user.email"`
   *        `primary.used_percent: "rate_limit.used_percent"`
   *        `primary.resets_at: "rate_limit.resets_in_seconds | now_ms_plus_seconds"`
   */
  map: Record<string, string>;
}

export interface ProviderUsage {
  /**
   * Fields derived from credentials (not HTTP probes). Applied before probes.
   *   e.g. `email: "id_token | jwt_claim:email"` — decodes JWT from vault.
   * Expressions read from the credentials object via `getByPath`, then apply
   * the same transform DSL as probe maps.
   */
  static?: Record<string, string>;
  probes: ProviderUsageProbe[];
}

/** One rate-limit window (5h / 7d / etc.). */
export interface UsageWindow {
  used_percent: number;
  /** Absolute epoch ms when the window resets. */
  resets_at?: number;
  /**
   * Window length in seconds — when the API tells us directly
   * (e.g. Codex `limit_window_seconds`). Renderer turns it into a label
   * like "5h" or "7d" instead of hardcoded guesses.
   */
  window_seconds?: number;
}

/** Canonical normalized shape across all providers. */
export interface UsageSnapshot {
  email?: string;
  plan?: string;
  primary?: UsageWindow;
  secondary?: UsageWindow;
}

// ── Registry ─────────────────────────────────────────────

export interface RegistryData {
  version: number;
  profiles: Profile[];
}

export interface ActiveData {
  /** provider → profile id */
  active: Record<string, string>;
}

// ── Vault ────────────────────────────────────────────────

export interface VaultEntry {
  profile_id: string;
  credentials: Record<string, unknown>;
  grab_data: Record<string, unknown>;
}

export interface VaultData {
  version: number;
  entries: VaultEntry[];
}

// ── Exit codes ───────────────────────────────────────────

export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  PROFILE_NOT_FOUND: 2,
  VAULT_LOCKED: 3,
  CREDENTIALS_EXPIRED: 4,
  PROVIDER_NOT_INSTALLED: 5,
  FILE_BUSY: 10,
} as const;
