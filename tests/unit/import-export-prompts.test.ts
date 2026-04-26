import { afterEach, describe, expect, it, vi } from "vitest";

const promptMocks = vi.hoisted(() => ({
  transport: vi.fn(async () => "transport-pw"),
  transportConfirm: vi.fn(async () => "transport-pw"),
  legacyPassword: vi.fn(async () => "legacy-pw"),
}));

const vaultMocks = vi.hoisted(() => ({
  openVault: vi.fn(async () => ({ listIds: async () => [] })),
}));

const exportCoreMocks = vi.hoisted(() => ({
  buildExport: vi.fn(async () => ({
    version: 1,
    exported_at: "2026-01-01T00:00:00.000Z",
    profiles: [],
    active: {},
  })),
  serializeExport: vi.fn(() => "{\"airev_export\":1}\n"),
  isEncryptedExport: vi.fn(() => true),
  parseExport: vi.fn(() => ({
    version: 1,
    exported_at: "2026-01-01T00:00:00.000Z",
    profiles: [],
    active: {},
  })),
  applyImport: vi.fn(async () => ({
    added: [],
    skippedConflict: [],
    skippedIdCollision: [],
    replaced: [],
    activeApplied: {},
  })),
  ImportError: class ImportError extends Error {},
}));

vi.mock("../../src/vault/prompt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/vault/prompt.js")>();
  return {
    ...actual,
    promptPassword: promptMocks.legacyPassword,
    promptTransportPassword: promptMocks.transport,
    promptTransportPasswordConfirm: promptMocks.transportConfirm,
  };
});

vi.mock("../../src/vault/factory.js", () => ({
  openVault: vaultMocks.openVault,
}));

vi.mock("../../src/core/export.js", () => exportCoreMocks);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => "{\"airev_export\":1,\"encrypted\":true}\n"),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("import/export password prompts", () => {
  it("export asks for a transport password and confirmation", async () => {
    const { exportProfiles } = await import("../../src/commands/export.js");

    await exportProfiles({ outPath: "backup.json" });

    expect(promptMocks.transport).toHaveBeenCalledWith("export");
    expect(promptMocks.transportConfirm).toHaveBeenCalledTimes(1);
    expect(promptMocks.legacyPassword).not.toHaveBeenCalled();
    expect(exportCoreMocks.serializeExport).toHaveBeenCalledWith(expect.anything(), "transport-pw");
  });

  it("encrypted import asks for the import transport password", async () => {
    const { importProfiles } = await import("../../src/commands/import.js");

    await importProfiles("backup.json");

    expect(promptMocks.transport).toHaveBeenCalledWith("import");
    expect(promptMocks.legacyPassword).not.toHaveBeenCalled();
    expect(exportCoreMocks.parseExport).toHaveBeenCalledWith(expect.any(String), "transport-pw");
  });

  it("import opens the local vault with new encrypted-file password confirmation enabled", async () => {
    const { importProfiles } = await import("../../src/commands/import.js");

    await importProfiles("backup.json");

    expect(vaultMocks.openVault).toHaveBeenCalledWith({ confirmNewFilePassword: true });
  });
});
