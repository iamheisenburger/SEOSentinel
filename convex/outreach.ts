/**
 * Authority outreach: inboxes, drafts, suppression and contacts.
 *
 * Two rules shape every function here.
 *
 * 1. Tenant isolation is checked on the record, not inferred from the
 *    argument. A message, contact or suppression is only ever reachable
 *    through the site that owns it.
 * 2. Mailbox credentials never leave the backend. Public queries return a
 *    redacted view; the full record is available only to internal actions that
 *    actually need to authenticate to a mail provider.
 */

import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  DEFAULT_DAILY_SEND_CAP,
  DOMAIN_CONTACT_COOLDOWN_DAYS,
  MAX_SEQUENCE_STEP,
  contactEligibility,
  nextFollowUpAt,
  normalizeDomain,
  outreachComplianceIssues,
  outreachDeliverySettlementDecision,
  outreachSendDecision,
  outreachSenderConnectionIssues,
  isConsumerMailDomain,
  utcDayKey,
} from "./lib/outreachPacing.ts";
import {
  draftFollowUp,
  draftOutreachMessage,
  outreachThreadKey,
} from "./lib/outreachDrafting.ts";
import {
  OUTREACH_AUTONOMY_CONSENT_VERSION,
  OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP,
  OUTREACH_AUTONOMY_POLICY_HASH,
  OUTREACH_DURABILITY_MIGRATION_VERSION,
  autonomousMessageAuthorizationMatches,
  autonomousOutreachConsentActive,
  autonomousOutreachReconciliationComplete,
  autonomousOutreachRuntimeEnabled,
  legacyUnownedPresendMessageMayBeQuarantined,
  outreachMessageOwnerMatches,
} from "./lib/outreachAutonomy.ts";
import {
  outboundIdentityReservationActive,
  reconnectPacingState,
  resolveGmailReconnectProfile,
  sanitizeInboxForClient,
} from "./lib/outreachSecurity.ts";
import {
  OUTREACH_DELIVERY_LEASE_MS,
  SMARTLEAD_DELIVERY_LEASE_MS,
  OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS,
  approvalMatchesInbox,
  autonomousOutreachTransportIssues,
  deliveryExternalBoundaryDecision,
  deliveryLeaseRecoveryDecision,
  deliveryLeaseState,
  deliveryOpportunityBoundaryCurrent,
  liveDnsEvidenceIssues,
  opportunityEvidenceIsFresh,
  sanitizeDeliveryFailure,
  senderClaimIssues,
} from "./lib/outreachDelivery.ts";
import {
  MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
  MANAGED_SES_PLATFORM_RELAY_DOMAIN,
  MANAGED_SES_PLATFORM_SENDER_DOMAIN,
  MANAGED_SES_TRANSPORT,
  managedSesIdentityTupleMatchesEstablished,
  managedSesInboxReceiptCurrent,
  managedSesPacingBoundaryTransition,
} from "./lib/managedSes.ts";
import { reserveManagedSesPacingAttempt } from
  "./lib/managedSesPacing.ts";
import {
  canonicalPublicationUrl,
  verifiedAuthorityTarget,
} from "./lib/publicationLive.ts";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance.ts";
import {
  OUTREACH_INBOUND_LEASE_MS,
  OUTREACH_INBOUND_LOOKBACK_MS,
  OUTREACH_INBOUND_OVERLAP_MS,
  shouldPromoteOutreachInbound,
} from "./lib/outreachInbound.ts";
import {
  OUTREACH_INBOUND_RELAY_CANARY_COOLDOWN_MS,
  OUTREACH_INBOUND_RELAY_CANARY_SEND_LEASE_MS,
  OUTREACH_INBOUND_RELAY_CANARY_TTL_MS,
  inboundRelayAliasHash,
  inboundRelayConfigurationHash,
  inboundRelayConfigured,
  inboundRelayDsnRoutingReady,
  inboundRelayDsnRoutingTarget,
  OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION,
  inboundRelayEmailHash,
  inboundRelayMessageIdHash,
  inboundRelayOutboundMessageIdForAttempt,
  normalizeInboundRelayDomain,
  normalizeRfcMessageId,
} from "./lib/outreachInboundRelay.ts";
import {
  accountDeletionKey,
  accountDeletionRequestedForKey,
} from "./lib/accountDeletion.ts";
import { isSeoGrowthActuationEligible } from "./lib/seoGrowth.ts";
import {
  materializeOutreachSuppressionTombstone,
  materializeOutreachSuppressionTombstoneForAccount,
  outreachSuppressionTombstoneIdentity,
  type OutreachSuppressionKind,
} from "./lib/outreachSuppression.ts";
import {
  legacyUnresolvedContactMayBeReplaced,
  outreachOrganisationDomain,
} from "./lib/outreachContacts.ts";
import {
  adoptDurablePacingReceiptOwner,
  effectiveDurablePacingState,
  outreachMailboxKey,
  readDurableContactReceipt,
  readDurablePacingReceipt,
  recordDurableContactReceiptForAccount,
  recordDurablePacingReceiptForAccount,
  releaseDurableContactClaimForAccount,
  reserveDurableContactClaim,
} from "./lib/outreachDurability.ts";
import {
  followUpPredecessorDecision,
  managedSesFollowUpPredecessorDecision,
} from "./lib/outreachSequence.ts";
import {
  normalizeCanonicalDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
} from "./lib/siteDomainBinding.ts";
import {
  managedOutreachMailboxLeaseIsCurrent,
  managedOutreachMailboxProfileIssues,
  managedOutreachMailboxRequestFenceIssues,
  managedSesRotationCandidateEligible,
} from "./lib/managedOutreachMailbox.ts";
import { ONE_SETUP_CONTRACT_VERSION } from "./lib/oneSetup.ts";
import { stageManagedOutreachMailboxRelease } from
  "./managedOutreachMailbox.ts";
import { sha256Hex } from "./lib/publicationArtifact.ts";
import {
  decideOutreachPolicy,
  OUTREACH_POLICY_VERSION,
} from "./lib/growthLoopContracts.ts";
import {
  SMARTLEAD_ADAPTER_VERSION,
  SMARTLEAD_MANAGED_TRANSPORT,
  SMARTLEAD_MAX_SEQUENCE_STEP,
  SMARTLEAD_MINIMUM_WARMUP_MS,
  smartleadCanaryOperationKey,
  smartleadManagedInboxIssues,
  smartleadOperationKey,
} from "./lib/smartlead.ts";
import {
  describeSmtpIssue,
  smtpConfigIssues,
} from "./lib/outreachSmtp.ts";

function authorityOpportunityMatchesCurrentDomain(
  site: Doc<"sites">,
  opportunity: Doc<"seo_authority_opportunities">,
): boolean {
  const explicitlyCurrent =
    normalizeCanonicalDomain(opportunity.canonicalDomain ?? "") ===
      siteCanonicalDomain(site) &&
    opportunity.domainRevision === siteCanonicalDomainRevision(site);
  const unstampedLegacy =
    siteUsesLegacyDomainReceipts(site) &&
    opportunity.canonicalDomain === undefined &&
    opportunity.domainRevision === undefined;
  return explicitlyCurrent || unstampedLegacy;
}

function outreachMessageMatchesCurrentDomain(
  site: Doc<"sites">,
  message: Doc<"outreach_messages">,
): boolean {
  const explicitlyCurrent =
    normalizeCanonicalDomain(message.canonicalDomain ?? "") ===
      siteCanonicalDomain(site) &&
    message.domainRevision === siteCanonicalDomainRevision(site);
  const unstampedLegacy =
    siteUsesLegacyDomainReceipts(site) &&
    message.canonicalDomain === undefined &&
    message.domainRevision === undefined;
  return explicitlyCurrent || unstampedLegacy;
}

function inboundRelayRuntimeConfig() {
  return {
    domain: process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    secrets: [
      process.env.OUTREACH_INBOUND_RELAY_SECRET,
      process.env.OUTREACH_INBOUND_RELAY_SECRET_NEXT,
    ],
    dsnTargetSecret:
      process.env.OUTREACH_INBOUND_RELAY_DSN_TARGET_SECRET,
    adapterVersion: process.env.OUTREACH_INBOUND_RELAY_ADAPTER_VERSION,
    retentionPolicyHash:
      process.env.OUTREACH_INBOUND_RELAY_RETENTION_POLICY_HASH,
    retentionAudited: process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
  };
}

async function outreachDurabilityMigrationComplete(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
): Promise<boolean> {
  if (!site.userId) return false;
  const receipt = await ctx.db
    .query("outreach_durability_migrations")
    .withIndex("by_account", (q) =>
      q.eq("accountKey", accountDeletionKey(site.userId!))
    )
    .first();
  return Boolean(
    receipt?.version === OUTREACH_DURABILITY_MIGRATION_VERSION &&
      receipt.status === "complete",
  );
}

async function requireSiteOwner(ctx: QueryCtx, siteId: Id<"sites">) {
  const [site, identity] = await Promise.all([
    ctx.db.get(siteId),
    ctx.auth.getUserIdentity(),
  ]);
  if (
    !site?.userId ||
    site.deletionStatus ||
    !identity ||
    identity.subject !== site.userId
  ) {
    throw new Error("Not authorized to access this site's outreach");
  }
  return site;
}

async function inboxForSite(ctx: QueryCtx, siteId: Id<"sites">) {
  return ctx.db
    .query("outreach_inboxes")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .unique();
}

type AutonomousApprovalReceipt = {
  siteId: Id<"sites">;
  ownerAccountKey: string;
  consentVersion: number;
  consentPolicyHash: string;
  consentAcceptedAt: number;
};

/** Capture the immutable approval receipt before a sender/consent mutation.
 * The cancellation worker uses this exact tuple, so a later re-enable can
 * never cancel a newly authorized sequence. */
function autonomousApprovalReceipt(
  inbox: Doc<"outreach_inboxes"> | null | undefined,
): AutonomousApprovalReceipt | null {
  if (
    !inbox?.credentialOwnerAccountKey ||
    !Number.isSafeInteger(inbox.autonomyConsentVersion) ||
    !inbox.autonomyConsentPolicyHash ||
    !Number.isFinite(inbox.autonomyConsentAcceptedAt) ||
    inbox.autonomyConsentAcceptedAt! <= 0
  ) return null;
  return {
    siteId: inbox.siteId,
    ownerAccountKey: inbox.credentialOwnerAccountKey,
    consentVersion: inbox.autonomyConsentVersion!,
    consentPolicyHash: inbox.autonomyConsentPolicyHash,
    consentAcceptedAt: inbox.autonomyConsentAcceptedAt!,
  };
}

async function scheduleAutonomousSequenceCancellation(
  ctx: MutationCtx,
  inbox: Doc<"outreach_inboxes"> | null | undefined,
  reason: string,
): Promise<boolean> {
  const receipt = autonomousApprovalReceipt(inbox);
  if (!receipt) return false;
  await ctx.scheduler.runAfter(
    0,
    internal.outreach.cancelAutonomousSequenceInternal,
    { ...receipt, sequenceStep: 0, reason },
  );
  return true;
}

/**
 * A tenant may never borrow another tenant's mailbox or sender-domain
 * reputation. Disconnected rows release the identity; reconnect is still
 * serialized against the same indexed reads, so two tenants cannot claim it
 * concurrently.
 */
async function outboundIdentityUsedByAnotherTenant(
  ctx: QueryCtx,
  siteId: Id<"sites">,
  fromEmail: string,
  senderDomain: string,
  provider = "gmail",
): Promise<boolean> {
  const normalizedEmail = fromEmail.trim().toLowerCase();
  const normalizedDomain = normalizeDomain(senderDomain);
  if (!normalizedEmail || !normalizedDomain) return true;
  const scanLimit = 20;
  const [sameMailbox, sameDomain] = await Promise.all([
    ctx.db
      .query("outreach_inboxes")
      .withIndex("by_from_email", (q) => q.eq("fromEmail", normalizedEmail))
      .take(scanLimit),
    ctx.db
      .query("outreach_inboxes")
      .withIndex("by_sender_domain", (q) =>
        q.eq("senderDomain", normalizedDomain),
      )
      .take(scanLimit),
  ]);
  if (provider === MANAGED_SES_TRANSPORT) {
    if (normalizedDomain !== MANAGED_SES_PLATFORM_SENDER_DOMAIN) return true;
    if (sameMailbox.length === scanLimit) return true;
    return sameMailbox.some((row) =>
      row.siteId !== siteId && row.status !== "disconnected"
    );
  }
  // A saturated identity range is abnormal. Do not scan without a bound or
  // guess that a conflicting active tenant is absent; require reviewed cleanup.
  if (sameMailbox.length === scanLimit || sameDomain.length === scanLimit) {
    return true;
  }
  const unique = new Map<string, Doc<"outreach_inboxes">>();
  for (const row of [...sameMailbox, ...sameDomain]) unique.set(row._id, row);
  for (const row of unique.values()) {
    if (row.siteId === siteId) continue;
    if (row.status !== "disconnected") return true;
    const [site, sending, unverified] = await Promise.all([
      ctx.db.get(row.siteId),
      ctx.db
        .query("outreach_messages")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", row.siteId).eq("status", "sending")
        )
        .first(),
      ctx.db
        .query("outreach_messages")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", row.siteId).eq("status", "delivery_unverified")
        )
        .first(),
    ]);
    if (outboundIdentityReservationActive({
      inboxStatus: row.status,
      siteExists: Boolean(site),
      siteDeletionPending: Boolean(site?.deletionStatus),
      accountDeletionPending: Boolean(site?.accountDeletionRequestedAt),
      hasSendingDelivery: Boolean(sending),
      hasUnverifiedDelivery: Boolean(unverified),
    })) return true;
  }
  return false;
}

async function pendingLegacyUnboundMessageCount(
  ctx: QueryCtx,
  inboxId: Id<"outreach_inboxes">,
): Promise<number> {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const settledStatuses = ["sent", "delivery_reviewed_sent", "replied"];
  const pending = await Promise.all([
    ...settledStatuses.map((status) =>
      ctx.db
        .query("outreach_messages")
        .withIndex("by_inbox_relay_status_sent", (q) =>
          q
            .eq("inboxId", inboxId)
            .eq("inboundRelayAliasHash", undefined)
            .eq("status", status)
            .gte("sentAt", cutoff)
        )
        .first()
    ),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_inbox_relay_status_sent", (q) =>
        q
          .eq("inboxId", inboxId)
          .eq("inboundRelayAliasHash", undefined)
          .eq("status", "delivery_unverified")
      )
      .first(),
  ]);
  // This is an existence/preflight result, not a misleading total. One direct
  // indexed hit is enough to prevent a reconnect from overwriting read access.
  return pending.some(Boolean) ? 1 : 0;
}

async function assertNoActiveDelivery(
  ctx: MutationCtx,
  siteId: Id<"sites">,
): Promise<void> {
  const inbox = await inboxForSite(ctx, siteId);
  const [sending, unverified, canaries] = await Promise.all([
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) => q.eq("siteId", siteId).eq("status", "sending"))
      .first(),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "delivery_unverified")
      )
      .first(),
    inbox
      ? ctx.db
          .query("outreach_inbound_relay_canaries")
          .withIndex("by_inbox", (q) => q.eq("inboxId", inbox._id))
          .take(2)
      : Promise.resolve([]),
  ]);
  const activeCanary = canaries.some(
    (canary) =>
      canary.deliveryStatus === "claimed" &&
      (canary.deliveryLeaseExpiresAt ?? 0) > Date.now(),
  );
  if (sending || unverified || activeCanary) {
    throw new Error("The inbox cannot change while outreach delivery is in progress");
  }
}

/** Additive credential-owner rollout: an inbox without an owner key may be
 * replaced only by a fresh OAuth grant. Never wait forever on an old
 * delivery_unverified row, but do wait for a provider call whose lease is
 * still live. Once its lease expires, quarantine it before replacing the
 * credential so a late callback cannot mutate the new owner's mailbox state. */
async function quarantineLegacyUnownedDeliveryBeforeReconnect(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  inboxId: Id<"outreach_inboxes">,
): Promise<void> {
  const now = Date.now();
  const [sending, canaries] = await Promise.all([
    ctx.db
      .query("outreach_messages")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "sending")
      )
      .first(),
    ctx.db
      .query("outreach_inbound_relay_canaries")
      .withIndex("by_inbox", (q) => q.eq("inboxId", inboxId))
      .take(2),
  ]);
  if (
    (sending && (sending.deliveryLeaseExpiresAt ?? 0) > now) ||
    canaries.some(
      (canary) =>
        canary.deliveryStatus === "claimed" &&
        (canary.deliveryLeaseExpiresAt ?? 0) > now,
    )
  ) {
    throw new Error(
      "The legacy inbox cannot be replaced while a provider attempt is still in flight",
    );
  }
  if (sending) {
    await ctx.db.patch(sending._id, {
      status: "delivery_unverified",
      deliveryLeaseExpiredAt: now,
      failureReason:
        "The legacy delivery lease expired before credential-owner migration. It remains quarantined and will not be retried.",
      updatedAt: now,
    });
  }
}

async function outreachSettlementLifecycleActive(
  ctx: QueryCtx,
  site: Doc<"sites"> | null,
): Promise<boolean> {
  if (
    !site?.userId ||
    site.deletionStatus ||
    site.accountDeletionRequestedAt ||
    site.domainOwnershipConflictAt
  ) {
    return false;
  }
  const deletionReceipt = await ctx.db
    .query("account_deletion_receipts")
    .withIndex("by_account_key", (q) =>
      q.eq("accountKey", accountDeletionKey(site.userId!))
    )
    .unique();
  if (deletionReceipt) return false;
  return true;
}

async function relaySettlementAuthorized(
  ctx: QueryCtx,
  site: Doc<"sites"> | null,
  sentAt: number | undefined,
): Promise<boolean> {
  const policy = await outreachSettlementPolicy(ctx, site);
  return Boolean(sentAt && policy.allows(sentAt));
}

async function outreachSettlementPolicy(
  ctx: QueryCtx,
  site: Doc<"sites"> | null,
): Promise<{
  allows: (deliveryBoundaryAt: number | undefined) => boolean;
  maximumDeliveryBoundaryAt?: number;
}> {
  if (!(await outreachSettlementLifecycleActive(ctx, site))) {
    return { allows: () => false, maximumDeliveryBoundaryAt: 0 };
  }
  if (await siteExecutionAuthorized(ctx, site)) {
    return { allows: (deliveryBoundaryAt) => Boolean(deliveryBoundaryAt) };
  }
  const entitlement = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site!.userId!))
    .unique();
  const transitionStartedAt = Math.max(
    site!.planAllowanceChangedAt ?? 0,
    site!.planParkedAt ?? 0,
    entitlement?.syncStartedAt ?? 0,
  );
  return {
    maximumDeliveryBoundaryAt: transitionStartedAt,
    allows: (deliveryBoundaryAt) => Boolean(
      transitionStartedAt > 0 &&
      deliveryBoundaryAt &&
      deliveryBoundaryAt <= transitionStartedAt
    ),
  };
}

const LEGACY_INBOUND_SETTLED_STATUSES = [
  "sent",
  "delivery_reviewed_sent",
  "replied",
] as const;

async function legacyUnboundMessages(
  ctx: QueryCtx,
  inboxId: Id<"outreach_inboxes">,
  options: {
    limit: number;
    maximumDeliveryBoundaryAt?: number;
  },
): Promise<Array<Doc<"outreach_messages">>> {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  if (
    options.maximumDeliveryBoundaryAt !== undefined &&
    options.maximumDeliveryBoundaryAt < cutoff
  ) {
    return [];
  }
  const perStatus = Math.max(1, Math.min(40, options.limit));
  const batches = await Promise.all(
    LEGACY_INBOUND_SETTLED_STATUSES.flatMap((status) => {
      if (options.maximumDeliveryBoundaryAt !== undefined) {
        return [
          ctx.db
            .query("outreach_messages")
            .withIndex("by_inbox_relay_status_claimed", (q) =>
              q
                .eq("inboxId", inboxId)
                .eq("inboundRelayAliasHash", undefined)
                .eq("status", status)
                .gte("deliveryClaimedAt", cutoff)
                .lte("deliveryClaimedAt", options.maximumDeliveryBoundaryAt!)
            )
            .order("desc")
            .take(perStatus),
          ctx.db
            .query("outreach_messages")
            .withIndex("by_inbox_relay_status_sent", (q) =>
              q
                .eq("inboxId", inboxId)
                .eq("inboundRelayAliasHash", undefined)
                .eq("status", status)
                .gte("sentAt", cutoff)
                .lte("sentAt", options.maximumDeliveryBoundaryAt!)
            )
            .order("desc")
            .take(perStatus),
        ];
      }
      return [
        ctx.db
          .query("outreach_messages")
          .withIndex("by_inbox_relay_status_sent", (q) =>
            q
              .eq("inboxId", inboxId)
              .eq("inboundRelayAliasHash", undefined)
              .eq("status", status)
              .gte("sentAt", cutoff)
          )
          .order("desc")
          .take(perStatus),
      ];
    }),
  );
  const unique = new Map<string, Doc<"outreach_messages">>();
  for (const message of batches.flat()) {
    const boundary = message.deliveryClaimedAt ?? message.sentAt;
    if (
      message.sentAt &&
      message.sentAt >= cutoff &&
      (message.providerMessageId || message.providerThreadId) &&
      (options.maximumDeliveryBoundaryAt === undefined ||
        (boundary !== undefined &&
          boundary <= options.maximumDeliveryBoundaryAt))
    ) unique.set(message._id, message);
  }
  return [...unique.values()]
    .sort((left, right) => (right.sentAt ?? 0) - (left.sentAt ?? 0))
    .slice(0, options.limit);
}

async function legacyUnboundMessagesMissingThread(
  ctx: QueryCtx,
  inboxId: Id<"outreach_inboxes">,
  maximumDeliveryBoundaryAt?: number,
): Promise<Array<Doc<"outreach_messages">>> {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const batches = await Promise.all(
    LEGACY_INBOUND_SETTLED_STATUSES.map((status) =>
      ctx.db
        .query("outreach_messages")
        .withIndex("by_inbox_relay_thread_status_sent", (q) =>
          q
            .eq("inboxId", inboxId)
            .eq("inboundRelayAliasHash", undefined)
            .eq("providerThreadId", undefined)
            .eq("status", status)
            .gte("sentAt", cutoff)
        )
        .order("desc")
        .take(10)
    ),
  );
  return batches
    .flat()
    .filter((message) => {
      const boundary = message.deliveryClaimedAt ?? message.sentAt;
      return Boolean(
        message.providerMessageId &&
        (maximumDeliveryBoundaryAt === undefined ||
          (boundary !== undefined && boundary <= maximumDeliveryBoundaryAt))
      );
    })
    .sort((left, right) => (right.sentAt ?? 0) - (left.sentAt ?? 0))
    .slice(0, 10);
}

// ── Inbox ──

export const getInbox = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const inbox = await inboxForSite(ctx, siteId);
    if (
      inbox &&
      (!site.userId ||
        inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId))
    ) {
      // Do not expose even the prior owner's sender address or derived relay
      // route to a later site owner. Reconnection replaces this stale binding.
      return null;
    }
    const executionAuthorized = await siteExecutionAuthorized(ctx, site);
    const legacyDrainRequired = inbox
      ? (await pendingLegacyUnboundMessageCount(ctx, inbox._id)) > 0
      : false;
    const runtimeConfig = inboundRelayRuntimeConfig();
    const routingTarget =
      inbox &&
      ["gmail", "smtp"].includes(inbox.provider) &&
      !["disconnected", "suspended"].includes(inbox.status) &&
      Boolean(
        inbox.provider === "smtp"
          ? inbox.smtpPassword
          : inbox.oauthRefreshToken || inbox.oauthAccessToken,
      ) &&
      executionAuthorized
        ? await inboundRelayDsnRoutingTarget({
            siteId: String(site._id),
            inboxId: String(inbox._id),
            generation: inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
            relayDomain: runtimeConfig.domain,
            secret: runtimeConfig.dsnTargetSecret,
          })
        : null;
    const routingCanaryReady = Boolean(
      routingTarget &&
      inbox?.inboundRelayDsnRoutingTargetHash === routingTarget.hash &&
      inbox.inboundRelayDsnRoutingTargetVersion === routingTarget.version &&
      inboundRelayDsnRoutingReady({
        inbox,
        now: Date.now(),
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        runtimeConfig,
      }),
    );
    return sanitizeInboxForClient(
      inbox,
      Date.now(),
      inboundRelayConfigured(runtimeConfig),
      routingCanaryReady,
      legacyDrainRequired,
      routingTarget?.address,
      autonomousOutreachRuntimeEnabled(
        process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
      ),
      site.userId,
      Boolean(
        inbox &&
          executionAuthorized &&
          isSeoGrowthActuationEligible(site) &&
          autonomousOutreachReconciliationComplete(inbox) &&
          (await outreachDurabilityMigrationComplete(ctx, site)) &&
          inbox.credentialOwnerAccountKey === accountDeletionKey(site.userId!) &&
          autonomousOutreachTransportIssues({
            inbox,
            now: Date.now(),
          }).length === 0,
      ),
    );
  },
});

/** Customer-managed SMTP fallback. It remains approval-only until the socket,
 * sender authentication, compliance profile, and signed inbound routing
 * canary all verify. Managed Smartlead remains the default One Setup path. */
export const configureSmtpInbox = mutation({
  args: {
    siteId: v.id("sites"),
    host: v.string(),
    port: v.number(),
    username: v.string(),
    password: v.string(),
    fromEmail: v.string(),
    fromName: v.string(),
    physicalMailingAddress: v.string(),
    dkimSelector: v.string(),
  },
  handler: async (ctx, args) => {
    const site = await requireSiteOwner(ctx, args.siteId);
    if (!(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("This site is not eligible to configure outreach");
    }
    const request = await ctx.db.query("managed_provisioning_requests")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .unique();
    if (
      request &&
      (request.outreachTransport !== "smtp" ||
        request.outreachMailbox.mode !== "connect_existing")
    ) {
      throw new Error("Select SMTP in One Setup before saving SMTP credentials");
    }
    if (
      request?.outreachSenderProfile &&
      (request.outreachSenderProfile.fromName !== args.fromName.trim() ||
        request.outreachSenderProfile.physicalMailingAddress !==
          args.physicalMailingAddress.trim())
    ) {
      throw new Error(
        "The SMTP sender identity must match the exact profile authorized in One Setup",
      );
    }
    const issues = smtpConfigIssues({
      host: args.host,
      port: args.port,
      username: args.username,
      password: args.password,
      fromEmail: args.fromEmail,
    });
    if (issues.length) {
      throw new Error(issues.map(describeSmtpIssue).join(" "));
    }
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const senderDomain = normalizeDomain(fromEmail.split("@")[1] ?? "");
    if (
      args.fromName.trim().length < 2 ||
      args.physicalMailingAddress.trim().length < 15 ||
      !/^[a-z0-9_-]{1,63}$/i.test(args.dkimSelector.trim())
    ) {
      throw new Error("Sender identity, mailing address, or DKIM selector is incomplete");
    }
    const connectionIssues = outreachSenderConnectionIssues({
      siteDomain: site.domain,
      provider: "smtp",
      fromEmail,
    });
    if (connectionIssues.length) throw new Error(connectionIssues.join(" "));
    if (
      await outboundIdentityUsedByAnotherTenant(
        ctx,
        args.siteId,
        fromEmail,
        senderDomain,
        "smtp",
      )
    ) {
      throw new Error("This SMTP mailbox or sender domain belongs to another tenant");
    }
    const existing = await inboxForSite(ctx, args.siteId);
    if (
      existing &&
      (existing.credentialSource === "managed_adapter" ||
        existing.credentialSource === "managed_adapter_retiring" ||
        existing.managedTransportOperationKey)
    ) {
      await stageManagedOutreachMailboxRelease(
        ctx,
        args.siteId,
        Date.now(),
        "owner_selected_connect_existing",
      );
      return {
        configured: false as const,
        releasePending: true as const,
      };
    }
    const ownerAccountKey = accountDeletionKey(site.userId!);
    if (
      existing?.credentialOwnerAccountKey &&
      existing.credentialOwnerAccountKey !== ownerAccountKey
    ) throw new Error("This mailbox belongs to another account");
    if (existing && !existing.credentialOwnerAccountKey) {
      await quarantineLegacyUnownedDeliveryBeforeReconnect(
        ctx,
        args.siteId,
        existing._id,
      );
    } else {
      await assertNoActiveDelivery(ctx, args.siteId);
    }
    const timestamp = Date.now();
    const record = {
      provider: "smtp",
      fromEmail,
      fromName: args.fromName.trim(),
      physicalMailingAddress: args.physicalMailingAddress.trim(),
      complianceConfirmedAt: timestamp,
      status: "connected",
      mode: "approval",
      credentialOwnerAccountKey: ownerAccountKey,
      credentialSource: "owner_smtp",
      smtpHost: args.host.trim().toLowerCase(),
      smtpPort: args.port,
      smtpUsername: args.username.trim(),
      smtpPassword: args.password,
      senderDomain,
      dkimSelector: args.dkimSelector.trim().toLowerCase(),
      dailySendCap: Math.min(
        existing?.dailySendCap ?? DEFAULT_DAILY_SEND_CAP,
        DEFAULT_DAILY_SEND_CAP,
      ),
      warmupStartedAt: undefined,
      sentToday: 0,
      sentTodayDay: utcDayKey(timestamp),
      oauthAccessToken: undefined,
      oauthRefreshToken: undefined,
      oauthExpiresAt: undefined,
      oauthScopes: undefined,
      apiKey: undefined,
      managedTransportOperationKey: undefined,
      managedTransportGeneration: undefined,
      managedTransportAdapterVersion: undefined,
      managedTransportKind: undefined,
      managedTransportResourceReceipt: undefined,
      verifiedAt: undefined,
      dnsCheckedAt: undefined,
      spfVerifiedAt: undefined,
      dkimVerifiedAt: undefined,
      dmarcVerifiedAt: undefined,
      autonomyConsentVersion: undefined,
      autonomyConsentPolicyHash: undefined,
      autonomyConsentAcceptedAt: undefined,
      autonomyConsentAcceptedBy: undefined,
      autonomyConsentInboxConfigurationVersion: undefined,
      autonomyReconciliationStatus: undefined,
      autonomyReconciliationStage: undefined,
      autonomyReconciliationCursor: undefined,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      inboundRelayDsnRoutingTargetGeneration:
        (existing?.inboundRelayDsnRoutingTargetGeneration ?? 0) + 1,
      configurationVersion: (existing?.configurationVersion ?? 0) + 1,
      lastError: "Verify the SMTP connection and sender authentication before sending.",
      updatedAt: timestamp,
    };
    const inboxId = existing
      ? (await ctx.db.patch(existing._id, record), existing._id)
      : await ctx.db.insert("outreach_inboxes", {
          siteId: args.siteId,
          ...record,
          createdAt: timestamp,
        });
    return { configured: true as const, inboxId };
  },
});

export const settleSmtpVerificationInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    expectedConfigurationVersion: v.number(),
    checkedAt: v.number(),
    spfVerified: v.boolean(),
    dkimVerified: v.boolean(),
    dmarcVerified: v.boolean(),
  },
  handler: async (ctx, args) => {
    const [site, inbox] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
    ]);
    if (
      !site?.userId || !inbox || inbox.siteId !== args.siteId ||
      inbox.provider !== "smtp" ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId) ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion ||
      args.checkedAt < Date.now() - 10 * 60 * 1000 ||
      args.checkedAt > Date.now() + 60 * 1000
    ) return { recorded: false as const };
    const authenticated = args.spfVerified && args.dkimVerified &&
      args.dmarcVerified;
    await ctx.db.patch(inbox._id, {
      dnsCheckedAt: args.checkedAt,
      spfVerifiedAt: args.spfVerified ? args.checkedAt : undefined,
      dkimVerifiedAt: args.dkimVerified ? args.checkedAt : undefined,
      dmarcVerifiedAt: args.dmarcVerified ? args.checkedAt : undefined,
      verifiedAt: authenticated ? args.checkedAt : undefined,
      status: authenticated ? "warming" : "connected",
      warmupStartedAt: authenticated
        ? inbox.warmupStartedAt ?? args.checkedAt
        : undefined,
      lastError: authenticated
        ? undefined
        : "SMTP connected, but SPF, DKIM, and DMARC have not all verified.",
      updatedAt: args.checkedAt,
    });
    return { recorded: true as const, ready: authenticated };
  },
});

/** Gmail credentials are accepted only from Pentra's signed server-side
 * OAuth callback. */
const GMAIL_INBOX_INSTALLATION_ARGS = {
  siteId: v.id("sites"),
  fromEmail: v.string(),
  fromName: v.optional(v.string()),
  oauthAccessToken: v.string(),
  oauthRefreshToken: v.optional(v.string()),
  oauthExpiresAt: v.optional(v.number()),
  oauthScopes: v.string(),
  senderDomain: v.string(),
  dkimSelector: v.string(),
  dnsCheckedAt: v.number(),
  spfVerified: v.boolean(),
  dkimVerified: v.boolean(),
  dmarcVerified: v.boolean(),
};

type GmailInboxInstallationArgs = {
  siteId: Id<"sites">;
  fromEmail: string;
  fromName?: string;
  oauthAccessToken: string;
  oauthRefreshToken?: string;
  oauthExpiresAt?: number;
  oauthScopes: string;
  senderDomain: string;
  dkimSelector: string;
  dnsCheckedAt: number;
  spfVerified: boolean;
  dkimVerified: boolean;
  dmarcVerified: boolean;
};

type ManagedGmailComplianceProfile = {
  fromName: string;
  physicalMailingAddress: string;
  complianceConfirmedAt: number;
};

type ManagedTransportBinding = {
  operationKey: string;
  generation: number;
  adapterVersion: string;
};

export const connectGmailInboxInternal = internalMutation({
  args: GMAIL_INBOX_INSTALLATION_ARGS,
  handler: (ctx, args) => installCanonicalGmailInbox(ctx, args),
});

/** The owner OAuth callback and a future managed adapter converge on this one
 * canonical Gmail writer. Managed callers must first cross their request and
 * resource lease fence below; credentials never touch the managed ledger. */
async function installCanonicalGmailInbox(
  ctx: MutationCtx,
  args: GmailInboxInstallationArgs,
  managedProfile?: ManagedGmailComplianceProfile,
  managedBinding?: ManagedTransportBinding,
) {
    const site = await ctx.db.get(args.siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    const credentialOwnerAccountKey = accountDeletionKey(site.userId!);
    const ownerSetupRequest = !managedBinding
      ? await ctx.db
          .query("managed_provisioning_requests")
          .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
          .unique()
      : null;
    if (
      ownerSetupRequest &&
      (ownerSetupRequest.outreachMailbox.mode !== "connect_existing" ||
        ownerSetupRequest.outreachTransport !== "gmail_oauth")
    ) {
      throw new Error(
        "Select Gmail OAuth in One Setup before connecting an owner Gmail mailbox",
      );
    }
    const oneSetupOwnerProfile = !managedBinding &&
        ownerSetupRequest?.ownerAccountKey === credentialOwnerAccountKey &&
        ownerSetupRequest.contractVersion === ONE_SETUP_CONTRACT_VERSION &&
        ownerSetupRequest.domainSnapshot === siteCanonicalDomain(site) &&
        ownerSetupRequest.domainRevisionSnapshot ===
          siteCanonicalDomainRevision(site) &&
        ownerSetupRequest.outreachSenderProfile
      ? {
          fromName: ownerSetupRequest.outreachSenderProfile.fromName,
          physicalMailingAddress:
            ownerSetupRequest.outreachSenderProfile.physicalMailingAddress,
          complianceConfirmedAt: ownerSetupRequest.outreachSenderProfile
            .senderIdentityAndAddressAttestedAt,
        }
      : undefined;
    const connectionProfile = managedProfile ?? oneSetupOwnerProfile;
    const existing = await inboxForSite(ctx, args.siteId);
    if (
      existing &&
      !managedBinding &&
      (
        existing.credentialSource === "managed_adapter" ||
        existing.credentialSource === "managed_adapter_retiring" ||
        existing.managedTransportOperationKey !== undefined ||
        existing.managedTransportGeneration !== undefined ||
        existing.managedTransportAdapterVersion !== undefined
      )
    ) {
      if (ownerSetupRequest?.outreachMailbox.mode !== "connect_existing") {
        throw new Error(
          "Select Connect existing in One Setup before replacing a managed mailbox",
        );
      }
      const managedResources = await ctx.db
        .query("managed_outreach_mailbox_resources")
        .withIndex("by_canonical_inbox", (q) =>
          q.eq("canonicalInboxId", existing._id)
        )
        .take(2);
      if (managedResources.length === 0) {
        throw new Error(
          "Managed mailbox provenance cannot be released automatically; operator review is required",
        );
      }
      await stageManagedOutreachMailboxRelease(
        ctx,
        args.siteId,
        Date.now(),
        "owner_selected_connect_existing",
      );
      const retired = await ctx.db.get(existing._id);
      return {
        inboxId: existing._id,
        reconnected: false,
        ready: false,
        inboundReady: false,
        managedReleasePending: Boolean(
          retired?.credentialSource === "managed_adapter_retiring" ||
            retired?.managedTransportOperationKey !== undefined,
        ),
        freshOwnerConnectionRequired: true as const,
      };
    }
    const existingOwnerMatches = Boolean(
      existing?.credentialOwnerAccountKey === credentialOwnerAccountKey,
    );
    if (
      existing?.credentialOwnerAccountKey &&
      !existingOwnerMatches
    ) {
      // Site ownership transfer is not a supported outreach operation. A
      // credential, profile and delayed settlement remain bound to the
      // account that connected/claimed them; support must create a clean
      // tenant rather than silently transferring Gmail authority.
      throw new Error(
        "This site's Gmail credential belongs to another account and cannot be transferred",
      );
    }
    if (existing && !existing.credentialOwnerAccountKey) {
      await quarantineLegacyUnownedDeliveryBeforeReconnect(
        ctx,
        args.siteId,
        existing._id,
      );
    } else {
      await assertNoActiveDelivery(ctx, args.siteId);
    }
    const now = Date.now();
    if (
      args.oauthAccessToken.length < 10 ||
      args.dnsCheckedAt < now - 10 * 60 * 1000 ||
      args.dnsCheckedAt > now + 60 * 1000 ||
      !/^[a-z0-9_-]{1,63}$/i.test(args.dkimSelector)
    ) {
      throw new Error("Mailbox verification evidence is invalid or stale");
    }
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const connectionIssues = outreachSenderConnectionIssues({
      siteDomain: site.domain,
      provider: "gmail",
      fromEmail,
    });
    if (connectionIssues.length > 0) throw new Error(connectionIssues.join(" "));
    const grantedScopes = args.oauthScopes.split(/\s+/).filter(Boolean);
    const allowedScopes = new Set([
      "https://www.googleapis.com/auth/gmail.send",
      "openid",
      "email",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
    if (
      !grantedScopes.includes("https://www.googleapis.com/auth/gmail.send") ||
      !grantedScopes.every((scope) => allowedScopes.has(scope))
    ) {
      throw new Error("Google did not return a strict send-only Gmail grant");
    }
    const emailDomain = normalizeDomain(fromEmail.split("@")[1] ?? "");
    if (!emailDomain || emailDomain !== normalizeDomain(args.senderDomain)) {
      throw new Error("Sender-domain evidence does not match the connected mailbox");
    }
    if (
      await outboundIdentityUsedByAnotherTenant(
        ctx,
        args.siteId,
        fromEmail,
        emailDomain,
        "gmail",
      )
    ) {
      throw new Error(
        "This outbound mailbox or sender domain is already connected to another tenant",
      );
    }

    const legacyInboundDrainPending = Boolean(
      existing &&
        !existingOwnerMatches &&
        existing.oauthScopes?.split(/\s+/).includes(
          "https://www.googleapis.com/auth/gmail.readonly",
        ) &&
        (existing.oauthRefreshToken || existing.oauthAccessToken) &&
        (await pendingLegacyUnboundMessageCount(ctx, existing._id)) > 0,
    );
    if (legacyInboundDrainPending) {
      if (existing!.fromEmail.trim().toLowerCase() !== fromEmail) {
        throw new Error(
          "Reconnect the exact legacy mailbox before its bounded reply and STOP drain can continue",
        );
      }
      if (managedBinding) {
        return {
          inboxId: existing!._id,
          reconnected: false,
          ready: false,
          inboundReady: true,
          legacyDrainAdopted: true as const,
          managedInstallRejected: true as const,
        };
      }
      // A fresh strict OAuth callback proves control of the same mailbox, but
      // it must not overwrite the only credential that can still observe
      // pre-relay replies, STOPs and bounces. Bind that legacy read lane to the
      // now-proven account, scrub the prior profile/consent, and keep outbound
      // delivery impossible until the bounded 90-day drain is empty. The
      // owner can repeat the send-only OAuth connection after the drain.
      await ctx.db.patch(existing!._id, {
        credentialSource: "owner_oauth",
        managedTransportOperationKey: undefined,
        managedTransportGeneration: undefined,
        managedTransportAdapterVersion: undefined,
        credentialOwnerAccountKey,
        fromName: undefined,
        replyToEmail: undefined,
        physicalMailingAddress: undefined,
        complianceConfirmedAt: undefined,
        verifiedAt: undefined,
        status: "connected",
        mode: "approval",
        configurationVersion: (existing!.configurationVersion ?? 0) + 1,
        autonomyConsentVersion: undefined,
        autonomyConsentPolicyHash: undefined,
        autonomyConsentAcceptedAt: undefined,
        autonomyConsentAcceptedBy: undefined,
        autonomyConsentInboxConfigurationVersion: undefined,
        autonomyLastEnabledAt: undefined,
        autonomyDisabledAt: undefined,
        autonomyReconciliationStatus: undefined,
        autonomyReconciliationGeneration: undefined,
        autonomyReconciliationStage: undefined,
        autonomyReconciliationCursor: undefined,
        inboundRelayDsnRoutingVerifiedAt: undefined,
        inboundRelayDsnRoutingConfigurationVersion: undefined,
        inboundRelayDsnRoutingRolloutEpoch: undefined,
        inboundRelayDsnRoutingSenderDomain: undefined,
        inboundRelayDsnRoutingRelayConfigurationHash: undefined,
        inboundRelayDsnRoutingEvidenceHash: undefined,
        inboundRelayDsnRoutingAdapterVersion: undefined,
        inboundRelayDsnRoutingRetentionPolicyHash: undefined,
        inboundRelayDsnRoutingTargetHash: undefined,
        inboundRelayDsnRoutingTargetVersion: undefined,
        inboundRelayDsnRoutingTargetGeneration:
          (existing!.inboundRelayDsnRoutingTargetGeneration ?? 1) + 1,
        lastError:
          "Legacy Gmail reply and STOP monitoring remains active. Send-only reconnect is available after its bounded 90-day drain completes.",
        updatedAt: now,
      });
      return {
        inboxId: existing!._id,
        reconnected: false,
        ready: false,
        inboundReady: true,
        legacyDrainAdopted: true,
      };
    }

    let durablePacing = await readDurablePacingReceipt(
      ctx,
      site,
      emailDomain,
    );
    if (
      durablePacing &&
      durablePacing.retainUntil <= now
    ) {
      await ctx.db.delete(durablePacing._id);
      durablePacing = null;
    }
    if (
      durablePacing &&
      durablePacing.accountKey !== credentialOwnerAccountKey &&
      durablePacing.retainUntil > now
    ) {
      throw new Error(
        "This sender domain remains reserved to its prior account during the 90-day reputation and opt-out retention window",
      );
    }
    const existingRefreshHasLegacyRead = Boolean(
      existingOwnerMatches && existing?.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ),
    );
    const existingScopes = existing?.oauthScopes?.split(/\s+/).filter(Boolean) ?? [];
    const existingRefreshIsStrictOutbound = Boolean(
      existing?.oauthRefreshToken &&
      existing.credentialOwnerAccountKey === credentialOwnerAccountKey &&
      existingScopes.includes("https://www.googleapis.com/auth/gmail.send") &&
      existingScopes.every((scope) => allowedScopes.has(scope)),
    );
    // Credential reuse is bound only to the exact current inbox row. A
    // historical mailbox digest may restore warm-up, but can never authorize
    // using another address's refresh token.
    const reconnectsCurrentMailbox = Boolean(
      existingOwnerMatches &&
        existing &&
        existing.fromEmail.trim().toLowerCase() === fromEmail,
    );
    const restoresSameMailboxWarmup = Boolean(
      reconnectsCurrentMailbox ||
        durablePacing?.mailboxKey === outreachMailboxKey(fromEmail),
    );
    const preservesSenderReputation = Boolean(
      durablePacing ||
        (existing &&
          existingOwnerMatches &&
          normalizeDomain(existing.senderDomain ?? "") === emailDomain),
    );
    if (
      existing &&
      existingRefreshHasLegacyRead &&
      (await pendingLegacyUnboundMessageCount(ctx, existing._id)) > 0
    ) {
      throw new Error(
        "Legacy Gmail monitoring still has unbound sent messages; reconnect is blocked until its 90-day compatibility drain completes",
      );
    }
    if (
      !args.oauthRefreshToken &&
      (!reconnectsCurrentMailbox || !existingRefreshIsStrictOutbound)
    ) {
      throw new Error("Google did not provide durable offline mailbox access");
    }
    const dnsReady = args.spfVerified && args.dkimVerified && args.dmarcVerified;
    const consumerMailbox = isConsumerMailDomain(emailDomain);
    const existingComplianceProfile = {
      physicalMailingAddress: existingOwnerMatches
        ? existing?.physicalMailingAddress
        : undefined,
      complianceConfirmedAt: existingOwnerMatches
        ? existing?.complianceConfirmedAt
        : undefined,
    };
    const reconnectProfile = resolveGmailReconnectProfile({
      requestedFromName: connectionProfile?.fromName ?? args.fromName,
      existingFromName: existingOwnerMatches ? existing?.fromName : undefined,
      physicalMailingAddress: connectionProfile?.physicalMailingAddress ??
        existingComplianceProfile.physicalMailingAddress,
      complianceConfirmedAt: connectionProfile?.complianceConfirmedAt ??
        existingComplianceProfile.complianceConfirmedAt,
    });
    const complianceReady = reconnectProfile.complianceReady;
    const ready = dnsReady && complianceReady;
    const inboundReady = false;
    const dsnRoutingTargetGeneration = existing
      ? reconnectsCurrentMailbox
        ? existing.inboundRelayDsnRoutingTargetGeneration ?? 1
        : (existing.inboundRelayDsnRoutingTargetGeneration ?? 1) + 1
      : 1;
    const pacingState = reconnectPacingState({
      reconnectsSameMailbox: restoresSameMailboxWarmup,
      preservesSenderReputation,
      now,
      existingWarmupStartedAt: restoresSameMailboxWarmup
        ? reconnectsCurrentMailbox
          ? existing?.warmupStartedAt
          : durablePacing?.warmupStartedAt
        : undefined,
      existingSentToday: Math.max(
        existingOwnerMatches && existing?.sentTodayDay === utcDayKey(now)
          ? existing.sentToday ?? 0
          : 0,
        durablePacing?.sentTodayDay === utcDayKey(now)
          ? durablePacing.sentToday
          : 0,
      ),
      existingSentTodayDay: utcDayKey(now),
      existingLastSentAt: Math.max(
        existingOwnerMatches ? existing?.lastSentAt ?? 0 : 0,
        durablePacing?.lastSentAt ?? 0,
      ) || undefined,
    });
    const record = {
      provider: "gmail",
      fromEmail,
      fromName: reconnectProfile.fromName,
      replyToEmail: existingOwnerMatches ? existing?.replyToEmail : undefined,
      physicalMailingAddress: connectionProfile?.physicalMailingAddress ??
        existingComplianceProfile.physicalMailingAddress,
      complianceConfirmedAt: connectionProfile?.complianceConfirmedAt ??
        existingComplianceProfile.complianceConfirmedAt,
      oauthAccessToken: args.oauthAccessToken,
      oauthRefreshToken: args.oauthRefreshToken ??
        (reconnectsCurrentMailbox ? existing?.oauthRefreshToken : undefined),
      oauthExpiresAt: args.oauthExpiresAt,
      oauthScopes: args.oauthScopes,
      smtpPassword: undefined,
      apiKey: undefined,
      credentialOwnerAccountKey,
      credentialSource: managedBinding
        ? "managed_adapter"
        : "owner_oauth",
      managedTransportOperationKey: managedBinding?.operationKey,
      managedTransportGeneration: managedBinding?.generation,
      managedTransportAdapterVersion: managedBinding?.adapterVersion,
      senderDomain: emailDomain,
      dkimSelector: args.dkimSelector,
      dnsCheckedAt: args.dnsCheckedAt,
      spfVerifiedAt: args.spfVerified ? args.dnsCheckedAt : undefined,
      dkimVerifiedAt: args.dkimVerified ? args.dnsCheckedAt : undefined,
      dmarcVerifiedAt: args.dmarcVerified ? args.dnsCheckedAt : undefined,
      configurationVersion: (existing?.configurationVersion ?? 0) + 1,
      verifiedAt: ready ? now : undefined,
      status: ready ? "warming" : "connected",
      mode: "approval",
      dailySendCap: Math.max(
        1,
        Math.min(
          existingOwnerMatches
            ? existing?.dailySendCap ?? DEFAULT_DAILY_SEND_CAP
            : DEFAULT_DAILY_SEND_CAP,
          DEFAULT_DAILY_SEND_CAP,
        ),
      ),
      ...pacingState,
      lastError: consumerMailbox
        ? "Consumer Gmail is connected for a same-mailbox send test only. Prospect outreach requires a dedicated secondary-domain Google Workspace inbox."
        : !dnsReady
          ? "SPF, DKIM and DMARC must all verify before outreach can send."
        : !complianceReady
          ? "Add the sender name and physical mailing address before outreach can send."
          : undefined,
      inboundLastError: undefined,
      inboundSyncPageToken: undefined,
      inboundSyncWindowStartedAt: undefined,
      inboundSyncLeaseId: undefined,
      inboundSyncOwnerAccountKey: undefined,
      inboundSyncLeaseExpiresAt: undefined,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      inboundRelayDsnRoutingTargetGeneration: dsnRoutingTargetGeneration,
      autonomyConsentVersion: undefined,
      autonomyConsentPolicyHash: undefined,
      autonomyConsentAcceptedAt: undefined,
      autonomyConsentAcceptedBy: undefined,
      autonomyConsentInboxConfigurationVersion: undefined,
      autonomyLastEnabledAt: undefined,
      autonomyDisabledAt: undefined,
      autonomyReconciliationStatus: undefined,
      autonomyReconciliationGeneration: undefined,
      autonomyReconciliationStage: undefined,
      autonomyReconciliationCursor: undefined,
      updatedAt: now,
    };

    await adoptDurablePacingReceiptOwner(ctx, site, emailDomain);

    if (existing) {
      await ctx.db.patch(existing._id, record);
      await scheduleAutonomousSequenceCancellation(
        ctx,
        existing,
        "The connected outreach mailbox or sender configuration changed.",
      );
      return { inboxId: existing._id, reconnected: true, ready, inboundReady };
    }
    const inboxId = await ctx.db.insert("outreach_inboxes", {
      ...record,
      siteId: args.siteId,
      createdAt: now,
    });
    return { inboxId, reconnected: false, ready, inboundReady };
}

/**
 * Action-only managed installer. The credential-bearing receipt exists only
 * in these mutation arguments and is written directly to the canonical inbox;
 * it is never copied to the managed request, resource ledger, or projections.
 */
export const installManagedGmailInboxInternal = internalMutation({
  args: {
    ...GMAIL_INBOX_INSTALLATION_ARGS,
    resourceId: v.id("managed_outreach_mailbox_resources"),
    requestId: v.id("managed_provisioning_requests"),
    expectedRequestRevision: v.number(),
    expectedConfigurationRevision: v.number(),
    expectedGeneration: v.number(),
    leaseToken: v.string(),
    adapterVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const [resource, request] = await Promise.all([
      ctx.db.get(args.resourceId),
      ctx.db.get(args.requestId),
    ]);
    const timestamp = Date.now();
    if (
      !resource ||
      !request ||
      resource.requestId !== request._id ||
      resource.siteId !== request.siteId ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      resource.domainSnapshot !== request.domainSnapshot ||
      resource.domainRevisionSnapshot !== request.domainRevisionSnapshot ||
      resource.requestContractVersion !== request.contractVersion ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      resource.domainSnapshot !== request.domainSnapshot ||
      resource.domainRevisionSnapshot !== request.domainRevisionSnapshot ||
      resource.requestContractVersion !== request.contractVersion ||
      args.siteId !== request.siteId ||
      request.revision !== args.expectedRequestRevision ||
      resource.requestConfigurationRevision !==
        args.expectedConfigurationRevision ||
      resource.generation !== args.expectedGeneration ||
      resource.lifecycleState !== "leased" ||
      resource.releaseState !== "active" ||
      !resource.externalProvisioningAttemptedAt ||
      !resource.externalProvisioningSettleAfter ||
      resource.adapterVersion !== args.adapterVersion ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      })
    ) throw new Error("Managed mailbox install lease or request changed");
    const site = await ctx.db.get(request.siteId);
    const fenceIssues = managedOutreachMailboxRequestFenceIssues({
      siteActive: Boolean(
        site?.userId &&
          !site.deletionStatus &&
          !site.accountDeletionRequestedAt,
      ),
      requestMode: request.outreachMailbox.mode,
      requestOwnerAccountKey: request.ownerAccountKey,
      currentOwnerAccountKey: site?.userId
        ? accountDeletionKey(site.userId)
        : undefined,
      requestDomainSnapshot: request.domainSnapshot,
      currentDomainSnapshot: site ? siteCanonicalDomain(site) : null,
      requestDomainRevisionSnapshot: request.domainRevisionSnapshot,
      currentDomainRevision: site ? siteCanonicalDomainRevision(site) : -1,
      expectedConfigurationRevision: args.expectedConfigurationRevision,
      actualConfigurationRevision: request.configurationRevision,
      expectedGeneration: args.expectedGeneration,
      actualGeneration: request.outreachMailboxGeneration,
      expectedContractVersion: ONE_SETUP_CONTRACT_VERSION,
      actualContractVersion: request.contractVersion,
    });
    const profile = request.managedOutreachProfile;
    if (
      fenceIssues.length > 0 ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !profile ||
      managedOutreachMailboxProfileIssues(profile).length > 0 ||
      (args.fromName !== undefined && args.fromName.trim() !== profile.fromName) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(args.adapterVersion)
    ) {
      await stageManagedOutreachMailboxRelease(
        ctx,
        request.siteId,
        timestamp,
        "managed_mailbox_install_lifecycle_invalidated",
      );
      await ctx.db.patch(request._id, {
        fulfillmentState: "cancelled",
        nextAttemptAt: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        completedAt: undefined,
        updatedAt: timestamp,
      });
      return {
        installed: false as const,
        reason: "lifecycle_fence" as const,
      };
    }

    const installation = await installCanonicalGmailInbox(
      ctx,
      {
        siteId: args.siteId,
        fromEmail: args.fromEmail,
        fromName: profile.fromName,
        oauthAccessToken: args.oauthAccessToken,
        oauthRefreshToken: args.oauthRefreshToken,
        oauthExpiresAt: args.oauthExpiresAt,
        oauthScopes: args.oauthScopes,
        senderDomain: args.senderDomain,
        dkimSelector: args.dkimSelector,
        dnsCheckedAt: args.dnsCheckedAt,
        spfVerified: args.spfVerified,
        dkimVerified: args.dkimVerified,
        dmarcVerified: args.dmarcVerified,
      },
      {
        fromName: profile.fromName,
        physicalMailingAddress: profile.physicalMailingAddress,
        complianceConfirmedAt: profile.senderIdentityAndAddressAttestedAt,
      },
      {
        operationKey: resource.operationKey,
        generation: resource.generation,
        adapterVersion: args.adapterVersion,
      },
    );
    if ("managedInstallRejected" in installation) {
      await stageManagedOutreachMailboxRelease(
        ctx,
        request.siteId,
        timestamp,
        "managed_mailbox_legacy_drain_not_installable",
      );
      await ctx.db.patch(request._id, {
        fulfillmentState: "cancelled",
        nextAttemptAt: undefined,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        completedAt: undefined,
        updatedAt: timestamp,
      });
      return {
        ...installation,
        installed: false as const,
        generation: resource.generation,
        operationallyReady: false as const,
        nextRequiredReceipt: "legacy_drain_settlement" as const,
      };
    }
    await ctx.db.patch(resource._id, {
      lifecycleState: "canonicalized",
      releaseState: "active",
      canonicalInboxId: installation.inboxId,
      externalAllocatedAt: resource.externalAllocatedAt ?? timestamp,
      adapterVersion: args.adapterVersion,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      externalProvisioningSettleAfter: undefined,
      nextAttemptAt: undefined,
      lastReasonCode: undefined,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.managedProvisioning.dispatchRequest,
      { requestId: request._id, expectedRevision: request.revision },
    );
    return {
      ...installation,
      installed: true as const,
      generation: resource.generation,
      operationallyReady: false as const,
      nextRequiredReceipt: "signed_dsn_canary" as const,
    };
  },
});

/** Install only the non-secret canonical identity returned by the signed
 * managed-SES adapter. Provider tenant names, ARNs and credentials are not
 * mutation arguments and cannot enter the application database. */
export const installManagedSesInboxInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    resourceId: v.id("managed_outreach_mailbox_resources"),
    requestId: v.id("managed_provisioning_requests"),
    expectedRequestRevision: v.number(),
    expectedConfigurationRevision: v.number(),
    expectedGeneration: v.number(),
    leaseToken: v.string(),
    adapterVersion: v.string(),
    fromEmail: v.string(),
    resourceReceipt: v.string(),
    providerVerifiedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const [resource, request] = await Promise.all([
      ctx.db.get(args.resourceId),
      ctx.db.get(args.requestId),
    ]);
    const timestamp = Date.now();
    if (
      !resource ||
      !request ||
      resource.requestId !== request._id ||
      resource.siteId !== request.siteId ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      resource.domainSnapshot !== request.domainSnapshot ||
      resource.domainRevisionSnapshot !== request.domainRevisionSnapshot ||
      resource.requestContractVersion !== request.contractVersion ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      args.siteId !== request.siteId ||
      request.revision !== args.expectedRequestRevision ||
      resource.requestConfigurationRevision !==
        args.expectedConfigurationRevision ||
      resource.generation !== args.expectedGeneration ||
      resource.lifecycleState !== "leased" ||
      resource.releaseState !== "active" ||
      resource.adapterVersion !== args.adapterVersion ||
      !resource.externalProvisioningAttemptedAt ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      }) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(args.adapterVersion) ||
      !/^[a-f0-9]{64}$/.test(args.resourceReceipt) ||
      !Number.isFinite(args.providerVerifiedAt) ||
      args.providerVerifiedAt <= 0 ||
      args.providerVerifiedAt > timestamp + 5 * 60 * 1000
    ) throw new Error("Managed SES install lease or receipt changed");
    const site = await ctx.db.get(request.siteId);
    const fenceIssues = managedOutreachMailboxRequestFenceIssues({
      siteActive: Boolean(
        site?.userId &&
          !site.deletionStatus &&
          !site.accountDeletionRequestedAt,
      ),
      requestMode: request.outreachMailbox.mode,
      requestOwnerAccountKey: request.ownerAccountKey,
      currentOwnerAccountKey: site?.userId
        ? accountDeletionKey(site.userId)
        : undefined,
      requestDomainSnapshot: request.domainSnapshot,
      currentDomainSnapshot: site ? siteCanonicalDomain(site) : null,
      requestDomainRevisionSnapshot: request.domainRevisionSnapshot,
      currentDomainRevision: site ? siteCanonicalDomainRevision(site) : -1,
      expectedConfigurationRevision: args.expectedConfigurationRevision,
      actualConfigurationRevision: request.configurationRevision,
      expectedGeneration: args.expectedGeneration,
      actualGeneration: request.outreachMailboxGeneration,
      expectedContractVersion: ONE_SETUP_CONTRACT_VERSION,
      actualContractVersion: request.contractVersion,
    });
    const profile = request.managedOutreachProfile;
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const senderDomain = normalizeDomain(fromEmail.split("@")[1] ?? "");
    if (
      fenceIssues.length > 0 ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !profile ||
      managedOutreachMailboxProfileIssues(profile).length > 0 ||
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,63}$/i.test(fromEmail) ||
      senderDomain !== MANAGED_SES_PLATFORM_SENDER_DOMAIN
    ) {
      await stageManagedOutreachMailboxRelease(
        ctx,
        request.siteId,
        timestamp,
        "managed_ses_install_lifecycle_invalidated",
      );
      return { installed: false as const, reason: "lifecycle_fence" as const };
    }
    const [existingRows, sameAddress] = await Promise.all([
      ctx.db
        .query("outreach_inboxes")
        .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
        .take(2),
      ctx.db
        .query("outreach_inboxes")
        .withIndex("by_from_email", (q) => q.eq("fromEmail", fromEmail))
        .take(2),
    ]);
    const existing = existingRows.length === 1 ? existingRows[0] : null;
    const exactExisting = Boolean(
      existing &&
      existing.provider === MANAGED_SES_TRANSPORT &&
      existing.credentialSource === "managed_adapter" &&
      existing.managedTransportKind === MANAGED_SES_TRANSPORT &&
      existing.managedTransportOperationKey === resource.operationKey &&
      existing.managedTransportGeneration === resource.generation &&
      existing.managedTransportAdapterVersion === args.adapterVersion,
    );
    let rotationReusable = false;
    let rotationReusableResourceId:
      | Id<"managed_outreach_mailbox_resources">
      | undefined;
    if (
      existing &&
      !exactExisting &&
      existing.provider === MANAGED_SES_TRANSPORT &&
      existing.status === "disconnected" &&
      existing.mode === "approval" &&
      existing.credentialSource === undefined &&
      existing.managedTransportKind === undefined &&
      existing.managedTransportOperationKey === undefined &&
      existing.managedTransportGeneration === undefined &&
      existing.managedTransportAdapterVersion === undefined &&
      !existing.oauthAccessToken &&
      !existing.oauthRefreshToken &&
      !existing.smtpPassword &&
      !existing.apiKey
    ) {
      const [oldResources, pendingMessages, pendingCanaries] =
        await Promise.all([
          ctx.db
            .query("managed_outreach_mailbox_resources")
            .withIndex("by_canonical_inbox", (q) =>
              q.eq("canonicalInboxId", existing._id)
            )
            .take(3),
          ctx.db
            .query("outreach_messages")
            .withIndex("by_inbox", (q) => q.eq("inboxId", existing._id))
            .filter((q) =>
              q.or(
                q.eq(q.field("status"), "draft"),
                q.eq(q.field("status"), "approved"),
                q.eq(q.field("status"), "sending"),
                q.eq(q.field("status"), "delivery_unverified"),
              )
            )
            .first(),
          ctx.db
            .query("managed_ses_event_canaries")
            .withIndex("by_inbox", (q) => q.eq("inboxId", existing._id))
            .filter((q) =>
              q.or(
                q.eq(q.field("status"), "claimed"),
                q.eq(q.field("status"), "accepted"),
                q.eq(q.field("status"), "unverified"),
              )
            )
            .first(),
        ]);
      const oldResource = oldResources.length === 1 ? oldResources[0] : null;
      const oldTombstone = oldResource
        ? await ctx.db
            .query("managed_outreach_mailbox_release_tombstones")
            .withIndex("by_operation", (q) =>
              q.eq("operationKey", oldResource.operationKey)
            )
            .unique()
        : null;
      rotationReusable = Boolean(oldResource &&
        managedSesRotationCandidateEligible({
          differentGeneration: oldResource._id !== resource._id &&
            oldResource.generation !== resource.generation,
          resourceRequestMatches: oldResource.requestId === request._id,
          siteMatches:
            oldResource.siteId === args.siteId &&
            existing.siteId === args.siteId,
          ownerMatches:
            oldResource.ownerAccountKey === request.ownerAccountKey &&
            existing.credentialOwnerAccountKey === request.ownerAccountKey,
          domainMatches: oldResource.domainSnapshot === request.domainSnapshot,
          domainRevisionMatches:
            oldResource.domainRevisionSnapshot ===
              request.domainRevisionSnapshot,
          contractMatches:
            oldResource.requestContractVersion === request.contractVersion,
          resourceReleased:
            oldResource.lifecycleState === "cancelled" &&
            oldResource.releaseState === "released" &&
            Boolean(oldResource.releasedAt),
          tombstoneMatches:
            oldTombstone?.state === "released" &&
            oldTombstone.operationKey === oldResource.operationKey &&
            oldTombstone.ownerAccountKey === oldResource.ownerAccountKey &&
            oldTombstone.generation === oldResource.generation,
          inboxIdentityMatches:
            oldResource.canonicalInboxId === existing._id &&
            existing.provider === MANAGED_SES_TRANSPORT,
          inboxProvenanceCleared:
            existing.status === "disconnected" &&
            existing.mode === "approval" &&
            existing.credentialSource === undefined &&
            existing.managedTransportKind === undefined &&
            existing.managedTransportOperationKey === undefined &&
            existing.managedTransportGeneration === undefined &&
            existing.managedTransportAdapterVersion === undefined &&
            !existing.oauthAccessToken &&
            !existing.oauthRefreshToken &&
            !existing.smtpPassword &&
            !existing.apiKey,
          noPendingWork: !pendingMessages && !pendingCanaries,
        }));
      if (rotationReusable) rotationReusableResourceId = oldResource!._id;
    }
    if (
      existingRows.length > 1 ||
      (existing && !exactExisting && !rotationReusable) ||
      sameAddress.some((row) => row.siteId !== args.siteId)
    ) {
      await stageManagedOutreachMailboxRelease(
        ctx,
        request.siteId,
        timestamp,
        "managed_ses_canonical_identity_conflict",
      );
      return {
        installed: false as const,
        reason: "canonical_identity_conflict" as const,
      };
    }
    const configurationVersion = exactExisting
      ? existing!.configurationVersion ?? 1
      : (existing?.configurationVersion ?? 0) + 1;
    const preserveExactProofs = Boolean(
      exactExisting &&
      existing!.managedTransportResourceReceipt === args.resourceReceipt,
    );
    const record = {
      provider: MANAGED_SES_TRANSPORT,
      fromEmail,
      fromName: profile.fromName,
      physicalMailingAddress: profile.physicalMailingAddress,
      complianceConfirmedAt: profile.senderIdentityAndAddressAttestedAt,
      status: "warming",
      mode: "approval",
      dailySendCap: Math.min(DEFAULT_DAILY_SEND_CAP, 30),
      warmupStartedAt: exactExisting
        ? existing?.warmupStartedAt ?? timestamp
        : timestamp,
      credentialOwnerAccountKey: request.ownerAccountKey,
      credentialSource: "managed_adapter",
      managedTransportKind: MANAGED_SES_TRANSPORT,
      managedTransportOperationKey: resource.operationKey,
      managedTransportGeneration: resource.generation,
      managedTransportAdapterVersion: args.adapterVersion,
      managedTransportResourceReceipt: args.resourceReceipt,
      managedTransportResourceVerifiedAt: args.providerVerifiedAt,
      managedTransportEventCanaryVerifiedAt: preserveExactProofs
        ? existing!.managedTransportEventCanaryVerifiedAt
        : undefined,
      managedTransportEventCanaryReceipt: preserveExactProofs
        ? existing!.managedTransportEventCanaryReceipt
        : undefined,
      managedTransportEventCanaryOperationKey: preserveExactProofs
        ? existing!.managedTransportEventCanaryOperationKey
        : undefined,
      managedTransportEventProviderMessageIdDigest: preserveExactProofs
        ? existing!.managedTransportEventProviderMessageIdDigest
        : undefined,
      managedTransportInboundCanaryVerifiedAt: preserveExactProofs
        ? existing!.managedTransportInboundCanaryVerifiedAt
        : undefined,
      managedTransportInboundCanaryReceipt: preserveExactProofs
        ? existing!.managedTransportInboundCanaryReceipt
        : undefined,
      managedTransportInboundCanaryOperationKey: preserveExactProofs
        ? existing!.managedTransportInboundCanaryOperationKey
        : undefined,
      managedTransportInboundCanaryInboxBinding: preserveExactProofs
        ? existing!.managedTransportInboundCanaryInboxBinding
        : undefined,
      managedTransportInboundCanaryRelayConfigurationHash: preserveExactProofs
        ? existing!.managedTransportInboundCanaryRelayConfigurationHash
        : undefined,
      managedTransportInboundCanaryAdapterVersion: preserveExactProofs
        ? existing!.managedTransportInboundCanaryAdapterVersion
        : undefined,
      managedTransportInboundCanaryRetentionPolicyHash: preserveExactProofs
        ? existing!.managedTransportInboundCanaryRetentionPolicyHash
        : undefined,
      senderDomain,
      verifiedAt: args.providerVerifiedAt,
      configurationVersion,
      oauthAccessToken: undefined,
      oauthRefreshToken: undefined,
      oauthExpiresAt: undefined,
      oauthScopes: undefined,
      smtpPassword: undefined,
      apiKey: undefined,
      lastError:
        "Managed sender provisioned; waiting for the signed delivery-event canary.",
      updatedAt: timestamp,
    };
    let inboxId: Id<"outreach_inboxes">;
    if (exactExisting || rotationReusable) {
      inboxId = existing!._id;
      await ctx.db.patch(inboxId, record);
    } else {
      inboxId = await ctx.db.insert("outreach_inboxes", {
        ...record,
        siteId: args.siteId,
        createdAt: timestamp,
      });
    }
    await ctx.db.patch(resource._id, {
      lifecycleState: "canonicalized",
      releaseState: "active",
      canonicalInboxId: inboxId,
      externalAllocatedAt: resource.externalAllocatedAt ?? timestamp,
      resourceReceipt: args.resourceReceipt,
      externalVerifiedAt: args.providerVerifiedAt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      externalProvisioningSettleAfter: undefined,
      nextAttemptAt: undefined,
      lastReasonCode: undefined,
      updatedAt: timestamp,
    });
    if (rotationReusableResourceId) {
      // The old released row exists only as an OCC-protected handoff bridge.
      // Delete it in the same transaction that binds the successor so the
      // canonical inbox index is never left ambiguous after installation.
      await ctx.db.delete(rotationReusableResourceId);
    }
    const installedInbox = await ctx.db.get(inboxId);
    const operationallyReady = Boolean(
      installedInbox && managedSesInboxReceiptCurrent({
        inbox: installedInbox,
        now: timestamp,
        expectedAdapterVersion: args.adapterVersion,
      }),
    );
    if (operationallyReady) {
      await ctx.db.patch(inboxId, { lastError: undefined, updatedAt: timestamp });
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.managedOutreachMailbox.sendManagedSesEventCanary,
        { resourceId: resource._id, inboxId },
      );
    }
    return {
      installed: true as const,
      inboxId,
      operationallyReady,
      nextRequiredReceipt: operationallyReady
        ? undefined
        : "signed_managed_ses_event_canary" as const,
    };
  },
});

/** Canonicalize a reconciled Smartlead mailbox without accepting provider
 * credentials or plaintext provider ids. Readiness remains warming until the
 * independent domain, duration, and canary receipts are all present. */
export const installSmartleadManagedInboxInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    resourceId: v.id("managed_outreach_mailbox_resources"),
    requestId: v.id("managed_provisioning_requests"),
    expectedRequestRevision: v.number(),
    expectedConfigurationRevision: v.number(),
    expectedGeneration: v.number(),
    leaseToken: v.string(),
    fromEmail: v.string(),
    encryptedProviderBinding: v.string(),
    configurationHash: v.string(),
    providerVerifiedAt: v.number(),
    warmupStartedAt: v.optional(v.number()),
    warmupProviderActive: v.boolean(),
    warmupProviderHealthy: v.boolean(),
    warmupReputationScore: v.optional(v.number()),
    domainAuthenticationReceipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [resource, request] = await Promise.all([
      ctx.db.get(args.resourceId),
      ctx.db.get(args.requestId),
    ]);
    const timestamp = Date.now();
    if (
      !resource || !request ||
      resource.requestId !== request._id ||
      resource.siteId !== request.siteId ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      request.outreachTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      resource.transportKind !== SMARTLEAD_MANAGED_TRANSPORT ||
      args.siteId !== request.siteId ||
      request.revision !== args.expectedRequestRevision ||
      resource.requestConfigurationRevision !== args.expectedConfigurationRevision ||
      resource.generation !== args.expectedGeneration ||
      resource.lifecycleState !== "leased" ||
      resource.releaseState !== "active" ||
      resource.adapterVersion !== SMARTLEAD_ADAPTER_VERSION ||
      !resource.externalProvisioningAttemptedAt ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      }) ||
      !/^v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(
        args.encryptedProviderBinding,
      ) ||
      !/^[a-f0-9]{64}$/.test(args.configurationHash) ||
      (args.domainAuthenticationReceipt !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.domainAuthenticationReceipt)) ||
      (args.warmupReputationScore !== undefined &&
        (!Number.isFinite(args.warmupReputationScore) ||
          args.warmupReputationScore < 0 || args.warmupReputationScore > 100)) ||
      !Number.isFinite(args.providerVerifiedAt) ||
      args.providerVerifiedAt <= 0 ||
      args.providerVerifiedAt > timestamp + 5 * 60 * 1000
    ) throw new Error("Smartlead install lease or receipt changed");
    const site = await ctx.db.get(request.siteId);
    const fenceIssues = managedOutreachMailboxRequestFenceIssues({
      siteActive: Boolean(site?.userId && !site.deletionStatus && !site.accountDeletionRequestedAt),
      requestMode: request.outreachMailbox.mode,
      requestOwnerAccountKey: request.ownerAccountKey,
      currentOwnerAccountKey: site?.userId ? accountDeletionKey(site.userId) : undefined,
      requestDomainSnapshot: request.domainSnapshot,
      currentDomainSnapshot: site ? siteCanonicalDomain(site) : null,
      requestDomainRevisionSnapshot: request.domainRevisionSnapshot,
      currentDomainRevision: site ? siteCanonicalDomainRevision(site) : -1,
      expectedConfigurationRevision: args.expectedConfigurationRevision,
      actualConfigurationRevision: request.configurationRevision,
      expectedGeneration: args.expectedGeneration,
      actualGeneration: request.outreachMailboxGeneration,
      expectedContractVersion: ONE_SETUP_CONTRACT_VERSION,
      actualContractVersion: request.contractVersion,
    });
    const profile = request.managedOutreachProfile;
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const senderDomain = normalizeDomain(fromEmail.split("@")[1] ?? "");
    if (
      fenceIssues.length > 0 || !site || !(await siteExecutionAuthorized(ctx, site)) ||
      !profile || managedOutreachMailboxProfileIssues(profile).length > 0 ||
      !profile.senderDomainChoice || senderDomain !== profile.senderDomainChoice ||
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,63}$/i.test(fromEmail)
    ) {
      await stageManagedOutreachMailboxRelease(
        ctx,
        request.siteId,
        timestamp,
        "smartlead_install_lifecycle_invalidated",
      );
      return { installed: false as const, reason: "lifecycle_fence" as const };
    }
    const [existingRows, sameAddress] = await Promise.all([
      ctx.db.query("outreach_inboxes").withIndex("by_site", (q) => q.eq("siteId", args.siteId)).take(2),
      ctx.db.query("outreach_inboxes").withIndex("by_from_email", (q) => q.eq("fromEmail", fromEmail)).take(2),
    ]);
    const existing = existingRows.length === 1 ? existingRows[0] : null;
    const exactExisting = Boolean(
      existing &&
      existing.provider === "smartlead" &&
      existing.managedTransportKind === SMARTLEAD_MANAGED_TRANSPORT &&
      existing.managedTransportOperationKey === resource.operationKey &&
      existing.managedTransportGeneration === resource.generation,
    );
    if (
      existingRows.length > 1 ||
      (existing && !exactExisting) ||
      sameAddress.some((row) => row.siteId !== args.siteId)
    ) {
      await stageManagedOutreachMailboxRelease(
        ctx,
        request.siteId,
        timestamp,
        "smartlead_canonical_identity_conflict",
      );
      return { installed: false as const, reason: "canonical_identity_conflict" as const };
    }
    const warmupStartedAt = args.warmupStartedAt;
    const warmupEligibleAt = warmupStartedAt
      ? warmupStartedAt + SMARTLEAD_MINIMUM_WARMUP_MS
      : undefined;
    const warmupVerified = Boolean(
      args.warmupProviderActive && args.warmupProviderHealthy &&
      (args.warmupReputationScore ?? 0) >= 90 &&
      warmupEligibleAt && warmupEligibleAt <= timestamp,
    );
    const configurationVersion = exactExisting
      ? existing!.configurationVersion ?? 1
      : (existing?.configurationVersion ?? 0) + 1;
    const resourceReceipt = sha256Hex(JSON.stringify({
      adapterVersion: SMARTLEAD_ADAPTER_VERSION,
      operationKey: resource.operationKey,
      generation: resource.generation,
      configurationHash: args.configurationHash,
      fromEmailHash: sha256Hex(fromEmail),
    }));
    const record = {
      provider: "smartlead",
      fromEmail,
      fromName: profile.fromName,
      physicalMailingAddress: profile.physicalMailingAddress,
      complianceConfirmedAt: profile.senderIdentityAndAddressAttestedAt,
      status: "warming",
      mode: "approval",
      dailySendCap: Math.min(DEFAULT_DAILY_SEND_CAP, 20),
      warmupStartedAt,
      credentialOwnerAccountKey: request.ownerAccountKey,
      credentialSource: "managed_adapter",
      managedTransportKind: SMARTLEAD_MANAGED_TRANSPORT,
      managedTransportOperationKey: resource.operationKey,
      managedTransportGeneration: resource.generation,
      managedTransportAdapterVersion: SMARTLEAD_ADAPTER_VERSION,
      managedTransportResourceReceipt: resourceReceipt,
      managedTransportResourceVerifiedAt: args.providerVerifiedAt,
      senderDomain,
      verifiedAt: args.providerVerifiedAt,
      configurationVersion,
      oauthAccessToken: undefined,
      oauthRefreshToken: undefined,
      oauthExpiresAt: undefined,
      oauthScopes: undefined,
      smtpPassword: undefined,
      apiKey: undefined,
      lastError: !args.domainAuthenticationReceipt
        ? "Managed sender exists; waiting for exact SPF, DKIM, and DMARC authentication evidence."
        : !warmupVerified
          ? "Managed sender is warming. Pentra will recheck it automatically."
          : "Managed sender is waiting for controlled delivery, reply, bounce, unsubscribe, and cancellation canaries.",
      updatedAt: timestamp,
    };
    let inboxId: Id<"outreach_inboxes">;
    if (exactExisting) {
      inboxId = existing!._id;
      await ctx.db.patch(inboxId, record);
    } else {
      inboxId = await ctx.db.insert("outreach_inboxes", {
        ...record,
        siteId: args.siteId,
        createdAt: timestamp,
      });
    }
    await ctx.db.patch(resource._id, {
      lifecycleState: "canonicalized",
      releaseState: "active",
      canonicalInboxId: inboxId,
      externalAllocatedAt: resource.externalAllocatedAt ?? timestamp,
      encryptedProviderBinding: args.encryptedProviderBinding,
      configurationHash: args.configurationHash,
      resourceReceipt,
      externalVerifiedAt: args.providerVerifiedAt,
      warmupState: warmupVerified ? "verified" : args.warmupProviderActive ? "warming" : "provider_inactive",
      warmupStartedAt,
      warmupEligibleAt,
      warmupReputationScore: args.warmupReputationScore,
      domainAuthenticationReceipt: args.domainAuthenticationReceipt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      externalProvisioningSettleAfter: undefined,
      nextAttemptAt: warmupVerified ? timestamp + 15 * 60 * 1000 : warmupEligibleAt,
      lastReasonCode: warmupVerified
        ? "smartlead_canaries_pending"
        : "smartlead_warmup_pending",
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.managedProvisioning.dispatchRequest,
      { requestId: request._id, expectedRevision: request.revision },
    );
    if (warmupVerified && args.domainAuthenticationReceipt) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.smartlead.runControlledCanaries,
        { resourceId: resource._id },
      );
    }
    return {
      installed: true as const,
      inboxId,
      operationallyReady: false as const,
      nextRequiredReceipt: !args.domainAuthenticationReceipt
        ? "smartlead_domain_authentication"
        : !warmupVerified
          ? "smartlead_warmup"
          : "smartlead_controlled_canaries",
    };
  },
});

const managedSesEventTypeValidator = v.union(
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("complaint"),
  v.literal("delayed"),
  v.literal("rejected"),
  v.literal("rendering_failed"),
);

export const MANAGED_SES_SEND_TOMBSTONE_RETENTION_MS =
  90 * 24 * 60 * 60 * 1000;

/** Materialize the exact provider-attempt bridge before deletion removes its
 * message/inbox. This deliberately excludes tenant, owner, recipient and
 * content fields. A sealed resource release is the only authorization. */
export async function materializeManagedSesSendTombstoneForDeletion(
  ctx: MutationCtx,
  message: Doc<"outreach_messages">,
): Promise<boolean> {
  if (
    message.deliveryTransport !== MANAGED_SES_TRANSPORT ||
    !message.managedSesExternalAttemptedAt
  ) return true;
  if (
    !message.managedSesOperationKey ||
    !message.managedSesResourceOperationKey ||
    !Number.isSafeInteger(message.managedSesGeneration) ||
    !message.managedSesAdapterVersion ||
    !Number.isSafeInteger(message.sequenceStep) ||
    message.sequenceStep < 0 ||
    message.sequenceStep > MAX_SEQUENCE_STEP
  ) return false;
  const releaseTombstone = await ctx.db
    .query("managed_outreach_mailbox_release_tombstones")
    .withIndex("by_operation", (q) =>
      q.eq("operationKey", message.managedSesResourceOperationKey!)
    )
    .unique();
  if (
    !releaseTombstone ||
    releaseTombstone.state !== "released" ||
    releaseTombstone.generation !== message.managedSesGeneration ||
    releaseTombstone.adapterVersion !== message.managedSesAdapterVersion ||
    releaseTombstone.ownerAccountKey !== message.deliveryOwnerAccountKey
  ) return false;
  const existing = await ctx.db
    .query("managed_ses_send_tombstones")
    .withIndex("by_operation", (q) =>
      q.eq("operationKey", message.managedSesOperationKey!)
    )
    .unique();
  if (
    existing &&
    (existing.resourceOperationKey !==
        message.managedSesResourceOperationKey ||
      existing.generation !== message.managedSesGeneration ||
      existing.adapterVersion !== message.managedSesAdapterVersion ||
      existing.sequenceStep !== message.sequenceStep ||
      existing.purpose !== "outreach" ||
      (existing.providerMessageIdDigest !== undefined &&
        message.managedSesProviderMessageIdDigest !== undefined &&
        existing.providerMessageIdDigest !==
          message.managedSesProviderMessageIdDigest) ||
      (existing.rfcMessageIdDigest !== undefined &&
        message.inboundRelayOutboundMessageIdHash !== undefined &&
        existing.rfcMessageIdDigest !==
          message.inboundRelayOutboundMessageIdHash) ||
      (existing.threadReceipt !== undefined &&
        message.managedSesThreadReceipt !== undefined &&
        existing.threadReceipt !== message.managedSesThreadReceipt))
  ) throw new Error("Managed SES send tombstone crossed a binding");
  const timestamp = Date.now();
  const record = {
    operationKey: message.managedSesOperationKey,
    resourceOperationKey: message.managedSesResourceOperationKey,
    generation: message.managedSesGeneration,
    adapterVersion: message.managedSesAdapterVersion,
    sequenceStep: message.sequenceStep,
    purpose: "outreach" as const,
    providerMessageIdDigest:
      message.managedSesProviderMessageIdDigest ??
      existing?.providerMessageIdDigest,
    rfcMessageIdDigest:
      message.inboundRelayOutboundMessageIdHash ??
      existing?.rfcMessageIdDigest,
    threadReceipt:
      message.managedSesThreadReceipt ?? existing?.threadReceipt,
    releaseState: "released" as const,
    terminalEventType: existing?.terminalEventType,
    terminalEventOccurredAt: existing?.terminalEventOccurredAt,
    terminalEventReceipt: existing?.terminalEventReceipt,
    terminalEventBindingHash: existing?.terminalEventBindingHash,
    expiresAt: Math.max(
      existing?.expiresAt ?? 0,
      timestamp + MANAGED_SES_SEND_TOMBSTONE_RETENTION_MS,
    ),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  if (existing) await ctx.db.patch(existing._id, record);
  else await ctx.db.insert("managed_ses_send_tombstones", record);
  return true;
}

export async function materializeManagedSesCanaryTombstoneForDeletion(
  ctx: MutationCtx,
  canary: Doc<"managed_ses_event_canaries">,
): Promise<boolean> {
  if (!canary.externalAttemptedAt) return true;
  const releaseTombstone = await ctx.db
    .query("managed_outreach_mailbox_release_tombstones")
    .withIndex("by_operation", (q) =>
      q.eq("operationKey", canary.resourceOperationKey)
    )
    .unique();
  if (
    !releaseTombstone ||
    releaseTombstone.state !== "released" ||
    releaseTombstone.generation !== canary.generation ||
    releaseTombstone.adapterVersion !== canary.adapterVersion
  ) return false;
  const existing = await ctx.db
    .query("managed_ses_send_tombstones")
    .withIndex("by_operation", (q) => q.eq("operationKey", canary.operationKey))
    .unique();
  if (
    existing &&
    (existing.resourceOperationKey !== canary.resourceOperationKey ||
      existing.generation !== canary.generation ||
      existing.adapterVersion !== canary.adapterVersion ||
      existing.sequenceStep !== 0 ||
      existing.purpose !== "inbound_relay_canary" ||
      (existing.providerMessageIdDigest !== undefined &&
        canary.providerMessageIdDigest !== undefined &&
        existing.providerMessageIdDigest !== canary.providerMessageIdDigest) ||
      (existing.rfcMessageIdDigest !== undefined &&
        canary.rfcMessageIdDigest !== undefined &&
        existing.rfcMessageIdDigest !== canary.rfcMessageIdDigest) ||
      (existing.threadReceipt !== undefined &&
        canary.threadReceipt !== undefined &&
        existing.threadReceipt !== canary.threadReceipt))
  ) throw new Error("Managed SES canary tombstone crossed a binding");
  const timestamp = Date.now();
  const record = {
    operationKey: canary.operationKey,
    resourceOperationKey: canary.resourceOperationKey,
    generation: canary.generation,
    adapterVersion: canary.adapterVersion,
    sequenceStep: 0,
    purpose: "inbound_relay_canary" as const,
    providerMessageIdDigest:
      canary.providerMessageIdDigest ?? existing?.providerMessageIdDigest,
    rfcMessageIdDigest:
      canary.rfcMessageIdDigest ?? existing?.rfcMessageIdDigest,
    threadReceipt: canary.threadReceipt ?? existing?.threadReceipt,
    releaseState: "released" as const,
    terminalEventType: existing?.terminalEventType,
    terminalEventOccurredAt: existing?.terminalEventOccurredAt,
    terminalEventReceipt: existing?.terminalEventReceipt,
    terminalEventBindingHash: existing?.terminalEventBindingHash,
    expiresAt: Math.max(
      existing?.expiresAt ?? 0,
      timestamp + MANAGED_SES_SEND_TOMBSTONE_RETENTION_MS,
    ),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  if (existing) await ctx.db.patch(existing._id, record);
  else await ctx.db.insert("managed_ses_send_tombstones", record);
  return true;
}

async function quarantineManagedSesEventCanaryIdentityMismatch(
  ctx: MutationCtx,
  canary: Doc<"managed_ses_event_canaries">,
  timestamp: number,
) {
  await ctx.db.patch(canary._id, {
    status: "failed",
    dispositionState: "quarantined_integrity",
    dispositionLeaseToken: undefined,
    dispositionLeaseExpiresAt: undefined,
    dispositionSettledAt: timestamp,
    inboundCanaryActivationState: "failed",
    inboundCanaryActivationLeaseToken: undefined,
    inboundCanaryActivationLeaseExpiresAt: undefined,
    inboundCanaryReceipt: undefined,
    inboundCanaryVerifiedAt: undefined,
    updatedAt: timestamp,
  });
  const inbox = await ctx.db.get(canary.inboxId);
  if (!inbox) return;
  const ownsOutboundProof =
    inbox.managedTransportEventCanaryOperationKey === canary.operationKey;
  const ownsInboundProof =
    inbox.managedTransportInboundCanaryOperationKey === canary.operationKey;
  if (!ownsOutboundProof && !ownsInboundProof) return;
  await ctx.db.patch(inbox._id, {
    ...(ownsOutboundProof
      ? {
          managedTransportEventCanaryVerifiedAt: undefined,
          managedTransportEventCanaryReceipt: undefined,
          managedTransportEventCanaryOperationKey: undefined,
          managedTransportEventProviderMessageIdDigest: undefined,
        }
      : {}),
    ...(ownsInboundProof
      ? {
          managedTransportInboundCanaryVerifiedAt: undefined,
          managedTransportInboundCanaryReceipt: undefined,
          managedTransportInboundCanaryOperationKey: undefined,
          managedTransportInboundCanaryInboxBinding: undefined,
          managedTransportInboundCanaryRelayConfigurationHash: undefined,
          managedTransportInboundCanaryAdapterVersion: undefined,
          managedTransportInboundCanaryRetentionPolicyHash: undefined,
        }
      : {}),
    lastError:
      "The managed sender returned a signed provider/RFC/thread identity mismatch. This canary is quarantined and cannot authorize outreach.",
    updatedAt: timestamp,
  });
}

/** Settle one privacy-reduced, signed SES event. The operation index must
 * resolve to exactly one canary or delivery attempt, and every stored binding
 * must still match the canonical managed resource. */
export const recordManagedSesDeliveryEvent = internalMutation({
  args: {
    adapterVersion: v.string(),
    operationKey: v.string(),
    resourceOperationKey: v.string(),
    generation: v.number(),
    sequenceStep: v.number(),
    purpose: v.union(
      v.literal("outreach"),
      v.literal("rfc_message_id_canary"),
      v.literal("inbound_relay_canary"),
    ),
    eventType: managedSesEventTypeValidator,
    occurredAt: v.number(),
    providerMessageIdDigest: v.string(),
    rfcMessageIdDigest: v.string(),
    threadReceipt: v.string(),
    eventReceipt: v.string(),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    if (
      args.adapterVersion !== process.env.MANAGED_SES_ADAPTER_VERSION ||
      !/^[A-Za-z0-9_-]{32,96}$/.test(args.operationKey) ||
      !/^[A-Za-z0-9_-]{32,96}$/.test(args.resourceOperationKey) ||
      !Number.isSafeInteger(args.generation) ||
      args.generation < 1 ||
      !Number.isSafeInteger(args.sequenceStep) ||
      args.sequenceStep < 0 ||
      args.sequenceStep > MAX_SEQUENCE_STEP ||
      !/^[a-f0-9]{64}$/.test(args.providerMessageIdDigest) ||
      !/^[a-f0-9]{64}$/.test(args.rfcMessageIdDigest) ||
      !/^[A-Za-z0-9_-]{32,96}$/.test(args.threadReceipt) ||
      !/^[a-f0-9]{64}$/.test(args.eventReceipt) ||
      !Number.isFinite(args.occurredAt) ||
      args.occurredAt <= 0 ||
      args.occurredAt > timestamp + 5 * 60 * 1000
    ) throw new Error("Managed SES event receipt is invalid");
    const prior = await ctx.db
      .query("managed_ses_delivery_events")
      .withIndex("by_event_receipt", (q) =>
        q.eq("eventReceipt", args.eventReceipt)
      )
      .unique();
    if (prior) {
      if (
        prior.operationKey !== args.operationKey ||
        prior.resourceOperationKey !== args.resourceOperationKey ||
        prior.generation !== args.generation ||
        prior.sequenceStep !== args.sequenceStep ||
        prior.purpose !== args.purpose ||
        prior.eventType !== args.eventType ||
        prior.occurredAt !== args.occurredAt ||
        prior.providerMessageIdDigest !== args.providerMessageIdDigest ||
        prior.rfcMessageIdDigest !== args.rfcMessageIdDigest ||
        prior.threadReceipt !== args.threadReceipt ||
        prior.adapterVersion !== args.adapterVersion
      ) throw new Error("Managed SES event receipt was rebound");
      return { recorded: false as const, replay: true as const };
    }
    const [canary, message] = await Promise.all([
      ctx.db
        .query("managed_ses_event_canaries")
        .withIndex("by_operation", (q) =>
          q.eq("operationKey", args.operationKey)
        )
        .unique(),
      ctx.db
        .query("outreach_messages")
        .withIndex("by_managed_ses_operation", (q) =>
          q.eq("managedSesOperationKey", args.operationKey)
        )
        .unique(),
    ]);
    if (canary && message) {
      throw new Error("Managed SES event operation is missing or ambiguous");
    }
    if (!canary && !message) {
      const sendTombstone = await ctx.db
        .query("managed_ses_send_tombstones")
        .withIndex("by_operation", (q) =>
          q.eq("operationKey", args.operationKey)
        )
        .unique();
      if (
        !sendTombstone ||
        sendTombstone.expiresAt <= timestamp ||
        sendTombstone.releaseState !== "released" ||
        sendTombstone.resourceOperationKey !== args.resourceOperationKey ||
        sendTombstone.generation !== args.generation ||
        sendTombstone.adapterVersion !== args.adapterVersion ||
        sendTombstone.sequenceStep !== args.sequenceStep ||
        sendTombstone.purpose !== args.purpose ||
        (sendTombstone.providerMessageIdDigest !== undefined &&
          sendTombstone.providerMessageIdDigest !==
            args.providerMessageIdDigest) ||
        (sendTombstone.rfcMessageIdDigest !== undefined &&
          sendTombstone.rfcMessageIdDigest !== args.rfcMessageIdDigest) ||
        (sendTombstone.threadReceipt !== undefined &&
          sendTombstone.threadReceipt !== args.threadReceipt)
      ) {
        throw new Error("Managed SES event operation is missing or ambiguous");
      }
      const tombstoneEventBindingHash = sha256Hex(JSON.stringify({
        version: 1,
        operationKey: args.operationKey,
        resourceOperationKey: args.resourceOperationKey,
        generation: args.generation,
        adapterVersion: args.adapterVersion,
        sequenceStep: args.sequenceStep,
        purpose: args.purpose,
        eventType: args.eventType,
        occurredAt: args.occurredAt,
        providerMessageIdDigest: args.providerMessageIdDigest,
        rfcMessageIdDigest: args.rfcMessageIdDigest,
        threadReceipt: args.threadReceipt,
        eventReceipt: args.eventReceipt,
      }));
      if (sendTombstone.terminalEventReceipt === args.eventReceipt) {
        if (
          sendTombstone.terminalEventBindingHash !==
            tombstoneEventBindingHash
        ) throw new Error("Managed SES tombstone event was rebound");
        return { recorded: false as const, replay: true as const };
      }
      await ctx.db.patch(sendTombstone._id, {
        providerMessageIdDigest: args.providerMessageIdDigest,
        rfcMessageIdDigest: args.rfcMessageIdDigest,
        threadReceipt: args.threadReceipt,
        terminalEventType: args.eventType,
        terminalEventOccurredAt: args.occurredAt,
        terminalEventReceipt: args.eventReceipt,
        terminalEventBindingHash: tombstoneEventBindingHash,
        updatedAt: timestamp,
      });
      // deletion_fenced_tombstone_only: the exact adapter/resource release is
      // sealed and all site/message rows are already gone. A late signed retry
      // is acknowledged without recreating any site-scoped data.
      return {
        recorded: true as const,
        tombstoneOnly: true as const,
        reason: "deletion_fenced_tombstone_only" as const,
      };
    }
    if (canary) {
      const [
        inbox,
        resource,
        request,
        canarySite,
        canaryReleaseTombstone,
      ] = await Promise.all([
        ctx.db.get(canary.inboxId),
        ctx.db.get(canary.resourceId),
        ctx.db.get(canary.resourceId).then((row) =>
          row ? ctx.db.get(row.requestId) : null
        ),
        ctx.db.get(canary.siteId),
        ctx.db
          .query("managed_outreach_mailbox_release_tombstones")
          .withIndex("by_operation", (q) =>
            q.eq("operationKey", canary.resourceOperationKey)
          )
          .unique(),
      ]);
      const liveCanaryBinding = Boolean(
        inbox &&
        resource &&
        canary.resourceOperationKey === resource.operationKey &&
        canary.generation === resource.generation &&
        canary.inboxConfigurationVersion ===
          (inbox.configurationVersion ?? 0) &&
        resource.canonicalInboxId === inbox._id &&
        resource.releaseState === "active" &&
        inbox.credentialSource === "managed_adapter" &&
        inbox.managedTransportKind === MANAGED_SES_TRANSPORT &&
        inbox.managedTransportOperationKey === resource.operationKey &&
        inbox.managedTransportGeneration === resource.generation &&
        inbox.managedTransportAdapterVersion === args.adapterVersion,
      );
      const releasedCanaryBinding = Boolean(
        canaryReleaseTombstone &&
        ["release_requested", "blocked", "released"].includes(
          canaryReleaseTombstone.state,
        ) &&
        canaryReleaseTombstone.generation === canary.generation &&
        canaryReleaseTombstone.adapterVersion === canary.adapterVersion,
      );
      if (
        canary.adapterVersion !== args.adapterVersion ||
        args.resourceOperationKey !== canary.resourceOperationKey ||
        args.generation !== canary.generation ||
        args.sequenceStep !== 0 ||
        args.purpose !== "inbound_relay_canary" ||
        (!liveCanaryBinding && !releasedCanaryBinding) ||
        !canary.externalAttemptedAt ||
        args.occurredAt < canary.externalAttemptedAt - 5 * 60 * 1000 ||
        canary.expiresAt < args.occurredAt
      ) throw new Error("Managed SES canary event crossed a binding");
      if (!managedSesIdentityTupleMatchesEstablished({
        establishedProviderMessageIdDigest:
          canary.providerMessageIdDigest,
        establishedRfcMessageIdDigest: canary.rfcMessageIdDigest,
        establishedThreadReceipt: canary.threadReceipt,
        providerMessageIdDigest: args.providerMessageIdDigest,
        rfcMessageIdDigest: args.rfcMessageIdDigest,
        threadReceipt: args.threadReceipt,
      })) {
        await quarantineManagedSesEventCanaryIdentityMismatch(
          ctx,
          canary,
          timestamp,
        );
        return {
          recorded: false as const,
          terminal: true as const,
          identityMismatch: true as const,
        };
      }
      if (canary.eventReceipt === args.eventReceipt) {
        if (
          canary.eventType !== args.eventType ||
          canary.providerMessageIdDigest !== args.providerMessageIdDigest ||
          canary.rfcMessageIdDigest !== args.rfcMessageIdDigest ||
          canary.threadReceipt !== args.threadReceipt
        ) throw new Error("Managed SES canary event receipt was rebound");
        return { recorded: false as const, replay: true as const };
      }
      if (
        !liveCanaryBinding ||
        !canarySite ||
        canarySite.deletionStatus ||
        canarySite.accountDeletionRequestedAt
      ) {
        await ctx.db.patch(canary._id, {
          status: "failed",
          eventReceipt: args.eventReceipt,
          eventType: args.eventType,
          providerMessageIdDigest: args.providerMessageIdDigest,
          rfcMessageIdDigest: args.rfcMessageIdDigest,
          threadReceipt: args.threadReceipt,
          inboundCanaryActivationState: "failed",
          inboundCanaryActivationLeaseToken: undefined,
          inboundCanaryActivationLeaseExpiresAt: undefined,
          dispositionState: "event_confirmed",
          dispositionLeaseToken: undefined,
          dispositionLeaseExpiresAt: undefined,
          dispositionSettledAt: timestamp,
          updatedAt: timestamp,
        });
        if (canaryReleaseTombstone?.state === "released") {
          await materializeManagedSesCanaryTombstoneForDeletion(ctx, {
            ...canary,
            status: "failed",
            eventReceipt: args.eventReceipt,
            eventType: args.eventType,
            providerMessageIdDigest: args.providerMessageIdDigest,
            rfcMessageIdDigest: args.rfcMessageIdDigest,
            threadReceipt: args.threadReceipt,
          });
          const transportTombstone = await ctx.db
            .query("managed_ses_send_tombstones")
            .withIndex("by_operation", (q) =>
              q.eq("operationKey", canary.operationKey)
            )
            .unique();
          if (transportTombstone) {
            const bindingHash = sha256Hex(JSON.stringify({
              version: 1,
              operationKey: args.operationKey,
              resourceOperationKey: args.resourceOperationKey,
              generation: args.generation,
              adapterVersion: args.adapterVersion,
              sequenceStep: args.sequenceStep,
              purpose: args.purpose,
              eventType: args.eventType,
              occurredAt: args.occurredAt,
              providerMessageIdDigest: args.providerMessageIdDigest,
              rfcMessageIdDigest: args.rfcMessageIdDigest,
              threadReceipt: args.threadReceipt,
              eventReceipt: args.eventReceipt,
            }));
            await ctx.db.patch(transportTombstone._id, {
              terminalEventType: args.eventType,
              terminalEventOccurredAt: args.occurredAt,
              terminalEventReceipt: args.eventReceipt,
              terminalEventBindingHash: bindingHash,
              updatedAt: timestamp,
            });
          }
        }
        // deletion_fenced_tombstone_only: do not recreate a site-scoped
        // managed_ses_delivery_events row while account/site deletion drains.
        return {
          recorded: true as const,
          canary: true as const,
          tombstoneOnly: true as const,
          reason: "deletion_fenced_tombstone_only" as const,
        };
      }
      if (!inbox || !resource) {
        throw new Error("Managed SES live canary binding disappeared");
      }
      const adverseCanaryEvent = [
        "bounced",
        "complaint",
        "rejected",
        "rendering_failed",
      ].includes(args.eventType);
      const canaryAlreadyTerminal = canary.status === "failed";
      if (adverseCanaryEvent) {
        await ctx.db.patch(canary._id, {
          status: "failed",
          providerMessageIdDigest: args.providerMessageIdDigest,
          rfcMessageIdDigest: args.rfcMessageIdDigest,
          threadReceipt: args.threadReceipt,
          eventReceipt: args.eventReceipt,
          eventType: args.eventType,
          verifiedAt: undefined,
          inboundCanaryActivationState: "failed",
          inboundCanaryActivationLeaseToken: undefined,
          inboundCanaryActivationLeaseExpiresAt: undefined,
          inboundCanaryReceipt: undefined,
          inboundCanaryVerifiedAt: undefined,
          dispositionState: "event_confirmed",
          dispositionLeaseToken: undefined,
          dispositionLeaseExpiresAt: undefined,
          dispositionSettledAt: timestamp,
          updatedAt: timestamp,
        });
        const ownsOutboundProof =
          inbox.managedTransportEventCanaryOperationKey ===
            canary.operationKey;
        const ownsInboundProof =
          inbox.managedTransportInboundCanaryOperationKey ===
            canary.operationKey;
        if (ownsOutboundProof || ownsInboundProof) {
          await ctx.db.patch(inbox._id, {
            ...(ownsOutboundProof
              ? {
                  managedTransportEventCanaryVerifiedAt: undefined,
                  managedTransportEventCanaryReceipt: undefined,
                  managedTransportEventCanaryOperationKey: undefined,
                  managedTransportEventProviderMessageIdDigest: undefined,
                }
              : {}),
            ...(ownsInboundProof
              ? {
                  managedTransportInboundCanaryVerifiedAt: undefined,
                  managedTransportInboundCanaryReceipt: undefined,
                  managedTransportInboundCanaryOperationKey: undefined,
                  managedTransportInboundCanaryInboxBinding: undefined,
                  managedTransportInboundCanaryRelayConfigurationHash:
                    undefined,
                  managedTransportInboundCanaryAdapterVersion: undefined,
                  managedTransportInboundCanaryRetentionPolicyHash:
                    undefined,
                }
              : {}),
            lastError:
              "The current managed sender canary received a terminal adverse event; outreach is quarantined until a new exact canary succeeds.",
            updatedAt: timestamp,
          });
        }
        if (request) {
          await ctx.scheduler.runAfter(
            0,
            internal.managedProvisioning.dispatchRequest,
            { requestId: request._id, expectedRevision: request.revision },
          );
        }
      } else if (args.eventType === "delivered" && !canaryAlreadyTerminal) {
        await ctx.db.patch(canary._id, {
          status: "delivered",
          providerMessageIdDigest: args.providerMessageIdDigest,
          rfcMessageIdDigest: args.rfcMessageIdDigest,
          threadReceipt: args.threadReceipt,
          eventReceipt: args.eventReceipt,
          eventType: args.eventType,
          verifiedAt: args.occurredAt,
          updatedAt: timestamp,
        });
        await ctx.db.patch(inbox._id, {
          managedTransportEventCanaryVerifiedAt: args.occurredAt,
          managedTransportEventCanaryReceipt: args.eventReceipt,
          managedTransportEventCanaryOperationKey: args.operationKey,
          managedTransportEventProviderMessageIdDigest:
            args.providerMessageIdDigest,
          lastError: undefined,
          updatedAt: timestamp,
        });
        if (request) {
          await ctx.scheduler.runAfter(
            0,
            internal.managedProvisioning.dispatchRequest,
            { requestId: request._id, expectedRevision: request.revision },
          );
        }
        if (canary.inboundCanarySettledAt) {
          await ctx.scheduler.runAfter(
            0,
            internal.actions.managedOutreachMailbox
              .activateManagedSesInboundCanary,
            { canaryId: canary._id },
          );
        }
      }
      await ctx.db.insert("managed_ses_delivery_events", {
        siteId: canary.siteId,
        inboxId: canary.inboxId,
        canaryId: canary._id,
        operationKey: args.operationKey,
        resourceOperationKey: args.resourceOperationKey,
        generation: args.generation,
        adapterVersion: args.adapterVersion,
        sequenceStep: args.sequenceStep,
        purpose: args.purpose,
        eventType: args.eventType,
        occurredAt: args.occurredAt,
        providerMessageIdDigest: args.providerMessageIdDigest,
        rfcMessageIdDigest: args.rfcMessageIdDigest,
        threadReceipt: args.threadReceipt,
        eventReceipt: args.eventReceipt,
        recordedAt: timestamp,
      });
      return { recorded: true as const, canary: true as const };
    }

    const [inbox, eventSite, releaseTombstone] = await Promise.all([
      message!.inboxId ? ctx.db.get(message!.inboxId) : null,
      ctx.db.get(message!.siteId),
      ctx.db
        .query("managed_outreach_mailbox_release_tombstones")
        .withIndex("by_operation", (q) =>
          q.eq("operationKey", args.resourceOperationKey)
        )
        .unique(),
    ]);
    const liveInboxBinding = Boolean(
      inbox &&
      inbox.provider === MANAGED_SES_TRANSPORT &&
      message!.managedSesResourceOperationKey ===
        inbox.managedTransportOperationKey &&
      message!.managedSesGeneration === inbox.managedTransportGeneration &&
      inbox.managedTransportAdapterVersion === args.adapterVersion,
    );
    const releaseTombstoneBinding = Boolean(
      releaseTombstone &&
      ["release_requested", "blocked", "released"].includes(
        releaseTombstone.state,
      ) &&
      releaseTombstone.ownerAccountKey ===
        message!.deliveryOwnerAccountKey &&
      releaseTombstone.generation === args.generation &&
      releaseTombstone.adapterVersion === args.adapterVersion,
    );
    if (
      message!.deliveryTransport !== MANAGED_SES_TRANSPORT ||
      args.resourceOperationKey !==
        message!.managedSesResourceOperationKey ||
      args.generation !== message!.managedSesGeneration ||
      args.sequenceStep !== message!.sequenceStep ||
      args.purpose !== "outreach" ||
      message!.managedSesAdapterVersion !== args.adapterVersion ||
      (!liveInboxBinding && !releaseTombstoneBinding) ||
      !message!.managedSesExternalAttemptedAt ||
      args.occurredAt <
        message!.managedSesExternalAttemptedAt - 5 * 60 * 1000 ||
      ![
        "sending",
        "delivery_unverified",
        "sent",
        "failed",
        "replied",
        "bounced",
      ].includes(message!.status)
    ) throw new Error("Managed SES delivery event crossed a binding");
    if (!managedSesIdentityTupleMatchesEstablished({
      establishedProviderMessageIdDigest:
        message!.managedSesProviderMessageIdDigest,
      establishedRfcMessageIdDigest:
        message!.inboundRelayOutboundMessageIdHash,
      establishedThreadReceipt: message!.managedSesThreadReceipt,
      providerMessageIdDigest: args.providerMessageIdDigest,
      rfcMessageIdDigest: args.rfcMessageIdDigest,
      threadReceipt: args.threadReceipt,
    })) {
      await quarantineManagedSesMessageIdentityMismatch(
        ctx,
        message!,
        timestamp,
      );
      return {
        recorded: false as const,
        terminal: true as const,
        identityMismatch: true as const,
      };
    }
    const lateEventBindingHash = sha256Hex(JSON.stringify({
      version: 1,
      operationKey: args.operationKey,
      resourceOperationKey: args.resourceOperationKey,
      generation: args.generation,
      adapterVersion: args.adapterVersion,
      sequenceStep: args.sequenceStep,
      purpose: args.purpose,
      eventType: args.eventType,
      occurredAt: args.occurredAt,
      providerMessageIdDigest: args.providerMessageIdDigest,
      rfcMessageIdDigest: args.rfcMessageIdDigest,
      threadReceipt: args.threadReceipt,
      eventReceipt: args.eventReceipt,
    }));
    if (message!.managedSesLateEventReceipt === args.eventReceipt) {
      if (message!.managedSesLateEventBindingHash !== lateEventBindingHash) {
        throw new Error("Managed SES late event receipt was rebound");
      }
      return { recorded: false as const, replay: true as const };
    }
    const latestEvent = await ctx.db
      .query("managed_ses_delivery_events")
      .withIndex("by_operation_occurred", (q) =>
        q.eq("operationKey", args.operationKey)
      )
      .order("desc")
      .first();
    const staleEvent = Boolean(
      latestEvent && args.occurredAt < latestEvent.occurredAt,
    );
    const settlementAccountKey = immutableDeliveryOwnerAccountKey(
      message!,
      inbox,
    );
    const ownsCurrentSite = Boolean(
      settlementAccountKey &&
      eventSite?.userId &&
      !eventSite.deletionStatus &&
      !eventSite.accountDeletionRequestedAt &&
      inbox &&
      settlementAccountKey === accountDeletionKey(eventSite.userId) &&
      inbox.credentialOwnerAccountKey === settlementAccountKey,
    );
    const deletionFencedTombstoneOnly = Boolean(
      !eventSite ||
      eventSite.deletionStatus ||
      eventSite.accountDeletionRequestedAt ||
      !inbox,
    );

    const acceptedEvent = ["sent", "delivered", "bounced", "complaint"]
      .includes(args.eventType);
    let acceptedSettlement:
      | { accountKey?: string; ownsCurrentSite: boolean }
      | undefined;
    if (acceptedEvent && !message!.sentAt) {
      if (deletionFencedTombstoneOnly) {
        if (settlementAccountKey) {
          await recordDurableContactReceiptForAccount(
            ctx,
            settlementAccountKey,
            message!.toDomain,
            args.occurredAt,
            message!.deliveryAttemptId,
          );
        }
        acceptedSettlement = { ownsCurrentSite: false };
      } else {
        acceptedSettlement = await settleAcceptedDeliveryCounter(
          ctx,
          message!,
          message!.siteId,
          args.occurredAt,
        );
      }
    }
    if (["bounced", "complaint"].includes(args.eventType)) {
      const reason = args.eventType === "complaint" ? "complaint" : "bounce";
      if (settlementAccountKey) {
        await materializeOutreachSuppressionTombstoneForAccount(
          ctx,
          settlementAccountKey,
          "email",
          message!.toEmail,
          reason,
          args.occurredAt,
        );
        if (args.eventType === "complaint") {
          await materializeOutreachSuppressionTombstoneForAccount(
            ctx,
            settlementAccountKey,
            "domain",
            message!.toDomain,
            reason,
            args.occurredAt,
          );
        }
      }
      if (ownsCurrentSite) {
        await addSuppression(
          ctx,
          message!.siteId,
          "email",
          message!.toEmail,
          reason,
        );
        if (args.eventType === "complaint") {
          await addSuppression(
            ctx,
            message!.siteId,
            "domain",
            message!.toDomain,
            reason,
          );
        }
        await cancelQueuedThread(
          ctx,
          message!.siteId,
          message!.threadKey,
          message!._id,
          "bounce",
        );
      }
      await ctx.db.patch(message!._id, {
        status: "bounced",
        sentAt: message!.sentAt ?? args.occurredAt,
        bouncedAt: args.occurredAt,
        managedSesProviderMessageIdDigest: args.providerMessageIdDigest,
        managedSesThreadReceipt: args.threadReceipt,
        inboundRelayOutboundMessageIdHash: args.rfcMessageIdDigest,
        failureReason: args.eventType === "complaint"
          ? "The managed sender received a signed complaint event."
          : "The managed sender received a signed bounce event.",
        managedSesDispositionState: "event_confirmed",
        managedSesDispositionLeaseToken: undefined,
        managedSesDispositionLeaseExpiresAt: undefined,
        managedSesDispositionSettledAt: timestamp,
        updatedAt: timestamp,
      });
    } else if (
      ["sent", "delivered"].includes(args.eventType) &&
      !staleEvent
    ) {
      await ctx.db.patch(message!._id, {
        status: ["replied", "bounced"].includes(message!.status)
          ? message!.status
          : "sent",
        sentAt: message!.sentAt ?? args.occurredAt,
        managedSesProviderMessageIdDigest: args.providerMessageIdDigest,
        managedSesThreadReceipt: args.threadReceipt,
        inboundRelayOutboundMessageIdHash: args.rfcMessageIdDigest,
        failureReason: undefined,
        managedSesDispositionState: "event_confirmed",
        managedSesDispositionLeaseToken: undefined,
        managedSesDispositionLeaseExpiresAt: undefined,
        managedSesDispositionSettledAt: timestamp,
        updatedAt: timestamp,
      });
    } else if (
      ["rejected", "rendering_failed"].includes(args.eventType) &&
      !staleEvent &&
      !message!.sentAt &&
      ["sending", "delivery_unverified", "failed"].includes(message!.status)
    ) {
      await ctx.db.patch(message!._id, {
        status: "failed",
        managedSesProviderMessageIdDigest: args.providerMessageIdDigest,
        managedSesThreadReceipt: args.threadReceipt,
        inboundRelayOutboundMessageIdHash: args.rfcMessageIdDigest,
        failureReason: "The managed sender reported a terminal delivery failure.",
        managedSesDispositionState: "event_confirmed",
        managedSesDispositionLeaseToken: undefined,
        managedSesDispositionLeaseExpiresAt: undefined,
        managedSesDispositionSettledAt: timestamp,
        updatedAt: timestamp,
      });
      if (
        message!.deliveryOwnerAccountKey &&
        message!.deliveryAttemptId
      ) {
        await releaseDurableContactClaimForAccount(
          ctx,
          message!.deliveryOwnerAccountKey,
          message!.toDomain,
          message!.deliveryAttemptId,
          timestamp,
        );
      }
    }
    if (acceptedSettlement?.ownsCurrentSite) {
      const [opportunity, contact] = await Promise.all([
        ctx.db.get(message!.opportunityId),
        ctx.db
          .query("outreach_contacts")
          .withIndex("by_site_email", (q) =>
            q.eq("siteId", message!.siteId).eq("email", message!.toEmail)
          )
          .unique(),
      ]);
      const lifecycle = outreachDeliverySettlementDecision({
        sequenceStep: message!.sequenceStep,
        messageSiteId: String(message!.siteId),
        opportunitySiteId: opportunity
          ? String(opportunity.siteId)
          : undefined,
        messageEvidenceHash: message!.opportunityEvidenceHash,
        opportunityEvidenceHash: opportunity?.evidenceHash,
        messageSourceUrl: message!.opportunitySourceUrl,
        opportunitySourceUrl: opportunity?.sourceUrl,
        messageTargetUrl: message!.opportunityTargetUrl,
        opportunityTargetUrl: opportunity?.targetUrl,
        opportunityStatus:
          opportunity?.siteId === message!.siteId
            ? opportunity.status
            : undefined,
      });
      if (
        opportunity &&
        opportunity.siteId === message!.siteId &&
        lifecycle.shouldMarkContacted
      ) {
        await ctx.db.patch(opportunity._id, {
          status: "contacted",
          contactedAt: args.occurredAt,
          updatedAt: timestamp,
        });
      }
      if (contact) {
        await ctx.db.patch(contact._id, {
          lastContactedAt: args.occurredAt,
          updatedAt: timestamp,
        });
      }
    }
    let followUpQueued = false;
    if (
      acceptedSettlement?.ownsCurrentSite &&
      ["sent", "delivered"].includes(args.eventType)
    ) {
      const next = await queueNextVerifiedAutonomousFollowUp(ctx, {
        siteId: message!.siteId,
        parentMessageId: message!._id,
        transport: MANAGED_SES_TRANSPORT,
        providerThreadId: undefined,
        outboundRfcMessageId: undefined,
        managedSesOperationKey: message!.managedSesOperationKey,
        managedSesThreadReceipt: args.threadReceipt,
        rfcMessageIdDigest: args.rfcMessageIdDigest,
        sentAt: message!.sentAt ?? args.occurredAt,
      });
      followUpQueued = next.queued;
    }
    if (deletionFencedTombstoneOnly) {
      await ctx.db.patch(message!._id, {
        managedSesLateEventReceipt: args.eventReceipt,
        managedSesLateEventBindingHash: lateEventBindingHash,
        managedSesLateEventRecordedAt: timestamp,
        updatedAt: timestamp,
      });
      // deletion_fenced_tombstone_only: never insert a new
      // managed_ses_delivery_events row after the deletion sweep.
      return {
        recorded: true as const,
        canary: false as const,
        tombstoneOnly: true as const,
        reason: "deletion_fenced_tombstone_only" as const,
        followUpQueued: false as const,
      };
    }
    await ctx.db.insert("managed_ses_delivery_events", {
      siteId: message!.siteId,
      inboxId: inbox!._id,
      messageId: message!._id,
      operationKey: args.operationKey,
      resourceOperationKey: args.resourceOperationKey,
      generation: args.generation,
      adapterVersion: args.adapterVersion,
      sequenceStep: args.sequenceStep,
      purpose: args.purpose,
      eventType: args.eventType,
      occurredAt: args.occurredAt,
      providerMessageIdDigest: args.providerMessageIdDigest,
      rfcMessageIdDigest: args.rfcMessageIdDigest,
      threadReceipt: args.threadReceipt,
      eventReceipt: args.eventReceipt,
      recordedAt: timestamp,
    });
    return {
      recorded: true as const,
      canary: false as const,
      followUpQueued,
    };
  },
});

export const recordManagedSesUnsubscribe = internalMutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) {
      return { recorded: false as const };
    }
    const message = await ctx.db
      .query("outreach_messages")
      .withIndex("by_managed_ses_unsubscribe", (q) =>
        q.eq("managedSesUnsubscribeTokenHash", tokenHash)
      )
      .unique();
    if (
      !message ||
      message.deliveryTransport !== MANAGED_SES_TRANSPORT ||
      !message.deliveryOwnerAccountKey ||
      !message.managedSesExternalAttemptedAt
    ) return { recorded: false as const };
    if (message.inboundReceiptKind === "unsubscribe") {
      return { recorded: false as const, replay: true as const };
    }
    const timestamp = Date.now();
    if (!message.sentAt) {
      await settleAcceptedDeliveryCounter(
        ctx,
        message,
        message.siteId,
        message.deliveryClaimedAt ?? timestamp,
      );
    }
    const site = await ctx.db.get(message.siteId);
    const ownsCurrentSite = Boolean(
      site?.userId &&
      accountDeletionKey(site.userId) === message.deliveryOwnerAccountKey,
    );
    await Promise.all([
      materializeOutreachSuppressionTombstoneForAccount(
        ctx,
        message.deliveryOwnerAccountKey,
        "email",
        message.toEmail,
        "unsubscribe",
        timestamp,
      ),
      materializeOutreachSuppressionTombstoneForAccount(
        ctx,
        message.deliveryOwnerAccountKey,
        "domain",
        message.toDomain,
        "unsubscribe",
        timestamp,
      ),
    ]);
    if (ownsCurrentSite) {
      await addSuppression(
        ctx,
        message.siteId,
        "email",
        message.toEmail,
        "unsubscribe",
      );
      await addSuppression(
        ctx,
        message.siteId,
        "domain",
        message.toDomain,
        "unsubscribe",
      );
      await cancelQueuedThread(
        ctx,
        message.siteId,
        message.threadKey,
        message._id,
        "unsubscribe",
      );
    }
    await ctx.db.patch(message._id, {
      status: message.status === "bounced" ? "bounced" : "replied",
      sentAt: message.sentAt ?? message.deliveryClaimedAt ?? timestamp,
      repliedAt: message.repliedAt ?? timestamp,
      inboundCheckedAt: timestamp,
      inboundReceiptKind: "unsubscribe",
      inboundReceiptHash: tokenHash,
      inboundReceiptAt: timestamp,
      updatedAt: timestamp,
    });
    return { recorded: true as const };
  },
});

export const setInboxComplianceProfile = mutation({
  args: {
    siteId: v.id("sites"),
    fromName: v.string(),
    physicalMailingAddress: v.string(),
  },
  handler: async (ctx, { siteId, fromName, physicalMailingAddress }) => {
    const site = await requireSiteOwner(ctx, siteId);
    await assertNoActiveDelivery(ctx, siteId);
    const inbox = await inboxForSite(ctx, siteId);
    if (!inbox) throw new Error("Connect the secondary-domain Gmail inbox first");
    if (inbox.provider === MANAGED_SES_TRANSPORT) {
      throw new Error(
        "Update a managed sender through One Setup so its generation is released and reverified",
      );
    }
    if (
      !site.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      throw new Error(
        "The Gmail credential belongs to a previous site owner; reconnect it before editing the sender profile",
      );
    }
    const safeName = fromName.replace(/[\r\n<>]/g, " ").replace(/\s+/g, " ").trim();
    const safeAddress = physicalMailingAddress
      .replace(/[\r\n]+/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
    if (safeName.length < 2 || safeName.length > 100) {
      throw new Error("Enter the real person or business name that will send outreach");
    }
    if (safeAddress.length < 15 || safeAddress.length > 300) {
      throw new Error("Enter a complete physical mailing address for the email footer");
    }
    const dnsReady = Boolean(
      inbox.spfVerifiedAt && inbox.dkimVerifiedAt && inbox.dmarcVerifiedAt,
    );
    const now = Date.now();
    await ctx.db.patch(inbox._id, {
      fromName: safeName,
      physicalMailingAddress: safeAddress,
      complianceConfirmedAt: now,
      configurationVersion: (inbox.configurationVersion ?? 0) + 1,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      verifiedAt: dnsReady ? now : undefined,
      status: dnsReady ? "warming" : "connected",
      mode: "approval",
      autonomyDisabledAt: now,
      autonomyReconciliationStatus: "paused",
      autonomyReconciliationCursor: undefined,
      lastError: dnsReady
        ? undefined
        : "SPF, DKIM and DMARC must all verify before outreach can send.",
      updatedAt: now,
    });
    const cancellationScheduled = await scheduleAutonomousSequenceCancellation(
      ctx,
      inbox,
      "The sender identity or compliance profile changed before this message became due.",
    );
    return {
      ready: dnsReady,
      status: dnsReady ? "warming" : "connected",
      cancellationScheduled,
    };
  },
});

/** Rotate only this tenant's Workspace DSN intake capability. The address is
 * derived for the authenticated owner and is never stored; its non-secret
 * generation is durable so routine reconnects and plan parking stay stable. */
export const rotateInboundRelayDsnRoutingTarget = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    if (!(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("This site's outreach configuration is currently parked");
    }
    await assertNoActiveDelivery(ctx, siteId);
    const inbox = await inboxForSite(ctx, siteId);
    if (
      !inbox ||
      !site.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId) ||
      inbox.provider !== "gmail" ||
      ["disconnected", "suspended"].includes(inbox.status) ||
      !(inbox.oauthRefreshToken || inbox.oauthAccessToken)
    ) {
      throw new Error("Connect the Gmail outreach inbox before rotating its route");
    }
    const runtimeConfig = inboundRelayRuntimeConfig();
    const generation =
      (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) + 1;
    const target = await inboundRelayDsnRoutingTarget({
      siteId: String(siteId),
      inboxId: String(inbox._id),
      generation,
      relayDomain: runtimeConfig.domain,
      secret: runtimeConfig.dsnTargetSecret,
    });
    if (!target) {
      throw new Error("The per-inbox DSN routing target is unavailable");
    }
    const rotatedAt = Date.now();
    await ctx.db.patch(inbox._id, {
      inboundRelayDsnRoutingTargetGeneration: generation,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      mode: "approval",
      autonomyDisabledAt: rotatedAt,
      autonomyReconciliationStatus: "paused",
      autonomyReconciliationCursor: undefined,
      updatedAt: rotatedAt,
    });
    await scheduleAutonomousSequenceCancellation(
      ctx,
      inbox,
      "The signed reply, STOP, and bounce route changed before this message became due.",
    );
    return {
      rotated: true as const,
      routingAddress: target.address,
      canaryReady: false as const,
    };
  },
});

export const setInboxMode = mutation({
  args: { siteId: v.id("sites"), mode: v.string() },
  handler: async (ctx, { siteId, mode }) => {
    const site = await requireSiteOwner(ctx, siteId);
    if (mode !== "approval") {
      throw new Error("Automatic outreach delivery is disabled; use owner-approved one-message sends");
    }
    const inbox = await inboxForSite(ctx, siteId);
    if (!inbox) throw new Error("No outreach inbox is connected for this site");
    const ownerAccountKey = accountDeletionKey(site.userId!);
    if (inbox.credentialOwnerAccountKey !== ownerAccountKey) {
      throw new Error("The Gmail credential belongs to another account");
    }
    const inFlight = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_owner_lineage_status", (q) =>
        q
          .eq("siteId", siteId)
          .eq("ownerAccountKey", ownerAccountKey)
          .eq("ownerLineageUnresolvedAt", undefined)
          .eq("status", "sending"),
      )
      .first();
    const disabledAt = Date.now();
    await ctx.db.patch(inbox._id, {
      mode,
      autonomyDisabledAt: disabledAt,
      autonomyReconciliationStatus: "paused",
      autonomyReconciliationCursor: undefined,
      updatedAt: disabledAt,
    });
    const cancellationScheduled = await scheduleAutonomousSequenceCancellation(
      ctx,
      inbox,
      "Authority autopilot was disabled before this message became due.",
    );
    return {
      mode,
      inFlightMayComplete: Boolean(inFlight),
      cancellationScheduled,
    };
  },
});

/** Bounded receipt-fenced cancellation. Step zero returns to reviewable draft
 * state; follow-ups are terminal. The exact old consent tuple prevents a late
 * worker from touching work created after a new owner consent. */
export const cancelAutonomousSequenceInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    ownerAccountKey: v.string(),
    consentVersion: v.number(),
    consentPolicyHash: v.string(),
    consentAcceptedAt: v.number(),
    sequenceStep: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !/^[a-f0-9]{64}$/.test(args.ownerAccountKey) ||
      !Number.isSafeInteger(args.consentVersion) ||
      args.consentVersion < 1 ||
      !/^[a-f0-9]{64}$/.test(args.consentPolicyHash) ||
      !Number.isFinite(args.consentAcceptedAt) ||
      args.consentAcceptedAt <= 0 ||
      !Number.isSafeInteger(args.sequenceStep) ||
      args.sequenceStep < 0 ||
      args.sequenceStep > MAX_SEQUENCE_STEP
    ) {
      return { completed: false as const, reason: "invalid_receipt" as const };
    }
    const timestamp = Date.now();
    const rows = await ctx.db
      .query("outreach_messages")
      .withIndex(
        "by_site_owner_lineage_status_autonomy_consent_sequence_scheduled",
        (q) => q
          .eq("siteId", args.siteId)
          .eq("ownerAccountKey", args.ownerAccountKey)
          .eq("ownerLineageUnresolvedAt", undefined)
          .eq("status", "approved")
          .eq("approvalKind", "account_autopilot")
          .eq("approvalConsentVersion", args.consentVersion)
          .eq("approvalConsentPolicyHash", args.consentPolicyHash)
          .eq("approvalConsentAcceptedAt", args.consentAcceptedAt)
          .eq("sequenceStep", args.sequenceStep),
      )
      .take(50);
    const safeReason = args.reason
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300) || "The autonomous outreach authorization changed.";
    for (const message of rows) {
      if (args.sequenceStep === 0) {
        await ctx.db.patch(message._id, {
          status: "draft",
          approvedAt: undefined,
          approvedInboxId: undefined,
          approvedInboxConfigurationVersion: undefined,
          approvalKind: undefined,
          approvalConsentVersion: undefined,
          approvalConsentPolicyHash: undefined,
          approvalConsentAcceptedAt: undefined,
          scheduledAt: undefined,
          blockedReason: undefined,
          updatedAt: timestamp,
        });
      } else {
        await ctx.db.patch(message._id, {
          status: "skipped",
          blockedReason: safeReason,
          updatedAt: timestamp,
        });
      }
    }
    if (rows.length === 50) {
      await ctx.scheduler.runAfter(
        0,
        internal.outreach.cancelAutonomousSequenceInternal,
        args,
      );
      return {
        completed: false as const,
        sequenceStep: args.sequenceStep,
        processed: rows.length,
      };
    }
    if (args.sequenceStep < MAX_SEQUENCE_STEP) {
      await ctx.scheduler.runAfter(
        0,
        internal.outreach.cancelAutonomousSequenceInternal,
        { ...args, sequenceStep: args.sequenceStep + 1 },
      );
      return {
        completed: false as const,
        sequenceStep: args.sequenceStep,
        processed: rows.length,
      };
    }
    return {
      completed: true as const,
      sequenceStep: args.sequenceStep,
      processed: rows.length,
    };
  },
});

/**
 * One tenant-owner consent replaces per-message clicks, not any safety gate.
 * The receipt is bound to this exact Gmail/compliance configuration and the
 * signed inbound relay. Reconnects and profile edits therefore fail closed.
 */
export const enableAutonomousOutreach = mutation({
  args: {
    siteId: v.id("sites"),
    expectedInboxId: v.id("outreach_inboxes"),
    expectedInboxConfigurationVersion: v.number(),
    consentVersion: v.number(),
    consentPolicyHash: v.string(),
    dailySendCap: v.number(),
    confirmsAutomaticSending: v.boolean(),
    confirmsBusinessRecipientsAndLawfulBasis: v.boolean(),
    confirmsSenderIdentityAndAddress: v.boolean(),
    acceptsMailboxReputationRisk: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (!autonomousOutreachRuntimeEnabled(
      process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
    )) {
      throw new Error("Authority autopilot is not released in this environment");
    }
    const site = await requireSiteOwner(ctx, args.siteId);
    if (!isSeoGrowthActuationEligible(site)) {
      throw new Error("Pentra growth autopilot must be executing before outreach can run");
    }
    await assertNoActiveDelivery(ctx, args.siteId);
    if (
      args.consentVersion !== OUTREACH_AUTONOMY_CONSENT_VERSION ||
      args.consentPolicyHash !== OUTREACH_AUTONOMY_POLICY_HASH ||
      !args.confirmsAutomaticSending ||
      !args.confirmsBusinessRecipientsAndLawfulBasis ||
      !args.confirmsSenderIdentityAndAddress ||
      !args.acceptsMailboxReputationRisk
    ) {
      throw new Error("Accept every current authority-autopilot consent statement");
    }
    const dailySendCap = Math.floor(args.dailySendCap);
    if (
      !Number.isSafeInteger(dailySendCap) ||
      dailySendCap < 1 ||
      dailySendCap > OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP
    ) {
      throw new Error(
        `Authority autopilot is limited to 1-${OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP} messages per UTC day`,
      );
    }
    const inbox = await inboxForSite(ctx, args.siteId);
    if (!inbox) throw new Error("Connect the dedicated Gmail outreach inbox first");
    if (
      inbox._id !== args.expectedInboxId ||
      (inbox.configurationVersion ?? 0) !==
        args.expectedInboxConfigurationVersion
    ) {
      throw new Error(
        "The outreach inbox or sender profile changed. Review the current configuration before consenting.",
      );
    }
    if (
      !site.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      throw new Error(
        "The Gmail credential belongs to a previous site owner; reconnect it before enabling autonomy.",
      );
    }
    if (
      await outboundIdentityUsedByAnotherTenant(
        ctx,
        args.siteId,
        inbox.fromEmail,
        inbox.senderDomain ?? "",
        inbox.provider,
      )
    ) {
      throw new Error(
        "This outbound mailbox or sender domain is already connected to another tenant",
      );
    }
    const senderIssues = senderClaimIssues({
      siteDomain: site.domain,
      provider: inbox.provider,
      status: inbox.status,
      fromEmail: inbox.fromEmail,
      fromName: inbox.fromName,
      physicalMailingAddress: inbox.physicalMailingAddress,
      complianceConfirmedAt: inbox.complianceConfirmedAt,
      verifiedAt: inbox.verifiedAt,
      oauthScopes: inbox.oauthScopes,
      hasCredential: Boolean(inbox.oauthRefreshToken || inbox.oauthAccessToken),
      senderDomain: inbox.senderDomain,
    });
    if (senderIssues.length > 0) throw new Error(senderIssues[0]);
    const autonomousCredentialIssues = autonomousOutreachTransportIssues({
      inbox,
      now: Date.now(),
      managedSesAdapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
    });
    if (autonomousCredentialIssues.length > 0) {
      throw new Error(autonomousCredentialIssues[0]);
    }
    if (
      !inboundRelayConfigured(inboundRelayRuntimeConfig()) ||
      (inbox.provider === MANAGED_SES_TRANSPORT
        ? !managedSesInboxReceiptCurrent({
            inbox,
            now: Date.now(),
            expectedAdapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
          })
        : !inboundRelayDsnRoutingReady({
            inbox,
            now: Date.now(),
            rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
            runtimeConfig: inboundRelayRuntimeConfig(),
          }))
    ) {
      throw new Error(
        "The signed reply/bounce/STOP relay must pass its current routing canary first",
      );
    }

    const enabledAt = Date.now();
    const configurationVersion = inbox.configurationVersion ?? 0;
    const reusesCurrentConsentReceipt = Boolean(
      inbox.autonomyConsentVersion === OUTREACH_AUTONOMY_CONSENT_VERSION &&
        inbox.autonomyConsentPolicyHash === OUTREACH_AUTONOMY_POLICY_HASH &&
        Number.isFinite(inbox.autonomyConsentAcceptedAt) &&
        inbox.autonomyConsentAcceptedAt! > 0 &&
        inbox.autonomyConsentAcceptedBy === site.userId &&
        inbox.autonomyConsentInboxConfigurationVersion === configurationVersion &&
        (!inbox.autonomyDisabledAt ||
          inbox.autonomyDisabledAt < inbox.autonomyConsentAcceptedAt!),
    );
    const acceptedAt = reusesCurrentConsentReceipt
      ? inbox.autonomyConsentAcceptedAt!
      : enabledAt;
    const reconciliationGeneration =
      (inbox.autonomyReconciliationGeneration ?? 0) + 1;
    const migrationAccountKey = accountDeletionKey(site.userId!);
    const existingMigration = await ctx.db
      .query("outreach_durability_migrations")
      .withIndex("by_account", (q) => q.eq("accountKey", migrationAccountKey))
      .first();
    if (!existingMigration) {
      await ctx.db.insert("outreach_durability_migrations", {
        accountKey: migrationAccountKey,
        userId: site.userId!,
        version: OUTREACH_DURABILITY_MIGRATION_VERSION,
        status: "pending",
        createdAt: enabledAt,
        updatedAt: enabledAt,
      });
    } else if (
      existingMigration.version !== OUTREACH_DURABILITY_MIGRATION_VERSION
    ) {
      await ctx.db.patch(existingMigration._id, {
        userId: site.userId!,
        version: OUTREACH_DURABILITY_MIGRATION_VERSION,
        status: "pending",
        siteCursor: undefined,
        nextSiteCursor: undefined,
        sitesDoneAfterActive: undefined,
        activeSiteId: undefined,
        rowStage: undefined,
        rowCursor: undefined,
        completedAt: undefined,
        updatedAt: enabledAt,
      });
    }
    await ctx.db.patch(inbox._id, {
      mode: "live",
      dailySendCap,
      autonomyConsentVersion: OUTREACH_AUTONOMY_CONSENT_VERSION,
      autonomyConsentPolicyHash: OUTREACH_AUTONOMY_POLICY_HASH,
      autonomyConsentAcceptedAt: acceptedAt,
      autonomyConsentAcceptedBy: site.userId,
      autonomyConsentInboxConfigurationVersion: configurationVersion,
      autonomyLastEnabledAt: enabledAt,
      autonomyDisabledAt: undefined,
      autonomyReconciliationStatus: "pending",
      autonomyReconciliationStage: "approved",
      autonomyReconciliationCursor: undefined,
      autonomyReconciliationGeneration: reconciliationGeneration,
      updatedAt: enabledAt,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.outreach.migrateOutreachDurabilityInternal,
      {
        siteId: args.siteId,
        inboxId: inbox._id,
        generation: reconciliationGeneration,
      },
    );
    return {
      mode: "live" as const,
      dailySendCap,
      acceptedAt,
      enabledAt,
      authorizedDrafts: 0,
      reconciliationPending: true,
    };
  },
});

/** Bootstrap the account-wide legacy STOP/contact/pacing materialization for
 * every delivery mode. Manual approval is not allowed to bypass compliance
 * history that predates the durable ledgers on a sibling site. */
export const ensureOutreachDurabilityMigrationInternal = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const [site, inboxes] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("outreach_inboxes")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(2),
    ]);
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.userId ||
      inboxes.length !== 1 ||
      inboxes[0].credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      return { complete: false as const, reason: "tenant_unavailable" as const };
    }
    const inbox = inboxes[0];
    const timestamp = Date.now();
    const accountKey = accountDeletionKey(site.userId);
    const receipt = await ctx.db
      .query("outreach_durability_migrations")
      .withIndex("by_account", (q) => q.eq("accountKey", accountKey))
      .first();
    if (
      receipt?.version === OUTREACH_DURABILITY_MIGRATION_VERSION &&
      receipt.status === "complete"
    ) {
      return { complete: true as const };
    }
    let reconciliationGeneration =
      inbox.autonomyReconciliationGeneration ?? 0;
    const currentMigrationComplete = Boolean(
      receipt?.version === OUTREACH_DURABILITY_MIGRATION_VERSION &&
        receipt.userId === site.userId &&
        receipt.status === "complete",
    );
    if (
      inbox.mode === "live" &&
      !currentMigrationComplete &&
      inbox.autonomyReconciliationStatus === "complete"
    ) {
      // A newly bumped migration version must atomically close the old
      // reconciliation generation before its backfill begins. Otherwise the
      // narrow interval between migration completion and its scheduled sweep
      // could authorize an approval reconciled under the prior contract.
      reconciliationGeneration += 1;
      await ctx.db.patch(inbox._id, {
        autonomyReconciliationStatus: "pending",
        autonomyReconciliationStage: "approved",
        autonomyReconciliationCursor: undefined,
        autonomyReconciliationGeneration: reconciliationGeneration,
        updatedAt: timestamp,
      });
    }
    if (!receipt) {
      await ctx.db.insert("outreach_durability_migrations", {
        accountKey,
        userId: site.userId,
        version: OUTREACH_DURABILITY_MIGRATION_VERSION,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else if (
      receipt.version !== OUTREACH_DURABILITY_MIGRATION_VERSION ||
      receipt.userId !== site.userId
    ) {
      await ctx.db.patch(receipt._id, {
        userId: site.userId,
        version: OUTREACH_DURABILITY_MIGRATION_VERSION,
        status: "pending",
        siteCursor: undefined,
        nextSiteCursor: undefined,
        sitesDoneAfterActive: undefined,
        activeSiteId: undefined,
        rowStage: undefined,
        rowCursor: undefined,
        completedAt: undefined,
        updatedAt: timestamp,
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.outreach.migrateOutreachDurabilityInternal,
      {
        siteId,
        inboxId: inbox._id,
        generation: reconciliationGeneration,
      },
    );
    return { complete: false as const, reason: "migration_pending" as const };
  },
});

export const migrateOutreachDurabilityInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    generation: v.number(),
  },
  handler: async (ctx, args) => {
    const originSite = await ctx.db.get(args.siteId);
    if (!originSite?.userId) return { completed: false, stopped: "owner_missing" };
    const accountKey = accountDeletionKey(originSite.userId);
    const receipt = await ctx.db
      .query("outreach_durability_migrations")
      .withIndex("by_account", (q) => q.eq("accountKey", accountKey))
      .first();
    if (!receipt || receipt.version !== OUTREACH_DURABILITY_MIGRATION_VERSION) {
      return { completed: false, stopped: "receipt_missing" };
    }
    const scheduleSelf = async () => {
      await ctx.scheduler.runAfter(
        0,
        internal.outreach.migrateOutreachDurabilityInternal,
        args,
      );
    };
    const scheduleReconciliation = async () => {
      const inbox = await ctx.db.get(args.inboxId);
      if (
        inbox?.siteId === args.siteId &&
        inbox.mode === "live" &&
        inbox.autonomyReconciliationGeneration === args.generation
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.outreach.reconcileAutonomousInitialMessagesInternal,
          args,
        );
      }
    };
    if (receipt.status === "complete") {
      await scheduleReconciliation();
      return { completed: true, processed: 0 };
    }

    if (!receipt.activeSiteId) {
      const sitesPage = await ctx.db
        .query("sites")
        .withIndex("by_user", (q) => q.eq("userId", receipt.userId))
        .order("asc")
        .paginate({ cursor: receipt.siteCursor ?? null, numItems: 1 });
      const nextSite = sitesPage.page[0];
      if (!nextSite) {
        const timestamp = Date.now();
        await ctx.db.patch(receipt._id, {
          status: "complete",
          siteCursor: undefined,
          nextSiteCursor: undefined,
          activeSiteId: undefined,
          rowStage: undefined,
          rowCursor: undefined,
          completedAt: timestamp,
          updatedAt: timestamp,
        });
        await scheduleReconciliation();
        return { completed: true, processed: 0 };
      }
      await ctx.db.patch(receipt._id, {
        activeSiteId: nextSite._id,
        nextSiteCursor: sitesPage.isDone
          ? undefined
          : sitesPage.continueCursor,
        sitesDoneAfterActive: sitesPage.isDone,
        rowStage: "suppressions",
        rowCursor: undefined,
        updatedAt: Date.now(),
      });
      await scheduleSelf();
      return { completed: false, processed: 0 };
    }

    const migrationSite = await ctx.db.get(receipt.activeSiteId);
    if (!migrationSite || migrationSite.userId !== receipt.userId) {
      if (receipt.sitesDoneAfterActive) {
        const timestamp = Date.now();
        await ctx.db.patch(receipt._id, {
          status: "complete",
          activeSiteId: undefined,
          nextSiteCursor: undefined,
          sitesDoneAfterActive: undefined,
          rowStage: undefined,
          rowCursor: undefined,
          completedAt: timestamp,
          updatedAt: timestamp,
        });
        await scheduleReconciliation();
        return { completed: true, processed: 0 };
      }
      await ctx.db.patch(receipt._id, {
        siteCursor: receipt.nextSiteCursor,
        nextSiteCursor: undefined,
        sitesDoneAfterActive: undefined,
        activeSiteId: undefined,
        rowStage: undefined,
        rowCursor: undefined,
        updatedAt: Date.now(),
      });
      await scheduleSelf();
      return { completed: false, processed: 0 };
    }

    if ((receipt.rowStage ?? "suppressions") === "suppressions") {
      const [page, migrationInboxes] = await Promise.all([
        ctx.db
          .query("outreach_suppressions")
          .withIndex("by_site", (q) => q.eq("siteId", migrationSite._id))
          .paginate({ cursor: receipt.rowCursor ?? null, numItems: 50 }),
        ctx.db
          .query("outreach_inboxes")
          .withIndex("by_site", (q) => q.eq("siteId", migrationSite._id))
          .take(2),
      ]);
      const suppressionOwnerAccountKey = migrationInboxes.length === 1
        && migrationInboxes[0].credentialOwnerAccountKey === accountKey
        ? accountKey
        : undefined;
      for (const row of page.page) {
        if (row.kind === "domain" || row.kind === "email") {
          const rowOwnerAccountKey =
            row.ownerAccountKey ?? (
              row.ownerLineageUnresolvedAt
                ? undefined
                : suppressionOwnerAccountKey
            );
          if (!rowOwnerAccountKey) {
            const currentIdentity = migrationSite.userId
              ? outreachSuppressionTombstoneIdentity({
                  userId: migrationSite.userId,
                  tenantDomain: migrationSite.domain,
                  kind: row.kind,
                  value: row.value,
                })
              : null;
            const alreadyDurable = currentIdentity
              ? await ctx.db
                  .query("outreach_sender_suppression_tombstones")
                  .withIndex("by_account_tenant_value", (q) =>
                    q
                      .eq("accountKey", currentIdentity.accountKey)
                      .eq("tenantDomainKey", currentIdentity.tenantDomainKey)
                      .eq("kind", row.kind)
                      .eq("valueKey", currentIdentity.valueKey)
                  )
                  .first()
              : null;
            if (alreadyDurable && currentIdentity) {
              // The exact account/tenant/kind/value tombstone is immutable
              // proof that this additive-rollout raw row belongs to the same
              // account. Bind it before progressing so a later owner cannot
              // adopt or list the old recipient value.
              await ctx.db.patch(row._id, {
                ownerAccountKey: currentIdentity.accountKey,
                ownerLineageUnresolvedAt: undefined,
              });
              continue;
            }
            return {
              completed: false,
              processed: 0,
              stopped: "legacy_suppression_owner_unresolved",
            };
          }
          if (!row.ownerAccountKey) {
            await ctx.db.patch(row._id, {
              ownerAccountKey: rowOwnerAccountKey,
            });
          }
          await materializeOutreachSuppressionTombstoneForAccount(
            ctx,
            rowOwnerAccountKey,
            row.kind,
            row.value,
            row.reason,
            row.createdAt,
          );
        }
      }
      await ctx.db.patch(receipt._id, {
        rowStage: page.isDone ? "contacts" : "suppressions",
        rowCursor: page.isDone ? undefined : page.continueCursor,
        updatedAt: Date.now(),
      });
      await scheduleSelf();
      return { completed: false, processed: page.page.length };
    }

    if (receipt.rowStage === "contacts") {
      const [page, migrationInboxes] = await Promise.all([
        ctx.db
          .query("outreach_contacts")
          .withIndex("by_site_email", (q) =>
            q.eq("siteId", migrationSite._id)
          )
          .paginate({ cursor: receipt.rowCursor ?? null, numItems: 50 }),
        ctx.db
          .query("outreach_inboxes")
          .withIndex("by_site", (q) => q.eq("siteId", migrationSite._id))
          .take(2),
      ]);
      const contactOwnerAccountKey = migrationInboxes.length === 1
        && migrationInboxes[0].credentialOwnerAccountKey === accountKey
        ? accountKey
        : undefined;
      for (const contact of page.page) {
        if (!contact.ownerAccountKey) {
          if (contactOwnerAccountKey && !contact.ownerLineageUnresolvedAt) {
            await ctx.db.patch(contact._id, {
              ownerAccountKey: contactOwnerAccountKey,
              updatedAt: Math.max(contact.updatedAt, Date.now()),
            });
          } else if (!contact.ownerLineageUnresolvedAt) {
            // A foreign/ownerless additive-rollout inbox cannot prove which
            // historical account discovered this raw recipient. Preserve the
            // row for operator review but make silent future adoption
            // impossible.
            await ctx.db.patch(contact._id, {
              ownerLineageUnresolvedAt: Date.now(),
              updatedAt: Math.max(contact.updatedAt, Date.now()),
            });
          }
        }
      }
      await ctx.db.patch(receipt._id, {
        rowStage: page.isDone ? "messages" : "contacts",
        rowCursor: page.isDone ? undefined : page.continueCursor,
        updatedAt: Date.now(),
      });
      await scheduleSelf();
      return { completed: false, processed: page.page.length };
    }

    const page = await ctx.db
      .query("outreach_messages")
      // This cursor is intentionally independent of every field the v3
      // migration scrubs or backfills. Mutating recipient/domain/owner indexes
      // while paginating them could skip or revisit legacy rows.
      .withIndex("by_site_created", (q) => q.eq("siteId", migrationSite._id))
      .paginate({ cursor: receipt.rowCursor ?? null, numItems: 50 });
    for (const message of page.page) {
      if (legacyUnownedPresendMessageMayBeQuarantined(message)) {
        const timestamp = Date.now();
        // This row predates immutable ownership and has no mailbox/provider
        // proof. Do not adopt its raw recipient data into the current account.
        // Scrub and terminalize it so a later exact-owner re-verification can
        // create one fresh draft without the hidden legacy row poisoning the
        // opportunity or recipient thread.
        await ctx.db.patch(message._id, {
          ownerLineageUnresolvedAt:
            message.ownerLineageUnresolvedAt ?? timestamp,
          toEmail: "redacted@invalid.local",
          toDomain: "invalid.local",
          subject: "",
          body: "",
          threadKey: `quarantined:${message._id}`,
          complianceIssues: undefined,
          blockedReason: undefined,
          pacingReason: undefined,
          opportunityEvidenceHash: undefined,
          opportunitySourceUrl: undefined,
          opportunityTargetUrl: undefined,
          approvedAt: undefined,
          approvedInboxId: undefined,
          approvedInboxConfigurationVersion: undefined,
          approvalKind: undefined,
          approvalConsentVersion: undefined,
          approvalConsentPolicyHash: undefined,
          approvalConsentAcceptedAt: undefined,
          scheduledAt: undefined,
          status: "failed",
          failureReason:
            "A pre-lineage unsent draft was quarantined without adopting its unresolved recipient ownership.",
          updatedAt: Math.max(message.updatedAt, timestamp),
        });
        continue;
      }
      const messageInbox = message.inboxId
        ? await ctx.db.get(message.inboxId)
        : null;
      const exactMessageOwnerAccountKey =
        message.ownerAccountKey ??
        message.deliveryOwnerAccountKey ??
        (messageInbox?.siteId === migrationSite._id
          ? messageInbox.credentialOwnerAccountKey
          : undefined);
      if (!message.ownerAccountKey) {
        if (exactMessageOwnerAccountKey) {
          await ctx.db.patch(message._id, {
            ownerAccountKey: exactMessageOwnerAccountKey,
            ownerLineageUnresolvedAt: undefined,
            updatedAt: Math.max(message.updatedAt, Date.now()),
          });
        } else if (!message.ownerLineageUnresolvedAt) {
          // A no-inbox pre-lineage draft contains raw recipient/body data but
          // has no immutable account proof. Keep it hidden and immutable for
          // operator review; never infer ownership from the account currently
          // enumerating the site.
          await ctx.db.patch(message._id, {
            ownerLineageUnresolvedAt: Date.now(),
            updatedAt: Math.max(message.updatedAt, Date.now()),
          });
        }
      }
      const acceptedAt = message.sentAt ?? (
        message.status === "delivery_unverified"
          ? message.deliveryClaimedAt
          : undefined
      );
      if (!acceptedAt) continue;
      const settlementAccountKey =
        message.deliveryOwnerAccountKey ??
        (messageInbox?.siteId === migrationSite._id
          ? messageInbox.credentialOwnerAccountKey
          : undefined);
      if (!settlementAccountKey) {
        // Never guess the owner from the account currently enumerating the
        // site. A fresh same-mailbox OAuth proof can bind an additive legacy
        // inbox, after which this exact cursor is safely resumed.
        return {
          completed: false,
          processed: 0,
          stopped: "legacy_delivery_owner_unresolved",
        };
      }
      const legacyDeliveryOwnerWasUnbound = !message.deliveryOwnerAccountKey;
      if (!message.deliveryOwnerAccountKey) {
        await ctx.db.patch(message._id, {
          deliveryOwnerAccountKey: settlementAccountKey,
          updatedAt: Math.max(message.updatedAt, acceptedAt),
        });
      }
      await recordDurableContactReceiptForAccount(
        ctx,
        settlementAccountKey,
        message.toDomain,
        acceptedAt,
      );
      if (legacyDeliveryOwnerWasUnbound) {
        // Pre-lineage Gmail rows may contain an unseen STOP that only the
        // bounded readonly drain can discover. Conservatively retire both the
        // exact address and recipient organisation before any future outbound
        // claim, so even a revoked/failed legacy read token cannot cause a
        // compliance recontact.
        await materializeOutreachSuppressionTombstoneForAccount(
          ctx,
          settlementAccountKey,
          "domain",
          message.toDomain,
          "manual",
          acceptedAt,
        );
        await materializeOutreachSuppressionTombstoneForAccount(
          ctx,
          settlementAccountKey,
          "email",
          message.toEmail,
          "manual",
          acceptedAt,
        );
      }
      if (messageInbox?.siteId === migrationSite._id) {
        await recordDurablePacingReceiptForAccount(
          ctx,
          settlementAccountKey,
          messageInbox,
          acceptedAt,
          false,
        );
      }
    }
    if (page.isDone) {
      if (receipt.sitesDoneAfterActive) {
        const timestamp = Date.now();
        await ctx.db.patch(receipt._id, {
          status: "complete",
          siteCursor: undefined,
          nextSiteCursor: undefined,
          sitesDoneAfterActive: undefined,
          activeSiteId: undefined,
          rowStage: undefined,
          rowCursor: undefined,
          completedAt: timestamp,
          updatedAt: timestamp,
        });
        await scheduleReconciliation();
        return { completed: true, processed: page.page.length };
      }
      await ctx.db.patch(receipt._id, {
        siteCursor: receipt.nextSiteCursor,
        nextSiteCursor: undefined,
        sitesDoneAfterActive: undefined,
        activeSiteId: undefined,
        rowStage: undefined,
        rowCursor: undefined,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(receipt._id, {
        rowCursor: page.continueCursor,
        updatedAt: Date.now(),
      });
    }
    await scheduleSelf();
    return { completed: false, processed: page.page.length };
  },
});

/** Bounded, resumable activation sweep. It first retires every approval from
 * an older consent receipt (including its follow-ups), then reviews every
 * initial draft under the exact current inbox/consent configuration. New
 * follow-ups can only be created later by a verified provider receipt.
 * Automatic claims remain closed until the generation reaches complete. */
export const reconcileAutonomousInitialMessagesInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    generation: v.number(),
  },
  handler: async (ctx, { siteId, inboxId, generation }) => {
    const [site, inbox] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db.get(inboxId),
    ]);
    if (
      !siteExecutionActive(site) ||
      !inbox ||
      inbox.siteId !== siteId ||
      inbox.mode !== "live" ||
      !site.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId) ||
      inbox.autonomyReconciliationGeneration !== generation ||
      !autonomousOutreachConsentActive(inbox, site.userId)
    ) {
      return { completed: false, stopped: "configuration_changed" as const };
    }
    if (!(await outreachDurabilityMigrationComplete(ctx, site))) {
      return { completed: false, stopped: "migration_pending" as const };
    }
    if (!autonomousOutreachRuntimeEnabled(
      process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
    )) {
      return { completed: false, stopped: "release_paused" as const };
    }
    const timestamp = Date.now();
    const ownerAccountKey = inbox.credentialOwnerAccountKey;
    const scheduleNext = async () => {
      await ctx.scheduler.runAfter(
        0,
        internal.outreach.reconcileAutonomousInitialMessagesInternal,
        { siteId, inboxId, generation },
      );
    };
    if ((inbox.autonomyReconciliationStage ?? "approved") === "approved") {
      const rows = await ctx.db
        .query("outreach_messages")
        .withIndex("by_site_owner_lineage_status_approval_kind_sequence_scheduled", (q) =>
          q
            .eq("siteId", siteId)
            .eq("ownerAccountKey", ownerAccountKey)
            .eq("ownerLineageUnresolvedAt", undefined)
            .eq("status", "approved")
            .eq("approvalKind", "account_autopilot")
        )
        .take(50);
      for (const message of rows) {
        await ctx.db.patch(message._id, {
          status: message.sequenceStep === 0 ? "draft" : "skipped",
          approvedAt: undefined,
          approvedInboxId: undefined,
          approvedInboxConfigurationVersion: undefined,
          approvalKind: undefined,
          approvalConsentVersion: undefined,
          approvalConsentPolicyHash: undefined,
          approvalConsentAcceptedAt: undefined,
          scheduledAt: undefined,
          blockedReason: message.sequenceStep === 0
            ? undefined
            : "This follow-up belongs to an older autonomy consent receipt and will not resume.",
          updatedAt: timestamp,
        });
      }
      if (rows.length > 0) {
        await scheduleNext();
        return { completed: false, stage: "approved" as const, processed: rows.length };
      }
      await ctx.db.patch(inbox._id, {
        autonomyReconciliationStage: "draft",
        updatedAt: timestamp,
      });
      await scheduleNext();
      return { completed: false, stage: "draft" as const, processed: 0 };
    }

    const drafts = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_owner_lineage_status", (q) =>
        q
          .eq("siteId", siteId)
          .eq("ownerAccountKey", ownerAccountKey)
          .eq("ownerLineageUnresolvedAt", undefined)
          .eq("status", "draft")
      )
      .take(50);
    const configurationVersion = inbox.configurationVersion ?? 0;
    const brandName = site.siteName || normalizeDomain(site.domain).split(".")[0];
    for (const message of drafts) {
      if (message.sequenceStep !== 0) {
        await ctx.db.patch(message._id, {
          status: "skipped",
          blockedReason:
            "A follow-up can only be created from a verified accepted predecessor under the current consent receipt.",
          updatedAt: timestamp,
        });
        continue;
      }
      const [opportunity, domainSuppressed, emailSuppressed] = await Promise.all([
        ctx.db.get(message.opportunityId),
        siteSuppressionExists(ctx, siteId, "domain", message.toDomain),
        siteSuppressionExists(ctx, siteId, "email", message.toEmail),
      ]);
      const [durableDomainSuppressed, durableEmailSuppressed] = await Promise.all([
        persistentSuppressionExists(ctx, site, "domain", message.toDomain),
        persistentSuppressionExists(ctx, site, "email", message.toEmail),
      ]);
      if (
        domainSuppressed ||
        emailSuppressed ||
        durableDomainSuppressed ||
        durableEmailSuppressed
      ) {
        await ctx.db.patch(message._id, {
          status: "skipped",
          blockedReason:
            "The recipient previously opted out or bounced for this account.",
          updatedAt: timestamp,
        });
        continue;
      }
      const regeneratedDraft = opportunity
        ? draftOutreachMessage({
            type: opportunity.type,
            sourceUrl: opportunity.sourceUrl,
            sourceDomain: opportunity.sourceDomain,
            targetUrl: opportunity.targetUrl,
            brokenUrl: opportunity.type === "broken_link"
              ? opportunity.context
              : undefined,
            anchorText: opportunity.anchorText,
            context: opportunity.type === "unlinked_mention"
              ? opportunity.context
              : undefined,
            brandName,
            senderName: inbox.fromName || brandName,
            physicalMailingAddress: inbox.physicalMailingAddress,
          })
        : null;
      const complianceIssues = regeneratedDraft
        ? outreachComplianceIssues({
            body: regeneratedDraft.body,
            toEmail: message.toEmail,
            fromEmail: inbox.fromEmail,
            brandName,
            physicalMailingAddress: inbox.physicalMailingAddress,
          })
        : ["The verified evidence cannot produce a current compliant draft."];
      const bindingMatches = Boolean(
        regeneratedDraft &&
          opportunity &&
          opportunity.siteId === siteId &&
          opportunity.status === "outreach_prepared" &&
          opportunityEvidenceIsFresh({
            verifiedAt: opportunity.verifiedAt,
            now: timestamp,
          }) &&
          message.inboxId === inbox._id &&
          message.inboxConfigurationVersion === configurationVersion &&
          message.opportunityEvidenceHash === opportunity.evidenceHash &&
          message.opportunitySourceUrl === opportunity.sourceUrl &&
          message.opportunityTargetUrl === opportunity.targetUrl &&
          complianceIssues.length === 0,
      );
      if (!bindingMatches) {
        await ctx.db.patch(message._id, {
          status: "failed",
          failureReason:
            "This historical draft does not match the current verified evidence or sender configuration.",
          updatedAt: timestamp,
        });
        continue;
      }
      await ctx.db.patch(message._id, {
        subject: regeneratedDraft!.subject,
        body: regeneratedDraft!.body,
        complianceIssues: undefined,
        status: "approved",
        approvedAt: timestamp,
        approvedInboxId: inbox._id,
        approvedInboxConfigurationVersion: configurationVersion,
        approvalKind: "account_autopilot",
        approvalConsentVersion: inbox.autonomyConsentVersion,
        approvalConsentPolicyHash: inbox.autonomyConsentPolicyHash,
        approvalConsentAcceptedAt: inbox.autonomyConsentAcceptedAt,
        scheduledAt: timestamp,
        updatedAt: timestamp,
      });
    }
    if (drafts.length > 0) {
      await scheduleNext();
      return { completed: false, stage: "draft" as const, processed: drafts.length };
    }
    await ctx.db.patch(inbox._id, {
      autonomyReconciliationStatus: "complete",
      autonomyReconciliationStage: undefined,
      autonomyReconciliationCursor: undefined,
      updatedAt: timestamp,
    });
    return { completed: true, processed: 0 };
  },
});

export const disconnectInbox = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    await assertNoActiveDelivery(ctx, siteId);
    const inbox = await inboxForSite(ctx, siteId);
    if (!inbox) return { disconnected: false };
    if (inbox.provider === MANAGED_SES_TRANSPORT) {
      throw new Error(
        "Retire a managed sender through One Setup so its external resource is quarantined and released",
      );
    }
    if (
      !site.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      throw new Error(
        "The Gmail credential does not belong to the current site owner",
      );
    }
    const pendingLegacyDrain = Boolean(
      inbox.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ) && (await pendingLegacyUnboundMessageCount(ctx, inbox._id)) > 0,
    );
    if (pendingLegacyDrain) {
      // The owner may revoke Gmail immediately, but doing so discards the only
      // provider path that can observe an unseen pre-relay STOP. Atomically
      // reopen the account durability migration before clearing credentials;
      // all outbound claims stay closed until every pre-lineage recipient is
      // conservatively tombstoned from site-scoped history.
      const accountKey = accountDeletionKey(site.userId);
      const timestamp = Date.now();
      const receipt = await ctx.db
        .query("outreach_durability_migrations")
        .withIndex("by_account", (q) => q.eq("accountKey", accountKey))
        .first();
      if (receipt) {
        await ctx.db.patch(receipt._id, {
          userId: site.userId,
          version: OUTREACH_DURABILITY_MIGRATION_VERSION,
          status: "pending",
          siteCursor: undefined,
          nextSiteCursor: undefined,
          sitesDoneAfterActive: undefined,
          activeSiteId: undefined,
          rowStage: undefined,
          rowCursor: undefined,
          completedAt: undefined,
          updatedAt: timestamp,
        });
      } else {
        await ctx.db.insert("outreach_durability_migrations", {
          accountKey,
          userId: site.userId,
          version: OUTREACH_DURABILITY_MIGRATION_VERSION,
          status: "pending",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
      await ctx.scheduler.runAfter(
        0,
        internal.outreach.migrateOutreachDurabilityInternal,
        {
          siteId,
          inboxId: inbox._id,
          generation: inbox.autonomyReconciliationGeneration ?? 0,
        },
      );
    }
    // Credentials are cleared rather than the row deleted so warm-up history
    // and the audit trail on sent messages survive a reconnect.
    const disconnectedAt = Date.now();
    await ctx.db.patch(inbox._id, {
      status: "disconnected",
      mode: "approval",
      autonomyDisabledAt: disconnectedAt,
      autonomyReconciliationStatus: "paused",
      autonomyReconciliationCursor: undefined,
      oauthAccessToken: undefined,
      oauthRefreshToken: undefined,
      oauthExpiresAt: undefined,
      oauthScopes: undefined,
      complianceConfirmedAt: undefined,
      smtpPassword: undefined,
      apiKey: undefined,
      verifiedAt: undefined,
      inboundSyncPageToken: undefined,
      inboundSyncWindowStartedAt: undefined,
      inboundSyncLeaseId: undefined,
      inboundSyncOwnerAccountKey: undefined,
      inboundSyncLeaseExpiresAt: undefined,
      inboundRelayDsnRoutingVerifiedAt: undefined,
      inboundRelayDsnRoutingConfigurationVersion: undefined,
      inboundRelayDsnRoutingRolloutEpoch: undefined,
      inboundRelayDsnRoutingSenderDomain: undefined,
      inboundRelayDsnRoutingRelayConfigurationHash: undefined,
      inboundRelayDsnRoutingEvidenceHash: undefined,
      inboundRelayDsnRoutingAdapterVersion: undefined,
      inboundRelayDsnRoutingRetentionPolicyHash: undefined,
      inboundRelayDsnRoutingTargetHash: undefined,
      inboundRelayDsnRoutingTargetVersion: undefined,
      configurationVersion: (inbox.configurationVersion ?? 0) + 1,
      updatedAt: disconnectedAt,
    });
    const cancellationScheduled = await scheduleAutonomousSequenceCancellation(
      ctx,
      inbox,
      "The outreach mailbox was disconnected before this message became due.",
    );
    return { disconnected: true, cancellationScheduled };
  },
});

export const getInboxInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!(await siteExecutionAuthorized(ctx, site))) return null;
    const inbox = await inboxForSite(ctx, siteId);
    if (
      !inbox ||
      !site?.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      // This query returns provider credentials to Node actions. A site owner
      // change must therefore fail before any canary, send, or Gmail-read
      // action can obtain the prior owner's refresh token.
      return null;
    }
    const timestamp = Date.now();
    const durablePacing = inbox.provider === MANAGED_SES_TRANSPORT
      ? null
      : await readDurablePacingReceipt(
          ctx,
          site,
          inbox.senderDomain ?? inbox.fromEmail.split("@")[1] ?? "",
        );
    const activeDurablePacing =
      durablePacing && durablePacing.retainUntil > timestamp
        ? durablePacing
        : null;
    const durableOwnerMatches = Boolean(
      !activeDurablePacing ||
        activeDurablePacing.accountKey === accountDeletionKey(site.userId),
    );
    if (!durableOwnerMatches) return null;
    const effectivePacing = effectiveDurablePacingState({
      now: timestamp,
      fromEmail: inbox.fromEmail,
      inboxWarmupStartedAt: inbox.warmupStartedAt,
      inboxSentToday: inbox.sentToday,
      inboxSentTodayDay: inbox.sentTodayDay,
      inboxLastSentAt: inbox.lastSentAt,
      durable: activeDurablePacing ?? undefined,
    });
    return {
      ...inbox,
      ...effectivePacing,
      siteRolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      automaticDeliveryAuthorized: Boolean(
        autonomousOutreachRuntimeEnabled(
          process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
        ) &&
          autonomousOutreachConsentActive(inbox, site.userId) &&
          autonomousOutreachReconciliationComplete(inbox) &&
          (await outreachDurabilityMigrationComplete(ctx, site)) &&
          isSeoGrowthActuationEligible(site),
      ),
    };
  },
});

export const getGmailReconnectReadinessInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      return { ready: false, reason: "Tenant is unavailable." };
    }
    const [inbox, setupRequest] = await Promise.all([
      inboxForSite(ctx, siteId),
      ctx.db
        .query("managed_provisioning_requests")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .unique(),
    ]);
    if (
      setupRequest &&
      (setupRequest.outreachMailbox.mode !== "connect_existing" ||
        setupRequest.outreachTransport !== "gmail_oauth")
    ) {
      return {
        ready: false,
        reason:
          "Select Gmail OAuth in One Setup before starting owner Gmail authorization.",
      };
    }
    if (
      inbox &&
      (
        inbox.credentialSource === "managed_adapter" ||
        inbox.credentialSource === "managed_adapter_retiring" ||
        inbox.managedTransportOperationKey !== undefined
      )
    ) {
      return {
        ready: false,
        reason:
          "The managed sender is still retiring. Start a fresh owner Gmail connection after its release completes.",
      };
    }
    const ownerKey = accountDeletionKey(site.userId!);
    if (
      inbox?.credentialOwnerAccountKey &&
      inbox.credentialOwnerAccountKey !== ownerKey
    ) {
      return {
        ready: false,
        reason:
          "This site's Gmail credential belongs to another account and cannot be transferred.",
      };
    }
    if (inbox && !inbox.credentialOwnerAccountKey) {
      // Additive rollout rows are never trusted or reused. A fresh send-only
      // OAuth grant may replace the row after any live provider lease drains;
      // old readonly/unverified state cannot strand reconnect indefinitely.
      const [sending, canaries] = await Promise.all([
        ctx.db
          .query("outreach_messages")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", "sending")
          )
          .first(),
        ctx.db
          .query("outreach_inbound_relay_canaries")
          .withIndex("by_inbox", (q) => q.eq("inboxId", inbox._id))
          .take(2),
      ]);
      const timestamp = Date.now();
      if (
        (sending && (sending.deliveryLeaseExpiresAt ?? 0) > timestamp) ||
        canaries.some(
          (canary) =>
            canary.deliveryStatus === "claimed" &&
            (canary.deliveryLeaseExpiresAt ?? 0) > timestamp,
        )
      ) {
        return {
          ready: false,
          reason:
            "The legacy inbox has a provider attempt still in flight. Reconnect after its bounded lease settles.",
        };
      }
      return { ready: true, freshGrantRequired: true };
    }
    if (
      !inbox ||
      !inbox.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      )
    ) {
      return { ready: true };
    }
    const pending = await pendingLegacyUnboundMessageCount(ctx, inbox._id);
    return pending > 0
      ? {
          ready: false,
          pending,
          reason:
            "This legacy inbox still monitors sent messages without relay aliases. Reconnect is blocked until the bounded 90-day compatibility drain completes.",
        }
      : { ready: true };
  },
});

/** Legacy readonly polling is retained only as post-send compliance
 * settlement. Unlike growth work, it may finish replies for messages sent
 * before plan parking/reconciliation, but never after deletion or conflict. */
export const listLegacyInboundFleetPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db
      .query("outreach_inboxes")
      .paginate({ cursor: cursor ?? null, numItems: 25 });
    const page: Array<{
      siteId: Id<"sites">;
      autopilotEnabled: boolean;
      autopilotRolloutMode: string;
      inboxConfigurationValid: boolean;
      hasInbox: boolean;
      inboxProvider?: string;
      inboxStatus?: string;
      inboxMode?: string;
      inboxVerified: boolean;
      hasVerifiedOpportunities: boolean;
      hasApprovedMessages: boolean;
      hasLinksToVerify: boolean;
      inboundMonitoringReady: boolean;
      inboundMonitoringMode: "legacy_gmail";
      hasMessagesToMonitor: boolean;
    }> = [];
    for (const inbox of result.page) {
      if (
        inbox.provider !== "gmail" ||
        !inbox.oauthScopes?.split(/\s+/).includes(
          "https://www.googleapis.com/auth/gmail.readonly",
        ) ||
        !(inbox.oauthRefreshToken || inbox.oauthAccessToken) ||
        ["disconnected", "suspended"].includes(inbox.status)
      ) continue;
      const [site, inboxes] = await Promise.all([
        ctx.db.get(inbox.siteId),
        ctx.db
          .query("outreach_inboxes")
          .withIndex("by_site", (q) => q.eq("siteId", inbox.siteId))
          .take(2),
      ]);
      if (
        !site?.userId ||
        inboxes.length !== 1 ||
        inboxes[0]._id !== inbox._id ||
        inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
      ) continue;
      const policy = await outreachSettlementPolicy(ctx, site);
      if (policy.maximumDeliveryBoundaryAt === 0) continue;
      const [candidate] = await legacyUnboundMessages(ctx, inbox._id, {
        limit: 1,
        maximumDeliveryBoundaryAt: policy.maximumDeliveryBoundaryAt,
      });
      if (!candidate || !policy.allows(
        candidate.deliveryClaimedAt ?? candidate.sentAt,
      )) {
        continue;
      }
      page.push({
        siteId: inbox.siteId,
        autopilotEnabled: false,
        autopilotRolloutMode: "observe",
        inboxConfigurationValid: true,
        hasInbox: true,
        inboxProvider: inbox.provider,
        inboxStatus: inbox.status,
        inboxMode: inbox.mode,
        inboxVerified: Boolean(inbox.verifiedAt),
        hasVerifiedOpportunities: false,
        hasApprovedMessages: false,
        hasLinksToVerify: false,
        inboundMonitoringReady: true,
        inboundMonitoringMode: "legacy_gmail",
        hasMessagesToMonitor: true,
      });
    }
    return { ...result, page };
  },
});

export const getLegacyInboundFleetState = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const inboxes = await ctx.db
      .query("outreach_inboxes")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2);
    if (inboxes.length !== 1) return null;
    const inbox = inboxes[0];
    const site = await ctx.db.get(siteId);
    if (
      !site?.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      throw new Error(
        "The Gmail credential belongs to a previous site owner; reconnect it before approval",
      );
    }
    if (
      inbox.provider !== "gmail" ||
      !inbox.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ) ||
      !(inbox.oauthRefreshToken || inbox.oauthAccessToken) ||
      ["disconnected", "suspended"].includes(inbox.status)
    ) return null;
    const policy = await outreachSettlementPolicy(ctx, site);
    if (policy.maximumDeliveryBoundaryAt === 0) return null;
    const [candidate] = await legacyUnboundMessages(ctx, inbox._id, {
      limit: 1,
      maximumDeliveryBoundaryAt: policy.maximumDeliveryBoundaryAt,
    });
    if (!candidate || !policy.allows(
      candidate.deliveryClaimedAt ?? candidate.sentAt,
    )) return null;
    return {
      siteId,
      autopilotEnabled: false,
      autopilotRolloutMode: "observe",
      inboxConfigurationValid: true,
      hasInbox: true,
      inboxProvider: inbox.provider,
      inboxStatus: inbox.status,
      inboxMode: inbox.mode,
      inboxVerified: Boolean(inbox.verifiedAt),
      hasVerifiedOpportunities: false,
      hasApprovedMessages: false,
      hasLinksToVerify: false,
      inboundMonitoringReady: true,
      inboundMonitoringMode: "legacy_gmail" as const,
      hasMessagesToMonitor: true,
    };
  },
});

export const getLegacyInboundOwnership = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!(await outreachSettlementLifecycleActive(ctx, site))) return null;
    const inboxes = await ctx.db
      .query("outreach_inboxes")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2);
    if (
      inboxes.length !== 1 ||
      inboxes[0].credentialOwnerAccountKey !==
        accountDeletionKey(site!.userId!)
    ) {
      return null;
    }
    return { userId: site!.userId };
  },
});

export const markInboxVerified = internalMutation({
  args: { inboxId: v.id("outreach_inboxes"), siteId: v.id("sites") },
  handler: async (ctx, { inboxId, siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) throw new Error("Site not found");
    const inbox = await ctx.db.get(inboxId);
    if (!inbox || inbox.siteId !== siteId) throw new Error("Inbox not found for site");
    if (
      !site?.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      throw new Error("The Gmail credential does not belong to the current site owner");
    }
    await assertNoActiveDelivery(ctx, siteId);
    if (
      !inbox.spfVerifiedAt ||
      !inbox.dkimVerifiedAt ||
      !inbox.dmarcVerifiedAt ||
      !inbox.physicalMailingAddress ||
      !inbox.complianceConfirmedAt
    ) {
      throw new Error("DNS and sender compliance must verify before the inbox can activate");
    }
    const now = Date.now();
    await ctx.db.patch(inboxId, {
      verifiedAt: now,
      status: "active",
      lastError: undefined,
      updatedAt: now,
    });
  },
});

export const recordInboxError = internalMutation({
  args: {
    inboxId: v.id("outreach_inboxes"),
    siteId: v.id("sites"),
    error: v.string(),
    suspend: v.optional(v.boolean()),
    expectedConfigurationVersion: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { inboxId, siteId, error, suspend, expectedConfigurationVersion },
  ) => {
    const inbox = await ctx.db.get(inboxId);
    if (!inbox || inbox.siteId !== siteId) throw new Error("Inbox not found for site");
    if (
      expectedConfigurationVersion !== undefined &&
      (inbox.configurationVersion ?? 0) !== expectedConfigurationVersion
    ) {
      return { recorded: false };
    }
    await ctx.db.patch(inboxId, {
      lastError: sanitizeDeliveryFailure(error),
      // A provider-level rejection suspends sending rather than retrying into
      // a block, which is what turns a warning into a blacklisting.
      status: suspend ? "suspended" : inbox.status,
      mode: suspend ? "approval" : inbox.mode,
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});

// ── Messages ──

export const listMessages = query({
  args: {
    siteId: v.id("sites"),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { siteId, status, limit }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const ownerAccountKey = accountDeletionKey(site.userId!);
    const canonicalDomain = siteCanonicalDomain(site);
    const take = Math.max(1, Math.min(limit ?? 50, 200));
    const currentStatusBatch = (messageStatus: string) => {
      if (siteUsesLegacyDomainReceipts(site)) {
        return ctx.db
          .query("outreach_messages")
          .withIndex("by_site_owner_lineage_status", (q) =>
            q
              .eq("siteId", siteId)
              .eq("ownerAccountKey", ownerAccountKey)
              .eq("ownerLineageUnresolvedAt", undefined)
              .eq("status", messageStatus)
          )
          .order("desc")
          .take(take);
      }
      if (!canonicalDomain) return Promise.resolve([]);
      return ctx.db
        .query("outreach_messages")
        .withIndex("by_site_epoch_owner_status", (q) =>
          q
            .eq("siteId", siteId)
            .eq("canonicalDomain", canonicalDomain)
            .eq("domainRevision", siteCanonicalDomainRevision(site))
            .eq("ownerAccountKey", ownerAccountKey)
            .eq("ownerLineageUnresolvedAt", undefined)
            .eq("status", messageStatus)
        )
        .order("desc")
        .take(take);
    };
    if (status) {
      return currentStatusBatch(status);
    }
    const statuses = [
      "draft",
      "blocked",
      "approved",
      "sending",
      "delivery_unverified",
      "delivery_reviewed_sent",
      "sent",
      "replied",
      "failed",
      "bounced",
      "skipped",
    ];
    const batches = await Promise.all(
      statuses.map(currentStatusBatch),
    );
    return batches
      .flat()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, take);
  },
});

export const insertDraft = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.optional(v.id("outreach_inboxes")),
    opportunityId: v.id("seo_authority_opportunities"),
    toEmail: v.string(),
    toDomain: v.string(),
    subject: v.string(),
    body: v.string(),
    providerPlannedSequence: v.optional(v.array(v.object({
      sequenceStep: v.number(),
      subject: v.string(),
      body: v.string(),
      delayDays: v.number(),
    }))),
    status: v.string(),
    sequenceStep: v.number(),
    threadKey: v.string(),
    complianceIssues: v.optional(v.array(v.string())),
    blockedReason: v.optional(v.string()),
    pacingReason: v.optional(v.string()),
    pacingVersion: v.optional(v.number()),
    inboxConfigurationVersion: v.optional(v.number()),
    opportunityEvidenceHash: v.optional(v.string()),
    opportunitySourceUrl: v.optional(v.string()),
    opportunityTargetUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.sequenceStep !== 0) {
      throw new Error(
        "Only the verified provider-receipt path may create a bounded follow-up.",
      );
    }
    const [site, opportunity] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.opportunityId),
    ]);
    if (!siteExecutionActive(site)) {
      throw new Error("Site not found");
    }
    if (!site.userId) throw new Error("Outreach tenant owner is unavailable");
    const canonicalDomain = siteCanonicalDomain(site);
    if (!canonicalDomain) throw new Error("Outreach tenant domain is invalid");
    const ownerAccountKey = accountDeletionKey(site.userId);
    if (
      !opportunity ||
      opportunity.siteId !== args.siteId ||
      !authorityOpportunityMatchesCurrentDomain(site, opportunity)
    ) {
      throw new Error("Authority opportunity not found for site");
    }
    if (
      !args.opportunityEvidenceHash ||
      args.opportunityEvidenceHash !== opportunity.evidenceHash ||
      args.opportunitySourceUrl !== opportunity.sourceUrl ||
      args.opportunityTargetUrl !== opportunity.targetUrl ||
      opportunity.status !== "verified"
    ) {
      return {
        messageId: undefined,
        status: "stale_evidence" as const,
        alreadyExisted: false,
      };
    }
    const draftInbox = args.inboxId ? await ctx.db.get(args.inboxId) : null;
    if (args.inboxId) {
      if (!draftInbox || draftInbox.siteId !== args.siteId) {
        throw new Error("Inbox not found for site");
      }
      if (
        draftInbox.credentialOwnerAccountKey !== ownerAccountKey ||
        args.inboxConfigurationVersion !== undefined &&
        args.inboxConfigurationVersion !==
          (draftInbox.configurationVersion ?? 0)
      ) {
        throw new Error("The draft sender profile changed before it was stored");
      }
    }
    if (
      draftInbox?.mode === "live" &&
      !autonomousOutreachRuntimeEnabled(
        process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
      )
    ) {
      return {
        messageId: undefined,
        status: "paused" as const,
        alreadyExisted: false,
      };
    }
    // A message that is queued or already delivered is untouchable.
    const LIVE = [
      "draft",
      "approved",
      "sending",
      "delivery_unverified",
      "delivery_reviewed_sent",
      "sent",
      "replied",
    ];
    const REFRESHABLE = [...LIVE, "blocked"];
    const now = Date.now();

    const [sameOpportunity, sameThread] = await Promise.all([
      ctx.db
        .query("outreach_messages")
        .withIndex("by_opportunity", (q) => q.eq("opportunityId", args.opportunityId))
        .collect(),
      ctx.db
        .query("outreach_messages")
        .withIndex("by_thread", (q) => q.eq("threadKey", args.threadKey))
        .collect(),
    ]);

    const ownershipConflict = [...sameOpportunity, ...sameThread].some(
      (message) =>
        REFRESHABLE.includes(message.status) &&
        !outreachMessageOwnerMatches(message, ownerAccountKey),
    );
    if (ownershipConflict) {
      throw new Error(
        "Existing outreach message ownership is unresolved or belongs to another account",
      );
    }

    // One live message per opportunity: re-running discovery must not queue
    // the same email twice.
    const liveForOpportunity = sameOpportunity.find((m) =>
      LIVE.includes(m.status) && outreachMessageMatchesCurrentDomain(site, m)
    );
    if (liveForOpportunity) {
      const refreshesStaleDraft =
        liveForOpportunity.status === "draft" &&
        (liveForOpportunity.inboxConfigurationVersion !==
          args.inboxConfigurationVersion ||
          liveForOpportunity.opportunityEvidenceHash !==
            args.opportunityEvidenceHash ||
          liveForOpportunity.opportunitySourceUrl !==
            args.opportunitySourceUrl ||
          liveForOpportunity.opportunityTargetUrl !==
            args.opportunityTargetUrl);
      if (refreshesStaleDraft) {
        await ctx.db.patch(liveForOpportunity._id, {
          ...args,
          canonicalDomain,
          domainRevision: siteCanonicalDomainRevision(site),
          ownerAccountKey,
          ownerLineageUnresolvedAt: undefined,
          approvedAt: undefined,
          approvedInboxId: undefined,
          approvedInboxConfigurationVersion: undefined,
          approvalKind: undefined,
          approvalConsentVersion: undefined,
          approvalConsentPolicyHash: undefined,
          approvalConsentAcceptedAt: undefined,
          scheduledAt: undefined,
          updatedAt: now,
        });
        await ctx.db.patch(opportunity._id, {
          status: "outreach_prepared",
          updatedAt: now,
        });
        return {
          messageId: liveForOpportunity._id,
          status: args.status,
          alreadyExisted: true,
        };
      }
      return {
        messageId: liveForOpportunity._id,
        status: liveForOpportunity.status,
        alreadyExisted: true,
      };
    }

    const contact = await ctx.db.query("outreach_contacts")
      .withIndex("by_site_email", (q) =>
        q.eq("siteId", args.siteId).eq(
          "email",
          args.toEmail.trim().toLowerCase(),
        )
      )
      .unique();
    const recipientDomain = args.toEmail.trim().toLowerCase().split("@")[1] ?? "";
    const recipientClass = contact?.recipientClass ??
      (isConsumerMailDomain(recipientDomain) ? "personal" : "corporate");
    const enabledJurisdictions = new Set(
      String(process.env.OUTREACH_AUTO_JURISDICTIONS ?? "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean),
    );
    const policy = decideOutreachPolicy({
      recipientClass,
      jurisdiction: contact?.jurisdiction,
      jurisdictionEvidence: contact?.jurisdictionEvidenceHash,
      businessRoleEvidence: contact?.businessRoleEvidenceHash ?? contact?.role,
      businessRelevance: opportunity.evidenceHash,
      contactSource: contact?.discoveredFromUrl,
      lawfulBasisClass: contact?.lawfulBasisClass,
      requiredDisclosuresPresent: Boolean(
        draftInbox?.fromName && draftInbox.physicalMailingAddress &&
        (args.complianceIssues ?? []).length === 0,
      ),
      tenantConsentVersion: draftInbox?.autonomyConsentVersion,
      suppressed: false,
      legalRuleEnabled: Boolean(
        contact?.jurisdiction &&
        enabledJurisdictions.has(contact.jurisdiction.toUpperCase()),
      ),
    });
    const recipientHash = sha256Hex(args.toEmail.trim().toLowerCase());
    const policyConfigurationHash = sha256Hex(JSON.stringify({
      version: OUTREACH_POLICY_VERSION,
      siteId: String(args.siteId),
      recipientHash,
      recipientClass,
      jurisdiction: contact?.jurisdiction,
      jurisdictionEvidenceHash: contact?.jurisdictionEvidenceHash,
      businessRoleEvidenceHash: contact?.businessRoleEvidenceHash,
      lawfulBasisClass: contact?.lawfulBasisClass,
      opportunityEvidenceHash: opportunity.evidenceHash,
      contactSource: contact?.discoveredFromUrl,
      disclosuresPresent: (args.complianceIssues ?? []).length === 0,
      tenantConsentVersion: draftInbox?.autonomyConsentVersion,
      decision: policy.decision,
    }));
    const priorPolicyRows = await ctx.db.query("outreach_policy_decisions")
      .withIndex("by_site_recipient_policy", (q) =>
        q.eq("siteId", args.siteId)
          .eq("recipientHash", recipientHash)
          .eq("policyVersion", OUTREACH_POLICY_VERSION)
      )
      .take(50);
    let policyReceipt = priorPolicyRows.find((row) =>
      row.configurationHash === policyConfigurationHash
    );
    if (!policyReceipt) {
      const policyReceiptId = await ctx.db.insert("outreach_policy_decisions", {
        siteId: args.siteId,
        opportunityId: opportunity._id,
        recipientHash,
        recipientClass,
        jurisdiction: contact?.jurisdiction,
        jurisdictionEvidenceHash: contact?.jurisdictionEvidenceHash,
        businessRoleEvidenceHash: contact?.businessRoleEvidenceHash,
        businessRelevanceHash: sha256Hex(opportunity.evidenceHash),
        contactSourceHash: contact?.discoveredFromUrl
          ? sha256Hex(contact.discoveredFromUrl)
          : undefined,
        lawfulBasisClass: contact?.lawfulBasisClass,
        requiredDisclosures: (args.complianceIssues ?? []).length === 0
          ? ["sender_identity", "physical_address", "one_click_unsubscribe"]
          : [],
        tenantConsentVersion: draftInbox?.autonomyConsentVersion,
        decision: policy.decision,
        reasonCodes: policy.reasons,
        policyVersion: OUTREACH_POLICY_VERSION,
        configurationHash: policyConfigurationHash,
        evaluatedAt: now,
        createdAt: now,
      });
      policyReceipt = (await ctx.db.get(policyReceiptId))!;
    }

    // And one live thread per recipient domain. Two opportunities on the same
    // site are two reasons to write, not two emails: sending both is the
    // behaviour that gets a sender marked as spam. A second opportunity is
    // still recorded, but held blocked behind the one already in flight.
    const liveForThread = sameThread.find(
      (m) =>
        LIVE.includes(m.status) &&
        outreachMessageMatchesCurrentDomain(site, m) &&
        m.opportunityId !== args.opportunityId,
    );
    const heldBehindThread = Boolean(liveForThread) && args.status !== "blocked";

    const automaticallyAuthorized = Boolean(
      args.status === "draft" &&
        draftInbox &&
        autonomousOutreachRuntimeEnabled(
          process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
        ) &&
        autonomousOutreachConsentActive(draftInbox, site.userId) &&
        autonomousOutreachReconciliationComplete(draftInbox) &&
        policy.decision === "allowed_auto" &&
        (args.complianceIssues ?? []).length === 0 &&
        !args.blockedReason,
    );
    const authorizeRecord = automaticallyAuthorized && !heldBehindThread;
    const record = {
      ...args,
      canonicalDomain,
      domainRevision: siteCanonicalDomainRevision(site),
      ownerAccountKey,
      ownerLineageUnresolvedAt: undefined,
      toEmail: args.toEmail.trim().toLowerCase(),
      toDomain: outreachOrganisationDomain(args.toDomain),
      status: heldBehindThread
        ? "blocked"
        : authorizeRecord
          ? "approved"
          : args.status,
      blockedReason: heldBehindThread
        ? `Another message to ${outreachOrganisationDomain(args.toDomain)} is already in flight.`
        : args.blockedReason,
      // Written explicitly so a refreshed message clears a stale issue list
      // rather than keeping one it no longer has.
      complianceIssues: args.complianceIssues,
      outreachPolicyDecisionId: policyReceipt._id,
      outreachPolicyDecision: policy.decision,
      outreachPolicyVersion: policy.version,
      outreachPolicyConfigurationHash: policyConfigurationHash,
      ...(authorizeRecord
        ? {
            approvedAt: now,
            approvedInboxId: draftInbox!._id,
            approvedInboxConfigurationVersion:
              draftInbox!.configurationVersion ?? 0,
            approvalKind: "account_autopilot",
            approvalConsentVersion: draftInbox!.autonomyConsentVersion,
            approvalConsentPolicyHash:
              draftInbox!.autonomyConsentPolicyHash,
            approvalConsentAcceptedAt:
              draftInbox!.autonomyConsentAcceptedAt,
            scheduledAt: now,
          }
        : {}),
    };

    // A previously blocked message is refreshed in place. That is what lets a
    // tenant connect an inbox, re-run, and see the same message become
    // sendable instead of accumulating a second blocked row per attempt.
    const blocked = sameOpportunity.find((m) =>
      m.status === "blocked" && outreachMessageMatchesCurrentDomain(site, m)
    );
    if (blocked) {
      await ctx.db.patch(blocked._id, { ...record, updatedAt: now });
      await ctx.db.patch(opportunity._id, {
        status: "outreach_prepared",
        updatedAt: now,
      });
      return { messageId: blocked._id, status: record.status, alreadyExisted: true };
    }

    const messageId = await ctx.db.insert("outreach_messages", {
      ...record,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(opportunity._id, {
      status: "outreach_prepared",
      updatedAt: now,
    });
    return { messageId, status: record.status, alreadyExisted: false };
  },
});

export const approveMessage = mutation({
  args: { siteId: v.id("sites"), messageId: v.id("outreach_messages") },
  handler: async (ctx, { siteId, messageId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    if (!siteExecutionActive(site)) {
      throw new Error("This site is parked outside the current plan allowance");
    }
    const message = await ctx.db.get(messageId);
    const ownerAccountKey = accountDeletionKey(site.userId!);
    if (
      !message ||
      message.siteId !== siteId ||
      !outreachMessageMatchesCurrentDomain(site, message) ||
      !outreachMessageOwnerMatches(message, ownerAccountKey)
    ) {
      throw new Error("Message not found for site");
    }
    if (message.sequenceStep !== 0) {
      throw new Error(
        "Autonomous follow-ups are released only from an exact verified predecessor receipt and cannot be manually approved.",
      );
    }
    if (
      !message.outreachPolicyDecisionId ||
      !["allowed_auto", "approval_only"].includes(
        message.outreachPolicyDecision ?? "needs_evidence",
      )
    ) {
      throw new Error(
        "This recipient needs jurisdiction and lawful-basis evidence before outreach can be approved",
      );
    }
    const policyReceipt = await ctx.db.get(message.outreachPolicyDecisionId);
    if (
      !policyReceipt || policyReceipt.siteId !== siteId ||
      policyReceipt.decision !== message.outreachPolicyDecision ||
      policyReceipt.policyVersion !== message.outreachPolicyVersion ||
      policyReceipt.configurationHash !== message.outreachPolicyConfigurationHash
    ) throw new Error("The outreach policy receipt is missing or stale");
    if (message.status !== "draft") {
      throw new Error(`Only a draft can be approved (status is "${message.status}")`);
    }
    if ((message.complianceIssues ?? []).length > 0) {
      throw new Error("Message cannot be approved while compliance issues remain");
    }
    const inboxes = await ctx.db
      .query("outreach_inboxes")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2);
    if (inboxes.length !== 1) {
      throw new Error("Exactly one outreach inbox must be connected before approval");
    }
    const inbox = inboxes[0];
    if (
      !site.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      throw new Error(
        "The Gmail credential belongs to a previous site owner; reconnect it before approval",
      );
    }
    const configurationVersion = inbox.configurationVersion ?? 0;
    if (
      message.inboxId !== inbox._id ||
      message.inboxConfigurationVersion === undefined ||
      message.inboxConfigurationVersion !== configurationVersion
    ) {
      throw new Error("The draft uses a stale sender profile; regenerate it before approval");
    }
    const complianceIssues = outreachComplianceIssues({
      body: message.body,
      toEmail: message.toEmail,
      fromEmail: inbox.fromEmail,
      brandName: site.siteName || normalizeDomain(site.domain).split(".")[0],
      physicalMailingAddress: inbox.physicalMailingAddress,
    });
    if (complianceIssues.length > 0) {
      throw new Error("The draft no longer passes the current sender compliance profile");
    }
    const approvedAt = Date.now();
    await ctx.db.patch(messageId, {
      status: "approved",
      approvedAt,
      approvedInboxId: inbox._id,
      approvedInboxConfigurationVersion: configurationVersion,
      approvalKind: "owner_message",
      approvalConsentVersion: undefined,
      approvalConsentPolicyHash: undefined,
      approvalConsentAcceptedAt: undefined,
      scheduledAt: approvedAt,
      updatedAt: approvedAt,
    });
    return { status: "approved" };
  },
});

export const discardMessage = mutation({
  args: { siteId: v.id("sites"), messageId: v.id("outreach_messages") },
  handler: async (ctx, { siteId, messageId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const message = await ctx.db.get(messageId);
    if (
      !message ||
      message.siteId !== siteId ||
      !outreachMessageMatchesCurrentDomain(site, message) ||
      !outreachMessageOwnerMatches(
        message,
        accountDeletionKey(site.userId!),
      )
    ) {
      throw new Error("Message not found for site");
    }
    if (message.sentAt) throw new Error("A sent message cannot be discarded");
    if (["sending", "delivery_unverified"].includes(message.status)) {
      throw new Error(
        "A message cannot be discarded while delivery is in progress or awaiting manual review",
      );
    }
    await ctx.db.patch(messageId, { status: "skipped", updatedAt: Date.now() });
    return { status: "skipped" };
  },
});

const dnsEvidenceValidator = v.object({
  senderDomain: v.string(),
  dkimSelector: v.string(),
  checkedAt: v.number(),
  spf: v.boolean(),
  dkim: v.boolean(),
  dmarc: v.boolean(),
});

const liveOpportunityEvidenceValidator = v.object({
  messageId: v.id("outreach_messages"),
  opportunityId: v.id("seo_authority_opportunities"),
  evidenceHash: v.string(),
  checkedAt: v.number(),
  contactEmail: v.string(),
  contactReceiptUrl: v.string(),
  contactCheckedAt: v.number(),
  targetReceiptUrl: v.optional(v.string()),
  targetCheckedAt: v.optional(v.number()),
});

const inboundRelayBindingValidator = v.object({
  aliasAddress: v.string(),
  aliasHash: v.string(),
  aliasDomain: v.string(),
  outboundRfcMessageId: v.string(),
  dsnRoutingTargetHash: v.string(),
  dsnRoutingTargetVersion: v.number(),
  dsnRoutingTargetGeneration: v.number(),
});

const managedSesClaimReceiptValidator = v.object({
  resourceOperationKey: v.string(),
  generation: v.number(),
  adapterVersion: v.string(),
  resourceReceipt: v.string(),
  providerVerifiedAt: v.number(),
  unsubscribeTokenHash: v.string(),
});

const deliveryReleaseValidator = v.union(
  v.literal("approved"),
  v.literal("automatic"),
);

/**
 * Atomically select and lease one approved message.
 *
 * Convex mutations are serializable. The `approved` -> `sending` transition is
 * therefore the idempotency boundary: two concurrent owner actions cannot
 * both receive the same message, and a tenant can have at most one claim.
 */
export const claimApprovedDelivery = internalMutation({
  args: {
    siteId: v.id("sites"),
    attemptId: v.string(),
    release: deliveryReleaseValidator,
    dnsEvidence: dnsEvidenceValidator,
    opportunityEvidence: liveOpportunityEvidenceValidator,
    inboundRelay: v.optional(inboundRelayBindingValidator),
    managedSesReceipt: v.optional(managedSesClaimReceiptValidator),
  },
  handler: async (
    ctx,
    {
      siteId,
      attemptId,
      release,
      dnsEvidence,
      opportunityEvidence,
      inboundRelay,
      managedSesReceipt,
    },
  ) => {
    const now = Date.now();
    if (!/^[a-z0-9-]{20,100}$/i.test(attemptId)) {
      throw new Error("Delivery attempt identifier is invalid");
    }

    const claimSite = await ctx.db.get(siteId);
    if (!claimSite?.userId) {
      return {
        claimed: false as const,
        reason: "Tenant is unavailable or parked outside the current plan allowance.",
      };
    }
    const claimOwnerAccountKey = accountDeletionKey(claimSite.userId);

    const unresolved = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_owner_lineage_status", (q) =>
        q
          .eq("siteId", siteId)
          .eq("ownerAccountKey", claimOwnerAccountKey)
          .eq("ownerLineageUnresolvedAt", undefined)
          .eq("status", "delivery_unverified"),
      )
      .first();
    if (unresolved) {
      if (
        unresolved.deliveryTransport === MANAGED_SES_TRANSPORT &&
        unresolved.managedSesExternalAttemptedAt &&
        unresolved.inboxId
      ) {
        const resourceRows = await ctx.db
          .query("managed_outreach_mailbox_resources")
          .withIndex("by_canonical_inbox", (q) =>
            q.eq("canonicalInboxId", unresolved.inboxId)
          )
          .take(20);
        const resource = resourceRows.find((row) =>
          row.operationKey === unresolved.managedSesResourceOperationKey &&
          row.generation === unresolved.managedSesGeneration &&
          row.adapterVersion === unresolved.managedSesAdapterVersion
        );
        if (
          resource &&
          resource.operationKey ===
            unresolved.managedSesResourceOperationKey &&
          resource.generation === unresolved.managedSesGeneration &&
          resource.adapterVersion === unresolved.managedSesAdapterVersion
        ) {
          await ctx.scheduler.runAt(
            Math.max(
              now,
              unresolved.managedSesExternalAttemptedAt +
                MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
            ),
            internal.managedOutreachMailbox
              .claimManagedSesAmbiguityReconciliation,
            { resourceId: resource._id },
          );
        }
      }
      return {
        claimed: false as const,
        reason: "A previous delivery has an unverified outcome and requires exact provider settlement.",
      };
    }

    const inFlight = await ctx.db
      .query("outreach_messages")
      .withIndex("by_site_owner_lineage_status", (q) =>
        q
          .eq("siteId", siteId)
          .eq("ownerAccountKey", claimOwnerAccountKey)
          .eq("ownerLineageUnresolvedAt", undefined)
          .eq("status", "sending")
      )
      .take(2);
    if (inFlight.length > 0) {
      const expired = inFlight.find(
        (message) =>
          deliveryLeaseState({
            status: message.status,
            leaseExpiresAt: message.deliveryLeaseExpiresAt,
            attemptId: message.deliveryAttemptId,
            now,
          }) === "expired_unverified",
      );
      if (expired) {
        const recoveryDecision = deliveryLeaseRecoveryDecision({
          exactClaimCurrent: expired.deliveryBoundaryVersion === 1,
          leaseExpired: true,
          externalAttempted: Boolean(
            expired.deliveryExternalAttemptedAt ||
            expired.managedSesExternalAttemptedAt
          ),
        });
        if (recoveryDecision === "restore_approved") {
          const restored = await deferClaimedDeliveryBeforeProvider(
            ctx,
            expired,
            now,
            now + 1_000,
            "The delivery lease expired before the provider boundary; the exact approved message was restored for a fresh authorization check.",
            false,
          );
          return {
            claimed: false as const,
            reason:
              "A pre-provider delivery claim expired safely and was restored for retry.",
            deferredUntil: restored.nextEligibleAt,
          };
        }
        await ctx.db.patch(expired._id, {
          status: "delivery_unverified",
          deliveryLeaseExpiredAt: now,
          failureReason:
            "The delivery lease expired after a provider boundary without a verified receipt. This operation will not be replayed.",
          updatedAt: now,
        });
        if (
          expired.deliveryTransport === MANAGED_SES_TRANSPORT &&
          expired.managedSesExternalAttemptedAt &&
          expired.inboxId
        ) {
          const resourceRows = await ctx.db
            .query("managed_outreach_mailbox_resources")
            .withIndex("by_canonical_inbox", (q) =>
              q.eq("canonicalInboxId", expired.inboxId)
            )
            .take(20);
          const resource = resourceRows.find((row) =>
            row.operationKey === expired.managedSesResourceOperationKey &&
            row.generation === expired.managedSesGeneration &&
            row.adapterVersion === expired.managedSesAdapterVersion
          );
          if (
            resource &&
            resource.operationKey === expired.managedSesResourceOperationKey &&
            resource.generation === expired.managedSesGeneration &&
            resource.adapterVersion === expired.managedSesAdapterVersion
          ) {
            await ctx.scheduler.runAt(
              Math.max(
                now,
                expired.managedSesExternalAttemptedAt +
                  MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
              ),
              internal.managedOutreachMailbox
                .claimManagedSesAmbiguityReconciliation,
              { resourceId: resource._id },
            );
          }
        }
        return {
          claimed: false as const,
          reason:
            "A delivery lease expired without a verified receipt; exact provider settlement is required.",
        };
      }
      return {
        claimed: false as const,
        reason: "Another outreach delivery is already in progress for this tenant.",
      };
    }

    const [site, inboxes] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("outreach_inboxes")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(2),
    ]);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      return {
        claimed: false as const,
        reason: "Tenant is unavailable or parked outside the current plan allowance.",
      };
    }
    if (!(await outreachDurabilityMigrationComplete(ctx, site))) {
      return {
        claimed: false as const,
        reason:
          "Account-wide legacy suppression and contact history has not finished reconciling.",
      };
    }
    if (
      release === "automatic" &&
      (!autonomousOutreachRuntimeEnabled(
        process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
      ) ||
        !isSeoGrowthActuationEligible(site))
    ) {
      return {
        claimed: false as const,
        reason: "Authority autopilot is not active for this tenant rollout.",
      };
    }
    if (inboxes.length !== 1) {
      return {
        claimed: false as const,
        reason: "Exactly one outreach inbox must be connected for this tenant.",
      };
    }
    const inbox = inboxes[0];
    if (
      !site.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      await ctx.db.patch(inbox._id, {
        status: "disconnected",
        mode: "approval",
        oauthAccessToken: undefined,
        oauthRefreshToken: undefined,
        autonomyDisabledAt: now,
        autonomyReconciliationStatus: "paused",
        configurationVersion: (inbox.configurationVersion ?? 0) + 1,
        lastError:
          "The site owner changed; reconnect Gmail before any outreach can send.",
        updatedAt: now,
      });
      await scheduleAutonomousSequenceCancellation(
        ctx,
        inbox,
        "The site owner or mailbox ownership binding changed before this message became due.",
      );
      return {
        claimed: false as const,
        reason: "The Gmail credential does not belong to the current tenant owner.",
      };
    }
    const managedSes = inbox.provider === MANAGED_SES_TRANSPORT;
    const smartleadManaged =
      inbox.managedTransportKind === SMARTLEAD_MANAGED_TRANSPORT;
    const managedResourceRows = managedSes || smartleadManaged
      ? await ctx.db
        .query("managed_outreach_mailbox_resources")
        .withIndex("by_canonical_inbox", (q) =>
          q.eq("canonicalInboxId", inbox._id)
        )
        .take(20)
      : [];
    const managedResource = managedSes || smartleadManaged
      ? managedResourceRows.find((row) =>
          row.operationKey === inbox.managedTransportOperationKey &&
          row.generation === inbox.managedTransportGeneration &&
          row.adapterVersion === inbox.managedTransportAdapterVersion
        )
      : undefined;
    if (
      managedSes &&
      (!managedSesReceipt ||
        !managedResource ||
        managedResource.transportKind !== MANAGED_SES_TRANSPORT ||
        managedResource.lifecycleState !== "canonicalized" ||
        managedResource.releaseState !== "active" ||
        managedResource.canonicalInboxId !== inbox._id ||
        managedResource.resourceReceipt !==
          inbox.managedTransportResourceReceipt ||
        inbox.managedTransportKind !== MANAGED_SES_TRANSPORT ||
        inbox.credentialSource !== "managed_adapter" ||
        managedSesReceipt.resourceOperationKey !==
          inbox.managedTransportOperationKey ||
        managedSesReceipt.generation !== inbox.managedTransportGeneration ||
        managedSesReceipt.adapterVersion !==
          inbox.managedTransportAdapterVersion ||
        managedSesReceipt.resourceReceipt !==
          inbox.managedTransportResourceReceipt ||
        !/^[a-f0-9]{64}$/.test(managedSesReceipt.resourceReceipt) ||
        !/^[a-f0-9]{64}$/.test(
          managedSesReceipt.unsubscribeTokenHash,
        ) ||
        !Number.isFinite(managedSesReceipt.providerVerifiedAt) ||
        managedSesReceipt.providerVerifiedAt <= 0 ||
        managedSesReceipt.providerVerifiedAt > now + 5 * 60 * 1000 ||
        !managedSesInboxReceiptCurrent({
          inbox,
          now,
          expectedAdapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
        }))
    ) {
      return {
        claimed: false as const,
        reason:
          "The managed sender lacks a current exact signed status or event-canary receipt.",
      };
    }
    if (managedSes && managedSesReceipt && managedResource) {
      // The same exact signed status receipt advances both projections in one
      // transaction; One Setup never churns because only the inbox moved.
      await Promise.all([
        ctx.db.patch(inbox._id, {
          managedTransportResourceVerifiedAt:
            managedSesReceipt.providerVerifiedAt,
          updatedAt: now,
        }),
        ctx.db.patch(managedResource._id, {
          externalVerifiedAt: managedSesReceipt.providerVerifiedAt,
          updatedAt: now,
        }),
      ]);
    }
    if (!managedSes && managedSesReceipt) {
      return { claimed: false as const, reason: "Transport receipt mismatch." };
    }
    if (
      smartleadManaged &&
      (!managedResource ||
        managedResource.transportKind !== SMARTLEAD_MANAGED_TRANSPORT ||
        managedResource.lifecycleState !== "canonicalized" ||
        managedResource.releaseState !== "active" ||
        managedResource.canonicalInboxId !== inbox._id ||
        managedResource.operationKey !== inbox.managedTransportOperationKey ||
        managedResource.generation !== inbox.managedTransportGeneration ||
        managedResource.adapterVersion !== SMARTLEAD_ADAPTER_VERSION ||
        managedResource.resourceReceipt !== inbox.managedTransportResourceReceipt ||
        !managedResource.encryptedProviderBinding ||
        !managedResource.configurationHash ||
        !managedResource.domainAuthenticationReceipt ||
        managedResource.warmupState !== "verified" ||
        !managedResource.warmupEligibleAt ||
        managedResource.warmupEligibleAt > now ||
        !managedResource.deliveryCanaryReceipt ||
        !managedResource.replyCanaryReceipt ||
        !managedResource.bounceCanaryReceipt ||
        !managedResource.unsubscribeCanaryReceipt ||
        !managedResource.cancellationCanaryReceipt ||
        smartleadManagedInboxIssues({ inbox, now }).length > 0)
    ) {
      return {
        claimed: false as const,
        reason:
          "The Smartlead sender has not completed domain authentication, warm-up, and all controlled safety canaries.",
      };
    }
    if (
      release === "automatic" &&
      autonomousOutreachTransportIssues({
        inbox,
        now,
        managedSesAdapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
      }).length > 0
    ) {
      return {
        claimed: false as const,
        reason:
          "Autonomous outreach requires a current verified outbound transport.",
      };
    }
    if (
      await outboundIdentityUsedByAnotherTenant(
        ctx,
        siteId,
        inbox.fromEmail,
        inbox.senderDomain ?? "",
        inbox.provider,
      )
    ) {
      await ctx.db.patch(inbox._id, {
        mode: "approval",
        autonomyDisabledAt: now,
        lastError:
          "This outbound mailbox or sender domain is already connected to another tenant.",
        updatedAt: now,
      });
      await scheduleAutonomousSequenceCancellation(
        ctx,
        inbox,
        "The outbound mailbox or sender-domain ownership became ambiguous.",
      );
      return {
        claimed: false as const,
        reason:
          "The outbound mailbox or sender domain is already connected to another tenant.",
      };
    }
    if (
      (release === "approved" && !["approval", "live"].includes(inbox.mode)) ||
      (release === "automatic" &&
        (!autonomousOutreachConsentActive(inbox, site.userId) ||
          !autonomousOutreachReconciliationComplete(inbox)))
    ) {
      return {
        claimed: false as const,
        reason:
          release === "automatic"
            ? "The current tenant autonomy consent does not authorize delivery."
            : "This delivery was not released through the current owner-approved mode.",
      };
    }

    const configuredRelayDomain = normalizeInboundRelayDomain(
      process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    );
    const relayIsConfigured = inboundRelayConfigured(inboundRelayRuntimeConfig());
    const legacyGmailReadReady = Boolean(
      inbox.provider === "gmail" &&
      inbox.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ) &&
      (inbox.oauthRefreshToken || inbox.oauthAccessToken),
    );
    if (release === "automatic" && !inboundRelay && !smartleadManaged) {
      return {
        claimed: false as const,
        reason:
          "Automatic outreach requires the current signed reply/bounce/STOP relay.",
      };
    }
    if (!inboundRelay && !legacyGmailReadReady && !smartleadManaged) {
      return {
        claimed: false as const,
        reason:
          "The signed inbound relay is unavailable, so replies and opt-outs cannot be handled safely.",
      };
    }
    if (inboundRelay) {
      const aliasDomain = normalizeInboundRelayDomain(inboundRelay.aliasDomain);
      const aliasAddress = inboundRelay.aliasAddress.trim().toLowerCase();
      const outboundMessageId = normalizeRfcMessageId(
        inboundRelay.outboundRfcMessageId,
      );
      const expectedDsnRoutingTarget = await inboundRelayDsnRoutingTarget({
        siteId: String(siteId),
        inboxId: String(inbox._id),
        generation:
          inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
        relayDomain: configuredRelayDomain ?? undefined,
        secret: inboundRelayRuntimeConfig().dsnTargetSecret,
      });
      if (
        !relayIsConfigured ||
        !configuredRelayDomain ||
        aliasDomain !== configuredRelayDomain ||
        !aliasAddress.endsWith(`@${configuredRelayDomain}`) ||
        !/^reply-[a-z0-9_-]{32,64}@[a-z0-9.-]+$/i.test(aliasAddress) ||
        inboundRelayAliasHash(aliasAddress) !== inboundRelay.aliasHash ||
        !/^[a-f0-9]{64}$/.test(inboundRelay.aliasHash) ||
        !expectedDsnRoutingTarget ||
        inboundRelay.dsnRoutingTargetHash !==
          expectedDsnRoutingTarget.hash ||
        inboundRelay.dsnRoutingTargetVersion !==
          expectedDsnRoutingTarget.version ||
        (!managedSes && inboundRelay.dsnRoutingTargetHash !==
          inbox.inboundRelayDsnRoutingTargetHash) ||
        inboundRelay.dsnRoutingTargetVersion !==
          OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
        (!managedSes && inboundRelay.dsnRoutingTargetVersion !==
          inbox.inboundRelayDsnRoutingTargetVersion) ||
        inboundRelay.dsnRoutingTargetGeneration !==
          (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
        !outboundMessageId ||
        !outboundMessageId.endsWith(
          `@${normalizeDomain(inbox.senderDomain ?? "")}>`,
        ) ||
        (managedSes
          ? !managedSesInboxReceiptCurrent({
              inbox,
              now,
              expectedAdapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
            })
          : !inboundRelayDsnRoutingReady({
              inbox,
              now,
              rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
              runtimeConfig: inboundRelayRuntimeConfig(),
            }))
      ) {
        return {
          claimed: false as const,
          reason:
            "The signed inbound relay binding or hard-bounce routing canary is invalid or unavailable.",
        };
      }
    }

    // A migration or deletion sweep can materialize older sender-domain
    // reputation after this inbox connected. Read the global receipt inside
    // this mutation and merge it monotonically before the authoritative pacing
    // decision. The indexed read also serializes against a concurrent receipt
    // update, so the action preflight can never be the only cap boundary.
    const durablePacing = managedSes || smartleadManaged
      ? null
      : await readDurablePacingReceipt(
          ctx,
          site,
          inbox.senderDomain ?? inbox.fromEmail.split("@")[1] ?? "",
        );
    const activeDurablePacing =
      durablePacing && durablePacing.retainUntil > now
        ? durablePacing
        : null;
    if (
      !managedSes && !smartleadManaged &&
      activeDurablePacing &&
      activeDurablePacing.accountKey !== accountDeletionKey(site.userId!)
    ) {
      return {
        claimed: false as const,
        reason:
          "The sender domain remains reserved to another account's reputation window.",
      };
    }
    const effectivePacing = effectiveDurablePacingState({
      now,
      fromEmail: inbox.fromEmail,
      inboxWarmupStartedAt: inbox.warmupStartedAt,
      inboxSentToday: inbox.sentToday,
      inboxSentTodayDay: inbox.sentTodayDay,
      inboxLastSentAt: inbox.lastSentAt,
      durable: activeDurablePacing ?? undefined,
    });
    const effectiveInbox = { ...inbox, ...effectivePacing };

    const senderIssues = senderClaimIssues({
      siteDomain: site.domain,
      provider: inbox.provider,
      status: inbox.status,
      fromEmail: inbox.fromEmail,
      fromName: inbox.fromName,
      physicalMailingAddress: inbox.physicalMailingAddress,
      complianceConfirmedAt: inbox.complianceConfirmedAt,
      verifiedAt: inbox.verifiedAt,
      oauthScopes: inbox.oauthScopes,
      hasCredential: Boolean(inbox.oauthRefreshToken || inbox.oauthAccessToken),
      senderDomain: inbox.senderDomain,
    });
    const dnsIssues = managedSes || smartleadManaged ? [] : liveDnsEvidenceIssues({
      checkedAt: dnsEvidence.checkedAt,
      now,
      senderDomain: dnsEvidence.senderDomain,
      expectedSenderDomain: inbox.senderDomain,
      dkimSelector: dnsEvidence.dkimSelector,
      expectedDkimSelector: inbox.dkimSelector,
      spf: dnsEvidence.spf,
      dkim: dnsEvidence.dkim,
      dmarc: dnsEvidence.dmarc,
    });
    if (senderIssues.length > 0 || dnsIssues.length > 0) {
      await ctx.db.patch(inbox._id, {
        ...(managedSes || smartleadManaged
          ? {
              managedTransportResourceVerifiedAt:
                managedSesReceipt?.providerVerifiedAt,
            }
          : {
        dnsCheckedAt: dnsEvidence.checkedAt,
        spfVerifiedAt: dnsEvidence.spf ? dnsEvidence.checkedAt : undefined,
        dkimVerifiedAt: dnsEvidence.dkim ? dnsEvidence.checkedAt : undefined,
        dmarcVerifiedAt: dnsEvidence.dmarc ? dnsEvidence.checkedAt : undefined,
            }),
        ...(dnsIssues.length > 0
          ? { status: "connected", mode: "approval", verifiedAt: undefined }
          : {}),
        lastError:
          dnsIssues[0] ?? senderIssues[0] ?? "The current sender is not ready.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The current sender or its live DNS evidence is not ready for delivery.",
      };
    }

    const pacing = outreachSendDecision({
      inbox: effectiveInbox,
      now,
      release,
    });
    if (!pacing.allowed) return { claimed: false as const, reason: pacing.reason };

    const message = await ctx.db.get(opportunityEvidence.messageId);
    if (
      !message ||
      message.siteId !== siteId ||
      !outreachMessageMatchesCurrentDomain(site, message) ||
      !outreachMessageOwnerMatches(
        message,
        inbox.credentialOwnerAccountKey,
      ) ||
      message.status !== "approved" ||
      (message.scheduledAt ?? 0) > now
    ) {
      return {
        claimed: false as const,
        reason:
          release === "automatic"
            ? "No consent-authorized message is due."
            : "No owner-approved message is ready.",
      };
    }
    if (
      !Number.isSafeInteger(message.sequenceStep) ||
      message.sequenceStep < 0 ||
      message.sequenceStep > MAX_SEQUENCE_STEP
    ) {
      await ctx.db.patch(message._id, {
        status: "skipped",
        blockedReason:
          "The outreach sequence step is outside the consent-authorized range.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The outreach sequence step is invalid.",
      };
    }
    if (
      smartleadManaged &&
      (message.sequenceStep !== 0 ||
        !message.providerPlannedSequence ||
        message.providerPlannedSequence.length < 1 ||
        message.providerPlannedSequence.length > 3 ||
        message.providerPlannedSequence.some((entry, index) =>
          entry.sequenceStep !== index ||
          entry.delayDays < 0 || entry.delayDays > 30 ||
          !entry.subject.trim() || entry.subject.length > 240 ||
          !entry.body.trim() || entry.body.length > 20_000
        ))
    ) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason:
          "The Smartlead sequence is not an exact bounded one-to-three-message Pentra plan.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The managed sequence requires a fresh policy-approved draft.",
      };
    }
    if (message.sequenceStep > 0 && release !== "automatic") {
      await ctx.db.patch(message._id, {
        status: "skipped",
        blockedReason:
          "Follow-ups require the exact current account-autopilot consent and cannot use the one-message owner release path.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "This follow-up is not authorized by the owner-message release path.",
      };
    }
    const automaticAuthorizationMatches =
      autonomousMessageAuthorizationMatches({
        inbox,
        ownerId: site.userId,
        approvalKind: message.approvalKind,
        approvalConsentVersion: message.approvalConsentVersion,
        approvalConsentPolicyHash: message.approvalConsentPolicyHash,
        approvalConsentAcceptedAt: message.approvalConsentAcceptedAt,
      });
    if (
      (release === "automatic" && !automaticAuthorizationMatches) ||
      (release === "approved" &&
        message.approvalKind === "account_autopilot")
    ) {
      return {
        claimed: false as const,
        reason: "The message is not authorized by this release path.",
      };
    }

    if (
      !approvalMatchesInbox({
        messageInboxId: message.inboxId,
        approvedInboxId: message.approvedInboxId,
        approvedInboxConfigurationVersion:
          message.approvedInboxConfigurationVersion,
        inboxId: inbox._id,
        inboxConfigurationVersion: inbox.configurationVersion,
      })
    ) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason:
          "The approved draft is bound to an older sender connection or compliance profile. Regenerate and approve a fresh draft.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The approved draft uses a stale sender profile and requires a fresh review.",
      };
    }

    let deliveryThreadId: string | undefined;
    let deliveryInReplyToRfcMessageId: string | undefined;
    if (message.sequenceStep > 0) {
      const [candidate, replied, bounced] = await Promise.all([
        message.parentMessageId ? ctx.db.get(message.parentMessageId) : null,
        ctx.db
          .query("outreach_messages")
          .withIndex("by_thread_owner_status", (q) =>
            q
              .eq("threadKey", message.threadKey)
              .eq("ownerAccountKey", inbox.credentialOwnerAccountKey)
              .eq("status", "replied")
          )
          .first(),
        ctx.db
          .query("outreach_messages")
          .withIndex("by_thread_owner_status", (q) =>
            q
              .eq("threadKey", message.threadKey)
              .eq("ownerAccountKey", inbox.credentialOwnerAccountKey)
              .eq("status", "bounced")
          )
          .first(),
      ]);
      const predecessor = candidate;
      const threadStopped = Boolean(replied || bounced);
      if (managedSes) {
        const predecessorDecision = managedSesFollowUpPredecessorDecision({
          message,
          predecessor,
          ownerAccountKey: inbox.credentialOwnerAccountKey!,
          threadStopped,
        });
        if (!predecessorDecision.allowed) {
          await ctx.db.patch(message._id, {
            status: "skipped",
            blockedReason: predecessorDecision.reason === "thread_stopped"
              ? "The recipient replied, opted out, or bounced before this follow-up became due."
              : "The exact signed managed-sender predecessor or thread receipt is unavailable; Pentra will not send an unthreaded follow-up.",
            updatedAt: now,
          });
          return {
            claimed: false as const,
            reason: "The follow-up sequence is no longer eligible.",
          };
        }
      } else {
        const predecessorDecision = followUpPredecessorDecision({
          message,
          predecessor,
          ownerAccountKey: inbox.credentialOwnerAccountKey!,
          threadStopped,
        });
        const transientInReplyTo = predecessorDecision.allowed &&
            predecessor?.deliveryAttemptId
          ? await inboundRelayOutboundMessageIdForAttempt({
              siteId: String(siteId),
              inboxId: String(inbox._id),
              deliveryAttemptId: predecessor.deliveryAttemptId,
              senderDomain: inbox.senderDomain ?? "",
              secret: inboundRelayRuntimeConfig().dsnTargetSecret,
            })
          : null;
        const exactTransientReference = Boolean(
          transientInReplyTo &&
          predecessor?.inboundRelayOutboundMessageIdHash &&
          inboundRelayMessageIdHash(transientInReplyTo) ===
            predecessor.inboundRelayOutboundMessageIdHash &&
          message.inReplyToRfcMessageIdHash ===
            predecessor.inboundRelayOutboundMessageIdHash,
        );
        if (!predecessorDecision.allowed || !exactTransientReference) {
          await ctx.db.patch(message._id, {
            status: "skipped",
            blockedReason: !predecessorDecision.allowed &&
                predecessorDecision.reason === "thread_stopped"
              ? "The recipient replied, opted out, or bounced before this follow-up became due."
              : "The exact accepted predecessor, Gmail thread, or message identity is unavailable; Pentra will not send an unthreaded follow-up.",
            updatedAt: now,
          });
          return {
            claimed: false as const,
            reason: "The follow-up sequence is no longer eligible.",
          };
        }
        deliveryThreadId = predecessorDecision.providerThreadId;
        deliveryInReplyToRfcMessageId = transientInReplyTo!;
      }
    }

    const opportunity = await ctx.db.get(message.opportunityId);
    let targetPublicationMatches = opportunity?.type !== "broken_link";
    if (opportunity?.type === "broken_link" && opportunity.articleId) {
      const article = await ctx.db.get(opportunity.articleId);
      const target = article
        ? verifiedAuthorityTarget({ site, article, now })
        : null;
      try {
        targetPublicationMatches = Boolean(
          target &&
          target.targetUrl === opportunity.targetUrl &&
          opportunityEvidence.targetReceiptUrl &&
          canonicalPublicationUrl(opportunityEvidence.targetReceiptUrl) ===
            canonicalPublicationUrl(opportunity.targetUrl) &&
          Number.isFinite(opportunityEvidence.targetCheckedAt) &&
          opportunityEvidence.targetCheckedAt! <= now + 5_000 &&
          now - opportunityEvidence.targetCheckedAt! <=
            OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS,
        );
      } catch {
        targetPublicationMatches = false;
      }
    }
    if (
      message.sequenceStep > 0 &&
      opportunity &&
      ["acquired", "rejected"].includes(opportunity.status)
    ) {
      await ctx.db.patch(message._id, {
        status: "skipped",
        blockedReason:
          opportunity.status === "acquired"
            ? "The exact backlink was acquired before this follow-up became due."
            : "The authority opportunity is no longer verified.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The authority opportunity no longer needs a follow-up.",
      };
    }
    const opportunityLifecycleMatches = Boolean(
      opportunity &&
        (message.sequenceStep === 0
          ? opportunity.status === "outreach_prepared" &&
            opportunityEvidenceIsFresh({
              verifiedAt: opportunity.verifiedAt,
              now,
            })
          : opportunity.status === "contacted"),
    );
    if (
      !opportunity ||
      opportunity.siteId !== siteId ||
      !authorityOpportunityMatchesCurrentDomain(site, opportunity) ||
      !opportunityLifecycleMatches ||
      opportunityEvidence.messageId !== message._id ||
      opportunityEvidence.opportunityId !== opportunity._id ||
      !Number.isFinite(opportunityEvidence.checkedAt) ||
      opportunityEvidence.checkedAt > now + 5_000 ||
      now - opportunityEvidence.checkedAt >
        OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS ||
      opportunityEvidence.evidenceHash !== opportunity.evidenceHash ||
      !message.opportunityEvidenceHash ||
      message.opportunityEvidenceHash !== opportunity.evidenceHash ||
      message.opportunitySourceUrl !== opportunity.sourceUrl ||
      message.opportunityTargetUrl !== opportunity.targetUrl ||
      !targetPublicationMatches ||
      outreachOrganisationDomain(opportunity.sourceDomain) !==
        outreachOrganisationDomain(message.toDomain)
    ) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason:
          "The authority opportunity no longer matches verified tenant evidence. Regenerate and review the draft.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The approved message no longer has matching verified opportunity evidence.",
      };
    }

    const complianceIssues = outreachComplianceIssues({
      body: message.body,
      toEmail: message.toEmail,
      fromEmail: inbox.fromEmail,
      brandName: site.siteName || normalizeDomain(site.domain).split(".")[0],
      physicalMailingAddress: inbox.physicalMailingAddress,
    });
    if (complianceIssues.length > 0 || (message.complianceIssues ?? []).length > 0) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason:
          "The approved message no longer passes the current delivery compliance checks.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The approved message requires a fresh compliance review.",
      };
    }

    const [
      localDomainSuppressed,
      localEmailSuppressed,
      lastContactedAt,
      contact,
    ] = await Promise.all([
      siteSuppressionExists(ctx, siteId, "domain", message.toDomain),
      siteSuppressionExists(ctx, siteId, "email", message.toEmail),
      latestTenantContactAt(ctx, site, message.toDomain, now),
      ctx.db
        .query("outreach_contacts")
        .withIndex("by_site_email", (q) =>
          q.eq("siteId", siteId).eq("email", message.toEmail),
        )
        .unique(),
    ]);
    if (
      !contact ||
      contact.ownerAccountKey !== inbox.credentialOwnerAccountKey ||
      outreachOrganisationDomain(contact.domain) !==
        outreachOrganisationDomain(message.toDomain) ||
      !contact.discoveredFromUrl ||
      contact.email !== opportunityEvidence.contactEmail ||
      contact.discoveredFromUrl !== opportunityEvidence.contactReceiptUrl ||
      !Number.isFinite(opportunityEvidence.contactCheckedAt) ||
      opportunityEvidence.contactCheckedAt > now + 5_000 ||
      now - opportunityEvidence.contactCheckedAt >
        OUTREACH_LIVE_OPPORTUNITY_EVIDENCE_MAX_AGE_MS
    ) {
      await ctx.db.patch(message._id, {
        status: "failed",
        failureReason:
          "The recipient no longer has a matching observed contact receipt. Regenerate and review the draft.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason: "The recipient contact evidence requires a fresh review.",
      };
    }
    const [persistentDomainSuppressed, persistentEmailSuppressed] =
      await Promise.all([
        persistentSuppressionExists(
          ctx,
          site,
          "domain",
          message.toDomain,
        ),
        persistentSuppressionExists(
          ctx,
          site,
          "email",
          message.toEmail,
        ),
      ]);
    if (
      localDomainSuppressed ||
      localEmailSuppressed ||
      persistentDomainSuppressed ||
      persistentEmailSuppressed
    ) {
      await ctx.db.patch(message._id, {
        status: "skipped",
        blockedReason:
          "The recipient previously opted out or bounced for this tenant brand.",
        updatedAt: now,
      });
      return {
        claimed: false as const,
        reason:
          "The recipient is permanently suppressed for this tenant brand.",
      };
    }
    if (message.sequenceStep === 0) {
      const eligibility = contactEligibility({
        sourceDomain: message.toDomain,
        toEmail: message.toEmail,
        now,
        history: lastContactedAt
          ? [{ domain: message.toDomain, lastContactedAt }]
          : undefined,
      });
      if (!eligibility.eligible) {
        await ctx.db.patch(message._id, {
          status: "failed",
          failureReason: eligibility.reason.slice(0, 500),
          updatedAt: now,
        });
        return { claimed: false as const, reason: eligibility.reason };
      }

      const durableReservation = await reserveDurableContactClaim(
        ctx,
        site,
        message.toDomain,
        attemptId,
        now,
        now + DOMAIN_CONTACT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
        DOMAIN_CONTACT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
      );
      if (!durableReservation.reserved) {
        return {
          claimed: false as const,
          reason:
            "Another tenant-brand send already reserved or contacted this recipient domain.",
        };
      }
    }

    const deliveryLeaseExpiresAt = now + (
      smartleadManaged
        ? SMARTLEAD_DELIVERY_LEASE_MS
        : OUTREACH_DELIVERY_LEASE_MS
    );
    await ctx.db.patch(inbox._id, {
      ...effectivePacing,
      ...(managedSes
        ? {
            managedTransportResourceVerifiedAt:
              managedSesReceipt!.providerVerifiedAt,
          }
        : smartleadManaged
          ? {}
        : {
            dnsCheckedAt: dnsEvidence.checkedAt,
            spfVerifiedAt: dnsEvidence.checkedAt,
            dkimVerifiedAt: dnsEvidence.checkedAt,
            dmarcVerifiedAt: dnsEvidence.checkedAt,
          }),
      lastError: undefined,
      updatedAt: now,
    });
    await ctx.db.patch(message._id, {
      status: "sending",
      deliveryOwnerAccountKey: inbox.credentialOwnerAccountKey,
      deliveryAttemptId: attemptId,
      deliveryClaimedAt: now,
      deliveryLeaseExpiresAt,
      deliveryLeaseExpiredAt: undefined,
      deliveryBoundaryVersion: 1,
      deliveryExternalAttemptedAt: undefined,
      failureReason: undefined,
      ...(managedSes
        ? {
            deliveryTransport: MANAGED_SES_TRANSPORT,
            managedSesOperationKey: attemptId,
            managedSesResourceOperationKey:
              managedSesReceipt!.resourceOperationKey,
            managedSesGeneration: managedSesReceipt!.generation,
            managedSesAdapterVersion: managedSesReceipt!.adapterVersion,
            managedSesUnsubscribeTokenHash:
              managedSesReceipt!.unsubscribeTokenHash,
          }
        : smartleadManaged
          ? {
              deliveryTransport: SMARTLEAD_MANAGED_TRANSPORT,
              providerOperationKey: smartleadOperationKey({
                siteId: String(siteId),
                inboxGeneration: inbox.managedTransportGeneration!,
                campaignGeneration: inbox.managedTransportGeneration!,
                messageId: String(message._id),
                sequenceStep: message.sequenceStep,
              }),
              providerCampaignGeneration: inbox.managedTransportGeneration!,
              providerAcknowledgementState: "claimed",
            }
        : {
            deliveryTransport: inbox.provider === "smtp"
              ? "smtp"
              : "gmail_oauth",
          }),
      ...(inboundRelay
        ? {
            inboundRelayAliasHash: inboundRelay.aliasHash,
            inboundRelayAliasDomain: normalizeInboundRelayDomain(
              inboundRelay.aliasDomain,
            )!,
            // Gmail receives this locally generated RFC Message-ID. Managed
            // SES does not: its actual RFC digest is accepted only from the
            // exact signed send/status/event receipt after provider identity
            // exists.
            inboundRelayOutboundMessageIdHash: managedSes
              ? undefined
              : inboundRelayMessageIdHash(inboundRelay.outboundRfcMessageId),
            inboundRelayRolloutEpoch: site.autopilotRolloutEpoch ?? 0,
            inboundRelayInboxConfigurationVersion:
              inbox.configurationVersion ?? 0,
            inboundRelaySenderDomain: normalizeDomain(
              inbox.senderDomain ?? "",
            ),
            inboundRelayDsnRoutingTargetHash:
              inboundRelay.dsnRoutingTargetHash,
            inboundRelayDsnRoutingTargetVersion:
              inboundRelay.dsnRoutingTargetVersion,
            inboundRelayDsnRoutingTargetGeneration:
              inboundRelay.dsnRoutingTargetGeneration,
          }
        : {}),
      updatedAt: now,
    });
    // Claim-owned wake closes action death before either provider-boundary
    // mutation. The exact attempt is safely restored when no marker exists,
    // or quarantined no-replay when a boundary marker won.
    await ctx.scheduler.runAt(
      deliveryLeaseExpiresAt + 1_000,
      internal.outreach.recoverApprovedDeliveryBoundaryLease,
      { siteId, messageId: message._id, attemptId },
    );
    return {
      claimed: true as const,
      attemptId,
      inbox: effectiveInbox,
      message,
      deliveryThreadId,
      deliveryInReplyToRfcMessageId,
      leaseExpiresAt: deliveryLeaseExpiresAt,
    };
  },
});

type DeliveryBoundaryTransport =
  | "gmail"
  | "smtp"
  | typeof MANAGED_SES_TRANSPORT
  | typeof SMARTLEAD_MANAGED_TRANSPORT;

type DeliveryBoundaryArgs = {
  siteId: Id<"sites">;
  messageId: Id<"outreach_messages">;
  attemptId: string;
  release: "approved" | "automatic";
  expectedParentMessageId?: Id<"outreach_messages">;
  expectedProviderThreadId?: string;
  expectedInReplyToRfcMessageIdHash?: string;
  expectedManagedParentOperationKey?: string;
  expectedManagedParentThreadReceipt?: string;
};

async function terminalizeClaimedDeliveryBeforeProvider(
  ctx: MutationCtx,
  message: Doc<"outreach_messages">,
  attemptId: string,
  timestamp: number,
  reason: string,
) {
  if (
    message.status === "sending" &&
    message.deliveryAttemptId === attemptId &&
    message.deliveryBoundaryVersion === 1 &&
    !message.deliveryExternalAttemptedAt &&
    !message.managedSesExternalAttemptedAt
  ) {
    await ctx.db.patch(message._id, {
      status: "skipped",
      deliveryLeaseExpiredAt: timestamp,
      deliveryLeaseExpiresAt: undefined,
      managedSesUnsubscribeTokenHash: undefined,
      blockedReason: reason.slice(0, 500),
      failureReason: reason.slice(0, 500),
      updatedAt: timestamp,
    });
  }
  if (message.deliveryOwnerAccountKey) {
    await releaseDurableContactClaimForAccount(
      ctx,
      message.deliveryOwnerAccountKey,
      message.toDomain,
      attemptId,
      timestamp,
    );
  }
  return {
    authorized: false as const,
    marked: false as const,
    externalAttempted: false as const,
    terminalized: true as const,
    reason: "delivery_authorization_changed" as const,
  };
}

async function deferClaimedDeliveryBeforeProvider(
  ctx: MutationCtx,
  message: Doc<"outreach_messages">,
  timestamp: number,
  nextEligibleAt: number,
  reason: string,
  pacingDeferred = true,
) {
  const deferredUntil = Math.max(timestamp + 1_000, nextEligibleAt);
  await ctx.db.patch(message._id, {
    status: "approved",
    scheduledAt: deferredUntil,
    deliveryOwnerAccountKey: undefined,
    deliveryAttemptId: undefined,
    deliveryClaimedAt: undefined,
    deliveryLeaseExpiresAt: undefined,
    deliveryLeaseExpiredAt: undefined,
    deliveryBoundaryVersion: undefined,
    deliveryExternalAttemptedAt: undefined,
    deliveryTransport: undefined,
    managedSesOperationKey: undefined,
    managedSesResourceOperationKey: undefined,
    managedSesGeneration: undefined,
    managedSesAdapterVersion: undefined,
    managedSesExternalAttemptedAt: undefined,
    managedSesProviderMessageIdDigest: undefined,
    managedSesThreadReceipt: undefined,
    managedSesDispositionState: undefined,
    managedSesDispositionAuthorizedAt: undefined,
    managedSesDispositionAuthorizationReceipt: undefined,
    managedSesDispositionLeaseToken: undefined,
    managedSesDispositionLeaseExpiresAt: undefined,
    managedSesDispositionExternalAttemptedAt: undefined,
    managedSesDispositionSettledAt: undefined,
    managedSesUnsubscribeTokenHash: undefined,
    inboundRelayAliasHash: undefined,
    inboundRelayAliasDomain: undefined,
    inboundRelayOutboundMessageIdHash: undefined,
    inboundRelayRolloutEpoch: undefined,
    inboundRelayInboxConfigurationVersion: undefined,
    inboundRelaySenderDomain: undefined,
    inboundRelayDsnRoutingTargetHash: undefined,
    inboundRelayDsnRoutingTargetVersion: undefined,
    inboundRelayDsnRoutingTargetGeneration: undefined,
    failureReason: undefined,
    blockedReason: undefined,
    pacingReason: pacingDeferred ? reason.slice(0, 500) : undefined,
    updatedAt: timestamp,
  });
  if (message.deliveryOwnerAccountKey && message.deliveryAttemptId) {
    await releaseDurableContactClaimForAccount(
      ctx,
      message.deliveryOwnerAccountKey,
      message.toDomain,
      message.deliveryAttemptId,
      timestamp,
    );
  }
  await ctx.scheduler.runAt(
    deferredUntil,
    internal.actions.outreachFleet.runSite,
    { siteId: message.siteId, phase: "delivery" },
  );
  return {
    marked: false as const,
    externalAttempted: false as const,
    deferred: true as const,
    nextEligibleAt: deferredUntil,
    reason,
  };
}

/** Shared last-mutation authorization fence for both Gmail and managed SES.
 * Every reply, STOP, unsubscribe, suppression, consent, owner, configuration,
 * parent, thread and lease write conflicts with these reads before a provider
 * message call can begin. */
async function authorizeClaimedDeliveryAtExternalBoundary(
  ctx: MutationCtx,
  args: DeliveryBoundaryArgs,
  expectedTransport: DeliveryBoundaryTransport,
) {
  const timestamp = Date.now();
  const message = await ctx.db.get(args.messageId);
  if (!message || message.siteId !== args.siteId) {
    return {
      authorized: false as const,
      marked: false as const,
      externalAttempted: false as const,
    };
  }
  if (
    message.deliveryExternalAttemptedAt ||
    message.managedSesExternalAttemptedAt
  ) {
    return {
      authorized: false as const,
      marked: false as const,
      externalAttempted: true as const,
    };
  }
  const [site, inbox, opportunity] = await Promise.all([
    ctx.db.get(args.siteId),
    message.inboxId ? ctx.db.get(message.inboxId) : null,
    ctx.db.get(message.opportunityId),
  ]);
  const ownerAccountKey = site?.userId
    ? accountDeletionKey(site.userId)
    : undefined;
  const managedSes = expectedTransport === MANAGED_SES_TRANSPORT;
  const smartleadManaged = expectedTransport === SMARTLEAD_MANAGED_TRANSPORT;
  const releaseAuthorized = Boolean(
    site?.userId &&
      inbox &&
      (args.release === "automatic"
        ? autonomousOutreachRuntimeEnabled(
            process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
          ) &&
          isSeoGrowthActuationEligible(site) &&
          autonomousOutreachConsentActive(inbox, site.userId) &&
          autonomousOutreachReconciliationComplete(inbox) &&
          autonomousMessageAuthorizationMatches({
            inbox,
            ownerId: site.userId,
            approvalKind: message.approvalKind,
            approvalConsentVersion: message.approvalConsentVersion,
            approvalConsentPolicyHash: message.approvalConsentPolicyHash,
            approvalConsentAcceptedAt: message.approvalConsentAcceptedAt,
          })
        : ["approval", "live"].includes(inbox.mode) &&
          message.approvalKind !== "account_autopilot"),
  );
  const coreAuthorized = Boolean(
    site?.userId &&
      !site.deletionStatus &&
      !site.accountDeletionRequestedAt &&
      inbox &&
      ownerAccountKey &&
      message.status === "sending" &&
      message.deliveryAttemptId === args.attemptId &&
      message.deliveryBoundaryVersion === 1 &&
      (message.deliveryLeaseExpiresAt ?? 0) > timestamp &&
      message.deliveryOwnerAccountKey === ownerAccountKey &&
      outreachMessageMatchesCurrentDomain(site, message) &&
      outreachMessageOwnerMatches(message, ownerAccountKey) &&
      message.inboxId === inbox._id &&
      inbox.siteId === site._id &&
      inbox.credentialOwnerAccountKey === ownerAccountKey &&
      !["disconnected", "suspended"].includes(inbox.status) &&
      approvalMatchesInbox({
        messageInboxId: message.inboxId,
        approvedInboxId: message.approvedInboxId,
        approvedInboxConfigurationVersion:
          message.approvedInboxConfigurationVersion,
        inboxId: inbox._id,
        inboxConfigurationVersion: inbox.configurationVersion,
      }) &&
      (!message.inboundRelayAliasHash ||
        (message.inboundRelayInboxConfigurationVersion ===
          (inbox.configurationVersion ?? 0) &&
          message.inboundRelayRolloutEpoch ===
            (site.autopilotRolloutEpoch ?? 0) &&
          message.inboundRelaySenderDomain ===
            normalizeDomain(inbox.senderDomain ?? "") &&
          message.inboundRelayDsnRoutingTargetHash ===
            inbox.inboundRelayDsnRoutingTargetHash &&
          message.inboundRelayDsnRoutingTargetVersion ===
            inbox.inboundRelayDsnRoutingTargetVersion &&
          message.inboundRelayDsnRoutingTargetGeneration ===
            inbox.inboundRelayDsnRoutingTargetGeneration)) &&
      (managedSes
        ? message.deliveryTransport === MANAGED_SES_TRANSPORT &&
          inbox.provider === MANAGED_SES_TRANSPORT &&
          inbox.credentialSource === "managed_adapter"
        : smartleadManaged
          ? message.deliveryTransport === SMARTLEAD_MANAGED_TRANSPORT &&
            inbox.provider === "smartlead" &&
            inbox.managedTransportKind === SMARTLEAD_MANAGED_TRANSPORT &&
            inbox.credentialSource === "managed_adapter"
        : expectedTransport === "smtp"
          ? message.deliveryTransport === "smtp" &&
            inbox.provider === "smtp" &&
            Boolean(
              inbox.smtpHost && inbox.smtpPort && inbox.smtpUsername &&
              inbox.smtpPassword,
            )
          : message.deliveryTransport === "gmail_oauth" &&
            inbox.provider === "gmail" &&
            Boolean(inbox.oauthRefreshToken || inbox.oauthAccessToken)) &&
      message.parentMessageId === args.expectedParentMessageId &&
      message.deliveryExpectedThreadId === args.expectedProviderThreadId &&
      message.inReplyToRfcMessageIdHash ===
        args.expectedInReplyToRfcMessageIdHash &&
      message.managedSesParentOperationKey ===
        args.expectedManagedParentOperationKey &&
      message.managedSesParentThreadReceipt ===
        args.expectedManagedParentThreadReceipt,
  );
  const executionAuthorized = site
    ? await siteExecutionAuthorized(ctx, site)
    : false;
  const opportunityCurrent = Boolean(
    site &&
      opportunity &&
      deliveryOpportunityBoundaryCurrent({
        messageSiteId: String(message.siteId),
        opportunitySiteId: String(opportunity.siteId),
        sequenceStep: message.sequenceStep,
        opportunityStatus: opportunity.status,
        messageEvidenceHash: message.opportunityEvidenceHash,
        opportunityEvidenceHash: opportunity.evidenceHash,
        messageSourceUrl: message.opportunitySourceUrl,
        opportunitySourceUrl: opportunity.sourceUrl,
        messageTargetUrl: message.opportunityTargetUrl,
        opportunityTargetUrl: opportunity.targetUrl,
        currentDomainBinding:
          authorityOpportunityMatchesCurrentDomain(site, opportunity),
        initialEvidenceFresh: opportunityEvidenceIsFresh({
          verifiedAt: opportunity.verifiedAt,
          now: timestamp,
        }),
      })
  );
  // Managed SES proves its separate signed resource/inbound canary below.
  // A relay-bound Gmail message must re-prove the finite DSN canary here;
  // an intentional legacy readonly delivery has no relay binding to recheck.
  const inboundRelayCurrent = managedSes || smartleadManaged ||
    !message.inboundRelayAliasHash ||
    inboundRelayDsnRoutingReady({
      inbox,
      now: timestamp,
      rolloutEpoch: site?.autopilotRolloutEpoch ?? 0,
      runtimeConfig: inboundRelayRuntimeConfig(),
    });
  if (
    !site ||
    !inbox ||
    !ownerAccountKey ||
    !coreAuthorized ||
    !executionAuthorized
  ) {
    return terminalizeClaimedDeliveryBeforeProvider(
      ctx,
      message,
      args.attemptId,
      timestamp,
      "Delivery authorization, ownership, consent, or sender configuration changed before the provider boundary.",
    );
  }

  const [
    localDomainSuppressed,
    localEmailSuppressed,
    persistentDomainSuppressed,
    persistentEmailSuppressed,
    replied,
    bounced,
    predecessor,
  ] = await Promise.all([
    siteSuppressionExists(ctx, args.siteId, "domain", message.toDomain),
    siteSuppressionExists(ctx, args.siteId, "email", message.toEmail),
    persistentSuppressionExists(ctx, site, "domain", message.toDomain),
    persistentSuppressionExists(ctx, site, "email", message.toEmail),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_thread_owner_status", (q) =>
        q
          .eq("threadKey", message.threadKey)
          .eq("ownerAccountKey", ownerAccountKey)
          .eq("status", "replied"))
      .first(),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_thread_owner_status", (q) =>
        q
          .eq("threadKey", message.threadKey)
          .eq("ownerAccountKey", ownerAccountKey)
          .eq("status", "bounced"))
      .first(),
    message.parentMessageId ? ctx.db.get(message.parentMessageId) : null,
  ]);
  const threadStopped = Boolean(replied || bounced);
  const parentAuthorized = message.sequenceStep === 0 || (
    managedSes
      ? managedSesFollowUpPredecessorDecision({
          message,
          predecessor,
          ownerAccountKey,
          threadStopped,
        }).allowed
      : followUpPredecessorDecision({
          message,
          predecessor,
          ownerAccountKey,
          threadStopped,
      }).allowed
  );
  const boundaryDecision = deliveryExternalBoundaryDecision({
    alreadyExternalAttempted: false,
    exactClaimCurrent: coreAuthorized,
    siteExecutionAuthorized: executionAuthorized,
    ownerAndConfigurationCurrent: coreAuthorized,
    consentCurrent: releaseAuthorized,
    recipientUnsuppressed: !(
      localDomainSuppressed ||
      localEmailSuppressed ||
      persistentDomainSuppressed ||
      persistentEmailSuppressed
    ),
    threadCurrent: !threadStopped,
    predecessorCurrent: parentAuthorized,
    opportunityEvidenceCurrent: opportunityCurrent,
    inboundRelayCurrent,
  });
  if (!boundaryDecision.providerCallAllowed) {
    return terminalizeClaimedDeliveryBeforeProvider(
      ctx,
      message,
      args.attemptId,
      timestamp,
      "The recipient replied, opted out, bounced, became suppressed, or the verified opportunity changed before the provider boundary.",
    );
  }
  return {
    authorized: true as const,
    message,
    site,
    inbox,
    timestamp,
  };
}

/** The claim reserves app state; this second CAS is the exact provider
 * boundary. A pre-boundary action death is safely retryable as a fresh draft,
 * while any post-boundary ambiguity is status/event/disposition-only. */
export const markManagedSesDeliveryExternalBoundary = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    release: deliveryReleaseValidator,
    expectedParentMessageId: v.optional(v.id("outreach_messages")),
    expectedProviderThreadId: v.optional(v.string()),
    expectedInReplyToRfcMessageIdHash: v.optional(v.string()),
    expectedManagedParentOperationKey: v.optional(v.string()),
    expectedManagedParentThreadReceipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authorization = await authorizeClaimedDeliveryAtExternalBoundary(
      ctx,
      args,
      MANAGED_SES_TRANSPORT,
    );
    if (!authorization.authorized) return authorization;
    const { message, site, inbox, timestamp } = authorization;
    const resourceRows = inbox
      ? await ctx.db
        .query("managed_outreach_mailbox_resources")
        .withIndex("by_canonical_inbox", (q) =>
          q.eq("canonicalInboxId", inbox._id)
        )
        .take(20)
      : [];
    const resource = resourceRows.find((row) =>
      row.operationKey === message.managedSesResourceOperationKey &&
      row.generation === message.managedSesGeneration &&
      row.adapterVersion === message.managedSesAdapterVersion
    ) ?? null;
    const request = resource ? await ctx.db.get(resource.requestId) : null;
    const requestFence = site && request && resource
      ? managedOutreachMailboxRequestFenceIssues({
          siteActive: Boolean(
            site.userId &&
              !site.deletionStatus &&
              !site.accountDeletionRequestedAt,
          ),
          requestMode: request.outreachMailbox.mode,
          requestOwnerAccountKey: request.ownerAccountKey,
          currentOwnerAccountKey: site.userId
            ? accountDeletionKey(site.userId)
            : undefined,
          requestDomainSnapshot: request.domainSnapshot,
          currentDomainSnapshot: siteCanonicalDomain(site),
          requestDomainRevisionSnapshot: request.domainRevisionSnapshot,
          currentDomainRevision: siteCanonicalDomainRevision(site),
          expectedConfigurationRevision:
            resource.requestConfigurationRevision,
          actualConfigurationRevision: request.configurationRevision,
          expectedGeneration: resource.generation,
          actualGeneration: request.outreachMailboxGeneration,
          expectedContractVersion: ONE_SETUP_CONTRACT_VERSION,
          actualContractVersion: request.contractVersion,
        })
      : ["managed_resource_or_request_missing"];
    if (
      !resource ||
      !request ||
      requestFence.length > 0 ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" ||
      resource.releaseState !== "active" ||
      resource.canonicalInboxId !== inbox._id ||
      resource.siteId !== site._id ||
      resource.requestId !== request._id ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      resource.domainSnapshot !== request.domainSnapshot ||
      resource.domainRevisionSnapshot !== request.domainRevisionSnapshot ||
      resource.requestContractVersion !== request.contractVersion ||
      inbox.managedTransportKind !== MANAGED_SES_TRANSPORT ||
      message.managedSesOperationKey !== args.attemptId ||
      message.managedSesResourceOperationKey !==
        inbox.managedTransportOperationKey ||
      message.managedSesResourceOperationKey !== resource.operationKey ||
      message.managedSesGeneration !== inbox.managedTransportGeneration ||
      message.managedSesGeneration !== resource.generation ||
      message.managedSesAdapterVersion !==
        inbox.managedTransportAdapterVersion ||
      message.managedSesAdapterVersion !== resource.adapterVersion ||
      resource.resourceReceipt !== inbox.managedTransportResourceReceipt ||
      request.outreachMailbox.mode !== "managed" ||
      request.outreachMailboxGeneration !== resource.generation ||
      !request.managedOutreachProfile ||
      managedOutreachMailboxProfileIssues(request.managedOutreachProfile)
        .length > 0 ||
      !message.managedSesUnsubscribeTokenHash ||
      !message.inboundRelayAliasHash ||
      !managedSesInboxReceiptCurrent({
        inbox,
        now: timestamp,
        expectedAdapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
      })
    ) {
      return terminalizeClaimedDeliveryBeforeProvider(
        ctx,
        message,
        args.attemptId,
        timestamp,
        "The managed sender resource or signed readiness binding changed before the provider boundary.",
      );
    }
    const pacing = await reserveManagedSesPacingAttempt(ctx, {
      inbox,
      accountKey: inbox.credentialOwnerAccountKey!,
      now: timestamp,
    });
    const pacingTransition = managedSesPacingBoundaryTransition({
      kind: "delivery",
      reserved: pacing.reserved,
      nextEligibleAt: pacing.nextEligibleAt,
    });
    if (pacingTransition !== "cross_external_boundary") {
      if (
        pacingTransition === "defer_delivery" &&
        pacing.nextEligibleAt
      ) {
        return deferClaimedDeliveryBeforeProvider(
          ctx,
          message,
          timestamp,
          pacing.nextEligibleAt,
          pacing.reason ?? "Managed sender pacing deferred this attempt.",
        );
      }
      return terminalizeClaimedDeliveryBeforeProvider(
        ctx,
        message,
        args.attemptId,
        timestamp,
        "The managed sender pacing identity became invalid before the provider boundary.",
      );
    }
    await ctx.db.patch(message._id, {
      deliveryExternalAttemptedAt: timestamp,
      managedSesExternalAttemptedAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      message.deliveryLeaseExpiresAt! + 1_000,
      internal.outreach.recoverManagedSesDeliveryBoundaryLease,
      {
        siteId: message.siteId,
        messageId: message._id,
        attemptId: args.attemptId,
        resourceId: resource._id,
      },
    );
    return { marked: true as const, externalAttempted: true as const };
  },
});

const smartleadDeliveryBoundaryArgs = {
  siteId: v.id("sites"),
  messageId: v.id("outreach_messages"),
  attemptId: v.string(),
  release: deliveryReleaseValidator,
  expectedParentMessageId: v.optional(v.id("outreach_messages")),
  expectedProviderThreadId: v.optional(v.string()),
  expectedInReplyToRfcMessageIdHash: v.optional(v.string()),
  expectedManagedParentOperationKey: v.optional(v.string()),
  expectedManagedParentThreadReceipt: v.optional(v.string()),
};

/** Last serializable authorization check before any Smartlead campaign or
 * lead write. All five controlled canaries and the 14-day warm-up receipt are
 * re-read in this transaction. */
export const markSmartleadDeliveryExternalBoundary = internalMutation({
  args: smartleadDeliveryBoundaryArgs,
  handler: async (ctx, args) => {
    const authorization = await authorizeClaimedDeliveryAtExternalBoundary(
      ctx,
      args,
      SMARTLEAD_MANAGED_TRANSPORT,
    );
    if (!authorization.authorized) return authorization;
    const { message, site, inbox, timestamp } = authorization;
    const resources = await ctx.db
      .query("managed_outreach_mailbox_resources")
      .withIndex("by_canonical_inbox", (q) =>
        q.eq("canonicalInboxId", inbox._id))
      .take(20);
    const resource = resources.find((row) =>
      row.transportKind === SMARTLEAD_MANAGED_TRANSPORT &&
      row.operationKey === inbox.managedTransportOperationKey &&
      row.generation === inbox.managedTransportGeneration &&
      row.adapterVersion === SMARTLEAD_ADAPTER_VERSION
    ) ?? null;
    const request = resource ? await ctx.db.get(resource.requestId) : null;
    const requestFence = request && resource
      ? managedOutreachMailboxRequestFenceIssues({
          siteActive: Boolean(
            site.userId && !site.deletionStatus && !site.accountDeletionRequestedAt,
          ),
          requestMode: request.outreachMailbox.mode,
          requestOwnerAccountKey: request.ownerAccountKey,
          currentOwnerAccountKey: accountDeletionKey(site.userId!),
          requestDomainSnapshot: request.domainSnapshot,
          currentDomainSnapshot: siteCanonicalDomain(site),
          requestDomainRevisionSnapshot: request.domainRevisionSnapshot,
          currentDomainRevision: siteCanonicalDomainRevision(site),
          expectedConfigurationRevision: resource.requestConfigurationRevision,
          actualConfigurationRevision: request.configurationRevision,
          expectedGeneration: resource.generation,
          actualGeneration: request.outreachMailboxGeneration,
          expectedContractVersion: ONE_SETUP_CONTRACT_VERSION,
          actualContractVersion: request.contractVersion,
        })
      : ["smartlead_resource_or_request_missing"];
    const planned = message.providerPlannedSequence ?? [];
    const campaignConfigurationHash = sha256Hex(JSON.stringify({
      adapterVersion: SMARTLEAD_ADAPTER_VERSION,
      resourceOperationKey: resource?.operationKey,
      generation: resource?.generation,
      sequence: planned.map((entry) => ({
        sequenceStep: entry.sequenceStep,
        delayDays: entry.delayDays,
      })),
      maxSequenceStep: SMARTLEAD_MAX_SEQUENCE_STEP,
      stopOnReply: true,
      unsubscribe: true,
    }));
    const expectedOperationKey = smartleadOperationKey({
      siteId: String(site._id),
      inboxGeneration: inbox.managedTransportGeneration!,
      campaignGeneration: inbox.managedTransportGeneration!,
      messageId: String(message._id),
      sequenceStep: message.sequenceStep,
    });
    if (
      !resource || !request || requestFence.length > 0 ||
      request.outreachTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" ||
      resource.releaseState !== "active" ||
      resource.canonicalInboxId !== inbox._id ||
      !resource.encryptedProviderBinding || !resource.configurationHash ||
      !resource.domainAuthenticationReceipt ||
      resource.warmupState !== "verified" ||
      !resource.warmupStartedAt || !resource.warmupEligibleAt ||
      resource.warmupEligibleAt > timestamp ||
      resource.warmupEligibleAt <
        resource.warmupStartedAt + SMARTLEAD_MINIMUM_WARMUP_MS ||
      !resource.deliveryCanaryReceipt || !resource.replyCanaryReceipt ||
      !resource.bounceCanaryReceipt || !resource.unsubscribeCanaryReceipt ||
      !resource.cancellationCanaryReceipt ||
      smartleadManagedInboxIssues({ inbox, now: timestamp }).length > 0 ||
      message.sequenceStep !== 0 || planned.length < 1 || planned.length > 3 ||
      message.providerOperationKey !== expectedOperationKey ||
      message.providerCampaignGeneration !== resource.generation ||
      (resource.campaignGeneration !== undefined &&
        resource.campaignGeneration !== resource.generation) ||
      (resource.campaignConfigurationHash !== undefined &&
        resource.campaignConfigurationHash !== campaignConfigurationHash)
    ) {
      return terminalizeClaimedDeliveryBeforeProvider(
        ctx,
        message,
        args.attemptId,
        timestamp,
        "The Smartlead resource, warm-up, canary, campaign, or sequence binding changed before the provider boundary.",
      );
    }
    await Promise.all([
      ctx.db.patch(resource._id, {
        campaignGeneration: resource.generation,
        campaignConfigurationHash,
        updatedAt: timestamp,
      }),
      ctx.db.patch(message._id, {
        deliveryExternalAttemptedAt: timestamp,
        providerCampaignConfigurationHash: campaignConfigurationHash,
        providerAcknowledgementState: "attempted",
        updatedAt: timestamp,
      }),
    ]);
    await ctx.scheduler.runAt(
      message.deliveryLeaseExpiresAt! + 1_000,
      internal.outreach.recoverApprovedDeliveryBoundaryLease,
      { siteId: message.siteId, messageId: message._id, attemptId: args.attemptId },
    );
    return { marked: true as const, externalAttempted: true as const };
  },
});

export const getSmartleadDeliveryOperationInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      !message || message.siteId !== args.siteId ||
      message.status !== "sending" ||
      message.deliveryAttemptId !== args.attemptId ||
      message.deliveryTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      !message.deliveryExternalAttemptedAt || !message.inboxId ||
      !message.providerOperationKey ||
      !message.providerCampaignConfigurationHash ||
      (message.deliveryLeaseExpiresAt ?? 0) <= Date.now()
    ) return null;
    const inbox = await ctx.db.get(message.inboxId);
    if (
      !inbox || inbox.siteId !== args.siteId ||
      inbox.provider !== "smartlead" ||
      inbox.managedTransportKind !== SMARTLEAD_MANAGED_TRANSPORT
    ) return null;
    const resources = await ctx.db
      .query("managed_outreach_mailbox_resources")
      .withIndex("by_canonical_inbox", (q) => q.eq("canonicalInboxId", inbox._id))
      .take(20);
    const resource = resources.find((row) =>
      row.transportKind === SMARTLEAD_MANAGED_TRANSPORT &&
      row.operationKey === inbox.managedTransportOperationKey &&
      row.generation === message.providerCampaignGeneration &&
      row.adapterVersion === SMARTLEAD_ADAPTER_VERSION
    );
    if (
      !resource || !resource.encryptedProviderBinding ||
      resource.campaignConfigurationHash !==
        message.providerCampaignConfigurationHash
    ) return null;
    return {
      message,
      inbox,
      resource: {
        _id: resource._id,
        operationKey: resource.operationKey,
        generation: resource.generation,
        encryptedProviderBinding: resource.encryptedProviderBinding,
        encryptedProviderCampaignBinding:
          resource.encryptedProviderCampaignBinding,
        campaignRequestedAt: resource.smartleadCampaignRequestedAt,
        campaignConfigurationRequestedAt:
          resource.smartleadCampaignConfigurationRequestedAt,
        webhookRequestedAt: resource.smartleadWebhookRequestedAt,
        campaignConfigurationHash: resource.campaignConfigurationHash,
        campaignConfiguredAt: resource.campaignConfiguredAt,
      },
    };
  },
});

export const recordSmartleadProviderProgressInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    phase: v.union(
      v.literal("campaign"),
      v.literal("webhook"),
      v.literal("configuration"),
      v.literal("lead"),
      v.literal("queued"),
      v.literal("ambiguous"),
    ),
    encryptedCampaignBinding: v.optional(v.string()),
    encryptedLeadBinding: v.optional(v.string()),
    providerLeadBindingHash: v.optional(v.string()),
    providerCampaignBindingHash: v.optional(v.string()),
    providerRecipientHash: v.optional(v.string()),
    completed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    const timestamp = Date.now();
    if (
      !message || message.siteId !== args.siteId ||
      message.status !== "sending" ||
      message.deliveryAttemptId !== args.attemptId ||
      message.deliveryTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      !message.deliveryExternalAttemptedAt || !message.inboxId ||
      !message.providerCampaignConfigurationHash ||
      (message.deliveryLeaseExpiresAt ?? 0) <= timestamp ||
      (args.encryptedCampaignBinding !== undefined &&
        !/^v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(
          args.encryptedCampaignBinding,
        )) ||
      (args.encryptedLeadBinding !== undefined &&
        !/^v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(
          args.encryptedLeadBinding,
        )) ||
      (args.providerLeadBindingHash !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.providerLeadBindingHash)) ||
      (args.providerCampaignBindingHash !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.providerCampaignBindingHash)) ||
      (args.providerRecipientHash !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.providerRecipientHash))
    ) return { recorded: false as const };
    const inbox = await ctx.db.get(message.inboxId);
    if (!inbox || inbox.siteId !== args.siteId) return { recorded: false as const };
    const resources = await ctx.db
      .query("managed_outreach_mailbox_resources")
      .withIndex("by_canonical_inbox", (q) => q.eq("canonicalInboxId", inbox._id))
      .take(20);
    const resource = resources.find((row) =>
      row.transportKind === SMARTLEAD_MANAGED_TRANSPORT &&
      row.operationKey === inbox.managedTransportOperationKey &&
      row.generation === message.providerCampaignGeneration &&
      row.campaignConfigurationHash ===
        message.providerCampaignConfigurationHash
    );
    if (!resource) return { recorded: false as const };
    if (args.phase === "campaign") {
      await ctx.db.patch(resource._id, {
        smartleadCampaignRequestedAt:
          resource.smartleadCampaignRequestedAt ?? timestamp,
        encryptedProviderCampaignBinding:
          args.encryptedCampaignBinding ??
          resource.encryptedProviderCampaignBinding,
        updatedAt: timestamp,
      });
    } else if (args.phase === "webhook") {
      await ctx.db.patch(resource._id, {
        smartleadWebhookRequestedAt:
          resource.smartleadWebhookRequestedAt ?? timestamp,
        encryptedProviderCampaignBinding:
          args.encryptedCampaignBinding ??
          resource.encryptedProviderCampaignBinding,
        updatedAt: timestamp,
      });
    } else if (args.phase === "configuration") {
      await ctx.db.patch(resource._id, {
        smartleadCampaignConfigurationRequestedAt:
          resource.smartleadCampaignConfigurationRequestedAt ?? timestamp,
        encryptedProviderCampaignBinding:
          args.encryptedCampaignBinding ??
          resource.encryptedProviderCampaignBinding,
        campaignConfiguredAt: args.completed
          ? timestamp
          : resource.campaignConfiguredAt,
        updatedAt: timestamp,
      });
    } else if (args.phase === "lead") {
      await ctx.db.patch(message._id, {
        providerAcknowledgementState: "lead_boundary_crossed",
        updatedAt: timestamp,
      });
    } else if (args.phase === "queued") {
      if (
        !args.encryptedLeadBinding || !args.providerLeadBindingHash ||
        !args.providerCampaignBindingHash || !args.providerRecipientHash
      ) {
        return { recorded: false as const };
      }
      await ctx.db.patch(message._id, {
        status: "provider_queued",
        encryptedProviderLeadBinding: args.encryptedLeadBinding,
        providerLeadBindingHash: args.providerLeadBindingHash,
        providerCampaignBindingHash: args.providerCampaignBindingHash,
        providerRecipientHash: args.providerRecipientHash,
        providerAcknowledgementState: "acknowledged",
        providerReconciledAt: timestamp,
        deliveryLeaseExpiresAt: undefined,
        updatedAt: timestamp,
      });
    } else {
      const nextEligibleAt = timestamp + 5 * 60 * 1000;
      await ctx.db.patch(message._id, {
        status: "delivery_unverified",
        providerAcknowledgementState: "ambiguous",
        providerReconciledAt: timestamp,
        providerReconciliationAttempt: 0,
        providerReconciliationNextEligibleAt: nextEligibleAt,
        deliveryLeaseExpiredAt: timestamp,
        deliveryLeaseExpiresAt: undefined,
        failureReason:
          "Smartlead crossed an external boundary without an exact provider receipt. Pentra will reconcile this operation key and will not create a second sequence.",
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAt(
        nextEligibleAt,
        internal.actions.smartlead.reconcileSequence,
        {
          siteId: args.siteId,
          messageId: args.messageId,
          operationKey: message.providerOperationKey!,
        },
      );
    }
    return { recorded: true as const, resourceId: resource._id };
  },
});

export const getSmartleadReconciliationOperationInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    operationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      !message || message.siteId !== args.siteId ||
      message.status !== "delivery_unverified" ||
      message.deliveryTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      message.providerOperationKey !== args.operationKey ||
      message.providerAcknowledgementState !== "ambiguous" ||
      !message.inboxId
    ) return null;
    const inbox = await ctx.db.get(message.inboxId);
    if (!inbox || inbox.siteId !== args.siteId) return null;
    const resources = await ctx.db.query("managed_outreach_mailbox_resources")
      .withIndex("by_canonical_inbox", (q) => q.eq("canonicalInboxId", inbox._id))
      .take(20);
    const resource = resources.find((row) =>
      row.transportKind === SMARTLEAD_MANAGED_TRANSPORT &&
      row.operationKey === inbox.managedTransportOperationKey &&
      row.generation === message.providerCampaignGeneration
    );
    if (!resource?.encryptedProviderBinding) return null;
    return {
      message: {
        toEmail: message.toEmail,
        toDomain: message.toDomain,
        providerOperationKey: message.providerOperationKey,
      },
      resource: {
        _id: resource._id,
        operationKey: resource.operationKey,
        generation: resource.generation,
        encryptedProviderBinding: resource.encryptedProviderBinding,
        encryptedProviderCampaignBinding:
          resource.encryptedProviderCampaignBinding,
      },
    };
  },
});

export const recordSmartleadReconciliationInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    operationKey: v.string(),
    found: v.boolean(),
    encryptedCampaignBinding: v.optional(v.string()),
    encryptedLeadBinding: v.optional(v.string()),
    providerLeadBindingHash: v.optional(v.string()),
    providerCampaignBindingHash: v.optional(v.string()),
    providerRecipientHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    const timestamp = Date.now();
    if (
      !message || message.siteId !== args.siteId ||
      message.status !== "delivery_unverified" ||
      message.deliveryTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      message.providerOperationKey !== args.operationKey ||
      message.providerAcknowledgementState !== "ambiguous" ||
      !message.inboxId
    ) return { recorded: false as const };
    const inbox = await ctx.db.get(message.inboxId);
    if (!inbox || inbox.siteId !== args.siteId) return { recorded: false as const };
    const resources = await ctx.db.query("managed_outreach_mailbox_resources")
      .withIndex("by_canonical_inbox", (q) => q.eq("canonicalInboxId", inbox._id))
      .take(20);
    const resource = resources.find((row) =>
      row.transportKind === SMARTLEAD_MANAGED_TRANSPORT &&
      row.operationKey === inbox.managedTransportOperationKey &&
      row.generation === message.providerCampaignGeneration
    );
    if (!resource) return { recorded: false as const };
    if (args.found) {
      if (
        !args.encryptedCampaignBinding || !args.encryptedLeadBinding ||
        !args.providerLeadBindingHash || !args.providerCampaignBindingHash ||
        !args.providerRecipientHash ||
        !/^v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(
          args.encryptedCampaignBinding,
        ) ||
        !/^v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(
          args.encryptedLeadBinding,
        ) ||
        ![args.providerLeadBindingHash, args.providerCampaignBindingHash,
          args.providerRecipientHash].every((value) => /^[a-f0-9]{64}$/.test(value))
      ) return { recorded: false as const };
      await Promise.all([
        ctx.db.patch(resource._id, {
          encryptedProviderCampaignBinding: args.encryptedCampaignBinding,
          updatedAt: timestamp,
        }),
        ctx.db.patch(message._id, {
          status: "provider_queued",
          encryptedProviderLeadBinding: args.encryptedLeadBinding,
          providerLeadBindingHash: args.providerLeadBindingHash,
          providerCampaignBindingHash: args.providerCampaignBindingHash,
          providerRecipientHash: args.providerRecipientHash,
          providerAcknowledgementState: "reconciled",
          providerReconciledAt: timestamp,
          providerReconciliationNextEligibleAt: undefined,
          failureReason: undefined,
          updatedAt: timestamp,
        }),
      ]);
      return { recorded: true as const, found: true as const };
    }
    const attempt = Math.min(10, (message.providerReconciliationAttempt ?? 0) + 1);
    const terminal = attempt >= 10;
    const nextEligibleAt = timestamp + Math.min(
      6 * 60 * 60 * 1000,
      5 * 60 * 1000 * 2 ** Math.max(0, attempt - 1),
    );
    await ctx.db.patch(message._id, {
      providerReconciliationAttempt: attempt,
      providerReconciliationNextEligibleAt: terminal ? undefined : nextEligibleAt,
      providerAcknowledgementState: terminal ? "terminal_alert" : "ambiguous",
      failureReason: terminal
        ? "Smartlead reconciliation exhausted ten bounded read-only checks. The external outcome remains unresolved and will not be replayed."
        : "Smartlead acknowledgement remains unresolved; a durable read-only reconciliation wake is scheduled.",
      updatedAt: timestamp,
    });
    if (!terminal) {
      await ctx.scheduler.runAt(
        nextEligibleAt,
        internal.actions.smartlead.reconcileSequence,
        {
          siteId: args.siteId,
          messageId: args.messageId,
          operationKey: args.operationKey,
        },
      );
    }
    return { recorded: true as const, found: false as const, terminal };
  },
});

export const markGmailDeliveryExternalBoundary = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    release: deliveryReleaseValidator,
    expectedParentMessageId: v.optional(v.id("outreach_messages")),
    expectedProviderThreadId: v.optional(v.string()),
    expectedInReplyToRfcMessageIdHash: v.optional(v.string()),
    expectedManagedParentOperationKey: v.optional(v.string()),
    expectedManagedParentThreadReceipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authorization = await authorizeClaimedDeliveryAtExternalBoundary(
      ctx,
      args,
      "gmail",
    );
    if (!authorization.authorized) return authorization;
    await ctx.db.patch(authorization.message._id, {
      deliveryExternalAttemptedAt: authorization.timestamp,
      updatedAt: authorization.timestamp,
    });
    await ctx.scheduler.runAt(
      authorization.message.deliveryLeaseExpiresAt! + 1_000,
      internal.outreach.recoverApprovedDeliveryBoundaryLease,
      {
        siteId: authorization.message.siteId,
        messageId: authorization.message._id,
        attemptId: args.attemptId,
      },
    );
    return { marked: true as const, externalAttempted: true as const };
  },
});

export const markSmtpDeliveryExternalBoundary = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    release: deliveryReleaseValidator,
    expectedParentMessageId: v.optional(v.id("outreach_messages")),
    expectedProviderThreadId: v.optional(v.string()),
    expectedInReplyToRfcMessageIdHash: v.optional(v.string()),
    expectedManagedParentOperationKey: v.optional(v.string()),
    expectedManagedParentThreadReceipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authorization = await authorizeClaimedDeliveryAtExternalBoundary(
      ctx,
      args,
      "smtp",
    );
    if (!authorization.authorized) return authorization;
    await ctx.db.patch(authorization.message._id, {
      deliveryExternalAttemptedAt: authorization.timestamp,
      updatedAt: authorization.timestamp,
    });
    await ctx.scheduler.runAt(
      authorization.message.deliveryLeaseExpiresAt! + 1_000,
      internal.outreach.recoverApprovedDeliveryBoundaryLease,
      {
        siteId: authorization.message.siteId,
        messageId: authorization.message._id,
        attemptId: args.attemptId,
      },
    );
    return { marked: true as const, externalAttempted: true as const };
  },
});

/** Claim-owned recovery shared by Gmail and managed SES. An exact v1 claim
 * with no boundary marker is safe to restore; a marker makes the operation
 * immutable and therefore delivery_unverified/no-replay. */
export const recoverApprovedDeliveryBoundaryLease = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    const timestamp = Date.now();
    if (
      !message ||
      message.siteId !== args.siteId ||
      message.status !== "sending" ||
      message.deliveryAttemptId !== args.attemptId ||
      message.deliveryBoundaryVersion !== 1 ||
      (message.deliveryLeaseExpiresAt ?? 0) > timestamp
    ) return { recovered: false as const };
    const recoveryDecision = deliveryLeaseRecoveryDecision({
      exactClaimCurrent: true,
      leaseExpired: true,
      externalAttempted: Boolean(
        message.deliveryExternalAttemptedAt ||
        message.managedSesExternalAttemptedAt
      ),
    });
    if (recoveryDecision === "restore_approved") {
      const restored = await deferClaimedDeliveryBeforeProvider(
        ctx,
        message,
        timestamp,
        timestamp + 1_000,
        "The delivery action ended before the provider boundary; the exact approved message was restored for a fresh authorization check.",
        false,
      );
      return {
        recovered: true as const,
        externalAttempted: false as const,
        deferredUntil: restored.nextEligibleAt,
      };
    }
    await ctx.db.patch(message._id, {
      status: "delivery_unverified",
      deliveryLeaseExpiresAt: undefined,
      deliveryLeaseExpiredAt: timestamp,
      failureReason:
        "The provider boundary was crossed but no exact receipt was stored before the lease expired. This operation will not be replayed.",
      updatedAt: timestamp,
    });
    if (
      message.deliveryTransport === MANAGED_SES_TRANSPORT &&
      message.managedSesExternalAttemptedAt &&
      message.inboxId
    ) {
      const resources = await ctx.db
        .query("managed_outreach_mailbox_resources")
        .withIndex("by_canonical_inbox", (q) =>
          q.eq("canonicalInboxId", message.inboxId!))
        .take(20);
      const resource = resources.find((row) =>
        row.operationKey === message.managedSesResourceOperationKey &&
        row.generation === message.managedSesGeneration &&
        row.adapterVersion === message.managedSesAdapterVersion
      );
      if (resource) {
        await ctx.scheduler.runAt(
          Math.max(
            timestamp,
            message.managedSesExternalAttemptedAt +
              MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
          ),
          internal.managedOutreachMailbox
            .claimManagedSesAmbiguityReconciliation,
          { resourceId: resource._id },
        );
      }
    }
    return { recovered: true as const, externalAttempted: true as const };
  },
});

/** Exact action-death watchdog armed in the provider-boundary transaction. */
export const recoverManagedSesDeliveryBoundaryLease = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    resourceId: v.id("managed_outreach_mailbox_resources"),
  },
  handler: async (ctx, args) => {
    const [message, resource] = await Promise.all([
      ctx.db.get(args.messageId),
      ctx.db.get(args.resourceId),
    ]);
    const timestamp = Date.now();
    if (
      !message ||
      message.siteId !== args.siteId ||
      message.status !== "sending" ||
      message.deliveryTransport !== MANAGED_SES_TRANSPORT ||
      message.deliveryAttemptId !== args.attemptId ||
      message.managedSesOperationKey !== args.attemptId ||
      !message.managedSesExternalAttemptedAt ||
      (message.deliveryLeaseExpiresAt ?? 0) > timestamp ||
      !message.inboxId ||
      !resource ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      resource.operationKey !== message.managedSesResourceOperationKey ||
      resource.generation !== message.managedSesGeneration ||
      resource.adapterVersion !== message.managedSesAdapterVersion ||
      resource.canonicalInboxId !== message.inboxId
    ) return { recovered: false as const };
    await ctx.db.patch(message._id, {
      status: "delivery_unverified",
      deliveryLeaseExpiredAt: timestamp,
      failureReason:
        "The managed sender crossed its provider boundary but the action died before an exact signed receipt was stored. This operation will not be replayed.",
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      Math.max(
        timestamp,
        message.managedSesExternalAttemptedAt +
          MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
      ),
      internal.managedOutreachMailbox.claimManagedSesAmbiguityReconciliation,
      { resourceId: args.resourceId },
    );
    return { recovered: true as const };
  },
});

export const getApprovedDeliveryEvidenceInternal = internalQuery({
  args: { siteId: v.id("sites"), release: deliveryReleaseValidator },
  handler: async (ctx, { siteId, release }) => {
    const now = Date.now();
    const [site, inboxes] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("outreach_inboxes")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .take(2),
    ]);
    if (!siteExecutionActive(site) || inboxes.length !== 1) return null;
    const inbox = inboxes[0];
    if (
      !site.userId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) return null;
    const ownerAccountKey = inbox.credentialOwnerAccountKey;
    if (
      release === "automatic" &&
      (!autonomousOutreachRuntimeEnabled(
        process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
      ) ||
        !autonomousOutreachConsentActive(inbox, site.userId) ||
        !autonomousOutreachReconciliationComplete(inbox) ||
        !(await outreachDurabilityMigrationComplete(ctx, site)))
    ) return null;
    const canonicalDomain = siteCanonicalDomain(site);
    if (!canonicalDomain) return null;
    const automaticCandidates = release === "automatic"
      ? await Promise.all(
          Array.from({ length: MAX_SEQUENCE_STEP + 1 }, (_, sequenceStep) =>
            siteUsesLegacyDomainReceipts(site)
              ? ctx.db
                .query("outreach_messages")
                .withIndex(
                  "by_site_owner_lineage_status_autonomy_consent_sequence_scheduled",
                  (q) => q
                    .eq("siteId", siteId)
                    .eq("ownerAccountKey", ownerAccountKey)
                    .eq("ownerLineageUnresolvedAt", undefined)
                    .eq("status", "approved")
                    .eq("approvalKind", "account_autopilot")
                    .eq("approvalConsentVersion", inbox.autonomyConsentVersion)
                    .eq(
                      "approvalConsentPolicyHash",
                      inbox.autonomyConsentPolicyHash,
                    )
                    .eq(
                      "approvalConsentAcceptedAt",
                      inbox.autonomyConsentAcceptedAt,
                    )
                    .eq("sequenceStep", sequenceStep)
                    .lte("scheduledAt", now)
                )
                .order("asc")
                .first()
              : ctx.db
                .query("outreach_messages")
                .withIndex(
                  "by_site_epoch_owner_auto_sequence_scheduled",
                  (q) => q
                    .eq("siteId", siteId)
                    .eq("canonicalDomain", canonicalDomain)
                    .eq("domainRevision", siteCanonicalDomainRevision(site))
                    .eq("ownerAccountKey", ownerAccountKey)
                    .eq("ownerLineageUnresolvedAt", undefined)
                    .eq("status", "approved")
                    .eq("approvalKind", "account_autopilot")
                    .eq("approvalConsentVersion", inbox.autonomyConsentVersion)
                    .eq(
                      "approvalConsentPolicyHash",
                      inbox.autonomyConsentPolicyHash,
                    )
                    .eq(
                      "approvalConsentAcceptedAt",
                      inbox.autonomyConsentAcceptedAt,
                    )
                    .eq("sequenceStep", sequenceStep)
                    .lte("scheduledAt", now)
                )
                .order("asc")
                .first()
          ),
        )
      : [];
    const message = release === "automatic"
      ? automaticCandidates
          .filter((candidate): candidate is NonNullable<typeof candidate> =>
            Boolean(candidate)
          )
          .sort((left, right) =>
            (left.scheduledAt ?? 0) - (right.scheduledAt ?? 0) ||
            left.createdAt - right.createdAt
          )[0]
      : siteUsesLegacyDomainReceipts(site)
        ? await ctx.db
          .query("outreach_messages")
          .withIndex("by_site_owner_lineage_status_approval_kind_sequence_scheduled", (q) =>
            q
              .eq("siteId", siteId)
              .eq("ownerAccountKey", ownerAccountKey)
              .eq("ownerLineageUnresolvedAt", undefined)
              .eq("status", "approved")
              .eq("approvalKind", "owner_message")
              .eq("sequenceStep", 0)
              .lte("scheduledAt", now)
          )
          .order("asc")
          .first()
        : await ctx.db
          .query("outreach_messages")
          .withIndex("by_site_epoch_owner_approval_sequence_scheduled", (q) =>
            q
              .eq("siteId", siteId)
              .eq("canonicalDomain", canonicalDomain)
              .eq("domainRevision", siteCanonicalDomainRevision(site))
              .eq("ownerAccountKey", ownerAccountKey)
              .eq("ownerLineageUnresolvedAt", undefined)
              .eq("status", "approved")
              .eq("approvalKind", "owner_message")
              .eq("sequenceStep", 0)
              .lte("scheduledAt", now)
          )
          .order("asc")
          .first();
    if (!message) return null;
    const policyReceipt = message.outreachPolicyDecisionId
      ? await ctx.db.get(message.outreachPolicyDecisionId)
      : null;
    const policyAllowed = release === "automatic"
      ? message.outreachPolicyDecision === "allowed_auto"
      : ["allowed_auto", "approval_only"].includes(
          message.outreachPolicyDecision ?? "needs_evidence",
        );
    if (
      !policyAllowed || !policyReceipt || policyReceipt.siteId !== siteId ||
      policyReceipt.decision !== message.outreachPolicyDecision ||
      policyReceipt.policyVersion !== OUTREACH_POLICY_VERSION ||
      policyReceipt.policyVersion !== message.outreachPolicyVersion ||
      policyReceipt.configurationHash !== message.outreachPolicyConfigurationHash
    ) return null;
    const opportunity = await ctx.db.get(message.opportunityId);
    const permanentlyInvalid = (
      reason: "source_changed" | "target_missing" | "contact_changed",
    ) => ({
      permanentInvalidReason: reason,
      messageId: message._id,
      opportunityId: message.opportunityId,
      evidenceHash: message.opportunityEvidenceHash ?? "",
    });
    if (
      !opportunity ||
      opportunity.siteId !== siteId ||
      !outreachMessageMatchesCurrentDomain(site, message) ||
      !authorityOpportunityMatchesCurrentDomain(site, opportunity) ||
      !Number.isSafeInteger(message.sequenceStep) ||
      message.sequenceStep < 0 ||
      message.sequenceStep > MAX_SEQUENCE_STEP ||
      (message.sequenceStep === 0
        ? opportunity.status !== "outreach_prepared"
        : opportunity.status !== "contacted") ||
      !message.opportunityEvidenceHash ||
      message.opportunityEvidenceHash !== opportunity.evidenceHash ||
      message.opportunitySourceUrl !== opportunity.sourceUrl ||
      message.opportunityTargetUrl !== opportunity.targetUrl
    ) {
      return permanentlyInvalid("source_changed");
    }
    let targetTitle: string | undefined;
    if (opportunity.type === "broken_link") {
      if (!opportunity.articleId) return permanentlyInvalid("target_missing");
      const article = await ctx.db.get(opportunity.articleId);
      const target = article
        ? verifiedAuthorityTarget({ site, article, now: Date.now() })
        : null;
      if (!target || target.targetUrl !== opportunity.targetUrl) {
        return permanentlyInvalid("target_missing");
      }
      targetTitle = target.title;
    }
    const contact = await ctx.db
      .query("outreach_contacts")
      .withIndex("by_site_email", (q) =>
        q.eq("siteId", siteId).eq("email", message.toEmail),
      )
      .unique();
    if (
      !contact ||
      contact.ownerAccountKey !== inbox.credentialOwnerAccountKey ||
      !contact.discoveredFromUrl
    ) {
      return permanentlyInvalid("contact_changed");
    }
    return {
      messageId: message._id,
      opportunityId: opportunity._id,
      evidenceHash: opportunity.evidenceHash,
      sourceUrl: opportunity.sourceUrl,
      sourceDomain: opportunity.sourceDomain,
      type: opportunity.type,
      targetUrl: opportunity.targetUrl,
      context: opportunity.context,
      anchorText: opportunity.anchorText,
      targetTitle,
      toEmail: message.toEmail,
      contactDiscoveredFromUrl: contact.discoveredFromUrl,
    };
  },
});

/** Retire only an exact, still-approved evidence binding after the action
 * successfully fetched the public pages and proved a permanent semantic
 * mismatch. Transport/timeouts never call this mutation. */
export const retireInvalidApprovedDeliveryEvidenceInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    opportunityId: v.id("seo_authority_opportunities"),
    evidenceHash: v.string(),
    reason: v.union(
      v.literal("source_changed"),
      v.literal("target_missing"),
      v.literal("contact_changed"),
    ),
  },
  handler: async (ctx, args) => {
    const [site, message, opportunity] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.messageId),
      ctx.db.get(args.opportunityId),
    ]);
    if (
      !site?.userId ||
      !message ||
      message.siteId !== args.siteId ||
      !outreachMessageOwnerMatches(
        message,
        accountDeletionKey(site.userId),
      ) ||
      message.opportunityId !== args.opportunityId ||
      message.status !== "approved" ||
      !Number.isSafeInteger(message.sequenceStep) ||
      message.sequenceStep < 0 ||
      message.sequenceStep > MAX_SEQUENCE_STEP ||
      (message.opportunityEvidenceHash ?? "") !== args.evidenceHash
    ) {
      return { retired: false as const };
    }
    const timestamp = Date.now();
    await ctx.db.patch(message._id, message.sequenceStep === 0
      ? {
          status: "failed",
          failureReason:
            "Live public evidence permanently changed before delivery; a fresh authority scan is required.",
          updatedAt: timestamp,
        }
      : {
          status: "skipped",
          blockedReason:
            "Live public evidence permanently changed before this follow-up became due.",
          updatedAt: timestamp,
        });
    if (
      opportunity?.siteId === args.siteId &&
      opportunity.evidenceHash === args.evidenceHash &&
      message.opportunitySourceUrl === opportunity.sourceUrl &&
      message.opportunityTargetUrl === opportunity.targetUrl &&
      opportunity.status === "outreach_prepared"
    ) {
      await ctx.db.patch(opportunity._id, {
        status: "rejected",
        updatedAt: timestamp,
      });
    }
    return { retired: true as const, reason: args.reason };
  },
});

function immutableDeliveryOwnerAccountKey(
  message: Doc<"outreach_messages">,
  inbox: Doc<"outreach_inboxes"> | null,
): string | undefined {
  return message.deliveryOwnerAccountKey ?? inbox?.credentialOwnerAccountKey;
}

async function settleAcceptedDeliveryCounter(
  ctx: MutationCtx,
  message: Doc<"outreach_messages">,
  siteId: Id<"sites">,
  deliveredAt: number,
): Promise<{ accountKey?: string; ownsCurrentSite: boolean }> {
  if (!message.inboxId) return { ownsCurrentSite: false };
  const inbox = await ctx.db.get(message.inboxId);
  if (!inbox || inbox.siteId !== siteId) return { ownsCurrentSite: false };
  const site = await ctx.db.get(siteId);
  if (!site) return { ownsCurrentSite: false };
  const settlementAccountKey = immutableDeliveryOwnerAccountKey(message, inbox);
  if (!settlementAccountKey) return { ownsCurrentSite: false };
  const ownsCurrentSite = Boolean(
    site.userId &&
      settlementAccountKey === accountDeletionKey(site.userId) &&
      inbox.credentialOwnerAccountKey === settlementAccountKey,
  );
  const deliveredDay = utcDayKey(deliveredAt);
  const existingDay = inbox.sentTodayDay ?? "";
  const sameDay = existingDay === deliveredDay;
  const newerDay = deliveredDay > existingDay;
  if (ownsCurrentSite) {
    await ctx.db.patch(inbox._id, {
      sentToday: sameDay
        ? (inbox.sentToday ?? 0) + 1
        : newerDay
          ? 1
          : inbox.sentToday ?? 0,
      sentTodayDay: newerDay ? deliveredDay : existingDay || deliveredDay,
      lastSentAt: Math.max(inbox.lastSentAt ?? 0, deliveredAt),
      status: inbox.status === "connected" ? "warming" : inbox.status,
      updatedAt: Math.max(inbox.updatedAt ?? 0, deliveredAt),
    });
  }
  await recordDurableContactReceiptForAccount(
    ctx,
    settlementAccountKey,
    message.toDomain,
    deliveredAt,
    message.deliveryAttemptId,
  );
  // A managed SES sender shares Pentra's platform domain. Its conservative
  // global-domain and tenant/mailbox attempt receipts are reserved atomically
  // at claim time, so it must never enter the legacy one-domain-per-account
  // reputation table used by owner-connected Gmail senders.
  if (inbox.provider !== MANAGED_SES_TRANSPORT) {
    await recordDurablePacingReceiptForAccount(
      ctx,
      settlementAccountKey,
      inbox,
      deliveredAt,
    );
  }
  return { accountKey: settlementAccountKey, ownsCurrentSite };
}

/** Queue exactly one next step only inside the same transaction that seals a
 * provider-verified accepted receipt. Every later claim repeats all live
 * evidence, suppression, consent, configuration, pacing and thread checks. */
async function queueNextVerifiedAutonomousFollowUp(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    parentMessageId: Id<"outreach_messages">;
    transport: "gmail" | "smtp" | typeof MANAGED_SES_TRANSPORT;
    providerThreadId: string | undefined;
    outboundRfcMessageId: string | undefined;
    managedSesOperationKey?: string;
    managedSesThreadReceipt?: string;
    rfcMessageIdDigest?: string;
    sentAt: number;
  },
): Promise<{ queued: boolean; reason?: string }> {
  const parent = await ctx.db.get(args.parentMessageId);
  const ownerAccountKey = parent?.ownerAccountKey;
  const normalizedOutboundMessageId = normalizeRfcMessageId(
    args.outboundRfcMessageId,
  );
  const customerManagedParentIdentityMatches = Boolean(
    (args.transport === "gmail" || args.transport === "smtp") &&
      (args.transport === "smtp" || (
        args.providerThreadId &&
        /^[a-zA-Z0-9_-]{1,200}$/.test(args.providerThreadId) &&
        parent?.providerThreadId === args.providerThreadId
      )) &&
      normalizedOutboundMessageId &&
      parent?.inboundRelayOutboundMessageIdHash &&
      inboundRelayMessageIdHash(normalizedOutboundMessageId) ===
        parent.inboundRelayOutboundMessageIdHash,
  );
  const managedParentIdentityMatches = Boolean(
    args.transport === MANAGED_SES_TRANSPORT &&
      parent?.deliveryTransport === MANAGED_SES_TRANSPORT &&
      args.managedSesOperationKey &&
      /^[A-Za-z0-9_-]{32,96}$/.test(args.managedSesOperationKey) &&
      parent.managedSesOperationKey === args.managedSesOperationKey &&
      args.managedSesThreadReceipt &&
      /^[A-Za-z0-9_-]{32,96}$/.test(args.managedSesThreadReceipt) &&
      parent.managedSesThreadReceipt === args.managedSesThreadReceipt &&
      args.rfcMessageIdDigest &&
      /^[a-f0-9]{64}$/.test(args.rfcMessageIdDigest) &&
      parent.inboundRelayOutboundMessageIdHash === args.rfcMessageIdDigest,
  );
  if (
    !parent ||
    parent.siteId !== args.siteId ||
    !ownerAccountKey ||
    !outreachMessageOwnerMatches(parent, ownerAccountKey) ||
    parent.status !== "sent" ||
    parent.sentAt !== args.sentAt ||
    parent.approvalKind !== "account_autopilot" ||
    !Number.isSafeInteger(parent.sequenceStep) ||
    parent.sequenceStep < 0 ||
    parent.sequenceStep >= MAX_SEQUENCE_STEP ||
    (!customerManagedParentIdentityMatches && !managedParentIdentityMatches)
  ) {
    return { queued: false, reason: "verified_parent_unavailable" };
  }

  const nextStep = parent.sequenceStep + 1;
  const scheduledAt = nextFollowUpAt({
    sequenceStep: parent.sequenceStep,
    lastSentAt: args.sentAt,
  });
  if (!scheduledAt || nextStep > MAX_SEQUENCE_STEP) {
    return { queued: false, reason: "sequence_complete" };
  }

  const [
    site,
    inbox,
    opportunity,
    existingNext,
    replied,
    bounced,
  ] = await Promise.all([
    ctx.db.get(args.siteId),
    parent.inboxId ? ctx.db.get(parent.inboxId) : null,
    ctx.db.get(parent.opportunityId),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_opportunity_owner_sequence", (q) =>
        q
          .eq("opportunityId", parent.opportunityId)
          .eq("ownerAccountKey", ownerAccountKey)
          .eq("sequenceStep", nextStep)
      )
      .first(),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_thread_owner_status", (q) =>
        q
          .eq("threadKey", parent.threadKey)
          .eq("ownerAccountKey", ownerAccountKey)
          .eq("status", "replied")
      )
      .first(),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_thread_owner_status", (q) =>
        q
          .eq("threadKey", parent.threadKey)
          .eq("ownerAccountKey", ownerAccountKey)
          .eq("status", "bounced")
      )
      .first(),
  ]);
  if (existingNext) return { queued: false, reason: "already_queued" };
  if (replied || bounced) return { queued: false, reason: "thread_stopped" };
  const relayRuntime = inboundRelayRuntimeConfig();
  const managedRoutingTarget =
    args.transport === MANAGED_SES_TRANSPORT && inbox
      ? await inboundRelayDsnRoutingTarget({
          siteId: String(args.siteId),
          inboxId: String(inbox._id),
          generation: inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
          relayDomain: relayRuntime.domain,
          secret: relayRuntime.dsnTargetSecret,
        })
      : null;
  const managedRelayReady = Boolean(
    args.transport === MANAGED_SES_TRANSPORT &&
      inbox?.provider === MANAGED_SES_TRANSPORT &&
      managedSesInboxReceiptCurrent({
        inbox,
        now: args.sentAt,
        expectedAdapterVersion: process.env.MANAGED_SES_ADAPTER_VERSION,
      }) &&
      inboundRelayConfigured(relayRuntime) &&
      managedRoutingTarget &&
      parent.inboundRelayAliasHash &&
      /^[a-f0-9]{64}$/.test(parent.inboundRelayAliasHash) &&
      parent.inboundRelayAliasDomain ===
        normalizeInboundRelayDomain(relayRuntime.domain) &&
      parent.inboundRelayDsnRoutingTargetHash === managedRoutingTarget.hash &&
      parent.inboundRelayDsnRoutingTargetVersion ===
        managedRoutingTarget.version &&
      parent.inboundRelayDsnRoutingTargetGeneration ===
        (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) &&
      parent.inboundRelayInboxConfigurationVersion ===
        (inbox.configurationVersion ?? 0) &&
      parent.inboundRelayRolloutEpoch === (site?.autopilotRolloutEpoch ?? 0),
  );
  if (
    !site ||
    !(await siteExecutionAuthorized(ctx, site)) ||
    !isSeoGrowthActuationEligible(site) ||
    !site.userId ||
    accountDeletionKey(site.userId) !== ownerAccountKey ||
    !inbox ||
    inbox.siteId !== args.siteId ||
    inbox._id !== parent.inboxId ||
    inbox.credentialOwnerAccountKey !== ownerAccountKey ||
    (args.transport === "gmail" && inbox.provider !== "gmail") ||
    (args.transport === "smtp" && inbox.provider !== "smtp") ||
    !autonomousOutreachRuntimeEnabled(
      process.env.OUTREACH_AUTONOMOUS_DELIVERY_ENABLED,
    ) ||
    !autonomousOutreachReconciliationComplete(inbox) ||
    !(await outreachDurabilityMigrationComplete(ctx, site)) ||
    !autonomousMessageAuthorizationMatches({
      inbox,
      ownerId: site.userId,
      approvalKind: parent.approvalKind,
      approvalConsentVersion: parent.approvalConsentVersion,
      approvalConsentPolicyHash: parent.approvalConsentPolicyHash,
      approvalConsentAcceptedAt: parent.approvalConsentAcceptedAt,
    }) ||
    !parent.outreachPolicyDecisionId ||
    parent.outreachPolicyDecision !== "allowed_auto" ||
    parent.outreachPolicyVersion !== OUTREACH_POLICY_VERSION ||
    !approvalMatchesInbox({
      messageInboxId: parent.inboxId,
      approvedInboxId: parent.approvedInboxId,
      approvedInboxConfigurationVersion:
        parent.approvedInboxConfigurationVersion,
      inboxId: inbox._id,
      inboxConfigurationVersion: inbox.configurationVersion,
    }) ||
    (args.transport === MANAGED_SES_TRANSPORT
      ? !managedRelayReady
      : !inboundRelayDsnRoutingReady({
          inbox,
          now: args.sentAt,
          rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
          runtimeConfig: relayRuntime,
        }))
  ) {
    return { queued: false, reason: "authorization_changed" };
  }
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) {
    return { queued: false, reason: "authorization_changed" };
  }
  if (
    !opportunity ||
    opportunity.siteId !== args.siteId ||
    !authorityOpportunityMatchesCurrentDomain(site, opportunity) ||
    opportunity.status !== "contacted" ||
    parent.opportunityEvidenceHash !== opportunity.evidenceHash ||
    parent.opportunitySourceUrl !== opportunity.sourceUrl ||
    parent.opportunityTargetUrl !== opportunity.targetUrl ||
    outreachOrganisationDomain(opportunity.sourceDomain) !==
      outreachOrganisationDomain(parent.toDomain) ||
    parent.threadKey !==
      outreachThreadKey(String(args.siteId), opportunity.sourceDomain)
  ) {
    return { queued: false, reason: "opportunity_changed" };
  }
  const [domainSuppressed, emailSuppressed, persistentDomain, persistentEmail] =
    await Promise.all([
      siteSuppressionExists(ctx, args.siteId, "domain", parent.toDomain),
      siteSuppressionExists(ctx, args.siteId, "email", parent.toEmail),
      persistentSuppressionExists(ctx, site, "domain", parent.toDomain),
      persistentSuppressionExists(ctx, site, "email", parent.toEmail),
    ]);
  if (
    domainSuppressed ||
    emailSuppressed ||
    persistentDomain ||
    persistentEmail
  ) {
    return { queued: false, reason: "recipient_suppressed" };
  }

  const brandName = site.siteName || normalizeDomain(site.domain).split(".")[0];
  const draft = draftFollowUp({
    sequenceStep: nextStep,
    evidence: {
      type: opportunity.type,
      sourceUrl: opportunity.sourceUrl,
      sourceDomain: opportunity.sourceDomain,
      targetUrl: opportunity.targetUrl,
      brokenUrl:
        opportunity.type === "broken_link" ? opportunity.context : undefined,
      anchorText: opportunity.anchorText,
      context:
        opportunity.type === "unlinked_mention"
          ? opportunity.context
          : undefined,
      brandName,
      senderName: inbox.fromName || brandName,
      physicalMailingAddress: inbox.physicalMailingAddress,
    },
  });
  const complianceIssues = draft
    ? outreachComplianceIssues({
        body: draft.body,
        toEmail: parent.toEmail,
        fromEmail: inbox.fromEmail,
        brandName,
        physicalMailingAddress: inbox.physicalMailingAddress,
      })
    : ["The verified evidence cannot produce a compliant follow-up."];
  if (!draft || complianceIssues.length > 0) {
    return { queued: false, reason: "draft_unavailable" };
  }

  await ctx.db.insert("outreach_messages", {
    siteId: args.siteId,
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    ownerAccountKey,
    inboxId: inbox._id,
    opportunityId: opportunity._id,
    toEmail: parent.toEmail,
    toDomain: parent.toDomain,
    subject: draft.subject,
    body: draft.body,
    status: "approved",
    sequenceStep: nextStep,
    threadKey: parent.threadKey,
    parentMessageId: parent._id,
    ...(args.transport === MANAGED_SES_TRANSPORT
      ? {
          deliveryTransport: MANAGED_SES_TRANSPORT,
          managedSesParentOperationKey: args.managedSesOperationKey!,
          managedSesParentThreadReceipt: args.managedSesThreadReceipt!,
        }
      : {
          deliveryTransport: args.transport === "smtp"
            ? "smtp"
            : "gmail_oauth",
          deliveryExpectedThreadId: args.providerThreadId,
        }),
    inReplyToRfcMessageIdHash:
      parent.inboundRelayOutboundMessageIdHash,
    inboxConfigurationVersion: inbox.configurationVersion ?? 0,
    opportunityEvidenceHash: opportunity.evidenceHash,
    opportunitySourceUrl: opportunity.sourceUrl,
    opportunityTargetUrl: opportunity.targetUrl,
    outreachPolicyDecisionId: parent.outreachPolicyDecisionId,
    outreachPolicyDecision: parent.outreachPolicyDecision,
    outreachPolicyVersion: parent.outreachPolicyVersion,
    outreachPolicyConfigurationHash: parent.outreachPolicyConfigurationHash,
    approvedAt: args.sentAt,
    approvedInboxId: inbox._id,
    approvedInboxConfigurationVersion: inbox.configurationVersion ?? 0,
    approvalKind: "account_autopilot",
    approvalConsentVersion: parent.approvalConsentVersion,
    approvalConsentPolicyHash: parent.approvalConsentPolicyHash,
    approvalConsentAcceptedAt: parent.approvalConsentAcceptedAt,
    scheduledAt,
    createdAt: args.sentAt,
    updatedAt: args.sentAt,
  });
  return { queued: true };
}

/** Shared exact settlement used by a synchronous send, a signed delivery
 * event, or the finite +72h status/disposition reconciler. It accepts only
 * adapter-derived digests/receipts and keeps owner/contact/follow-up effects
 * in the same transaction as the terminal message state. */
export async function quarantineManagedSesMessageIdentityMismatch(
  ctx: MutationCtx,
  message: Doc<"outreach_messages">,
  timestamp: number,
) {
  await ctx.db.patch(message._id, {
    status: ["replied", "bounced"].includes(message.status)
      ? message.status
      : "failed",
    failureReason:
      "The managed sender returned a signed provider/RFC/thread identity mismatch. The operation is quarantined and will not be replayed.",
    managedSesDispositionState: "quarantined_integrity",
    managedSesDispositionLeaseToken: undefined,
    managedSesDispositionLeaseExpiresAt: undefined,
    managedSesDispositionSettledAt: timestamp,
    updatedAt: timestamp,
  });
}

export async function settleManagedSesAcceptedMessage(
  ctx: MutationCtx,
  args: {
    message: Doc<"outreach_messages">;
    providerMessageIdDigest: string;
    rfcMessageIdDigest: string;
    threadReceipt: string;
    acceptedAt: number;
  },
): Promise<{
  settled: boolean;
  followUpQueued: boolean;
  identityMismatch?: boolean;
}> {
  const { message } = args;
  if (
    message.deliveryTransport !== MANAGED_SES_TRANSPORT ||
    !message.managedSesOperationKey ||
    !message.managedSesExternalAttemptedAt ||
    !/^[a-f0-9]{64}$/.test(args.providerMessageIdDigest) ||
    !/^[a-f0-9]{64}$/.test(args.rfcMessageIdDigest) ||
    !/^[A-Za-z0-9_-]{32,96}$/.test(args.threadReceipt)
  ) return { settled: false, followUpQueued: false };
  if (!managedSesIdentityTupleMatchesEstablished({
    establishedProviderMessageIdDigest:
      message.managedSesProviderMessageIdDigest,
    establishedRfcMessageIdDigest:
      message.inboundRelayOutboundMessageIdHash,
    establishedThreadReceipt: message.managedSesThreadReceipt,
    providerMessageIdDigest: args.providerMessageIdDigest,
    rfcMessageIdDigest: args.rfcMessageIdDigest,
    threadReceipt: args.threadReceipt,
  })) {
    await quarantineManagedSesMessageIdentityMismatch(ctx, message, Date.now());
    return {
      settled: false,
      followUpQueued: false,
      identityMismatch: true,
    };
  }
  if (message.sentAt) {
    const exact =
      message.managedSesProviderMessageIdDigest ===
        args.providerMessageIdDigest &&
      message.inboundRelayOutboundMessageIdHash ===
        args.rfcMessageIdDigest &&
      message.managedSesThreadReceipt === args.threadReceipt;
    return { settled: exact, followUpQueued: false };
  }
  const acceptedAt = Math.max(
    message.managedSesExternalAttemptedAt,
    args.acceptedAt,
  );
  const settlement = await settleAcceptedDeliveryCounter(
    ctx,
    message,
    message.siteId,
    acceptedAt,
  );
  await ctx.db.patch(message._id, {
    status: "sent",
    sentAt: acceptedAt,
    managedSesProviderMessageIdDigest: args.providerMessageIdDigest,
    inboundRelayOutboundMessageIdHash: args.rfcMessageIdDigest,
    managedSesThreadReceipt: args.threadReceipt,
    failureReason: undefined,
    updatedAt: Date.now(),
  });
  if (settlement.ownsCurrentSite) {
    const [opportunity, contact] = await Promise.all([
      ctx.db.get(message.opportunityId),
      ctx.db
        .query("outreach_contacts")
        .withIndex("by_site_email", (q) =>
          q.eq("siteId", message.siteId).eq("email", message.toEmail)
        )
        .unique(),
    ]);
    const lifecycle = outreachDeliverySettlementDecision({
      sequenceStep: message.sequenceStep,
      messageSiteId: String(message.siteId),
      opportunitySiteId: opportunity ? String(opportunity.siteId) : undefined,
      messageEvidenceHash: message.opportunityEvidenceHash,
      opportunityEvidenceHash: opportunity?.evidenceHash,
      messageSourceUrl: message.opportunitySourceUrl,
      opportunitySourceUrl: opportunity?.sourceUrl,
      messageTargetUrl: message.opportunityTargetUrl,
      opportunityTargetUrl: opportunity?.targetUrl,
      opportunityStatus: opportunity?.siteId === message.siteId
        ? opportunity.status
        : undefined,
    });
    if (
      opportunity?.siteId === message.siteId &&
      lifecycle.shouldMarkContacted
    ) {
      await ctx.db.patch(opportunity._id, {
        status: "contacted",
        contactedAt: acceptedAt,
        updatedAt: Date.now(),
      });
    }
    if (contact) {
      await ctx.db.patch(contact._id, {
        lastContactedAt: acceptedAt,
        updatedAt: Date.now(),
      });
    }
  }
  const next = settlement.ownsCurrentSite
    ? await queueNextVerifiedAutonomousFollowUp(ctx, {
        siteId: message.siteId,
        parentMessageId: message._id,
        transport: MANAGED_SES_TRANSPORT,
        providerThreadId: undefined,
        outboundRfcMessageId: undefined,
        managedSesOperationKey: message.managedSesOperationKey,
        managedSesThreadReceipt: args.threadReceipt,
        rfcMessageIdDigest: args.rfcMessageIdDigest,
        sentAt: acceptedAt,
      })
    : { queued: false };
  return { settled: true, followUpQueued: next.queued };
}

/** Finalize a synchronously accepted managed SES operation without ever
 * storing the provider message identifier. The adapter exposes only its
 * digest, and a signed event is allowed to win the settlement race. */
export const completeManagedSesDeliveryAttempt = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    providerMessageIdDigest: v.string(),
    rfcMessageIdDigest: v.string(),
    threadReceipt: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.siteId !== args.siteId) {
      throw new Error("Message not found for site");
    }
    const now = Date.now();
    if (
      !/^[a-f0-9]{64}$/.test(args.providerMessageIdDigest) ||
      !/^[a-f0-9]{64}$/.test(args.rfcMessageIdDigest) ||
      !/^[A-Za-z0-9_-]{32,96}$/.test(args.threadReceipt) ||
      message.deliveryTransport !== MANAGED_SES_TRANSPORT ||
      message.managedSesOperationKey !== args.attemptId ||
      message.deliveryAttemptId !== args.attemptId ||
      !message.managedSesExternalAttemptedAt
    ) {
      throw new Error("Managed SES delivery receipt crossed an operation binding");
    }
    if (!managedSesIdentityTupleMatchesEstablished({
      establishedProviderMessageIdDigest:
        message.managedSesProviderMessageIdDigest,
      establishedRfcMessageIdDigest:
        message.inboundRelayOutboundMessageIdHash,
      establishedThreadReceipt: message.managedSesThreadReceipt,
      providerMessageIdDigest: args.providerMessageIdDigest,
      rfcMessageIdDigest: args.rfcMessageIdDigest,
      threadReceipt: args.threadReceipt,
    })) {
      await quarantineManagedSesMessageIdentityMismatch(ctx, message, now);
      return {
        recorded: false as const,
        terminal: true as const,
        identityMismatch: true as const,
        reason: "Signed managed-sender identity mismatch was quarantined.",
      };
    }
    if (
      message.managedSesProviderMessageIdDigest ===
        args.providerMessageIdDigest &&
      message.inboundRelayOutboundMessageIdHash ===
        args.rfcMessageIdDigest &&
      message.managedSesThreadReceipt === args.threadReceipt &&
      ["sent", "replied"].includes(message.status)
    ) {
      return { recorded: true as const, eventWon: true as const };
    }
    if (
      message.managedSesProviderMessageIdDigest ===
        args.providerMessageIdDigest &&
      message.inboundRelayOutboundMessageIdHash ===
        args.rfcMessageIdDigest &&
      message.managedSesThreadReceipt === args.threadReceipt &&
      ["bounced", "failed"].includes(message.status)
    ) {
      return {
        recorded: false as const,
        terminal: true as const,
        reason: "A signed terminal delivery event won settlement.",
      };
    }
    if (message.status !== "sending") {
      return {
        recorded: false as const,
        reason: "Delivery attempt no longer owns this message.",
      };
    }
    if ((message.deliveryLeaseExpiresAt ?? 0) <= now) {
      await ctx.db.patch(message._id, {
        status: "delivery_unverified",
        deliveryLeaseExpiredAt: now,
        failureReason:
          "The signed managed-sender receipt arrived after the delivery lease expired. This operation will not be replayed.",
        updatedAt: now,
      });
      return {
        recorded: false as const,
        reason: "Delivery lease expired before receipt finalization.",
      };
    }
    const settlement = await settleAcceptedDeliveryCounter(
      ctx,
      message,
      args.siteId,
      now,
    );
    if (!settlement.ownsCurrentSite) {
      await ctx.db.patch(message._id, {
        status: "delivery_unverified",
        sentAt: now,
        managedSesProviderMessageIdDigest: args.providerMessageIdDigest,
        managedSesThreadReceipt: args.threadReceipt,
        inboundRelayOutboundMessageIdHash: args.rfcMessageIdDigest,
        deliveryLeaseExpiredAt: now,
        failureReason:
          "The managed sender accepted this attempt after the tenant owner changed. Durable cooldown was preserved and the operation will not be replayed.",
        updatedAt: now,
      });
      return { recorded: true as const, ownerChanged: true as const };
    }
    await ctx.db.patch(message._id, {
      status: "sent",
      sentAt: now,
      managedSesProviderMessageIdDigest: args.providerMessageIdDigest,
      managedSesThreadReceipt: args.threadReceipt,
      inboundRelayOutboundMessageIdHash: args.rfcMessageIdDigest,
      failureReason: undefined,
      updatedAt: now,
    });
    const opportunity = await ctx.db.get(message.opportunityId);
    const lifecycle = outreachDeliverySettlementDecision({
      sequenceStep: message.sequenceStep,
      messageSiteId: String(message.siteId),
      opportunitySiteId: opportunity ? String(opportunity.siteId) : undefined,
      messageEvidenceHash: message.opportunityEvidenceHash,
      opportunityEvidenceHash: opportunity?.evidenceHash,
      messageSourceUrl: message.opportunitySourceUrl,
      opportunitySourceUrl: opportunity?.sourceUrl,
      messageTargetUrl: message.opportunityTargetUrl,
      opportunityTargetUrl: opportunity?.targetUrl,
      opportunityStatus:
        opportunity?.siteId === args.siteId ? opportunity.status : undefined,
    });
    if (
      opportunity &&
      opportunity.siteId === args.siteId &&
      lifecycle.shouldMarkContacted
    ) {
      await ctx.db.patch(opportunity._id, {
        status: "contacted",
        contactedAt: now,
        updatedAt: now,
      });
    }
    const contact = await ctx.db
      .query("outreach_contacts")
      .withIndex("by_site_email", (q) =>
        q.eq("siteId", args.siteId).eq("email", message.toEmail)
      )
      .unique();
    if (contact) {
      await ctx.db.patch(contact._id, {
        lastContactedAt: now,
        updatedAt: now,
      });
    }
    const next = await queueNextVerifiedAutonomousFollowUp(ctx, {
      siteId: args.siteId,
      parentMessageId: message._id,
      transport: MANAGED_SES_TRANSPORT,
      providerThreadId: undefined,
      outboundRfcMessageId: undefined,
      managedSesOperationKey: message.managedSesOperationKey,
      managedSesThreadReceipt: args.threadReceipt,
      rfcMessageIdDigest: args.rfcMessageIdDigest,
      sentAt: now,
    });
    return { recorded: true as const, followUpQueued: next.queued };
  },
});

export const completeDeliveryAttempt = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    providerMessageId: v.optional(v.string()),
    providerThreadId: v.optional(v.string()),
    outboundRfcMessageId: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      siteId,
      messageId,
      attemptId,
      providerMessageId,
      providerThreadId,
      outboundRfcMessageId,
    },
  ) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.siteId !== siteId) throw new Error("Message not found for site");
    const now = Date.now();
    const smtpDelivery = message.deliveryTransport === "smtp";
    const transportLabel = smtpDelivery ? "SMTP" : "Gmail";
    if (
      message.status !== "sending" ||
      message.deliveryAttemptId !== attemptId
    ) {
      return { recorded: false, reason: "Delivery attempt no longer owns this message." };
    }
    if ((message.deliveryLeaseExpiresAt ?? 0) <= now) {
      await ctx.db.patch(messageId, {
        status: "delivery_unverified",
        deliveryLeaseExpiredAt: now,
        failureReason:
          `${transportLabel} returned after the delivery lease expired. The outcome requires manual review and will not be retried automatically.`,
        updatedAt: now,
      });
      return { recorded: false, reason: "Delivery lease expired before receipt finalization." };
    }
    const safeProviderMessageId = providerMessageId
      ?.replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 200);
    const safeProviderThreadId = providerThreadId
      ?.replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 200);
    const safeOutboundRfcMessageId = normalizeRfcMessageId(
      outboundRfcMessageId,
    );
    if (
      message.inboundRelayOutboundMessageIdHash &&
      (!safeOutboundRfcMessageId ||
        inboundRelayMessageIdHash(safeOutboundRfcMessageId) !==
          message.inboundRelayOutboundMessageIdHash)
    ) {
      await ctx.db.patch(messageId, {
        status: "delivery_unverified",
        deliveryLeaseExpiredAt: now,
        failureReason:
          `The ${transportLabel} receipt did not match the claimed outbound message identity. Manual review is required.`,
        updatedAt: now,
      });
      return {
        recorded: false,
        reason: "Outbound message identity was missing or invalid.",
      };
    }
    if (!safeProviderMessageId) {
      await ctx.db.patch(messageId, {
        status: "delivery_unverified",
        deliveryLeaseExpiredAt: now,
        failureReason:
          `${transportLabel} did not return a valid delivery receipt. Manual review is required and the message will not be retried automatically.`,
        updatedAt: now,
      });
      return { recorded: false, reason: "Gmail receipt was missing or invalid." };
    }
    // The daily counter and its day key move together so a stale count can
    // never authorise tomorrow's sends.
    const settlement = await settleAcceptedDeliveryCounter(
      ctx,
      message,
      siteId,
      now,
    );
    if (!settlement.ownsCurrentSite) {
      await ctx.db.patch(messageId, {
        status: "delivery_unverified",
        // The provider receipt proved acceptance and the durable pacing/contact
        // settlement above has already been counted. Preserve only the
        // chronology (never provider identifiers) so a later relay event
        // cannot count the same accepted send a second time.
        sentAt: now,
        deliveryLeaseExpiredAt: now,
        failureReason:
          `${transportLabel} accepted this attempt after the site owner changed. The original account's durable cooldown was preserved, but provider identifiers were not exposed to the new owner.`,
        updatedAt: now,
      });
      return { recorded: true, ownerChanged: true };
    }
    if (
      !smtpDelivery && message.sequenceStep > 0 &&
      (!message.deliveryExpectedThreadId ||
        safeProviderThreadId !== message.deliveryExpectedThreadId)
    ) {
      await ctx.db.patch(messageId, {
        status: "delivery_unverified",
        sentAt: now,
        deliveryLeaseExpiredAt: now,
        failureReason:
          "Gmail accepted the follow-up but did not preserve the exact claimed thread identity. The accepted send was counted, no later step was created, and this outcome will not be replayed.",
        updatedAt: now,
      });
      return {
        recorded: true,
        threadMismatch: true,
        followUpQueued: false,
      };
    }
    await ctx.db.patch(messageId, {
      status: "sent",
      sentAt: now,
      providerMessageId: safeProviderMessageId,
      providerThreadId: safeProviderThreadId || undefined,
      updatedAt: now,
    });

    const opportunity = await ctx.db.get(message.opportunityId);
    const settlementLifecycle = outreachDeliverySettlementDecision({
      sequenceStep: message.sequenceStep,
      messageSiteId: String(message.siteId),
      opportunitySiteId: opportunity ? String(opportunity.siteId) : undefined,
      messageEvidenceHash: message.opportunityEvidenceHash,
      opportunityEvidenceHash: opportunity?.evidenceHash,
      messageSourceUrl: message.opportunitySourceUrl,
      opportunitySourceUrl: opportunity?.sourceUrl,
      messageTargetUrl: message.opportunityTargetUrl,
      opportunityTargetUrl: opportunity?.targetUrl,
      opportunityStatus:
        opportunity?.siteId === siteId ? opportunity.status : undefined,
    });
    if (
      settlement.ownsCurrentSite &&
      opportunity &&
      opportunity.siteId === siteId &&
      settlementLifecycle.shouldMarkContacted
    ) {
      await ctx.db.patch(opportunity._id, {
        status: "contacted",
        contactedAt: now,
        updatedAt: now,
      });
    }

    if (settlement.ownsCurrentSite) {
      const contact = await ctx.db
        .query("outreach_contacts")
        .withIndex("by_site_email", (q) =>
          q.eq("siteId", siteId).eq("email", message.toEmail),
        )
        .unique();
      if (contact) {
        await ctx.db.patch(contact._id, {
          lastContactedAt: now,
          updatedAt: now,
        });
      }
    }

    const next = await queueNextVerifiedAutonomousFollowUp(ctx, {
      siteId,
      parentMessageId: messageId,
      transport: smtpDelivery ? "smtp" : "gmail",
      providerThreadId: safeProviderThreadId,
      outboundRfcMessageId: safeOutboundRfcMessageId,
      sentAt: now,
    });

    return { recorded: true, followUpQueued: next.queued };
  },
});

export const failDeliveryAttempt = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    reason: v.string(),
    bounced: v.optional(v.boolean()),
    unverified: v.optional(v.boolean()),
    preserveContactClaim: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      siteId,
      messageId,
      attemptId,
      reason,
      bounced,
      unverified,
      preserveContactClaim,
    },
  ) => {
    const message = await ctx.db.get(messageId);
    if (!message || message.siteId !== siteId) throw new Error("Message not found for site");
    const now = Date.now();
    if (message.status !== "sending" || message.deliveryAttemptId !== attemptId) {
      return { recorded: false };
    }
    await ctx.db.patch(messageId, {
      status: unverified ? "delivery_unverified" : bounced ? "bounced" : "failed",
      failureReason: sanitizeDeliveryFailure(reason),
      bouncedAt: bounced ? now : undefined,
      deliveryLeaseExpiredAt: unverified ? now : undefined,
      updatedAt: now,
    });
    if (
      unverified &&
      message.deliveryTransport === MANAGED_SES_TRANSPORT &&
      message.managedSesExternalAttemptedAt &&
      message.managedSesResourceOperationKey
    ) {
      const resourceRows = message.inboxId
        ? await ctx.db
          .query("managed_outreach_mailbox_resources")
          .withIndex("by_canonical_inbox", (q) =>
            q.eq("canonicalInboxId", message.inboxId)
          )
          .take(20)
        : [];
      const resource = resourceRows.find((row) =>
        row.operationKey === message.managedSesResourceOperationKey &&
        row.generation === message.managedSesGeneration &&
        row.adapterVersion === message.managedSesAdapterVersion
      );
      if (resource) {
        await ctx.scheduler.runAt(
          Math.max(
            now,
            message.managedSesExternalAttemptedAt +
              MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
          ),
          internal.managedOutreachMailbox
            .claimManagedSesAmbiguityReconciliation,
          { resourceId: resource._id },
        );
      }
    }
    const [site, inbox] = await Promise.all([
      ctx.db.get(siteId),
      message.inboxId ? ctx.db.get(message.inboxId) : null,
    ]);
    const settlementAccountKey = immutableDeliveryOwnerAccountKey(
      message,
      inbox && inbox.siteId === siteId ? inbox : null,
    );
    const ownsCurrentSite = Boolean(
      site?.userId &&
        settlementAccountKey === accountDeletionKey(site.userId),
    );
    if (!ownsCurrentSite) {
      await ctx.db.patch(messageId, {
        failureReason:
          "The original account's Gmail attempt settled after the site owner changed; provider details were not exposed to the new owner.",
        updatedAt: now,
      });
    }
    if (settlementAccountKey) {
      if (bounced) {
        await recordDurableContactReceiptForAccount(
          ctx,
          settlementAccountKey,
          message.toDomain,
          message.deliveryClaimedAt ?? now,
          attemptId,
        );
      } else if (!unverified && !preserveContactClaim) {
        await releaseDurableContactClaimForAccount(
          ctx,
          settlementAccountKey,
          message.toDomain,
          attemptId,
          now,
        );
      }
    }
    // A bounce is an address that must never be tried again.
    if (bounced) {
      if (ownsCurrentSite) {
        await addSuppression(ctx, siteId, "email", message.toEmail, "bounce");
      } else if (settlementAccountKey) {
        await materializeOutreachSuppressionTombstoneForAccount(
          ctx,
          settlementAccountKey,
          "email",
          message.toEmail,
          "bounce",
          now,
        );
      }
    }
    return { recorded: true };
  },
});

/**
 * Resolve an ambiguous provider outcome only after the tenant checks Gmail's
 * Sent folder. Neither resolution restores the same draft to `approved`.
 */
export const resolveUnverifiedDelivery = mutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    resolution: v.union(
      v.literal("confirmed_sent"),
      v.literal("confirmed_not_sent"),
    ),
  },
  handler: async (ctx, { siteId, messageId, resolution }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const message = await ctx.db.get(messageId);
    if (
      !message ||
      message.siteId !== siteId ||
      !outreachMessageOwnerMatches(
        message,
        accountDeletionKey(site.userId!),
      )
    ) {
      throw new Error("Message not found for site");
    }
    const settlementInbox = message.inboxId
      ? await ctx.db.get(message.inboxId)
      : null;
    const settlementAccountKey = immutableDeliveryOwnerAccountKey(
      message,
      settlementInbox?.siteId === siteId ? settlementInbox : null,
    );
    if (
      !site.userId ||
      !settlementAccountKey ||
      settlementAccountKey !== accountDeletionKey(site.userId)
    ) {
      throw new Error(
        "Only the account that claimed this Gmail delivery may review its outcome",
      );
    }
    if (message.status !== "delivery_unverified") {
      throw new Error("Only an unverified delivery outcome can be reviewed");
    }
    if (message.deliveryTransport === MANAGED_SES_TRANSPORT) {
      throw new Error(
        "Managed delivery ambiguity is settled only by signed status, event, or no-replay disposition receipts",
      );
    }
    const now = Date.now();
    if (resolution === "confirmed_not_sent") {
      await ctx.db.patch(messageId, {
        status: "failed",
        deliveryReviewedAt: now,
        deliveryReviewResolution: resolution,
        failureReason:
          "The tenant reviewed Gmail and confirmed that the message was not sent. Run a fresh authority scan before generating and approving a new draft.",
        updatedAt: now,
      });
      if (message.deliveryAttemptId) {
        await releaseDurableContactClaimForAccount(
          ctx,
          settlementAccountKey,
          message.toDomain,
          message.deliveryAttemptId,
          now,
        );
      }
      return { status: "failed" as const };
    }

    // This is deliberately not labelled as a provider-verified `sent` row.
    // It participates in cooldown and pacing because the tenant confirmed the
    // message in Gmail's Sent folder, while retaining the honest evidence gap.
    const previouslyCountedAcceptedReceipt = Boolean(message.sentAt);
    await ctx.db.patch(messageId, {
      status: "delivery_reviewed_sent",
      sentAt: message.sentAt ?? message.deliveryClaimedAt ?? now,
      deliveryReviewedAt: now,
      deliveryReviewResolution: resolution,
      failureReason:
        "The tenant confirmed this message in Gmail's Sent folder; no provider receipt was captured by Pentra.",
      updatedAt: now,
    });
    if (!previouslyCountedAcceptedReceipt) {
      const settlement = await settleAcceptedDeliveryCounter(
        ctx,
        message,
        siteId,
        now,
      );
      if (!settlement.ownsCurrentSite) {
        throw new Error(
          "The delivery owner changed before the review could be recorded",
        );
      }
    }
    const opportunity = await ctx.db.get(message.opportunityId);
    const settlementLifecycle = outreachDeliverySettlementDecision({
      sequenceStep: message.sequenceStep,
      messageSiteId: String(message.siteId),
      opportunitySiteId: opportunity ? String(opportunity.siteId) : undefined,
      messageEvidenceHash: message.opportunityEvidenceHash,
      opportunityEvidenceHash: opportunity?.evidenceHash,
      messageSourceUrl: message.opportunitySourceUrl,
      opportunitySourceUrl: opportunity?.sourceUrl,
      messageTargetUrl: message.opportunityTargetUrl,
      opportunityTargetUrl: opportunity?.targetUrl,
      opportunityStatus:
        opportunity?.siteId === siteId ? opportunity.status : undefined,
    });
    if (
      opportunity &&
      opportunity.siteId === siteId &&
      settlementLifecycle.shouldMarkContacted
    ) {
      await ctx.db.patch(opportunity._id, {
        status: "contacted",
        contactedAt: now,
        updatedAt: now,
      });
    }
    const contact = await ctx.db
      .query("outreach_contacts")
      .withIndex("by_site_email", (q) =>
        q.eq("siteId", siteId).eq("email", message.toEmail),
      )
      .unique();
    if (contact) {
      await ctx.db.patch(contact._id, { lastContactedAt: now, updatedAt: now });
    }
    return { status: "delivery_reviewed_sent" as const };
  },
});

export const recordReply = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    unsubscribe: v.optional(v.boolean()),
  },
  handler: async () => {
    // Legacy callers supplied only booleans and could not prove which Gmail
    // message was observed. All automated inbound transitions now require the
    // leased, provider-bound, hashed receipt accepted by recordInboundReceipt.
    throw new Error(
      "Legacy reply recording is disabled; use the verified Gmail inbound sync",
    );
  },
});

// ── Signed receiving-only relay receipts ──

export const createInboundRelayDsnCanary = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    aliasHash: v.string(),
    outboundMessageIdHash: v.string(),
    testRecipientHash: v.string(),
    relayDomain: v.string(),
    senderDomain: v.string(),
    rolloutEpoch: v.number(),
    inboxConfigurationVersion: v.number(),
    relayConfigurationHash: v.string(),
    adapterVersion: v.string(),
    retentionPolicyHash: v.string(),
    dsnRoutingTargetHash: v.string(),
    dsnRoutingTargetVersion: v.number(),
    dsnRoutingTargetGeneration: v.number(),
    issuedAt: v.number(),
    expiresAt: v.number(),
    attemptId: v.string(),
    deliveryLeaseExpiresAt: v.number(),
    dnsEvidence: dnsEvidenceValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [site, inbox, existingCanaries] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db
        .query("outreach_inbound_relay_canaries")
        .withIndex("by_inbox", (q) => q.eq("inboxId", args.inboxId))
        .take(2),
    ]);
    const runtimeConfig = inboundRelayRuntimeConfig();
    const configurationHash = inboundRelayConfigurationHash(runtimeConfig);
    const relayDomain = normalizeInboundRelayDomain(args.relayDomain);
    const expectedDsnRoutingTarget = await inboundRelayDsnRoutingTarget({
      siteId: String(args.siteId),
      inboxId: String(args.inboxId),
      generation: inbox?.inboundRelayDsnRoutingTargetGeneration ?? 1,
      relayDomain: runtimeConfig.domain,
      secret: runtimeConfig.dsnTargetSecret,
    });
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.userId ||
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId) ||
      inbox.provider !== "gmail" ||
      ["disconnected", "suspended"].includes(inbox.status) ||
      (inbox.configurationVersion ?? 0) !== args.inboxConfigurationVersion ||
      (site.autopilotRolloutEpoch ?? 0) !== args.rolloutEpoch ||
      normalizeDomain(inbox.senderDomain ?? "") !==
        normalizeDomain(args.senderDomain) ||
      !configurationHash ||
      configurationHash !== args.relayConfigurationHash ||
      relayDomain !== normalizeInboundRelayDomain(runtimeConfig.domain) ||
      args.adapterVersion !== runtimeConfig.adapterVersion ||
      args.retentionPolicyHash !== runtimeConfig.retentionPolicyHash ||
      !expectedDsnRoutingTarget ||
      args.dsnRoutingTargetHash !== expectedDsnRoutingTarget.hash ||
      args.dsnRoutingTargetVersion !== expectedDsnRoutingTarget.version ||
      args.dsnRoutingTargetVersion !==
        OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
      args.dsnRoutingTargetGeneration !==
        (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      !/^[a-f0-9]{64}$/.test(args.aliasHash) ||
      !/^[a-f0-9]{64}$/.test(args.outboundMessageIdHash) ||
      !/^[a-f0-9]{64}$/.test(args.testRecipientHash) ||
      args.testRecipientHash === inboundRelayEmailHash(inbox.fromEmail) ||
      !Number.isSafeInteger(args.issuedAt) ||
      Math.abs(now - args.issuedAt) > 60_000 ||
      args.expiresAt - args.issuedAt !==
        OUTREACH_INBOUND_RELAY_CANARY_TTL_MS ||
      !/^[a-z0-9-]{20,100}$/i.test(args.attemptId) ||
      args.deliveryLeaseExpiresAt - args.issuedAt !==
        OUTREACH_INBOUND_RELAY_CANARY_SEND_LEASE_MS ||
      existingCanaries.length > 1
    ) {
      throw new Error("Inbound relay canary crossed a tenant or configuration boundary");
    }
    const senderIssues = senderClaimIssues({
      siteDomain: site.domain,
      provider: inbox.provider,
      status: inbox.status,
      fromEmail: inbox.fromEmail,
      fromName: inbox.fromName,
      physicalMailingAddress: inbox.physicalMailingAddress,
      complianceConfirmedAt: inbox.complianceConfirmedAt,
      verifiedAt: inbox.verifiedAt,
      oauthScopes: inbox.oauthScopes,
      hasCredential: Boolean(inbox.oauthRefreshToken || inbox.oauthAccessToken),
      senderDomain: inbox.senderDomain,
    });
    const dnsIssues = liveDnsEvidenceIssues({
      checkedAt: args.dnsEvidence.checkedAt,
      now,
      senderDomain: args.dnsEvidence.senderDomain,
      expectedSenderDomain: inbox.senderDomain,
      dkimSelector: args.dnsEvidence.dkimSelector,
      expectedDkimSelector: inbox.dkimSelector,
      spf: args.dnsEvidence.spf,
      dkim: args.dnsEvidence.dkim,
      dmarc: args.dnsEvidence.dmarc,
    });
    const allowedScopes = new Set([
      "https://www.googleapis.com/auth/gmail.send",
      "openid",
      "email",
      "https://www.googleapis.com/auth/userinfo.email",
    ]);
    const grantedScopes = inbox.oauthScopes?.split(/\s+/).filter(Boolean) ?? [];
    if (
      senderIssues.length > 0 ||
      dnsIssues.length > 0 ||
      !grantedScopes.includes("https://www.googleapis.com/auth/gmail.send") ||
      !grantedScopes.every((scope) => allowedScopes.has(scope))
    ) {
      throw new Error("The Gmail sender is not ready for a routing canary");
    }
    const existing = existingCanaries[0];
    if (inboundRelayDsnRoutingReady({
      inbox,
      now,
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      runtimeConfig,
    })) {
      throw new Error(
        "Bounce routing is already verified for the current inbox configuration",
      );
    }
    if (
      existing &&
      existing.issuedAt + OUTREACH_INBOUND_RELAY_CANARY_COOLDOWN_MS > now
    ) {
      throw new Error(
        "A Gmail routing canary has already been attempted for this inbox today",
      );
    }
    if (existing && !existing.verifiedAt && existing.expiresAt > now) {
      throw new Error("A current inbound relay canary challenge is already pending");
    }
    const record = {
      siteId: args.siteId,
      inboxId: args.inboxId,
      aliasHash: args.aliasHash,
      outboundMessageIdHash: args.outboundMessageIdHash,
      testRecipientHash: args.testRecipientHash,
      relayDomain: relayDomain!,
      senderDomain: normalizeDomain(args.senderDomain),
      rolloutEpoch: args.rolloutEpoch,
      inboxConfigurationVersion: args.inboxConfigurationVersion,
      relayConfigurationHash: args.relayConfigurationHash,
      adapterVersion: args.adapterVersion,
      retentionPolicyHash: args.retentionPolicyHash,
      dsnRoutingTargetHash: args.dsnRoutingTargetHash,
      dsnRoutingTargetVersion: args.dsnRoutingTargetVersion,
      dsnRoutingTargetGeneration: args.dsnRoutingTargetGeneration,
      issuedAt: args.issuedAt,
      expiresAt: args.expiresAt,
      deliveryStatus: "claimed",
      deliveryAttemptId: args.attemptId,
      deliveryClaimedAt: args.issuedAt,
      deliveryLeaseExpiresAt: args.deliveryLeaseExpiresAt,
      providerMessageIdHash: undefined,
      deliveryFinalizedAt: undefined,
      verifiedAt: undefined,
      eventKey: undefined,
      payloadHash: undefined,
      evidenceHash: undefined,
    };
    if (existing) {
      await ctx.db.patch(existing._id, record);
      return { canaryId: existing._id, created: false as const };
    }
    const canaryId = await ctx.db.insert(
      "outreach_inbound_relay_canaries",
      record,
    );
    return { canaryId, created: true as const };
  },
});

export const finalizeInboundRelayDsnCanaryDelivery = internalMutation({
  args: {
    canaryId: v.id("outreach_inbound_relay_canaries"),
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    attemptId: v.string(),
    inboxConfigurationVersion: v.number(),
    outcome: v.union(
      v.literal("accepted"),
      v.literal("unverified"),
      v.literal("failed"),
    ),
    providerMessageIdHash: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [canary, inbox] = await Promise.all([
      ctx.db.get(args.canaryId),
      ctx.db.get(args.inboxId),
    ]);
    if (
      canary?.verifiedAt &&
      canary.siteId === args.siteId &&
      canary.inboxId === args.inboxId &&
      canary.deliveryAttemptId === args.attemptId
    ) {
      return { recorded: false as const, dsnVerified: true as const };
    }
    if (
      !canary ||
      canary.siteId !== args.siteId ||
      canary.inboxId !== args.inboxId ||
      canary.deliveryStatus !== "claimed" ||
      canary.deliveryAttemptId !== args.attemptId ||
      !inbox ||
      inbox.siteId !== args.siteId ||
      (inbox.configurationVersion ?? 0) !== args.inboxConfigurationVersion ||
      (args.outcome === "accepted") !==
        Boolean(args.providerMessageIdHash) ||
      (args.providerMessageIdHash !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.providerMessageIdHash))
    ) {
      throw new Error("Inbound relay canary delivery lost its exact claim");
    }
    await ctx.db.patch(canary._id, {
      deliveryStatus: args.outcome,
      deliveryLeaseExpiresAt: undefined,
      providerMessageIdHash: args.providerMessageIdHash,
      deliveryFinalizedAt: now,
      ...(args.outcome === "failed" ? { expiresAt: now } : {}),
    });
    return { recorded: true as const };
  },
});

export const getInboundRelayDsnCanaryCandidate = internalQuery({
  args: {
    aliasHash: v.string(),
    aliasDomain: v.string(),
  },
  handler: async (ctx, { aliasHash, aliasDomain }) => {
    const now = Date.now();
    const runtimeConfig = inboundRelayRuntimeConfig();
    const configurationHash = inboundRelayConfigurationHash(runtimeConfig);
    const configuredDomain = normalizeInboundRelayDomain(runtimeConfig.domain);
    if (
      !configurationHash ||
      !configuredDomain ||
      normalizeInboundRelayDomain(aliasDomain) !== configuredDomain ||
      !/^[a-f0-9]{64}$/.test(aliasHash)
    ) return null;
    const canaries = await ctx.db
      .query("outreach_inbound_relay_canaries")
      .withIndex("by_alias_hash", (q) => q.eq("aliasHash", aliasHash))
      .take(2);
    if (canaries.length !== 1) return null;
    const canary = canaries[0];
    const [site, inbox] = await Promise.all([
      ctx.db.get(canary.siteId),
      ctx.db.get(canary.inboxId),
    ]);
    if (
      canary.verifiedAt ||
      !["claimed", "accepted", "unverified"].includes(
        canary.deliveryStatus,
      ) ||
      canary.expiresAt <= now ||
      canary.relayDomain !== configuredDomain ||
      canary.relayConfigurationHash !== configurationHash ||
      canary.adapterVersion !== runtimeConfig.adapterVersion ||
      canary.retentionPolicyHash !== runtimeConfig.retentionPolicyHash ||
      canary.dsnRoutingTargetVersion !==
        OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
      canary.dsnRoutingTargetGeneration !==
        (inbox?.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      !/^[a-f0-9]{64}$/.test(canary.dsnRoutingTargetHash ?? "") ||
      !site ||
      !site.userId ||
      inbox?.credentialOwnerAccountKey !== accountDeletionKey(site.userId) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      (site.autopilotRolloutEpoch ?? 0) !== canary.rolloutEpoch ||
      !inbox ||
      inbox.siteId !== canary.siteId ||
      inbox.provider !== "gmail" ||
      ["disconnected", "suspended"].includes(inbox.status) ||
      (inbox.configurationVersion ?? 0) !==
        canary.inboxConfigurationVersion ||
      normalizeDomain(inbox.senderDomain ?? "") !== canary.senderDomain
    ) return null;
    return {
      canaryId: canary._id,
      siteId: canary.siteId,
      inboxId: canary.inboxId,
      aliasHash: canary.aliasHash,
      aliasDomain: canary.relayDomain,
      testRecipientHash: canary.testRecipientHash,
      outboundRfcMessageIdHash: canary.outboundMessageIdHash,
      issuedAt: canary.issuedAt,
      expiresAt: canary.expiresAt,
      rolloutEpoch: canary.rolloutEpoch,
      inboxConfigurationVersion: canary.inboxConfigurationVersion,
      senderDomain: canary.senderDomain,
      relayConfigurationHash: canary.relayConfigurationHash,
      adapterVersion: canary.adapterVersion,
      retentionPolicyHash: canary.retentionPolicyHash,
      dsnRoutingTargetHash: canary.dsnRoutingTargetHash!,
      dsnRoutingTargetVersion: canary.dsnRoutingTargetVersion!,
      dsnRoutingTargetGeneration: canary.dsnRoutingTargetGeneration!,
    };
  },
});

/** The only operation that can seal bounce routing. Callers cannot attest to
 * readiness: they must present digests from a signed hard-DSN webhook bound to
 * the active one-time challenge. */
export const recordInboundRelayDsnCanaryReceipt = internalMutation({
  args: {
    canaryId: v.id("outreach_inbound_relay_canaries"),
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    aliasHash: v.string(),
    aliasDomain: v.string(),
    eventKey: v.string(),
    payloadHash: v.string(),
    evidenceHash: v.string(),
    inboundMessageIdHash: v.string(),
    fromEmail: v.string(),
    receivedAt: v.number(),
    rolloutEpoch: v.number(),
    inboxConfigurationVersion: v.number(),
    senderDomain: v.string(),
    relayConfigurationHash: v.string(),
    adapterVersion: v.string(),
    retentionPolicyHash: v.string(),
    dsnRoutingTargetHash: v.string(),
    dsnRoutingTargetVersion: v.number(),
    dsnRoutingTargetGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [canary, site, inbox] = await Promise.all([
      ctx.db.get(args.canaryId),
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
    ]);
    if (canary?.verifiedAt) {
      if (
        canary.eventKey === args.eventKey &&
        canary.payloadHash === args.payloadHash
      ) return { recorded: false as const, replay: true as const };
      throw new Error("Inbound relay canary was already sealed by different evidence");
    }
    const runtimeConfig = inboundRelayRuntimeConfig();
    const configurationHash = inboundRelayConfigurationHash(runtimeConfig);
    const configuredDomain = normalizeInboundRelayDomain(runtimeConfig.domain);
    const fromEmail = args.fromEmail.trim().toLowerCase();
    const expectedDsnRoutingTarget = inbox
      ? await inboundRelayDsnRoutingTarget({
          siteId: String(args.siteId),
          inboxId: String(args.inboxId),
          generation:
            inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
          relayDomain: runtimeConfig.domain,
          secret: runtimeConfig.dsnTargetSecret,
        })
      : null;
    if (
      !canary ||
      canary.siteId !== args.siteId ||
      canary.inboxId !== args.inboxId ||
      canary.aliasHash !== args.aliasHash ||
      canary.relayDomain !== configuredDomain ||
      canary.relayDomain !== normalizeInboundRelayDomain(args.aliasDomain) ||
      canary.rolloutEpoch !== args.rolloutEpoch ||
      canary.inboxConfigurationVersion !== args.inboxConfigurationVersion ||
      canary.senderDomain !== normalizeDomain(args.senderDomain) ||
      canary.relayConfigurationHash !== args.relayConfigurationHash ||
      canary.adapterVersion !== args.adapterVersion ||
      canary.retentionPolicyHash !== args.retentionPolicyHash ||
      canary.dsnRoutingTargetHash !== args.dsnRoutingTargetHash ||
      canary.dsnRoutingTargetVersion !== args.dsnRoutingTargetVersion ||
      canary.dsnRoutingTargetGeneration !==
        args.dsnRoutingTargetGeneration ||
      !["claimed", "accepted", "unverified"].includes(
        canary.deliveryStatus,
      ) ||
      !configurationHash ||
      configurationHash !== args.relayConfigurationHash ||
      runtimeConfig.adapterVersion !== args.adapterVersion ||
      runtimeConfig.retentionPolicyHash !== args.retentionPolicyHash ||
      !expectedDsnRoutingTarget ||
      expectedDsnRoutingTarget.hash !== args.dsnRoutingTargetHash ||
      expectedDsnRoutingTarget.version !== args.dsnRoutingTargetVersion ||
      args.dsnRoutingTargetGeneration !==
        (inbox?.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      canary.expiresAt <= now ||
      args.receivedAt < canary.issuedAt - 60_000 ||
      args.receivedAt > canary.expiresAt ||
      !site ||
      !site.userId ||
      inbox?.credentialOwnerAccountKey !== accountDeletionKey(site.userId) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      (site.autopilotRolloutEpoch ?? 0) !== args.rolloutEpoch ||
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.provider !== "gmail" ||
      ["disconnected", "suspended"].includes(inbox.status) ||
      (inbox.configurationVersion ?? 0) !== args.inboxConfigurationVersion ||
      normalizeDomain(inbox.senderDomain ?? "") !== normalizeDomain(args.senderDomain) ||
      !/^[a-f0-9]{64}$/.test(args.aliasHash) ||
      !/^[a-f0-9]{64}$/.test(args.eventKey) ||
      !/^[a-f0-9]{64}$/.test(args.payloadHash) ||
      !/^[a-f0-9]{64}$/.test(args.evidenceHash) ||
      !/^[a-f0-9]{64}$/.test(args.inboundMessageIdHash) ||
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,24}$/i.test(fromEmail)
    ) {
      throw new Error("Inbound relay canary receipt crossed a tenant or configuration boundary");
    }
    await ctx.db.patch(canary._id, {
      verifiedAt: now,
      deliveryStatus: "dsn_verified",
      deliveryLeaseExpiresAt: undefined,
      eventKey: args.eventKey,
      payloadHash: args.payloadHash,
      evidenceHash: args.evidenceHash,
    });
    await ctx.db.patch(inbox._id, {
      inboundRelayDsnRoutingVerifiedAt: now,
      inboundRelayDsnRoutingConfigurationVersion:
        args.inboxConfigurationVersion,
      inboundRelayDsnRoutingRolloutEpoch: args.rolloutEpoch,
      inboundRelayDsnRoutingSenderDomain: normalizeDomain(args.senderDomain),
      inboundRelayDsnRoutingRelayConfigurationHash:
        args.relayConfigurationHash,
      inboundRelayDsnRoutingEvidenceHash: args.evidenceHash,
      inboundRelayDsnRoutingAdapterVersion: args.adapterVersion,
      inboundRelayDsnRoutingRetentionPolicyHash: args.retentionPolicyHash,
      inboundRelayDsnRoutingTargetHash: args.dsnRoutingTargetHash,
      inboundRelayDsnRoutingTargetVersion: args.dsnRoutingTargetVersion,
      inboundRelayDsnRoutingTargetGeneration:
        args.dsnRoutingTargetGeneration,
      inboundLastCompletedAt: now,
      inboundLastError: undefined,
      updatedAt: now,
    });
    return { recorded: true as const };
  },
});

const inboundRelayKindValidator = v.union(
  v.literal("reply"),
  v.literal("unsubscribe"),
  v.literal("bounce"),
  v.literal("ignored"),
);

const inboundRelayIgnoredReasons = new Set([
  "automatic_message",
  "invalid_sender",
  "missing_reply_proof",
  "recipient_mismatch",
  "sender_authentication_failed",
  "soft_or_invalid_dsn",
  "timestamp_mismatch",
]);

/** Resolve the deterministic digest of the controlled managed-SES canary
 * Reply-To alias. The raw alias and controlled mailbox address never leave
 * the HTTP action; this returns only bodyless hashes and immutable fences. */
export const getManagedSesInboundCanaryCandidate = internalQuery({
  args: {
    aliasHash: v.string(),
    aliasDomain: v.string(),
  },
  handler: async (ctx, args) => {
    const runtime = inboundRelayRuntimeConfig();
    const relayDomain = normalizeInboundRelayDomain(runtime.domain);
    const relayConfigurationHash = inboundRelayConfigurationHash(runtime);
    if (
      !inboundRelayConfigured(runtime) ||
      relayDomain !== MANAGED_SES_PLATFORM_RELAY_DOMAIN ||
      normalizeInboundRelayDomain(args.aliasDomain) !== relayDomain ||
      !relayConfigurationHash ||
      !/^[a-f0-9]{64}$/.test(args.aliasHash)
    ) return null;
    const rows = await ctx.db
      .query("managed_ses_event_canaries")
      .withIndex("by_inbound_alias_hash", (q) =>
        q.eq("inboundRelayAliasHash", args.aliasHash)
      )
      .take(2);
    if (rows.length !== 1) return null;
    const canary = rows[0];
    const [site, inbox, resource] = await Promise.all([
      ctx.db.get(canary.siteId),
      ctx.db.get(canary.inboxId),
      ctx.db.get(canary.resourceId),
    ]);
    const routingTarget = inbox
      ? await inboundRelayDsnRoutingTarget({
          siteId: String(canary.siteId),
          inboxId: String(inbox._id),
          generation: inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
          relayDomain: runtime.domain,
          secret: runtime.dsnTargetSecret,
        })
      : null;
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !inbox ||
      !resource ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" ||
      resource.releaseState !== "active" ||
      resource.canonicalInboxId !== inbox._id ||
      resource.operationKey !== canary.resourceOperationKey ||
      resource.generation !== canary.generation ||
      resource.adapterVersion !== canary.adapterVersion ||
      inbox.provider !== MANAGED_SES_TRANSPORT ||
      inbox.credentialSource !== "managed_adapter" ||
      inbox.managedTransportOperationKey !== resource.operationKey ||
      inbox.managedTransportGeneration !== resource.generation ||
      inbox.managedTransportAdapterVersion !== resource.adapterVersion ||
      canary.inboxConfigurationVersion !==
        (inbox.configurationVersion ?? 0) ||
      canary.inboundRelayAliasDomain !== relayDomain ||
      canary.inboundRelayConfigurationHash !== relayConfigurationHash ||
      canary.inboundRelayAdapterVersion !== runtime.adapterVersion ||
      canary.inboundRelayRetentionPolicyHash !==
        runtime.retentionPolicyHash ||
      canary.inboundRelayRolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
      !routingTarget ||
      canary.inboundRelayDsnRoutingTargetHash !== routingTarget.hash ||
      canary.inboundRelayDsnRoutingTargetVersion !== routingTarget.version ||
      canary.inboundRelayDsnRoutingTargetGeneration !==
        (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      !/^[a-f0-9]{64}$/.test(canary.inboundCanaryInboxBinding ?? "") ||
      !/^[a-f0-9]{64}$/.test(canary.recipientHash) ||
      !/^[a-f0-9]{64}$/.test(canary.rfcMessageIdDigest ?? "") ||
      !canary.externalAttemptedAt ||
      !["accepted", "delivered"].includes(canary.status) ||
      canary.expiresAt < Date.now()
    ) return null;
    return {
      canaryId: canary._id,
      siteId: canary.siteId,
      inboxId: canary.inboxId,
      resourceId: canary.resourceId,
      operationKey: canary.operationKey,
      resourceOperationKey: canary.resourceOperationKey,
      generation: canary.generation,
      adapterVersion: canary.adapterVersion,
      inboxConfigurationVersion: canary.inboxConfigurationVersion,
      inboxBinding: canary.inboundCanaryInboxBinding!,
      recipientHash: canary.recipientHash,
      outboundRfcMessageIdHash: canary.rfcMessageIdDigest!,
      aliasHash: canary.inboundRelayAliasHash!,
      aliasDomain: relayDomain,
      issuedAt: canary.issuedAt,
      expiresAt: canary.expiresAt,
      relayConfigurationHash,
      relayAdapterVersion: runtime.adapterVersion!,
      retentionPolicyHash: runtime.retentionPolicyHash!,
      rolloutEpoch: canary.inboundRelayRolloutEpoch!,
      dsnRoutingTargetHash: canary.inboundRelayDsnRoutingTargetHash!,
      dsnRoutingTargetVersion: canary.inboundRelayDsnRoutingTargetVersion!,
      dsnRoutingTargetGeneration:
        canary.inboundRelayDsnRoutingTargetGeneration!,
    };
  },
});

export const recordManagedSesInboundCanaryReceipt = internalMutation({
  args: {
    canaryId: v.id("managed_ses_event_canaries"),
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    resourceId: v.id("managed_outreach_mailbox_resources"),
    operationKey: v.string(),
    resourceOperationKey: v.string(),
    generation: v.number(),
    adapterVersion: v.string(),
    inboxConfigurationVersion: v.number(),
    inboxBinding: v.string(),
    aliasHash: v.string(),
    aliasDomain: v.string(),
    eventKey: v.string(),
    payloadHash: v.string(),
    evidenceHash: v.string(),
    inboundMessageIdHash: v.string(),
    outboundRfcMessageIdHash: v.string(),
    fromHash: v.string(),
    receivedAt: v.number(),
    relayConfigurationHash: v.string(),
    relayAdapterVersion: v.string(),
    retentionPolicyHash: v.string(),
    rolloutEpoch: v.number(),
    dsnRoutingTargetHash: v.string(),
    dsnRoutingTargetVersion: v.number(),
    dsnRoutingTargetGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const prior = await ctx.db
      .query("managed_ses_event_canaries")
      .withIndex("by_inbound_event_key", (q) =>
        q.eq("inboundCanaryEventKey", args.eventKey)
      )
      .unique();
    if (prior) {
      if (
        prior._id !== args.canaryId ||
        prior.inboundCanaryPayloadHash !== args.payloadHash ||
        prior.inboundCanaryEvidenceHash !== args.evidenceHash
      ) throw new Error("Managed inbound canary event was rebound");
      return { recorded: false as const, replay: true as const };
    }
    const [canary, site, inbox, resource] = await Promise.all([
      ctx.db.get(args.canaryId),
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db.get(args.resourceId),
    ]);
    const runtime = inboundRelayRuntimeConfig();
    const relayDomain = normalizeInboundRelayDomain(runtime.domain);
    const relayConfigurationHash = inboundRelayConfigurationHash(runtime);
    const routingTarget = inbox
      ? await inboundRelayDsnRoutingTarget({
          siteId: String(args.siteId),
          inboxId: String(args.inboxId),
          generation: inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
          relayDomain: runtime.domain,
          secret: runtime.dsnTargetSecret,
        })
      : null;
    if (
      !canary ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !inbox ||
      !resource ||
      canary.siteId !== args.siteId ||
      canary.inboxId !== args.inboxId ||
      canary.resourceId !== args.resourceId ||
      canary.operationKey !== args.operationKey ||
      canary.resourceOperationKey !== args.resourceOperationKey ||
      canary.generation !== args.generation ||
      canary.adapterVersion !== args.adapterVersion ||
      canary.inboxConfigurationVersion !== args.inboxConfigurationVersion ||
      canary.inboundCanaryInboxBinding !== args.inboxBinding ||
      canary.inboundRelayAliasHash !== args.aliasHash ||
      canary.inboundRelayAliasDomain !== relayDomain ||
      args.aliasDomain !== relayDomain ||
      canary.recipientHash !== args.fromHash ||
      canary.rfcMessageIdDigest !== args.outboundRfcMessageIdHash ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" ||
      resource.releaseState !== "active" ||
      resource.canonicalInboxId !== inbox._id ||
      resource.operationKey !== args.resourceOperationKey ||
      resource.generation !== args.generation ||
      resource.adapterVersion !== args.adapterVersion ||
      inbox.provider !== MANAGED_SES_TRANSPORT ||
      inbox.credentialSource !== "managed_adapter" ||
      inbox.managedTransportOperationKey !== resource.operationKey ||
      inbox.managedTransportGeneration !== resource.generation ||
      inbox.managedTransportAdapterVersion !== resource.adapterVersion ||
      (inbox.configurationVersion ?? 0) !== args.inboxConfigurationVersion ||
      !relayConfigurationHash ||
      args.relayConfigurationHash !== relayConfigurationHash ||
      canary.inboundRelayConfigurationHash !== relayConfigurationHash ||
      args.relayAdapterVersion !== runtime.adapterVersion ||
      canary.inboundRelayAdapterVersion !== runtime.adapterVersion ||
      args.retentionPolicyHash !== runtime.retentionPolicyHash ||
      canary.inboundRelayRetentionPolicyHash !== runtime.retentionPolicyHash ||
      args.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
      canary.inboundRelayRolloutEpoch !== args.rolloutEpoch ||
      !routingTarget ||
      args.dsnRoutingTargetHash !== routingTarget.hash ||
      args.dsnRoutingTargetVersion !== routingTarget.version ||
      args.dsnRoutingTargetGeneration !==
        (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      canary.inboundRelayDsnRoutingTargetHash !== routingTarget.hash ||
      canary.inboundRelayDsnRoutingTargetVersion !== routingTarget.version ||
      canary.inboundRelayDsnRoutingTargetGeneration !==
        (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      !/^[a-f0-9]{64}$/.test(args.eventKey) ||
      !/^[a-f0-9]{64}$/.test(args.payloadHash) ||
      !/^[a-f0-9]{64}$/.test(args.evidenceHash) ||
      !/^[a-f0-9]{64}$/.test(args.inboundMessageIdHash) ||
      !/^[a-f0-9]{64}$/.test(args.outboundRfcMessageIdHash) ||
      !/^[a-f0-9]{64}$/.test(args.fromHash) ||
      !/^[a-f0-9]{64}$/.test(args.inboxBinding) ||
      !Number.isSafeInteger(args.receivedAt) ||
      args.receivedAt < canary.issuedAt - 60_000 ||
      args.receivedAt > canary.expiresAt ||
      args.receivedAt > timestamp + 5 * 60 * 1000
    ) throw new Error("Managed inbound canary crossed a binding");
    await ctx.db.patch(canary._id, {
      inboundCanaryEventKey: args.eventKey,
      inboundCanaryPayloadHash: args.payloadHash,
      inboundCanaryEvidenceHash: args.evidenceHash,
      inboundCanaryMessageIdHash: args.inboundMessageIdHash,
      inboundCanaryFromHash: args.fromHash,
      inboundCanarySettledAt: args.receivedAt,
      inboundCanaryActivationState: "pending",
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.managedOutreachMailbox.activateManagedSesInboundCanary,
      { canaryId: canary._id },
    );
    return { recorded: true as const };
  },
});

/** Resolve an unguessable per-message alias to one bodyless candidate. This
 * query is internal-only and returns no draft body or mailbox credential. */
export const getInboundRelayCandidate = internalQuery({
  args: {
    aliasHash: v.string(),
    aliasDomain: v.string(),
  },
  handler: async (ctx, { aliasHash, aliasDomain }) => {
    const configuredDomain = normalizeInboundRelayDomain(
      process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    );
    if (
      !inboundRelayConfigured(inboundRelayRuntimeConfig()) ||
      !configuredDomain ||
      normalizeInboundRelayDomain(aliasDomain) !== configuredDomain ||
      !/^[a-f0-9]{64}$/.test(aliasHash)
    ) {
      return null;
    }
    const messages = await ctx.db
      .query("outreach_messages")
      .withIndex("by_relay_alias_hash", (q) =>
        q.eq("inboundRelayAliasHash", aliasHash)
      )
      .take(2);
    if (messages.length !== 1) return null;
    const message = messages[0];
    const settlementBoundaryAt =
      message.deliveryClaimedAt ?? message.sentAt;
    const chronologyAt = message.sentAt ?? message.deliveryClaimedAt;
    const [site, inbox] = await Promise.all([
      ctx.db.get(message.siteId),
      message.inboxId ? ctx.db.get(message.inboxId) : null,
    ]);
    const settlementAccountKey = immutableDeliveryOwnerAccountKey(
      message,
      inbox && inbox.siteId === message.siteId ? inbox : null,
    );
    const settlementOwnerDeleting = settlementAccountKey
      ? await accountDeletionRequestedForKey(ctx, settlementAccountKey)
      : true;
    const managedSesIdentityPending =
      message.deliveryTransport === MANAGED_SES_TRANSPORT &&
      (!/^[a-f0-9]{64}$/.test(
        message.inboundRelayOutboundMessageIdHash ?? "",
      ) ||
        !/^[a-f0-9]{64}$/.test(
          message.managedSesProviderMessageIdDigest ?? "",
        ) ||
        !/^[A-Za-z0-9_-]{32,96}$/.test(
          message.managedSesThreadReceipt ?? "",
        ));
    if (
      !site ||
      !(await relaySettlementAuthorized(ctx, site, settlementBoundaryAt)) ||
      !inbox ||
      inbox.siteId !== message.siteId ||
      !settlementAccountKey ||
      settlementOwnerDeleting ||
      message.inboundRelayAliasDomain !== configuredDomain ||
      message.inboundRelayInboxConfigurationVersion === undefined ||
      message.inboundRelayRolloutEpoch === undefined ||
      !message.inboundRelaySenderDomain ||
      message.inboundRelaySenderDomain !==
        normalizeDomain(message.inboundRelaySenderDomain) ||
      (!managedSesIdentityPending &&
        !/^[a-f0-9]{64}$/.test(
          message.inboundRelayOutboundMessageIdHash ?? "",
        )) ||
      !/^[a-f0-9]{64}$/.test(
        message.inboundRelayDsnRoutingTargetHash ?? "",
      ) ||
      message.inboundRelayDsnRoutingTargetVersion !==
        OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
      !Number.isSafeInteger(
        message.inboundRelayDsnRoutingTargetGeneration,
      ) ||
      ![
        "sending",
        "delivery_unverified",
        "sent",
        "delivery_reviewed_sent",
        "replied",
        "bounced",
      ].includes(
        message.status,
      )
    ) {
      return null;
    }
    if (managedSesIdentityPending) {
      return {
        state: "pending" as const,
        siteId: message.siteId,
        inboxId: inbox._id,
        messageId: message._id,
        toEmail: message.toEmail,
        toDomain: message.toDomain,
        sentAt: chronologyAt!,
        outboundRfcMessageIdHash: "",
        dsnRoutingTargetHash: message.inboundRelayDsnRoutingTargetHash!,
        dsnRoutingTargetVersion:
          message.inboundRelayDsnRoutingTargetVersion!,
        dsnRoutingTargetGeneration:
          message.inboundRelayDsnRoutingTargetGeneration!,
        aliasHash,
        aliasDomain: configuredDomain,
        rolloutEpoch: message.inboundRelayRolloutEpoch,
        inboxConfigurationVersion:
          message.inboundRelayInboxConfigurationVersion,
        senderDomain: message.inboundRelaySenderDomain,
        deliveryOwnerAccountKey: settlementAccountKey,
      };
    }
    if (
      message.status === "sending" &&
      (message.deliveryLeaseExpiresAt ?? 0) > Date.now()
    ) {
      return {
        state: "pending" as const,
        siteId: message.siteId,
        inboxId: inbox._id,
        messageId: message._id,
        toEmail: message.toEmail,
        toDomain: message.toDomain,
        sentAt: chronologyAt!,
        outboundRfcMessageIdHash:
          message.inboundRelayOutboundMessageIdHash!,
        dsnRoutingTargetHash:
          message.inboundRelayDsnRoutingTargetHash!,
        dsnRoutingTargetVersion:
          message.inboundRelayDsnRoutingTargetVersion!,
        dsnRoutingTargetGeneration:
          message.inboundRelayDsnRoutingTargetGeneration!,
        aliasHash,
        aliasDomain: configuredDomain,
        rolloutEpoch: message.inboundRelayRolloutEpoch,
        inboxConfigurationVersion:
          message.inboundRelayInboxConfigurationVersion,
        senderDomain: message.inboundRelaySenderDomain,
        deliveryOwnerAccountKey: settlementAccountKey,
      };
    }
    return {
      state:
        ["sending", "delivery_unverified"].includes(message.status)
          ? "ambiguous"
          : "settled",
      siteId: message.siteId,
      inboxId: inbox._id,
      messageId: message._id,
      toEmail: message.toEmail,
      toDomain: message.toDomain,
      sentAt: chronologyAt!,
      outboundRfcMessageIdHash:
        message.inboundRelayOutboundMessageIdHash!,
      dsnRoutingTargetHash: message.inboundRelayDsnRoutingTargetHash!,
      dsnRoutingTargetVersion:
        message.inboundRelayDsnRoutingTargetVersion!,
      dsnRoutingTargetGeneration:
        message.inboundRelayDsnRoutingTargetGeneration!,
      aliasHash,
      aliasDomain: configuredDomain,
      rolloutEpoch: message.inboundRelayRolloutEpoch,
      inboxConfigurationVersion:
        message.inboundRelayInboxConfigurationVersion,
      senderDomain: message.inboundRelaySenderDomain,
      deliveryOwnerAccountKey: settlementAccountKey,
    };
  },
});

/** Atomically deduplicate and settle one signed relay event. The raw subject
 * and body never cross this mutation boundary. */
export const recordInboundRelayReceipt = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    messageId: v.id("outreach_messages"),
    aliasHash: v.string(),
    aliasDomain: v.string(),
    eventKey: v.string(),
    payloadHash: v.string(),
    evidenceHash: v.string(),
    inboundMessageId: v.string(),
    outboundMessageIdHash: v.string(),
    kind: inboundRelayKindValidator,
    reason: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    receivedAt: v.number(),
    rolloutEpoch: v.number(),
    inboxConfigurationVersion: v.number(),
    senderDomain: v.string(),
    dsnRoutingTargetHash: v.string(),
    dsnRoutingTargetVersion: v.number(),
    dsnRoutingTargetGeneration: v.number(),
    deliveryOwnerAccountKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const priorEvent = await ctx.db
      .query("outreach_inbound_relay_receipts")
      .withIndex("by_event_key", (q) => q.eq("eventKey", args.eventKey))
      .unique();
    if (priorEvent) {
      if (priorEvent.payloadHash !== args.payloadHash) {
        throw new Error("Inbound relay event identifier was reused with different evidence");
      }
      return { recorded: false as const, replay: true as const };
    }

    const [site, inbox, message] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db.get(args.messageId),
    ]);
    const configuredDomain = normalizeInboundRelayDomain(
      process.env.OUTREACH_INBOUND_RELAY_DOMAIN,
    );
    const settlementAccountKey = message
      ? immutableDeliveryOwnerAccountKey(message, inbox)
      : undefined;
    const settlementOwnerDeleting = settlementAccountKey
      ? await accountDeletionRequestedForKey(ctx, settlementAccountKey)
      : true;
    if (
      !inboundRelayConfigured(inboundRelayRuntimeConfig()) ||
      !configuredDomain ||
      normalizeInboundRelayDomain(args.aliasDomain) !== configuredDomain ||
      !site ||
      !(await relaySettlementAuthorized(
        ctx,
        site,
        message?.deliveryClaimedAt ?? message?.sentAt,
      )) ||
      !inbox ||
      inbox.siteId !== args.siteId ||
      !message ||
      message.siteId !== args.siteId ||
      message.inboxId !== args.inboxId ||
      !settlementAccountKey ||
      settlementOwnerDeleting ||
      args.deliveryOwnerAccountKey !== settlementAccountKey ||
      !/^[a-f0-9]{64}$/.test(args.deliveryOwnerAccountKey) ||
      ![
        "delivery_unverified",
        "sent",
        "delivery_reviewed_sent",
        "replied",
        "bounced",
      ].includes(
        message.status,
      ) && !(
        message.status === "sending" &&
        (message.deliveryLeaseExpiresAt ?? 0) <= now
      ) ||
      message.inboundRelayAliasHash !== args.aliasHash ||
      message.inboundRelayAliasDomain !== configuredDomain ||
      message.inboundRelayOutboundMessageIdHash !==
        args.outboundMessageIdHash ||
      message.inboundRelayRolloutEpoch !== args.rolloutEpoch ||
      message.inboundRelayInboxConfigurationVersion !==
        args.inboxConfigurationVersion ||
      message.inboundRelaySenderDomain !== normalizeDomain(args.senderDomain) ||
      message.inboundRelayDsnRoutingTargetHash !==
        args.dsnRoutingTargetHash ||
      message.inboundRelayDsnRoutingTargetVersion !==
        args.dsnRoutingTargetVersion ||
      message.inboundRelayDsnRoutingTargetGeneration !==
        args.dsnRoutingTargetGeneration ||
      !/^[a-f0-9]{64}$/.test(args.aliasHash) ||
      !/^[a-f0-9]{64}$/.test(args.eventKey) ||
      !/^[a-f0-9]{64}$/.test(args.payloadHash) ||
      !/^[a-f0-9]{64}$/.test(args.evidenceHash) ||
      !/^[a-f0-9]{64}$/.test(args.outboundMessageIdHash) ||
      !/^[a-f0-9]{64}$/.test(args.dsnRoutingTargetHash) ||
      args.dsnRoutingTargetVersion !==
        OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
      !Number.isSafeInteger(args.dsnRoutingTargetGeneration) ||
      !normalizeRfcMessageId(args.inboundMessageId) ||
      !Number.isSafeInteger(args.receivedAt) ||
      args.receivedAt <
        (message.sentAt ?? message.deliveryClaimedAt ?? 0) - 60_000 ||
      args.receivedAt > now + 5 * 60 * 1000 ||
      (args.kind === "ignored" &&
        (!args.reason || !inboundRelayIgnoredReasons.has(args.reason))) ||
      (args.kind !== "ignored" && args.reason !== undefined)
    ) {
      throw new Error("Inbound relay receipt crossed a tenant or delivery boundary");
    }

    const normalizedFrom = args.fromEmail?.trim().toLowerCase();
    if (
      normalizedFrom &&
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,24}$/i.test(normalizedFrom)
    ) {
      throw new Error("Inbound relay sender is invalid");
    }
    if (args.kind !== "ignored" && !normalizedFrom) {
      throw new Error("A classified inbound relay receipt requires a sender");
    }
    if (
      args.kind === "unsubscribe" &&
      normalizedFrom !== message.toEmail.trim().toLowerCase()
    ) {
      throw new Error("Only the exact recipient can issue a permanent opt-out");
    }

    // Ignored/ambiguous mail has no state transition and is intentionally not
    // persisted. A leaked alias therefore cannot create unbounded audit rows.
    // The five-minute signed-envelope window remains the retry bound.
    if (args.kind === "ignored") {
      return { recorded: false as const, ignored: true as const };
    }

    const priorMessageReceipt = await ctx.db
      .query("outreach_inbound_relay_receipts")
      .withIndex("by_message_inbound_id", (q) =>
        q.eq("messageId", args.messageId).eq(
          "inboundMessageId",
          normalizeRfcMessageId(args.inboundMessageId),
        )
      )
      .unique();
    if (priorMessageReceipt) {
      if (priorMessageReceipt.payloadHash !== args.payloadHash) {
        throw new Error("Inbound message identifier was reused with different evidence");
      }
      return { recorded: false as const, replay: true as const };
    }

    const priorKinds = await ctx.db
      .query("outreach_inbound_relay_receipts")
      .withIndex("by_site_message", (q) =>
        q.eq("siteId", args.siteId).eq("messageId", args.messageId)
      )
      .take(4);
    if (priorKinds.some((receipt) => receipt.kind === args.kind)) {
      return { recorded: false as const, duplicateKind: true as const };
    }

    const inboundProvesAmbiguousDelivery = [
      "sending",
      "delivery_unverified",
    ].includes(message.status);
    const settlementOwnsCurrentSite = Boolean(
      site.userId &&
        settlementAccountKey === accountDeletionKey(site.userId) &&
        inbox.credentialOwnerAccountKey === settlementAccountKey,
    );
    if (inboundProvesAmbiguousDelivery && !message.sentAt) {
      const deliveredAt = message.deliveryClaimedAt ?? args.receivedAt;
      const settlement = await settleAcceptedDeliveryCounter(
        ctx,
        message,
        args.siteId,
        deliveredAt,
      );
      const opportunity = await ctx.db.get(message.opportunityId);
      const settlementLifecycle = outreachDeliverySettlementDecision({
        sequenceStep: message.sequenceStep,
        messageSiteId: String(message.siteId),
        opportunitySiteId: opportunity
          ? String(opportunity.siteId)
          : undefined,
        messageEvidenceHash: message.opportunityEvidenceHash,
        opportunityEvidenceHash: opportunity?.evidenceHash,
        messageSourceUrl: message.opportunitySourceUrl,
        opportunitySourceUrl: opportunity?.sourceUrl,
        messageTargetUrl: message.opportunityTargetUrl,
        opportunityTargetUrl: opportunity?.targetUrl,
        opportunityStatus:
          opportunity?.siteId === args.siteId
            ? opportunity.status
            : undefined,
      });
      if (
        settlement.ownsCurrentSite &&
        opportunity &&
        opportunity.siteId === args.siteId &&
        settlementLifecycle.shouldMarkContacted
      ) {
        await ctx.db.patch(opportunity._id, {
          status: "contacted",
          contactedAt: deliveredAt,
          updatedAt: now,
        });
      }
      if (settlement.ownsCurrentSite) {
        const contact = await ctx.db
          .query("outreach_contacts")
          .withIndex("by_site_email", (q) =>
            q.eq("siteId", args.siteId).eq("email", message.toEmail)
          )
          .unique();
        if (contact) {
          await ctx.db.patch(contact._id, {
            lastContactedAt: deliveredAt,
            updatedAt: now,
          });
        }
        await ctx.db.patch(message._id, {
          status: "delivery_reviewed_sent",
          sentAt: deliveredAt,
          deliveryReviewedAt: now,
          deliveryReviewResolution: "inbound_relay_proof",
          failureReason:
            "An authenticated inbound relay receipt proved delivery after Gmail's direct receipt was ambiguous.",
          updatedAt: now,
        });
      } else {
        // The authenticated receipt proves the original account's send, but
        // the current site owner must not receive provider/message details.
        // sentAt is an idempotency marker for the already-recorded durable
        // pacing/contact settlement; the quarantined status remains visible
        // only to the unsupported transferred site lineage.
        await ctx.db.patch(message._id, {
          sentAt: deliveredAt,
          deliveryReviewedAt: now,
          deliveryReviewResolution: "inbound_relay_proof",
          failureReason:
            "An authenticated inbound relay receipt proved the original account's delivery after the site owner changed.",
          updatedAt: now,
        });
      }
    }

    {
      const shouldPromote = shouldPromoteOutreachInbound({
        existingKind: message.inboundReceiptKind as
          | "reply"
          | "unsubscribe"
          | "bounce"
          | undefined,
        existingAt: message.inboundReceiptAt,
        nextKind: args.kind,
        nextAt: args.receivedAt,
      });
      if (args.kind === "unsubscribe") {
        if (settlementOwnsCurrentSite) {
          await addSuppression(ctx, args.siteId, "domain", message.toDomain, "unsubscribe");
          await addSuppression(ctx, args.siteId, "email", message.toEmail, "unsubscribe");
        } else {
          await materializeOutreachSuppressionTombstoneForAccount(
            ctx,
            settlementAccountKey,
            "domain",
            message.toDomain,
            "unsubscribe",
            args.receivedAt,
          );
          await materializeOutreachSuppressionTombstoneForAccount(
            ctx,
            settlementAccountKey,
            "email",
            message.toEmail,
            "unsubscribe",
            args.receivedAt,
          );
        }
      } else if (args.kind === "bounce") {
        if (settlementOwnsCurrentSite) {
          await addSuppression(ctx, args.siteId, "email", message.toEmail, "bounce");
        } else {
          await materializeOutreachSuppressionTombstoneForAccount(
            ctx,
            settlementAccountKey,
            "email",
            message.toEmail,
            "bounce",
            args.receivedAt,
          );
        }
      }
      if (settlementOwnsCurrentSite) {
        await cancelQueuedThread(
          ctx,
          args.siteId,
          message.threadKey,
          message._id,
          args.kind,
        );
        await ctx.db.patch(message._id, {
          inboundCheckedAt: now,
          ...(shouldPromote
            ? {
                status: args.kind === "bounce" ? "bounced" : "replied",
                repliedAt:
                  args.kind === "bounce" ? message.repliedAt : args.receivedAt,
                bouncedAt:
                  args.kind === "bounce" ? args.receivedAt : message.bouncedAt,
                inboundReceiptHash: args.evidenceHash,
                inboundReceiptKind: args.kind,
                inboundReceiptAt: args.receivedAt,
                inboundReceiptFrom: normalizedFrom,
              }
            : {}),
          updatedAt: now,
        });
      }
    }

    await ctx.db.insert("outreach_inbound_relay_receipts", {
      siteId: args.siteId,
      inboxId: args.inboxId,
      messageId: args.messageId,
      eventKey: args.eventKey,
      payloadHash: args.payloadHash,
      evidenceHash: args.evidenceHash,
      aliasHash: args.aliasHash,
      inboundMessageId: normalizeRfcMessageId(args.inboundMessageId),
      outboundMessageIdHash: args.outboundMessageIdHash,
      kind: args.kind,
      reason: undefined,
      fromEmail: normalizedFrom,
      receivedAt: args.receivedAt,
      rolloutEpoch: args.rolloutEpoch,
      inboxConfigurationVersion: args.inboxConfigurationVersion,
      senderDomain: normalizeDomain(args.senderDomain),
      dsnRoutingTargetHash: args.dsnRoutingTargetHash,
      dsnRoutingTargetVersion: args.dsnRoutingTargetVersion,
      dsnRoutingTargetGeneration: args.dsnRoutingTargetGeneration,
      processedAt: now,
    });
    await ctx.db.patch(inbox._id, {
      inboundLastCompletedAt: now,
      inboundLastError: undefined,
      updatedAt: now,
    });
    return { recorded: true as const, kind: args.kind };
  },
});

// ── Legacy Gmail readonly inbound receipts ──

const inboundKindValidator = v.union(
  v.literal("reply"),
  v.literal("unsubscribe"),
  v.literal("bounce"),
);

function validProviderReceiptId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,200}$/.test(value);
}

/**
 * Atomically lease a bounded Gmail inbox scan. This is the sole boundary that
 * releases a tenant credential to the Node action, and it re-reads canonical
 * account/site authorization before doing so.
 */
export const claimInboundSync = internalMutation({
  args: {
    siteId: v.id("sites"),
    attemptId: v.string(),
  },
  handler: async (ctx, { siteId, attemptId }) => {
    const now = Date.now();
    if (!/^[a-z0-9-]{20,100}$/i.test(attemptId)) {
      throw new Error("Inbound sync attempt identifier is invalid");
    }
    const site = await ctx.db.get(siteId);
    if (!(await outreachSettlementLifecycleActive(ctx, site))) {
      return { claimed: false as const, reason: "Tenant is unavailable." };
    }
    const inboxes = await ctx.db
      .query("outreach_inboxes")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2);
    if (inboxes.length !== 1) {
      return { claimed: false as const, reason: "Exactly one outreach inbox is required." };
    }
    const inbox = inboxes[0];
    if (!site?.userId || !inbox.credentialOwnerAccountKey) {
      // Additive rollout rows are unproven, not foreign. Never destroy the
      // only legacy readonly credential from a scheduled pre-rollout job; a
      // fresh exact-mailbox OAuth callback owns the safe adoption protocol.
      return {
        claimed: false as const,
        reason:
          "The legacy Gmail credential requires exact-mailbox ownership adoption before monitoring can resume.",
      };
    }
    if (
      inbox.credentialOwnerAccountKey !== accountDeletionKey(site.userId)
    ) {
      // A legacy read grant belongs to the account that connected it. Clear
      // stale credentials before returning so a new site owner can never read
      // the prior owner's mailbox through this settlement-only path.
      await ctx.db.patch(inbox._id, {
        status: "disconnected",
        mode: "approval",
        oauthAccessToken: undefined,
        oauthRefreshToken: undefined,
        oauthExpiresAt: undefined,
        oauthScopes: undefined,
        verifiedAt: undefined,
        inboundSyncLeaseId: undefined,
        inboundSyncOwnerAccountKey: undefined,
        inboundSyncLeaseExpiresAt: undefined,
        configurationVersion: (inbox.configurationVersion ?? 0) + 1,
        lastError:
          "The site owner changed; reconnect Gmail before any mailbox access.",
        updatedAt: now,
      });
      await scheduleAutonomousSequenceCancellation(
        ctx,
        inbox,
        "The site owner or mailbox ownership binding changed before this message became due.",
      );
      return {
        claimed: false as const,
        reason: "The Gmail credential does not belong to the current tenant owner.",
      };
    }
    if (
      inbox.provider !== "gmail" ||
      !inbox.oauthScopes?.split(/\s+/).includes(
        "https://www.googleapis.com/auth/gmail.readonly",
      ) ||
      !(inbox.oauthRefreshToken || inbox.oauthAccessToken) ||
      ["disconnected", "suspended"].includes(inbox.status)
    ) {
      return {
        claimed: false as const,
        reason: "Reconnect Gmail with reply monitoring before syncing inbound mail.",
      };
    }
    if (
      inbox.inboundSyncLeaseId &&
      (inbox.inboundSyncLeaseExpiresAt ?? 0) > now
    ) {
      return { claimed: false as const, reason: "An inbound Gmail sync is already running." };
    }

    const policy = await outreachSettlementPolicy(ctx, site);
    if (policy.maximumDeliveryBoundaryAt === 0) {
      return { claimed: false as const, reason: "Tenant is unavailable." };
    }
    const [settleableRows, missingThreadRows] = await Promise.all([
      legacyUnboundMessages(ctx, inbox._id, {
        limit: 1,
        maximumDeliveryBoundaryAt: policy.maximumDeliveryBoundaryAt,
      }),
      legacyUnboundMessagesMissingThread(
        ctx,
        inbox._id,
        policy.maximumDeliveryBoundaryAt,
      ),
    ]);
    if (
      !settleableRows[0] ||
      !policy.allows(
        settleableRows[0].deliveryClaimedAt ?? settleableRows[0].sentAt,
      )
    ) {
      return { claimed: false as const, reason: "No delivered outreach needs monitoring." };
    }
    const candidates = missingThreadRows
      .filter((message) => policy.allows(
        message.deliveryClaimedAt ?? message.sentAt,
      ))
      .map((message) => ({
        messageId: message._id,
        providerMessageId: message.providerMessageId,
        providerThreadId: message.providerThreadId,
        toEmail: message.toEmail,
        toDomain: message.toDomain,
        sentAt: message.sentAt!,
      }));
    for (const message of missingThreadRows) {
      if (!message.deliveryOwnerAccountKey) {
        await ctx.db.patch(message._id, {
          deliveryOwnerAccountKey: inbox.credentialOwnerAccountKey,
          updatedAt: Math.max(message.updatedAt, now),
        });
      }
    }
    const syncWindowStartedAt = inbox.inboundSyncWindowStartedAt ?? now;
    const searchAfter = Math.max(
      now - OUTREACH_INBOUND_LOOKBACK_MS,
      (inbox.inboundLastScannedAt ?? now - OUTREACH_INBOUND_LOOKBACK_MS) -
        OUTREACH_INBOUND_OVERLAP_MS,
    );
    await ctx.db.patch(inbox._id, {
      inboundSyncLeaseId: attemptId,
      inboundSyncOwnerAccountKey: inbox.credentialOwnerAccountKey,
      inboundSyncLeaseExpiresAt: now + OUTREACH_INBOUND_LEASE_MS,
      inboundSyncWindowStartedAt: syncWindowStartedAt,
      inboundLastError: undefined,
      updatedAt: now,
    });
    return {
      claimed: true as const,
      attemptId,
      inbox,
      inboxConfigurationVersion: inbox.configurationVersion ?? 0,
      pageToken: inbox.inboundSyncPageToken,
      syncWindowStartedAt,
      searchAfter,
      candidates,
    };
  },
});

export const bindInboundProviderThread = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    providerMessageId: v.string(),
    providerThreadId: v.string(),
  },
  handler: async (ctx, args) => {
    const [site, inbox, message] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db.get(args.messageId),
    ]);
    if (!(await relaySettlementAuthorized(
      ctx,
      site,
      message?.deliveryClaimedAt ?? message?.sentAt,
    ))) {
      throw new Error("Site not found");
    }
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      !inbox.inboundSyncOwnerAccountKey ||
      (inbox.inboundSyncLeaseExpiresAt ?? 0) <= Date.now() ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion
    ) {
      return { recorded: false };
    }
    if (
      !message ||
      message.siteId !== args.siteId ||
      message.inboxId !== args.inboxId ||
      message.deliveryOwnerAccountKey !== inbox.inboundSyncOwnerAccountKey ||
      !site?.userId ||
      accountDeletionKey(site.userId) !== inbox.inboundSyncOwnerAccountKey ||
      message.inboundRelayAliasHash !== undefined ||
      message.providerMessageId !== args.providerMessageId ||
      !validProviderReceiptId(args.providerThreadId)
    ) {
      throw new Error("Inbound thread binding crossed a tenant or delivery boundary");
    }
    if (message.providerThreadId && message.providerThreadId !== args.providerThreadId) {
      throw new Error("Gmail thread identity changed for a sealed delivery receipt");
    }
    await ctx.db.patch(message._id, {
      providerThreadId: args.providerThreadId,
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});

export const getInboundCandidatesForEvidence = internalQuery({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    providerThreadId: v.string(),
    failedRecipients: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const inbox = await ctx.db.get(args.inboxId);
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      !inbox.inboundSyncOwnerAccountKey ||
      (inbox.inboundSyncLeaseExpiresAt ?? 0) <= Date.now() ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion
    ) {
      return [];
    }
    const byId = new Map<string, Doc<"outreach_messages">>();
    if (validProviderReceiptId(args.providerThreadId)) {
      const threaded = await ctx.db
        .query("outreach_messages")
        .withIndex("by_site_provider_thread", (q) =>
          q.eq("siteId", args.siteId).eq("providerThreadId", args.providerThreadId)
        )
        .take(10);
      for (const message of threaded) byId.set(message._id, message);
    }
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    return [...byId.values()]
      .filter(
        (message) =>
          Boolean(
            message.siteId === args.siteId &&
            message.inboxId === args.inboxId &&
            (message.deliveryOwnerAccountKey ===
                inbox.inboundSyncOwnerAccountKey ||
              // Additive rollout rows predate immutable delivery ownership.
              // The exact current-owner inbound lease may inspect them, but
              // recordInboundReceipt must bind them atomically before any
              // state transition.
              message.deliveryOwnerAccountKey === undefined) &&
            !message.inboundRelayAliasHash &&
            ["sent", "delivery_reviewed_sent", "replied", "bounced"].includes(
              message.status,
            ) &&
            (message.sentAt ?? 0) >= cutoff,
          ),
      )
      .sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0))
      .slice(0, 20)
      .map((message) => ({
        messageId: message._id,
        providerMessageId: message.providerMessageId,
        providerThreadId: message.providerThreadId,
        toEmail: message.toEmail,
        toDomain: message.toDomain,
        sentAt: message.sentAt!,
      }));
  },
});

export const recordInboundReceipt = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    messageId: v.id("outreach_messages"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    providerMessageId: v.string(),
    providerThreadId: v.string(),
    kind: inboundKindValidator,
    fromEmail: v.string(),
    receivedAt: v.number(),
    evidenceHash: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [site, inbox, message] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db.get(args.messageId),
    ]);
    if (!(await relaySettlementAuthorized(
      ctx,
      site,
      message?.deliveryClaimedAt ?? message?.sentAt,
    ))) {
      throw new Error("Site not found");
    }
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      !inbox.inboundSyncOwnerAccountKey ||
      (inbox.inboundSyncLeaseExpiresAt ?? 0) <= now ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion
    ) {
      return { recorded: false as const, reason: "inbound_lease_lost" as const };
    }
    if (
      !message ||
      message.siteId !== args.siteId ||
      message.inboxId !== args.inboxId ||
      (message.deliveryOwnerAccountKey !== undefined &&
        message.deliveryOwnerAccountKey !== inbox.inboundSyncOwnerAccountKey) ||
      message.inboundRelayAliasHash !== undefined ||
      !["sent", "delivery_reviewed_sent", "replied", "bounced"].includes(message.status)
    ) {
      throw new Error("Inbound receipt crossed a tenant or delivery boundary");
    }
    const fromEmail = args.fromEmail.trim().toLowerCase();
    if (
      !validProviderReceiptId(args.providerMessageId) ||
      !validProviderReceiptId(args.providerThreadId) ||
      !/^[a-f0-9]{64}$/.test(args.evidenceHash) ||
      !/^[^@\s<>\r\n]+@[^@\s<>\r\n]+\.[a-z]{2,24}$/i.test(fromEmail) ||
      !Number.isFinite(args.receivedAt) ||
      args.receivedAt < (message.sentAt ?? 0) - 60_000 ||
      args.receivedAt > now + 5 * 60 * 1000
    ) {
      throw new Error("Inbound Gmail receipt is invalid");
    }
    if (args.kind === "unsubscribe" && fromEmail !== message.toEmail) {
      throw new Error("Only the exact recipient can issue a permanent opt-out");
    }
    if (
      message.providerThreadId &&
      args.kind !== "bounce" &&
      message.providerThreadId !== args.providerThreadId
    ) {
      throw new Error("Inbound reply does not belong to the sealed Gmail thread");
    }
    if (message.inboundReceiptProviderMessageId === args.providerMessageId) {
      return { recorded: false as const, reason: "already_recorded" as const };
    }

    if (!message.deliveryOwnerAccountKey) {
      if (
        !site?.userId ||
        accountDeletionKey(site.userId) !== inbox.inboundSyncOwnerAccountKey ||
        inbox.credentialOwnerAccountKey !== inbox.inboundSyncOwnerAccountKey
      ) {
        throw new Error(
          "A legacy inbound receipt could not establish immutable delivery ownership",
        );
      }
      await ctx.db.patch(message._id, {
        deliveryOwnerAccountKey: inbox.inboundSyncOwnerAccountKey,
        updatedAt: Math.max(message.updatedAt, now),
      });
    }

    const shouldPromote = shouldPromoteOutreachInbound({
      existingKind: message.inboundReceiptKind as
        | "reply"
        | "unsubscribe"
        | "bounce"
        | undefined,
      existingAt: message.inboundReceiptAt,
      nextKind: args.kind,
      nextAt: args.receivedAt,
    });
    const settlementOwnsCurrentSite = Boolean(
      site?.userId &&
        accountDeletionKey(site.userId) === inbox.inboundSyncOwnerAccountKey &&
        inbox.credentialOwnerAccountKey === inbox.inboundSyncOwnerAccountKey,
    );
    if (args.kind === "unsubscribe") {
      if (settlementOwnsCurrentSite) {
        await addSuppression(ctx, args.siteId, "domain", message.toDomain, "unsubscribe");
        await addSuppression(ctx, args.siteId, "email", message.toEmail, "unsubscribe");
      } else {
        await materializeOutreachSuppressionTombstoneForAccount(
          ctx,
          inbox.inboundSyncOwnerAccountKey,
          "domain",
          message.toDomain,
          "unsubscribe",
          args.receivedAt,
        );
        await materializeOutreachSuppressionTombstoneForAccount(
          ctx,
          inbox.inboundSyncOwnerAccountKey,
          "email",
          message.toEmail,
          "unsubscribe",
          args.receivedAt,
        );
      }
    } else if (args.kind === "bounce") {
      if (settlementOwnsCurrentSite) {
        await addSuppression(ctx, args.siteId, "email", message.toEmail, "bounce");
      } else {
        await materializeOutreachSuppressionTombstoneForAccount(
          ctx,
          inbox.inboundSyncOwnerAccountKey,
          "email",
          message.toEmail,
          "bounce",
          args.receivedAt,
        );
      }
    }
    if (settlementOwnsCurrentSite) {
      await cancelQueuedThread(
        ctx,
        args.siteId,
        message.threadKey,
        message._id,
        args.kind,
      );

      await ctx.db.patch(message._id, {
        ...(message.providerThreadId || args.kind === "bounce"
          ? {}
          : { providerThreadId: args.providerThreadId }),
        inboundCheckedAt: now,
        ...(shouldPromote
          ? {
              status: args.kind === "bounce" ? "bounced" : "replied",
              repliedAt: args.kind === "bounce" ? message.repliedAt : args.receivedAt,
              bouncedAt: args.kind === "bounce" ? args.receivedAt : message.bouncedAt,
              inboundReceiptProviderMessageId: args.providerMessageId,
              inboundReceiptHash: args.evidenceHash,
              inboundReceiptKind: args.kind,
              inboundReceiptAt: args.receivedAt,
              inboundReceiptFrom: fromEmail,
            }
          : {}),
        updatedAt: now,
      });
    }
    return { recorded: true as const, kind: args.kind };
  },
});

const smartleadCanaryKindValidator = v.union(
  v.literal("delivery"),
  v.literal("reply"),
  v.literal("bounce"),
  v.literal("unsubscribe"),
);
const SMARTLEAD_CANARY_LEASE_MS = 10 * 60 * 1000;
const SMARTLEAD_CANARY_EVENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

async function promoteSmartleadResourceAfterCanaries(
  ctx: MutationCtx,
  resource: Doc<"managed_outreach_mailbox_resources">,
  patch: Partial<Pick<Doc<"managed_outreach_mailbox_resources">,
    "deliveryCanaryReceipt" | "replyCanaryReceipt" | "bounceCanaryReceipt" |
    "unsubscribeCanaryReceipt" | "cancellationCanaryReceipt">>,
  timestamp: number,
) {
  const projected = { ...resource, ...patch };
  if (
    !projected.deliveryCanaryReceipt || !projected.replyCanaryReceipt ||
    !projected.bounceCanaryReceipt || !projected.unsubscribeCanaryReceipt ||
    !projected.cancellationCanaryReceipt || !projected.canonicalInboxId
  ) return false;
  const inbox = await ctx.db.get(projected.canonicalInboxId);
  if (
    !inbox || inbox.siteId !== projected.siteId ||
    inbox.managedTransportOperationKey !== projected.operationKey ||
    inbox.managedTransportGeneration !== projected.generation
  ) return false;
  await Promise.all([
    ctx.db.patch(inbox._id, {
      status: "active",
      lastError: undefined,
      updatedAt: timestamp,
    }),
    ctx.db.patch(projected._id, {
      nextAttemptAt: undefined,
      lastReasonCode: undefined,
      updatedAt: timestamp,
    }),
  ]);
  const request = await ctx.db.get(projected.requestId);
  if (request) {
    await ctx.scheduler.runAfter(
      0,
      internal.managedProvisioning.dispatchRequest,
      { requestId: request._id, expectedRevision: request.revision },
    );
  }
  return true;
}

/** Create one deterministic controlled operation per safety event. Targets
 * are one-way hashes supplied by the Node action from production secrets. */
export const ensureSmartleadControlledCanariesInternal = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    targets: v.array(v.object({
      kind: smartleadCanaryKindValidator,
      targetHash: v.string(),
    })),
  },
  handler: async (ctx, { resourceId, targets }) => {
    const resource = await ctx.db.get(resourceId);
    const timestamp = Date.now();
    if (
      !resource || resource.transportKind !== SMARTLEAD_MANAGED_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" || resource.releaseState !== "active" ||
      !resource.canonicalInboxId || !resource.encryptedProviderBinding ||
      !resource.domainAuthenticationReceipt || resource.warmupState !== "verified" ||
      !resource.warmupEligibleAt || resource.warmupEligibleAt > timestamp
    ) throw new Error("Smartlead resource is not ready for controlled canaries");
    const kinds = new Set(targets.map((target) => target.kind));
    if (
      targets.length !== 4 || kinds.size !== 4 ||
      targets.some((target) => !/^[a-f0-9]{64}$/.test(target.targetHash))
    ) throw new Error("All four isolated Smartlead canary targets are required");
    const operationIds = [];
    let allPassed = true;
    for (const target of targets) {
      const operationKey = smartleadCanaryOperationKey({
        siteId: String(resource.siteId),
        resourceOperationKey: resource.operationKey,
        generation: resource.generation,
        kind: target.kind,
        targetHash: target.targetHash,
      });
      const rows = await ctx.db.query("smartlead_canary_operations")
        .withIndex("by_resource_kind", (q) =>
          q.eq("resourceId", resource._id).eq("kind", target.kind))
        .take(2);
      if (rows.length > 1) throw new Error("Smartlead canary identity is ambiguous");
      const existing = rows[0];
      if (existing) {
        if (
          existing.siteId !== resource.siteId || existing.operationKey !== operationKey ||
          existing.targetHash !== target.targetHash
        ) throw new Error("Smartlead canary target changed inside a resource generation");
        operationIds.push(existing._id);
        if (existing.state !== "passed") allPassed = false;
        if (["queued", "leased"].includes(existing.state)) continue;
        if (["provider_queued", "event_verified", "pause_required", "passed"].includes(existing.state)) continue;
        continue;
      }
      const operationId = await ctx.db.insert("smartlead_canary_operations", {
        siteId: resource.siteId,
        resourceId: resource._id,
        kind: target.kind,
        operationKey,
        targetHash: target.targetHash,
        state: "queued",
        attempt: 0,
        nextAttemptAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      operationIds.push(operationId);
      allPassed = false;
      await ctx.scheduler.runAfter(0, internal.actions.smartlead.runControlledCanary, {
        operationId,
      });
    }
    if (allPassed) {
      await promoteSmartleadResourceAfterCanaries(ctx, resource, {}, timestamp);
    } else {
      await ctx.db.patch(resource._id, {
        lastReasonCode: "smartlead_canaries_pending",
        nextAttemptAt: timestamp + 15 * 60 * 1000,
        updatedAt: timestamp,
      });
    }
    return { ensured: true as const, operationIds };
  },
});

export const recordSmartleadCanaryCoordinatorBlockerInternal = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    reason: v.union(
      v.literal("runtime_unavailable"),
      v.literal("canary_targets_unavailable"),
      v.literal("resource_not_ready"),
    ),
  },
  handler: async (ctx, { resourceId, reason }) => {
    const resource = await ctx.db.get(resourceId);
    if (
      !resource || resource.transportKind !== SMARTLEAD_MANAGED_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" ||
      resource.releaseState !== "active"
    ) {
      return { recorded: false as const };
    }
    const nextAttemptAt = Date.now() + 60 * 60 * 1000;
    await ctx.db.patch(resource._id, {
      lastReasonCode: reason,
      nextAttemptAt,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.actions.smartlead.runControlledCanaries,
      { resourceId },
    );
    return { recorded: true as const, nextAttemptAt };
  },
});

export const claimSmartleadControlledCanaryInternal = internalMutation({
  args: { operationId: v.id("smartlead_canary_operations") },
  handler: async (ctx, { operationId }) => {
    const operation = await ctx.db.get(operationId);
    const timestamp = Date.now();
    if (
      !operation || operation.state !== "queued" ||
      (operation.nextAttemptAt ?? 0) > timestamp || operation.attempt >= 10
    ) return null;
    const resource = await ctx.db.get(operation.resourceId);
    if (
      !resource || resource.siteId !== operation.siteId ||
      resource.transportKind !== SMARTLEAD_MANAGED_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" || resource.releaseState !== "active" ||
      !resource.encryptedProviderBinding || !resource.canonicalInboxId ||
      !resource.domainAuthenticationReceipt || resource.warmupState !== "verified" ||
      !resource.warmupEligibleAt || resource.warmupEligibleAt > timestamp
    ) return null;
    const attempt = operation.attempt + 1;
    const leaseToken = sha256Hex(JSON.stringify({
      operationKey: operation.operationKey,
      attempt,
      timestamp,
    }));
    const leaseExpiresAt = timestamp + SMARTLEAD_CANARY_LEASE_MS;
    await ctx.db.patch(operation._id, {
      state: "leased",
      attempt,
      leaseToken,
      leaseExpiresAt,
      nextAttemptAt: undefined,
      lastReasonCode: undefined,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      leaseExpiresAt + 1_000,
      internal.outreach.recoverSmartleadControlledCanaryLeaseInternal,
      { operationId: operation._id, leaseToken },
    );
    return {
      operation: { ...operation, attempt, leaseToken, leaseExpiresAt },
      resource: {
        operationKey: resource.operationKey,
        generation: resource.generation,
        encryptedProviderBinding: resource.encryptedProviderBinding,
        canonicalInboxId: resource.canonicalInboxId,
      },
    };
  },
});

export const recordSmartleadControlledCanaryProgressInternal = internalMutation({
  args: {
    operationId: v.id("smartlead_canary_operations"),
    leaseToken: v.string(),
    phase: v.union(
      v.literal("campaign"), v.literal("webhook"),
      v.literal("configuration"), v.literal("lead"),
    ),
    encryptedProviderBinding: v.optional(v.string()),
    completed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    const timestamp = Date.now();
    if (
      !operation || operation.state !== "leased" ||
      operation.leaseToken !== args.leaseToken ||
      (operation.leaseExpiresAt ?? 0) <= timestamp ||
      (args.encryptedProviderBinding !== undefined &&
        !/^v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(
          args.encryptedProviderBinding))
    ) return { recorded: false as const };
    await ctx.db.patch(operation._id, {
      externalAttemptedAt: operation.externalAttemptedAt ?? timestamp,
      campaignRequestedAt: args.phase === "campaign"
        ? operation.campaignRequestedAt ?? timestamp : operation.campaignRequestedAt,
      webhookRequestedAt: args.phase === "webhook"
        ? operation.webhookRequestedAt ?? timestamp : operation.webhookRequestedAt,
      configurationRequestedAt: args.phase === "configuration"
        ? operation.configurationRequestedAt ?? timestamp : operation.configurationRequestedAt,
      configurationCompletedAt: args.phase === "configuration" && args.completed
        ? timestamp : operation.configurationCompletedAt,
      leadRequestedAt: args.phase === "lead"
        ? operation.leadRequestedAt ?? timestamp : operation.leadRequestedAt,
      encryptedProviderBinding:
        args.encryptedProviderBinding ?? operation.encryptedProviderBinding,
      updatedAt: timestamp,
    });
    return { recorded: true as const };
  },
});

export const recordSmartleadControlledCanaryQueuedInternal = internalMutation({
  args: {
    operationId: v.id("smartlead_canary_operations"),
    leaseToken: v.string(),
    encryptedProviderBinding: v.string(),
    campaignBindingHash: v.string(),
    recipientHash: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    const timestamp = Date.now();
    if (
      !operation || operation.state !== "leased" ||
      operation.leaseToken !== args.leaseToken ||
      (operation.leaseExpiresAt ?? 0) <= timestamp ||
      !/^v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(
        args.encryptedProviderBinding) ||
      ![args.campaignBindingHash, args.recipientHash].every((value) =>
        /^[a-f0-9]{64}$/.test(value)) ||
      args.recipientHash !== operation.targetHash
    ) return { recorded: false as const };
    const nextAttemptAt = timestamp + SMARTLEAD_CANARY_EVENT_TIMEOUT_MS;
    await ctx.db.patch(operation._id, {
      state: "provider_queued",
      encryptedProviderBinding: args.encryptedProviderBinding,
      campaignBindingHash: args.campaignBindingHash,
      recipientHash: args.recipientHash,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt,
      lastReasonCode: "smartlead_canary_event_pending",
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.outreach.expireSmartleadControlledCanaryInternal,
      { operationId: operation._id },
    );
    return { recorded: true as const, nextAttemptAt };
  },
});

export const failSmartleadControlledCanaryInternal = internalMutation({
  args: {
    operationId: v.id("smartlead_canary_operations"),
    leaseToken: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation || operation.state !== "leased" || operation.leaseToken !== args.leaseToken) {
      return { recorded: false as const };
    }
    const timestamp = Date.now();
    const terminal = operation.attempt >= 10;
    const nextAttemptAt = timestamp + Math.min(
      6 * 60 * 60 * 1000,
      5 * 60 * 1000 * 2 ** Math.max(0, operation.attempt - 1),
    );
    await ctx.db.patch(operation._id, {
      state: terminal ? "failed" : "queued",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: terminal ? undefined : nextAttemptAt,
      lastReasonCode: args.reason.replace(/[^a-z0-9_]/g, "_").slice(0, 120),
      completedAt: terminal ? timestamp : undefined,
      updatedAt: timestamp,
    });
    if (!terminal) {
      await ctx.scheduler.runAt(
        nextAttemptAt,
        internal.actions.smartlead.runControlledCanary,
        { operationId: operation._id },
      );
    }
    return { recorded: true as const, terminal, nextAttemptAt };
  },
});

export const recoverSmartleadControlledCanaryLeaseInternal = internalMutation({
  args: {
    operationId: v.id("smartlead_canary_operations"),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (
      !operation || operation.state !== "leased" ||
      operation.leaseToken !== args.leaseToken ||
      (operation.leaseExpiresAt ?? 0) > Date.now()
    ) return { recovered: false as const };
    const nextAttemptAt = Date.now() + 60_000;
    await ctx.db.patch(operation._id, {
      state: operation.attempt >= 10 ? "failed" : "queued",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: operation.attempt >= 10 ? undefined : nextAttemptAt,
      lastReasonCode: operation.externalAttemptedAt
        ? "smartlead_canary_external_ack_ambiguous"
        : "smartlead_canary_preboundary_action_lost",
      completedAt: operation.attempt >= 10 ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    if (operation.attempt < 10) {
      await ctx.scheduler.runAt(
        nextAttemptAt,
        internal.actions.smartlead.runControlledCanary,
        { operationId: operation._id },
      );
    }
    return { recovered: true as const };
  },
});

export const expireSmartleadControlledCanaryInternal = internalMutation({
  args: { operationId: v.id("smartlead_canary_operations") },
  handler: async (ctx, { operationId }) => {
    const operation = await ctx.db.get(operationId);
    if (
      !operation || operation.state !== "provider_queued" ||
      (operation.nextAttemptAt ?? 0) > Date.now()
    ) return { expired: false as const };
    await ctx.db.patch(operation._id, {
      state: "failed",
      nextAttemptAt: undefined,
      lastReasonCode: "smartlead_canary_signed_event_timeout",
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { expired: true as const };
  },
});

export const getSmartleadControlledCanaryWebhookCandidate = internalQuery({
  args: { campaignBindingHash: v.string(), recipientHash: v.string() },
  handler: async (ctx, args) => {
    if (![args.campaignBindingHash, args.recipientHash].every((value) =>
      /^[a-f0-9]{64}$/.test(value))) return null;
    const operation = await ctx.db.query("smartlead_canary_operations")
      .withIndex("by_campaign_recipient", (q) =>
        q.eq("campaignBindingHash", args.campaignBindingHash)
          .eq("recipientHash", args.recipientHash))
      .unique();
    if (!operation || !["provider_queued", "event_verified", "pause_required"].includes(operation.state)) {
      return null;
    }
    const resource = await ctx.db.get(operation.resourceId);
    if (!resource?.canonicalInboxId || resource.siteId !== operation.siteId) return null;
    return {
      siteId: operation.siteId,
      inboxId: resource.canonicalInboxId,
      operationId: operation._id,
      operationKey: operation.operationKey,
    };
  },
});

export const recordSmartleadControlledCanaryWebhookReceipt = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    operationId: v.id("smartlead_canary_operations"),
    operationKey: v.string(),
    requestId: v.string(),
    campaignBindingHash: v.string(),
    recipientHash: v.string(),
    kind: v.union(
      v.literal("sent"), v.literal("reply"),
      v.literal("bounce"), v.literal("unsubscribe"),
    ),
    observedAt: v.number(),
    payloadHash: v.string(),
    evidenceHash: v.string(),
    sequenceStep: v.optional(v.number()),
    stopRequest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const prior = await ctx.db.query("smartlead_webhook_events")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (prior) {
      if (prior.payloadHash !== args.payloadHash) {
        throw new Error("Smartlead request id was reused with different evidence");
      }
      return { recorded: false as const, replay: true as const };
    }
    const [operation, resource] = await Promise.all([
      ctx.db.get(args.operationId),
      ctx.db.query("managed_outreach_mailbox_resources")
        .withIndex("by_canonical_inbox", (q) => q.eq("canonicalInboxId", args.inboxId))
        .unique(),
    ]);
    const timestamp = Date.now();
    const expectedKind = operation?.kind === "delivery" ? "sent" : operation?.kind;
    if (
      !operation || operation.siteId !== args.siteId ||
      operation.operationKey !== args.operationKey ||
      !["provider_queued", "event_verified", "pause_required"].includes(operation.state) ||
      operation.campaignBindingHash !== args.campaignBindingHash ||
      operation.recipientHash !== args.recipientHash || expectedKind !== args.kind ||
      !resource || resource._id !== operation.resourceId ||
      resource.siteId !== args.siteId || resource.transportKind !== SMARTLEAD_MANAGED_TRANSPORT ||
      ![args.payloadHash, args.evidenceHash].every((value) => /^[a-f0-9]{64}$/.test(value)) ||
      !Number.isFinite(args.observedAt) || args.observedAt > timestamp + 5 * 60 * 1000
    ) throw new Error("Smartlead canary receipt crossed its isolated boundary");
    const requiresPause = args.kind !== "sent";
    const resourcePatch = args.kind === "sent"
      ? { deliveryCanaryReceipt: args.evidenceHash }
      : args.kind === "reply"
        ? { replyCanaryReceipt: args.evidenceHash }
        : args.kind === "bounce"
          ? { bounceCanaryReceipt: args.evidenceHash }
          : { unsubscribeCanaryReceipt: args.evidenceHash };
    await Promise.all([
      ctx.db.patch(resource._id, { ...resourcePatch, updatedAt: timestamp }),
      ctx.db.patch(operation._id, {
        state: requiresPause ? "pause_required" : "passed",
        eventEvidenceHash: args.evidenceHash,
        observedAt: args.observedAt,
        nextAttemptAt: requiresPause ? timestamp : undefined,
        lastReasonCode: requiresPause ? "smartlead_canary_pause_pending" : undefined,
        completedAt: requiresPause ? undefined : timestamp,
        updatedAt: timestamp,
      }),
    ]);
    await promoteSmartleadResourceAfterCanaries(
      ctx,
      resource,
      resourcePatch,
      timestamp,
    );
    await ctx.db.insert("smartlead_webhook_events", {
      requestId: args.requestId,
      siteId: args.siteId,
      inboxId: args.inboxId,
      canaryOperationId: operation._id,
      operationKey: operation.operationKey,
      campaignBindingHash: args.campaignBindingHash,
      recipientHash: args.recipientHash,
      kind: args.kind,
      payloadHash: args.payloadHash,
      evidenceHash: args.evidenceHash,
      sequenceStep: args.sequenceStep,
      stopRequest: args.stopRequest,
      providerPauseState: requiresPause ? "requested" : undefined,
      observedAt: args.observedAt,
      settledAt: timestamp,
      createdAt: timestamp,
    });
    if (requiresPause) {
      await ctx.scheduler.runAfter(0, internal.actions.smartlead.pauseControlledCanary, {
        operationId: operation._id,
      });
    }
    return { recorded: true as const, replay: false as const };
  },
});

export const getSmartleadControlledCanaryPauseOperationInternal = internalQuery({
  args: { operationId: v.id("smartlead_canary_operations") },
  handler: async (ctx, { operationId }) => {
    const operation = await ctx.db.get(operationId);
    if (operation?.state !== "pause_required" || !operation.encryptedProviderBinding) return null;
    return { encryptedProviderBinding: operation.encryptedProviderBinding };
  },
});

export const recordSmartleadControlledCanaryPauseReceiptInternal = internalMutation({
  args: {
    operationId: v.id("smartlead_canary_operations"),
    providerResponseHash: v.string(),
  },
  handler: async (ctx, { operationId, providerResponseHash }) => {
    const operation = await ctx.db.get(operationId);
    if (
      operation?.state !== "pause_required" || !operation.eventEvidenceHash ||
      !/^[a-f0-9]{64}$/.test(providerResponseHash)
    ) return { recorded: false as const };
    const resource = await ctx.db.get(operation.resourceId);
    if (!resource || resource.siteId !== operation.siteId) return { recorded: false as const };
    const timestamp = Date.now();
    const cancellationReceiptHash = sha256Hex(JSON.stringify({
      operationKey: operation.operationKey,
      eventEvidenceHash: operation.eventEvidenceHash,
      providerResponseHash,
    }));
    await Promise.all([
      ctx.db.patch(operation._id, {
        state: "passed",
        cancellationReceiptHash,
        nextAttemptAt: undefined,
        lastReasonCode: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
      }),
      ctx.db.patch(resource._id, {
        cancellationCanaryReceipt: cancellationReceiptHash,
        updatedAt: timestamp,
      }),
    ]);
    await promoteSmartleadResourceAfterCanaries(
      ctx,
      resource,
      { cancellationCanaryReceipt: cancellationReceiptHash },
      timestamp,
    );
    const events = await ctx.db.query("smartlead_webhook_events")
      .withIndex("by_canary_operation", (q) => q.eq("canaryOperationId", operation._id))
      .take(10);
    await Promise.all(events.map((event) => ctx.db.patch(event._id, {
      providerPauseState: "confirmed",
      settledAt: timestamp,
    })));
    return { recorded: true as const, cancellationReceiptHash };
  },
});

export const recordSmartleadControlledCanaryPauseFailureInternal = internalMutation({
  args: {
    operationId: v.id("smartlead_canary_operations"),
    reason: v.string(),
  },
  handler: async (ctx, { operationId, reason }) => {
    const operation = await ctx.db.get(operationId);
    if (operation?.state !== "pause_required") return { recorded: false as const };
    const attempt = (operation.pauseAttempt ?? 0) + 1;
    const terminal = attempt >= 10;
    const nextAttemptAt = Date.now() + Math.min(
      15 * 60 * 1000,
      60 * 1000 * 2 ** Math.max(0, attempt - 1),
    );
    await ctx.db.patch(operation._id, {
      pauseAttempt: attempt,
      state: terminal ? "failed" : "pause_required",
      nextAttemptAt: terminal ? undefined : nextAttemptAt,
      lastReasonCode: reason.replace(/[^a-z0-9_]/g, "_").slice(0, 120),
      completedAt: terminal ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    if (!terminal) {
      await ctx.scheduler.runAt(
        nextAttemptAt,
        internal.actions.smartlead.pauseControlledCanary,
        { operationId: operation._id },
      );
    }
    return { recorded: true as const, terminal, nextAttemptAt };
  },
});

export const getSmartleadWebhookCandidate = internalQuery({
  args: {
    campaignBindingHash: v.string(),
    recipientHash: v.string(),
  },
  handler: async (ctx, { campaignBindingHash, recipientHash }) => {
    if (
      !/^[a-f0-9]{64}$/.test(campaignBindingHash) ||
      !/^[a-f0-9]{64}$/.test(recipientHash)
    ) return null;
    const message = await ctx.db.query("outreach_messages")
      .withIndex("by_provider_campaign_recipient", (q) =>
        q.eq("providerCampaignBindingHash", campaignBindingHash)
          .eq("providerRecipientHash", recipientHash))
      .unique();
    if (
      !message || message.deliveryTransport !== "smartlead_managed" ||
      !message.inboxId || !message.deliveryOwnerAccountKey
    ) return null;
    const inbox = await ctx.db.get(message.inboxId);
    if (
      !inbox || inbox.siteId !== message.siteId ||
      inbox.managedTransportKind !== "smartlead_managed" ||
      inbox.credentialOwnerAccountKey !== message.deliveryOwnerAccountKey
    ) return null;
    return {
      siteId: message.siteId,
      inboxId: inbox._id,
      messageId: message._id,
      operationKey: message.providerOperationKey!,
      expectedOwnerAccountKey: message.deliveryOwnerAccountKey,
      expectedCampaignGeneration: message.providerCampaignGeneration ?? 0,
    };
  },
});

export const getSmartleadPauseOperationInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    operationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      !message || message.siteId !== args.siteId ||
      message.deliveryTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      message.providerOperationKey !== args.operationKey ||
      message.providerAcknowledgementState !== "pause_required" ||
      message.providerPauseState === "confirmed" ||
      !message.encryptedProviderLeadBinding
    ) return null;
    return {
      encryptedProviderLeadBinding: message.encryptedProviderLeadBinding,
      requiresGlobalUnsubscribe:
        message.providerGlobalUnsubscribeState !== undefined &&
        message.providerGlobalUnsubscribeState !== "confirmed",
      globalUnsubscribeAttemptedAt:
        message.providerGlobalUnsubscribeAttemptedAt,
    };
  },
});

export const recordSmartleadGlobalUnsubscribeBoundaryInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    operationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      !message || message.siteId !== args.siteId ||
      message.deliveryTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      message.providerOperationKey !== args.operationKey ||
      message.providerAcknowledgementState !== "pause_required" ||
      message.providerGlobalUnsubscribeState !== "required" ||
      message.providerGlobalUnsubscribeAttemptedAt ||
      !message.encryptedProviderLeadBinding
    ) return { recorded: false as const };
    await ctx.db.patch(message._id, {
      providerGlobalUnsubscribeState: "external_attempted",
      providerGlobalUnsubscribeAttemptedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { recorded: true as const };
  },
});

export const recordSmartleadGlobalUnsubscribeReceiptInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    operationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      !message || message.siteId !== args.siteId ||
      message.deliveryTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      message.providerOperationKey !== args.operationKey ||
      message.providerAcknowledgementState !== "pause_required" ||
      !["required", "external_attempted", "confirmed"].includes(
        message.providerGlobalUnsubscribeState ?? "",
      ) || !message.encryptedProviderLeadBinding
    ) return { recorded: false as const };
    await ctx.db.patch(message._id, {
      providerGlobalUnsubscribeState: "confirmed",
      providerReconciledAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { recorded: true as const };
  },
});

export const recordSmartleadPauseReceiptInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    operationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      !message || message.siteId !== args.siteId ||
      message.deliveryTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      message.providerOperationKey !== args.operationKey ||
      message.providerAcknowledgementState !== "pause_required" ||
      (message.providerGlobalUnsubscribeState !== undefined &&
        message.providerGlobalUnsubscribeState !== "confirmed") ||
      !message.encryptedProviderLeadBinding
    ) return { recorded: false as const };
    const timestamp = Date.now();
    await ctx.db.patch(message._id, {
      providerPauseState: "confirmed",
      providerPauseNextEligibleAt: undefined,
      providerReconciledAt: timestamp,
      updatedAt: timestamp,
    });
    const events = await ctx.db.query("smartlead_webhook_events")
      .withIndex("by_message", (q) => q.eq("messageId", message._id))
      .take(100);
    await Promise.all(events
      .filter((event) =>
        event.operationKey === args.operationKey &&
        event.kind !== "sent" &&
        event.providerPauseState !== "confirmed")
      .map((event) => ctx.db.patch(event._id, {
        providerPauseState: "confirmed",
        settledAt: timestamp,
      })));
    return { recorded: true as const };
  },
});

export const recordSmartleadPauseFailureInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    messageId: v.id("outreach_messages"),
    operationKey: v.string(),
    reason: v.union(
      v.literal("runtime_unavailable"),
      v.literal("binding_invalid"),
      v.literal("pause_unverified"),
      v.literal("global_unsubscribe_unverified"),
    ),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (
      !message || message.siteId !== args.siteId ||
      message.deliveryTransport !== SMARTLEAD_MANAGED_TRANSPORT ||
      message.providerOperationKey !== args.operationKey ||
      message.providerAcknowledgementState !== "pause_required" ||
      message.providerPauseState === "confirmed"
    ) return { recorded: false as const };
    const timestamp = Date.now();
    const attempt = Math.min(10, (message.providerPauseAttempt ?? 0) + 1);
    const nextEligibleAt = timestamp + Math.min(
      15 * 60 * 1000,
      60 * 1000 * 2 ** Math.max(0, attempt - 1),
    );
    await ctx.db.patch(message._id, {
      providerPauseState: attempt >= 10 ? "terminal_alert" : "retry_wait",
      providerPauseAttempt: attempt,
      providerPauseNextEligibleAt: attempt >= 10 ? undefined : nextEligibleAt,
      failureReason: attempt >= 10
        ? "Smartlead did not confirm lead cancellation after ten bounded attempts. The sequence remains locally suppressed and requires provider incident response."
        : "Smartlead lead cancellation is awaiting a bounded provider retry; local suppression is already active.",
      updatedAt: timestamp,
    });
    if (attempt < 10) {
      await ctx.scheduler.runAt(
        nextEligibleAt,
        internal.actions.smartlead.pauseLead,
        {
          siteId: args.siteId,
          messageId: args.messageId,
          operationKey: args.operationKey,
        },
      );
    }
    return { recorded: true as const, nextEligibleAt, terminal: attempt >= 10 };
  },
});

/** Atomically dedupe and settle a signed Smartlead event without raw content. */
export const recordSmartleadWebhookReceipt = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    messageId: v.id("outreach_messages"),
    expectedOwnerAccountKey: v.string(),
    expectedCampaignGeneration: v.number(),
    requestId: v.string(),
    operationKey: v.string(),
    campaignBindingHash: v.string(),
    recipientHash: v.string(),
    kind: v.union(
      v.literal("sent"),
      v.literal("reply"),
      v.literal("bounce"),
      v.literal("unsubscribe"),
    ),
    observedAt: v.number(),
    payloadHash: v.string(),
    evidenceHash: v.string(),
    sequenceStep: v.optional(v.number()),
    stopRequest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const prior = await ctx.db.query("smartlead_webhook_events")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .unique();
    if (prior) {
      if (prior.payloadHash !== args.payloadHash) {
        throw new Error("Smartlead request id was reused with different evidence");
      }
      return { recorded: false as const, replay: true as const };
    }
    const [site, inbox, message] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
      ctx.db.get(args.messageId),
    ]);
    const timestamp = Date.now();
    if (
      !site || !(await relaySettlementAuthorized(ctx, site, message?.deliveryClaimedAt ?? message?.sentAt)) ||
      !inbox || inbox.siteId !== args.siteId ||
      inbox.managedTransportKind !== "smartlead_managed" ||
      inbox.credentialOwnerAccountKey !== args.expectedOwnerAccountKey ||
      !message || message.siteId !== args.siteId || message.inboxId !== args.inboxId ||
      message.deliveryTransport !== "smartlead_managed" ||
      message.deliveryOwnerAccountKey !== args.expectedOwnerAccountKey ||
      message.providerOperationKey !== args.operationKey ||
      !/^[a-f0-9]{64}$/.test(args.campaignBindingHash) ||
      !/^[a-f0-9]{64}$/.test(args.recipientHash) ||
      message.providerCampaignBindingHash !== args.campaignBindingHash ||
      message.providerRecipientHash !== args.recipientHash ||
      (message.providerCampaignGeneration ?? 0) !== args.expectedCampaignGeneration ||
      !/^[a-f0-9]{64}$/.test(args.payloadHash) ||
      !/^[a-f0-9]{64}$/.test(args.evidenceHash) ||
      !Number.isFinite(args.observedAt) || args.observedAt > timestamp + 5 * 60 * 1000
    ) throw new Error("Smartlead receipt crossed a tenant or delivery boundary");

    const ownsCurrentSite = Boolean(
      site.userId && accountDeletionKey(site.userId) === args.expectedOwnerAccountKey,
    );
    if (!ownsCurrentSite) throw new Error("Smartlead settlement owner changed");

    if (
      args.kind === "sent" &&
      (args.sequenceStep ?? 0) === 0 &&
      ["sending", "provider_queued", "delivery_unverified"].includes(message.status)
    ) {
      const deliveredAt = args.observedAt;
      await settleAcceptedDeliveryCounter(ctx, message, args.siteId, deliveredAt);
      const opportunity = await ctx.db.get(message.opportunityId);
      const lifecycle = outreachDeliverySettlementDecision({
        sequenceStep: message.sequenceStep,
        messageSiteId: String(message.siteId),
        opportunitySiteId: opportunity ? String(opportunity.siteId) : undefined,
        messageEvidenceHash: message.opportunityEvidenceHash,
        opportunityEvidenceHash: opportunity?.evidenceHash,
        messageSourceUrl: message.opportunitySourceUrl,
        opportunitySourceUrl: opportunity?.sourceUrl,
        messageTargetUrl: message.opportunityTargetUrl,
        opportunityTargetUrl: opportunity?.targetUrl,
        opportunityStatus: opportunity?.status,
      });
      if (opportunity && lifecycle.shouldMarkContacted) {
        await ctx.db.patch(opportunity._id, {
          status: "contacted",
          contactedAt: deliveredAt,
          updatedAt: timestamp,
        });
      }
      await ctx.db.patch(message._id, {
        status: "sent",
        sentAt: deliveredAt,
        providerAcknowledgementState: "webhook_confirmed",
        providerReconciledAt: timestamp,
        updatedAt: timestamp,
      });
    } else if (args.kind !== "sent") {
      if (args.kind === "unsubscribe") {
        await addSuppression(ctx, args.siteId, "domain", message.toDomain, "unsubscribe");
        await addSuppression(ctx, args.siteId, "email", message.toEmail, "unsubscribe");
      } else if (args.kind === "bounce") {
        await addSuppression(ctx, args.siteId, "email", message.toEmail, "bounce");
      }
      await cancelQueuedThread(ctx, args.siteId, message.threadKey, message._id, args.kind);
      const promote = shouldPromoteOutreachInbound({
        existingKind: message.inboundReceiptKind as "reply" | "unsubscribe" | "bounce" | undefined,
        existingAt: message.inboundReceiptAt,
        nextKind: args.kind,
        nextAt: args.observedAt,
      });
      await ctx.db.patch(message._id, {
        providerAcknowledgementState: "pause_required",
        providerPauseState: "requested",
        ...(args.kind === "unsubscribe" ? {
          providerGlobalUnsubscribeState: args.stopRequest
            ? "required"
            : "confirmed",
        } : {}),
        ...(promote ? {
          status: args.kind === "bounce" ? "bounced" : "replied",
          repliedAt: args.kind === "bounce" ? message.repliedAt : args.observedAt,
          bouncedAt: args.kind === "bounce" ? args.observedAt : message.bouncedAt,
          inboundReceiptHash: args.evidenceHash,
          inboundReceiptKind: args.kind,
          inboundReceiptAt: args.observedAt,
        } : {}),
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.actions.smartlead.pauseLead,
        {
          siteId: args.siteId,
          messageId: message._id,
          operationKey: args.operationKey,
        },
      );
    }
    await ctx.db.insert("smartlead_webhook_events", {
      requestId: args.requestId,
      siteId: args.siteId,
      inboxId: args.inboxId,
      messageId: args.messageId,
      operationKey: args.operationKey,
      campaignBindingHash: args.campaignBindingHash,
      recipientHash: args.recipientHash,
      kind: args.kind,
      payloadHash: args.payloadHash,
      evidenceHash: args.evidenceHash,
      sequenceStep: args.sequenceStep,
      stopRequest: args.stopRequest,
      providerPauseState: args.kind === "sent" ? undefined : "requested",
      observedAt: args.observedAt,
      settledAt: timestamp,
      createdAt: timestamp,
    });
    return { recorded: true as const, replay: false as const };
  },
});

export const completeInboundSync = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    syncWindowStartedAt: v.number(),
    nextPageToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [site, inbox] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
    ]);
    if (!(await outreachSettlementLifecycleActive(ctx, site))) {
      return { recorded: false };
    }
    const now = Date.now();
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      (inbox.inboundSyncLeaseExpiresAt ?? 0) <= now ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion ||
      inbox.inboundSyncWindowStartedAt !== args.syncWindowStartedAt
    ) {
      return { recorded: false };
    }
    const safePageToken = args.nextPageToken
      ?.replace(/[^a-zA-Z0-9_\-=]/g, "")
      .slice(0, 500);
    await ctx.db.patch(inbox._id, {
      inboundSyncPageToken: safePageToken,
      inboundSyncWindowStartedAt: safePageToken
        ? args.syncWindowStartedAt
        : undefined,
      inboundLastScannedAt: safePageToken
        ? inbox.inboundLastScannedAt
        : args.syncWindowStartedAt,
      inboundLastCompletedAt: now,
      inboundSyncLeaseId: undefined,
      inboundSyncOwnerAccountKey: undefined,
      inboundSyncLeaseExpiresAt: undefined,
      inboundLastError: undefined,
      updatedAt: now,
    });
    return { recorded: true, complete: !safePageToken };
  },
});

export const failInboundSync = internalMutation({
  args: {
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    attemptId: v.string(),
    expectedConfigurationVersion: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const [site, inbox] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.inboxId),
    ]);
    if (!(await outreachSettlementLifecycleActive(ctx, site))) {
      return { recorded: false };
    }
    if (
      !inbox ||
      inbox.siteId !== args.siteId ||
      inbox.inboundSyncLeaseId !== args.attemptId ||
      (inbox.configurationVersion ?? 0) !== args.expectedConfigurationVersion
    ) {
      return { recorded: false };
    }
    const allowed = new Set([
      "gmail_authorization_unavailable",
      "gmail_read_failed",
      "gmail_response_invalid",
      "inbound_sync_deadline",
      "inbound_receipt_failed",
    ]);
    await ctx.db.patch(inbox._id, {
      inboundSyncLeaseId: undefined,
      inboundSyncOwnerAccountKey: undefined,
      inboundSyncLeaseExpiresAt: undefined,
      inboundLastError: allowed.has(args.reason)
        ? args.reason
        : "gmail_read_failed",
      updatedAt: Date.now(),
    });
    return { recorded: true };
  },
});

// ── Suppression ──

async function persistentSuppressionExists(
  ctx: QueryCtx,
  site: Doc<"sites"> | null,
  kind: OutreachSuppressionKind,
  value: string,
): Promise<boolean> {
  if (!site?.userId || !site.domain) return true;
  const identity = outreachSuppressionTombstoneIdentity({
    userId: site.userId,
    tenantDomain: site.domain,
    kind,
    value,
  });
  if (!identity) return true;
  return Boolean(await ctx.db
    .query("outreach_sender_suppression_tombstones")
    .withIndex("by_account_tenant_value", (q) =>
      q
        .eq("accountKey", identity.accountKey)
        .eq("tenantDomainKey", identity.tenantDomainKey)
        .eq("kind", kind)
        .eq("valueKey", identity.valueKey)
    )
    .unique());
}

async function siteSuppressionExists(
  ctx: QueryCtx,
  siteId: Id<"sites">,
  kind: OutreachSuppressionKind,
  rawValue: string,
): Promise<boolean> {
  const value = kind === "domain"
    ? outreachOrganisationDomain(rawValue)
    : String(rawValue || "").trim().toLowerCase();
  if (!value) return true;
  const row = await ctx.db
    .query("outreach_suppressions")
    .withIndex("by_site_value", (q) =>
      q.eq("siteId", siteId).eq("value", value)
    )
    .unique();
  return Boolean(row && row.kind === kind);
}

const acceptedContactStatuses = [
  "sent",
  "delivery_reviewed_sent",
  "replied",
  "bounced",
  "delivery_unverified",
] as const;

async function latestLocalContactAt(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  rawDomain: string,
  cutoff: number,
): Promise<number | undefined> {
  const domain = outreachOrganisationDomain(rawDomain);
  if (!domain) return undefined;
  const rows = await Promise.all(
    acceptedContactStatuses.map((status) =>
      ctx.db
        .query("outreach_messages")
        .withIndex("by_site_domain_status_sent", (q) =>
          q
            .eq("siteId", siteId)
            .eq("toDomain", domain)
            .eq("status", status)
            .gte("sentAt", cutoff)
        )
        .order("desc")
        .first()
    ),
  );
  const latest = Math.max(0, ...rows.map((row) => row?.sentAt ?? 0));
  return latest > 0 ? latest : undefined;
}

async function latestTenantContactAt(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
  rawDomain: string,
  now: number,
): Promise<number | undefined> {
  const cutoff = now - DOMAIN_CONTACT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const [local, durable] = await Promise.all([
    latestLocalContactAt(ctx, site._id, rawDomain, cutoff),
    readDurableContactReceipt(ctx, site, rawDomain),
  ]);
  const latest = Math.max(
    local ?? 0,
    durable?.lastContactedAt ?? 0,
    (durable?.reservationExpiresAt ?? 0) > now ? now : 0,
  );
  return latest >= cutoff ? latest : undefined;
}

async function cancelQueuedThread(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  threadKey: string,
  receiptMessageId: Id<"outreach_messages">,
  kind: "reply" | "unsubscribe" | "bounce",
) {
  const [receiptMessage, queued] = await Promise.all([
    ctx.db.get(receiptMessageId),
    ctx.db
      .query("outreach_messages")
      .withIndex("by_thread", (q) => q.eq("threadKey", threadKey))
      .take(50),
  ]);
  const receiptOwnerAccountKey = receiptMessage?.ownerAccountKey ??
    receiptMessage?.deliveryOwnerAccountKey;
  if (
    !receiptMessage ||
    receiptMessage.siteId !== siteId ||
    !receiptOwnerAccountKey
  ) return;
  const timestamp = Date.now();
  for (const message of queued) {
    if (
      message.siteId !== siteId ||
      message._id === receiptMessageId ||
      !outreachMessageOwnerMatches(message, receiptOwnerAccountKey) ||
      !["draft", "blocked", "approved"].includes(message.status)
    ) continue;
    await ctx.db.patch(message._id, {
      status: "skipped",
      blockedReason:
        kind === "reply"
          ? "The recipient replied before this message became due."
          : kind === "unsubscribe"
            ? "The recipient opted out before this message became due."
            : "The recipient address bounced before this message became due.",
      updatedAt: timestamp,
    });
  }
}

async function writableOutreachOwnerAccountKey(
  ctx: MutationCtx,
  site: Doc<"sites">,
): Promise<{
  ownerAccountKey: string;
  hasExactOwnerInbox: boolean;
}> {
  if (!site.userId) throw new Error("Outreach tenant owner is unavailable");
  const ownerAccountKey = accountDeletionKey(site.userId);
  const inboxes = await ctx.db
    .query("outreach_inboxes")
    .withIndex("by_site", (q) => q.eq("siteId", site._id))
    .take(2);
  if (inboxes.length > 1) {
    throw new Error("Exactly one outreach inbox is required");
  }
  if (
    inboxes.length === 1 &&
    inboxes[0].credentialOwnerAccountKey !== ownerAccountKey
  ) {
    // Never let a new/current owner append recipient PII into a stale Gmail
    // owner's local ledger. Undefined additive-rollout ownership also remains
    // fail-closed until the exact-mailbox adoption protocol proves it.
    throw new Error(
      "Reconnect the current owner's Gmail inbox before writing outreach recipient data",
    );
  }
  return {
    ownerAccountKey,
    hasExactOwnerInbox: inboxes.length === 1,
  };
}

async function addSuppression(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  kind: "domain" | "email",
  rawValue: string,
  reason: string,
) {
  const value =
    kind === "domain"
      ? outreachOrganisationDomain(rawValue)
      : String(rawValue || "").trim().toLowerCase();
  if (!value) return;
  const site = await ctx.db.get(siteId);
  if (!site?.userId) throw new Error("Outreach tenant is unavailable");
  const ownerAccountKey = accountDeletionKey(site.userId);
  const existing = await ctx.db
    .query("outreach_suppressions")
    .withIndex("by_site_value", (q) => q.eq("siteId", siteId).eq("value", value))
    .first();
  if (!existing) {
    await ctx.db.insert("outreach_suppressions", {
      siteId,
      ownerAccountKey,
      kind,
      value,
      reason,
      createdAt: Date.now(),
    });
  }

  // The site-scoped row is useful for the current dashboard, but cannot be
  // the permanent STOP ledger because ordinary site deletion purges it. Keep
  // a PII-minimized account + canonical-tenant tombstone in the same
  // transaction. This intentionally does not query an inbox or try to adopt
  // an unresolved/foreign local row: duplicate/corrupt ownership can never
  // roll back an opt-out or silently move its raw lineage.
  await materializeOutreachSuppressionTombstone(
    ctx,
    site,
    kind,
    value,
    reason,
    Date.now(),
  );

  // Suppression is not merely a claim-time guard. Remove every bounded pre-send
  // row that already targets the opted-out address/domain so the dashboard and
  // approval queue immediately reflect the permanent decision. A message that
  // already owns a sending lease is never mutated here.
  const queued = kind === "domain"
    ? await ctx.db
        .query("outreach_messages")
        .withIndex("by_site_domain", (q) =>
          q.eq("siteId", siteId).eq("toDomain", value)
        )
        .take(200)
    : await ctx.db
        .query("outreach_messages")
        .withIndex("by_site_email", (q) =>
          q.eq("siteId", siteId).eq("toEmail", value)
        )
        .take(200);
  const timestamp = Date.now();
  for (const message of queued) {
    if (
      !outreachMessageOwnerMatches(message, ownerAccountKey) ||
      !["draft", "blocked", "approved"].includes(message.status)
    ) continue;
    await ctx.db.patch(message._id, {
      status: "skipped",
      blockedReason: `${value} is permanently suppressed (${reason}).`,
      updatedAt: timestamp,
    });
  }
}

export const suppress = mutation({
  args: {
    siteId: v.id("sites"),
    kind: v.string(),
    value: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { siteId, kind, value, reason }) => {
    await requireSiteOwner(ctx, siteId);
    if (kind !== "domain" && kind !== "email") {
      throw new Error(`Unsupported suppression kind "${kind}"`);
    }
    await addSuppression(ctx, siteId, kind, value, reason ?? "manual");
    return { suppressed: true };
  },
});

export const suppressInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    kind: v.string(),
    value: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { siteId, kind, value, reason }) => {
    if (kind !== "domain" && kind !== "email") {
      throw new Error(`Unsupported suppression kind "${kind}"`);
    }
    await addSuppression(ctx, siteId, kind, value, reason);
  },
});

export const listSuppressions = query({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const ownerAccountKey = accountDeletionKey(site.userId!);
    return ctx.db
      .query("outreach_suppressions")
      .withIndex("by_site_owner_unresolved", (q) =>
        q
          .eq("siteId", siteId)
          .eq("ownerAccountKey", ownerAccountKey)
          .eq("ownerLineageUnresolvedAt", undefined)
      )
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? 100, 500)));
  },
});

export const isSuppressedInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    kind: v.union(v.literal("domain"), v.literal("email")),
    value: v.string(),
  },
  handler: async (ctx, { siteId, kind, value }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return true;
    const [local, durable] = await Promise.all([
      siteSuppressionExists(ctx, siteId, kind, value),
      persistentSuppressionExists(ctx, site, kind, value),
    ]);
    return local || durable;
  },
});

/** Bounded cleanup for detached/global sender-reputation hashes. The receipt
 * blocks identity transfer only for its explicit 90-day safety window. */
export const pruneExpiredSenderPacingReceiptsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const timestamp = Date.now();
    const cutoff = timestamp -
      DOMAIN_CONTACT_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
    const [
      pacingRows,
      managedPacingRows,
      managedSendTombstones,
      contactCandidates,
    ] = await Promise.all([
      ctx.db
        .query("managed_ses_pacing_receipts")
        .withIndex("by_retain_until", (q) => q.lt("retainUntil", timestamp))
        .take(100),
      ctx.db
        .query("managed_ses_send_tombstones")
        .withIndex("by_expires", (q) => q.lt("expiresAt", timestamp))
        .take(100),
      ctx.db
        .query("outreach_sender_pacing_receipts")
        .withIndex("by_retain_until", (q) => q.lt("retainUntil", timestamp))
        .take(100),
      ctx.db
        .query("outreach_tenant_contact_receipts")
        .withIndex("by_updated", (q) => q.lt("updatedAt", cutoff))
        .take(100),
    ]);
    for (const row of pacingRows) await ctx.db.delete(row._id);
    for (const row of managedPacingRows) await ctx.db.delete(row._id);
    for (const row of managedSendTombstones) await ctx.db.delete(row._id);
    let contactsDeleted = 0;
    for (const row of contactCandidates) {
      if (
        (row.lastContactedAt ?? 0) < cutoff &&
        (row.reservationExpiresAt ?? 0) <= timestamp
      ) {
        await ctx.db.delete(row._id);
        contactsDeleted++;
      }
    }
    if (
      pacingRows.length === 100 ||
      managedPacingRows.length === 100 ||
      managedSendTombstones.length === 100 ||
      contactCandidates.length === 100
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.outreach.pruneExpiredSenderPacingReceiptsInternal,
        {},
      );
    }
    return {
      pacingDeleted: pacingRows.length,
      managedPacingDeleted: managedPacingRows.length,
      managedSendTombstonesDeleted: managedSendTombstones.length,
      contactsDeleted,
      scheduledNext:
        pacingRows.length === 100 ||
        managedPacingRows.length === 100 ||
        managedSendTombstones.length === 100 ||
        contactCandidates.length === 100,
    };
  },
});

// ── Contacts and prior-contact history ──

export const upsertContact = internalMutation({
  args: {
    siteId: v.id("sites"),
    domain: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    discoveredFromUrl: v.string(),
    discoveryMethod: v.string(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!siteExecutionActive(site)) {
      throw new Error("Site not found");
    }
    const { ownerAccountKey, hasExactOwnerInbox } =
      await writableOutreachOwnerAccountKey(ctx, site);
    const email = args.email.trim().toLowerCase();
    const domain = outreachOrganisationDomain(args.domain);
    const now = Date.now();
    const existing = await ctx.db
      .query("outreach_contacts")
      .withIndex("by_site_email", (q) => q.eq("siteId", args.siteId).eq("email", email))
      .unique();
    if (existing) {
      if (legacyUnresolvedContactMayBeReplaced(existing)) {
        if (!hasExactOwnerInbox) {
          throw new Error(
            "Reconnect the current owner's Gmail inbox before replacing unresolved contact evidence",
          );
        }
        // Fresh, tenant-bound public discovery is a new evidence boundary, not
        // permission to adopt the ownerless row's old PII or contact history.
        // Replace every mutable field and clear the unresolved marker/history.
        await ctx.db.patch(existing._id, {
          ownerAccountKey,
          ownerLineageUnresolvedAt: undefined,
          domain,
          email,
          name: args.name,
          role: args.role,
          discoveredFromUrl: args.discoveredFromUrl,
          discoveryMethod: args.discoveryMethod,
          verifiedAt: now,
          lastContactedAt: undefined,
          createdAt: now,
          updatedAt: now,
        });
        return {
          contactId: existing._id,
          created: false,
          replacedLegacyUnresolved: true,
        };
      }
      if (existing.ownerLineageUnresolvedAt) {
        throw new Error(
          "Outreach contact ownership is unresolved; operator review is required",
        );
      }
      if (
        existing.ownerAccountKey &&
        existing.ownerAccountKey !== ownerAccountKey
      ) {
        throw new Error("Outreach contact belongs to another account lineage");
      }
      await ctx.db.patch(existing._id, {
        ownerAccountKey,
        name: args.name ?? existing.name,
        role: args.role ?? existing.role,
        discoveredFromUrl: args.discoveredFromUrl,
        discoveryMethod: args.discoveryMethod,
        verifiedAt: now,
        updatedAt: now,
      });
      return { contactId: existing._id, created: false };
    }
    const contactId = await ctx.db.insert("outreach_contacts", {
      siteId: args.siteId,
      ownerAccountKey,
      domain,
      email,
      name: args.name,
      role: args.role,
      discoveredFromUrl: args.discoveredFromUrl,
      discoveryMethod: args.discoveryMethod,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { contactId, created: true };
  },
});

/** Exact bounded cooldown lookup. Durable state survives site deletion and
 * the indexed legacy fallback preserves safety during additive rollout. */
export const getContactCooldownInternal = internalQuery({
  args: { siteId: v.id("sites"), domain: v.string() },
  handler: async (ctx, { siteId, domain }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return null;
    return (await latestTenantContactAt(ctx, site, domain, Date.now())) ?? null;
  },
});
