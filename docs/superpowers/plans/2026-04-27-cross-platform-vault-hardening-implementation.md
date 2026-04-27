# Cross-Platform Vault Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make vault/config/prompt/migration behavior reliable across Windows, Linux, and macOS, with Linux parity and migration safety protected by tests.

**Architecture:** Centralize platform and vault backend decisions in `src/vault/info.ts`, keep vault opening in `src/vault/factory.ts`, and make `src/commands/vault.ts` consume the shared effective-backend contract. Add focused contract tests and command tests before each production change.

**Tech Stack:** TypeScript ESM, Node.js, Vitest, existing `VaultStore` abstraction, `secret-tool`/DPAPI/Keychain backends.

---

## File Structure

- Modify `src/vault/info.ts`: own vault paths, keyring labels, effective backend detection, and Linux keyring diagnostics types.
- Modify `src/vault/factory.ts`: use platform labels and shared backend naming in user-facing messages.
- Modify `src/commands/vault.ts`: use shared effective backend detection for `status`, `passwd`, and `migrate`.
- Modify `src/vault/prompt.ts`: keep chunk-safe password input behavior.
- Modify `src/vault/keyring-linux.ts`: expose diagnostic status for `secret-tool` and Secret Service availability.
- Modify `src/vault/migrate.ts`: import the shared `VaultBackendName` type from `vault/info.ts`.
- Modify `tests/unit/vault-info.test.ts`: contract tests for paths, labels, backend detection, and Linux keyring diagnostics.
- Modify `tests/unit/vault-factory.test.ts`: platform-neutral config-dir mocks and platform-specific keyring labels.
- Modify `tests/unit/vault-command.test.ts`: command behavior for effective backend status/passwd/migrate.
- Modify `tests/unit/vault-prompt.test.ts`: chunked stdin, EOF, and sequential prompt regression tests.
- Modify `tests/unit/stale.test.ts`: platform-neutral config-dir mocks.
- Add or modify `tests/unit/fs.test.ts`: safe atomic-write, chmod, and backup recovery coverage if not already present.

---

### Task 1: Make Platform Tests Use the Shared Config Contract

**Files:**
- Modify: `tests/unit/vault-factory.test.ts`
- Modify: `tests/unit/vault-info.test.ts`
- Modify: `tests/unit/stale.test.ts`

- [ ] **Step 1: Write failing Linux-safe and platform-neutral tests**

In `tests/unit/vault-info.test.ts`, mock `src/platform/index.ts` instead of mutating `APPDATA` or `XDG_CONFIG_HOME`:

```ts
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getVaultPaths,
  keyringBackendLabel,
  normalizeVaultMigrateTarget,
} from "../../src/vault/info.js";

const platformState = vi.hoisted(() => ({
  configDir: "/tmp/airev-vault-info/ai-revolver",
  platform: "linux" as "win32" | "darwin" | "linux",
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getConfigDir: () => platformState.configDir,
    getPlatform: () => platformState.platform,
  };
});

describe("vault info", () => {
  it("derives all state paths from the shared config dir", () => {
    const paths = getVaultPaths();

    expect(paths.configDir).toBe(platformState.configDir);
    expect(paths.registry).toBe(path.join(paths.configDir, "registry.json"));
    expect(paths.active).toBe(path.join(paths.configDir, "active.json"));
    expect(paths.stale).toBe(path.join(paths.configDir, "stale.json"));
    expect(paths.encryptedVault).toBe(path.join(paths.configDir, "vault.enc"));
    expect(paths.windowsDpapiVault).toBe(path.join(paths.configDir, "keyring", "vault_data.dpapi"));
  });

  it("labels known keyring backends by platform", () => {
    expect(keyringBackendLabel("win32")).toBe("Windows DPAPI");
    expect(keyringBackendLabel("darwin")).toBe("macOS Keychain");
    expect(keyringBackendLabel("linux")).toBe("Linux libsecret");
  });

  it("uses the current platform for the default keyring label", () => {
    platformState.platform = "darwin";
    expect(keyringBackendLabel()).toBe("macOS Keychain");
  });

  it("normalizes supported migrate targets", () => {
    expect(normalizeVaultMigrateTarget("keyring")).toBe("keyring");
    expect(normalizeVaultMigrateTarget("file")).toBe("file");
    expect(normalizeVaultMigrateTarget("encrypted-file")).toBe("file");
  });

  it("rejects unsupported migrate targets", () => {
    expect(normalizeVaultMigrateTarget("plaintext")).toBeNull();
    expect(normalizeVaultMigrateTarget(undefined)).toBeNull();
  });
});
```

