import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { accountDeletionKey } from "./lib/accountDeletion.ts";
import {
  aggregateOneSetupRequestState,
  managedProvisioningRetryAt,
  ONE_SETUP_CONTRACT_VERSION,
} from "./lib/oneSetup.ts";
import {
  MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED,
  MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE,
  MANAGED_OUTREACH_MAILBOX_ADAPTER_RETRY,
  MANAGED_OUTREACH_MAILBOX_PROVIDER_BLOCKED,
  MANAGED_OUTREACH_MAILBOX_CONTRACT_VERSION,
  MANAGED_OUTREACH_MAILBOX_LEASE_MS,
  managedOutreachMailboxCanaryReleasePending,
  managedOutreachMailboxLeaseIsCurrent,
  managedOutreachMailboxProfileIssues,
  managedOutreachMailboxReleaseSealed,
  managedOutreachMailboxRequestFenceIssues,
  managedOutreachMailboxVerifiedDeletionSettled,
  managedSesRotationCandidateEligible,
  managedSesSuccessorHandoffDecision,
  type ManagedOutreachMailboxProvisionOperation,
  type ManagedOutreachMailboxReleaseOperation,
} from "./lib/managedOutreachMailbox.ts";
import {
  MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
  MANAGED_SES_EVENT_CANARY_VALID_MS,
  MANAGED_SES_EVENT_CANARY_TTL_MS,
  MANAGED_SES_PLATFORM_RELAY_DOMAIN,
  MANAGED_SES_TRANSPORT,
  managedSesEventCanaryClaimDecision,
  managedSesIdentityTupleMatchesEstablished,
  managedSesPacingBoundaryTransition,
} from "./lib/managedSes.ts";
import { sha256Hex } from "./lib/publicationArtifact.ts";
import { reserveManagedSesPacingAttempt } from
  "./lib/managedSesPacing.ts";
import { releaseDurableContactClaimForAccount } from
  "./lib/outreachDurability.ts";
import {
  quarantineManagedSesMessageIdentityMismatch,
  settleManagedSesAcceptedMessage,
} from "./outreach.ts";
import {
  OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION,
  inboundRelayAliasHash,
  inboundRelayConfigurationHash,
  inboundRelayConfigured,
  inboundRelayDsnRoutingTarget,
  normalizeInboundRelayDomain,
} from "./lib/outreachInboundRelay.ts";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance.ts";
import {
  SMARTLEAD_ADAPTER_VERSION,
  SMARTLEAD_MANAGED_TRANSPORT,
} from "./lib/smartlead.ts";
import {
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
} from "./lib/siteDomainBinding.ts";

type ManagedRequest = Doc<"managed_provisioning_requests">;
type ManagedResource = Doc<"managed_outreach_mailbox_resources">;
type ManagedReleaseTombstone =
  Doc<"managed_outreach_mailbox_release_tombstones">;

const RESOURCE_SCAN_LIMIT = 20;
const RESOURCE_RELEASE_BATCH = 100;
const RELEASE_RETRY_MS = 15 * 60 * 1000;
const EXTERNAL_PROVISIONING_LATE_RESULT_GRACE_MS = 20 * 60 * 1000;
const MANAGED_SES_DISPOSITION_LEASE_MS = 2 * 60 * 1000;
const MANAGED_SES_CANARY_SEND_LEASE_MS = 2 * 60 * 1000;
const MANAGED_SES_INBOUND_ACTIVATION_LEASE_MS = 2 * 60 * 1000;
const MANAGED_SES_EVENT_CANARY_REFRESH_LEAD_MS = 3 * 24 * 60 * 60 * 1000;
const RELEASE_SETTLEMENT_PENDING =
  "managed_mailbox_delivery_or_canary_settlement_pending";
const RELEASE_PROVISIONING_PENDING =
  "managed_mailbox_provisioning_settlement_pending";
const RELEASE_QUARANTINE_PENDING =
  "managed_mailbox_canonical_inbox_quarantine_required";

export function managedOutreachMailboxOperationKey(args: {
  requestId: string;
  ownerAccountKey: string;
  domainSnapshot: string;
  domainRevisionSnapshot: number;
  generation: number;
}): string {
  return sha256Hex(JSON.stringify({
    contractVersion: MANAGED_OUTREACH_MAILBOX_CONTRACT_VERSION,
    requestId: args.requestId,
    ownerAccountKey: args.ownerAccountKey,
    domainSnapshot: args.domainSnapshot,
    domainRevisionSnapshot: args.domainRevisionSnapshot,
    generation: args.generation,
  }));
}

function currentOwnerAccountKey(site: Doc<"sites"> | null): string | undefined {
  return site?.userId ? accountDeletionKey(site.userId) : undefined;
}

function requestFenceIssues(args: {
  request: ManagedRequest;
  site: Doc<"sites"> | null;
  expectedConfigurationRevision: number;
  expectedGeneration: number;
}): string[] {
  return managedOutreachMailboxRequestFenceIssues({
    siteActive: Boolean(
      args.site?.userId &&
        !args.site.deletionStatus &&
        !args.site.accountDeletionRequestedAt,
    ),
    requestMode: args.request.outreachMailbox.mode,
    requestOwnerAccountKey: args.request.ownerAccountKey,
    currentOwnerAccountKey: currentOwnerAccountKey(args.site),
    requestDomainSnapshot: args.request.domainSnapshot,
    currentDomainSnapshot: args.site ? siteCanonicalDomain(args.site) : null,
    requestDomainRevisionSnapshot: args.request.domainRevisionSnapshot,
    currentDomainRevision: args.site
      ? siteCanonicalDomainRevision(args.site)
      : -1,
    expectedConfigurationRevision: args.expectedConfigurationRevision,
    actualConfigurationRevision: args.request.configurationRevision,
    expectedGeneration: args.expectedGeneration,
    actualGeneration: args.request.outreachMailboxGeneration,
    expectedContractVersion: ONE_SETUP_CONTRACT_VERSION,
    actualContractVersion: args.request.contractVersion,
  });
}

async function releaseFenceAllows(ctx: QueryCtx, args: {
  resource: ManagedResource;
  request: ManagedRequest | null;
  site: Doc<"sites"> | null;
}): Promise<boolean> {
  if (!args.site || args.site.deletionStatus || args.site.accountDeletionRequestedAt) {
    return true;
  }
  if (
    args.resource.lifecycleState === "cancelled" &&
    args.resource.releaseRequestedAt &&
    ["requested", "leased", "blocked"].includes(args.resource.releaseState)
  ) return true;
  if (
    currentOwnerAccountKey(args.site) !== args.resource.ownerAccountKey ||
    siteCanonicalDomain(args.site) !== args.resource.domainSnapshot ||
    siteCanonicalDomainRevision(args.site) !==
      args.resource.domainRevisionSnapshot ||
    !(await siteExecutionAuthorized(ctx, args.site))
  ) return true;
  if (!args.request || args.request._id !== args.resource.requestId) return true;
  return args.request.outreachMailbox.mode !== "managed" ||
    args.request.ownerAccountKey !== args.resource.ownerAccountKey ||
    args.request.domainSnapshot !== args.resource.domainSnapshot ||
    args.request.domainRevisionSnapshot !==
      args.resource.domainRevisionSnapshot ||
    args.request.outreachMailboxGeneration !== args.resource.generation ||
    args.request.contractVersion !== args.resource.requestContractVersion;
}

function managedInboxMatchesResource(
  inbox: Doc<"outreach_inboxes"> | null,
  resource: ManagedResource,
): inbox is Doc<"outreach_inboxes"> {
  const transportMatches = resource.transportKind === MANAGED_SES_TRANSPORT
    ? Boolean(
        inbox &&
        inbox.provider === MANAGED_SES_TRANSPORT &&
        inbox.managedTransportKind === MANAGED_SES_TRANSPORT &&
        inbox.managedTransportResourceReceipt === resource.resourceReceipt,
      )
    : Boolean(
        inbox &&
        inbox.provider === "smartlead" &&
        inbox.managedTransportKind === SMARTLEAD_MANAGED_TRANSPORT &&
        inbox.managedTransportResourceReceipt === resource.resourceReceipt,
      );
  return Boolean(
    inbox &&
      transportMatches &&
      inbox.siteId === resource.siteId &&
      inbox.credentialOwnerAccountKey === resource.ownerAccountKey &&
      inbox.managedTransportOperationKey === resource.operationKey &&
      inbox.managedTransportGeneration === resource.generation &&
      inbox.managedTransportAdapterVersion === resource.adapterVersion &&
      ["managed_adapter", "managed_adapter_retiring"].includes(
        inbox.credentialSource ?? "",
      ),
  );
}

function managedInboxIsQuarantinedForResource(
  inbox: Doc<"outreach_inboxes"> | null,
  resource: ManagedResource,
): boolean {
  return Boolean(
    managedInboxMatchesResource(inbox, resource) &&
      inbox.credentialSource === "managed_adapter_retiring" &&
      inbox.status === "disconnected" &&
      inbox.mode === "approval" &&
      !inbox.oauthAccessToken &&
      !inbox.oauthRefreshToken &&
      !inbox.smtpPassword &&
      !inbox.apiKey &&
      !inbox.autonomyConsentAcceptedAt &&
      !inbox.inboundRelayDsnRoutingVerifiedAt &&
      (resource.transportKind !== MANAGED_SES_TRANSPORT ||
        (!inbox.managedTransportResourceVerifiedAt &&
          !inbox.managedTransportEventCanaryVerifiedAt &&
          !inbox.managedTransportEventCanaryReceipt &&
          !inbox.managedTransportInboundCanaryVerifiedAt &&
          !inbox.managedTransportInboundCanaryReceipt)),
  );
}

async function quarantineManagedCanonicalInbox(
  ctx: MutationCtx,
  resource: ManagedResource,
  timestamp: number,
  releaseReason: string,
): Promise<boolean> {
  if (!resource.canonicalInboxId) return false;
  const inbox = await ctx.db.get(resource.canonicalInboxId);
  const exactResourceProvenance = Boolean(
    inbox &&
      inbox.siteId === resource.siteId &&
      inbox.credentialOwnerAccountKey === resource.ownerAccountKey &&
      inbox.managedTransportOperationKey === resource.operationKey &&
      inbox.managedTransportGeneration === resource.generation &&
      inbox.managedTransportAdapterVersion === resource.adapterVersion &&
      (resource.transportKind === MANAGED_SES_TRANSPORT
        ? inbox.provider === MANAGED_SES_TRANSPORT &&
          inbox.managedTransportKind === MANAGED_SES_TRANSPORT &&
          inbox.managedTransportResourceReceipt === resource.resourceReceipt
        : inbox.provider === "smartlead" &&
          inbox.managedTransportKind === SMARTLEAD_MANAGED_TRANSPORT &&
          inbox.managedTransportResourceReceipt === resource.resourceReceipt),
  );
  const legacyResourceBoundInbox = Boolean(
    inbox &&
      inbox.siteId === resource.siteId &&
      inbox.credentialOwnerAccountKey === resource.ownerAccountKey &&
      inbox.credentialSource === undefined &&
      inbox.managedTransportOperationKey === undefined &&
      inbox.managedTransportGeneration === undefined &&
      inbox.managedTransportAdapterVersion === undefined,
  );
  if (!exactResourceProvenance && !legacyResourceBoundInbox) {
    return false;
  }
  if (!inbox) return false;
  if (managedInboxIsQuarantinedForResource(inbox, resource)) return true;
  const cancellationReceipt =
    inbox.autonomyConsentVersion &&
      inbox.autonomyConsentPolicyHash &&
      inbox.autonomyConsentAcceptedAt &&
      inbox.credentialOwnerAccountKey
      ? {
          siteId: inbox.siteId,
          ownerAccountKey: inbox.credentialOwnerAccountKey,
          consentVersion: inbox.autonomyConsentVersion,
          consentPolicyHash: inbox.autonomyConsentPolicyHash,
          consentAcceptedAt: inbox.autonomyConsentAcceptedAt,
        }
      : null;
  await ctx.db.patch(inbox._id, {
    credentialSource: "managed_adapter_retiring",
    managedTransportKind: resource.transportKind === SMARTLEAD_MANAGED_TRANSPORT
      ? SMARTLEAD_MANAGED_TRANSPORT
      : MANAGED_SES_TRANSPORT,
    managedTransportOperationKey: resource.operationKey,
    managedTransportGeneration: resource.generation,
    managedTransportAdapterVersion: resource.adapterVersion,
    status: "disconnected",
    mode: "approval",
    oauthAccessToken: undefined,
    oauthRefreshToken: undefined,
    oauthExpiresAt: undefined,
    oauthScopes: undefined,
    smtpPassword: undefined,
    apiKey: undefined,
    verifiedAt: undefined,
    dnsCheckedAt: undefined,
    spfVerifiedAt: undefined,
    dkimVerifiedAt: undefined,
    dmarcVerifiedAt: undefined,
    managedTransportResourceVerifiedAt: undefined,
    managedTransportEventCanaryVerifiedAt: undefined,
    managedTransportEventCanaryReceipt: undefined,
    managedTransportEventCanaryOperationKey: undefined,
    managedTransportEventProviderMessageIdDigest: undefined,
    managedTransportInboundCanaryVerifiedAt: undefined,
    managedTransportInboundCanaryReceipt: undefined,
    managedTransportInboundCanaryOperationKey: undefined,
    managedTransportInboundCanaryInboxBinding: undefined,
    managedTransportInboundCanaryRelayConfigurationHash: undefined,
    managedTransportInboundCanaryAdapterVersion: undefined,
    managedTransportInboundCanaryRetentionPolicyHash: undefined,
    autonomyConsentVersion: undefined,
    autonomyConsentPolicyHash: undefined,
    autonomyConsentAcceptedAt: undefined,
    autonomyConsentAcceptedBy: undefined,
    autonomyConsentInboxConfigurationVersion: undefined,
    autonomyLastEnabledAt: undefined,
    autonomyDisabledAt: timestamp,
    autonomyReconciliationStatus: "paused",
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
    configurationVersion: (inbox.configurationVersion ?? 0) + 1,
    lastError:
      `Managed mailbox retired (${releaseReason}); connect a fresh owner mailbox after release completes.`
        .slice(0, 500),
    updatedAt: timestamp,
  });
  if (cancellationReceipt) {
    await ctx.scheduler.runAfter(
      0,
      internal.outreach.cancelAutonomousSequenceInternal,
      {
        ...cancellationReceipt,
        sequenceStep: 0,
        reason:
          "The managed outreach mailbox was retired before this message became due.",
      },
    );
  }
  return true;
}

