// Minimalist inline i18n for CLI output.
//
// Approach borrowed from wg-atelier (`generate_wg_configs.py::tr`): instead
// of JSON locale files and key registries, each user-facing string is
// written twice at the call site as `tr("ru text", "en text")`. Benefits:
//   - translations live next to context (no lookup by key)
//   - no drift between key registry and usage — unused strings die with
//     the code they belong to
//   - tiny runtime cost, zero external deps
//
// Language selection priority:
//   1. env `AIREV_LANG` (explicit override, for CI/scripts)
//   2. env `LANG` / `LC_ALL` / `LC_MESSAGES` (standard POSIX)
//   3. Intl default locale (as a last resort on Windows)
//   4. fall back to English if nothing matches
//
// Terminology note: domain terms (`vault`, `profile`, `refresh_token`,
// `OAuth`, `rate-limit`, `CLI`, `API key`) are kept in English even in
// Russian strings — translating them adds confusion, not clarity.

export type Lang = "ru" | "en";

function detectLang(): Lang {
  const override = process.env.AIREV_LANG;
  if (override) {
    const l = override.toLowerCase();
    if (l.startsWith("ru")) return "ru";
    if (l.startsWith("en")) return "en";
  }

  for (const fromEnv of [process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG]) {
    if (!fromEnv) continue;
    const l = fromEnv.toLowerCase();
    if (l.startsWith("ru")) return "ru";
    if (l.startsWith("en")) return "en";
    if (l === "c" || l === "c.utf-8" || l === "posix") continue;
  }

  // Windows often doesn't set LANG. Try Intl as a fallback.
  try {
    const sys = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    if (sys.startsWith("ru")) return "ru";
  } catch {
    /* ignore */
  }

  return "en";
}

export const LANG: Lang = detectLang();

// Bilingual override (borrowed from wg-atelier): when AIREV_BILINGUAL=1,
// `tr()` returns "ru / en" inline. Useful for:
//   - capturing screenshots/docs that must serve both audiences at once
//   - verifying the RU/EN pair is consistent without re-running the CLI
//     under two different locales
// Not a user-facing default — it makes output noisy.
const FORCE_BILINGUAL = process.env.AIREV_BILINGUAL === "1";

export function tr(ru: string, en: string): string {
  if (FORCE_BILINGUAL) return `${ru} / ${en}`;
  return LANG === "ru" ? ru : en;
}

/**
 * Like `tr`, but substitutes `{name}` placeholders from `vars`.
 * Placeholders must exist in both strings — mismatch is a bug caught by review.
 */
export function trf(ru: string, en: string, vars: Record<string, string | number>): string {
  const s = tr(ru, en);
  return s.replace(/\{(\w+)\}/g, (_, k: string) => {
    const hasKey = Object.prototype.hasOwnProperty.call(vars, k);
    const v = hasKey ? vars[k] : undefined;
    return v === undefined ? `{${k}}` : String(v);
  });
}
