"use node";

import { internal } from "../_generated/api.js";
import type { Id } from "../_generated/dataModel.js";
import { internalAction } from "../_generated/server.js";
import type { ActionCtx } from "../_generated/server.js";
import { v } from "convex/values";
import { EXPECTED_CLICK_DEMAND_BACKFILL_VERSION } from
  "../lib/expectedClickDemandBackfill.ts";
import { EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION } from
  "../lib/expectedClickEvidenceBackfill.ts";
import { planExpectedClickFleetRecovery } from
  "../lib/expectedClickBackfillFleet.ts";

export type ExpectedClickBackfillFleetSiteState = {
  siteId: string;
  autopilotEnabled: boolean;
  expectedClickSchedulingEnabled: boolean;
  autopilotRolloutMode?: string;
  deleting: boolean;
};

export type ExpectedClickBackfillFleetPlan = {
  advance: boolean;
  failClosedReason?: string;
};

const SITE_JITTER_WINDOW_MS = 5 * 60 * 1000;
const RECOVERY_STALE_AFTER_MS = 10 * 60 * 1000;
const DISPATCH_RECEIPT_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** Pure rollout policy shared by dispatch and every fresh per-site recheck. */
export function planExpectedClickBackfillFleetSite(
  state: ExpectedClickBackfillFleetSiteState,
): ExpectedClickBackfillFleetPlan {
  if (state.deleting) return { advance: false, failClosedReason: "tenant_deleting" };
  if (!state.autopilotEnabled) {
    return { advance: false, failClosedReason: "autopilot_disabled" };
  }
  if (!state.expectedClickSchedulingEnabled) {
    return {
      advance: false,
      failClosedReason: "expected_click_scheduling_disabled",
    };
  }
  if (!["warm", "live"].includes(state.autopilotRolloutMode ?? "observe")) {
    return { advance: false, failClosedReason: "rollout_ineligible" };
  }
  return { advance: true };
}

/**
 * Stable daily jitter rotates reservation order across tenants and pages. It
 * prevents the same first page from winning a constrained shared ledger every
 * day while remaining deterministic across duplicate dispatcher invocations.
 */