async function terminalizeExpiredManagedDeliveryLeases(
  ctx: MutationCtx,
  resource: ManagedResource,
  timestamp: number,
): Promise<void> {
  if (!resource.canonicalInboxId) return;
  const inbox = await ctx.db.get(resource.canonicalInboxId);
  if (!managedInboxIsQuarantinedForResource(inbox, resource)) return;
  const [sending, claimedCanaries, managedClaimedCanaries] = await Promise.all([
    ctx.db
      .query("outreach_messages")
      .withIndex("by_inbox_status", (q) =>
        q.eq("inboxId", resource.canonicalInboxId!).eq("status", "sending")
      )
      .take(10),
    ctx.db
      .query("outreach_inbound_relay_canaries")
      .withIndex("by_inbox_status", (q) =>
        q.eq("inboxId", resource.canonicalInboxId!).eq(
          "deliveryStatus",
          "claimed",
        )
      )
      .take(10),
    ctx.db
      .query("managed_ses_event_canaries")
      .withIndex("by_inbox_status", (q) =>
        q.eq("inboxId", resource.canonicalInboxId!).eq("status", "claimed")
      )
      .take(10),
  ]);
  for (const message of sending) {
    if ((message.deliveryLeaseExpiresAt ?? 0) > timestamp) continue;
    if (
      message.deliveryTransport === MANAGED_SES_TRANSPORT &&
      !message.managedSesExternalAttemptedAt
    ) {
      await ctx.db.patch(message._id, {
        status: "failed",
        deliveryLeaseExpiredAt: timestamp,
        failureReason:
          "The managed sender was retired before the provider boundary; no delivery was attempted.",
        updatedAt: timestamp,
      });
      if (message.deliveryAttemptId && message.deliveryOwnerAccountKey) {
        await releaseDurableContactClaimForAccount(
          ctx,
          message.deliveryOwnerAccountKey,
          message.toDomain,
          message.deliveryAttemptId,
          timestamp,
        );
      }
    } else {
      await ctx.db.patch(message._id, {
        status: "delivery_unverified",
        deliveryLeaseExpiredAt: timestamp,
        failureReason:
          "The managed sender was retired after its delivery lease expired. This immutable ambiguous attempt will never be replayed.",
        updatedAt: timestamp,
      });
    }
  }
  for (const canary of claimedCanaries) {
    if ((canary.deliveryLeaseExpiresAt ?? 0) > timestamp) continue;
    await ctx.db.patch(canary._id, {
      deliveryStatus: "unverified",
      deliveryLeaseExpiresAt: undefined,
      deliveryFinalizedAt: timestamp,
    });
  }
  for (const canary of managedClaimedCanaries) {
    if ((canary.sendLeaseExpiresAt ?? 0) > timestamp) continue;
    await ctx.db.patch(canary._id, {
      status: canary.externalAttemptedAt ? "unverified" : "failed",
      sendLeaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
  }
}

function managedSesDispositionSettled(state?: string): boolean {
  return [
    "missing",
    "submitted",
    "event_confirmed",
    "terminal_rejected",
    "quarantined_integrity",
    "quarantined_no_replay",
    "event_confirmed_after_disposition",
  ].includes(state ?? "");
}

async function verifiedAccountDeletionAmbiguitySettled(
  ctx: QueryCtx,
  resource: ManagedResource,
  timestamp: number,
): Promise<boolean> {
  const site = await ctx.db.get(resource.siteId);
  if (!site?.accountDeletionRequestedAt) return false;
  const receipt = await ctx.db
    .query("account_deletion_receipts")
    .withIndex("by_account_key", (q) =>
      q.eq("accountKey", resource.ownerAccountKey)
    )
    .unique();
  return managedOutreachMailboxVerifiedDeletionSettled({
    timestamp,
    accountDeletionRequestedAt: site.accountDeletionRequestedAt,
    siteUserId: site.userId,
    receiptUserId: receipt?.userId,
    receiptStatus: receipt?.status,
    resourceOwnerMatches:
      currentOwnerAccountKey(site) === resource.ownerAccountKey,
  });
}

async function clearManagedInboxProvenanceAfterRelease(
  ctx: MutationCtx,
  resource: ManagedResource,
  timestamp: number,
): Promise<void> {
  if (!resource.canonicalInboxId) return;
  const inbox = await ctx.db.get(resource.canonicalInboxId);
  if (!managedInboxMatchesResource(inbox, resource)) return;
  await ctx.db.patch(inbox._id, {
    credentialSource: undefined,
    managedTransportKind: undefined,
    managedTransportOperationKey: undefined,
    managedTransportGeneration: undefined,
    managedTransportAdapterVersion: undefined,
    managedTransportResourceReceipt: undefined,
    managedTransportResourceVerifiedAt: undefined,
    managedTransportEventCanaryVerifiedAt: undefined,
    managedTransportEventCanaryReceipt: undefined,
    managedTransportEventCanaryOperationKey: undefined,
    managedTransportEventProviderMessageIdDigest: undefined,
    managedTransportInboundCanaryVerifiedAt: undefined,
    managedTransportInboundCanaryReceipt: undefined,
    managedTransportInboundCanaryOperationKey: undefined,
    managedTransportInboundCanaryInboxBinding: undefined,
    managedTransportInboundCanaryRelayConfigurationHash: undefined,
    managedTransportInboundCanaryAdapterVersion: undefined,
    managedTransportInboundCanaryRetentionPolicyHash: undefined,
    updatedAt: timestamp,
  });
}

type ManagedReleaseBlocker = {
  reasonCode: typeof RELEASE_SETTLEMENT_PENDING |
    typeof RELEASE_PROVISIONING_PENDING |
    typeof RELEASE_QUARANTINE_PENDING;
  nextAttemptAt: number;
};

async function managedReleaseBlocker(
  ctx: QueryCtx,
  resource: ManagedResource,
  timestamp: number,
): Promise<ManagedReleaseBlocker | null> {
  if ((resource.externalProvisioningSettleAfter ?? 0) > timestamp) {
    return {
      reasonCode: RELEASE_PROVISIONING_PENDING,
      nextAttemptAt: resource.externalProvisioningSettleAfter! + 1_000,
    };
  }
  if (!resource.canonicalInboxId) return null;
  const canonicalInboxId = resource.canonicalInboxId;
  const inbox = await ctx.db.get(canonicalInboxId);
  if (inbox && !managedInboxIsQuarantinedForResource(inbox, resource)) {
    return {
      reasonCode: RELEASE_QUARANTINE_PENDING,
      nextAttemptAt: timestamp + RELEASE_RETRY_MS,
    };
  }
  const [
    sending,
    unverified,
    claimedCanary,
    acceptedCanary,
    unverifiedCanary,
    managedClaimedCanary,
    managedUnverifiedCanary,
  ] =
    await Promise.all([
      ctx.db
        .query("outreach_messages")
        .withIndex("by_inbox_status", (q) =>
          q.eq("inboxId", canonicalInboxId).eq("status", "sending")
        )
        .first(),
      ctx.db
        .query("outreach_messages")
        .withIndex("by_managed_resource_status_disposition", (q) =>
          q.eq("managedSesResourceOperationKey", resource.operationKey)
            .eq("status", "delivery_unverified")
            .eq("managedSesDispositionSettledAt", undefined)
        )
        .first(),
      ctx.db
        .query("outreach_inbound_relay_canaries")
        .withIndex("by_inbox_status", (q) =>
          q.eq("inboxId", canonicalInboxId).eq(
            "deliveryStatus",
            "claimed",
          )
        )
        .first(),
      ctx.db
        .query("outreach_inbound_relay_canaries")
        .withIndex("by_inbox_status", (q) =>
          q.eq("inboxId", canonicalInboxId).eq(
            "deliveryStatus",
            "accepted",
          )
        )
        .first(),
      ctx.db
        .query("outreach_inbound_relay_canaries")
        .withIndex("by_inbox_status", (q) =>
          q.eq("inboxId", canonicalInboxId).eq(
            "deliveryStatus",
            "unverified",
          )
        )
        .first(),
      ctx.db
        .query("managed_ses_event_canaries")
        .withIndex("by_inbox_status", (q) =>
          q.eq("inboxId", canonicalInboxId).eq("status", "claimed")
        )
        .first(),
      ctx.db
        .query("managed_ses_event_canaries")
        .withIndex("by_resource_status_disposition", (q) =>
          q.eq("resourceOperationKey", resource.operationKey)
            .eq("status", "unverified")
            .eq("dispositionSettledAt", undefined)
        )
        .first(),
    ]);
  const unsettledCanaries = [
    claimedCanary,
    acceptedCanary,
    unverifiedCanary,
  ].filter((canary): canary is NonNullable<typeof canary> =>
    Boolean(canary && managedOutreachMailboxCanaryReleasePending({
      deliveryStatus: canary.deliveryStatus,
      deliveryLeaseExpiresAt: canary.deliveryLeaseExpiresAt,
      expiresAt: canary.expiresAt,
      timestamp,
    }))
  );
  const verifiedDeletionSettled = sending || unverified
    ? await verifiedAccountDeletionAmbiguitySettled(ctx, resource, timestamp)
    : false;
  const blockingSending = Boolean(
    sending && (
      (sending.deliveryLeaseExpiresAt ?? 0) > timestamp ||
      !verifiedDeletionSettled
    ),
  );
  const blockingUnverified = Boolean(
    unverified &&
    (unverified.deliveryTransport === MANAGED_SES_TRANSPORT ||
      !verifiedDeletionSettled),
  );
  const managedCanarySettlementAt = Math.max(
    managedClaimedCanary?.sendLeaseExpiresAt ?? 0,
    managedUnverifiedCanary
      ? Math.max(
          managedUnverifiedCanary.issuedAt +
            MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
          managedUnverifiedCanary.dispositionLeaseExpiresAt ?? 0,
        )
      : 0,
  );
  const managedCanaryPending = Boolean(
    (managedClaimedCanary && managedClaimedCanary.expiresAt > timestamp) ||
    managedUnverifiedCanary,
  );
  if (
    !blockingSending &&
    !blockingUnverified &&
    unsettledCanaries.length === 0 &&
    !managedCanaryPending
  ) return null;
  const knownSettlementAt = Math.max(
    blockingSending ? sending?.deliveryLeaseExpiresAt ?? 0 : 0,
    unverified?.deliveryTransport === MANAGED_SES_TRANSPORT
      ? Math.max(
          (unverified.managedSesExternalAttemptedAt ?? timestamp) +
            MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
          unverified.managedSesDispositionLeaseExpiresAt ?? 0,
        )
      : 0,
    ...unsettledCanaries.map((row) =>
      Math.max(row.deliveryLeaseExpiresAt ?? 0, row.expiresAt)
    ),
    managedCanarySettlementAt,
  );
  return {
    reasonCode: RELEASE_SETTLEMENT_PENDING,
    nextAttemptAt: Math.max(
      timestamp + RELEASE_RETRY_MS,
      knownSettlementAt + 1_000,
    ),
  };
}

async function releaseTombstoneForOperation(
  ctx: QueryCtx,
  operationKey: string,
): Promise<ManagedReleaseTombstone | null> {
  return ctx.db
    .query("managed_outreach_mailbox_release_tombstones")
    .withIndex("by_operation", (q) => q.eq("operationKey", operationKey))
    .unique();
}

async function requestResourceRelease(
  ctx: MutationCtx,
  resource: ManagedResource,
  timestamp: number,
  releaseReason: string,
): Promise<"not_required" | "requested"> {
  await quarantineManagedCanonicalInbox(
    ctx,
    resource,
    timestamp,
    releaseReason,
  );
  await terminalizeExpiredManagedDeliveryLeases(ctx, resource, timestamp);
  const existing = await releaseTombstoneForOperation(
    ctx,
    resource.operationKey,
  );
  if (
    !resource.externalProvisioningAttemptedAt &&
    !resource.externalAllocatedAt &&
    !resource.canonicalInboxId
  ) {
    const tombstone = {
      operationKey: resource.operationKey,
      ownerAccountKey: resource.ownerAccountKey,
      generation: resource.generation,
      contractVersion: resource.requestContractVersion,
      state: "not_required" as const,
      releaseReason,
      requestedAt: existing?.requestedAt ?? timestamp,
      releasedAt: existing?.releasedAt ?? timestamp,
      updatedAt: timestamp,
      adapterVersion: undefined,
      lastReasonCode: undefined,
    };
    if (existing) await ctx.db.patch(existing._id, tombstone);
    else {
      await ctx.db.insert(
        "managed_outreach_mailbox_release_tombstones",
        tombstone,
      );
    }
    await ctx.db.patch(resource._id, {
      lifecycleState: "cancelled",
      releaseState: "released",
      releaseRequestedAt: resource.releaseRequestedAt ?? timestamp,
      releaseReason,
      releasedAt: timestamp,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      externalProvisioningSettleAfter: undefined,
      nextAttemptAt: undefined,
      updatedAt: timestamp,
    });
    await clearManagedInboxProvenanceAfterRelease(ctx, resource, timestamp);
    return "not_required";
  }

  const blocker = existing?.state === "released"
    ? null
    : await managedReleaseBlocker(ctx, resource, timestamp);
  const blockedUntil = blocker?.nextAttemptAt ?? (
    resource.releaseState === "blocked" &&
        (resource.nextAttemptAt ?? 0) > timestamp
      ? resource.nextAttemptAt
      : undefined
  );
  const tombstone = {
    operationKey: resource.operationKey,
    ownerAccountKey: resource.ownerAccountKey,
    generation: resource.generation,
    contractVersion: resource.requestContractVersion,
    state: existing?.state === "released"
      ? "released" as const
      : blockedUntil
        ? "blocked" as const
        : "release_requested" as const,
    releaseReason,
    requestedAt: existing?.requestedAt ?? timestamp,
    releasedAt: existing?.releasedAt,
    updatedAt: timestamp,
    adapterVersion: existing?.adapterVersion ?? resource.adapterVersion,
    lastReasonCode: existing?.state === "released"
      ? existing.lastReasonCode
      : blocker?.reasonCode ?? (blockedUntil ? existing?.lastReasonCode : undefined),
  };
  if (existing) await ctx.db.patch(existing._id, tombstone);
  else {
    await ctx.db.insert(
      "managed_outreach_mailbox_release_tombstones",
      tombstone,
    );
  }
  if (tombstone.state === "released") {
    await ctx.db.patch(resource._id, {
      releaseState: "released",
      releasedAt: tombstone.releasedAt ?? timestamp,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      externalProvisioningSettleAfter: undefined,
      nextAttemptAt: undefined,
      updatedAt: timestamp,
    });
    await clearManagedInboxProvenanceAfterRelease(ctx, resource, timestamp);
    return "not_required";
  }
  await ctx.db.patch(resource._id, {
    lifecycleState: "cancelled",
    releaseState: blockedUntil ? "blocked" : "requested",
    releaseRequestedAt: resource.releaseRequestedAt ?? timestamp,
    releaseReason,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    nextAttemptAt: blockedUntil ?? timestamp,
    lastReasonCode: blocker?.reasonCode,
    updatedAt: timestamp,
  });
  await ctx.scheduler.runAt(
    blockedUntil ?? timestamp,
    internal.managedOutreachMailbox.claimRelease,
    { resourceId: resource._id },
  );
  return "requested";
}

/** Called in the same transaction that erects a site/account deletion fence. */
export async function stageManagedOutreachMailboxRelease(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  timestamp: number,
  releaseReason: string,
): Promise<{ resources: number; pending: number }> {
  const [resourcePage, requests] = await Promise.all([
    ctx.db
      .query("managed_outreach_mailbox_resources")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(RESOURCE_RELEASE_BATCH),
    ctx.db
      .query("managed_provisioning_requests")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .take(2),
  ]);
  const resourcesById = new Map<string, ManagedResource>();
  for (const resource of resourcePage) {
    resourcesById.set(String(resource._id), resource);
  }
  for (const request of requests) {
    if (request.outreachMailboxGeneration === undefined) continue;
    const current = await ctx.db
      .query("managed_outreach_mailbox_resources")
      .withIndex("by_request_generation", (q) =>
        q.eq("requestId", request._id).eq(
          "generation",
          request.outreachMailboxGeneration!,
        )
      )
      .take(2);
    for (const resource of current) {
      resourcesById.set(String(resource._id), resource);
    }
  }
  const resources = [...resourcesById.values()];
  let pending = 0;
  for (const resource of resources) {
    const state = await requestResourceRelease(
      ctx,
      resource,
      timestamp,
      releaseReason,
    );
    if (state === "requested") pending += 1;
  }
  return { resources: resources.length, pending };
}

/** Account-deletion cleanup may encounter a managed inbox on a site whose
 * ownership has already changed. Release only the external resource bound to
 * that exact inbox; never broaden the operation to the site's current inbox. */
export async function stageManagedOutreachMailboxReleaseForInbox(
  ctx: MutationCtx,
  inboxId: Id<"outreach_inboxes">,
  timestamp: number,
  releaseReason: string,
): Promise<{ found: boolean; pending: boolean }> {
  const resources = await ctx.db
    .query("managed_outreach_mailbox_resources")
    .withIndex("by_canonical_inbox", (q) => q.eq("canonicalInboxId", inboxId))
    .take(2);
  if (resources.length === 0) return { found: false, pending: false };
  if (resources.length !== 1) {
    throw new Error("Managed inbox resolves to ambiguous external resources");
  }
  const resource = resources[0];
  const state = await requestResourceRelease(
    ctx,
    resource,
    timestamp,
    releaseReason,
  );
  return {
    found: true,
    pending: state === "requested" || resource.releaseState !== "released",
  };
}

async function pruneSealedManagedResources(
  ctx: MutationCtx,
  resources: ManagedResource[],
  expectedGeneration: number,
  retainedHandoffResourceId?: Id<"managed_outreach_mailbox_resources">,
): Promise<number> {
  let pruned = 0;
  for (const candidate of resources) {
    if (
      candidate.generation === expectedGeneration ||
      candidate._id === retainedHandoffResourceId
    ) continue;
    const [resource, tombstone] = await Promise.all([
      ctx.db.get(candidate._id),
      releaseTombstoneForOperation(ctx, candidate.operationKey),
    ]);
    if (
      resource &&
      managedOutreachMailboxReleaseSealed({
        externalProvisioningAttemptedAt:
          resource.externalProvisioningAttemptedAt,
        externalAllocatedAt: resource.externalAllocatedAt,
        hasCanonicalInbox: Boolean(resource.canonicalInboxId),
        releaseState: resource.releaseState,
        tombstoneState: tombstone?.state,
      })
    ) {
      await ctx.db.delete(resource._id);
      pruned += 1;
    }
  }
  return pruned;
}

async function managedSuccessorHandoffResource(
  ctx: MutationCtx,
  request: ManagedRequest,
  resources: ManagedResource[],
  expectedGeneration: number,
): Promise<{
  resource: ManagedResource | null;
  ambiguous: boolean;
}> {
  const eligible: ManagedResource[] = [];
  for (const candidate of resources) {
    if (
      candidate.generation === expectedGeneration ||
      !candidate.canonicalInboxId
    ) continue;
    const [resource, tombstone, inbox] = await Promise.all([
      ctx.db.get(candidate._id),
      releaseTombstoneForOperation(ctx, candidate.operationKey),
      ctx.db.get(candidate.canonicalInboxId),
    ]);
    if (resource && inbox && managedSesRotationCandidateEligible({
      differentGeneration: resource.generation !== expectedGeneration,
      resourceRequestMatches: resource.requestId === request._id,
      siteMatches:
        resource.siteId === request.siteId && inbox.siteId === request.siteId,
      ownerMatches:
        resource.ownerAccountKey === request.ownerAccountKey &&
        inbox.credentialOwnerAccountKey === request.ownerAccountKey,
      domainMatches: resource.domainSnapshot === request.domainSnapshot,
      domainRevisionMatches:
        resource.domainRevisionSnapshot === request.domainRevisionSnapshot,
      contractMatches:
        resource.requestContractVersion === request.contractVersion,
      resourceReleased:
        resource.lifecycleState === "cancelled" &&
        resource.releaseState === "released",
      tombstoneMatches:
        tombstone?.state === "released" &&
        tombstone.operationKey === resource.operationKey &&
        tombstone.ownerAccountKey === resource.ownerAccountKey &&
        tombstone.generation === resource.generation,
      inboxIdentityMatches:
        resource.canonicalInboxId === inbox._id &&
        inbox.provider === MANAGED_SES_TRANSPORT,
      inboxProvenanceCleared:
        inbox.status === "disconnected" &&
        inbox.mode === "approval" &&
        inbox.credentialSource === undefined &&
        inbox.managedTransportKind === undefined &&
        inbox.managedTransportOperationKey === undefined &&
        inbox.managedTransportGeneration === undefined &&
        inbox.managedTransportAdapterVersion === undefined &&
        !inbox.oauthAccessToken &&
        !inbox.oauthRefreshToken &&
        !inbox.smtpPassword &&
        !inbox.apiKey,
      noPendingWork: true,
    })) eligible.push(resource);
  }
  const decision = managedSesSuccessorHandoffDecision({
    successorAlreadyInstalled: false,
    eligibleResourceIds: eligible.map((resource) => String(resource._id)),
  });
  return {
    resource: decision.state === "retain_one" ? eligible[0] : null,
    ambiguous: decision.state === "ambiguous",
  };
}

async function cancelProvisioningRequestAfterMailboxRetirement(
  ctx: MutationCtx,
  request: ManagedRequest,
  timestamp: number,
): Promise<void> {
  await ctx.db.patch(request._id, {
    fulfillmentState: "cancelled",
    nextAttemptAt: undefined,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    lastReconciledAt: timestamp,
    operatorActionRequiredAt: undefined,
    completedAt: undefined,
    updatedAt: timestamp,
  });
}

export const reconcileProvisioningResource = internalMutation({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    expectedRequestRevision: v.number(),
    expectedConfigurationRevision: v.number(),
    expectedGeneration: v.number(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.revision !== args.expectedRequestRevision) {
      return { reconciled: false as const, reason: "request_changed" as const };
    }
    const [site, scannedResources, generationResources] = await Promise.all([
      ctx.db.get(request.siteId),
      ctx.db
      .query("managed_outreach_mailbox_resources")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .take(RESOURCE_SCAN_LIMIT + 1),
      ctx.db
        .query("managed_outreach_mailbox_resources")
        .withIndex("by_request_generation", (q) =>
          q.eq("requestId", request._id).eq(
            "generation",
            args.expectedGeneration,
          )
        )
        .take(2),
    ]);
    const resourcesById = new Map<string, ManagedResource>();
    for (const resource of [...scannedResources, ...generationResources]) {
      resourcesById.set(String(resource._id), resource);
    }
    const resources = [...resourcesById.values()];
    const timestamp = Date.now();
    for (const stale of resources.filter((row) =>
      row.generation !== args.expectedGeneration
    )) {
      await requestResourceRelease(
        ctx,
        stale,
        timestamp,
        "managed_mailbox_generation_superseded",
      );
    }
    if (
      request.outreachMailbox.mode !== "managed" ||
      request.fulfillmentState === "cancelled"
    ) {
      await pruneSealedManagedResources(ctx, resources, args.expectedGeneration);
      for (const resource of generationResources) {
        await requestResourceRelease(
          ctx,
          resource,
          timestamp,
          "owner_selected_connect_existing",
        );
      }
      return { reconciled: true as const, state: "not_managed" as const };
    }
    const fenceIssues = requestFenceIssues({
      request,
      site,
      expectedConfigurationRevision: args.expectedConfigurationRevision,
      expectedGeneration: args.expectedGeneration,
    });
    const executionAuthorized = site
      ? await siteExecutionAuthorized(ctx, site)
      : false;
    if (fenceIssues.length > 0 || !executionAuthorized) {
      for (const resource of resources) {
        await requestResourceRelease(
          ctx,
          resource,
          timestamp,
          fenceIssues.length > 0
            ? "managed_mailbox_identity_or_contract_invalidated"
            : "managed_mailbox_execution_unauthorized",
        );
      }
      await pruneSealedManagedResources(ctx, resources, args.expectedGeneration);
      await cancelProvisioningRequestAfterMailboxRetirement(
        ctx,
        request,
        timestamp,
      );
      return {
        reconciled: false as const,
        reason: fenceIssues.length > 0
          ? "lifecycle_fence" as const
          : "execution_unauthorized" as const,
        fenceIssues,
      };
    }
    const successorAlreadyInstalled = generationResources.some((row) =>
      row.lifecycleState === "canonicalized" &&
      row.releaseState === "active" &&
      Boolean(row.canonicalInboxId)
    );
    const handoff = successorAlreadyInstalled
      ? { resource: null, ambiguous: false }
      : await managedSuccessorHandoffResource(
          ctx,
          request,
          resources,
          args.expectedGeneration,
        );
    if (handoff.ambiguous) {
      return {
        reconciled: false as const,
        reason: "resource_identity_conflict" as const,
      };
    }
    await pruneSealedManagedResources(
      ctx,
      resources,
      args.expectedGeneration,
      handoff.resource?._id,
    );
    const profileIssues = managedOutreachMailboxProfileIssues(
      request.managedOutreachProfile,
    );
    if (profileIssues.length > 0) {
      return {
        reconciled: false as const,
        reason: "profile_fence" as const,
        profileIssues,
      };
    }
    const operationKey = managedOutreachMailboxOperationKey({
      requestId: String(request._id),
      ownerAccountKey: request.ownerAccountKey,
      domainSnapshot: request.domainSnapshot,
      domainRevisionSnapshot: request.domainRevisionSnapshot!,
      generation: args.expectedGeneration,
    });
    if (generationResources.length > 1) {
      for (const conflict of generationResources) {
        await requestResourceRelease(
          ctx,
          conflict,
          timestamp,
          "managed_mailbox_generation_identity_conflict",
        );
      }
      await cancelProvisioningRequestAfterMailboxRetirement(
        ctx,
        request,
        timestamp,
      );
      return {
        reconciled: false as const,
        reason: "resource_identity_conflict" as const,
      };
    }
    const remainingHistory = await ctx.db
      .query("managed_outreach_mailbox_resources")
      .withIndex("by_request", (q) => q.eq("requestId", request._id))
      .take(RESOURCE_SCAN_LIMIT);
    const priorGenerations = remainingHistory.filter((row) =>
      row.generation !== args.expectedGeneration &&
      row._id !== handoff.resource?._id
    );
    if (priorGenerations.length > 0) {
      const scheduledAt = Math.min(
        ...priorGenerations.map((row) =>
          Math.max(timestamp + 1_000, row.nextAttemptAt ?? timestamp)
        ),
        timestamp + RELEASE_RETRY_MS,
      );
      await ctx.scheduler.runAfter(
        Math.max(0, scheduledAt - timestamp),
        internal.managedOutreachMailbox.reconcileProvisioningResource,
        args,
      );
      return {
        reconciled: false as const,
        reason: "prior_generation_release_pending" as const,
      };
    }
    let resource: ManagedResource | null = generationResources[0] ?? null;
    if (!resource) {
      const resourceId = await ctx.db.insert(
        "managed_outreach_mailbox_resources",
        {
          siteId: request.siteId,
          requestId: request._id,
          ownerAccountKey: request.ownerAccountKey,
          domainSnapshot: request.domainSnapshot,
          domainRevisionSnapshot: request.domainRevisionSnapshot!,
          requestConfigurationRevision: args.expectedConfigurationRevision,
          requestContractVersion: request.contractVersion,
          generation: args.expectedGeneration,
          operationKey,
          transportKind: request.outreachTransport === SMARTLEAD_MANAGED_TRANSPORT
            ? SMARTLEAD_MANAGED_TRANSPORT
            : MANAGED_SES_TRANSPORT,
          lifecycleState: "queued",
          releaseState: "not_required",
          attempt: 0,
          nextAttemptAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      );
      resource = await ctx.db.get(resourceId);
      if (!resource) throw new Error("Managed mailbox ledger insert disappeared");
    } else if (
      resource.siteId !== request.siteId ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      resource.domainSnapshot !== request.domainSnapshot ||
      resource.domainRevisionSnapshot !== request.domainRevisionSnapshot ||
      resource.requestContractVersion !== request.contractVersion ||
      resource.operationKey !== operationKey
    ) {
      return { reconciled: false as const, reason: "resource_identity_conflict" as const };
    } else if (
      resource.requestConfigurationRevision !== args.expectedConfigurationRevision
    ) {
      await ctx.db.patch(resource._id, {
        requestConfigurationRevision: args.expectedConfigurationRevision,
        lifecycleState: resource.externalAllocatedAt
          ? "canonicalized"
          : "queued",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        nextAttemptAt: timestamp,
        lastReasonCode: undefined,
        updatedAt: timestamp,
      });
      resource = (await ctx.db.get(resource._id))!;
    }
    if (
      resource.releaseState === "requested" ||
      resource.releaseState === "leased" ||
      resource.releaseState === "blocked" ||
      resource.releaseState === "released" ||
      resource.lifecycleState === "cancelled"
    ) {
      return { reconciled: false as const, reason: "resource_retiring" as const };
    }
    if (request.outreachMailbox.state === "ready") {
      await ctx.db.patch(resource._id, {
        lifecycleState: "canonicalized",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        nextAttemptAt: undefined,
        updatedAt: timestamp,
      });
      return { reconciled: true as const, state: "canonicalized" as const };
    }
    if (
      resource.lifecycleState === "leased" &&
      (resource.leaseExpiresAt ?? 0) > timestamp
    ) {
      await ctx.scheduler.runAt(
        resource.leaseExpiresAt! + 1,
        internal.managedOutreachMailbox.reconcileProvisioningResource,
        args,
      );
      return { reconciled: true as const, state: "lease_live" as const };
    }
    const attempt = resource.attempt + 1;
    const leaseExpiresAt = timestamp + MANAGED_OUTREACH_MAILBOX_LEASE_MS;
    const leaseToken = sha256Hex(
      `managed-mailbox-lease:v1:${resource.operationKey}:${args.expectedConfigurationRevision}:${attempt}:${timestamp}`,
    );
    await ctx.db.patch(resource._id, {
      lifecycleState: "leased",
      attempt,
      leaseToken,
      leaseExpiresAt,
      nextAttemptAt: leaseExpiresAt,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.managedOutreachMailbox.provision,
      {
        resourceId: resource._id,
        requestId: request._id,
        expectedRequestRevision: request.revision,
        expectedConfigurationRevision: args.expectedConfigurationRevision,
        expectedGeneration: args.expectedGeneration,
        leaseToken,
      },
    );
    return {
      reconciled: true as const,
      state: "leased" as const,
      resourceId: resource._id,
      attempt,
      leaseExpiresAt,
    };
  },
});

export const getProvisioningOperation = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    requestId: v.id("managed_provisioning_requests"),
    expectedRequestRevision: v.number(),
    expectedConfigurationRevision: v.number(),
    expectedGeneration: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args): Promise<{
    operation: ManagedOutreachMailboxProvisionOperation;
    installTarget: { siteId: Id<"sites"> };
  } | null> => {
    const timestamp = Date.now();
    const [resource, request] = await Promise.all([
      ctx.db.get(args.resourceId),
      ctx.db.get(args.requestId),
    ]);
    if (
      !resource ||
      !request ||
      resource.requestId !== request._id ||
      resource.siteId !== request.siteId ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      resource.domainSnapshot !== request.domainSnapshot ||
      resource.domainRevisionSnapshot !== request.domainRevisionSnapshot ||
      resource.requestContractVersion !== request.contractVersion ||
      request.revision !== args.expectedRequestRevision ||
      resource.requestConfigurationRevision !==
        args.expectedConfigurationRevision ||
      resource.generation !== args.expectedGeneration ||
      resource.lifecycleState !== "leased" ||
      !["not_required", "active"].includes(resource.releaseState) ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      })
    ) return null;
    const site = await ctx.db.get(request.siteId);
    const lifecycleIssues = requestFenceIssues({
      request,
      site,
      expectedConfigurationRevision: args.expectedConfigurationRevision,
      expectedGeneration: args.expectedGeneration,
    });
    if (
      lifecycleIssues.length > 0 ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site))
    ) {
      await requestResourceRelease(
        ctx,
        resource,
        timestamp,
        lifecycleIssues.length > 0
          ? "managed_mailbox_identity_or_contract_invalidated"
          : "managed_mailbox_execution_unauthorized",
      );
      await cancelProvisioningRequestAfterMailboxRetirement(
        ctx,
        request,
        timestamp,
      );
      return null;
    }
    const profile = request.managedOutreachProfile;
    if (!profile || managedOutreachMailboxProfileIssues(profile).length > 0) {
      return null;
    }
    return {
      installTarget: { siteId: resource.siteId },
      operation: {
        contractVersion: MANAGED_OUTREACH_MAILBOX_CONTRACT_VERSION,
        transport: resource.transportKind === SMARTLEAD_MANAGED_TRANSPORT
          ? SMARTLEAD_MANAGED_TRANSPORT
          : MANAGED_SES_TRANSPORT,
        operationKey: resource.operationKey,
        generation: resource.generation,
        configurationRevision: resource.requestConfigurationRevision,
        externalDeadlineAt: resource.leaseExpiresAt!,
        tenantDomain: resource.domainSnapshot,
        senderDomainChoice: profile.senderDomainChoice,
        providerState: {
          encryptedBinding: resource.encryptedProviderBinding,
          clientRequestedAt: resource.smartleadClientRequestedAt,
          mailboxRequestedAt: resource.smartleadMailboxRequestedAt,
        },
        senderProfile: {
          fromName: profile.fromName,
          physicalMailingAddress: profile.physicalMailingAddress,
        },
        attestations: {
          profileVersion: profile.attestationVersion,
          senderIdentityAndAddressAttestedAt:
            profile.senderIdentityAndAddressAttestedAt,
          dedicatedSenderIdentityAttestedAt:
            profile.dedicatedSenderIdentityAttestedAt,
          canaryConsentVersion: profile.canaryConsentVersion,
          deliveryEventCanaryAuthorizedAt:
            profile.deliveryEventCanaryAuthorizedAt,
        },
        requirements: {
          idempotentOperationKey: true,
          doNotCommitAfterExternalDeadline: true,
          tenantIsolatedSenderIdentity: true,
          tenantBoundSendingAuthority: true,
          dedicatedSenderIdentity: true,
          scopedOutboundAuthority: true,
          spfDkimDmarc: true,
          signedDeliveryEventCanary: true,
        },
      },
    };
  },
});

