import chalk from "chalk";
import type { VaultStore } from "./store.js";
import { KeyringVault } from "./keyring-vault.js";
import { EncryptedFileVault } from "./encrypted-file.js";
import { promptExistingVaultPassword, promptNewVaultPassword } from "./prompt.js";
import { winVerifyIdentity, winVerifyAvailable } from "./keyring-win.js";
import { tr } from "../i18n.js";

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
    // Verify identity via Windows Security (Hello / PIN / password)
    if (!opts.skipVerify && await winVerifyAvailable()) {
      console.log(chalk.dim("  🔐 Requesting identity verification..."));
      const verified = await winVerifyIdentity("Confirm identity to access credentials");
      if (!verified) {
        throw new Error("Identity verification cancelled.");
      }
      console.log(chalk.dim("  🔓 Vault: verified via Windows Security"));
    } else {
      console.log(chalk.dim("  🔓 Vault: DPAPI (Windows)"));
    }
    return new KeyringVault();
  }

  // Fallback: password prompt
  console.error(chalk.dim(tr(
    "  OS keyring недоступен, fallback на пароль локального vault-а.",
    "  OS keyring unavailable, falling back to local vault password.",
  )));
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
