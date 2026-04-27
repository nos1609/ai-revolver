import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existingVaultPasswordPromptLabel,
  newVaultPasswordPromptLabels,
  promptPassword,
  transportPasswordPromptLabel,
} from "../../src/vault/prompt.js";

class FakeStdin extends EventEmitter {
  isTTY = false;
  resume = vi.fn();
  pause = vi.fn();
  setEncoding = vi.fn();
  setRawMode = vi.fn();
}

const originalStdin = process.stdin;
const originalStdoutWrite = process.stdout.write;

afterEach(() => {
  Object.defineProperty(process, "stdin", { configurable: true, value: originalStdin });
  process.stdout.write = originalStdoutWrite;
});

describe("vault password prompt labels", () => {
  it("labels export password as a transfer file password in English", () => {
    expect(transportPasswordPromptLabel("export", "ru")).toContain("Транспортный пароль export-файла");
    expect(transportPasswordPromptLabel("export", "en")).toContain("Export transfer file password");
  });

  it("labels import password as a transfer file password in English", () => {
    expect(transportPasswordPromptLabel("import", "ru")).toContain("Транспортный пароль import-файла");
    expect(transportPasswordPromptLabel("import", "en")).toContain("Import transfer file password");
  });

  it("labels new local vault password separately from the file-transfer password", () => {
    expect(newVaultPasswordPromptLabels("ru")).toEqual({
      password: "  🔐 Новый пароль локального vault-а: ",
      confirm: "  🔐 Повтори пароль локального vault-а: ",
    });
    expect(newVaultPasswordPromptLabels("en")).toEqual({
      password: "  🔐 New local vault password: ",
      confirm: "  🔐 Confirm local vault password: ",
    });
  });

  it("labels existing local vault password without confirmation wording", () => {
    expect(existingVaultPasswordPromptLabel("ru")).toBe("  🔐 Пароль локального vault-а: ");
    expect(existingVaultPasswordPromptLabel("en")).toBe("  🔐 Local vault password: ");
  });
});

describe("promptPassword input behavior", () => {
  it("resolves chunked piped input that includes a newline", async () => {
    const stdin = new FakeStdin();
    const writes: string[] = [];
    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    process.stdout.write = ((chunk: string) => {
      writes.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    const result = promptPassword("Password: ");
    stdin.emit("data", "secret\n");

    await expect(result).resolves.toBe("secret");
    expect(writes.join("")).toContain("Password: ******\n");
  });

  it("resolves EOF after a password in piped mode", async () => {
    const stdin = new FakeStdin();
    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    process.stdout.write = vi.fn(() => true) as unknown as typeof process.stdout.write;

    const result = promptPassword("Password: ");
    stdin.emit("data", "secret");
    stdin.emit("end");

    await expect(result).resolves.toBe("secret");
  });

  it("handles sequential prompts in the same process", async () => {
    const stdin = new FakeStdin();
    Object.defineProperty(process, "stdin", { configurable: true, value: stdin });
    process.stdout.write = vi.fn(() => true) as unknown as typeof process.stdout.write;

    const first = promptPassword("First: ");
    stdin.emit("data", "one\n");
    await expect(first).resolves.toBe("one");

    const second = promptPassword("Second: ");
    stdin.emit("data", "two\n");
    await expect(second).resolves.toBe("two");
  });
});