/** A future real adapter must commit this conservative marker immediately
 * before its first external provisioning call. If that call becomes
 * ambiguous, deletion treats the resource as allocated and requires a
 * release receipt. The current network-free stub never invokes this mutation. */
export const markProvisioningExternalBoundaryInternal = internalMutation({
  args: {
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
      request.revision !== args.expectedRequestRevision ||
      resource.requestConfigurationRevision !==
        args.expectedConfigurationRevision ||
      resource.generation !== args.expectedGeneration ||
      resource.lifecycleState !== "leased" ||
      !["not_required", "active"].includes(resource.releaseState) ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      })
    ) throw new Error("Managed mailbox external boundary fence changed");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(args.adapterVersion)) {
      throw new Error("Managed mailbox adapter version is invalid");
    }
    const site = await ctx.db.get(request.siteId);
    const lifecycleIssues = requestFenceIssues({
      request,
      site,
      expectedConfigurationRevision: args.expectedConfigurationRevision,
      expectedGeneration: args.expectedGeneration,
    });
    if (
      lifecycleIssues.length > 0 ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site))
    ) {
      await requestResourceRelease(
        ctx,
        resource,
        timestamp,
        lifecycleIssues.length > 0
          ? "managed_mailbox_identity_or_contract_invalidated"
          : "managed_mailbox_execution_unauthorized",
      );
      await cancelProvisioningRequestAfterMailboxRetirement(
        ctx,
        request,
        timestamp,
      );
      return { marked: false as const, reason: "lifecycle_fence" as const };
    }
    await ctx.db.patch(resource._id, {
      externalProvisioningAttemptedAt:
        resource.externalProvisioningAttemptedAt ?? timestamp,
      externalProvisioningSettleAfter:
        resource.leaseExpiresAt! + EXTERNAL_PROVISIONING_LATE_RESULT_GRACE_MS,
      releaseState: "active",
      adapterVersion: args.adapterVersion,
      updatedAt: timestamp,
    });
    return {
      marked: true as const,
      operationKey: resource.operationKey,
      externalProvisioningAttemptedAt:
        resource.externalProvisioningAttemptedAt ?? timestamp,
    };
  },
});

