import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getByPath,
  setByPath,
  interpolate,
  applyMapExpr,
  credsEqual,
  fetchUsage,
} from "../../src/core/usage.js";
import { isDeadRefreshError, renderDuplicateDiagnostics, renderSnapshot } from "../../src/commands/usage.js";
import { LANG } from "../../src/i18n.js";
import { stripAnsi } from "../../src/ui/table.js";
import type { ProviderDefinition, VaultEntry } from "../../src/types/index.js";

// ── getByPath ────────────────────────────────────────────

describe("getByPath", () => {
  it("returns top-level value", () => {
    expect(getByPath({ a: 1 }, "a")).toBe(1);
  });
  it("returns nested value by dot path", () => {
    expect(getByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });
  it("returns undefined for missing path", () => {
    expect(getByPath({ a: {} }, "a.b.c")).toBeUndefined();
  });
  it("returns undefined when descending into null", () => {
    expect(getByPath({ a: null }, "a.b")).toBeUndefined();
  });
  it("returns undefined when descending into primitive", () => {
    expect(getByPath({ a: 5 }, "a.b")).toBeUndefined();
  });
  it("returns undefined for null root", () => {
    expect(getByPath(null, "a")).toBeUndefined();
  });
  it("preserves zero / false / empty-string values", () => {
    expect(getByPath({ a: 0 }, "a")).toBe(0);
    expect(getByPath({ a: false }, "a")).toBe(false);
    expect(getByPath({ a: "" }, "a")).toBe("");
  });
});

// ── setByPath ────────────────────────────────────────────

describe("setByPath", () => {
  it("sets top-level key", () => {
    const o: Record<string, unknown> = {};
    setByPath(o, "a", 1);
    expect(o).toEqual({ a: 1 });
  });
  it("creates intermediate objects for nested path", () => {
    const o: Record<string, unknown> = {};
    setByPath(o, "a.b.c", 42);
    expect(o).toEqual({ a: { b: { c: 42 } } });
  });
  it("replaces existing leaf value", () => {
    const o: Record<string, unknown> = { a: { b: 1 } };
    setByPath(o, "a.b", 2);
    expect(o).toEqual({ a: { b: 2 } });
  });
  it("replaces intermediate primitive with object", () => {
    const o: Record<string, unknown> = { a: 5 };
    setByPath(o, "a.b.c", 1);
    expect(o).toEqual({ a: { b: { c: 1 } } });
  });
  it("preserves sibling keys when setting nested path", () => {
    const o: Record<string, unknown> = { a: { x: "keep" } };
    setByPath(o, "a.y", "new");
    expect(o).toEqual({ a: { x: "keep", y: "new" } });
  });
});

// ── interpolate ──────────────────────────────────────────

describe("interpolate", () => {
  it("replaces ${credentials.foo} with credentials.foo", () => {
    expect(interpolate("Bearer ${credentials.access_token}", { access_token: "tok" }))
      .toBe("Bearer tok");
  });
  it("replaces multiple placeholders", () => {
    expect(interpolate("${credentials.a}-${credentials.b}", { a: "X", b: "Y" })).toBe("X-Y");
  });
  it("missing key becomes empty string", () => {
    expect(interpolate("Bearer ${credentials.access_token}", {})).toBe("Bearer ");
  });
  it("null and undefined values become empty string", () => {
    expect(interpolate("${credentials.a}", { a: null })).toBe("");
    expect(interpolate("${credentials.a}", { a: undefined })).toBe("");
  });
  it("coerces numeric values to string", () => {
    expect(interpolate("v=${credentials.n}", { n: 42 })).toBe("v=42");
  });
  it("literal string with no placeholders is returned as-is", () => {
    expect(interpolate("plain string", { a: "x" })).toBe("plain string");
  });
  it("does not interpolate non-credentials placeholders", () => {
    // Only `${credentials.X}` pattern is recognised.
    expect(interpolate("${other.a}", { a: "x" })).toBe("${other.a}");
  });
});

// ── applyMapExpr transforms ──────────────────────────────

describe("applyMapExpr", () => {
  it("plain path returns value", () => {
    expect(applyMapExpr({ a: { b: "x" } }, "a.b")).toBe("x");
  });

  it("missing path returns undefined", () => {
    expect(applyMapExpr({}, "a.b")).toBeUndefined();
  });

  describe("now_ms_plus_seconds", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("adds seconds to Date.now() in ms", () => {
      vi.setSystemTime(new Date("2026-04-20T00:00:00Z"));
      const base = Date.now();
      const result = applyMapExpr({ expires_in: 3600 }, "expires_in | now_ms_plus_seconds");
      expect(result).toBe(base + 3600 * 1000);
    });

    it("returns undefined for non-numeric value", () => {
      expect(applyMapExpr({ expires_in: "oops" }, "expires_in | now_ms_plus_seconds"))
        .toBeUndefined();
    });

    it("accepts numeric string (Number() coerces)", () => {
      vi.setSystemTime(new Date("2026-04-20T00:00:00Z"));
      const base = Date.now();
      expect(applyMapExpr({ n: "60" }, "n | now_ms_plus_seconds")).toBe(base + 60_000);
    });
  });

  describe("epoch_seconds_to_ms", () => {
    it("converts seconds to ms", () => {
      expect(applyMapExpr({ reset: 1700000000 }, "reset | epoch_seconds_to_ms"))
        .toBe(1700000000 * 1000);
    });
    it("returns undefined for non-numeric", () => {
      expect(applyMapExpr({ reset: {} }, "reset | epoch_seconds_to_ms")).toBeUndefined();
    });
  });

  describe("iso_to_ms", () => {
    it("converts ISO string to ms", () => {
      const ms = Date.parse("2026-01-01T00:00:00Z");
      expect(applyMapExpr({ t: "2026-01-01T00:00:00Z" }, "t | iso_to_ms")).toBe(ms);
    });
    it("returns undefined for invalid ISO", () => {
      expect(applyMapExpr({ t: "not a date" }, "t | iso_to_ms")).toBeUndefined();
    });
    it("returns undefined for non-string", () => {
      expect(applyMapExpr({ t: 12345 }, "t | iso_to_ms")).toBeUndefined();
    });
  });

  describe("jwt_claim", () => {
    // JWT payload { "email": "a@b.com", "sub": "u1" }
    const payload = { email: "a@b.com", sub: "u1" };
    const middle = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const jwt = `header.${middle}.sig`;

    it("extracts claim from JWT", () => {
      expect(applyMapExpr({ id_token: jwt }, "id_token | jwt_claim:email")).toBe("a@b.com");
    });

    it("returns undefined when claim not present in payload", () => {
      expect(applyMapExpr({ id_token: jwt }, "id_token | jwt_claim:missing")).toBeUndefined();
    });

    it("returns undefined on malformed JWT (single segment)", () => {
      expect(applyMapExpr({ id_token: "malformed" }, "id_token | jwt_claim:email"))
        .toBeUndefined();
    });

    it("returns undefined when source is not a string", () => {
      expect(applyMapExpr({ id_token: 123 }, "id_token | jwt_claim:email")).toBeUndefined();
    });

    it("throws when no claim arg provided", () => {
      expect(() => applyMapExpr({ id_token: jwt }, "id_token | jwt_claim")).toThrow(/claim/i);
    });
  });

  it("throws on unknown transform name", () => {
    expect(() => applyMapExpr({ a: 1 }, "a | nonsense")).toThrow(/Unknown transform/);
  });
});

