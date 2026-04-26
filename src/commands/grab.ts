import chalk from "chalk";
import { loadProvider } from "../providers/loader.js";
import { readCredentials } from "../providers/reader.js";
import { addProfile, clearStale, getProfile, setActive } from "../core/registry.js";
import { openVault } from "../vault/factory.js";
import { resolveTemplatePath } from "../platform/index.js";
import { fileExists } from "../platform/fs.js";
import { tr, trf } from "../i18n.js";
import type { AuthType } from "../types/index.js";

export interface GrabOptions {
  apiKey?: string;
}

export async function grab(providerName: string, profileName: string, opts: GrabOptions): Promise<void> {
  const provider = await loadProvider(providerName);

  let authType: AuthType;
  let credentials: Record<string, unknown>;
  let grabData: Record<string, unknown>;

  if (opts.apiKey) {
    authType = "api_key";
    credentials = { api_key: opts.apiKey };
    grabData = {};
    console.log(chalk.dim(tr(`  Режим: API key`, `  Mode: API key`)));
  } else {
    const oauthDef = provider.auth_methods.oauth;
    if (!oauthDef) {
      throw new Error(
        trf(`У провайдера "{p}" нет OAuth auth_method`, `Provider "{p}" has no oauth auth method`, { p: providerName }),
      );
    }

    const credPath = resolveTemplatePath(oauthDef.credential_file.path);
    console.log(chalk.dim(trf(`  Сканирую {path}...`, `  Scanning {path}...`, { path: credPath })));

    if (!(await fileExists(credPath))) {
      throw new Error(
        trf(
          `Credential-файл не найден: {path}\n  Убедись, что CLI {p} установлен и ты залогинен.`,
          `Credential file not found: {path}\n  Make sure {p} CLI is installed and you are logged in.`,
          { path: credPath, p: providerName },
        ),
      );
    }

    const result = await readCredentials(oauthDef.credential_file);
    authType = "oauth";
    credentials = result.credentials;
    grabData = result.grab_data;

    console.log(chalk.dim(trf(`  Найдено: {t}-сессия`, `  Found: {t} session`, { t: authType })));
  }

  // Upsert: if profile exists, update its vault entry in place;
  // otherwise create it. Keeps profile id stable — critical for external
  // references (exports, env-gen output) and the only way to "refresh"
  // a stale vault entry from CLI file without burning a refresh_token.
  const existing = await getProfile(profileName, providerName);

  if (existing && existing.auth_type !== authType) {
    throw new Error(
      trf(
        `Профиль "{n}" существует с auth_type="{old}", но {src} подразумевает "{new}". ` +
          `Удали профиль (drop), если действительно хочешь сменить auth_type.`,
        `Profile "{n}" exists with auth_type="{old}", but {src} implies "{new}". ` +
          `Drop the profile first if you really want to change its auth type.`,
        {
          n: profileName,
          old: existing.auth_type,
          new: authType,
          src: opts.apiKey ? "--api-key" : tr("OAuth-скан", "oauth scan"),
        },
      ),
    );
  }

  const profile = existing ?? (await addProfile(profileName, providerName, authType));

  // Store in vault — skip verification (user already proved ownership by being logged in)
  const vault = await openVault({ skipVerify: true });
  await vault.put({
    profile_id: profile.id,
    credentials,
    grab_data: grabData,
  });
  await clearStale(profile.id);

  if (existing) {
    // Update path: don't touch active — user asked to refresh creds,
    // not to reshuffle which profile is current.
    console.log(chalk.green(trf(`  ✓ "{n}" обновлён из CLI-файла`, `  ✓ Updated "{n}" from CLI file`, { n: profileName })));
  } else {
    // Create path: new profile captures the current session → it IS active.
    await setActive(providerName, profile.id);
    console.log(chalk.green(trf(`  ✓ Забран → "{n}" (active)`, `  ✓ Grabbed → "{n}" (active)`, { n: profileName })));
  }
}
