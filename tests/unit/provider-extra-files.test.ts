import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readExtraFiles, writeExtraFiles } from "../../src/providers/extra-files.js";
import { writeCredentials } from "../../src/providers/writer.js";

const tempDirs: string[] = [];

vi.mock("../../src/platform/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/platform/index.js")>();
  return {
    ...actual,
    resolveTemplatePath: (p: string) => p,
  };
});

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("provider extra files", () => {
  it("reads and writes companion file grab_fields", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-extra-files-"));
    tempDirs.push(dir);
    const companion = path.join(dir, ".claude.json");
    await writeFile(
      companion,
      JSON.stringify({
        numStartups: 1,
        oauthAccount: { emailAddress: "a@example.com", organizationUuid: "org-a" },
      }),
    );

    const extraFiles = [
      {
        path: companion,
        format: "json" as const,
        grab_fields: ["oauthAccount"],
        permissions: 0o644,
      },
    ];

    const grabbed = await readExtraFiles(extraFiles);
    expect(grabbed.oauthAccount).toEqual({
      emailAddress: "a@example.com",
      organizationUuid: "org-a",
    });

    const writtenPaths = await writeExtraFiles(extraFiles, {
      oauthAccount: { emailAddress: "b@example.com", organizationUuid: "org-b" },
    });
    expect(writtenPaths).toEqual([companion]);

    const updated = JSON.parse(await readFile(companion, "utf-8"));
    expect(updated.numStartups).toBe(1);
    expect(updated.oauthAccount).toEqual({
      emailAddress: "b@example.com",
      organizationUuid: "org-b",
    });
  });

  it("credential writer does not leak extra-file grab_data into credential file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "airev-extra-files-"));
    tempDirs.push(dir);
    const cred = path.join(dir, ".credentials.json");
    await writeFile(cred, JSON.stringify({ claudeAiOauth: { accessToken: "old" } }));

    await writeCredentials(
      {
        path: cred,
        format: "json",
        mapping: { access_token: "claudeAiOauth.accessToken" },
        grab_fields: ["organizationUuid"],
        permissions: 0o600,
        atomic_write: true,
        preserve_unknown_fields: true,
      },
      {
        credentials: { access_token: "new" },
        grab_data: {
          organizationUuid: "org-b",
          oauthAccount: { emailAddress: "b@example.com" },
        },
      },
    );

    const written = JSON.parse(await readFile(cred, "utf-8"));
    expect(written.claudeAiOauth.accessToken).toBe("new");
    expect(written.organizationUuid).toBe("org-b");
    expect(written.oauthAccount).toBeUndefined();
  });
});