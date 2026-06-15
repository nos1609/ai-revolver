import path from "node:path";
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
import { getByPath } from "../core/usage.js";
import { tr, trf } from "../i18n.js";
import type { AuthType, ProviderDefinition } from "../types/index.js";

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

// ── Identity extraction ───────────────────────────────────

function extractIdentity(
  provider: ProviderDefinition,
  rawJson: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!provider.identity) return undefined;
  const out: Record<string, unknown> = {};
  for (const field of provider.identity.fields) {
    const v = getByPath(rawJson, field);
    if (v == null) return undefined; // identity неполная → не записываем
    out[field] = v;
  }
  return out;
}

function extractLastRefresh(
  grabData: Record<string, unknown>,
  rawJson: Record<string, unknown>,
): number | undefined {
  // Сначала из grab_data (provider явно объявил last_refresh как grab_field)
  const fromGrab = grabData["last_refresh"];
  if (typeof fromGrab === "number" && Number.isFinite(fromGrab)) return fromGrab;
  if (typeof fromGrab === "string") {
    const d = Date.parse(fromGrab);
    if (Number.isFinite(d)) return d;
  }
  // Fallback: из сырого JSON
  const fromRaw = rawJson["last_refresh"];
  if (typeof fromRaw === "number" && Number.isFinite(fromRaw)) return fromRaw;
  return undefined;
}

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

      // Читаем сырой JSON для извлечения identity (fields — dotted paths в raw JSON)
      rawJson = await readProviderJsonFile<Record<string, unknown>>(credPath, oauthDef.credential_file.format);

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

      await vault.put({
        profile_id: profile.id,
        credentials,
        grab_data: grabData,
        identity: extractIdentity(provider, rawJson),
        last_refresh: extractLastRefresh(grabData, rawJson),
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
