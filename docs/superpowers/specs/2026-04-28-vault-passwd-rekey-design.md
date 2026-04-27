# Vault Password Rekey Design

Date: 2026-04-28
Status: design spec, no implementation

## Purpose

Implement `airev vault passwd` for the local encrypted-file vault without changing keyring behavior or persisted vault data format.

The command should rotate the password that protects `vault.enc`. It must not affect transfer-file passwords used by `vault export` / `vault import`, and it must not imply any password for OS keyring backends.

## Current State

`vault passwd` is currently a stub:

- If the effective backend is `keyring`, it prints that an airev master password is not used.
- If the effective backend is `encrypted-file`, it prints that changing the encrypted-file vault master password is not implemented.

The lower-level encrypted-file vault can already decrypt with a password and save encrypted data with the same password. It does not yet expose a rekey operation that reads with the old password and writes with a new password.

## Terminology

**Local vault password** / **пароль локального vault-а**  
Password used only for the local `vault.enc` file.

**Transfer file password** / **транспортный пароль**  
Password used only for encrypted export/import files. It must not be reused automatically for `vault.enc`.

**Effective backend**  
The backend selected by the shared vault backend rules:

- keyring unavailable -> `encrypted-file`;
- keyring available with entries -> `keyring`;
- keyring available, empty, and `vault.enc` exists -> `encrypted-file`;
- keyring available, empty, and no `vault.enc` -> `keyring`.

`vault passwd` must use the effective backend, not raw keyring availability.

## Approaches Considered

### Recommended: Dedicated In-Place Rekey

Add an explicit encrypted-file rekey operation:

1. Prompt for the current local vault password.
2. Decrypt and fully load `vault.enc`.
3. Prompt for a new local vault password and confirmation.
4. Encrypt the same vault data with the new password.
5. Atomically replace `vault.enc`.
6. Verify that the new password can read the rewritten vault.

This is the smallest correct implementation. It keeps import/export separate, preserves the existing file format, and has a clear failure boundary.

### Alternative: Export Then Import Internally

Use the existing export/import logic as an internal conversion path.

Rejected for now because it mixes transport snapshot semantics with local storage rekey semantics. It also increases the chance of confusing transfer-file password with local vault password, which the current docs explicitly avoid.

### Alternative: Migrate File -> Keyring -> File

Use backend migration as an indirect password rotation.

Rejected because it requires keyring availability and changes the user's backend state as an implementation detail. It is not a general encrypted-file password rotation.

## User Experience

### Effective Backend Is Keyring

Command:

```bash
airev vault passwd
```

Output remains informational:

```text
OS keyring backend is active; airev master password is not used.
```

No password prompts occur.

### Effective Backend Is Encrypted-File

Command:

```bash
airev vault passwd
```

Prompt sequence:

```text
Local vault password:
New local vault password:
Confirm local vault password:
```

Russian prompts should use the existing local-vault wording:

```text
Пароль локального vault-а:
Новый пароль локального vault-а:
Повтори пароль локального vault-а:
```

Success summary:

```text
✓ Local vault password changed.
```

The summary must not print profile ids, credentials, tokens, old password, or new password.

## Security Requirements

1. Wrong current password must fail before writing anything.
2. Empty new password must fail before writing anything.
3. Mismatched confirmation must fail before writing anything.
4. A successful rekey must verify-read with the new password before printing success.
5. After a successful rekey, the old password must no longer decrypt the current `vault.enc`.
6. The implementation must not create an export JSON or any plaintext credential file.
7. The command must not log credentials, access tokens, refresh tokens, profile ids, or passwords.
8. Secure wipe is not promised. The operation is logical re-encryption plus atomic replacement; filesystem journals, SSD wear leveling, and `.bak` recovery files may retain old encrypted bytes.
9. The existing `atomicWrite` backup behavior may remain. Backup files are encrypted blobs, not plaintext secrets.
10. On failure after opening the old vault but before replacement, the original `vault.enc` must remain readable with the old password.
11. On failure during replacement or verify, the command must throw and must not print a success summary.

## Architecture

### `src/vault/encrypted-file.ts`

Add a focused rekey capability for encrypted-file vaults. Acceptable shape:

```ts
export async function rekeyEncryptedFileVault(oldPassword: string, newPassword: string): Promise<void>
```

or an equivalent static method on `EncryptedFileVault`.

The helper should:

- read the current `vault.enc`;
- decrypt with `oldPassword`;
- parse and validate the vault payload enough to avoid writing malformed data;
- encrypt the same payload with `newPassword`;
- write via existing atomic JSON write path with `0o600`;
- verify by decrypting the rewritten file with `newPassword`.

It should not depend on `VaultStore.put()` because rekey is file-level metadata work, not profile mutation.

### `src/vault/prompt.ts`

Reuse:

- `promptExistingVaultPassword()`;
- `promptNewVaultPassword()`;
- `newVaultPasswordPromptLabels()`.

No transfer-password prompt should be used.

### `src/commands/vault.ts`

Change `vaultPasswd()`:

- call `describeEffectiveVaultBackend()`;
- if backend is `keyring`, keep current no-op message;
- if backend is `encrypted-file`, run the rekey flow;
- print success only after verify.

The command should keep the same CLI shape: `airev vault passwd`.

## Error Handling

Wrong old password:

```text
Wrong vault password.
```

Mismatched new password confirmation:

```text
Local vault passwords do not match.
```

Empty new password:

```text
Password required.
```

Verify failure after write:

```text
Rekey verify failed.
```

Exact Russian localization can follow existing style, but tests should assert semantic substrings instead of full punctuation.

## Testing Plan

Implementation must follow TDD.

### Unit Tests: Encrypted-File Rekey

Add tests that create a temp config dir and real `vault.enc`:

- successful rekey keeps all entries and opens with the new password;
- successful rekey no longer opens with the old password;
- wrong old password throws and leaves the file readable with the old password;
- empty new password throws before writing;
- verify failure throws and does not report success.

### Unit Tests: `vault passwd` Command

Add command-level tests:

- effective backend `keyring` prints no-op message and does not prompt;
- effective backend `encrypted-file` prompts existing + new + confirm;
- mismatched confirm rejects before rekey helper is called;
- successful rekey prints success;
- failed rekey does not print success.

### Regression Commands

After implementation:

```bash
npm run build
npm test
npm run test:mutation
node dist/index.js vault passwd
```

The live `node dist/index.js vault passwd` smoke should only be run against a disposable temp config or an explicit test vault, not the user's real vault, unless the user explicitly asks for a live password rotation.

## Out Of Scope

- Password strength policy beyond non-empty and confirmation.
- Recovery from forgotten passwords.
- Secure wipe guarantees for old encrypted bytes.
- Re-encrypting export/import files.
- Changing transfer-file password terminology.
- Changing the `vault.enc` file format.
- Automatic password rotation during import or migration.

## Open Decision

The only implementation choice left is API shape:

- static helper: `EncryptedFileVault.rekey(oldPassword, newPassword)`;
- standalone helper: `rekeyEncryptedFileVault(oldPassword, newPassword)`.

Recommendation: standalone helper. It makes the operation explicit, avoids exposing mutable password state on `EncryptedFileVault` instances, and is easier to test as a file-level operation.
