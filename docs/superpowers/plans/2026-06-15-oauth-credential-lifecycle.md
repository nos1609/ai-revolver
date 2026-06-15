# OAuth Credential Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-agnostic credential merge guards and FS-side freshness (mtime + `last_refresh`) so sync/status heal Claude-like providers without duplicating grab diagnostics.

**Architecture:** New `src/core/credential-policy.ts` centralizes `sanitizeCredentials`, `mergeCredentials`, `computeFreshness`, and `isRefreshDegraded`. Reader/writer/grab/sync call it; status adds degraded hints after freshness works. No `expires_at` in freshness.

**Tech Stack:** TypeScript ESM, Vitest, existing provider YAML manifests.

**Spec:** `docs/superpowers/specs/2026-06-15-oauth-credential-lifecycle-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/core/credential-policy.ts` | **Create** — sanitize, merge, freshness, degraded check |
| `tests/unit/credential-policy.test.ts` | **Create** — policy unit tests |
| `src/providers/reader.ts` | Sanitize after mapping extract |
| `src/providers/writer.ts` | Extract existing creds + merge before setByPath |
| `src/commands/grab.ts` | Merge on vault.put; use `computeFreshness` + mtime |
| `src/commands/sync.ts` | FS mtime freshness; merge on push-fs-to-vault |
| `src/commands/usage.ts` | Set `last_refresh` on vault.put after persist |
| `src/commands/status.ts` | `computeFreshness` for FS ts; degraded hints |
| `tests/unit/provider-writer.test.ts` | Merge guard tests |
| `tests/unit/sync-merge.test.ts` | Claude-like mtime + poison scenarios |
| `tests/unit/status-satellite.test.ts` | Degraded hint cases |

---

### Task 1: Credential policy module

**Files:**
- Create: `src/core/credential-policy.ts`
- Create: `tests/unit/credential-policy.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/credential-policy.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  sanitizeCredentials,
  mergeCredentials,
  computeFreshness,
  isRefreshDegraded,
} from "../../src/core/credential-policy.js";

describe("credential-policy", () => {
  it("sanitizeCredentials removes empty refresh_token", () => {
    expect(sanitizeCredentials({ refresh_token: "", access_token: "a" })).toEqual({
      access_token: "a",
    });
  });

  it("mergeCredentials keeps existing refresh when incoming empty", () => {
    expect(
      mergeCredentials(
        { refresh_token: "rt_live", access_token: "old" },
        { refresh_token: "", access_token: "new" },
      ),
    ).toEqual({ refresh_token: "rt_live", access_token: "new" });
  });

  it("mergeCredentials omits refresh when both sides empty", () => {
    expect(mergeCredentials({}, { refresh_token: "" })).toEqual({});
  });

  it("mergeCredentials accepts non-empty incoming refresh rotation", () => {
    expect(
      mergeCredentials({ refresh_token: "rt_old" }, { refresh_token: "rt_new" }),
    ).toEqual({ refresh_token: "rt_new" });
  });

  it("computeFreshness prefers last_refresh over mtime", () => {
    expect(
      computeFreshness({
        grabData: { last_refresh: 2_000 },
        rawJson: {},
        fileMtimeMs: 5_000,
      }),
    ).toBe(2_000);
  });

  it("computeFreshness uses mtime when no last_refresh", () => {
    expect(
      computeFreshness({ grabData: {}, rawJson: {}, fileMtimeMs: 4_200 }),
    ).toBe(4_200);
  });

  it("computeFreshness ignores expires_at in credentials", () => {
    expect(
      computeFreshness({
        grabData: {},
        rawJson: { expires_at: 9_999_999 },
        fileMtimeMs: 100,
      }),
    ).toBe(100);
  });

  it("isRefreshDegraded true when refresh missing or empty", () => {
    expect(isRefreshDegraded({})).toBe(true);
    expect(isRefreshDegraded({ refresh_token: "" })).toBe(true);
    expect(isRefreshDegraded({ refresh_token: "rt" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test -- --run tests/unit/credential-policy.test.ts
```

Expected: module not found.

- [ ] **Step 3: Implement module**

Create `src/core/credential-policy.ts`:

```typescript
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
    if (key in out && isEmptyToken(out[key])) delete out[key];
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
  for (const [key, value] of Object.entries(clean)) {
    if (sensitive.has(key) && isEmptyToken(value) && !isEmptyToken(merged[key])) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

export function computeFreshness(ctx: {
  grabData: Record<string, unknown>;
  rawJson: Record<string, unknown>;
  fileMtimeMs: number;
}): number {
  let best = 0;
  for (const source of [ctx.grabData["last_refresh"], ctx.rawJson["last_refresh"]]) {
    if (typeof source === "number" && Number.isFinite(source)) {
      best = Math.max(best, source);
    } else if (typeof source === "string") {
      const d = Date.parse(source);
      if (Number.isFinite(d)) best = Math.max(best, d);
    }
  }
  if (Number.isFinite(ctx.fileMtimeMs)) best = Math.max(best, ctx.fileMtimeMs);
  return best;
}

export function isRefreshDegraded(creds: Record<string, unknown>): boolean {
  return isEmptyToken(sanitizeCredentials(creds).refresh_token);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test -- --run tests/unit/credential-policy.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/core/credential-policy.ts tests/unit/credential-policy.test.ts
git commit -m "feat: add universal OAuth credential policy helpers"
```

