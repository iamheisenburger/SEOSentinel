import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  resolvePlanFromFeatures,
  type CanonicalPlanTier,
} from "../planLimits.ts";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./planSiteAllowance.ts";

/**
 * Shared fleet circuit breaker for paid discovery providers.
 *
 * Topic planning and authority discovery have independent tenant policies but
 * spend from the same DataForSEO/OpenAI account. Every allowed attempt writes
 * one durable reservation in the same transaction as its source job/run,
 * preventing concurrent tenants or different features from oversubscribing
 * the shared provider account. Only a proven exit before the first paid call
 * may append release metadata; the receipt itself is never deleted.
 */
// Conservative fleet guard: three complete $2 topic-plan reservations (one
// for every site in the public Pro bundle), the full
// bounded cadence-recovery chain ($0.35), one $0.20 evidence-policy upgrade,
// two complete $0.15 micro-seed policy attempts, one $0.10 ambiguous category
// attempt, the final timeout-repaired attempt's $0.10 evidence, one complete
// $0.25 anchor-preservation migration, one $0.25 legacy-anchor quarantine
// migration (each primary, fallback, and evidence), a bounded $0.70
// release-repair reserve, the complete $0.45 v15 candidate-continuation
// envelope (primary discovery, fallback discovery when needed, and up to
// three exact SERP evidence attempts), the complete $0.45 v16
// saturated-anchor diversification envelope, the complete $0.45 v17
// current-fit-policy recovery envelope, and a $0.25 reserve for another
// account must all fit in the same UTC day. The repair reserve prevents an
// immutable ambiguous provider receipt from consuming the next corrected
// policy version's admission headroom; the monthly cap still bounds aggregate
// spend and no ambiguous request is replayed.
// The ordinary recovery chain is primary
// micro-seed ($0.10), fallback micro-seed ($0.05), exact demand ($0.10), and
// SERP/authority evidence ($0.10). A lower ceiling lets an independent demand
// worker consume the evidence headroom observed by the micro-seed inspector,
// deterministically stranding cadence after every paid step has succeeded.
// The versioned recoveries permit exactly one repaired demand/evidence batch
// and only the explicitly versioned micro-seed generations whose immutable
// predecessors proved a distinct algorithm defect. The monthly $35 fleet
// circuit breaker remains unchanged.
export const SHARED_PROVIDER_DAILY_CEILING_MICRO_USD = 9_850_000;
export const SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD = 35_000_000;
export const PROVIDER_BALANCE_PREFLIGHT_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Provider-backed growth is available on every advertised plan, but the
 * account's purchased volume funds a bounded share of the common provider
 * wallet. These are reservation ceilings, not claims about actual spend.
 * The fleet ceilings below remain an additional final circuit breaker.
 */
// No single account may reserve the entire fleet envelope. One complete topic
// plan plus every bounded cadence-recovery phase and one version migration
// for both evidence and micro-seed discovery
// fits, while one full $0.25 authority/onboarding envelope remains admissible
// for another customer.
// This is admission fairness only and does not alter the monthly fleet cap.
export const PROVIDER_OTHER_ACCOUNTS_DAILY_RESERVE_MICRO_USD = 250_000;
export const PROVIDER_OTHER_ACCOUNTS_MONTHLY_RESERVE_MICRO_USD = 7_000_000;
export const PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD =
  SHARED_PROVIDER_DAILY_CEILING_MICRO_USD -
  PROVIDER_OTHER_ACCOUNTS_DAILY_RESERVE_MICRO_USD;
export const PROVIDER_ACCOUNT_MONTHLY_CEILING_MICRO_USD = Object.freeze({
  free: 2_500_000,
  starter: 5_000_000,
  pro: 10_000_000,
  scale: 20_000_000,
  enterprise:
    SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD -
    PROVIDER_OTHER_ACCOUNTS_MONTHLY_RESERVE_MICRO_USD,
} satisfies Record<CanonicalPlanTier, number>);

