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

[English version](README.en.md)

`ai-revolver` (`airev`) — локальный менеджер профилей для CLI-инструментов с
AI. Он сохраняет уже созданные OAuth-сессии или API keys в защищённом
хранилище и атомарно переключает файлы учётных данных исходных CLI.

Проект работает с живыми токенами. Перед первым использованием прочитай
[`docs/security.md`](docs/security.md) и сделай зашифрованный экспорт текущих
профилей. Проект не связан с OpenAI, Anthropic, Google, GitHub, xAI, Alibaba,
Qoder или другими поставщиками.

## Что он делает

- сохраняет несколько именованных профилей одного поставщика;
- переключает активную учётную запись без повторного входа в исходный CLI;
- синхронизирует активный файл и неактивные локальные копии с vault;
- не перезаписывает профиль при несовпадении identity без явного подтверждения;
- защищает непустой `refresh_token` от замены пустым значением;
- показывает локальное состояние без сети и доступные лимиты через `usage`;
- переносит профили через зашифрованный export/import;
- создаёт completion для Bash, Zsh, Fish и PowerShell.

`ai-revolver` не выполняет вход вместо исходного CLI, не обходит MFA и не
гарантирует стабильность недокументированных форматов поставщиков. Подробные
границы показаны в [архитектуре](docs/architecture/overview.md).

## Поддерживаемые платформы

