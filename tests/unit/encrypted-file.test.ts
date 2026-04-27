import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VaultEntry } from "../../src/types/index.js";

const configState = vi.hoisted(() => ({
  configDir: "",
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getConfigDir: () => configState.configDir,
  };
});

let tempRoot: string;

const entry: VaultEntry = {
  profile_id: "prof_a",
  credentials: { access_token: "tok_a", refresh_token: "ref_a" },
  grab_data: { email: "a@example.test" },
};

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-encrypted-file-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("rekeyEncryptedFileVault", () => {
  it("rewrites vault.enc so entries open with the new password and not the old one", async () => {
    const { EncryptedFileVault, rekeyEncryptedFileVault } = await import("../../src/vault/encrypted-file.js");
    const oldVault = new EncryptedFileVault("old-pw");
    await oldVault.put(entry);

    await rekeyEncryptedFileVault("old-pw", "new-pw");

    const newVault = new EncryptedFileVault("new-pw");
    await expect(newVault.get("prof_a")).resolves.toEqual(entry);
    const staleVault = new EncryptedFileVault("old-pw");
    await expect(staleVault.listIds()).rejects.toThrow(/wrong vault password/i);
  });

  it("leaves vault.enc readable with the old password when the old password is wrong", async () => {
    const { EncryptedFileVault, rekeyEncryptedFileVault } = await import("../../src/vault/encrypted-file.js");
    const oldVault = new EncryptedFileVault("old-pw");
    await oldVault.put(entry);

    await expect(rekeyEncryptedFileVault("bad-pw", "new-pw")).rejects.toThrow(/wrong vault password/i);

    const stillOldVault = new EncryptedFileVault("old-pw");
    await expect(stillOldVault.get("prof_a")).resolves.toEqual(entry);
  });

  it("rejects an empty new password before changing vault.enc", async () => {
    const { EncryptedFileVault, rekeyEncryptedFileVault } = await import("../../src/vault/encrypted-file.js");
    const oldVault = new EncryptedFileVault("old-pw");
    await oldVault.put(entry);

    await expect(rekeyEncryptedFileVault("old-pw", "")).rejects.toThrow(/password required/i);

    const stillOldVault = new EncryptedFileVault("old-pw");
    await expect(stillOldVault.get("prof_a")).resolves.toEqual(entry);
  });
});