export type ProviderReservationReleaseReason =
  | "provider_balance_insufficient"
  | "provider_balance_preflight_unavailable"
  | "plan_cancelled_before_execution"
  | "plan_reservation_day_expired_before_execution"
  | "one_setup_planning_context_superseded_before_execution";

export type SharedProviderPurpose =
  | "topic_plan"
  | "authority_discovery"
  | "onboarding_analysis"
  | "expected_click_evidence_backfill"
  | "expected_click_demand_backfill"
  | "cadence_micro_seed"
  | "cadence_micro_seed_fallback";

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

export type SharedProviderReservationResult =
  | {
      ok: true;
      reservationId: Id<"provider_spend_reservations">;
      fleetReservedTodayMicroUsd: number;
      fleetReservedThisMonthMicroUsd: number;
      accountReservedTodayMicroUsd: number;
      accountReservedThisMonthMicroUsd: number;
      accountMonthlyCeilingMicroUsd: number;
    }
  | {
      ok: false;
      reason: "provider_account_entitlement_unavailable" |
        "provider_account_daily_budget_reserved" |
        "provider_account_monthly_budget_reserved" |
        "provider_fleet_daily_budget_reserved" |
        "provider_fleet_monthly_budget_reserved" |
        "provider_account_preflight_cooling_down";
      reservedMicroUsd: number;
      ceilingMicroUsd: number;
      retryAfterMs?: number;
    };

export type SharedProviderCapacityDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "provider_fleet_daily_budget_reserved" |
        "provider_fleet_monthly_budget_reserved";
      reservedMicroUsd: number;
      ceilingMicroUsd: number;
    };

export type ProviderAccountCapacityDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "provider_account_daily_budget_reserved" |
        "provider_account_monthly_budget_reserved";
      reservedMicroUsd: number;
      ceilingMicroUsd: number;
    };

export function providerAccountMonthlyCeilingMicroUsd(
  tier: CanonicalPlanTier,
): number {
  return PROVIDER_ACCOUNT_MONTHLY_CEILING_MICRO_USD[tier];
}

export function evaluateProviderAccountCapacity(args: {
  accountReservedTodayMicroUsd: number;
  accountReservedThisMonthMicroUsd: number;
  requestedMicroUsd: number;
  monthlyCeilingMicroUsd: number;
}): ProviderAccountCapacityDecision {
  if (
    args.accountReservedTodayMicroUsd + args.requestedMicroUsd >
      PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD
  ) {
    return {
      allowed: false,
      reason: "provider_account_daily_budget_reserved",
      reservedMicroUsd: args.accountReservedTodayMicroUsd,
      ceilingMicroUsd: PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
    };
  }
  if (
    args.accountReservedThisMonthMicroUsd + args.requestedMicroUsd >
      args.monthlyCeilingMicroUsd
  ) {
    return {
      allowed: false,
      reason: "provider_account_monthly_budget_reserved",
      reservedMicroUsd: args.accountReservedThisMonthMicroUsd,
      ceilingMicroUsd: args.monthlyCeilingMicroUsd,
    };
  }
  return { allowed: true };
}

type ProviderReservationLedgerRow = {
  userId: string;
  reservedMicroUsd: number;
  releasedAt?: number;
  createdAt: number;
};

/**
 * Summarize the immutable reservation ledger without depending on siteId.
 * Tenant deletion deliberately clears that optional reference while retaining
 * userId, so deleting and recreating a site cannot reset an account allowance.
 */
