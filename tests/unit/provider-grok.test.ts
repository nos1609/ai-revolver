import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readCredentials } from "../../src/providers/reader.js";
import { writeCredentials } from "../../src/providers/writer.js";
import { loadProviderFromString } from "../../src/providers/loader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const BUCKET = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";
const BR = (p: string) => `['${BUCKET}'].${p}`;

describe("grok provider", () => {
  it("reader: bracket key with :: reads .key as access_token", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-grok-reader-"));
    tempDirs.push(dir);
    const file = path.join(dir, "auth.json");
    const sample: Record<string, any> = {
      [BUCKET]: {
        key: "sk-grok-access-xyz123",
        refresh_token: "rt-grok-abc456",
        expires_at: "2026-06-23T00:00:00Z",
        user_id: "uid-001",
        email: "grok@x.ai",
        team_id: "team-grok",
        principal_id: "prin-42",
        auth_mode: "oauth",
        create_time: "2025-01-01T00:00:00Z",
      },
    };
    await writeFile(file, JSON.stringify(sample, null, 2));

    const yamlText = await readFile("providers/grok.yaml", "utf-8");
    const prov = parseYaml(yamlText) as any;
    const cred = prov.auth_methods.oauth.credential_file;

    const result = await readCredentials({
      ...cred,
      path: file,
    });

    expect(result.credentials.access_token).toBe("sk-grok-access-xyz123");
    expect(result.credentials.refresh_token).toBe("rt-grok-abc456");
    expect(result.grab_data[BR("user_id")]).toBe("uid-001");
    expect(result.grab_data[BR("email")]).toBe("grok@x.ai");
    expect(result.grab_data[BR("team_id")]).toBe("team-grok");
  });

  it("writer: round-trip write preserves metadata grab_fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-grok-writer-"));
    tempDirs.push(dir);
    const file = path.join(dir, "auth.json");

    // start with some existing content + unknown field to test preserve
    const initial: Record<string, any> = {
      [BUCKET]: {
        key: "old-key",
        refresh_token: "old-rt",
        user_id: "old-uid",
        email: "old@x.ai",
        extra_unknown: "must-stay",
        create_time: "2025-01-01",
      },
    };
    await writeFile(file, JSON.stringify(initial));

    const yamlText = await readFile("providers/grok.yaml", "utf-8");
    const prov = parseYaml(yamlText) as any;
    const cred = prov.auth_methods.oauth.credential_file;

    await writeCredentials(
      {
        ...cred,
        path: file,
      },
      {
        credentials: {
          access_token: "new-key-999",
          refresh_token: "new-rt-999",
        },
        grab_data: {
          [BR("user_id")]: "new-uid",
          [BR("email")]: "new@x.ai",
          [BR("team_id")]: "new-team",
          [BR("principal_id")]: "new-prin",
          // note: only listed grab_fields present in this grab_data will be written
        },
      },
    );

    const written = JSON.parse(await readFile(file, "utf-8"));
    const b = written[BUCKET];
    expect(b.key).toBe("new-key-999");
    expect(b.refresh_token).toBe("new-rt-999");
    expect(b.user_id).toBe("new-uid");
    expect(b.email).toBe("new@x.ai");
    expect(b.team_id).toBe("new-team");
    expect(b.principal_id).toBe("new-prin");
    expect(b.extra_unknown).toBe("must-stay");
    expect(b.create_time).toBe("2025-01-01");
  });

  it("loadProviderFromString validates identity block", async () => {
    const yamlText = await readFile("providers/grok.yaml", "utf-8");
    const prov = loadProviderFromString(yamlText);

    expect(prov.name).toBe("grok");
    expect(prov.version).toBe(1);
    expect(Array.isArray(prov.identity?.fields)).toBe(true);
    expect(prov.identity!.fields.length).toBeGreaterThan(0);
    expect(prov.identity!.fields[0]).toContain("https://auth.x.ai::b1a00492");
    expect(Array.isArray(prov.identity?.display)).toBe(true);
    expect(prov.identity!.display.length).toBeGreaterThan(0);
    expect(prov.identity!.display[0]).toContain("email");
  });
});
