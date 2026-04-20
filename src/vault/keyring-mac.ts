import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SERVICE = "ai-revolver";
const ACCOUNT = "vault_data";

/**
 * macOS Keychain via `security` CLI (built-in).
 * Data stored as generic password — accessible only to current user.
 */
export async function keychainStore(key: string, data: string): Promise<void> {
  // Delete existing entry first (update not atomic in security CLI)
  await keychainDelete(key).catch(() => {});
  await execFileAsync("security", [
    "add-generic-password",
    "-a", `${ACCOUNT}_${key}`,
    "-s", SERVICE,
    "-w", data,
    "-U", // update if exists
  ], { timeout: 10000 });
}

export async function keychainLoad(key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-a", `${ACCOUNT}_${key}`,
      "-s", SERVICE,
      "-w", // output password only
    ], { timeout: 10000 });
    return stdout.trimEnd() || null;
  } catch {
    return null;
  }
}

export async function keychainDelete(key: string): Promise<void> {
  await execFileAsync("security", [
    "delete-generic-password",
    "-a", `${ACCOUNT}_${key}`,
    "-s", SERVICE,
  ], { timeout: 10000 }).catch(() => {});
}

export async function keychainAvailable(): Promise<boolean> {
  try {
    // Check that `security` CLI exists and Keychain is accessible
    await execFileAsync("security", ["list-keychains"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
