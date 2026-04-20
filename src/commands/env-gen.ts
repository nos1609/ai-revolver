import chalk from "chalk";
import { getAllActive, getProfileById } from "../core/registry.js";
import { loadProvider } from "../providers/loader.js";
import { openVault } from "../vault/factory.js";
import { tr } from "../i18n.js";

type Shell = "bash" | "zsh" | "fish" | "powershell";

function detectShell(): Shell {
  const shell = process.env.SHELL ?? process.env.PSModulePath ? "powershell" : "bash";
  if (shell.includes("fish")) return "fish";
  if (shell.includes("zsh")) return "zsh";
  if (process.env.PSModulePath) return "powershell";
  return "bash";
}

function formatExport(shell: Shell, key: string, value: string): string {
  switch (shell) {
    case "powershell":
      return `$env:${key} = "${value}"`;
    case "fish":
      return `set -gx ${key} "${value}"`;
    default:
      return `export ${key}="${value}"`;
  }
}

/**
 * Generate env exports for all active api_key profiles.
 * Usage: eval "$(airev env)" or airev env --shell powershell | Invoke-Expression
 */
export async function envGen(shellOverride?: string): Promise<void> {
  const shell = (shellOverride ?? detectShell()) as Shell;
  const active = await getAllActive();
  const lines: string[] = [];

  const vault = await openVault();

  for (const [provName, profileId] of Object.entries(active)) {
    const profile = await getProfileById(profileId);
    if (!profile || profile.auth_type !== "api_key") continue;

    const provider = await loadProvider(provName);
    const apiKeyDef = provider.auth_methods.api_key;
    if (!apiKeyDef) continue;

    const entry = await vault.get(profileId);
    if (!entry) continue;

    const apiKey = String(entry.credentials.api_key ?? "");

    for (const [envName, template] of Object.entries(apiKeyDef.env)) {
      lines.push(formatExport(shell, envName, template.replace("${api_key}", apiKey)));
    }

    if (apiKeyDef.env_extra) {
      for (const [envName, value] of Object.entries(apiKeyDef.env_extra)) {
        lines.push(formatExport(shell, envName, value));
      }
    }
  }

  if (lines.length === 0) {
    console.error(chalk.dim(tr("  Нет активных api_key-профилей для экспорта.", "  No active api_key profiles to export.")));
    return;
  }

  // Output to stdout (for eval)
  for (const line of lines) {
    process.stdout.write(line + "\n");
  }
}
