# OAuth credential lifecycle — universal guards and freshness

## Context

`airev` already ships a provider-agnostic OAuth lifecycle for Codex:

- `token_refresh` in `providers/*.yaml` + lazy refresh on 401 in `usage`
- `liveFromFile` for the active profile (CLI file may have rotated tokens)
- `sync` / `status` reconciliation via `identity` + `last_refresh`
- pre-switch auto-sync on the outgoing profile

Claude and Gemini use the same refresh and usage machinery, but **sync is
effectively blind** for them: their credential files do not expose
`last_refresh`, so freshness comparison always yields `0` on both sides and
`sync` becomes a no-op unless `--force` is used.

A separate gap allows **credential poison** to propagate: empty
`refresh_token` values are treated as legitimate data everywhere:

- `reader.ts`: `""` is not `undefined`, so it is captured on read
- `writer.ts` / `grab` / `sync`: empty incoming values overwrite non-empty
  stored values

Observed failure chain (Claude, 2026-06-15):

1. Access token expired; Claude CLI refresh failed → wrote `refreshToken: ""`
2. `grab --force` (or sync push) copied poison into vault
3. `switch` restored poison from vault to the native credential file
4. API calls returned 401; `claude auth status` still showed cached metadata

This is not a Claude-specific bug in `switch` — it is a **missing universal
merge policy** plus **incomplete freshness** for providers without
`last_refresh`.

## Goal

Add a small, provider-agnostic credential lifecycle layer that:

1. Prevents empty sensitive tokens from poisoning vault or FS on any merge
2. Makes `sync` / `status` / pre-switch sync work for all OAuth providers
   (not only Codex), without duplicating diagnostics in `grab` or `switch`
3. Preserves existing command roles: `sync` + `status` diagnose; `grab` captures

## Non-goals

- No new CLI commands
- No refresh-before-switch network call in v1
- No per-provider YAML policy blocks in v1 (sensible code defaults only)
- No change to `grab` UX messaging beyond existing no-op hint
- No automatic re-auth or CLI launcher
- No mtime-based freshness for vault-side comparisons (vault stores
  `last_refresh`; FS side may use mtime as fallback)

## Command responsibilities (no duplication)

| Command | Responsibility |
|---------|----------------|
| `grab` | Initial capture. Without `--force`: no-op if vault entry exists, hint to use `sync`. With `--force`: emergency overwrite from FS. **No diagnostic output beyond existing hints.** |
| `sync` | Sole reconcile path FS ↔ vault: identity guard, freshness merge, push/pull, error hints (`grab --force` / `render --force`). |
| `status` | Read-only observability: `sync_hint`, identity, `last_refresh`. Extended hints for degraded credentials. |
| `switch` | Pre-sync outgoing profile (unchanged), then vault → FS via router. |
| `usage` | Live probes, lazy refresh on 401, stale marking on dead refresh (unchanged role). |

Infrastructure merge guards run silently inside the write paths used by
`sync`, `switch`, `grab`, `render`, and `usage` — they do not emit their own
user-facing diagnostics.

## Design

### 1. Credential policy layer

New module: `src/core/credential-policy.ts`

Provider-agnostic helpers used by `reader`, `writer`, `grab`, `sync`, and
`usage` persist paths.

#### Sensitive fields (v1 defaults)

Apply policy to normalized OAuth fields present in any provider mapping:

- `refresh_token` (required in v1)
- Optionally `access_token` (same empty-as-absent rule; clobber guard only
  where merge semantics apply)

#### Rules

**`sanitizeCredentialsRead(credentials)`**

- For each sensitive field: if value is `""` or whitespace-only, remove the
  key from the returned object (treat as absent, not as an intentional empty
  token).

**`mergeCredentials(existing, incoming)`**

- Start from `{ ...existing }`
- For each key in `incoming`:
  - If key is sensitive and `incoming[key]` is empty/absent after sanitize:
    - If `existing[key]` is non-empty → **keep existing** (no clobber)
    - Else → leave absent (no write of `""`)
  - Else → `existing[key] = incoming[key]`

**`isRefreshDegraded(credentials)`**

- Returns true when `refresh_token` key is missing or empty after sanitize.
- Used by `status` only (read-only hint); not a separate command.

#### Integration points

| Caller | When |
|--------|------|
| `reader.ts` | After mapping extraction → `sanitizeCredentialsRead` |
| `writer.ts` | Before write: merge file existing JSON mapping fields with incoming credentials via policy |
| `grab.ts` | `vault.put`: `mergeCredentials(existingVault.credentials, incoming)` |
| `sync.ts` | push-fs-to-vault: merge into vault entry; push-vault-to-fs: writer merge |
| `usage` persist | Uses existing `persistCredentials`; writer path gets policy via `writer.ts` |

`grab --force` still overwrites in the sense of upserting, but merge policy
prevents a dead FS session from erasing a live vault `refresh_token`.

### 2. Universal freshness

New function: `computeFreshness(ctx)` in `src/core/credential-policy.ts` or
`src/core/freshness.ts`.

