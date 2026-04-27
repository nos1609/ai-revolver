# Cross-Platform Vault Hardening Design

Date: 2026-04-27

## Purpose

The PoC was developed and debugged primarily on Windows. The current Linux work exposed several places where platform-specific assumptions can leak into runtime behavior and tests. This design hardens the vault/config/prompt/migration surface for Windows, Linux, and macOS without changing persisted data formats or provider manifests.

The goal is to make Linux a first-class runtime target while preserving Windows behavior and keeping macOS behavior covered by contract tests until live macOS testing is available.

## Scope

In scope:

- Linux parity for libsecret keyring and encrypted-file fallback.
- Cross-platform contracts for config paths, keyring labels, backend detection, and command messaging.
- Migration safety between `keyring` and `encrypted-file`.
- Test isolation that does not touch real user state directories.
- Regression coverage for password prompt chunked input.

Out of scope:

- Changing the format of `registry.json`, `active.json`, `stale.json`, or `vault.enc`.
- Changing provider YAML schema.
- Implementing a full `vault passwd` password-rotation flow.
- Live macOS verification in this implementation pass.
- Automatic migration at CLI startup.

## Platform Contract

Platform-specific behavior should be centralized behind a small contract. Commands should not directly infer behavior from environment variables or hardcoded OS labels.

The contract is:

- `src/platform/index.ts` remains the owner of `getPlatform()`, `getConfigDir()`, `getHome()`, and `resolveTemplatePath()`.
- `src/vault/info.ts` is the read-only vault/platform information layer: vault paths, keyring backend labels, and backend status diagnostics.
- `src/vault/factory.ts` remains responsible for opening vault backends.
- `src/commands/vault.ts` should use shared backend detection for `status`, `passwd`, and `migrate` so all subcommands describe the same active backend.

Commands should ask shared helpers:

- Which config directory is active?
- Which vault backend is actually being used?
- What user-facing name should this keyring backend have?
- Is keyring unavailable, available but empty, or available with entries?

They should not directly encode platform-specific path rules or Windows-only messages.

## Linux Adaptation

Linux has two supported runtime modes.

### Keyring Mode

If `secret-tool` is installed and Secret Service is available, `KeyringVault` uses libsecret. Availability should be based on a real probe, not only binary presence.

User-facing diagnostics should distinguish:

- `secret-tool` missing.
- Secret Service unavailable.
- Keyring available but empty.
- Keyring available with entries.

`vault status` should display `Linux libsecret`, not a Windows DPAPI label.

### Encrypted-File Fallback

If libsecret is unavailable, `vault.enc` with a local vault password is the supported fallback. It must work in:

- Interactive TTY.
- Non-TTY pipe input, for example `printf 'pass\n' | airev env --shell bash`.
- Multiple sequential prompts, such as export/import/migration flows.

Errors should be explicit:

- Missing password.
- Wrong local vault password.
- Keyring unavailable.

The fallback should continue storing secrets in `vault.enc` under the active config directory and should preserve `0600` permissions on POSIX platforms.

## Windows and macOS Guardrails

Windows behavior must remain stable:

- Config directory is `%APPDATA%\ai-revolver`, with the existing fallback under the home directory.
- DPAPI file path remains `configDir/keyring/vault_data.dpapi`.
- CredUI identity verification remains Windows-only.
- Atomic write keeps the Windows retry/copy fallback for locked files.
- User-facing keyring label is `Windows DPAPI`.

macOS behavior is contract-covered in this pass:

- Config directory is `~/Library/Application Support/ai-revolver`.
- Keyring backend label is `macOS Keychain`.
- Keychain backend continues using the `security` CLI.
- Gemini's `GEMINI_FORCE_FILE_STORAGE=true` behavior is preserved.

Live macOS testing is deferred, but unit tests should cover the macOS path and label contracts.

## Backend Detection

The CLI must distinguish keyring availability from the actual active source backend.

The effective backend selection rules are:

