import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { readCredentials } from "../../src/providers/reader.js";
import { writeCredentials } from "../../src/providers/writer.js";
import { loadProviderFromString } from "../../src/providers/loader.js";
import { checkIdentity } from "../../src/core/identity.js";
import { resolveBucketPath } from "../../src/providers/bucket.js";
import { pathSegments } from "../../src/core/path.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

const BUCKET = "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828";

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
    // after dynamic: grab_data uses relative keys + injected _auth
    expect(result.grab_data._auth_bucket_key).toBe(BUCKET);
    expect(result.grab_data.user_id).toBe("uid-001");
    expect(result.grab_data.email).toBe("grok@x.ai");
    expect(result.grab_data.team_id).toBe("team-grok");
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
          _auth_bucket_key: BUCKET,
          user_id: "new-uid",
          email: "new@x.ai",
          team_id: "new-team",
          auth_mode: "oauth",
          expires_at: "2026-06-23T00:00:00Z",
          first_name: "G",
          last_name: "Rok",
          // note: relative keys (per yaml with dynamic_bucket_prefix) + _auth_bucket_key
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
    expect(b.auth_mode).toBe("oauth");
    expect(b.expires_at).toBe("2026-06-23T00:00:00Z");
    expect(b.first_name).toBe("G");
    expect(b.last_name).toBe("Rok");
    expect(b.extra_unknown).toBe("must-stay");
    expect(b.create_time).toBe("2025-01-01"); // preserved via preserve_unknown_fields
  });

  it("loadProviderFromString validates identity block", async () => {
    const yamlText = await readFile("providers/grok.yaml", "utf-8");
    const prov = loadProviderFromString(yamlText);

    expect(prov.name).toBe("grok");
    expect(prov.version).toBe(1);
    expect(Array.isArray(prov.identity?.fields)).toBe(true);
    expect(prov.identity!.fields.length).toBeGreaterThan(0);
    expect(prov.identity!.fields[0]).toBe("user_id"); // relative under dynamic_bucket_prefix
    expect(Array.isArray(prov.identity?.display)).toBe(true);
    expect(prov.identity!.display.length).toBeGreaterThan(0);
    expect(prov.identity!.display[0]).toContain("email");
  });

  it("reader: works with dynamic_bucket_prefix and DIFFERENT bucket UUID (not hardcoded)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-grok-reader-dyn-"));
    tempDirs.push(dir);
    const file = path.join(dir, "auth.json");
    const DYN_BUCKET = "https://auth.x.ai::aaaa-bbbb-cccc";
    const sample: Record<string, any> = {
      [DYN_BUCKET]: {
        key: "sk-dyn-access-999",
        refresh_token: "rt-dyn-888",
        user_id: "uid-dyn",
        email: "dyn@x.ai",
        team_id: "team-dyn",
        principal_id: "prin-dyn",
        auth_mode: "oauth",
        create_time: "2025-01-01T00:00:00Z",
      },
    };
    await writeFile(file, JSON.stringify(sample, null, 2));

    // direct config with dynamic (simulates what yaml will declare after update)
    const result = await readCredentials({
      path: file,
      format: "json",
      mapping: {
        access_token: "key",
        refresh_token: "refresh_token",
      },
      grab_fields: ["user_id", "email", "team_id", "auth_mode", "expires_at", "first_name", "last_name"],
      permissions: 0o600,
      atomic_write: true,
      preserve_unknown_fields: true,
      dynamic_bucket_prefix: "https://auth.x.ai::",
    });

    expect(result.credentials.access_token).toBe("sk-dyn-access-999");
    expect(result.credentials.refresh_token).toBe("rt-dyn-888");
    expect(result.grab_data._auth_bucket_key).toBe(DYN_BUCKET);
    expect(result.grab_data.user_id).toBe("uid-dyn");
    expect(result.grab_data.email).toBe("dyn@x.ai");
  });

  it("writer: prunes old bucket key when switching to different _auth_bucket_key", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-grok-prune-"));
    tempDirs.push(dir);
    const file = path.join(dir, "auth.json");
    const OLD = "https://auth.x.ai::old-uuid-zzzz";
    const NEW = "https://auth.x.ai::aaaa-bbbb-cccc";
    // simulate file left with previous account + current
    await writeFile(
      file,
      JSON.stringify({
        [OLD]: { key: "old-access", refresh_token: "old-rt", user_id: "old-uid", email: "old@x.ai", extra: 1 },
        [NEW]: { key: "stale-new", refresh_token: "stale", user_id: "stale-uid" },
      }),
    );

    const dynCred = {
      path: file,
      format: "json" as const,
      mapping: { access_token: "key", refresh_token: "refresh_token" },
      grab_fields: ["user_id", "email", "team_id"],
      permissions: 0o600,
      atomic_write: true,
      preserve_unknown_fields: true,
      dynamic_bucket_prefix: "https://auth.x.ai::",
    };

    await writeCredentials(
      dynCred,
      {
        credentials: { access_token: "switched-access-777", refresh_token: "switched-rt-777" },
        grab_data: {
          _auth_bucket_key: NEW,
          user_id: "switched-uid",
          email: "switched@x.ai",
          team_id: "switched-team",
        },
      },
    );

    const after = JSON.parse(await readFile(file, "utf-8"));
    expect(after[NEW]).toBeDefined();
    expect(after[NEW].key).toBe("switched-access-777");
    expect(after[NEW].user_id).toBe("switched-uid");
    expect(after[NEW].email).toBe("switched@x.ai");
    expect(after[OLD]).toBeUndefined(); // pruned
    // no other prefix keys
    const prefixKeys = Object.keys(after).filter((k: string) => k.startsWith("https://auth.x.ai::"));
    expect(prefixKeys).toEqual([NEW]);
  });

  it("identity check: passes when vaultIdentity has legacy bracket key and fs has bucket content", async () => {
    const yamlText = await readFile("providers/grok.yaml", "utf-8");
    const prov = loadProviderFromString(yamlText);

    const LEGACY_BUCKET = "https://auth.x.ai::legacy-uuid-111";
    const legacyVaultIdentity: Record<string, unknown> = {
      [`['${LEGACY_BUCKET}'].user_id`]: "uid-legacy",
    };
    const fsRaw: Record<string, unknown> = {
      [LEGACY_BUCKET]: {
        key: "sk-legacy",
        user_id: "uid-legacy",
        email: "legacy@x.ai",
      },
    };

    const check = checkIdentity(prov, legacyVaultIdentity, fsRaw);
    expect(check.ok).toBe(true);
  });

  it("reader: readCredentials with 2 buckets + preferredKey from grab_data works", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-grok-read-pref-"));
    tempDirs.push(dir);
    const file = path.join(dir, "auth.json");
    const OLD = "https://auth.x.ai::old-multi-aaa";
    const NEW = "https://auth.x.ai::new-multi-bbb";
    await writeFile(
      file,
      JSON.stringify({
        [OLD]: { key: "oldk", user_id: "oldu", email: "old@x" },
        [NEW]: { key: "newk", user_id: "newu", email: "new@x.ai" },
      }),
    );

    const dynCred = {
      path: file,
      format: "json" as const,
      mapping: { access_token: "key", refresh_token: "refresh_token" },
      grab_fields: ["user_id", "email"],
      permissions: 0o600,
      atomic_write: true,
      preserve_unknown_fields: true,
      dynamic_bucket_prefix: "https://auth.x.ai::",
    };

    // pass preferred as 4th arg (simulates from grab_data._auth_bucket_key)
    const result = await readCredentials(dynCred, [], undefined, NEW);

    expect(result.grab_data._auth_bucket_key).toBe(NEW);
    expect(result.credentials.access_token).toBe("newk");
    expect(result.grab_data.user_id).toBe("newu");
  });

  it("writer: writeCredentials with legacy grab_data (no _auth_bucket_key) but existing has bucket succeeds (fallback)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-grok-write-legacy-"));
    tempDirs.push(dir);
    const file = path.join(dir, "auth.json");
    const B = "https://auth.x.ai::fallback-bucket-ccc";
    await writeFile(
      file,
      JSON.stringify({
        [B]: { key: "old-access", user_id: "old-uid", email: "old@x.ai", extra_unknown: "keep" },
      }),
    );

    const dynCred = {
      path: file,
      format: "json" as const,
      mapping: { access_token: "key", refresh_token: "refresh_token" },
      grab_fields: ["user_id", "email"],
      permissions: 0o600,
      atomic_write: true,
      preserve_unknown_fields: true,
      dynamic_bucket_prefix: "https://auth.x.ai::",
    };

    await writeCredentials(dynCred, {
      credentials: { access_token: "fallback-new-key" },
      grab_data: {
        // deliberately no _auth_bucket_key (legacy vault entry)
        user_id: "fallback-uid",
        email: "fallback@x.ai",
      },
    });

    const after = JSON.parse(await readFile(file, "utf-8"));
    expect(after[B]).toBeDefined();
    expect(after[B].key).toBe("fallback-new-key");
    expect(after[B].user_id).toBe("fallback-uid");
    expect(after[B].email).toBe("fallback@x.ai");
    expect(after[B].extra_unknown).toBe("keep");
    const prefixKeys = Object.keys(after).filter((k: string) => k.startsWith("https://auth.x.ai::"));
    expect(prefixKeys).toEqual([B]);
  });

  it("bucket: resolveBucketPath escapes ' in bucketKey; pathSegments unescapes", () => {
    const bucketWithQuote = "https://auth.x.ai::user'with'quote-123";
    const resolved = resolveBucketPath("user_id", bucketWithQuote);
    expect(resolved).toBe("['https://auth.x.ai::user\\'with\\'quote-123'].user_id");
    const segments = pathSegments(resolved);
    expect(segments).toEqual([bucketWithQuote, "user_id"]);
    // also verify no-escape normal case
    const normal = resolveBucketPath("email", "https://auth.x.ai::noquote");
    expect(normal).toBe("['https://auth.x.ai::noquote'].email");
    expect(pathSegments(normal)).toEqual(["https://auth.x.ai::noquote", "email"]);
  });
});
