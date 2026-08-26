import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ── configDir isolation ───────────────────────────────────────────────────────
const configState = vi.hoisted(() => ({ configDir: "" }));
vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getConfigDir: () => configState.configDir,
    resolveTemplatePath: (p: string) => p,
  };
});

// ── registry mocks ────────────────────────────────────────────────────────────
const registryMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  isActiveMain: vi.fn(),
}));
vi.mock("../../src/core/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/registry.js")>();
  return { ...actual, ...registryMocks };
});

// ── vault mock ────────────────────────────────────────────────────────────────
const vaultMocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("../../src/vault/factory.js", () => ({
  openVault: vi.fn(async () => vaultMocks),
}));

// ── provider mock ─────────────────────────────────────────────────────────────
const fakeProvider = {
  name: "codex",
  auth_methods: {
    oauth: {
      credential_file: {
        path: "/fake/home/.codex/auth.json",
        format: "json" as const,
        mapping: { access_token: "tokens.access_token", account_id: "tokens.account_id" },
        grab_fields: ["last_refresh"],
        permissions: 0o600,
        atomic_write: true,
        preserve_unknown_fields: true,
      },
      credential_secrets: [],
    },
  },
  detection: { commands: ["codex"], paths: [] },
  identity: { fields: ["tokens.account_id"], display: ["${tokens.account_id}"] },
};
vi.mock("../../src/providers/loader.js", () => ({
  loadProvider: vi.fn(async () => fakeProvider),
}));

// ── reader mock ───────────────────────────────────────────────────────────────
const readerMocks = vi.hoisted(() => ({ readCredentials: vi.fn() }));
vi.mock("../../src/providers/reader.js", () => ({
  readCredentials: readerMocks.readCredentials,
}));

// ── json reader mock ──────────────────────────────────────────────────────────
const jsonMocks = vi.hoisted(() => ({ readProviderJsonFile: vi.fn() }));
vi.mock("../../src/providers/json.js", () => ({
  readProviderJsonFile: jsonMocks.readProviderJsonFile,
}));

// ── fileExists mock ───────────────────────────────────────────────────────────
const fsMocks = vi.hoisted(() => ({ fileExists: vi.fn() }));
vi.mock("../../src/platform/fs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/fs.js")>();
  return { ...actual, fileExists: fsMocks.fileExists };
});

vi.spyOn(console, "log").mockImplementation(() => {});

let tempRoot: string;

const fakeProfile = {
  id: "prof_side1",
  name: "side1",
  provider: "codex",
  auth_type: "oauth" as const,
  created_at: "2026-01-01T00:00:00.000Z",
};

const fakeVaultEntry = {
  profile_id: "prof_side1",
  credentials: { access_token: "tok_a", account_id: "acc_A" },
  grab_data: { last_refresh: 1_700_000_000_000 },
  identity: { "tokens.account_id": "acc_A" },
  last_refresh: 1_700_000_000_000,
};

const fakeFsRead = {
  credentials: { access_token: "tok_a", account_id: "acc_A" },
  grab_data: { last_refresh: 1_700_000_000_000 },
};

const fakeFsRawJson = {
  tokens: { access_token: "tok_a", account_id: "acc_A" },
  last_refresh: 1_700_000_000_000,
};

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-sync-identity-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  registryMocks.getProfile.mockResolvedValue(fakeProfile);
  registryMocks.isActiveMain.mockResolvedValue(true); // active main → native path
  vaultMocks.get.mockResolvedValue(fakeVaultEntry);
  vaultMocks.put.mockResolvedValue(undefined);
  readerMocks.readCredentials.mockResolvedValue(fakeFsRead);
  jsonMocks.readProviderJsonFile.mockResolvedValue(fakeFsRawJson);
  fsMocks.fileExists.mockResolvedValue(true); // FS file exists by default
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("sync identity guard", () => {
  it("no-op когда identity совпадает и last_refresh равны", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    const result = await sync("codex", "side1");
    expect(result.resolution).toBe("no-op");
  });

  it("ошибка когда vault entry не имеет identity (legacy entry)", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    // Vault entry без identity — legacy
    vaultMocks.get.mockResolvedValue({ ...fakeVaultEntry, identity: undefined });

    await expect(sync("codex", "side1")).rejects.toThrow(/identity.*not recorded|identity.*missing|identity.*не записана/i);
  });

  it("ошибка когда identity не совпадает между vault и FS", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    // FS имеет другой account_id
    jsonMocks.readProviderJsonFile.mockResolvedValue({
      tokens: { access_token: "tok_a", account_id: "acc_B" }, // другой account
      last_refresh: 1_700_000_000_000,
    });

    await expect(sync("codex", "side1")).rejects.toThrow(/identity mismatch|identity.*mismatch/i);
  });

  it("сообщение об ошибке содержит значения с обеих сторон", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    jsonMocks.readProviderJsonFile.mockResolvedValue({
      tokens: { access_token: "tok_a", account_id: "acc_B" },
      last_refresh: 1_700_000_000_000,
    });

    const error = await sync("codex", "side1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const msg = String(error);
    // Сообщение должно содержать значения vault (acc_A) и FS (acc_B)
    expect(msg).toMatch(/acc_A/);
    expect(msg).toMatch(/acc_B/);
  });

  it("--force --push пропускает identity guard и пишет FS → vault", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    // FS с другим account_id — без --force упал бы
    jsonMocks.readProviderJsonFile.mockResolvedValue({
      tokens: { access_token: "tok_a", account_id: "acc_B" },
      last_refresh: 1_700_000_000_000,
    });

    const result = await sync("codex", "side1", { force: true, direction: "push" });
    expect(result.resolution).toBe("push-fs-to-vault");
    expect(vaultMocks.put).toHaveBeenCalled();
  });

  it("--force без direction бросает ошибку", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    await expect(sync("codex", "side1", { force: true })).rejects.toThrow(/--push|--pull|direction/i);
  });

  it("ошибка когда профиль не найден", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    registryMocks.getProfile.mockResolvedValue(null);
    await expect(sync("codex", "ghost")).rejects.toThrow(/не найден|not found/i);
  });

  it("ошибка когда нет FS-локации", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    fsMocks.fileExists.mockResolvedValue(false);
    await expect(sync("codex", "side1")).rejects.toThrow(/FS|location|нет FS/i);
  });
});