export const recordProvisioningAdapterBlocked = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    requestId: v.id("managed_provisioning_requests"),
    expectedRequestRevision: v.number(),
    expectedConfigurationRevision: v.number(),
    expectedGeneration: v.number(),
    leaseToken: v.string(),
    reasonCode: v.union(
      v.literal(MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE),
      v.literal(MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED),
    ),
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
      request.revision !== args.expectedRequestRevision ||
      resource.requestConfigurationRevision !==
        args.expectedConfigurationRevision ||
      resource.generation !== args.expectedGeneration ||
      resource.lifecycleState !== "leased" ||
      !["not_required", "active"].includes(resource.releaseState) ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      })
    ) return { recorded: false as const, reason: "lease_or_request_lost" as const };
    const site = await ctx.db.get(request.siteId);
    const lifecycleIssues = requestFenceIssues({
      request,
      site,
      expectedConfigurationRevision: args.expectedConfigurationRevision,
      expectedGeneration: args.expectedGeneration,
    });
    if (
      lifecycleIssues.length > 0 ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site))
    ) {
      await requestResourceRelease(
        ctx,
        resource,
        timestamp,
        lifecycleIssues.length > 0
          ? "managed_mailbox_identity_or_contract_invalidated"
          : "managed_mailbox_execution_unauthorized",
      );
      await cancelProvisioningRequestAfterMailboxRetirement(
        ctx,
        request,
        timestamp,
      );
      return { recorded: false as const, reason: "lifecycle_fence" as const };
    }
    const nextAttemptAt = managedProvisioningRetryAt(timestamp);
    await ctx.db.patch(resource._id, {
      lifecycleState: "waiting_adapter",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt,
      lastReasonCode: args.reasonCode,
      updatedAt: timestamp,
    });
    const outreachMailbox = {
      ...request.outreachMailbox,
      state: "blocked" as const,
      blockedReasonCode: args.reasonCode,
      actionRequiredBy: "operator" as const,
      providerReportedAt: timestamp,
      updatedAt: timestamp,
    };
    const revision = request.revision + 1;
    await ctx.db.patch(request._id, {
      outreachMailbox,
      aggregateState: aggregateOneSetupRequestState([
        request.publisher,
        request.searchMeasurement,
        outreachMailbox,
      ]),
      fulfillmentState: "waiting_action",
      nextAttemptAt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      operatorActionRequiredAt: request.operatorActionRequiredAt ?? timestamp,
      revision,
      updatedAt: timestamp,
      completedAt: undefined,
    });
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.managedProvisioning.dispatchRequest,
      { requestId: request._id, expectedRevision: revision },
    );
    return { recorded: true as const, revision, nextAttemptAt };
  },
});

/** A signed managed-SES response can report bounded provider progress without
 * turning a transient state into fake readiness or an owner action. */
export const recordProvisioningAdapterProgress = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    requestId: v.id("managed_provisioning_requests"),
    expectedRequestRevision: v.number(),
    expectedConfigurationRevision: v.number(),
    expectedGeneration: v.number(),
    leaseToken: v.string(),
    adapterVersion: v.string(),
    reasonCode: v.string(),
    retryAfterSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const [resource, request] = await Promise.all([
      ctx.db.get(args.resourceId),
      ctx.db.get(args.requestId),
    ]);
    const timestamp = Date.now();
    const safeRetrySeconds = Math.max(
      30,
      Math.min(15 * 60, Math.floor(args.retryAfterSeconds ?? 60)),
    );
    if (
      !resource ||
      !request ||
      resource.requestId !== request._id ||
      resource.siteId !== request.siteId ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      resource.domainSnapshot !== request.domainSnapshot ||
      resource.domainRevisionSnapshot !== request.domainRevisionSnapshot ||
      resource.requestContractVersion !== request.contractVersion ||
      request.revision !== args.expectedRequestRevision ||
      resource.requestConfigurationRevision !==
        args.expectedConfigurationRevision ||
      resource.generation !== args.expectedGeneration ||
      resource.lifecycleState !== "leased" ||
      ![MANAGED_SES_TRANSPORT, SMARTLEAD_MANAGED_TRANSPORT].includes(
        resource.transportKind as typeof MANAGED_SES_TRANSPORT | typeof SMARTLEAD_MANAGED_TRANSPORT,
      ) ||
      !["not_required", "active"].includes(resource.releaseState) ||
      resource.externalProvisioningAttemptedAt === undefined ||
      resource.adapterVersion !== args.adapterVersion ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      }) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(args.adapterVersion) ||
      !/^[a-z][a-z0-9_]{1,63}$/.test(args.reasonCode)
    ) return { recorded: false as const };
    const site = await ctx.db.get(request.siteId);
    const lifecycleIssues = requestFenceIssues({
      request,
      site,
      expectedConfigurationRevision: args.expectedConfigurationRevision,
      expectedGeneration: args.expectedGeneration,
    });
    if (
      lifecycleIssues.length > 0 ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site))
    ) {
      await requestResourceRelease(
        ctx,
        resource,
        timestamp,
        lifecycleIssues.length > 0
          ? "managed_mailbox_identity_or_contract_invalidated"
          : "managed_mailbox_execution_unauthorized",
      );
      await cancelProvisioningRequestAfterMailboxRetirement(
        ctx,
        request,
        timestamp,
      );
      return { recorded: false as const };
    }
    const nextAttemptAt = timestamp + safeRetrySeconds * 1_000;
    await ctx.db.patch(resource._id, {
      lifecycleState: "waiting_adapter",
      adapterVersion: args.adapterVersion,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt,
      lastReasonCode: args.reasonCode,
      updatedAt: timestamp,
    });
    const outreachMailbox = {
      ...request.outreachMailbox,
      state: "in_progress" as const,
      blockedReasonCode: undefined,
      actionRequiredBy: undefined,
      providerReportedAt: timestamp,
      updatedAt: timestamp,
    };
    await ctx.db.patch(request._id, {
      outreachMailbox,
      aggregateState: aggregateOneSetupRequestState([
        request.publisher,
        request.searchMeasurement,
        outreachMailbox,
      ]),
      fulfillmentState: "retry_wait",
      nextAttemptAt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      operatorActionRequiredAt: undefined,
      completedAt: undefined,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.managedProvisioning.dispatchRequest,
      { requestId: request._id, expectedRevision: request.revision },
    );
    return { recorded: true as const, nextAttemptAt };
  },
});

/** Persist each Smartlead external sub-boundary before the provider call.
 * The timestamps make an acknowledgement loss distinguishable from a safe
 * first attempt, while the encrypted binding never exposes provider ids. */
export const recordSmartleadProvisioningBoundaryInternal = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    requestId: v.id("managed_provisioning_requests"),
    expectedRequestRevision: v.number(),
    expectedConfigurationRevision: v.number(),
    expectedGeneration: v.number(),
    leaseToken: v.string(),
    phase: v.union(
      v.literal("binding"),
      v.literal("client"),
      v.literal("mailbox"),
    ),
    encryptedProviderBinding: v.optional(v.string()),
    configurationHash: v.string(),
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
      request.revision !== args.expectedRequestRevision ||
      resource.requestConfigurationRevision !== args.expectedConfigurationRevision ||
      resource.generation !== args.expectedGeneration ||
      resource.transportKind !== SMARTLEAD_MANAGED_TRANSPORT ||
      resource.lifecycleState !== "leased" ||
      resource.releaseState !== "active" ||
      resource.adapterVersion !== SMARTLEAD_ADAPTER_VERSION ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      }) ||
      !/^[a-f0-9]{64}$/.test(args.configurationHash) ||
      (args.encryptedProviderBinding !== undefined &&
        !/^v1\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/.test(
          args.encryptedProviderBinding,
        ))
    ) return { recorded: false as const };
    const site = await ctx.db.get(request.siteId);
    const lifecycleIssues = requestFenceIssues({
      request,
      site,
      expectedConfigurationRevision: args.expectedConfigurationRevision,
      expectedGeneration: args.expectedGeneration,
    });
    if (lifecycleIssues.length > 0 || !site || !(await siteExecutionAuthorized(ctx, site))) {
      return { recorded: false as const };
    }
    const patch = args.phase === "client"
      ? { smartleadClientRequestedAt: resource.smartleadClientRequestedAt ?? timestamp }
      : args.phase === "mailbox"
        ? { smartleadMailboxRequestedAt: resource.smartleadMailboxRequestedAt ?? timestamp }
        : {};
    await ctx.db.patch(resource._id, {
      ...patch,
      encryptedProviderBinding:
        args.encryptedProviderBinding ?? resource.encryptedProviderBinding,
      configurationHash: args.configurationHash,
      updatedAt: timestamp,
    });
    return { recorded: true as const, recordedAt: timestamp };
  },
});

