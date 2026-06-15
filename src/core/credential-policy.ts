const DEFAULT_SENSITIVE = new Set(["refresh_token", "access_token"]);

function isEmptyToken(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

export function sanitizeCredentials(
  creds: Record<string, unknown>,
  sensitive: ReadonlySet<string> = DEFAULT_SENSITIVE,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...creds };
  for (const key of sensitive) {
    if (key in out && isEmptyToken(out[key])) {
      delete out[key];
    }
  }
  return out;
}

export function mergeCredentials(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  sensitive: ReadonlySet<string> = DEFAULT_SENSITIVE,
): Record<string, unknown> {
  const merged = { ...existing };
  const clean = sanitizeCredentials(incoming, sensitive);
  // Assign from sanitized incoming. For sensitive fields, sanitize already removed empty values,
  // so existing non-empty values from spread are preserved automatically (no clobber).
  for (const [key, value] of Object.entries(clean)) {
    merged[key] = value;
  }
  return merged;
}

export function computeFreshness(ctx: {
  grabData?: Record<string, unknown>;
  rawJson?: Record<string, unknown>;
  fileMtimeMs?: number;
}): number {
  let best = 0;
  let hasLast = false;
  const grab = ctx.grabData ?? {};
  const raw = ctx.rawJson ?? {};
  for (const source of [grab["last_refresh"], raw["last_refresh"]]) {
    if (typeof source === "number" && Number.isFinite(source)) {
      best = Math.max(best, source);
      hasLast = true;
    } else if (typeof source === "string") {
      const d = Date.parse(source);
      if (Number.isFinite(d)) {
        best = Math.max(best, d);
        hasLast = true;
      }
    }
  }
  if (!hasLast && typeof ctx.fileMtimeMs === "number" && Number.isFinite(ctx.fileMtimeMs)) {
    best = ctx.fileMtimeMs;
  }
  return best;
}

export function isRefreshDegraded(creds: Record<string, unknown>): boolean {
  const sanitized = sanitizeCredentials(creds);
  return isEmptyToken(sanitized["refresh_token"]);
}
