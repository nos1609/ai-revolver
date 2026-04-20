import chalk from "chalk";
import { listProviders, loadProvider } from "../providers/loader.js";
import { getAllActive, listProfiles } from "../core/registry.js";
import { openVault } from "../vault/factory.js";
import { fetchUsage, persistCredentials } from "../core/usage.js";
import { tr, trf } from "../i18n.js";
import type { Profile, UsageSnapshot, UsageWindow } from "../types/index.js";

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
  const isActive = (p: Profile) => active[p.provider] === p.id;

  let matching = profiles;
  if (providerFilter) matching = matching.filter((p) => p.provider === providerFilter);
  if (profileFilter) matching = matching.filter((p) => p.name === profileFilter);

  return matching.map((p) => ({ profile: p, isActive: isActive(p) }));
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
  // Column layout mirrors `list`: marker first, then provider, then name.
  // Continuation lines align under the snapshot column (after marker + provider + name gutter).
  const CONT_INDENT = "    " + " ".repeat(10) + " " + " ".repeat(20) + " "; // 2 + marker(1) + sp + prov(10) + sp + name(20) + sp
  for (const { profile, isActive } of targets) {
    const provider = await loadProvider(profile.provider);
    const marker = isActive ? chalk.green("*") : " ";
    const head =
      `  ${marker} ${chalk.bold(profile.provider.padEnd(10))} ` +
      `${chalk.green(profile.name.padEnd(20))} `;

    if (!provider.usage) {
      console.log(`${head} ${chalk.dim(tr("— usage-probes не настроены", "— no usage probes configured"))}`);
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
