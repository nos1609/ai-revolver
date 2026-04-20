import type { VaultEntry } from "../types/index.js";

/**
 * Abstract vault store interface.
 * MVP: encrypted file. Future: OS keyring, biometric.
 */
export interface VaultStore {
  /** Store credentials for a profile */
  put(entry: VaultEntry): Promise<void>;

  /** Retrieve credentials by profile id (requires prior unlock) */
  get(profileId: string): Promise<VaultEntry | null>;

  /** Remove a profile's credentials */
  remove(profileId: string): Promise<void>;

  /** List all profile IDs in the vault */
  listIds(): Promise<string[]>;
}
