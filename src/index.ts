import chalk from "chalk";
import { grab } from "./commands/grab.js";
import { render } from "./commands/render.js";
import { sync } from "./commands/sync.js";
import { evict } from "./commands/evict.js";
import { switchProfile } from "./commands/switch.js";
import { list } from "./commands/list.js";
import { status } from "./commands/status.js";
import { usage } from "./commands/usage.js";
import { drop } from "./commands/drop.js";
import { rename } from "./commands/rename.js";
import { envGen } from "./commands/env-gen.js";
import { exportProfiles } from "./commands/export.js";
import { importProfiles } from "./commands/import.js";
import { vaultCommand, vaultUnlock } from "./commands/vault.js";
import { completionCommand } from "./commands/completion.js";
import { printActionHelp, printProviderHelp, hasActionHelp } from "./commands/help.js";
import { buildHelp } from "./commands/top-help.js";
import { listProviders } from "./providers/loader.js";
import { tr, trf } from "./i18n.js";
import { ExitCode } from "./types/index.js";

const VERSION = "0.2.0";

const GLOBAL_VERBS = new Set(["list", "status", "usage", "env", "provider", "vault", "export", "import", "completion"]);
const PROVIDER_VERBS = new Set(["grab", "switch", "rename", "drop", "list", "status", "usage", "render", "sync", "evict"]);

