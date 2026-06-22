# Qoder CLI — reverse-engineering заметки

> Дата: 2026-06-22
> Автор: Qoder (по запросу, без правок бинарника)
> Охват: `~/.qoder/**`, бинарник `~/.qoder/bin/qodercli/qodercli-1.0.24`,
>         публичные docs docs.qoder.com, REST probes на openapi/api1 qoder.sh
> Итог: **opaque blob relay** — см. `providers/qodercli.yaml`.

## 1. File layout (`~/.qoder/`)

```
.qoder/
├── .auth/
│   ├── user                  # 1048 B, 0600, base64-looking ciphertext
│   ├── machine_id            # 36 B, UUID v4 plaintext (install-bound, НЕ account)
│   └── dynamic-texts.json    # UI i18n strings, не credentials
├── .bin/runtime-info-linux-x64-*
├── .cache/
│   ├── endpoint-cache.json   # {"prod":{"endpoint":"https://api1.qoder.sh"}}
│   └── dns-cache.json        # IPs для center/api1/openapi.qoder.sh
├── bin/qodercli/qodercli-1.0.24   # Bun SEA binary
├── cache/changelog.json
├── external-commands/registry.json
├── file-history/
├── installation_id
├── logs/runs/<ts-pid>/qodercli.log
├── logs/sessions/<project>/<session>/segments/*.jsonl
├── plugins/installed_plugins_v2.json
├── projects/<path>/<session>.jsonl
├── settings.json             # user preferences
├── state.json                # tipsShown, startupWarningCounts
└── tmp/
```

Plaintext email / user_id **нигде не хранятся**: только в логах/JSONL
сессий (`logs/runs/...`, `projects/.../<session>.jsonl`), что ненадёжно
(ротация, очистка, привязка к сессии, а не к аккаунту).

## 2. Формат `~/.qoder/.auth/user`

- 1048 байт, режим 0600, base64-алфавит (A-Za-z0-9+/), **без** padding `=`
  в наблюдаемом образце и без переносов строк.
- Не JWT: точек-разделителей 0, структура `header.payload.signature`
  отсутствует.
- После `base64 -d` — 784 байт высокой энтропии (наблюдаемый префикс
  удалён как часть чувствительного credential material), без JSON-magic,
  без magic bytes известных контейнеров.
- Размер кратен 16 — признак блочного шифрования (AES-128/256).

В бинарнике qodercli-1.0.24 (Bun SEA, ~30 MB minified JS):
- упоминаются алгоритмы `aes-256-gcm`, `aes-256-cbc`, `chacha20-poly1305`,
  KDF `argon2d/argon2i/argon2id`, `pbkdf2`, `scrypt`, `hkdf`;
- поля `access_token`, `refresh_token`, `id_token`, `expires_in`,
  `expires_at`, `account_id`, `user_id`, `security_oauth_token`
  (внутреннее имя в runtime), `AuthType, userEmail`, `tierName`;
- нет прямых URL `/oauth/token` / `/oauth/authorize` от Qoder — только
  generic OIDC/OAuth2 paths (`/oauth2/authorize`, `/oauth2/v4/token`,
  `/oauth/callback`), вероятно, из зависимостей (node-openid-client и т.п.).

Вывод: файл — зашифрованный контейнер с credentials (at least
access_token + refresh_token + user profile). Ключ шифрования либо
выводится из machine_id через KDF, либо привязан к OS keytar (но
`secret-tool`/libsecret/gnome-keyring/kwallet на тестовой системе пусты —
значит, key derivation локальный). Без реверса бинарника формат закрыт.

## 3. Сетевое поведение (strace)

`strace -f -e trace=connect qodercli --list-models`:

```
connect(19, {AF_INET, port=53,  addr=100.100.100.100}, 16) = 0     # DNS
connect(19, {AF_INET, port=443, addr=8.211.12.32},     16) = 0     # TLS
connect(19, {AF_INET, port=443, addr=8.211.15.87},     16) = 0
```

- 8.211.12.32 / 8.211.15.87 / 8.211.19.0 / 8.211.37.33 — Alibaba Cloud
  (соответствует A-записям `center.qoder.sh`, `api1.qoder.sh`,
  `openapi.qoder.sh` из dns-cache.json).
- Все соединения — port 443 (TLS). Plaintext токенов в трафике нет.
- DNS resolver: 100.100.100.100 (Alibaba internal DNS).

## 4. Публичные REST endpoints (пробовали с blob как Bearer)

