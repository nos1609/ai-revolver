import type { ProviderCredentialFile, ProviderCredentialSecret, ProfileCredentials } from "../types/index.js";
import { resolveTemplatePath } from "../platform/index.js";
import { pathSegments } from "../core/path.js";
import { getKeytarPassword } from "./keytar.js";
import { readProviderJsonFile } from "./json.js";

/** Get a nested value by path: "tokens.access_token" or "['github.com'].oauth_token". */
function getByPath(obj: Record<string, unknown>, dotPath: string): unknown {
  let current: unknown = obj;
  for (const key of pathSegments(dotPath)) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function interpolateSecretTemplate(
  template: string,
  credentials: Record<string, unknown>,
  grabData: Record<string, unknown>,
): string {
  return template.replace(/\$\{(credentials|grab_data)\.([^}]+)\}/g, (_match, scope: string, key: string) => {
    const source = scope === "credentials" ? credentials : grabData;
    return String(source[key] ?? "");
  });
}

/**
 * Read credentials from a provider's credential file.
 * Extracts `mapping` fields → `credentials` and `grab_fields` → `grab_data`.
 */
export async function readCredentials(
  credFile: ProviderCredentialFile,
  credentialSecrets: ProviderCredentialSecret[] = [],
): Promise<ProfileCredentials> {
  const filePath = resolveTemplatePath(credFile.path);
  const raw = await readProviderJsonFile<Record<string, unknown>>(filePath);

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

  for (const secret of credentialSecrets) {
    if (secret.backend !== "keytar") continue;
    const account = interpolateSecretTemplate(secret.account, credentials, grab_data);
    const password = account ? await getKeytarPassword(secret.service, account) : null;
    if (!password) continue;

    for (const [normKey, source] of Object.entries(secret.mapping)) {
      if (source === "password") credentials[normKey] = password;
    }
  }

  return { credentials, grab_data };
}
