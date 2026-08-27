import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { packageVersion } from "../../src/version.js";

describe("package version", () => {
  it("uses package.json as the CLI version source", async () => {
    const metadata = JSON.parse(await readFile("package.json", "utf8")) as {
      version: string;
    };

    expect(packageVersion()).toBe(metadata.version);
  });
});
