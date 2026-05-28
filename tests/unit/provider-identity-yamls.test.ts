import fs from "node:fs/promises";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { loadProviderFromString } from "../../src/providers/loader.js";

// Resolve providers/ relative to repo root (two levels up from tests/unit/)
const PROVIDERS_DIR = path.resolve(import.meta.dirname, "../../providers");
const PROVIDERS = ["codex", "claude", "gemini", "qwen", "copilot"];

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
});
