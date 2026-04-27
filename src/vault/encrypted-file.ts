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

export async function rekeyEncryptedFileVault(oldPassword: string, newPassword: string): Promise<void> {
  if (!newPassword) {
    throw new Error("Password required.");
  }

  const filePath = EncryptedFileVault.path();
  const encFile = await readJsonFile<EncryptedVaultFile>(filePath);
  let data: VaultData;
  try {
    data = parseVaultData(decryptWithPassword(encFile, oldPassword));
  } catch {
    throw new Error("Wrong vault password.");
  }

  const nextEnvelope = encryptWithPassword(JSON.stringify(data), newPassword);
  await writeJsonFile(filePath, nextEnvelope, 0o600);

  try {
    parseVaultData(decryptWithPassword(await readJsonFile<EncryptedVaultFile>(filePath), newPassword));
  } catch {
    throw new Error("Rekey verify failed.");
  }
}

export class EncryptedFileVault implements VaultStore {
  private filePath: string;
  private password: string;
  private cache: VaultData | null = null;

  static path(): string {
    return path.join(getConfigDir(), "vault.enc");
  }

  static async exists(): Promise<boolean> {
    return fileExists(EncryptedFileVault.path());
  }

  constructor(password: string) {
    this.filePath = EncryptedFileVault.path();
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

function parseVaultData(json: string): VaultData {
  const parsed = JSON.parse(json) as VaultData;
  if (!parsed || typeof parsed !== "object" || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error("Invalid vault data.");
  }
  return parsed;
}
