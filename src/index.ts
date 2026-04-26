import chalk from "chalk";
import { grab } from "./commands/grab.js";
import { switchProfile } from "./commands/switch.js";
import { list } from "./commands/list.js";
import { status } from "./commands/status.js";
import { usage } from "./commands/usage.js";
import { drop } from "./commands/drop.js";
import { rename } from "./commands/rename.js";
import { envGen } from "./commands/env-gen.js";
import { exportProfiles } from "./commands/export.js";
import { importProfiles } from "./commands/import.js";
import { vaultCommand } from "./commands/vault.js";
import { printActionHelp, printProviderHelp, hasActionHelp } from "./commands/help.js";
import { listProviders } from "./providers/loader.js";
import { tr, trf } from "./i18n.js";
import { ExitCode } from "./types/index.js";

const VERSION = "0.2.0";

function buildHelp(): string {
  const tagline = tr(
    "CLI-менеджер профилей для AI-инструментов",
    "CLI profile manager for AI tools",
  );

  const usage = tr(
    `  airev <provider> grab <name>            Забрать текущие credentials как профиль
  airev <provider> switch <name>          Переключиться на профиль
  airev <provider> rename <old> <new>     Переименовать профиль
  airev <provider> drop <name>            Удалить профиль
  airev <provider> list                   Профили одного провайдера
  airev <provider> status                 Статус провайдера
  airev <provider> usage [<name>]         Живые rate-limit'ы: все профили провайдера или один

  airev list                              Все профили
  airev status                            Все провайдеры (локально, быстро)
  airev usage [<name>]                    Живые rate-limit'ы по всем oauth-профилям или по имени
  airev env [--shell <shell>]             Env-экспорты для shell-хука
  airev provider list                     Доступные провайдеры

  airev vault path                        Пути registry / active / stale / vault
  airev vault status                      Backend vault-а
  airev vault export [<out>]              Экспорт registry+vault (encrypted по умолчанию)
  airev vault import <file>               Импорт registry+vault
  airev vault migrate <keyring|file>      Заглушка будущей миграции backend-а`,
    `  airev <provider> grab <name>            Grab current credentials as profile
  airev <provider> switch <name>          Switch to a profile
  airev <provider> rename <old> <new>     Rename a profile
  airev <provider> drop <name>            Remove a profile
  airev <provider> list                   List profiles for a provider
  airev <provider> status                 Show provider status
  airev <provider> usage [<name>]         Live rate-limits: all provider's profiles, or one

  airev list                              List all profiles
  airev status                            Show all providers (local, fast)
  airev usage [<name>]                    Live rate-limits for all oauth profiles, or by name
  airev env [--shell <shell>]             Output env exports for shell hook
  airev provider list                     List available providers

  airev vault path                        Show registry / active / stale / vault paths
  airev vault status                      Show vault backend
  airev vault export [<out>]              Export registry+vault (encrypted by default)
  airev vault import <file>               Import registry+vault
  airev vault migrate <keyring|file>      Placeholder for future backend migration`,
  );

  const options = tr(
    `  --api-key <key>                         API key вместо OAuth (для grab)
  --shell <shell>                         Тип shell: bash, zsh, fish, powershell
  --version                               Версия
  --help                                  Эта справка`,
    `  --api-key <key>                         Use API key instead of OAuth (for grab)
  --shell <shell>                         Shell type: bash, zsh, fish, powershell
  --version                               Show version
  --help                                  Show this help`,
  );

  const examples = tr(
    `  airev codex grab work                   Забрать сессию Codex как "work"
  airev codex switch work                 Сделать "work" активным для Codex
  airev codex rename work main            Переименовать "work" → "main"
  airev codex usage                       5h/7d лимиты для активного Codex
  airev list                              Показать всё`,
    `  airev codex grab work                   Grab Codex session as "work"
  airev codex switch work                 Switch Codex to "work"
  airev codex rename work main            Rename "work" → "main" under codex
  airev codex usage                       Live 5h/7d limits for active codex
  airev list                              List everything`,
  );

  const perLevel = tr(
    `  airev <provider> -h                     напр. airev codex -h
  airev <action> -h                       напр. airev grab -h, airev usage -h
  airev <provider> <action> -h            напр. airev codex rename -h`,
    `  airev <provider> -h                     e.g. airev codex -h
  airev <action> -h                       e.g. airev grab -h, airev usage -h
  airev <provider> <action> -h            e.g. airev codex rename -h`,
  );

  return `
${chalk.bold("airev")} — ${tagline}

${chalk.bold(tr("Использование:", "Usage:"))}
${usage}

${chalk.bold(tr("Провайдеры:", "Providers:"))} codex, claude, gemini, qwen

${chalk.bold(tr("Опции:", "Options:"))}
${options}

${chalk.bold(tr("Примеры:", "Examples:"))}
${examples}

${chalk.bold(tr("Справка по уровням:", "Per-level help:"))}
${perLevel}
`;
}

