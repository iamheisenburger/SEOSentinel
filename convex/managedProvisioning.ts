import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { accountDeletionKey } from "./lib/accountDeletion.ts";
import {
  oneSetupManagedOutreachMailboxReceiptVerified,
  oneSetupOutreachMailboxReceiptVerified,
  oneSetupPublisherReceiptVerified,
  oneSetupSearchMeasurementReceiptVerified,
} from "./lib/oneSetupCanonical.ts";
import {
  aggregateOneSetupRequestState,
  managedProvisioningDecision,
  managedProvisioningIdentityIsCurrent,
  managedProvisioningLeaseIsCurrent,
  managedProvisioningRetryAt,
  MANAGED_PROVIDER_PROGRESS_STALE_MS,
  MANAGED_PROVISIONING_LEASE_MS,
  normalizedOneSetupDomain,
  type OneSetupCapability,
} from "./lib/oneSetup.ts";
import {
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
} from "./lib/siteDomainBinding.ts";
import { sha256Hex } from "./lib/publicationArtifact.ts";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance.ts";
import { publisherAutopublishConsentCurrent } from
  "./lib/publisherProvisioning.ts";
import { stageManagedOutreachMailboxRelease } from
  "./managedOutreachMailbox.ts";

const MANAGED_PROVISIONING_FLEET_BATCH = 25;
const MANAGED_PROVISIONING_LEGACY_BATCH = 25;

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

type ManagedProvisioningRequest = Doc<"managed_provisioning_requests">;
type ManagedProvisioningCapability = ManagedProvisioningRequest["publisher"];

function activeRequestDomain(
  site: Doc<"sites"> | null,
): string | null {
  return site
    ? site.canonicalDomain ?? normalizedOneSetupDomain(site.domain)
    : null;
}

function requestIdentityIsCurrent(args: {
  request: ManagedProvisioningRequest;
  site: Doc<"sites"> | null;
}): args is {
  request: ManagedProvisioningRequest;
  site: Doc<"sites"> & { userId: string };
} {
  const { request, site } = args;
  return managedProvisioningIdentityIsCurrent({
    siteActive: Boolean(
      site?.userId &&
        !site.deletionStatus &&
        !site.accountDeletionRequestedAt,
    ),
    requestOwnerAccountKey: request.ownerAccountKey,
    currentOwnerAccountKey: site?.userId
      ? accountDeletionKey(site.userId)
      : undefined,
    requestDomainSnapshot: request.domainSnapshot,
    currentDomainSnapshot: activeRequestDomain(site),
    requestDomainRevisionSnapshot: request.domainRevisionSnapshot,
    currentCanonicalDomainRevision: site
      ? siteCanonicalDomainRevision(site)
      : 0,
    legacyUnstampedAllowed: Boolean(
      site && siteUsesLegacyDomainReceipts(site)
    ),
    requestContractVersion: request.contractVersion,
  });
}

function publisherAuthorizationVerified(args: {
  request: ManagedProvisioningRequest;
  site: Doc<"sites">;
  timestamp: number;
}): boolean {
  return oneSetupPublisherReceiptVerified(args.site, args.timestamp) &&
    publisherAutopublishConsentCurrent({
      request: args.request,
      timestamp: args.timestamp,
    });
}

function publisherLeaseContextIsCurrent(args: {
  request: ManagedProvisioningRequest | null;
  site: Doc<"sites"> | null;
  expectedRevision: number;
  leaseToken: string;
  timestamp: number;
}): boolean {
  return Boolean(
    args.request &&
      managedProvisioningLeaseIsCurrent({
        expectedRevision: args.expectedRevision,
        actualRevision: args.request.revision,
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: args.request.leaseToken,
        leaseExpiresAt: args.request.leaseExpiresAt,
        timestamp: args.timestamp,
      }) &&
      requestIdentityIsCurrent({
        request: args.request,
        site: args.site,
      }),
  );
}

