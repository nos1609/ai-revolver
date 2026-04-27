import { afterEach, describe, expect, it, vi } from "vitest";

const keyringState = vi.hoisted(() => ({
  available: true,
  ids: [] as string[],
  encryptedFileExists: false,
}));

const backendMocks = vi.hoisted(() => ({
  sourceIds: [] as string[],
  removedIds: [] as string[],
  sourceVault: {
    listIds: async () => backendMocks.sourceIds,
    get: async (id: string) => backendMocks.removedIds.includes(id) ? null : { profile_id: id, credentials: {}, grab_data: {} },
    remove: async (id: string) => {
      backendMocks.removedIds.push(id);
    },
  },
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
    verifiedIds: ["prof_a", "prof_b"],
  })),
}));

vi.mock("../../src/vault/keyring-vault.js", () => ({
  KeyringVault: class {
    static isAvailable = vi.fn(async () => keyringState.available);
    async listIds() {
      return keyringState.ids;
    }
  },
}));

vi.mock("../../src/vault/encrypted-file.js", () => ({
  EncryptedFileVault: class {
    static exists = vi.fn(async () => keyringState.encryptedFileExists);
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
  keyringState.ids = [];
  keyringState.encryptedFileExists = false;
  backendMocks.sourceIds = [];
  backendMocks.removedIds = [];
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

  it("treats encrypted-file as source when keyring is available but empty and vault.enc exists", async () => {
    keyringState.available = true;
    keyringState.ids = [];
    keyringState.encryptedFileExists = true;
    const { vaultCommand } = await import("../../src/commands/vault.js");

    await vaultCommand("migrate", "keyring", { yes: true, isTty: false });

    expect(backendMocks.openVaultBackend).toHaveBeenCalledWith("encrypted-file", expect.anything());
    expect(backendMocks.openVaultBackend).toHaveBeenCalledWith("keyring", expect.anything());
    expect(migrateMocks.migrateVaultEntries).toHaveBeenCalledWith(expect.objectContaining({
      sourceName: "encrypted-file",
      targetName: "keyring",
      cleanup: "delete-source",
    }));
  });

  it("rejects --yes and --keep-source together before opening vaults", async () => {
    const { vaultCommand } = await import("../../src/commands/vault.js");

    await expect(vaultCommand("migrate", "file", { yes: true, keepSource: true, isTty: false }))
      .rejects.toThrow(/--yes|--keep-source/);

    expect(backendMocks.openVaultBackend).not.toHaveBeenCalled();
    expect(migrateMocks.migrateVaultEntries).not.toHaveBeenCalled();
  });

  it("interactive delete removes only verified snapshot ids from the migration report", async () => {
    backendMocks.sourceIds = ["prof_a", "prof_b", "prof_late"];
    const originalStdin = process.stdin;
    const originalStdoutWrite = process.stdout.write;
    Object.defineProperty(process, "stdin", {
      configurable: true,
      value: {
        isTTY: true,
        resume: vi.fn(),
        pause: vi.fn(),
        setEncoding: vi.fn(),
        once: vi.fn((_event: string, cb: (data: string) => void) => cb("y\n")),
      },
    });
    process.stdout.write = vi.fn() as typeof process.stdout.write;
    try {
      const { vaultCommand } = await import("../../src/commands/vault.js");

      await vaultCommand("migrate", "file", { isTty: true });

      expect(backendMocks.removedIds).toEqual(["prof_a", "prof_b"]);
    } finally {
      Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
      process.stdout.write = originalStdoutWrite;
    }
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
