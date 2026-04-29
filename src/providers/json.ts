import fs from "node:fs/promises";
import { readJsonFile } from "../platform/fs.js";
import type { ProviderCredentialFileFormat } from "../types/index.js";

function stripJsonComments(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
      continue;
    }

    if (ch === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) {
        if (raw[i] === "\n") out += "\n";
        i++;
      }
      i++;
      continue;
    }

    out += ch;
  }

  return out;
}

function stripJsonTrailingCommas(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j++;
      if (raw[j] === "}" || raw[j] === "]") continue;
    }

    out += ch;
  }

  return out;
}

function parseJsonc<T>(raw: string): T {
  return JSON.parse(stripJsonTrailingCommas(stripJsonComments(raw))) as T;
}

export async function readProviderJsonFile<T>(
  filePath: string,
  format: ProviderCredentialFileFormat = "json",
): Promise<T> {
  if (format === "jsonc") {
    const raw = await fs.readFile(filePath, "utf-8");
    return parseJsonc<T>(raw);
  }

  try {
    return await readJsonFile<T>(filePath);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    const raw = await fs.readFile(filePath, "utf-8");
    return parseJsonc<T>(raw);
  }
}
