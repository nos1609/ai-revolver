import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const keytarMock = vi.hoisted(() => ({
  getKeytarPassword: vi.fn(async (_service: string, _account: string) => "gho_token"),
  setKeytarPassword: vi.fn(async () => undefined),
}));

vi.mock("../../src/providers/keytar.js", () => keytarMock);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
  vi.clearAllMocks();
});

describe("provider credential keytar integration", () => {
  it("reads keytar secrets using account data from the credential file", async () => {
    const { readCredentials } = await import("../../src/providers/reader.js");
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-keytar-read-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    await writeFile(
      file,
      `// User settings belong in settings.json.
// This file is managed automatically.
${JSON.stringify({ lastLoggedInUser: { host: "https://github.com", login: "octo" } })}`,
    );

    const result = await readCredentials(
      {
        path: file,
        format: "json",
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
    );

    expect(keytarMock.getKeytarPassword).toHaveBeenCalledWith("copilot-cli", "https://github.com:octo");
    expect(result.credentials).toEqual({ access_token: "gho_token" });
    expect(result.grab_data).toEqual({
      "lastLoggedInUser.host": "https://github.com",
      "lastLoggedInUser.login": "octo",
    });
  });

  it("writes keytar secrets and preserves the Copilot config file", async () => {
    const { writeCredentials } = await import("../../src/providers/writer.js");
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-keytar-write-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    await writeFile(
      file,
      `// User settings belong in settings.json.
${JSON.stringify({ firstLaunchAt: "2026-03-11T00:00:00.000Z" })}`,
    );

    await writeCredentials(
      {
        path: file,
        format: "json",
        mapping: {},
        grab_fields: ["lastLoggedInUser.host", "lastLoggedInUser.login"],
        permissions: 0o600,
        atomic_write: true,
        preserve_unknown_fields: true,
      },
      {
        credentials: { access_token: "gho_token" },
        grab_data: {
          "lastLoggedInUser.host": "https://github.com",
          "lastLoggedInUser.login": "octo",
        },
      },
      [
        {
          backend: "keytar",
          service: "copilot-cli",
          account: "${grab_data.lastLoggedInUser.host}:${grab_data.lastLoggedInUser.login}",
          mapping: { access_token: "password" },
        },
      ],
    );

    expect(keytarMock.setKeytarPassword).toHaveBeenCalledWith("copilot-cli", "https://github.com:octo", "gho_token");
    expect(JSON.parse(await readFile(file, "utf-8"))).toEqual({
      firstLaunchAt: "2026-03-11T00:00:00.000Z",
      lastLoggedInUser: {
        host: "https://github.com",
        login: "octo",
      },
    });
  });
});
