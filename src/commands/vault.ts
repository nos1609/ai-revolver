import chalk from "chalk";
import { exportProfiles } from "./export.js";
import { importProfiles } from "./import.js";
import { tr, trf } from "../i18n.js";
import { getVaultPaths, keyringBackendLabel, normalizeVaultMigrateTarget } from "../vault/info.js";
import { KeyringVault } from "../vault/keyring-vault.js";

export interface VaultCommandOptions {
  plaintext?: boolean;
  replace?: boolean;
  restoreActive?: boolean;
}

export async function vaultCommand(
  action: string | undefined,
  arg: string | undefined,
  opts: VaultCommandOptions = {},
): Promise<void> {
  switch (action) {
    case "path":
      return vaultPath();
    case "status":
      return vaultStatus();
    case "passwd":
      return vaultPasswd();
    case "migrate":
      return vaultMigrate(arg);
    case "export":
      return exportProfiles({ outPath: arg, plaintext: opts.plaintext });
    case "import":
      if (!arg || arg.startsWith("--")) {
        throw new Error(tr(
          `Использование: airev vault import <file> [--replace] [--restore-active]`,
          `Usage: airev vault import <file> [--replace] [--restore-active]`,
        ));
      }
      return importProfiles(arg, {
        replace: opts.replace,
        restoreActive: opts.restoreActive,
      });
    default:
      throw new Error(tr(
        `Использование: airev vault <path|status|passwd|migrate|export|import>`,
        `Usage: airev vault <path|status|passwd|migrate|export|import>`,
      ));
  }
}

async function vaultPath(): Promise<void> {
  const paths = getVaultPaths();
  console.log();
  console.log(`${chalk.bold("config:")}   ${paths.configDir}`);
  console.log(`${chalk.bold("registry:")} ${paths.registry}`);
  console.log(`${chalk.bold("active:")}   ${paths.active}`);
  console.log(`${chalk.bold("stale:")}    ${paths.stale}`);
  console.log(`${chalk.bold("file:")}     ${paths.encryptedVault}`);
  console.log(`${chalk.bold("dpapi:")}    ${paths.windowsDpapiVault}`);
  console.log();
}

async function vaultStatus(): Promise<void> {
  const keyringAvailable = await KeyringVault.isAvailable();
  const backend = keyringAvailable ? "keyring" : "encrypted-file";

  console.log();
  console.log(`${chalk.bold("backend:")} ${backend}`);
  if (keyringAvailable) {
    console.log(`${chalk.bold("provider:")} ${keyringBackendLabel()}`);
  } else {
    console.log(`${chalk.bold("file:")} ${getVaultPaths().encryptedVault}`);
  }
  console.log();
}

async function vaultPasswd(): Promise<void> {
  if (await KeyringVault.isAvailable()) {
    console.log(chalk.dim(tr(
      "  Используется OS keyring; master password airev не применяется.",
      "  OS keyring backend is active; airev master password is not used.",
    )));
    return;
  }

  console.log(chalk.yellow(tr(
    "  Смена master password для encrypted-file vault пока не реализована.",
    "  Changing the encrypted-file vault master password is not implemented yet.",
  )));
}

async function vaultMigrate(targetArg: string | undefined): Promise<void> {
  const target = normalizeVaultMigrateTarget(targetArg);
  if (!target) {
    throw new Error(tr(
      `Использование: airev vault migrate <keyring|file>`,
      `Usage: airev vault migrate <keyring|file>`,
    ));
  }

  console.log(chalk.yellow(trf(
    `  Миграция vault → {target} пока не реализована.`,
    `  Vault migration → {target} is not implemented yet.`,
    { target },
  )));
}
