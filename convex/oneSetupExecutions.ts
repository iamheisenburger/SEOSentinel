import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";

import { accountDeletionKey } from "./lib/accountDeletion.ts";
import { ONE_SETUP_CONTRACT_VERSION } from "./lib/oneSetup.ts";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance.ts";
import {
  oneSetupConfigurationRevisionIsCurrent,
  oneSetupExecutionClaimDisposition,
  oneSetupPlanSettlement,
  oneSetupTerminalReceiptSettlementAllowed,
} from "./lib/oneSetupExecution.ts";
import { oneSetupInitialPlanJobBindingMatches } from
  "./lib/oneSetupInitialPlan.ts";

export const ONE_SETUP_EXECUTION_LEASE_MS = 35 * 60 * 1000;
export const ONE_SETUP_PLAN_SETTLEMENT_RECHECK_MS = 30 * 1000;
export const ONE_SETUP_PLAN_SETTLEMENT_MAX_ATTEMPTS = 180;

function normalizedDomain(value: string): string | null {
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    return parsed.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
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
  const domainSnapshot = site?.canonicalDomain ??
    (site ? normalizedDomain(site.domain) : null);
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
): boolean {
  return execution.configurationRevision ===
      (request.configurationRevision ?? 0) &&
    execution.ownerAccountKey === request.ownerAccountKey &&
    execution.domainSnapshot === request.domainSnapshot &&
    execution.automationMode === request.automationMode &&
    execution.requestedCadencePerWeek === request.requestedCadencePerWeek &&
    execution.publisherMode === request.publisher.mode &&
    execution.searchMeasurementMode === request.searchMeasurement.mode &&
    execution.outreachMailboxMode === request.outreachMailbox.mode;
}

function planBindingMatches(
  request: Doc<"managed_provisioning_requests">,
  execution: Doc<"one_setup_executions">,
  job: Doc<"jobs"> | null,
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
  const exactExecutionBinding =
    String(payload.oneSetupExecutionId ?? "") === String(execution._id) &&
    payload.oneSetupConfigurationRevision === execution.configurationRevision;
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
  });
  return exactExecutionBinding || stableRequestBinding;
}

async function settleTerminalPlan(
  ctx: MutationCtx,
  execution: Doc<"one_setup_executions">,
  job: Doc<"jobs">,
): Promise<
  | { state: "completed"; topicCount: number }
  | { state: "blocked"; blockerCode: string; topicCount?: number }
  | { state: "in_progress"; planJobId: Id<"jobs"> }
