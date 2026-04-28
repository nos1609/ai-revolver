import { describe, expect, it } from "vitest";
import { generateCompletionScript, parseCompletionShell } from "../../src/completion/generate.js";

describe("completion generator", () => {
  const providers = ["claude", "codex", "gemini", "qwen"];

  it("accepts supported shells and rejects unknown shells", () => {
    expect(parseCompletionShell(undefined)).toBe("bash");
    expect(parseCompletionShell("bash")).toBe("bash");
    expect(parseCompletionShell("zsh")).toBe("zsh");
    expect(parseCompletionShell("fish")).toBe("fish");
    expect(parseCompletionShell("powershell")).toBe("powershell");

    expect(() => parseCompletionShell("cmd")).toThrow(/Unknown completion shell|Неизвестный shell/i);
  });

  it("generates shell scripts with commands providers actions and flags", () => {
    for (const shell of ["bash", "zsh", "fish", "powershell"] as const) {
      const script = generateCompletionScript({ shell, providers });

      expect(script).toContain("airev");
      expect(script).toContain("completion");
      expect(script).toContain("vault");
      expect(script).toContain("codex");
      expect(script).toContain("claude");
      expect(script).toContain("grab");
      expect(script).toContain("migrate");
      expect(script).toContain("--shell");
      expect(script).toContain("powershell");
    }
  });
});
