# Usage Duplicate Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add minimal duplicate-account diagnostics to `airev usage` using only verified identities already observed during the current live run.

**Architecture:** Keep `status` unchanged. `usage` will collect `(provider, profile alias, snapshot.email)` facts while it renders profiles, then print a compact diagnostics block for duplicate `provider + normalized email` groups. No observed identity is persisted.

**Tech Stack:** TypeScript, Vitest, existing `chalk` and `tr/trf` helpers.

---

### Task 1: Revert Profile-Name-Based Suppression

**Files:**
- Modify: `src/commands/usage.ts`
- Modify: `tests/unit/usage.test.ts`

- [x] **Step 1: Write the failing test**

Add a test asserting `renderSnapshot()` shows verified email even when it equals an arbitrary profile alias argument is removed.

```ts
it("always shows verified email when present", () => {
  const lines = renderSnapshot({ email: "me@example.com", plan: "plus" });

  expect(lines.map(stripAnsi)).toEqual(["me@example.com  plus"]);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/unit/usage.test.ts
```

Expected before implementation: FAIL if `renderSnapshot` still suppresses matching profile names or requires a profile-name argument.

- [x] **Step 3: Write minimal implementation**

In `src/commands/usage.ts`, change `renderSnapshot` back to:

```ts
export function renderSnapshot(snap: UsageSnapshot): string[] {
  const header: string[] = [];
  if (snap.email) header.push(chalk.cyan(snap.email));
  if (snap.plan) header.push(chalk.dim(snap.plan));
  // keep existing window rendering unchanged
}
```

Call it as:

```ts
const lines = renderSnapshot(result.snapshot);
```

- [x] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- --run tests/unit/usage.test.ts
```

Expected: PASS.

### Task 2: Add Live Duplicate Diagnostics

**Files:**
- Modify: `src/commands/usage.ts`
- Modify: `tests/unit/usage.test.ts`

- [x] **Step 1: Write the failing tests**

Add tests for a pure helper:

```ts
expect(renderDuplicateDiagnostics([
  { provider: "codex", profileName: "work", email: "same@example.com" },
  { provider: "codex", profileName: "main", email: "SAME@example.com" },
]).map(stripAnsi)).toEqual([
  "  diagnostics:",
  "    duplicate observed account in codex:",
  "      profiles: work, main",
]);

expect(renderDuplicateDiagnostics([
  { provider: "codex", profileName: "work", email: "same@example.com" },
  { provider: "claude", profileName: "main", email: "same@example.com" },
])).toEqual([]);

expect(renderDuplicateDiagnostics([
  { provider: "codex", profileName: "work" },
  { provider: "codex", profileName: "main", email: "main@example.com" },
])).toEqual([]);
```

- [x] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm test -- --run tests/unit/usage.test.ts
```

Expected before implementation: FAIL because `renderDuplicateDiagnostics` does not exist.

- [x] **Step 3: Write minimal implementation**

Export a small helper from `src/commands/usage.ts`:

```ts
export interface ObservedUsageIdentity {
  provider: string;
  profileName: string;
  email?: string;
}

export function renderDuplicateDiagnostics(observed: ObservedUsageIdentity[]): string[] {
  const groups = new Map<string, ObservedUsageIdentity[]>();
  for (const item of observed) {
    if (!item.email) continue;
    const key = `${item.provider}\0${item.email.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const lines: string[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    if (lines.length === 0) lines.push(chalk.dim("  diagnostics:"));
    lines.push(chalk.dim(`    duplicate observed account in ${group[0].provider}:`));
    lines.push(chalk.dim(`      profiles: ${group.map((item) => item.profileName).join(", ")}`));
  }
  return lines;
}
```

In `usage()`, collect observed identities after each successful `fetchUsage` result with `snapshot.email`, then print diagnostics after the profile loop:

```ts
const observed: ObservedUsageIdentity[] = [];
// after fetchUsage:
observed.push({ provider: profile.provider, profileName: profile.name, email: result.snapshot.email });
// after loop:
for (const line of renderDuplicateDiagnostics(observed)) console.log(line);
```

- [x] **Step 4: Run tests to verify they pass**

Run:

```powershell
npm test -- --run tests/unit/usage.test.ts
```

Expected: PASS.

### Task 3: Verify and Ship

**Files:**
- Modify: `src/commands/usage.ts`
- Modify: `tests/unit/usage.test.ts`

- [x] **Step 1: Build**

Run:

```powershell
npm run build
```

Expected: success.

- [x] **Step 2: Full tests**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [x] **Step 3: Optional live smoke**

Run only if Windows Hello interaction is acceptable:

```powershell
node dist\index.js usage
```

Expected: normal usage output, and duplicate diagnostics only if current live snapshots contain duplicate observed accounts.

- [ ] **Step 4: Commit and push**

Run:

```powershell
git add src/commands/usage.ts tests/unit/usage.test.ts docs/superpowers/plans/2026-04-29-usage-duplicate-diagnostics.md
git commit -m "Add live usage duplicate diagnostics"
git push
```
