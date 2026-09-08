import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { automaticSingleExecutionCheckpointTargetFromPayload } from "./lib/planProviderBudget.ts";
import { accountDeletionKey } from "./lib/accountDeletion.ts";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance.ts";
import { activeProviderBudgetAuthorization, MAX_APPROVED_PROVIDER_MONTHLY_CEILING_MICRO_USD, providerBudgetMonth,
  readProviderBudgetAuthorization } from "./lib/providerBudgetAuthorization.ts";
import { resolvePlanFromFeatures } from "./planLimits.ts";
import {
  PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
  providerAccountMonthlyCeilingMicroUsd,
  providerReservationConsumedMicroUsd,
} from "./lib/providerSpendReservation.ts";

const SITE_RESERVATION_READ_LIMIT = 500;

/** Read-only, exact-site lower bounds. Never inspect another site's billing
 * rows to diagnose this site. Shared account/fleet capacity is deliberately
 * NOT inferred from these values, even when the site's window is complete. */
export const getSiteReservationSnapshot = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site?.userId) throw new Error("Site owner unavailable");
    const snapshotAt = Date.now();
    const date = new Date(snapshotAt);
    const monthStartAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const dayStartAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const [entitlement, rows] = await Promise.all([
      ctx.db.query("account_plan_entitlements")
        .withIndex("by_user", q => q.eq("userId", site.userId!)).unique(),
      ctx.db.query("provider_spend_reservations")
        .withIndex("by_site_created", q => q.eq("siteId", siteId)
          .gte("createdAt", monthStartAt))
        .order("desc").take(SITE_RESERVATION_READ_LIMIT + 1),
    ]);
    const tier = resolvePlanFromFeatures(entitlement?.planFeatures ?? site.planFeatures ?? []).tier;
    const baseMonthlyCeilingMicroUsd = providerAccountMonthlyCeilingMicroUsd(tier);
    const authorization = await readProviderBudgetAuthorization(ctx, entitlement, site.userId,
      baseMonthlyCeilingMicroUsd, snapshotAt);
    const monthlyCeilingMicroUsd = authorization?.monthlyCeilingMicroUsd ?? baseMonthlyCeilingMicroUsd;
    let monthlyConsumedMicroUsd = 0;
    let approvedWindowConsumedMicroUsd = 0;
    let dailyConsumedMicroUsd = 0;
    let monthlyOriginalMicroUsd = 0;
    let settledCount = 0;
    let releasedCount = 0;
    let unmatchedOwnerCount = 0;
    for (const row of rows.slice(0, SITE_RESERVATION_READ_LIMIT)) {
      if (row.userId !== site.userId) { unmatchedOwnerCount++; continue; }
      if (row.releasedAt !== undefined) { releasedCount++; continue; }
      const consumed = providerReservationConsumedMicroUsd(row);
      monthlyOriginalMicroUsd += row.reservedMicroUsd;
      monthlyConsumedMicroUsd += consumed;
      if (authorization && row.createdAt >= authorization.approvedAt) approvedWindowConsumedMicroUsd += consumed;
      if (row.createdAt >= dayStartAt) dailyConsumedMicroUsd += consumed;
      if (row.settledAt !== undefined) settledCount++;
    }
    return {
      siteId, snapshotAt, dayStartAt, monthStartAt, tier,
      scope: "exact_site_current_owner_only" as const,
      accountAndFleetCapacity: "not_inspected" as const,
      siteWindowComplete: rows.length <= SITE_RESERVATION_READ_LIMIT,
      examined: Math.min(rows.length, SITE_RESERVATION_READ_LIMIT),
      unmatchedOwnerCount, releasedCount, settledCount,
      monthlyOriginalMicroUsd, monthlyConsumedMicroUsd, dailyConsumedMicroUsd,
      accountDailyCeilingMicroUsd: PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
      accountMonthlyCeilingMicroUsd: monthlyCeilingMicroUsd,
      baseMonthlyCeilingMicroUsd,
      approvedIncrementalLimitMicroUsd: authorization?.incrementalLimitMicroUsd,
      approvalStartedAt: authorization?.approvedAt,
      approvedWindowConsumedMicroUsd: authorization ? approvedWindowConsumedMicroUsd : undefined,
      approvalExpiresAt: authorization?.expiresAt,
      // Upper bounds only: the account may have reservations at other sites.
      accountDailyHeadroomAtMostMicroUsd: Math.max(0,
        PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD - dailyConsumedMicroUsd),
      accountMonthlyHeadroomAtMostMicroUsd: Math.max(0, Math.min(
        monthlyCeilingMicroUsd - monthlyConsumedMicroUsd,
        authorization ? authorization.incrementalLimitMicroUsd - approvedWindowConsumedMicroUsd : Infinity)),
    };
  },
});

