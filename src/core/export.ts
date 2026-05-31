import {
  listProfiles,
  getAllActive,
  loadRegistry,
  saveRegistry,
  setActive,
  clearStale,
} from "./registry.js";
import type { VaultStore } from "../vault/store.js";
import type { Profile } from "../types/index.js";
import {
  encryptWithPassword,
  decryptWithPassword,
  type EncryptedEnvelope,
} from "../vault/crypto.js";
import { tr } from "../i18n.js";

// ── Format ───────────────────────────────────────────────
//
// On-disk envelope. Two shapes, distinguished by `encrypted`:
//   plaintext → { airev_export:1, encrypted:false, payload: ExportPayload }
//   encrypted → { airev_export:1, encrypted:true,  envelope: EncryptedEnvelope }
//
// Encrypted envelope is the *same* scheme vault.enc uses (aes-256-gcm +
// scrypt), so anyone who can open the encrypted-file vault can also open
// an export — and vice-versa. No bespoke crypto.

export interface ExportedProfile extends Profile {
  credentials: Record<string, unknown>;
  grab_data: Record<string, unknown>;
}

export interface ExportPayload {
  version: 1;
  exported_at: string;
  profiles: ExportedProfile[];
  /** provider → profile_id (optional; import may or may not apply). */
  active: Record<string, string>;
}

type ExportFile =
  | { airev_export: 1; encrypted: false; payload: ExportPayload }
  | { airev_export: 1; encrypted: true; envelope: EncryptedEnvelope };

// ── Build ────────────────────────────────────────────────

/**
 * Pull registry + vault + active-map into a single portable payload.
 *
 * Vault entries are joined by profile id; profiles without a vault entry
 * are included with empty credentials/grab_data — they're still valid
 * registry rows (user might have dropped secrets but kept the profile for
 * re-grab later). Orphan vault entries (no matching profile) are dropped
 * on purpose: they're garbage the `doctor` command should surface.
 */
export async function buildExport(vault: VaultStore): Promise<ExportPayload> {
  const profiles = await listProfiles();
  const active = await getAllActive();

  const exported: ExportedProfile[] = [];
  for (const p of profiles) {
    const entry = await vault.get(p.id);
    exported.push({
      ...p,
      credentials: entry?.credentials ?? {},
      grab_data: entry?.grab_data ?? {},
    });
  }

  return {
    version: 1,
    exported_at: new Date().toISOString(),
    profiles: exported,
    active,
  };
}

export function serializeExport(
  payload: ExportPayload,
  password?: string,
): string {
  if (password) {
    const envelope = encryptWithPassword(JSON.stringify(payload), password);
    const file: ExportFile = { airev_export: 1, encrypted: true, envelope };
    return JSON.stringify(file, null, 2) + "\n";
  }
  const file: ExportFile = { airev_export: 1, encrypted: false, payload };
  return JSON.stringify(file, null, 2) + "\n";
}

// ── Parse ────────────────────────────────────────────────

export class ImportError extends Error {}

/**
 * Parse a file back into ExportPayload. If `password` is undefined and the
 * file is encrypted, throws — caller decides how to prompt.
 */
export function parseExport(raw: string, password?: string): ExportPayload {
  let file: ExportFile;
  try {
    file = JSON.parse(raw) as ExportFile;
  } catch {
    throw new ImportError(tr("Файл не является валидным JSON.", "File is not valid JSON."));
  }
  if (!file || (file as { airev_export?: number }).airev_export !== 1) {
    throw new ImportError(
      tr(
        "Файл не является airev-export (нет airev_export:1).",
        "Not an airev export file (missing airev_export:1).",
      ),
    );
  }

  if (file.encrypted) {
    if (!password) {
      throw new ImportError(tr("Файл зашифрован — нужен пароль.", "File is encrypted — password required."));
    }
    let decrypted: string;
    try {
      decrypted = decryptWithPassword(file.envelope, password);
    } catch {
      throw new ImportError(tr("Неверный пароль.", "Wrong password."));
    }
    return JSON.parse(decrypted) as ExportPayload;
  }
  return file.payload;
}

