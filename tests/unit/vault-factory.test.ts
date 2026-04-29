import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const promptState = vi.hoisted(() => ({
  existing: vi.fn<() => Promise<string>>(),
  nextNewPassword: "new-pw",
  nextNewConfirm: "new-pw",
  keyringAvailable: false,
  keyringIds: [] as string[],
  winVerifyAvailable: false,
  winVerifyIdentityResult: true,
}));

const configState = vi.hoisted(() => ({
  configDir: "",
}));

const platformState = vi.hoisted(() => ({
  platform: "linux" as "win32" | "darwin" | "linux",
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getConfigDir: () => configState.configDir,
    getPlatform: () => platformState.platform,
  };
});

vi.mock("../../src/vault/keyring-vault.js", () => ({
  KeyringVault: class {
    static isAvailable = vi.fn(async () => promptState.keyringAvailable);
    async listIds() {
      return promptState.keyringIds;
    }
  },
}));

vi.mock("../../src/vault/keyring-win.js", () => ({
  winVerifyAvailable: vi.fn(async () => promptState.winVerifyAvailable),
  winVerifyIdentity: vi.fn(async () => promptState.winVerifyIdentityResult),
}));

vi.mock("../../src/vault/prompt.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/vault/prompt.js")>();
  return {
    ...actual,
    promptPassword: vi.fn(async () => "legacy-pw"),
    promptExistingVaultPassword: promptState.existing,
    promptNewVaultPassword: vi.fn(async () => ({
      password: promptState.nextNewPassword,
      confirm: promptState.nextNewConfirm,
    })),
  };
});

let tempRoot: string;