/** Operator audit, never an admission decision. Every source read starts at
 * the explicitly supplied site index. A comparison reads only the second site
 * identity to establish shared ownership; it never enumerates that account's
 * other sites or reservations. No job payload, error, credential or owner ID
 * crosses this boundary. Terminal state alone is not proof of zero spend. */
export const getSiteReservationAudit = internalQuery({
  args: { siteId: v.id("sites"), comparisonSiteId: v.optional(v.id("sites")) },
  handler: async (ctx, { siteId, comparisonSiteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site?.userId) throw new Error("Site owner unavailable");
    const snapshotAt = Date.now();
    const date = new Date(snapshotAt);
    const monthStartAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    const resetAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const comparison = comparisonSiteId ? await ctx.db.get(comparisonSiteId) : null;
    const [entitlement, reservations, plans, onboardings, microSeeds, demand, evidence, authority] = await Promise.all([
      ctx.db.query("account_plan_entitlements")
        .withIndex("by_user", q => q.eq("userId", site.userId!)).unique(),
      ctx.db.query("provider_spend_reservations")
        .withIndex("by_site_created", q => q.eq("siteId", siteId).gte("createdAt", monthStartAt))
        .order("desc").take(SITE_RESERVATION_READ_LIMIT + 1),
      ctx.db.query("jobs")
        .withIndex("by_site_type_created", q => q.eq("siteId", siteId).eq("type", "plan").gte("createdAt", monthStartAt))
        .order("desc").take(SITE_RESERVATION_READ_LIMIT + 1),
      ctx.db.query("jobs")
        .withIndex("by_site_type_created", q => q.eq("siteId", siteId).eq("type", "onboarding").gte("createdAt", monthStartAt))
        .order("desc").take(SITE_RESERVATION_READ_LIMIT + 1),
      ctx.db.query("cadence_micro_seed_jobs")
        .withIndex("by_site_created", q => q.eq("siteId", siteId).gte("createdAt", monthStartAt))
        .order("desc").take(SITE_RESERVATION_READ_LIMIT + 1),
      ctx.db.query("expected_click_demand_jobs")
        .withIndex("by_site_created", q => q.eq("siteId", siteId).gte("createdAt", monthStartAt))
        .order("desc").take(SITE_RESERVATION_READ_LIMIT + 1),
      ctx.db.query("expected_click_evidence_jobs")
        .withIndex("by_site_created", q => q.eq("siteId", siteId).gte("createdAt", monthStartAt))
        .order("desc").take(SITE_RESERVATION_READ_LIMIT + 1),
      ctx.db.query("seo_authority_runs")
        .withIndex("by_site_created", q => q.eq("siteId", siteId).gte("createdAt", monthStartAt))
        .order("desc").take(SITE_RESERVATION_READ_LIMIT + 1),
    ]);
    const tier = resolvePlanFromFeatures(entitlement?.planFeatures ?? site.planFeatures ?? []).tier;
    const baseMonthlyCeilingMicroUsd = providerAccountMonthlyCeilingMicroUsd(tier);
    const authorization = await readProviderBudgetAuthorization(ctx, entitlement, site.userId,
      baseMonthlyCeilingMicroUsd, snapshotAt);
    const sourceWindows = [plans, onboardings, microSeeds, demand, evidence, authority];
    const planProofs = new Map(await Promise.all(plans.slice(0, SITE_RESERVATION_READ_LIMIT)
      .filter(job => job.siteId === siteId).map(async job => {
        const checkpoints = await ctx.db.query("plan_candidate_checkpoints")
          .withIndex("by_plan_job", q => q.eq("planJobId", job._id)).take(2);
        return [job._id, { singleExecutionTargetValid: Boolean(automaticSingleExecutionCheckpointTargetFromPayload(job.payload)),
          checkpointCount: checkpoints.length,
          checkpointBindingsValid: checkpoints.every(c => c.siteId === siteId && c.userId === site.userId && c.planJobId === job._id),
          checkpoints: checkpoints.filter(c => c.siteId === siteId && c.userId === site.userId).map(c => ({
            status: ["active", "inline_sealed", "inline_completed", "activated", "empty", "terminal_blocked"].includes(c.status) ? c.status : "other",
            workerExecution: c.workerExecution,
          })) }] as const;
      })));
    const sources = new Map<Id<"provider_spend_reservations">, Array<{
      jobId: string; status: string; createdAt: number; updatedAt: number;
      reservationAmountMatches: boolean; workerAttempts?: number;
      leaseExpired: boolean; retryScheduled: boolean;
      providerAttempted?: boolean; providerCompleted?: boolean;
      verifiedReceiptMicroUsd?: number; providerCallsAttempted?: number;
      providerCallsCompleted?: number; jobReleaseRecorded: boolean;
    }>>();
    const statuses = new Set(["pending", "running", "done", "failed", "cancelled", "settled",
      "partial", "completed", "missed", "awaiting_evidence", "provider_balance_unavailable",
      "provider_response_unverified", "expired"]);
    for (const window of sourceWindows) for (const job of window.slice(0, SITE_RESERVATION_READ_LIMIT)) {
      if (job.siteId !== siteId || ("userId" in job && job.userId !== site.userId) || !job.providerSpendReservationId) continue;
      const rows = sources.get(job.providerSpendReservationId) ?? [];
      rows.push({
        jobId: job._id, status: statuses.has(job.status) ? job.status : "other",
        createdAt: job.createdAt, updatedAt: job.updatedAt,
        reservationAmountMatches: reservations.some(r => r._id === job.providerSpendReservationId &&
          r.reservedMicroUsd === job.providerCostReservedMicroUsd && r.createdAt === job.createdAt),
        workerAttempts: "workerAttempts" in job ? job.workerAttempts : undefined,
        leaseExpired: "leaseExpiresAt" in job && job.leaseExpiresAt !== undefined && job.leaseExpiresAt <= snapshotAt,
        retryScheduled: "nextAttemptAt" in job && job.nextAttemptAt !== undefined,
        providerAttempted: "providerCallAttempted" in job ? job.providerCallAttempted : undefined,
        providerCompleted: "providerCallCompleted" in job ? job.providerCallCompleted : undefined,
        verifiedReceiptMicroUsd: "providerTaskCostUsd" in job && job.providerCallCompleted === true &&
          typeof job.providerTaskCostUsd === "number" && Number.isFinite(job.providerTaskCostUsd) && job.providerTaskCostUsd >= 0
          ? Math.ceil(job.providerTaskCostUsd * 1_000_000) : undefined,
        providerCallsAttempted: "providerCallsAttempted" in job ? job.providerCallsAttempted : undefined,
        providerCallsCompleted: "providerCallsCompleted" in job ? job.providerCallsCompleted : undefined,
        jobReleaseRecorded: "providerReservationReleasedAt" in job && job.providerReservationReleasedAt !== undefined,
      });
      sources.set(job.providerSpendReservationId, rows);
    }
    let verifiedSettledMicroUsd = 0;
    let contingencySettledMicroUsd = 0;
    let retainedMicroUsd = 0;
    let releasedOriginalMicroUsd = 0;
    let invalidSettlementCount = 0;
    const purposes = new Set(["topic_plan", "onboarding_analysis", "authority_discovery",
      "expected_click_demand_backfill", "expected_click_evidence_backfill", "cadence_micro_seed", "cadence_micro_seed_fallback"]);
    const rows = reservations.slice(0, SITE_RESERVATION_READ_LIMIT)
      .filter(r => r.siteId === siteId && r.userId === site.userId).map(r => {
        const consumedMicroUsd = r.releasedAt !== undefined ? 0 : providerReservationConsumedMicroUsd(r);
        const settlementValid = r.settledAt !== undefined && r.settledMicroUsd !== undefined &&
          Number.isSafeInteger(r.settledMicroUsd) && r.settledMicroUsd >= 0 && r.settledMicroUsd <= r.reservedMicroUsd;
        let accountingState: "released" | "verified_actual" | "execution_ceiling" | "retained_ceiling";
        if (r.releasedAt !== undefined) { accountingState = "released"; releasedOriginalMicroUsd += r.reservedMicroUsd; }
        else if (settlementValid && r.settlementReason === "verified_provider_receipt_actual_cost") {
          accountingState = "verified_actual"; verifiedSettledMicroUsd += consumedMicroUsd;
        } else if (settlementValid && r.settlementReason === "single_execution_plan_contingency_retired") {
          accountingState = "execution_ceiling"; contingencySettledMicroUsd += consumedMicroUsd;
        } else { accountingState = "retained_ceiling"; retainedMicroUsd += consumedMicroUsd; }
        if ((r.settledAt !== undefined || r.settledMicroUsd !== undefined) && !settlementValid) invalidSettlementCount++;
        return { reservationId: r._id, purpose: purposes.has(r.purpose) ? r.purpose : "other",
          reservedMicroUsd: r.reservedMicroUsd, consumedMicroUsd, accountingState, createdAt: r.createdAt,
          sources: (sources.get(r._id) ?? []).map(s => ({ ...s,
            planProof: planProofs.get(s.jobId as Id<"jobs">) })) };
      });
    return { siteId, snapshotAt, monthStartAt, resetAt, tier,
      accountMonthlyCeilingMicroUsd: authorization?.monthlyCeilingMicroUsd ?? baseMonthlyCeilingMicroUsd,
      baseMonthlyCeilingMicroUsd, approvedIncrementalLimitMicroUsd: authorization?.incrementalLimitMicroUsd,
      approvalStartedAt: authorization?.approvedAt,
      approvedWindowConsumedMicroUsd: authorization ? rows.filter(r => r.createdAt >= authorization.approvedAt)
        .reduce((sum, r) => sum + r.consumedMicroUsd, 0) : undefined,
      approvalExpiresAt: authorization?.expiresAt,
      sameAccountAsComparison: comparisonSiteId ? Boolean(comparison?.userId && comparison.userId === site.userId) : null,
      scope: "exact_site_current_owner_only" as const, accountAndFleetCapacity: "not_inspected" as const,
      siteWindowComplete: reservations.length <= SITE_RESERVATION_READ_LIMIT,
      sourceWindowsComplete: sourceWindows.every(w => w.length <= SITE_RESERVATION_READ_LIMIT),
      verifiedSettledMicroUsd, contingencySettledMicroUsd, retainedMicroUsd, releasedOriginalMicroUsd,
      monthlyConsumedMicroUsd: verifiedSettledMicroUsd + contingencySettledMicroUsd + retainedMicroUsd,
      invalidSettlementCount, rows };
  },
});

