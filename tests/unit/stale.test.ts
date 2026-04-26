import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearStale, getAllStale, isStale, setStale } from "../../src/core/registry.js";
import { isDeadRefreshError } from "../../src/commands/usage.js";

let configRoot: string;
const originalAppData = process.env.APPDATA;

beforeEach(async () => {
  configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-stale-"));
  process.env.APPDATA = configRoot;
});

afterEach(async () => {
  if (originalAppData === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
  await fs.rm(configRoot, { recursive: true, force: true });
});

describe("stale registry", () => {
  it("tracks multiple stale profile ids", async () => {
    await setStale("prof_one");
    await setStale("prof_two");
    await setStale("prof_one");

    expect(await getAllStale()).toEqual(["prof_one", "prof_two"]);
    expect(await isStale("prof_one")).toBe(true);
    expect(await isStale("prof_two")).toBe(true);
  });

  it("clears only the requested stale profile id", async () => {
    await setStale("prof_one");
    await setStale("prof_two");

    await clearStale("prof_one");

    expect(await getAllStale()).toEqual(["prof_two"]);
    expect(await isStale("prof_one")).toBe(false);
    expect(await isStale("prof_two")).toBe(true);
  });
});

describe("dead refresh detection", () => {
  it("recognizes standard and provider-specific dead-token errors", () => {
    expect(isDeadRefreshError(400, "invalid_grant")).toBe(true);
    expect(isDeadRefreshError(400, "Refresh token not found or invalid")).toBe(true);
    expect(isDeadRefreshError(400, "oauth failed: invalid_grant for refresh_token")).toBe(true);
  });

  it("does not treat unrelated refresh failures as stale credentials", () => {
    expect(isDeadRefreshError(0, "network")).toBe(false);
    expect(isDeadRefreshError(401, "invalid_client")).toBe(false);
    expect(isDeadRefreshError(400, "invalid_request")).toBe(false);
  });
});