export const claimManagedSesEventCanary = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    inboxId: v.id("outreach_inboxes"),
    recipientHash: v.string(),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const [resource, inbox] = await Promise.all([
      ctx.db.get(args.resourceId),
      ctx.db.get(args.inboxId),
    ]);
    if (
      !resource ||
      !inbox ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" ||
      resource.releaseState !== "active" ||
      resource.canonicalInboxId !== inbox._id ||
      inbox.provider !== MANAGED_SES_TRANSPORT ||
      inbox.managedTransportKind !== MANAGED_SES_TRANSPORT ||
      inbox.credentialSource !== "managed_adapter" ||
      inbox.managedTransportOperationKey !== resource.operationKey ||
      inbox.managedTransportGeneration !== resource.generation ||
      inbox.managedTransportAdapterVersion !== resource.adapterVersion ||
      !resource.adapterVersion ||
      !resource.resourceReceipt ||
      resource.resourceReceipt !== inbox.managedTransportResourceReceipt ||
      !/^[a-f0-9]{64}$/.test(args.recipientHash)
    ) return { claimed: false as const, reason: "binding_changed" as const };
    const [site, request] = await Promise.all([
      ctx.db.get(resource.siteId),
      ctx.db.get(resource.requestId),
    ]);
    if (
      !site ||
      !request ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      resource.requestId !== request._id ||
      resource.siteId !== request.siteId ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      resource.domainSnapshot !== request.domainSnapshot ||
      resource.domainRevisionSnapshot !== request.domainRevisionSnapshot ||
      resource.requestContractVersion !== request.contractVersion ||
      requestFenceIssues({
        request,
        site,
        expectedConfigurationRevision:
          resource.requestConfigurationRevision,
        expectedGeneration: resource.generation,
      }).length > 0 ||
      request.outreachMailbox.mode !== "managed" ||
      request.outreachMailboxGeneration !== resource.generation ||
      request.ownerAccountKey !== resource.ownerAccountKey ||
      !request.managedOutreachProfile ||
      managedOutreachMailboxProfileIssues(request.managedOutreachProfile)
        .length > 0 ||
      request.managedOutreachProfile.deliveryEventCanaryAuthorizedAt >
        timestamp
    ) return { claimed: false as const, reason: "authority_changed" as const };
    const cycle = Math.floor(timestamp / MANAGED_SES_EVENT_CANARY_VALID_MS);
    const cycleStartedAt = cycle * MANAGED_SES_EVENT_CANARY_VALID_MS;
    const cycleEndsAt = cycleStartedAt + MANAGED_SES_EVENT_CANARY_VALID_MS;
    const inboxConfigurationVersion = inbox.configurationVersion ?? 0;
    const resourceAdapterVersion = resource.adapterVersion;
    const currentCycleAttempts = await ctx.db
      .query("managed_ses_event_canaries")
      .withIndex("by_inbox_configuration_adapter_issued_at", (q) =>
        q
          .eq("inboxId", inbox._id)
          .eq("inboxConfigurationVersion", inboxConfigurationVersion)
          .eq("adapterVersion", resourceAdapterVersion)
          .gte("issuedAt", cycleStartedAt)
          .lt("issuedAt", cycleEndsAt))
      .take(11);
    const liveWindow = await ctx.db
      .query("managed_ses_event_canaries")
      .withIndex("by_inbox_configuration_adapter_issued_at", (q) =>
        q
          .eq("inboxId", inbox._id)
          .eq("inboxConfigurationVersion", inboxConfigurationVersion)
          .eq("adapterVersion", resourceAdapterVersion)
          .gte(
            "issuedAt",
            Math.max(0, timestamp - MANAGED_SES_EVENT_CANARY_VALID_MS),
          ))
      .order("desc")
      .take(21);
    const liveStatuses = liveWindow.filter((row) =>
      row.expiresAt > timestamp &&
      ["claimed", "accepted", "unverified", "delivered"].includes(row.status)
    ).map((row) =>
      row.status as "claimed" | "accepted" | "unverified" | "delivered"
    );
    const canaryDecision = managedSesEventCanaryClaimDecision({
      currentCycleAttemptCount: currentCycleAttempts.length,
      rollingAttemptCount: liveWindow.length,
      liveStatuses,
    });
    if (canaryDecision.state !== "create") {
      return {
        claimed: false as const,
        reason: canaryDecision.state,
      };
    }
    const cycleAttempts = canaryDecision.attemptOrdinal;
    const operationKey = sha256Hex(JSON.stringify({
      purpose: "managed_ses_event_canary",
      version: 1,
      resourceOperationKey: resource.operationKey,
      generation: resource.generation,
      inboxConfigurationVersion: inbox.configurationVersion ?? 0,
      adapterVersion: resource.adapterVersion,
      cycle,
      attemptOrdinal: cycleAttempts,
    }));
    const prior = await ctx.db
      .query("managed_ses_event_canaries")
      .withIndex("by_operation", (q) => q.eq("operationKey", operationKey))
      .unique();
    if (prior) {
      return { claimed: false as const, reason: "attempt_exists" as const };
    }
    const relayRuntime = {
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
      retentionAudited:
        process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
    };
    const relayDomain = normalizeInboundRelayDomain(relayRuntime.domain);
    const relayConfigurationHash = inboundRelayConfigurationHash(relayRuntime);
    const routingTarget = await inboundRelayDsnRoutingTarget({
      siteId: String(resource.siteId),
      inboxId: String(inbox._id),
      generation: inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
      relayDomain: relayRuntime.domain,
      secret: relayRuntime.dsnTargetSecret,
    });
    const replyAlias =
      `reply-${operationKey.slice(0, 48)}@${MANAGED_SES_PLATFORM_RELAY_DOMAIN}`;
    const aliasHash = inboundRelayAliasHash(replyAlias);
    if (
      !inboundRelayConfigured(relayRuntime) ||
      relayDomain !== MANAGED_SES_PLATFORM_RELAY_DOMAIN ||
      !relayConfigurationHash ||
      !routingTarget ||
      routingTarget.version !== OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION ||
      !relayRuntime.adapterVersion ||
      !relayRuntime.retentionPolicyHash ||
      !/^[a-f0-9]{64}$/.test(aliasHash)
    ) {
      return {
        claimed: false as const,
        reason: "inbound_relay_unavailable" as const,
      };
    }
    const inboxBinding = sha256Hex(JSON.stringify({
      version: 1,
      purpose: "managed_ses_inbound_canary",
      siteId: String(resource.siteId),
      inboxId: String(inbox._id),
      inboxConfigurationVersion: inbox.configurationVersion ?? 0,
      ownerAccountKey: resource.ownerAccountKey,
      resourceOperationKey: resource.operationKey,
      generation: resource.generation,
      adapterVersion: resource.adapterVersion,
      aliasHash,
      relayConfigurationHash,
      routingTargetHash: routingTarget.hash,
      routingTargetVersion: routingTarget.version,
      routingTargetGeneration:
        inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
    }));
    const sendLeaseExpiresAt =
      timestamp + MANAGED_SES_CANARY_SEND_LEASE_MS;
    const canaryId = await ctx.db.insert("managed_ses_event_canaries", {
      siteId: resource.siteId,
      inboxId: inbox._id,
      resourceId: resource._id,
      operationKey,
      resourceOperationKey: resource.operationKey,
      generation: resource.generation,
      adapterVersion: resource.adapterVersion!,
      inboxConfigurationVersion: inbox.configurationVersion ?? 0,
      recipientHash: args.recipientHash,
      status: "claimed",
      issuedAt: timestamp,
      expiresAt: timestamp + MANAGED_SES_EVENT_CANARY_TTL_MS,
      sendLeaseExpiresAt,
      inboundRelayAliasHash: aliasHash,
      inboundRelayAliasDomain: relayDomain,
      inboundRelayConfigurationHash: relayConfigurationHash,
      inboundRelayAdapterVersion: relayRuntime.adapterVersion,
      inboundRelayRetentionPolicyHash: relayRuntime.retentionPolicyHash,
      inboundRelayRolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      inboundRelayDsnRoutingTargetHash: routingTarget.hash,
      inboundRelayDsnRoutingTargetVersion: routingTarget.version,
      inboundRelayDsnRoutingTargetGeneration:
        inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
      inboundCanaryInboxBinding: inboxBinding,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      sendLeaseExpiresAt + 1_000,
      internal.managedOutreachMailbox.recoverManagedSesEventCanaryLease,
      { canaryId, operationKey },
    );
    return {
      claimed: true as const,
      canaryId,
      operationKey,
      resourceOperationKey: resource.operationKey,
      generation: resource.generation,
      adapterVersion: resource.adapterVersion!,
      inboxBinding,
      fromName: request.managedOutreachProfile.fromName,
    };
  },
});

