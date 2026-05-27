import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Profile, RegistryData, VaultEntry } from "../../src/types/index.js";
import type { VaultStore } from "../../src/vault/store.js";

// In-memory registry + active map, replacing the FS-backed module.
// applyImport reads via loadRegistry, writes via saveRegistry, may call setActive.
const state = {
  reg: { version: 1, profiles: [] as Profile[] } as RegistryData,
  active: {} as Record<string, string>,
  clearedStale: [] as string[],
};

vi.mock("../../src/core/registry.js", async () => {
  return {
    loadRegistry: async () => state.reg,
    saveRegistry: async (r: RegistryData) => {
      state.reg = r;
    },
    listProfiles: async () => state.reg.profiles,
    getAllActive: async () => state.active,
    setActive: async (prov: string, id: string) => {
      state.active[prov] = id;
    },
    clearStale: async (id: string) => {
      state.clearedStale.push(id);
    },
  };
});

// Must be imported *after* vi.mock — vitest hoists vi.mock, but keep order clear.
import {
  parseExport,
  isEncryptedExport,
  serializeExport,
  buildExport,
  applyImport,
  ImportError,
  type ExportPayload,
  type ExportedProfile,
} from "../../src/core/export.js";

// ── Fixtures ─────────────────────────────────────────────

function makeProfile(over: Partial<Profile> = {}): Profile {
  return {
    id: over.id ?? "prof_aaa",
    name: over.name ?? "alice",
    provider: over.provider ?? "codex",
    auth_type: over.auth_type ?? "oauth",
    created_at: over.created_at ?? "2026-01-01T00:00:00.000Z",
  };
}

function makeExported(over: Partial<ExportedProfile> = {}): ExportedProfile {
  return {
    ...makeProfile(over),
    credentials: over.credentials ?? { access_token: "tok" },
    grab_data: over.grab_data ?? {},
  };
}

class MemVault implements VaultStore {
  store = new Map<string, VaultEntry>();
  async put(e: VaultEntry) { this.store.set(e.profile_id, { ...e }); }
  async get(id: string) { return this.store.get(id) ?? null; }
  async remove(id: string) { this.store.delete(id); }
  async listIds() { return [...this.store.keys()]; }
}

beforeEach(() => {
  state.reg = { version: 1, profiles: [] };
  state.active = {};
  state.clearedStale = [];
});

// ── isEncryptedExport ────────────────────────────────────

describe("isEncryptedExport", () => {
  it("true for encrypted airev_export file", () => {
    const raw = JSON.stringify({ airev_export: 1, encrypted: true, envelope: {} });
    expect(isEncryptedExport(raw)).toBe(true);
  });
  it("false for plaintext airev_export file", () => {
    const raw = JSON.stringify({ airev_export: 1, encrypted: false, payload: {} });
    expect(isEncryptedExport(raw)).toBe(false);
  });
  it("false when not an airev export (missing marker)", () => {
    expect(isEncryptedExport(JSON.stringify({ encrypted: true }))).toBe(false);
  });
  it("false when airev_export is not 1", () => {
    expect(isEncryptedExport(JSON.stringify({ airev_export: 2, encrypted: true }))).toBe(false);
  });
  it("false on invalid JSON", () => {
    expect(isEncryptedExport("not json")).toBe(false);
  });
});

// ── parseExport ──────────────────────────────────────────

describe("parseExport", () => {
  const payload: ExportPayload = {
    version: 1,
    exported_at: "2026-01-01T00:00:00.000Z",
    profiles: [makeExported()],
    active: { codex: "prof_aaa" },
  };

  it("parses plaintext export", () => {
    const raw = serializeExport(payload);
    const out = parseExport(raw);
    expect(out).toEqual(payload);
  });

  it("parses encrypted export with correct password", () => {
    const raw = serializeExport(payload, "hunter2");
    const out = parseExport(raw, "hunter2");
    expect(out).toEqual(payload);
  });

  it("throws ImportError on invalid JSON", () => {
    expect(() => parseExport("{{{")).toThrow(ImportError);
  });

  it("throws ImportError when airev_export marker missing", () => {
    expect(() => parseExport(JSON.stringify({ payload }))).toThrow(ImportError);
  });

  it("throws ImportError when encrypted and password absent", () => {
    const raw = serializeExport(payload, "pw");
    expect(() => parseExport(raw)).toThrow(/encrypted|password|пароль/i);
  });

  it("throws ImportError on wrong password", () => {
    const raw = serializeExport(payload, "right");
    expect(() => parseExport(raw, "wrong")).toThrow(ImportError);
  });
});

