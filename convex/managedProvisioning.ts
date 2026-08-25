import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { accountDeletionKey } from "./lib/accountDeletion.ts";
import {
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
  MANAGED_PROVISIONING_LEASE_MS,
  normalizedOneSetupDomain,
  type OneSetupCapability,
} from "./lib/oneSetup.ts";
import { sha256Hex } from "./lib/publicationArtifact.ts";

const MANAGED_PROVISIONING_FLEET_BATCH = 25;
const MANAGED_PROVISIONING_LEGACY_BATCH = 25;

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
    requestContractVersion: request.contractVersion,
  });
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
    const timestamp = Date.now();
    const site = await ctx.db.get(request.siteId);
    if (!requestIdentityIsCurrent({ request, site })) {
      await cancelStaleRequest(ctx, request, timestamp);
      return { claimed: false as const, reason: "lifecycle_fence" as const };
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
    await ctx.scheduler.runAfter(0, internal.managedProvisioning.reconcileRequest, {
      requestId: request._id,
      expectedRevision: request.revision,
      leaseToken,
    });
    await ctx.scheduler.runAt(
      leaseExpiresAt + 1_000,
      internal.managedProvisioning.dispatchRequest,
      {
        requestId: request._id,
        expectedRevision: request.revision,
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
    const publisher = capabilityAfterReconciliation({
      capability: "publisher",
      current: request.publisher,
      canonicalReceiptVerified: oneSetupPublisherReceiptVerified(site),
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
      canonicalReceiptVerified: oneSetupOutreachMailboxReceiptVerified({
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
