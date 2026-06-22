import fs from "node:fs/promises";
import path from "node:path";
import { getPlatform } from "./index.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Ensure parent directories exist */
export async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

/**
 * Atomic write: tmp → backup → rename.
 * On Windows, retries rename on EPERM/EACCES (file may be held by CLI process).
 */
export async function atomicWrite(
  target: string,
  data: string,
  permissions?: number,
): Promise<void> {
  await ensureDir(target);

  const tmp = target + ".tmp";
  const bak = target + ".bak";

  await fs.writeFile(tmp, data, "utf-8");

  // Verify tmp was written
  const stat = await fs.stat(tmp);
  if (stat.size === 0 && data.length > 0) {
    throw new Error(`Atomic write failed: tmp file is empty (${target})`);
  }

  // Backup current file if it exists
  try {
    await fs.copyFile(target, bak);
  } catch {
    // No existing file — fine
  }

  // Replace target: rename with fallback to copy+unlink on Windows
  const maxRetries = getPlatform() === "win32" ? 3 : 1;
  let delay = 100;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fs.rename(tmp, target);
      break;
    } catch (err: unknown) {
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      // Last resort on Windows: copy + unlink instead of rename
      try {
        await fs.copyFile(tmp, target);
        await fs.unlink(tmp).catch(() => {});
        break;
      } catch {
        // Restore from backup
        try {
          await fs.copyFile(bak, target);
        } catch { /* best effort */ }
        throw err;
      }
    }
  }

  // Set permissions
  if (permissions != null) {
    await setPermissions(target, permissions);
  }
}

async function setPermissions(filePath: string, mode: number): Promise<void> {
  if (getPlatform() === "win32") {
    try {
      const username = process.env.USERNAME ?? process.env.USER ?? "";
      if (username) {
        await execFileAsync("icacls", [
          filePath,
          "/inheritance:r",
          "/grant:r",
          `${username}:F`,
        ]);
      }
    } catch {
      // Best effort on Windows
    }
  } else {
    await fs.chmod(filePath, mode);
  }
}

/** Raw existence check — no recovery, no recursion */
async function rawExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-recover: if a file is missing but .bak exists, restore from backup.
 * This handles the case where atomicWrite renamed target → .bak
 * but failed to rename .tmp → target (Windows file locking).
 */
async function autoRecover(filePath: string): Promise<boolean> {
  if (await rawExists(filePath)) return false;
  if (!(await rawExists(filePath + ".bak"))) return false;

  try {
    await fs.copyFile(filePath + ".bak", filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T = unknown>(filePath: string): Promise<T> {
  // Try auto-recovery if file is missing but .bak exists
  await autoRecover(filePath);
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, data: unknown, permissions?: number): Promise<void> {
  const json = JSON.stringify(data, null, 2) + "\n";
  await atomicWrite(filePath, json, permissions);
}

/**
 * Write raw UTF-8 content to a file atomically (tmp → bak → rename).
 * Used for opaque credential blobs (providers whose CLI reads the file
 * verbatim and whose on-disk format is not JSON).
 */
export async function writeBinaryFile(
  filePath: string,
  content: string,
  permissions?: number,
): Promise<void> {
  await atomicWrite(filePath, content, permissions);
}

export async function fileExists(filePath: string): Promise<boolean> {
  if (await rawExists(filePath)) return true;
  // Auto-recover from .bak if main file is missing
  return autoRecover(filePath);
}
