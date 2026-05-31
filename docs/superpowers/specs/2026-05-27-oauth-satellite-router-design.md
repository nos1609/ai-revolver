# OAuth satellite router

## Context

`airev` currently models a single global "active" credential per provider:
`switch <name>` overwrites `~/.codex/auth.json` (or its equivalent for other
providers), and the vault holds the rest as encrypted snapshots. This works for
manual identity rotation but does not support running a CLI against a
non-active account in parallel — for example, dispatching a subagent on a side
account while the main interactive session keeps using the primary one.

The constraint is that the CLI clients (Codex, Claude Code, Gemini, Qwen) read
their credentials from a fixed filesystem path. They do honor environment
variables that redirect that path (`CODEX_HOME`, `CLAUDE_CONFIG_DIR`), but the
caller has to materialize an alternate directory tree containing valid
credential files before launching the CLI under those env vars.

`airev` is the natural place to own that materialization: it already stores
every profile's OAuth state in the vault, already understands per-provider
credential formats via `providers/*.yaml`, and already runs `usage` probes and
OAuth refreshes against the same endpoints. What is missing is a primitive to
render an additional credential location on demand and to keep it consistent
with the vault when the CLI rotates tokens against it.

## Goal

Add a satellite mechanism that lets external callers (shells, skills,
subagent wrappers) run a provider CLI against any vault-stored profile other
than the current main, in parallel and without disturbing the main path.

`airev` itself does not orchestrate the CLI launch. It exposes only the
filesystem and vault primitives; the caller sets the env var and runs the
CLI between the primitives.

The first implementation must:

- store credentials for non-active profiles in a per-provider, per-name
  satellite directory under `~/.airev/satellites/<provider>/<name>/`;
- render a satellite from the vault on demand, idempotent on presence;
- accept reverse updates from a satellite back into the vault when the CLI
  rotates tokens against it;
- detect identity mismatch between vault and satellite before propagating
  any token change, refusing to merge credentials that belong to different
  accounts;
- coordinate concurrent operations on the same `(provider, name)` via an
  advisory lock with a user-facing way to clear stale locks;
- keep the existing `switch` and `grab` semantics intact for the active main
  path, extending `grab` to be polymorphic over main and satellite sources.

## Non-goals

- No CLI launcher inside `airev`. `airev` does not run codex, claude, or any
  provider binary. Callers compose the launch themselves.
- No automatic rotation policy or pool of accounts. The satellite the caller
  selects is the satellite that runs.
- No shared-state rendering for satellites (no shared `projects/`, `skills/`,
  `memory/`, `settings.json`). Satellites carry credentials only and are
  treated as short-lived disposable runs.
- No migration of legacy vault entries missing identity fields. Affected
  entries are reported and require a manual `grab --force` to upgrade.
- No concurrent-modification detection across both sides. Sync resolves drift
  by freshness only. The "both sides moved since last sync" case is a known
  limitation documented under Future work.
- No multi-provider profile bundling under a shared name. Profiles remain
  `(provider, name)` pairs, as today.

## Design

### Storage layout

The vault remains the single source of truth and the only encrypted store.
Two filesystem render targets exist:

- `~/.<provider>/...` — canonical native path, occupied by the active main
  profile (e.g. `~/.codex/auth.json`, `~/.claude/.credentials.json`).
- `~/.airev/satellites/<provider>/<name>/...` — per-name satellite render
  for any non-active profile. Provider-scoped so that different providers'
  satellite counts and contents stay decoupled.

The satellite directory contains only the credential file that the provider
manifest declares as `credential_file.path` (or its equivalent), under the
same filename the CLI expects (`auth.json` for Codex,
`.credentials.json` for Claude, and so on). It does not contain config,
shared assets, or any other state.

For providers like Claude Code whose `$CLAUDE_CONFIG_DIR` is also the home
for `projects/`, `skills/`, `memory/`, and `settings.json`, a satellite
run sees none of those — only credentials. This is by design: satellites
are short-lived "burnable" invocations (typically a single subagent call),
not a substitute home for interactive use. Callers needing those assets
should run against the native main path instead.

### Vault metadata additions

Each vault entry gains two fields beyond the credentials themselves:

- `identity` — the values extracted from the credential file for the fields
  declared in the provider manifest as `identity.fields`. Recorded at grab
  time and updated by sync.
- `last_refresh` — the most recent refresh timestamp known to the vault for
  this entry. Updated by `grab` (on creation) and by `sync` (on a successful
  merge in either direction). Sourced from the credential file's own
  refresh-time field where the provider exposes one (e.g. `last_refresh`
  for Codex), or from the file mtime as a fallback.

