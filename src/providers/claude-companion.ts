/**
 * Ensure Claude vault grab_data carries a complete oauthAccount companion block.
 * Claude Code reads ~/.claude.json.oauthAccount for UI/plan/limits; credentials
 * alone are not enough. On grab/sync we synthesize missing or stale blocks from
 * live credentials so new profiles are not half-empty after switch.
 */

export type ClaudeOauthAccount = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function orgTypeFromSubscription(subscriptionType: unknown): string {
  if (subscriptionType === "max") return "claude_max";
  if (subscriptionType === "pro") return "claude_pro";
  if (typeof subscriptionType === "string" && subscriptionType.length > 0) return subscriptionType;
  return "claude_pro";
}

function inferAccountUuid(
  companionJson: Record<string, unknown> | undefined,
  organizationUuid: string,
): string | undefined {
  const oauthAccount = asRecord(companionJson?.oauthAccount);
  if (
    typeof oauthAccount?.accountUuid === "string" &&
    oauthAccount.organizationUuid === organizationUuid
  ) {
    return oauthAccount.accountUuid;
  }

  const groveCache = asRecord(companionJson?.groveConfigCache);
  const groveIds = groveCache ? Object.keys(groveCache) : [];
  const staleOrg = oauthAccount?.organizationUuid;
  const staleId =
    typeof staleOrg === "string" && staleOrg !== organizationUuid
      ? (typeof oauthAccount?.accountUuid === "string" ? oauthAccount.accountUuid : undefined)
      : undefined;

  const candidate = groveIds.find((id) => id !== staleId);
  if (candidate) return candidate;
  if (typeof oauthAccount?.accountUuid === "string") return oauthAccount.accountUuid;
  return groveIds[0];
}

function subscriptionTypeFromGrab(
  grabData: Record<string, unknown>,
  rawCredentials: Record<string, unknown>,
): unknown {
  return (
    grabData["claudeAiOauth.subscriptionType"]
    ?? asRecord(rawCredentials.claudeAiOauth)?.subscriptionType
  );
}

function rateLimitTierFromGrab(
  grabData: Record<string, unknown>,
  rawCredentials: Record<string, unknown>,
): unknown {
  return (
    grabData["claudeAiOauth.rateLimitTier"]
    ?? asRecord(rawCredentials.claudeAiOauth)?.rateLimitTier
  );
}

function resolveEmail(
  profileName: string | undefined,
  existing: ClaudeOauthAccount | undefined,
  organizationUuid: string,
): string {
  if (
    existing?.organizationUuid === organizationUuid
    && typeof existing.emailAddress === "string"
    && existing.emailAddress.includes("@")
  ) {
    return existing.emailAddress;
  }
  if (profileName?.includes("@")) return profileName;
  if (typeof existing?.emailAddress === "string" && existing.emailAddress.includes("@")) {
    return existing.emailAddress;
  }
  return typeof existing?.emailAddress === "string" ? existing.emailAddress : "";
}

export function isClaudeOauthAccountComplete(
  oauthAccount: unknown,
  organizationUuid: string,
): boolean {
  const account = asRecord(oauthAccount);
  if (!account) return false;
  return (
    account.organizationUuid === organizationUuid
    && typeof account.emailAddress === "string"
    && account.emailAddress.length > 0
    && typeof account.organizationType === "string"
    && account.organizationType.length > 0
  );
}

export function buildClaudeOauthAccount(params: {
  organizationUuid: string;
  emailAddress: string;
  subscriptionType?: unknown;
  rateLimitTier?: unknown;
  companionJson?: Record<string, unknown>;
  existing?: ClaudeOauthAccount;
}): ClaudeOauthAccount {
  const email = params.emailAddress;
  const subscriptionType = params.subscriptionType;
  const rateLimitTier = params.rateLimitTier;

  return {
    accountUuid: inferAccountUuid(params.companionJson, params.organizationUuid)
      ?? (typeof params.existing?.accountUuid === "string" ? params.existing.accountUuid : undefined),
    emailAddress: email,
    organizationUuid: params.organizationUuid,
    hasExtraUsageEnabled: params.existing?.hasExtraUsageEnabled ?? false,
    billingType: params.existing?.billingType ?? "stripe_subscription",
    accountCreatedAt: params.existing?.accountCreatedAt ?? null,
    subscriptionCreatedAt: params.existing?.subscriptionCreatedAt ?? null,
    ccOnboardingFlags: params.existing?.ccOnboardingFlags ?? {},
    claudeCodeTrialEndsAt: params.existing?.claudeCodeTrialEndsAt ?? null,
    claudeCodeTrialDurationDays: params.existing?.claudeCodeTrialDurationDays ?? null,
    seatTier: params.existing?.seatTier ?? null,
    displayName:
      typeof params.existing?.displayName === "string"
        ? params.existing.displayName
        : (email.includes("@") ? email.split("@")[0] : email),
    organizationRole: params.existing?.organizationRole ?? "admin",
    workspaceRole: params.existing?.workspaceRole ?? null,
    organizationName:
      typeof params.existing?.organizationName === "string"
        ? params.existing.organizationName
        : (email ? `${email}'s Organization` : "Organization"),
    organizationType: orgTypeFromSubscription(subscriptionType),
    organizationRateLimitTier:
      typeof rateLimitTier === "string" && rateLimitTier.length > 0
        ? rateLimitTier
        : "default_claude_ai",
    userRateLimitTier: params.existing?.userRateLimitTier ?? null,
  };
}

/**
 * Merge/enrich grab_data.oauthAccount when missing or pointing at another org.
 * No-op when organizationUuid is absent or companion block is already complete.
 */
export function enrichClaudeGrabData(
  grabData: Record<string, unknown>,
  rawCredentials: Record<string, unknown>,
  opts: { profileName?: string; companionJson?: Record<string, unknown> } = {},
): Record<string, unknown> {
  const organizationUuid =
    (typeof grabData.organizationUuid === "string" ? grabData.organizationUuid : undefined)
    ?? (typeof rawCredentials.organizationUuid === "string" ? rawCredentials.organizationUuid : undefined);

  if (!organizationUuid) return grabData;

  const existing = asRecord(grabData.oauthAccount);
  if (isClaudeOauthAccountComplete(existing, organizationUuid)) {
    return grabData;
  }

  const emailAddress = resolveEmail(opts.profileName, existing, organizationUuid);
  const oauthAccount = buildClaudeOauthAccount({
    organizationUuid,
    emailAddress,
    subscriptionType: subscriptionTypeFromGrab(grabData, rawCredentials),
    rateLimitTier: rateLimitTierFromGrab(grabData, rawCredentials),
    companionJson: opts.companionJson,
    existing,
  });

  return { ...grabData, oauthAccount };
}