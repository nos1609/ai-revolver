import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getByPath,
  setByPath,
  interpolate,
  applyMapExpr,
  credsEqual,
} from "../../src/core/usage.js";

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
