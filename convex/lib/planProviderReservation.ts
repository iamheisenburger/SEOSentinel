import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  cadenceFitsMonthlyLimit,
  getLimitsFromFeatures,
} from "../planLimits";
import {
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  AUTOMATIC_PLAN_PROVIDER_DAILY_CEILING_MICRO_USD,
  EXPECTED_CLICK_PLAN_MIGRATION_VERSION,
  evaluatePlanProviderReservationCapacity,
  hasExplicitPlanProviderReservation,
} from "./planProviderBudget";
import { reserveSharedProviderBudget } from "./providerSpendReservation";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./planSiteAllowance";

export type PlanProviderReservation = {
  providerCostCeilingMicroUsd: number;
  providerCostReservedMicroUsd: number;
  providerCostReservationDay: string;
  providerSpendReservationId: Doc<"provider_spend_reservations">["_id"];
};

export type PlanProviderReservationResult =
  | ({ ok: true } & PlanProviderReservation)
  | {
      ok: false;
      reason:
        | "owner_unbound"
        | "site_parked"
        | "plan_entitlement_missing"
        | "site_limit_reached"
        | "article_quota_no_headroom"
        | "plan_headroom_exhausted"
        | "provider_daily_budget_reserved"
        | "provider_account_entitlement_unavailable"
        | "provider_account_daily_budget_reserved"
        | "provider_account_monthly_budget_reserved"
        | "provider_fleet_daily_budget_reserved"
        | "provider_fleet_monthly_budget_reserved"
        | "provider_account_preflight_cooling_down";
      current?: number;
      maximum?: number;
      reservedMicroUsd?: number;
      ceilingMicroUsd?: number;
      retryAfterMs?: number;
    };

function utcDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

function utcMonthStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function utcDayKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

type PlanJobBudgetFields = {
  type: string;
  payload?: unknown;
  providerCostCeilingMicroUsd?: number;
  providerCostReservedMicroUsd?: number;
  providerCostReservationDay?: string;
  providerSpendReservationId?: unknown;
  providerReservationReleasedAt?: number;
};

function isBudgetedPlanJob(job: PlanJobBudgetFields): boolean {
  if (job.type !== "plan") return false;
  if (job.providerReservationReleasedAt !== undefined) return false;
  // Every historical plan execution is counted conservatively. A legacy row
  // without a modern reservation can consume headroom, but can never grant a
  // new worker permission to call a provider.
  return true;
}

async function activeArticleUsageForMonth(
  ctx: MutationCtx,
  userId: string,
  currentTime: number,
): Promise<number> {
  const logs = await ctx.db
    .query("usage_log")
    .withIndex("by_user_type_created", (q) =>
      q
        .eq("userId", userId)
        .eq("type", "article_generated")
        .gte("createdAt", utcMonthStart(currentTime)),
    )
    .collect();
  return logs.filter(
    (log) =>
      log.state !== "reserved" || (log.expiresAt ?? Infinity) > currentTime,
  ).length;
}

/**
 * Reserve the complete bounded provider envelope before a plan job is
 * inserted. This function is shared by automatic scheduling and both public
 * owner-triggered plan paths, so a UI click cannot bypass tenant spend or
 * article entitlement.
 */
