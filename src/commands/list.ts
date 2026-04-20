import chalk from "chalk";
import { listProfiles, getAllActive } from "../core/registry.js";
import { tr, trf } from "../i18n.js";

export async function list(providerFilter?: string): Promise<void> {
  let profiles = await listProfiles();
  const active = await getAllActive();

  if (providerFilter) {
    profiles = profiles.filter((p) => p.provider === providerFilter);
  }

  if (profiles.length === 0) {
    const hint = providerFilter
      ? trf(
          `Нет профилей для {p}. Используй \`airev {p} grab <name>\`, чтобы добавить.`,
          `No profiles for {p}. Use \`airev {p} grab <name>\` to add one.`,
          { p: providerFilter },
        )
      : tr(
          `Профилей пока нет. Используй \`airev <provider> grab <name>\`, чтобы добавить.`,
          `No profiles yet. Use \`airev <provider> grab <name>\` to add one.`,
        );
    console.log(chalk.dim(`  ${hint}`));
    return;
  }

  console.log();
  console.log(
    chalk.bold(("  " + tr("ПРОФИЛЬ", "PROFILE")).padEnd(22)) +
    chalk.bold(tr("ПРОВАЙДЕР", "PROVIDER").padEnd(12)) +
    chalk.bold(tr("AUTH", "AUTH").padEnd(12)) +
    chalk.bold(tr("СОЗДАН", "CREATED")),
  );

  for (const p of profiles) {
    const isActive = active[p.provider] === p.id;
    const marker = isActive ? chalk.green("*") : " ";
    const name = p.name.padEnd(18);
    const provider = p.provider.padEnd(12);
    const auth = p.auth_type.padEnd(12);
    const created = p.created_at.slice(0, 10);

    console.log(`  ${marker} ${name} ${provider}${auth}${created}`);
  }

  console.log();
  console.log(chalk.dim(tr("  * = active", "  * = active")));
}
