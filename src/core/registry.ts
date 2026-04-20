import crypto from "node:crypto";
import path from "node:path";
import { getConfigDir } from "../platform/index.js";
import { readJsonFile, writeJsonFile, fileExists } from "../platform/fs.js";
import { tr, trf } from "../i18n.js";
import type { Profile, RegistryData, ActiveData, AuthType } from "../types/index.js";

function registryPath(): string {
  return path.join(getConfigDir(), "registry.json");
}

function activePath(): string {
  return path.join(getConfigDir(), "active.json");
}

function generateId(): string {
  return "prof_" + crypto.randomBytes(6).toString("hex");
}

// ── Registry CRUD ────────────────────────────────────────

export async function loadRegistry(): Promise<RegistryData> {
  const p = registryPath();
  if (!(await fileExists(p))) {
    return { version: 1, profiles: [] };
  }
  return readJsonFile<RegistryData>(p);
}

export async function saveRegistry(data: RegistryData): Promise<void> {
  await writeJsonFile(registryPath(), data);
}

export async function addProfile(
  name: string,
  provider: string,
  authType: AuthType,
): Promise<Profile> {
  const reg = await loadRegistry();

  // Check for duplicate name within same provider
  if (reg.profiles.some((p) => p.name === name && p.provider === provider)) {
    throw new Error(
      trf(
        `Профиль "{n}" уже существует для провайдера "{p}"`,
        `Profile "{n}" already exists for provider "{p}"`,
        { n: name, p: provider },
      ),
    );
  }

  const profile: Profile = {
    id: generateId(),
    name,
    provider,
    auth_type: authType,
    created_at: new Date().toISOString(),
  };

  reg.profiles.push(profile);
  await saveRegistry(reg);
  return profile;
}

export async function renameProfile(
  provider: string,
  oldName: string,
  newName: string,
): Promise<Profile> {
  if (oldName === newName) {
    throw new Error(tr(`Новое имя совпадает со старым.`, `New name is the same as the old one.`));
  }
  const reg = await loadRegistry();

  const target = reg.profiles.find((p) => p.name === oldName && p.provider === provider);
  if (!target) {
    throw new Error(
      trf(`Профиль "{n}" не найден для провайдера "{p}".`, `Profile "{n}" not found for provider "{p}".`, { n: oldName, p: provider }),
    );
  }

  const clash = reg.profiles.find((p) => p.name === newName && p.provider === provider);
  if (clash) {
    throw new Error(
      trf(`Профиль "{n}" уже существует для провайдера "{p}".`, `Profile "{n}" already exists for provider "{p}".`, { n: newName, p: provider }),
    );
  }

  target.name = newName;
  await saveRegistry(reg);
  return target;
}

export async function removeProfile(name: string, provider?: string): Promise<Profile> {
  const reg = await loadRegistry();
  const idx = provider
    ? reg.profiles.findIndex((p) => p.name === name && p.provider === provider)
    : reg.profiles.findIndex((p) => p.name === name);
  if (idx < 0) throw new Error(trf(`Профиль "{n}" не найден`, `Profile "{n}" not found`, { n: name }));

  const [removed] = reg.profiles.splice(idx, 1);
  await saveRegistry(reg);
  return removed;
}

export async function getProfile(name: string, provider?: string): Promise<Profile | null> {
  const reg = await loadRegistry();
  if (provider) {
    return reg.profiles.find((p) => p.name === name && p.provider === provider) ?? null;
  }
  return reg.profiles.find((p) => p.name === name) ?? null;
}

export async function getProfileById(id: string): Promise<Profile | null> {
  const reg = await loadRegistry();
  return reg.profiles.find((p) => p.id === id) ?? null;
}

export async function listProfiles(): Promise<Profile[]> {
  const reg = await loadRegistry();
  return reg.profiles;
}

// ── Active tracking ──────────────────────────────────────

async function loadActive(): Promise<ActiveData> {
  const p = activePath();
  if (!(await fileExists(p))) {
    return { active: {} };
  }
  return readJsonFile<ActiveData>(p);
}

export async function setActive(provider: string, profileId: string): Promise<void> {
  const data = await loadActive();
  data.active[provider] = profileId;
  await writeJsonFile(activePath(), data);
}

export async function getActive(provider: string): Promise<string | null> {
  const data = await loadActive();
  return data.active[provider] ?? null;
}

export async function getAllActive(): Promise<Record<string, string>> {
  const data = await loadActive();
  return data.active;
}
