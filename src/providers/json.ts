import fs from "node:fs/promises";
import { readJsonFile } from "../platform/fs.js";

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

export async function readProviderJsonFile<T>(filePath: string): Promise<T> {
  try {
    return await readJsonFile<T>(filePath);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(stripJsonComments(raw)) as T;
  }
}
