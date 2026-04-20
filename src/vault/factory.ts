import chalk from "chalk";
import type { VaultStore } from "./store.js";
import { KeyringVault } from "./keyring-vault.js";
import { EncryptedFileVault } from "./encrypted-file.js";
import { promptPassword } from "./prompt.js";
import { winVerifyIdentity, winVerifyAvailable } from "./keyring-win.js";

export interface VaultOpenOptions {
  /** Skip identity verification (e.g. for grab — user is already proving they own the session). */
  skipVerify?: boolean;
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
  console.error(chalk.dim("  OS keyring unavailable, falling back to master password."));
  const password = await promptPassword("  🔐 Master password: ");
  if (!password) {
    throw new Error("Password required.");
  }
  return new EncryptedFileVault(password);
}
