import chalk from "chalk";
import { getProfile, removeProfile } from "../core/registry.js";
import { openVault } from "../vault/factory.js";
import { trf } from "../i18n.js";

export async function drop(providerName: string, profileName: string): Promise<void> {
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
  await vault.remove(profile.id);
  await removeProfile(profileName, providerName);

  console.log(
    chalk.green(
      trf(`  ✓ "{n}" удалён из {p}`, `  ✓ Dropped "{n}" from {p}`, { n: profileName, p: providerName }),
    ),
  );
}
