"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { assertDataForSeoAccountBalance } from "../lib/dataForSeoAccountBalance";
import { requiredPlanProviderBalanceMicroUsd } from "../lib/planProviderBudget";

/**
 * Operator-only wrapper for the versioned completed-plan bridge. An apply run
 * verifies that DataForSEO can fund the remaining $1 execution before the
 * mutation consumes worker ordinal two. The worker repeats the same free
 * preflight at the paid-call boundary.
 */
export const recoverCompletedUnderfilledPlanContinuation = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    recoveryVersion: v.number(),
    apply: v.boolean(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (!args.apply) {
      return await ctx.runMutation(
        internal.jobs.recoverCompletedUnderfilledPlanContinuation,
        args,
      );
    }
    const preview: { eligible?: boolean } = await ctx.runMutation(
      internal.jobs.recoverCompletedUnderfilledPlanContinuation,
      { ...args, apply: false },
    );
    if (preview.eligible !== true) return preview;
    await assertDataForSeoAccountBalance(
      requiredPlanProviderBalanceMicroUsd(),
    );
    return await ctx.runMutation(
      internal.jobs.recoverCompletedUnderfilledPlanContinuation,
      args,
    );
  },
});
