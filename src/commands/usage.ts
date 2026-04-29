import chalk from "chalk";
import { listProviders, loadProvider } from "../providers/loader.js";
import { clearStale, getAllActive, getAllStale, listProfiles, setStale } from "../core/registry.js";
import { openVault } from "../vault/factory.js";
import { fetchUsage, persistCredentials } from "../core/usage.js";
import { tr, trf } from "../i18n.js";
import type { Profile, UsageSnapshot, UsageWindow } from "../types/index.js";
import { renderCells, tableWidths } from "../ui/table.js";
import type { TableColumn, TableRow } from "../ui/table.js";

// ── Formatters ───────────────────────────────────────────

function formatRelative(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return tr("сейчас", "now");
  const sec = Math.floor(diff / 1000);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  // Time unit suffixes stay English (d/h/m) — established terminology,
  // translating to "д/ч/м" adds noise without clarity.
  if (d > 0) return trf(`через {d}d {h}h`, `in {d}d {h}h`, { d, h });
  if (h > 0) return trf(`через {h}h {m}m`, `in {h}h {m}m`, { h, m });
  return trf(`через {m}m`, `in {m}m`, { m });
}

function pctColor(pctLeft: number): (s: string) => string {
  if (pctLeft >= 50) return chalk.green;
  if (pctLeft >= 20) return chalk.yellow;
  return chalk.red;
}