export async function reservePlanProviderBudget(
  ctx: MutationCtx,
  site: Doc<"sites">,
  timestamp: number,
  options?: { expectedClickMigrationVersion: number },
): Promise<PlanProviderReservationResult> {
  if (
    options &&
    options.expectedClickMigrationVersion !==
      EXPECTED_CLICK_PLAN_MIGRATION_VERSION
  ) {
    throw new Error("Unsupported expected-click plan migration version");
  }
  if (!site.userId) return { ok: false, reason: "owner_unbound" };
  if (!siteExecutionActive(site)) {
    return { ok: false, reason: "site_parked" };
  }
  // This mutation is the atomic paid-work claim boundary. Re-read the current
  // account receipt here rather than trusting the site's cached plan mirror or
  // an action argument captured before a downgrade/reconciliation began.
  if (!(await siteExecutionAuthorized(ctx, site))) {
    return { ok: false, reason: "plan_entitlement_missing" };
  }
  const entitlement = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site.userId!))
    .unique();
  const limits = getLimitsFromFeatures(
    entitlement?.planFeatures ?? site.planFeatures ?? [],
  );
  if (!cadenceFitsMonthlyLimit(site.cadencePerWeek ?? 0, limits.maxArticles)) {
    return { ok: false, reason: "plan_entitlement_missing" };
  }
  const userSites = limits.maxSites >= 9999
    ? [site]
    : await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", site.userId!))
      .filter((q) =>
        q.and(
          q.eq(q.field("deletionStatus"), undefined),
          q.eq(q.field("planParkedAt"), undefined),
        )
      )
      .take(limits.maxSites + 1);
  if (limits.maxSites < 9999 && userSites.length > limits.maxSites) {
    return {
      ok: false,
      reason: "site_limit_reached",
      current: userSites.length,
      maximum: limits.maxSites,
    };
  }

  const articlesThisMonth = await activeArticleUsageForMonth(
    ctx,
    site.userId,
    timestamp,
  );
  const remainingArticles = Math.max(0, limits.maxArticles - articlesThisMonth);
  if (remainingArticles === 0) {
    return {
      ok: false,
      reason: "article_quota_no_headroom",
      current: articlesThisMonth,
      maximum: limits.maxArticles,
    };
  }

  // Finite tiers can inspect every entitled site directly. Enterprise has no
  // site-count ceiling, so its account-wide plan headroom comes from the
  // durable provider reservation ledger rather than truncating the site set.
  const budgetedPlansThisMonth = limits.maxSites >= 9999
    ? (
        await ctx.db
          .query("provider_spend_reservations")
          .withIndex("by_user_purpose_created", (q) =>
            q
              .eq("userId", site.userId!)
              .eq("purpose", "topic_plan")
              .gte("createdAt", utcMonthStart(timestamp)),
          )
          .take(limits.maxArticles + 1)
      ).filter((reservation) => reservation.releasedAt === undefined).length
    : (
        await Promise.all(
          userSites.map((userSite) =>
            ctx.db
              .query("jobs")
              .withIndex("by_site_type_created", (q) =>
                q
                  .eq("siteId", userSite._id)
                  .eq("type", "plan")
                  .gte("createdAt", utcMonthStart(timestamp)),
              )
              .take(200),
          ),
        )
      ).flat().filter((job) =>
        options
          ? hasExplicitPlanProviderReservation(job)
          : isBudgetedPlanJob(job)
      ).length;
  const dailyPlanJobs = await ctx.db
    .query("jobs")
    .withIndex("by_site_type_created", (q) =>
      q
        .eq("siteId", site._id)
        .eq("type", "plan")
        .gte("createdAt", utcDayStart(timestamp)),
    )
    .take(50);
  const reservedTodayMicroUsd = dailyPlanJobs
    .filter((job) =>
      options
        ? hasExplicitPlanProviderReservation(job)
        : isBudgetedPlanJob(job)
    )
    .reduce(
      (sum, job) =>
        sum +
        (job.providerCostReservedMicroUsd ??
          AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD),
      0,
    );
  const capacity = evaluatePlanProviderReservationCapacity({
    remainingArticles,
    budgetedPlansThisMonth,
    reservedTodayMicroUsd,
  });
  if (!capacity.allowed) {
    return {
      ok: false,
      reason: capacity.reason,
      current: capacity.reason === "plan_headroom_exhausted"
        ? budgetedPlansThisMonth
        : undefined,
      maximum: capacity.reason === "plan_headroom_exhausted"
        ? capacity.monthlyPlanAllowance
        : undefined,
      reservedMicroUsd: reservedTodayMicroUsd,
      ceilingMicroUsd: AUTOMATIC_PLAN_PROVIDER_DAILY_CEILING_MICRO_USD,
    };
  }

  const shared = await reserveSharedProviderBudget(ctx, {
    siteId: site._id,
    userId: site.userId,
    purpose: "topic_plan",
    trigger: options
      ? `expected_click_plan_migration_v${options.expectedClickMigrationVersion}`
      : "topic_plan",
    reservedMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    timestamp,
  });
  if (!shared.ok) {
    return {
      ok: false,
      reason: shared.reason,
      reservedMicroUsd: shared.reservedMicroUsd,
      ceilingMicroUsd: shared.ceilingMicroUsd,
      retryAfterMs: shared.retryAfterMs,
    };
  }

  return {
    ok: true,
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservationDay: utcDayKey(timestamp),
    providerSpendReservationId: shared.reservationId,
  };
}
