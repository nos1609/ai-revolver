import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keyringState = vi.hoisted(() => ({
  available: true,
  ids: [] as string[],
  encryptedFileExists: false,
}));

const infoMocks = vi.hoisted(() => ({
  effectiveBackend: {
    backend: "encrypted-file" as "keyring" | "encrypted-file",
    keyringAvailable: true,
    keyringEntryCount: 0,
    encryptedFileExists: true,
    keyringLabel: "Linux libsecret",
  },
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

const promptMocks = vi.hoisted(() => ({
  existingPassword: "old-pw",
  newPassword: "new-pw",
  newConfirm: "new-pw",
  promptExistingVaultPassword: vi.fn(async () => promptMocks.existingPassword),
  promptNewVaultPassword: vi.fn(async () => ({
    password: promptMocks.newPassword,
    confirm: promptMocks.newConfirm,
  })),
}));

const encryptedFileMocks = vi.hoisted(() => ({
  rekeyEncryptedFileVault: vi.fn(async () => {}),
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

const originalAirevLang = process.env.AIREV_LANG;

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
  rekeyEncryptedFileVault: encryptedFileMocks.rekeyEncryptedFileVault,
}));

vi.mock("../../src/vault/prompt.js", () => ({
  promptExistingVaultPassword: promptMocks.promptExistingVaultPassword,
  promptNewVaultPassword: promptMocks.promptNewVaultPassword,
}));

vi.mock("../../src/vault/info.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/vault/info.js")>();
  return {
    ...actual,
    describeEffectiveVaultBackend: vi.fn(async () => infoMocks.effectiveBackend),
  };
});

vi.mock("../../src/vault/factory.js", () => ({
  openVaultBackend: backendMocks.openVaultBackend,
}));

vi.mock("../../src/vault/migrate.js", () => ({
  migrateVaultEntries: migrateMocks.migrateVaultEntries,
}));

afterEach(() => {
  if (originalAirevLang === undefined) delete process.env.AIREV_LANG;
  else process.env.AIREV_LANG = originalAirevLang;
  keyringState.available = true;
  keyringState.ids = [];
  keyringState.encryptedFileExists = false;
  infoMocks.effectiveBackend = {
    backend: "encrypted-file",
    keyringAvailable: true,
    keyringEntryCount: 0,
    encryptedFileExists: true,
    keyringLabel: "Linux libsecret",
  };
  backendMocks.sourceIds = [];
  backendMocks.removedIds = [];
  promptMocks.existingPassword = "old-pw";
  promptMocks.newPassword = "new-pw";
  promptMocks.newConfirm = "new-pw";
  vi.clearAllMocks();
});

beforeEach(() => {
  process.env.AIREV_LANG = "en";
});

describe("vaultCommand migrate", () => {
  it("migrates keyring to encrypted-file and keeps source with --keep-source", async () => {
    infoMocks.effectiveBackend = {
      backend: "keyring",
      keyringAvailable: true,
      keyringEntryCount: 2,
      encryptedFileExists: false,
      keyringLabel: "Linux libsecret",
    };
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
    infoMocks.effectiveBackend = {
      backend: "keyring",
      keyringAvailable: true,
      keyringEntryCount: 2,
      encryptedFileExists: false,
      keyringLabel: "Linux libsecret",
    };
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
    infoMocks.effectiveBackend = {
      backend: "keyring",
      keyringAvailable: true,
      keyringEntryCount: 2,
      encryptedFileExists: false,
      keyringLabel: "Linux libsecret",
    };
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
    infoMocks.effectiveBackend = {
      backend: "keyring",
      keyringAvailable: true,
      keyringEntryCount: 2,
      encryptedFileExists: false,
      keyringLabel: "Linux libsecret",
    };
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

describe("vaultCommand status/passwd effective backend", () => {
  it("status reports encrypted-file when keyring is available but empty and vault.enc exists", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    try {
      const { vaultCommand } = await import("../../src/commands/vault.js");

      await vaultCommand("status", undefined);

      expect(logs.join("\n")).toContain("encrypted-file");
      expect(logs.join("\n")).toContain("keyring is available but empty");
    } finally {
      console.log = originalLog;
    }
  });

  it("passwd changes the encrypted-file password through the rekey helper", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    try {
      const { vaultCommand } = await import("../../src/commands/vault.js");

      await vaultCommand("passwd", undefined);

      expect(promptMocks.promptExistingVaultPassword).toHaveBeenCalledTimes(1);
      expect(promptMocks.promptNewVaultPassword).toHaveBeenCalledTimes(1);
      expect(encryptedFileMocks.rekeyEncryptedFileVault).toHaveBeenCalledWith("old-pw", "new-pw");
      expect(logs.join("\n")).toContain("Local vault password changed");
      expect(logs.join("\n")).not.toContain("OS keyring backend is active");
    } finally {
      console.log = originalLog;
    }
  });

  it("passwd rejects mismatched new local vault password confirmation before rekey", async () => {
    promptMocks.newPassword = "new-pw";
    promptMocks.newConfirm = "other-pw";
    const { vaultCommand } = await import("../../src/commands/vault.js");

    await expect(vaultCommand("passwd", undefined)).rejects.toThrow(/match|совпад/i);

    expect(encryptedFileMocks.rekeyEncryptedFileVault).not.toHaveBeenCalled();
  });

  it("passwd keeps keyring backend as a no-op without prompting", async () => {
    infoMocks.effectiveBackend = {
      backend: "keyring",
      keyringAvailable: true,
      keyringEntryCount: 1,
      encryptedFileExists: false,
      keyringLabel: "Windows DPAPI",
    };
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    try {
      const { vaultCommand } = await import("../../src/commands/vault.js");

      await vaultCommand("passwd", undefined);

      expect(logs.join("\n")).toContain("OS keyring backend is active");
      expect(promptMocks.promptExistingVaultPassword).not.toHaveBeenCalled();
      expect(promptMocks.promptNewVaultPassword).not.toHaveBeenCalled();
      expect(encryptedFileMocks.rekeyEncryptedFileVault).not.toHaveBeenCalled();
    } finally {
      console.log = originalLog;
    }
  });
});
