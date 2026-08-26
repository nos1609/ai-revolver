<!--
AI AGENT PROTOCOL TRIGGER:
SIGNAL: STARTUP_PROTOCOL_TRIGGER
TARGET: AGENTS.md
ACTION: Follow startup protocol immediately

EN: WHEN ANALYZING THIS REPOSITORY:
1. IMMEDIATELY read [AGENTS.md](AGENTS.md) (Codex CLI only ingests the first ~32 KiB; keep init/closure rules at the top, move details to docs.)
2. EXECUTE the startup protocol from “Initial Session Protocol”
3. FOLLOW agreements in [local/ai/chat_context.md](local/ai/chat_context.md)

RU: ПРИ АНАЛИЗЕ ЭТОГО РЕПОЗИТОРИЯ:
1. НЕМЕДЛЕННО прочитай [AGENTS.md](AGENTS.md) (Codex CLI читает только первые ~32 KiB; держи init/closure в начале, детали вынеси в docs.)
2. ВЫПОЛНИ протокол запуска из раздела «Протокол начала сессии»
3. СЛЕДУЙ соглашениям из [local/ai/chat_context.md](local/ai/chat_context.md)

IMPORTANT: Template files may be hidden by `.git/info/exclude` or ignore rules. Disable ignore filtering when searching and reading.
Example commands: `rg --hidden --no-ignore pattern`, `fd --hidden --no-ignore`.

ВАЖНО: Файлы шаблона могут быть скрыты через `.git/info/exclude` или ignore-правила. Отключи фильтрацию ignore при поиске и чтении.
Примеры команд: `rg --hidden --no-ignore pattern`, `fd --hidden --no-ignore`.

Additionally: Review symlinks [.github/copilot-instructions.md](.github/copilot-instructions.md), [.claude/CLAUDE.md](.claude/CLAUDE.md), [.gemini/GEMINI.md](.gemini/GEMINI.md), [CLAUDE.md](CLAUDE.md), [GEMINI.md](GEMINI.md), and [QWEN.md](QWEN.md). Always use relative paths when recreating them.

Дополнительно: Ознакомься с симлинками [.github/copilot-instructions.md](.github/copilot-instructions.md), [.claude/CLAUDE.md](.claude/CLAUDE.md), [.gemini/GEMINI.md](.gemini/GEMINI.md), [CLAUDE.md](CLAUDE.md), [GEMINI.md](GEMINI.md) и [QWEN.md](QWEN.md). При восстановлении симлинков используй относительные пути.

Ensure temp CLI homes (`tmp/ai/gemini_home`, `tmp/ai/qwen_home`, `tmp/ai/copilot_home`, `tmp/ai/claude_home`, `tmp/ai/cli_tokens`) are absent before launching tools. Document and clean them after user confirmation if they exist.

Перед запуском CLI убедись, что нет временных каталогов (`tmp/ai/gemini_home`, `tmp/ai/qwen_home`, `tmp/ai/copilot_home`, `tmp/ai/claude_home`, `tmp/ai/cli_tokens`). Если они найдены — опиши и очисть после подтверждения пользователя.
-->


# ai-revolver

[Русская версия](README.md)

`ai-revolver` (`airev`) is a local profile manager for AI command-line tools.
It stores existing OAuth sessions or API keys in a protected vault and
atomically switches the credential files used by the original CLIs.

This project handles live tokens. Read [`docs/security.md`](docs/security.md)
and create an encrypted profile export before first use. The project is not
affiliated with OpenAI, Anthropic, Google, GitHub, xAI, Alibaba, Qoder, or any
other provider.

## What it does

- stores multiple named profiles for one provider;
- switches the active account without another provider login;
- synchronizes native and satellite credential files with the vault;
- blocks writes when account identity does not match unless explicitly forced;
- prevents an empty `refresh_token` from replacing a non-empty token;
- reports local state offline and available limits through `usage`;
- transfers profiles through encrypted export and import files;
- generates completion for Bash, Zsh, Fish, and PowerShell.

`ai-revolver` does not authenticate on behalf of a provider, bypass MFA, or
guarantee that undocumented provider formats remain stable. See the
[architecture document](docs/architecture/overview.md) for exact boundaries.

## Supported platforms