> {
  const timestamp = Date.now();
  const result = job.result && typeof job.result === "object"
    ? job.result as Record<string, unknown>
    : {};
  const settlement = oneSetupPlanSettlement({
    jobStatus: job.status,
    resultCount: result.count,
  });
  if (settlement.state === "completed") {
    await ctx.db.patch(execution._id, {
      status: "completed",
      topicCount: settlement.topicCount,
      blockerCode: undefined,
      claimNonce: undefined,
      leaseExpiresAt: undefined,
      planSettlementWatchAttempt: undefined,
      planSettlementNextAt: undefined,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      state: "completed",
      topicCount: settlement.topicCount,
    };
  }
  if (settlement.state === "blocked") {
    await ctx.db.patch(execution._id, {
      status: "blocked",
      blockerCode: settlement.blockerCode,
      topicCount: settlement.topicCount,
      claimNonce: undefined,
      leaseExpiresAt: undefined,
      planSettlementWatchAttempt: undefined,
      planSettlementNextAt: undefined,
      completedAt: timestamp,
      updatedAt: timestamp,
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
    ? (args.execution.planSettlementWatchGeneration ?? 0) + 1
    : args.previousGeneration;
  const attempt = args.attempt ?? 1;
  const nextAt = timestamp + ONE_SETUP_PLAN_SETTLEMENT_RECHECK_MS;
  await ctx.db.patch(args.execution._id, {
    status: "plan_queued",
    claimNonce: undefined,
    leaseExpiresAt: undefined,
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
  },
  handler: async (ctx, args) => {
    if (
      !Number.isSafeInteger(args.configurationRevision) ||
      args.configurationRevision <= 0 ||
      !args.claimNonce
    ) throw new Error("Invalid one-setup execution claim");
    const { request } = await activeRequestContext(ctx, args);
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
      return {
        claimed: true as const,
        executionId,
        status: "running" as const,
      };
    }
    if (
      existing.siteId !== args.siteId ||
      !requestMatchesExecution(request, existing)
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
      };
    }
    if (disposition.kind === "in_progress") {
      return {
        claimed: false as const,
        executionId: existing._id,
        status: "in_progress" as const,
        planJobId: existing.planJobId,
      };
    }
    await ctx.db.patch(existing._id, {
      status: existing.planJobId ? "plan_queued" : "running",
      claimNonce: args.claimNonce,
      leaseExpiresAt: timestamp + ONE_SETUP_EXECUTION_LEASE_MS,
      blockerCode: undefined,
      updatedAt: timestamp,
    });
    return {
      claimed: true as const,
      executionId: existing._id,
      status: existing.planJobId
        ? "plan_queued" as const
        : "running" as const,
      planJobId: existing.planJobId,
    };
  },
});

export const inspectPlan = internalQuery({
  args: { executionId: v.id("one_setup_executions") },
  handler: async (ctx, { executionId }) => {
    const execution = await ctx.db.get(executionId);
    if (!execution?.planJobId) return null;
    const [job, request] = await Promise.all([
      ctx.db.get(execution.planJobId),
      ctx.db.get(execution.requestId),
    ]);
    if (
      !request ||
      !requestMatchesExecution(request, execution) ||
      !job ||
      !planBindingMatches(request, execution, job)
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
  },
  handler: async (ctx, args) => {
    const execution = await ctx.db.get(args.executionId);
    if (!execution || execution.claimNonce !== args.claimNonce) {
      return { updated: false as const };
    }
    const timestamp = Date.now();
    await ctx.db.patch(execution._id, {
      status: execution.planJobId ? "plan_queued" : "pending",
      claimNonce: undefined,
      leaseExpiresAt: undefined,
      blockerCode: args.blockerCode.slice(0, 80),
      updatedAt: timestamp,
    });
    return { updated: true as const };
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
    const [job, request] = await Promise.all([
      ctx.db.get(execution.planJobId),
      ctx.db.get(execution.requestId),
    ]);
    if (
      !request ||
      !requestMatchesExecution(request, execution) ||
      !job ||
      !planBindingMatches(request, execution, job)
    ) throw new Error("One-setup plan binding changed");
    const settled = await settleTerminalPlan(ctx, execution, job);
    if (settled.state !== "in_progress") return settled;
    // The owner action may be observing a job started by the superseded
    // configuration. Arm an exact durable watcher before returning so the
    // current execution settles without another browser click.
    await armPlanSettlementWatch(ctx, {
      execution,
      requestId: request._id,
      planJobId: job._id,
    });
    return settled;
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
    watchGeneration: v.optional(v.number()),
    watchAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
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
    const execution = await ctx.db
      .query("one_setup_executions")
      .withIndex("by_request_configuration", (q) =>
        q.eq("requestId", request._id).eq(
          "configurationRevision",
          request.configurationRevision ?? 0,
        )
      )
      .unique();
    if (
      !execution ||
      execution.planJobId !== args.planJobId ||
      !requestMatchesExecution(context.request, execution)
    ) return { state: "execution_superseded" as const };
    if (["completed", "blocked"].includes(execution.status)) {
      return { state: execution.status as "completed" | "blocked" };
    }
    if (
      args.watchGeneration !== undefined &&
      (
        execution.planSettlementWatchGeneration !== args.watchGeneration ||
        execution.planSettlementWatchAttempt !== args.watchAttempt
      )
    ) return { state: "watch_superseded" as const };

    const job = await ctx.db.get(args.planJobId);
    if (!job || !planBindingMatches(context.request, execution, job)) {
      return { state: "binding_superseded" as const };
    }
    const settled = await settleTerminalPlan(ctx, execution, job);
    if (settled.state !== "in_progress") return settled;

    const previousAttempt = args.watchAttempt ??
      execution.planSettlementWatchAttempt ?? 0;
    if (previousAttempt >= ONE_SETUP_PLAN_SETTLEMENT_MAX_ATTEMPTS) {
      await ctx.db.patch(execution._id, {
        blockerCode: "plan_settlement_watch_exhausted",
        planSettlementWatchAttempt: undefined,
        planSettlementNextAt: undefined,
        updatedAt: Date.now(),
      });
      return { state: "watch_exhausted" as const };
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
