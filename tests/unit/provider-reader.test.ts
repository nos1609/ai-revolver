import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readCredentials } from "../../src/providers/reader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
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
});
