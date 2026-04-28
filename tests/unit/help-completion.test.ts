import { afterEach, describe, expect, it } from "vitest";

describe("completion help", () => {
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
  });

  it("has action-level help for completion with all supported shells", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    const { hasActionHelp, printActionHelp } = await import("../../src/commands/help.js");

    expect(hasActionHelp("completion")).toBe(true);

    printActionHelp("completion");

    const output = logs.join("\n");
    expect(output).toContain("airev completion");
    expect(output).toContain("bash");
    expect(output).toContain("zsh");
    expect(output).toContain("fish");
    expect(output).toContain("powershell");
  });
});
