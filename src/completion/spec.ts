export const SUPPORTED_COMPLETION_SHELLS = ["bash", "zsh", "fish", "powershell"] as const;

export type CompletionShell = typeof SUPPORTED_COMPLETION_SHELLS[number];

export const TOP_LEVEL_COMMANDS = [
  "list",
  "status",
  "usage",
  "env",
  "provider",
  "vault",
  "export",
  "import",
  "completion",
] as const;

export const PROVIDER_ACTIONS = ["grab", "switch", "rename", "drop", "list", "status", "usage"] as const;

export const VAULT_ACTIONS = ["path", "status", "passwd", "migrate", "export", "import"] as const;

export const PROVIDER_ACTION_OPTIONS = ["--api-key", "--help", "-h"] as const;

export const GLOBAL_OPTIONS = ["--help", "-h", "--version", "-V"] as const;

export const ENV_OPTIONS = ["--shell", "--help", "-h"] as const;

export const EXPORT_OPTIONS = ["--plaintext", "--help", "-h"] as const;

export const IMPORT_OPTIONS = ["--replace", "--restore-active", "--help", "-h"] as const;

export const MIGRATE_OPTIONS = ["--yes", "--keep-source", "--replace", "--help", "-h"] as const;

export const SHELL_VALUES = [...SUPPORTED_COMPLETION_SHELLS];

export const MIGRATE_TARGETS = ["keyring", "file"] as const;

export interface CompletionWords {
  topLevel: string[];
  providers: string[];
  providerActions: string[];
  vaultActions: string[];
  allOptions: string[];
  shellValues: string[];
  migrateTargets: string[];
}

export function buildCompletionWords(providers: string[]): CompletionWords {
  return {
    topLevel: [...TOP_LEVEL_COMMANDS],
    providers: [...providers].sort(),
    providerActions: [...PROVIDER_ACTIONS],
    vaultActions: [...VAULT_ACTIONS],
    allOptions: unique([
      ...GLOBAL_OPTIONS,
      ...ENV_OPTIONS,
      ...EXPORT_OPTIONS,
      ...IMPORT_OPTIONS,
      ...MIGRATE_OPTIONS,
      ...PROVIDER_ACTION_OPTIONS,
    ]),
    shellValues: [...SHELL_VALUES],
    migrateTargets: [...MIGRATE_TARGETS],
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
