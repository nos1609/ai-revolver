import { describe, expect, it } from "vitest";
import {
  buildWinVerifyAvailableScript,
  buildWinVerifyIdentityScript,
} from "../../src/vault/keyring-win.js";

describe("Windows identity verification", () => {
  it("uses UserConsentVerifier instead of CredUI credential prompts", () => {
    const script = buildWinVerifyIdentityScript("unlock");

    expect(script).toContain("Windows.Security.Credentials.UI.UserConsentVerifier");
    expect(script).toContain("CheckAvailabilityAsync()");
    expect(script).toContain("RequestVerificationAsync('unlock')");
    expect(script).toContain("UserConsentVerificationResult]::Verified");
    expect(script).not.toContain("CredUIPromptForWindowsCredentials");
    expect(script).not.toContain("CredPackAuthenticationBuffer");
  });

  it("checks Windows Hello availability through UserConsentVerifier", () => {
    const script = buildWinVerifyAvailableScript();

    expect(script).toContain("CheckAvailabilityAsync()");
    expect(script).toContain("UserConsentVerifierAvailability]::Available");
    expect(script).not.toContain("credui.dll");
  });

  it("escapes single quotes in the prompt reason", () => {
    const script = buildWinVerifyIdentityScript("owner's vault");

    expect(script).toContain("RequestVerificationAsync('owner''s vault')");
  });
});
