# Approach: Use Windows Credential UI (CredUI) for user verification
# Works on all Windows 10+ without WinRT SDK
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class CredUI {
    [DllImport("credui.dll", CharSet = CharSet.Unicode)]
    private static extern int CredUIPromptForWindowsCredentialsW(
        ref CREDUI_INFO pUiInfo,
        int dwAuthError,
        ref uint pulAuthPackage,
        IntPtr pvInAuthBuffer,
        uint ulInAuthBufferSize,
        out IntPtr ppvOutAuthBuffer,
        out uint pulOutAuthBufferSize,
        ref bool pfSave,
        int dwFlags
    );

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDUI_INFO {
        public int cbSize;
        public IntPtr hwndParent;
        public string pszMessageText;
        public string pszCaptionText;
        public IntPtr hbmBanner;
    }

    // CREDUIWIN_IN_CRED_ONLY = 0x20 — verifies current user, doesn't ask for new creds
    // Actually just use 0 for default behavior + Hello
    private const int CREDUIWIN_HELLO_FLAG = 0x80000; // CREDUIWIN_AUTHPACKAGE_ONLY not quite right

    public static bool Verify(string caption, string message) {
        var info = new CREDUI_INFO();
        info.cbSize = Marshal.SizeOf(info);
        info.pszCaptionText = caption;
        info.pszMessageText = message;

        uint authPackage = 0;
        IntPtr outBuf;
        uint outBufSize;
        bool save = false;

        int result = CredUIPromptForWindowsCredentialsW(
            ref info, 0, ref authPackage,
            IntPtr.Zero, 0,
            out outBuf, out outBufSize,
            ref save, 0
        );

        if (outBuf != IntPtr.Zero) Marshal.FreeCoTaskMem(outBuf);

        return result == 0; // ERROR_SUCCESS
    }
}
"@

Write-Host "Testing CredUI prompt..."
$ok = [CredUI]::Verify("ai-revolver", "Verify identity to unlock vault")
Write-Host "Result: $ok"
