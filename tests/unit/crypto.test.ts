import { describe, it, expect } from "vitest";
import {
  encryptWithPassword,
  decryptWithPassword,
  type EncryptedEnvelope,
} from "../../src/vault/crypto.js";

describe("vault/crypto", () => {
  it("roundtrip: decrypt(encrypt(x)) === x", () => {
    const plain = "пароль123 + secret data {}";
    const env = encryptWithPassword(plain, "correct horse battery staple");
    expect(decryptWithPassword(env, "correct horse battery staple")).toBe(plain);
  });

  it("roundtrip on empty string", () => {
    const env = encryptWithPassword("", "p");
    expect(decryptWithPassword(env, "p")).toBe("");
  });

  it("roundtrip on multi-KB payload", () => {
    const plain = "x".repeat(8192);
    const env = encryptWithPassword(plain, "p");
    expect(decryptWithPassword(env, "p")).toBe(plain);
  });

  it("envelope has expected shape (version, salt, iv, tag, data hex)", () => {
    const env = encryptWithPassword("hi", "p");
    expect(env.version).toBe(1);
    // salt 32B, iv 12B, tag 16B — hex = 2× bytes
    expect(env.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(env.iv).toMatch(/^[0-9a-f]{24}$/);
    expect(env.tag).toMatch(/^[0-9a-f]{32}$/);
    expect(env.data).toMatch(/^[0-9a-f]*$/);
  });

  it("wrong password throws (GCM auth tag mismatch)", () => {
    const env = encryptWithPassword("secret", "right");
    expect(() => decryptWithPassword(env, "wrong")).toThrow();
  });

  it("each encrypt call produces fresh salt + iv (non-deterministic)", () => {
    const a = encryptWithPassword("same", "same");
    const b = encryptWithPassword("same", "same");
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("tampered ciphertext is rejected", () => {
    const env = encryptWithPassword("hello", "p");
    // Flip last nibble of data. If data is empty (rare but possible), skip.
    if (!env.data) return;
    const flipped = env.data.slice(0, -1) + (env.data.endsWith("0") ? "1" : "0");
    const tampered: EncryptedEnvelope = { ...env, data: flipped };
    expect(() => decryptWithPassword(tampered, "p")).toThrow();
  });

  it("tampered auth tag is rejected", () => {
    const env = encryptWithPassword("hello", "p");
    const flipped = env.tag.slice(0, -1) + (env.tag.endsWith("0") ? "1" : "0");
    const tampered: EncryptedEnvelope = { ...env, tag: flipped };
    expect(() => decryptWithPassword(tampered, "p")).toThrow();
  });

  it("tampered iv is rejected (auth tag no longer matches)", () => {
    const env = encryptWithPassword("hello", "p");
    const flipped = env.iv.slice(0, -1) + (env.iv.endsWith("0") ? "1" : "0");
    const tampered: EncryptedEnvelope = { ...env, iv: flipped };
    expect(() => decryptWithPassword(tampered, "p")).toThrow();
  });

  it("tampered salt leads to wrong key and rejection", () => {
    const env = encryptWithPassword("hello", "p");
    const flipped = env.salt.slice(0, -1) + (env.salt.endsWith("0") ? "1" : "0");
    const tampered: EncryptedEnvelope = { ...env, salt: flipped };
    expect(() => decryptWithPassword(tampered, "p")).toThrow();
  });
});
