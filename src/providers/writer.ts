import type { ProviderCredentialFile, ProfileCredentials } from "../types/index.js";
import { resolveTemplatePath } from "../platform/index.js";
import { readJsonFile, writeJsonFile, fileExists } from "../platform/fs.js";

/** Set a nested value by dot-separated path, creating intermediate objects */
function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = dotPath.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Merge-on-write: read existing file, overlay auth fields, write back.
 * Unknown fields are preserved (mcpOAuth etc.).
 */
export async function writeCredentials(
  credFile: ProviderCredentialFile,
  data: ProfileCredentials,
): Promise<void> {
  const filePath = resolveTemplatePath(credFile.path);

  // Read current file (or start empty if first run)
  let existing: Record<string, unknown> = {};
  if (await fileExists(filePath)) {
    existing = await readJsonFile<Record<string, unknown>>(filePath);
  }

  // Write mapping fields (normalised key → original json path)
  for (const [normKey, jsonPath] of Object.entries(credFile.mapping)) {
    if (normKey in data.credentials) {
      setByPath(existing, jsonPath, data.credentials[normKey]);
    }
  }

  // Write grab_data fields (path is the key)
  for (const [fieldPath, value] of Object.entries(data.grab_data)) {
    setByPath(existing, fieldPath, value);
  }

  const perms = typeof credFile.permissions === "number" ? credFile.permissions : 0o600;
  await writeJsonFile(filePath, existing, perms);
}
