# Сборка и публикация

## Назначение

Этот порядок отделяет проверку исходников, создание пакета, публикацию Git и
публикацию npm. Ни один локальный зелёный тест не означает, что внешний шаг уже
выполнен.

Изменение repository visibility, push, tag, release и `npm publish` являются
отдельными внешними записями. Выполняй каждую только после явного решения
владельца.

## Предварительные условия

- Рабочее дерево содержит только согласованные изменения.
- Публичный remote URL, homepage, bugs URL и private security channel выбраны.
- `package.json` содержит новую версию, которую ещё не публиковали.
- Публикуемая Git-история прошла secret и personal-data scan.
- Provider contracts и внешние client ids проверены на право распространения.
- CI для внешних PR не использует доверенный постоянный self-hosted runner.
- Есть предыдущий tarball и encrypted profile export для локального rollback.

Храни датированный статус этих условий во внутренней release-записи вне
публикуемых Git-refs и npm-пакета.

## 1. Зафиксируй исходное состояние

```bash
git status --short --branch
git remote -v
git log -1 --oneline
node --version
npm --version
```

Не включай в commit `*.tgz`, `airev-export-*.json`, local recovery scripts,
`tmp/`, `coverage/` или `.remember/`.

## 2. Обнови release metadata

Выбери SemVer по фактическому изменению. Текущая версия не должна повторно
описывать другой набор кода.

```bash
npm version --no-git-tag-version <version>
git diff -- package.json package-lock.json
```

До появления публичного URL не записывай в `repository`, `homepage` и `bugs`
локальный `localhost` remote или вымышленный адрес.

## 3. Выполни локальные проверки

```bash
npm ci
npm install-scripts ls
npm run check
npm run build
npm audit --omit=dev
git diff --check
```

Проверь версии compiler layers:

```bash
npx tsc --version
npx tsc6 --version
```

TypeScript 7 должен выполнять project type-check. TypeScript 6 остаётся API
для lint/DTS tooling до завершения миграции экосистемы.

`npm install-scripts ls` не должен показывать незапланированные blocked или
allowed scripts. `package.json` разрешает только точную проверенную версию
`esbuild`; обновление этого pin требует отдельного review.

## 4. Проверь tarball

```bash
npm pack --dry-run --json
npm pack --json
tar -tf ai-revolver-<version>.tgz
```

В архиве ожидаются только package metadata, README, LICENSE, SECURITY,
действующая документация, `dist/` и `providers/`. В нём не должно быть tests,
source maps с локальными путями, recovery scripts, exports или reports.

Выполни изолированный smoke без глобальной установки:

```bash
smoke_dir="tmp/ai/release-smoke-$(date +%s)"
npm install --prefix "$smoke_dir" ./ai-revolver-<version>.tgz
"$smoke_dir/node_modules/.bin/airev" --version
"$smoke_dir/node_modules/.bin/airev" --help
```

На Windows повтори tarball install и smoke в PowerShell. macOS support требует
отдельной проверки Keychain path до заявления о полном live coverage.

## 5. Проверь публичную историю

Используй scanner, который умеет редактировать вывод:

```bash
gitleaks git --redact --no-banner
```

Проверь все refs, которые будут опубликованы: branches, tags и release commits.
Не публикуй local backup branches, stash или assistant refs. Если scanner
находит credential, сначала отзови его, затем согласуй rewrite истории.

Отдельно ищи personal emails и workstation paths. Авторский email в commit
metadata также станет публичным; владелец должен принять это осознанно или
переписать metadata до первой публикации.

## 6. Проверь имя npm

Доступность имени меняется и проверяется непосредственно перед publish:

```bash
npm view ai-revolver name version
```

`E404` означает только отсутствие доступного package на момент запроса. Это не
резервирует имя.

## 7. Commit и push

Сначала проверь staged scope:

```bash
git diff --cached --stat
git diff --cached --check
```

После разрешённого commit проверь точный SHA. После разрешённого push сравни
local и remote:

```bash
git rev-parse HEAD
git ls-remote origin refs/heads/main
```

Совпадение SHA доказывает push, но не доказывает public visibility или npm
publication.

## 8. Dry run npm

```bash
npm publish --dry-run
```

Сверь name, version, file list, unpacked size и registry. Не передавай npm token
в command line.

## 9. Внешняя публикация

После отдельного подтверждения владельца:

1. Измени visibility выбранного repository.
2. Открой public URL без авторизации и проверь README, LICENSE и clone.
3. Создай signed или annotated tag на проверенном commit.
4. Создай release notes и приложи immutable checksum tarball, если это нужно.
5. Выполни `npm publish --access public` только из доверенной среды.

Для npm с 2FA используй штатный interactive flow или trusted publishing. Не
храни долгоживущий publish token в repository или постоянном self-hosted runner.

## 10. Доказательство результата

```bash
git ls-remote origin refs/heads/main refs/tags/v<version>
npm view ai-revolver@<version> dist.integrity dist.tarball --json
npm install -g ai-revolver@<version>
airev --version
```

Дополнительно проверь public repository URL из clean unauthenticated session.
Только совокупность remote SHA, visible tag/release, registry metadata и clean
install подтверждает публикацию.

## Откат

Public disclosure нельзя надёжно отменить обратным переключением visibility:
clones и caches могут сохраниться. При раскрытии секрета сначала отзови его.

Ошибочный npm release не исправляй перепубликацией той же версии. Выпусти новую
версию и пометь старую deprecated согласно правилам registry. Локально верни
предыдущий tarball и восстанови vault только из заранее проверенного export.
