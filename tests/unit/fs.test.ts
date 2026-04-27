import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileExists, readJsonFile, writeJsonFile } from "../../src/platform/fs.js";

const platformState = vi.hoisted(() => ({
  platform: "linux" as "win32" | "darwin" | "linux",
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getPlatform: () => platformState.platform,
  };
});

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-fs-"));
  platformState.platform = "linux";
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("platform fs", () => {
  it("writes json with requested POSIX permissions", async () => {
    platformState.platform = "linux";
    const file = path.join(tempRoot, "vault.enc");

    await writeJsonFile(file, { ok: true }, 0o600);

    const stat = await fs.stat(file);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
    await expect(readJsonFile(file)).resolves.toEqual({ ok: true });
  });

  it("writes json on Windows when POSIX permissions are requested", async () => {
    platformState.platform = "win32";
    const file = path.join(tempRoot, "vault.enc");

    await writeJsonFile(file, { ok: true }, 0o600);

    await expect(readJsonFile(file)).resolves.toEqual({ ok: true });
  });

  it("recovers a missing json file from backup", async () => {
    const file = path.join(tempRoot, "registry.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + ".bak", JSON.stringify({ restored: true }), "utf-8");

    await expect(fileExists(file)).resolves.toBe(true);
    await expect(readJsonFile(file)).resolves.toEqual({ restored: true });
  });
});
