import path from "node:path";
import { getConfigDir } from "../platform/index.js";

/**
 * Returns the directory that holds all satellite credential files for a given
 * (provider, name) pair: `<configDir>/satellites/<provider>/<name>`.
 */
export function satelliteDir(provider: string, name: string): string {
  return path.join(getConfigDir(), "satellites", provider, name);
}

/**
 * Returns the full path to the credential file inside a satellite directory.
 * `fileName` is the basename of the provider's credential_file (e.g. "auth.json").
 */
export function satelliteCredentialPath(provider: string, name: string, fileName: string): string {
  return path.join(satelliteDir(provider, name), fileName);
}

/**
 * Returns the directory that holds all advisory lock files: `<configDir>/locks`.
 */
export function locksDir(): string {
  return path.join(getConfigDir(), "locks");
}

/**
 * Returns the path for the advisory lock file for a given (provider, name):
 * `<configDir>/locks/<provider>/<name>.lock`.
 */
export function lockPath(provider: string, name: string): string {
  return path.join(locksDir(), provider, `${name}.lock`);
}
