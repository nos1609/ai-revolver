import chalk from "chalk";
import { listProfiles, getAllActive, getProfileById } from "../core/registry.js";
import { listProviders } from "../providers/loader.js";
import { tr, trf } from "../i18n.js";

export async function status(providerFilter?: string): Promise<void> {
  const providers = providerFilter ? [providerFilter] : await listProviders();
  const active = await getAllActive();

  console.log();

  for (const provName of providers) {
    const activeId = active[provName];
    if (!activeId) {
      console.log(`  ${chalk.bold(provName.padEnd(10))} ${chalk.dim(tr("— не настроен", "— not configured"))}`);
      continue;
    }

    const profile = await getProfileById(activeId);
    if (!profile) {
      console.log(`  ${chalk.bold(provName.padEnd(10))} ${chalk.red(tr("— профиль не найден", "— profile missing"))}`);
      continue;
    }

    console.log(
      `  ${chalk.bold(provName.padEnd(10))} ${chalk.green(profile.name)} (${profile.auth_type})`,
    );
  }

  const totalProfiles = (await listProfiles()).length;
  console.log();
  console.log(
    chalk.dim(
      trf(
        `  профилей: {n} | провайдеров: {m}`,
        `  profiles: {n} | providers: {m}`,
        { n: totalProfiles, m: providers.length },
      ),
    ),
  );
}