function die(msg: string, hint?: string): never {
  console.error(chalk.red(msg));
  if (hint) console.error(chalk.dim(hint));
  process.exit(ExitCode.GENERAL_ERROR);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    return;
  }

  const wantsHelp = args.includes("--help") || args.includes("-h");

  // Drop help flags from positional parsing so `airev codex grab -h` still
  // routes as provider=codex, action=grab (not action="-h").
  const positional = args.filter((a) => a !== "--help" && a !== "-h");

  // Top-level: no args, or only help flags.
  if (positional.length === 0) {
    console.log(buildHelp(await listProviders()));
    return;
  }

  const [first, second, third, fourth] = positional;

  // Help dispatch — resolve the most specific scope that matches:
  //   airev codex grab -h       → action help, with provider context
  //   airev codex -h            → provider help
  //   airev grab -h             → action help (global form, no provider)
  //   airev -h                  → top-level
  if (wantsHelp) {
    const providers = await listProviders();

    // `airev vault <action> -h`
    if (first === "vault" && second && hasActionHelp(second)) {
      printActionHelp(second);
      return;
    }
    // `airev <prov> <action> -h`
    if (providers.includes(first) && second && hasActionHelp(second)) {
      printActionHelp(second, first);
      return;
    }
    // `airev <prov> -h`
    if (providers.includes(first) && !second) {
      printProviderHelp(first);
      return;
    }
    // `airev <action> -h` — either a global verb or a provider verb documented generically
    if (hasActionHelp(first)) {
      printActionHelp(first);
      return;
    }
    // Unknown target — fall through to top-level help rather than erroring.
    console.log(buildHelp(providers));
    return;
  }

  const apiKeyIdx = args.indexOf("--api-key");
  const apiKey = apiKeyIdx >= 0 ? args[apiKeyIdx + 1] : undefined;
  const shellIdx = args.indexOf("--shell");
  const shell = shellIdx >= 0 ? args[shellIdx + 1] : undefined;

  // ── Global commands (no positional provider filter) ──────

  if (GLOBAL_VERBS.has(first)) {
    // `list` and `status` take no positional args — they're "show all, local".
    // `usage` uniquely accepts a profile name: `airev usage <name>`.
    if (first === "list" && !second) return list();
    if (first === "status" && !second) return status();
    if (first === "usage") {
      // Guard: `airev usage codex` would parse as "profile named 'codex'",
      // which is almost always a mistake for "all codex profiles".
      const known = await listProviders();
      if (second && known.includes(second)) {
        die(
          trf(`"{p}" — это провайдер, а не имя профиля.`, `"{p}" is a provider, not a profile name.`, { p: second }),
          trf(`Имелось в виду 'airev {p} usage'?`, `Did you mean 'airev {p} usage'?`, { p: second }),
        );
      }
      return usage(undefined, second);
    }
    if (first === "env") return envGen(shell);

    if (first === "completion") return completionCommand(second);

    if (first === "vault") {
      // `airev vault unlock <provider> <name>`
      if (second === "unlock") {
        if (!third || !fourth) {
          die(tr(`Использование: airev vault unlock <provider> <name>`, `Usage: airev vault unlock <provider> <name>`));
        }
        return vaultUnlock(third, fourth).then(() => {});
      }
      return vaultCommand(second, third, {
        plaintext: args.includes("--plaintext"),
        replace: args.includes("--replace"),
        restoreActive: args.includes("--restore-active"),
        yes: args.includes("--yes"),
        keepSource: args.includes("--keep-source"),
      });
    }

    if (first === "export") {
      const plaintext = args.includes("--plaintext");
      // Positional out-path: anything after `export` that isn't a flag.
      const outPath = args.slice(1).find((a) => !a.startsWith("--"));
      return exportProfiles({ outPath, plaintext });
    }

    if (first === "import") {
      if (!second || second.startsWith("--")) {
        die(tr(
          `Использование: airev import <file> [--replace] [--restore-active]`,
          `Usage: airev import <file> [--replace] [--restore-active]`,
        ));
      }
      return importProfiles(second, {
        replace: args.includes("--replace"),
        restoreActive: args.includes("--restore-active"),
      });
    }

    if (first === "provider") {
      if (second === "list") {
        const providers = await listProviders();
        console.log();
        for (const p of providers) console.log(`  ${p}`);
        console.log();
        return;
      }
      die(
        trf(`Неизвестное действие провайдера: "{a}"`, `Unknown provider action: "{a}"`, { a: second ?? "" }),
        tr(`Использование: airev provider list`, `Usage: airev provider list`),
      );
    }

    // Offer a targeted hint only when `second` is actually a known provider.
    const knownProviders = await listProviders();
    const hint = knownProviders.includes(second)
      ? trf(
          `Возможно, имелось в виду 'airev {p} {a}'? (per-provider форма)`,
          `Did you mean 'airev {p} {a}'? (per-provider form)`,
          { p: second, a: first },
        )
      : trf(
          `Используй 'airev {a}' (global) или 'airev <provider> {a}' (scoped).`,
          `Use 'airev {a}' (global) or 'airev <provider> {a}' (scoped).`,
          { a: first },
        );
    die(trf(`"{v}" не принимает позиционных аргументов.`, `"{v}" takes no positional arguments.`, { v: first }), hint);
  }

  // ── Provider commands: airev <provider> <action> [args] ──

  const providers = await listProviders();
  if (!providers.includes(first)) {
    die(
      trf(`Неизвестная команда или провайдер: "{v}"`, `Unknown command or provider: "{v}"`, { v: first }),
      trf(
        `Доступные провайдеры: {list}\nЗапусти 'airev --help' для справки.`,
        `Available providers: {list}\nRun 'airev --help' for usage.`,
        { list: providers.join(", ") },
      ),
    );
  }

  const provider = first;
  const action = second;

  if (!action) {
    die(
      tr(`Не указано действие.`, `Missing action.`),
      trf(
        `Использование: airev {p} <{list}>`,
        `Usage: airev {p} <{list}>`,
        { p: provider, list: [...PROVIDER_VERBS].join("|") },
      ),
    );
  }

  if (!PROVIDER_VERBS.has(action)) {
    die(
      trf(`Неизвестное действие: "{a}"`, `Unknown action: "{a}"`, { a: action }),
      trf(`Доступные: {list}`, `Available: {list}`, { list: [...PROVIDER_VERBS].join(", ") }),
    );
  }

  switch (action) {
    case "grab":
      if (!third) die(trf(`Использование: airev {p} grab <name>`, `Usage: airev {p} grab <name>`, { p: provider }));
      return grab(provider, third, { apiKey });

    case "switch":
      if (!third) die(trf(`Использование: airev {p} switch <name>`, `Usage: airev {p} switch <name>`, { p: provider }));
      return switchProfile(provider, third, { force: args.includes("--force") });

    case "render":
      if (!third) die(trf(`Использование: airev {p} render <name>`, `Usage: airev {p} render <name>`, { p: provider }));
      return render(provider, third, { force: args.includes("--force") });

    case "sync": {
      if (!third) die(trf(`Использование: airev {p} sync <name>`, `Usage: airev {p} sync <name>`, { p: provider }));
      const dryRun = args.includes("--dry-run");
      const force = args.includes("--force");
      const direction = args.includes("--push") ? "push" : args.includes("--pull") ? "pull" : undefined;
      return sync(provider, third, { dryRun, force, direction }).then(() => {});
    }

    case "evict":
      if (!third) die(trf(`Использование: airev {p} evict <name>`, `Usage: airev {p} evict <name>`, { p: provider }));
      return evict(provider, third);

    case "rename":
      if (!third || !fourth) die(trf(`Использование: airev {p} rename <old> <new>`, `Usage: airev {p} rename <old> <new>`, { p: provider }));
      return rename(provider, third, fourth);

    case "drop":
      if (!third) die(trf(`Использование: airev {p} drop <name>`, `Usage: airev {p} drop <name>`, { p: provider }));
      return drop(provider, third);

    case "list":
      return list(provider);

    case "status":
      return status(provider);

    case "usage":
      // `airev <prov> usage`         → all profiles of that provider
      // `airev <prov> usage <name>`  → one specific profile
      return usage(provider, third);
  }
}

main().catch((err) => {
  console.error(chalk.red(trf(`Ошибка: {msg}`, `Error: {msg}`, { msg: err.message })));
  process.exit(ExitCode.GENERAL_ERROR);
});
