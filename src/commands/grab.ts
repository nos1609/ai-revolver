import path from "node:path";
import { stat } from "node:fs/promises";
import fs from "node:fs/promises";
import chalk from "chalk";
import { loadProvider } from "../providers/loader.js";
import { readExtraFiles } from "../providers/extra-files.js";
import { readCredentials } from "../providers/reader.js";
import { readProviderJsonFile } from "../providers/json.js";
import { addProfile, clearStale, getProfile, isActiveMain, setActive } from "../core/registry.js";
import { openVault } from "../vault/factory.js";
import { withProfileLock } from "../core/lock.js";
import { satelliteCredentialPath } from "../core/satellite.js";
import { resolveTemplatePath } from "../platform/index.js";
import { fileExists } from "../platform/fs.js";
import { tr, trf } from "../i18n.js";
import type { AuthType, ProviderDefinition } from "../types/index.js";
import { mergeCredentials, computeFreshness } from "../core/credential-policy.js";
import { extractIdentityFromRaw } from "../core/identity.js";
import { enrichClaudeGrabData } from "../providers/claude-companion.js";

export interface GrabOptions {
  apiKey?: string;
  /** Пропустить source-resolution rule 4 и читать из native */
  force?: boolean;
}

// ── Source resolution ─────────────────────────────────────

type GrabSource =
  | { kind: "native"; path: undefined }
  | { kind: "satellite"; path: string };

async function resolveGrabSource(
  provider: ProviderDefinition,
  profileName: string,
  opts: GrabOptions,
): Promise<GrabSource> {
  if (!provider.auth_methods.oauth) return { kind: "native", path: undefined };

  const credFileName = path.basename(
    resolveTemplatePath(provider.auth_methods.oauth.credential_file.path),
  );
  const satCredPath = satelliteCredentialPath(provider.name, profileName, credFileName);

  // Rule 1: сателлит существует → читаем из него
  // Но если это active main — сателлит для него быть не должен (stale state).
  // В этом случае игнорируем stale satellite и читаем из native.
  if (await fileExists(satCredPath)) {
    if (await isActiveMain(provider.name, profileName)) {
      // Stale satellite для active main: игнорируем, читаем native
      return { kind: "native", path: undefined };
    }
    return { kind: "satellite", path: satCredPath };
  }

  // Rule 2: name является active main → читаем из native
  if (await isActiveMain(provider.name, profileName)) {
    return { kind: "native", path: undefined };
  }

  // Rule 3: нет записи в registry → онбординг из native
  const existing = await getProfile(profileName, provider.name);
  if (!existing) {
    return { kind: "native", path: undefined };
  }

  // Rule 4: vault entry есть, но нет FS-локации
  if (opts.force) {
    return { kind: "native", path: undefined };
  }

  throw new Error(
    trf(
      `Нет FS-локации для "{n}"; отрендери сателлит: airev {p} render {n}`,
      `No FS location for "{n}"; render the satellite first: airev {p} render {n}`,
      { n: profileName, p: provider.name },
    ),
  );
}

// (old extractLastRefresh removed — unified via credential-policy.computeFreshness + mtime stat)

// ── Main function ─────────────────────────────────────────

