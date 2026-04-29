import type { ProviderCredentialFile, ProfileCredentials } from "../types/index.js";
import { resolveTemplatePath } from "../platform/index.js";
import { readJsonFile } from "../platform/fs.js";
import { pathSegments } from "../core/path.js";

/** Get a nested value by path: "tokens.access_token" or "['github.com'].oauth_token". */
function getByPath(obj: Record<string, unknown>, dotPath: string): unknown {
  let current: unknown = obj;
  for (const key of pathSegments(dotPath)) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Read credentials from a provider's credential file.
 * Extracts `mapping` fields → `credentials` and `grab_fields` → `grab_data`.
 */
export async function readCredentials(
  credFile: ProviderCredentialFile,
): Promise<ProfileCredentials> {
  const filePath = resolveTemplatePath(credFile.path);
  const raw = await readJsonFile<Record<string, unknown>>(filePath);

  // Extract mapping → credentials (normalised keys)
  const credentials: Record<string, unknown> = {};
  for (const [normKey, jsonPath] of Object.entries(credFile.mapping)) {
    const value = getByPath(raw, jsonPath);
    if (value !== undefined) {
      credentials[normKey] = value;
    }
  }

  // Extract grab_fields → grab_data (original paths as keys)
  const grab_data: Record<string, unknown> = {};
  for (const fieldPath of credFile.grab_fields) {
    const value = getByPath(raw, fieldPath);
    if (value !== undefined) {
      grab_data[fieldPath] = value;
    }
  }

  return { credentials, grab_data };
}