In `tests/unit/vault-factory.test.ts`, add a hoisted config mock:

```ts
const configState = vi.hoisted(() => ({
  configDir: "",
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getConfigDir: () => configState.configDir,
  };
});
```

Set it in `beforeEach`:

```ts
beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-vault-factory-"));
  configState.configDir = path.join(tempRoot, "ai-revolver");
  promptState.existing.mockResolvedValue("existing-pw");
  promptState.nextNewPassword = "new-pw";
  promptState.nextNewConfirm = "new-pw";
  promptState.keyringAvailable = false;
  promptState.keyringIds = [];
});
```

In `tests/unit/stale.test.ts`, add the same pattern:

```ts
const configState = vi.hoisted(() => ({
  configDir: "",
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getConfigDir: () => configState.configDir,
  };
});

beforeEach(async () => {
  configRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-stale-"));
  configState.configDir = path.join(configRoot, "ai-revolver");
});
```

- [ ] **Step 2: Run tests to verify the current platform-specific assumptions fail**

Run:

```bash
npm test tests/unit/vault-info.test.ts tests/unit/vault-factory.test.ts tests/unit/stale.test.ts
```

Expected before the test-isolation fix: at least one test reads the real platform config path or real local vault state.

- [ ] **Step 3: Implement minimal test-isolation changes**

Apply only the test mock changes from Step 1. Do not change production code in this task.

- [ ] **Step 4: Verify green**

Run:

```bash
npm test tests/unit/vault-info.test.ts tests/unit/vault-factory.test.ts tests/unit/stale.test.ts
```

Expected: all selected tests pass without reading real `~/.config`, `%APPDATA%`, or `~/Library`.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/vault-info.test.ts tests/unit/vault-factory.test.ts tests/unit/stale.test.ts
git commit -m "test: isolate vault config paths"
```

---

### Task 2: Add Shared Effective Backend Detection

**Files:**
- Modify: `src/vault/info.ts`
- Modify: `src/vault/migrate.ts`
- Modify: `tests/unit/vault-info.test.ts`

- [ ] **Step 1: Write failing backend detection tests**

Extend `tests/unit/vault-info.test.ts` with mocks for keyring and encrypted-file state:

```ts
const backendState = vi.hoisted(() => ({
  keyringAvailable: false,
  keyringIds: [] as string[],
  encryptedFileExists: false,
}));

vi.mock("../../src/vault/keyring-vault.js", () => ({
  KeyringVault: class {
    static isAvailable = vi.fn(async () => backendState.keyringAvailable);
    async listIds() {
      return backendState.keyringIds;
    }
  },
}));

vi.mock("../../src/vault/encrypted-file.js", () => ({
  EncryptedFileVault: class {
    static exists = vi.fn(async () => backendState.encryptedFileExists);
  },
}));
```

Add tests:

```ts
import { describeEffectiveVaultBackend } from "../../src/vault/info.js";

