import { promises as fs } from "node:fs";
import chalk from "chalk";
import { isActiveMain } from "../core/registry.js";
import { withProfileLock } from "../core/lock.js";
import { satelliteDir } from "../core/satellite.js";
import { tr, trf } from "../i18n.js";

/**
 * Evict a satellite: remove its directory from
 * `~/.airev/satellites/<provider>/<name>/`.
 * The vault entry is preserved — vault remains source of truth.
 * No-op if the satellite directory does not exist.
 */
export async function evict(providerName: string, profileName: string): Promise<void> {
  await withProfileLock(providerName, profileName, async () => {
    if (await isActiveMain(providerName, profileName)) {
      throw new Error(
        trf(
          `"{n}" — active main для {p}; evict работает только с сателлитами`,
          `"{n}" is the active main for {p}; evict operates on satellites only`,
          { n: profileName, p: providerName },
        ),
      );
    }

    const dir = satelliteDir(providerName, profileName);
    try {
      await fs.rm(dir, { recursive: true, force: false });
      console.log(
        chalk.green(
          trf(`  ✓ Сателлит удалён: {p}`, `  ✓ Satellite evicted: {p}`, { p: dir }),
        ),
      );
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.log(
          chalk.dim(tr(`  Сателлит не существует — нечего удалять`, `  Satellite does not exist — nothing to remove`)),
        );
        return;
      }
      throw err;
    }
  });
}
