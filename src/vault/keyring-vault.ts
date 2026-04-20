import { getPlatform } from "../platform/index.js";
import { dpApiStore, dpApiLoad, dpApiDelete, dpApiAvailable } from "./keyring-win.js";
import { keychainStore, keychainLoad, keychainDelete, keychainAvailable } from "./keyring-mac.js";
import { secretToolStore, secretToolLoad, secretToolDelete, secretToolAvailable } from "./keyring-linux.js";
import type { VaultStore } from "./store.js";
import type { VaultEntry, VaultData } from "../types/index.js";

const VAULT_KEY = "vault_data";

type Backend = {
  store: (key: string, data: string) => Promise<void>;
  load: (key: string) => Promise<string | null>;
  remove: (key: string) => Promise<void>;
};

function getBackend(): Backend {
  const platform = getPlatform();
  if (platform === "win32") {
    return { store: dpApiStore, load: dpApiLoad, remove: dpApiDelete };
  }
  if (platform === "darwin") {
    return { store: keychainStore, load: keychainLoad, remove: keychainDelete };
  }
  // linux / other
  return { store: secretToolStore, load: secretToolLoad, remove: secretToolDelete };
}

/**
 * OS Keyring vault — Tier 1 storage backend.
 *   Windows : DPAPI (ProtectedData), tied to user login session
 *   macOS   : Keychain via `security` CLI
 *   Linux   : libsecret via `secret-tool`
 */
export class KeyringVault implements VaultStore {
  private cache: VaultData | null = null;
  private backend = getBackend();

  static async isAvailable(): Promise<boolean> {
    const platform = getPlatform();
    if (platform === "win32") return dpApiAvailable();
    if (platform === "darwin") return keychainAvailable();
    return secretToolAvailable();
  }

  private async load(): Promise<VaultData> {
    if (this.cache) return this.cache;

    const raw = await this.backend.load(VAULT_KEY);
    if (!raw) {
      this.cache = { version: 1, entries: [] };
      return this.cache;
    }

    this.cache = JSON.parse(raw) as VaultData;
    return this.cache;
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    await this.backend.store(VAULT_KEY, JSON.stringify(this.cache));
  }

  async put(entry: VaultEntry): Promise<void> {
    const data = await this.load();
    const idx = data.entries.findIndex((e) => e.profile_id === entry.profile_id);
    if (idx >= 0) {
      data.entries[idx] = entry;
    } else {
      data.entries.push(entry);
    }
    await this.save();
  }

  async get(profileId: string): Promise<VaultEntry | null> {
    const data = await this.load();
    return data.entries.find((e) => e.profile_id === profileId) ?? null;
  }

  async remove(profileId: string): Promise<void> {
    const data = await this.load();
    data.entries = data.entries.filter((e) => e.profile_id !== profileId);
    await this.save();
  }

  async listIds(): Promise<string[]> {
    const data = await this.load();
    return data.entries.map((e) => e.profile_id);
  }
}
