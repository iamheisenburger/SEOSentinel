/**
 * Durable spend and retry contract for autonomous topic planning.
 *
 * A plan can call more than the Backlinks bulk endpoint. The current strict
 * path is structurally bounded to Google Ads discovery/metrics, DataForSEO
 * Labs expansion/difficulty, ten live SERPs, and two Backlinks bulk requests
 * (one tenant lookup when uncached plus one 50-target competitor lookup).
 * At DataForSEO's 2026-08 published prices that worst case is approximately
 * $0.913 per execution. We reserve $2.00 before queueing a budgeted plan:
 * $1.00 for the initial execution and $1.00 for exactly one second execution.
 * Execution two is either a transient retry or a rotated continuation after a
 * successful verified underfill; it can never be both. Deterministic failures
 * remain terminal and never grant another execution.
 *
 * The reservation is deliberately a ceiling rather than a claim that every
 * job spends the full amount. Keeping it on the job makes the tenant/day
 * budget auditable and prevents different replenishment reasons from evading
 * one another's spend limit.
 */

export const AUTOMATIC_PLAN_TOPIC_CAPACITY = 10;
// The scheduler protects seven verified topics, one week of inventory for a
// daily tenant. A successful first execution below that horizon may use the
// reservation's already-funded second execution to rotate discovery once.
// Cumulative output remains capped at the original ten-topic plan capacity.
export const AUTOMATIC_PLAN_MINIMUM_VERIFIED_YIELD = 7;
export const UNDERFILLED_PLAN_CONTINUATION_RECOVERY_VERSION = 1;
export const AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD = 1_000_000;
export const AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES = 1;
export const AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD =
  AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD *
  (AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES + 1);
export const AUTOMATIC_PLAN_PROVIDER_COST_CEILING_USD =
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD / 1_000_000;

export type AutomaticPlanContinuationDecision =
  | {
      allowed: true;
      remainingTopicCapacity: number;
      workerExecution: 2;
    }
  | {
      allowed: false;
      reason:
        | "not_automatic_topic_plan"
        | "first_execution_not_successful"
        | "verified_yield_sufficient"
        | "execution_allowance_consumed"
        | "continuation_already_queued"
        | "reservation_day_expired";
    };

/**
 * Decide whether one successful but underfilled automatic plan may consume
 * the second execution already included in its immutable $2 reservation.
 *
 * Zero/invalid yield is a failure, not free continuation. A prior transient
 * retry or continuation has already consumed execution two. The caller also
 * supplies the intended wake-up timestamp so work cannot cross the UTC day
 * that owns the reservation.
 */
export function evaluateAutomaticPlanContinuation(args: {
  automaticTopicPlan: boolean;
  savedTopicCount: number;
  workerAttempts: number;
  continuationAlreadyQueued: boolean;
  reservationDay?: string;
  executionAt: number;
}): AutomaticPlanContinuationDecision {
  if (!args.automaticTopicPlan) {
    return { allowed: false, reason: "not_automatic_topic_plan" };
  }
  if (
    !Number.isInteger(args.savedTopicCount) ||
    args.savedTopicCount <= 0 ||
    args.savedTopicCount > AUTOMATIC_PLAN_TOPIC_CAPACITY
  ) {
    return { allowed: false, reason: "first_execution_not_successful" };
  }
  if (args.savedTopicCount >= AUTOMATIC_PLAN_MINIMUM_VERIFIED_YIELD) {
    return { allowed: false, reason: "verified_yield_sufficient" };
  }
  if (args.continuationAlreadyQueued) {
    return { allowed: false, reason: "continuation_already_queued" };
  }
  if (args.workerAttempts !== 0) {
    return { allowed: false, reason: "execution_allowance_consumed" };
  }
  if (
    !planRetryUsesCurrentReservationDay(
      args.reservationDay,
      args.executionAt,
    )
  ) {
    return { allowed: false, reason: "reservation_day_expired" };
  }
  return {
    allowed: true,
    remainingTopicCapacity:
      AUTOMATIC_PLAN_TOPIC_CAPACITY - args.savedTopicCount,
    workerExecution: 2,
  };
}

// Versioned explicitly because this compatibility path is a one-time operator
// migration, not a permanent alternative budget policy. A future migration
// must choose a new version and receive its own reviewed marker.
export const EXPECTED_CLICK_PLAN_MIGRATION_VERSION = 1;

type PlanProviderReservationEvidence = {
  type: string;
  payload?: unknown;
  providerCostCeilingMicroUsd?: number;
  providerCostReservedMicroUsd?: number;
  providerCostReservationDay?: string;
  providerSpendReservationId?: unknown;
  providerReservationReleasedAt?: number;
  providerReservationReleaseReason?: string;
};

/** A balance preflight release proves that the plan stopped before its first
 * paid provider request. It must not consume the tenant's one-per-window topic
 * replenishment allowance after funding is restored. Unknown or ambiguous
 * releases remain counted fail-closed. */
