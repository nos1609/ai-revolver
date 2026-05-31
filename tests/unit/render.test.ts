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
    resolveTemplatePath: (p: string) => p,  // не раскрываем ${HOME} в тестах
  };
});

// ── registry mocks ────────────────────────────────────────────────────────────
const registryMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  isActiveMain: vi.fn(),
}));
vi.mock("../../src/core/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/registry.js")>();
  return { ...actual, getProfile: registryMocks.getProfile, isActiveMain: registryMocks.isActiveMain };
});

// ── vault mock ────────────────────────────────────────────────────────────────
const vaultMocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../src/vault/factory.js", () => ({
  openVault: vi.fn(async () => ({ get: vaultMocks.get })),
}));

// ── provider mock ─────────────────────────────────────────────────────────────
vi.mock("../../src/providers/loader.js", () => ({
  loadProvider: vi.fn(async () => ({
    name: "codex",
    auth_methods: {
      oauth: {
        credential_file: {
          path: "/fake/home/.codex/auth.json",
          format: "json",
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
  })),
}));

// ── writer mock ───────────────────────────────────────────────────────────────
const writerMocks = vi.hoisted(() => ({ writeCredentials: vi.fn() }));
vi.mock("../../src/providers/writer.js", () => ({
  writeCredentials: writerMocks.writeCredentials,
}));

// ── console.log silent ────────────────────────────────────────────────────────
vi.spyOn(console, "log").mockImplementation(() => {});

let tempRoot: string;

const fakeProfile = {
  id: "prof_side1",
  name: "side1",
  provider: "codex",
  auth_type: "oauth" as const,
  created_at: "2026-01-01T00:00:00.000Z",
};

const fakeEntry = {
  profile_id: "prof_side1",
  credentials: { access_token: "tok_a", account_id: "acc_123" },
  grab_data: { last_refresh: 1_700_000_000_000 },
  identity: { "tokens.account_id": "acc_123" },
};

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-render-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  registryMocks.getProfile.mockResolvedValue(fakeProfile);
  registryMocks.isActiveMain.mockResolvedValue(false);
  vaultMocks.get.mockResolvedValue(fakeEntry);
  writerMocks.writeCredentials.mockResolvedValue(undefined);
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("render", () => {
  it("создаёт директорию сателлита и вызывает writeCredentials с satellite path", async () => {
    const { render } = await import("../../src/commands/render.js");
    const { satelliteCredentialPath } = await import("../../src/core/satellite.js");

    await render("codex", "side1");

    const expectedPath = satelliteCredentialPath("codex", "side1", "auth.json");
    expect(writerMocks.writeCredentials).toHaveBeenCalledOnce();
    expect(writerMocks.writeCredentials.mock.calls[0][3]).toBe(expectedPath);
  });

  it("идемпотентен — не перезаписывает если сателлит уже есть", async () => {
    const { render } = await import("../../src/commands/render.js");
    const { satelliteCredentialPath, satelliteDir } = await import("../../src/core/satellite.js");

    // создаём файл сателлита вручную
    const satDir = satelliteDir("codex", "side1");
    await fs.mkdir(satDir, { recursive: true });
    const satPath = satelliteCredentialPath("codex", "side1", "auth.json");
    await fs.writeFile(satPath, "EXISTING");

    await render("codex", "side1");

    // writeCredentials не должен быть вызван
    expect(writerMocks.writeCredentials).not.toHaveBeenCalled();
  });

  it("--force перезаписывает существующий сателлит", async () => {
    const { render } = await import("../../src/commands/render.js");
    const { satelliteCredentialPath, satelliteDir } = await import("../../src/core/satellite.js");

    const satDir = satelliteDir("codex", "side1");
    await fs.mkdir(satDir, { recursive: true });
    const satPath = satelliteCredentialPath("codex", "side1", "auth.json");
    await fs.writeFile(satPath, "EXISTING");

    await render("codex", "side1", { force: true });

    expect(writerMocks.writeCredentials).toHaveBeenCalledOnce();
  });

  it("ошибка когда name — это active main", async () => {
    const { render } = await import("../../src/commands/render.js");
    registryMocks.isActiveMain.mockResolvedValue(true);

    await expect(render("codex", "side1")).rejects.toThrow(/active main.*switch/i);
  });

  it("ошибка когда профиль не найден в registry", async () => {
    const { render } = await import("../../src/commands/render.js");
    registryMocks.getProfile.mockResolvedValue(null);

    await expect(render("codex", "ghost")).rejects.toThrow(/не найден|not found/i);
  });

  it("ошибка когда vault entry отсутствует", async () => {
    const { render } = await import("../../src/commands/render.js");
    vaultMocks.get.mockResolvedValue(null);

    await expect(render("codex", "side1")).rejects.toThrow(/отсутствуют|missing/i);
  });
});
