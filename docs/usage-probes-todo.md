# Usage Probes TODO

## Codex extras

- Add `code_review_rate_limit.primary_window` from `/backend-api/wham/usage`.
- Decide how to render a third quota window without overloading the current two-window `UsageSnapshot`.
- Add `credits` display only after deciding whether it belongs in `usage` output or a separate detail view.

## Gemini remote quota

- Add a non-declarative Gemini flow based on `cloudcode-pa.googleapis.com/v1internal`.
- Prefer `retrieveUserQuota` when a quota project id is already known.
- Use `loadCodeAssist` only to resolve the managed project id when needed.
- Parse `buckets[]` by model and prefer `tokenType: REQUESTS` when duplicate buckets exist.

## Qwen

- Do not add a fake remote usage probe until a real Qwen quota API is found.
- Local estimation can be considered separately, but it should be labelled as local estimation, not account quota.

## Linux vault/keyring

- On the second Linux host, check why OS keyring is unavailable and `airev` falls back to the local encrypted-file vault password.
- Inspect the local Secret Service/libsecret setup: DBus session, `gnome-keyring` or compatible service, and whether the Node keytar binding can load.
- Decide whether password fallback is the supported mode for that host, or whether the Linux keyring path should be fixed and covered by a smoke check.
