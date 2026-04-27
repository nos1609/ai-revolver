import type { VaultEntry } from "../types/index.js";
import type { VaultStore } from "./store.js";
import type { VaultBackendName } from "./info.js";
import { tr } from "../i18n.js";

export type { VaultBackendName } from "./info.js";
export type VaultMigrationCleanup = "keep-source" | "delete-source";

export interface VaultMigrationOptions {
  sourceName: VaultBackendName;
  targetName: VaultBackendName;
  source: VaultStore;
  target: VaultStore;
  cleanup: VaultMigrationCleanup;
  replace?: boolean;
}

export interface VaultMigrationReport {
  source: VaultBackendName;
  target: VaultBackendName;
  copied: number;
  verified: number;
  verifiedIds: string[];
  deleted: number;
  keptSource: boolean;
}

export async function migrateVaultEntries(opts: VaultMigrationOptions): Promise<VaultMigrationReport> {
  const ids = await opts.source.listIds();
  await assertTargetCanAccept(opts.target, ids, opts.replace ?? false);

  const copiedEntries: VaultEntry[] = [];
  for (const id of ids) {
    const entry = await opts.source.get(id);
    if (!entry) {
      throw new Error(tr(
        `Source vault перечислил entry, но не смог её прочитать.`,
        `Source vault listed an entry but could not read it.`,
      ));
    }
    await opts.target.put(entry);
    copiedEntries.push(entry);
  }

  let verified = 0;
  const verifiedIds: string[] = [];
  for (const entry of copiedEntries) {
    const targetEntry = await opts.target.get(entry.profile_id);
    if (!entriesEqual(entry, targetEntry)) {
      throw new Error(tr(
        `Verify target vault не прошёл после copy.`,
        `Target vault verify failed after copy.`,
      ));
    }
    verified += 1;
    verifiedIds.push(entry.profile_id);
  }

  let deleted = 0;
  if (opts.cleanup === "delete-source") {
    deleted = await deleteVerifiedSourceEntries(opts.source, verifiedIds);
  }

  return {
    source: opts.sourceName,
    target: opts.targetName,
    copied: copiedEntries.length,
    verified,
    verifiedIds,
    deleted,
    keptSource: opts.cleanup !== "delete-source",
  };
}

async function assertTargetCanAccept(target: VaultStore, ids: string[], replace: boolean): Promise<void> {
  if (replace) return;
  const existing = new Set(await target.listIds());
  if (ids.some((id) => existing.has(id))) {
    throw new Error(tr(
      `Target vault уже содержит одну из мигрируемых entries. Используй --replace для перезаписи.`,
      `Target vault entry already exists. Use --replace to overwrite.`,
    ));
  }
}

async function deleteVerifiedSourceEntries(source: VaultStore, verifiedIds: string[]): Promise<number> {
  let deleted = 0;
  for (const id of verifiedIds) {
    await source.remove(id);
    if (await source.get(id)) {
      throw new Error(tr(
        `Source vault сообщил об удалении entry, но entry всё ещё читается.`,
        `Source vault reported delete success, but the entry is still readable.`,
      ));
    }
    deleted += 1;
  }
  return deleted;
}

function entriesEqual(left: VaultEntry, right: VaultEntry | null): boolean {
  return right !== null && stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
