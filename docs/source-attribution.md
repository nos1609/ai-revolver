# Происхождение provider-контрактов

## Назначение

Этот документ фиксирует, откуда взяты внешние assumptions в `providers/*.yaml`.
Он не передаёт права на provider software и не означает аффилированность.

## Источники по поставщикам

| Manifest | Источник контракта | Ограничение |
|---|---|---|
| `claude.yaml` | Наблюдаемая структура Claude CLI credentials и companion metadata; provider OAuth/usage behavior | Формат и endpoint может измениться без versioned public contract. |
| `codex.yaml` | Локальный credential file Codex CLI и документированный OAuth account flow | Usage windows и refresh behavior зависят от сервиса OpenAI. |
| `copilot.yaml` | Copilot CLI JSONC config и system credential-store entry | Token не находится в metadata file; нужен keytar-compatible store. |
| `gemini.yaml` | Gemini CLI OAuth file и companion account metadata | Usage probe отсутствует; provider может менять storage mode. |
| `grok.yaml` | Наблюдаемый Grok CLI dynamic auth bucket и OAuth refresh | Bucket key и endpoint являются compatibility contract этого adapter. |
| `qodercli.yaml` | Очищенное локальное исследование opaque credential file | Blob не расшифровывается и не используется как Bearer; live usage отсутствует. |
| `qwen.yaml` | Наблюдаемый Qwen CLI OAuth file | Token refresh и usage endpoint не объявлены. |

Датированный Qoder report находится в
[`notes/2026-06-22-qodercli-reverse-engineering.md`](notes/2026-06-22-qodercli-reverse-engineering.md).
Он является historical evidence для конкретной версии CLI, а не постоянной
гарантией.

## Правила обновления

1. Сначала проверь official provider documentation и source, если они доступны.
2. Используй локальный read-only probe без TLS interception и credential dump.
3. Зафиксируй provider CLI version и дату.
4. Храни только очищенные paths, schemas, status codes и synthetic fixtures.
5. Не копируй proprietary source или длинные provider responses.
6. Обнови manifest, focused tests, README table и этот документ вместе.

OAuth client ids installed applications могут быть публичными identifiers, но
их распространение и повторное использование всё равно нужно сверять с
provider terms перед release. Client secret, если provider требует его как
настоящий secret, не должен находиться в manifest.

## Зависимости сборки

Прямые runtime dependencies объявлены в `package.json`; точные версии и
integrity hashes находятся в `package-lock.json`. Их собственные лицензии
сохраняются в package distributions. Лицензия MIT этого репозитория не
перелицензирует сторонние packages или provider CLIs.

TypeScript 7 используется как native compiler, а TypeScript 6 временно
предоставляет JavaScript API для tooling. Основание миграции — официальное
[объявление TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

## Торговые марки

OpenAI, Codex, Anthropic, Claude, Google, Gemini, GitHub, Copilot, xAI, Grok,
Alibaba, Qwen и Qoder являются именами соответствующих владельцев. Они
используются только для описания совместимости.