export const markManagedSesEventCanaryExternalBoundary = internalMutation({
  args: {
    canaryId: v.id("managed_ses_event_canaries"),
    operationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const canary = await ctx.db.get(args.canaryId);
    const timestamp = Date.now();
    if (
      !canary ||
      canary.operationKey !== args.operationKey ||
      canary.status !== "claimed" ||
      canary.externalAttemptedAt !== undefined ||
      (canary.sendLeaseExpiresAt ?? 0) <= timestamp
    ) {
      return {
        marked: false as const,
        externalAttempted: Boolean(canary?.externalAttemptedAt),
      };
    }
    const [resource, inbox, site, request] = await Promise.all([
      ctx.db.get(canary.resourceId),
      ctx.db.get(canary.inboxId),
      ctx.db.get(canary.siteId),
      ctx.db.get(canary.resourceId).then((resource) =>
        resource ? ctx.db.get(resource.requestId) : null
      ),
    ]);
    const relayRuntime = {
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
      retentionAudited:
        process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
    };
    const relayConfigurationHash = inboundRelayConfigurationHash(relayRuntime);
    const routingTarget = inbox
      ? await inboundRelayDsnRoutingTarget({
          siteId: String(canary.siteId),
          inboxId: String(inbox._id),
          generation: inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
          relayDomain: relayRuntime.domain,
          secret: relayRuntime.dsnTargetSecret,
        })
      : null;
    const expectedInboxBinding = resource && inbox && relayConfigurationHash &&
        routingTarget
      ? sha256Hex(JSON.stringify({
          version: 1,
          purpose: "managed_ses_inbound_canary",
          siteId: String(canary.siteId),
          inboxId: String(inbox._id),
          inboxConfigurationVersion: inbox.configurationVersion ?? 0,
          ownerAccountKey: resource.ownerAccountKey,
          resourceOperationKey: resource.operationKey,
          generation: resource.generation,
          adapterVersion: resource.adapterVersion,
          aliasHash: canary.inboundRelayAliasHash,
          relayConfigurationHash,
          routingTargetHash: routingTarget.hash,
          routingTargetVersion: routingTarget.version,
          routingTargetGeneration:
            inbox.inboundRelayDsnRoutingTargetGeneration ?? 1,
        }))
      : null;
    if (
      !resource ||
      !inbox ||
      !site ||
      !request ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" ||
      resource.releaseState !== "active" ||
      resource.canonicalInboxId !== inbox._id ||
      resource.operationKey !== canary.resourceOperationKey ||
      resource.generation !== canary.generation ||
      resource.adapterVersion !== canary.adapterVersion ||
      resource.requestId !== request._id ||
      resource.siteId !== request.siteId ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      resource.domainSnapshot !== request.domainSnapshot ||
      resource.domainRevisionSnapshot !== request.domainRevisionSnapshot ||
      resource.requestContractVersion !== request.contractVersion ||
      requestFenceIssues({
        request,
        site,
        expectedConfigurationRevision:
          resource.requestConfigurationRevision,
        expectedGeneration: resource.generation,
      }).length > 0 ||
      inbox.credentialSource !== "managed_adapter" ||
      inbox.managedTransportKind !== MANAGED_SES_TRANSPORT ||
      inbox.managedTransportOperationKey !== resource.operationKey ||
      inbox.managedTransportGeneration !== resource.generation ||
      inbox.managedTransportAdapterVersion !== resource.adapterVersion ||
      !inboundRelayConfigured(relayRuntime) ||
      normalizeInboundRelayDomain(relayRuntime.domain) !==
        MANAGED_SES_PLATFORM_RELAY_DOMAIN ||
      !relayConfigurationHash ||
      canary.inboundRelayConfigurationHash !== relayConfigurationHash ||
      canary.inboundRelayAdapterVersion !== relayRuntime.adapterVersion ||
      canary.inboundRelayRetentionPolicyHash !==
        relayRuntime.retentionPolicyHash ||
      canary.inboundRelayRolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
      !routingTarget ||
      canary.inboundRelayDsnRoutingTargetHash !== routingTarget.hash ||
      canary.inboundRelayDsnRoutingTargetVersion !== routingTarget.version ||
      canary.inboundRelayDsnRoutingTargetGeneration !==
        (inbox.inboundRelayDsnRoutingTargetGeneration ?? 1) ||
      !expectedInboxBinding ||
      canary.inboundCanaryInboxBinding !== expectedInboxBinding ||
      request.outreachMailbox.mode !== "managed" ||
      request.outreachMailboxGeneration !== resource.generation ||
      request.ownerAccountKey !== resource.ownerAccountKey
    ) return { marked: false as const, externalAttempted: false as const };
    const pacing = await reserveManagedSesPacingAttempt(ctx, {
      inbox,
      accountKey: resource.ownerAccountKey,
      now: timestamp,
    });
    const pacingTransition = managedSesPacingBoundaryTransition({
      kind: "canary",
      reserved: pacing.reserved,
      nextEligibleAt: pacing.nextEligibleAt,
    });
    if (pacingTransition !== "cross_external_boundary") {
      if (
        pacingTransition === "discard_canary_and_retry" &&
        pacing.nextEligibleAt
      ) {
        const deferredUntil = Math.max(timestamp + 1_000, pacing.nextEligibleAt);
        // No adapter boundary was crossed, so remove the unattempted ordinal.
        // The exact next claim can safely reuse its deterministic operation.
        await ctx.db.delete(canary._id);
        await ctx.scheduler.runAt(
          deferredUntil,
          internal.actions.managedOutreachMailbox.sendManagedSesEventCanary,
          { resourceId: resource._id, inboxId: inbox._id },
        );
        return {
          marked: false as const,
          externalAttempted: false as const,
          deferred: true as const,
          nextEligibleAt: deferredUntil,
          pacingReason: pacing.reason,
        };
      }
      return {
        marked: false as const,
        externalAttempted: false as const,
        pacingReason: pacing.reason,
      };
    }
    await ctx.db.patch(canary._id, {
      externalAttemptedAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      canary.sendLeaseExpiresAt! + 1_000,
      internal.managedOutreachMailbox.recoverManagedSesEventCanaryLease,
      { canaryId: canary._id, operationKey: canary.operationKey },
    );
    return { marked: true as const, externalAttempted: true as const };
  },
});

/** Action-death recovery for the narrow gap after the exact provider boundary
 * and before the signed response is recorded. Pre-boundary expiry is retryable;
 * post-boundary expiry is immutable and enters finite status/disposition. */
export const recoverManagedSesEventCanaryLease = internalMutation({
  args: {
    canaryId: v.id("managed_ses_event_canaries"),
    operationKey: v.string(),
  },
  handler: async (ctx, args) => {
    const canary = await ctx.db.get(args.canaryId);
    const timestamp = Date.now();
    if (
      !canary ||
      canary.operationKey !== args.operationKey ||
      canary.status !== "claimed" ||
      (canary.sendLeaseExpiresAt ?? 0) > timestamp
    ) return { recovered: false as const };
    if (!canary.externalAttemptedAt) {
      // No adapter boundary exists, so this deterministic ordinal is not an
      // attempt. Remove it and wake the exact resource/inbox claimant; a stale
      // action holding the deleted id can no longer cross the boundary.
      await ctx.db.delete(canary._id);
      await ctx.scheduler.runAfter(
        0,
        internal.actions.managedOutreachMailbox.sendManagedSesEventCanary,
        { resourceId: canary.resourceId, inboxId: canary.inboxId },
      );
      return {
        recovered: true as const,
        externalAttempted: false as const,
        retryScheduled: true as const,
      };
    }
    await ctx.db.patch(canary._id, {
      status: "unverified",
      sendLeaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      Math.max(
        timestamp,
        canary.externalAttemptedAt + MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
      ),
      internal.managedOutreachMailbox.claimManagedSesAmbiguityReconciliation,
      { resourceId: canary.resourceId },
    );
    return { recovered: true as const, externalAttempted: true as const };
  },
});

export const recordManagedSesEventCanaryAttempt = internalMutation({
  args: {
    canaryId: v.id("managed_ses_event_canaries"),
    operationKey: v.string(),
    state: v.union(
      v.literal("accepted"),
      v.literal("unverified"),
      v.literal("failed"),
    ),
    providerMessageIdDigest: v.optional(v.string()),
    rfcMessageIdDigest: v.optional(v.string()),
    threadReceipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const canary = await ctx.db.get(args.canaryId);
    if (
      !canary ||
      canary.operationKey !== args.operationKey ||
      canary.status !== "claimed" ||
      (["accepted", "unverified"].includes(args.state) &&
        !canary.externalAttemptedAt) ||
      (args.state === "accepted") !==
        /^[a-f0-9]{64}$/.test(args.providerMessageIdDigest ?? "") ||
      (args.state === "accepted") !==
        /^[a-f0-9]{64}$/.test(args.rfcMessageIdDigest ?? "") ||
      (args.state === "accepted") !==
        /^[A-Za-z0-9_-]{32,96}$/.test(args.threadReceipt ?? "") ||
      (args.state !== "accepted" &&
        (args.providerMessageIdDigest !== undefined ||
          args.rfcMessageIdDigest !== undefined ||
          args.threadReceipt !== undefined))
    ) return { recorded: false as const };
    const timestamp = Date.now();
    await ctx.db.patch(canary._id, {
      status: args.state,
      providerMessageIdDigest: args.providerMessageIdDigest,
      rfcMessageIdDigest: args.rfcMessageIdDigest,
      threadReceipt: args.threadReceipt,
      sendLeaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
    if (args.state === "unverified" && canary.externalAttemptedAt) {
      await ctx.scheduler.runAt(
        Math.max(
          timestamp,
          canary.externalAttemptedAt + MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
        ),
        internal.managedOutreachMailbox
          .claimManagedSesAmbiguityReconciliation,
        { resourceId: canary.resourceId },
      );
    }
    return { recorded: true as const };
  },
});

/** Claim the adapter activation only after both halves of the same controlled
 * canary have settled: a signed SES delivered event and an exact signed relay
 * STOP reply. The adapter call is idempotent for this immutable operation. */
export const claimManagedSesInboundCanaryActivation = internalMutation({
  args: { canaryId: v.id("managed_ses_event_canaries") },
  handler: async (ctx, args) => {
    const canary = await ctx.db.get(args.canaryId);
    const timestamp = Date.now();
    if (!canary) return { claimed: false as const, reason: "missing" as const };
    if (
      canary.inboundCanaryActivationState === "verified" &&
      canary.inboundCanaryReceipt &&
      canary.inboundCanaryVerifiedAt
    ) return { claimed: false as const, reason: "already_verified" as const };
    const [resource, inbox, site, request] = await Promise.all([
      ctx.db.get(canary.resourceId),
      ctx.db.get(canary.inboxId),
      ctx.db.get(canary.siteId),
      ctx.db.get(canary.resourceId).then((row) =>
        row ? ctx.db.get(row.requestId) : null
      ),
    ]);
    const runtime = {
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
      retentionAudited:
        process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
    };
    const relayConfigurationHash = inboundRelayConfigurationHash(runtime);
    if (
      !resource ||
      !inbox ||
      !site ||
      !request ||
      !(await siteExecutionAuthorized(ctx, site)) ||
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
      (inbox.configurationVersion ?? 0) !==
        canary.inboxConfigurationVersion ||
      request.outreachMailbox.mode !== "managed" ||
      request.outreachMailboxGeneration !== resource.generation ||
      request.ownerAccountKey !== resource.ownerAccountKey ||
      canary.status !== "delivered" ||
      !canary.eventReceipt ||
      !canary.verifiedAt ||
      !canary.inboundCanaryEventKey ||
      !canary.inboundCanaryEvidenceHash ||
      !canary.inboundCanarySettledAt ||
      !canary.inboundCanaryInboxBinding ||
      !relayConfigurationHash ||
      canary.inboundRelayConfigurationHash !== relayConfigurationHash ||
      canary.inboundRelayRetentionPolicyHash !== runtime.retentionPolicyHash ||
      canary.expiresAt < timestamp ||
      (canary.inboundCanaryActivationLeaseExpiresAt ?? 0) > timestamp
    ) return { claimed: false as const, reason: "binding_changed" as const };
    const leaseToken = sha256Hex(JSON.stringify({
      purpose: "managed_ses_inbound_canary_activation_lease",
      canaryId: String(canary._id),
      operationKey: canary.operationKey,
      timestamp,
      priorAttemptedAt: canary.inboundCanaryActivationExternalAttemptedAt,
    }));
    const activationLeaseExpiresAt =
      timestamp + MANAGED_SES_INBOUND_ACTIVATION_LEASE_MS;
    await ctx.db.patch(canary._id, {
      inboundCanaryActivationState: "claimed",
      inboundCanaryActivationLeaseToken: leaseToken,
      inboundCanaryActivationLeaseExpiresAt: activationLeaseExpiresAt,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      activationLeaseExpiresAt + 1_000,
      internal.actions.managedOutreachMailbox.activateManagedSesInboundCanary,
      { canaryId: canary._id },
    );
    return {
      claimed: true as const,
      leaseToken,
      canaryId: canary._id,
      operationKey: canary.operationKey,
      resourceOperationKey: canary.resourceOperationKey,
      generation: canary.generation,
      adapterVersion: canary.adapterVersion,
      fromEmail: inbox.fromEmail,
      resourceReceipt: resource.resourceReceipt!,
      inboxBinding: canary.inboundCanaryInboxBinding,
      relayConfigurationHash,
      retentionPolicyHash: runtime.retentionPolicyHash!,
      verifiedAt: Math.floor(canary.inboundCanarySettledAt / 1_000),
    };
  },
});

export const markManagedSesInboundCanaryActivationBoundary = internalMutation({
  args: {
    canaryId: v.id("managed_ses_event_canaries"),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const canary = await ctx.db.get(args.canaryId);
    const timestamp = Date.now();
    if (
      !canary ||
      canary.inboundCanaryActivationState !== "claimed" ||
      canary.inboundCanaryActivationLeaseToken !== args.leaseToken ||
      (canary.inboundCanaryActivationLeaseExpiresAt ?? 0) <= timestamp
    ) return { marked: false as const };
    const [resource, inbox, site, request] = await Promise.all([
      ctx.db.get(canary.resourceId),
      ctx.db.get(canary.inboxId),
      ctx.db.get(canary.siteId),
      ctx.db.get(canary.resourceId).then((row) =>
        row ? ctx.db.get(row.requestId) : null
      ),
    ]);
    const runtime = {
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
      retentionAudited:
        process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
    };
    const relayConfigurationHash = inboundRelayConfigurationHash(runtime);
    if (
      !resource ||
      !inbox ||
      !site ||
      !request ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      requestFenceIssues({
        request,
        site,
        expectedConfigurationRevision:
          resource.requestConfigurationRevision,
        expectedGeneration: resource.generation,
      }).length > 0 ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" ||
      resource.releaseState !== "active" ||
      resource.canonicalInboxId !== inbox._id ||
      resource.operationKey !== canary.resourceOperationKey ||
      resource.generation !== canary.generation ||
      resource.adapterVersion !== canary.adapterVersion ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      inbox.siteId !== site._id ||
      inbox.provider !== MANAGED_SES_TRANSPORT ||
      inbox.credentialSource !== "managed_adapter" ||
      inbox.credentialOwnerAccountKey !== resource.ownerAccountKey ||
      inbox.managedTransportOperationKey !== resource.operationKey ||
      inbox.managedTransportGeneration !== resource.generation ||
      inbox.managedTransportAdapterVersion !== resource.adapterVersion ||
      (inbox.configurationVersion ?? 0) !==
        canary.inboxConfigurationVersion ||
      request.outreachMailbox.mode !== "managed" ||
      request.outreachMailboxGeneration !== resource.generation ||
      canary.status !== "delivered" ||
      !canary.eventReceipt ||
      !canary.inboundCanarySettledAt ||
      !relayConfigurationHash ||
      canary.inboundRelayConfigurationHash !== relayConfigurationHash ||
      canary.inboundRelayRetentionPolicyHash !== runtime.retentionPolicyHash ||
      canary.expiresAt < timestamp
    ) return { marked: false as const };
    await ctx.db.patch(canary._id, {
      inboundCanaryActivationState: "external_attempted",
      inboundCanaryActivationExternalAttemptedAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      canary.inboundCanaryActivationLeaseExpiresAt! + 1_000,
      internal.actions.managedOutreachMailbox.activateManagedSesInboundCanary,
      { canaryId: canary._id },
    );
    return { marked: true as const };
  },
});

export const recordManagedSesInboundCanaryActivation = internalMutation({
  args: {
    canaryId: v.id("managed_ses_event_canaries"),
    leaseToken: v.string(),
    state: v.union(v.literal("verified"), v.literal("unverified")),
    operationKey: v.optional(v.string()),
    resourceOperationKey: v.optional(v.string()),
    generation: v.optional(v.number()),
    adapterVersion: v.optional(v.string()),
    inboxBinding: v.optional(v.string()),
    relayConfigurationHash: v.optional(v.string()),
    retentionPolicyHash: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    inboundCanaryReceipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const canary = await ctx.db.get(args.canaryId);
    const timestamp = Date.now();
    if (
      !canary ||
      (args.state === "verified"
        ? canary.inboundCanaryActivationState !== "external_attempted"
        : !["claimed", "external_attempted"].includes(
            canary.inboundCanaryActivationState ?? "",
          )) ||
      canary.inboundCanaryActivationLeaseToken !== args.leaseToken
    ) return { recorded: false as const };
    if (args.state === "unverified") {
      await ctx.db.patch(canary._id, {
        inboundCanaryActivationState: "unverified",
        inboundCanaryActivationLeaseToken: undefined,
        inboundCanaryActivationLeaseExpiresAt: undefined,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAfter(
        15 * 60 * 1000,
        internal.actions.managedOutreachMailbox.activateManagedSesInboundCanary,
        { canaryId: canary._id },
      );
      return { recorded: true as const, verified: false as const };
    }
    const [resource, inbox, site, request] = await Promise.all([
      ctx.db.get(canary.resourceId),
      ctx.db.get(canary.inboxId),
      ctx.db.get(canary.siteId),
      ctx.db.get(canary.resourceId).then((row) =>
        row ? ctx.db.get(row.requestId) : null
      ),
    ]);
    const runtime = {
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
      retentionAudited:
        process.env.OUTREACH_INBOUND_RELAY_RETENTION_AUDITED,
    };
    const relayConfigurationHash = inboundRelayConfigurationHash(runtime);
    if (
      !resource ||
      !inbox ||
      !site ||
      !request ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      requestFenceIssues({
        request,
        site,
        expectedConfigurationRevision:
          resource.requestConfigurationRevision,
        expectedGeneration: resource.generation,
      }).length > 0 ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      resource.lifecycleState !== "canonicalized" ||
      resource.releaseState !== "active" ||
      resource.canonicalInboxId !== inbox._id ||
      resource.operationKey !== canary.resourceOperationKey ||
      resource.generation !== canary.generation ||
      resource.adapterVersion !== canary.adapterVersion ||
      resource.ownerAccountKey !== request.ownerAccountKey ||
      inbox.siteId !== site._id ||
      inbox.provider !== MANAGED_SES_TRANSPORT ||
      inbox.credentialSource !== "managed_adapter" ||
      inbox.credentialOwnerAccountKey !== resource.ownerAccountKey ||
      inbox.managedTransportOperationKey !== resource.operationKey ||
      inbox.managedTransportGeneration !== resource.generation ||
      inbox.managedTransportAdapterVersion !== resource.adapterVersion ||
      (inbox.configurationVersion ?? 0) !==
        canary.inboxConfigurationVersion ||
      request.outreachMailbox.mode !== "managed" ||
      request.outreachMailboxGeneration !== resource.generation ||
      canary.status !== "delivered" ||
      !canary.eventReceipt ||
      !canary.verifiedAt ||
      !canary.inboundCanaryEventKey ||
      !canary.inboundCanaryEvidenceHash ||
      !canary.inboundCanarySettledAt ||
      !canary.inboundCanaryActivationExternalAttemptedAt ||
      (canary.inboundCanaryActivationLeaseExpiresAt ?? 0) <= timestamp ||
      args.operationKey !== canary.operationKey ||
      args.resourceOperationKey !== canary.resourceOperationKey ||
      args.generation !== canary.generation ||
      args.adapterVersion !== canary.adapterVersion ||
      args.inboxBinding !== canary.inboundCanaryInboxBinding ||
      !relayConfigurationHash ||
      args.relayConfigurationHash !== relayConfigurationHash ||
      args.relayConfigurationHash !==
        canary.inboundRelayConfigurationHash ||
      args.retentionPolicyHash !== runtime.retentionPolicyHash ||
      args.retentionPolicyHash !==
        canary.inboundRelayRetentionPolicyHash ||
      !Number.isSafeInteger(args.verifiedAt) ||
      args.verifiedAt !==
        Math.floor(canary.inboundCanarySettledAt / 1_000) ||
      !/^[a-f0-9]{64}$/.test(args.inboundCanaryReceipt ?? "") ||
      args.verifiedAt! * 1_000 > timestamp + 5 * 60 * 1000 ||
      args.verifiedAt! * 1_000 < canary.issuedAt - 60_000
    ) throw new Error("Managed inbound activation crossed a binding");
    const verifiedAt = args.verifiedAt! * 1_000;
    await ctx.db.patch(canary._id, {
      inboundCanaryActivationState: "verified",
      inboundCanaryActivationLeaseToken: undefined,
      inboundCanaryActivationLeaseExpiresAt: undefined,
      inboundCanaryReceipt: args.inboundCanaryReceipt,
      inboundCanaryVerifiedAt: verifiedAt,
      updatedAt: timestamp,
    });
    await ctx.db.patch(inbox._id, {
      managedTransportInboundCanaryVerifiedAt: verifiedAt,
      managedTransportInboundCanaryReceipt: args.inboundCanaryReceipt,
      managedTransportInboundCanaryOperationKey: canary.operationKey,
      managedTransportInboundCanaryInboxBinding:
        canary.inboundCanaryInboxBinding,
      managedTransportInboundCanaryRelayConfigurationHash:
        relayConfigurationHash,
      managedTransportInboundCanaryAdapterVersion: canary.adapterVersion,
      managedTransportInboundCanaryRetentionPolicyHash:
        runtime.retentionPolicyHash,
      lastError: undefined,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.managedProvisioning.dispatchRequest,
      { requestId: request._id, expectedRevision: request.revision },
    );
    // Re-prove the exact outbound event and reply/STOP path before this
    // finite receipt expires. The claimant is idempotent and fully fenced.
    await ctx.scheduler.runAt(
      Math.max(
        timestamp,
        verifiedAt + MANAGED_SES_EVENT_CANARY_VALID_MS -
          MANAGED_SES_EVENT_CANARY_REFRESH_LEAD_MS,
      ),
      internal.actions.managedOutreachMailbox.sendManagedSesEventCanary,
      { resourceId: resource._id, inboxId: inbox._id },
    );
    return { recorded: true as const, verified: true as const };
  },
});

type ManagedSesDispositionTarget =
  | { kind: "message"; row: Doc<"outreach_messages"> }
  | { kind: "canary"; row: Doc<"managed_ses_event_canaries"> };

async function managedSesDispositionTarget(
  ctx: QueryCtx,
  resource: ManagedResource,
  operationKey: string,
): Promise<ManagedSesDispositionTarget | null> {
  const [message, canary] = await Promise.all([
    ctx.db
      .query("outreach_messages")
      .withIndex("by_managed_ses_operation", (q) =>
        q.eq("managedSesOperationKey", operationKey)
      )
      .unique(),
    ctx.db
      .query("managed_ses_event_canaries")
      .withIndex("by_operation", (q) => q.eq("operationKey", operationKey))
      .unique(),
  ]);
  if (Boolean(message) === Boolean(canary)) return null;
  if (
    message &&
    message.inboxId === resource.canonicalInboxId &&
    message.deliveryTransport === MANAGED_SES_TRANSPORT &&
    message.status === "delivery_unverified" &&
    message.managedSesResourceOperationKey === resource.operationKey &&
    message.managedSesGeneration === resource.generation &&
    message.managedSesAdapterVersion === resource.adapterVersion
  ) return { kind: "message", row: message };
  if (
    canary &&
    canary.resourceId === resource._id &&
    canary.inboxId === resource.canonicalInboxId &&
    canary.status === "unverified" &&
    canary.resourceOperationKey === resource.operationKey &&
    canary.generation === resource.generation &&
    canary.adapterVersion === resource.adapterVersion
  ) return { kind: "canary", row: canary };
  return null;
}

async function managedSesDispositionFence(
  ctx: QueryCtx,
  resource: ManagedResource,
): Promise<"active" | "release" | null> {
  const [request, site] = await Promise.all([
    ctx.db.get(resource.requestId),
    ctx.db.get(resource.siteId),
  ]);
  if (
    resource.lifecycleState === "canonicalized" &&
    resource.releaseState === "active" &&
    request &&
    site &&
    (await siteExecutionAuthorized(ctx, site)) &&
    requestFenceIssues({
      request,
      site,
      expectedConfigurationRevision: resource.requestConfigurationRevision,
      expectedGeneration: resource.generation,
    }).length === 0 &&
    resource.requestId === request._id &&
    resource.siteId === request.siteId &&
    resource.ownerAccountKey === request.ownerAccountKey &&
    resource.domainSnapshot === request.domainSnapshot &&
    resource.domainRevisionSnapshot === request.domainRevisionSnapshot &&
    resource.requestContractVersion === request.contractVersion
  ) return "active";
  if (
    resource.lifecycleState === "cancelled" &&
    ["requested", "blocked"].includes(resource.releaseState) &&
    (await releaseFenceAllows(ctx, { resource, request, site }))
  ) return "release";
  return null;
}

async function claimEligibleManagedSesDisposition(
  ctx: MutationCtx,
  resource: ManagedResource,
  timestamp: number,
): Promise<boolean> {
  if (
    resource.transportKind !== MANAGED_SES_TRANSPORT ||
    !resource.canonicalInboxId ||
    !resource.adapterVersion ||
    !(await managedSesDispositionFence(ctx, resource))
  ) return false;
  const dueBefore = timestamp - MANAGED_SES_AMBIGUOUS_DISPOSITION_MS;
  const [message, canary] = await Promise.all([
    ctx.db
      .query("outreach_messages")
      .withIndex("by_managed_resource_disposition_due", (q) =>
        q.eq("managedSesResourceOperationKey", resource.operationKey)
          .eq("status", "delivery_unverified")
          .eq("managedSesDispositionSettledAt", undefined)
          .lte("managedSesExternalAttemptedAt", dueBefore)
      )
      .first(),
    ctx.db
      .query("managed_ses_event_canaries")
      .withIndex("by_resource_disposition_due", (q) =>
        q.eq("resourceOperationKey", resource.operationKey)
          .eq("status", "unverified")
          .eq("dispositionSettledAt", undefined)
          .lte("externalAttemptedAt", dueBefore)
      )
      .first(),
  ]);
  const candidates = [
    ...(message
      ? [message]
      : [])
      .filter((row) =>
        row.deliveryTransport === MANAGED_SES_TRANSPORT &&
        row.managedSesResourceOperationKey === resource.operationKey &&
        row.managedSesGeneration === resource.generation &&
        row.managedSesAdapterVersion === resource.adapterVersion &&
        Boolean(row.managedSesExternalAttemptedAt) &&
        timestamp >= row.managedSesExternalAttemptedAt! +
          MANAGED_SES_AMBIGUOUS_DISPOSITION_MS &&
        (row.managedSesDispositionLeaseExpiresAt ?? 0) <= timestamp
      )
      .map((row) => ({
        kind: "message" as const,
        row,
        attemptedAt: row.managedSesExternalAttemptedAt!,
      })),
    ...(canary ? [canary] : [])
      .filter((row) =>
        row.resourceId === resource._id &&
        row.resourceOperationKey === resource.operationKey &&
        row.generation === resource.generation &&
        row.adapterVersion === resource.adapterVersion &&
        Boolean(row.externalAttemptedAt) &&
        timestamp >= row.externalAttemptedAt! +
          MANAGED_SES_AMBIGUOUS_DISPOSITION_MS &&
        (row.dispositionLeaseExpiresAt ?? 0) <= timestamp
      )
      .map((row) => ({
        kind: "canary" as const,
        row,
        attemptedAt: row.externalAttemptedAt!,
      })),
  ].sort((a, b) => a.attemptedAt - b.attemptedAt);
  const target = candidates[0];
  if (!target) return false;
  const operationKey = target.kind === "message"
    ? target.row.managedSesOperationKey!
    : target.row.operationKey;
  const leaseToken = sha256Hex(
    `managed-ses-disposition:v1:${resource.operationKey}:${operationKey}:${timestamp}`,
  );
  const leaseExpiresAt = timestamp + MANAGED_SES_DISPOSITION_LEASE_MS;
  if (target.kind === "message") {
    await ctx.db.patch(target.row._id, {
      managedSesDispositionState: "claimed",
      managedSesDispositionLeaseToken: leaseToken,
      managedSesDispositionLeaseExpiresAt: leaseExpiresAt,
      updatedAt: timestamp,
    });
  } else {
    await ctx.db.patch(target.row._id, {
      dispositionState: "claimed",
      dispositionLeaseToken: leaseToken,
      dispositionLeaseExpiresAt: leaseExpiresAt,
      updatedAt: timestamp,
    });
  }
  await ctx.scheduler.runAt(
    leaseExpiresAt + 1_000,
    internal.managedOutreachMailbox.recoverManagedSesDispositionLease,
    {
      resourceId: resource._id,
      operationKey,
      leaseToken,
    },
  );
  await ctx.scheduler.runAfter(
    0,
    internal.actions.managedOutreachMailbox.disposeManagedSesAmbiguity,
    { resourceId: resource._id, operationKey, leaseToken },
  );
  return true;
}

/** A live managed resource reconciles every ambiguous external attempt at the
 * same finite +72h boundary as retirement. This prevents one lost response
 * from blocking the mailbox forever while preserving the immutable no-replay
 * operation. */
export const claimManagedSesAmbiguityReconciliation = internalMutation({
  args: { resourceId: v.id("managed_outreach_mailbox_resources") },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) return { claimed: false as const, reason: "missing" as const };
    const claimed = await claimEligibleManagedSesDisposition(
      ctx,
      resource,
      Date.now(),
    );
    return {
      claimed,
      reason: claimed ? "claimed" as const : "not_due_or_fenced" as const,
    };
  },
});

export const getManagedSesDispositionOperation = internalQuery({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    operationKey: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    const timestamp = Date.now();
    if (
      !resource ||
      resource.transportKind !== MANAGED_SES_TRANSPORT ||
      !resource.adapterVersion
    ) return null;
    const lifecycleMode = await managedSesDispositionFence(ctx, resource);
    if (!lifecycleMode) return null;
    const target = await managedSesDispositionTarget(
      ctx,
      resource,
      args.operationKey,
    );
    if (!target) return null;
    const claimed = target.kind === "message"
      ? target.row.managedSesDispositionState === "claimed" &&
        target.row.managedSesDispositionLeaseToken === args.leaseToken &&
        (target.row.managedSesDispositionLeaseExpiresAt ?? 0) > timestamp
      : target.row.dispositionState === "claimed" &&
        target.row.dispositionLeaseToken === args.leaseToken &&
        (target.row.dispositionLeaseExpiresAt ?? 0) > timestamp;
    if (!claimed) return null;
    const attemptedAt = target.kind === "message"
      ? target.row.managedSesExternalAttemptedAt
      : target.row.externalAttemptedAt;
    if (
      !attemptedAt ||
      timestamp < attemptedAt + MANAGED_SES_AMBIGUOUS_DISPOSITION_MS
    ) return null;
    return {
      kind: target.kind,
      operationKey: args.operationKey,
      resourceOperationKey: resource.operationKey,
      generation: resource.generation,
      adapterVersion: resource.adapterVersion,
      sequenceStep: target.kind === "message" ? target.row.sequenceStep : 0,
      purpose: target.kind === "message"
        ? "outreach" as const
        : "inbound_relay_canary" as const,
      providerMessageIdDigest: target.kind === "message"
        ? target.row.managedSesProviderMessageIdDigest
        : target.row.providerMessageIdDigest,
      rfcMessageIdDigest: target.kind === "message"
        ? target.row.inboundRelayOutboundMessageIdHash
        : target.row.rfcMessageIdDigest,
      threadReceipt: target.kind === "message"
        ? target.row.managedSesThreadReceipt
        : target.row.threadReceipt,
      lifecycleMode,
    };
  },
});

export const markManagedSesDispositionExternalBoundary = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    operationKey: v.string(),
    leaseToken: v.string(),
    authorizedAt: v.number(),
    authorizationReceipt: v.string(),
    providerMessageIdDigest: v.optional(v.string()),
    rfcMessageIdDigest: v.optional(v.string()),
    threadReceipt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    const timestamp = Date.now();
    if (
      !resource ||
      Math.abs(Math.floor(timestamp / 1_000) - args.authorizedAt) > 5 * 60 ||
      !/^[a-f0-9]{64}$/.test(args.authorizationReceipt)
    ) return { marked: false as const };
    if (!(await managedSesDispositionFence(ctx, resource))) {
      return { marked: false as const };
    }
    const target = await managedSesDispositionTarget(
      ctx,
      resource,
      args.operationKey,
    );
    if (!target) return { marked: false as const };
    const leaseMatches = target.kind === "message"
      ? target.row.managedSesDispositionState === "claimed" &&
        target.row.managedSesDispositionLeaseToken === args.leaseToken &&
        (target.row.managedSesDispositionLeaseExpiresAt ?? 0) > timestamp
      : target.row.dispositionState === "claimed" &&
        target.row.dispositionLeaseToken === args.leaseToken &&
        (target.row.dispositionLeaseExpiresAt ?? 0) > timestamp;
    const establishedProviderMessageIdDigest = target.kind === "message"
      ? target.row.managedSesProviderMessageIdDigest
      : target.row.providerMessageIdDigest;
    const establishedRfcMessageIdDigest = target.kind === "message"
      ? target.row.inboundRelayOutboundMessageIdHash
      : target.row.rfcMessageIdDigest;
    const establishedThreadReceipt = target.kind === "message"
      ? target.row.managedSesThreadReceipt
      : target.row.threadReceipt;
    const establishedIdentityCount = [
      establishedProviderMessageIdDigest,
      establishedRfcMessageIdDigest,
      establishedThreadReceipt,
    ].filter((value) => value !== undefined).length;
    const suppliedIdentityCount = [
      args.providerMessageIdDigest,
      args.rfcMessageIdDigest,
      args.threadReceipt,
    ].filter((value) => value !== undefined).length;
    if (
      !leaseMatches ||
      ![0, 3].includes(establishedIdentityCount) ||
      ![0, 3].includes(suppliedIdentityCount) ||
      (args.providerMessageIdDigest !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.providerMessageIdDigest)) ||
      (args.rfcMessageIdDigest !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.rfcMessageIdDigest)) ||
      (args.threadReceipt !== undefined &&
        !/^[A-Za-z0-9_-]{32,96}$/.test(args.threadReceipt)) ||
      (establishedIdentityCount > 0 &&
        (suppliedIdentityCount !== 3 ||
          !managedSesIdentityTupleMatchesEstablished({
            establishedProviderMessageIdDigest,
            establishedRfcMessageIdDigest,
            establishedThreadReceipt,
            providerMessageIdDigest: args.providerMessageIdDigest,
            rfcMessageIdDigest: args.rfcMessageIdDigest,
            threadReceipt: args.threadReceipt,
          })))
    ) return { marked: false as const };
    if (target.kind === "message") {
      await ctx.db.patch(target.row._id, {
        managedSesDispositionState: "external_attempted",
        managedSesDispositionAuthorizedAt: args.authorizedAt * 1_000,
        managedSesDispositionAuthorizationReceipt: args.authorizationReceipt,
        managedSesDispositionExternalAttemptedAt: timestamp,
        ...(args.providerMessageIdDigest
          ? { managedSesProviderMessageIdDigest: args.providerMessageIdDigest }
          : {}),
        ...(args.rfcMessageIdDigest
          ? { inboundRelayOutboundMessageIdHash: args.rfcMessageIdDigest }
          : {}),
        ...(args.threadReceipt
          ? { managedSesThreadReceipt: args.threadReceipt }
          : {}),
        updatedAt: timestamp,
      });
    } else {
      await ctx.db.patch(target.row._id, {
        dispositionState: "external_attempted",
        dispositionAuthorizedAt: args.authorizedAt * 1_000,
        dispositionAuthorizationReceipt: args.authorizationReceipt,
        dispositionExternalAttemptedAt: timestamp,
        ...(args.providerMessageIdDigest
          ? { providerMessageIdDigest: args.providerMessageIdDigest }
          : {}),
        ...(args.rfcMessageIdDigest
          ? { rfcMessageIdDigest: args.rfcMessageIdDigest }
          : {}),
        ...(args.threadReceipt
          ? { threadReceipt: args.threadReceipt }
          : {}),
        updatedAt: timestamp,
      });
    }
    await ctx.scheduler.runAt(
      (target.kind === "message"
        ? target.row.managedSesDispositionLeaseExpiresAt!
        : target.row.dispositionLeaseExpiresAt!) + 1_000,
      internal.managedOutreachMailbox.recoverManagedSesDispositionLease,
      {
        resourceId: resource._id,
        operationKey: args.operationKey,
        leaseToken: args.leaseToken,
      },
    );
    return { marked: true as const };
  },
});

/** Reclaims only the exact ambiguity whose disposition action died after its
 * external boundary. A generic resource scan could select a different row. */
export const recoverManagedSesDispositionLease = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    operationKey: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    const timestamp = Date.now();
    if (!resource || !(await managedSesDispositionFence(ctx, resource))) {
      return { recovered: false as const };
    }
    const target = await managedSesDispositionTarget(
      ctx,
      resource,
      args.operationKey,
    );
    if (!target) return { recovered: false as const };
    const exactExpired = target.kind === "message"
      ? ["claimed", "external_attempted"].includes(
          target.row.managedSesDispositionState ?? "",
        ) &&
        target.row.managedSesDispositionLeaseToken === args.leaseToken &&
        (target.row.managedSesDispositionLeaseExpiresAt ?? 0) <= timestamp
      : ["claimed", "external_attempted"].includes(
          target.row.dispositionState ?? "",
        ) &&
        target.row.dispositionLeaseToken === args.leaseToken &&
        (target.row.dispositionLeaseExpiresAt ?? 0) <= timestamp;
    if (!exactExpired) return { recovered: false as const };
    const nextLeaseToken = sha256Hex(
      `managed-ses-disposition-recovery:v1:${resource.operationKey}:${args.operationKey}:${timestamp}`,
    );
    const nextLeaseExpiresAt = timestamp + MANAGED_SES_DISPOSITION_LEASE_MS;
    if (target.kind === "message") {
      await ctx.db.patch(target.row._id, {
        managedSesDispositionState: "claimed",
        managedSesDispositionLeaseToken: nextLeaseToken,
        managedSesDispositionLeaseExpiresAt: nextLeaseExpiresAt,
        updatedAt: timestamp,
      });
    } else {
      await ctx.db.patch(target.row._id, {
        dispositionState: "claimed",
        dispositionLeaseToken: nextLeaseToken,
        dispositionLeaseExpiresAt: nextLeaseExpiresAt,
        updatedAt: timestamp,
      });
    }
    await ctx.scheduler.runAt(
      nextLeaseExpiresAt + 1_000,
      internal.managedOutreachMailbox.recoverManagedSesDispositionLease,
      {
        resourceId: resource._id,
        operationKey: args.operationKey,
        leaseToken: nextLeaseToken,
      },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.actions.managedOutreachMailbox.disposeManagedSesAmbiguity,
      {
        resourceId: resource._id,
        operationKey: args.operationKey,
        leaseToken: nextLeaseToken,
      },
    );
    return { recovered: true as const };
  },
});