The vault also keeps an `active_main` pointer per provider, identifying
which profile name currently occupies the native main path. `switch` and
`grab` (on first-time onboarding) update this pointer; `render`, `sync`,
and `evict` do not.

### Provider manifest additions

Provider YAML gains an `identity` block:

```yaml
identity:
  fields: ["tokens.account_id"]
  display: ["${grab_fields.email}", "${tokens.account_id}"]
```

- `fields` lists the credential paths whose values define logical identity.
  Sync compares these between vault and FS; any mismatch refuses the merge.
- `display` lists human-readable expressions to print in identity-mismatch
  error messages. May reference `grab_fields` already captured alongside
  the credential.

Codex declares `tokens.account_id`. Claude, Gemini, Qwen declare their
respective stable identifiers (concrete paths chosen during implementation
based on each provider's credential shape).

### Commands

| Verb | Direction | Path |
|------|-----------|------|
| `switch <provider> <name>` | vault → FS | main only |
| `grab <provider> <name>` | FS → vault | polymorphic (main or satellite) |
| `render <provider> <name>` | vault → FS | satellite only |
| `sync <provider> <name>` | bidirectional | polymorphic (main or satellite) |
| `evict <provider> <name>` | satellite → ∅ | satellite only, vault kept |
| `vault unlock <provider> <name>` | clears lock | n/a |
| `status [<provider> [<name>]]` | read-only inspection | n/a |

#### `switch`

Replaces the active main credential at the native path with the named
profile from the vault.

Internally, before overwriting:
1. Run `sync` on the currently active main to back-propagate any FS-side
   rotation into the vault. If sync errors (identity mismatch, missing
   identity, lock contention), `switch` aborts and surfaces that error.
2. Read `vault[<name>]`, write to the native path atomically (tempfile +
   rename).
3. Update the `active_main` pointer to `<name>`.

`--force` skips the pre-sync step. Use only when the caller has accepted
that the current main's most recent refresh may be lost.

#### `grab`

Captures the credential file at the resolved FS location for `<name>` into
the vault under `<name>`. Path resolution, in order:

1. If `<name>` matches `active_main` for the provider → read from the
   native path. (The active main is always rendered there, and that copy
   is the fresher one if both native and a stale satellite happen to
   exist for the same name.)
2. Else if `~/.airev/satellites/<provider>/<name>/` exists → read from
   the satellite.
3. Else if the vault has no entry for `<name>` → read from the native
   path. This is the onboarding case for a brand-new profile being
   captured straight from the CLI's current session.
4. Else → error: "no FS location for `<name>`; render it first
   (`airev render`) or use `--force` if onboarding from a fresh login
   that has overwritten the native path." This prevents accidentally
   capturing whatever someone else's creds happen to be at the native
   path under the wrong name.

Behavior:

- If the vault has no entry for `<name>` → create. This is the onboarding
  case. On creation from the native path, the `active_main` pointer is set
  to `<name>`. On creation from a satellite, `active_main` is left alone.
- If the vault already has an entry → no-op by default. `--force`
  overrides and overwrites the vault entry, skipping identity guard.

`--force` additionally overrides the path-resolution rule 4 error,
falling back to the native path. This supports re-onboarding the same
name from a freshly-logged-in native session that replaced the prior
credentials.

Idempotency on presence keeps `grab` strictly an onboarding/`--force`
override verb. Routine drift handling belongs to `sync`.

`grab --force` is intentionally unguarded: when the native path holds
credentials for a different identity than the targeted vault entry,
`--force` will overwrite the vault entry with those credentials. Use only
when the caller has verified what is at the source. Routine refresh
capture should go through `sync`, which carries the identity guard.

#### `render`

Writes `vault[<name>]` to `~/.airev/satellites/<provider>/<name>/` (the
credential file only, per the manifest).

- If the satellite already exists → no-op by default. `--force` overrides
  and overwrites the satellite file, skipping identity guard.
- Errors if `<name>` equals the current `active_main` for the provider:
  the main lives at the native path, not in satellites. Caller should use
  `switch` instead.
- Errors if the vault has no entry for `<name>`.

#### `sync`

Resolves drift between the vault and the FS render for `<name>`. Path
resolution, in order:

1. If `<name>` matches `active_main` for the provider → resolve against
   the native path.
2. Else if `~/.airev/satellites/<provider>/<name>/` exists → resolve
   against the satellite.
3. Else → error: "no FS location for `<name>`; nothing to sync. Use
   `airev render` to materialize a satellite, or `airev switch` to make
   this profile the active main."

Unlike `grab`, sync has no native-path fallback for the missing case —
sync needs an existing render to compare against.

Two-stage resolution:

1. **Identity guard.** Read identity fields from both sides per the provider
   manifest's `identity.fields`. Any of the following → error, no write:
   - identity field missing on either side;
   - identity values differ between vault and FS.
   The error prints both sides' `identity.display` and suggests
   `grab --force` (to overwrite vault from FS) or `render --force` (to
   overwrite FS from vault) for intentional override.
2. **Freshness merge.** Compare `last_refresh` values:
   - FS newer → write FS credentials into vault entry (push FS → vault),
     update vault `last_refresh`;
   - vault newer → write vault credentials to FS atomically (push vault →
     FS), with the compare-and-swap guard below;
   - equal → no-op.

**Compare-and-swap on FS write.** When the freshness merge resolves to
"push vault → FS", airev re-reads the FS file immediately before writing
and confirms `last_refresh` has not changed since the initial read. If
it has — the provider CLI rotated the token during the sync operation —
the write aborts with a clear "FS changed concurrently, retry sync"
error. This closes the race between airev's read-decide-write and a
concurrent CLI refresh that atomic rename alone cannot prevent.

The reverse direction (FS → vault) is protected by the per-(provider,
name) advisory lock; only airev itself writes to the vault, and the lock
serializes those writes.

Flags:

- `--dry-run` — perform the same checks and report the resolution that
  would happen, without writing. This replaces a separate `diff` command.
- `--force` — single flag that skips both the identity guard and the
  freshness comparison. Direction is determined by `--push` or `--pull`,
  which become required when `--force` is set. Used for emergency override
  when the caller knows the desired direction.

#### `evict`

Removes the satellite directory `~/.airev/satellites/<provider>/<name>/`.
The vault entry is untouched.

- No-op if the satellite does not exist.
- Refuses if `<name>` is `active_main` — `evict` operates on satellites
  only.

#### `vault unlock <provider> <name>`

Removes the advisory lockfile for `(provider, name)`. Intended for
recovering from a crashed or SIGKILL-ed `airev` process. Locking is
described under "Concurrency" below.

Lives under the `vault` namespace rather than per-provider because it is
a rarely-used recovery operation, not part of the routine per-account
lifecycle. Keeping it out of the hot per-provider verb list (`grab`,
`switch`, `render`, `sync`, `evict`) reduces visual noise where users
spend most of their time.

#### `status`

Read-only report of the current state of profiles across vault, native
path, and satellites. Performs no writes and ignores locks (reading is
always safe given atomic-write guarantees).

Forms:

- `airev status` — top-level summary across every provider. One line
  per profile: provider, name, vault present?, render location
  (native/satellite/none), last_refresh, sync hint (in-sync, FS-newer,
  vault-newer, identity-mismatch, etc.).
- `airev <provider> status` — same summary scoped to one provider.
- `airev <provider> status <name>` — detailed report for one profile:
  vault entry (identity values, last_refresh), native path state if
  `<name>` is `active_main`, satellite state if rendered, lockfile state
  if any, the resolution `sync` would propose.

Output is designed for both human reading and machine parsing. A
`--json` flag emits a stable structured representation for tooling.

`status` is the primary observability surface; without it the new
satellite state is invisible until something goes wrong. It is therefore
in V1 scope rather than future work.

### Concurrency

Every verb that reads or writes either vault[name] or its FS render
acquires an exclusive advisory lock on
`~/.airev/locks/<provider>/<name>.lock` (via `flock`-equivalent) for the
duration of the operation. The lock covers `switch`, `grab`, `render`,
`sync`, and `evict`.

If the lock cannot be acquired, the operation errors with:

```
airev sync codex side1: another airev operation holds the lock for codex/side1
  lock file: ~/.airev/locks/codex/side1.lock (held by pid <N>)
  if no such process is running, clear with: airev vault unlock codex side1
```

The pid printed comes from the lockfile contents. `vault unlock` removes
the lockfile unconditionally.

The lock does not coordinate with the provider CLI itself (codex, claude,
etc.). Those clients write their credential files atomically (tempfile +
rename); readers in `airev` therefore always observe a consistent snapshot
even if the CLI rotates concurrently. The narrow gap between an `airev`
read and an `airev` write within a single operation is closed by the
advisory lock for `airev`-to-`airev` races.

### Atomic writes

Every credential file write — to the native path (`switch`, `sync`
pull-direction) or to a satellite (`render`, `sync` pull-direction) — uses
tempfile + rename with `0600` permissions, matching the existing
`atomic_write: true` contract in the provider manifests.

Every vault mutation (`grab`, `sync` push-direction) writes the whole
encrypted vault file atomically (tempfile + rename) so that a crash never
leaves a half-written vault.

### Identity field absence

If a vault entry was created before `identity.fields` was declared for its
provider, the entry has no recorded `identity`. Sync against such an entry
errors with:

```
airev sync codex side1: vault entry has no identity recorded
  fix: airev grab --force codex side1   (re-capture from FS to upgrade)
```

This applies symmetrically: if a freshly-grabbed FS file has the identity
field absent (manual edit, unexpected provider format change), sync
errors with the same shape, suggesting investigation.

There is no automatic backfill. Upgrading legacy entries is a deliberate
user action.

**Format compatibility.** Adding `identity` to vault entries is additive:
the existing decode path treats it as extra metadata and ignores it on
old code paths. Legacy vault files load and decrypt normally; the missing
identity surfaces only at `sync` time, with the fix path being a manual
`grab --force`. There is no parse-breaking schema change.

### Caller contract

The expected pattern for running a CLI against a satellite:

```sh
airev render codex side1
CODEX_HOME=~/.airev/satellites/codex/side1 codex exec "..."
airev sync codex side1
```

`render` is idempotent so it costs nothing on subsequent calls. `sync`
captures any token rotation the CLI performed during the run back into
the vault. The satellite directory itself persists between runs unless the
caller calls `evict`.

For main-path runs the contract is just:

```sh
codex exec "..."
airev sync codex <active-main-name>
```

`render` is not used; the native path is always rendered.

## Testing

The provider-agnostic engine is the new surface; per-provider correctness
piggybacks on the existing provider manifests.

Unit-level (engine):

- `render` creates the satellite directory and credential file with `0600`
  perms when none exists; no-op when present; error on `--force` when
  vault entry is missing.
- `grab` creates a vault entry from a native-path file (and sets
  `active_main`); creates from a satellite-path file when a satellite
  exists for the name (and does not touch `active_main`); errors when
  neither satellite nor native path holds a readable credential file;
  no-op when vault entry already present (without `--force`); overwrites
  with `--force` regardless of identity mismatch.
- `sync` direction matrix: vault-only-changed, FS-only-changed,
  both-equal, both-changed-vault-newer, both-changed-FS-newer.
- `sync` identity guard: identity match → freshness merge runs; identity
  mismatch → no write, error message contains both sides' display values;
  identity missing → no write, error suggests `grab --force`.
- `sync --dry-run` produces the resolution report without writing either
  side.
- `sync --force --push` / `sync --force --pull` ignore identity and
  freshness and write the chosen direction.
- `evict` removes the satellite directory; no-op when absent; errors on
  the active main name.
- `switch` runs the pre-sync step; surfaces a sync error before
  overwriting; updates `active_main` only on success.
- `vault unlock` removes the lockfile when present; no-op when absent.
- `status` returns the expected sync hint for each state combination:
  in-sync, vault-newer, FS-newer, identity-mismatch, missing-identity,
  no-vault-entry, no-FS-render, lock-held. `--json` output stable across
  versions for the documented schema.
- `sync` compare-and-swap: when push vault → FS resolves and a
  concurrent FS rotation lands between the initial read and the write,
  sync aborts the write with the documented "FS changed concurrently"
  error rather than overwriting the rotation.

Concurrency:

- Two concurrent `airev` operations on the same `(provider, name)` — the
  second blocks or errors per locking strategy; on lock release the second
  proceeds correctly.
- Crash mid-operation leaves a recoverable state: vault is either fully
  old or fully new; satellite credential file is either fully old or
  fully new; lockfile may remain (cleared via `vault unlock`).

Provider integration:

- Codex satellite end-to-end: grab from native path, render to satellite,
  read satellite from `CODEX_HOME`-redirected process, observe a
  simulated refresh in satellite, sync back to vault, verify vault entry
  matches the refreshed file.
- Same flow for Claude, Gemini, Qwen — verifying that each provider
  manifest's `identity.fields` resolves to a non-empty stable value.

## Future work

- **Concurrent-modification detection.** Add a `last_sync` watermark in
  vault metadata and refuse the freshness merge when both sides moved
  since the watermark. Surfaces with a clear "both changed" error
  instructing the caller to choose direction via `sync --force`. Today's
  spec accepts that divergent concurrent changes silently lose one side.
- **Per-provider satellite layout extensions.** If a future caller needs a
  satellite to expose more than credentials (shared assets, per-satellite
  config), the provider manifest gains a `satellite_layout` block
  describing what to render and what to symlink. Out of V1 scope:
  satellites are credential-only.
- **Pool/rotation policy.** A higher layer above satellites that selects
  among multiple accounts by usage or round-robin. Layers on top of the
  existing `usage` probes; not part of this design.
- **JWT-based identity verification.** Compare `sub` claims from
  decoded `id_token` JWTs in addition to declared `identity.fields` for
  stronger same-account assurance.