// ── credsEqual ───────────────────────────────────────────

describe("credsEqual", () => {
  it("equal objects → true", () => {
    expect(credsEqual({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(true);
  });
  it("equal via different insertion order → true", () => {
    expect(credsEqual({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
  });
  it("different value → false", () => {
    expect(credsEqual({ a: 1 }, { a: 2 })).toBe(false);
  });
  it("extra key on one side → false", () => {
    expect(credsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });
  it("missing key (same length, different keys) → false", () => {
    expect(credsEqual({ a: 1 }, { b: 1 })).toBe(false);
  });
  it("empty objects → true", () => {
    expect(credsEqual({}, {})).toBe(true);
  });
  it("reference-identical types compared strictly (objects not equal by value)", () => {
    // credsEqual does shallow `!==`; nested objects are distinct refs → false.
    expect(credsEqual({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false);
  });
});

// ── snapshot rendering ──────────────────────────────────

describe("renderSnapshot", () => {
  it("always shows verified email when present", () => {
    const lines = renderSnapshot({ email: "me@example.com", plan: "plus" });

    expect(lines.map(stripAnsi)).toEqual(["me@example.com  plus"]);
  });
});

// ── duplicate usage diagnostics ─────────────────────────

describe("renderDuplicateDiagnostics", () => {
  it("reports duplicate observed emails within the same provider", () => {
    const lines = renderDuplicateDiagnostics([
      { provider: "codex", profileName: "work", email: "same@example.com" },
      { provider: "codex", profileName: "main", email: "SAME@example.com" },
    ]);

    expect(lines.map(stripAnsi)).toEqual([
      LANG === "ru" ? "  диагностика:" : "  diagnostics:",
      LANG === "ru" ? "    найден дубль аккаунта в codex:" : "    duplicate observed account in codex:",
      LANG === "ru" ? "      профили: work, main" : "      profiles: work, main",
    ]);
  });

  it("does not treat the same email across different providers as duplicate", () => {
    const lines = renderDuplicateDiagnostics([
      { provider: "codex", profileName: "work", email: "same@example.com" },
      { provider: "claude", profileName: "main", email: "same@example.com" },
    ]);

    expect(lines).toEqual([]);
  });

  it("ignores profiles without verified email", () => {
    const lines = renderDuplicateDiagnostics([
      { provider: "codex", profileName: "work" },
      { provider: "codex", profileName: "main", email: "main@example.com" },
    ]);

    expect(lines).toEqual([]);
  });
});

// ── refresh error normalization ─────────────────────────

describe("refresh error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes structured OAuth refresh errors to strings", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: "invalid_grant", message: "expired" } }),
      });
    vi.stubGlobal("fetch", fetch);

    const provider: ProviderDefinition = {
      name: "codex",
      version: 1,
      auth_methods: {
        oauth: {
          credential_file: {
            path: "unused",
            format: "json",
            mapping: {},
            grab_fields: [],
            permissions: 0o600,
            atomic_write: true,
            preserve_unknown_fields: true,
          },
          token_refresh: {
            url: "https://example.test/token",
            body: { refresh_token: "${credentials.refresh_token}" },
            update: {},
          },
        },
      },
      detection: { commands: [], paths: [] },
      usage: {
        probes: [
          {
            url: "https://example.test/usage",
            headers: { authorization: "Bearer ${credentials.access_token}" },
            map: {},
          },
        ],
      },
    };
    const entry: VaultEntry = {
      profile_id: "prof_a",
      credentials: { access_token: "dead", refresh_token: "dead" },
      grab_data: {},
    };

    const result = await fetchUsage(provider, entry);

    expect(result.refreshError?.error).toBe('{"code":"invalid_grant","message":"expired"}');
    expect(isDeadRefreshError(result.refreshError?.status ?? 0, result.refreshError?.error)).toBe(true);
  });

  it("does not throw when checking a non-string refresh error", () => {
    expect(isDeadRefreshError(400, { code: "invalid_grant" })).toBe(true);
  });

  it("treats reused refresh tokens as dead", () => {
    expect(isDeadRefreshError(401, { code: "refresh_token_reused" })).toBe(true);
  });
});

// ── provider-specific usage parsers ─────────────────────

describe("copilot usage parser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("maps GitHub Copilot internal user quota snapshots to the canonical primary window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T10:00:00Z"));
    const reset = "2026-05-01T00:00:00Z";
    const fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        quota_reset_date_utc: reset,
        quota_snapshots: {
          chat: {
            entitlement: 1000,
            remaining: 250,
            percent_remaining: 25,
          },
        },
      }),
    });
    vi.stubGlobal("fetch", fetch);

    const provider: ProviderDefinition = {
      name: "copilot",
      version: 1,
      auth_methods: {
        oauth: {
          credential_file: {
            path: "unused",
            format: "json",
            mapping: {},
            grab_fields: [],
            permissions: 0o600,
            atomic_write: true,
            preserve_unknown_fields: true,
          },
        },
      },
      detection: { commands: [], paths: [] },
      usage: {
        probes: [
          {
            url: "https://api.github.com/copilot_internal/user",
            parser: "copilot_internal_user",
            headers: { Authorization: "Bearer ${credentials.access_token}" },
            map: {},
          },
        ],
      },
    };
    const entry: VaultEntry = {
      profile_id: "copilot_a",
      credentials: { access_token: "ghu_token" },
      grab_data: {},
    };

    const result = await fetchUsage(provider, entry);

    expect(result.snapshot.primary).toEqual({
      used_percent: 75,
      resets_at: Date.parse(reset),
    });
    expect(result.errors).toEqual([]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.github.com/copilot_internal/user",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer ghu_token" }),
      }),
    );
  });
});

// ── transient usage probe errors ────────────────────────

describe("usage probe error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("marks rate-limit and overload probe failures as transient", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: false, status: 529 });
    vi.stubGlobal("fetch", fetch);

    const provider: ProviderDefinition = {
      name: "claude",
      version: 1,
      auth_methods: {
        oauth: {
          credential_file: {
            path: "unused",
            format: "json",
            mapping: {},
            grab_fields: [],
            permissions: 0o600,
            atomic_write: true,
            preserve_unknown_fields: true,
          },
        },
      },
      detection: { commands: [], paths: [] },
      usage: {
        probes: [
          { url: "https://example.test/profile", map: {} },
          { url: "https://example.test/usage", map: {} },
        ],
      },
    };

    const result = await fetchUsage(provider, {
      profile_id: "claude_a",
      credentials: { access_token: "tok" },
      grab_data: {},
    });

    expect(result.errors).toEqual([
      { probe: "https://example.test/profile", status: 429, transient: true },
      { probe: "https://example.test/usage", status: 529, transient: true },
    ]);
  });
});
