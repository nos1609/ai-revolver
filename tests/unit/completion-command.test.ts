import { afterEach, describe, expect, it, vi } from "vitest";

const providersMock = vi.hoisted(() => ({
  listProviders: vi.fn(async () => ["claude", "codex", "gemini", "qodercli", "qwen"]),
}));

vi.mock("../../src/providers/loader.js", () => providersMock);

describe("completion command", () => {
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
    vi.clearAllMocks();
  });

  it("prints bash completion by default", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    const { completionCommand } = await import("../../src/commands/completion.js");

    await completionCommand(undefined);

    expect(providersMock.listProviders).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain("airev");
    expect(logs.join("\n")).toContain("complete");
  });

  it("prints powershell completion when requested", async () => {
    const logs: string[] = [];
    console.log = ((value?: unknown) => {
      logs.push(String(value ?? ""));
    }) as typeof console.log;
    const { completionCommand } = await import("../../src/commands/completion.js");

    await completionCommand("powershell");

    expect(providersMock.listProviders).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).toContain("Register-ArgumentCompleter");
  });

  it("rejects unsupported shells before loading providers", async () => {
    const { completionCommand } = await import("../../src/commands/completion.js");

    await expect(completionCommand("cmd")).rejects.toThrow(/Unknown completion shell|Неизвестный shell/i);

    expect(providersMock.listProviders).not.toHaveBeenCalled();
  });
});
