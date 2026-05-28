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

vi.spyOn(console, "log").mockImplementation(() => {});

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-vault-unlock-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("vault unlock", () => {
  it("удаляет lockfile и возвращает true когда lock существует", async () => {
    const { vaultUnlock } = await import("../../src/commands/vault.js");
    const { lockPath } = await import("../../src/core/satellite.js");

    // создаём lockfile вручную
    const lp = lockPath("codex", "side1");
    await fs.mkdir(path.dirname(lp), { recursive: true });
    await fs.writeFile(lp, String(process.pid), { flag: "w" });

    const ok = await vaultUnlock("codex", "side1");
    expect(ok).toBe(true);

    // lockfile удалён
    await expect(fs.stat(lp)).rejects.toThrow(/ENOENT/);
  });

  it("возвращает false (no-op) когда lockfile отсутствует", async () => {
    const { vaultUnlock } = await import("../../src/commands/vault.js");
    const ok = await vaultUnlock("codex", "ghost");
    expect(ok).toBe(false);
  });
});
