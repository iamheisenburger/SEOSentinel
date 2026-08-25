import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";

import { accountDeletionKey } from "./lib/accountDeletion.ts";
import { ONE_SETUP_CONTRACT_VERSION } from "./lib/oneSetup.ts";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance.ts";
import {
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  topicPlanProviderReservationTriggerFromPayload,
} from "./lib/planProviderBudget.ts";
import {
  oneSetupConfigurationRevisionIsCurrent,
  oneSetupExecutionClaimDisposition,
  oneSetupExecutionWatchIdentityMatches,
  oneSetupExecutionTerminalPatch,
  oneSetupPlanSettlement,
  oneSetupTerminalReceiptSettlementAllowed,
  nextOneSetupWatchGeneration,
} from "./lib/oneSetupExecution.ts";
import {
  oneSetupDomainRevisionReceiptMatches,
  oneSetupFailedPlanRecoveryReceiptMatches,
  oneSetupInitialPlanContextFingerprint,
  oneSetupInitialPlanJobBindingMatches,
  oneSetupZeroSpendRecoveryEligibleAt,
} from "./lib/oneSetupInitialPlan.ts";
import { oneSetupInitialPlanCurrency } from
  "./lib/oneSetupInitialPlanDb.ts";
import {
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
} from "./lib/siteDomainBinding.ts";

export const ONE_SETUP_EXECUTION_LEASE_MS = 35 * 60 * 1000;
export const ONE_SETUP_PLAN_SETTLEMENT_RECHECK_MS = 30 * 1000;
export const ONE_SETUP_PLAN_SETTLEMENT_MAX_ATTEMPTS = 180;
export const ONE_SETUP_CLAIM_WATCHDOG_MAX_RECOVERIES = 3;
export const ONE_SETUP_CLAIM_UNAUTHORIZED_RECHECK_MS = 30 * 60 * 1000;
export const ONE_SETUP_PENDING_RESUME_RECHECK_MS = 30 * 1000;
export const ONE_SETUP_PENDING_RESUME_MAX_ATTEMPTS = 180;
export const ONE_SETUP_RESUME_DISPATCH_WATCH_MS = 60 * 1000;

type FailedPlanRecoveryDecision =
  | { kind: "recoverable"; blockerCode: string; eligibleAt: number }
  | { kind: "terminal"; blockerCode: string };

async function failedPlanRecoveryDecision(
  ctx: MutationCtx,
  args: {
    site: Doc<"sites">;
    request: Doc<"managed_provisioning_requests">;
    job: Doc<"jobs">;
  },
): Promise<FailedPlanRecoveryDecision> {
  const blockerCode = args.job.cadenceFailure?.code ??
    "plan_failed_no_replay";
  const eligibleAt = args.job.cadenceFailure?.eligibleAt;
  const recordedAt = args.job.cadenceFailure?.recordedAt;
  const releaseReason = args.job.providerReservationReleaseReason;
  if (
    args.job.status !== "failed" ||
    !args.job.providerSpendReservationId ||
    !args.site.userId
  ) return { kind: "terminal", blockerCode };
  const reservation = await ctx.db.get(args.job.providerSpendReservationId);
  const contextSupersededBeforeExecution = releaseReason ===
    "one_setup_planning_context_superseded_before_execution";
  // A first-version save may enrich the exact legacy J after its worker's
  // pre-provider authorization mutation observed the raw receipt. Recover
  // that zero-spend ordering only if the enriched job is now the request's
  // current stable generation. A real planning/domain/context reset stays
  // stale here and can never recycle its old reservation into the new plan.
  const currentStableBinding = !contextSupersededBeforeExecution ||
    (await oneSetupInitialPlanCurrency(ctx, {
      site: args.site,
      job: args.job,
    })).kind === "current";
  const exactReleasedReservation = currentStableBinding &&
    oneSetupFailedPlanRecoveryReceiptMatches({
      recoveryCount: args.request.initialPlanRecoveryCount,
      workerAttempts: args.job.workerAttempts,
      recordedAt,
      eligibleAt,
      failureCode: args.job.cadenceFailure?.code,
      releaseReason,
      jobSiteId: String(args.site._id),
      jobUserId: args.site.userId,
      jobTrigger:
        topicPlanProviderReservationTriggerFromPayload(args.job.payload),
      jobCreatedAt: args.job.createdAt,
      jobReservationDay: args.job.providerCostReservationDay,
      jobReservedMicroUsd: args.job.providerCostReservedMicroUsd,
      jobCeilingMicroUsd: args.job.providerCostCeilingMicroUsd,
      jobReleasedAt: args.job.providerReservationReleasedAt,
      reservationSiteId: reservation?.siteId
        ? String(reservation.siteId)
        : undefined,
      reservationUserId: reservation?.userId,
      reservationPurpose: reservation?.purpose,
      reservationTrigger: reservation?.trigger,
      reservationCreatedAt: reservation?.createdAt,
      reservationDay: reservation?.reservationDay,
      reservationReservedMicroUsd: reservation?.reservedMicroUsd,
      reservationReleasedAt: reservation?.releasedAt,
      reservationReleaseReason: reservation?.releaseReason,
      expectedProviderCeilingMicroUsd:
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    });
  return exactReleasedReservation
    ? {
      kind: "recoverable",
      blockerCode,
      eligibleAt: oneSetupZeroSpendRecoveryEligibleAt({
        recoveryCount: args.request.initialPlanRecoveryCount,
        receiptRecordedAt: recordedAt!,
        receiptEligibleAt: eligibleAt!,
      }),
    }
    : { kind: "terminal", blockerCode };
}

async function armClaimWatchdog(
  ctx: MutationCtx,
  args: {
    executionId: Id<"one_setup_executions">;
    requestId: Id<"managed_provisioning_requests">;
    configurationRevision: number;
    claimNonce: string;
    leaseExpiresAt: number;
    previousGeneration?: number;
    recoveryAttempt: number;
  },
): Promise<void> {
  const generation = nextOneSetupWatchGeneration(args.previousGeneration);
  const nextAt = args.leaseExpiresAt + 1_000;
  await ctx.db.patch(args.executionId, {
    claimWatchGeneration: generation,
    claimWatchAttempt: args.recoveryAttempt,
    claimWatchNextAt: nextAt,
  });
  await ctx.scheduler.runAt(
    nextAt,
    internal.oneSetupExecutions.recoverExpiredClaim,
    {
      executionId: args.executionId,
      requestId: args.requestId,
      configurationRevision: args.configurationRevision,
      claimNonce: args.claimNonce,
      watchGeneration: generation,
      recoveryAttempt: args.recoveryAttempt,
    },
  );
}

/**
 * A scheduler action is not itself a durable claim. Every mutation-to-action
 * handoff therefore writes a successor mutation wake in the same transaction.
 * The action's successful claim advances claimWatchGeneration and makes this
 * wake a no-op; action death before claim lets the wake dispatch one bounded
 * successor.
 */
