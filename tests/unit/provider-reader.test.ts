import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCredentials } from "../../src/providers/reader.js";

const keytarMock = vi.hoisted(() => ({
  getKeytarPassword: vi.fn(async (_service: string, _account: string) => null as string | null),
}));

vi.mock("../../src/providers/keytar.js", () => keytarMock);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
  keytarMock.getKeytarPassword.mockClear();
});

describe("provider credential reader", () => {
  it("reads explicit jsonc credential files with comments and trailing commas", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-reader-jsonc-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    await writeFile(
      file,
      `// User settings belong in settings.json.
{
  "lastLoggedInUser": {
    "host": "https://github.com",
    "login": "octo",
  },
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

  it("reads bracket-quoted JSON keys that contain dots", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-reader-"));
    tempDirs.push(dir);
    const file = path.join(dir, "hosts.json");
    await writeFile(
      file,
      JSON.stringify({
        "github.com": {
          oauth_token: "ghu_token",
          user: "octo",
        },
      }),
    );

    const result = await readCredentials({
      path: file,
      format: "json",
      mapping: {
        access_token: "['github.com'].oauth_token",
      },
      grab_fields: ["['github.com'].user"],
      permissions: 0o600,
      atomic_write: true,
      preserve_unknown_fields: true,
    });

    expect(result).toEqual({
      credentials: { access_token: "ghu_token" },
      grab_data: { "['github.com'].user": "octo" },
    });
  });

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

  it("binary-passthrough: reads file content as a single credential field, no JSON parse", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-reader-binary-"));
    tempDirs.push(dir);
    const file = path.join(dir, "user");
    // Not JSON — proves reader does not attempt to parse.
    const blob = "jr8OM2/T8IRU_base64_looking_opaque_blob+padding==";
    await writeFile(file, blob);

    const result = await readCredentials({
      path: file,
      format: "binary-passthrough",
      mapping: { user_blob: "." },
      grab_fields: [],
      permissions: 0o600,
      atomic_write: true,
      preserve_unknown_fields: false,
    });

    expect(result).toEqual({
      credentials: { user_blob: blob },
      grab_data: {},
    });
  });

  it("binary-passthrough: skips keytar secrets even if credential_secrets are declared", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-reader-binary-keytar-"));
    tempDirs.push(dir);
    const file = path.join(dir, "user");
    await writeFile(file, "opaque-blob");

    const result = await readCredentials(
      {
        path: file,
        format: "binary-passthrough",
        mapping: { user_blob: "." },
        grab_fields: [],
        permissions: 0o600,
        atomic_write: true,
        preserve_unknown_fields: false,
      },
      [
        {
          backend: "keytar",
          service: "would-fail",
          account: "missing",
          mapping: { access_token: "password" },
        },
      ],
    );

    expect(result.credentials).toEqual({ user_blob: "opaque-blob" });
    expect(keytarMock.getKeytarPassword).not.toHaveBeenCalled();
  });
});
