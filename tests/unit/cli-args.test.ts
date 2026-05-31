import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.js";

describe("CLI args parser", () => {
  it("does not treat --force before profile name as the profile name", () => {
    expect(parseArgs(["codex", "grab", "--force", "ns@onstudy.org"])).toEqual({
      positionals: ["codex", "grab", "ns@onstudy.org"],
      options: { "--force": true },
      unknownOptions: [],
    });
  });

  it("does not treat --force after profile name as a second positional", () => {
    expect(parseArgs(["codex", "grab", "ns@onstudy.org", "--force"])).toEqual({
      positionals: ["codex", "grab", "ns@onstudy.org"],
      options: { "--force": true },
      unknownOptions: [],
    });
  });

  it("allows dash-prefixed literal profile names only after --", () => {
    expect(parseArgs(["codex", "drop", "--", "--force"])).toEqual({
      positionals: ["codex", "drop", "--force"],
      options: {},
      unknownOptions: [],
    });
  });

  it("reports unknown dash-prefixed tokens before -- as options", () => {
    expect(parseArgs(["codex", "grab", "--froce", "work"])).toEqual({
      positionals: ["codex", "grab", "work"],
      options: {},
      unknownOptions: ["--froce"],
    });
  });
});
