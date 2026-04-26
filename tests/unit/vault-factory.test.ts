import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const promptState = vi.hoisted(() => ({
  existing: vi.fn<() => Promise<string>>(),
  nextNewPassword: "new-pw",
  nextNewConfirm: "new-pw",
}));

vi.mock("../../src/vault/keyring-vault.js", () => ({
  KeyringVault: class {
    static isAvailable = vi.fn(async () => false);
  },
}));

vi.mock("../../src/vault/keyring-win.js", () => ({
  winVerifyAvailable: vi.fn(async () => false),
  winVerifyIdentity: vi.fn(async () => true),
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

const originalAppData = process.env.APPDATA;
let tempRoot: string;

async function importFactory() {
  vi.resetModules();
  return import("../../src/vault/factory.js");
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-vault-factory-"));
  process.env.APPDATA = tempRoot;
  promptState.existing.mockResolvedValue("existing-pw");
  promptState.nextNewPassword = "new-pw";
  promptState.nextNewConfirm = "new-pw";
});

afterEach(async () => {
  if (originalAppData === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
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
    const configDir = path.join(tempRoot, "ai-revolver");
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(path.join(configDir, "vault.enc"), "{}", "utf-8");
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
});
