import { afterEach, describe, expect, it, vi } from "vitest";

const keyringState = vi.hoisted(() => ({
  available: true,
}));

const backendMocks = vi.hoisted(() => ({
  sourceVault: { listIds: async () => [] },
  targetVault: { listIds: async () => [] },
  openVaultBackend: vi.fn(async (backend: string) => (
    backend === "keyring" ? backendMocks.sourceVault : backendMocks.targetVault
  )),
}));

const migrateMocks = vi.hoisted(() => ({
  migrateVaultEntries: vi.fn(async () => ({
    source: "keyring",
    target: "encrypted-file",
    copied: 2,
    verified: 2,
    deleted: 0,
    keptSource: true,
  })),
}));

vi.mock("../../src/vault/keyring-vault.js", () => ({
  KeyringVault: class {
    static isAvailable = vi.fn(async () => keyringState.available);
  },
}));

vi.mock("../../src/vault/factory.js", () => ({
  openVaultBackend: backendMocks.openVaultBackend,
}));

vi.mock("../../src/vault/migrate.js", () => ({
  migrateVaultEntries: migrateMocks.migrateVaultEntries,
}));

afterEach(() => {
  keyringState.available = true;
  vi.clearAllMocks();
});

describe("vaultCommand migrate", () => {
  it("migrates keyring to encrypted-file and keeps source with --keep-source", async () => {
    const { vaultCommand } = await import("../../src/commands/vault.js");

    await vaultCommand("migrate", "file", { keepSource: true, isTty: true });

    expect(backendMocks.openVaultBackend).toHaveBeenCalledWith("keyring", expect.anything());
    expect(backendMocks.openVaultBackend).toHaveBeenCalledWith("encrypted-file", expect.objectContaining({
      confirmNewFilePassword: true,
    }));
    expect(migrateMocks.migrateVaultEntries).toHaveBeenCalledWith(expect.objectContaining({
      sourceName: "keyring",
      targetName: "encrypted-file",
      cleanup: "keep-source",
    }));
  });

  it("uses delete-source cleanup with --yes", async () => {
    const { vaultCommand } = await import("../../src/commands/vault.js");

    await vaultCommand("migrate", "file", { yes: true, isTty: false });

    expect(migrateMocks.migrateVaultEntries).toHaveBeenCalledWith(expect.objectContaining({
      cleanup: "delete-source",
    }));
  });

  it("fails before opening vaults in non-TTY mode without --yes or --keep-source", async () => {
    const { vaultCommand } = await import("../../src/commands/vault.js");

    await expect(vaultCommand("migrate", "file", { isTty: false })).rejects.toThrow(/--yes|--keep-source/);

    expect(backendMocks.openVaultBackend).not.toHaveBeenCalled();
    expect(migrateMocks.migrateVaultEntries).not.toHaveBeenCalled();
  });

  it("rejects migration when source and target are the same backend", async () => {
    keyringState.available = false;
    const { vaultCommand } = await import("../../src/commands/vault.js");

    await expect(vaultCommand("migrate", "file", { keepSource: true, isTty: true })).rejects.toThrow(/already|уже|same/i);

    expect(backendMocks.openVaultBackend).not.toHaveBeenCalled();
  });
});
