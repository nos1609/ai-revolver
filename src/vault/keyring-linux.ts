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

export type SecretToolStatus =
  | { status: "available" }
  | { status: "missing-secret-tool"; detail?: string }
  | { status: "secret-service-unavailable"; detail?: string }
  | { status: "unavailable"; detail?: string };

export async function secretToolStatus(): Promise<SecretToolStatus> {
  try {
    // Do a real lookup — not just binary check. If the secret service daemon
    // isn't running, secret-tool prints "The name is not activatable" to stderr
    // but may still exit 0. We check stderr explicitly.
    const { stderr } = await execFileAsync("secret-tool", [
      "lookup", "service", "ai-revolver-probe", "account", "probe",
    ], { timeout: 5000 });
    if (stderr && stderr.includes("not activatable")) {
      return { status: "secret-service-unavailable", detail: stderr.trim() };
    }
    return { status: "available" };
  } catch (err: unknown) {
    const e = err as { code?: string; stderr?: string; message?: string };
    const detail = (e.stderr || e.message || "").trim() || undefined;
    if (e.code === "ENOENT") {
      return { status: "missing-secret-tool", detail };
    }
    if (detail?.includes("not activatable")) {
      return { status: "secret-service-unavailable", detail };
    }
    return { status: "unavailable", detail };
  }
}

export async function secretToolAvailable(): Promise<boolean> {
  return (await secretToolStatus()).status === "available";
}
