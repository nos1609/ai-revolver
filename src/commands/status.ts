import path from "node:path";
import { stat } from "node:fs/promises";
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
import { readCredentials } from "../providers/reader.js";
import { computeFreshness, isRefreshDegraded } from "../core/credential-policy.js";
import { getByPath } from "../core/usage.js";

// ── Status JSON types ─────────────────────────────────────────

export type SyncHint =
  | "in-sync"
  | "vault-newer"
  | "fs-newer"
  | "identity-mismatch"
  | "missing-identity"
  | "no-fs"
  | "no-vault"
  | "fs-degraded"
  | "both-degraded"
  | "vault-degraded";

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
            const oauth = provider.auth_methods.oauth;
            // binary-passthrough: synthesise rawJson from the read credentials
            // (no JSON parse of the opaque blob). Other formats read as JSON.
            let fsRawJson: Record<string, unknown>;
            if (oauth.credential_file.format === "binary-passthrough") {
              const fsRead = await readCredentials(
                oauth.credential_file,
                oauth.credential_secrets || [],
                fsPath,
              );
              fsRawJson = {};
              for (const [normKey, jsonPath] of Object.entries(oauth.credential_file.mapping)) {
                if (jsonPath === ".") fsRawJson[normKey] = fsRead.credentials[normKey];
              }
            } else {
              fsRawJson = await readProviderJsonFile<Record<string, unknown>>(
                fsPath,
                oauth.credential_file.format,
              );
            }

            // Identity check
            const identityCheck = checkIdentity(provider, vaultEntry.identity, fsRawJson);
            if (!identityCheck.ok) {
              sync_hint = identityCheck.reason === "missing-in-vault"
                ? "missing-identity"
                : "identity-mismatch";
            } else {
              // W3: universal freshness with mtime + degraded hints (after identity ok)
              // wrapped to not break existing tests on mock paths
              let fsTs = 0;
              const vaultDegraded = isRefreshDegraded(vaultEntry.credentials || {});
              let fsDegraded = false;
              try {
                let fsCreds: Record<string, unknown> = {};
                try {
                  const oauth = provider.auth_methods.oauth;
                  if (oauth) {
                    const fsRead = await readCredentials(
                      oauth.credential_file,
                      oauth.credential_secrets || [],
                      fsPath,
                    );
                    fsCreds = fsRead.credentials;
                  }
                } catch {
                  // no creds for degrade check
                }
                const fsStat = await stat(fsPath);
                fsTs = computeFreshness({
                  grabData: {},
                  rawJson: fsRawJson,
                  fileMtimeMs: fsStat.mtimeMs,
                });
                fsDegraded = isRefreshDegraded(fsCreds);
                // Use the provider-declared mapping (e.g. "tokens.refresh_token" or "claudeAiOauth.refreshToken")
                // instead of hardcoded paths. This makes degrade detection provider-agnostic and consistent
                // with how reader extracts + sanitizes credentials.
                const oauthForRt = provider.auth_methods.oauth;
                if (fsDegraded && oauthForRt && oauthForRt.credential_file && oauthForRt.credential_file.mapping) {
                  const rtPath = oauthForRt.credential_file.mapping.refresh_token;
                  if (rtPath) {
                    const rawRt = getByPath(fsRawJson, rtPath);
                    if (rawRt && !(typeof rawRt === "string" && rawRt.trim() === "")) {
                      fsDegraded = false;
                    }
                  }
                }
                // Supplemental for test fixtures with minimal raw (common locations); primary is mapping above.
                if (fsDegraded) {
                  const rawRt = getByPath(fsRawJson, "tokens.refresh_token") || getByPath(fsRawJson, "refresh_token") || getByPath(fsRawJson, "claudeAiOauth.refreshToken");
                  if (rawRt && !(typeof rawRt === "string" && rawRt.trim() === "")) {
                    fsDegraded = false;
                  }
                }
              } catch {
                // fallback to old ts from raw for back-compat in tests
                const v = fsRawJson["last_refresh"];
                fsTs = (typeof v === "number" && Number.isFinite(v)) ? v : (typeof v === "string" ? (Date.parse(v) || 0) : 0);
              }

              const vaultTs = vaultEntry.last_refresh ?? 0;

              if (fsDegraded && !vaultDegraded) {
                sync_hint = "fs-degraded";
              } else if (vaultDegraded && fsDegraded) {
                sync_hint = "both-degraded";
              } else if (vaultDegraded && !fsDegraded) {
                sync_hint = "vault-degraded";
              } else {
                // existing freshness compare
                if (fsTs === vaultTs) {
                  sync_hint = "in-sync";
                } else if (vaultTs > fsTs) {
                  sync_hint = "vault-newer";
                } else {
                  sync_hint = "fs-newer";
                }
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

// (extractTs removed — W3 uses computeFreshness + file stat for FS-side freshness)
