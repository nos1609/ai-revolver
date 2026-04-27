import { LANG, type Lang } from "../i18n.js";

/**
 * Prompt for password with hidden input (****)
 * Works in any terminal — no native deps.
 */
export async function promptPassword(message = "Master password: "): Promise<string> {
  return new Promise((resolve) => {
    const stdout = process.stdout;
    let password = "";

    stdout.write(message);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const onData = (ch: string) => {
      const c = ch.toString();

      if (c === "\n" || c === "\r" || c === "\u0004") {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        stdout.write("\n");
        resolve(password);
      } else if (c === "\u0003") {
        process.stdin.setRawMode?.(false);
        process.exit(0);
      } else if (c === "\u007F" || c === "\b") {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write("\b \b");
        }
      } else {
        password += c;
        stdout.write("*");
      }
    };

    process.stdin.on("data", onData);
  });
}

export type TransportPasswordPurpose = "export" | "import";

export function transportPasswordPromptLabel(
  purpose: TransportPasswordPurpose,
  lang: Lang = LANG,
): string {
  if (purpose === "export") {
    return lang === "ru"
      ? "  🔐 Транспортный пароль export-файла: "
      : "  🔐 Export transfer file password: ";
  }
  return lang === "ru"
    ? "  🔐 Транспортный пароль import-файла: "
    : "  🔐 Import transfer file password: ";
}

export function confirmTransportPasswordPromptLabel(lang: Lang = LANG): string {
  return lang === "ru"
    ? "  🔐 Повтори транспортный пароль: "
    : "  🔐 Confirm transfer file password: ";
}

export function newVaultPasswordPromptLabels(lang: Lang = LANG): { password: string; confirm: string } {
  return lang === "ru"
    ? {
        password: "  🔐 Новый пароль локального vault-а: ",
        confirm: "  🔐 Повтори пароль локального vault-а: ",
      }
    : {
        password: "  🔐 New local vault password: ",
        confirm: "  🔐 Confirm local vault password: ",
      };
}

export function existingVaultPasswordPromptLabel(lang: Lang = LANG): string {
  return lang === "ru"
    ? "  🔐 Пароль локального vault-а: "
    : "  🔐 Local vault password: ";
}

export async function promptTransportPassword(purpose: TransportPasswordPurpose): Promise<string> {
  return promptPassword(transportPasswordPromptLabel(purpose));
}

export async function promptTransportPasswordConfirm(): Promise<string> {
  return promptPassword(confirmTransportPasswordPromptLabel());
}

export async function promptNewVaultPassword(): Promise<{ password: string; confirm: string }> {
  const labels = newVaultPasswordPromptLabels();
  return {
    password: await promptPassword(labels.password),
    confirm: await promptPassword(labels.confirm),
  };
}

export async function promptExistingVaultPassword(): Promise<string> {
  return promptPassword(existingVaultPasswordPromptLabel());
}
