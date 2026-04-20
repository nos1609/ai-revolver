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

/**
 * Prompt the user to verify identity via Windows Security (CredUI).
 * Shows the standard Windows credential dialog — supports Hello (PIN/fingerprint/face).
 * Returns true if the user verified successfully, false if cancelled/failed.
 */
export async function winVerifyIdentity(reason: string): Promise<boolean> {
  const script = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class CredUI {
    [DllImport("credui.dll", CharSet = CharSet.Unicode)]
    private static extern int CredUIPromptForWindowsCredentialsW(
        ref CREDUI_INFO pUiInfo, int dwAuthError, ref uint pulAuthPackage,
        IntPtr pvInAuthBuffer, uint ulInAuthBufferSize,
        out IntPtr ppvOutAuthBuffer, out uint pulOutAuthBufferSize,
        ref bool pfSave, int dwFlags);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDUI_INFO {
        public int cbSize;
        public IntPtr hwndParent;
        public string pszMessageText;
        public string pszCaptionText;
        public IntPtr hbmBanner;
    }

    public static bool Verify(string caption, string message) {
        var info = new CREDUI_INFO();
        info.cbSize = Marshal.SizeOf(info);
        info.pszCaptionText = caption;
        info.pszMessageText = message;
        uint authPackage = 0;
        IntPtr outBuf; uint outBufSize; bool save = false;
        int result = CredUIPromptForWindowsCredentialsW(
            ref info, 0, ref authPackage,
            IntPtr.Zero, 0, out outBuf, out outBufSize, ref save, 0);
        if (outBuf != IntPtr.Zero) Marshal.FreeCoTaskMem(outBuf);
        return result == 0;
    }
}
"@
if ([CredUI]::Verify('ai-revolver', '${reason.replace(/'/g, "''")}')) {
    Write-Output 'OK'
} else {
    Write-Output 'CANCEL'
}
  `;
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
 * Check if CredUI is available (basically always on Windows 10+).
 */
export async function winVerifyAvailable(): Promise<boolean> {
  try {
    // credui.dll exists on all Windows 10+
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile", "-NonInteractive", "-Command",
      "if (Test-Path \"$env:SystemRoot\\System32\\credui.dll\") { 'yes' } else { 'no' }",
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
