/**
 * Tenant-scoped authority-autopilot consent.
 *
 * Automatic outreach is never inferred from publishing autopilot, an inbox
 * connection, or a paid plan. The tenant owner must accept this exact policy
 * once for the current mailbox/compliance configuration. Any reconnect,
 * sender-profile change, suspension, or explicit disable makes the receipt
 * inactive without weakening the historical audit fields.
 */

export const OUTREACH_AUTONOMY_CONSENT_VERSION = 3;

/** Additive compliance-ledger backfills and every fleet/claim gate must agree
 * on this exact version or completed tenants can be stranded indefinitely. */
export const OUTREACH_DURABILITY_MIGRATION_VERSION = 3;

/** Raw recipient and message-body data belongs to the account that created
 * the draft, before any provider claim exists. Additive-rollout rows whose
 * lineage is unresolved remain invisible and immutable until exact proof is
 * migrated; a current site owner is never treated as proof by itself. */
export function outreachMessageOwnerMatches(
  message: {
    ownerAccountKey?: string;
    ownerLineageUnresolvedAt?: number;
  },
  accountKey: string,
): boolean {
  return Boolean(accountKey) &&
    message.ownerLineageUnresolvedAt === undefined &&
    message.ownerAccountKey === accountKey;
}

/** A pre-owner-lineage row that never had an inbox or provider claim cannot
 * be attributed safely, but it also must not poison the opportunity/thread
 * forever. It may be terminally scrubbed; anything with delivery evidence or
 * an inbox binding stays on the exact-proof migration/settlement path. */
export function legacyUnownedPresendMessageMayBeQuarantined(message: {
  ownerAccountKey?: string;
  inboxId?: unknown;
  deliveryOwnerAccountKey?: string;
  deliveryAttemptId?: string;
  deliveryClaimedAt?: number;
  sentAt?: number;
  status: string;
}): boolean {
  return !message.ownerAccountKey &&
    !message.inboxId &&
    !message.deliveryOwnerAccountKey &&
    !message.deliveryAttemptId &&
    message.deliveryClaimedAt === undefined &&
    message.sentAt === undefined &&
    ["draft", "blocked", "approved"].includes(message.status);
}

export const OUTREACH_AUTONOMY_CONSENT_TEXT =
  "I authorize Pentra to send evidence-grounded one-to-one commercial business outreach automatically from this dedicated secondary-domain outreach mailbox, including at most two timed follow-ups in the same message thread unless a reply, STOP request, bounce, verified link acquisition, tenant parking, consent withdrawal, or sender configuration change cancels the remaining sequence. Sends remain subject to warm-up, daily caps, permanent suppression, and bounce/reply monitoring. Disabling autonomy stops new delivery claims; one attempt already claimed by the provider boundary may settle once. I confirm the sender identity and physical address are accurate, that I am responsible for a lawful basis in each recipient jurisdiction, and that this use complies with my mailbox provider’s terms; I accept the sending-domain and mailbox-reputation risk.";

export const OUTREACH_AUTONOMY_POLICY_HASH =
  "dc8a066cc8583c7be3618d880238612dc1aa72e14f1cc54abae9938432a06df9";

/** Owner-selected ceiling. Warm-up and spacing can only reduce this value. */
export const OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP = 30;

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
  autonomyReconciliationStatus?: string;
};

export function autonomousOutreachReconciliationComplete(
  inbox: OutreachAutonomyInbox | null | undefined,
): boolean {
  return inbox?.autonomyReconciliationStatus === "complete";
}

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