export function isEncryptedExport(raw: string): boolean {
  try {
    const file = JSON.parse(raw) as { encrypted?: boolean; airev_export?: number };
    return file?.airev_export === 1 && file.encrypted === true;
  } catch {
    return false;
  }
}

// ── Apply ────────────────────────────────────────────────

export interface ImportOptions {
  /** When a profile with same (name, provider) exists, overwrite instead of skipping. */
  replace?: boolean;
  /** Restore the `active` map from the export, overriding local active selection. */
  restoreActive?: boolean;
}

export interface ImportReport {
  added: ExportedProfile[];
  /** Skipped because same (name, provider) already present and replace=false. */
  skippedConflict: ExportedProfile[];
  /** Profile id collided — we keep local, drop incoming. (Pathological; airev IDs are random.) */
  skippedIdCollision: ExportedProfile[];
  replaced: ExportedProfile[];
  /** Names assigned or kept. */
  activeApplied: Record<string, string>;
}

/**
 * Merge an exported payload into current registry + vault.
 *
 * Strategy:
 *   - (name, provider) is the user-facing uniqueness key.
 *     If it collides → skip (default) or replace (--replace).
 *   - Profile `id` is expected to be unique. If an incoming id equals a
 *     local id but the name/provider differs, we treat it as an id
 *     collision and skip — it would be unsafe to silently overwrite a
 *     different profile under the same id.
 *   - Vault writes keyed by profile id, always.
 *   - `active` is only applied with --restore-active, and only for profiles
 *     that exist after the merge.
 */
export async function applyImport(
  payload: ExportPayload,
  vault: VaultStore,
  opts: ImportOptions,
): Promise<ImportReport> {
  const reg = await loadRegistry();
  const byNameProvider = new Map<string, Profile>(
    reg.profiles.map((p) => [`${p.provider}:${p.name}`, p]),
  );
  const byId = new Map<string, Profile>(reg.profiles.map((p) => [p.id, p]));

  const report: ImportReport = {
    added: [],
    skippedConflict: [],
    skippedIdCollision: [],
    replaced: [],
    activeApplied: {},
  };

  for (const incoming of payload.profiles) {
    const key = `${incoming.provider}:${incoming.name}`;
    const nameClash = byNameProvider.get(key);
    const idClash = byId.get(incoming.id);

    // ID collision with a *different* profile — refuse silently overwriting.
    if (idClash && (idClash.name !== incoming.name || idClash.provider !== incoming.provider)) {
      report.skippedIdCollision.push(incoming);
      continue;
    }

    if (nameClash && !opts.replace) {
      report.skippedConflict.push(incoming);
      continue;
    }

    const profile: Profile = {
      id: incoming.id,
      name: incoming.name,
      provider: incoming.provider,
      auth_type: incoming.auth_type,
      created_at: incoming.created_at,
    };

    if (nameClash && opts.replace) {
      // Keep the *local* id so vault pointers elsewhere stay intact; but
      // everything else — including potentially updated credentials —
      // comes from the incoming record.
      profile.id = nameClash.id;
      const idx = reg.profiles.findIndex((p) => p.id === nameClash.id);
      reg.profiles[idx] = profile;
      report.replaced.push(incoming);
    } else {
      reg.profiles.push(profile);
      report.added.push(incoming);
    }

    // Always write vault entry (replace or new). Empty credentials means a
    // profile was exported without secrets — import as empty, `grab` later.
    await vault.put({
      profile_id: profile.id,
      credentials: incoming.credentials,
      grab_data: incoming.grab_data,
    });
    // Importing (with or without secrets) supersedes any prior local "stale"
    // knowledge for this id. The export is the new source of truth.
    await clearStale(profile.id);
  }

  await saveRegistry(reg);

  if (opts.restoreActive) {
    const validIds = new Set(reg.profiles.map((p) => p.id));
    for (const [prov, id] of Object.entries(payload.active)) {
      if (validIds.has(id)) {
        await setActive(prov, id);
        report.activeApplied[prov] = id;
      }
    }
  }

  return report;
}
