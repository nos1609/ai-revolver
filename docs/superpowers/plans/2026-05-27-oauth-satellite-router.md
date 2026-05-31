# OAuth satellite router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a satellite router primitive so callers can run a provider CLI (codex, claude, gemini, qwen, copilot) against any vault-stored profile other than the current main, in parallel and without disturbing the main path.

**Architecture:** Vault remains source of truth. Native paths (`~/.<provider>/`) hold the active main. Satellites live under `~/.airev/satellites/<provider>/<name>/` and contain only the credential file. Six new/extended commands: `render`, `sync`, `evict`, `status` (extended), `vault unlock`, plus refactors to `switch` and `grab`. All cross-vault/FS ops are guarded by per-(provider, name) advisory locks and an identity check (stable field, e.g. Codex `tokens.account_id`).

**Tech Stack:** TypeScript (existing project tooling — tsup build, vitest tests, stryker mutation testing). Node `fs/promises`, `proper-lockfile` (or `flock`-via-`fs`). Provider YAML schema additions parsed via existing `src/providers/loader.ts`.

**Spec:** [docs/superpowers/specs/2026-05-27-oauth-satellite-router-design.md](../specs/2026-05-27-oauth-satellite-router-design.md)
**CLI tree:** [docs/superpowers/specs/2026-05-27-oauth-satellite-router-cli-tree.md](../specs/2026-05-27-oauth-satellite-router-cli-tree.md)

---

## Task 1: Provider identity schema — types and YAML loader

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/providers/loader.ts`
- Test: `tests/unit/provider-identity.test.ts` (new)

- [ ] **Step 1: Add identity types to `src/types/index.ts`**

Append after `ProviderApiKeyMethod`:

```typescript
export interface ProviderIdentity {
  /** Credential paths (dotted) whose values define logical identity. */
  fields: string[];
  /** Human-readable expressions for identity-mismatch error messages.
   *  May reference `${grab_fields.x}` and `${credentials.x}`. */
  display: string[];
}
```

Extend `ProviderDefinition`:

```typescript
export interface ProviderDefinition {
  name: string;
  version: number;
  auth_methods: {
    oauth?: ProviderOAuthMethod;
    api_key?: ProviderApiKeyMethod;
  };
  detection: { commands: string[]; paths: string[]; };
  usage?: ProviderUsage;
  identity?: ProviderIdentity;   // ← new
}
```

- [ ] **Step 2: Write failing tests for loader**

Create `tests/unit/provider-identity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { loadProviderFromString } from "../../src/providers/loader.js";

