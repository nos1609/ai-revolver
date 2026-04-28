import { trf } from "../i18n.js";
import {
  buildCompletionWords,
  type CompletionShell,
  SUPPORTED_COMPLETION_SHELLS,
} from "./spec.js";

export interface GenerateCompletionOptions {
  shell: CompletionShell;
  providers: string[];
}

export function parseCompletionShell(value: string | undefined): CompletionShell {
  if (!value) return "bash";
  if (isCompletionShell(value)) return value;

  throw new Error(trf(
    `Неизвестный shell для completion: "{shell}". Доступные: bash, zsh, fish, powershell`,
    `Unknown completion shell: "{shell}". Available: bash, zsh, fish, powershell`,
    { shell: value },
  ));
}

export function generateCompletionScript(opts: GenerateCompletionOptions): string {
  const words = buildCompletionWords(opts.providers);

  switch (opts.shell) {
    case "bash":
      return renderBash(words);
    case "zsh":
      return renderZsh(words);
    case "fish":
      return renderFish(words);
    case "powershell":
      return renderPowerShell(words);
  }
}

function isCompletionShell(value: string): value is CompletionShell {
  return SUPPORTED_COMPLETION_SHELLS.includes(value as CompletionShell);
}

function renderBash(words: ReturnType<typeof buildCompletionWords>): string {
  return `# bash completion for airev
_airev_completion() {
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
    --shell|completion)
      COMPREPLY=( $(compgen -W "${join(words.shellValues)}" -- "$cur") )
      return 0
      ;;
    migrate)
      COMPREPLY=( $(compgen -W "${join(words.migrateTargets)}" -- "$cur") )
      return 0
      ;;
    vault)
      COMPREPLY=( $(compgen -W "${join(words.vaultActions)}" -- "$cur") )
      return 0
      ;;
    provider)
      COMPREPLY=( $(compgen -W "list" -- "$cur") )
      return 0
      ;;
  esac

  case "$cur" in
    --*)
      COMPREPLY=( $(compgen -W "${join(words.allOptions)}" -- "$cur") )
      return 0
      ;;
  esac

  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=( $(compgen -W "${join([...words.topLevel, ...words.providers])}" -- "$cur") )
    return 0
  fi

  if [[ " ${join(words.providers)} " == *" \${COMP_WORDS[1]} "* && $COMP_CWORD -eq 2 ]]; then
    COMPREPLY=( $(compgen -W "${join(words.providerActions)}" -- "$cur") )
    return 0
  fi
}
complete -F _airev_completion airev
`;
}

function renderZsh(words: ReturnType<typeof buildCompletionWords>): string {
  return `#compdef airev
# zsh completion for airev
_airev_completion() {
  local -a commands providers provider_actions vault_actions options shells migrate_targets
  commands=(${quoteZsh([...words.topLevel])})
  providers=(${quoteZsh(words.providers)})
  provider_actions=(${quoteZsh(words.providerActions)})
  vault_actions=(${quoteZsh(words.vaultActions)})
  options=(${quoteZsh(words.allOptions)})
  shells=(${quoteZsh(words.shellValues)})
  migrate_targets=(${quoteZsh(words.migrateTargets)})

  if [[ CURRENT -eq 2 ]]; then
    _describe 'command' commands
    _describe 'provider' providers
    return
  fi

  case "$words[2]" in
    vault)
      _describe 'vault action' vault_actions
      _describe 'option' options
      ;;
    provider)
      _values 'provider action' list
      ;;
    completion|env)
      _describe 'shell' shells
      _describe 'option' options
      ;;
    *)
      if (( \${providers[(Ie)$words[2]]} )); then
        _describe 'provider action' provider_actions
        _describe 'option' options
      else
        _describe 'option' options
        _describe 'migration target' migrate_targets
      fi
      ;;
  esac
}
_airev_completion "$@"
`;
}

function renderFish(words: ReturnType<typeof buildCompletionWords>): string {
  const lines = [
    "# fish completion for airev",
    `# options: ${words.allOptions.join(" ")}`,
    "complete -c airev -f",
    ...[...words.topLevel, ...words.providers].map((word) => `complete -c airev -n '__fish_use_subcommand' -a '${escapeSingle(word)}'`),
    ...words.providerActions.map((word) => `complete -c airev -n "__fish_seen_subcommand_from ${words.providers.map(escapeFishConditionWord).join(" ")}" -a '${escapeSingle(word)}'`),
    ...words.vaultActions.map((word) => `complete -c airev -n '__fish_seen_subcommand_from vault' -a '${escapeSingle(word)}'`),
    ...words.shellValues.map((word) => `complete -c airev -n '__fish_seen_subcommand_from completion env' -a '${escapeSingle(word)}'`),
    ...words.migrateTargets.map((word) => `complete -c airev -n '__fish_seen_subcommand_from migrate' -a '${escapeSingle(word)}'`),
    ...words.allOptions.map((option) => renderFishOption(option)),
  ];
  return `${lines.join("\n")}\n`;
}

function renderPowerShell(words: ReturnType<typeof buildCompletionWords>): string {
  const allWords = unique([
    ...words.topLevel,
    ...words.providers,
    ...words.providerActions,
    ...words.vaultActions,
    ...words.allOptions,
    ...words.shellValues,
    ...words.migrateTargets,
  ]);
  const values = allWords.map((word) => `"${escapeDouble(word)}"`).join(", ");

  return `# PowerShell completion for airev
Register-ArgumentCompleter -Native -CommandName airev -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $values = @(${values})
  $values |
    Where-Object { $_ -like "$wordToComplete*" } |
    ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
    }
}
`;
}

function renderFishOption(option: string): string {
  if (option.startsWith("--")) {
    return `complete -c airev -l '${escapeSingle(option.slice(2))}'`;
  }
  if (option.startsWith("-")) {
    return `complete -c airev -s '${escapeSingle(option.slice(1))}'`;
  }
  return `complete -c airev -a '${escapeSingle(option)}'`;
}

function join(values: readonly string[]): string {
  return values.join(" ");
}

function quoteZsh(values: readonly string[]): string {
  return values.map((value) => `'${escapeSingle(value)}'`).join(" ");
}

function escapeSingle(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function escapeDouble(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeFishConditionWord(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