/** Human label for a window duration: 5h, 7d, 30m, etc. */
function windowLabel(seconds: number | undefined, fallback: string): string {
  if (!seconds || !Number.isFinite(seconds)) return fallback;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

function formatWindow(fallbackLabel: string, w: UsageWindow | undefined): string {
  if (!w || typeof w.used_percent !== "number") return "";
  const label = windowLabel(w.window_seconds, fallbackLabel);
  const left = Math.max(0, Math.min(100, 100 - w.used_percent));
  const pctStr = pctColor(left)(trf(`{n}% осталось`, `{n}% left`, { n: left.toFixed(0) }));
  const resets = w.resets_at
    ? chalk.dim(trf(` · сброс {t}`, ` · resets {t}`, { t: formatRelative(w.resets_at) }))
    : "";
  return `${chalk.bold(label)}: ${pctStr}${resets}`;
}

/**
 * Render snapshot lines. Email and plan come from the API/JWT — they represent
 * the *verified account identity*, distinct from `profile.name` (which is just
 * a user-chosen label). We always show email when available, even if it
 * textually matches the profile name: the point is confirmation, not dedup.
 */
function renderSnapshot(snap: UsageSnapshot): string[] {
  const header: string[] = [];
  if (snap.email) header.push(chalk.cyan(snap.email));
  if (snap.plan) header.push(chalk.dim(snap.plan));

  const windows: string[] = [];
  const p = formatWindow("5h", snap.primary);
  const s = formatWindow("7d", snap.secondary);
  if (p) windows.push(p);
  if (s) windows.push(s);

  const out: string[] = [];
  if (header.length) out.push(header.join("  "));
  if (windows.length) out.push(windows.join("    "));
  return out;
}

// ── Target resolution ────────────────────────────────────

interface Target {
  profile: Profile;
  isActive: boolean;
  isStale: boolean;
}

export function isDeadRefreshError(status: number, error?: string): boolean {
  const normalized = (error ?? "").toLowerCase();
  return (
    normalized === "invalid_grant" ||
    normalized === "refresh token not found or invalid" ||
    normalized.includes("invalid_grant") ||
    (status === 400 && normalized.includes("refresh token"))
  );
}

/**
 * Resolve which profiles to probe based on (providerFilter, profileFilter).
 *
 *   airev usage                → ALL oauth profiles (every provider, every account)
 *   airev usage <name>         → any oauth profile with that name (cross-provider)
 *   airev <prov> usage         → all oauth profiles for that provider
 *   airev <prov> usage <name>  → one specific profile
 */
async function resolveTargets(
  providerFilter: string | undefined,
  profileFilter: string | undefined,
): Promise<Target[]> {
  const profiles = (await listProfiles()).filter((p) => p.auth_type === "oauth");
  const active = await getAllActive();
  const stale = new Set(await getAllStale());
  const isActive = (p: Profile) => active[p.provider] === p.id;
  const isStale = (p: Profile) => stale.has(p.id);

  let matching = profiles;
  if (providerFilter) matching = matching.filter((p) => p.provider === providerFilter);
  if (profileFilter) matching = matching.filter((p) => p.name === profileFilter);

  return matching.map((p) => ({ profile: p, isActive: isActive(p), isStale: isStale(p) }));
}

// ── Command ──────────────────────────────────────────────

export async function usage(
  providerFilter?: string,
  profileFilter?: string,
): Promise<void> {
  // Validate provider, if specified
  if (providerFilter) {
    const known = await listProviders();
    if (!known.includes(providerFilter)) {
      console.error(chalk.red(trf(`Неизвестный провайдер: "{p}"`, `Unknown provider: "{p}"`, { p: providerFilter })));
      return;
    }
  }

  const targets = await resolveTargets(providerFilter, profileFilter);

  if (targets.length === 0) {
    if (profileFilter) {
      const scope = providerFilter
        ? trf(` для провайдера "{p}"`, ` for provider "{p}"`, { p: providerFilter })
        : "";
      console.log(
        chalk.red(
          trf(`  OAuth-профиль "{n}" не найден{scope}.`, `  No oauth profile "{n}" found{scope}.`, {
            n: profileFilter,
            scope,
          }),
        ),
      );
    } else if (providerFilter) {
      console.log(
        chalk.dim(trf(`  Нет OAuth-профилей для "{p}".`, `  No oauth profiles for "{p}".`, { p: providerFilter })),
      );
    } else {
      console.log(chalk.dim(tr("  Нет активных OAuth-профилей.", "  No active oauth profiles.")));
    }
    return;
  }

  // Open vault once for all targets
  const vault = await openVault();

  console.log();
  const columns: TableColumn[] = [
    { key: "active", header: "", min: 1, max: 1, priority: 9 },
    { key: "provider", header: tr("ПРОВАЙДЕР", "PROVIDER"), min: 8, max: 16, priority: 1 },
    { key: "name", header: tr("ПРОФИЛЬ", "PROFILE"), min: 10, max: 28, priority: 0 },
  ];
  const layoutRows: TableRow[] = targets.map(({ profile, isActive }) => ({
    active: isActive ? "*" : " ",
    provider: profile.provider,
    name: profile.name,
  }));
  const widths = tableWidths(columns, layoutRows);
  const CONT_INDENT = `  ${widths.map((width) => " ".repeat(width)).join("  ")} `;

  for (const { profile, isActive, isStale } of targets) {
    const provider = await loadProvider(profile.provider);
    const head = `${renderCells(
      [
        { text: isActive ? "*" : " ", color: isActive ? chalk.green : undefined },
        { text: profile.provider, color: chalk.bold },
        { text: profile.name, color: chalk.green },
      ],
      widths,
    )} `;

    if (!provider.usage) {
      console.log(`${head} ${chalk.dim(tr("— usage-probes не настроены", "— no usage probes configured"))}`);
      continue;
    }

    if (isStale && !isActive) {
      console.log(
        `${head} ${chalk.yellow(tr("— stale credentials; сначала обнови через grab", "— stale credentials; refresh via grab first"))}`,
      );
      continue;
    }

    const entry = await vault.get(profile.id);
    if (!entry) {
      console.log(`${head} ${chalk.red(tr("vault-запись не найдена", "vault entry missing"))}`);
      continue;
    }

    try {
      // Active profiles read from the CLI credential file as source of
      // truth — the file may have rotated tokens we don't have in vault
      // yet (critical for Anthropic's rotating refresh_tokens).
      const result = await fetchUsage(provider, entry, { liveFromFile: isActive });

      if (result.updatedCredentials) {
        const updated = await persistCredentials(
          provider,
          entry,
          result.updatedCredentials,
          result.source,
          isActive,
        );
        await vault.put(updated);
      }

      if (!result.refreshError) {
        await clearStale(profile.id);
      }

      const lines = renderSnapshot(result.snapshot);
      // Tag reflects *what we wrote*, not just what we read. If refresh
      // failed, the file creds are proven dead and we didn't write to
      // vault — don't claim "synced".
      const tag =
        result.source === "refresh" ? chalk.dim(tr(" (refreshed)", " (refreshed)")) :
        result.source === "file" && result.updatedCredentials ? chalk.dim(tr(" (синк из файла)", " (synced from file)")) :
        "";

      if (lines.length === 0) {
        console.log(`${head}${tag}${chalk.dim(tr("— нет данных", "— no data"))}`);
      } else {
        console.log(`${head}${lines[0]}${tag}`);
        for (const rest of lines.slice(1)) {
          console.log(`${CONT_INDENT}${rest}`);
        }
      }

      for (const err of result.errors) {
        console.log(
          chalk.dim(
            trf(`{ind}⚠ probe {url} → HTTP {status}`, `{ind}⚠ probe {url} → HTTP {status}`, {
              ind: CONT_INDENT,
              url: err.probe,
              status: err.status,
            }),
          ),
        );
      }
      if (result.refreshError) {
        const { status, error } = result.refreshError;
        if (isDeadRefreshError(status, error)) {
          await setStale(profile.id);
        }
        const detail = error ? ` (${error})` : "";
        console.log(
          chalk.yellow(
            trf(`{ind}⚠ refresh не удался → HTTP {status}{detail}`, `{ind}⚠ refresh failed → HTTP {status}{detail}`, {
              ind: CONT_INDENT,
              status,
              detail,
            }),
          ),
        );
        // Two distinct scenarios, two distinct hints:
        //   source="file": we already read from the CLI file, so grab won't
        //     help — the file's rt is dead too. Only re-auth via the CLI
        //     will mint a new one.
        //   source="vault": vault's rt is stale. If CLI file currently holds
        //     this account's fresh creds → `grab` (upsert) pulls them in
        //     without disturbing active. Otherwise user must log in via CLI
        //     with this account first.
        if (error === "invalid_grant" || error === "Refresh token not found or invalid") {
          if (result.source === "file") {
            console.log(
              chalk.dim(
                trf(
                  `{ind}  подсказка: refresh_token в CLI-файле тоже мёртв — `,
                  `{ind}  hint: the CLI file's refresh_token is also dead — `,
                  { ind: CONT_INDENT },
                ),
              ) +
              chalk.cyan(
                trf(`залогинься через {p} CLI`, `log in via the {p} CLI`, { p: profile.provider }),
              ) +
              chalk.dim(tr(` для повторной аутентификации`, ` to re-authenticate`)),
            );
          } else {
            console.log(
              chalk.dim(
                trf(
                  `{ind}  подсказка: rotating refresh_token в vault устарел — если CLI-файл {p} держит этот аккаунт, `,
                  `{ind}  hint: vault's rotating refresh_token is stale — if the {p} CLI file holds this account, `,
                  { ind: CONT_INDENT, p: profile.provider },
                ),
              ) +
              chalk.cyan(`airev ${profile.provider} grab ${profile.name}`) +
              chalk.dim(tr(` подтянет свежие creds`, ` pulls fresh creds in`)),
            );
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`${head} ${chalk.red(trf(`ошибка: {m}`, `error: {m}`, { m: msg }))}`);
    }
  }
  console.log();
}