export function summarizeProviderReservationLedger(
  rows: readonly ProviderReservationLedgerRow[],
  userId: string,
  timestamp: number,
): {
  fleetReservedTodayMicroUsd: number;
  fleetReservedThisMonthMicroUsd: number;
  accountReservedTodayMicroUsd: number;
  accountReservedThisMonthMicroUsd: number;
} {
  const dayStart = utcDayStart(timestamp);
  const monthStart = utcMonthStart(timestamp);
  let fleetReservedTodayMicroUsd = 0;
  let fleetReservedThisMonthMicroUsd = 0;
  let accountReservedTodayMicroUsd = 0;
  let accountReservedThisMonthMicroUsd = 0;

  for (const row of rows) {
    if (row.releasedAt !== undefined || row.createdAt < monthStart) continue;
    fleetReservedThisMonthMicroUsd += row.reservedMicroUsd;
    if (row.userId === userId) {
      accountReservedThisMonthMicroUsd += row.reservedMicroUsd;
    }
    if (row.createdAt >= dayStart) {
      fleetReservedTodayMicroUsd += row.reservedMicroUsd;
      if (row.userId === userId) {
        accountReservedTodayMicroUsd += row.reservedMicroUsd;
      }
    }
  }

  return {
    fleetReservedTodayMicroUsd,
    fleetReservedThisMonthMicroUsd,
    accountReservedTodayMicroUsd,
    accountReservedThisMonthMicroUsd,
  };
}

export function evaluateSharedProviderCapacity(args: {
  fleetReservedTodayMicroUsd: number;
  fleetReservedThisMonthMicroUsd: number;
  requestedMicroUsd: number;
}): SharedProviderCapacityDecision {
  if (
    args.fleetReservedTodayMicroUsd + args.requestedMicroUsd >
    SHARED_PROVIDER_DAILY_CEILING_MICRO_USD
  ) {
    return {
      allowed: false,
      reason: "provider_fleet_daily_budget_reserved",
      reservedMicroUsd: args.fleetReservedTodayMicroUsd,
      ceilingMicroUsd: SHARED_PROVIDER_DAILY_CEILING_MICRO_USD,
    };
  }
  if (
    args.fleetReservedThisMonthMicroUsd + args.requestedMicroUsd >
    SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD
  ) {
    return {
      allowed: false,
      reason: "provider_fleet_monthly_budget_reserved",
      reservedMicroUsd: args.fleetReservedThisMonthMicroUsd,
      ceilingMicroUsd: SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD,
    };
  }
  return { allowed: true };
}

