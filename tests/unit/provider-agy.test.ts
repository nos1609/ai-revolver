import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadProviderFromString } from "../../src/providers/loader.js";
import { readCredentials } from "../../src/providers/reader.js";
import { writeCredentials } from "../../src/providers/writer.js";
import { extractIdentityFromRaw } from "../../src/core/identity.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("agy provider", () => {
  it("round-trips the current Antigravity OAuth shape", async () => {
    const provider = loadProviderFromString(await readFile("providers/agy.yaml", "utf8"));
    const oauth = provider.auth_methods.oauth!;
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-agy-"));
    tempDirs.push(dir);
    const file = path.join(dir, "antigravity-oauth-token");
    const fixture = {
      auth_method: "google",
      token: {
        access_token: "access-current",
        refresh_token: "refresh-current",
        expiry: "2026-08-28T00:00:00Z",
        token_type: "Bearer",
      },
      future_field: { preserved: true },
    };
    await writeFile(file, JSON.stringify(fixture));

    const read = await readCredentials({ ...oauth.credential_file, path: file });
    expect(read).toEqual({
      credentials: {
        access_token: "access-current",
        refresh_token: "refresh-current",
        expires_at: "2026-08-28T00:00:00Z",
      },
      grab_data: {
        auth_method: "google",
        "token.token_type": "Bearer",
      },
    });

    await writeCredentials(
      { ...oauth.credential_file, path: file },
      read,
    );
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(fixture);
  });

  it("stores only a digest as identity", async () => {
    const provider = loadProviderFromString(await readFile("providers/agy.yaml", "utf8"));
    const identity = extractIdentityFromRaw(provider, {
      token: { refresh_token: "refresh-secret" },
    });

    expect(identity?.["token.refresh_token"]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(String(identity?.["token.refresh_token"])).not.toContain("refresh-secret");
  });

  it("rejects an incomplete token pair", async () => {
    const provider = loadProviderFromString(await readFile("providers/agy.yaml", "utf8"));
    const oauth = provider.auth_methods.oauth!;
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-agy-required-"));
    tempDirs.push(dir);
    const file = path.join(dir, "antigravity-oauth-token");
    await writeFile(file, JSON.stringify({
      auth_method: "google",
      token: { refresh_token: "refresh-only" },
    }));

    await expect(readCredentials({ ...oauth.credential_file, path: file }))
      .rejects.toThrow(/required mapped field: access_token/i);
  });
});
