import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getVaultPaths,
  keyringBackendLabel,
  normalizeVaultMigrateTarget,
} from "../../src/vault/info.js";

const platformState = vi.hoisted(() => ({
  configDir: "/tmp/airev-vault-info/ai-revolver",
  platform: "linux" as "win32" | "darwin" | "linux",
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getConfigDir: () => platformState.configDir,
    getPlatform: () => platformState.platform,
  };
});

describe("vault info", () => {
  beforeEach(() => {
    platformState.platform = "linux";
  });

  it("derives all state paths from the shared config dir", () => {
    const paths = getVaultPaths();

    expect(paths.configDir).toBe(platformState.configDir);
    expect(paths.registry).toBe(path.join(paths.configDir, "registry.json"));
    expect(paths.active).toBe(path.join(paths.configDir, "active.json"));
    expect(paths.stale).toBe(path.join(paths.configDir, "stale.json"));
    expect(paths.encryptedVault).toBe(path.join(paths.configDir, "vault.enc"));
    expect(paths.windowsDpapiVault).toBe(path.join(paths.configDir, "keyring", "vault_data.dpapi"));
  });

  it("labels known keyring backends by platform", () => {
    expect(keyringBackendLabel("win32")).toBe("Windows DPAPI");
    expect(keyringBackendLabel("darwin")).toBe("macOS Keychain");
    expect(keyringBackendLabel("linux")).toBe("Linux libsecret");
  });

  it("uses the current platform for the default keyring label", () => {
    platformState.platform = "darwin";
    expect(keyringBackendLabel()).toBe("macOS Keychain");
  });

  it("normalizes supported migrate targets", () => {
    expect(normalizeVaultMigrateTarget("keyring")).toBe("keyring");
    expect(normalizeVaultMigrateTarget("file")).toBe("file");
    expect(normalizeVaultMigrateTarget("encrypted-file")).toBe("file");
  });

  it("rejects unsupported migrate targets", () => {
    expect(normalizeVaultMigrateTarget("plaintext")).toBeNull();
    expect(normalizeVaultMigrateTarget(undefined)).toBeNull();
  });
});
