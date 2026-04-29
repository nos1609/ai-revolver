import chalk from "chalk";
import { getAllActive, getAllStale, listProfiles } from "../core/registry.js";
import { tr, trf } from "../i18n.js";
import { renderTable } from "../ui/table.js";

export async function list(providerFilter?: string): Promise<void> {
  let profiles = await listProfiles();
  const active = await getAllActive();
  const stale = new Set(await getAllStale());

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
  const rows = profiles.map((p) => {
    const isActive = active[p.provider] === p.id;
    const isStale = stale.has(p.id);
    return {
      active: { text: isActive ? "*" : " ", color: isActive ? chalk.green : undefined },
      name: { text: p.name, color: isStale ? chalk.yellow : undefined },
      provider: p.provider,
      auth: p.auth_type,
      created: p.created_at.slice(0, 10),
      status: { text: isStale ? "stale" : "", color: isStale ? chalk.yellow : undefined },
    };
  });

  for (const line of renderTable(
    [
      { key: "active", header: "", min: 1, max: 1, priority: 9 },
      { key: "name", header: tr("ПРОФИЛЬ", "PROFILE"), min: 10, max: 32, priority: 0 },
      { key: "provider", header: tr("ПРОВАЙДЕР", "PROVIDER"), min: 8, max: 16, priority: 1 },
      { key: "auth", header: "AUTH", min: 6, max: 10, priority: 2 },
      { key: "created", header: tr("СОЗДАН", "CREATED"), min: 10, max: 10, priority: 8 },
      { key: "status", header: tr("СТАТУС", "STATUS"), min: 6, max: 10, priority: 7 },
    ],
    rows,
  )) {
    console.log(line);
  }

  console.log();
  console.log(chalk.dim(tr("  * = active | stale = requires grab/re-auth", "  * = active | stale = requires grab/re-auth")));
}
