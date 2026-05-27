import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ProviderDefinition } from "../types/index.js";
import { getConfigDir } from "../platform/index.js";
import { fileExists } from "../platform/fs.js";

/**
 * Parse a provider definition from a raw YAML string.
 * Used in tests and for custom-provider validation without requiring a file path.
 */
export function loadProviderFromString(yamlText: string): ProviderDefinition {
  return parseYaml(yamlText) as ProviderDefinition;
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
      return parseYaml(raw) as ProviderDefinition;
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
