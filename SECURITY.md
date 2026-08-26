# Security Policy

## Supported versions

Until the first public release, security fixes target the current `main`
branch. After publication, the latest released minor line is supported; older
lines receive fixes only when explicitly stated in release notes.

## Report a vulnerability privately

Do not open a public issue when a report includes or could expose:

- a live credential, export, vault file, or provider identity;
- a way to bypass identity, freshness, merge, lock, or atomic-write guards;
- unsafe permission handling or plaintext output;
- a publish or CI path that leaks repository or registry secrets.

Use the private security-reporting channel configured on the canonical public
repository. If that channel is not available, contact the maintainer through a
private method listed on the repository owner's profile. A public release must
not proceed until one of these channels is configured.

Include:

- affected `ai-revolver` version or commit;
- operating system and Node.js major version;
- provider name and minimal reproduction;
- expected and actual behavior;
- sanitized error text;
- impact and any known workaround.

Do not send a real token as proof. Use synthetic values and state where the
secret appeared. If a live credential was exposed, revoke it before further
testing.

## Handling

The maintainer will validate scope, determine affected versions, prepare a
test, and coordinate disclosure. No fixed response time is promised before a
public maintenance process and contact channel are established.

Operational guidance and the local threat model are in
[`docs/security.md`](docs/security.md).
