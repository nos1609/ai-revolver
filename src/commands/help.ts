import chalk from "chalk";
import { tr, trf } from "../i18n.js";

// ── Action-level help ────────────────────────────────────
//
// Each entry is keyed by action verb. Both global (`airev import -h`) and
// provider-scoped (`airev codex grab -h`) invocations share the same text —
// the verb's semantics don't change between scopes; only the synopsis line
// substitutes <prov> with the actual provider name.

interface ActionHelp {
  synopsis: (prov?: string) => string;
  description: () => string;
  options?: () => string[];
  examples: (prov?: string) => string[];
}

const ACTIONS: Record<string, ActionHelp> = {
  grab: {
    synopsis: (p) => `airev ${p ?? "<provider>"} grab <name> [--api-key <key>]`,
    description: () =>
      tr(
        "Забирает текущую сессию из credential-файла CLI и сохраняет её как профиль.\n" +
          "Upsert: если <name> уже существует — обновляет credentials на месте, не\n" +
          "трогая active-профиль и сохраняя profile id. Используется, чтобы подтянуть\n" +
          "свежий refresh_token из CLI-файла после внешней ротации.",
        "Capture the current CLI session (from the provider's credential file) as a profile.\n" +
          "Upsert: if <name> already exists, refreshes its credentials in place without\n" +
          "changing the active profile or the profile id. Use this to pull a fresh\n" +
          "refresh_token from the CLI file after it rotated externally.",
      ),
    options: () => [
      tr(
        "--api-key <key>   Использовать API key вместо поиска OAuth-сессии",
        "--api-key <key>   Use an API key instead of scanning for an OAuth session",
      ),
    ],
    examples: (p) => [
      `airev ${p ?? "codex"} grab work                       ${tr("# первый раз (создаёт, делает active)", "# first-time grab (creates, sets active)")}`,
      `airev ${p ?? "codex"} grab work                       ${tr("# повторно — обновляет vault из файла, id и active не трогает", "# again — updates vault from CLI file, keeps id & active")}`,
      `airev ${p ?? "codex"} grab work --api-key sk-...      ${tr("# профиль на API key вместо OAuth", "# register an API-key profile instead")}`,
    ],
  },

  switch: {
    synopsis: (p) => `airev ${p ?? "<provider>"} switch <name>`,
    description: () =>
      tr(
        "Записывает credentials профиля в credential-файл CLI провайдера и помечает\n" +
          "его active. Именно так внешний CLI (codex/claude/…) подхватывает нужный\n" +
          "аккаунт — airev не перехватывает чтение CLI, он правит файл.",
        "Write a profile's credentials into the provider's CLI credential file and\n" +
          "mark it active. This is how the external CLI (codex/claude/…) picks up the\n" +
          "account — airev never intercepts the CLI's reads, it just edits the file.",
      ),
    examples: (p) => [
      `airev ${p ?? "codex"} switch work                     ${trf("# сделать 'work' активным {p}-аккаунтом", "# make 'work' the active {p} account", { p: p ?? "codex" })}`,
    ],
  },

  rename: {
    synopsis: (p) => `airev ${p ?? "<provider>"} rename <old> <new>`,
    description: () =>
      tr(
        "Переименовывает профиль. Только метка — profile id остаётся прежним,\n" +
          "vault-запись и active-map не трогаются. <new> должен быть уникален\n" +
          "в рамках провайдера.",
        "Rename a profile. Label-only — the profile id stays the same, vault entry\n" +
          "and active map are untouched. <new> must be unique within the provider.",
      ),
    examples: (p) => [
      `airev ${p ?? "codex"} rename work main                ${tr("# 'work' → 'main'", "# rename 'work' → 'main'")}`,
    ],
  },

  drop: {
    synopsis: (p) => `airev ${p ?? "<provider>"} drop <name>`,
    description: () =>
      tr(
        "Удаляет профиль из registry и его credentials из vault.\n" +
          "Credential-файл CLI НЕ трогает — если удалённый профиль был active,\n" +
          "CLI продолжит работать с тем, что сейчас лежит в файле.",
        "Remove a profile from the registry and its credentials from the vault.\n" +
          "Does NOT touch the provider's CLI credential file — if the dropped profile\n" +
          "was active, the CLI keeps working with whatever's currently in that file.",
      ),
    examples: (p) => [
      `airev ${p ?? "codex"} drop old-account                ${tr("# удалить профиль и vault-запись", "# delete profile + vault entry")}`,
    ],
  },

  list: {
    synopsis: (p) => `airev ${p ? `${p} ` : ""}list`,
    description: () =>
      tr(
        "Список профилей. Без указания провайдера — все профили по всем\n" +
          "провайдерам; с провайдером — только его. Маркер '*' = active.",
        "List profiles. Without a provider — all profiles across providers;\n" +
          "with a provider — only that provider's profiles. Marker '*' = active.",
      ),
    examples: (p) => [
      `airev list                              ${tr("# все профили", "# all profiles")}`,
      `airev ${p ?? "codex"} list                      ${tr("# только ", "# only ")}${p ?? "codex"}`,
    ],
  },

  status: {
    synopsis: (p) => `airev ${p ? `${p} ` : ""}status`,
    description: () =>
      tr(
        "Локальный статус: какой профиль active для каждого провайдера — по данным\n" +
          "registry и текущему содержимому CLI-credential-файла. Без HTTP, быстро.\n" +
          "Для живых rate-limit'ов используй 'usage'.",
        "Local-only status: which profile is active for each provider, based on\n" +
          "the registry + current contents of each CLI credential file. No HTTP,\n" +
          "fast. For live rate-limits use 'usage' instead.",
      ),
    examples: (p) => [
      `airev status                            ${tr("# все провайдеры", "# all providers")}`,
      `airev ${p ?? "codex"} status                    ${tr("# только ", "# only ")}${p ?? "codex"}`,
    ],
  },

  usage: {
    synopsis: (p) => (p ? `airev ${p} usage [<name>]` : `airev usage [<name>]`),
    description: () =>
      tr(
        "Живой снапшот rate-limit'ов через API провайдера. Автоматически рефрешит\n" +
          "истёкшие access_token'ы (лениво, по 401). Для active-профиля сначала\n" +
          "читает credential-файл CLI — критично для провайдеров с rotating\n" +
          "refresh_token'ами (Claude): CLI может ротировать токены в обход vault.",
        "Live rate-limit snapshot via the provider's API. Refreshes expired\n" +
          "access_tokens automatically (lazy, on 401). For the active profile it\n" +
          "reads the CLI credential file first — critical for providers with\n" +
          "rotating refresh_tokens (e.g. Claude), where the CLI may have rotated\n" +
          "tokens out from under our vault copy.",
      ),
    examples: (p) => [
      `airev usage                             ${tr("# все oauth-профили по всем провайдерам", "# all oauth profiles, every provider")}`,
      `airev usage me@x.com                    ${tr("# один профиль по имени (кросс-провайдерно)", "# one profile by name (cross-provider)")}`,
      `airev ${p ?? "claude"} usage                    ${trf("# все профили провайдера {p}", "# all {p} profiles", { p: p ?? "claude" })}`,
      `airev ${p ?? "claude"} usage me@x.com           ${trf("# конкретный профиль {p}", "# specific {p} profile", { p: p ?? "claude" })}`,
    ],
  },

  env: {
    synopsis: () => `airev env [--shell <shell>]`,
    description: () =>
      tr(
        "Печатает shell-экспорты для текущих active-профилей каждого провайдера.\n" +
          "Обычно вшивается в shell-инит (eval \"$(airev env)\"). Shell определяется\n" +
          "автоматически по $SHELL / $PSModulePath, если не задан --shell.",
        "Output shell exports for the currently active profile of each provider.\n" +
          "Meant to be wired into your shell init (eval \"$(airev env)\"). Auto-detects\n" +
          "shell from $SHELL / $PSModulePath unless --shell is given.",
      ),
    options: () => [
      tr(
        "--shell <shell>   Форсировать shell: bash, zsh, fish, powershell",
        "--shell <shell>   Force shell: bash, zsh, fish, powershell",
      ),
    ],
    examples: () => [
      `airev env                               ${tr("# автодетект shell", "# auto-detect shell")}`,
      `airev env --shell powershell            ${tr("# форсить синтаксис powershell", "# force powershell syntax")}`,
      `eval "$(airev env)"                     ${tr("# типичное использование в .zshrc / .bashrc", "# typical .zshrc / .bashrc use")}`,
    ],
  },

  export: {
    synopsis: () => `airev vault export [<out>] [--plaintext]`,
    description: () =>
      tr(
        "Экспортирует все профили + vault-записи + active-map в один JSON-файл.\n" +
          "По умолчанию шифрование (AES-256-GCM + scrypt, пароль спрашивается).\n" +
          "--plaintext пишет живые токены открытым текстом — файл 0600, печатается\n" +
          "предупреждение; не коммитить, не расшаривать, удалять после переноса.",
        "Export all profiles + vault entries + active map to a single JSON file.\n" +
          "Encrypted by default (AES-256-GCM + scrypt, password prompted).\n" +
          "--plaintext writes live tokens in the clear — file is 0600, a warning is\n" +
          "printed; do not commit, do not share, delete after transfer.",
      ),
    options: () => [
      tr(
        "--plaintext       Писать без шифрования (живые токены видны)",
        "--plaintext       Write unencrypted (live tokens visible)",
      ),
    ],
    examples: () => [
      `airev vault export                      ${tr("# → ./airev-export-<ts>.json (encrypted)", "# → ./airev-export-<ts>.json (encrypted)")}`,
      `airev vault export backup.json          ${tr("# свой путь, encrypted", "# custom path, encrypted")}`,
      `airev vault export backup.json --plaintext ${tr("# unencrypted — только для отладки", "# unencrypted — for debugging only")}`,
    ],
  },

  import: {
    synopsis: () => `airev vault import <file> [--replace] [--restore-active]`,
    description: () =>
      tr(
        "Импортирует export-файл. Стратегия при конфликте по (name, provider):\n" +
          "  default      пропустить существующий профиль молча\n" +
          "  --replace    перезаписать credentials (id берётся ЛОКАЛЬНЫЙ)\n" +
          "Коллизии по id при разных name/provider всегда пропускаются.",
        "Import an export file. Conflict strategy by (name, provider):\n" +
          "  default      skip existing profiles silently\n" +
          "  --replace    overwrite existing credentials (keeps LOCAL id)\n" +
          "ID collisions under different name/provider are always skipped.",
      ),
    options: () => [
      tr(
        "--replace           Перезаписывать при конфликте name+provider",
        "--replace           Overwrite name+provider conflicts",
      ),
      tr(
        "--restore-active    Также восстановить active-map",
        "--restore-active    Also restore the active-profile map",
      ),
    ],
    examples: () => [
      `airev vault import backup.json                    ${tr("# merge, конфликты пропускаем", "# merge, skip conflicts")}`,
      `airev vault import backup.json --replace          ${tr("# перезаписывать при конфликте", "# overwrite on conflict")}`,
      `airev vault import backup.json --restore-active   ${tr("# вместе с active-map", "# also restore which was active")}`,
    ],
  },

  vault: {
    synopsis: () => `airev vault <path|status|passwd|migrate|export|import>`,
    description: () =>
      tr(
        "Управление локальным vault namespace: пути служебных файлов, backend,\n" +
          "экспорт/импорт и будущая миграция между backend-ами.",
        "Manage the local vault namespace: state-file paths, backend, export/import,\n" +
          "and future migration between backends.",
      ),
    examples: () => [
      `airev vault path                       ${tr("# показать config/registry/active/stale/vault paths", "# show config/registry/active/stale/vault paths")}`,
      `airev vault status                     ${tr("# показать активный backend", "# show active backend")}`,
      `airev vault passwd                     ${tr("# смена пароля file-vault (пока stub)", "# change file-vault password (stub for now)")}`,
      `airev vault migrate keyring            ${tr("# заглушка будущей миграции", "# future migration placeholder")}`,
    ],
  },
};

