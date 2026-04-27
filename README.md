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
airev provider list                # доступные провайдеры

airev vault path                   # где лежат registry / active / stale / vault
airev vault status                 # какой backend используется
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
- **Vault commands** — `vault export/import` основной интерфейс переносимости; `vault migrate <keyring|file>` локально переносит entries между backend-ами через copy → verify → optional delete-source. Если keyring доступен, но пустой, а `vault.enc` существует, обычный CLI читает `vault.enc`; поэтому `migrate file --yes` реально переключает на file-backend, а `--keep-source` остаётся fallback-copy. Старые top-level `export/import` оставлены как совместимые алиасы.

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
npm run build      # tsup → dist/
npm link           # глобальный airev → junction на этот workspace (Windows)
airev --help
```

> Без `npm link` глобальный `airev` в `%APPDATA%\npm\node_modules\ai-revolver`
> остаётся **копией** — изменения в src/ не подхватываются.
