import path from "node:path";
import chalk from "chalk";
import { loadProvider } from "../providers/loader.js";
import { readCredentials } from "../providers/reader.js";
import { writeCredentials } from "../providers/writer.js";
import { readProviderJsonFile } from "../providers/json.js";
import { getProfile, isActiveMain } from "../core/registry.js";
import { openVault } from "../vault/factory.js";
import { withProfileLock } from "../core/lock.js";
import { satelliteCredentialPath } from "../core/satellite.js";
import { checkIdentity } from "../core/identity.js";
import { resolveTemplatePath } from "../platform/index.js";
import { fileExists } from "../platform/fs.js";
import { getByPath } from "../core/usage.js";
import { tr, trf } from "../i18n.js";
import type { ProviderDefinition, VaultEntry } from "../types/index.js";

// ── Public types ──────────────────────────────────────────────

export interface SyncOpts {
  dryRun?: boolean;
  force?: boolean;
  /** Required when force is true. */
  direction?: "push" | "pull";
}

export type SyncResolution =
  | { resolution: "no-op" }
  | { resolution: "push-fs-to-vault"; reason: string }
  | { resolution: "push-vault-to-fs"; reason: string };

// ── Main function ─────────────────────────────────────────────

export async function sync(
  providerName: string,
  profileName: string,
  opts: SyncOpts = {},
): Promise<SyncResolution> {
  return withProfileLock(providerName, profileName, async () => {
    // --force requires --push or --pull
    if (opts.force && !opts.direction) {
      throw new Error(
        tr(`--force требует --push или --pull`, `--force requires --push or --pull`),
      );
    }

    const provider = await loadProvider(providerName);
    const oauth = provider.auth_methods.oauth;
    if (!oauth) {
      throw new Error(
        trf(`Провайдер "{p}" не поддерживает OAuth`, `Provider "{p}" has no oauth auth method`, { p: providerName }),
      );
    }

    const profile = await getProfile(profileName, providerName);
    if (!profile) {
      throw new Error(
        trf(`Профиль "{n}" не найден`, `Profile "{n}" not found`, { n: profileName }),
      );
    }

    // Resolve FS path: active main → native, else → satellite
    const nativePath = resolveTemplatePath(oauth.credential_file.path);
    const fsPath = (await isActiveMain(providerName, profileName))
      ? nativePath
      : satelliteCredentialPath(providerName, profileName, path.basename(nativePath));

    if (!(await fileExists(fsPath))) {
      throw new Error(
        trf(
          `Нет FS-локации для "{n}"; нечего синхронизировать`,
          `No FS location for "{n}"; nothing to sync (run render first)`,
          { n: profileName },
        ),
      );
    }

    const vault = await openVault();
    const vaultEntry = await vault.get(profile.id);
    if (!vaultEntry) {
      throw new Error(
        trf(
          `Vault entry для "{n}" отсутствует; запусти grab сначала`,
          `Vault entry for "{n}" missing; run grab first`,
          { n: profileName },
        ),
      );
    }

    // Read FS credentials (normalized) and raw JSON for identity check
    const fsRead = await readCredentials(oauth.credential_file, oauth.credential_secrets, fsPath);
    const fsRawJson = await readProviderJsonFile<Record<string, unknown>>(fsPath, oauth.credential_file.format);

    // ── Identity guard ────────────────────────────────────────
    if (!opts.force) {
      const check = checkIdentity(provider, vaultEntry.identity, fsRawJson);
      if (!check.ok) {
        const fixHint = trf(
          `  Если намеренно:\n` +
          `    airev {p} grab --force {n}   (FS → vault)\n` +
          `    airev {p} render --force {n}  (vault → FS)`,
          `  If intentional:\n` +
          `    airev {p} grab --force {n}   (FS → vault)\n` +
          `    airev {p} render --force {n}  (vault → FS)`,
          { p: providerName, n: profileName },
        );
        const reasonLabel = check.reason === "mismatch"
          ? tr(`identity mismatch`, `identity mismatch`)
          : tr(`identity not recorded`, `identity not recorded`);
        throw new Error(
          trf(
            `airev sync {p} {n}: {r}\n  vault: {v}\n  FS:    {f}\n{hint}`,
            `airev sync {p} {n}: {r}\n  vault: {v}\n  FS:    {f}\n{hint}`,
            { p: providerName, n: profileName, r: reasonLabel, v: check.vaultDisplay, f: check.fsDisplay, hint: fixHint },
          ),
        );
      }
    }

    // ── Freshness merge ───────────────────────────────────────
    const fsLastRefresh = extractLastRefreshFromRaw(fsRead.grab_data, fsRawJson);
    const vaultLastRefresh = vaultEntry.last_refresh ?? 0;

    let resolution: SyncResolution = { resolution: "no-op" };

    if (opts.force) {
      resolution = opts.direction === "push"
        ? { resolution: "push-fs-to-vault", reason: "--force --push" }
        : { resolution: "push-vault-to-fs", reason: "--force --pull" };
    } else if (fsLastRefresh > vaultLastRefresh) {
      resolution = {
        resolution: "push-fs-to-vault",
        reason: `FS newer (${fsLastRefresh} > ${vaultLastRefresh})`,
      };
    } else if (vaultLastRefresh > fsLastRefresh) {
      resolution = {
        resolution: "push-vault-to-fs",
        reason: `vault newer (${vaultLastRefresh} > ${fsLastRefresh})`,
      };
    }

    if (opts.dryRun) {
      const label = resolution.resolution + ("reason" in resolution ? ` (${resolution.reason})` : "");
      console.log(chalk.dim(`  dry-run: ${label}`));
      return resolution;
    }

    // ── Execute resolution ────────────────────────────────────
    if (resolution.resolution === "push-fs-to-vault") {
      await vault.put({
        profile_id: profile.id,
        credentials: fsRead.credentials,
        grab_data: fsRead.grab_data,
        identity: extractIdentityFromRaw(provider, fsRawJson),
        last_refresh: fsLastRefresh,
      });
      console.log(chalk.green(
        trf(`  ✓ "{n}": FS → vault`, `  ✓ "{n}": FS → vault`, { n: profileName }),
      ));
    } else if (resolution.resolution === "push-vault-to-fs") {
      // Compare-and-swap: re-read FS to detect concurrent rotation
      const fsRawRecheck = await readProviderJsonFile<Record<string, unknown>>(fsPath, oauth.credential_file.format);
      const fsRecheckRefresh = extractLastRefreshFromRaw({}, fsRawRecheck);

      if (fsRecheckRefresh !== fsLastRefresh) {
        throw new Error(
          trf(
            `airev sync {p} {n}: FS changed concurrently (last_refresh {a} → {b}); retry sync`,
            `airev sync {p} {n}: FS changed concurrently (last_refresh {a} → {b}); retry sync`,
            {
              p: providerName,
              n: profileName,
              a: String(fsLastRefresh),
              b: String(fsRecheckRefresh),
            },
          ),
        );
      }

      await writeCredentials(
        oauth.credential_file,
        { credentials: vaultEntry.credentials, grab_data: vaultEntry.grab_data },
        oauth.credential_secrets,
        fsPath,
      );
      console.log(chalk.green(
        trf(`  ✓ "{n}": vault → FS`, `  ✓ "{n}": vault → FS`, { n: profileName }),
      ));
    } else {
      console.log(chalk.dim(trf(`  ✓ "{n}": уже синхронизирован`, `  ✓ "{n}": already in sync`, { n: profileName })));
    }

    return resolution;
  });
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Extract last_refresh timestamp from grab_data or raw JSON.
 * Mirrors the extraction logic in grab.ts:extractLastRefresh.
 * Returns 0 when the field is absent (treats missing as "oldest").
 *
 * Note: mtime-based fallback is intentionally omitted in V1.
 * Providers that never emit last_refresh will always produce 0,
 * causing sync to be a no-op unless --force is used.
 */
function extractLastRefreshFromRaw(
  grabData: Record<string, unknown>,
  rawJson: Record<string, unknown>,
): number {
  // Try grab_data first (provider explicitly declared last_refresh as grab_field)
  const fromGrab = grabData["last_refresh"];
  if (typeof fromGrab === "number" && Number.isFinite(fromGrab)) return fromGrab;
  if (typeof fromGrab === "string") {
    const d = Date.parse(fromGrab);
    if (Number.isFinite(d)) return d;
  }
  // Fallback: raw JSON top-level field
  const fromRaw = rawJson["last_refresh"];
  if (typeof fromRaw === "number" && Number.isFinite(fromRaw)) return fromRaw;
  if (typeof fromRaw === "string") {
    const d = Date.parse(fromRaw);
    if (Number.isFinite(d)) return d;
  }
  return 0;
}

function extractIdentityFromRaw(
  provider: ProviderDefinition,
  rawJson: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!provider.identity) return undefined;
  const out: Record<string, unknown> = {};
  for (const field of provider.identity.fields) {
    const v = getByPath(rawJson, field);
    if (v == null) return undefined;
    out[field] = v;
  }
  return out;
}
