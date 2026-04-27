# Vault Transport Passwords and Backend Migration Design

Дата: 2026-04-27
Статус: design spec, без реализации

## Цель

Сделать перенос credentials безопасным и понятным в двух разных сценариях:

1. Перенос между машинами через `vault export` / `vault import`.
2. Локальная конвертация backend-а через `vault migrate <keyring|file>`.

Главное требование: пользователь не должен путать пароль переносимого export-файла с паролем локального encrypted-file vault-а. Эти пароли защищают разные объекты, живут разное время и имеют разные security-свойства.

## Термины

**Transfer file password** / **транспортный пароль**  
Пароль для переносимого export-файла. Используется только для шифрования/расшифровки `airev-export-*.json`. Не становится паролем локального vault-а на машине импорта.

**Vault master password** / **пароль локального vault-а**  
Пароль для локального `vault.enc`, когда OS keyring недоступен или когда пользователь явно мигрирует в encrypted-file backend.

**Keyring backend**  
OS-хранилище: Windows DPAPI / macOS Keychain / Linux libsecret. Пароль airev не используется; доступ контролируется ОС.

**Encrypted-file backend**  
Локальный файл `vault.enc`, зашифрованный vault master password.

## Пользовательский UX

### Export

Команда:

```bash
airev vault export backup.json
```

Если экспорт encrypted, prompt должен говорить именно про транспортный пароль:

```text
🔐 Транспортный пароль export-файла:
🔐 Повтори транспортный пароль:
```

English:

```text
🔐 Export transfer file password:
🔐 Confirm transfer file password:
```

`--plaintext` оставляет текущую семантику: export без шифрования и с явным предупреждением о живых credentials.

### Import на машине с keyring

Команда:

```bash
airev vault import backup.json
```

Если import-файл encrypted:

```text
🔐 Транспортный пароль import-файла:
```

После расшифровки credentials пишутся в keyring. Vault master password не спрашивается, потому что локальное хранилище не file-based.

### Import на машине без keyring

Если import-файл encrypted и `vault.enc` отсутствует:

```text
🔐 Транспортный пароль import-файла:
🔐 Новый пароль локального vault-а:
🔐 Повтори пароль локального vault-а:
```

Если import-файл plaintext и `vault.enc` отсутствует:

```text
🔐 Новый пароль локального vault-а:
🔐 Повтори пароль локального vault-а:
```

Если `vault.enc` уже существует:

```text
🔐 Пароль локального vault-а:
```

Для нового `vault.enc` подтверждение обязательно. Несовпадение паролей abort-ит import до записи credentials.

## Backend Migration UX

Команда должна оставаться одной операцией конвертации:

```bash
airev vault migrate file
airev vault migrate keyring
```

Source backend определяется как текущий auto-selected backend `openVault()`: keyring, если он доступен, иначе encrypted-file. Target backend берётся из аргумента команды. Если source и target совпадают, команда падает без действий.

Публичных режимов `copy` / `move` не вводим. Семантика:

1. Скопировать все entries source -> target.
2. Проверить, что target содержит все скопированные entries.
3. Только после успешной verify спросить, удалять ли source entries.
4. По умолчанию source не удаляется.

Пример:

```text
Migrating vault: keyring -> encrypted-file
Entries: 12

Copied: 12
Verified: 12

Delete source entries from keyring? This leaves encrypted-file as the only vault copy. [y/N]
```

Флаги для неинтерактивного режима:

```bash
airev vault migrate file --yes
airev vault migrate file --keep-source
```

`--yes` означает: после успешной verify удалить source entries без prompt.  
`--keep-source` означает: после успешной copy+verify оставить source и не спрашивать.  
Без TTY и без `--yes` / `--keep-source` команда должна падать до копирования.

Важно: если keyring доступен, но пустой, а `vault.enc` существует, обычный `openVault()` должен fallback-иться на encrypted-file. Поэтому `migrate file --yes` является полноценным переходом keyring -> file: copy -> verify -> delete keyring entries -> последующие команды читают `vault.enc`. `migrate file --keep-source` остаётся fallback-copy и не переключает backend, пока keyring содержит entries.

`--yes` и `--keep-source` взаимоисключающие. Команда должна падать до открытия vault-ов с сообщением `Use either --yes or --keep-source, not both`.

## Security Invariants

1. Transfer file password / транспортный пароль и vault master password не взаимозаменяемы и не переиспользуются автоматически.
2. Import не должен создавать новый `vault.enc` без подтверждения нового vault master password.
3. Migration не должна создавать промежуточный export JSON.
4. Migration не удаляет source до полной verify target.
5. Если target уже содержит любую мигрируемую entry и нет явного `--replace`, операция падает до копирования.
6. В логах нельзя печатать credentials, refresh tokens, access tokens или полный список profile ids.
7. Summary допускает только counts и backend names: `copied`, `verified`, `deleted`, `kept`.
8. `delete source entries` не обещает secure wipe. Для `vault.enc` это логическое удаление с перезаписью файла; физическое стирание на SSD/journaling FS не гарантируется.
9. При `keyring -> file` нужно предупредить, что `vault.enc` является копируемым offline blob-ом и безопасность зависит от силы vault master password.
10. При `file -> keyring` нужно предупредить, что после удаления source доступ будет зависеть от OS user/session keyring.
11. Delete-source удаляет только snapshot ids, которые реально копировались и прошли verify; после `remove()` каждый id должен больше не читаться из source.