async function quarantineManagedSesCanaryIdentityMismatch(
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

export const recordManagedSesDispositionOutcome = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    operationKey: v.string(),
    leaseToken: v.string(),
    state: v.string(),
    providerMessageIdDigest: v.optional(v.string()),
    rfcMessageIdDigest: v.optional(v.string()),
    threadReceipt: v.optional(v.string()),
    receiptUpdatedAt: v.optional(v.number()),
    retryAfterSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    const timestamp = Date.now();
    if (
      !resource ||
      !(await managedSesDispositionFence(ctx, resource))
    ) return { recorded: false as const };
    const lifecycleMode = await managedSesDispositionFence(ctx, resource);
    if (!lifecycleMode) return { recorded: false as const };
    const target = await managedSesDispositionTarget(
      ctx,
      resource,
      args.operationKey,
    );
    if (!target) return { recorded: false as const };
    const leaseMatches = target.kind === "message"
      ? target.row.managedSesDispositionLeaseToken === args.leaseToken &&
        ["claimed", "external_attempted"].includes(
          target.row.managedSesDispositionState ?? "",
        )
      : target.row.dispositionLeaseToken === args.leaseToken &&
        ["claimed", "external_attempted"].includes(
          target.row.dispositionState ?? "",
        );
    if (
      !leaseMatches ||
      (args.providerMessageIdDigest !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.providerMessageIdDigest)) ||
      (args.rfcMessageIdDigest !== undefined &&
        !/^[a-f0-9]{64}$/.test(args.rfcMessageIdDigest)) ||
      (args.threadReceipt !== undefined &&
        !/^[A-Za-z0-9_-]{32,96}$/.test(args.threadReceipt)) ||
      (args.receiptUpdatedAt !== undefined &&
        (!Number.isSafeInteger(args.receiptUpdatedAt) ||
          args.receiptUpdatedAt <= 0 ||
          args.receiptUpdatedAt > Math.floor(timestamp / 1_000) + 5 * 60))
    ) return { recorded: false as const };
    const establishedProviderMessageIdDigest = target.kind === "message"
      ? target.row.managedSesProviderMessageIdDigest
      : target.row.providerMessageIdDigest;
    const establishedRfcMessageIdDigest = target.kind === "message"
      ? target.row.inboundRelayOutboundMessageIdHash
      : target.row.rfcMessageIdDigest;
    const establishedThreadReceipt = target.kind === "message"
      ? target.row.managedSesThreadReceipt
      : target.row.threadReceipt;
    const hasEstablishedIdentity = Boolean(
      establishedProviderMessageIdDigest ||
      establishedRfcMessageIdDigest ||
      establishedThreadReceipt
    );
    const suppliedIdentityCount = [
      args.providerMessageIdDigest,
      args.rfcMessageIdDigest,
      args.threadReceipt,
    ].filter((value) => value !== undefined).length;
    const identityMismatch =
      args.state === "identity_mismatch" ||
      (args.state === "missing" && hasEstablishedIdentity) ||
      (suppliedIdentityCount > 0 &&
        (suppliedIdentityCount !== 3 ||
          !managedSesIdentityTupleMatchesEstablished({
            establishedProviderMessageIdDigest,
            establishedRfcMessageIdDigest,
            establishedThreadReceipt,
            providerMessageIdDigest: args.providerMessageIdDigest,
            rfcMessageIdDigest: args.rfcMessageIdDigest,
            threadReceipt: args.threadReceipt,
          })));
    const settled = identityMismatch || [
      "missing",
      "submitted",
      "quarantined_no_replay",
      "quarantined_integrity",
      "terminal_rejected",
    ].includes(args.state);
    const state = identityMismatch
      ? "quarantined_integrity"
      : settled ? args.state : "retry_wait";
    // `event_confirmed` is transport state, not semantic acceptance: the
    // underlying event may be a bounce, complaint, rejection, or rendering
    // failure. Only `submitted` alone proves an accepted send here. Semantic
    // terminal events settle through their exact signed event receipt.
    const accepted = !identityMismatch && args.state === "submitted";
    let followUpQueued = false;
    if (target.kind === "message") {
      if (identityMismatch) {
        await quarantineManagedSesMessageIdentityMismatch(
          ctx,
          target.row,
          timestamp,
        );
      } else if (accepted) {
        if (
          !args.providerMessageIdDigest ||
          !args.rfcMessageIdDigest ||
          !args.threadReceipt ||
          !args.receiptUpdatedAt
        ) return { recorded: false as const };
        // This shared helper atomically invokes settleAcceptedDeliveryCounter
        // and queueNextVerifiedAutonomousFollowUp before disposition is sealed.
        const acceptance = await settleManagedSesAcceptedMessage(ctx, {
          message: target.row,
          providerMessageIdDigest: args.providerMessageIdDigest,
          rfcMessageIdDigest: args.rfcMessageIdDigest,
          threadReceipt: args.threadReceipt,
          acceptedAt: args.receiptUpdatedAt * 1_000,
        });
        if (!acceptance.settled) return { recorded: false as const };
        followUpQueued = acceptance.followUpQueued;
      } else if (settled) {
        const releaseContact = ["missing", "terminal_rejected"].includes(
          args.state,
        );
        await ctx.db.patch(target.row._id, {
          status: "failed",
          failureReason: [
              "event_confirmed",
              "event_confirmed_after_disposition",
            ].includes(args.state)
            ? "The provider recorded an event, but its signed semantic webhook has not settled; this operation remains no-replay."
            : args.state === "quarantined_integrity"
            ? "The managed sender quarantined an integrity mismatch; this recipient claim remains no-replay."
            : args.state === "quarantined_no_replay"
              ? "The managed sender quarantined an ambiguous attempt; this recipient claim remains no-replay."
              : "The managed sender proved the ambiguous operation was not accepted.",
          updatedAt: timestamp,
        });
        if (
          releaseContact &&
          target.row.deliveryOwnerAccountKey &&
          target.row.deliveryAttemptId
        ) {
          await releaseDurableContactClaimForAccount(
            ctx,
            target.row.deliveryOwnerAccountKey,
            target.row.toDomain,
            target.row.deliveryAttemptId,
            timestamp,
          );
        }
      }
      if (!identityMismatch) {
        await ctx.db.patch(target.row._id, {
          managedSesDispositionState: state,
          managedSesProviderMessageIdDigest:
            args.providerMessageIdDigest ??
            target.row.managedSesProviderMessageIdDigest,
          ...(args.rfcMessageIdDigest
            ? { inboundRelayOutboundMessageIdHash: args.rfcMessageIdDigest }
            : {}),
          ...(args.threadReceipt
            ? { managedSesThreadReceipt: args.threadReceipt }
            : {}),
          managedSesDispositionLeaseToken: undefined,
          managedSesDispositionLeaseExpiresAt: undefined,
          managedSesDispositionSettledAt: settled ? timestamp : undefined,
          updatedAt: timestamp,
        });
      }
    } else {
      if (identityMismatch) {
        await quarantineManagedSesCanaryIdentityMismatch(
          ctx,
          target.row,
          timestamp,
        );
      } else {
        await ctx.db.patch(target.row._id, {
          status: accepted
            ? "accepted"
            : settled ? "failed" : target.row.status,
          dispositionState: state,
          providerMessageIdDigest:
            args.providerMessageIdDigest ?? target.row.providerMessageIdDigest,
          rfcMessageIdDigest:
            args.rfcMessageIdDigest ?? target.row.rfcMessageIdDigest,
          threadReceipt: args.threadReceipt ?? target.row.threadReceipt,
          dispositionLeaseToken: undefined,
          dispositionLeaseExpiresAt: undefined,
          dispositionSettledAt: settled ? timestamp : undefined,
          updatedAt: timestamp,
        });
      }
    }
    const retryAfterSeconds = settled
      ? 0
      : Math.max(30, Math.min(15 * 60, args.retryAfterSeconds ?? 120));
    if (lifecycleMode === "release") {
      await ctx.db.patch(resource._id, {
        releaseState: "blocked",
        nextAttemptAt: timestamp + retryAfterSeconds * 1_000,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAfter(
        retryAfterSeconds * 1_000,
        internal.managedOutreachMailbox.claimRelease,
        { resourceId: resource._id },
      );
    } else if (!settled) {
      await ctx.scheduler.runAfter(
        retryAfterSeconds * 1_000,
        internal.managedOutreachMailbox.claimManagedSesAmbiguityReconciliation,
        { resourceId: resource._id },
      );
    }
    return { recorded: true as const, settled, state, followUpQueued };
  },
});

