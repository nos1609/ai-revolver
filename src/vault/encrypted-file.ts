import path from "node:path";
import { getConfigDir } from "../platform/index.js";
import { readJsonFile, writeJsonFile, fileExists, ensureDir } from "../platform/fs.js";
import type { VaultStore } from "./store.js";
import type { VaultEntry, VaultData } from "../types/index.js";
import {
  encryptWithPassword,
  decryptWithPassword,
  type EncryptedEnvelope,
} from "./crypto.js";

type EncryptedVaultFile = EncryptedEnvelope;

export class EncryptedFileVault implements VaultStore {
  private filePath: string;
  private password: string;
  private cache: VaultData | null = null;

  constructor(password: string) {
    this.filePath = path.join(getConfigDir(), "vault.enc");
    this.password = password;
  }

  private async load(): Promise<VaultData> {
    if (this.cache) return this.cache;

    if (!(await fileExists(this.filePath))) {
      this.cache = { version: 1, entries: [] };
      return this.cache;
    }

    const encFile = await readJsonFile<EncryptedVaultFile>(this.filePath);
    try {
      const json = decryptWithPassword(encFile, this.password);
      this.cache = JSON.parse(json) as VaultData;
    } catch {
      throw new Error("Wrong vault password.");
    }
    return this.cache;
  }

  private async save(): Promise<void> {
    if (!this.cache) return;
    await ensureDir(this.filePath);
    const json = JSON.stringify(this.cache);
    const encFile = encryptWithPassword(json, this.password);
    await writeJsonFile(this.filePath, encFile, 0o600);
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
