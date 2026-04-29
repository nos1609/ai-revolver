import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getHome } from "../platform/index.js";

const require = createRequire(import.meta.url);

interface KeytarBinding {
  getPassword(service: string, account: string): Promise<string | null> | string | null;
  setPassword(service: string, account: string, password: string): Promise<void> | void;
}

let cached: KeytarBinding | null | undefined;

function latestCopilotKeytarNode(): string | undefined {
  const root = path.join(getHome(), ".copilot", "pkg", "universal");
  let versions: string[];
  try {
    versions = fs.readdirSync(root)
      .filter((entry) => fs.statSync(path.join(root, entry)).isDirectory())
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    return undefined;
  }

  for (const version of versions) {
    const candidate = path.join(root, version, "prebuilds", `${process.platform}-${process.arch}`, "keytar.node");
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function loadKeytar(): KeytarBinding {
  if (cached !== undefined) {
    if (!cached) throw new Error("keytar unavailable");
    return cached;
  }

  try {
    cached = require("keytar") as KeytarBinding;
    return cached;
  } catch {
    const keytarNode = latestCopilotKeytarNode();
    if (!keytarNode) {
      cached = null;
      throw new Error("keytar unavailable");
    }
    cached = require(keytarNode) as KeytarBinding;
    return cached;
  }
}

export async function getKeytarPassword(service: string, account: string): Promise<string | null> {
  return await loadKeytar().getPassword(service, account);
}

export async function setKeytarPassword(service: string, account: string, password: string): Promise<void> {
  await loadKeytar().setPassword(service, account, password);
}
