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
  listProfiles: vi.fn(),
  getAllActive: vi.fn(),
  getProfileById: vi.fn(),
  isActiveMain: vi.fn(),
}));
vi.mock("../../src/core/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/registry.js")>();
  return { ...actual, ...registryMocks };
});

// ── vault mock ────────────────────────────────────────────────────────────────
const vaultMocks = vi.hoisted(() => ({ get: vi.fn() }));
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
        mapping: { account_id: "tokens.account_id" },
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
  listProviders: vi.fn(async () => ["codex"]),
  loadProvider: vi.fn(async () => fakeProvider),
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

const sideProfile = {
  id: "prof_side1",
  name: "side1",
  provider: "codex",
  auth_type: "oauth" as const,
  created_at: "2026-01-01T00:00:00.000Z",
};

const vaultEntry = {
  profile_id: "prof_side1",
  credentials: { access_token: "tok_a", account_id: "acc_A" },
  grab_data: { last_refresh: 1_700_000_000_000 },
  identity: { "tokens.account_id": "acc_A" },
  last_refresh: 1_700_000_000_000,
};

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-status-sat-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  registryMocks.listProfiles.mockResolvedValue([sideProfile]);
  registryMocks.getAllActive.mockResolvedValue({ codex: "prof_main" });
  registryMocks.getProfileById.mockResolvedValue(sideProfile);
  registryMocks.isActiveMain.mockResolvedValue(false);
  vaultMocks.get.mockResolvedValue(vaultEntry);
  fsMocks.fileExists.mockResolvedValue(true);
  jsonMocks.readProviderJsonFile.mockResolvedValue({
    tokens: { account_id: "acc_A" },
    last_refresh: 1_700_000_000_000,
  });
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("statusJson", () => {
  it("возвращает массив объектов с полями профилей", async () => {
    const { statusJson } = await import("../../src/commands/status.js");
    const result = await statusJson();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("provider");
    expect(result[0]).toHaveProperty("name");
    expect(result[0]).toHaveProperty("in_vault");
    expect(result[0]).toHaveProperty("render");
    expect(result[0]).toHaveProperty("sync_hint");
  });

  it("render=satellite когда satellite file существует и не active_main", async () => {
    const { statusJson } = await import("../../src/commands/status.js");
    const result = await statusJson();
    const entry = result.find((r) => r.name === "side1");
    expect(entry?.render).toBe("satellite");
  });

  it("sync_hint=in-sync когда timestamps равны", async () => {
    const { statusJson } = await import("../../src/commands/status.js");
    const result = await statusJson();
    const entry = result.find((r) => r.name === "side1");
    expect(entry?.sync_hint).toBe("in-sync");
  });

  it("sync_hint=vault-newer когда vault.last_refresh > FS", async () => {
    const { statusJson } = await import("../../src/commands/status.js");
    jsonMocks.readProviderJsonFile.mockResolvedValue({
      tokens: { account_id: "acc_A" },
      last_refresh: 1_699_000_000_000, // FS older
    });

    const result = await statusJson();
    const entry = result.find((r) => r.name === "side1");
    expect(entry?.sync_hint).toBe("vault-newer");
  });

  it("sync_hint=fs-newer когда FS > vault.last_refresh", async () => {
    const { statusJson } = await import("../../src/commands/status.js");
    jsonMocks.readProviderJsonFile.mockResolvedValue({
      tokens: { account_id: "acc_A" },
      last_refresh: 1_701_000_000_000, // FS newer
    });
    vaultMocks.get.mockResolvedValue({ ...vaultEntry, last_refresh: 1_700_000_000_000 });

    const result = await statusJson();
    const entry = result.find((r) => r.name === "side1");
    expect(entry?.sync_hint).toBe("fs-newer");
  });

  it("sync_hint=identity-mismatch когда account_id отличается", async () => {
    const { statusJson } = await import("../../src/commands/status.js");
    jsonMocks.readProviderJsonFile.mockResolvedValue({
      tokens: { account_id: "acc_B" }, // разный account
      last_refresh: 1_700_000_000_000,
    });

    const result = await statusJson();
    const entry = result.find((r) => r.name === "side1");
    expect(entry?.sync_hint).toBe("identity-mismatch");
  });

  it("sync_hint=no-fs когда нет FS-локации", async () => {
    const { statusJson } = await import("../../src/commands/status.js");
    fsMocks.fileExists.mockResolvedValue(false);

    const result = await statusJson();
    const entry = result.find((r) => r.name === "side1");
    expect(entry?.sync_hint).toBe("no-fs");
  });
});
