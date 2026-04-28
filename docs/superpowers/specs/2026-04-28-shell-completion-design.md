# Shell Completion Design

## Context

`codex` generates shell completion scripts through `clap_complete`: the CLI command tree is described once by `clap`, and `codex completion <shell>` prints a script for the requested shell.

`airev` does not use `clap` or another parser framework. `src/index.ts` parses `process.argv` manually, and command help is currently maintained separately in `src/commands/help.ts`. A direct copy of the `codex` implementation is therefore not possible. The useful part to borrow is the contract:

```bash
airev completion [bash|zsh|fish|powershell]
```

The command prints a shell-specific completion script to stdout. Installing the script is left to the user shell init.

## Goal

Add cross-platform shell completion for `airev` while keeping the first version safe and small:

- complete top-level commands;
- complete bundled and user provider names;
- complete provider actions;
- complete vault subcommands;
- complete known flags and enum flag values;
- support `bash`, `zsh`, `fish`, and `powershell`;
- avoid reading local profiles, vault entries, tokens, or registry state.

## Non-Goals

- No dynamic profile-name completion in v1.
- No mutation of user shell config.
- No credential or vault access from completion generation.
- No dependency on a full CLI framework rewrite.
- No pre-generated scripts committed as source of truth.

## Recommended Approach

Use a small internal command specification and generate completion scripts from it.

The command specification becomes the shared, declarative description of the static CLI surface:

- executable name: `airev`;
- top-level commands: `list`, `status`, `usage`, `env`, `provider`, `vault`, `export`, `import`, `completion`;
- provider actions: `grab`, `switch`, `rename`, `drop`, `list`, `status`, `usage`;
- vault actions: `path`, `status`, `passwd`, `migrate`, `export`, `import`;
- flags: `--help`, `-h`, `--version`, `-V`, `--api-key`, `--shell`, `--plaintext`, `--replace`, `--restore-active`, `--yes`, `--keep-source`;
- enum values: shell names and migration targets.

Provider names are loaded with the existing `listProviders()` function. This includes bundled providers and user provider YAML files. This is acceptable because provider discovery reads only provider definitions, not credentials or profile registry.

## Architecture

### `src/completion/spec.ts`

Owns the static completion model.

Responsibilities:

- expose supported shells;
- build the completion command tree from provider names;
- keep command/action/flag definitions in one place for completion;
- avoid side effects.

The model should be simple TypeScript data, not a parser framework:

```ts
type CompletionShell = "bash" | "zsh" | "fish" | "powershell";

interface CompletionCommand {
  name: string;
  aliases?: string[];
  subcommands?: CompletionCommand[];
  options?: CompletionOption[];
  positionals?: CompletionPositional[];
}
```

The exact shape can be adjusted during implementation, but it must stay easy to test and independent from stdout/process state.

### `src/completion/generate.ts`

Pure generator module.

Responsibilities:

- accept `{ shell, providers }`;
- return a completion script string;
- generate shell-specific syntax for `bash`, `zsh`, `fish`, and `powershell`;
- avoid filesystem, vault, registry, and network access.

The generator can be intentionally conservative. It only needs to complete known command words and options; it does not need to implement perfect context-sensitive parsing for every positional argument in v1.

### `src/commands/completion.ts`

Thin command wrapper.

Responsibilities:

- normalize shell argument;
- default to `bash` when shell is omitted;
- call `listProviders()`;
- call generator;
- write script to stdout;
- throw a localized error for unknown shell.

### `src/index.ts`

Add `completion` as a top-level global command before provider dispatch:

```bash
airev completion
airev completion bash
airev completion zsh
airev completion fish
airev completion powershell
```

`completion` must not conflict with provider names. It is a reserved top-level command.

## User-Facing Behavior

### Help

Top-level help should include:

```bash
airev completion [<shell>]              Generate shell completion script
```

Action help should include:

```bash
airev completion [bash|zsh|fish|powershell]
```

### Errors

Unknown shell:

```text
Unknown completion shell: "<value>"
Available: bash, zsh, fish, powershell
```

Russian locale should use natural Russian wording, not literal English calques.

### Security

Completion generation is read-only and does not access:

- vault backends;
- registry profiles;
- active/stale maps;
- provider credential files;
- API endpoints.

This keeps completion safe to run from shell startup.

## Documentation

Update README with install examples:

```powershell
# PowerShell profile
airev completion powershell | Out-String | Invoke-Expression
```

```bash
# bash
eval "$(airev completion bash)"
```

```zsh
# zsh
eval "$(airev completion zsh)"
```

```fish
# fish
airev completion fish | source
```

The docs should note that v1 completes commands, providers, actions, and flags, but not profile names.

## Testing Plan

Follow TDD.

### Unit Tests

Add `tests/unit/completion.test.ts`.

Required cases:

- supported shell parser accepts `bash`, `zsh`, `fish`, `powershell`;
- unsupported shell produces a clear error;
- generated scripts contain `airev`;
- generated scripts include top-level commands;
- generated scripts include bundled provider names such as `codex`, `claude`, `gemini`, `qwen`;
- generated scripts include provider actions;
- generated scripts include vault actions;
- generated scripts include `--shell` enum values;
- generator output does not require vault or registry setup.

### CLI Routing Tests

If existing test structure allows direct command invocation, cover:

- `completion` defaults to bash;
- `completion powershell` calls the generator with `powershell`;
- invalid shell exits through the normal CLI error path.

If full CLI subprocess tests are too heavy, keep routing test at command-wrapper level and cover final behavior with a smoke command after build.

### Verification

```bash
npm run build
npm test
node dist/index.js completion powershell
node dist/index.js completion bash
```

Mutation testing is optional for the first implementation unless the generator becomes non-trivial. If added to mutation scope, include only `src/completion/**` and not generated shell text snapshots.

## Open Decisions Resolved

- First version is static.
- Profile-name completion is out of scope.
- Provider-name completion is in scope because it reads provider definitions only.
- Command name is singular: `completion`, matching `codex`.
- Default shell is `bash`, matching `codex`.
