import chalk from "chalk";
import { listProfiles, getAllActive, getProfileById } from "../core/registry.js";
import { listProviders } from "../providers/loader.js";
import { tr, trf } from "../i18n.js";
import { renderTable } from "../ui/table.js";

export async function status(providerFilter?: string): Promise<void> {
  const providers = providerFilter ? [providerFilter] : await listProviders();
  const active = await getAllActive();
  const rows = [];

  console.log();

  for (const provName of providers) {
    const activeId = active[provName];
    if (!activeId) {
      rows.push({
        provider: { text: provName, color: chalk.bold },
        status: { text: tr("— не настроен", "— not configured"), color: chalk.dim },
      });
      continue;
    }

    const profile = await getProfileById(activeId);
    if (!profile) {
      rows.push({
        provider: { text: provName, color: chalk.bold },
        status: { text: tr("— профиль не найден", "— profile missing"), color: chalk.red },
      });
      continue;
    }

    rows.push({
      provider: { text: provName, color: chalk.bold },
      status: `${chalk.green(profile.name)} (${profile.auth_type})`,
    });
  }

  for (const line of renderTable(
    [
      { key: "provider", header: tr("ПРОВАЙДЕР", "PROVIDER"), min: 8, max: 16, priority: 1 },
      { key: "status", header: tr("СТАТУС", "STATUS"), min: 18, max: 80, priority: 0 },
    ],
    rows,
  )) {
    console.log(line);
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