- If keyring is unavailable, the source backend is `encrypted-file`.
- If keyring is available and contains entries, the source backend is `keyring`.
- If keyring is available but empty and `vault.enc` exists, the source backend is `encrypted-file`.
- If keyring is available but empty and `vault.enc` does not exist, the source backend is `keyring`.

`vault status`, `vault passwd`, and `vault migrate` must use these same rules.

This prevents cases where a command says "OS keyring is active" merely because keyring is available, while the actual vault source is `vault.enc`.

## Migration Safety

Vault migration must follow copy-verify-cleanup.

Flow:

1. Resolve effective source backend.
2. Resolve target backend from the command argument.
3. Reject immediately if source and target are the same.
4. In non-TTY mode, require either `--yes` or `--keep-source`.
5. Open source and target explicitly through `openVaultBackend()`.
6. Read source ids.
7. Reject target conflicts before writing unless `--replace` is set.
8. Copy entries to target.
9. Re-read target entries and verify equality.
10. Delete source entries only after successful verification and only when requested.

Cleanup behavior:

- `--keep-source` always keeps source entries.
- `--yes` deletes verified source entries after successful copy and verify.
- Interactive mode may ask whether to delete source entries.
- Interactive deletion may delete only the `verifiedIds` captured in the migration report.

Migration must not delete `vault.enc` as a file. It should delete source entries through the `VaultStore` interface.

## Prompt Behavior

`promptPassword()` must support:

- Raw TTY character input.
- Chunked input where a full password and newline arrive in one `data` event.
- EOF after a password in piped mode.
- Multiple sequential prompts in one process.

The existing chunked-input bug is considered a regression target and requires a dedicated test.

`process.exit()` on Ctrl+C can remain as current behavior, but tests may treat it as a limited/manual case unless implementation changes make it injectable.

## Test Strategy

Implementation must follow TDD. Every production behavior change gets a failing test first.

### Unit Contract Tests

Cover platform and backend contracts without relying on the current machine:

- Windows, Linux, and macOS config paths.
- Windows DPAPI, Linux libsecret, and macOS Keychain labels.
- Vault paths derived from a shared config directory.
- Effective backend detection rules.

Tests should mock shared abstractions such as `getPlatform()`, `getConfigDir()`, and backend availability rather than mutating real `APPDATA`, `XDG_CONFIG_HOME`, or home directories.

### Command Tests

Cover user-visible command behavior:

- `vault status` reports the effective backend.
- `vault passwd` reports based on the effective backend, not only keyring availability.
- `vault migrate` handles `--yes`, `--keep-source`, non-TTY restrictions, source/target equality, conflicts, and keyring-unavailable errors.
- `vault path` uses shared path helpers.

### Prompt Tests

Cover:

- Chunked input: `"pass\n"`.
- Character-by-character input.
- EOF after password.
- Sequential prompts.

### Filesystem Tests

Cover only safe filesystem behavior:

- POSIX permissions on encrypted vault and credential files.
- Windows write branch through mocked platform behavior.
- Backup auto-recovery from `.bak`.

### Manual Smoke Tests

After unit tests and build:

- Linux fallback: `printf 'pass\n' | airev env --shell bash`.
- Linux `vault status` and `vault path`.
- Linux libsecret flow when `secret-tool` and Secret Service are available.
- Windows smoke on the Windows environment.
- macOS smoke in the deferred live macOS pass for Keychain, config path, and Gemini file-storage behavior.

## Acceptance Criteria

- Linux fallback vault works in TTY and pipe mode.
- Linux keyring mode displays Linux-specific status when libsecret is available.
- Windows labels, paths, and DPAPI behavior remain protected by tests.
- macOS paths and labels are protected by tests.
- `vault status`, `vault passwd`, and `vault migrate` agree on effective backend selection.
- Migration never deletes source data before target verification.
- Tests do not read or write real user config directories.
- `npm test` passes.
- `npm run build` passes.
