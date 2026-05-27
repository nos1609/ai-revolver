import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ── configDir isolation ───────────────────────────────────────────────────────
const configState = vi.hoisted(() => ({ configDir: "" }));
vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return { ...actual, getConfigDir: () => configState.configDir };
});

// ── registry mocks ────────────────────────────────────────────────────────────
const registryMocks = vi.hoisted(() => ({ isActiveMain: vi.fn() }));
vi.mock("../../src/core/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/registry.js")>();
  return { ...actual, isActiveMain: registryMocks.isActiveMain };
});

vi.spyOn(console, "log").mockImplementation(() => {});

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-evict-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  registryMocks.isActiveMain.mockResolvedValue(false);
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("evict", () => {
  it("удаляет директорию сателлита", async () => {
    const { evict } = await import("../../src/commands/evict.js");
    const { satelliteDir } = await import("../../src/core/satellite.js");

    // создаём сателлит вручную
    const satDir = satelliteDir("codex", "side1");
    await fs.mkdir(satDir, { recursive: true });
    await fs.writeFile(path.join(satDir, "auth.json"), "{}");

    await evict("codex", "side1");

    await expect(fs.stat(satDir)).rejects.toThrow(/ENOENT/);
  });

  it("no-op когда сателлит не существует", async () => {
    const { evict } = await import("../../src/commands/evict.js");
    // должен завершиться без ошибки
    await expect(evict("codex", "ghost")).resolves.toBeUndefined();
  });

  it("ошибка когда name — active main", async () => {
    const { evict } = await import("../../src/commands/evict.js");
    registryMocks.isActiveMain.mockResolvedValue(true);

    await expect(evict("codex", "side1")).rejects.toThrow(/active main/i);
  });
});
