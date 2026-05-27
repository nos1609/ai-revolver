import { promises as fs } from "node:fs";
import path from "node:path";
import { lockPath as getLockPath } from "./satellite.js";

export interface LockOpts {
  /**
   * When true (default), wait for the lock to become available by polling.
   * When false, throw immediately if the lock is already held.
   */
  wait?: boolean;
  /** Maximum time in milliseconds to wait when wait=true. Default: 30_000. */
  timeoutMs?: number;
}

/**
 * Acquire an O_EXCL advisory lock for the given (provider, name) pair, run `fn`,
 * then release the lock. The lock file records the holder PID so `vault unlock`
 * can display diagnostic information.
 *
 * Serializes concurrent calls within the same process via a retry loop.
 * Cross-process serialization relies on O_EXCL atomicity at the OS level.
 */
export async function withProfileLock<T>(
  provider: string,
  name: string,
  fn: () => Promise<T>,
  opts: LockOpts = {},
): Promise<T> {
  const wait = opts.wait !== false;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const lp = getLockPath(provider, name);
  await fs.mkdir(path.dirname(lp), { recursive: true });

  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      // wx = O_WRONLY | O_CREAT | O_EXCL — fails with EEXIST if file exists
      const handle = await fs.open(lp, "wx", 0o600);
      try {
        await handle.write(`${process.pid}\n`);
      } finally {
        await handle.close();
      }

      try {
        return await fn();
      } finally {
        await fs.unlink(lp).catch(() => {
          // Best-effort unlink — ignore if already removed by clearLock
        });
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw err;

      if (!wait) {
        const pid = await readLockPid(provider, name).catch(() => null);
        throw new Error(
          `another airev operation holds the lock for ${provider}/${name}` +
          (pid ? ` (pid ${pid})` : "") +
          `\n  if no such process is running, clear it with: airev vault unlock ${provider} ${name}`,
        );
      }

      if (Date.now() > deadline) {
        throw new Error(
          `timed out waiting for lock ${provider}/${name} after ${timeoutMs}ms`,
        );
      }

      await new Promise<void>((r) => setTimeout(r, 50));
    }
  }
}

/**
 * Returns true if the lockfile exists (another process may hold the lock).
 * Does not distinguish a stale lock from a live one — use `readLockPid`
 * and check whether the process is alive for that.
 */
export async function isLockHeld(provider: string, name: string): Promise<boolean> {
  try {
    await fs.access(getLockPath(provider, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the PID written inside the lockfile.
 * Returns null if the lockfile is absent or its content is not a valid integer.
 */
export async function readLockPid(provider: string, name: string): Promise<number | null> {
  try {
    const text = await fs.readFile(getLockPath(provider, name), "utf8");
    const pid = parseInt(text.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Forcibly removes the lockfile (used by `vault unlock` for stale-lock recovery).
 * Returns true if the file was present and removed, false if it was already absent.
 */
export async function clearLock(provider: string, name: string): Promise<boolean> {
  try {
    await fs.unlink(getLockPath(provider, name));
    return true;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Re-export `lockPath` from satellite.ts for consumers that need the raw path
 * (e.g., tests that manually create a lockfile to simulate a stale lock).
 */
export { getLockPath as lockPath };
