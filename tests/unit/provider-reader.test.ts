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
