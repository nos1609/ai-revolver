/**
 * One-shot: convert old password-encrypted vault → DPAPI keyring.
 * Strips -<provider> suffixes from profile names.
 *
 * Usage: node scripts/convert-vault.mjs <old-password>
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const APPDATA = process.env.APPDATA;
const configDir = path.join(APPDATA, "ai-revolver");
const registryPath = path.join(configDir, "registry.json");
const vaultPath = path.join(configDir, "vault.enc");
const keyringDir = path.join(configDir, "keyring");

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/convert-vault.mjs <old-password>");
  process.exit(1);
}

// 1. Decrypt old vault
console.log("Reading old vault.enc...");
const encFile = JSON.parse(fs.readFileSync(vaultPath, "utf-8"));
const salt = Buffer.from(encFile.salt, "hex");
const key = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
const iv = Buffer.from(encFile.iv, "hex");
const tag = Buffer.from(encFile.tag, "hex");
const data = Buffer.from(encFile.data, "hex");
const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
decipher.setAuthTag(tag);
let plain;
try {
  plain = decipher.update(data) + decipher.final("utf8");
} catch {
  console.error("Wrong password.");
  process.exit(1);
}
const vault = JSON.parse(plain);
console.log(`  ${vault.entries.length} entries decrypted.`);

// 2. Store into DPAPI via temp file (avoids PowerShell arg parsing issues)
if (!fs.existsSync(keyringDir)) fs.mkdirSync(keyringDir, { recursive: true });

const tmpFile = path.join(configDir, "_migrate_tmp");
const dpApiFile = path.join(keyringDir, "vault_data.dpapi");
fs.writeFileSync(tmpFile, plain, "utf-8");

const psScript = `
  Add-Type -AssemblyName System.Security
  $text = Get-Content -Path '${tmpFile.replace(/'/g, "''")}' -Raw
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
  $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
    $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
  )
  $b64 = [Convert]::ToBase64String($encrypted)
  Set-Content -Path '${dpApiFile.replace(/'/g, "''")}' -Value $b64 -NoNewline
  Remove-Item -Path '${tmpFile.replace(/'/g, "''")}' -Force
`;
execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", psScript]);
console.log("  Written to DPAPI keyring.");

// 3. Fix registry — strip provider suffixes
if (fs.existsSync(registryPath)) {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  for (const profile of registry.profiles) {
    const suffix = `-${profile.provider}`;
    if (profile.name.endsWith(suffix)) {
      const oldName = profile.name;
      profile.name = profile.name.slice(0, -suffix.length);
      console.log(`  Renamed: "${oldName}" → "${profile.name}"`);
    }
  }
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
}

// 4. Clean up
fs.unlinkSync(vaultPath);
try { fs.unlinkSync(vaultPath + ".bak"); } catch {}
try { fs.unlinkSync(registryPath + ".bak"); } catch {}
try { fs.unlinkSync(path.join(configDir, "active.json.bak")); } catch {}

console.log("\nDone. Profiles now use DPAPI — no password needed.");
console.log("Run: airev list");
