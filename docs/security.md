# Безопасность ai-revolver

## Модель угроз

`ai-revolver` запускается локально с правами текущего пользователя и работает с
credentials уже установленных provider CLIs. Основные угрозы:

- раскрытие live token через Git, shell history, logs, process arguments или
  plaintext export;
- запись credentials другого аккаунта в native file;
- потеря более свежего refresh token при переключении;
- чтение vault другим процессом текущего пользователя;
- offline-подбор пароля к скопированному `vault.enc`;
- изменение недокументированного provider format;
- запуск непроверенного кода из публичного pull request на доверенном runner.

Проект не защищает систему после компрометации пользовательской сессии или
процесса с теми же правами. OS keyring и шифрование файла уменьшают риск
случайного раскрытия на диске, но не создают отдельную security boundary внутри
уже захваченного аккаунта ОС.

## Классификация данных

| Данные | Чувствительность | Место |
|---|---|---|
| OAuth/API credentials | секрет | OS keyring или `vault.enc` |
| `grab_data` и identity snapshot | может содержать account id или email | vault |
| Profile name | может содержать персональные данные | `registry.json` |
| Active profile id | служебные metadata | `active.json` |
| Stale profile ids | служебные metadata | `stale.json` |
| Satellite credential file | секрет | каталог `satellites/` |
| Encrypted export | секретный переносимый контейнер | путь пользователя |
| Plaintext export | live secret material | путь пользователя до удаления |

Не прикладывай ни один из этих файлов к issue. Даже `registry.json` нужно
очистить, если profile names содержат email или внутренние названия.

## Хранилища

### OS keyring

- Windows использует DPAPI, привязанный к текущему пользователю.
- Linux использует Secret Service через `secret-tool`.
- macOS использует Keychain через встроенную команду `security`.

Разблокированная пользовательская сессия может разрешить доступ без отдельного
пароля `airev`. Защити сам аккаунт ОС, экран блокировки и резервные копии.

### Encrypted file

`vault.enc` использует AES-256-GCM. Ключ выводится из пароля через `scrypt` с
уникальной солью. Файл имеет POSIX mode `0600`, когда платформа поддерживает
эти права.

Скопированный файл можно атаковать offline. Используй длинный уникальный пароль
и не храни его рядом с файлом. Пароль transfer export и пароль локального
`vault.enc` являются разными значениями.

## Защита записи

- Profile operations используют advisory lock.
- Credential files записываются атомарно.
- `switch` запускает pre-sync исходящего профиля.
- `sync` сравнивает account identity и freshness.
- Empty sensitive values не перезаписывают непустой `refresh_token`.
- Forced `sync` требует `--push` или `--pull`.
- Opaque `qodercli`, `agy` и `qwen` refresh credentials сравниваются по SHA-256
  digest; исходные значения не входят в identity snapshots и diagnostics.

Эти проверки уменьшают риск, но явный `--force` может обойти identity или
pre-sync. Перед ним зафиксируй источник, который должен победить, и создай
encrypted export.

## Опасные интерфейсы

### API key в аргументе

`grab --api-key <key>` может оставить key в shell history и кратко показать его
другим локальным процессам через process list. Предпочитай интерактивный вход
исходного CLI или очищай history согласно политике своей shell.

### Env output

`airev env` выводит exports, которые могут содержать API keys. Не направляй
вывод в CI log, issue или общий терминал. Shell tracing (`set -x`) должен быть
выключен.

### Plaintext export

`airev vault export --plaintext` создаёт полноценную копию live credentials.
Используй этот режим только в изолированном локальном переносе. Удали файл и
проверь, что он не попал в Git, backup sync или shell transcript.

### Usage probes

`usage` выполняет HTTPS-запросы к endpoint поставщика. При `401` manifest может
разрешить refresh и локальное сохранение обновлённого token. Не запускай
`usage`, если требуется строго offline-поведение.

## Provider contracts

Часть форматов и endpoint не имеет стабильного публичного API. Manifests
основаны на локально наблюдаемом поведении и доступной документации. Перед
изменением:

1. проверь актуальную версию исходного CLI;
2. не перехватывай TLS и не обходи защиту поставщика;
3. не сохраняй raw credential в test fixture;
4. используй синтетические значения `example.test`;
5. обнови [`source-attribution.md`](source-attribution.md) и regression test.

## Публичная разработка и CI

Не запускай код внешнего pull request на постоянном self-hosted runner с
доступом к home directory, OS keyring, npm token или private network. Текущий
Forgejo workflow должен принимать только push доверенного maintainer. Для PR
используй одноразовый изолированный runner без секретов либо ручной локальный
gate после проверки diff.

## Реакция на раскрытие

1. Останови публикацию и не копируй секрет в новый отчёт.
2. Отзови или ротируй token у поставщика.
3. Удали plaintext export и проверь backup/sync destinations.
4. Определи, попал ли секрет в commit, remote ref, package или release asset.
5. Для опубликованной Git-истории подготовь отдельное согласованное rewrite.
6. Повтори secret scan с redaction и выпусти новый token.

Закрытый порядок сообщения об уязвимости находится в
[`../SECURITY.md`](../SECURITY.md).
