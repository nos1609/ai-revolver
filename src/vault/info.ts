import path from "node:path";
import { getConfigDir, getPlatform, type Platform } from "../platform/index.js";
import { EncryptedFileVault } from "./encrypted-file.js";
import { KeyringVault } from "./keyring-vault.js";

export type VaultBackendName = "keyring" | "encrypted-file";
export type VaultMigrateTarget = "keyring" | "file";

export interface VaultPaths {
  configDir: string;
  registry: string;
  active: string;
  stale: string;
  encryptedVault: string;
  windowsDpapiVault: string;
}

export interface EffectiveVaultBackend {
  backend: VaultBackendName;
  keyringAvailable: boolean;
  keyringEntryCount: number | null;
  encryptedFileExists: boolean;
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

export async function describeEffectiveVaultBackend(): Promise<EffectiveVaultBackend> {
  const keyringAvailable = await KeyringVault.isAvailable();
  const encryptedFileExists = await EncryptedFileVault.exists();

  if (!keyringAvailable) {
    return {
      backend: "encrypted-file",
      keyringAvailable,
      keyringEntryCount: null,
      encryptedFileExists,
    };
  }

  const keyringEntryCount = (await new KeyringVault().listIds()).length;

  return {
    backend: keyringEntryCount === 0 && encryptedFileExists ? "encrypted-file" : "keyring",
    keyringAvailable,
    keyringEntryCount,
    encryptedFileExists,
  };
}
