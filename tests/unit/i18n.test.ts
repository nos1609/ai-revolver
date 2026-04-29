import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// i18n.ts captures language at module load time (`export const LANG = detectLang()`).
// So we re-import it per test via dynamic import after resetting modules and env.

async function loadI18n(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ["AIREV_LANG", "AIREV_BILINGUAL", "LC_ALL", "LC_MESSAGES", "LANG"]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return await import("../../src/i18n.js");
}

describe("i18n", () => {
  const snapshot: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ["AIREV_LANG", "AIREV_BILINGUAL", "LC_ALL", "LC_MESSAGES", "LANG"]) {
      snapshot[k] = process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("detectLang priority", () => {
    it("AIREV_LANG=ru → ru", async () => {
      const { tr, LANG } = await loadI18n({ AIREV_LANG: "ru" });
      expect(LANG).toBe("ru");
      expect(tr("раз", "one")).toBe("раз");
    });

    it("AIREV_LANG=en → en", async () => {
      const { tr, LANG } = await loadI18n({ AIREV_LANG: "en" });
      expect(LANG).toBe("en");
      expect(tr("раз", "one")).toBe("one");
    });

    it("AIREV_LANG=ru_RU.UTF-8 (ru prefix) → ru", async () => {
      const { LANG } = await loadI18n({ AIREV_LANG: "ru_RU.UTF-8" });
      expect(LANG).toBe("ru");
    });

    it("AIREV_LANG overrides LANG", async () => {
      const { LANG } = await loadI18n({ AIREV_LANG: "en", LANG: "ru_RU.UTF-8" });
      expect(LANG).toBe("en");
    });

    it("LC_ALL takes precedence over LC_MESSAGES and LANG", async () => {
      const { LANG } = await loadI18n({
        LC_ALL: "ru_RU.UTF-8",
        LC_MESSAGES: "en_US.UTF-8",
        LANG: "en_US.UTF-8",
      });
      expect(LANG).toBe("ru");
    });

    it("LC_MESSAGES takes precedence over LANG", async () => {
      const { LANG } = await loadI18n({
        LC_MESSAGES: "ru_RU.UTF-8",
        LANG: "en_US.UTF-8",
      });
      expect(LANG).toBe("ru");
    });

    it("unknown AIREV_LANG falls through to env detection", async () => {
      const { LANG } = await loadI18n({ AIREV_LANG: "zz", LANG: "ru_RU.UTF-8" });
      expect(LANG).toBe("ru");
    });

    describe("Intl fallback (no env set)", () => {
      const origIntl = Intl.DateTimeFormat;
      afterEach(() => {
        // Restore; the beforeEach/afterEach in the outer describe handles env.
        (Intl as { DateTimeFormat: typeof Intl.DateTimeFormat }).DateTimeFormat = origIntl;
      });

      function stubIntlLocale(locale: string): void {
        // Minimal shape — detectLang() only reads resolvedOptions().locale.
        (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function () {
          return { resolvedOptions: () => ({ locale }) };
        } as unknown as typeof Intl.DateTimeFormat;
      }

      it("Intl locale 'ru-RU' → ru when no env present", async () => {
        stubIntlLocale("ru-RU");
        const { LANG } = await loadI18n({});
        expect(LANG).toBe("ru");
      });

      it("Intl locale 'RU-ru' (upper-case prefix) → ru (lowercase compare)", async () => {
        stubIntlLocale("RU-ru");
        const { LANG } = await loadI18n({});
        expect(LANG).toBe("ru");
      });

      it("Intl locale 'en-US' → en (not ru)", async () => {
        stubIntlLocale("en-US");
        const { LANG } = await loadI18n({});
        expect(LANG).toBe("en");
      });

      it("LANG=C is neutral and falls through to Intl locale", async () => {
        stubIntlLocale("ru-RU");
        const { LANG } = await loadI18n({ LANG: "C" });
        expect(LANG).toBe("ru");
      });

      it("LC_ALL=C.UTF-8 is neutral and does not mask Windows locale", async () => {
        stubIntlLocale("ru-RU");
        const { LANG } = await loadI18n({ LC_ALL: "C.UTF-8" });
        expect(LANG).toBe("ru");
      });

      it("LANG=POSIX is neutral and falls through to Intl locale", async () => {
        stubIntlLocale("ru-RU");
        const { LANG } = await loadI18n({ LANG: "POSIX" });
        expect(LANG).toBe("ru");
      });

      it("Intl throwing is caught and falls through to 'en'", async () => {
        (Intl as unknown as { DateTimeFormat: unknown }).DateTimeFormat = function () {
          throw new Error("Intl broken");
        } as unknown as typeof Intl.DateTimeFormat;
        const { LANG } = await loadI18n({});
        expect(LANG).toBe("en");
      });

      it("env wins over Intl (priority: env > Intl fallback)", async () => {
        stubIntlLocale("en-US");
        const { LANG } = await loadI18n({ LANG: "ru_RU.UTF-8" });
        expect(LANG).toBe("ru");
      });
    });
  });

  describe("tr", () => {
    it("returns ru in ru mode", async () => {
      const { tr } = await loadI18n({ AIREV_LANG: "ru" });
      expect(tr("привет", "hi")).toBe("привет");
    });

    it("returns en in en mode", async () => {
      const { tr } = await loadI18n({ AIREV_LANG: "en" });
      expect(tr("привет", "hi")).toBe("hi");
    });

    it("bilingual mode joins with ' / '", async () => {
      const { tr } = await loadI18n({ AIREV_LANG: "ru", AIREV_BILINGUAL: "1" });
      expect(tr("привет", "hi")).toBe("привет / hi");
    });

    it("AIREV_BILINGUAL != '1' is ignored", async () => {
      const { tr } = await loadI18n({ AIREV_LANG: "en", AIREV_BILINGUAL: "true" });
      expect(tr("привет", "hi")).toBe("hi");
    });
  });

  describe("trf", () => {
    it("substitutes single {name} placeholder", async () => {
      const { trf } = await loadI18n({ AIREV_LANG: "en" });
      expect(trf("привет {n}", "hi {n}", { n: "world" })).toBe("hi world");
    });

    it("substitutes multi-char placeholder names (regex must match \\w+, not \\w)", async () => {
      const { trf } = await loadI18n({ AIREV_LANG: "en" });
      expect(trf("hi {name}", "hi {name}", { name: "alice" })).toBe("hi alice");
    });

    it("substitutes multiple placeholders", async () => {
      const { trf } = await loadI18n({ AIREV_LANG: "en" });
      expect(trf("{a}+{b}", "{a}+{b}", { a: 1, b: 2 })).toBe("1+2");
    });

    it("coerces numeric values to string", async () => {
      const { trf } = await loadI18n({ AIREV_LANG: "en" });
      expect(trf("n={n}", "n={n}", { n: 42 })).toBe("n=42");
    });

    it("missing placeholder remains untouched", async () => {
      const { trf } = await loadI18n({ AIREV_LANG: "en" });
      expect(trf("hi {who}", "hi {who}", {})).toBe("hi {who}");
    });

    it("respects language selection", async () => {
      const { trf } = await loadI18n({ AIREV_LANG: "ru" });
      expect(trf("привет {n}", "hi {n}", { n: "мир" })).toBe("привет мир");
    });

    it("ignores non-placeholder braces like {  } or { 1 }", async () => {
      const { trf } = await loadI18n({ AIREV_LANG: "en" });
      // Placeholder regex is /\{(\w+)\}/ — a space or digits-only are fine,
      // but leading space / non-word chars won't match.
      expect(trf("{ a }", "{ a }", { a: "x" })).toBe("{ a }");
    });
  });
});
