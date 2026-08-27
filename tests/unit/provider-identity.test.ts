import os from "node:os";
import { describe, it, expect } from "vitest";
import { loadProviderFromString } from "../../src/providers/loader.js";
import {
  checkIdentity,
  extractIdentityFromRaw,
} from "../../src/core/identity.js";

// Use forward slashes and single quotes in the YAML value so that the generated
// provider manifest is valid YAML on both Windows and Unix.
// (double-quoted YAML interprets \U etc. as escapes; this test only cares about
// schema parsing of the identity block, not real FS access.)
const portableHome = os.homedir().replace(/\\/g, "/");
const baseYaml = (extra = "") => `
name: test-provider
version: 1
auth_methods:
  oauth:
    credential_file:
      path: '${portableHome}/.test/auth.json'
      format: json
      mapping: {}
      grab_fields: []
      permissions: 384
      atomic_write: true
      preserve_unknown_fields: true
detection:
  commands: [test]
  paths: []
${extra}
`;

describe("provider identity schema — happy path", () => {
  it("parses identity block when present", () => {
    const prov = loadProviderFromString(baseYaml(`
identity:
  fields:
    - "tokens.account_id"
  display:
    - "\${grab_fields.email}"
    - "\${tokens.account_id}"
`));
    expect(prov.identity?.fields).toEqual(["tokens.account_id"]);
    expect(prov.identity?.display).toHaveLength(2);
  });

  it("leaves identity undefined when absent", () => {
    const prov = loadProviderFromString(baseYaml());
    expect(prov.identity).toBeUndefined();
  });

  it("accepts multiple fields and display entries", () => {
    const prov = loadProviderFromString(baseYaml(`
identity:
  fields: ["a.b", "c.d"]
  display: ["one", "two", "three"]
`));
    expect(prov.identity?.fields).toHaveLength(2);
    expect(prov.identity?.display).toHaveLength(3);
  });

  it("reads identity from companion grab_data", () => {
    const provider = loadProviderFromString(baseYaml(`
identity:
  fields: ["oauthAccount.organizationUuid"]
  display: ["\${oauthAccount.organizationUuid}"]
`));

    expect(extractIdentityFromRaw(provider, {}, {
      oauthAccount: { organizationUuid: "org-current" },
    })).toEqual({ "oauthAccount.organizationUuid": "org-current" });
  });

  it("hashes opaque identity and accepts a legacy raw vault snapshot", () => {
    const provider = loadProviderFromString(baseYaml(`
identity:
  fields: ["refresh_token"]
  transforms:
    refresh_token: sha256
  display: ["opaque credential"]
`));
    const token = "refresh-token-secret";
    const extracted = extractIdentityFromRaw(provider, { refresh_token: token });

    expect(extracted?.refresh_token).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(String(extracted?.refresh_token)).not.toContain(token);
    expect(checkIdentity(provider, { refresh_token: token }, { refresh_token: token })).toEqual({ ok: true });
  });

  it("extracts a stable JWT claim instead of storing the full ID token", () => {
    const provider = loadProviderFromString(baseYaml(`
identity:
  fields: ["id_token"]
  transforms:
    id_token: jwt_claim:sub
  display: ["JWT account"]
`));
    const jwt = (sub: string, nonce: string) => [
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
      Buffer.from(JSON.stringify({ sub, nonce })).toString("base64url"),
      "signature",
    ].join(".");

    const first = extractIdentityFromRaw(provider, { id_token: jwt("account-1", "a") });
    expect(first).toEqual({ id_token: "account-1" });
    expect(checkIdentity(provider, first, { id_token: jwt("account-1", "b") })).toEqual({ ok: true });
    expect(checkIdentity(provider, first, { id_token: jwt("account-2", "c") }).ok).toBe(false);
  });

  it("uses overlapping identity fields when companion metadata is unavailable", () => {
    const provider = loadProviderFromString(baseYaml(`
identity:
  fields: ["oauthAccount.organizationUuid", "refresh_token"]
  transforms:
    refresh_token: sha256
  match: overlap
  display: ["\${oauthAccount.organizationUuid}"]
`));
    const vaultIdentity = extractIdentityFromRaw(
      provider,
      { refresh_token: "same-token" },
      { oauthAccount: { organizationUuid: "org-1" } },
    );

    expect(vaultIdentity).toBeDefined();
    expect(checkIdentity(provider, vaultIdentity, { refresh_token: "same-token" })).toEqual({ ok: true });
    expect(checkIdentity(provider, vaultIdentity, { refresh_token: "other-token" }).ok).toBe(false);
  });
});

describe("provider identity schema — validation rejects malformed identity", () => {
  it("throws when identity.fields is missing", () => {
    expect(() =>
      loadProviderFromString(baseYaml(`
identity:
  display: ["something"]
`)),
    ).toThrow(/identity\.fields.*non-empty/i);
  });

  it("throws when identity.fields is an empty array", () => {
    expect(() =>
      loadProviderFromString(baseYaml(`
identity:
  fields: []
  display: ["something"]
`)),
    ).toThrow(/identity\.fields.*non-empty/i);
  });

  it("throws when identity.fields contains a non-string entry", () => {
    expect(() =>
      loadProviderFromString(baseYaml(`
identity:
  fields: [123]
  display: ["something"]
`)),
    ).toThrow(/identity\.fields.*strings/i);
  });

  it("throws when identity.display is missing", () => {
    expect(() =>
      loadProviderFromString(baseYaml(`
identity:
  fields: ["tokens.account_id"]
`)),
    ).toThrow(/identity\.display.*non-empty/i);
  });

  it("throws when identity.display is an empty array", () => {
    expect(() =>
      loadProviderFromString(baseYaml(`
identity:
  fields: ["tokens.account_id"]
  display: []
`)),
    ).toThrow(/identity\.display.*non-empty/i);
  });

  it("throws when identity.display contains a non-string entry", () => {
    expect(() =>
      loadProviderFromString(baseYaml(`
identity:
  fields: ["tokens.account_id"]
  display: [42]
`)),
    ).toThrow(/identity\.display.*strings/i);
  });

  it("throws when identity is not an object", () => {
    expect(() =>
      loadProviderFromString(baseYaml("identity: not-an-object")),
    ).toThrow(/identity must be an object/i);
  });

  it("throws when a transform targets an undeclared field", () => {
    expect(() =>
      loadProviderFromString(baseYaml(`
identity:
  fields: ["tokens.account_id"]
  transforms:
    id_token: jwt_claim:sub
  display: ["account"]
`)),
    ).toThrow(/undeclared field/i);
  });

  it("throws when identity.match is unsupported", () => {
    expect(() =>
      loadProviderFromString(baseYaml(`
identity:
  fields: ["tokens.account_id"]
  match: some
  display: ["account"]
`)),
    ).toThrow(/identity\.match/i);
  });

  it("throws when a required credential is absent from mapping", () => {
    expect(() => loadProviderFromString(baseYaml().replace(
      "      mapping: {}",
      "      mapping: {}\n      required_credentials: [id_token]",
    ))).toThrow(/required credential.*id_token.*mapping/i);
  });
});