export function expectedClickFleetJitterMs(
  siteId: string,
  utcDay: string,
  windowMs = SITE_JITTER_WINDOW_MS,
): number {
  const boundedWindow = Math.max(1, Math.floor(windowMs));
  let hash = 2_166_136_261;
  for (const character of `${utcDay}:${siteId}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash % boundedWindow;
}

function utcDay(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function utcHour(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 13);
}

function safeQueueReason(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("reason" in value)) {
    return undefined;
  }
  return typeof value.reason === "string" ? value.reason : undefined;
}

export async function scheduleExpectedClickFleetContinuation(
  schedule: () => Promise<unknown>,
  recordFailure: () => Promise<unknown>,
): Promise<boolean> {
  try {
    await schedule();
    return true;
  } catch {
    await recordFailure();
    return false;
  }
}

type SiteRunResult = {
  siteId: Id<"sites">;
  stage: "advance" | "evidence" | "recovery";
  status: "queued" | "skipped" | "failed" | "recovered";
  reason?: string;
  result?: unknown;
};

async function freshFleetState(
  ctx: ActionCtx,
  siteId: Id<"sites">,
): Promise<ExpectedClickBackfillFleetSiteState | null> {
  return ctx.runQuery(
    internal.sites.getExpectedClickBackfillFleetState,
    { siteId },
  ) as Promise<ExpectedClickBackfillFleetSiteState | null>;
}

async function resumeStalledDispatchRuns(ctx: ActionCtx): Promise<number> {
  const stale = await ctx.runQuery(
    internal.sites.listRecoverableExpectedClickFleetDispatchRuns,
    { staleBefore: Date.now() - RECOVERY_STALE_AFTER_MS },
  );
  if (stale.truncated) {
    console.error(
      "[expected-click-fleet] recoverable dispatch receipt limit exhausted",
    );
  }
  let resumed = 0;
  for (const run of stale.runs) {
    try {
      if (run.kind === "daily") {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.expectedClickBackfillFleet.dispatchFleet,
          { cursor: run.cursor, dispatchDay: run.dispatchKey },
        );
      } else if (run.kind === "recovery") {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.expectedClickBackfillFleet.dispatchRecoveryFleet,
          { cursor: run.cursor, dispatchHour: run.dispatchKey },
        );
      } else {
        console.error("[expected-click-fleet] invalid dispatch receipt kind");
        continue;
      }
      await ctx.runMutation(
        internal.sites.markExpectedClickFleetDispatchResumeScheduled,
        { runId: run.runId, cursor: run.cursor },
      );
      resumed += 1;
    } catch {
      await ctx.runMutation(
        internal.sites.recordExpectedClickFleetContinuationFailure,
        { runId: run.runId, cursor: run.cursor },
      );
      console.error("[expected-click-fleet] failed to resume dispatch receipt");
    }
  }
  return resumed;
}

/**
 * One daily paginated dispatcher. Every tenant is isolated and receives a
 * deterministic day-specific delay before competing for the shared ledger.
 */
export const dispatchFleet = internalAction({
  args: {
    cursor: v.optional(v.string()),
    dispatchDay: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, dispatchDay }): Promise<{
    scheduled: number;
    failed: number;
    scheduledNext: boolean;
  }> => {
    const day = dispatchDay ?? utcDay();
    const claim = await ctx.runMutation(
      internal.sites.beginExpectedClickFleetDispatchPage,
      { kind: "daily", dispatchKey: day, cursor },
    );
    if (!claim.claimed) {
      return { scheduled: 0, failed: 0, scheduledNext: false };
    }
    const page = await ctx.runQuery(
      internal.sites.listExpectedClickBackfillFleetPage,
      { cursor },
    );
    let scheduled = 0;
    let failed = 0;
    for (const state of page.page) {
      try {
        await ctx.scheduler.runAfter(
          expectedClickFleetJitterMs(String(state.siteId), day),
          internal.actions.expectedClickBackfillFleet.runSite,
          { siteId: state.siteId },
        );
        scheduled += 1;
      } catch {
        failed += 1;
        console.error(
          `[expected-click-fleet] failed to schedule tenant ${state.siteId}`,
        );
      }
    }
    const checkpoint = await ctx.runMutation(
      internal.sites.advanceExpectedClickFleetDispatchPage,
      {
        runId: claim.runId,
        kind: "daily",
        dispatchKey: day,
        expectedCursor: cursor,
        nextCursor: page.isDone ? undefined : page.continueCursor,
        isDone: page.isDone,
        scheduled,
        failed,
      },
    );
    let scheduledNext = false;
    if (!page.isDone && checkpoint.advanced) {
      scheduledNext = await scheduleExpectedClickFleetContinuation(
        () => ctx.scheduler.runAfter(
          1_000,
          internal.actions.expectedClickBackfillFleet.dispatchFleet,
          { cursor: page.continueCursor, dispatchDay: day },
        ),
        () => ctx.runMutation(
          internal.sites.recordExpectedClickFleetContinuationFailure,
          { runId: claim.runId, cursor: page.continueCursor },
        ),
      );
      if (!scheduledNext) {
        failed += 1;
        console.error("[expected-click-fleet] failed to schedule next fleet page");
      }
    }
    return { scheduled, failed, scheduledNext };
  },
});

/** Demand is always first. Fleet-origin completion transactionally chains evidence. */
export const runSite = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<SiteRunResult> => {
    try {
      const state = await freshFleetState(ctx, siteId);
      const plan = state ? planExpectedClickBackfillFleetSite(state) : null;
      if (!state || !plan?.advance) {
        return {
          siteId,
          stage: "advance",
          status: "skipped",
          reason: plan?.failClosedReason ?? "site_unavailable",
        };
      }
      const readiness = await ctx.runQuery(
        internal.expectedClickDemandBackfill.getFleetReadinessInternal,
        { siteId },
      );
      if (!readiness?.ready) {
        if (readiness?.continueToEvidence) {
          const result = await ctx.runAction(
            internal.actions.expectedClickBackfillFleet.runEvidenceSite,
            { siteId },
          );
          return { siteId, stage: "advance", status: "queued", result };
        }
        if (readiness?.actionable) {
          console.error(
            `[expected-click-fleet] demand blocked for tenant ${siteId}: ${readiness.reason}`,
          );
        }
        return {
          siteId,
          stage: "advance",
          status: "skipped",
          reason: readiness?.reason ?? "site_unavailable",
        };
      }
      const result = await ctx.runAction(
        internal.actions.expectedClickDemandBackfill
          .queueExpectedClickDemandBackfillFleet,
        { siteId, policyVersion: EXPECTED_CLICK_DEMAND_BACKFILL_VERSION },
      );
      if (safeQueueReason(result) === "no_eligible_legacy_topics") {
        const evidenceResult = await ctx.runAction(
          internal.actions.expectedClickBackfillFleet.runEvidenceSite,
          { siteId },
        );
        return { siteId, stage: "advance", status: "queued", result: evidenceResult };
      }
      return { siteId, stage: "advance", status: "queued", result };
    } catch {
      console.error(`[expected-click-fleet] demand failed closed for tenant ${siteId}`);
      return {
        siteId,
        stage: "advance",
        status: "failed",
        reason: "tenant_run_failed",
      };
    }
  },
});

/** Evidence can be invoked only by the demand chain or the no-demand branch. */
export const runEvidenceSite = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<SiteRunResult> => {
    try {
      const state = await freshFleetState(ctx, siteId);
      const plan = state ? planExpectedClickBackfillFleetSite(state) : null;
      if (!state || !plan?.advance) {
        return {
          siteId,
          stage: "evidence",
          status: "skipped",
          reason: plan?.failClosedReason ?? "site_unavailable",
        };
      }
      const readiness = await ctx.runQuery(
        internal.expectedClickEvidenceBackfill.getFleetReadinessInternal,
        { siteId },
      );
      if (!readiness?.ready) {
        if (readiness?.actionable) {
          console.error(
            `[expected-click-fleet] evidence blocked for tenant ${siteId}: ${readiness.reason}`,
          );
        }
        return {
          siteId,
          stage: "evidence",
          status: "skipped",
          reason: readiness?.reason ?? "site_unavailable",
        };
      }
      const result = await ctx.runAction(
        internal.actions.expectedClickEvidenceBackfill
          .queueExpectedClickEvidenceBackfillFleet,
        { siteId, policyVersion: EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION },
      );
      return { siteId, stage: "evidence", status: "queued", result };
    } catch {
      console.error(`[expected-click-fleet] evidence failed closed for tenant ${siteId}`);
      return {
        siteId,
        stage: "evidence",
        status: "failed",
        reason: "tenant_run_failed",
      };
    }
  },
});

/** Paginated recovery never creates a reservation or touches operator jobs. */
export const dispatchRecoveryFleet = internalAction({
  args: {
    cursor: v.optional(v.string()),
    dispatchHour: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, dispatchHour }): Promise<{
    scheduled: number;
    failed: number;
    scheduledNext: boolean;
    resumedDispatches: number;
  }> => {
    let resumedDispatches = 0;
    if (cursor === undefined && dispatchHour === undefined) {
      resumedDispatches = await resumeStalledDispatchRuns(ctx);
      await ctx.runMutation(
        internal.sites.pruneExpectedClickFleetDispatchRuns,
        { olderThan: Date.now() - DISPATCH_RECEIPT_RETENTION_MS },
      );
    }
    const hour = dispatchHour ?? utcHour();
    const claim = await ctx.runMutation(
      internal.sites.beginExpectedClickFleetDispatchPage,
      { kind: "recovery", dispatchKey: hour, cursor },
    );
    if (!claim.claimed) {
      return {
        scheduled: 0,
        failed: 0,
        scheduledNext: false,
        resumedDispatches,
      };
    }
    const page = await ctx.runQuery(
      internal.sites.listExpectedClickBackfillFleetPage,
      { cursor },
    );
    let scheduled = 0;
    let failed = 0;
    for (const state of page.page) {
      try {
        await ctx.scheduler.runAfter(
          expectedClickFleetJitterMs(String(state.siteId), utcDay(), 30_000),
          internal.actions.expectedClickBackfillFleet.recoverSite,
          { siteId: state.siteId },
        );
        scheduled += 1;
      } catch {
        failed += 1;
        console.error(
          `[expected-click-fleet] failed to schedule recovery for tenant ${state.siteId}`,
        );
      }
    }
    const checkpoint = await ctx.runMutation(
      internal.sites.advanceExpectedClickFleetDispatchPage,
      {
        runId: claim.runId,
        kind: "recovery",
        dispatchKey: hour,
        expectedCursor: cursor,
        nextCursor: page.isDone ? undefined : page.continueCursor,
        isDone: page.isDone,
        scheduled,
        failed,
      },
    );
    let scheduledNext = false;
    if (!page.isDone && checkpoint.advanced) {
      scheduledNext = await scheduleExpectedClickFleetContinuation(
        () => ctx.scheduler.runAfter(
          1_000,
          internal.actions.expectedClickBackfillFleet.dispatchRecoveryFleet,
          { cursor: page.continueCursor, dispatchHour: hour },
        ),
        () => ctx.runMutation(
          internal.sites.recordExpectedClickFleetContinuationFailure,
          { runId: claim.runId, cursor: page.continueCursor },
        ),
      );
      if (!scheduledNext) {
        failed += 1;
        console.error("[expected-click-fleet] failed to schedule next recovery page");
      }
    }
    return { scheduled, failed, scheduledNext, resumedDispatches };
  },
});

export const recoverSite = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<SiteRunResult> => {
    try {
      const state = await freshFleetState(ctx, siteId);
      if (!state || !planExpectedClickBackfillFleetSite(state).advance) {
        return {
          siteId,
          stage: "recovery",
          status: "skipped",
          reason: "rollout_ineligible",
        };
      }
      const [demand, evidence] = await Promise.all([
        ctx.runQuery(
          internal.expectedClickDemandBackfill.getFleetRecoveryInternal,
          { siteId, staleAfterMs: RECOVERY_STALE_AFTER_MS },
        ),
        ctx.runQuery(
          internal.expectedClickEvidenceBackfill.getFleetRecoveryInternal,
          { siteId, staleAfterMs: RECOVERY_STALE_AFTER_MS },
        ),
      ]);
      const recoveryPlan = planExpectedClickFleetRecovery([
        ...(demand
          ? [{
              phase: "demand" as const,
              action: demand.action,
              reason: demand.reason,
              actionable: "actionable" in demand
                ? demand.actionable
                : undefined,
              jobId: "jobId" in demand ? String(demand.jobId) : undefined,
              policyVersion: "policyVersion" in demand
                ? demand.policyVersion
                : undefined,
              createdAt: "createdAt" in demand
                ? demand.createdAt
                : undefined,
            }]
          : []),
        ...(evidence
          ? [{
              phase: "evidence" as const,
              action: evidence.action,
              reason: evidence.reason,
              actionable: "actionable" in evidence
                ? evidence.actionable
                : undefined,
              jobId: "jobId" in evidence ? String(evidence.jobId) : undefined,
              policyVersion: "policyVersion" in evidence
                ? evidence.policyVersion
                : undefined,
              createdAt: "createdAt" in evidence
                ? evidence.createdAt
                : undefined,
            }]
          : []),
      ]);
      if (recoveryPlan.action !== "recover") {
        if (recoveryPlan.action === "blocked" && recoveryPlan.actionable) {
          console.error(
            `[expected-click-fleet] ${recoveryPlan.phase ?? "fleet"} recovery blocked for tenant ${siteId}: ${recoveryPlan.reason}`,
          );
        }
        return {
          siteId,
          stage: "recovery",
          status: "skipped",
          reason: recoveryPlan.reason,
        };
      }
      if (recoveryPlan.phase === "demand") {
        const args = {
          siteId,
          jobId: recoveryPlan.jobId as Id<"expected_click_demand_jobs">,
          policyVersion: recoveryPlan.policyVersion,
          suppressEvidenceChain: true,
        };
        const result = recoveryPlan.mode === "process"
          ? await ctx.runAction(
              internal.actions.expectedClickDemandBackfill
                .processExpectedClickDemandBackfill,
              args,
            )
          : await ctx.runAction(
              internal.actions.expectedClickDemandBackfill
                .resumeExpectedClickDemandBackfill,
              args,
            );
        return { siteId, stage: "recovery", status: "recovered", result };
      }
      const args = {
        siteId,
        jobId: recoveryPlan.jobId as Id<"expected_click_evidence_jobs">,
        policyVersion: recoveryPlan.policyVersion,
      };
      const result = recoveryPlan.mode === "process"
        ? await ctx.runAction(
            internal.actions.expectedClickEvidenceBackfill
              .processExpectedClickEvidenceBackfill,
            args,
          )
        : await ctx.runAction(
            internal.actions.expectedClickEvidenceBackfill
              .resumeExpectedClickEvidenceBackfill,
            args,
          );
      return { siteId, stage: "recovery", status: "recovered", result };
    } catch {
      console.error(`[expected-click-fleet] recovery failed closed for tenant ${siteId}`);
      return {
        siteId,
        stage: "recovery",
        status: "failed",
        reason: "tenant_recovery_failed",
      };
    }
  },
});
