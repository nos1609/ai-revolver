import { describe, expect, it } from "vitest";
import { buildHelp } from "../../src/commands/top-help.js";

describe("top-level help", () => {
  it("renders the provider list from loaded provider names", () => {
    const help = buildHelp(["agy", "claude", "codex", "copilot", "qodercli", "qwen"]);

    expect(help).toContain("agy, claude, codex, copilot, qodercli, qwen");
  });
});