export const claimRelease = internalMutation({
  args: { resourceId: v.id("managed_outreach_mailbox_resources") },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    if (!resource) return { claimed: false as const, reason: "missing" as const };
    const timestamp = Date.now();
    const tombstone = await releaseTombstoneForOperation(
      ctx,
      resource.operationKey,
    );
    if (
      !tombstone ||
      tombstone.state === "released" ||
      tombstone.state === "not_required" ||
      resource.releaseState === "released"
    ) return { claimed: false as const, reason: "already_settled" as const };
    if (
      resource.releaseState === "leased" &&
      (resource.leaseExpiresAt ?? 0) > timestamp
    ) return { claimed: false as const, reason: "lease_live" as const };
    if ((resource.nextAttemptAt ?? 0) > timestamp) {
      return { claimed: false as const, reason: "not_due" as const };
    }
    const [request, site] = await Promise.all([
      ctx.db.get(resource.requestId),
      ctx.db.get(resource.siteId),
    ]);
    if (!(await releaseFenceAllows(ctx, { resource, request, site }))) {
      return { claimed: false as const, reason: "release_not_authorized" as const };
    }
    await quarantineManagedCanonicalInbox(
      ctx,
      resource,
      timestamp,
      resource.releaseReason ?? tombstone.releaseReason,
    );
    await terminalizeExpiredManagedDeliveryLeases(ctx, resource, timestamp);
    await claimEligibleManagedSesDisposition(ctx, resource, timestamp);
    const blocker = await managedReleaseBlocker(ctx, resource, timestamp);
    if (blocker) {
      await ctx.db.patch(resource._id, {
        releaseState: "blocked",
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        nextAttemptAt: blocker.nextAttemptAt,
        lastReasonCode: blocker.reasonCode,
        updatedAt: timestamp,
      });
      await ctx.db.patch(tombstone._id, {
        state: "blocked",
        lastReasonCode: blocker.reasonCode,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAt(
        blocker.nextAttemptAt,
        internal.managedOutreachMailbox.claimRelease,
        { resourceId: resource._id },
      );
      return { claimed: false as const, reason: blocker.reasonCode };
    }
    const attempt = resource.attempt + 1;
    const leaseExpiresAt = timestamp + MANAGED_OUTREACH_MAILBOX_LEASE_MS;
    const leaseToken = sha256Hex(
      `managed-mailbox-release:v1:${resource.operationKey}:${attempt}:${timestamp}`,
    );
    await ctx.db.patch(resource._id, {
      releaseState: "leased",
      attempt,
      leaseToken,
      leaseExpiresAt,
      nextAttemptAt: leaseExpiresAt,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(0, internal.actions.managedOutreachMailbox.release, {
      resourceId: resource._id,
      leaseToken,
    });
    await ctx.scheduler.runAt(
      leaseExpiresAt + 1_000,
      internal.managedOutreachMailbox.claimRelease,
      { resourceId: resource._id },
    );
    return { claimed: true as const, leaseExpiresAt };
  },
});

export const getReleaseOperation = internalQuery({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    leaseToken: v.string(),
  },
  handler: async (ctx, args): Promise<{
    operation: ManagedOutreachMailboxReleaseOperation;
  } | null> => {
    const resource = await ctx.db.get(args.resourceId);
    const timestamp = Date.now();
    if (
      !resource ||
      resource.lifecycleState !== "cancelled" ||
      resource.releaseState !== "leased" ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      })
    ) return null;
    const [tombstone, request, site] = await Promise.all([
      releaseTombstoneForOperation(ctx, resource.operationKey),
      ctx.db.get(resource.requestId),
      ctx.db.get(resource.siteId),
    ]);
    if (
      !tombstone ||
      !["release_requested", "blocked"].includes(tombstone.state) ||
      !(await releaseFenceAllows(ctx, { resource, request, site })) ||
      await managedReleaseBlocker(ctx, resource, timestamp)
    ) return null;
    return {
      operation: {
        contractVersion: MANAGED_OUTREACH_MAILBOX_CONTRACT_VERSION,
        transport: resource.transportKind === SMARTLEAD_MANAGED_TRANSPORT
          ? SMARTLEAD_MANAGED_TRANSPORT
          : MANAGED_SES_TRANSPORT,
        operationKey: resource.operationKey,
        generation: resource.generation,
        provisioningAdapterVersion: resource.adapterVersion,
        encryptedProviderBinding: resource.encryptedProviderBinding,
        senderDomainChoice: request?.managedOutreachProfile?.senderDomainChoice,
        releaseReason: resource.releaseReason ?? tombstone.releaseReason,
        requirements: {
          reconcileProvisioningStatusByOperationKey: true,
          releaseWinsLateProvision: true,
        },
      },
    };
  },
});

export const recordReleaseAdapterBlocked = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    leaseToken: v.string(),
    reasonCode: v.union(
      v.literal(MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE),
      v.literal(MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED),
    ),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    const timestamp = Date.now();
    if (
      !resource ||
      resource.lifecycleState !== "cancelled" ||
      resource.releaseState !== "leased" ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      })
    ) return { recorded: false as const };
    const [tombstone, request, site] = await Promise.all([
      releaseTombstoneForOperation(ctx, resource.operationKey),
      ctx.db.get(resource.requestId),
      ctx.db.get(resource.siteId),
    ]);
    if (
      !tombstone ||
      !["release_requested", "blocked"].includes(tombstone.state) ||
      !(await releaseFenceAllows(ctx, { resource, request, site }))
    ) return { recorded: false as const };
    const nextAttemptAt = timestamp + RELEASE_RETRY_MS;
    await ctx.db.patch(resource._id, {
      releaseState: "blocked",
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt,
      lastReasonCode: args.reasonCode,
      updatedAt: timestamp,
    });
    await ctx.db.patch(tombstone._id, {
      state: "blocked",
      lastReasonCode: args.reasonCode,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.managedOutreachMailbox.claimRelease,
      { resourceId: resource._id },
    );
    return { recorded: true as const, nextAttemptAt };
  },
});

export const recordReleaseAdapterProgress = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    leaseToken: v.string(),
    adapterVersion: v.string(),
    reasonCode: v.string(),
    retryAfterSeconds: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    const timestamp = Date.now();
    if (
      !resource ||
      ![MANAGED_SES_TRANSPORT, SMARTLEAD_MANAGED_TRANSPORT].includes(
        resource.transportKind as typeof MANAGED_SES_TRANSPORT | typeof SMARTLEAD_MANAGED_TRANSPORT,
      ) ||
      resource.lifecycleState !== "cancelled" ||
      resource.releaseState !== "leased" ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      }) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(args.adapterVersion) ||
      !/^[a-z][a-z0-9_]{1,63}$/.test(args.reasonCode)
    ) return { recorded: false as const };
    const tombstone = await releaseTombstoneForOperation(
      ctx,
      resource.operationKey,
    );
    if (!tombstone || tombstone.state === "released") {
      return { recorded: false as const };
    }
    const retryAfterSeconds = Math.max(
      30,
      Math.min(15 * 60, Math.floor(args.retryAfterSeconds ?? 120)),
    );
    const nextAttemptAt = timestamp + retryAfterSeconds * 1_000;
    await ctx.db.patch(resource._id, {
      releaseState: "blocked",
      adapterVersion: args.adapterVersion,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt,
      lastReasonCode: args.reasonCode,
      updatedAt: timestamp,
    });
    await ctx.db.patch(tombstone._id, {
      state: "blocked",
      adapterVersion: args.adapterVersion,
      lastReasonCode: args.reasonCode,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.managedOutreachMailbox.claimRelease,
      { resourceId: resource._id },
    );
    return { recorded: true as const, nextAttemptAt };
  },
});

/** Future adapter implementations may seal release only through this exact
 * lease mutation. The current Node stub never calls it. */
export const recordReleaseCompletedInternal = internalMutation({
  args: {
    resourceId: v.id("managed_outreach_mailbox_resources"),
    leaseToken: v.string(),
    adapterVersion: v.string(),
  },
  handler: async (ctx, args) => {
    const resource = await ctx.db.get(args.resourceId);
    const timestamp = Date.now();
    if (
      !resource ||
      resource.lifecycleState !== "cancelled" ||
      resource.releaseState !== "leased" ||
      !managedOutreachMailboxLeaseIsCurrent({
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: resource.leaseToken,
        leaseExpiresAt: resource.leaseExpiresAt,
        timestamp,
      })
    ) throw new Error("Managed mailbox release lease changed");
    const [tombstone, request, site] = await Promise.all([
      releaseTombstoneForOperation(ctx, resource.operationKey),
      ctx.db.get(resource.requestId),
      ctx.db.get(resource.siteId),
    ]);
    if (
      !tombstone ||
      !["release_requested", "blocked"].includes(tombstone.state) ||
      !(await releaseFenceAllows(ctx, { resource, request, site })) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(args.adapterVersion)
    ) throw new Error("Managed mailbox release fence changed");
    await quarantineManagedCanonicalInbox(
      ctx,
      resource,
      timestamp,
      resource.releaseReason ?? tombstone.releaseReason,
    );
    await terminalizeExpiredManagedDeliveryLeases(ctx, resource, timestamp);
    if (await managedReleaseBlocker(ctx, resource, timestamp)) {
      throw new Error("Managed mailbox release settlement is still pending");
    }
    await ctx.db.patch(tombstone._id, {
      state: "released",
      adapterVersion: args.adapterVersion,
      releasedAt: timestamp,
      lastReasonCode: undefined,
      updatedAt: timestamp,
    });
    await ctx.db.patch(resource._id, {
      lifecycleState: "cancelled",
      releaseState: "released",
      releasedAt: timestamp,
      adapterVersion: args.adapterVersion,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      externalProvisioningSettleAfter: undefined,
      nextAttemptAt: undefined,
      lastReasonCode: undefined,
      updatedAt: timestamp,
    });
    await clearManagedInboxProvenanceAfterRelease(ctx, resource, timestamp);
    if (site?.deletionStatus === "running") {
      await ctx.scheduler.runAfter(
        0,
        internal.sites.continueSiteDeletionInternal,
        { siteId: site._id, stage: Math.max(0, site.deletionStage ?? 0) },
      );
    }
    return { released: true as const, releasedAt: timestamp };
  },
});