export async function grab(providerName: string, profileName: string, opts: GrabOptions): Promise<void> {
  const provider = await loadProvider(providerName);

  let authType: AuthType;
  let credentials: Record<string, unknown>;
  let grabData: Record<string, unknown>;
  let rawJson: Record<string, unknown> = {};

  if (opts.apiKey) {
    // API key path — без source resolution (нет credential file)
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

    await withProfileLock(providerName, profileName, async () => {
      const source = await resolveGrabSource(provider, profileName, opts);

      const credPath = source.kind === "satellite"
        ? source.path
        : resolveTemplatePath(oauthDef.credential_file.path);

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

      const result = await readCredentials(oauthDef.credential_file, oauthDef.credential_secrets, source.path);
      authType = "oauth";
      credentials = result.credentials;
      grabData = {
        ...result.grab_data,
        // Companion files (e.g. ~/.claude.json) live only on the native main path.
        ...(source.kind === "native" ? await readExtraFiles(oauthDef.extra_files) : {}),
      };

      // Читаем сырой JSON для извлечения identity (fields — dotted paths в raw JSON).
      // Для binary-passthrough: JSON парсинг невозможен (opaque blob). Строим
      // синтетический Record, в котором каждый ключ credentials с путём "."
      // указывает на сырое содержимое файла — extractIdentityFromRaw резолвит identity.fields
      // против этого Record так же, как против распарсенного JSON для json/jsonc.
      if (oauthDef.credential_file.format === "binary-passthrough") {
        const content = await fs.readFile(credPath, "utf-8");
        rawJson = {};
        for (const [normKey, jsonPath] of Object.entries(oauthDef.credential_file.mapping)) {
          if (jsonPath === ".") rawJson[normKey] = content;
        }
      } else {
        rawJson = await readProviderJsonFile<Record<string, unknown>>(credPath, oauthDef.credential_file.format);
      }

      if (providerName === "claude") {
        let companionJson: Record<string, unknown> | undefined;
        const companionDef = oauthDef.extra_files?.[0];
        if (source.kind === "native" && companionDef) {
          const companionPath = resolveTemplatePath(companionDef.path);
          if (await fileExists(companionPath)) {
            companionJson = await readProviderJsonFile<Record<string, unknown>>(
              companionPath,
              companionDef.format,
            );
          }
        }
        grabData = enrichClaudeGrabData(grabData, rawJson, {
          profileName,
          companionJson,
        });
      }

      console.log(chalk.dim(trf(`  Найдено: {t}-сессия`, `  Found: {t} session`, { t: authType })));

      // Upsert профиля
      const existing = await getProfile(profileName, providerName);
      if (existing && existing.auth_type !== authType) {
        throw new Error(
          trf(
            `Профиль "{n}" существует с auth_type="{old}", но OAuth подразумевает "{new}". ` +
              `Удали профиль (drop), если действительно хочешь сменить auth_type.`,
            `Profile "{n}" exists with auth_type="{old}", but OAuth implies "{new}". ` +
              `Drop the profile first if you really want to change its auth type.`,
            { n: profileName, old: existing.auth_type, new: authType },
          ),
        );
      }

      const profile = existing ?? (await addProfile(profileName, providerName, authType));

      const vault = await openVault({ skipVerify: true });

      // No-op if vault already has an entry and --force was not passed.
      // Use `sync` to refresh an existing vault entry from FS; `grab` is for initial capture.
      const existingVaultEntry = await vault.get(profile.id);
      if (existingVaultEntry && !opts.force) {
        console.log(
          chalk.dim(
            trf(
              `  "{n}" уже есть в vault — для обновления используй: airev {p} sync {n}`,
              `  "{n}" already in vault — to refresh use: airev {p} sync {n}`,
              { n: profileName, p: providerName },
            ),
          ),
        );
        return;
      }

      // FS mtime + computeFreshness (supports providers without last_refresh in their files)
      let fsMtime = 0;
      try {
        const fsStat = await stat(credPath);
        fsMtime = fsStat.mtimeMs;
      } catch {
        // fallback 0 (oldest) — prod paths are guarded by fileExists; unit tests with fake paths stay back-compat
      }
      const lastRefresh = computeFreshness({
        grabData,
        rawJson,
        fileMtimeMs: fsMtime,
      });

      // Merge guard even on --force grab: empty refresh from FS never clobbers live vault copy.
      let finalCredentials = credentials;
      if (existingVaultEntry) {
        finalCredentials = mergeCredentials(existingVaultEntry.credentials, credentials);
      }

      await vault.put({
        profile_id: profile.id,
        credentials: finalCredentials,
        grab_data: grabData,
        identity: extractIdentityFromRaw(provider, rawJson),
        last_refresh: lastRefresh || undefined,
      });
      await clearStale(profile.id);

      if (existing) {
        console.log(chalk.green(trf(`  ✓ "{n}" перезаписан (--force)`, `  ✓ "{n}" overwritten (--force)`, { n: profileName })));
      } else {
        // Новый профиль забирается из native → он IS active
        await setActive(providerName, profile.id);
        console.log(chalk.green(trf(`  ✓ Забран → "{n}" (active)`, `  ✓ Grabbed → "{n}" (active)`, { n: profileName })));
      }
    });
    return; // return внутри else после lock
  }

  // API key path — нет lock (нет credential file на диске)
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
          src: "--api-key",
        },
      ),
    );
  }

  const profile = existing ?? (await addProfile(profileName, providerName, authType));
  const vault = await openVault({ skipVerify: true });
  await vault.put({
    profile_id: profile.id,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guaranteed by earlier branching in apiKey path
    credentials: credentials!,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- guaranteed by earlier branching in apiKey path
    grab_data: grabData!,
  });
  await clearStale(profile.id);

  if (existing) {
    console.log(chalk.green(trf(`  ✓ "{n}" обновлён из CLI-файла`, `  ✓ Updated "{n}" from CLI file`, { n: profileName })));
  } else {
    await setActive(providerName, profile.id);
    console.log(chalk.green(trf(`  ✓ Забран → "{n}" (active)`, `  ✓ Grabbed → "{n}" (active)`, { n: profileName })));
  }
}