function capabilityAfterReconciliation(args: {
  capability: OneSetupCapability;
  current: ManagedProvisioningCapability;
  canonicalReceiptVerified: boolean;
  timestamp: number;
}): ManagedProvisioningCapability {
  const decision = managedProvisioningDecision({
    capability: args.capability,
    mode: args.current.mode,
    canonicalReceiptVerified: args.canonicalReceiptVerified,
    currentProgress: args.current,
    timestamp: args.timestamp,
  });
  return {
    ...args.current,
    ...decision,
    providerReportedAt: args.current.state === "in_progress"
      ? args.current.providerReportedAt ?? args.current.updatedAt
      : args.current.providerReportedAt,
    blockedReasonCode: decision.blockedReasonCode,
    actionRequiredBy: decision.actionRequiredBy,
    updatedAt: args.timestamp,
  };
}

async function cancelStaleRequest(
  ctx: MutationCtx,
  request: ManagedProvisioningRequest,
  timestamp: number,
) {
  await stageManagedOutreachMailboxRelease(
    ctx,
    request.siteId,
    timestamp,
    "managed_mailbox_request_identity_invalidated",
  );
  const alert = await ctx.db
    .query("autopilot_alerts")
    .withIndex("by_site_kind_status", (q) =>
      q.eq("siteId", request.siteId)
        .eq("kind", "managed_provisioning_operator_action_required")
        .eq("status", "active")
    )
    .first();
  if (alert) {
    await ctx.db.patch(alert._id, {
      status: "resolved",
      resolvedAt: timestamp,
      updatedAt: timestamp,
    });
  }
  await ctx.db.patch(request._id, {
    fulfillmentState: "cancelled",
    nextAttemptAt: undefined,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    lastReconciledAt: timestamp,
    operatorActionRequiredAt: undefined,
    updatedAt: timestamp,
    completedAt: undefined,
  });
}

async function syncOperatorActionAlert(
  ctx: MutationCtx,
  request: ManagedProvisioningRequest,
  reasonCodes: string[],
  timestamp: number,
  revision: number,
) {
  const existing = await ctx.db
    .query("autopilot_alerts")
    .withIndex("by_site_kind_status", (q) =>
      q.eq("siteId", request.siteId)
        .eq("kind", "managed_provisioning_operator_action_required")
        .eq("status", "active")
    )
    .first();
  if (reasonCodes.length === 0) {
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "resolved",
        resolvedAt: timestamp,
        updatedAt: timestamp,
      });
    }
    return;
  }
  const fields = {
    message:
      `Managed setup requires Pentra operator action: ${reasonCodes.join(", ")}.`,
    details: {
      requestId: request._id,
      requestRevision: revision,
      reasonCodes,
    },
    updatedAt: timestamp,
  };
  if (existing) await ctx.db.patch(existing._id, fields);
  else {
    await ctx.db.insert("autopilot_alerts", {
      siteId: request.siteId,
      kind: "managed_provisioning_operator_action_required",
      status: "active",
      createdAt: timestamp,
      ...fields,
    });
  }
}

/** Internal-only credential-bearing context for one exact live lease. */
export const getPublisherPreflightContext = internalQuery({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    expectedRevision: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    const site = request ? await ctx.db.get(request.siteId) : null;
    const timestamp = Date.now();
    if (!publisherLeaseContextIsCurrent({
      request,
      site,
      expectedRevision: args.expectedRevision,
      leaseToken: args.leaseToken,
      timestamp,
    }) || !request || !site || !(await siteExecutionAuthorized(ctx, site))) {
      return null;
    }
    return { request, site, timestamp };
  },
});

/** Provider progress remains on the same lease/revision. It cannot create a
 * fresh lease, extend one, or transition the capability to ready. */
export const markPublisherPreflightInProgress = internalMutation({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    expectedRevision: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    const site = request ? await ctx.db.get(request.siteId) : null;
    const timestamp = Date.now();
    if (!publisherLeaseContextIsCurrent({
      request,
      site,
      expectedRevision: args.expectedRevision,
      leaseToken: args.leaseToken,
      timestamp,
    }) || !request || !site) {
      return { started: false as const, reason: "lease_lost" as const };
    }
    const publisher: ManagedProvisioningCapability = {
      ...request.publisher,
      state: "in_progress",
      blockedReasonCode: undefined,
      actionRequiredBy: undefined,
      providerReportedAt: timestamp,
      updatedAt: timestamp,
    };
    await ctx.db.patch(request._id, {
      publisher,
      aggregateState: aggregateOneSetupRequestState([
        publisher,
        request.searchMeasurement,
        request.outreachMailbox,
      ]),
      updatedAt: timestamp,
    });
    return { started: true as const };
  },
});

