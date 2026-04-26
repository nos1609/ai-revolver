import chalk from "chalk";
import { exportProfiles } from "./export.js";
import { importProfiles } from "./import.js";
import { tr, trf } from "../i18n.js";
import { openVaultBackend } from "../vault/factory.js";
import { getVaultPaths, keyringBackendLabel, normalizeVaultMigrateTarget } from "../vault/info.js";
import { KeyringVault } from "../vault/keyring-vault.js";
import { migrateVaultEntries, type VaultBackendName } from "../vault/migrate.js";
import type { VaultStore } from "../vault/store.js";

export interface VaultCommandOptions {
  plaintext?: boolean;
  replace?: boolean;
  restoreActive?: boolean;
  yes?: boolean;
  keepSource?: boolean;
  isTty?: boolean;
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
      return vaultMigrate(arg, opts);
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
  console.log(`${pathLabel("config:")} ${paths.configDir}`);
  console.log(`${pathLabel("registry:")} ${paths.registry}`);
  console.log(`${pathLabel("active:")} ${paths.active}`);
  console.log(`${pathLabel("stale:")} ${paths.stale}`);
  console.log(`${pathLabel(tr("vault-файл:", "vault file:"))} ${paths.encryptedVault}`);
  console.log(`${pathLabel(tr("DPAPI-файл:", "DPAPI file:"))} ${paths.windowsDpapiVault}`);
  console.log();
}

async function vaultStatus(): Promise<void> {
  const keyringAvailable = await KeyringVault.isAvailable();
  const backend = keyringAvailable ? "keyring" : "encrypted-file";

  console.log();
  console.log(`${statusLabel("backend:")} ${backend}`);
  if (keyringAvailable) {
    console.log(`${statusLabel(tr("провайдер:", "provider:"))} ${keyringBackendLabel()}`);
  } else {
    console.log(`${statusLabel(tr("vault-файл:", "vault file:"))} ${getVaultPaths().encryptedVault}`);
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

async function vaultMigrate(targetArg: string | undefined, opts: VaultCommandOptions): Promise<void> {
  const normalized = normalizeVaultMigrateTarget(targetArg);
  if (!normalized) {
    throw new Error(tr(
      `Использование: airev vault migrate <keyring|file>`,
      `Usage: airev vault migrate <keyring|file>`,
    ));
  }
  const target: VaultBackendName = normalized === "file" ? "encrypted-file" : "keyring";
  const source = await detectSourceBackend();
  if (source === target) {
    throw new Error(trf(
      `Source и target backend уже совпадают: {backend}`,
      `Source and target backend are already the same: {backend}`,
      { backend: source },
    ));
  }
  return vaultMigrateWithOptions(target, source, opts);
}

async function vaultMigrateWithOptions(
  target: VaultBackendName,
  source: VaultBackendName,
  opts: VaultCommandOptions,
): Promise<void> {
  const explicitCleanup = opts.yes || opts.keepSource;
  const isTty = opts.isTty ?? process.stdin.isTTY;
  if (!explicitCleanup && !isTty) {
    throw new Error(tr(
      `Non-TTY migration требует --yes или --keep-source.`,
      `Non-TTY migration requires --yes or --keep-source.`,
    ));
  }

  console.log();
  console.log(trf(
    `  Миграция vault: {source} → {target}`,
    `  Migrating vault: {source} → {target}`,
    { source, target },
  ));
  if (source === "keyring" && target === "encrypted-file") {
    console.log(chalk.yellow(tr(
      `  ⚠ vault.enc можно копировать и атаковать offline; безопасность зависит от пароля локального vault-а.`,
      `  ⚠ vault.enc is copyable and can be attacked offline; security depends on the local vault password.`,
    )));
  }
  if (source === "encrypted-file" && target === "keyring") {
    console.log(chalk.yellow(tr(
      `  ⚠ После удаления source доступ будет зависеть от OS keyring текущего пользователя.`,
      `  ⚠ After source deletion, access depends on the current user's OS keyring.`,
    )));
  }

  const sourceVault = await openVaultBackend(source, {});
  const targetVault = await openVaultBackend(target, {
    confirmNewFilePassword: target === "encrypted-file",
  });

  const cleanup = opts.yes ? "delete-source" : "keep-source";
  const report = await migrateVaultEntries({
    sourceName: source,
    targetName: target,
    source: sourceVault,
    target: targetVault,
    cleanup,
    replace: opts.replace,
  });

  console.log(chalk.green(trf(
    `  ✓ Скопировано: {copied}, проверено: {verified}, удалено из source: {deleted}`,
    `  ✓ Copied: {copied}, verified: {verified}, deleted from source: {deleted}`,
    { copied: report.copied, verified: report.verified, deleted: report.deleted },
  )));
  if (!opts.yes && !opts.keepSource && await confirmDeleteSource(source)) {
    const deleted = await deleteSourceEntries(sourceVault);
    console.log(chalk.green(trf(
      `  ✓ Удалено из source: {deleted}`,
      `  ✓ Deleted from source: {deleted}`,
      { deleted },
    )));
  } else if (!opts.yes) {
    console.log(chalk.dim(tr(
      `  Source entries оставлены.`,
      `  Source entries kept.`,
    )));
  }
  console.log();
}

async function detectSourceBackend(): Promise<VaultBackendName> {
  return await KeyringVault.isAvailable() ? "keyring" : "encrypted-file";
}

async function confirmDeleteSource(source: VaultBackendName): Promise<boolean> {
  const question = trf(
    `  Удалить source entries из {source}? [y/N] `,
    `  Delete source entries from {source}? [y/N] `,
    { source },
  );
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      const answer = data.toString().trim().toLowerCase();
      resolve(answer === "y" || answer === "yes");
    });
  });
}

async function deleteSourceEntries(source: VaultStore): Promise<number> {
  const ids = await source.listIds();
  for (const id of ids) {
    await source.remove(id);
  }
  return ids.length;
}

function pathLabel(label: string): string {
  return chalk.bold(label.padEnd(12));
}

function statusLabel(label: string): string {
  return chalk.bold(label.padEnd(11));
}
