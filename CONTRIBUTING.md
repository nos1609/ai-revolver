# Участие в разработке ai-revolver

[English version](CONTRIBUTING.en.md)

## Перед началом

- Используй Node.js `>=18` и npm.
- Прочитай [`docs/README.md`](docs/README.md),
  [`docs/security.md`](docs/security.md) и относящийся к изменению provider
  manifest или архитектурный документ.
- Проверь `git status --short --branch` и не затирай незнакомые изменения.
- Не используй реальные credentials, account ids, emails и home paths в test
  fixtures или документации.

## Область изменения

Делай минимальный законченный diff. Provider-specific path, mapping, identity,
refresh и usage behavior сначала описывай в `providers/*.yaml`. Добавляй кодовый
adapter только когда manifest не может выразить формат безопасно.

Не добавляй в Git:

- `vault.enc`, registry/active/stale state и satellite files;
- encrypted или plaintext exports;
- `*.tgz`, coverage, reports и `tmp/`;
- one-off recovery scripts, которые пишут в реальный home;
- raw provider responses или binary credential blobs.

## Изменение provider contract

1. Зафиксируй provider CLI version и источник поведения.
2. Проверь официальную документацию или source, если они доступны.
3. Используй read-only probe без TLS interception.
4. Очисти evidence и создай synthetic fixture.
5. Обнови manifest и focused regression test.
6. Обнови README table и [`docs/source-attribution.md`](docs/source-attribution.md).
7. Проверь, что diagnostics не выводят sensitive field.

## Код и тесты

Сохраняй существующий TypeScript/ESM style. Не добавляй dependency без
обоснованной необходимости. Для изменения поведения сначала добавь regression
test, затем исправление.

Из корня репозитория:

```bash
npm ci
npm install-scripts ls
npm run check
npm run build
npm pack --dry-run
git diff --check
```

Для platform-specific изменения добавь unit contract test. До заявления о live
поддержке проверь соответствующую ОС реальным executable и backend.

Не расширяй `allowScripts` по wildcard. Закрепи точный package version и
проверь назначение install script до изменения списка.

## Документация

Следуй [`docs/DOCUMENTATION_STANDARD.md`](docs/DOCUMENTATION_STANDARD.md).
Русский и английский README обновляй вместе. Команды должны работать из
указанного каталога и не зависеть от локального username.

Mermaid diagram храни как source block в Markdown и отрисуй перед commit.

## Commit и pull request

- Не смешивай исправление с посторонним refactor.
- В описании укажи проблему, решение, проверки, ограничения и rollback.
- Не обходи lint, tests, docs gate или security checks.
- Не запускай код недоверенного pull request на постоянном self-hosted runner.
- Commit, push, tag и publication выполняй только в согласованной области.

## Уязвимости

Не открывай public issue с credential leak или способом обойти identity guard.
Используй порядок из [`SECURITY.md`](SECURITY.md).