/** Internal operator boundary: call only for an explicit spending approval.
 * The two supplied sites must share an owner; no account/site enumeration.
 * One immutable approval per month. Replays return the original receipt and
 * never restart its clock or enlarge its incremental spending allowance. */
export const approveAccountMonthBudget = internalMutation({
  args: { siteId: v.id("sites"), comparisonSiteId: v.id("sites"), month: v.string(),
    expectedBaseMonthlyCeilingMicroUsd: v.number(), monthlyCeilingMicroUsd: v.number(),
    incrementalLimitMicroUsd: v.number(), approvalReference: v.string() },
  handler: async (ctx, args) => {
    const [site, comparison] = await Promise.all([ctx.db.get(args.siteId), ctx.db.get(args.comparisonSiteId)]);
    if (!site?.userId || comparison?.userId !== site.userId ||
        !(await siteExecutionAuthorized(ctx, site)) || !(await siteExecutionAuthorized(ctx, comparison))) {
      throw new Error("Budget approval scope is unavailable");
    }
    const entitlement = await ctx.db.query("account_plan_entitlements")
      .withIndex("by_user", q => q.eq("userId", site.userId!)).unique();
    if (!entitlement || entitlement.status !== "completed") throw new Error("Canonical account entitlement required");
    const timestamp = Date.now(); const window = providerBudgetMonth(timestamp);
    const base = providerAccountMonthlyCeilingMicroUsd(resolvePlanFromFeatures(entitlement.planFeatures).tier);
    if (args.month !== window.month || args.expectedBaseMonthlyCeilingMicroUsd !== base ||
        !Number.isSafeInteger(args.monthlyCeilingMicroUsd) || args.monthlyCeilingMicroUsd <= base ||
        args.monthlyCeilingMicroUsd > MAX_APPROVED_PROVIDER_MONTHLY_CEILING_MICRO_USD ||
        !Number.isSafeInteger(args.incrementalLimitMicroUsd) || args.incrementalLimitMicroUsd <= 0 ||
        args.incrementalLimitMicroUsd > args.monthlyCeilingMicroUsd - base ||
        !/^[a-zA-Z0-9_-]{8,128}$/.test(args.approvalReference)) throw new Error("Budget approval contract is invalid");
    const accountKey = accountDeletionKey(site.userId);
    const existing = await ctx.db.query("provider_budget_authorizations")
      .withIndex("by_account_month", q => q.eq("accountKey", accountKey).eq("month", window.month)).unique();
    if (existing && (existing.approvalReference !== args.approvalReference ||
        existing.baseMonthlyCeilingMicroUsd !== base || existing.monthlyCeilingMicroUsd !== args.monthlyCeilingMicroUsd ||
        existing.incrementalLimitMicroUsd !== args.incrementalLimitMicroUsd)) throw new Error("A different monthly budget approval already exists");
    if (existing && !activeProviderBudgetAuthorization(existing, site.userId, base, timestamp)) {
      throw new Error("Existing monthly budget approval is invalid");
    }
    const authorizationId = existing?._id ?? await ctx.db.insert("provider_budget_authorizations", {
      accountKey, month: window.month, windowStartAt: window.startAt, expiresAt: window.endAt,
      approvedAt: timestamp, baseMonthlyCeilingMicroUsd: base,
      monthlyCeilingMicroUsd: args.monthlyCeilingMicroUsd, incrementalLimitMicroUsd: args.incrementalLimitMicroUsd,
      approvalReference: args.approvalReference,
    });
    if (entitlement.providerBudgetAuthorizationId !== authorizationId) {
      await ctx.db.patch(entitlement._id, { providerBudgetAuthorizationId: authorizationId });
    }
    return { authorizationId, created: !existing, approvedAt: existing?.approvedAt ?? timestamp,
      expiresAt: window.endAt, baseMonthlyCeilingMicroUsd: base,
      monthlyCeilingMicroUsd: args.monthlyCeilingMicroUsd, incrementalLimitMicroUsd: args.incrementalLimitMicroUsd };
  },
});
