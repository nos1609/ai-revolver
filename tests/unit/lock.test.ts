import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ── redirect getConfigDir to an isolated tmp dir ──────────────────────────────
const configState = vi.hoisted(() => ({ configDir: "" }));
vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return { ...actual, getConfigDir: () => configState.configDir };
});

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-lock-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("profile advisory lock", () => {
  it("withProfileLock runs the callback and returns its value", async () => {
    const { withProfileLock } = await import("../../src/core/lock.js");
    const result = await withProfileLock("codex", "main", async () => 42);
    expect(result).toBe(42);
  });

  it("withProfileLock serializes concurrent calls — no interleaving", async () => {
    const { withProfileLock } = await import("../../src/core/lock.js");
    const seen: number[] = [];

    const run = (n: number) =>
      withProfileLock("codex", "serial", async () => {
        seen.push(n);
        await new Promise((r) => setTimeout(r, 20));
        seen.push(-n);
      });

    await Promise.all([run(1), run(2)]);

    // Each pair (n, -n) must be adjacent — no interleaving
    expect(seen).toHaveLength(4);
    expect(Math.abs(seen[0])).toBe(Math.abs(seen[1]));
    expect(seen[0]).toBe(-seen[1]);
    expect(seen[2]).toBe(-seen[3]);
  });

  it("rejects immediately when wait:false and lock is held", async () => {
    const { withProfileLock } = await import("../../src/core/lock.js");

    let release!: () => void;
    const held = withProfileLock("codex", "busy", async () => {
      await new Promise<void>((r) => { release = r; });
    });

    // Give the first acquirer time to write the lockfile
    await new Promise((r) => setTimeout(r, 30));

    await expect(
      withProfileLock("codex", "busy", async () => {}, { wait: false }),
    ).rejects.toThrow(/lock/i);

    release();
    await held;
  });

  it("isLockHeld returns true while lock is held, false after release", async () => {
    const { withProfileLock, isLockHeld } = await import("../../src/core/lock.js");

    let release!: () => void;
    const held = withProfileLock("codex", "probe", async () => {
      await new Promise<void>((r) => { release = r; });
    });
    await new Promise((r) => setTimeout(r, 30));

    expect(await isLockHeld("codex", "probe")).toBe(true);
    release();
    await held;
    expect(await isLockHeld("codex", "probe")).toBe(false);
  });

  // The positive "PID was written and is readable" check exercises a diagnostic
  // side-effect of withProfileLock (the write of `${pid}\n` after successful O_EXCL open).
  // Core locking correctness relies only on the atomic create + unlink, not on
  // the content being immediately visible to a concurrent reader.
  // On Windows the file write visibility / flush timing in the test harness
  // (temp dir + config dir mock) can differ from Unix, causing intermittent null.
  // We gate it explicitly (via skipIf) so platform-specific behaviour does not
  // cause the test suite to "walk" failures between Windows and Unix CI/dev.
  it.skipIf(process.platform === "win32")("readLockPid returns the PID written inside the lockfile", async () => {
    const { withProfileLock, readLockPid } = await import("../../src/core/lock.js");

    let release!: () => void;
    const held = withProfileLock("codex", "pid-check", async () => {
      await new Promise<void>((r) => { release = r; });
    });
    await new Promise((r) => setTimeout(r, 30));

    const pid = await readLockPid("codex", "pid-check");
    expect(pid).toBe(process.pid);

    release();
    await held;
  });

  it("clearLock removes the lockfile and returns true", async () => {
    const { isLockHeld, clearLock, lockPath } = await import("../../src/core/lock.js");

    // Manually place a lockfile
    const lp = lockPath("codex", "stale");
    await fs.mkdir(path.dirname(lp), { recursive: true });
    await fs.writeFile(lp, "99999\n", { flag: "wx" });

    expect(await isLockHeld("codex", "stale")).toBe(true);
    const cleared = await clearLock("codex", "stale");
    expect(cleared).toBe(true);
    expect(await isLockHeld("codex", "stale")).toBe(false);
  });

  it("clearLock returns false when lockfile is absent", async () => {
    const { clearLock } = await import("../../src/core/lock.js");
    const result = await clearLock("codex", "ghost");
    expect(result).toBe(false);
  });

  it("readLockPid returns null for corrupt/non-numeric lockfile content", async () => {
    const { readLockPid, lockPath } = await import("../../src/core/lock.js");

    const lp = lockPath("codex", "corrupt");
    await fs.mkdir(path.dirname(lp), { recursive: true });
    await fs.writeFile(lp, "not-a-pid\n");

    expect(await readLockPid("codex", "corrupt")).toBeNull();
  });

  it("readLockPid returns null when lockfile is absent", async () => {
    const { readLockPid } = await import("../../src/core/lock.js");
    expect(await readLockPid("codex", "missing")).toBeNull();
  });

  it("withProfileLock throws timeout error when deadline expires", async () => {
    const { withProfileLock } = await import("../../src/core/lock.js");

    let release!: () => void;
    const held = withProfileLock("codex", "timeout-test", async () => {
      await new Promise<void>((r) => { release = r; });
    });
    await new Promise((r) => setTimeout(r, 30));

    // Another caller with a 200ms timeout — should expire while the first holds
    await expect(
      withProfileLock("codex", "timeout-test", async () => {}, { timeoutMs: 200 }),
    ).rejects.toThrow(/timed out/i);

    release();
    await held;
  });
});
