import path from "node:path";
import { promises as fs } from "node:fs";
import chalk from "chalk";
import { loadProvider } from "../providers/loader.js";
import { writeCredentials } from "../providers/writer.js";
import { getProfile, isActiveMain } from "../core/registry.js";
import { openVault } from "../vault/factory.js";
import { withProfileLock } from "../core/lock.js";
import { satelliteCredentialPath, satelliteDir } from "../core/satellite.js";
import { fileExists } from "../platform/fs.js";
import { resolveTemplatePath } from "../platform/index.js";
import { tr, trf } from "../i18n.js";

export interface RenderOpts {
  force?: boolean;
}

/**
 * Render a satellite: write vault credentials to
 * `~/.airev/satellites/<provider>/<name>/<credFileName>`.
 *
 * Idempotent by default — skips if the satellite credential file already exists.
 * Use `force: true` to overwrite.
 */
export async function render(
  providerName: string,
  profileName: string,
  opts: RenderOpts = {},
): Promise<void> {
  await withProfileLock(providerName, profileName, async () => {
    // Guard: satellites cannot shadow the active main
    if (await isActiveMain(providerName, profileName)) {
      throw new Error(
        trf(
          `"{n}" — текущий active main для {p}; используй airev {p} switch чтобы сменить основной профиль`,
          `"{n}" is the active main for {p}; use airev {p} switch to change the main profile`,
          { n: profileName, p: providerName },
        ),
      );
    }

    const provider = await loadProvider(providerName);
    const oauth = provider.auth_methods.oauth;
    if (!oauth) {
      throw new Error(
        trf(
          `Провайдер "{p}" не поддерживает OAuth — нет credential file для render`,
          `Provider "{p}" has no oauth — nothing to render`,
          { p: providerName },
        ),
      );
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

    const vault = await openVault();
    const entry = await vault.get(profile.id);
    if (!entry) {
      throw new Error(
        trf(
          `Credentials для "{n}" отсутствуют в vault`,
          `Credentials for "{n}" missing from vault`,
          { n: profileName },
        ),
      );
    }

    // Derive satellite credential file path from provider's native path basename
    const nativeResolved = resolveTemplatePath(oauth.credential_file.path);
    const credFileName = path.basename(nativeResolved);
    const satPath = satelliteCredentialPath(providerName, profileName, credFileName);

    // Idempotency: skip if already rendered (unless --force)
    if (!opts.force && (await fileExists(satPath))) {
      console.log(
        chalk.dim(
          trf(
            `  Сателлит уже отрисован: {p} (используй --force для перезаписи)`,
            `  Satellite already rendered: {p} (use --force to overwrite)`,
            { p: satPath },
          ),
        ),
      );
      return;
    }

    // Ensure satellite directory exists
    await fs.mkdir(satelliteDir(providerName, profileName), { recursive: true });

    await writeCredentials(
      oauth.credential_file,
      { credentials: entry.credentials, grab_data: entry.grab_data },
      oauth.credential_secrets ?? [],
      satPath,
    );

    console.log(
      chalk.green(
        trf(`  ✓ Сателлит отрисован: {p}`, `  ✓ Satellite rendered: {p}`, { p: satPath }),
      ),
    );
  });
}
