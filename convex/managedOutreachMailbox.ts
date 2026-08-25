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
  MANAGED_OUTREACH_MAILBOX_CONTRACT_VERSION,
  MANAGED_OUTREACH_MAILBOX_LEASE_MS,
  managedOutreachMailboxCanaryReleasePending,
  managedOutreachMailboxLeaseIsCurrent,
  managedOutreachMailboxProfileIssues,
  managedOutreachMailboxReleaseSealed,
  managedOutreachMailboxRequestFenceIssues,
  managedOutreachMailboxVerifiedDeletionSettled,
  type ManagedOutreachMailboxProvisionOperation,
  type ManagedOutreachMailboxReleaseOperation,
} from "./lib/managedOutreachMailbox.ts";
import { sha256Hex } from "./lib/publicationArtifact.ts";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance.ts";
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
  return Boolean(
    inbox &&
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
      !inbox.inboundRelayDsnRoutingVerifiedAt,
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
      inbox.managedTransportAdapterVersion === resource.adapterVersion,
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
  const [sending, claimedCanaries] = await Promise.all([
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
  ]);
  for (const message of sending) {
    if ((message.deliveryLeaseExpiresAt ?? 0) > timestamp) continue;
    await ctx.db.patch(message._id, {
      status: "delivery_unverified",
      deliveryLeaseExpiredAt: timestamp,
      failureReason:
        "The managed sender was retired after its delivery lease expired. This immutable ambiguous attempt will never be replayed.",
      updatedAt: timestamp,
    });
  }
  for (const canary of claimedCanaries) {
    if ((canary.deliveryLeaseExpiresAt ?? 0) > timestamp) continue;
    await ctx.db.patch(canary._id, {
      deliveryStatus: "unverified",
      deliveryLeaseExpiresAt: undefined,
      deliveryFinalizedAt: timestamp,
    });
  }
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
    managedTransportOperationKey: undefined,
    managedTransportGeneration: undefined,
    managedTransportAdapterVersion: undefined,
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
  const [sending, unverified, claimedCanary, acceptedCanary, unverifiedCanary] =
    await Promise.all([
      ctx.db
        .query("outreach_messages")
        .withIndex("by_inbox_status", (q) =>
          q.eq("inboxId", canonicalInboxId).eq("status", "sending")
        )
        .first(),
      ctx.db
        .query("outreach_messages")
        .withIndex("by_inbox_status", (q) =>
          q.eq("inboxId", canonicalInboxId).eq(
            "status",
            "delivery_unverified",
          )
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
  const blockingUnverified = Boolean(unverified && !verifiedDeletionSettled);
  if (
    !blockingSending &&
    !blockingUnverified &&
    unsettledCanaries.length === 0
  ) return null;
  const knownSettlementAt = Math.max(
    blockingSending ? sending?.deliveryLeaseExpiresAt ?? 0 : 0,
    ...unsettledCanaries.map((row) =>
      Math.max(row.deliveryLeaseExpiresAt ?? 0, row.expiresAt)
    ),
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

async function pruneSealedManagedResources(
  ctx: MutationCtx,
  resources: ManagedResource[],
  expectedGeneration: number,
): Promise<number> {
  let pruned = 0;
  for (const candidate of resources) {
    if (candidate.generation === expectedGeneration) continue;
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
    await pruneSealedManagedResources(ctx, resources, args.expectedGeneration);
    if (
      request.outreachMailbox.mode !== "managed" ||
      request.fulfillmentState === "cancelled"
    ) {
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
      row.generation !== args.expectedGeneration
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
        operationKey: resource.operationKey,
        generation: resource.generation,
        configurationRevision: resource.requestConfigurationRevision,
        externalDeadlineAt: resource.leaseExpiresAt!,
        tenantDomain: resource.domainSnapshot,
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
        operationKey: resource.operationKey,
        generation: resource.generation,
        provisioningAdapterVersion: resource.adapterVersion,
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
