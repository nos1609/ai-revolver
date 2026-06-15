import os from "node:os";
import { describe, it, expect } from "vitest";
import { loadProviderFromString } from "../../src/providers/loader.js";

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
});
