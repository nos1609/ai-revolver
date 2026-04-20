import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ATTR_SERVICE = "service=ai-revolver";

/**
 * Linux secret store via `secret-tool` (libsecret).
 * Requires: apt install libsecret-tools / pacman -S libsecret
 * Integrates with GNOME Keyring, KWallet (via compatibility layer), etc.
 *
 * Data is stored as a secret with attributes — accessible only to current user session.
 */
export async function secretToolStore(key: string, data: string): Promise<void> {
  await execFileAsync("secret-tool", [
    "store",
    "--label", `ai-revolver: ${key}`,
    "service", "ai-revolver",
    "account", key,
  ], {
    timeout: 15000,
    input: data, // secret-tool reads the secret from stdin — never exposed as arg
  });
}

export async function secretToolLoad(key: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("secret-tool", [
      "lookup",
      "service", "ai-revolver",
      "account", key,
    ], { timeout: 10000 });
    return stdout.trimEnd() || null;
  } catch {
    return null;
  }
}

export async function secretToolDelete(key: string): Promise<void> {
  await execFileAsync("secret-tool", [
    "clear",
    "service", "ai-revolver",
    "account", key,
  ], { timeout: 10000 }).catch(() => {});
}

export async function secretToolAvailable(): Promise<boolean> {
  try {
    // Do a real lookup — not just binary check. If the secret service daemon
    // isn't running, secret-tool prints "The name is not activatable" to stderr
    // but may still exit 0. We check stderr explicitly.
    const { stderr } = await execFileAsync("secret-tool", [
      "lookup", "service", "ai-revolver-probe", "account", "probe",
    ], { timeout: 5000 });
    if (stderr && stderr.includes("not activatable")) return false;
    return true;
  } catch (err: unknown) {
    const msg = (err as { stderr?: string }).stderr ?? "";
    if (msg.includes("not activatable")) return false;
    // Binary not found or other system error
    return false;
  }
}
