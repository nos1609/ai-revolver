export interface ParsedArgs {
  positionals: string[];
  options: Record<string, string | boolean>;
  unknownOptions: string[];
}

const VALUE_OPTIONS = new Set(["--api-key", "--shell"]);
const BOOLEAN_OPTIONS = new Set([
  "--help",
  "-h",
  "--version",
  "-V",
  "--plaintext",
  "--replace",
  "--restore-active",
  "--yes",
  "--keep-source",
  "--force",
]);

export function parseArgs(args: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const options: Record<string, string | boolean> = {};
  const unknownOptions: string[] = [];
  let literalMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (literalMode) {
      positionals.push(arg);
      continue;
    }

    if (arg === "--") {
      literalMode = true;
      continue;
    }

    if (VALUE_OPTIONS.has(arg)) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("-")) {
        unknownOptions.push(arg);
      } else {
        options[arg] = value;
        i++;
      }
      continue;
    }

    if (BOOLEAN_OPTIONS.has(arg)) {
      options[arg] = true;
      continue;
    }

    if (arg.startsWith("-")) {
      unknownOptions.push(arg);
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, options, unknownOptions };
}

export function hasOption(parsed: ParsedArgs, ...names: string[]): boolean {
  return names.some((name) => parsed.options[name] === true);
}

export function optionValue(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.options[name];
  return typeof value === "string" ? value : undefined;
}