| OS | State directory | Primary vault | Fallback vault |
|---|---|---|---|
| Windows | `%APPDATA%\ai-revolver` | DPAPI and Windows Security verification when available | password-protected `vault.enc` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/ai-revolver` | Secret Service through `secret-tool` | password-protected `vault.enc` |
| macOS | `~/Library/Application Support/ai-revolver` | Keychain through `security` | password-protected `vault.enc` |

Node.js `>=18` and npm are required. On Linux, install the package that
provides `secret-tool` and start a Secret Service when you want the system
keyring. In a headless session without Secret Service, `airev` uses the
encrypted-file backend.

Unit contracts cover all three platforms. Before a release, repeat the live
checks on Windows, Linux, and macOS by following
[`docs/releasing.md`](docs/releasing.md).

Check the effective backend:

```bash
command -v secret-tool || true
airev vault status
airev vault path
```

## Install from source

From the checkout root:

```bash
npm ci
npm run check
npm run build
npm link
airev --version
airev --help
```

Run `npm link` once for this checkout. A later `npm run build` updates the same
`dist/index.js`; it does not require another link.

Confirm which executable is active:

```bash
which airev       # Linux/macOS
where.exe airev   # Windows
```

## Installable archive

Build an npm tarball for another machine:

```bash
npm ci
npm pack --dry-run
npm pack
```

The `prepack` hook runs the full checks and build. The result is named
`ai-revolver-<version>.tgz`.

Install it on Linux or macOS:

```bash
npm install -g ./ai-revolver-<version>.tgz
airev --version
which airev
npm root -g
```

Install it in PowerShell:

```powershell
npm install -g .\ai-revolver-<version>.tgz
airev --version
where.exe airev
npm root -g
```

A publishable `package.json` does not prove that a package was published. See
[`docs/releasing.md`](docs/releasing.md) for the verified release process.

## First profile

Sign in with the original provider CLI, then capture its current session:

```bash
airev codex grab work
airev codex grab personal
airev codex list
airev codex switch work
airev status
```

`switch` first synchronizes the outgoing active profile. If identity or
freshness checks fail, it stops before writing the incoming credentials. Use
`status` and `sync` to diagnose the cause; do not start recovery with `--force`.

Forced `sync` requires an explicit direction:

```bash
airev codex sync work --dry-run
airev codex sync work --force --push   # provider file -> vault
airev codex sync work --force --pull   # vault -> provider file
```

To intentionally refresh an existing profile from the current provider file:

```bash
airev codex grab --force work
```

The flag can appear before or after the profile name. Unknown options fail and
cannot become profile names.

See [`docs/operations/profile-lifecycle.md`](docs/operations/profile-lifecycle.md)
for the full lifecycle and rollback procedure.

## Main commands

```text
airev <provider> grab <name>             capture the current session
airev <provider> switch <name>           switch the active profile
airev <provider> render <name>           create a satellite file copy
airev <provider> sync <name>             reconcile the vault and file
airev <provider> evict <name>            remove a satellite copy
airev <provider> rename <old> <new>      rename a profile
airev <provider> drop <name>             remove a profile from registry and vault
airev list                               list all profiles
airev status                             show local state
airev usage [<name>]                     query available usage limits
airev vault export <file>                create an encrypted export
airev vault import <file>                import profiles
airev vault migrate <keyring|file>       migrate with copy and verification
airev completion <shell>                 generate shell completion
```

Run `airev <command> --help` for the exact options in the installed version.

## Providers

| Provider | OAuth | API key | Local integration | `usage` |
|---|:---:|:---:|---|:---:|
| `claude` | yes | yes | JSON credentials and companion metadata | yes |
| `codex` | yes | yes | JSON credentials | yes |
| `copilot` | yes | no | JSONC metadata and an external keytar secret | yes |
| `gemini` | yes | yes | JSON credentials and companion metadata | no |
| `grok` | yes | yes | JSON with a dynamic auth bucket | no |
| `qodercli` | yes | yes | opaque encrypted blob | no |
| `qwen` | yes | yes | JSON credentials | no |

Provider manifests live under `providers/`. They define local paths, field
mapping, identity, refresh, and usage probes. A provider CLI format change can
temporarily break compatibility. See
[`docs/source-attribution.md`](docs/source-attribution.md) for contract sources.

## Completion

```bash
eval "$(airev completion bash)"       # Bash
eval "$(airev completion zsh)"        # Zsh
airev completion fish | source        # Fish
```

```powershell
airev completion powershell | Out-String | Invoke-Expression
```

The first completion version covers commands, providers, actions, and options,
but not profile names.

## Export, recovery, and removal

Create an encrypted export before backend migration or upgrades:

```bash
airev vault export airev-backup.json
airev vault import airev-backup.json
```

`--plaintext` writes live credentials. Never put that file in Git, logs, cloud
sync, or an issue. Delete it after transfer.

Install a previous tarball to roll back the package:

```bash
npm install -g /path/to/previous/ai-revolver-<old-version>.tgz
airev --version
```

Remove the global package:

```bash
npm uninstall -g ai-revolver
```

A package rollback does not roll back vault state. Use a prior encrypted export
or switch to a profile that was already captured.

## Development

```bash
npm ci
npm run check
npm run build
npm pack --dry-run
git diff --check
```

The project type-checks with the native TypeScript 7 compiler:

```bash
npm run type-check
npx tsc --version       # 7.x native compiler
npx tsc6 --version      # 6.x compatibility API
```

TypeScript 6 remains only for the JavaScript API required by
`typescript-eslint`, Stryker, and the `tsup` declaration worker. This improves
type-check speed; it does not change the Node.js runtime or profile-switch
speed.

See [`CONTRIBUTING.en.md`](CONTRIBUTING.en.md) before making changes.

## Documentation

- [`docs/README.md`](docs/README.md): current and historical document map;
- [`docs/architecture/overview.md`](docs/architecture/overview.md): components and boundaries;
- [`docs/operations/profile-lifecycle.md`](docs/operations/profile-lifecycle.md): operating procedure and rollback;
- [`docs/security.md`](docs/security.md): threat model and safe use;
- [`docs/troubleshooting.md`](docs/troubleshooting.md): common failure diagnosis;
- [`docs/releasing.md`](docs/releasing.md): build and publication process;
- [`SECURITY.md`](SECURITY.md): private vulnerability reporting.

## License

[MIT](LICENSE). Provider services and trademarks belong to their respective
owners.