// ── buildExport ──────────────────────────────────────────

describe("buildExport", () => {
  it("joins profile + vault entry by id", async () => {
    state.reg.profiles = [makeProfile({ id: "prof_x", name: "x" })];
    state.active = { codex: "prof_x" };
    const vault = new MemVault();
    await vault.put({
      profile_id: "prof_x",
      credentials: { access_token: "t" },
      grab_data: { foo: "bar" },
    });

    const payload = await buildExport(vault);
    expect(payload.version).toBe(1);
    expect(payload.profiles).toHaveLength(1);
    expect(payload.profiles[0]).toMatchObject({
      id: "prof_x",
      name: "x",
      credentials: { access_token: "t" },
      grab_data: { foo: "bar" },
    });
    expect(payload.active).toEqual({ codex: "prof_x" });
  });

  it("includes profiles with no vault entry — empty credentials/grab_data", async () => {
    state.reg.profiles = [makeProfile({ id: "prof_empty" })];
    const payload = await buildExport(new MemVault());
    expect(payload.profiles[0].credentials).toEqual({});
    expect(payload.profiles[0].grab_data).toEqual({});
  });

  it("drops orphan vault entries (vault id with no matching profile)", async () => {
    const vault = new MemVault();
    await vault.put({ profile_id: "prof_orphan", credentials: {}, grab_data: {} });
    const payload = await buildExport(vault);
    expect(payload.profiles).toHaveLength(0);
  });

  it("sets exported_at to a valid ISO string", async () => {
    const payload = await buildExport(new MemVault());
    expect(Number.isFinite(Date.parse(payload.exported_at))).toBe(true);
  });
});

// ── applyImport ──────────────────────────────────────────

