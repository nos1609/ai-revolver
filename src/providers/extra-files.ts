import type { ProviderExtraFile } from "../types/index.js";
import { resolveTemplatePath } from "../platform/index.js";
import { writeJsonFile, fileExists } from "../platform/fs.js";
import { pathSegments } from "../core/path.js";
import { readProviderJsonFile } from "./json.js";

function getByPath(obj: Record<string, unknown>, dotPath: string): unknown {
  let current: unknown = obj;
  for (const key of pathSegments(dotPath)) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function setByPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const keys = pathSegments(dotPath);
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Read declared grab_fields from companion OAuth files (e.g. ~/.claude.json).
 * Keys in grab_data use the same dotted paths as in the manifest.
 */
export async function readExtraFiles(
  extraFiles: ProviderExtraFile[] | undefined,
): Promise<Record<string, unknown>> {
  const grab_data: Record<string, unknown> = {};
  if (!extraFiles?.length) return grab_data;

  for (const extra of extraFiles) {
    const filePath = resolveTemplatePath(extra.path);
    if (!(await fileExists(filePath))) continue;

    const raw = await readProviderJsonFile<Record<string, unknown>>(filePath, extra.format);
    for (const fieldPath of extra.grab_fields) {
      const value = getByPath(raw, fieldPath);
      if (value !== undefined) {
        grab_data[fieldPath] = value;
      }
    }
  }

  return grab_data;
}

/**
 * Merge companion OAuth files from vault grab_data.
 * Only fields declared in each extra file's grab_fields are written.
 */
export async function writeExtraFiles(
  extraFiles: ProviderExtraFile[] | undefined,
  grabData: Record<string, unknown>,
): Promise<string[]> {
  const written: string[] = [];
  if (!extraFiles?.length) return written;

  for (const extra of extraFiles) {
    const filePath = resolveTemplatePath(extra.path);
    let existing: Record<string, unknown> = {};
    if (await fileExists(filePath)) {
      existing = await readProviderJsonFile<Record<string, unknown>>(filePath, extra.format);
    }

    let touched = false;
    for (const fieldPath of extra.grab_fields) {
      if (fieldPath in grabData) {
        setByPath(existing, fieldPath, grabData[fieldPath]);
        touched = true;
      }
    }

    if (!touched) continue;

    const perms = typeof extra.permissions === "number" ? extra.permissions : 0o644;
    await writeJsonFile(filePath, existing, perms);
    written.push(filePath);
  }

  return written;
}