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

  it("merge guard: poisoned incoming (empty refresh) does not clobber good existing on FS", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-writer-merge-"));
    tempDirs.push(dir);
    const file = path.join(dir, "creds.json");
    // Pre-populate FS with good refresh (simulates live CLI session after bad vault)
    await writeFile(file, JSON.stringify({ tokens: { access_token: "a", refresh_token: "rt_good" } }));

    await writeCredentials(
      {
        path: file,
        format: "json",
        mapping: {
          access_token: "tokens.access_token",
          refresh_token: "tokens.refresh_token",
        },
        grab_fields: [],
        permissions: 0o600,
        atomic_write: true,
        preserve_unknown_fields: true,
      },
      {
        // incoming from poisoned vault
        credentials: { access_token: "a2", refresh_token: "" },
        grab_data: {},
      },
    );

    const written = JSON.parse(await readFile(file, "utf-8"));
    expect(written.tokens.refresh_token).toBe("rt_good"); // kept, not clobbered
    expect(written.tokens.access_token).toBe("a2"); // non-sensitive / non-empty incoming wins
  });

  it("merge guard: empty incoming refresh never writes the key (both-sides-empty or absent)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-writer-merge-"));
    tempDirs.push(dir);
    const file = path.join(dir, "creds.json");
    await writeFile(file, JSON.stringify({ tokens: { access_token: "a" } })); // no refresh key yet

    await writeCredentials(
      {
        path: file,
        format: "json",
        mapping: {
          access_token: "tokens.access_token",
          refresh_token: "tokens.refresh_token",
        },
        grab_fields: [],
        permissions: 0o600,
        atomic_write: true,
        preserve_unknown_fields: true,
      },
      {
        credentials: { access_token: "a2", refresh_token: "" },
        grab_data: {},
      },
    );

    const written = JSON.parse(await readFile(file, "utf-8"));
    expect("refresh_token" in written.tokens).toBe(false); // never wrote ""
    expect(written.tokens.access_token).toBe("a2");
  });
});