---

### Task 2: Reader sanitization

**Files:**
- Modify: `src/providers/reader.ts`
- Modify: `tests/unit/provider-reader.test.ts` (if exists) or extend credential-policy integration

- [ ] **Step 1: Add test for empty refresh_token read**

In an existing reader test file, add:

```typescript
it("treats empty refresh_token as absent on read", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "airev-reader-empty-rt-"));
  tempDirs.push(dir);
  const file = path.join(dir, "creds.json");
  await writeFile(
    file,
    JSON.stringify({
      claudeAiOauth: { accessToken: "at", refreshToken: "", expiresAt: 1 },
    }),
  );
  const result = await readCredentials({
    path: file,
    format: "json",
    mapping: {
      access_token: "claudeAiOauth.accessToken",
      refresh_token: "claudeAiOauth.refreshToken",
      expires_at: "claudeAiOauth.expiresAt",
    },
    grab_fields: [],
    permissions: 0o600,
    atomic_write: true,
    preserve_unknown_fields: true,
  });
  expect(result.credentials).toEqual({ access_token: "at", expires_at: 1 });
  expect("refresh_token" in result.credentials).toBe(false);
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Patch reader**

At end of mapping loop in `readCredentials`, before return:

```typescript
import { sanitizeCredentials } from "../core/credential-policy.js";
// ...
return {
  credentials: sanitizeCredentials(credentials),
  grab_data,
};
```

- [ ] **Step 4: Run reader tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/providers/reader.ts tests/unit/provider-reader.test.ts
git commit -m "fix: sanitize empty OAuth tokens on credential read"
```

---

### Task 3: Writer merge-on-write

**Files:**
- Modify: `src/providers/writer.ts`
- Modify: `tests/unit/provider-writer.test.ts`

- [ ] **Step 1: Add failing writer test**

```typescript
it("does not clobber non-empty refresh_token with empty incoming", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "airev-writer-merge-"));
  tempDirs.push(dir);
  const file = path.join(dir, "creds.json");
  await writeFile(
    file,
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "at_old",
        refreshToken: "rt_live",
        expiresAt: 1,
      },
    }),
  );

  await writeCredentials(
    {
      path: file,
      format: "json",
      mapping: {
        access_token: "claudeAiOauth.accessToken",
        refresh_token: "claudeAiOauth.refreshToken",
        expires_at: "claudeAiOauth.expiresAt",
      },
      grab_fields: [],
      permissions: 0o600,
      atomic_write: true,
      preserve_unknown_fields: true,
    },
    { credentials: { access_token: "at_new", refresh_token: "" }, grab_data: {} },
  );

  const written = JSON.parse(await readFile(file, "utf-8"));
  expect(written.claudeAiOauth.refreshToken).toBe("rt_live");
  expect(written.claudeAiOauth.accessToken).toBe("at_new");
});
```

- [ ] **Step 2: Run test — FAIL**

- [ ] **Step 3: Implement writer merge**

Add `getByPath` helper (or import from path module). Replace mapping write loop:

```typescript
import { mergeCredentials, sanitizeCredentials } from "../core/credential-policy.js";

function getByPath(obj: Record<string, unknown>, dotPath: string): unknown {
  let current: unknown = obj;
  for (const key of pathSegments(dotPath)) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// inside writeCredentials, after reading existing:
const existingCreds: Record<string, unknown> = {};
for (const [normKey, jsonPath] of Object.entries(credFile.mapping)) {
  const v = getByPath(existing, jsonPath);
  if (v !== undefined) existingCreds[normKey] = v;
}
const merged = mergeCredentials(existingCreds, sanitizeCredentials(data.credentials));
for (const [normKey, jsonPath] of Object.entries(credFile.mapping)) {
  if (normKey in merged) setByPath(existing, jsonPath, merged[normKey]);
}
```

Remove old loop that wrote `data.credentials` directly.

- [ ] **Step 4: Run writer tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add src/providers/writer.ts tests/unit/provider-writer.test.ts
git commit -m "fix: merge credentials on write to prevent empty refresh clobber"
```

---

### Task 4: Grab vault merge + freshness

**Files:**
- Modify: `src/commands/grab.ts`

- [ ] **Step 1: Add failing grab test** (extend `tests/unit/grab-polymorphic.test.ts` or new file)

Test: existing vault with `refresh_token: "rt_vault"`, FS read returns `refresh_token` absent (empty sanitized) → after grab --force, vault still has `rt_vault`.

- [ ] **Step 2: Patch grab vault.put**

```typescript
import { mergeCredentials, computeFreshness } from "../core/credential-policy.js";
import { stat } from "node:fs/promises";

