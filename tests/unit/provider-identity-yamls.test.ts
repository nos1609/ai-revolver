import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { checkIdentity } from "../../src/core/identity.js";
import { loadProviderFromString } from "../../src/providers/loader.js";

// Resolve providers/ relative to repo root (two levels up from tests/unit/)
const PROVIDERS_DIR = path.resolve(import.meta.dirname, "../../providers");
const PROVIDERS = ["codex", "claude", "gemini", "grok", "qwen", "copilot", "qodercli"];

describe("shipped provider manifests declare identity", () => {
  for (const name of PROVIDERS) {
    it(`${name}.yaml has identity.fields with at least one stable field`, async () => {
      const yamlText = await fs.readFile(path.join(PROVIDERS_DIR, `${name}.yaml`), "utf-8");
      const prov = loadProviderFromString(yamlText);

      expect(prov.identity?.fields.length).toBeGreaterThan(0);
      expect(prov.identity?.display.length).toBeGreaterThan(0);
      for (const f of prov.identity!.fields) {
        expect(typeof f).toBe("string");
        expect(f.length).toBeGreaterThan(0);
      }
    });
  }

  it("qodercli identity mismatch does not expose opaque credentials", async () => {
    const yamlText = await fs.readFile(path.join(PROVIDERS_DIR, "qodercli.yaml"), "utf-8");
    const provider = loadProviderFromString(yamlText);
    const vaultBlob = "A".repeat(1048);
    const fsBlob = "B".repeat(1048);

    const result = checkIdentity(provider, { user_blob: vaultBlob }, { user_blob: fsBlob });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.vaultDisplay).toBe("qodercli opaque credential");
    expect(result.fsDisplay).toBe("qodercli opaque credential");
    expect(result.vaultDisplay).not.toContain(vaultBlob);
    expect(result.fsDisplay).not.toContain(fsBlob);
  });
});
