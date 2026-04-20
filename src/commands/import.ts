import chalk from "chalk";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { openVault } from "../vault/factory.js";
import { applyImport, parseExport, isEncryptedExport, ImportError } from "../core/export.js";
import { promptPassword } from "../vault/prompt.js";
import { tr, trf } from "../i18n.js";

interface ImportOptions {
  replace?: boolean;
  restoreActive?: boolean;
  password?: string;
}

export async function importProfiles(filePath: string, opts: ImportOptions = {}): Promise<void> {
  const resolved = path.resolve(filePath);
  let raw: string;
  try {
    raw = await readFile(resolved, "utf-8");
  } catch (e) {
    console.error(
      chalk.red(
        trf(`Не могу прочитать {path}: {m}`, `Cannot read {path}: {m}`, { path: resolved, m: (e as Error).message }),
      ),
    );
    process.exitCode = 1;
    return;
  }

  // Prompt for password only if the file actually needs one — avoids an
  // unnecessary prompt when the user exports plaintext.
  let password = opts.password;
  if (isEncryptedExport(raw) && !password) {
    password = await promptPassword(tr("  🔐 Пароль import: ", "  🔐 Import password: "));
  }

  let payload;
  try {
    payload = parseExport(raw, password);
  } catch (e) {
    const msg = e instanceof ImportError ? e.message : String(e);
    console.error(chalk.red(trf(`Import не удался: {m}`, `Import failed: {m}`, { m: msg })));
    process.exitCode = 1;
    return;
  }

  const vault = await openVault();
  const report = await applyImport(payload, vault, {
    replace: opts.replace,
    restoreActive: opts.restoreActive,
  });

  console.log();
  console.log(trf(`  Импорт из {path}`, `  Imported from {path}`, { path: chalk.dim(resolved) }));
  console.log(`    ${chalk.green("+")} ${tr("добавлено ", "added    ")}: ${report.added.length}`);
  if (report.replaced.length) {
    console.log(`    ${chalk.yellow("~")} ${tr("заменено  ", "replaced ")}: ${report.replaced.length}`);
  }
  if (report.skippedConflict.length) {
    console.log(
      `    ${chalk.dim("·")} ${tr("пропущено ", "skipped  ")}: ${report.skippedConflict.length} ` +
        chalk.dim(
          tr(
            "(name+provider уже существует — используй --replace для перезаписи)",
            "(name+provider already exists — use --replace to overwrite)",
          ),
        ),
    );
    for (const p of report.skippedConflict) {
      console.log(chalk.dim(`        ${p.provider}/${p.name}`));
    }
  }
  if (report.skippedIdCollision.length) {
    console.log(
      `    ${chalk.red("!")} ${tr("коллизия id", "id collision")}: ${report.skippedIdCollision.length} ` +
        chalk.dim(
          tr(
            "(входящий id уже занят другим локальным профилем — оставляем локальный)",
            "(incoming id already used by a different local profile — kept local)",
          ),
        ),
    );
  }
  if (Object.keys(report.activeApplied).length) {
    console.log(
      `    ${chalk.cyan("→")} active   : ${Object.entries(report.activeApplied).map(([k, v]) => `${k}=${v.slice(0, 13)}…`).join(", ")}`,
    );
  }
  console.log();
}
