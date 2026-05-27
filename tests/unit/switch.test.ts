import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mocks for registry (the main thing we care about for the stale guard)
const registryMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  isStale: vi.fn(),
  clearStale: vi.fn(),
  setActive: vi.fn(),
}));

vi.mock("../../src/core/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/registry.js")>("../../src/core/registry.js");
  return {
    ...actual,
    getProfile: registryMocks.getProfile,
    isStale: registryMocks.isStale,
    clearStale: registryMocks.clearStale,
    setActive: registryMocks.setActive,
  };
});

// Mock heavy dependencies so we can focus on the early guard logic
vi.mock("../../src/providers/loader.js", () => ({
  loadProvider: vi.fn(async () => ({})),
}));

vi.mock("../../src/vault/factory.js", () => ({
  openVault: vi.fn(async () => ({
    get: vi.fn(async () => ({ credentials: {}, grab_data: {} })),
  })),
}));

vi.mock("../../src/core/router.js", () => ({
  routeSwitch: vi.fn(async () => ({ method: "file_merge", filePath: "~/.codex/auth.json" })),
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    resolveTemplatePath: (p: string) => p,
  };
});

import { switchProfile } from "../../src/commands/switch.js";
import { trf } from "../../src/i18n.js";

describe("switchProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("throws when profile does not exist", async () => {
    registryMocks.getProfile.mockResolvedValue(null);

    await expect(switchProfile("codex", "ghost")).rejects.toThrow(
      trf(
        `Профиль "{n}" не найден для провайдера "{p}"`,
        `Profile "{n}" not found for provider "{p}"`,
        { n: "ghost", p: "codex" },
      ),
    );
  });

  it("throws the exact stale error (ru/en) and does not proceed when profile is marked stale", async () => {
    registryMocks.getProfile.mockResolvedValue({
      id: "prof_stale_123",
      name: "work",
      provider: "codex",
      auth_type: "oauth",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    registryMocks.isStale.mockResolvedValue(true);

    const expectedStaleMsg = trf(
      `Профиль "{n}" помечен как stale. Сначала обнови его через 'airev {p} grab {n}' или перелогинься в CLI.`,
      `Profile "{n}" is marked stale. Refresh it via 'airev {p} grab {n}' or re-authenticate in the CLI first.`,
      { n: "work", p: "codex" },
    );

    await expect(switchProfile("codex", "work")).rejects.toThrow(expectedStaleMsg);

    // Verify we checked stale using the profile id and did not touch vault/active
    expect(registryMocks.isStale).toHaveBeenCalledWith("prof_stale_123");
    expect(registryMocks.clearStale).not.toHaveBeenCalled();
    expect(registryMocks.setActive).not.toHaveBeenCalled();
  });

  it("clears stale and sets active on successful switch (after the guard passes)", async () => {
    registryMocks.getProfile.mockResolvedValue({
      id: "prof_ok_456",
      name: "main",
      provider: "codex",
      auth_type: "oauth",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    registryMocks.isStale.mockResolvedValue(false);

    // Should not throw
    await switchProfile("codex", "main");

    expect(registryMocks.isStale).toHaveBeenCalledWith("prof_ok_456");
    // After successful switch we clear stale (defensive) and set active
    expect(registryMocks.clearStale).toHaveBeenCalledWith("prof_ok_456");
    expect(registryMocks.setActive).toHaveBeenCalledWith("codex", "prof_ok_456");
  });
});
