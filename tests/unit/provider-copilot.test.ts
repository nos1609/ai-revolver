import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import type { ProviderDefinition } from "../../src/types/index.js";

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
    const provider = parseYaml(await readFile("providers/copilot.yaml", "utf-8")) as ProviderDefinition;
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
