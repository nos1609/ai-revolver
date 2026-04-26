import { describe, expect, it } from "vitest";
import {
  existingVaultPasswordPromptLabel,
  newVaultPasswordPromptLabels,
  transportPasswordPromptLabel,
} from "../../src/vault/prompt.js";

describe("vault password prompt labels", () => {
  it("labels export password as transport password", () => {
    expect(transportPasswordPromptLabel("export", "ru")).toContain("Транспортный пароль export-файла");
    expect(transportPasswordPromptLabel("export", "en")).toContain("Export transport password");
  });

  it("labels import password as transport password", () => {
    expect(transportPasswordPromptLabel("import", "ru")).toContain("Транспортный пароль import-файла");
    expect(transportPasswordPromptLabel("import", "en")).toContain("Import transport password");
  });

  it("labels new local vault password separately from transport password", () => {
    expect(newVaultPasswordPromptLabels("ru")).toEqual({
      password: "  🔐 Новый пароль локального vault-а: ",
      confirm: "  🔐 Повтори пароль локального vault-а: ",
    });
    expect(newVaultPasswordPromptLabels("en")).toEqual({
      password: "  🔐 New local vault password: ",
      confirm: "  🔐 Confirm local vault password: ",
    });
  });

  it("labels existing local vault password without confirmation wording", () => {
    expect(existingVaultPasswordPromptLabel("ru")).toBe("  🔐 Пароль локального vault-а: ");
    expect(existingVaultPasswordPromptLabel("en")).toBe("  🔐 Local vault password: ");
  });
});
