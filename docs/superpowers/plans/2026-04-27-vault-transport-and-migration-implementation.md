# Vault Transport and Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement distinct transport-password prompts, confirmed creation of new encrypted-file vaults, and safe backend-to-backend vault migration.

**Architecture:** Keep export/import as portable snapshot flow and migration as local vault-store flow. Add small password prompt helpers, extend vault factory for explicit backend opening, and put copy/verify/delete behavior in a testable migration core.

**Tech Stack:** TypeScript ESM, Vitest, Node fs/path/process APIs, existing `VaultStore`, `KeyringVault`, and `EncryptedFileVault`.

---

### Task 1: Transport and Vault Password Prompts

**Files:**
- Modify: `src/vault/prompt.ts`
- Test: `tests/unit/vault-prompt.test.ts`

- [ ] Write failing tests for `transportPasswordPromptLabel("export")`, `transportPasswordPromptLabel("import")`, `newVaultPasswordPromptLabels()`, and `existingVaultPasswordPromptLabel()`.
- [ ] Run `npm test -- tests/unit/vault-prompt.test.ts` and verify missing exports fail.
- [ ] Add pure label helpers plus prompt wrappers in `src/vault/prompt.ts`; wrappers call existing `promptPassword`.
- [ ] Run the targeted test and full `npm test`.
- [ ] Commit prompt helpers.

### Task 2: Confirm New Encrypted-File Vault Passwords

**Files:**
- Modify: `src/vault/factory.ts`
- Modify: `src/vault/encrypted-file.ts`
- Test: `tests/unit/vault-factory.test.ts`

- [ ] Write failing tests for fallback encrypted-file behavior: existing `vault.enc` asks once; missing `vault.enc` asks new+confirm; mismatched confirm throws before returning a vault.
- [ ] Run targeted test and verify failure on unsupported options/helpers.
- [ ] Add `encryptedVaultExists()` or equivalent path helper to `EncryptedFileVault`.
- [ ] Extend `openVault({ confirmNewFilePassword?: boolean })` to confirm only when keyring is unavailable and `vault.enc` does not exist.
- [ ] Change import command later to call `openVault({ confirmNewFilePassword: true })`.
- [ ] Run targeted test and full `npm test`.
- [ ] Commit confirmed new vault password behavior.

### Task 3: Import/Export Prompt Wording

**Files:**
- Modify: `src/commands/export.ts`
- Modify: `src/commands/import.ts`
- Test: `tests/unit/import-export-prompts.test.ts`

- [ ] Write failing tests that encrypted export requests transport export labels and encrypted import requests transport import label before opening the local vault.
- [ ] Run targeted test and verify old generic labels fail.
- [ ] Replace inline export/import prompt strings with prompt helpers.
- [ ] Make `importProfiles()` open the local vault with `confirmNewFilePassword: true`.
- [ ] Run targeted test and full `npm test`.
- [ ] Commit transport password prompt wording.

### Task 4: Migration Core

**Files:**
- Create: `src/vault/migrate.ts`
- Test: `tests/unit/vault-migrate.test.ts`

- [ ] Write failing tests for conflict preflight, copy+verify, keep-source, delete-source after verify, and verify-failure preserving source.
- [ ] Run targeted test and verify missing module fails.
- [ ] Implement `migrateVaultEntries({ source, target, cleanup, replace })` over opened `VaultStore` instances.
- [ ] Ensure reports contain counts/backend names only and no credentials/profile ids in messages.
- [ ] Run targeted test and full `npm test`.
- [ ] Commit migration core.

### Task 5: Explicit Backend Open

**Files:**
- Modify: `src/vault/factory.ts`
- Test: `tests/unit/vault-factory.test.ts`

- [ ] Write failing tests for `openVaultBackend("keyring")`, `openVaultBackend("encrypted-file")`, and unsupported/unavailable backend errors.
- [ ] Run targeted test and verify missing export fails.
- [ ] Implement explicit backend opening with existing keyring verification behavior and encrypted-file password confirmation semantics.
- [ ] Run targeted test and full `npm test`.
- [ ] Commit explicit backend open.

### Task 6: CLI Migration Wiring

**Files:**
- Modify: `src/commands/vault.ts`
- Modify: `src/index.ts` if extra flags need parsing
- Test: `tests/unit/vault-command.test.ts`

- [ ] Write failing tests for `vault migrate file --keep-source`, `vault migrate file --yes`, non-TTY failure without either flag, and invalid same-source/target error.
- [ ] Run targeted test and verify current stub fails.
- [ ] Replace migrate stub with source detection, target opening, security warning output, migration call, optional prompt/delete behavior.
- [ ] Parse `--yes`, `--keep-source`, and optional `--replace`.
- [ ] Run targeted test, `npm run build`, and full `npm test`.
- [ ] Commit CLI migration wiring.

### Task 7: Documentation and Smoke Tests

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-27-vault-transport-and-migration-design.md` only if implementation forces a design correction

- [ ] Update README examples with transport password terminology and migration flags.
- [ ] Run smoke commands: `node dist/index.js vault export -h`, `node dist/index.js vault import -h`, `node dist/index.js vault migrate file --keep-source` in a safe mocked/temp config path if needed.
- [ ] Run `npm run build` and `npm test`.
- [ ] Commit docs and final verification.

