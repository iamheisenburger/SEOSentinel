import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
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
    const monthlyCeilingMicroUsd = providerAccountMonthlyCeilingMicroUsd(tier);
    let monthlyConsumedMicroUsd = 0;
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
      // Upper bounds only: the account may have reservations at other sites.
      accountDailyHeadroomAtMostMicroUsd: Math.max(0,
        PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD - dailyConsumedMicroUsd),
      accountMonthlyHeadroomAtMostMicroUsd: Math.max(0,
        monthlyCeilingMicroUsd - monthlyConsumedMicroUsd),
    };
  },
});
