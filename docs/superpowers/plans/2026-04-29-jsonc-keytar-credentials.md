# JSONC Keytar Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make provider credential files explicitly support JSONC and make store-backed secrets fail with clear diagnostics, with Copilot as the first enabled provider.

**Architecture:** Keep credential-file parsing and store-backed secrets provider-agnostic. Extend the provider schema from `json` to `json | jsonc`, keep `credential_secrets` as the generic secret-store layer, and improve errors in `readCredentials()` without branching on Copilot.

**Tech Stack:** TypeScript ESM, Vitest, YAML provider definitions, keytar-compatible OS credential-store access.

---

## File Structure

- Modify `src/types/index.ts`: widen `ProviderCredentialFile.format` and `ProviderExtraFile.format` to `"json" | "jsonc"`.
- Modify `src/providers/json.ts`: parse according to explicit format while preserving compatibility for existing `json` files with comments.
- Modify `src/providers/reader.ts`: pass file format to the parser and produce clear store-secret errors.
- Modify `src/providers/writer.ts`: pass file format when reading existing credential files.
- Modify `providers/copilot.yaml`: set `credential_file.format: jsonc`.
- Modify `tests/unit/provider-reader.test.ts`: add reader tests for explicit JSONC and missing store secret diagnostics.
- Modify `tests/unit/provider-keytar.test.ts`: keep existing keytar happy-path behavior green if needed.
- Create `tests/unit/provider-copilot.test.ts`: lock Copilot provider YAML behavior.

---

### Task 1: Explicit JSONC Credential File Parsing

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/providers/json.ts`
- Modify: `src/providers/reader.ts`
- Modify: `src/providers/writer.ts`
- Modify: `tests/unit/provider-reader.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test to `tests/unit/provider-reader.test.ts` inside `describe("provider credential reader", ...)`:

```ts
  it("reads explicit jsonc credential files with comments", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-reader-jsonc-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    await writeFile(
      file,
      `// User settings belong in settings.json.
{
  "lastLoggedInUser": {
    "host": "https://github.com",
    "login": "octo"
  }
}`,
    );

    const result = await readCredentials({
      path: file,
      format: "jsonc",
      mapping: {},
      grab_fields: ["lastLoggedInUser.host", "lastLoggedInUser.login"],
      permissions: 0o600,
      atomic_write: true,
      preserve_unknown_fields: true,
    });

    expect(result).toEqual({
      credentials: {},
      grab_data: {
        "lastLoggedInUser.host": "https://github.com",
        "lastLoggedInUser.login": "octo",
      },
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/unit/provider-reader.test.ts
```

Expected: TypeScript/Vitest fails because `"jsonc"` is not assignable to the current `format: "json"` type.

- [ ] **Step 3: Write minimal implementation**

Update `src/types/index.ts`:

```ts
export type ProviderCredentialFileFormat = "json" | "jsonc";

export interface ProviderCredentialFile {
  path: string;
  format: ProviderCredentialFileFormat;
  mapping: Record<string, string>;
  grab_fields: string[];
  permissions: number;
  atomic_write: boolean;
  preserve_unknown_fields: boolean;
}

export interface ProviderExtraFile {
  path: string;
  format: ProviderCredentialFileFormat;
  grab_fields: string[];
  permissions: number;
}
```

Update `src/providers/json.ts`:

```ts
import fs from "node:fs/promises";
import { readJsonFile } from "../platform/fs.js";
import type { ProviderCredentialFileFormat } from "../types/index.js";

function stripJsonComments(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }

    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) {
        if (raw[i] === "\n") out += "\n";
        i++;
      }
      i++;
      continue;
    }

    out += ch;
  }

  return out;
}

export async function readProviderJsonFile<T>(
  filePath: string,
  format: ProviderCredentialFileFormat = "json",
): Promise<T> {
  if (format === "jsonc") {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(stripJsonComments(raw)) as T;
  }

  try {
    return await readJsonFile<T>(filePath);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(stripJsonComments(raw)) as T;
  }
}
```

Update `src/providers/reader.ts`:

```ts
  const raw = await readProviderJsonFile<Record<string, unknown>>(filePath, credFile.format);
```

Update `src/providers/writer.ts`:

```ts
    existing = await readProviderJsonFile<Record<string, unknown>>(filePath, credFile.format);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- --run tests/unit/provider-reader.test.ts
```

Expected: PASS for `provider-reader.test.ts`.

- [ ] **Step 5: Commit**

```powershell
git add src/types/index.ts src/providers/json.ts src/providers/reader.ts src/providers/writer.ts tests/unit/provider-reader.test.ts
git commit -m "Support explicit JSONC credential files"
```

---

### Task 2: Store Secret Diagnostics

**Files:**
- Modify: `src/providers/reader.ts`
- Modify: `tests/unit/provider-reader.test.ts`

- [ ] **Step 1: Write the failing test**

At the top of `tests/unit/provider-reader.test.ts`, before importing `readCredentials`, add a keytar mock:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const keytarMock = vi.hoisted(() => ({
  getKeytarPassword: vi.fn(async (_service: string, _account: string) => null as string | null),
}));

