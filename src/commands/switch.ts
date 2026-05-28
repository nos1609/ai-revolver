import chalk from "chalk";
import { loadProvider } from "../providers/loader.js";
import { clearStale, getActive, getProfile, getProfileById, isStale, setActive } from "../core/registry.js";
import { routeSwitch } from "../core/router.js";
import { openVault } from "../vault/factory.js";
import { resolveTemplatePath } from "../platform/index.js";
import { tr, trf } from "../i18n.js";
import { sync } from "./sync.js";

export interface SwitchOpts {
  force?: boolean;
}

export async function switchProfile(
  providerName: string,
  profileName: string,
  opts: SwitchOpts = {},
): Promise<void> {
  // Auto-sync current main before overwriting (unless --force)
  if (!opts.force) {
    const activeId = await getActive(providerName);
    if (activeId) {
      const activeProfile = await getProfileById(activeId);
      if (activeProfile && activeProfile.name !== profileName) {
        await sync(providerName, activeProfile.name).catch((err: unknown) => {
          throw new Error(
            trf(
              `switch aborted: pre-sync на "{n}" завершился с ошибкой:\n  {e}`,
              `switch aborted: pre-sync on "{n}" failed:\n  {e}`,
              { n: activeProfile.name, e: String(err) },
            ),
          );
        });
      }
    }
  }

  const profile = await getProfile(profileName, providerName);
  if (!profile) {
    throw new Error(
      trf(
        `Профиль "{n}" не найден для провайдера "{p}"`,
        `Profile "{n}" not found for provider "{p}"`,
        { n: profileName, p: providerName },
      ),
    );
  }

  if (await isStale(profile.id)) {
    throw new Error(
      trf(
        `Профиль "{n}" помечен как stale. Сначала обнови его через 'airev {p} grab {n}' или перелогинься в CLI.`,
        `Profile "{n}" is marked stale. Refresh it via 'airev {p} grab {n}' or re-authenticate in the CLI first.`,
        { n: profileName, p: providerName },
      ),
    );
  }

  const provider = await loadProvider(profile.provider);

  const vault = await openVault();
  const entry = await vault.get(profile.id);
  if (!entry) {
    throw new Error(
      trf(
        `Credentials для "{n}" не найдены в vault`,
        `Credentials for "{n}" not found in vault`,
        { n: profileName },
      ),
    );
  }

  const result = await routeSwitch(
    provider,
    profile.auth_type,
    { credentials: entry.credentials, grab_data: entry.grab_data },
  );

  if (result.method === "file_merge") {
    const displayPath = resolveTemplatePath(result.filePath ?? "");
    console.log(chalk.green(trf(`  ✓ Обновлён {path}`, `  ✓ Merged {path}`, { path: displayPath })));
  } else if (result.method === "env") {
    console.log(chalk.green(tr(`  ✓ Env-переменные готовы:`, `  ✓ Env vars ready:`)));
    for (const [k, v] of Object.entries(result.envVars ?? {})) {
      console.log(chalk.dim(`    ${k}=${v.slice(0, 8)}...`));
    }
  }

  await setActive(profile.provider, profile.id);
  await clearStale(profile.id);
  console.log(chalk.green(trf(`  ✓ Активный: {p} → {n}`, `  ✓ Active: {p} → {n}`, { p: providerName, n: profileName })));
}