describe("applyImport", () => {
  const basePayload = (profiles: ExportedProfile[], active: Record<string, string> = {}): ExportPayload => ({
    version: 1,
    exported_at: "2026-01-01T00:00:00.000Z",
    profiles,
    active,
  });

  it("adds a fresh profile + writes vault + clears stale for the new id", async () => {
    const vault = new MemVault();
    const incoming = makeExported({ id: "prof_new", name: "n", credentials: { access_token: "t" } });
    const report = await applyImport(basePayload([incoming]), vault, {});
    expect(report.added).toHaveLength(1);
    expect(report.skippedConflict).toHaveLength(0);
    expect(state.reg.profiles).toHaveLength(1);
    expect(await vault.get("prof_new")).toMatchObject({ credentials: { access_token: "t" } });
    expect(state.clearedStale).toContain("prof_new");
  });

  it("skips when (name, provider) collides and replace=false", async () => {
    state.reg.profiles = [makeProfile({ id: "prof_local", name: "alice", provider: "codex" })];
    const vault = new MemVault();
    const incoming = makeExported({ id: "prof_other", name: "alice", provider: "codex" });
    const report = await applyImport(basePayload([incoming]), vault, {});
    expect(report.skippedConflict).toHaveLength(1);
    expect(report.added).toHaveLength(0);
    // Registry untouched
    expect(state.reg.profiles).toEqual([makeProfile({ id: "prof_local", name: "alice", provider: "codex" })]);
    // Vault untouched
    expect(await vault.get("prof_local")).toBeNull();
    expect(await vault.get("prof_other")).toBeNull();
    // Skipped profiles must not affect stale state — clearStale runs only after a successful write.
    expect(state.clearedStale).toEqual([]);
  });

  it("replace=true overwrites same (name, provider) but keeps LOCAL id + clears stale for it", async () => {
    state.reg.profiles = [makeProfile({ id: "prof_local", name: "alice", provider: "codex" })];
    const vault = new MemVault();
    const incoming = makeExported({
      id: "prof_incoming",
      name: "alice",
      provider: "codex",
      credentials: { access_token: "new_token" },
    });
    const report = await applyImport(basePayload([incoming]), vault, { replace: true });
    expect(report.replaced).toHaveLength(1);
    expect(report.added).toHaveLength(0);
    // id stability — local id preserved
    expect(state.reg.profiles[0].id).toBe("prof_local");
    // vault written under the LOCAL id, not incoming id
    expect(await vault.get("prof_local")).toMatchObject({ credentials: { access_token: "new_token" } });
    expect(await vault.get("prof_incoming")).toBeNull();
    // Keeping the local id means stale state attached to that id must be cleared too.
    expect(state.clearedStale).toContain("prof_local");
  });

  it("id collision with different name/provider is skipped (always, even with replace)", async () => {
    state.reg.profiles = [makeProfile({ id: "prof_X", name: "alice", provider: "codex" })];
    const vault = new MemVault();
    const incoming = makeExported({ id: "prof_X", name: "bob", provider: "claude" });
    const report = await applyImport(basePayload([incoming]), vault, { replace: true });
    expect(report.skippedIdCollision).toHaveLength(1);
    expect(report.added).toHaveLength(0);
    expect(report.replaced).toHaveLength(0);
    expect(state.reg.profiles).toHaveLength(1);
    expect(state.reg.profiles[0].name).toBe("alice");
    expect(state.clearedStale).toEqual([]);
  });

  it("id collision where only provider differs → skippedIdCollision", async () => {
    state.reg.profiles = [makeProfile({ id: "prof_X", name: "alice", provider: "codex" })];
    const vault = new MemVault();
    const incoming = makeExported({ id: "prof_X", name: "alice", provider: "claude" });
    const report = await applyImport(basePayload([incoming]), vault, { replace: true });
    expect(report.skippedIdCollision).toHaveLength(1);
  });

  it("id collision where only name differs → skippedIdCollision", async () => {
    state.reg.profiles = [makeProfile({ id: "prof_X", name: "alice", provider: "codex" })];
    const vault = new MemVault();
    const incoming = makeExported({ id: "prof_X", name: "bob", provider: "codex" });
    const report = await applyImport(basePayload([incoming]), vault, { replace: true });
    expect(report.skippedIdCollision).toHaveLength(1);
  });

  it("same (name, provider, id) is treated as replace target (not id collision)", async () => {
    // This is the normal re-import case: exporting then importing the same
    // registry should replace cleanly, NOT trigger id collision.
    state.reg.profiles = [makeProfile({ id: "prof_X", name: "alice", provider: "codex" })];
    const vault = new MemVault();
    const incoming = makeExported({
      id: "prof_X",
      name: "alice",
      provider: "codex",
      credentials: { access_token: "updated" },
    });
    const report = await applyImport(basePayload([incoming]), vault, { replace: true });
    expect(report.skippedIdCollision).toHaveLength(0);
    expect(report.replaced).toHaveLength(1);
    expect(await vault.get("prof_X")).toMatchObject({ credentials: { access_token: "updated" } });
  });

  it("restoreActive only applies entries whose id ended up in registry", async () => {
    const vault = new MemVault();
    const p1 = makeExported({ id: "prof_1", name: "a", provider: "codex" });
    const p2 = makeExported({ id: "prof_2", name: "b", provider: "claude" });
    const active = { codex: "prof_1", claude: "prof_2", ghost: "prof_missing" };
    const report = await applyImport(basePayload([p1, p2], active), vault, { restoreActive: true });
    expect(report.activeApplied).toEqual({ codex: "prof_1", claude: "prof_2" });
    expect(state.active).toEqual({ codex: "prof_1", claude: "prof_2" });
  });

  it("without restoreActive active map is not touched", async () => {
    state.active = { codex: "prof_preexisting" };
    const vault = new MemVault();
    const incoming = makeExported({ id: "prof_new" });
    await applyImport(basePayload([incoming], { codex: "prof_new" }), vault, {});
    expect(state.active).toEqual({ codex: "prof_preexisting" });
  });

  it("empty credentials are preserved (profile exported without secrets)", async () => {
    const vault = new MemVault();
    const incoming = makeExported({ id: "prof_empty", credentials: {}, grab_data: {} });
    await applyImport(basePayload([incoming]), vault, {});
    const entry = await vault.get("prof_empty");
    expect(entry).toMatchObject({ credentials: {}, grab_data: {} });
  });

  it("clears stale exactly once per imported id, using the kept local id under --replace", async () => {
    state.reg.profiles = [makeProfile({ id: "prof_stale_work", name: "work", provider: "codex" })];
    const vault = new MemVault();
    const incoming = makeExported({
      id: "prof_fresh_from_other_machine",
      name: "work",
      provider: "codex",
      credentials: { access_token: "live_from_export", refresh_token: "rt_live" },
    });
    const report = await applyImport(basePayload([incoming]), vault, { replace: true });
    expect(report.replaced).toHaveLength(1);
    expect(state.clearedStale).toEqual(["prof_stale_work"]);
    expect(await vault.get("prof_stale_work")).toMatchObject({
      credentials: { access_token: "live_from_export" },
    });
  });
});
