import os from "node:os";
import { describe, it, expect } from "vitest";
import { loadProviderFromString } from "../../src/providers/loader.js";

describe("provider identity schema", () => {
  it("parses identity block when present", async () => {
    const yaml = `
name: codex
version: 1
auth_methods:
  oauth:
    credential_file:
      path: "${os.homedir()}/.codex/auth.json"
      format: json
      mapping: {}
      grab_fields: []
      permissions: 384
      atomic_write: true
      preserve_unknown_fields: true
detection:
  commands: [codex]
  paths: []
identity:
  fields:
    - "tokens.account_id"
  display:
    - "\${grab_fields.email}"
    - "\${tokens.account_id}"
`;
    const prov = await loadProviderFromString(yaml);
    expect(prov.identity?.fields).toEqual(["tokens.account_id"]);
    expect(prov.identity?.display).toHaveLength(2);
  });

  it("leaves identity undefined when absent", async () => {
    const yaml = `
name: legacy
version: 1
auth_methods:
  oauth:
    credential_file:
      path: "${os.homedir()}/.legacy/auth"
      format: json
      mapping: {}
      grab_fields: []
      permissions: 384
      atomic_write: true
      preserve_unknown_fields: true
detection:
  commands: [legacy]
  paths: []
`;
    const prov = await loadProviderFromString(yaml);
    expect(prov.identity).toBeUndefined();
  });
});
