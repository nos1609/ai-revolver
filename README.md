# airev — AI CLI Profile Manager

Мгновенное переключение между учётками Codex, Claude, Gemini, Qwen. Один бинарь, один vault, одна команда.

## TL;DR

```bash
airev codex grab work              # захватить текущую сессию как профиль "work"
airev codex switch personal        # переключиться (Windows Hello / Touch ID)
airev codex rename work main       # переименовать
airev codex drop old               # удалить

airev list                         # все профили (все провайдеры)
airev status                       # локальный статус (быстро, без сети)
airev usage                        # live-лимиты 5h / 7d по ВСЕМ oauth-профилям
airev usage <name>                 # по конкретному профилю (кросс-провайдер)
airev codex usage                  # все профили одного провайдера

airev env --shell powershell       # env-экспорты для shell-хука
airev completion powershell        # автодополнение для shell
airev provider list                # доступные провайдеры

airev vault path                   # где лежат registry / active / stale / vault
airev vault status                 # какой backend используется
airev vault passwd                 # сменить пароль локального vault.enc (если active backend = file)
airev vault export backup.json     # encrypted export, пароль = транспортный
airev vault export backup.json --plaintext  # без шифрования (⚠ живые токены в файле)
airev vault import backup.json     # восстановить; конфликты по name+provider → skip
airev vault import backup.json --replace --restore-active
airev vault migrate file --keep-source  # fallback-copy в vault.enc, source оставить
airev vault migrate file --yes  # copy+verify, удалить keyring; дальше читается vault.enc
airev vault migrate keyring --yes  # copy+verify, затем удалить source entries
```

## Что такое

- **Профиль** = именованная учётка CLI-клиента (`codex`, `claude`, …) со своими OAuth-токенами.
- **Vault** — зашифрованное хранилище, ключ — биометрия ОС (Windows Hello / Touch ID / DBus).
- **Switch** — мгновенный: подменяет CLI-файл (`~/.codex/auth.json`, `~/.claude/.credentials.json`) атомарно, без перезапуска клиента.
- **Usage** — читает живые rate-limits напрямую из API провайдера, при 401 сам рефрешит токен (и для неактивных профилей пишет только в vault — не трогая файл активного).
- **Claude / rotating creds** — для active-профиля `usage` сначала читает системный `~/.claude/.credentials.json`, а если vault-креды признаны мёртвыми, профиль помечается как `stale` и больше не дёргается автоматически, пока его не обновят через `airev claude grab <name>`.
- **Stale state** — `stale.json` локальный кэш наблюдений, а не часть профиля: он не экспортируется и не импортируется; успешный `grab` снимает stale-флаг.
- **Транспортный пароль** — пароль export/import-файла. В английской локали это `transfer file password`; он не становится паролем локального `vault.enc`.
- **Пароль локального vault-а** — пароль только для `vault.enc`; меняется через `vault passwd`, если effective backend сейчас `encrypted-file`. Для OS keyring этот пароль не применяется.
- **Vault commands** — `vault export/import` основной интерфейс переносимости; `vault migrate <keyring|file>` локально переносит entries между backend-ами через copy → verify → optional delete-source. Если keyring доступен, но пустой, а `vault.enc` существует, обычный CLI читает `vault.enc`; поэтому `migrate file --yes` реально переключает на file-backend, а `--keep-source` остаётся fallback-copy. Старые top-level `export/import` оставлены как совместимые алиасы.
- **Автодополнение shell** — `airev completion <shell>` печатает скрипт для `bash`, `zsh`, `fish` или `powershell`. Первая версия дополняет команды, провайдеры, действия и флаги, но не имена профилей.

## Автодополнение

PowerShell:

```powershell
airev completion powershell | Out-String | Invoke-Expression
```

Bash:

```bash
eval "$(airev completion bash)"
```

Zsh:

```zsh
eval "$(airev completion zsh)"
```

Fish:

```fish
airev completion fish | source
```

## Поддерживаемые провайдеры

Декларативные yaml-манифесты в `providers/`. На сегодня:

| Провайдер | OAuth | API key | Usage |
|-----------|:-----:|:-------:|:-----:|
| codex (OpenAI) | ✓ | ✓ | 5h + 7d |
| claude (Anthropic) | ✓ | ✓ | 5h + 7d |
| gemini (Google) | ✓ | ✓ | — |
| qwen (Alibaba) | ✓ | ✓ | — |

## Документация

- **Архитектура и дизайн** → [`plans/05-design-v2.md`](plans/05-design-v2.md)
- **Провайдер-specific findings** (endpoints, JWT-трюки, подводные камни) → [`docs/findings.md`](docs/findings.md)
- **Road-map / фазы** → в конце `plans/05-design-v2.md`

## Разработка

```bash
npm install
npm test
npm run build      # tsup → dist/
airev --help
```

### Локальная dev-установка

`npm link` удобен только для разработки на той же машине, где лежит workspace:

```bash
npm link
which airev       # Linux/macOS
where.exe airev   # Windows
airev --version
```

Без `npm link` глобальный `airev` остаётся копией в global npm prefix и изменения
в `src/` не подхватывает:

- Windows: `%APPDATA%\npm\node_modules\ai-revolver`
- Linux/macOS: смотри `npm root -g`

### Сборка installable tarball

Для установки на другую машину собирай npm tarball:

```bash
npm ci
npm test
npm run build
npm pack
```

На выходе будет файл вида:

```text
ai-revolver-<version>.tgz
```

Проверить содержимое без создания архива:

```bash
npm pack --dry-run
```

### Установка tarball на Linux

Если tarball собран на другой машине, сначала перенеси его на Linux:

```bash
scp ai-revolver-<version>.tgz user@linux-host:/tmp/
```

На Linux:

```bash
npm install -g /tmp/ai-revolver-<version>.tgz
airev --version
which airev
npm root -g
```

Если репозиторий уже есть на Linux и нужно собрать прямо там:

```bash
git pull --ff-only
npm ci
npm test
npm run build
npm pack
npm install -g ./ai-revolver-<version>.tgz
airev --version
```

### Rollback установки

Вернуться на предыдущий tarball:

```bash
npm install -g /path/to/previous/ai-revolver-<old-version>.tgz
airev --version
```

Полностью убрать глобальную установку:

```bash
npm uninstall -g ai-revolver
```
