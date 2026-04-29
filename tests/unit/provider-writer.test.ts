import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCredentials } from "../../src/providers/writer.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("provider credential writer", () => {
  it("writes bracket-quoted JSON keys that contain dots", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-writer-"));
    tempDirs.push(dir);
    const file = path.join(dir, "hosts.json");
    await writeFile(file, JSON.stringify({ "github.com": { user: "octo" } }));

    await writeCredentials(
      {
        path: file,
        format: "json",
        mapping: {
          access_token: "['github.com'].oauth_token",
        },
        grab_fields: ["['github.com'].user"],
        permissions: 0o600,
        atomic_write: true,
        preserve_unknown_fields: true,
      },
      {
        credentials: { access_token: "ghu_token" },
        grab_data: { "['github.com'].user": "octo" },
      },
    );

    const written = JSON.parse(await readFile(file, "utf-8"));
    expect(written).toEqual({
      "github.com": {
        oauth_token: "ghu_token",
        user: "octo",
      },
    });
  });
});