// before vault.put in oauth path:
const existingVaultEntry = await vault.get(profile.id);
const mergedCreds = existingVaultEntry
  ? mergeCredentials(existingVaultEntry.credentials, credentials)
  : credentials;
const mtimeMs = (await stat(credPath)).mtimeMs;
const lastRefresh = computeFreshness({ grabData, rawJson, fileMtimeMs: mtimeMs });

await vault.put({
  profile_id: profile.id,
  credentials: mergedCreds,
  grab_data: grabData,
  identity: extractIdentity(provider, rawJson),
  last_refresh: lastRefresh || undefined,
});
```

Replace `extractLastRefresh` calls with `computeFreshness` + mtime; remove duplicate `extractLastRefresh` function if unused.

- [ ] **Step 3: Run grab tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/commands/grab.ts tests/unit/grab-polymorphic.test.ts
git commit -m "fix: merge vault credentials on grab and record FS mtime freshness"
```

---

### Task 5: Sync freshness + vault merge

**Files:**
- Modify: `src/commands/sync.ts`

- [ ] **Step 1: Add failing sync test**

Claude-like fixture: no `last_refresh`, FS mtime newer than vault `last_refresh` → `push-fs-to-vault`. Second case: FS empty refresh, vault good → push-fs merges, vault refresh preserved.

- [ ] **Step 2: Patch sync**

```typescript
import { stat } from "node:fs/promises";
import { mergeCredentials, computeFreshness } from "../core/credential-policy.js";

const fsMtimeMs = (await stat(fsPath)).mtimeMs;
const fsLastRefresh = computeFreshness({
  grabData: fsRead.grab_data,
  rawJson: fsRawJson,
  fileMtimeMs: fsMtimeMs,
});
```

On `push-fs-to-vault`:

```typescript
credentials: mergeCredentials(vaultEntry.credentials, fsRead.credentials),
```

Remove `extractLastRefreshFromRaw`; use shared `computeFreshness`.

- [ ] **Step 3: Run sync tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/commands/sync.ts tests/unit/sync-merge.test.ts
git commit -m "fix: sync uses mtime freshness and credential merge on FS push"
```

---

### Task 6: Usage last_refresh persist

**Files:**
- Modify: `src/commands/usage.ts`

- [ ] **Step 1: Add failing usage test** in `tests/unit/usage.test.ts`

After simulated refresh persist, vault entry should have `last_refresh` updated.

- [ ] **Step 2: Patch usage vault.put**

```typescript
let updated = await persistCredentials(...);
if (result.source === "refresh") {
  updated = { ...updated, last_refresh: Date.now() };
} else if (result.source === "file" && result.updatedCredentials) {
  updated = {
    ...updated,
    last_refresh: Math.max(entry.last_refresh ?? 0, Date.now()),
  };
}
await vault.put(updated);
```

Adjust file-source branch if file mtime is available from active profile read path.

- [ ] **Step 3: Run usage tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/commands/usage.ts tests/unit/usage.test.ts
git commit -m "fix: update vault last_refresh after usage credential persist"
```

---

### Task 7: Status freshness + degraded hints

**Files:**
- Modify: `src/commands/status.ts`
- Modify: `tests/unit/status-satellite.test.ts`

- [ ] **Step 1: Add failing status tests** for `fs-degraded`, `both-degraded`

- [ ] **Step 2: Patch status**

Replace `extractTs` with `computeFreshness` + file stat for FS side.

After identity ok, before freshness compare:

```typescript
import { isRefreshDegraded } from "../core/credential-policy.js";

const fsDegraded = isRefreshDegraded(fsRead.credentials);
const vaultDegraded = isRefreshDegraded(vaultEntry.credentials);
if (fsDegraded && vaultDegraded) sync_hint = "both-degraded";
else if (fsDegraded && !vaultDegraded) sync_hint = "fs-degraded";
else if (!fsDegraded && vaultDegraded) sync_hint = "vault-degraded";
else { /* existing freshness compare */ }
```

- [ ] **Step 3: Run status tests — PASS**

- [ ] **Step 4: Commit**

```bash
git add src/commands/status.ts tests/unit/status-satellite.test.ts
git commit -m "feat: status degraded hints and mtime-based FS freshness"
```

---

### Task 8: Full regression

- [ ] **Step 1: Run full check**

```bash
npm run check
```

Expected: all tests pass.

- [ ] **Step 2: Final commit if any fixups**

```bash
git status
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| sanitize + merge guards | 1, 2, 3, 4, 5 |
| writer explicit merge | 3 |
| no expires_at in freshness | 1 (negative test) |
| FS mtime mandatory | 4, 5, 7 |
| grab --force merge semantics | 4 |
| usage last_refresh | 6 |
| status degraded hints | 7 |
| sync/status/grab unified freshness | 4, 5, 7 |
| no grab diagnostic duplication | (no grab UX changes) |

## Out of Scope (per spec)

- `extra_files` merge guards
- keytar empty password guard
- refresh-before-switch