export function countsTowardTopicPlanRecentLimit(
  job: PlanProviderReservationEvidence,
): boolean {
  if (job.type !== "plan") return false;
  return !(
    job.providerReservationReleasedAt !== undefined &&
    [
      "provider_balance_insufficient",
      "provider_balance_preflight_unavailable",
    ].includes(job.providerReservationReleaseReason ?? "")
  );
}

/**
 * Legacy plan rows predate the shared reservation ledger. They remain in the
 * audit history and conservatively block ordinary autonomous planning, but
 * they cannot prove that the new bounded provider envelope was actually
 * reserved. The one-shot expected-click migration may count only jobs carrying
 * the complete modern reservation contract.
 */
export function hasExplicitPlanProviderReservation(
  job: PlanProviderReservationEvidence,
): boolean {
  if (job.type !== "plan") return false;
  if (job.providerReservationReleasedAt !== undefined) return false;
  return (
    job.providerCostCeilingMicroUsd ===
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
    job.providerCostReservedMicroUsd ===
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
    /^\d{4}-\d{2}-\d{2}$/.test(job.providerCostReservationDay ?? "") &&
    job.providerSpendReservationId !== undefined
  );
}

/**
 * One autonomous paid plan per tenant/site/day, regardless of reason. The
 * reservation covers the initial bounded execution and its single permitted
 * second execution, so retry/underfill recovery cannot silently exceed the
 * per-job ceiling.
 */
export const AUTOMATIC_PLAN_PROVIDER_DAILY_CEILING_MICRO_USD =
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD;

export function automaticPlanAllowanceForArticleHeadroom(
  remainingArticles: number,
): number {
  if (!Number.isFinite(remainingArticles) || remainingArticles <= 0) return 0;
  return Math.ceil(
    Math.floor(remainingArticles) / AUTOMATIC_PLAN_TOPIC_CAPACITY,
  );
}

export type PlanProviderCapacityDecision =
  | { allowed: true; monthlyPlanAllowance: number }
  | {
      allowed: false;
      reason:
        | "article_quota_no_headroom"
        | "plan_headroom_exhausted"
        | "provider_daily_budget_reserved";
      monthlyPlanAllowance: number;
    };

export function evaluatePlanProviderReservationCapacity(args: {
  remainingArticles: number;
  budgetedPlansThisMonth: number;
  reservedTodayMicroUsd: number;
}): PlanProviderCapacityDecision {
  const monthlyPlanAllowance = automaticPlanAllowanceForArticleHeadroom(
    args.remainingArticles,
  );
  if (monthlyPlanAllowance === 0) {
    return {
      allowed: false,
      reason: "article_quota_no_headroom",
      monthlyPlanAllowance,
    };
  }
  if (args.budgetedPlansThisMonth >= monthlyPlanAllowance) {
    return {
      allowed: false,
      reason: "plan_headroom_exhausted",
      monthlyPlanAllowance,
    };
  }
  if (
    args.reservedTodayMicroUsd +
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD >
    AUTOMATIC_PLAN_PROVIDER_DAILY_CEILING_MICRO_USD
  ) {
    return {
      allowed: false,
      reason: "provider_daily_budget_reserved",
      monthlyPlanAllowance,
    };
  }
  return { allowed: true, monthlyPlanAllowance };
}

export function planRetryUsesCurrentReservationDay(
  reservationDay: string | undefined,
  now: number,
): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(reservationDay ?? "") &&
    reservationDay === new Date(now).toISOString().slice(0, 10)
  );
}

/**
 * Every worker invocation must be able to fund the one execution it is about
 * to start. The separate atomic Pentra reservation continues to own the full
 * initial-plus-retry envelope; requiring hypothetical retry cash in advance
 * would conflate provider wallet balance with Pentra's worst-case allowance.
 */
export function requiredPlanProviderBalanceMicroUsd(): number {
  return AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD;
}

export type PlanFailureClassification = {
  retryable: boolean;
  category: "transient_provider" | "terminal_planner";
};

/**
 * Planning defaults terminal because a replay can repeat every paid discovery
 * call. Only an explicit transport failure, provider throttling, or provider
 * 5xx is safe to retry with the existing bounded backoff. Empty inventory,
 * weak business fit, insufficient authority evidence, and duplicate/exhausted
 * topics therefore stop once and surface their evidence to the operator.
 */
export function classifyPlanFailure(
  message: string,
): PlanFailureClassification {
  const normalized = message.trim().toLowerCase();
  const transient =
    /\bhttp\s*(?:429|5\d\d)\b/.test(normalized) ||
    /\b(?:econnreset|econnrefused|etimedout|eai_again|enetwork|socket hang up)\b/.test(
      normalized,
    ) ||
    /\b(?:network request failed|fetch failed|request timed out|request timeout|temporarily unavailable|service unavailable|gateway timeout|bad gateway)\b/.test(
      normalized,
    );
  return transient
    ? { retryable: true, category: "transient_provider" }
    : { retryable: false, category: "terminal_planner" };
}