describe("provider identity schema", () => {
  it("parses identity block when present", async () => {
    const yaml = `
name: codex
version: 1
auth_methods: { oauth: { credential_file: { path: "${HOME}/.codex/auth.json", format: json, mapping: {}, grab_fields: [], permissions: 384, atomic_write: true, preserve_unknown_fields: true } } }
detection: { commands: [codex], paths: [] }
identity:
  fields: ["tokens.account_id"]
  display: ["\${grab_fields.email}", "\${tokens.account_id}"]
`;
    const prov = await loadProviderFromString(yaml);
    expect(prov.identity?.fields).toEqual(["tokens.account_id"]);
    expect(prov.identity?.display).toHaveLength(2);
  });

  it("leaves identity undefined when absent", async () => {
    const yaml = `
name: legacy
version: 1
auth_methods: { oauth: { credential_file: { path: "${HOME}/.legacy/auth", format: json, mapping: {}, grab_fields: [], permissions: 384, atomic_write: true, preserve_unknown_fields: true } } }
detection: { commands: [legacy], paths: [] }
`;
    const prov = await loadProviderFromString(yaml);
    expect(prov.identity).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npx vitest run tests/unit/provider-identity.test.ts
```
Expected: FAIL — `loadProviderFromString` does not exist or `identity` not parsed.

- [ ] **Step 4: Implement parser**

In `src/providers/loader.ts`, add (or extract) a string-input loader `loadProviderFromString(yamlText: string): Promise<ProviderDefinition>` if not present. Parse YAML, validate optional `identity` block:
- If `identity` exists: require `fields` (non-empty array of strings) and `display` (non-empty array of strings); throw on malformed.
- If absent: leave undefined.

Follow existing validation pattern in `loader.ts` for `usage`, `detection`, etc.

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx vitest run tests/unit/provider-identity.test.ts
```
Expected: PASS for both cases.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/providers/loader.ts tests/unit/provider-identity.test.ts
git commit -m "Add identity schema to provider manifests"
```

---

## Task 2: Vault entry — identity and last_refresh fields

**Files:**
- Modify: `src/types/index.ts`
- Test: `tests/unit/vault-entry-identity.test.ts` (new)

- [ ] **Step 1: Extend `VaultEntry` in `src/types/index.ts`**

```typescript
export interface VaultEntry {
  profile_id: string;
  credentials: Record<string, unknown>;
  grab_data: Record<string, unknown>;
  /** Stable identity field values captured at write time, indexed by field path.
   *  Absent on legacy entries written before identity support. */
  identity?: Record<string, unknown>;
  /** Epoch ms of the most recent refresh known to the vault for this entry. */
  last_refresh?: number;
}
```

- [ ] **Step 2: Write failing test verifying backward-compat decoding**

`tests/unit/vault-entry-identity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { encryptedFileStore } from "../../src/vault/encrypted-file.js";  // adjust import to actual factory
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

describe("vault entry identity backward-compat", () => {
  it("loads legacy entry without identity/last_refresh", async () => {
    // Arrange: write a legacy-style vault entry without identity
    // Implementation depends on vault store API — use existing test helpers
    // from tests/unit/encrypted-file.test.ts as reference.
    const dir = mkdtempSync(path.join(tmpdir(), "airev-test-"));
    try {
      const store = await encryptedFileStore({ dir, password: "test" });
      await store.put({
        profile_id: "prof_legacy",
        credentials: { access_token: "a" },
        grab_data: {},
      });
      const got = await store.get("prof_legacy");
      expect(got?.profile_id).toBe("prof_legacy");
      expect(got?.identity).toBeUndefined();
      expect(got?.last_refresh).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips identity and last_refresh", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "airev-test-"));
    try {
      const store = await encryptedFileStore({ dir, password: "test" });
      await store.put({
        profile_id: "prof_x",
        credentials: { access_token: "a" },
        grab_data: { email: "a@b.c" },
        identity: { "tokens.account_id": "acc_123" },
        last_refresh: 1_700_000_000_000,
      });
      const got = await store.get("prof_x");
      expect(got?.identity?.["tokens.account_id"]).toBe("acc_123");
      expect(got?.last_refresh).toBe(1_700_000_000_000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run tests — expect PASS without code changes**

```bash
npx vitest run tests/unit/vault-entry-identity.test.ts
```
Expected: PASS — extending `VaultEntry` with optional fields is additive; existing encode/decode should pass them through. If FAIL, the vault encoder is stripping unknown fields — fix `src/vault/encrypted-file.ts` to preserve `identity` and `last_refresh` on serialize.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts tests/unit/vault-entry-identity.test.ts
git commit -m "Add identity and last_refresh fields to vault entries"
```

---

## Task 3: Satellite path resolver

**Files:**
- Create: `src/core/satellite.ts`
- Test: `tests/unit/satellite-paths.test.ts` (new)

- [ ] **Step 1: Write failing tests**

`tests/unit/satellite-paths.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { satelliteDir, satelliteCredentialPath, locksDir, lockPath } from "../../src/core/satellite.js";
import { getConfigDir } from "../../src/platform/index.js";
import path from "node:path";

describe("satellite paths", () => {
  it("satelliteDir returns ~/.airev/satellites/<provider>/<name>", () => {
    expect(satelliteDir("codex", "side1")).toBe(
      path.join(getConfigDir(), "satellites", "codex", "side1"),
    );
  });

  it("satelliteCredentialPath joins with credential filename from provider", () => {
    expect(satelliteCredentialPath("codex", "side1", "auth.json")).toBe(
      path.join(getConfigDir(), "satellites", "codex", "side1", "auth.json"),
    );
  });

  it("locksDir returns ~/.airev/locks", () => {
    expect(locksDir()).toBe(path.join(getConfigDir(), "locks"));
  });

  it("lockPath returns locks/<provider>/<name>.lock", () => {
    expect(lockPath("codex", "side1")).toBe(
      path.join(getConfigDir(), "locks", "codex", "side1.lock"),
    );
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/unit/satellite-paths.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/core/satellite.ts`**

```typescript
import path from "node:path";
import { getConfigDir } from "../platform/index.js";

export function satelliteDir(provider: string, name: string): string {
  return path.join(getConfigDir(), "satellites", provider, name);
}

export function satelliteCredentialPath(provider: string, name: string, fileName: string): string {
  return path.join(satelliteDir(provider, name), fileName);
}

export function locksDir(): string {
  return path.join(getConfigDir(), "locks");
}

export function lockPath(provider: string, name: string): string {
  return path.join(locksDir(), provider, `${name}.lock`);
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/unit/satellite-paths.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/satellite.ts tests/unit/satellite-paths.test.ts
git commit -m "Add satellite path resolver"
```

---

## Task 4: Advisory lock primitive

**Files:**
- Create: `src/core/lock.ts`
- Test: `tests/unit/lock.test.ts` (new)

- [ ] **Step 1: Write failing tests**

`tests/unit/lock.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { withProfileLock, isLockHeld, readLockPid, clearLock } from "../../src/core/lock.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("profile advisory lock", () => {
  it("withProfileLock runs callback exclusively", async () => {
    const seen: number[] = [];
    const run = (n: number) =>
      withProfileLock("codex", "side1", async () => {
        seen.push(n);
        await new Promise((r) => setTimeout(r, 20));
        seen.push(-n);
      });
    await Promise.all([run(1), run(2)]);
    // No interleaving: each pair (n, -n) is adjacent
    expect(seen.length).toBe(4);
    expect(seen[0]).toBe(-seen[1]);
    expect(seen[2]).toBe(-seen[3]);
  });

  it("second concurrent attempt errors with LockBusy when no-wait", async () => {
    let inner: () => void = () => {};
    const held = withProfileLock("codex", "side2", async () => {
      await new Promise<void>((r) => { inner = r; });
    });
    await new Promise((r) => setTimeout(r, 10));
    await expect(
      withProfileLock("codex", "side2", async () => {}, { wait: false }),
    ).rejects.toThrow(/lock/i);
    inner();
    await held;
  });

  it("clearLock removes lockfile", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lock-"));
    // construct a fake-locked state via the public API and then clearLock
    // (concrete arrangement depends on the lock implementation; ensure
    // isLockHeld returns false after clearLock).
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/unit/lock.test.ts
```
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/core/lock.ts`**

Use `proper-lockfile` (already widely used Node ecosystem) or roll a small `flock`-equivalent using O_EXCL on a `.lock` file containing the holder pid.

```typescript
import { promises as fs } from "node:fs";
import path from "node:path";
import { lockPath, locksDir } from "./satellite.js";

export interface LockOpts {
  /** If false, fail immediately when lock is held by another process. Default true. */
  wait?: boolean;
  /** Max time (ms) to wait when wait=true. Default 30_000. */
  timeoutMs?: number;
}

export async function withProfileLock<T>(
  provider: string,
  name: string,
  fn: () => Promise<T>,
  opts: LockOpts = {},
): Promise<T> {
  const wait = opts.wait !== false;
  const lockFile = lockPath(provider, name);
  await fs.mkdir(path.dirname(lockFile), { recursive: true });

  const deadline = Date.now() + (opts.timeoutMs ?? 30_000);
  for (;;) {
    try {
      const handle = await fs.open(lockFile, "wx", 0o600);
      await handle.write(`${process.pid}\n`);
      await handle.close();
      try {
        return await fn();
      } finally {
        await fs.unlink(lockFile).catch(() => {});
      }
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw err;
      if (!wait) {
        const pid = await readLockPid(provider, name).catch(() => null);
        throw new Error(
          `another airev operation holds the lock for ${provider}/${name}` +
          (pid ? ` (pid ${pid})` : "") +
          `\n  if no such process is running, clear with: airev vault unlock ${provider} ${name}`,
        );
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for lock ${provider}/${name}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

export async function isLockHeld(provider: string, name: string): Promise<boolean> {
  try {
    await fs.access(lockPath(provider, name));
    return true;
  } catch { return false; }
}

export async function readLockPid(provider: string, name: string): Promise<number | null> {
  try {
    const txt = await fs.readFile(lockPath(provider, name), "utf8");
    const pid = parseInt(txt.trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch { return null; }
}

export async function clearLock(provider: string, name: string): Promise<boolean> {
  try {
    await fs.unlink(lockPath(provider, name));
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/unit/lock.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/lock.ts tests/unit/lock.test.ts
git commit -m "Add per-profile advisory lock primitive"
```

---

## Task 5: `render` command — vault → satellite

**Files:**
- Create: `src/commands/render.ts`
- Test: `tests/unit/render.test.ts` (new)

- [ ] **Step 1: Write failing tests**

`tests/unit/render.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "../../src/commands/render.js";
import { satelliteCredentialPath } from "../../src/core/satellite.js";
import { promises as fs } from "node:fs";
// + setup helpers to seed vault/registry with a profile (use existing patterns from tests/unit/switch.test.ts)

describe("render", () => {
  beforeEach(async () => {/* seed a codex profile "side1" with credentials */});
  afterEach(async () => {/* cleanup tmp dirs */});

  it("creates satellite credential file from vault when none exists", async () => {
    await render("codex", "side1");
    const p = satelliteCredentialPath("codex", "side1", "auth.json");
    const stat = await fs.stat(p);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("is idempotent: no-op when satellite already present", async () => {
    await render("codex", "side1");
    const p = satelliteCredentialPath("codex", "side1", "auth.json");
    await fs.writeFile(p, "MODIFIED");           // simulate user edit
    await render("codex", "side1");               // second call
    const content = await fs.readFile(p, "utf8");
    expect(content).toBe("MODIFIED");             // not overwritten
  });

  it("overwrites with --force", async () => {
    await render("codex", "side1");
    const p = satelliteCredentialPath("codex", "side1", "auth.json");
    await fs.writeFile(p, "MODIFIED");
    await render("codex", "side1", { force: true });
    const content = await fs.readFile(p, "utf8");
    expect(content).not.toBe("MODIFIED");
  });

  it("errors when <name> is the active main for provider", async () => {
    // arrange active_main = side1
    await expect(render("codex", "side1"))
      .rejects.toThrow(/active main.*use.*switch/i);
  });

  it("errors when vault has no entry for <name>", async () => {
    await expect(render("codex", "ghost"))
      .rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
npx vitest run tests/unit/render.test.ts
```

- [ ] **Step 3: Implement `src/commands/render.ts`**

```typescript
import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { loadProvider } from "../providers/loader.js";
import { getProfile, loadActive } from "../core/registry.js";
import { openVault } from "../vault/factory.js";
import { withProfileLock } from "../core/lock.js";
import { satelliteCredentialPath, satelliteDir } from "../core/satellite.js";
import { trf } from "../i18n.js";

export interface RenderOpts { force?: boolean; }

export async function render(providerName: string, profileName: string, opts: RenderOpts = {}): Promise<void> {
  await withProfileLock(providerName, profileName, async () => {
    const provider = await loadProvider(providerName);
    const oauth = provider.auth_methods.oauth;
    if (!oauth) throw new Error(trf(`Провайдер "{p}" без OAuth — нет credential file для render`, `Provider "{p}" has no oauth — nothing to render`, { p: providerName }));

    const active = await loadActive();
    if (active.active[providerName]) {
      const activeProfile = await getProfile("", "");  // see existing helpers; resolve by id
      // load by id helper — see Task 7
      if (await isActiveMain(providerName, profileName)) {
        throw new Error(trf(`"{n}" — текущий active main для {p}; используй airev {p} switch`, `"{n}" is the active main for {p}; use airev {p} switch`, { n: profileName, p: providerName }));
      }
    }

    const profile = await getProfile(profileName, providerName);
    if (!profile) throw new Error(trf(`Профиль "{n}" не найден`, `Profile "{n}" not found`, { n: profileName }));

    const vault = await openVault();
    const entry = await vault.get(profile.id);
    if (!entry) throw new Error(trf(`Credentials для "{n}" отсутствуют в vault`, `Credentials for "{n}" missing from vault`, { n: profileName }));

    const credPath = satelliteCredentialPath(providerName, profileName, path.basename(oauth.credential_file.path));
    const exists = await fileExists(credPath);
    if (exists && !opts.force) {
      console.log(chalk.dim(trf(`  Satellite уже отрисован: {p}`, `  Satellite already rendered: {p}`, { p: credPath })));
      return;
    }

    await fs.mkdir(satelliteDir(providerName, profileName), { recursive: true });
    // Use existing writer to serialize credentials per provider format,
    // not direct JSON.stringify, so that JSONC/mapping/secrets all behave.
    await writeProviderCredentialsToPath(provider, entry, credPath);
    console.log(chalk.green(trf(`  ✓ Render: {p}`, `  ✓ Rendered: {p}`, { p: credPath })));
  });
}
```

`isActiveMain(provider, name)` helper: load registry, resolve `active[provider]` → profile id → compare name. Implement in `src/core/registry.ts` as a sibling of existing helpers.

`writeProviderCredentialsToPath` helper: wraps existing `src/providers/writer.ts` logic but writes to a given path (factor out from current writer if it currently hardcodes the credential_file.path).

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run tests/unit/render.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/commands/render.ts src/core/registry.ts src/providers/writer.ts tests/unit/render.test.ts
git commit -m "Add render command for satellite materialization"
```

---

## Task 6: `evict` command — satellite teardown

**Files:**
- Create: `src/commands/evict.ts`
- Test: `tests/unit/evict.test.ts` (new)

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { evict } from "../../src/commands/evict.js";
import { render } from "../../src/commands/render.js";
import { satelliteDir } from "../../src/core/satellite.js";
import { promises as fs } from "node:fs";

describe("evict", () => {
  it("removes satellite directory", async () => {
    await render("codex", "side1");
    await evict("codex", "side1");
    await expect(fs.stat(satelliteDir("codex", "side1"))).rejects.toThrow(/ENOENT/);
  });

  it("is no-op when satellite missing", async () => {
    await evict("codex", "ghost");                // does not throw
  });

  it("errors when <name> is active main", async () => {
    // arrange active main
    await expect(evict("codex", "side1")).rejects.toThrow(/active main/i);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run tests/unit/evict.test.ts
```

- [ ] **Step 3: Implement `src/commands/evict.ts`**

```typescript
import { promises as fs } from "node:fs";
import chalk from "chalk";
import { withProfileLock } from "../core/lock.js";
import { isActiveMain } from "../core/registry.js";
import { satelliteDir } from "../core/satellite.js";
import { trf, tr } from "../i18n.js";

export async function evict(providerName: string, profileName: string): Promise<void> {
  await withProfileLock(providerName, profileName, async () => {
    if (await isActiveMain(providerName, profileName)) {
      throw new Error(trf(`"{n}" — active main для {p}; evict работает только с сателлитами`, `"{n}" is active main for {p}; evict operates on satellites only`, { n: profileName, p: providerName }));
    }
    const dir = satelliteDir(providerName, profileName);
    try {
      await fs.rm(dir, { recursive: true, force: false });
      console.log(chalk.green(trf(`  ✓ Evicted satellite {p}`, `  ✓ Evicted satellite {p}`, { p: dir })));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        console.log(chalk.dim(tr(`  Satellite не существует — нечего удалять`, `  Satellite does not exist — nothing to remove`)));
        return;
      }
      throw err;
    }
  });
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/commands/evict.ts tests/unit/evict.test.ts
git commit -m "Add evict command to remove satellite directories"
```

---

## Task 7: `grab` — polymorphic source resolution

**Files:**
- Modify: `src/commands/grab.ts`
- Modify: `src/core/registry.ts` (add `isActiveMain`, `getProfileById`)
- Test: `tests/unit/grab-polymorphic.test.ts` (new), update existing `tests/unit/switch.test.ts` if needed

- [ ] **Step 1: Add registry helpers in `src/core/registry.ts`**

```typescript
export async function isActiveMain(providerName: string, profileName: string): Promise<boolean> {
  const active = await loadActive();
  const activeId = active.active[providerName];
  if (!activeId) return false;
  const profile = await getProfileById(activeId);
  return profile?.name === profileName;
}

export async function getProfileById(id: string): Promise<Profile | null> {
  const reg = await loadRegistry();
  return reg.profiles.find((p) => p.id === id) ?? null;
}
```

- [ ] **Step 2: Write failing tests**

`tests/unit/grab-polymorphic.test.ts`:

```typescript
describe("grab path resolution", () => {
  it("reads from satellite when satellite exists", async () => {
    // seed: render side1 → write known content into satellite/auth.json with new account_id
    // call grab side1 → vault entry should reflect satellite content, not native
  });

  it("reads from native when active_main matches name", async () => {
    // set active_main = work; native has work creds; grab work → reads native
  });

  it("falls back to native when vault has no entry and no satellite", async () => {
    // fresh state, no entries; native has work creds; grab work → onboards from native
    // and sets active_main = work
  });

  it("errors when vault has entry but no satellite and not active_main", async () => {
    // vault has side1, no satellite, active_main = work
    await expect(grab("codex", "side1", {})).rejects.toThrow(/render first/i);
  });

  it("--force reads from native overriding rule 4", async () => {
    // same as above but with --force → reads native
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

- [ ] **Step 4: Refactor `src/commands/grab.ts`**

Add a new helper that resolves source path:

```typescript
type GrabSource = { kind: "native" } | { kind: "satellite", dir: string };

async function resolveGrabSource(provider: ProviderDefinition, name: string, opts: GrabOptions): Promise<GrabSource> {
  if (await fileExists(satelliteDir(provider.name, name))) {
    return { kind: "satellite", dir: satelliteDir(provider.name, name) };
  }
  if (await isActiveMain(provider.name, name)) {
    return { kind: "native" };
  }
  const existing = await getProfile(name, provider.name);
  if (!existing) return { kind: "native" };       // onboarding
  if (opts.force) return { kind: "native" };       // --force override of rule 4
  throw new Error(trf(`Нет FS-локации для "{n}"; сделай airev {p} render {n} сначала`, `No FS location for "{n}"; run airev {p} render {n} first`, { n: name, p: provider.name }));
}
```

Wrap the body of `grab` in `withProfileLock`. Use `resolveGrabSource` to pick the credential file path. After upsert, set `active_main` only when the source was `native` and the entry is being created for the first time.

Add `identity` and `last_refresh` extraction at grab time:

```typescript
function extractIdentity(provider: ProviderDefinition, creds: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!provider.identity) return undefined;
  const out: Record<string, unknown> = {};
  for (const field of provider.identity.fields) {
    const v = getByPath({ ...creds }, field);     // existing dotted-path utility
    if (v == null) return undefined;              // identity incomplete → store nothing
    out[field] = v;
  }
  return out;
}

function extractLastRefresh(provider: ProviderDefinition, credPath: string, grabData: Record<string, unknown>): number {
  // Prefer provider-supplied last_refresh in grab_data; fallback to file mtime.
  const fromData = grabData["last_refresh"];
  if (typeof fromData === "string") {
    const d = Date.parse(fromData);
    if (Number.isFinite(d)) return d;
  } else if (typeof fromData === "number") {
    return fromData;
  }
  // mtime fallback
  return statSyncMs(credPath);
}
```

Store `identity` and `last_refresh` on vault.put.

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/commands/grab.ts src/core/registry.ts tests/unit/grab-polymorphic.test.ts
git commit -m "Make grab polymorphic over native and satellite sources; capture identity"
```

---

## Task 8: `sync` command — identity guard and freshness merge

**Files:**
- Create: `src/commands/sync.ts`
- Create: `src/core/identity.ts` (helper for identity comparison + display rendering)
- Test: `tests/unit/sync-merge.test.ts`, `tests/unit/sync-identity-guard.test.ts`

- [ ] **Step 1: Write failing tests for identity guard**

`tests/unit/sync-identity-guard.test.ts`:

```typescript
describe("sync identity guard", () => {
  it("errors when vault entry has no identity field recorded", async () => {
    // seed legacy entry without identity
    await expect(sync("codex", "side1")).rejects.toThrow(/identity.*not recorded/i);
  });

  it("errors when identity values differ between vault and FS", async () => {
    // vault.identity.account_id = acc_A; FS auth.json has tokens.account_id = acc_B
    await expect(sync("codex", "side1")).rejects.toThrow(/identity mismatch/i);
  });

  it("error message includes display values from both sides", async () => {
    try { await sync("codex", "side1"); }
    catch (e) { expect(String(e)).toMatch(/acc_A.*acc_B/s); }
  });

  it("--force --push skips identity guard and writes FS → vault", async () => {
    await sync("codex", "side1", { force: true, direction: "push" });
    // assert vault now has FS identity
  });
});
```

- [ ] **Step 2: Write failing tests for freshness merge**

`tests/unit/sync-merge.test.ts`:

```typescript
describe("sync freshness merge", () => {
  it("no-op when last_refresh equal", async () => {/* ... */});
  it("pushes FS → vault when FS newer", async () => {/* ... */});
  it("pushes vault → FS when vault newer", async () => {/* ... */});
  it("--dry-run reports direction without writing", async () => {
    const report = await sync("codex", "side1", { dryRun: true });
    expect(report.resolution).toBe("push-fs-to-vault");
    // FS file mtime unchanged, vault entry unchanged
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
npx vitest run tests/unit/sync-identity-guard.test.ts tests/unit/sync-merge.test.ts
```

- [ ] **Step 4: Implement `src/core/identity.ts`**

```typescript
import type { ProviderDefinition } from "../types/index.js";
import { getByPath } from "../platform/index.js";  // or wherever dotted-path util lives

export interface IdentityCheckOk { ok: true; }
export interface IdentityCheckErr {
  ok: false;
  reason: "missing-in-vault" | "missing-in-fs" | "mismatch";
  vaultDisplay: string;
  fsDisplay: string;
}
export type IdentityCheck = IdentityCheckOk | IdentityCheckErr;

export function checkIdentity(
  provider: ProviderDefinition,
  vaultIdentity: Record<string, unknown> | undefined,
  vaultGrabData: Record<string, unknown>,
  fsCredentials: Record<string, unknown>,
  fsGrabData: Record<string, unknown>,
): IdentityCheck {
  if (!provider.identity) return { ok: true };    // provider has no identity schema; pass
  if (!vaultIdentity) return mkErr(provider, "missing-in-vault", vaultGrabData, {}, fsCredentials, fsGrabData);

  for (const field of provider.identity.fields) {
    const vaultV = vaultIdentity[field];
    const fsV = getByPath({ tokens: fsCredentials, ...fsCredentials } as Record<string, unknown>, field);
    if (vaultV == null) return mkErr(provider, "missing-in-vault", vaultGrabData, vaultIdentity, fsCredentials, fsGrabData);
    if (fsV == null)    return mkErr(provider, "missing-in-fs",    vaultGrabData, vaultIdentity, fsCredentials, fsGrabData);
    if (String(vaultV) !== String(fsV)) return mkErr(provider, "mismatch", vaultGrabData, vaultIdentity, fsCredentials, fsGrabData);
  }
  return { ok: true };
}

function mkErr(provider: ProviderDefinition, reason: IdentityCheckErr["reason"],
               vaultGrab: Record<string, unknown>, vaultIdentity: Record<string, unknown>,
               fsCreds: Record<string, unknown>, fsGrab: Record<string, unknown>): IdentityCheckErr {
  return { ok: false, reason,
    vaultDisplay: renderDisplay(provider, { credentials: vaultIdentity, grab_data: vaultGrab }),
    fsDisplay:    renderDisplay(provider, { credentials: fsCreds, grab_data: fsGrab }),
  };
}

function renderDisplay(provider: ProviderDefinition, src: { credentials: Record<string, unknown>; grab_data: Record<string, unknown> }): string {
  if (!provider.identity) return "";
  return provider.identity.display.map((tpl) =>
    tpl.replace(/\$\{(grab_fields|credentials|tokens)\.([^}]+)\}/g, (_, kind, field) => {
      const bag = kind === "grab_fields" ? src.grab_data : src.credentials;
      return String(getByPath(bag as Record<string, unknown>, field) ?? "?");
    }),
  ).join(", ");
}
```

- [ ] **Step 5: Implement `src/commands/sync.ts`** (basic, without CAS — CAS is Task 9)

```typescript
import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { loadProvider } from "../providers/loader.js";
import { readCredentials } from "../providers/reader.js";
import { getProfile, isActiveMain } from "../core/registry.js";
import { openVault } from "../vault/factory.js";
import { withProfileLock } from "../core/lock.js";
import { satelliteCredentialPath } from "../core/satellite.js";
import { checkIdentity } from "../core/identity.js";
import { resolveTemplatePath, fileExists } from "../platform/index.js";
import { tr, trf } from "../i18n.js";

export interface SyncOpts {
  dryRun?: boolean;
  force?: boolean;
  direction?: "push" | "pull";   // required with force
}

export type SyncResolution =
  | { resolution: "no-op" }
  | { resolution: "push-fs-to-vault"; reason: string }
  | { resolution: "push-vault-to-fs"; reason: string };

export async function sync(providerName: string, profileName: string, opts: SyncOpts = {}): Promise<SyncResolution> {
  return withProfileLock(providerName, profileName, async () => {
    if (opts.force && !opts.direction) {
      throw new Error(tr(`--force требует --push или --pull`, `--force requires --push or --pull`));
    }
    const provider = await loadProvider(providerName);
    const oauth = provider.auth_methods.oauth;
    if (!oauth) throw new Error(trf(`Провайдер "{p}" без OAuth`, `Provider "{p}" has no oauth`, { p: providerName }));

    const profile = await getProfile(profileName, providerName);
    if (!profile) throw new Error(trf(`Профиль "{n}" не найден`, `Profile "{n}" not found`, { n: profileName }));

    // Resolve FS path
    const fsPath = (await isActiveMain(providerName, profileName))
      ? resolveTemplatePath(oauth.credential_file.path)
      : satelliteCredentialPath(providerName, profileName, path.basename(oauth.credential_file.path));

    if (!(await fileExists(fsPath))) {
      throw new Error(trf(`Нет FS-локации для "{n}"; нечего синхронизировать`, `No FS location for "{n}"; nothing to sync`, { n: profileName }));
    }

    const vault = await openVault();
    const vaultEntry = await vault.get(profile.id);
    if (!vaultEntry) throw new Error(trf(`Vault entry для "{n}" отсутствует`, `Vault entry for "{n}" missing`, { n: profileName }));

    const fsRead = await readCredentials({ ...oauth.credential_file, path: fsPath }, oauth.credential_secrets);

    // Identity guard
    if (!opts.force) {
      const check = checkIdentity(provider, vaultEntry.identity, vaultEntry.grab_data, fsRead.credentials, fsRead.grab_data);
      if (!check.ok) {
        const fixHint = trf(`  Если намеренно — airev {p} grab --force {n}  (FS → vault)\n` +
                            `  или        — airev {p} render --force {n}  (vault → FS)`,
                            `  If intentional — airev {p} grab --force {n}  (FS → vault)\n` +
                            `  or             — airev {p} render --force {n}  (vault → FS)`,
                            { p: providerName, n: profileName });
        throw new Error(
          trf(`airev sync {p} {n}: identity ` +
              (check.reason === "mismatch" ? `mismatch` : `not recorded`) +
              `\n  vault: {v}\n  FS:    {f}\n` + fixHint,
              `airev sync {p} {n}: identity ` +
              (check.reason === "mismatch" ? `mismatch` : `not recorded`) +
              `\n  vault: {v}\n  FS:    {f}\n` + fixHint,
              { p: providerName, n: profileName, v: check.vaultDisplay, f: check.fsDisplay }),
        );
      }
    }

    // Freshness merge
    const fsLastRefresh = numberOr(fsRead.grab_data["last_refresh"], statMtimeMs(fsPath));
    const vaultLastRefresh = vaultEntry.last_refresh ?? 0;

    let resolution: SyncResolution = { resolution: "no-op" };
    if (opts.force) {
      resolution = opts.direction === "push"
        ? { resolution: "push-fs-to-vault", reason: "--force --push" }
        : { resolution: "push-vault-to-fs", reason: "--force --pull" };
    } else if (fsLastRefresh > vaultLastRefresh) {
      resolution = { resolution: "push-fs-to-vault", reason: `FS newer (${fsLastRefresh} > ${vaultLastRefresh})` };
    } else if (vaultLastRefresh > fsLastRefresh) {
      resolution = { resolution: "push-vault-to-fs", reason: `vault newer (${vaultLastRefresh} > ${fsLastRefresh})` };
    }

    if (opts.dryRun) {
      console.log(chalk.dim(`  ${resolution.resolution}` + ("reason" in resolution ? ` (${resolution.reason})` : "")));
      return resolution;
    }

    if (resolution.resolution === "push-fs-to-vault") {
      await vault.put({
        profile_id: profile.id,
        credentials: fsRead.credentials,
        grab_data: fsRead.grab_data,
        identity: extractIdentity(provider, fsRead.credentials),
        last_refresh: fsLastRefresh,
      });
    } else if (resolution.resolution === "push-vault-to-fs") {
      await writeProviderCredentialsToPath(provider, vaultEntry, fsPath);
    }

    return resolution;
  });
}
```

- [ ] **Step 6: Run tests — expect PASS**

- [ ] **Step 7: Commit**

```bash
git add src/commands/sync.ts src/core/identity.ts tests/unit/sync-identity-guard.test.ts tests/unit/sync-merge.test.ts
git commit -m "Add sync command with identity guard and freshness merge"
```

---

## Task 9: `sync` — compare-and-swap on push-vault-to-FS

**Files:**
- Modify: `src/commands/sync.ts`
- Test: `tests/unit/sync-cas.test.ts` (new)

- [ ] **Step 1: Write failing test**

`tests/unit/sync-cas.test.ts`:

```typescript
describe("sync compare-and-swap on FS write", () => {
  it("aborts push-vault-to-FS when FS rotates between read and write", async () => {
    // Arrange: vault newer than FS; sync resolution = push-vault-to-fs.
    // Intercept the write step: between identity-check and write, mutate the FS file
    // (simulate CLI rotation: write a fresh auth.json with newer last_refresh).
    // Use a vitest spy/hook in writeProviderCredentialsToPath, OR refactor to expose
    // a beforeWrite hook for testability.
    // Expect sync to throw with "FS changed concurrently" message.
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (no CAS yet)**

- [ ] **Step 3: Implement CAS in `src/commands/sync.ts`**

In the `push-vault-to-fs` branch, before the write:

```typescript
if (resolution.resolution === "push-vault-to-fs") {
  const recheck = await readCredentials({ ...oauth.credential_file, path: fsPath }, oauth.credential_secrets);
  const recheckLastRefresh = numberOr(recheck.grab_data["last_refresh"], statMtimeMs(fsPath));
  if (recheckLastRefresh !== fsLastRefresh) {
    throw new Error(
      trf(`airev sync {p} {n}: FS changed concurrently (last_refresh {a} → {b}); retry sync`,
          `airev sync {p} {n}: FS changed concurrently (last_refresh {a} → {b}); retry sync`,
          { p: providerName, n: profileName, a: String(fsLastRefresh), b: String(recheckLastRefresh) }),
    );
  }
  await writeProviderCredentialsToPath(provider, vaultEntry, fsPath);
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/commands/sync.ts tests/unit/sync-cas.test.ts
git commit -m "Add compare-and-swap guard on sync push-vault-to-fs"
```

---

## Task 10: `switch` refactor — auto-sync current main first

**Files:**
- Modify: `src/commands/switch.ts`
- Test: `tests/unit/switch.test.ts` (extend existing)

- [ ] **Step 1: Write failing tests**

Add to `tests/unit/switch.test.ts`:

```typescript
it("runs sync on current main before overwriting", async () => {
  // arrange: active_main = work; mutate ~/.codex/auth.json with newer last_refresh
  // call switch personal
  // assert: vault[work].last_refresh has been updated to FS's last_refresh
  //         before vault[personal] was written to ~/.codex/
});

it("aborts when pre-sync identity mismatch", async () => {
  // arrange: active_main = work but ~/.codex/auth.json has different identity
  await expect(switchProfile("codex", "personal")).rejects.toThrow(/identity/i);
  // assert ~/.codex/auth.json unchanged
});

it("--force skips pre-sync step", async () => {
  // mutate native with newer last_refresh
  await switchProfile("codex", "personal", { force: true });
  // assert vault[work].last_refresh NOT updated (refresh lost — acceptable per --force contract)
});
```

- [ ] **Step 2: Refactor `src/commands/switch.ts`**

Before the existing body, locate current active main and call `sync` on it (unless `--force`):

```typescript
export async function switchProfile(providerName: string, profileName: string, opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force) {
    const active = await loadActive();
    const activeId = active.active[providerName];
    if (activeId) {
      const activeProfile = await getProfileById(activeId);
      if (activeProfile && activeProfile.name !== profileName) {
        // pre-sync the outgoing main; surfaces identity errors before we overwrite anything
        await sync(providerName, activeProfile.name).catch((err) => {
          throw new Error(trf(`switch aborted: pre-sync on "{n}" failed:\n  {e}`, `switch aborted: pre-sync on "{n}" failed:\n  {e}`, { n: activeProfile.name, e: String(err) }));
        });
      }
    }
  }

  // existing body (resolve target profile, openVault, routeSwitch, writeCredentials, setActive)
  // wrap whole thing in withProfileLock(providerName, profileName, ...)
}
```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/commands/switch.ts tests/unit/switch.test.ts
git commit -m "switch auto-syncs outgoing main before overwriting"
```

---

## Task 11: `status` extension — satellite-aware

**Files:**
- Modify: `src/commands/status.ts`
- Test: `tests/unit/status-satellite.test.ts` (new)

- [ ] **Step 1: Write failing tests**

```typescript
describe("status with satellites", () => {
  it("lists all profiles with vault/FS state and sync hint", async () => {
    const output = await statusJson();
    // shape: array of { provider, name, in_vault, render: "native"|"satellite"|"none",
    //                   identity, last_refresh, sync_hint: "in-sync"|"vault-newer"|"fs-newer"|"identity-mismatch"|... }
    expect(output).toBeInstanceOf(Array);
  });

  it("detailed mode shows full state for one profile", async () => {
    const output = await statusDetailJson("codex", "side1");
    expect(output.vault).toBeDefined();
    expect(output.satellite).toBeDefined();
    expect(output.sync_hint).toMatch(/in-sync|vault-newer|fs-newer|.*mismatch.*|missing-identity/);
  });

  it("includes lock state when lock held", async () => {
    // hold lock, then call status — should report lock with pid
  });
});
```

- [ ] **Step 2: Extend `src/commands/status.ts`**

Compute, for each profile, the equivalent of `sync --dry-run` result (without acquiring the lock — status is read-only). Add `--json` flag.

For the detailed view (`status <provider> <name>`), include identity values from both sides, last_refresh, FS rendering location, lockfile presence/pid.

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/commands/status.ts tests/unit/status-satellite.test.ts
git commit -m "Extend status with satellite presence and sync hints"
```

---

## Task 12: `vault unlock` subcommand

**Files:**
- Modify: `src/commands/vault.ts`
- Test: `tests/unit/vault-unlock.test.ts` (new)

- [ ] **Step 1: Write failing tests**

```typescript
describe("vault unlock", () => {
  it("removes the lockfile and returns true when present", async () => {
    // create lockfile manually
    const ok = await vaultUnlock("codex", "side1");
    expect(ok).toBe(true);
    // assert lock file gone
  });

  it("returns false (no-op) when lockfile missing", async () => {
    const ok = await vaultUnlock("codex", "ghost");
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Implement in `src/commands/vault.ts`**

Add a new `unlock` subcommand wired into the existing vault command tree. Delegates to `clearLock` from `src/core/lock.ts`.

```typescript
export async function vaultUnlock(provider: string, name: string): Promise<boolean> {
  const cleared = await clearLock(provider, name);
  if (cleared) {
    console.log(chalk.green(trf(`  ✓ Lock cleared: {p}/{n}`, `  ✓ Lock cleared: {p}/{n}`, { p: provider, n: name })));
  } else {
    console.log(chalk.dim(trf(`  Lock not present: {p}/{n}`, `  Lock not present: {p}/{n}`, { p: provider, n: name })));
  }
  return cleared;
}
```

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add src/commands/vault.ts tests/unit/vault-unlock.test.ts
git commit -m "Add vault unlock subcommand for stale lock recovery"
```

---

## Task 13: Provider YAMLs — declare identity fields

**Files:**
- Modify: `providers/codex.yaml`
- Modify: `providers/claude.yaml`
- Modify: `providers/gemini.yaml`
- Modify: `providers/qwen.yaml`
- Modify: `providers/copilot.yaml`
- Test: `tests/unit/provider-identity-yamls.test.ts` (new)

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from "vitest";
import { loadProvider } from "../../src/providers/loader.js";

describe("shipped provider manifests declare identity", () => {
  for (const name of ["codex", "claude", "gemini", "qwen", "copilot"]) {
    it(`${name}.yaml has identity.fields with at least one stable field`, async () => {
      const prov = await loadProvider(name);
      expect(prov.identity?.fields.length).toBeGreaterThan(0);
      expect(prov.identity?.display.length).toBeGreaterThan(0);
    });
  }
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Add identity block to each YAML**

For codex (`providers/codex.yaml`), append at the top level:

```yaml
identity:
  fields: ["tokens.account_id"]
  display:
    - "${grab_fields.email}"
    - "${tokens.account_id}"
```

For claude (`providers/claude.yaml`) — inspect existing credential structure and pick the stable field (typically the email or account_uuid in `~/.claude/.credentials.json`). Mirror the same shape.

For gemini, qwen, copilot — repeat with their respective stable fields. Confirm each provider's credential file actually contains the field at the declared path before committing.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add providers/*.yaml tests/unit/provider-identity-yamls.test.ts
git commit -m "Declare identity fields in shipped provider manifests"
```

---

## Task 14: CLI wiring — register new commands and completion

**Files:**
- Modify: `src/index.ts` (or wherever commander/yargs CLI is wired)
- Modify: `src/commands/completion.ts`
- Modify: `src/commands/help.ts` and `src/commands/top-help.ts`
- Test: `tests/unit/completion-command.test.ts` (extend), `tests/unit/top-help.test.ts` (extend)

- [ ] **Step 1: Wire new verbs**

Add to the per-provider subcommand registration:
- `render <name> [--force]`
- `sync <name> [--dry-run] [--force --push|--pull]`
- `evict <name>`

Add to top-level:
- `status [--json]` extended
- under `vault`: `unlock <provider> <name>`

- [ ] **Step 2: Update completion strings**

Add new verbs to the completion data so tab-completion works.

- [ ] **Step 3: Update help text**

Add per-verb help entries (Russian and English variants, matching existing tr/trf pattern).

- [ ] **Step 4: Tests — assert completion includes new verbs, help mentions them**

- [ ] **Step 5: Run tests — expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/commands/completion.ts src/commands/help.ts src/commands/top-help.ts tests/unit/completion-command.test.ts tests/unit/top-help.test.ts
git commit -m "Wire render/sync/evict/vault-unlock into CLI and completion"
```

---

## Task 15: Integration — codex satellite end-to-end

**Files:**
- Create: `tests/unit/satellite-e2e-codex.test.ts`

- [ ] **Step 1: Write integration test**

Simulate the full lifecycle in a temp HOME:

```typescript
import { describe, it, expect } from "vitest";
import { grab } from "../../src/commands/grab.js";
import { render } from "../../src/commands/render.js";
import { sync } from "../../src/commands/sync.js";
import { evict } from "../../src/commands/evict.js";
import { satelliteCredentialPath } from "../../src/core/satellite.js";
import { promises as fs } from "node:fs";

describe("codex satellite E2E", () => {
  it("grab → render → simulate CLI refresh in satellite → sync → vault updated → evict", async () => {
    // 1. seed ~/.codex/auth.json with valid creds (account_id=acc_A, last_refresh=T0)
    // 2. await grab("codex", "side1");
    // 3. await render("codex", "side1");
    //    assert satellite file exists, content matches vault
    // 4. simulate CLI refresh: overwrite satellite auth.json with last_refresh=T1>T0, same account_id
    // 5. const r = await sync("codex", "side1");
    //    expect(r.resolution).toBe("push-fs-to-vault");
    // 6. assert vault[side1].last_refresh === T1
    // 7. await evict("codex", "side1");
    //    assert satellite dir gone, vault entry intact
  });

  it("identity guard blocks cross-account drift", async () => {
    // 1. grab, render side1 (account_id=acc_A)
    // 2. overwrite satellite auth.json with account_id=acc_B (simulating a different login)
    // 3. await expect(sync(...)).rejects.toThrow(/identity mismatch/i)
    // 4. assert vault unchanged
  });
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
npx vitest run tests/unit/satellite-e2e-codex.test.ts
```

- [ ] **Step 3: Full test suite + build**

```bash
npm run build && npx vitest run
```
Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/satellite-e2e-codex.test.ts
git commit -m "Add E2E test for codex satellite lifecycle"
```

---

## Post-implementation checks

- [ ] All spec sections covered (cross-reference [spec](../specs/2026-05-27-oauth-satellite-router-design.md) sections vs tasks).
- [ ] CLI tree matches what's wired (cross-reference [tree](../specs/2026-05-27-oauth-satellite-router-cli-tree.md)).
- [ ] `npm run build` clean.
- [ ] `npx vitest run` all green.
- [ ] Manual smoke: `airev codex render side1` then `airev codex status side1` then `airev codex sync side1 --dry-run` against a real configured profile.
- [ ] Update `README.md` with the new commands under "Поддерживаемые провайдеры" / TL;DR sections (one-line each for `render` / `sync` / `evict`, plus `vault unlock`).
