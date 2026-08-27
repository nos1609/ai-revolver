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

describe("qwen provider", () => {
  it("switches the current access and refresh token pair", async () => {
    const provider = loadProviderFromString(await readFile("providers/qwen.yaml", "utf8"));
    const oauth = provider.auth_methods.oauth!;
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-qwen-"));
    tempDirs.push(dir);
    const file = path.join(dir, "oauth_creds.json");
    await writeFile(file, JSON.stringify({
      access_token: "old-access",
      refresh_token: "old-refresh",
      expiry_date: 1,
      token_type: "Bearer",
      resource_url: "https://portal.qwen.ai",
      future_field: true,
    }));

    await writeCredentials(
      { ...oauth.credential_file, path: file },
      {
        credentials: {
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_at: 2,
        },
        grab_data: {
          token_type: "Bearer",
          resource_url: "https://portal.qwen.ai",
        },
      },
    );

    const written = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    expect(written).toMatchObject({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expiry_date: 2,
      future_field: true,
    });
    const read = await readCredentials({ ...oauth.credential_file, path: file });
    expect(read.credentials.refresh_token).toBe("new-refresh");
    expect(extractIdentityFromRaw(provider, written)?.refresh_token).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
  });

  it("refuses an incomplete token pair instead of mixing accounts", async () => {
    const provider = loadProviderFromString(await readFile("providers/qwen.yaml", "utf8"));
    const oauth = provider.auth_methods.oauth!;
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-qwen-required-"));
    tempDirs.push(dir);
    const file = path.join(dir, "oauth_creds.json");
    const original = {
      access_token: "current-access",
      refresh_token: "current-refresh",
      expiry_date: 1,
    };
    await writeFile(file, JSON.stringify(original));

    await expect(writeCredentials(
      { ...oauth.credential_file, path: file },
      {
        credentials: {
          refresh_token: "next-refresh",
          expires_at: 2,
        },
        grab_data: {},
      },
    )).rejects.toThrow(/required field: access_token/i);

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(original);

    await expect(writeCredentials(
      { ...oauth.credential_file, path: file },
      {
        credentials: {
          access_token: "next-access",
          expires_at: 2,
        },
        grab_data: {},
      },
    )).rejects.toThrow(/required field: refresh_token/i);

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(original);
  });
});