| Host                  | Path                     | Ответ                      |
|-----------------------|--------------------------|----------------------------|
| openapi.qoder.sh      | /api/v1/userinfo         | 401 `TOKEN_INVALID`        |
| openapi.qoder.sh      | /api/v2/user/plan        | 401 `TOKEN_INVALID`        |
| openapi.qoder.sh      | /api/v2/quota/usage      | 401 `TOKEN_INVALID`        |
| openapi.qoder.sh      | /api/v3/user/status      | 401 `TOKEN_INVALID`        |
| openapi.qoder.sh      | /api/v1/user/profile     | 302                        |
| openapi.qoder.sh      | /api/v1/jobToken/refresh | 302                        |
| api1.qoder.sh         | /api/v1/userinfo (+UA qodercli/1.0.24) | 404 `notfound` |

Вывод: raw blob **не является** access_token. CLI внутри себя расшифровывает
blob и получает настоящий access_token, который уже идёт в Bearer. Формат
внутреннего access_token нам неизвестен, перехватывать через MITM —
неприемлемо (TLS + корневой сертификат пользователя).

## 5. TUI-only команды

- `/status` в TUI выводит: Version, Username, Email, Avatar URL (с
  `user_id` в пути). **Но** `qodercli --print` возвращает
  `Exiting due to command result that is not supported in non-interactive mode.`
- `/usage` аналогично: только TUI.
- `qodercli status` (субкоманда, не slash) — отдаёт Version/Username/Email/Avatar
  plaintext, НО, судя по всему, тоже делает сетевой запрос (проверено strace:
  connect к api1.qoder.sh:443). Без blob в `~/.qoder/.auth/user` команда
  падает с «Not logged in. Run `qodercli login` to authenticate.»

То есть `qodercli status` теоретически можно было бы парсить для identity,
но только если blob на месте и валиден; в offline-режиме он бесполезен.
Для ai-revolver это ломает модель «прочитал файл — получил identity»,
поэтому мы **не** парсим status, а берём сам blob как identity.

## 6. Экспериментально подтверждённое

