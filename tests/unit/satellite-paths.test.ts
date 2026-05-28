import path from "node:path";
import { describe, it, expect, vi } from "vitest";

// ── redirect getConfigDir to a fixed test root so the test is deterministic ──
const FAKE_CONFIG = "/tmp/airev-test-config";
vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return { ...actual, getConfigDir: () => FAKE_CONFIG };
});

describe("satellite paths", () => {
  it("satelliteDir returns <configDir>/satellites/<provider>/<name>", async () => {
    const { satelliteDir } = await import("../../src/core/satellite.js");
    expect(satelliteDir("codex", "side1")).toBe(
      path.join(FAKE_CONFIG, "satellites", "codex", "side1"),
    );
  });

  it("satelliteDir rejects path traversal in name", async () => {
    const { satelliteDir } = await import("../../src/core/satellite.js");
    expect(() => satelliteDir("codex", "../../vault.enc")).toThrow(/Invalid profile name/);
    expect(() => satelliteDir("../evil", "side1")).toThrow(/Invalid provider/);
    expect(() => satelliteDir("codex", "/absolute")).toThrow(/Invalid profile name/);
  });

  it("lockPath rejects path traversal", async () => {
    const { lockPath } = await import("../../src/core/satellite.js");
    expect(() => lockPath("codex", "../../sensitive")).toThrow(/Invalid profile name/);
  });

  it("satelliteCredentialPath appends the credential filename inside satelliteDir", async () => {
    const { satelliteCredentialPath } = await import("../../src/core/satellite.js");
    expect(satelliteCredentialPath("codex", "side1", "auth.json")).toBe(
      path.join(FAKE_CONFIG, "satellites", "codex", "side1", "auth.json"),
    );
  });

  it("locksDir returns <configDir>/locks", async () => {
    const { locksDir } = await import("../../src/core/satellite.js");
    expect(locksDir()).toBe(path.join(FAKE_CONFIG, "locks"));
  });

  it("lockPath returns <configDir>/locks/<provider>/<name>.lock", async () => {
    const { lockPath } = await import("../../src/core/satellite.js");
    expect(lockPath("codex", "side1")).toBe(
      path.join(FAKE_CONFIG, "locks", "codex", "side1.lock"),
    );
  });
});