const PUBLISHER_PREFLIGHT_ACTIONS = {
  publisher_autopublish_consent_required: "owner",
  publisher_connection_required: "owner",
  publisher_connection_verification_required: "owner",
  managed_publisher_adapter_unavailable: "operator",
} as const;

/** Settle a preflight boundary against the exact lease and wake a durable
 * retry. Supported adapters always return a structured owner action; only a
 * genuinely unsupported adapter enters the operator queue. */
export const settlePublisherPreflightActionRequired = internalMutation({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    expectedRevision: v.number(),
    leaseToken: v.string(),
    reasonCode: v.union(
      v.literal("publisher_autopublish_consent_required"),
      v.literal("publisher_connection_required"),
      v.literal("publisher_connection_verification_required"),
      v.literal("managed_publisher_adapter_unavailable"),
    ),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    const site = request ? await ctx.db.get(request.siteId) : null;
    const timestamp = Date.now();
    if (!publisherLeaseContextIsCurrent({
      request,
      site,
      expectedRevision: args.expectedRevision,
      leaseToken: args.leaseToken,
      timestamp,
    }) || !request || !site) {
      return { settled: false as const, reason: "lease_lost" as const };
    }
    const actionRequiredBy = PUBLISHER_PREFLIGHT_ACTIONS[args.reasonCode];
    const publisher: ManagedProvisioningCapability = {
      ...request.publisher,
      state: actionRequiredBy === "owner"
        ? "owner_action_required"
        : "blocked",
      blockedReasonCode: args.reasonCode,
      actionRequiredBy,
      providerReportedAt: timestamp,
      updatedAt: timestamp,
    };
    const capabilities = [
      publisher,
      request.searchMeasurement,
      request.outreachMailbox,
    ] as const;
    const aggregateState = aggregateOneSetupRequestState(capabilities);
    const operatorReasonCodes = capabilities
      .filter((capability) => capability.actionRequiredBy === "operator")
      .map((capability) => capability.blockedReasonCode)
      .filter((reasonCode): reasonCode is string => Boolean(reasonCode));
    const revision = request.revision + 1;
    const nextAttemptAt = managedProvisioningRetryAt(timestamp);
    await ctx.db.patch(request._id, {
      publisher,
      aggregateState,
      fulfillmentState: "waiting_action",
      nextAttemptAt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      operatorActionRequiredAt: operatorReasonCodes.length > 0
        ? request.operatorActionRequiredAt ?? timestamp
        : undefined,
      revision,
      updatedAt: timestamp,
      completedAt: undefined,
    });
    await syncOperatorActionAlert(
      ctx,
      request,
      operatorReasonCodes,
      timestamp,
      revision,
    );
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.managedProvisioning.dispatchRequest,
      { requestId: request._id, expectedRevision: revision },
    );
    // Publisher owner action must not serialize or starve managed mailbox
    // provisioning. Reconcile the mailbox against the revision committed above;
    // an older dispatch wake is expected to lose this exact revision race.
    await ctx.scheduler.runAfter(
      0,
      internal.managedOutreachMailbox.reconcileProvisioningResource,
      {
        requestId: request._id,
        expectedRequestRevision: revision,
        expectedConfigurationRevision: request.configurationRevision ?? 0,
        expectedGeneration: request.outreachMailboxGeneration ?? 1,
      },
    );
    return {
      settled: true as const,
      revision,
      aggregateState,
      actionRequiredBy,
    };
  },
});

/**
 * Atomic lease boundary for one exact owner/domain/contract/revision. A
 * duplicate exact wake is harmless, and a watchdog wake reclaims an expired
 * lease if the scheduled reconciler never commits.
 */