async function scheduleExactResumeWithWatchdog(
  ctx: MutationCtx,
  args: {
    execution: Doc<"one_setup_executions">;
    recoveryAttempt: number;
  },
): Promise<{ generation: number; nextAt: number }> {
  if (
    !Number.isSafeInteger(args.recoveryAttempt) ||
    args.recoveryAttempt < 1 ||
    args.recoveryAttempt > ONE_SETUP_CLAIM_WATCHDOG_MAX_RECOVERIES
  ) throw new Error("Invalid one-setup resume recovery attempt");
  const generation = nextOneSetupWatchGeneration(
    args.execution.claimWatchGeneration,
  );
  const timestamp = Date.now();
  const nextAt = timestamp + ONE_SETUP_RESUME_DISPATCH_WATCH_MS;
  await ctx.db.patch(args.execution._id, {
    status: args.execution.planJobId ? "plan_queued" : "pending",
    claimNonce: undefined,
    leaseExpiresAt: undefined,
    claimWatchGeneration: generation,
    claimWatchAttempt: args.recoveryAttempt,
    claimWatchNextAt: nextAt,
    pendingResumeAttempt: undefined,
    pendingResumeNextAt: undefined,
    bootstrapAuthorizationWatchAttempt: undefined,
    bootstrapAuthorizationNextAt: undefined,
    updatedAt: timestamp,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.actions.pipeline.resumeOneSetupExecutionInternal,
    {
      siteId: args.execution.siteId,
      requestId: args.execution.requestId,
      configurationRevision: args.execution.configurationRevision,
      expectedExecutionId: args.execution._id,
      claimRecoveryAttempt: args.recoveryAttempt,
      expectedClaimWatchGeneration: generation,
    },
  );
  await ctx.scheduler.runAt(
    nextAt,
    internal.oneSetupExecutions.recoverScheduledResumeDispatch,
    {
      executionId: args.execution._id,
      requestId: args.execution.requestId,
      configurationRevision: args.execution.configurationRevision,
      watchGeneration: generation,
      recoveryAttempt: args.recoveryAttempt,
    },
  );
  return { generation, nextAt };
}

async function receiptRequestContext(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    requestId: Id<"managed_provisioning_requests">;
  },
): Promise<{
  site: Doc<"sites">;
  request: Doc<"managed_provisioning_requests">;
}> {
  const [site, request] = await Promise.all([
    ctx.db.get(args.siteId),
    ctx.db.get(args.requestId),
  ]);
  const domainSnapshot = site ? siteCanonicalDomain(site) : null;
  const deletionReceipt = site?.userId
    ? await ctx.db
        .query("account_deletion_receipts")
        .withIndex("by_account_key", (q) =>
          q.eq("accountKey", accountDeletionKey(site.userId!))
        )
        .unique()
    : null;
  if (
    !site ||
    !request ||
    request.siteId !== site._id ||
    !oneSetupTerminalReceiptSettlementAllowed({
      hasUser: Boolean(site.userId),
      deletionStatus: site.deletionStatus,
      accountDeletionRequestedAt: site.accountDeletionRequestedAt,
      accountDeletionReceiptExists: Boolean(deletionReceipt),
      ownerMatches: Boolean(
        site.userId &&
        request.ownerAccountKey === accountDeletionKey(site.userId)
      ),
      domainMatches: request.domainSnapshot === domainSnapshot,
      contractMatches: request.contractVersion === ONE_SETUP_CONTRACT_VERSION,
      planParkedAt: site.planParkedAt,
    }) ||
    !oneSetupDomainRevisionReceiptMatches({
      currentCanonicalDomainRevision: siteCanonicalDomainRevision(site),
      receiptDomainRevision: request.domainRevisionSnapshot,
      legacyUnstampedAllowed: siteUsesLegacyDomainReceipts(site),
    })
  ) {
    throw new Error("One-setup receipt lost its tenant request fence");
  }
  return { site, request };
}

async function activeRequestContext(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    requestId: Id<"managed_provisioning_requests">;
  },
): Promise<{
  site: Doc<"sites">;
  request: Doc<"managed_provisioning_requests">;
}> {
  const context = await receiptRequestContext(ctx, args);
  if (!(await siteExecutionAuthorized(ctx, context.site))) {
    throw new Error("One-setup execution is not currently authorized");
  }
  return context;
}

function requestMatchesExecution(
  request: Doc<"managed_provisioning_requests">,
  execution: Doc<"one_setup_executions">,
  site: Doc<"sites">,
): boolean {
  const currentCanonicalDomainRevision = siteCanonicalDomainRevision(site);
  const legacyUnstampedAllowed = siteUsesLegacyDomainReceipts(site);
  return execution.configurationRevision ===
      (request.configurationRevision ?? 0) &&
    execution.ownerAccountKey === request.ownerAccountKey &&
    execution.domainSnapshot === request.domainSnapshot &&
    request.domainSnapshot === siteCanonicalDomain(site) &&
    execution.automationMode === request.automationMode &&
    execution.requestedCadencePerWeek === request.requestedCadencePerWeek &&
    execution.publisherMode === request.publisher.mode &&
    execution.searchMeasurementMode === request.searchMeasurement.mode &&
    execution.outreachMailboxMode === request.outreachMailbox.mode &&
    oneSetupDomainRevisionReceiptMatches({
      currentCanonicalDomainRevision,
      receiptDomainRevision: request.domainRevisionSnapshot,
      legacyUnstampedAllowed,
    }) &&
    oneSetupDomainRevisionReceiptMatches({
      currentCanonicalDomainRevision,
      receiptDomainRevision: execution.domainRevisionSnapshot,
      legacyUnstampedAllowed,
    }) &&
    execution.domainRevisionSnapshot === request.domainRevisionSnapshot;
}

function planBindingMatches(
  request: Doc<"managed_provisioning_requests">,
  execution: Doc<"one_setup_executions">,
  job: Doc<"jobs"> | null,
  site: Doc<"sites">,
): boolean {
  if (
    !job ||
    job.siteId !== execution.siteId ||
    job.type !== "plan"
  ) return false;
  const payload = job.payload && typeof job.payload === "object"
    ? job.payload as Record<string, unknown>
    : {};
  if (
    payload.manual !== true ||
    payload.reason !== "one_setup_initial_plan"
  ) return false;
  const stableRequestBinding = oneSetupInitialPlanJobBindingMatches({
    requestId: String(request._id),
    requestPlanJobId: request.initialPlanJobId
      ? String(request.initialPlanJobId)
      : undefined,
    requestReceiptVersion: request.initialPlanReceiptVersion,
    requestGeneration: request.initialPlanGeneration,
    jobId: String(job._id),
    payloadRequestId: payload.oneSetupRequestId,
    payloadReceiptVersion: payload.oneSetupInitialPlanReceiptVersion,
    payloadGeneration: payload.oneSetupInitialPlanGeneration,
    requestDomainRevisionSnapshot: request.domainRevisionSnapshot,
    payloadCanonicalDomainRevision:
      payload.oneSetupCanonicalDomainRevision,
    currentCanonicalDomainRevision: siteCanonicalDomainRevision(site),
    legacyUnstampedAllowed: siteUsesLegacyDomainReceipts(site),
  });
  return stableRequestBinding;
}

async function settleTerminalPlan(
  ctx: MutationCtx,
  site: Doc<"sites">,
  request: Doc<"managed_provisioning_requests">,
  execution: Doc<"one_setup_executions">,
  job: Doc<"jobs">,
): Promise<
  | { state: "completed"; topicCount: number }
  | { state: "blocked"; blockerCode: string; topicCount?: number }
  | {
      state: "in_progress";
      planJobId: Id<"jobs">;
      recoveryWaiting?: true;
    }
