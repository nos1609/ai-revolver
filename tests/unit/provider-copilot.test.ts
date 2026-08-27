import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import type { ProviderDefinition } from "../../src/types/index.js";

const tokenStoreMock = vi.hoisted(() => ({
  getCopilotToken: vi.fn(async () => "gho_token"),
  setCopilotToken: vi.fn(async () => undefined),
}));

vi.mock("../../src/providers/copilot-token-store.js", () => tokenStoreMock);

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
  tokenStoreMock.getCopilotToken.mockClear();
  tokenStoreMock.setCopilotToken.mockClear();
});

describe("copilot provider credentials", () => {
  it("declares JSONC metadata and reads the token through the current CLI store", async () => {
    const provider = parseYaml(await readFile("providers/copilot.yaml", "utf-8")) as ProviderDefinition;
    const oauth = provider.auth_methods.oauth;
    expect(oauth).toBeDefined();
    expect(oauth?.credential_file.format).toBe("jsonc");

    const { readCredentials } = await import("../../src/providers/reader.js");
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-copilot-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    await writeFile(
      file,
      `// User settings belong in settings.json.
{
  "lastLoggedInUser": {
    "host": "https://github.com",
    "login": "octo"
  }
}`,
    );

    const result = await readCredentials(
      {
        ...oauth!.credential_file,
        path: file,
      },
      oauth!.credential_secrets,
    );

    expect(oauth?.credential_secrets?.[0]?.backend).toBe("copilot-token-store");
    expect(tokenStoreMock.getCopilotToken).toHaveBeenCalledWith(
      file,
      "https://github.com",
      "octo",
      false,
    );
    expect(result).toEqual({
      credentials: { access_token: "gho_token" },
      grab_data: {
        "lastLoggedInUser.host": "https://github.com",
        "lastLoggedInUser.login": "octo",
      },
    });
  });

  it("writes the selected token through the current CLI store", async () => {
    const provider = parseYaml(await readFile("providers/copilot.yaml", "utf-8")) as ProviderDefinition;
    const oauth = provider.auth_methods.oauth!;
    const { writeCredentials } = await import("../../src/providers/writer.js");
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-copilot-write-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    await writeFile(file, "{}\n");

    await writeCredentials(
      { ...oauth.credential_file, path: file },
      {
        credentials: { access_token: "gho_selected" },
        grab_data: {
          "lastLoggedInUser.host": "github.com",
          "lastLoggedInUser.login": "octo",
          storeTokenPlaintext: true,
        },
      },
      oauth.credential_secrets,
    );

    expect(tokenStoreMock.setCopilotToken).toHaveBeenCalledWith(
      file,
      "github.com",
      "octo",
      "gho_selected",
      true,
    );
    const written = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
    expect(written).toMatchObject({
      lastLoggedInUser: { host: "github.com", login: "octo" },
      storeTokenPlaintext: true,
    });
  });

  it("rejects missing token before changing Copilot metadata", async () => {
    const provider = parseYaml(await readFile("providers/copilot.yaml", "utf-8")) as ProviderDefinition;
    const oauth = provider.auth_methods.oauth!;
    const { writeCredentials } = await import("../../src/providers/writer.js");
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-copilot-required-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    const original = '{"firstLaunchAt":"fixture"}\n';
    await writeFile(file, original);

    await expect(writeCredentials(
      { ...oauth.credential_file, path: file },
      {
        credentials: {},
        grab_data: {
          "lastLoggedInUser.host": "github.com",
          "lastLoggedInUser.login": "octo",
        },
      },
      oauth.credential_secrets,
    )).rejects.toThrow(/external credential store.*access_token/i);

    expect(await readFile(file, "utf8")).toBe(original);
    expect(tokenStoreMock.setCopilotToken).not.toHaveBeenCalled();
  });

  it("does not change metadata when the Copilot token store rejects the write", async () => {
    const provider = parseYaml(await readFile("providers/copilot.yaml", "utf-8")) as ProviderDefinition;
    const oauth = provider.auth_methods.oauth!;
    const { writeCredentials } = await import("../../src/providers/writer.js");
    const dir = await mkdtemp(path.join(tmpdir(), "airev-provider-copilot-store-failure-"));
    tempDirs.push(dir);
    const file = path.join(dir, "config.json");
    const original = '{"firstLaunchAt":"fixture"}\n';
    await writeFile(file, original);
    tokenStoreMock.setCopilotToken.mockRejectedValueOnce(new Error("store unavailable"));

    await expect(writeCredentials(
      { ...oauth.credential_file, path: file },
      {
        credentials: { access_token: "gho_selected" },
        grab_data: {
          "lastLoggedInUser.host": "github.com",
          "lastLoggedInUser.login": "octo",
        },
      },
      oauth.credential_secrets,
    )).rejects.toThrow(/store unavailable/i);

    expect(await readFile(file, "utf8")).toBe(original);
  });
});