export const dispatchRequest = internalMutation({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    expectedRevision: v.number(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.revision !== args.expectedRevision) {
      return { claimed: false as const, reason: "stale_revision" as const };
    }
    if (request.fulfillmentState === "cancelled") {
      return { claimed: false as const, reason: "cancelled" as const };
    }
    const timestamp = Date.now();
    const site = await ctx.db.get(request.siteId);
    if (!requestIdentityIsCurrent({ request, site })) {
      await cancelStaleRequest(ctx, request, timestamp);
      return { claimed: false as const, reason: "lifecycle_fence" as const };
    }
    if (!site) throw new Error("Active provisioning site disappeared");
    if (!(await siteExecutionAuthorized(ctx, site))) {
      // Parking publisher execution must not strand a managed mailbox. The
      // mailbox reconciler owns retirement, quarantine, and durable release;
      // under this same execution fence it will retire rather than allocate.
      await ctx.scheduler.runAfter(
        0,
        internal.managedOutreachMailbox.reconcileProvisioningResource,
        {
          requestId: request._id,
          expectedRequestRevision: request.revision,
          expectedConfigurationRevision: request.configurationRevision ?? 0,
          expectedGeneration: request.outreachMailboxGeneration ?? 1,
        },
      );
      const nextAttemptAt = managedProvisioningRetryAt(timestamp);
      await ctx.db.patch(request._id, {
        fulfillmentState: "retry_wait",
        nextAttemptAt,
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        updatedAt: timestamp,
        completedAt: undefined,
      });
      await ctx.scheduler.runAt(
        nextAttemptAt,
        internal.managedProvisioning.dispatchRequest,
        { requestId: request._id, expectedRevision: request.revision },
      );
      return {
        claimed: false as const,
        reason: "execution_paused" as const,
        nextAttemptAt,
      };
    }
    if (
      request.fulfillmentState === "leased" &&
      (request.leaseExpiresAt ?? 0) > timestamp
    ) {
      return { claimed: false as const, reason: "lease_live" as const };
    }
    if ((request.nextAttemptAt ?? 0) > timestamp) {
      return { claimed: false as const, reason: "not_due" as const };
    }

    const fulfillmentAttempt = (request.fulfillmentAttempt ?? 0) + 1;
    const leaseExpiresAt = timestamp + MANAGED_PROVISIONING_LEASE_MS;
    const leaseToken = sha256Hex(
      `managed-provisioning:v1:${request._id}:${request.revision}:${fulfillmentAttempt}:${timestamp}`,
    );
    await ctx.db.patch(request._id, {
      fulfillmentState: "leased",
      fulfillmentAttempt,
      leaseToken,
      leaseExpiresAt,
      lastClaimedAt: timestamp,
      nextAttemptAt: leaseExpiresAt,
      updatedAt: timestamp,
    });
    const publisherReady = publisherAuthorizationVerified({
      request,
      site,
      timestamp,
    });
    const publisherProgressAt = request.publisher.providerReportedAt ??
      request.publisher.updatedAt;
    const publisherAdapterStalled = request.publisher.state === "in_progress" &&
      publisherProgressAt > 0 &&
      timestamp - publisherProgressAt > MANAGED_PROVIDER_PROGRESS_STALE_MS;
    await ctx.scheduler.runAfter(
      0,
      publisherReady || publisherAdapterStalled
        ? internal.managedProvisioning.reconcileRequest
        : internal.publisher.preflightManagedPublisherInternal,
      {
        requestId: request._id,
        expectedRevision: request.revision,
        leaseToken,
      },
    );
    await ctx.scheduler.runAt(
      leaseExpiresAt + 1_000,
      internal.managedProvisioning.dispatchRequest,
      {
        requestId: request._id,
        expectedRevision: request.revision,
      },
    );
    // A publisher action that dies without settling must not starve mailbox
    // lifecycle work. Wait until the exact top-level lease is expired so this
    // fallback cannot race a valid publisher settlement; normal settlement and
    // canonical reconciliation arm their own current-revision mailbox wakes.
    await ctx.scheduler.runAt(
      leaseExpiresAt + 1,
      internal.managedOutreachMailbox.reconcileProvisioningResource,
      {
        requestId: request._id,
        expectedRequestRevision: request.revision,
        expectedConfigurationRevision: request.configurationRevision ?? 0,
        expectedGeneration: request.outreachMailboxGeneration ?? 1,
      },
    );
    return {
      claimed: true as const,
      requestId: request._id,
      revision: request.revision,
      fulfillmentAttempt,
      leaseExpiresAt,
    };
  },
});

