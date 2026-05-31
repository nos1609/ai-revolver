import path from "node:path";
import { getConfigDir } from "../platform/index.js";

// ── Path segment validation ───────────────────────────────────

/**
 * Reject path segments that could escape the satellites/locks directories.
 * Throws if `segment` contains `/`, `\`, `..`, or is an absolute path.
 */
function assertSafeSegment(segment: string, label: string): void {
  if (
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("..") ||
    path.isAbsolute(segment) ||
    segment === "." ||
    segment.length === 0
  ) {
    throw new Error(
      `Invalid ${label}: "${segment}" — must be a simple name without path separators or traversal sequences`,
    );
  }
}

// ── Satellite paths ───────────────────────────────────────────

/**
 * Returns the directory that holds all satellite credential files for a given
 * (provider, name) pair: `<configDir>/satellites/<provider>/<name>`.
 */
export function satelliteDir(provider: string, name: string): string {
  assertSafeSegment(provider, "provider");
  assertSafeSegment(name, "profile name");
  return path.join(getConfigDir(), "satellites", provider, name);
}

/**
 * Returns the full path to the credential file inside a satellite directory.
 * `fileName` is the basename of the provider's credential_file (e.g. "auth.json").
 */
export function satelliteCredentialPath(provider: string, name: string, fileName: string): string {
  return path.join(satelliteDir(provider, name), fileName);
}

// ── Lock paths ────────────────────────────────────────────────

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
  assertSafeSegment(provider, "provider");
  assertSafeSegment(name, "profile name");
  return path.join(locksDir(), provider, `${name}.lock`);
}
