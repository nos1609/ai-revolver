import chalk from "chalk";
import { loadProvider } from "../providers/loader.js";
import { getProfile, setActive } from "../core/registry.js";
import { routeSwitch } from "../core/router.js";
import { openVault } from "../vault/factory.js";
import { resolveTemplatePath } from "../platform/index.js";
import { tr, trf } from "../i18n.js";

export async function switchProfile(providerName: string, profileName: string): Promise<void> {
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

  const provider = await loadProvider(profile.provider);

  // Unlock vault (keyring auto or password prompt)
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
  console.log(chalk.green(trf(`  ✓ Активный: {p} → {n}`, `  ✓ Active: {p} → {n}`, { p: providerName, n: profileName })));
}
