# Usage Duplicate Diagnostics

## Goal

Add a minimal duplicate-account diagnostic to `airev usage`.

The diagnostic must use only identities already returned during the current live `usage` run. It must not introduce a persisted `accountKey`, `accountKeyLabel`, observed-identity cache, background polling, or changes to `airev status`.

## Current Problem

`usage` can show two different local profiles that actually resolve to the same provider account, for example when a profile was grabbed while the provider CLI was logged into a different account.

The local profile name is only an alias and may be arbitrary. It must never be used to decide whether a verified account is duplicated.

## Design

During one `usage` invocation:

1. Keep rendering each profile as today, including the verified account identity from the provider snapshot when available.
2. For every successful snapshot with `snapshot.email`, group rows by `provider + normalized snapshot.email`.
3. After all profiles are processed, print a compact diagnostics block for groups with more than one profile.

Example:

```text
diagnostics:
  duplicate observed account in codex:
    profiles: first@example.test, second@example.test
```

The verified account email is not repeated in the diagnostics block; profile aliases are enough to tell the user which entries need attention.

## Non-Goals

- Do not change `airev status`.
- Do not persist observed identity metadata.
- Do not add a separate `doctor` command.
- Do not add background polling or scheduled refresh.
- Do not infer duplicates from `profile.name`.

## Error Handling

Profiles without a verified email are ignored for duplicate detection. Failed probes and stale credentials keep their existing behavior.

If no duplicate group exists, no diagnostics block is printed.

## Tests

Add focused unit tests for the grouping/rendering helper:

- one provider, same verified email, two profile aliases => duplicate diagnostics;
- same email across different providers => no duplicate;
- profiles without verified email => ignored;
- no duplicates => no diagnostics output.
