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

// ── writer mock ───────────────────────────────────────────────────────────────
const writerMocks = vi.hoisted(() => ({ writeCredentials: vi.fn() }));
vi.mock("../../src/providers/writer.js", () => ({
  writeCredentials: writerMocks.writeCredentials,
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

const TS_BASE = 1_700_000_000_000;

function makeVaultEntry(lastRefresh: number) {
  return {
    profile_id: "prof_side1",
    credentials: { access_token: "tok_a", account_id: "acc_A" },
    grab_data: { last_refresh: lastRefresh },
    identity: { "tokens.account_id": "acc_A" },
    last_refresh: lastRefresh,
  };
}

function makeFsRead(lastRefresh: number) {
  return {
    credentials: { access_token: "tok_a", account_id: "acc_A" },
    grab_data: { last_refresh: lastRefresh },
  };
}

function makeFsRawJson(lastRefresh: number) {
  return {
    tokens: { access_token: "tok_a", account_id: "acc_A" },
    last_refresh: lastRefresh,
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-sync-merge-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  registryMocks.getProfile.mockResolvedValue(fakeProfile);
  registryMocks.isActiveMain.mockResolvedValue(true);
  fsMocks.fileExists.mockResolvedValue(true);
  writerMocks.writeCredentials.mockResolvedValue(undefined);
  vaultMocks.put.mockResolvedValue(undefined);
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("sync freshness merge", () => {
  it("no-op когда last_refresh одинаков", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    vaultMocks.get.mockResolvedValue(makeVaultEntry(TS_BASE));
    readerMocks.readCredentials.mockResolvedValue(makeFsRead(TS_BASE));
    jsonMocks.readProviderJsonFile.mockResolvedValue(makeFsRawJson(TS_BASE));

    const result = await sync("codex", "side1");
    expect(result.resolution).toBe("no-op");
    expect(vaultMocks.put).not.toHaveBeenCalled();
    expect(writerMocks.writeCredentials).not.toHaveBeenCalled();
  });

  it("push-fs-to-vault когда FS новее", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    const fsTs = TS_BASE + 5000;
    vaultMocks.get.mockResolvedValue(makeVaultEntry(TS_BASE));
    readerMocks.readCredentials.mockResolvedValue(makeFsRead(fsTs));
    jsonMocks.readProviderJsonFile.mockResolvedValue(makeFsRawJson(fsTs));

    const result = await sync("codex", "side1");
    expect(result.resolution).toBe("push-fs-to-vault");
    expect(vaultMocks.put).toHaveBeenCalled();
    expect(writerMocks.writeCredentials).not.toHaveBeenCalled();
  });

  it("push-vault-to-fs когда vault новее", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    const vaultTs = TS_BASE + 5000;
    vaultMocks.get.mockResolvedValue(makeVaultEntry(vaultTs));
    readerMocks.readCredentials.mockResolvedValue(makeFsRead(TS_BASE));
    // Оба вызова readProviderJsonFile должны возвращать одинаковый FS raw (TS_BASE)
    jsonMocks.readProviderJsonFile.mockResolvedValue(makeFsRawJson(TS_BASE));

    const result = await sync("codex", "side1");
    expect(result.resolution).toBe("push-vault-to-fs");
    expect(writerMocks.writeCredentials).toHaveBeenCalled();
    expect(vaultMocks.put).not.toHaveBeenCalled();
  });

  it("--dry-run возвращает resolution без записи", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    const fsTs = TS_BASE + 5000;
    vaultMocks.get.mockResolvedValue(makeVaultEntry(TS_BASE));
    readerMocks.readCredentials.mockResolvedValue(makeFsRead(fsTs));
    jsonMocks.readProviderJsonFile.mockResolvedValue(makeFsRawJson(fsTs));

    const result = await sync("codex", "side1", { dryRun: true });
    expect(result.resolution).toBe("push-fs-to-vault");
    // Нет реальных записей
    expect(vaultMocks.put).not.toHaveBeenCalled();
    expect(writerMocks.writeCredentials).not.toHaveBeenCalled();
  });

  it("--force --pull пишет vault → FS независимо от timestamp", async () => {
    const { sync } = await import("../../src/commands/sync.js");
    // FS новее, но --force --pull должен записать vault → FS
    const fsTs = TS_BASE + 10000;
    vaultMocks.get.mockResolvedValue(makeVaultEntry(TS_BASE));
    readerMocks.readCredentials.mockResolvedValue(makeFsRead(fsTs));
    jsonMocks.readProviderJsonFile.mockResolvedValue(makeFsRawJson(fsTs));

    const result = await sync("codex", "side1", { force: true, direction: "pull" });
    expect(result.resolution).toBe("push-vault-to-fs");
    expect(writerMocks.writeCredentials).toHaveBeenCalled();
  });
});