// ── Provider-level help ──────────────────────────────────

function providerHelp(provider: string): string {
  const header = tr(
    `${chalk.bold(`airev ${provider}`)} — управление профилями ${provider}`,
    `${chalk.bold(`airev ${provider}`)} — manage ${provider} profiles`,
  );

  const actionsHeader = tr("Действия:", "Actions:");
  const examplesHeader = tr("Примеры:", "Examples:");

  const actions = tr(
    `  grab <name> [--api-key <key>]   Забрать (или обновить) профиль из CLI-сессии\n` +
      `  switch <name>                   Сделать профиль активным\n` +
      `  rename <old> <new>              Переименовать профиль (только метка)\n` +
      `  drop <name>                     Удалить профиль + vault-запись\n` +
      `  list                            Список профилей ${provider}\n` +
      `  status                          Локальный статус для ${provider}\n` +
      `  usage [<name>]                  Живые rate-limit'ы для профилей ${provider}`,
    `  grab <name> [--api-key <key>]   Grab (or update) a profile from CLI session\n` +
      `  switch <name>                   Activate a profile\n` +
      `  rename <old> <new>              Rename a profile (label-only)\n` +
      `  drop <name>                     Remove a profile + vault entry\n` +
      `  list                            List ${provider} profiles\n` +
      `  status                          Local status for ${provider}\n` +
      `  usage [<name>]                  Live rate-limits for ${provider} profiles`,
  );

  const examples = tr(
    `  airev ${provider} grab work                  # сохранить текущую сессию как "work"\n` +
      `  airev ${provider} grab work                  # та же команда повторно = обновить creds на месте\n` +
      `  airev ${provider} switch work                # сделать "work" активным\n` +
      `  airev ${provider} usage                      # 5h/7d лимиты по всем профилям ${provider}\n` +
      `  airev ${provider} rename work main           # переименовать`,
    `  airev ${provider} grab work                  # capture current session as "work"\n` +
      `  airev ${provider} grab work                  # same command again = update creds in place\n` +
      `  airev ${provider} switch work                # make "work" active\n` +
      `  airev ${provider} usage                      # 5h/7d limits for all ${provider} profiles\n` +
      `  airev ${provider} rename work main           # relabel`,
  );

  const footer = tr(
    `Запусти ${chalk.cyan(`airev ${provider} <action> -h`)} для справки по конкретному действию.`,
    `Run ${chalk.cyan(`airev ${provider} <action> -h`)} for per-action help.`,
  );

  return `
${header}

${chalk.bold(actionsHeader)}
${actions}

${chalk.bold(examplesHeader)}
${examples}

${footer}
`;
}

// ── Action-level help formatter ──────────────────────────

function formatActionHelp(action: string, provider?: string): string {
  const h = ACTIONS[action];
  if (!h) return tr(`Справка для "${action}" недоступна.`, `No help available for "${action}".`);

  const parts: string[] = [];
  parts.push("");
  parts.push(`${chalk.bold(tr("Использование:", "Usage:"))}  ${h.synopsis(provider)}`);
  parts.push("");
  parts.push(h.description());
  if (h.options) {
    const opts = h.options();
    if (opts.length) {
      parts.push("");
      parts.push(chalk.bold(tr("Опции:", "Options:")));
      for (const opt of opts) parts.push(`  ${opt}`);
    }
  }
  parts.push("");
  parts.push(chalk.bold(tr("Примеры:", "Examples:")));
  for (const ex of h.examples(provider)) parts.push(`  ${ex}`);
  parts.push("");
  return parts.join("\n");
}

// ── Exports ──────────────────────────────────────────────

export function printActionHelp(action: string, provider?: string): void {
  console.log(formatActionHelp(action, provider));
}

export function printProviderHelp(provider: string): void {
  console.log(providerHelp(provider));
}

export function hasActionHelp(action: string): boolean {
  return action in ACTIONS;
}