async function importFactory() {
  vi.resetModules();
  return import("../../src/vault/factory.js");
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-vault-factory-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  promptState.existing.mockResolvedValue("existing-pw");
  promptState.nextNewPassword = "new-pw";
  promptState.nextNewConfirm = "new-pw";
  promptState.keyringAvailable = false;
  promptState.keyringIds = [];
  promptState.winVerifyAvailable = false;
  promptState.winVerifyIdentityResult = true;
  platformState.platform = "linux";
  delete process.env.AIREV_LANG;
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("openVault encrypted-file fallback", () => {
  it("asks for a new local vault password with confirmation when vault.enc does not exist", async () => {
    const prompt = await import("../../src/vault/prompt.js");
    const { openVault } = await importFactory();

    await openVault({ confirmNewFilePassword: true });

    expect(prompt.promptNewVaultPassword).toHaveBeenCalledTimes(1);
    expect(promptState.existing).not.toHaveBeenCalled();
  });

  it("asks for the existing local vault password without confirmation when vault.enc exists", async () => {
    await fs.mkdir(configState.configDir, { recursive: true });
    await fs.writeFile(path.join(configState.configDir, "vault.enc"), "{}", "utf-8");
    const prompt = await import("../../src/vault/prompt.js");
    const { openVault } = await importFactory();

    await openVault({ confirmNewFilePassword: true });

    expect(prompt.promptNewVaultPassword).not.toHaveBeenCalled();
    expect(promptState.existing).toHaveBeenCalledTimes(1);
  });

  it("rejects mismatched new local vault password confirmation before returning a vault", async () => {
    promptState.nextNewPassword = "one";
    promptState.nextNewConfirm = "two";
    const { openVault } = await importFactory();

    await expect(openVault({ confirmNewFilePassword: true })).rejects.toThrow(/match|совпад/i);
  });

  it("uses keyring when keyring is available and has entries", async () => {
    promptState.keyringAvailable = true;
    promptState.keyringIds = ["prof_keyring"];
    const { openVault } = await importFactory();

    const vault = await openVault({ skipVerify: true });

    expect(await vault.listIds()).toEqual(["prof_keyring"]);
    expect(promptState.existing).not.toHaveBeenCalled();
  });

  it("falls back to encrypted-file when keyring is available but empty and vault.enc exists", async () => {
    promptState.keyringAvailable = true;
    promptState.keyringIds = [];
    await fs.mkdir(configState.configDir, { recursive: true });
    await fs.writeFile(path.join(configState.configDir, "vault.enc"), "{}", "utf-8");
    const { openVault } = await importFactory();

    await openVault({ skipVerify: true });

    expect(promptState.existing).toHaveBeenCalledTimes(1);
  });

  it("keeps keyring when keyring is available and empty but vault.enc is absent", async () => {
    promptState.keyringAvailable = true;
    promptState.keyringIds = [];
    const { openVault } = await importFactory();

    const vault = await openVault({ skipVerify: true });

    expect(await vault.listIds()).toEqual([]);
    expect(promptState.existing).not.toHaveBeenCalled();
  });

  it("prints the Linux keyring label when keyring is used on Linux", async () => {
    promptState.keyringAvailable = true;
    promptState.keyringIds = ["prof_keyring"];
    platformState.platform = "linux";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    try {
      const { openVault } = await importFactory();

      await openVault({ skipVerify: true });

      expect(logs.join("\n")).toContain("Linux libsecret");
      expect(logs.join("\n")).not.toContain("DPAPI");
    } finally {
      console.log = originalLog;
    }
  });

  it("prints the macOS keyring label when keyring is used on macOS", async () => {
    promptState.keyringAvailable = true;
    promptState.keyringIds = ["prof_keyring"];
    platformState.platform = "darwin";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    try {
      const { openVault } = await importFactory();

      await openVault({ skipVerify: true });

      expect(logs.join("\n")).toContain("macOS Keychain");
      expect(logs.join("\n")).not.toContain("DPAPI");
    } finally {
      console.log = originalLog;
    }
  });

  it("passes localized Russian text into the Windows Hello prompt", async () => {
    process.env.AIREV_LANG = "ru";
    promptState.keyringAvailable = true;
    promptState.keyringIds = ["prof_keyring"];
    promptState.winVerifyAvailable = true;
    const { openVault } = await importFactory();
    const win = await import("../../src/vault/keyring-win.js");

    await openVault();

    expect(win.winVerifyIdentity).toHaveBeenCalledWith("Подтвердите доступ к хранилищу учётных данных");
    expect(win.winVerifyIdentity).not.toHaveBeenCalledWith("Confirm identity to access credentials");
  });

  it("throws a localized Russian error when Windows Hello verification is cancelled", async () => {
    process.env.AIREV_LANG = "ru";
    promptState.keyringAvailable = true;
    promptState.keyringIds = ["prof_keyring"];
    promptState.winVerifyAvailable = true;
    promptState.winVerifyIdentityResult = false;
    const { openVault } = await importFactory();

    await expect(openVault()).rejects.toThrow("Подтверждение Windows Hello отменено.");
  });
});

describe("openVaultBackend", () => {
  it("opens encrypted-file backend explicitly with new password confirmation", async () => {
    const prompt = await import("../../src/vault/prompt.js");
    const { openVaultBackend } = await importFactory();

    await openVaultBackend("encrypted-file", { confirmNewFilePassword: true });

    expect(prompt.promptNewVaultPassword).toHaveBeenCalledTimes(1);
    expect(promptState.existing).not.toHaveBeenCalled();
  });

  it("opens keyring backend explicitly when available", async () => {
    promptState.keyringAvailable = true;
    const { openVaultBackend } = await importFactory();

    const vault = await openVaultBackend("keyring", { skipVerify: true });

    expect(vault).toBeTruthy();
    expect(promptState.existing).not.toHaveBeenCalled();
  });

  it("rejects explicit keyring backend when unavailable", async () => {
    const { openVaultBackend } = await importFactory();

    await expect(openVaultBackend("keyring", { skipVerify: true })).rejects.toThrow(/unavailable|недоступ/i);
  });
});