/**
 * Canonical reconciliation is the only ready writer. Missing adapters or
 * unavoidable provider consent are recorded as exact owner/operator actions,
 * then rechecked at an exact durable wake so a resolved receipt cannot starve.
 */
export const reconcileRequest = internalMutation({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    expectedRevision: v.number(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    const timestamp = Date.now();
    if (
      !request ||
      !managedProvisioningLeaseIsCurrent({
        expectedRevision: args.expectedRevision,
        actualRevision: request.revision,
        expectedLeaseToken: args.leaseToken,
        actualLeaseToken: request.leaseToken,
        leaseExpiresAt: request.leaseExpiresAt,
        timestamp,
      })
    ) {
      return { reconciled: false as const, reason: "lease_lost" as const };
    }
    const site = await ctx.db.get(request.siteId);
    if (!requestIdentityIsCurrent({ request, site })) {
      await cancelStaleRequest(ctx, request, timestamp);
      return { reconciled: false as const, reason: "lifecycle_fence" as const };
    }
    if (!site) throw new Error("Active provisioning site disappeared");
    const inboxes = await ctx.db
      .query("outreach_inboxes")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .take(2);
    const managedMailboxResources = request.outreachMailbox.mode === "managed" &&
        request.outreachMailboxGeneration !== undefined
      ? await ctx.db
          .query("managed_outreach_mailbox_resources")
          .withIndex("by_request", (q) => q.eq("requestId", request._id))
          .take(2)
      : [];
    const managedMailboxResource = managedMailboxResources.length === 1 &&
        managedMailboxResources[0].generation ===
          request.outreachMailboxGeneration
      ? managedMailboxResources[0]
      : null;
    const publisher = capabilityAfterReconciliation({
      capability: "publisher",
      current: request.publisher,
      canonicalReceiptVerified: oneSetupPublisherReceiptVerified(site) &&
        publisherAutopublishConsentCurrent({ request, timestamp }),
      timestamp,
    });
    const searchMeasurement = capabilityAfterReconciliation({
      capability: "search_measurement",
      current: request.searchMeasurement,
      canonicalReceiptVerified: oneSetupSearchMeasurementReceiptVerified(site),
      timestamp,
    });
    const outreachMailbox = capabilityAfterReconciliation({
      capability: "outreach_mailbox",
      current: request.outreachMailbox,
      canonicalReceiptVerified: request.outreachMailbox.mode === "managed"
        ? oneSetupManagedOutreachMailboxReceiptVerified({
            siteDomain: site.domain,
            inboxes,
            resource: managedMailboxResource,
            requestId: String(request._id),
            siteId: String(site._id),
            ownerAccountKey: request.ownerAccountKey,
            expectedDomainRevision: request.domainRevisionSnapshot ?? -1,
            expectedConfigurationRevision:
              request.configurationRevision ?? 0,
            expectedGeneration: request.outreachMailboxGeneration ?? -1,
            expectedRequestContractVersion: request.contractVersion,
            expectedProfile: request.managedOutreachProfile,
            now: timestamp,
            rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
            runtimeConfig: inboundRelayRuntimeConfig(),
          })
        : oneSetupOutreachMailboxReceiptVerified({
            inboxes,
            ownerAccountKey: request.ownerAccountKey,
          }),
      timestamp,
    });
    const aggregateState = aggregateOneSetupRequestState([
      publisher,
      searchMeasurement,
      outreachMailbox,
    ]);
    const operatorReasonCodes = [
      publisher,
      searchMeasurement,
      outreachMailbox,
    ].filter((capability) => capability.actionRequiredBy === "operator")
      .map((capability) => capability.blockedReasonCode)
      .filter((reasonCode): reasonCode is string => Boolean(reasonCode));
    const complete = aggregateState === "ready";
    const actionRequired = [
      publisher,
      searchMeasurement,
      outreachMailbox,
    ].some((capability) => Boolean(capability.actionRequiredBy));
    const fulfillmentState = complete
      ? "complete" as const
      : actionRequired
        ? "waiting_action" as const
        : "retry_wait" as const;
    const revision = request.revision + 1;
    // Completed integrations remain under a lightweight receipt watch. A
    // revoked OAuth grant or publisher/mailbox regression must re-enter the
    // exact action queue instead of leaving a stale permanent success state.
    const nextAttemptAt = managedProvisioningRetryAt(timestamp);
    await ctx.db.patch(request._id, {
      publisher,
      searchMeasurement,
      outreachMailbox,
      aggregateState,
      fulfillmentState,
      nextAttemptAt,
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      lastReconciledAt: timestamp,
      operatorActionRequiredAt: operatorReasonCodes.length > 0
        ? request.operatorActionRequiredAt ?? timestamp
        : undefined,
      revision,
      updatedAt: timestamp,
      completedAt: complete ? request.completedAt ?? timestamp : undefined,
    });
    await syncOperatorActionAlert(
      ctx,
      request,
      operatorReasonCodes,
      timestamp,
      revision,
    );
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.managedProvisioning.dispatchRequest,
      { requestId: request._id, expectedRevision: revision },
    );
    await ctx.scheduler.runAfter(
      0,
      internal.managedOutreachMailbox.reconcileProvisioningResource,
      {
        requestId: request._id,
        expectedRequestRevision: revision,
        expectedConfigurationRevision: request.configurationRevision ?? 0,
        expectedGeneration: request.outreachMailboxGeneration ?? 1,
      },
    );
    return {
      reconciled: true as const,
      requestId: request._id,
      revision,
      aggregateState,
      fulfillmentState,
      nextAttemptAt,
    };
  },
});

