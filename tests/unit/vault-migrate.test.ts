import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../../src/types/index.js";
import type { VaultStore } from "../../src/vault/store.js";
import { migrateVaultEntries } from "../../src/vault/migrate.js";

class MemVault implements VaultStore {
  store = new Map<string, VaultEntry>();

  constructor(entries: VaultEntry[] = []) {
    for (const entry of entries) {
      this.store.set(entry.profile_id, structuredClone(entry));
    }
  }

  async put(entry: VaultEntry): Promise<void> {
    this.store.set(entry.profile_id, structuredClone(entry));
  }

  async get(profileId: string): Promise<VaultEntry | null> {
    const entry = this.store.get(profileId);
    return entry ? structuredClone(entry) : null;
  }

  async remove(profileId: string): Promise<void> {
    this.store.delete(profileId);
  }

  async listIds(): Promise<string[]> {
    return [...this.store.keys()];
  }
}

class CorruptingTargetVault extends MemVault {
  override async get(profileId: string): Promise<VaultEntry | null> {
    const entry = await super.get(profileId);
    if (!entry) return null;
    return {
      ...entry,
      credentials: { ...entry.credentials, access_token: "corrupted" },
    };
  }
}

const entryA: VaultEntry = {
  profile_id: "prof_a",
  credentials: { access_token: "tok_a" },
  grab_data: { email: "a@example.test" },
};

const entryB: VaultEntry = {
  profile_id: "prof_b",
  credentials: { access_token: "tok_b" },
  grab_data: {},
};

describe("migrateVaultEntries", () => {
  it("fails before copying when target has a conflicting id and replace=false", async () => {
    const source = new MemVault([entryA, entryB]);
    const target = new MemVault([{ ...entryA, credentials: { access_token: "old" } }]);

    await expect(migrateVaultEntries({
      sourceName: "keyring",
      targetName: "encrypted-file",
      source,
      target,
      cleanup: "keep-source",
    })).rejects.toThrow(/already exists|уже/i);

    expect(await target.get("prof_b")).toBeNull();
    expect(await target.get("prof_a")).toMatchObject({ credentials: { access_token: "old" } });
  });

  it("copies and verifies all entries while keeping source by default", async () => {
    const source = new MemVault([entryA, entryB]);
    const target = new MemVault();

    const report = await migrateVaultEntries({
      sourceName: "keyring",
      targetName: "encrypted-file",
      source,
      target,
      cleanup: "keep-source",
    });

    expect(report).toEqual({
      source: "keyring",
      target: "encrypted-file",
      copied: 2,
      verified: 2,
      deleted: 0,
      keptSource: true,
    });
    expect(await target.get("prof_a")).toEqual(entryA);
    expect(await target.get("prof_b")).toEqual(entryB);
    expect(await source.get("prof_a")).toEqual(entryA);
  });

  it("deletes source entries only after all copied entries verify", async () => {
    const source = new MemVault([entryA, entryB]);
    const target = new MemVault();

    const report = await migrateVaultEntries({
      sourceName: "keyring",
      targetName: "encrypted-file",
      source,
      target,
      cleanup: "delete-source",
    });

    expect(report.deleted).toBe(2);
    expect(report.keptSource).toBe(false);
    expect(await source.listIds()).toEqual([]);
    expect(await target.get("prof_a")).toEqual(entryA);
  });

  it("does not delete source entries when target verification fails", async () => {
    const source = new MemVault([entryA]);
    const target = new CorruptingTargetVault();

    await expect(migrateVaultEntries({
      sourceName: "keyring",
      targetName: "encrypted-file",
      source,
      target,
      cleanup: "delete-source",
    })).rejects.toThrow(/verify|провер/i);

    expect(await source.get("prof_a")).toEqual(entryA);
  });

  it("allows target overwrite only with replace=true", async () => {
    const source = new MemVault([entryA]);
    const target = new MemVault([{ ...entryA, credentials: { access_token: "old" } }]);

    const report = await migrateVaultEntries({
      sourceName: "keyring",
      targetName: "encrypted-file",
      source,
      target,
      cleanup: "keep-source",
      replace: true,
    });

    expect(report.copied).toBe(1);
    expect(await target.get("prof_a")).toEqual(entryA);
  });
});
