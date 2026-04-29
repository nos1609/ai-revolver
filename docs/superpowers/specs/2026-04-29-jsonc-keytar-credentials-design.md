# JSONC credential files and store-backed secrets

## Context

`ai-revolver` provider definitions currently model OAuth credentials as a
credential file plus optional `credential_secrets`. This already fits Copilot:
its metadata is in `~/.copilot/config.json`, while the access token is stored
in the OS keyring through keytar (`service=copilot-cli`,
`account=https://github.com:<login>`).

The current implementation is close but not explicit enough:

- provider types only declare `format: json`, even when files are JSONC;
- the JSON reader tolerates comments only as an implementation detail;
- grab diagnostics can make a missing store secret look like a missing file;
- future credential sources such as VS Code SecretStorage or environment
  fallbacks need a separate design, not an ad-hoc Copilot patch.

## Goal

Implement a minimal universal credential-file/store contract and enable it for
Copilot first.

The first implementation must:

- support `credential_file.format: jsonc` while keeping `json` compatible;
- keep `credential_secrets` as the generic layer for store-backed tokens;
- read Copilot metadata from `~/.copilot/config.json`;
- read the Copilot token from keytar using the configured service/account
  template;
- report missing files, parse failures, missing secrets, and unavailable store
  backends as distinct errors.

## Non-goals

- No VS Code SecretStorage integration in this change.
- No generic `credential_sources[]` priority graph in this change.
- No migration of existing vault entries.
- No provider-wide behavior changes beyond Copilot using explicit `jsonc`.

## Design

### Provider schema

Extend `ProviderCredentialFile.format` from `"json"` to `"json" | "jsonc"`.

`json` keeps the current behavior for compatibility. `jsonc` is the explicit
format for files with comments, such as Copilot's managed config.

Copilot provider definition should declare:

```yaml
credential_file:
  path: "${HOME}/.copilot/config.json"
  format: jsonc
  mapping: {}
  grab_fields:
    - "lastLoggedInUser.host"
    - "lastLoggedInUser.login"
credential_secrets:
  - backend: keytar
    service: "copilot-cli"
    account: "${grab_data.lastLoggedInUser.host}:${grab_data.lastLoggedInUser.login}"
    mapping:
      access_token: password
```

This keeps Copilot provider-specific knowledge in YAML instead of hard-coding
it into the reader.

### Reader flow

`readCredentials()` remains the main provider reader:

1. Resolve and read the credential file.
2. Parse it according to `format`.
3. Extract normal `mapping` fields into `credentials`.
4. Extract `grab_fields` into `grab_data`.
5. For each `credential_secrets` entry, interpolate its `account` template.
6. Read the secret from the configured backend.
7. Merge the secret into normalized `credentials`.

The reader should stay provider-agnostic. It should not branch on
`providerName === "copilot"`.

### Error handling

Errors should identify the failing layer:

- missing credential file: include the resolved path;
- invalid JSON/JSONC: include the resolved path;
- unavailable keytar backend: say the system credential store is unavailable;
- missing keytar secret: include `service` and interpolated `account`.

Messages should stay cross-platform. User-facing text can say "system
credential store"; implementation details can include `backend=keytar` for
debuggability.

### Cross-platform notes

The contract should not assume Windows Credential Manager even though the
current failing case is on Windows. The same `keytar` abstraction maps to:

- Windows Credential Manager;
- macOS Keychain;
- Linux Secret Service / libsecret, where available.

If keytar cannot load on a platform, the error should make that explicit and
should not be confused with a missing Copilot config file.

## Testing

Implementation must follow TDD:

1. Add a failing provider-reader test for `format: jsonc` using a commented
   Copilot-like config file.
2. Add a failing provider-reader test for missing keytar secret that asserts
   the error includes service and account.
3. Add a failing Copilot provider test that proves the YAML uses `jsonc` and
   builds `https://github.com:<login>` from `lastLoggedInUser`.
4. Implement the minimal code to pass those tests.
5. Run the targeted tests, then `npm run build`, then the full `npm test`.

Mocks are acceptable for keytar in unit tests because the OS store is an
external dependency. Tests should still exercise the real provider reader and
real path interpolation.

## Future work

Keep the larger credential-source design in mind, but do not implement it here.

Candidate future model:

```yaml
credential_sources:
  - kind: file
    path: "${HOME}/.copilot/config.json"
    format: jsonc
  - kind: store
    backend: keytar
    service: "copilot-cli"
    account: "${grab_data.lastLoggedInUser.host}:${grab_data.lastLoggedInUser.login}"
  - kind: env
    names: ["GITHUB_TOKEN"]
```

That model would need explicit source priority, write-back rules, and separate
cross-platform tests. It is intentionally out of scope for this minimal change.