> {
  const timestamp = Date.now();
  if (job.status === "failed") {
    const recovery = await failedPlanRecoveryDecision(ctx, {
      site,
      request,
      job,
    });
    if (recovery.kind === "recoverable") {
      const existingRecoveryWatch =
        execution.status === "plan_queued" &&
        execution.blockerCode === recovery.blockerCode &&
        Number.isSafeInteger(execution.planSettlementWatchGeneration) &&
        (execution.planSettlementWatchGeneration ?? 0) > 0 &&
        Number.isSafeInteger(execution.planSettlementWatchAttempt) &&
        (execution.planSettlementWatchAttempt ?? -1) >= 0 &&
        Number.isSafeInteger(execution.planSettlementNextAt) &&
        (execution.planSettlementNextAt ?? -1) >= 0;
      if (existingRecoveryWatch) {
        return {
          state: "in_progress",
          planJobId: job._id,
          recoveryWaiting: true,
        };
      }
      const nextAt = Math.max(timestamp, recovery.eligibleAt);
      const recoveryWatchGeneration = nextOneSetupWatchGeneration(
        execution.planSettlementWatchGeneration,
      );
      await ctx.db.patch(execution._id, {
        status: "plan_queued",
        blockerCode: recovery.blockerCode,
        claimNonce: undefined,
        leaseExpiresAt: undefined,
        claimWatchAttempt: undefined,
        claimWatchNextAt: undefined,
        pendingResumeAttempt: undefined,
        pendingResumeNextAt: undefined,
        bootstrapAuthorizationWatchAttempt: undefined,
        bootstrapAuthorizationNextAt: undefined,
        planSettlementWatchGeneration: recoveryWatchGeneration,
        planSettlementWatchAttempt: 0,
        planSettlementNextAt: nextAt,
        completedAt: undefined,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAt(
        nextAt,
        internal.oneSetupExecutions.recoverFailedInitialPlanReceipt,
        {
          requestId: request._id,
          planJobId: job._id,
          expectedExecutionId: execution._id,
          expectedConfigurationRevision: execution.configurationRevision,
          recoveryWatchGeneration,
          authorizationWatchAttempt: 0,
        },
      );
      return {
        state: "in_progress",
        planJobId: job._id,
        recoveryWaiting: true,
      };
    }
    await ctx.db.patch(
      execution._id,
      oneSetupExecutionTerminalPatch({
        status: "blocked",
        blockerCode: recovery.blockerCode,
        timestamp,
      }),
    );
    return { state: "blocked", blockerCode: recovery.blockerCode };
  }
  const result = job.result && typeof job.result === "object"
    ? job.result as Record<string, unknown>
    : {};
  const settlement = oneSetupPlanSettlement({
    jobStatus: job.status,
    resultCount: result.count,
  });
  if (settlement.state === "completed") {
    await ctx.db.patch(execution._id, {
      ...oneSetupExecutionTerminalPatch({
        status: "completed",
        timestamp,
      }),
      topicCount: settlement.topicCount,
    });
    return {
      state: "completed",
      topicCount: settlement.topicCount,
    };
  }
  if (settlement.state === "blocked") {
    await ctx.db.patch(execution._id, {
      ...oneSetupExecutionTerminalPatch({
        status: "blocked",
        blockerCode: settlement.blockerCode,
        timestamp,
      }),
      topicCount: settlement.topicCount,
    });
    return {
      state: "blocked",
      blockerCode: settlement.blockerCode,
      topicCount: settlement.topicCount,
    };
  }
  return { state: "in_progress", planJobId: job._id };
}

async function armPlanSettlementWatch(
  ctx: MutationCtx,
  args: {
    execution: Doc<"one_setup_executions">;
    requestId: Id<"managed_provisioning_requests">;
    planJobId: Id<"jobs">;
    previousGeneration?: number;
    attempt?: number;
  },
): Promise<{ generation: number; attempt: number; nextAt: number }> {
  const timestamp = Date.now();
  const generation = args.previousGeneration === undefined
    ? nextOneSetupWatchGeneration(
      args.execution.planSettlementWatchGeneration,
    )
    : args.previousGeneration;
  const attempt = args.attempt ?? 1;
  const nextAt = timestamp + ONE_SETUP_PLAN_SETTLEMENT_RECHECK_MS;
  await ctx.db.patch(args.execution._id, {
    status: "plan_queued",
    claimNonce: undefined,
    leaseExpiresAt: undefined,
    claimWatchAttempt: undefined,
    claimWatchNextAt: undefined,
    pendingResumeAttempt: undefined,
    pendingResumeNextAt: undefined,
    bootstrapAuthorizationWatchAttempt: undefined,
    bootstrapAuthorizationNextAt: undefined,
    blockerCode: "plan_in_progress",
    planSettlementWatchGeneration: generation,
    planSettlementWatchAttempt: attempt,
    planSettlementNextAt: nextAt,
    updatedAt: timestamp,
  });
  await ctx.scheduler.runAt(
    nextAt,
    internal.oneSetupExecutions.reconcileCurrentPlanJob,
    {
      requestId: args.requestId,
      planJobId: args.planJobId,
      expectedExecutionId: args.execution._id,
      expectedConfigurationRevision: args.execution.configurationRevision,
      watchGeneration: generation,
      watchAttempt: attempt,
    },
  );
  return { generation, attempt, nextAt };
}

export const claim = internalMutation({
  args: {
    siteId: v.id("sites"),
    requestId: v.id("managed_provisioning_requests"),
    configurationRevision: v.number(),
    claimNonce: v.string(),
    expectedExecutionId: v.optional(v.id("one_setup_executions")),
    claimRecoveryAttempt: v.optional(v.number()),
    expectedClaimWatchGeneration: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.configurationRevision) ||
      args.configurationRevision <= 0 ||
      !args.claimNonce ||
      (
        (args.claimRecoveryAttempt === undefined) !==
          (args.expectedClaimWatchGeneration === undefined)
      ) ||
      (args.claimRecoveryAttempt !== undefined && !args.expectedExecutionId) ||
      (args.expectedClaimWatchGeneration !== undefined &&
        (
          !Number.isSafeInteger(args.expectedClaimWatchGeneration) ||
          args.expectedClaimWatchGeneration <= 0
        )) ||
      (args.claimRecoveryAttempt !== undefined &&
        (
          !Number.isSafeInteger(args.claimRecoveryAttempt) ||
          args.claimRecoveryAttempt < 1 ||
          args.claimRecoveryAttempt >
            ONE_SETUP_CLAIM_WATCHDOG_MAX_RECOVERIES
        ))
    ) throw new Error("Invalid one-setup execution claim");
    const { request, site } = await activeRequestContext(ctx, args);
    const existing = await ctx.db
      .query("one_setup_executions")
      .withIndex("by_request_configuration", (q) =>
        q.eq("requestId", args.requestId).eq(
          "configurationRevision",
          args.configurationRevision,
        )
      )
      .unique();
    const timestamp = Date.now();
    if (!existing) {
      if (args.expectedExecutionId || args.claimRecoveryAttempt !== undefined) {
        throw new Error("The exact one-setup execution no longer exists");
      }
      if (!oneSetupConfigurationRevisionIsCurrent({
        expected: args.configurationRevision,
        actual: request.configurationRevision ?? 0,
      })) {
        throw new Error("One-setup owner configuration changed before execution");
      }
      const executionId = await ctx.db.insert("one_setup_executions", {
        siteId: args.siteId,
        requestId: args.requestId,
        configurationRevision: args.configurationRevision,
        ownerAccountKey: request.ownerAccountKey,
        domainSnapshot: request.domainSnapshot,
        domainRevisionSnapshot: request.domainRevisionSnapshot,
        automationMode: request.automationMode,
        requestedCadencePerWeek: request.requestedCadencePerWeek,
        publisherMode: request.publisher.mode,
        searchMeasurementMode: request.searchMeasurement.mode,
        outreachMailboxMode: request.outreachMailbox.mode,
        status: "running",
        claimNonce: args.claimNonce,
        leaseExpiresAt: timestamp + ONE_SETUP_EXECUTION_LEASE_MS,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const leaseExpiresAt = timestamp + ONE_SETUP_EXECUTION_LEASE_MS;
      await armClaimWatchdog(ctx, {
        executionId,
        requestId: args.requestId,
        configurationRevision: args.configurationRevision,
        claimNonce: args.claimNonce,
        leaseExpiresAt,
        recoveryAttempt: 0,
      });
      return {
        claimed: true as const,
        executionId,
        status: "running" as const,
      };
    }
    if (
      args.expectedExecutionId && existing._id !== args.expectedExecutionId
    ) {
      throw new Error("One-setup recovery crossed its exact execution");
    }
    if (
      args.expectedClaimWatchGeneration !== undefined &&
      (
        existing.claimWatchGeneration !==
          args.expectedClaimWatchGeneration ||
        existing.claimWatchAttempt !== args.claimRecoveryAttempt
      )
    ) {
      throw new Error("One-setup recovery dispatch was superseded");
    }
    if (
      existing.siteId !== args.siteId ||
      !requestMatchesExecution(request, existing, site)
    ) {
      throw new Error("One-setup execution no longer matches its request");
    }
    const disposition = oneSetupExecutionClaimDisposition({
      status: existing.status,
      hasPlanJob: existing.planJobId !== undefined,
      claimNonce: existing.claimNonce,
      leaseExpiresAt: existing.leaseExpiresAt,
      now: timestamp,
    });
    if (disposition.kind === "terminal") {
      return {
        claimed: false as const,
        executionId: existing._id,
        status: disposition.status,
        planJobId: existing.planJobId,
        topicCount: existing.topicCount,
        blockerCode: existing.blockerCode,
        crawlCompletedAt: existing.crawlCompletedAt,
      };
    }
    if (disposition.kind === "in_progress") {
      return {
        claimed: false as const,
        executionId: existing._id,
        status: "in_progress" as const,
        planJobId: existing.planJobId,
        crawlCompletedAt: existing.crawlCompletedAt,
      };
    }
    const leaseExpiresAt = timestamp + ONE_SETUP_EXECUTION_LEASE_MS;
    const recoveryAttempt = args.claimRecoveryAttempt ??
      existing.claimWatchAttempt ?? 0;
    await ctx.db.patch(existing._id, {
      status: existing.planJobId ? "plan_queued" : "running",
      claimNonce: args.claimNonce,
      leaseExpiresAt,
      blockerCode: undefined,
      pendingResumeNextAt: undefined,
      bootstrapAuthorizationWatchAttempt: undefined,
      bootstrapAuthorizationNextAt: undefined,
      updatedAt: timestamp,
    });
    await armClaimWatchdog(ctx, {
      executionId: existing._id,
      requestId: args.requestId,
      configurationRevision: args.configurationRevision,
      claimNonce: args.claimNonce,
      leaseExpiresAt,
      previousGeneration: existing.claimWatchGeneration,
      recoveryAttempt,
    });
    return {
      claimed: true as const,
      executionId: existing._id,
      status: existing.planJobId
        ? "plan_queued" as const
        : "running" as const,
      planJobId: existing.planJobId,
      crawlCompletedAt: existing.crawlCompletedAt,
    };
  },
});

/**
 * Provider-free bootstrap armed by the owner-save transaction itself. It
 * closes the gap where the save commits but the browser disappears before it
 * invokes the public action. The composite request/configuration index makes a
 * simultaneous UI claim and this bootstrap converge on one execution row.
 */
export const bootstrapSavedExecution = internalMutation({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    configurationRevision: v.number(),
    authorizationRecheckAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      (request.configurationRevision ?? 0) !== args.configurationRevision
    ) return { state: "request_superseded" as const };
    let context: Awaited<ReturnType<typeof receiptRequestContext>>;
    try {
      context = await receiptRequestContext(ctx, {
        siteId: request.siteId,
        requestId: request._id,
      });
    } catch {
      return { state: "request_stale" as const };
    }
    let execution = await ctx.db
      .query("one_setup_executions")
      .withIndex("by_request_configuration", (q) =>
        q.eq("requestId", request._id).eq(
          "configurationRevision",
          args.configurationRevision,
        )
      )
      .unique();
    if (
      execution &&
      (
        execution.siteId !== request.siteId ||
        !requestMatchesExecution(context.request, execution, context.site)
      )
    ) return { state: "execution_superseded" as const };
    const timestamp = Date.now();
    // Creating the exact receipt is provider-free. Do it before checking
    // execution entitlement so every committed owner save has durable state
    // to inspect and a future authorization wake can address this same row.
    if (!execution) {
      const executionId = await ctx.db.insert("one_setup_executions", {
        siteId: context.site._id,
        requestId: context.request._id,
        configurationRevision: args.configurationRevision,
        ownerAccountKey: context.request.ownerAccountKey,
        domainSnapshot: context.request.domainSnapshot,
        domainRevisionSnapshot: context.request.domainRevisionSnapshot,
        automationMode: context.request.automationMode,
        requestedCadencePerWeek: context.request.requestedCadencePerWeek,
        publisherMode: context.request.publisher.mode,
        searchMeasurementMode: context.request.searchMeasurement.mode,
        outreachMailboxMode: context.request.outreachMailbox.mode,
        status: "pending",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      execution = await ctx.db.get(executionId);
      if (!execution) throw new Error("Bootstrapped execution disappeared");
    }
    if (
      args.authorizationRecheckAttempt !== undefined
        ? execution.bootstrapAuthorizationWatchAttempt !==
          args.authorizationRecheckAttempt
        : execution.bootstrapAuthorizationWatchAttempt !== undefined
    ) return { state: "authorization_watch_superseded" as const };
    if (
      !execution.planJobId &&
      context.request.initialPlanJobId &&
      context.request.initialPlanContextFingerprint ===
        oneSetupInitialPlanContextFingerprint(context.site)
    ) {
      const stableJob = await ctx.db.get(context.request.initialPlanJobId);
      if (
        stableJob &&
        planBindingMatches(
          context.request,
          execution,
          stableJob,
          context.site,
        )
      ) {
        await ctx.db.patch(execution._id, {
          status: "plan_queued",
          planJobId: stableJob._id,
          blockerCode: undefined,
          bootstrapAuthorizationWatchAttempt: undefined,
          bootstrapAuthorizationNextAt: undefined,
          updatedAt: timestamp,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.oneSetupExecutions.reconcileCurrentPlanJob,
          { requestId: context.request._id, planJobId: stableJob._id },
        );
        if (["done", "failed"].includes(stableJob.status)) {
          return {
            state: "stable_receipt_adopted" as const,
            executionId: execution._id,
            planJobId: stableJob._id,
            jobStatus: stableJob.status,
          };
        }
        // A pending J can exist when the prior configuration's action died
        // immediately after its atomic queue/bind mutation. Reconciliation
        // watches terminal state but does not execute provider work, so keep
        // flowing into the authorized exact action+watchdog handoff below.
        // A running J follows the same path harmlessly: the action observes it
        // in progress and the immediate receipt watcher owns final settlement.
        execution = await ctx.db.get(execution._id);
        if (!execution) throw new Error("Adopted execution disappeared");
      }
    }
    if (execution.planJobId) {
      const job = await ctx.db.get(execution.planJobId);
      if (
        job &&
        planBindingMatches(context.request, execution, job, context.site) &&
        ["done", "failed"].includes(job.status)
      ) {
        await ctx.db.patch(execution._id, {
          bootstrapAuthorizationWatchAttempt: undefined,
          bootstrapAuthorizationNextAt: undefined,
          updatedAt: timestamp,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.oneSetupExecutions.reconcileCurrentPlanJob,
          { requestId: context.request._id, planJobId: job._id },
        );
        return { state: "terminal_receipt_scheduled" as const };
      }
    }
    if (["completed", "blocked"].includes(execution.status)) {
      return { state: execution.status as "completed" | "blocked" };
    }
    if (
      execution.claimNonce &&
      (execution.leaseExpiresAt ?? 0) > timestamp
    ) return { state: "claim_active" as const };
    if (!(await siteExecutionAuthorized(ctx, context.site))) {
      const attempt = (args.authorizationRecheckAttempt ?? 0) + 1;
      if (attempt > ONE_SETUP_PLAN_SETTLEMENT_MAX_ATTEMPTS) {
        const blockerCode =
          "setup_bootstrap_authorization_watch_exhausted";
        await ctx.db.patch(
          execution._id,
          oneSetupExecutionTerminalPatch({
            status: "blocked",
            blockerCode,
            timestamp,
          }),
        );
        return {
          state: "authorization_watch_exhausted" as const,
          blockerCode,
        };
      }
      const nextAt = timestamp + ONE_SETUP_CLAIM_UNAUTHORIZED_RECHECK_MS;
      await ctx.db.patch(execution._id, {
        blockerCode: "setup_execution_not_authorized",
        bootstrapAuthorizationWatchAttempt: attempt,
        bootstrapAuthorizationNextAt: nextAt,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAt(
        nextAt,
        internal.oneSetupExecutions.bootstrapSavedExecution,
        {
          requestId: request._id,
          configurationRevision: args.configurationRevision,
          authorizationRecheckAttempt: attempt,
        },
      );
      return { state: "authorization_wait" as const, nextAt };
    }
    const recoveryAttempt = (execution.claimWatchAttempt ?? 0) + 1;
    if (recoveryAttempt > ONE_SETUP_CLAIM_WATCHDOG_MAX_RECOVERIES) {
      const blockerCode = "setup_bootstrap_dispatch_watchdog_exhausted";
      await ctx.db.patch(
        execution._id,
        oneSetupExecutionTerminalPatch({
          status: "blocked",
          blockerCode,
          timestamp,
        }),
      );
      return {
        state: "dispatch_watch_exhausted" as const,
        blockerCode,
      };
    }
    const dispatch = await scheduleExactResumeWithWatchdog(ctx, {
      execution,
      recoveryAttempt,
    });
    return {
      state: "execution_bootstrapped" as const,
      executionId: execution._id,
      ...dispatch,
    };
  },
});

/**
 * Exact claim-death recovery. The wake is armed atomically with the claim, so
 * a process dying before it binds J cannot require another browser click. A
 * terminal J is always reconciled through the receipt-only path; scheduling
 * new work still requires current execution authorization.
 */
export const recoverExpiredClaim = internalMutation({
  args: {
    executionId: v.id("one_setup_executions"),
    requestId: v.id("managed_provisioning_requests"),
    configurationRevision: v.number(),
    claimNonce: v.string(),
    watchGeneration: v.number(),
    recoveryAttempt: v.number(),
    authorizationRecheckAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (
      !execution ||
      execution.requestId !== args.requestId ||
      execution.configurationRevision !== args.configurationRevision ||
      execution.claimNonce !== args.claimNonce ||
      execution.claimWatchGeneration !== args.watchGeneration ||
      execution.claimWatchAttempt !== args.recoveryAttempt
    ) return { state: "watch_superseded" as const };
    if (["completed", "blocked"].includes(execution.status)) {
      return { state: execution.status as "completed" | "blocked" };
    }
    let context: Awaited<ReturnType<typeof receiptRequestContext>>;
    try {
      context = await receiptRequestContext(ctx, {
        siteId: execution.siteId,
        requestId: execution.requestId,
      });
    } catch {
      return { state: "request_stale" as const };
    }
    if (!requestMatchesExecution(context.request, execution, context.site)) {
      return { state: "execution_superseded" as const };
    }
    const timestamp = Date.now();
    if (execution.planJobId) {
      const job = await ctx.db.get(execution.planJobId);
      if (
        job &&
        planBindingMatches(context.request, execution, job, context.site) &&
        ["done", "failed"].includes(job.status)
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.oneSetupExecutions.reconcileCurrentPlanJob,
          { requestId: context.request._id, planJobId: job._id },
        );
        return { state: "terminal_receipt_scheduled" as const };
      }
    }
    if ((execution.leaseExpiresAt ?? 0) > timestamp) {
      const nextAt = execution.leaseExpiresAt! + 1_000;
      await ctx.db.patch(execution._id, { claimWatchNextAt: nextAt });
      await ctx.scheduler.runAt(
        nextAt,
        internal.oneSetupExecutions.recoverExpiredClaim,
        args,
      );
      return { state: "lease_active" as const, nextAt };
    }
    if (
      args.recoveryAttempt >= ONE_SETUP_CLAIM_WATCHDOG_MAX_RECOVERIES
    ) {
      const blockerCode = "setup_claim_watchdog_exhausted";
      await ctx.db.patch(
        execution._id,
        oneSetupExecutionTerminalPatch({
          status: "blocked",
          blockerCode,
          timestamp,
        }),
      );
      return { state: "watch_exhausted" as const, blockerCode };
    }
    if (!(await siteExecutionAuthorized(ctx, context.site))) {
      const recheckAttempt = (args.authorizationRecheckAttempt ?? 0) + 1;
      if (recheckAttempt > ONE_SETUP_PLAN_SETTLEMENT_MAX_ATTEMPTS) {
        const blockerCode =
          "setup_claim_authorization_watch_exhausted";
        await ctx.db.patch(
          execution._id,
          oneSetupExecutionTerminalPatch({
            status: "blocked",
            blockerCode,
            timestamp,
          }),
        );
        return {
          state: "authorization_watch_exhausted" as const,
          blockerCode,
        };
      }
      const nextAt = timestamp + ONE_SETUP_CLAIM_UNAUTHORIZED_RECHECK_MS;
      await ctx.db.patch(execution._id, {
        blockerCode: "setup_execution_not_authorized",
        claimWatchNextAt: nextAt,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAt(
        nextAt,
        internal.oneSetupExecutions.recoverExpiredClaim,
        { ...args, authorizationRecheckAttempt: recheckAttempt },
      );
      return { state: "authorization_wait" as const, nextAt };
    }
    const dispatch = await scheduleExactResumeWithWatchdog(ctx, {
      execution,
      recoveryAttempt: args.recoveryAttempt + 1,
    });
    return { state: "recovery_scheduled" as const, ...dispatch };
  },
});

/** Successor mutation for an action that may have died before claiming. */
export const recoverScheduledResumeDispatch = internalMutation({
  args: {
    executionId: v.id("one_setup_executions"),
    requestId: v.id("managed_provisioning_requests"),
    configurationRevision: v.number(),
    watchGeneration: v.number(),
    recoveryAttempt: v.number(),
    authorizationRecheckAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (
      !execution ||
      execution.requestId !== args.requestId ||
      execution.configurationRevision !== args.configurationRevision ||
      execution.claimWatchGeneration !== args.watchGeneration ||
      execution.claimWatchAttempt !== args.recoveryAttempt ||
      execution.claimNonce
    ) return { state: "dispatch_superseded" as const };
    if (["completed", "blocked"].includes(execution.status)) {
      return { state: execution.status as "completed" | "blocked" };
    }
    let context: Awaited<ReturnType<typeof receiptRequestContext>>;
    try {
      context = await receiptRequestContext(ctx, {
        siteId: execution.siteId,
        requestId: execution.requestId,
      });
    } catch {
      return { state: "request_stale" as const };
    }
    if (!requestMatchesExecution(context.request, execution, context.site)) {
      return { state: "execution_superseded" as const };
    }
    if (execution.planJobId) {
      const job = await ctx.db.get(execution.planJobId);
      if (
        job &&
        planBindingMatches(context.request, execution, job, context.site) &&
        ["done", "failed"].includes(job.status)
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.oneSetupExecutions.reconcileCurrentPlanJob,
          { requestId: context.request._id, planJobId: job._id },
        );
        return { state: "terminal_receipt_scheduled" as const };
      }
    }
    const timestamp = Date.now();
    if (!(await siteExecutionAuthorized(ctx, context.site))) {
      const recheckAttempt = (args.authorizationRecheckAttempt ?? 0) + 1;
      if (recheckAttempt > ONE_SETUP_PLAN_SETTLEMENT_MAX_ATTEMPTS) {
        const blockerCode =
          "setup_resume_dispatch_authorization_watch_exhausted";
        await ctx.db.patch(
          execution._id,
          oneSetupExecutionTerminalPatch({
            status: "blocked",
            blockerCode,
            timestamp,
          }),
        );
        return {
          state: "authorization_watch_exhausted" as const,
          blockerCode,
        };
      }
      const nextAt = timestamp + ONE_SETUP_CLAIM_UNAUTHORIZED_RECHECK_MS;
      await ctx.db.patch(execution._id, {
        blockerCode: "setup_execution_not_authorized",
        claimWatchNextAt: nextAt,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAt(
        nextAt,
        internal.oneSetupExecutions.recoverScheduledResumeDispatch,
        { ...args, authorizationRecheckAttempt: recheckAttempt },
      );
      return { state: "authorization_wait" as const, nextAt };
    }
    if (
      args.recoveryAttempt >= ONE_SETUP_CLAIM_WATCHDOG_MAX_RECOVERIES
    ) {
      const blockerCode = "setup_resume_dispatch_watchdog_exhausted";
      await ctx.db.patch(
        execution._id,
        oneSetupExecutionTerminalPatch({
          status: "blocked",
          blockerCode,
          timestamp,
        }),
      );
      return { state: "dispatch_watch_exhausted" as const, blockerCode };
    }
    const dispatch = await scheduleExactResumeWithWatchdog(ctx, {
      execution,
      recoveryAttempt: args.recoveryAttempt + 1,
    });
    return { state: "dispatch_recovered" as const, ...dispatch };
  },
});

export const inspectPlan = internalQuery({
  args: { executionId: v.id("one_setup_executions") },
  handler: async (ctx, { executionId }) => {
    const execution = await ctx.db.get(executionId);
    if (!execution?.planJobId) return null;
    const [job, request, site] = await Promise.all([
      ctx.db.get(execution.planJobId),
      ctx.db.get(execution.requestId),
      ctx.db.get(execution.siteId),
    ]);
    if (
      !site ||
      !request ||
      !requestMatchesExecution(request, execution, site) ||
      !job ||
      !planBindingMatches(request, execution, job, site)
    ) throw new Error("One-setup plan binding changed");
    return { jobId: job._id, status: job.status };
  },
});

export const recordCrawlCompleted = internalMutation({
  args: {
    executionId: v.id("one_setup_executions"),
    claimNonce: v.string(),
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    const timestamp = Date.now();
    if (
      !execution ||
      execution.claimNonce !== args.claimNonce ||
      (execution.leaseExpiresAt ?? 0) <= timestamp ||
      !["running", "plan_queued"].includes(execution.status)
    ) return { updated: false as const };
    await ctx.db.patch(execution._id, {
      crawlCompletedAt: execution.crawlCompletedAt ?? timestamp,
      updatedAt: timestamp,
    });
    return { updated: true as const };
  },
});

export const releaseForRetry = internalMutation({
  args: {
    executionId: v.id("one_setup_executions"),
    claimNonce: v.string(),
    blockerCode: v.string(),
    retryAt: v.optional(v.number()),
    terminalBlocker: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution || execution.claimNonce !== args.claimNonce) {
      return { updated: false as const };
    }
    const timestamp = Date.now();
    const blockerCode = args.blockerCode.slice(0, 80);
    const receiptQuarantined =
      blockerCode === "legacy_initial_plan_execution_ambiguous" ||
      blockerCode === "legacy_initial_plan_receipt_unprovable" ||
      blockerCode === "initial_plan_receipt_partial" ||
      blockerCode === "stable_initial_plan_domain_receipt_unprovable";
    if (receiptQuarantined || args.terminalBlocker === true) {
      await ctx.db.patch(
        execution._id,
        oneSetupExecutionTerminalPatch({
          status: "blocked",
          blockerCode,
          timestamp,
        }),
      );
      return { updated: true as const, terminal: true as const };
    }
    const pendingResumeAttempt = (execution.pendingResumeAttempt ?? 0) + 1;
    const pendingResumeGeneration = nextOneSetupWatchGeneration(
      execution.pendingResumeGeneration,
    );
    if (
      args.retryAt !== undefined &&
      (!Number.isSafeInteger(args.retryAt) || args.retryAt < 0)
    ) throw new Error("Invalid one-setup retry deadline");
    const pendingResumeNextAt = args.retryAt === undefined
      ? timestamp + ONE_SETUP_PENDING_RESUME_RECHECK_MS
      : Math.max(timestamp + 1_000, args.retryAt);
    await ctx.db.patch(execution._id, {
      status: execution.planJobId ? "plan_queued" : "pending",
      claimNonce: undefined,
      leaseExpiresAt: undefined,
      claimWatchAttempt: undefined,
      claimWatchNextAt: undefined,
      blockerCode,
      pendingResumeGeneration,
      pendingResumeAttempt,
      pendingResumeNextAt,
      bootstrapAuthorizationWatchAttempt: undefined,
      bootstrapAuthorizationNextAt: undefined,
      planSettlementWatchAttempt: undefined,
      planSettlementNextAt: undefined,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAt(
      pendingResumeNextAt,
      internal.oneSetupExecutions.resumePendingExecution,
      {
        executionId: execution._id,
        requestId: execution.requestId,
        configurationRevision: execution.configurationRevision,
        resumeGeneration: pendingResumeGeneration,
        resumeAttempt: pendingResumeAttempt,
      },
    );
    return { updated: true as const, terminal: false as const };
  },
});

/** Bounded autonomous retry for a deliberately released current execution. */
export const resumePendingExecution = internalMutation({
  args: {
    executionId: v.id("one_setup_executions"),
    requestId: v.id("managed_provisioning_requests"),
    configurationRevision: v.number(),
    resumeGeneration: v.number(),
    resumeAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (
      !execution ||
      execution.requestId !== args.requestId ||
      execution.configurationRevision !== args.configurationRevision ||
      execution.pendingResumeGeneration !== args.resumeGeneration ||
      execution.pendingResumeAttempt !== args.resumeAttempt ||
      !["pending", "plan_queued"].includes(execution.status) ||
      execution.claimNonce
    ) return { state: "resume_superseded" as const };
    let context: Awaited<ReturnType<typeof receiptRequestContext>>;
    try {
      context = await receiptRequestContext(ctx, {
        siteId: execution.siteId,
        requestId: execution.requestId,
      });
    } catch {
      return { state: "request_stale" as const };
    }
    if (!requestMatchesExecution(context.request, execution, context.site)) {
      return { state: "execution_superseded" as const };
    }
    if (execution.planJobId) {
      const job = await ctx.db.get(execution.planJobId);
      if (
        job &&
        planBindingMatches(context.request, execution, job, context.site) &&
        ["done", "failed"].includes(job.status)
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.oneSetupExecutions.reconcileCurrentPlanJob,
          { requestId: context.request._id, planJobId: job._id },
        );
        return { state: "terminal_receipt_scheduled" as const };
      }
    }
    const timestamp = Date.now();
    if (args.resumeAttempt >= ONE_SETUP_PENDING_RESUME_MAX_ATTEMPTS) {
      const blockerCode = "setup_pending_resume_exhausted";
      await ctx.db.patch(
        execution._id,
        oneSetupExecutionTerminalPatch({
          status: "blocked",
          blockerCode,
          timestamp,
        }),
      );
      return { state: "resume_exhausted" as const, blockerCode };
    }
    if (!(await siteExecutionAuthorized(ctx, context.site))) {
      const nextAt = timestamp + ONE_SETUP_CLAIM_UNAUTHORIZED_RECHECK_MS;
      await ctx.db.patch(execution._id, {
        blockerCode: "setup_execution_not_authorized",
        pendingResumeAttempt: args.resumeAttempt + 1,
        pendingResumeNextAt: nextAt,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAt(
        nextAt,
        internal.oneSetupExecutions.resumePendingExecution,
        { ...args, resumeAttempt: args.resumeAttempt + 1 },
      );
      return { state: "authorization_wait" as const, nextAt };
    }
    const dispatch = await scheduleExactResumeWithWatchdog(ctx, {
      execution,
      recoveryAttempt: (execution.claimWatchAttempt ?? 0) + 1,
    });
    return { state: "resume_scheduled" as const, ...dispatch };
  },
});

export const settleFromPlan = internalMutation({
  args: {
    executionId: v.id("one_setup_executions"),
    claimNonce: v.string(),
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution || execution.claimNonce !== args.claimNonce) {
      return { state: "claim_lost" as const };
    }
    if (!execution.planJobId) {
      throw new Error("One-setup execution has no bound plan job");
    }
    // Settlement is provider-free and therefore remains legal through plan
    // parking or entitlement downgrade, but it must re-run the full receipt
    // lifecycle fence for deletion, owner, domain, and contract drift.
    const context = await receiptRequestContext(ctx, {
      siteId: execution.siteId,
      requestId: execution.requestId,
    });
    const job = await ctx.db.get(execution.planJobId);
    if (
      !requestMatchesExecution(context.request, execution, context.site) ||
      !job ||
      !planBindingMatches(context.request, execution, job, context.site)
    ) throw new Error("One-setup plan binding changed");
    const settled = await settleTerminalPlan(
      ctx,
      context.site,
      context.request,
      execution,
      job,
    );
    if (settled.state !== "in_progress") return settled;
    if (settled.recoveryWaiting) return settled;
    // The owner action may be observing a job started by the superseded
    // configuration. Arm an exact durable watcher before returning so the
    // current execution settles without another browser click.
    await armPlanSettlementWatch(ctx, {
      execution,
      requestId: context.request._id,
      planJobId: job._id,
    });
    return settled;
  },
});

/**
 * Rotate a failed stable receipt only when its linked reservation proves that
 * no paid call began. Every old J is fenced in the same transaction that
 * schedules the exact current execution; a successor is not reserved until
 * the execution reclaims under current authorization and its durable provider
 * deadline/exponential backoff has elapsed.
 */
export const recoverFailedInitialPlanReceipt = internalMutation({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    planJobId: v.id("jobs"),
    expectedExecutionId: v.id("one_setup_executions"),
    expectedConfigurationRevision: v.number(),
    recoveryWatchGeneration: v.number(),
    authorizationWatchAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.expectedConfigurationRevision) ||
      args.expectedConfigurationRevision <= 0 ||
      !Number.isSafeInteger(args.recoveryWatchGeneration) ||
      args.recoveryWatchGeneration <= 0 ||
      !Number.isSafeInteger(args.authorizationWatchAttempt) ||
      args.authorizationWatchAttempt < 0
    ) throw new Error("Invalid one-setup recovery watch receipt");
    const request = await ctx.db.get(args.requestId);
    if (!request) return { state: "request_missing" as const };
    let context: Awaited<ReturnType<typeof receiptRequestContext>>;
    try {
      context = await receiptRequestContext(ctx, {
        siteId: request.siteId,
        requestId: request._id,
      });
    } catch {
      return { state: "request_stale" as const };
    }
    const execution = await ctx.db.get(args.expectedExecutionId);
    if (
      !execution ||
      !oneSetupExecutionWatchIdentityMatches({
        expectedExecutionId: String(args.expectedExecutionId),
        expectedConfigurationRevision:
          args.expectedConfigurationRevision,
        actualExecutionId: String(execution._id),
        actualConfigurationRevision: execution.configurationRevision,
        currentConfigurationRevision:
          context.request.configurationRevision ?? 0,
      }) ||
      execution.requestId !== request._id
    ) return { state: "recovery_watch_superseded" as const };
    const job = await ctx.db.get(args.planJobId);
    if (
      execution.planJobId !== args.planJobId ||
      !requestMatchesExecution(context.request, execution, context.site) ||
      !job ||
      !planBindingMatches(context.request, execution, job, context.site)
    ) return { state: "receipt_superseded" as const };
    if (
      execution.planSettlementWatchGeneration !==
        args.recoveryWatchGeneration ||
      execution.planSettlementWatchAttempt !==
        args.authorizationWatchAttempt ||
      !Number.isSafeInteger(execution.planSettlementNextAt)
    ) return { state: "recovery_watch_superseded" as const };

    const recovery = await failedPlanRecoveryDecision(ctx, {
      site: context.site,
      request: context.request,
      job,
    });
    if (recovery.kind === "terminal") {
      const settled = await settleTerminalPlan(
        ctx,
        context.site,
        context.request,
        execution,
        job,
      );
      return settled.state === "blocked"
        ? { state: "terminal" as const, blockerCode: settled.blockerCode }
        : { state: "receipt_superseded" as const };
    }
    const timestamp = Date.now();
    if (recovery.eligibleAt > timestamp) {
      await ctx.db.patch(execution._id, {
        status: "plan_queued",
        blockerCode: recovery.blockerCode,
        planSettlementNextAt: recovery.eligibleAt,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAt(
        recovery.eligibleAt,
        internal.oneSetupExecutions.recoverFailedInitialPlanReceipt,
        args,
      );
      return {
        state: "waiting_eligible" as const,
        eligibleAt: recovery.eligibleAt,
      };
    }
    if (!(await siteExecutionAuthorized(ctx, context.site))) {
      const attempt = args.authorizationWatchAttempt + 1;
      if (attempt > ONE_SETUP_PLAN_SETTLEMENT_MAX_ATTEMPTS) {
        const blockerCode =
          "setup_initial_plan_recovery_authorization_watch_exhausted";
        await ctx.db.patch(
          execution._id,
          oneSetupExecutionTerminalPatch({
            status: "blocked",
            blockerCode,
            timestamp,
          }),
        );
        return {
          state: "authorization_watch_exhausted" as const,
          blockerCode,
        };
      }
      const nextAt = timestamp + ONE_SETUP_CLAIM_UNAUTHORIZED_RECHECK_MS;
      await ctx.db.patch(execution._id, {
        status: "plan_queued",
        blockerCode: recovery.blockerCode,
        planSettlementWatchAttempt: attempt,
        planSettlementNextAt: nextAt,
        updatedAt: timestamp,
      });
      await ctx.scheduler.runAt(
        nextAt,
        internal.oneSetupExecutions.recoverFailedInitialPlanReceipt,
        {
          requestId: request._id,
          planJobId: job._id,
          expectedExecutionId: execution._id,
          expectedConfigurationRevision: execution.configurationRevision,
          recoveryWatchGeneration: args.recoveryWatchGeneration,
          authorizationWatchAttempt: attempt,
        },
      );
      return { state: "authorization_wait" as const, nextAt };
    }

    const currentGeneration = context.request.initialPlanGeneration;
    if (!Number.isSafeInteger(currentGeneration) || (currentGeneration ?? 0) <= 0) {
      throw new Error("Stable one-setup recovery lost its generation");
    }
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    await ctx.db.patch(context.request._id, {
      initialPlanGeneration: currentGeneration! + 1,
      initialPlanJobId: undefined,
      initialPlanBoundAt: undefined,
      initialPlanRecoveryCount:
        (context.request.initialPlanRecoveryCount ?? 0) + 1,
      updatedAt: timestamp,
    });
    await ctx.db.patch(job._id, {
      payload: {
        ...payload,
        oneSetupRecoveryConsumedAt: timestamp,
      },
      updatedAt: timestamp,
    });
    await ctx.db.patch(execution._id, {
      status: "pending",
      planJobId: undefined,
      blockerCode: undefined,
      claimNonce: undefined,
      leaseExpiresAt: undefined,
      claimWatchAttempt: undefined,
      claimWatchNextAt: undefined,
      pendingResumeAttempt: undefined,
      pendingResumeNextAt: undefined,
      bootstrapAuthorizationWatchAttempt: undefined,
      bootstrapAuthorizationNextAt: undefined,
      planSettlementWatchAttempt: undefined,
      planSettlementNextAt: undefined,
      completedAt: undefined,
      updatedAt: timestamp,
    });
    const recoveredExecution = await ctx.db.get(execution._id);
    if (!recoveredExecution) {
      throw new Error("Recovered one-setup execution disappeared");
    }
    const dispatch = await scheduleExactResumeWithWatchdog(ctx, {
      execution: recoveredExecution,
      recoveryAttempt: 1,
    });
    return {
      state: "recovery_scheduled" as const,
      planGeneration: currentGeneration! + 1,
      ...dispatch,
    };
  },
});

/**
 * Provider-free reconciliation for the current saved configuration. Terminal
 * job mutations call this immediately; the bounded watcher is a durable
 * fallback for a lost action response or an older in-flight worker bundle.
 */
export const reconcileCurrentPlanJob = internalMutation({
  args: {
    requestId: v.id("managed_provisioning_requests"),
    planJobId: v.id("jobs"),
    expectedExecutionId: v.optional(v.id("one_setup_executions")),
    expectedConfigurationRevision: v.optional(v.number()),
    watchGeneration: v.optional(v.number()),
    watchAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const watchIdentityValues = [
      args.expectedExecutionId,
      args.expectedConfigurationRevision,
      args.watchGeneration,
      args.watchAttempt,
    ];
    const watchIdentityCount = watchIdentityValues.filter((value) =>
      value !== undefined
    ).length;
    if (
      (watchIdentityCount !== 0 && watchIdentityCount !== 4) ||
      (
        watchIdentityCount === 4 &&
        (
          !Number.isSafeInteger(args.expectedConfigurationRevision) ||
          (args.expectedConfigurationRevision ?? 0) <= 0 ||
          !Number.isSafeInteger(args.watchGeneration) ||
          (args.watchGeneration ?? 0) <= 0 ||
          !Number.isSafeInteger(args.watchAttempt) ||
          (args.watchAttempt ?? 0) <= 0
        )
      )
    ) throw new Error("Invalid one-setup settlement watch identity");
    const request = await ctx.db.get(args.requestId);
    if (!request) return { state: "request_missing" as const };
    let context: Awaited<ReturnType<typeof receiptRequestContext>>;
    try {
      context = await receiptRequestContext(ctx, {
        siteId: request.siteId,
        requestId: request._id,
      });
    } catch {
      return { state: "request_stale" as const };
    }
    const execution = args.expectedExecutionId
      ? await ctx.db.get(args.expectedExecutionId)
      : await ctx.db
        .query("one_setup_executions")
        .withIndex("by_request_configuration", (q) =>
          q.eq("requestId", request._id).eq(
            "configurationRevision",
            request.configurationRevision ?? 0,
          )
        )
        .unique();
    if (
      args.expectedExecutionId &&
      (
        !execution ||
        !oneSetupExecutionWatchIdentityMatches({
          expectedExecutionId: String(args.expectedExecutionId),
          expectedConfigurationRevision:
            args.expectedConfigurationRevision!,
          actualExecutionId: String(execution._id),
          actualConfigurationRevision: execution.configurationRevision,
          currentConfigurationRevision:
            context.request.configurationRevision ?? 0,
        }) ||
        execution.requestId !== request._id
      )
    ) return { state: "watch_superseded" as const };
    if (
      !execution ||
      execution.planJobId !== args.planJobId ||
      !requestMatchesExecution(context.request, execution, context.site)
    ) return { state: "execution_superseded" as const };
    if (execution.status === "completed") {
      return { state: "completed" as const };
    }
    if (
      args.watchGeneration !== undefined &&
      (
        execution.planSettlementWatchGeneration !== args.watchGeneration ||
        execution.planSettlementWatchAttempt !== args.watchAttempt
      )
    ) return { state: "watch_superseded" as const };

    const job = await ctx.db.get(args.planJobId);
    if (
      !job ||
      !planBindingMatches(context.request, execution, job, context.site)
    ) {
      return { state: "binding_superseded" as const };
    }
    // Operational watchdog exhaustion may have blocked this execution while
    // the immutable paid J was still running. A later terminal J remains truth
    // and must settle provider-free; a nonterminal J cannot clear the blocker.
    // Zero-spend recovery exhaustion is different: it already observed this
    // exact failed J, so a duplicate terminal wake cannot restart its exhausted
    // authorization watch.
    if (
      execution.status === "blocked" &&
      (
        !["done", "failed"].includes(job.status) ||
        (
          execution.blockerCode ===
            "setup_initial_plan_recovery_authorization_watch_exhausted" &&
          job.status === "failed"
        )
      )
    ) return { state: "blocked" as const };
    const settled = await settleTerminalPlan(
      ctx,
      context.site,
      context.request,
      execution,
      job,
    );
    if (settled.state !== "in_progress") return settled;
    if (settled.recoveryWaiting) return settled;

    const previousAttempt = args.watchAttempt ??
      execution.planSettlementWatchAttempt ?? 0;
    if (previousAttempt >= ONE_SETUP_PLAN_SETTLEMENT_MAX_ATTEMPTS) {
      const timestamp = Date.now();
      const blockerCode = "plan_settlement_watch_exhausted";
      await ctx.db.patch(
        execution._id,
        oneSetupExecutionTerminalPatch({
          status: "blocked",
          blockerCode,
          timestamp,
        }),
      );
      return { state: "watch_exhausted" as const, blockerCode };
    }
    const watch = await armPlanSettlementWatch(ctx, {
      execution,
      requestId: request._id,
      planJobId: job._id,
      previousGeneration: args.watchGeneration,
      attempt: previousAttempt + 1,
    });
    return { state: "in_progress" as const, ...watch };
  },
});
