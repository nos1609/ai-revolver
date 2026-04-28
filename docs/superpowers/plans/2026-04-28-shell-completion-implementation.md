# Shell Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add static cross-platform shell completion generation for `airev`.

**Architecture:** Keep completion generation separate from the manual CLI parser. Build a small static command model, feed provider names into it, generate shell-specific scripts as strings, and expose it through `airev completion [shell]`.

**Tech Stack:** TypeScript ESM, Vitest, Node 18, existing `listProviders()` loader and `tr/trf` localization helpers.

---

### Task 1: Pure Completion Generator

**Files:**
- Create: `src/completion/spec.ts`
- Create: `src/completion/generate.ts`
- Test: `tests/unit/completion.test.ts`

- [ ] **Step 1: Write failing generator tests**

```ts
import { describe, expect, it } from "vitest";
import { generateCompletionScript, parseCompletionShell } from "../../src/completion/generate.js";

describe("completion generator", () => {
  const providers = ["claude", "codex", "gemini", "qwen"];

  it("accepts supported shells and rejects unknown shells", () => {
    expect(parseCompletionShell(undefined)).toBe("bash");
    expect(parseCompletionShell("powershell")).toBe("powershell");
    expect(() => parseCompletionShell("cmd")).toThrow(/Unknown completion shell|Неизвестный shell/i);
  });

  it("generates shell scripts with commands providers actions and flags", () => {
    for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
      const script = generateCompletionScript({ shell, providers });
      expect(script).toContain("airev");
      expect(script).toContain("completion");
      expect(script).toContain("vault");
      expect(script).toContain("codex");
      expect(script).toContain("claude");
      expect(script).toContain("grab");
      expect(script).toContain("migrate");
      expect(script).toContain("--shell");
      expect(script).toContain("powershell");
    }
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/completion.test.ts`

Expected: FAIL because `src/completion/generate.js` does not exist.

- [ ] **Step 3: Implement minimal generator**

Create `spec.ts` with static command words/options and `generate.ts` with four shell renderers. Keep it pure: no filesystem, vault, registry, or process access.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/unit/completion.test.ts`

Expected: PASS.

### Task 2: CLI Command Wrapper and Routing

**Files:**
- Create: `src/commands/completion.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/completion-command.test.ts`

- [ ] **Step 1: Write failing command tests**

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const providersMock = vi.hoisted(() => ({
  listProviders: vi.fn(async () => ["claude", "codex", "gemini", "qwen"]),
}));

vi.mock("../../src/providers/loader.js", () => providersMock);

describe("completion command", () => {
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
    vi.clearAllMocks();
  });

  it("prints bash completion by default", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => logs.push(String(value ?? ""))) as typeof console.log;
    const { completionCommand } = await import("../../src/commands/completion.js");

    await completionCommand(undefined);

    expect(providersMock.listProviders).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain("airev");
    expect(logs.join("\n")).toContain("complete");
  });

  it("prints powershell completion when requested", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => logs.push(String(value ?? ""))) as typeof console.log;
    const { completionCommand } = await import("../../src/commands/completion.js");

    await completionCommand("powershell");

    expect(logs.join("\n")).toContain("Register-ArgumentCompleter");
  });
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/completion-command.test.ts`

Expected: FAIL because `src/commands/completion.js` does not exist.

- [ ] **Step 3: Implement command wrapper and route**

Add `completion` to `GLOBAL_VERBS`, dispatch `completionCommand(second)`, and keep provider dispatch unchanged.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/unit/completion-command.test.ts tests/unit/completion.test.ts`

Expected: PASS.

### Task 3: Help and Documentation

**Files:**
- Modify: `src/index.ts`
- Modify: `src/commands/help.ts`
- Modify: `README.md`

- [ ] **Step 1: Add failing help expectations**

Extend completion tests or add `tests/unit/help-completion.test.ts` to assert action help exists for `completion` and mentions all shells.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/unit/help-completion.test.ts`

Expected: FAIL until help text is added.

- [ ] **Step 3: Update help and README**

Add top-level help row, action-level help entry, and README install snippets for PowerShell, bash, zsh, and fish. Note that v1 does not complete profile names.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/unit/help-completion.test.ts`

Expected: PASS.

### Task 4: Final Verification

**Files:**
- No new files unless verification exposes a defect.

- [ ] **Step 1: Build**

Run: `npm run build`

Expected: successful `tsup` build.

- [ ] **Step 2: Full tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Smoke completion commands**

Run:

```bash
node dist/index.js completion powershell
node dist/index.js completion bash
node dist/index.js completion fish
node dist/index.js completion zsh
```

Expected: every command prints a script containing `airev`.

- [ ] **Step 4: Commit**

Run:

```bash
git add src tests README.md docs/superpowers/plans/2026-04-28-shell-completion-implementation.md
git commit -m "Add shell completion generation"
```
