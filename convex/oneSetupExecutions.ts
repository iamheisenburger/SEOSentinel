import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

import { accountDeletionKey } from "./lib/accountDeletion.ts";
import { ONE_SETUP_CONTRACT_VERSION } from "./lib/oneSetup.ts";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance.ts";
import {
  oneSetupConfigurationRevisionIsCurrent,
  oneSetupExecutionClaimDisposition,
  oneSetupPlanSettlement,
} from "./lib/oneSetupExecution.ts";

export const ONE_SETUP_EXECUTION_LEASE_MS = 35 * 60 * 1000;

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
  const [site, request] = await Promise.all([
    ctx.db.get(args.siteId),
    ctx.db.get(args.requestId),
  ]);
  const domainSnapshot = site?.canonicalDomain ??
    (site ? normalizedDomain(site.domain) : null);
  if (
    !site?.userId ||
    !(await siteExecutionAuthorized(ctx, site)) ||
    !request ||
    request.siteId !== site._id ||
    request.ownerAccountKey !== accountDeletionKey(site.userId) ||
    request.domainSnapshot !== domainSnapshot ||
    request.contractVersion !== ONE_SETUP_CONTRACT_VERSION
  ) {
    throw new Error("One-setup execution lost its tenant request fence");
  }
  return { site, request };
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
    const payload = job?.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    if (
      !request ||
      (request.configurationRevision ?? 0) !==
        execution.configurationRevision ||
      !job ||
      job.siteId !== execution.siteId ||
      job.type !== "plan" ||
      String(payload.oneSetupExecutionId ?? "") !== String(execution._id) ||
      payload.oneSetupConfigurationRevision !== execution.configurationRevision
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
    const payload = job?.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    if (
      !request ||
      (request.configurationRevision ?? 0) !==
        execution.configurationRevision ||
      !job ||
      job.siteId !== execution.siteId ||
      job.type !== "plan" ||
      String(payload.oneSetupExecutionId ?? "") !== String(execution._id) ||
      payload.oneSetupConfigurationRevision !== execution.configurationRevision
    ) throw new Error("One-setup plan binding changed");
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
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        state: "completed" as const,
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
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        state: "blocked" as const,
        blockerCode: settlement.blockerCode,
        topicCount: settlement.topicCount,
      };
    }
    await ctx.db.patch(execution._id, {
      status: "plan_queued",
      claimNonce: undefined,
      leaseExpiresAt: undefined,
      blockerCode: "plan_in_progress",
      updatedAt: timestamp,
    });
    return { state: "in_progress" as const, planJobId: job._id };
  },
});
