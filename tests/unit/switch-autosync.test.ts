import { describe, it, expect, vi, beforeEach } from "vitest";

// withProfileLock passes through — lock behaviour tested separately
vi.mock("../../src/core/lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/lock.js")>();
  return { ...actual, withProfileLock: vi.fn(async (_p: string, _n: string, fn: () => Promise<unknown>) => fn()) };
});

// ── registry mocks ────────────────────────────────────────────────────────────
const registryMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getProfileById: vi.fn(),
  getActive: vi.fn(),
  isStale: vi.fn(),
  clearStale: vi.fn(),
  setActive: vi.fn(),
  isActiveMain: vi.fn(),
}));
vi.mock("../../src/core/registry.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/core/registry.js")>("../../src/core/registry.js");
  return { ...actual, ...registryMocks };
});

// ── sync mock ─────────────────────────────────────────────────────────────────
const syncMocks = vi.hoisted(() => ({ sync: vi.fn() }));
vi.mock("../../src/commands/sync.js", () => ({
  sync: syncMocks.sync,
}));

// ── other mocks ───────────────────────────────────────────────────────────────
vi.mock("../../src/providers/loader.js", () => ({
  loadProvider: vi.fn(async () => ({ name: "codex", auth_methods: { oauth: { credential_file: { path: "/fake/.codex/auth.json" } } } })),
}));
vi.mock("../../src/vault/factory.js", () => ({
  openVault: vi.fn(async () => ({
    get: vi.fn(async () => ({ credentials: {}, grab_data: {} })),
  })),
}));
vi.mock("../../src/core/router.js", () => ({
  routeSwitch: vi.fn(async () => ({ method: "file_merge", filePath: "/fake/.codex/auth.json" })),
}));
vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return { ...actual, resolveTemplatePath: (p: string) => p };
});

vi.spyOn(console, "log").mockImplementation(() => {});

const workProfile = { id: "prof_work", name: "work", provider: "codex", auth_type: "oauth" as const, created_at: "" };
const personalProfile = { id: "prof_personal", name: "personal", provider: "codex", auth_type: "oauth" as const, created_at: "" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  registryMocks.getProfile.mockResolvedValue(personalProfile);
  registryMocks.getProfileById.mockResolvedValue(workProfile);
  registryMocks.getActive.mockResolvedValue("prof_work");
  registryMocks.isStale.mockResolvedValue(false);
  registryMocks.clearStale.mockResolvedValue(undefined);
  registryMocks.setActive.mockResolvedValue(undefined);
  registryMocks.isActiveMain.mockResolvedValue(false);
  syncMocks.sync.mockResolvedValue({ resolution: "no-op" });
});

describe("switch auto-sync", () => {
  it("запускает sync на текущем main перед переключением", async () => {
    const { switchProfile } = await import("../../src/commands/switch.js");

    await switchProfile("codex", "personal");

    // sync должен быть вызван с текущим active main (work)
    expect(syncMocks.sync).toHaveBeenCalledWith("codex", "work");
  });

  it("не вызывает sync когда переключаемся на тот же профиль", async () => {
    const { switchProfile } = await import("../../src/commands/switch.js");
    // active = work, switching to work (same)
    registryMocks.getProfile.mockResolvedValue(workProfile);

    await switchProfile("codex", "work");

    expect(syncMocks.sync).not.toHaveBeenCalled();
  });

  it("не вызывает sync когда нет active main", async () => {
    const { switchProfile } = await import("../../src/commands/switch.js");
    registryMocks.getActive.mockResolvedValue(null);

    await switchProfile("codex", "personal");

    expect(syncMocks.sync).not.toHaveBeenCalled();
  });

  it("abort если pre-sync выбрасывает identity mismatch", async () => {
    const { switchProfile } = await import("../../src/commands/switch.js");
    syncMocks.sync.mockRejectedValue(new Error("identity mismatch: acc_A vs acc_B"));

    await expect(switchProfile("codex", "personal")).rejects.toThrow(/pre-sync|switch aborted/i);
  });

  it("--force пропускает pre-sync", async () => {
    const { switchProfile } = await import("../../src/commands/switch.js");

    await switchProfile("codex", "personal", { force: true });

    expect(syncMocks.sync).not.toHaveBeenCalled();
  });
});