| ОС | Каталог состояния | Основной vault | Резервный vault |
|---|---|---|---|
| Windows | `%APPDATA%\ai-revolver` | DPAPI и подтверждение Windows Security, если доступно | `vault.enc` с паролем |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/ai-revolver` | Secret Service через `secret-tool` | `vault.enc` с паролем |
| macOS | `~/Library/Application Support/ai-revolver` | Keychain через `security` | `vault.enc` с паролем |

Требуется Node.js `>=18` и npm. На Linux установи пакет, который предоставляет
`secret-tool`, и запусти Secret Service, если нужен системный keyring. В
headless-сессии без Secret Service `airev` использует зашифрованный файл.

Unit contracts покрывают все три платформы. Перед релизом повтори live-проверки
на Windows, Linux и macOS по порядку из
[`docs/releasing.md`](docs/releasing.md).

Проверь выбранный вариант:

```bash
command -v secret-tool || true
airev vault status
airev vault path
```

## Установка из исходников

Для исходников используй npm `12.0.1`, закреплённый в `packageManager`, и
совместимую с ним версию Node.js.

Из корня рабочей копии:

```bash
npm ci
npm run check
npm run build
npm link
airev --version
airev --help
```

`npm link` выполняется один раз для этой рабочей копии. После `npm run build`
повторная привязка не нужна: глобальная команда уже указывает на
`dist/index.js` этой копии.

Проверь, какой исполняемый файл используется:

```bash
which airev       # Linux/macOS
where.exe airev   # Windows
```

## Устанавливаемый архив

Собери npm tarball для другой машины:

```bash
npm ci
npm pack --dry-run
npm pack
```

`prepack` запускает полную проверку и сборку. Результат имеет имя
`ai-revolver-<version>.tgz`.

Установка на Linux или macOS:

```bash
npm install -g ./ai-revolver-<version>.tgz
airev --version
which airev
npm root -g
```

Установка в PowerShell:

```powershell
npm install -g .\ai-revolver-<version>.tgz
airev --version
where.exe airev
npm root -g
```

Пакет пока нельзя считать опубликованным только по наличию `package.json`.
Проверяемый порядок публикации описан в
[`docs/releasing.md`](docs/releasing.md).

## Первый профиль

Сначала войди в исходном CLI, затем сохрани его текущую сессию:

```bash
airev codex grab work
airev codex grab personal
airev codex list
airev codex switch work
airev status
```

`switch` сначала синхронизирует исходящий активный профиль. Если identity или
freshness не проходят проверку, команда останавливается до записи нового
файла. Разбери причину через `status` и `sync`; не начинай восстановление с
`--force`.

Явное направление требуется только для принудительного `sync`:

```bash
airev codex sync work --dry-run
airev codex sync work --force --push   # файл CLI -> vault
airev codex sync work --force --pull   # vault -> файл CLI
```

Для намеренного обновления существующего профиля из текущего файла:

```bash
airev codex grab --force work
```

Флаг можно ставить до или после имени. Неизвестные флаги завершают команду с
ошибкой и не становятся именем профиля.

Полный жизненный цикл и откат описаны в
[`docs/operations/profile-lifecycle.md`](docs/operations/profile-lifecycle.md).

## Основные команды

```text
airev <provider> grab <name>             сохранить текущую сессию
airev <provider> switch <name>           переключить активный профиль
airev <provider> render <name>           создать неактивную файловую копию
airev <provider> sync <name>             синхронизировать vault и файл
airev <provider> evict <name>            удалить файловую копию
airev <provider> rename <old> <new>      переименовать профиль
airev <provider> drop <name>             удалить профиль из registry и vault
airev list                               показать все профили
airev status                             показать локальное состояние
airev usage [<name>]                     запросить доступные лимиты
airev vault export <file>                создать зашифрованный экспорт
airev vault import <file>                импортировать профили
airev vault migrate <keyring|file>       перенести backend через copy/verify
airev completion <shell>                 создать shell completion
```

Точные флаги текущей версии показывает `airev <command> --help`.

## Поставщики

| Поставщик | OAuth | API key | Формат локальной интеграции | `usage` |
|---|:---:|:---:|---|:---:|
| `claude` | да | да | JSON credentials и companion metadata | да |
| `codex` | да | да | JSON credentials | да |
| `copilot` | да | нет | JSONC metadata и внешний keytar secret | да |
| `gemini` | да | да | JSON credentials и companion metadata | нет |
| `grok` | да | да | JSON с динамическим auth bucket | нет |
| `qodercli` | да | да | непрозрачный зашифрованный blob | нет |
| `qwen` | да | да | JSON credentials | нет |

Манифесты находятся в `providers/`. Они описывают локальные пути, mapping,
identity, refresh и usage probes. Изменение формата исходного CLI может
временно нарушить совместимость. Происхождение контрактов указано в
[`docs/source-attribution.md`](docs/source-attribution.md).

## Completion

```bash
eval "$(airev completion bash)"       # Bash
eval "$(airev completion zsh)"        # Zsh
airev completion fish | source        # Fish
```

```powershell
airev completion powershell | Out-String | Invoke-Expression
```

Первая версия дополняет команды, поставщиков, действия и флаги, но не имена
профилей.

## Export, восстановление и удаление

Перед миграцией backend или обновлением версии создай зашифрованный экспорт:

```bash
airev vault export airev-backup.json
airev vault import airev-backup.json
```

`--plaintext` создаёт файл с живыми credentials. Не помещай его в Git, логи,
облачную синхронизацию или issue. Удали его после переноса.

Вернуться на предыдущий tarball:

```bash
npm install -g /path/to/previous/ai-revolver-<old-version>.tgz
airev --version
```

Удалить глобальную установку:

```bash
npm uninstall -g ai-revolver
```

Откат пакета не откатывает состояние vault. Для состояния используй заранее
созданный export или переключись на сохранённый профиль.

## Разработка

```bash
npm ci
npm run check
npm run build
npm pack --dry-run
git diff --check
```

Проект проверяет типы native-компилятором TypeScript 7:

```bash
npm run type-check
npx tsc --version       # 7.x, native compiler
npx tsc6 --version      # 6.x, compatibility API
```

TypeScript 6 остаётся только для JavaScript API, который нужен
`typescript-eslint`, Stryker и DTS worker в `tsup`. Это ускоряет type-check,
но не меняет Node.js runtime и скорость переключения профилей.

Правила изменений находятся в [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Документация

- [`docs/README.md`](docs/README.md) — карта действующих и исторических документов;
- [`docs/architecture/overview.md`](docs/architecture/overview.md) — компоненты и границы;
- [`docs/operations/profile-lifecycle.md`](docs/operations/profile-lifecycle.md) — рабочий порядок и откат;
- [`docs/security.md`](docs/security.md) — модель угроз и безопасное использование;
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — диагностика типовых отказов;
- [`docs/releasing.md`](docs/releasing.md) — сборка и публикация;
- [`SECURITY.md`](SECURITY.md) — закрытое сообщение об уязвимости.

## Лицензия

[MIT](LICENSE). Торговые марки и сервисы поставщиков принадлежат их владельцам.
