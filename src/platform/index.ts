import os from "node:os";
import path from "node:path";

export type Platform = "win32" | "darwin" | "linux";

export function getPlatform(): Platform {
  const p = os.platform();
  if (p === "win32" || p === "darwin" || p === "linux") return p;
  // Treat FreeBSD, etc. as linux
  return "linux";
}

export function getHome(): string {
  return os.homedir();
}

/** Resolve ${HOME} and env vars in provider YAML paths */
export function resolveTemplatePath(template: string): string {
  return template.replace(/\$\{(\w+)\}/g, (_, name) => {
    if (name === "HOME") return getHome();
    return process.env[name] ?? "";
  });
}

/** App config directory (XDG / APPDATA / Library) */
export function getConfigDir(): string {
  const p = getPlatform();
  if (p === "win32") {
    return path.join(process.env.APPDATA ?? path.join(getHome(), "AppData", "Roaming"), "ai-revolver");
  }
  if (p === "darwin") {
    return path.join(getHome(), "Library", "Application Support", "ai-revolver");
  }
  // Linux — XDG
  const xdg = process.env.XDG_CONFIG_HOME ?? path.join(getHome(), ".config");
  return path.join(xdg, "ai-revolver");
}
