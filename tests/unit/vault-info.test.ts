import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getVaultPaths,
  keyringBackendLabel,
  normalizeVaultMigrateTarget,
} from "../../src/vault/info.js";

const originalAppData = process.env.APPDATA;

afterEach(() => {
  if (originalAppData === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
});

describe("vault info", () => {
  it("derives all state paths from the shared config dir", () => {
    process.env.APPDATA = "C:\\Users\\me\\AppData\\Roaming";

    const paths = getVaultPaths();

    expect(paths.configDir).toBe(path.join(process.env.APPDATA, "ai-revolver"));
    expect(paths.registry).toBe(path.join(paths.configDir, "registry.json"));
    expect(paths.active).toBe(path.join(paths.configDir, "active.json"));
    expect(paths.stale).toBe(path.join(paths.configDir, "stale.json"));
    expect(paths.encryptedVault).toBe(path.join(paths.configDir, "vault.enc"));
    expect(paths.windowsDpapiVault).toBe(path.join(paths.configDir, "keyring", "vault_data.dpapi"));
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

  it("labels known keyring backends by platform", () => {
    expect(keyringBackendLabel("win32")).toBe("Windows DPAPI");
    expect(keyringBackendLabel("darwin")).toBe("macOS Keychain");
    expect(keyringBackendLabel("linux")).toBe("Linux libsecret");
  });
});
