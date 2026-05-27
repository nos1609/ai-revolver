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
  addProfile: vi.fn(),
  setActive: vi.fn(),
  clearStale: vi.fn(),
  isActiveMain: vi.fn(),
}));
vi.mock("../../src/core/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/registry.js")>();
  return { ...actual, ...registryMocks };
});

// ── vault mock ────────────────────────────────────────────────────────────────
const vaultMocks = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn() }));
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

// ── json reader mock (для raw JSON identity extraction) ───────────────────────
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

const fakeCreds = {
  credentials: { access_token: "tok_a", account_id: "acc_123" },
  grab_data: { last_refresh: 1_700_000_001_000 },
};
const fakeRawJson = { tokens: { access_token: "tok_a", account_id: "acc_123" }, last_refresh: 1_700_000_001_000 };

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-grab-poly-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  registryMocks.getProfile.mockResolvedValue(fakeProfile);
  registryMocks.addProfile.mockResolvedValue(fakeProfile);
  registryMocks.setActive.mockResolvedValue(undefined);
  registryMocks.clearStale.mockResolvedValue(undefined);
  registryMocks.isActiveMain.mockResolvedValue(false);
  vaultMocks.put.mockResolvedValue(undefined);
  vaultMocks.get.mockResolvedValue(null);
  readerMocks.readCredentials.mockResolvedValue(fakeCreds);
  jsonMocks.readProviderJsonFile.mockResolvedValue(fakeRawJson);
  // по умолчанию: только native credential file существует (satellite — нет)
  const nativePath = "/fake/home/.codex/auth.json";
  fsMocks.fileExists.mockImplementation(async (p: string) => p === nativePath);
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("grab — source resolution", () => {
  it("читает из сателлита когда satellite credential file существует", async () => {
    const { grab } = await import("../../src/commands/grab.js");
    const { satelliteCredentialPath } = await import("../../src/core/satellite.js");

    const satPath = satelliteCredentialPath("codex", "side1", "auth.json");

    // fileExists: возвращает true для satPath, false для native
    fsMocks.fileExists.mockImplementation(async (p: string) => p === satPath);

    await grab("codex", "side1", {});

    // readCredentials должен быть вызван с satPath (3-й аргумент)
    expect(readerMocks.readCredentials).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      satPath,
    );
  });

  it("читает из native когда active_main совпадает", async () => {
    const { grab } = await import("../../src/commands/grab.js");
    registryMocks.isActiveMain.mockResolvedValue(true);

    await grab("codex", "side1", {});

    // readCredentials вызван без targetPath (undefined = native)
    expect(readerMocks.readCredentials).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });

  it("читает из native при онбординге (нет vault entry и нет сателлита)", async () => {
    const { grab } = await import("../../src/commands/grab.js");
    registryMocks.getProfile.mockResolvedValue(null);  // нет в registry

    await grab("codex", "newbie", {});

    expect(readerMocks.readCredentials).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
    // addProfile должен быть вызван для создания нового профиля
    expect(registryMocks.addProfile).toHaveBeenCalledWith("newbie", "codex", "oauth");
  });

  it("ошибка когда vault entry есть но нет сателлита и не active_main", async () => {
    const { grab } = await import("../../src/commands/grab.js");
    // getProfile вернёт профиль, isActiveMain = false, нет satellite → rule 4 → throw
    // fileExists по умолчанию возвращает false для satellite (из beforeEach)
    await expect(grab("codex", "side1", {})).rejects.toThrow(/render/i);
  });

  it("--force читает из native даже без сателлита (override rule 4)", async () => {
    const { grab } = await import("../../src/commands/grab.js");
    // vault entry есть, active_main = false, нет сателлита, но --force

    await grab("codex", "side1", { force: true });

    expect(readerMocks.readCredentials).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });
});

describe("grab — identity capture", () => {
  it("сохраняет identity и last_refresh в vault при grab из native", async () => {
    const { grab } = await import("../../src/commands/grab.js");
    registryMocks.isActiveMain.mockResolvedValue(true);

    await grab("codex", "side1", {});

    const putCall = vaultMocks.put.mock.calls[0][0];
    expect(putCall.identity).toEqual({ "tokens.account_id": "acc_123" });
    expect(putCall.last_refresh).toBe(1_700_000_001_000);
  });
});