const GLOBAL_VERBS = new Set(["list", "status", "usage", "env", "provider", "vault", "export", "import"]);
const PROVIDER_VERBS = new Set(["grab", "switch", "rename", "drop", "list", "status", "usage"]);

function die(msg: string, hint?: string): never {
  console.error(chalk.red(msg));
  if (hint) console.error(chalk.dim(hint));
  process.exit(ExitCode.GENERAL_ERROR);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    return;
  }

  const wantsHelp = args.includes("--help") || args.includes("-h");

  // Drop help flags from positional parsing so `airev codex grab -h` still
  // routes as provider=codex, action=grab (not action="-h").
  const positional = args.filter((a) => a !== "--help" && a !== "-h");

  // Top-level: no args, or only help flags.
  if (positional.length === 0) {
    console.log(buildHelp());
    return;
  }

  const [first, second, third, fourth] = positional;

  // Help dispatch — resolve the most specific scope that matches:
  //   airev codex grab -h       → action help, with provider context
  //   airev codex -h            → provider help
  //   airev grab -h             → action help (global form, no provider)
  //   airev -h                  → top-level
  if (wantsHelp) {
    const providers = await listProviders();

    // `airev vault <action> -h`
    if (first === "vault" && second && hasActionHelp(second)) {
      printActionHelp(second);
      return;
    }
    // `airev <prov> <action> -h`
    if (providers.includes(first) && second && hasActionHelp(second)) {
      printActionHelp(second, first);
      return;
    }
    // `airev <prov> -h`
    if (providers.includes(first) && !second) {
      printProviderHelp(first);
      return;
    }
    // `airev <action> -h` — either a global verb or a provider verb documented generically
    if (hasActionHelp(first)) {
      printActionHelp(first);
      return;
    }
    // Unknown target — fall through to top-level help rather than erroring.
    console.log(buildHelp());
    return;
  }

  const apiKeyIdx = args.indexOf("--api-key");
  const apiKey = apiKeyIdx >= 0 ? args[apiKeyIdx + 1] : undefined;
  const shellIdx = args.indexOf("--shell");
  const shell = shellIdx >= 0 ? args[shellIdx + 1] : undefined;

  // ── Global commands (no positional provider filter) ──────

  if (GLOBAL_VERBS.has(first)) {
    // `list` and `status` take no positional args — they're "show all, local".
    // `usage` uniquely accepts a profile name: `airev usage <name>`.
    if (first === "list" && !second) return list();
    if (first === "status" && !second) return status();
    if (first === "usage") {
      // Guard: `airev usage codex` would parse as "profile named 'codex'",
      // which is almost always a mistake for "all codex profiles".
      const known = await listProviders();
      if (second && known.includes(second)) {
        die(
          trf(`"{p}" — это провайдер, а не имя профиля.`, `"{p}" is a provider, not a profile name.`, { p: second }),
          trf(`Имелось в виду 'airev {p} usage'?`, `Did you mean 'airev {p} usage'?`, { p: second }),
        );
      }
      return usage(undefined, second);
    }
    if (first === "env") return envGen(shell);

    if (first === "vault") {
      return vaultCommand(second, third, {
        plaintext: args.includes("--plaintext"),
        replace: args.includes("--replace"),
        restoreActive: args.includes("--restore-active"),
        yes: args.includes("--yes"),
        keepSource: args.includes("--keep-source"),
      });
    }

    if (first === "export") {
      const plaintext = args.includes("--plaintext");
      // Positional out-path: anything after `export` that isn't a flag.
      const outPath = args.slice(1).find((a) => !a.startsWith("--"));
      return exportProfiles({ outPath, plaintext });
    }

    if (first === "import") {
      if (!second || second.startsWith("--")) {
        die(tr(
          `Использование: airev import <file> [--replace] [--restore-active]`,
          `Usage: airev import <file> [--replace] [--restore-active]`,
        ));
      }
      return importProfiles(second, {
        replace: args.includes("--replace"),
        restoreActive: args.includes("--restore-active"),
      });
    }

    if (first === "provider") {
      if (second === "list") {
        const providers = await listProviders();
        console.log();
        for (const p of providers) console.log(`  ${p}`);
        console.log();
        return;
      }
      die(
        trf(`Неизвестное действие провайдера: "{a}"`, `Unknown provider action: "{a}"`, { a: second ?? "" }),
        tr(`Использование: airev provider list`, `Usage: airev provider list`),
      );
    }

    // Offer a targeted hint only when `second` is actually a known provider.
    const knownProviders = await listProviders();
    const hint = knownProviders.includes(second)
      ? trf(
          `Возможно, имелось в виду 'airev {p} {a}'? (per-provider форма)`,
          `Did you mean 'airev {p} {a}'? (per-provider form)`,
          { p: second, a: first },
        )
      : trf(
          `Используй 'airev {a}' (global) или 'airev <provider> {a}' (scoped).`,
          `Use 'airev {a}' (global) or 'airev <provider> {a}' (scoped).`,
          { a: first },
        );
    die(trf(`"{v}" не принимает позиционных аргументов.`, `"{v}" takes no positional arguments.`, { v: first }), hint);
  }

  // ── Provider commands: airev <provider> <action> [args] ──

  const providers = await listProviders();
  if (!providers.includes(first)) {
    die(
      trf(`Неизвестная команда или провайдер: "{v}"`, `Unknown command or provider: "{v}"`, { v: first }),
      trf(
        `Доступные провайдеры: {list}\nЗапусти 'airev --help' для справки.`,
        `Available providers: {list}\nRun 'airev --help' for usage.`,
        { list: providers.join(", ") },
      ),
    );
  }

  const provider = first;
  const action = second;

  if (!action) {
    die(
      tr(`Не указано действие.`, `Missing action.`),
      trf(
        `Использование: airev {p} <{list}>`,
        `Usage: airev {p} <{list}>`,
        { p: provider, list: [...PROVIDER_VERBS].join("|") },
      ),
    );
  }

  if (!PROVIDER_VERBS.has(action)) {
    die(
      trf(`Неизвестное действие: "{a}"`, `Unknown action: "{a}"`, { a: action }),
      trf(`Доступные: {list}`, `Available: {list}`, { list: [...PROVIDER_VERBS].join(", ") }),
    );
  }

  switch (action) {
    case "grab":
      if (!third) die(trf(`Использование: airev {p} grab <name>`, `Usage: airev {p} grab <name>`, { p: provider }));
      return grab(provider, third, { apiKey });

    case "switch":
      if (!third) die(trf(`Использование: airev {p} switch <name>`, `Usage: airev {p} switch <name>`, { p: provider }));
      return switchProfile(provider, third);

    case "rename":
      if (!third || !fourth) die(trf(`Использование: airev {p} rename <old> <new>`, `Usage: airev {p} rename <old> <new>`, { p: provider }));
      return rename(provider, third, fourth);

    case "drop":
      if (!third) die(trf(`Использование: airev {p} drop <name>`, `Usage: airev {p} drop <name>`, { p: provider }));
      return drop(provider, third);

    case "list":
      return list(provider);

    case "status":
      return status(provider);

    case "usage":
      // `airev <prov> usage`         → all profiles of that provider
      // `airev <prov> usage <name>`  → one specific profile
      return usage(provider, third);
  }
}

main().catch((err) => {
  console.error(chalk.red(trf(`Ошибка: {msg}`, `Error: {msg}`, { msg: err.message })));
  process.exit(ExitCode.GENERAL_ERROR);
});
