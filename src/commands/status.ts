import path from "node:path";
import chalk from "chalk";
import { listProfiles, getAllActive, getProfileById, isActiveMain } from "../core/registry.js";
import { listProviders, loadProvider } from "../providers/loader.js";
import { readProviderJsonFile } from "../providers/json.js";
import { openVault } from "../vault/factory.js";
import { satelliteCredentialPath } from "../core/satellite.js";
import { checkIdentity } from "../core/identity.js";
import { resolveTemplatePath } from "../platform/index.js";
import { fileExists } from "../platform/fs.js";
import { tr, trf } from "../i18n.js";
import { renderTable } from "../ui/table.js";

// ── Status JSON types ─────────────────────────────────────────

export type SyncHint =
  | "in-sync"
  | "vault-newer"
  | "fs-newer"
  | "identity-mismatch"
  | "missing-identity"
  | "no-fs"
  | "no-vault";

export type RenderLocation = "native" | "satellite" | "none";

export interface StatusEntry {
  provider: string;
  name: string;
  in_vault: boolean;
  render: RenderLocation;
  identity: Record<string, unknown> | undefined;
  last_refresh: number | undefined;
  sync_hint: SyncHint;
}

// ── Satellite-aware JSON status ──────────────────────────────

export async function statusJson(providerFilter?: string): Promise<StatusEntry[]> {
  const providers = providerFilter ? [providerFilter] : await listProviders();
  const profiles = await listProfiles();
  const vault = await openVault({ skipVerify: true });

  const result: StatusEntry[] = [];

  for (const provName of providers) {
    const provProfiles = profiles.filter((p) => p.provider === provName);
    if (provProfiles.length === 0) continue;

    let provider: Awaited<ReturnType<typeof loadProvider>> | undefined;
    try {
      provider = await loadProvider(provName);
    } catch {
      // provider YAML missing — skip satellite details
    }

    for (const profile of provProfiles) {
      const vaultEntry = await vault.get(profile.id);
      const in_vault = vaultEntry !== null;

      // Determine FS render location
      let render: RenderLocation = "none";
      let fsPath: string | undefined;

      if (provider?.auth_methods.oauth) {
        const nativePath = resolveTemplatePath(provider.auth_methods.oauth.credential_file.path);
        const satPath = satelliteCredentialPath(
          provName,
          profile.name,
          path.basename(nativePath),
        );
        const isMain = await isActiveMain(provName, profile.name);

        if (isMain) {
          render = "native";
          fsPath = nativePath;
        } else if (await fileExists(satPath)) {
          render = "satellite";
          fsPath = satPath;
        }
      }

      // Compute sync_hint (read-only — no lock acquired)
      let sync_hint: SyncHint = "no-vault";
      if (in_vault && vaultEntry) {
        if (!fsPath || !(await fileExists(fsPath))) {
          sync_hint = "no-fs";
        } else if (provider?.auth_methods.oauth) {
          try {
            const fsRawJson = await readProviderJsonFile<Record<string, unknown>>(
              fsPath,
              provider.auth_methods.oauth.credential_file.format,
            );

            // Identity check
            const identityCheck = checkIdentity(provider, vaultEntry.identity, fsRawJson);
            if (!identityCheck.ok) {
              sync_hint = identityCheck.reason === "missing-in-vault"
                ? "missing-identity"
                : "identity-mismatch";
            } else {
              // Freshness comparison
              const fsTs = extractTs(fsRawJson);
              const vaultTs = vaultEntry.last_refresh ?? 0;
              if (fsTs === vaultTs) {
                sync_hint = "in-sync";
              } else if (vaultTs > fsTs) {
                sync_hint = "vault-newer";
              } else {
                sync_hint = "fs-newer";
              }
            }
          } catch {
            sync_hint = "no-fs"; // file unreadable
          }
        } else {
          sync_hint = "in-sync"; // no oauth, no FS check
        }
      }

      result.push({
        provider: provName,
        name: profile.name,
        in_vault,
        render,
        identity: vaultEntry?.identity,
        last_refresh: vaultEntry?.last_refresh,
        sync_hint,
      });
    }
  }

  return result;
}

// ── Original text status (unchanged) ────────────────────────

export async function status(providerFilter?: string): Promise<void> {
  const providers = providerFilter ? [providerFilter] : await listProviders();
  const active = await getAllActive();
  const rows = [];

  console.log();

  for (const provName of providers) {
    const activeId = active[provName];
    if (!activeId) {
      rows.push({
        provider: { text: provName, color: chalk.bold },
        status: { text: tr("— не настроен", "— not configured"), color: chalk.dim },
      });
      continue;
    }

    const profile = await getProfileById(activeId);
    if (!profile) {
      rows.push({
        provider: { text: provName, color: chalk.bold },
        status: { text: tr("— профиль не найден", "— profile missing"), color: chalk.red },
      });
      continue;
    }

    rows.push({
      provider: { text: provName, color: chalk.bold },
      status: `${chalk.green(profile.name)} (${profile.auth_type})`,
    });
  }

  for (const line of renderTable(
    [
      { key: "provider", header: tr("ПРОВАЙДЕР", "PROVIDER"), min: 8, max: 16, priority: 1 },
      { key: "status", header: tr("СТАТУС", "STATUS"), min: 18, max: 80, priority: 0 },
    ],
    rows,
  )) {
    console.log(line);
  }

  const totalProfiles = (await listProfiles()).length;
  console.log();
  console.log(
    chalk.dim(
      trf(
        `  профилей: {n} | провайдеров: {m}`,
        `  profiles: {n} | providers: {m}`,
        { n: totalProfiles, m: providers.length },
      ),
    ),
  );
}

// ── Helper ────────────────────────────────────────────────────

function extractTs(rawJson: Record<string, unknown>): number {
  const v = rawJson["last_refresh"];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const d = Date.parse(v);
    if (Number.isFinite(d)) return d;
  }
  return 0;
}