describe("effective vault backend", () => {
  it("uses encrypted-file when keyring is unavailable", async () => {
    backendState.keyringAvailable = false;
    backendState.encryptedFileExists = true;

    await expect(describeEffectiveVaultBackend()).resolves.toMatchObject({
      backend: "encrypted-file",
      keyringAvailable: false,
      encryptedFileExists: true,
    });
  });

  it("uses keyring when keyring has entries", async () => {
    backendState.keyringAvailable = true;
    backendState.keyringIds = ["prof_one"];
    backendState.encryptedFileExists = true;

    await expect(describeEffectiveVaultBackend()).resolves.toMatchObject({
      backend: "keyring",
      keyringAvailable: true,
      keyringEntryCount: 1,
      encryptedFileExists: true,
    });
  });

  it("uses encrypted-file when keyring is empty and vault file exists", async () => {
    backendState.keyringAvailable = true;
    backendState.keyringIds = [];
    backendState.encryptedFileExists = true;

    await expect(describeEffectiveVaultBackend()).resolves.toMatchObject({
      backend: "encrypted-file",
      keyringAvailable: true,
      keyringEntryCount: 0,
      encryptedFileExists: true,
    });
  });

  it("uses keyring when keyring is empty and vault file does not exist", async () => {
    backendState.keyringAvailable = true;
    backendState.keyringIds = [];
    backendState.encryptedFileExists = false;

    await expect(describeEffectiveVaultBackend()).resolves.toMatchObject({
      backend: "keyring",
      keyringAvailable: true,
      keyringEntryCount: 0,
      encryptedFileExists: false,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test tests/unit/vault-info.test.ts
```

Expected: FAIL with an import error because `describeEffectiveVaultBackend` is not exported.

- [ ] **Step 3: Implement shared backend detection**

In `src/vault/info.ts`, add imports and types:

```ts
import { EncryptedFileVault } from "./encrypted-file.js";
import { KeyringVault } from "./keyring-vault.js";

export type VaultBackendName = "keyring" | "encrypted-file";

export interface EffectiveVaultBackend {
  backend: VaultBackendName;
  keyringAvailable: boolean;
  keyringEntryCount: number;
  encryptedFileExists: boolean;
  keyringLabel: string;
}
```

Add the detector:

```ts
export async function describeEffectiveVaultBackend(): Promise<EffectiveVaultBackend> {
  const keyringAvailable = await KeyringVault.isAvailable();
  const encryptedFileExists = await EncryptedFileVault.exists();

  if (!keyringAvailable) {
    return {
      backend: "encrypted-file",
      keyringAvailable,
      keyringEntryCount: 0,
      encryptedFileExists,
      keyringLabel: keyringBackendLabel(),
    };
  }

  const keyringVault = new KeyringVault();
  const keyringEntryCount = (await keyringVault.listIds()).length;
  const backend = keyringEntryCount === 0 && encryptedFileExists
    ? "encrypted-file"
    : "keyring";

  return {
    backend,
    keyringAvailable,
    keyringEntryCount,
    encryptedFileExists,
    keyringLabel: keyringBackendLabel(),
  };
}
```

In `src/vault/migrate.ts`, replace the local backend type export:

```ts
import type { VaultBackendName } from "./info.js";
export type { VaultBackendName } from "./info.js";
```

- [ ] **Step 4: Verify green**

Run:

```bash
npm test tests/unit/vault-info.test.ts tests/unit/vault-migrate.test.ts
```

Expected: selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/vault/info.ts src/vault/migrate.ts tests/unit/vault-info.test.ts
git commit -m "feat: centralize vault backend detection"
```

---

### Task 3: Make Vault Commands Use the Effective Backend

**Files:**
- Modify: `src/commands/vault.ts`
- Modify: `tests/unit/vault-command.test.ts`

- [ ] **Step 1: Write failing command tests**

In `tests/unit/vault-command.test.ts`, add a mock for `describeEffectiveVaultBackend`:

```ts
const infoMocks = vi.hoisted(() => ({
  effectiveBackend: {
    backend: "encrypted-file" as "keyring" | "encrypted-file",
    keyringAvailable: true,
    keyringEntryCount: 0,
    encryptedFileExists: true,
    keyringLabel: "Linux libsecret",
  },
}));

vi.mock("../../src/vault/info.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/vault/info.js")>();
  return {
    ...actual,
    describeEffectiveVaultBackend: vi.fn(async () => infoMocks.effectiveBackend),
  };
});
```

Add tests:

```ts
describe("vaultCommand status/passwd effective backend", () => {
  it("status reports encrypted-file when keyring is available but empty and vault.enc exists", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    try {
      const { vaultCommand } = await import("../../src/commands/vault.js");

      await vaultCommand("status", undefined);

      expect(logs.join("\n")).toContain("encrypted-file");
      expect(logs.join("\n")).toContain("keyring is available but empty");
    } finally {
      console.log = originalLog;
    }
  });

  it("passwd uses the effective backend instead of keyring availability", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    try {
      const { vaultCommand } = await import("../../src/commands/vault.js");

      await vaultCommand("passwd", undefined);

      expect(logs.join("\n")).toContain("Changing the encrypted-file vault master password is not implemented yet");
      expect(logs.join("\n")).not.toContain("OS keyring backend is active");
    } finally {
      console.log = originalLog;
    }
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test tests/unit/vault-command.test.ts
```

Expected: the `passwd` test fails because the command checks `KeyringVault.isAvailable()` instead of effective backend.

- [ ] **Step 3: Update command implementation**

In `src/commands/vault.ts`, import the shared detector:

```ts
import {
  describeEffectiveVaultBackend,
  getVaultPaths,
  keyringBackendLabel,
  normalizeVaultMigrateTarget,
} from "../vault/info.js";
```

Change `vaultStatus()`:

```ts
async function vaultStatus(): Promise<void> {
  const state = await describeEffectiveVaultBackend();

  console.log();
  console.log(`${statusLabel("backend:")} ${state.backend}`);
  if (state.backend === "keyring") {
    console.log(`${statusLabel(tr("провайдер:", "provider:"))} ${state.keyringLabel}`);
  } else {
    console.log(`${statusLabel(tr("vault-файл:", "vault file:"))} ${getVaultPaths().encryptedVault}`);
    if (state.keyringAvailable) {
      console.log(chalk.dim(tr(
        "  keyring доступен, но пуст; используется vault.enc.",
        "  keyring is available but empty; using vault.enc.",
      )));
    }
  }
  console.log();
}
```

Change `vaultPasswd()`:

```ts
async function vaultPasswd(): Promise<void> {
  const state = await describeEffectiveVaultBackend();
  if (state.backend === "keyring") {
    console.log(chalk.dim(tr(
      "  Используется OS keyring; master password airev не применяется.",
      "  OS keyring backend is active; airev master password is not used.",
    )));
    return;
  }

  console.log(chalk.yellow(tr(
    "  Смена master password для encrypted-file vault пока не реализована.",
    "  Changing the encrypted-file vault master password is not implemented yet.",
  )));
}
```

Change `detectSourceBackend()`:

```ts
async function detectSourceBackend(): Promise<VaultBackendName> {
  return (await describeEffectiveVaultBackend()).backend;
}
```

- [ ] **Step 4: Verify green**

Run:

```bash
npm test tests/unit/vault-command.test.ts tests/unit/vault-info.test.ts
```

Expected: selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/commands/vault.ts tests/unit/vault-command.test.ts
git commit -m "fix: use effective vault backend in commands"
```

---

### Task 4: Make Keyring Labels Platform-Correct in Factory Output

**Files:**
- Modify: `src/vault/factory.ts`
- Modify: `tests/unit/vault-factory.test.ts`

- [ ] **Step 1: Write failing factory label tests**

In `tests/unit/vault-factory.test.ts`, extend the platform mock:

```ts
const platformState = vi.hoisted(() => ({
  platform: "linux" as "win32" | "darwin" | "linux",
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getConfigDir: () => configState.configDir,
    getPlatform: () => platformState.platform,
  };
});
```

Add tests:

```ts
it("prints the Linux keyring label when keyring is used on Linux", async () => {
  promptState.keyringAvailable = true;
  promptState.keyringIds = ["prof_keyring"];
  platformState.platform = "linux";
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = ((value?: unknown) => {
    logs.push(String(value ?? ""));
  }) as typeof console.log;
  try {
    const { openVault } = await importFactory();

    await openVault({ skipVerify: true });

    expect(logs.join("\n")).toContain("Linux libsecret");
    expect(logs.join("\n")).not.toContain("DPAPI");
  } finally {
    console.log = originalLog;
  }
});

it("prints the macOS keyring label when keyring is used on macOS", async () => {
  promptState.keyringAvailable = true;
  promptState.keyringIds = ["prof_keyring"];
  platformState.platform = "darwin";
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = ((value?: unknown) => {
    logs.push(String(value ?? ""));
  }) as typeof console.log;
  try {
    const { openVault } = await importFactory();

    await openVault({ skipVerify: true });

    expect(logs.join("\n")).toContain("macOS Keychain");
    expect(logs.join("\n")).not.toContain("DPAPI");
  } finally {
    console.log = originalLog;
  }
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test tests/unit/vault-factory.test.ts
```

Expected: tests fail because `openKeyringVault()` prints `DPAPI (Windows)` for every keyring backend.

- [ ] **Step 3: Implement platform-correct labels**

In `src/vault/factory.ts`, import `keyringBackendLabel`:

```ts
import { keyringBackendLabel } from "./info.js";
```

Change the non-CredUI branch:

```ts
  } else {
    console.log(chalk.dim(trf(
      "  🔓 Vault: {backend}",
      "  🔓 Vault: {backend}",
      { backend: keyringBackendLabel() },
    )));
  }
```

Add `trf` to the existing i18n import:

```ts
import { tr, trf } from "../i18n.js";
```

- [ ] **Step 4: Verify green**

Run:

```bash
npm test tests/unit/vault-factory.test.ts
```

Expected: selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/vault/factory.ts tests/unit/vault-factory.test.ts
git commit -m "fix: label keyring backend by platform"
```

---

### Task 5: Add Password Prompt Regression Coverage

**Files:**
- Modify: `src/vault/prompt.ts`
- Modify: `tests/unit/vault-prompt.test.ts`

- [ ] **Step 1: Write failing prompt behavior tests**

In `tests/unit/vault-prompt.test.ts`, add stream-based tests:

```ts
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { promptPassword } from "../../src/vault/prompt.js";

class FakeStdin extends EventEmitter {
  isTTY = false;
  resume = vi.fn();
  pause = vi.fn();
  setEncoding = vi.fn();
  setRawMode = vi.fn();
}

const originalStdin = process.stdin;
const originalStdoutWrite = process.stdout.write;

afterEach(() => {
  Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
  process.stdout.write = originalStdoutWrite;
});

describe("promptPassword input behavior", () => {
  it("resolves chunked piped input that includes a newline", async () => {
    const stdin = new FakeStdin();
    const writes: string[] = [];
    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    process.stdout.write = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    const result = promptPassword("Password: ");
    stdin.emit("data", "secret\n");

    await expect(result).resolves.toBe("secret");
    expect(writes.join("")).toContain("Password: ******\n");
  });

  it("resolves EOF after a password in piped mode", async () => {
    const stdin = new FakeStdin();
    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    process.stdout.write = vi.fn(() => true) as unknown as typeof process.stdout.write;

    const result = promptPassword("Password: ");
    stdin.emit("data", "secret");
    stdin.emit("end");

    await expect(result).resolves.toBe("secret");
  });

  it("handles sequential prompts in the same process", async () => {
    const stdin = new FakeStdin();
    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    process.stdout.write = vi.fn(() => true) as unknown as typeof process.stdout.write;

    const first = promptPassword("First: ");
    stdin.emit("data", "one\n");
    await expect(first).resolves.toBe("one");

    const second = promptPassword("Second: ");
    stdin.emit("data", "two\n");
    await expect(second).resolves.toBe("two");
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test tests/unit/vault-prompt.test.ts
```

Expected before the chunk-safe implementation: the chunked input test fails or hangs because `"secret\n"` is treated as one character-like string.

- [ ] **Step 3: Implement chunk-safe prompt behavior**

In `src/vault/prompt.ts`, ensure `promptPassword()` has a `settled` guard, a shared `finish()` helper, iterates each received chunk character-by-character, and handles `end`:

```ts
export async function promptPassword(message = "Master password: "): Promise<string> {
  return new Promise((resolve) => {
    const stdout = process.stdout;
    let password = "";
    let settled = false;

    stdout.write(message);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const finish = () => {
      if (settled) return;
      settled = true;
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      stdout.write("\n");
      resolve(password);
    };

    const onData = (chunk: string) => {
      for (const c of chunk.toString()) {
        if (c === "\n" || c === "\r" || c === "\u0004") {
          finish();
          return;
        } else if (c === "\u0003") {
          process.stdin.setRawMode?.(false);
          process.exit(0);
        } else if (c === "\u007F" || c === "\b") {
          if (password.length > 0) {
            password = password.slice(0, -1);
            stdout.write("\b \b");
          }
        } else {
          password += c;
          stdout.write("*");
        }
      }
    };

    const onEnd = () => {
      if (password.length > 0) {
        finish();
        return;
      }
      if (!settled) {
        settled = true;
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdin.removeListener("end", onEnd);
        resolve(password);
      }
    };

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}
```

- [ ] **Step 4: Verify green**

Run:

```bash
npm test tests/unit/vault-prompt.test.ts
```

Expected: selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/vault/prompt.ts tests/unit/vault-prompt.test.ts
git commit -m "fix: handle chunked vault password input"
```

---

### Task 6: Add Linux Keyring Diagnostics

**Files:**
- Modify: `src/vault/keyring-linux.ts`
- Modify: `src/vault/info.ts`
- Modify: `tests/unit/vault-info.test.ts`

- [ ] **Step 1: Write failing diagnostics tests**

In `tests/unit/vault-info.test.ts`, add a Linux diagnostic mock:

```ts
const linuxKeyringState = vi.hoisted(() => ({
  status: "available" as "available" | "missing-secret-tool" | "secret-service-unavailable" | "unavailable",
  detail: undefined as string | undefined,
}));

vi.mock("../../src/vault/keyring-linux.js", () => ({
  secretToolAvailable: vi.fn(async () => linuxKeyringState.status === "available"),
  secretToolStatus: vi.fn(async () => ({
    status: linuxKeyringState.status,
    detail: linuxKeyringState.detail,
  })),
}));
```

Add tests:

```ts
import { describeKeyringStatus } from "../../src/vault/info.js";

describe("keyring diagnostics", () => {
  it("reports missing secret-tool on Linux", async () => {
    platformState.platform = "linux";
    linuxKeyringState.status = "missing-secret-tool";

    await expect(describeKeyringStatus()).resolves.toMatchObject({
      platform: "linux",
      label: "Linux libsecret",
      available: false,
      reason: "missing-secret-tool",
    });
  });

  it("reports unavailable Secret Service on Linux", async () => {
    platformState.platform = "linux";
    linuxKeyringState.status = "secret-service-unavailable";
    linuxKeyringState.detail = "The name is not activatable";

    await expect(describeKeyringStatus()).resolves.toMatchObject({
      platform: "linux",
      label: "Linux libsecret",
      available: false,
      reason: "secret-service-unavailable",
      detail: "The name is not activatable",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
npm test tests/unit/vault-info.test.ts
```

Expected: FAIL because `secretToolStatus` and `describeKeyringStatus` are not implemented.

- [ ] **Step 3: Implement Linux diagnostics**

In `src/vault/keyring-linux.ts`, add:

```ts
export type SecretToolStatus =
  | { status: "available" }
  | { status: "missing-secret-tool"; detail?: string }
  | { status: "secret-service-unavailable"; detail?: string }
  | { status: "unavailable"; detail?: string };

export async function secretToolStatus(): Promise<SecretToolStatus> {
  try {
    const { stderr } = await execFileAsync("secret-tool", [
      "lookup", "service", "ai-revolver-probe", "account", "probe",
    ], { timeout: 5000 });
    if (stderr && stderr.includes("not activatable")) {
      return { status: "secret-service-unavailable", detail: stderr.trim() };
    }
    return { status: "available" };
  } catch (err: unknown) {
    const e = err as { code?: string; stderr?: string; message?: string };
    const detail = (e.stderr || e.message || "").trim() || undefined;
    if (e.code === "ENOENT") {
      return { status: "missing-secret-tool", detail };
    }
    if (detail?.includes("not activatable")) {
      return { status: "secret-service-unavailable", detail };
    }
    return { status: "unavailable", detail };
  }
}
```

Update `secretToolAvailable()`:

```ts
export async function secretToolAvailable(): Promise<boolean> {
  return (await secretToolStatus()).status === "available";
}
```

In `src/vault/info.ts`, add:

```ts
import { secretToolStatus } from "./keyring-linux.js";

export interface KeyringStatus {
  platform: Platform;
  label: string;
  available: boolean;
  reason?: "missing-secret-tool" | "secret-service-unavailable" | "unavailable";
  detail?: string;
}

export async function describeKeyringStatus(): Promise<KeyringStatus> {
  const platform = getPlatform();
  const label = keyringBackendLabel(platform);
  if (platform === "linux") {
    const status = await secretToolStatus();
    if (status.status === "available") return { platform, label, available: true };
    return {
      platform,
      label,
      available: false,
      reason: status.status,
      detail: status.detail,
    };
  }
  return {
    platform,
    label,
    available: await KeyringVault.isAvailable(),
  };
}
```

- [ ] **Step 4: Verify green**

Run:

```bash
npm test tests/unit/vault-info.test.ts
```

Expected: selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/vault/keyring-linux.ts src/vault/info.ts tests/unit/vault-info.test.ts
git commit -m "feat: report linux keyring diagnostics"
```

---

### Task 7: Add Filesystem Safety Tests

**Files:**
- Create or modify: `tests/unit/fs.test.ts`
- Modify: `src/platform/fs.ts` only if tests expose a bug.

- [ ] **Step 1: Write filesystem behavior tests**

Create `tests/unit/fs.test.ts` if it does not exist:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileExists, readJsonFile, writeJsonFile } from "../../src/platform/fs.js";

const platformState = vi.hoisted(() => ({
  platform: "linux" as "win32" | "darwin" | "linux",
}));

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    getPlatform: () => platformState.platform,
  };
});

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airev-fs-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("platform fs", () => {
  it("writes json with requested POSIX permissions", async () => {
    platformState.platform = "linux";
    const file = path.join(tempRoot, "vault.enc");

    await writeJsonFile(file, { ok: true }, 0o600);

    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o600);
    await expect(readJsonFile(file)).resolves.toEqual({ ok: true });
  });

  it("recovers a missing json file from backup", async () => {
    const file = path.join(tempRoot, "registry.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file + ".bak", JSON.stringify({ restored: true }), "utf-8");

    await expect(fileExists(file)).resolves.toBe(true);
    await expect(readJsonFile(file)).resolves.toEqual({ restored: true });
  });
});
```

- [ ] **Step 2: Run tests to verify RED or existing coverage**

Run:

```bash
npm test tests/unit/fs.test.ts
```

Expected: if `tests/unit/fs.test.ts` is new, tests run and may pass immediately because behavior exists. If they pass immediately, record that these are characterization tests for existing filesystem behavior and do not change production code in this task.

- [ ] **Step 3: Implement only if tests fail for a real behavior bug**

If POSIX permissions or backup recovery fails, update `src/platform/fs.ts` minimally in the failing area. Keep `atomicWrite()`, `setPermissions()`, and `autoRecover()` responsibilities separate.

- [ ] **Step 4: Verify green**

Run:

```bash
npm test tests/unit/fs.test.ts
```

Expected: selected tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/fs.test.ts src/platform/fs.ts
git commit -m "test: cover vault filesystem safety"
```

---

### Task 8: Final Verification and Linux Smoke

**Files:**
- Verify: no planned file changes.
- If smoke exposes a regression, stop and create a new TDD task before changing files.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Build**

Run:

```bash
npm run build
```

Expected: build succeeds and writes `dist/index.js`.

- [ ] **Step 3: Link local CLI**

Run:

```bash
npm link
```

Expected: global `airev` points at this workspace package.

- [ ] **Step 4: Verify CLI version and vault help**

Run:

```bash
airev --version
airev vault --help
```

Expected: version prints `0.2.0`; vault help includes `path`, `status`, `passwd`, `migrate`, `export`, and `import`.

- [ ] **Step 5: Verify Linux encrypted-file fallback prompt**

Run with the existing local test vault password:

```bash
printf 'linuxpass123\n' | airev env --shell bash
```

Expected: the command prints `export OPENAI_API_KEY=...` for the active api-key profile, and the password prompt does not hang.

- [ ] **Step 6: Verify vault status and paths on Linux**

Run:

```bash
airev vault path
airev vault status
```

Expected: paths point under the Linux config directory, and status does not print `DPAPI (Windows)` unless the platform is actually Windows.

- [ ] **Step 7: Record follow-up if smoke exposes a regression**

If smoke testing exposes a regression, do not patch it inside this verification task. Add a new TDD task to this plan with exact files, failing test, implementation, verification command, and commit command.

Expected: no new changes are needed in Task 8.

---

## Self-Review Checklist

- Spec coverage:
  - Linux parity: Tasks 2, 3, 5, 6, 8.
  - Cross-platform hardening: Tasks 1, 2, 4, 7.
  - Migration safety: Tasks 2, 3, 8 plus existing `tests/unit/vault-migrate.test.ts`.
  - Prompt regression: Task 5.
  - Test isolation: Task 1.

- Type consistency:
  - `VaultBackendName` is shared from `src/vault/info.ts`.
  - `describeEffectiveVaultBackend()` returns `EffectiveVaultBackend`.
  - `describeKeyringStatus()` returns `KeyringStatus`.

- Verification:
  - Each production behavior task starts with a failing test.
  - Each task has a focused test command.
  - Final verification includes `npm test`, `npm run build`, and Linux CLI smoke.
