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

// ── reader mock (две фазы: initial read + CAS re-read) ────────────────────────
const readerMocks = vi.hoisted(() => ({ readCredentials: vi.fn() }));
vi.mock("../../src/providers/reader.js", () => ({
  readCredentials: readerMocks.readCredentials,
}));

// ── writer mock ───────────────────────────────────────────────────────────────
const writerMocks = vi.hoisted(() => ({ writeCredentials: vi.fn() }));
vi.mock("../../src/providers/writer.js", () => ({
  writeCredentials: writerMocks.writeCredentials,
}));

// ── json reader mock (две фазы: initial read + CAS re-read) ──────────────────
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
const TS_VAULT_NEWER = TS_BASE + 5000;
const TS_FS_ROTATED = TS_BASE + 20000;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-sync-cas-"));
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

describe("sync compare-and-swap on push-vault-to-fs", () => {
  it("успешный push-vault-to-fs когда FS не изменился", async () => {
    const { sync } = await import("../../src/commands/sync.js");

    // vault новее FS → resolution = push-vault-to-fs
    vaultMocks.get.mockResolvedValue({
      profile_id: "prof_side1",
      credentials: { access_token: "tok_a", account_id: "acc_A" },
      grab_data: { last_refresh: TS_VAULT_NEWER },
      identity: { "tokens.account_id": "acc_A" },
      last_refresh: TS_VAULT_NEWER,
    });

    // Initial read (FS) + CAS re-read (FS) — оба возвращают TS_BASE
    const fsRead = {
      credentials: { access_token: "tok_a", account_id: "acc_A" },
      grab_data: { last_refresh: TS_BASE },
    };
    const fsRaw = { tokens: { access_token: "tok_a", account_id: "acc_A" }, last_refresh: TS_BASE };

    readerMocks.readCredentials.mockResolvedValue(fsRead);
    jsonMocks.readProviderJsonFile.mockResolvedValue(fsRaw);

    const result = await sync("codex", "side1");
    expect(result.resolution).toBe("push-vault-to-fs");
    expect(writerMocks.writeCredentials).toHaveBeenCalled();
  });

  it("abort когда FS изменился между начальным read и write (CAS)", async () => {
    const { sync } = await import("../../src/commands/sync.js");

    // vault новее FS → resolution = push-vault-to-fs
    vaultMocks.get.mockResolvedValue({
      profile_id: "prof_side1",
      credentials: { access_token: "tok_a", account_id: "acc_A" },
      grab_data: { last_refresh: TS_VAULT_NEWER },
      identity: { "tokens.account_id": "acc_A" },
      last_refresh: TS_VAULT_NEWER,
    });

    // Initial read возвращает TS_BASE
    const fsRead1 = {
      credentials: { access_token: "tok_a", account_id: "acc_A" },
      grab_data: { last_refresh: TS_BASE },
    };
    const fsRaw1 = { tokens: { access_token: "tok_a", account_id: "acc_A" }, last_refresh: TS_BASE };

    // CAS re-read возвращает другой timestamp (FS ротировался)
    const fsRaw2 = { tokens: { access_token: "tok_b", account_id: "acc_A" }, last_refresh: TS_FS_ROTATED };

    readerMocks.readCredentials.mockResolvedValue(fsRead1);
    // Первый вызов → initial; второй вызов → CAS re-check
    jsonMocks.readProviderJsonFile
      .mockResolvedValueOnce(fsRaw1)   // initial identity + freshness read
      .mockResolvedValueOnce(fsRaw2);  // CAS re-check

    await expect(sync("codex", "side1")).rejects.toThrow(
      /concurrently|параллельно|FS changed/i,
    );
    // writeCredentials не вызывается если CAS abort
    expect(writerMocks.writeCredentials).not.toHaveBeenCalled();
  });
});
