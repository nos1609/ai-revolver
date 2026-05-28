import type { ProviderDefinition } from "../types/index.js";
import { getByPath } from "./usage.js";

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
 *   - every identity field matches between vault and FS.
 *
 * Returns `{ ok: false, reason, vaultDisplay, fsDisplay }` otherwise.
 */
export function checkIdentity(
  provider: ProviderDefinition,
  vaultIdentity: Record<string, unknown> | undefined,
  fsRawJson: Record<string, unknown>,
): IdentityCheck {
  if (!provider.identity) return { ok: true };

  if (!vaultIdentity) {
    return mkErr(provider, "missing-in-vault", {}, fsRawJson);
  }

  for (const field of provider.identity.fields) {
    const vaultV = vaultIdentity[field];
    const fsV = getByPath(fsRawJson, field);

    if (vaultV == null) {
      return mkErr(provider, "missing-in-vault", vaultIdentity, fsRawJson);
    }
    if (fsV == null) {
      return mkErr(provider, "missing-in-fs", vaultIdentity, fsRawJson);
    }
    if (String(vaultV) !== String(fsV)) {
      return mkErr(provider, "mismatch", vaultIdentity, fsRawJson);
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
  return provider.identity.display
    .map((tpl) =>
      tpl.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
        // Prefixed form: "tokens.x", "credentials.x", "grab_fields.x"
        // Try full path traversal first (nested raw JSON), then flat key (vault identity)
        const v = getByPath(source, expr) ?? source[expr];
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
