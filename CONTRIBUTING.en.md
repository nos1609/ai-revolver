# Contributing to ai-revolver

[Русская версия](CONTRIBUTING.md)

## Before starting

- Use Node.js `>=18` and npm.
- Read [`docs/README.md`](docs/README.md),
  [`docs/security.md`](docs/security.md), and the provider manifest or
  architecture document relevant to the change.
- Check `git status --short --branch` and preserve changes you do not own.
- Never use real credentials, account ids, emails, or home paths in fixtures or
  documentation.

## Change scope

Keep the diff minimal and complete. Define provider-specific paths, mapping,
identity, refresh, and usage behavior in `providers/*.yaml` first. Add a code
adapter only when a manifest cannot express the format safely.

Do not add these items to Git:

- `vault.enc`, registry/active/stale state, or satellite files;
- encrypted or plaintext exports;
- `*.tgz`, coverage, reports, or `tmp/`;
- one-off recovery scripts that write to a real home directory;
- raw provider responses or binary credential blobs.

## Provider contract changes

1. Record the provider CLI version and behavior source.
2. Check official documentation or source when available.
3. Use a read-only probe without TLS interception.
4. Sanitize evidence and create a synthetic fixture.
5. Update the manifest and a focused regression test.
6. Update the README table and
   [`docs/source-attribution.md`](docs/source-attribution.md).
7. Verify that diagnostics never print a sensitive field.

## Code and tests

Keep the existing TypeScript and ESM style. Do not add a dependency without a
specific need. Add a regression test before changing behavior.

From the repository root:

```bash
npm ci
npm install-scripts ls
npm run check
npm run build
npm pack --dry-run
git diff --check
```

Add a unit contract test for a platform-specific change. Before claiming live
support, verify the real executable and backend on that operating system.

Do not use wildcards in `allowScripts`. Pin the exact package version and review
the install script before changing the allowlist.

## Documentation

Follow [`docs/DOCUMENTATION_STANDARD.md`](docs/DOCUMENTATION_STANDARD.md).
Update the Russian and English READMEs together. Commands must work from the
stated directory and must not depend on a local username.

Store Mermaid source in Markdown and render the diagram before committing it.

## Commits and pull requests

- Do not mix a fix with an unrelated refactor.
- State the problem, solution, checks, limitations, and rollback.
- Do not bypass lint, tests, documentation, or security gates.
- Do not run untrusted pull-request code on a permanent self-hosted runner.
- Commit, push, tag, and publish only within the approved scope.

## Vulnerabilities

Do not open a public issue for a credential leak or an identity-guard bypass.
Follow [`SECURITY.md`](SECURITY.md).