vi.mock("../../src/providers/keytar.js", () => keytarMock);
```

Replace the existing Vitest import line with the one above.

Append this test inside `describe("provider credential reader", ...)`:

```ts
  it("reports missing keytar secrets with service and account", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-reader-secret-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    await writeFile(
      file,
      JSON.stringify({
        lastLoggedInUser: {
          host: "https://github.com",
          login: "octo",
        },
      }),
    );

    await expect(readCredentials(
      {
        path: file,
        format: "jsonc",
        mapping: {},
        grab_fields: ["lastLoggedInUser.host", "lastLoggedInUser.login"],
        permissions: 0o600,
        atomic_write: true,
        preserve_unknown_fields: true,
      },
      [
        {
          backend: "keytar",
          service: "copilot-cli",
          account: "${grab_data.lastLoggedInUser.host}:${grab_data.lastLoggedInUser.login}",
          mapping: { access_token: "password" },
        },
      ],
    )).rejects.toThrow(/copilot-cli.*https:\/\/github\.com:octo|https:\/\/github\.com:octo.*copilot-cli/);
  });
```

In `afterEach`, add:

```ts
  keytarMock.getKeytarPassword.mockClear();
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/unit/provider-reader.test.ts
```

Expected: FAIL because `readCredentials()` currently silently skips missing keytar secrets.

- [ ] **Step 3: Write minimal implementation**

In `src/providers/reader.ts`, replace the keytar secret loop with:

```ts
  for (const secret of credentialSecrets) {
    if (secret.backend !== "keytar") continue;
    const account = interpolateSecretTemplate(secret.account, credentials, grab_data);
    if (!account) {
      throw new Error(`System credential store secret account is empty for service=${secret.service}`);
    }

    let password: string | null;
    try {
      password = await getKeytarPassword(secret.service, account);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`System credential store unavailable for backend=keytar service=${secret.service}: ${detail}`);
    }

    if (!password) {
      throw new Error(`System credential store secret not found: backend=keytar service=${secret.service} account=${account}`);
    }

    for (const [normKey, source] of Object.entries(secret.mapping)) {
      if (source === "password") credentials[normKey] = password;
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- --run tests/unit/provider-reader.test.ts tests/unit/provider-keytar.test.ts
```

Expected: PASS for both files. If the existing keytar happy-path test imports conflict with the new mock, keep mocks per file only; do not weaken the missing-secret assertion.

- [ ] **Step 5: Commit**

```powershell
git add src/providers/reader.ts tests/unit/provider-reader.test.ts
git commit -m "Report missing credential store secrets"
```

---

### Task 3: Enable Copilot JSONC Provider Contract

**Files:**
- Modify: `providers/copilot.yaml`
- Create: `tests/unit/provider-copilot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/provider-copilot.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadProvider } from "../../src/providers/loader.js";

const keytarMock = vi.hoisted(() => ({
  getKeytarPassword: vi.fn(async (_service: string, _account: string) => "gho_token"),
}));

vi.mock("../../src/providers/keytar.js", () => keytarMock);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
  keytarMock.getKeytarPassword.mockClear();
});

describe("copilot provider credentials", () => {
  it("declares jsonc metadata and reads the token from keytar", async () => {
    const provider = await loadProvider("copilot");
    const oauth = provider.auth_methods.oauth;
    expect(oauth).toBeDefined();
    expect(oauth?.credential_file.format).toBe("jsonc");

    const { readCredentials } = await import("../../src/providers/reader.js");
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-copilot-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    await writeFile(
      file,
      `// User settings belong in settings.json.
{
  "lastLoggedInUser": {
    "host": "https://github.com",
    "login": "octo"
  }
}`,
    );

    const result = await readCredentials(
      {
        ...oauth!.credential_file,
        path: file,
      },
      oauth!.credential_secrets,
    );

    expect(keytarMock.getKeytarPassword).toHaveBeenCalledWith("copilot-cli", "https://github.com:octo");
    expect(result).toEqual({
      credentials: { access_token: "gho_token" },
      grab_data: {
        "lastLoggedInUser.host": "https://github.com",
        "lastLoggedInUser.login": "octo",
      },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
npm test -- --run tests/unit/provider-copilot.test.ts
```

Expected: FAIL because `providers/copilot.yaml` still declares `format: json`.

- [ ] **Step 3: Write minimal implementation**

In `providers/copilot.yaml`, change:

```yaml
      format: json
```

to:

```yaml
      format: jsonc
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```powershell
npm test -- --run tests/unit/provider-copilot.test.ts tests/unit/provider-reader.test.ts tests/unit/provider-keytar.test.ts
```

Expected: PASS for all three files.

- [ ] **Step 5: Commit**

```powershell
git add providers/copilot.yaml tests/unit/provider-copilot.test.ts
git commit -m "Use JSONC metadata for Copilot credentials"
```

---

### Task 4: Final Verification and Runtime Smoke

**Files:**
- Verify only; no planned code changes.

- [ ] **Step 1: Run TypeScript build**

Run:

```powershell
npm run build
```

Expected: build exits with code 0.

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected: all Vitest files pass.

- [ ] **Step 3: Runtime Copilot grab smoke**

Run:

```powershell
node dist\index.js copilot grab profile@example.test
```

Expected: command scans the current user's `.copilot/config.json`, reads the
matching keytar account, and either updates/grabs the profile or reports a
precise store-secret error. It must not mention `hosts.json`.

- [ ] **Step 4: Inspect git state**

Run:

```powershell
git status --short --branch
git log --oneline -4
```

Expected: branch is ahead of origin by the implementation commits and no unrelated files are modified.

- [ ] **Step 5: Push**

Run:

```powershell
git push
```

Expected: `main -> main` push succeeds.
