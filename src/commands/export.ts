import chalk from "chalk";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { openVault } from "../vault/factory.js";
import { buildExport, serializeExport } from "../core/export.js";
import { promptTransportPassword, promptTransportPasswordConfirm } from "../vault/prompt.js";
import { tr, trf } from "../i18n.js";

interface ExportOptions {
  outPath?: string;
  plaintext?: boolean;
  /** Password passed via flag; if omitted and not plaintext, we prompt. */
  password?: string;
}

function defaultOutPath(): string {
  // Local file beside CWD. Timestamp in filename so re-exports don't overwrite.
  const ts = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
  return path.resolve(process.cwd(), `airev-export-${ts}.json`);
}

export async function exportProfiles(opts: ExportOptions = {}): Promise<void> {
  const outPath = opts.outPath ?? defaultOutPath();

  // Resolve password first so we never fail *after* decrypting the vault.
  let password: string | undefined;
  if (!opts.plaintext) {
    password = opts.password ?? (await promptTransportPassword("export"));
    if (!password) {
      console.error(chalk.red(tr("Для encrypted-export нужен пароль.", "Password required for encrypted export.")));
      console.error(
        chalk.dim(
          tr(
            "  Передай --plaintext, чтобы экспортировать без шифрования (не рекомендуется).",
            "  Pass --plaintext to export unencrypted (not recommended).",
          ),
        ),
      );
      process.exitCode = 1;
      return;
    }
    const confirm = opts.password ?? (await promptTransportPasswordConfirm());
    if (confirm !== password) {
      console.error(chalk.red(tr("Пароли не совпадают.", "Passwords don't match.")));
      process.exitCode = 1;
      return;
    }
  }

  const vault = await openVault();
  const payload = await buildExport(vault);

  const raw = serializeExport(payload, password);
  await writeFile(outPath, raw, { encoding: "utf-8", mode: 0o600 });

  const mode = password ? chalk.green(tr("encrypted", "encrypted")) : chalk.yellow(tr("PLAINTEXT", "PLAINTEXT"));
  console.log();
  console.log(
    trf(
      `  ✓ Экспортировано профилей: {n} — {mode}`,
      `  ✓ Exported {n} profile(s) — {mode}`,
      { n: chalk.bold(payload.profiles.length), mode },
    ),
  );
  console.log(`    ${chalk.dim(outPath)}`);
  if (!password) {
    console.log(
      chalk.yellow(
        tr(
          `  ⚠ Файл содержит живые credentials в открытом виде. Держи оффлайн или удали после переноса.`,
          `  ⚠ File contains live credentials in plaintext. Keep it offline or delete it.`,
        ),
      ),
    );
  }
  console.log();
}
