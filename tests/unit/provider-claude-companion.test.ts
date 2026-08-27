import { describe, expect, it } from "vitest";
import {
  buildClaudeOauthAccount,
  enrichClaudeGrabData,
  isClaudeOauthAccountComplete,
} from "../../src/providers/claude-companion.js";
import { readFile } from "node:fs/promises";
import { loadProviderFromString } from "../../src/providers/loader.js";
import { checkIdentity, extractIdentityFromRaw } from "../../src/core/identity.js";

const ORG = "11111111-2222-3333-4444-555555555555";
const OTHER_ORG = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("claude companion enrichment", () => {
  const rawCredentials = {
    organizationUuid: ORG,
    claudeAiOauth: {
      subscriptionType: "max",
      rateLimitTier: "tier_max",
      scopes: ["user:inference"],
    },
  };

  it("isClaudeOauthAccountComplete accepts matching complete block", () => {
    expect(
      isClaudeOauthAccountComplete(
        {
          organizationUuid: ORG,
          emailAddress: "user@example.com",
          organizationType: "claude_max",
        },
        ORG,
      ),
    ).toBe(true);
  });

  it("buildClaudeOauthAccount maps subscription tier and grove account uuid", () => {
    const account = buildClaudeOauthAccount({
      organizationUuid: ORG,
      emailAddress: "user@example.com",
      subscriptionType: "max",
      rateLimitTier: "tier_max",
      companionJson: {
        groveConfigCache: {
          "acct-from-grove": {},
        },
        oauthAccount: {
          organizationUuid: OTHER_ORG,
          accountUuid: "stale-acct",
        },
      },
    });

    expect(account.organizationUuid).toBe(ORG);
    expect(account.emailAddress).toBe("user@example.com");
    expect(account.organizationType).toBe("claude_max");
    expect(account.organizationRateLimitTier).toBe("tier_max");
    expect(account.accountUuid).toBe("acct-from-grove");
    expect(account.displayName).toBe("user");
  });

  it("enrichClaudeGrabData synthesizes oauthAccount when companion field is missing", () => {
    const enriched = enrichClaudeGrabData(
      {
        organizationUuid: ORG,
        "claudeAiOauth.subscriptionType": "pro",
        "claudeAiOauth.rateLimitTier": "default_claude_ai",
      },
      rawCredentials,
      { profileName: "user@example.com" },
    );

    expect(enriched.oauthAccount).toMatchObject({
      organizationUuid: ORG,
      emailAddress: "user@example.com",
      organizationType: "claude_pro",
      organizationRateLimitTier: "default_claude_ai",
    });
  });

  it("enrichClaudeGrabData rebuilds stale oauthAccount when org mismatches credentials", () => {
    const enriched = enrichClaudeGrabData(
      {
        organizationUuid: ORG,
        oauthAccount: {
          organizationUuid: OTHER_ORG,
          emailAddress: "stale@example.com",
          organizationType: "claude_pro",
        },
      },
      rawCredentials,
      { profileName: "user@example.com" },
    );

    expect(enriched.oauthAccount).toMatchObject({
      organizationUuid: ORG,
      emailAddress: "user@example.com",
      organizationType: "claude_max",
    });
  });

  it("enrichClaudeGrabData preserves complete oauthAccount", () => {
    const complete = {
      organizationUuid: ORG,
      emailAddress: "user@example.com",
      organizationType: "claude_max",
      accountUuid: "keep-me",
      displayName: "Custom Name",
    };

    const enriched = enrichClaudeGrabData(
      {
        organizationUuid: ORG,
        oauthAccount: complete,
      },
      rawCredentials,
      { profileName: "other@example.com" },
    );

    expect(enriched.oauthAccount).toEqual(complete);
  });

  it("enrichClaudeGrabData no-ops without organizationUuid", () => {
    const before = { oauthAccount: { emailAddress: "a@b.c" } };
    expect(enrichClaudeGrabData(before, {})).toEqual(before);
  });

  it("uses current companion identity and a token digest for satellites", async () => {
    const provider = loadProviderFromString(await readFile("providers/claude.yaml", "utf8"));
    const raw = {
      claudeAiOauth: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: 1,
      },
    };
    const grabData = {
      oauthAccount: {
        organizationUuid: "org-current",
        emailAddress: "current@example.test",
      },
    };
    const identity = extractIdentityFromRaw(provider, raw, grabData);

    expect(identity).toMatchObject({
      "oauthAccount.organizationUuid": "org-current",
    });
    expect(identity?.["claudeAiOauth.refreshToken"]).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(checkIdentity(provider, identity, raw, grabData)).toEqual({ ok: true });
    expect(checkIdentity(provider, identity, raw)).toEqual({ ok: true });
  });
});
