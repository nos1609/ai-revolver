import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface CopilotRuntime {
  stateGlobalStateKeysJson(): string;
  authAddLoggedInUser(
    configPath: string,
    userJson: string,
    normalizerSpecJson: string,
    header: string,
  ): Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string };
  tokenStoreGetToken(
    host: string,
    login: string,
    configPath: string,
    normalizerSpecJson: string,
    header: string,
    storePlaintext: boolean,
  ): Promise<string | null> | string | null;
  tokenStoreStoreToken(
    token: string,
    host: string,
    login: string,
    configPath: string,
    normalizerSpecJson: string,
    header: string,
    storePlaintext: boolean,
  ): Promise<boolean> | boolean;
}

const CONFIG_HEADER = "// User settings belong in settings.json.\n// This file is managed automatically.\n";
let cachedRuntime: CopilotRuntime | null | undefined;

function addCopilotRoot(roots: Set<string>, candidate: string): void {
  try {
    const real = fs.realpathSync(candidate);
    const stat = fs.statSync(real);
    roots.add(stat.isDirectory() ? real : path.dirname(real));
  } catch {
    // Optional installation candidate.
  }
}

function copilotPackageRoots(): string[] {
  const roots = new Set<string>();

  try {
    addCopilotRoot(roots, path.dirname(require.resolve("@github/copilot/package.json")));
  } catch {
    // A global CLI is usually outside this package's Node resolution tree.
  }

  for (const dir of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const executable of process.platform === "win32"
      ? ["copilot.cmd", "copilot.exe", "copilot"]
      : ["copilot"]) {
      const commandPath = path.join(dir, executable);
      try {
        const real = fs.realpathSync(commandPath);
        addCopilotRoot(roots, path.dirname(real));
      } catch {
        // Keep searching PATH.
      }
    }
    addCopilotRoot(roots, path.join(dir, "node_modules", "@github", "copilot"));
  }

  return [...roots];
}

function runtimeCandidates(root: string): string[] {
  const candidates = new Set<string>();
  const addPrebuilds = (prebuilds: string): void => {
    let targets: string[] = [];
    try {
      targets = fs.readdirSync(prebuilds);
    } catch {
      return;
    }
    for (const target of targets) {
      candidates.add(path.join(prebuilds, target, "runtime.node"));
    }
  };

  addPrebuilds(path.join(root, "prebuilds"));

  const githubModules = path.join(root, "node_modules", "@github");
  let platformPackages: string[] = [];
  try {
    platformPackages = fs.readdirSync(githubModules)
      .filter((entry) => entry.startsWith("copilot-"));
  } catch {
    // Not an npm-distributed Copilot CLI root.
  }

  for (const packageName of platformPackages) {
    addPrebuilds(path.join(githubModules, packageName, "prebuilds"));
  }

  return [...candidates].filter((candidate) => fs.existsSync(candidate));
}

function loadCopilotRuntime(): CopilotRuntime {
  if (cachedRuntime !== undefined) {
    if (!cachedRuntime) throw new Error("Copilot CLI token-store runtime unavailable");
    return cachedRuntime;
  }

  for (const root of copilotPackageRoots()) {
    for (const candidate of runtimeCandidates(root)) {
      try {
        const runtime = require(candidate) as Partial<CopilotRuntime>;
        if (
          typeof runtime.stateGlobalStateKeysJson === "function"
          && typeof runtime.authAddLoggedInUser === "function"
          && typeof runtime.tokenStoreGetToken === "function"
          && typeof runtime.tokenStoreStoreToken === "function"
        ) {
          cachedRuntime = runtime as CopilotRuntime;
          return cachedRuntime;
        }
      } catch {
        // Try the next platform package candidate.
      }
    }
  }

  cachedRuntime = null;
  throw new Error(
    "Copilot CLI token-store runtime unavailable; install the current @github/copilot CLI",
  );
}

function runtimeConfig(runtime: CopilotRuntime): {
  normalizerSpecJson: string;
  header: string;
} {
  const canonicalKeys = JSON.parse(runtime.stateGlobalStateKeysJson()) as unknown;
  if (!Array.isArray(canonicalKeys) || !canonicalKeys.every((key) => typeof key === "string")) {
    throw new Error("Copilot CLI token-store runtime returned an invalid config schema");
  }
  return {
    normalizerSpecJson: JSON.stringify({ canonicalKeys }),
    header: CONFIG_HEADER,
  };
}

export async function getCopilotToken(
  configPath: string,
  host: string,
  login: string,
  storePlaintext: boolean,
): Promise<string | null> {
  const runtime = loadCopilotRuntime();
  const config = runtimeConfig(runtime);
  return await runtime.tokenStoreGetToken(
    host,
    login,
    configPath,
    config.normalizerSpecJson,
    config.header,
    storePlaintext,
  );
}

export async function setCopilotToken(
  configPath: string,
  host: string,
  login: string,
  token: string,
  storePlaintext: boolean,
): Promise<void> {
  const runtime = loadCopilotRuntime();
  const config = runtimeConfig(runtime);
  const stored = await runtime.tokenStoreStoreToken(
    token,
    host,
    login,
    configPath,
    config.normalizerSpecJson,
    config.header,
    storePlaintext,
  );
  if (!stored) {
    throw new Error("Copilot CLI token store rejected the credential");
  }
  const added = await runtime.authAddLoggedInUser(
    configPath,
    JSON.stringify({ host, login }),
    config.normalizerSpecJson,
    config.header,
  );
  if (!added.success) {
    throw new Error(added.error ?? "Copilot CLI rejected the selected account metadata");
  }
}
