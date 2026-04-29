import chalk from "chalk";
import type { VaultStore } from "./store.js";
import { KeyringVault } from "./keyring-vault.js";
import { EncryptedFileVault } from "./encrypted-file.js";
import { promptExistingVaultPassword, promptNewVaultPassword } from "./prompt.js";
import { winVerifyIdentity, winVerifyAvailable } from "./keyring-win.js";
import { tr, trf } from "../i18n.js";
import type { VaultBackendName } from "./migrate.js";
import { keyringBackendLabel } from "./info.js";

export interface VaultOpenOptions {
  /** Skip identity verification (e.g. for grab — user is already proving they own the session). */
  skipVerify?: boolean;
  /** Confirm password when fallback creates a new encrypted-file vault. */
  confirmNewFilePassword?: boolean;
}

/**
 * Open the vault. Cascade:
 *   1. OS keyring (DPAPI) + Windows Security verification
 *   2. Encrypted file + password prompt — fallback
 */
export async function openVault(opts: VaultOpenOptions = {}): Promise<VaultStore> {
  if (await KeyringVault.isAvailable()) {
    const keyringVault = await openKeyringVault(opts);
    const keyringIds = await keyringVault.listIds();
    if (keyringIds.length > 0 || !(await EncryptedFileVault.exists())) {
      return keyringVault;
    }

    console.error(chalk.dim(tr(
      "  OS keyring пуст, найден vault.enc; открываем локальный encrypted-file vault.",
      "  OS keyring is empty and vault.enc exists; opening the local encrypted-file vault.",
    )));
    return openEncryptedFileVault(opts);
  }

  // Fallback: password prompt
  console.error(chalk.dim(tr(
    "  OS keyring недоступен, fallback на пароль локального vault-а.",
    "  OS keyring unavailable, falling back to local vault password.",
  )));
  return openEncryptedFileVault(opts);
}

export async function openVaultBackend(
  backend: VaultBackendName,
  opts: VaultOpenOptions = {},
): Promise<VaultStore> {
  if (backend === "keyring") {
    if (!(await KeyringVault.isAvailable())) {
      throw new Error(tr("Keyring backend недоступен.", "Keyring backend unavailable."));
    }
    return openKeyringVault(opts);
  }
  return openEncryptedFileVault(opts);
}

async function openKeyringVault(opts: VaultOpenOptions): Promise<VaultStore> {
  // Verify identity via Windows Hello / PIN / biometrics.
  if (!opts.skipVerify && await winVerifyAvailable()) {
    console.log(chalk.dim(tr(
      "  🔐 Запрашиваю подтверждение через Windows Hello...",
      "  🔐 Requesting Windows Hello verification...",
    )));
    const verified = await winVerifyIdentity(tr(
      "🔑 Подтвердите доступ к хранилищу учётных данных",
      "🔑 Confirm access to the credentials vault",
    ));
    if (!verified) {
      throw new Error(tr(
        "Подтверждение Windows Hello отменено.",
        "Windows Hello verification cancelled.",
      ));
    }
    console.log(chalk.dim(tr(
      "  🔓 Vault: подтверждено через Windows Hello",
      "  🔓 Vault: verified via Windows Hello",
    )));
  } else {
    console.log(chalk.dim(trf(
      "  🔓 Vault: {backend}",
      "  🔓 Vault: {backend}",
      { backend: keyringBackendLabel() },
    )));
  }
  return new KeyringVault();
}

async function openEncryptedFileVault(opts: VaultOpenOptions): Promise<VaultStore> {
  const fileExists = await EncryptedFileVault.exists();
  const password = opts.confirmNewFilePassword && !fileExists
    ? await promptConfirmedNewVaultPassword()
    : await promptExistingVaultPassword();
  if (!password) {
    throw new Error(tr("Пароль обязателен.", "Password required."));
  }
  return new EncryptedFileVault(password);
}

async function promptConfirmedNewVaultPassword(): Promise<string> {
  const { password, confirm } = await promptNewVaultPassword();
  if (password !== confirm) {
    throw new Error(tr("Пароли локального vault-а не совпадают.", "Local vault passwords do not match."));
  }
  return password;
}
