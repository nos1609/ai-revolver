import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ProviderDefinition } from "../types/index.js";
import { getConfigDir } from "../platform/index.js";
import { fileExists } from "../platform/fs.js";

/**
 * Validate the optional `identity` block in a parsed provider definition.
 * Throws a descriptive error on malformed data.
 */
function validateIdentity(def: ProviderDefinition): void {
  const id = def.identity;
  if (id === undefined || id === null) return;

  if (typeof id !== "object" || Array.isArray(id)) {
    throw new Error(`Provider "${def.name}": identity must be an object`);
  }

  if (!Array.isArray(id.fields) || id.fields.length === 0) {
    throw new Error(
      `Provider "${def.name}": identity.fields must be a non-empty array of strings`,
    );
  }
  for (const f of id.fields) {
    if (typeof f !== "string" || f.trim() === "") {
      throw new Error(
        `Provider "${def.name}": identity.fields entries must be non-empty strings (got ${JSON.stringify(f)})`,
      );
    }
  }

  if (!Array.isArray(id.display) || id.display.length === 0) {
    throw new Error(
      `Provider "${def.name}": identity.display must be a non-empty array of strings`,
    );
  }
  for (const d of id.display) {
    if (typeof d !== "string") {
      throw new Error(
        `Provider "${def.name}": identity.display entries must be strings (got ${JSON.stringify(d)})`,
      );
    }
  }
}

/**
 * Parse a provider definition from a raw YAML string and validate the optional
 * `identity` block. Throws on malformed identity fields.
 * Used in tests and for custom-provider validation without requiring a file path.
 */
export function loadProviderFromString(yamlText: string): ProviderDefinition {
  const def = parseYaml(yamlText) as ProviderDefinition;
  validateIdentity(def);
  return def;
}

/** Directories to scan for provider YAML files, in priority order */
function getProviderDirs(): string[] {
  const dirs: string[] = [];

  // User custom providers (highest priority)
  dirs.push(path.join(getConfigDir(), "providers"));

  // Built-in providers (bundled with package)
  // When running from dist/, go up to find providers/
  const builtIn = path.resolve(import.meta.dirname ?? __dirname, "../providers");
  dirs.push(builtIn);

  return dirs;
}

export async function loadProvider(name: string): Promise<ProviderDefinition> {
  for (const dir of getProviderDirs()) {
    const yamlPath = path.join(dir, `${name}.yaml`);
    if (await fileExists(yamlPath)) {
      const raw = await fs.readFile(yamlPath, "utf-8");
      const def = parseYaml(raw) as ProviderDefinition;
      validateIdentity(def);
      return def;
    }
  }
  throw new Error(`Provider "${name}" not found`);
}

export async function listProviders(): Promise<string[]> {
  const seen = new Set<string>();

  for (const dir of getProviderDirs()) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (entry.endsWith(".yaml")) {
          seen.add(entry.replace(/\.yaml$/, ""));
        }
      }
    } catch {
      // Directory doesn't exist — skip
    }
  }

  return [...seen].sort();
}
