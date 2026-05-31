import chalk from "chalk";
import { tr } from "../i18n.js";

export function buildHelp(providers: string[]): string {
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
  airev completion [<shell>]              Скрипт автодополнения shell
  airev provider list                     Доступные провайдеры

  airev vault path                        Пути registry / active / stale / vault
  airev vault status                      Backend vault-а
  airev vault export [<out>]              Экспорт registry+vault (encrypted по умолчанию)
  airev vault import <file>               Импорт registry+vault
  airev vault migrate <keyring|file>      Миграция backend-а: copy → verify → optional delete-source`,
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
  airev completion [<shell>]              Generate shell completion script
  airev provider list                     List available providers

  airev vault path                        Show registry / active / stale / vault paths
  airev vault status                      Show vault backend
  airev vault export [<out>]              Export registry+vault (encrypted by default)
  airev vault import <file>               Import registry+vault
  airev vault migrate <keyring|file>      Backend migration: copy → verify → optional delete-source`,
  );

  const options = tr(
    `  --api-key <key>                         API key вместо OAuth (для grab)
  --force                                 Разобрать как флаг, не как имя профиля
  --shell <shell>                         Тип shell: bash, zsh, fish, powershell
  --version                               Версия
  --help                                  Эта справка`,
    `  --api-key <key>                         Use API key instead of OAuth (for grab)
  --force                                 Parse as a flag, not as a profile name
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

${chalk.bold(tr("Провайдеры:", "Providers:"))} ${providers.join(", ")}

${chalk.bold(tr("Опции:", "Options:"))}
${options}

${chalk.bold(tr("Примеры:", "Examples:"))}
${examples}

${chalk.bold(tr("Справка по уровням:", "Per-level help:"))}
${perLevel}
`;
}