| #  | Действие                                                          | Результат                                                          |
|----|-------------------------------------------------------------------|--------------------------------------------------------------------|
| 1  | `ls -la ~/.qoder/.auth/`                                          | user=1048B/0600, machine_id=36B, dynamic-texts.json                |
| 2  | `xxd ~/.qoder/.auth/user \| head`                                 | Высокая энтропия, нет JSON-magic, нет header                       |
| 3  | `qodercli --list-models` ×2, `stat` mtime                         | mtime не изменился → CLI не переписывает файл при read-only        |
| 4  | `rm ~/.qoder/.auth/user` + `qodercli --list-models`               | «Not logged in. Run `qodercli login` to authenticate.»             |
| 5  | `cp --preserve=mode,timestamps backup user` + `qodercli --list-models` | Работает как до удаления                                      |
| 6  | `qodercli status` (TUI)                                           | Version 1.0.24 / Username / Email / Avatar URL                     |
| 7  | `echo /status \| qodercli --print`                                | «command result that is not supported in non-interactive mode»     |
| 8  | `qodercli --list-models`                                          | `MODEL: Lite, Qwen3.7-Max`                                         |
| 9  | `curl openapi.qoder.sh/api/v1/userinfo -H "Authorization: Bearer $BLOB"` | 401 TOKEN_INVALID                                          |
| 10 | `curl api1.qoder.sh/api/v1/userinfo -H "UA: qodercli/1.0.24"`     | 404 notfound                                                       |
| 11 | `strace -f -e trace=connect qodercli --list-models`               | TLS-коннекты к 8.211.x.x (Alibaba), без plaintext в trассе         |
| 12 | `grep -r "user@example.com" ~/.qoder`                          | Найден ТОЛЬКО в logs/runs и projects/*.jsonl, нигде в auth-слое    |

## 7. Выбранная модель: opaque blob relay

### `providers/qodercli.yaml` (окончательно)

```yaml
name: qodercli
auth_methods:
  oauth:
    credential_file:
      path: "${HOME}/.qoder/.auth/user"
      format: binary-passthrough     # НОВЫЙ формат (см. §8)
      mapping:
        user_blob: "."               # весь файл — одна credential
      grab_fields: []
      permissions: 0o600
      atomic_write: true
      preserve_unknown_fields: false
  api_key:
    env:
      QODER_PERSONAL_ACCESS_TOKEN: "${api_key}"

detection:
  commands: ["qodercli"]
  paths: ["${HOME}/.qoder/"]

identity:
  fields: ["user_blob"]              # одинаковый blob = один аккаунт
  display: ["${user_blob}"]          # см. §9 про утечку в stdout
```

### Поведение

- `airev qodercli grab <name>`: читает `~/.qoder/.auth/user` как UTF-8,
  кладёт в vault под `credentials.user_blob`.
- `airev qodercli switch <name>`: пишет `credentials.user_blob` обратно
  в `~/.qoder/.auth/user` byte-for-byte, с chmod 0600.
- `airev qodercli sync <name>`: freshness по mtime файла (нет embedded
  `last_refresh`); identity check по полному совпадению blob.
- `airev usage` для qodercli: no-op (нет probes).
- `airev env`: выставляет `QODER_PERSONAL_ACCESS_TOKEN` для api_key-профиля
  (но у нас он oauth — этот путь используется только если пользователь
  явно сделал `airev qodercli grab <name> --api-key qoder_...`).

## 8. Изменения в ядре ai-revolver

Чтобы поддержать opaque blob, добавлен новый format `binary-passthrough`:

- `src/types/index.ts`: `ProviderCredentialFileFormat += "binary-passthrough"`.
- `src/providers/reader.ts`: early-return — `fs.readFile(path, "utf-8")` →
  `credentials[mapping-key-for-"."] = content`; grab_data пустой; keytar
  игнорируется.
- `src/providers/writer.ts`: early-return — `fs.writeFile(path, blob, {mode})`;
  без merge, без preserve_unknown_fields, без keytar.
- `src/platform/fs.ts`: helper `writeBinaryFile()` поверх `atomicWrite`.
- `src/commands/grab.ts`: синтетический `rawJson` из blob для extractIdentity.
- `src/commands/sync.ts`: то же + recheck для push-vault-to-fs.
- `src/commands/status.ts`: `fsRawJson` из readCredentials, а не parse JSON.

## 9. Известные ограничения / tradeoffs

1. **Identity display светит полный blob в stdout.** При identity mismatch
   `airev sync` покажет 1048-байт blob в обе стороны (vault/FS). Для
   mitigation нужно добавить truncation DSL в identity display (`${var:8}`),
   но это отдельная задача.
2. **Нет token_refresh.** Протухший blob лечится только `qodercli login`.
   Это честное ограничение — у gemini/qwen то же самое.
3. **Нет usage probe.** `/usage` работает только в TUI, публичного REST нет.
4. **Identity = ciphertext.** Смена аккаунта на том же qoder-аккаунте
   (например, перевыпуск credentials на сайте) → новый blob → identity
   mismatch при sync. Лечится `grab --force`.
5. **Satellite render не протестирован in vivo.** По модели — blob пишется
   в `~/.airev/satellites/qodercli/<name>/user` и работает только если
   пользователь симлинк/копирует его на место нативного пути. Для qodercli
   satellite-сценарий менее востребован, чем для claude/codex.

## 10. Что НЕ делали (и почему)

- **Реверс бинарника** (Ghidra/IDA над Bun SEA): слишком дорого для
  одноразовой интеграции, и формат будет меняться с релизами qodercli.
- **MITM TLS** с подменой сертификата: неприемлемо по безопасности.
- **Keytar/DPAPI fallback:** на тестовой машине системный keyring пуст —
  qodercli использует локальный KDF, а не OS secret store.
- **Парсинг `qodercli status`:** работает только online и только при
  валидном blob; добавляет runtime-зависимость от subprocess.

## 11. Подтверждение из официальной SDK docs

`docs.qoder.com/en/cli/sdk/authentication` (проверено 2026-06-22):
официальный Qoder Agent SDK (`@qoder-ai/qoder-agent-sdk`) для Node.js
поддерживает **три** способа аутентификации:

1. `accessTokenFromEnv()` — читает `QODER_PERSONAL_ACCESS_TOKEN`.
2. `accessToken(token)` — принимает токен напрямую от хост-приложения.
3. **`qodercliAuth()` — «Reuse the local `qodercli` login session»**.

Ключевая цитата:
> If you have already completed login via `qodercli` on the local machine,
> you can let the SDK **delegate to the CLI** to read the existing
> credentials. This method works well in interactive local environments
> and is **not recommended for stateless CI**.

SDK **НЕ** парсит `~/.qoder/.auth/user` сам. Он запускает `qodercli`
как subprocess и получает от него credential. Формат файла намеренно
не раскрывается — даже официальный SDK не имеет к нему прямого доступа.

Это **независимое подтверждение** правильности opaque blob relay:
если сам Qoder не публикует формат и не даёт SDK читать файл напрямую,
то ai-revolver тоже не должен пытаться его парсить. Relay = корректная
модель интеграции, а не временный workaround.

Дополнительно: «The SDK does not automatically refresh PATs. The host
application should create a new `query()` session with a new `auth`
configuration after obtaining a new token.» — значит, и у нас отсутствие
`token_refresh` в YAML соответствует официальному поведению, не баг.

## 12. Точки расширения на будущее

- Если Qoder опубликует формат blob или публичный `/usage` REST под PAT —
  добавляем `token_refresh` и `usage.probes[]` в YAML, не трогая relay.
- Если появится `qodercli config get email` (non-interactive) — используем
  для identity вместо blob ciphertext.
- Truncation DSL для identity display — общая фича, покроет и qodercli,
  и длинные JWT у Codex.
