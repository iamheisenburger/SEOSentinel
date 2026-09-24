import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { automaticSingleExecutionCheckpointTargetFromPayload } from "./lib/planProviderBudget.ts";
import { accountDeletionKey } from "./lib/accountDeletion.ts";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance.ts";
import { activeProviderBudgetAuthorization, MAX_APPROVED_PROVIDER_MONTHLY_CEILING_MICRO_USD, providerBudgetMonth,
  readProviderBudgetAuthorization, MAX_CUMULATIVE_VALIDATION_MICRO_USD,
  validCumulativeValidationAuthorization, ordinaryProviderReservationRows } from "./lib/providerBudgetAuthorization.ts";
import { resolvePlanFromFeatures } from "./planLimits.ts";
import {
  providerAccountDailyCeilingMicroUsd,
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
    const ordinaryIds = new Set((await ordinaryProviderReservationRows(ctx, rows.filter(r => r.userId === site.userId), snapshotAt)).map(r => r._id));
    let independentConsumedMicroUsd = 0;
    for (const row of rows.slice(0, SITE_RESERVATION_READ_LIMIT)) {
      if (row.userId !== site.userId) { unmatchedOwnerCount++; continue; }
      if (row.releasedAt !== undefined) { releasedCount++; continue; }
      const consumed = providerReservationConsumedMicroUsd(row);
      if (!ordinaryIds.has(row._id)) { independentConsumedMicroUsd += consumed; continue; }
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
      independentConsumedMicroUsd, allScopesMonthlyConsumedMicroUsd: monthlyConsumedMicroUsd + independentConsumedMicroUsd,
      accountDailyCeilingMicroUsd: providerAccountDailyCeilingMicroUsd(),
      accountMonthlyCeilingMicroUsd: monthlyCeilingMicroUsd,
      baseMonthlyCeilingMicroUsd,
      approvedIncrementalLimitMicroUsd: authorization?.incrementalLimitMicroUsd,
      approvalStartedAt: authorization?.approvedAt,
      approvedWindowConsumedMicroUsd: authorization ? approvedWindowConsumedMicroUsd : undefined,
      approvalExpiresAt: authorization?.expiresAt,
      // Upper bounds only: the account may have reservations at other sites.
      accountDailyHeadroomAtMostMicroUsd: Math.max(0,
        providerAccountDailyCeilingMicroUsd() - dailyConsumedMicroUsd),
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
    const ordinaryIds = new Set((await ordinaryProviderReservationRows(ctx, reservations.filter(r => r.siteId === siteId && r.userId === site.userId), snapshotAt)).map(r => r._id));
    let independentConsumedMicroUsd = 0;
    const purposes = new Set(["topic_plan", "onboarding_analysis", "authority_discovery",
      "expected_click_demand_backfill", "expected_click_evidence_backfill", "cadence_micro_seed", "cadence_micro_seed_fallback"]);
    const rows = reservations.slice(0, SITE_RESERVATION_READ_LIMIT)
      .filter(r => r.siteId === siteId && r.userId === site.userId).map(r => {
        const consumedMicroUsd = r.releasedAt !== undefined ? 0 : providerReservationConsumedMicroUsd(r);
        const independent = !ordinaryIds.has(r._id);
        const ordinaryConsumed = independent ? 0 : consumedMicroUsd;
        if (independent) independentConsumedMicroUsd += consumedMicroUsd;
        const settlementValid = r.settledAt !== undefined && r.settledMicroUsd !== undefined &&
          Number.isSafeInteger(r.settledMicroUsd) && r.settledMicroUsd >= 0 && r.settledMicroUsd <= r.reservedMicroUsd;
        let accountingState: "released" | "verified_actual" | "execution_ceiling" | "retained_ceiling";
        if (r.releasedAt !== undefined) { accountingState = "released"; releasedOriginalMicroUsd += r.reservedMicroUsd; }
        else if (settlementValid && r.settlementReason === "verified_provider_receipt_actual_cost") {
          accountingState = "verified_actual"; verifiedSettledMicroUsd += ordinaryConsumed;
        } else if (settlementValid && r.settlementReason === "single_execution_plan_contingency_retired") {
          accountingState = "execution_ceiling"; contingencySettledMicroUsd += ordinaryConsumed;
        } else { accountingState = "retained_ceiling"; retainedMicroUsd += ordinaryConsumed; }
        if ((r.settledAt !== undefined || r.settledMicroUsd !== undefined) && !settlementValid) invalidSettlementCount++;
        return { reservationId: r._id, purpose: purposes.has(r.purpose) ? r.purpose : "other",
          budgetScope: independent ? "independent_validation" as const : "ordinary_account" as const,
          reservedMicroUsd: r.reservedMicroUsd, consumedMicroUsd, accountingState, createdAt: r.createdAt,
          sources: (sources.get(r._id) ?? []).map(s => ({ ...s,
            planProof: planProofs.get(s.jobId as Id<"jobs">) })) };
      });
    return { siteId, snapshotAt, monthStartAt, resetAt, tier,
      accountMonthlyCeilingMicroUsd: authorization?.monthlyCeilingMicroUsd ?? baseMonthlyCeilingMicroUsd,
      baseMonthlyCeilingMicroUsd, approvedIncrementalLimitMicroUsd: authorization?.incrementalLimitMicroUsd,
      approvalStartedAt: authorization?.approvedAt,
      approvedWindowConsumedMicroUsd: authorization ? rows.filter(r => r.budgetScope === "ordinary_account" && r.createdAt >= authorization.approvedAt)
        .reduce((sum, r) => sum + r.consumedMicroUsd, 0) : undefined,
      approvalExpiresAt: authorization?.expiresAt,
      sameAccountAsComparison: comparisonSiteId ? Boolean(comparison?.userId && comparison.userId === site.userId) : null,
      scope: "exact_site_current_owner_only" as const, accountAndFleetCapacity: "not_inspected" as const,
      siteWindowComplete: reservations.length <= SITE_RESERVATION_READ_LIMIT,
      sourceWindowsComplete: sourceWindows.every(w => w.length <= SITE_RESERVATION_READ_LIMIT),
      verifiedSettledMicroUsd, contingencySettledMicroUsd, retainedMicroUsd, releasedOriginalMicroUsd,
      monthlyConsumedMicroUsd: verifiedSettledMicroUsd + contingencySettledMicroUsd + retainedMicroUsd,
      independentConsumedMicroUsd, allScopesMonthlyConsumedMicroUsd: verifiedSettledMicroUsd + contingencySettledMicroUsd + retainedMicroUsd + independentConsumedMicroUsd,
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

/** LOCAL REVIEW CANDIDATE: no invocation/deployment is authorized by its
 * existence. Attach one additional hard stop to the existing approval row,
 * without replacing the old $4 receipt or changing account/fleet ceilings. */
export const attachCumulativeValidationBudget = internalMutation({
  args: { siteId: v.id("sites"), comparisonSiteId: v.id("sites"), authorizationId: v.id("provider_budget_authorizations"),
    expectedMonthlyApprovalReference: v.string(), approvalReference: v.string(), limitMicroUsd: v.number(), expiresAt: v.optional(v.number()),
    independentFunding: v.optional(v.object({ scope: v.literal("additional_provider_allowance"), approvalReference: v.string() })) },
  handler: async (ctx, args) => {
    const [site, comparison, anchor] = await Promise.all([ctx.db.get(args.siteId), ctx.db.get(args.comparisonSiteId), ctx.db.get(args.authorizationId)]);
    if (args.siteId === args.comparisonSiteId || !site?.userId || comparison?.userId !== site.userId ||
      !(await siteExecutionAuthorized(ctx, site)) || !(await siteExecutionAuthorized(ctx, comparison)) ||
      anchor?.accountKey !== accountDeletionKey(site.userId) || anchor.approvalReference !== args.expectedMonthlyApprovalReference) {
      throw new Error("Validation budget scope is unavailable");
    }
    const entitlement = await ctx.db.query("account_plan_entitlements").withIndex("by_user", q => q.eq("userId", site.userId!)).unique();
    if (!entitlement || entitlement.status !== "completed") throw new Error("Canonical account entitlement required");
    const selected = [site, comparison], siteIds = selected.map(s => s._id).sort();
    if (selected.some(s => s.serviceMode !== "growth_first" || !s.contentSchedule)) throw new Error("Select the exact content schedules before binding validation");
    const timestamp = Date.now(), previous = anchor.cumulativeValidation;
    if (previous || selected.some(s => s.contentSchedule!.validationAuthorizationId)) {
      if (!previous || selected.some(s => s.contentSchedule!.validationAuthorizationId !== anchor._id) ||
        !validCumulativeValidationAuthorization(anchor, site.userId, timestamp) || previous.limitMicroUsd !== args.limitMicroUsd ||
        JSON.stringify([...previous.siteIds].sort()) !== JSON.stringify(siteIds) ||
        previous.approvalReference !== args.approvalReference || previous.expiresAt !== args.expiresAt ||
        previous.independentFunding?.scope !== args.independentFunding?.scope ||
        previous.independentFunding?.approvalReference !== args.independentFunding?.approvalReference) throw new Error("An immutable validation budget already exists");
      return { created: false, ...previous };
    }
    const base = providerAccountMonthlyCeilingMicroUsd(resolvePlanFromFeatures(entitlement.planFeatures).tier);
    if (entitlement.providerBudgetAuthorizationId !== anchor._id || !activeProviderBudgetAuthorization(anchor, site.userId, base, timestamp) ||
      !Number.isSafeInteger(args.limitMicroUsd) || args.limitMicroUsd <= 0 || args.limitMicroUsd > MAX_CUMULATIVE_VALIDATION_MICRO_USD ||
      (args.expiresAt !== undefined && (!Number.isSafeInteger(args.expiresAt) || args.expiresAt <= timestamp)) ||
      (args.independentFunding !== undefined && (!/^[a-zA-Z0-9_-]{8,128}$/.test(args.independentFunding.approvalReference) ||
        [args.approvalReference, anchor.approvalReference].includes(args.independentFunding.approvalReference))) ||
      !/^[a-zA-Z0-9_-]{8,128}$/.test(args.approvalReference)) throw new Error("Validation budget contract is invalid");
    // Existing work is never retroactively charged to this additional grant.
    // Prepare a fresh run only after prior content execution has terminated.
    for (const target of selected) {
      const jobs = await ctx.db.query("jobs").withIndex("by_site", q => q.eq("siteId", target._id)).take(1001);
      if (jobs.length > 1000 || jobs.some(j => j.contentWork && !["verified", "failed"].includes(j.contentWork.stage))) {
        throw new Error("Reconcile existing content work before validation");
      }
    }
    const receipt = { approvedAt: timestamp, ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
      ...(args.independentFunding ? { independentFunding: args.independentFunding } : {}),
      siteIds, limitMicroUsd: args.limitMicroUsd, approvalReference: args.approvalReference };
    await ctx.db.patch(anchor._id, { cumulativeValidation: receipt });
    for (const target of selected) await ctx.db.patch(target._id, {
      contentSchedule: { ...target.contentSchedule!, validationAuthorizationId: anchor._id } });
    return { created: true, ...receipt };
  },
});

/** Explicit stop preserves the immutable run and every retained reservation.
 * Only bound content work is fenced; ordinary work has no dependency on it. */
export const stopCumulativeValidationBudget = internalMutation({
  args: { siteId: v.id("sites"), comparisonSiteId: v.id("sites"), authorizationId: v.id("provider_budget_authorizations"), approvalReference: v.string() },
  handler: async (ctx, args) => {
    const [site, other, anchor] = await Promise.all([ctx.db.get(args.siteId), ctx.db.get(args.comparisonSiteId), ctx.db.get(args.authorizationId)]);
    const run = anchor?.cumulativeValidation;
    if (args.siteId === args.comparisonSiteId || !site?.userId || other?.userId !== site.userId || !run ||
      !validCumulativeValidationAuthorization(anchor, site.userId, Date.now()) ||
      !run.siteIds.includes(site._id) || !run.siteIds.includes(other._id) || run.approvalReference !== args.approvalReference ||
      !(await siteExecutionAuthorized(ctx, site)) || !(await siteExecutionAuthorized(ctx, other))) throw new Error("Validation stop scope is unavailable");
    if (run.stoppedAt !== undefined) return { stoppedAt: run.stoppedAt, changed: false };
    const stoppedAt = Date.now(); await ctx.db.patch(anchor!._id, { cumulativeValidation: { ...run, stoppedAt } });
    return { stoppedAt, changed: true };
  },
});
