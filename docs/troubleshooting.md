# Диагностика ai-revolver

## Сначала зафиксируй состояние

Не выводи token, credential file или vault content. Собери только безопасные
факты:

```bash
airev --version
airev provider list
airev vault status
airev vault path
airev status
```

Проверь активный executable:

```bash
which airev       # Linux/macOS
where.exe airev   # Windows
npm root -g
```

## `--force` стал именем профиля

Симптом: после `grab --force` появился профиль с именем `--force`.

Причина: запущена старая сборка с positional parser или другой глобальный
`airev`.

Проверка:

```bash
airev --version
which airev
airev codex grab --froce work
```

Текущая версия должна отклонить опечатку `--froce`. После обновления удали
ошибочный профиль только когда убедишься, что нужный профиль сохранён:

```bash
airev codex list
airev codex drop -- --force
```

`--` переводит оставшийся token в literal profile name.

## Linux не переключает профили

Сначала проверь backend:

```bash
command -v secret-tool || true
airev vault status
```

Возможные состояния:

- `secret-tool` отсутствует: установи пакет libsecret для своей системы или
  используй `vault.enc`;
- Secret Service не запущен: запусти пользовательскую графическую сессию или
  используй encrypted-file fallback;
- keyring пуст, но `vault.enc` существует: CLI намеренно открывает файл;
- wrong password: проверь пароль локального vault, не transfer password.

Не запускай `sudo airev`: root получит другой home, config directory и keyring.

## `switch aborted: pre-sync`

Симптом означает, что outgoing active profile не удалось безопасно сохранить
до перезаписи native file. Новый профиль ещё не должен быть записан.

```bash
airev <provider> status
airev <provider> sync <outgoing-name> --dry-run
```

Разбери конкретную причину:

- `identity mismatch`: native file принадлежит другой учётной записи;
- `identity not recorded`: profile создан старой версией без identity snapshot;
- `FS changed concurrently`: provider CLI обновил файл во время sync;
- missing refresh token: одна или обе стороны degraded;
- file missing: active metadata и фактический credential path расходятся.

Повтори `sync` после остановки исходного CLI. Используй `grab --force` только
если проверил, что native file является нужным источником. Используй
`switch --force` только для аварийного восстановления из заведомо исправного
vault profile.

## Profile помечен как `stale`

`stale` означает, что live probe подтвердил недействующие credentials. Выполни
повторный вход в исходном CLI, затем обнови тот же profile:

```bash
airev <provider> grab --force <name>
airev <provider> status
```

Успешный `grab` снимает stale marker. Простое переименование профиля не лечит
token.

## `secret-tool` есть, но backend недоступен

Наличие executable не доказывает доступность D-Bus Secret Service. Проверь
пользовательскую сессию и затем повтори:

```bash
airev vault status
```

Для headless host используй file backend:

```bash
airev vault migrate file --keep-source
airev vault status
```

Перед миграцией создай encrypted export. Не удаляй source до проверки target.

## Copilot сообщает о missing keytar secret

Copilot хранит metadata в JSONC, а token — во внешнем credential store. Убедись,
что Copilot CLI вошёл в аккаунт в той же пользовательской сессии. Не создавай
ручной token fixture и не помещай key в `providers/copilot.yaml`.

Повтори provider login, затем:

```bash
airev copilot grab <name>
```

## Qoder identity mismatch

Qoder credential является непрозрачным encrypted blob. Перевыпуск credentials
может изменить blob для того же account. `airev` намеренно не выводит его.

Войди в нужный account через Qoder CLI и только затем обнови profile:

```bash
airev qodercli grab --force <name>
```

Не прикладывай `~/.qoder/.auth/user` к issue.

## `usage` возвращает `401` или ничего не показывает

`usage` поддерживают не все manifests. Проверь таблицу README. Для provider с
refresh flow повторный `401` может пометить profile как stale.

```bash
airev <provider> usage <name>
airev <provider> status
```

Не считай provider dashboard и `airev usage` идентичными источниками: endpoint,
окно агрегации и задержка могут различаться.

## Остался lock

Сначала убедись, что другой процесс `airev` не работает. Затем очисти lock
точного профиля:

```bash
airev vault unlock <provider> <name>
```

Не удаляй весь каталог locks: это может нарушить параллельную операцию другого
профиля.

## Что приложить к закрытому отчёту

- OS и Node.js major version;
- `airev --version`;
- provider name и command без profile email;
- error text с очищенными ids и paths;
- effective vault backend;
- минимальные шаги воспроизведения;
- результат `npm run check`, если ошибка воспроизводится из source checkout.

Не прикладывай exports, native credential files, `vault.enc`, environment или
полный `airev vault path`, если он раскрывает персональный username.