/** Credential-free, bounded work projection for the managed-setup operator. */
export const listOperatorQueue = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 25)));
    const requests = await ctx.db
      .query("managed_provisioning_requests")
      .withIndex("by_operator_action", (q) =>
        q.gte("operatorActionRequiredAt", 0)
      )
      .order("asc")
      .take(limit);
    const queue = [];
    for (const request of requests) {
      const site = await ctx.db.get(request.siteId);
      if (!requestIdentityIsCurrent({ request, site })) continue;
      const capabilities = [
        ["publisher", request.publisher],
        ["search_measurement", request.searchMeasurement],
        ["outreach_mailbox", request.outreachMailbox],
      ] as const;
      queue.push({
        requestId: request._id,
        siteId: request.siteId,
        domainSnapshot: request.domainSnapshot,
        contractVersion: request.contractVersion,
        revision: request.revision,
        actionRequiredAt: request.operatorActionRequiredAt!,
        nextReceiptCheckAt: request.nextAttemptAt,
        actions: capabilities
          .filter(([, progress]) => progress.actionRequiredBy === "operator")
          .map(([capability, progress]) => ({
            capability,
            reasonCode: progress.blockedReasonCode,
          })),
      });
    }
    return queue;
  },
});

/**
 * Bounded fleet safety net. The exact per-request wakes are primary; this pass
 * recovers scheduler silence, expired leases, and additive v1 rows that do not
 * yet carry dispatcher lifecycle fields.
 */
export const dispatchFleet = internalMutation({
  args: {},
  handler: async (ctx) => {
    const timestamp = Date.now();
    const due = await ctx.db
      .query("managed_provisioning_requests")
      .withIndex("by_fulfillment_due", (q) =>
        q.gte("nextAttemptAt", 0).lte("nextAttemptAt", timestamp)
      )
      .take(MANAGED_PROVISIONING_FLEET_BATCH);
    // Missing optional index values sort as `undefined`; the equality range
    // therefore reads at most one fixed legacy page and never post-filters the
    // entire modern fleet merely to prove that migration is complete.
    const legacy = await ctx.db
      .query("managed_provisioning_requests")
      .withIndex("by_fulfillment_updated", (q) =>
        q.eq("fulfillmentState", undefined)
      )
      .take(MANAGED_PROVISIONING_LEGACY_BATCH);
    const unique = new Map<Id<"managed_provisioning_requests">, ManagedProvisioningRequest>();
    for (const request of [...due, ...legacy]) unique.set(request._id, request);
    for (const request of unique.values()) {
      await ctx.scheduler.runAfter(0, internal.managedProvisioning.dispatchRequest, {
        requestId: request._id,
        expectedRevision: request.revision,
      });
    }
    return {
      scheduled: unique.size,
      due: due.length,
      legacy: legacy.length,
      boundedAt: MANAGED_PROVISIONING_FLEET_BATCH +
        MANAGED_PROVISIONING_LEGACY_BATCH,
    };
  },
});
