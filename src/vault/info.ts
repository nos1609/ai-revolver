import path from "node:path";
import { getConfigDir, getPlatform, type Platform } from "../platform/index.js";

export type VaultMigrateTarget = "keyring" | "file";

export interface VaultPaths {
  configDir: string;
  registry: string;
  active: string;
  stale: string;
  encryptedVault: string;
  windowsDpapiVault: string;
}

export function getVaultPaths(): VaultPaths {
  const configDir = getConfigDir();
  return {
    configDir,
    registry: path.join(configDir, "registry.json"),
    active: path.join(configDir, "active.json"),
    stale: path.join(configDir, "stale.json"),
    encryptedVault: path.join(configDir, "vault.enc"),
    windowsDpapiVault: path.join(configDir, "keyring", "vault_data.dpapi"),
  };
}

export function keyringBackendLabel(platform: Platform = getPlatform()): string {
  if (platform === "win32") return "Windows DPAPI";
  if (platform === "darwin") return "macOS Keychain";
  return "Linux libsecret";
}

export function normalizeVaultMigrateTarget(target: string | undefined): VaultMigrateTarget | null {
  if (target === "keyring") return "keyring";
  if (target === "file" || target === "encrypted-file") return "file";
  return null;
}
