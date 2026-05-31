import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { VaultEntry } from "../../src/types/index.js";

// ── configDir redirect (same pattern as encrypted-file.test.ts) ──────────────
const configState = vi.hoisted(() => ({ configDir: "" }));
vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return { ...actual, getConfigDir: () => configState.configDir };
});

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-vault-id-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("vault entry identity backward-compat", () => {
  it("loads legacy entry without identity/last_refresh", async () => {
    const { EncryptedFileVault } = await import("../../src/vault/encrypted-file.js");
    const vault = new EncryptedFileVault("test-pw");

    const legacy: VaultEntry = {
      profile_id: "prof_legacy",
      credentials: { access_token: "tok_a" },
      grab_data: {},
    };
    await vault.put(legacy);

    const got = await vault.get("prof_legacy");
    expect(got?.profile_id).toBe("prof_legacy");
    expect(got?.identity).toBeUndefined();
    expect(got?.last_refresh).toBeUndefined();
  });

  it("round-trips identity and last_refresh", async () => {
    const { EncryptedFileVault } = await import("../../src/vault/encrypted-file.js");
    const vault = new EncryptedFileVault("test-pw");

    const entry: VaultEntry = {
      profile_id: "prof_x",
      credentials: { access_token: "tok_b" },
      grab_data: { email: "a@b.c" },
      identity: { "tokens.account_id": "acc_123" },
      last_refresh: 1_700_000_000_000,
    };
    await vault.put(entry);

    const got = await vault.get("prof_x");
    expect(got?.identity?.["tokens.account_id"]).toBe("acc_123");
    expect(got?.last_refresh).toBe(1_700_000_000_000);
  });
});
