import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getConfigDir } from "../platform/index.js";

const execFileAsync = promisify(execFile);

function keyringDir(): string {
  return path.join(getConfigDir(), "keyring");
}

function dpApiFilePath(key: string): string {
  return path.join(keyringDir(), `${key}.dpapi`);
}

/**
 * Windows DPAPI vault via PowerShell.
 * Data passed through temp file — never as CLI argument (avoids leaking to stdout/stderr).
 */
export async function dpApiStore(key: string, data: string): Promise<void> {
  const dir = keyringDir();
  await fs.mkdir(dir, { recursive: true });

  const tmpFile = path.join(dir, `_tmp_${key}`);
  const outFile = dpApiFilePath(key);
  await fs.writeFile(tmpFile, data, "utf-8");

  try {
    const script = `
      Add-Type -AssemblyName System.Security
      $text = Get-Content -Path '${tmpFile.replace(/'/g, "''")}' -Raw -Encoding UTF8
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
      $encrypted = [System.Security.Cryptography.ProtectedData]::Protect(
        $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
      )
      [Convert]::ToBase64String($encrypted) | Set-Content -Path '${outFile.replace(/'/g, "''")}' -NoNewline
    `;
    await execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command", script,
    ], { timeout: 15000 });
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

export async function dpApiLoad(key: string): Promise<string | null> {
  const file = dpApiFilePath(key);
  try {
    await fs.access(file);
  } catch {
    return null;
  }

  const script = `
    Add-Type -AssemblyName System.Security
    $b64 = Get-Content -Path '${file.replace(/'/g, "''")}' -Raw
    $encrypted = [Convert]::FromBase64String($b64)
    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $encrypted, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [System.Text.Encoding]::UTF8.GetString($decrypted)
  `;
  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command", script,
    ], { timeout: 15000 });
    return stdout.trimEnd();
  } catch {
    return null;
  }
}

export async function dpApiDelete(key: string): Promise<void> {
  await fs.unlink(dpApiFilePath(key)).catch(() => {});
}

function winRtUserConsentSetup(): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows,ContentType=WindowsRuntime]
$null = [Windows.Security.Credentials.UI.UserConsentVerifierAvailability,Windows,ContentType=WindowsRuntime]
$null = [Windows.Security.Credentials.UI.UserConsentVerificationResult,Windows,ContentType=WindowsRuntime]
$null = [Windows.Foundation.IAsyncOperation\`1,Windows.Foundation,ContentType=WindowsRuntime]

function Await-WinRtOperation($operation, [Type] $resultType) {
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object {
            $_.Name -eq 'AsTask' -and
            $_.IsGenericMethodDefinition -and
            $_.GetParameters().Count -eq 1
        } |
        Select-Object -First 1
    $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
}
`;
}

export function buildWinVerifyIdentityScript(reason: string): string {
  return `
${winRtUserConsentSetup()}
$availability = Await-WinRtOperation \`
    ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) \`
    ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ($availability -ne [Windows.Security.Credentials.UI.UserConsentVerifierAvailability]::Available) {
    Write-Output "UNAVAILABLE:$availability"
    exit 0
}

$result = Await-WinRtOperation \`
    ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${reason.replace(/'/g, "''")}')) \`
    ([Windows.Security.Credentials.UI.UserConsentVerificationResult])
if ($result -eq [Windows.Security.Credentials.UI.UserConsentVerificationResult]::Verified) {
    Write-Output 'OK'
} else {
    Write-Output "CANCEL:$result"
}
  `;
}

export function buildWinVerifyAvailableScript(): string {
  return `
${winRtUserConsentSetup()}
$availability = Await-WinRtOperation \`
    ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) \`
    ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])
if ($availability -eq [Windows.Security.Credentials.UI.UserConsentVerifierAvailability]::Available) { 'yes' } else { 'no' }
  `;
}

/**
 * Prompt the user to verify identity via Windows Hello / PIN / biometrics.
 * Returns true if the user verified successfully, false if cancelled/failed.
 */
export async function winVerifyIdentity(reason: string): Promise<boolean> {
  const script = buildWinVerifyIdentityScript(reason);
  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile", "-Command", script,
    ], { timeout: 60000 }); // 60s — user may take time with biometrics
    return stdout.trim() === "OK";
  } catch {
    return false;
  }
}

/**
 * Check if the Windows Hello user consent verifier API is available.
 */
export async function winVerifyAvailable(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      buildWinVerifyAvailableScript(),
    ], { timeout: 5000 });
    return stdout.trim() === "yes";
  } catch {
    return false;
  }
}

export async function dpApiAvailable(): Promise<boolean> {
  try {
    const script = `
      Add-Type -AssemblyName System.Security
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("test")
      $enc = [System.Security.Cryptography.ProtectedData]::Protect(
        $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
      )
      $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $enc, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser
      )
      [System.Text.Encoding]::UTF8.GetString($dec)
    `;
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command", script,
    ], { timeout: 15000 });
    return stdout.trim() === "test";
  } catch {
    return false;
  }
}
