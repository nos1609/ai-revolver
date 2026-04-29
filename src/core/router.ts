import type { ProviderDefinition, ProfileCredentials, AuthType } from "../types/index.js";
import { writeCredentials } from "../providers/writer.js";

export type SwitchMethod = "env" | "file_merge";

export interface SwitchResult {
  method: SwitchMethod;
  envVars?: Record<string, string>;
  filePath?: string;
}

/**
 * Hybrid Router: determines and executes the switch method
 * based on provider definition and auth type.
 *
 * - api_key  → env injection (returns env vars for shell hook)
 * - oauth    → merge-on-write (modifies credential file in place)
 */
export async function routeSwitch(
  provider: ProviderDefinition,
  authType: AuthType,
  data: ProfileCredentials,
): Promise<SwitchResult> {
  if (authType === "api_key") {
    return routeEnv(provider, data);
  }
  return routeFileMerge(provider, data);
}

function routeEnv(
  provider: ProviderDefinition,
  data: ProfileCredentials,
): SwitchResult {
  const apiKeyDef = provider.auth_methods.api_key;
  if (!apiKeyDef) {
    throw new Error(`Provider "${provider.name}" has no api_key auth method`);
  }

  const envVars: Record<string, string> = {};

  // Main env vars (substitute ${api_key} with actual value)
  for (const [envName, template] of Object.entries(apiKeyDef.env)) {
    envVars[envName] = template.replace(
      "${api_key}",
      String(data.credentials.api_key ?? ""),
    );
  }

  // Extra env vars (static values like OPENAI_BASE_URL for Qwen)
  if (apiKeyDef.env_extra) {
    Object.assign(envVars, apiKeyDef.env_extra);
  }

  return { method: "env", envVars };
}

async function routeFileMerge(
  provider: ProviderDefinition,
  data: ProfileCredentials,
): Promise<SwitchResult> {
  const oauthDef = provider.auth_methods.oauth;
  if (!oauthDef) {
    throw new Error(`Provider "${provider.name}" has no oauth auth method`);
  }

  await writeCredentials(oauthDef.credential_file, data, oauthDef.credential_secrets);

  return {
    method: "file_merge",
    filePath: oauthDef.credential_file.path,
  };
}
