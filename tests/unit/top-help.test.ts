import { describe, expect, it } from "vitest";
import { buildHelp } from "../../src/commands/top-help.js";

describe("top-level help", () => {
  it("renders the provider list from loaded provider names", () => {
    const help = buildHelp(["claude", "codex", "copilot", "gemini", "qodercli", "qwen"]);

    expect(help).toContain("claude, codex, copilot, gemini, qodercli, qwen");
  });
});
