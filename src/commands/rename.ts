import chalk from "chalk";
import { renameProfile } from "../core/registry.js";
import { trf } from "../i18n.js";

/**
 * Rename a profile within a provider.
 * Only touches registry.json — vault keys by profile_id, active-map by id,
 * CLI credential files don't know about our name — so no cascade writes.
 */
export async function rename(
  provider: string,
  oldName: string,
  newName: string,
): Promise<void> {
  const updated = await renameProfile(provider, oldName, newName);
  console.log(
    chalk.green(
      trf(
        `  ✓ Переименован {p}: "{old}" → "{new}"`,
        `  ✓ Renamed {p}: "{old}" → "{new}"`,
        { p: provider, old: oldName, new: updated.name },
      ),
    ),
  );
}
