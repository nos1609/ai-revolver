import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// ── configDir isolation ───────────────────────────────────────────────────────
const configState = vi.hoisted(() => ({ configDir: "", fakeHome: "" }));
vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getConfigDir: () => configState.configDir,
    resolveTemplatePath: (p: string) => p.replace("${HOME}", configState.fakeHome),
  };
});

// ── vault mock ────────────────────────────────────────────────────────────────
const vaultStore = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../src/vault/factory.js", () => ({
  openVault: vi.fn(async () => ({
    put: vi.fn(async (entry: { profile_id: string;[k: string]: unknown }) => {
      vaultStore.set(entry.profile_id, entry);
    }),
    get: vi.fn(async (id: string) => vaultStore.get(id) ?? null),
  })),
}));

// ── registry mocks ────────────────────────────────────────────────────────────
const registryStore = vi.hoisted(() => ({
  profiles: new Map<string, unknown>(),
  active: {} as Record<string, string>,
  stale: new Set<string>(),
}));

vi.mock("../../src/core/registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/registry.js")>();
  return {
    ...actual,
    getProfile: vi.fn(async (name: string, provider: string) => {
      return [...registryStore.profiles.values()].find(
        (p: any) => p.name === name && p.provider === provider,
      ) ?? null;
    }),
    addProfile: vi.fn(async (name: string, provider: string, authType: string) => {
      const id = `prof_${name}`;
      const p = { id, name, provider, auth_type: authType, created_at: new Date().toISOString() };
      registryStore.profiles.set(id, p);
      return p;
    }),
    setActive: vi.fn(async (provider: string, id: string) => {
      registryStore.active[provider] = id;
    }),
    getActive: vi.fn(async (provider: string) => registryStore.active[provider] ?? null),
    getProfileById: vi.fn(async (id: string) => registryStore.profiles.get(id) ?? null),
    isActiveMain: vi.fn(async (provider: string, name: string) => {
      const activeId = registryStore.active[provider];
      if (!activeId) return false;
      const p: any = registryStore.profiles.get(activeId);
      return p?.name === name;
    }),
    clearStale: vi.fn(async () => {}),
    isStale: vi.fn(async () => false),
    listProfiles: vi.fn(async () => [...registryStore.profiles.values()]),
  };
});

// ── provider mock (codex with identity) ──────────────────────────────────────
const makeProvider = (authJsonPath: string) => ({
  name: "codex",
  auth_methods: {
    oauth: {
      credential_file: {
        path: authJsonPath,
        format: "json" as const,
        mapping: { access_token: "tokens.access_token", account_id: "tokens.account_id" },
        grab_fields: ["last_refresh"],
        permissions: 0o600,
        atomic_write: true,
        preserve_unknown_fields: true,
      },
      credential_secrets: [],
    },
  },
  detection: { commands: ["codex"], paths: [] },
  identity: { fields: ["tokens.account_id"], display: ["${tokens.account_id}"] },
});

vi.mock("../../src/providers/loader.js", () => ({
  loadProvider: vi.fn(async () => makeProvider(`\${HOME}/.codex/auth.json`)),
}));

vi.spyOn(console, "log").mockImplementation(() => {});

let tempRoot: string;

const T0 = 1_700_000_000_000;
const T1 = T0 + 5000;

function makeAuthJson(accountId: string, lastRefresh: number): string {
  return JSON.stringify({
    tokens: { access_token: "tok_a", account_id: accountId },
    last_refresh: lastRefresh,
  }, null, 2);
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-e2e-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  configState.fakeHome = tempRoot;
  vaultStore.clear();
  registryStore.profiles.clear();
  registryStore.active = {};
  registryStore.stale.clear();
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});

  // Create fake native auth.json
  const codexDir = path.join(tempRoot, ".codex");
  await fs.mkdir(codexDir, { recursive: true });
  await fs.writeFile(path.join(codexDir, "auth.json"), makeAuthJson("acc_A", T0));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("codex satellite E2E", () => {
  it("grab → render → sync (FS newer) → vault updated → evict", async () => {
    const { grab } = await import("../../src/commands/grab.js");
    const { render } = await import("../../src/commands/render.js");
    const { sync } = await import("../../src/commands/sync.js");
    const { evict } = await import("../../src/commands/evict.js");
    const { satelliteCredentialPath, satelliteDir } = await import("../../src/core/satellite.js");

    const satPath = satelliteCredentialPath("codex", "side1", "auth.json");

    // 1. grab "side1" — new profile, becomes active main (onboarding from native)
    await grab("codex", "side1", {});
    expect(registryStore.active["codex"]).toBe("prof_side1");

    // 2. grab "main" — another new profile from same native, main becomes active main
    //    side1 is no longer the active main → eligible for satellite
    await grab("codex", "main", {});
    expect(registryStore.active["codex"]).toBe("prof_main");

    const vaultEntry1 = vaultStore.get("prof_side1") as any;
    expect(vaultEntry1).toBeDefined();
    expect(vaultEntry1.last_refresh).toBe(T0);
    expect(vaultEntry1.identity?.["tokens.account_id"]).toBe("acc_A");

    // 3. render — materialise satellite (side1 is no longer active main)
    await render("codex", "side1");

    const satExists = await fs.stat(satPath).then(() => true).catch(() => false);
    expect(satExists).toBe(true);

    // 4. Simulate CLI rotation in satellite: write newer last_refresh, same account_id
    await fs.writeFile(satPath, makeAuthJson("acc_A", T1));

    // 5. sync — FS newer, should push FS → vault
    const result = await sync("codex", "side1");
    expect(result.resolution).toBe("push-fs-to-vault");

    const vaultEntry2 = vaultStore.get("prof_side1") as any;
    expect(vaultEntry2.last_refresh).toBe(T1);

    // 6. evict — remove satellite directory
    await evict("codex", "side1");

    const satDirGone = await fs.stat(satelliteDir("codex", "side1"))
      .then(() => false)
      .catch(() => true);
    expect(satDirGone).toBe(true);

    // Vault entry still intact
    expect(vaultStore.get("prof_side1")).toBeDefined();
  });

  it("identity guard blocks cross-account drift", async () => {
    const { grab } = await import("../../src/commands/grab.js");
    const { render } = await import("../../src/commands/render.js");
    const { sync } = await import("../../src/commands/sync.js");
    const { satelliteCredentialPath } = await import("../../src/core/satellite.js");

    // Same two-grab sequence to make side1 a satellite
    await grab("codex", "side1", {});
    await grab("codex", "main", {});
    await render("codex", "side1");

    const satPath = satelliteCredentialPath("codex", "side1", "auth.json");

    // Overwrite satellite with a different account_id
    await fs.writeFile(satPath, makeAuthJson("acc_B", T1));

    await expect(sync("codex", "side1")).rejects.toThrow(/identity mismatch/i);

    // Vault entry unchanged
    const entry = vaultStore.get("prof_side1") as any;
    expect(entry.identity?.["tokens.account_id"]).toBe("acc_A");
  });
});