```typescript
interface FreshnessContext {
  grabData: Record<string, unknown>;
  rawJson: Record<string, unknown>;
  credentials: Record<string, unknown>;
  /** Required for FS-side evaluation only */
  fileMtimeMs?: number;
}

function computeFreshness(ctx: FreshnessContext): number;
```

**Priority (max of available signals):**

1. `grab_data["last_refresh"]` or raw JSON `last_refresh` (number or ISO string)
   — Codex and any provider that exposes the field
2. `credentials.expires_at` when finite — Claude, Gemini
3. `fileMtimeMs` when provided — FS-side fallback per original satellite-router
   design intent

Returns `0` when no signal is available.

#### Replace duplicated extraction

Unify logic currently split across:

- `grab.ts` → `extractLastRefresh`
- `sync.ts` → `extractLastRefreshFromRaw`
- `status.ts` → `extractTs`

All call `computeFreshness` with appropriate context. Vault-side calls omit
`fileMtimeMs`.

#### `vault.last_refresh` updates

| Event | Update |
|-------|--------|
| `grab` / `sync` push-fs-to-vault | `last_refresh = computeFreshness(fsContext)` |
| `usage` successful refresh (`source === "refresh"`) | `last_refresh = Date.now()` |
| `usage` sync-from-file (`source === "file"`, credentials persisted) | `last_refresh = max(vault.last_refresh, computeFreshness(fileContext))` |

Today `usage` updates credentials but not `last_refresh` — that gap is closed
here.

### 3. Status hints (diagnostics live here)

Extend `sync_hint` in `status` (machine + human readable). Existing hints
unchanged: `in-sync`, `fs-newer`, `vault-newer`, `identity-mismatch`, etc.

New hints when identity check passes:

| Hint | Condition | User action |
|------|-----------|-------------|
| `fs-degraded` | FS refresh degraded, vault not | `airev <p> sync <n>` (expect vault → FS pull) |
| `both-degraded` | Both sides refresh degraded | Re-auth in provider CLI, then `grab --force` |
| `vault-degraded` | Vault degraded, FS not | `airev <p> sync <n>` if FS newer; else re-auth + `grab --force` |

`sync` itself does not add new hint strings — it continues to print resolution
and existing error templates. `status` is the place to see which case applies.

When `both-degraded`, `sync` freshness merge is a no-op; identity guard may
still pass. No automatic stale flag from `sync` — `usage` refresh failure and
existing stale machinery remain the live/dead signal.

### 4. Pre-switch behavior (unchanged flow, better data)

`switch` already calls `sync` on the outgoing profile. With working
freshness:

- Outgoing profile: if CLI rotated tokens on FS → FS newer → push to vault
  before native path is overwritten
- Incoming profile: `routeSwitch` writes vault → FS; writer merge guard
  prevents vault poison from clearing a coincidentally still-good FS refresh
  (defense in depth; primary fix is vault merge on grab/sync)

### 5. Recovery scenarios

**A. Vault good, FS poisoned (common after CLI refresh fail)**

- `status`: `fs-degraded` or `vault-newer`
- `sync`: pull vault → FS → file healed

**B. Vault poisoned via old grab, FS poisoned**

- `status`: `both-degraded`
- User re-auths in CLI → `grab --force` captures new tokens
- Merge guard ensures partial grabs do not make vault worse if vault still had
  a non-empty refresh (unlikely in B)

**C. Vault good, never poisoned, user only runs switch**

- Switch writes vault creds; if vault refresh present, file restored

## Data flow

```
CLI file ──read──► sanitizeRead ──► grab/sync/usage
                      │
vault ◄──mergeVault──┘
  │
  └──mergeWrite──► CLI file   (switch / sync pull / usage refresh persist)

computeFreshness ──► sync / status / grab last_refresh / usage persist
```

## Testing

Unit tests in `tests/unit/credential-policy.test.ts`:

- `sanitizeCredentialsRead`: `""` → key absent
- `mergeCredentials`: non-empty existing + empty incoming → keep existing
- `mergeCredentials`: both empty → no `refresh_token` key in result
- `isRefreshDegraded`: true/false cases

Extend existing sync tests:

- Claude-like fixture without `last_refresh`: FS mtime newer → push-fs-to-vault
- Vault newer with good refresh, FS empty refresh → pull restores FS (writer merge)

Extend `status` tests:

- `fs-degraded` / `both-degraded` hints

Regression:

- Codex `last_refresh` remains primary freshness signal
- `grab` no-op without `--force` unchanged
- `sync` identity-mismatch errors unchanged

## Migration

- No vault format version bump
- Existing entries with valid `refresh_token` unaffected
- Entries already poisoned (`refresh_token: ""`) remain degraded until re-auth;
  `status` surfaces `both-degraded` / `vault-degraded`
- Users may heal FS from vault via `sync` when vault still holds a good refresh

## Future work (out of scope)

- Optional `oauth.credential_policy` / `oauth.freshness` blocks in provider YAML
- Refresh-before-switch when access expired and vault refresh is valid
- `sync` detecting concurrent CLI rotation via expires_at delta in addition to
  last_refresh CAS