## Архитектурные изменения

### Password prompt слой

Нужны отдельные функции или явные prompt-purpose:

```ts
promptTransportPassword("export" | "import")
promptNewVaultPassword()
promptExistingVaultPassword()
```

`promptNewVaultPassword()` всегда делает confirm. `promptExistingVaultPassword()` не делает confirm.

### Vault factory

`openVault()` сейчас выбирает лучший backend автоматически. Для import и migrate нужны дополнительные возможности:

```ts
openVault({
  confirmNewFilePassword?: boolean;
  purpose?: "default" | "import" | "migration";
})
```

Для миграции также нужен явный backend open, чтобы читать и писать не только auto-selected backend:

```ts
openVaultBackend("keyring" | "encrypted-file", options)
```

`openVaultBackend("encrypted-file")` должен:

- если `vault.enc` существует, спросить existing vault master password;
- если не существует, спросить new vault master password + confirm;
- abort до создания файла, если confirm не совпал.

### Migration core

Низкоуровневый API:

```ts
type VaultBackendName = "keyring" | "encrypted-file";
type MigrationCleanup = "prompt" | "delete-source" | "keep-source";

interface VaultMigrationOptions {
  source: VaultBackendName;
  target: VaultBackendName;
  cleanup: MigrationCleanup;
  replace?: boolean;
  isTty: boolean;
}
```

Core-функция не должна сама парсить CLI args. Она должна принимать открытые vault stores или backend descriptors и возвращать report:

```ts
interface VaultMigrationReport {
  source: VaultBackendName;
  target: VaultBackendName;
  copied: number;
  verified: number;
  deleted: number;
  keptSource: boolean;
}
```

### Export/import separation

`export/import` и `migrate` могут переиспользовать crypto и vault-store интерфейс, но не должны сливаться в одну реализацию через export-файл.

Причина: export-файл является переносимым артефактом с отдельным threat model. Migration должна быть локальным backend-to-backend переносом без третьей копии credentials на диске.

## Error Handling

Import:

- неверный transfer file password / транспортный пароль -> import падает до открытия локального vault-а;
- новый vault password не совпал с confirm -> import падает до записи credentials;
- существующий `vault.enc` не открылся -> import падает без изменения registry/vault;
- конфликт profile name/provider сохраняет текущую семантику `--replace`.

Migration:

- target равен source -> понятная ошибка без действий;
- target conflict без `--replace` -> ошибка до копирования;
- ошибка copy -> source не удаляется;
- ошибка verify -> source не удаляется;
- ошибка delete source -> report должен показать, что target verified, но cleanup incomplete;
- non-TTY без `--yes` / `--keep-source` -> ошибка до копирования.

## TDD Plan

Тесты пишутся до production-кода.

1. Prompt labeling:
   - export вызывает `promptTransportPassword("export")`;
   - encrypted import вызывает `promptTransportPassword("import")`;
   - создание нового encrypted-file vault вызывает `promptNewVaultPassword()`.

2. New vault password confirmation:
   - если `vault.enc` отсутствует и confirm совпал, vault создаётся при первой записи;
   - если confirm не совпал, import падает до `applyImport()`;
   - если `vault.enc` существует, confirm не спрашивается.

3. Migration conflict preflight:
   - target содержит мигрируемый id и `replace=false` -> ни одной записи не копируется;
   - `replace=true` разрешает overwrite.

4. Migration copy/verify/delete:
   - успешная migration копирует все entries и проверяет target;
   - `keep-source` оставляет source entries;
   - `delete-source` удаляет source только после verify всех entries;
   - verify failure не удаляет source.

5. CLI non-TTY:
   - `vault migrate file` без TTY и без `--yes/--keep-source` падает до копирования;
   - `--yes` проходит без prompt;
   - `--keep-source` проходит без prompt.

6. Logging:
   - migration summary содержит counts/backend names;
   - migration output не содержит raw tokens.

## Non-Goals

- Не реализовывать secure wipe как обещание безопасности.
- Не переносить `stale.json` через export/import.
- Не делать transfer file password / транспортный пароль паролем локального `vault.enc`.
- Не добавлять глобальную настройку preferred backend в этой итерации.
- Не менять формат export payload без необходимости.

## Open Decisions

1. Нужен ли `--replace` в первой версии migration или лучше сначала fail-only preflight.
2. Нужна ли отдельная команда `vault backend set encrypted-file` в будущем, чтобы `migrate file --keep-source` на Windows реально переключал backend при доступном keyring.
3. Нужен ли минимальный password policy для нового vault master password или достаточно confirm + предупреждения.