export async function reserveSharedProviderBudget(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    userId: string;
    purpose: SharedProviderPurpose;
    trigger: string;
    reservedMicroUsd: number;
    timestamp: number;
  },
): Promise<SharedProviderReservationResult> {
  if (!Number.isSafeInteger(args.reservedMicroUsd) || args.reservedMicroUsd <= 0) {
    throw new Error("Shared provider reservation must be a positive integer");
  }

  // This mutation owns the billing decision. Callers may carry a stale site
  // snapshot, so re-read the tenant and derive its canonical tier inside the
  // same serializable transaction that will append the reservation receipt.
  const site = await ctx.db.get(args.siteId);
  if (
    !siteExecutionActive(site) ||
    !(await siteExecutionAuthorized(ctx, site)) ||
    !site.userId ||
    site.userId !== args.userId
  ) {
    return {
      ok: false,
      reason: "provider_account_entitlement_unavailable",
      reservedMicroUsd: 0,
      ceilingMicroUsd: 0,
    };
  }
  const accountEntitlement = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site.userId!))
    .unique();
  const plan = resolvePlanFromFeatures(
    accountEntitlement?.planFeatures ?? site.planFeatures ?? [],
  );
  const accountMonthlyCeilingMicroUsd =
    providerAccountMonthlyCeilingMicroUsd(plan.tier);
  const monthRows = await ctx.db
    .query("provider_spend_reservations")
    .withIndex("by_created", (q) =>
      q.gte("createdAt", utcMonthStart(args.timestamp))
    )
    .collect();
  const ledger = summarizeProviderReservationLedger(
    monthRows,
    site.userId,
    args.timestamp,
  );
  const accountCapacity = evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: ledger.accountReservedTodayMicroUsd,
    accountReservedThisMonthMicroUsd:
      ledger.accountReservedThisMonthMicroUsd,
    requestedMicroUsd: args.reservedMicroUsd,
    monthlyCeilingMicroUsd: accountMonthlyCeilingMicroUsd,
  });
  if (!accountCapacity.allowed) {
    return { ok: false, ...accountCapacity };
  }

  // Provider health and fleet capacity are deliberately evaluated only after
  // the account entitlement. They remain final shared-wallet circuit breakers,
  // never substitutes for per-customer billing enforcement.
  const recentPreflightRelease = (
    await ctx.db
      .query("provider_spend_reservations")
      .withIndex("by_released", (q) =>
        q.gte(
          "releasedAt",
          args.timestamp - PROVIDER_BALANCE_PREFLIGHT_RETRY_COOLDOWN_MS,
        )
      )
      .order("desc")
      .take(20)
  ).find((row) => row.releasedAt !== undefined && row.releaseReason?.startsWith(
    "provider_balance_",
  ));
  if (recentPreflightRelease?.releasedAt) {
    const retryAfterMs = Math.max(
      1,
      recentPreflightRelease.releasedAt +
        PROVIDER_BALANCE_PREFLIGHT_RETRY_COOLDOWN_MS - args.timestamp,
    );
    return {
      ok: false,
      reason: "provider_account_preflight_cooling_down",
      reservedMicroUsd: 0,
      ceilingMicroUsd: args.reservedMicroUsd,
      retryAfterMs,
    };
  }
  const capacity = evaluateSharedProviderCapacity({
    fleetReservedTodayMicroUsd: ledger.fleetReservedTodayMicroUsd,
    fleetReservedThisMonthMicroUsd: ledger.fleetReservedThisMonthMicroUsd,
    requestedMicroUsd: args.reservedMicroUsd,
  });
  if (!capacity.allowed) {
    return { ok: false, ...capacity };
  }

  const reservationId = await ctx.db.insert("provider_spend_reservations", {
    siteId: args.siteId,
    userId: args.userId,
    purpose: args.purpose,
    trigger: args.trigger,
    reservedMicroUsd: args.reservedMicroUsd,
    reservationDay: new Date(args.timestamp).toISOString().slice(0, 10),
    reservationMonth: new Date(args.timestamp).toISOString().slice(0, 7),
    createdAt: args.timestamp,
  });
  return {
    ok: true,
    reservationId,
    fleetReservedTodayMicroUsd:
      ledger.fleetReservedTodayMicroUsd + args.reservedMicroUsd,
    fleetReservedThisMonthMicroUsd:
      ledger.fleetReservedThisMonthMicroUsd + args.reservedMicroUsd,
    accountReservedTodayMicroUsd:
      ledger.accountReservedTodayMicroUsd + args.reservedMicroUsd,
    accountReservedThisMonthMicroUsd:
      ledger.accountReservedThisMonthMicroUsd + args.reservedMicroUsd,
    accountMonthlyCeilingMicroUsd,
  };
}

/**
 * Release only a reservation whose provider-balance preflight failed before
 * any paid request began. The row is retained as an audit receipt; capacity
 * ignores released rows, while a short global cooldown prevents a depleted
 * shared wallet from generating an unbounded fleet-wide retry loop.
 */
export async function releaseSharedProviderReservation(
  ctx: MutationCtx,
  args: {
    reservationId: Id<"provider_spend_reservations">;
    siteId: Id<"sites">;
    purpose: SharedProviderPurpose;
    reason: ProviderReservationReleaseReason;
    timestamp: number;
  },
): Promise<{ released: boolean }> {
  const reservation = await ctx.db.get(args.reservationId);
  if (
    !reservation ||
    reservation.siteId !== args.siteId ||
    reservation.purpose !== args.purpose
  ) {
    throw new Error("Provider reservation release crossed a tenant boundary");
  }
  if (reservation.releasedAt !== undefined) {
    return { released: false };
  }
  await ctx.db.patch(args.reservationId, {
    releasedAt: args.timestamp,
    releaseReason: args.reason,
  });
  return { released: true };
}
