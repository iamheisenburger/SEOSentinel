/**
 * Tenant-scoped authority-autopilot consent.
 *
 * Automatic outreach is never inferred from publishing autopilot, an inbox
 * connection, or a paid plan. The tenant owner must accept this exact policy
 * once for the current mailbox/compliance configuration. Any reconnect,
 * sender-profile change, suspension, or explicit disable makes the receipt
 * inactive without weakening the historical audit fields.
 */

export const OUTREACH_AUTONOMY_CONSENT_VERSION = 1;

export const OUTREACH_AUTONOMY_CONSENT_TEXT =
  "I authorize Pentra to send evidence-grounded one-to-one commercial business outreach automatically from this dedicated secondary-domain Gmail inbox, including at most two follow-ups, subject to warm-up, daily caps, suppression, bounce/reply monitoring, and immediate disable. I confirm the sender identity and physical address are accurate, that I am responsible for a lawful basis in each recipient jurisdiction, and that this use complies with my mailbox provider's terms; I accept the sending-domain and mailbox-reputation risk.";

export const OUTREACH_AUTONOMY_POLICY_HASH =
  "f3fd394830c6d34269b55ffd4fd2a87e1f113522c54e6904c979ecc4585421ce";

/** The first release stays deliberately below the general mailbox ceiling. */
export const OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP = 10;

export type OutreachAutonomyInbox = {
  mode?: string;
  configurationVersion?: number;
  autonomyConsentVersion?: number;
  autonomyConsentPolicyHash?: string;
  autonomyConsentAcceptedAt?: number;
  autonomyConsentAcceptedBy?: string;
  autonomyConsentInboxConfigurationVersion?: number;
  autonomyLastEnabledAt?: number;
  autonomyDisabledAt?: number;
};

export function autonomousOutreachRuntimeEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function autonomousOutreachConsentActive(
  inbox: OutreachAutonomyInbox | null | undefined,
  ownerId: string | undefined,
): boolean {
  if (!inbox || inbox.mode !== "live" || !ownerId) return false;
  return Boolean(
    inbox.autonomyConsentVersion === OUTREACH_AUTONOMY_CONSENT_VERSION &&
      inbox.autonomyConsentPolicyHash === OUTREACH_AUTONOMY_POLICY_HASH &&
      Number.isFinite(inbox.autonomyConsentAcceptedAt) &&
      inbox.autonomyConsentAcceptedAt! > 0 &&
      inbox.autonomyConsentAcceptedBy === ownerId &&
      inbox.autonomyConsentInboxConfigurationVersion ===
        (inbox.configurationVersion ?? 0) &&
      (!inbox.autonomyDisabledAt ||
        inbox.autonomyDisabledAt < inbox.autonomyConsentAcceptedAt!),
  );
}

export function autonomousMessageAuthorizationMatches(args: {
  inbox: OutreachAutonomyInbox | null | undefined;
  ownerId: string | undefined;
  approvalKind?: string;
  approvalConsentVersion?: number;
  approvalConsentPolicyHash?: string;
  approvalConsentAcceptedAt?: number;
}): boolean {
  return Boolean(
    autonomousOutreachConsentActive(args.inbox, args.ownerId) &&
      args.approvalKind === "account_autopilot" &&
      args.approvalConsentVersion === args.inbox!.autonomyConsentVersion &&
      args.approvalConsentPolicyHash ===
        args.inbox!.autonomyConsentPolicyHash &&
      args.approvalConsentAcceptedAt ===
        args.inbox!.autonomyConsentAcceptedAt,
  );
}
