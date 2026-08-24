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
export const AUTOMATIC_PLAN_YIELD_TARGET_VERSION = 1;
export const PLAN_CHECKPOINT_SINGLE_EXECUTION_VERSION = 1;
export const UNDERFILLED_PLAN_CONTINUATION_RECOVERY_VERSION = 1;
export const AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD = 1_000_000;
export const AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES = 1;
export const AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD =
  AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD *
  (AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES + 1);
export const AUTOMATIC_PLAN_PROVIDER_COST_CEILING_USD =
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD / 1_000_000;

/** Exact shared-ledger trigger bound to the plan payload that owns it. */
export function topicPlanProviderReservationTriggerFromPayload(
  payload: unknown,
): string {
  const record = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const migrationVersion = record.expectedClickPlanMigrationVersion;
  return Number.isInteger(migrationVersion) && (migrationVersion as number) > 0
    ? `expected_click_plan_migration_v${migrationVersion}`
    : "topic_plan";
}

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

/** Exact durable result count for the mutation that commits ordinary plan
 * inventory. Execution two is either a legacy transient retry (no prior
 * accepted count) or the one reserved underfill continuation (exact marker).
 */
export function atomicPlanPersistenceCumulativeCount(args: {
  workerExecution: number;
  acceptedTopicCount: number;
  continuation?: {
    version: unknown;
    firstExecutionCount: unknown;
    remainingTopicCapacity: unknown;
  };
}): number | null {
  if (
    !Number.isInteger(args.acceptedTopicCount) ||
    args.acceptedTopicCount < 0 ||
    ![1, 2].includes(args.workerExecution)
  ) return null;
  if (args.workerExecution === 1) {
    return !args.continuation &&
        args.acceptedTopicCount <= AUTOMATIC_PLAN_TOPIC_CAPACITY
      ? args.acceptedTopicCount
      : null;
  }
  if (!args.continuation) {
    return args.acceptedTopicCount <= AUTOMATIC_PLAN_TOPIC_CAPACITY
      ? args.acceptedTopicCount
      : null;
  }
  const firstExecutionCount = args.continuation.firstExecutionCount;
  if (
    args.continuation.version !== 1 ||
    !Number.isInteger(firstExecutionCount) ||
    (firstExecutionCount as number) <= 0 ||
    (firstExecutionCount as number) >= AUTOMATIC_PLAN_TOPIC_CAPACITY ||
    args.continuation.remainingTopicCapacity !==
      AUTOMATIC_PLAN_TOPIC_CAPACITY - (firstExecutionCount as number)
  ) return null;
  const cumulative = (firstExecutionCount as number) +
    args.acceptedTopicCount;
  return cumulative <= AUTOMATIC_PLAN_TOPIC_CAPACITY ? cumulative : null;
}

export type AutomaticPlanYieldTarget = {
  version: typeof AUTOMATIC_PLAN_YIELD_TARGET_VERSION;
  targetBufferShortfall: number;
  verifiedHorizonShortfall: number;
  articleQuotaHeadroom: number;
  requiredVerifiedYield: number;
};

/**
 * Read the immutable automatic-plan target written by the queue transaction.
 * Execution, watchdog recovery, and checkpoint activation all share this
 * parser so none can accept a different job shape or widen a paid plan later.
 */
export function automaticPlanYieldTargetFromPayload(
  payloadValue: unknown,
): AutomaticPlanYieldTarget | null {
  const payload = payloadValue && typeof payloadValue === "object"
    ? payloadValue as Record<string, unknown>
    : {};
  const marker = payload.planYieldTarget &&
      typeof payload.planYieldTarget === "object"
    ? payload.planYieldTarget as Record<string, unknown>
    : {};
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const fields = [
    marker.targetBufferShortfall,
    marker.verifiedHorizonShortfall,
    marker.articleQuotaHeadroom,
    marker.requiredVerifiedYield,
  ];
  if (
    payload.manual === true ||
    !reason.startsWith("topic_") ||
    payload.growthParentArticleId !== undefined ||
    payload.growthSeed !== undefined ||
    payload.growthActionFingerprint !== undefined ||
    payload.expectedClickPlanMigrationVersion !== undefined ||
    marker.version !== AUTOMATIC_PLAN_YIELD_TARGET_VERSION ||
    fields.some((value) => !Number.isInteger(value) || (value as number) < 0) ||
    (marker.requiredVerifiedYield as number) < 1 ||
    (marker.requiredVerifiedYield as number) > AUTOMATIC_PLAN_TOPIC_CAPACITY ||
    (marker.requiredVerifiedYield as number) >
      (marker.articleQuotaHeadroom as number) ||
    (marker.requiredVerifiedYield as number) !== Math.min(
      AUTOMATIC_PLAN_TOPIC_CAPACITY,
      marker.articleQuotaHeadroom as number,
      Math.max(
        marker.targetBufferShortfall as number,
        marker.verifiedHorizonShortfall as number,
      ),
    )
  ) return null;
  return marker as AutomaticPlanYieldTarget;
}

/** The initial durable checkpoint rollout is explicitly job-bound and admits
 * one provider execution. A frozen target without this queue-time marker is a
 * legacy automatic plan and must retain its prior behavior. */
export function automaticSingleExecutionCheckpointTargetFromPayload(
  payloadValue: unknown,
): AutomaticPlanYieldTarget | null {
  const payload = payloadValue && typeof payloadValue === "object"
    ? payloadValue as Record<string, unknown>
    : {};
  if (
    payload.planCheckpointModeVersion !==
      PLAN_CHECKPOINT_SINGLE_EXECUTION_VERSION
  ) return null;
  return automaticPlanYieldTargetFromPayload(payloadValue);
}

/**
 * Freeze the amount of verified inventory one paid plan is allowed to pursue.
 *
 * The queue transaction supplies canonical buffer/horizon counts and current
 * account article headroom. Execution must consume this persisted result
 * rather than widening the target after provider work has started.
 */
export function automaticPlanYieldTarget(args: {
  targetBufferShortfall: number;
  verifiedHorizonShortfall: number;
  articleQuotaHeadroom: number;
}): AutomaticPlanYieldTarget {
  const targetBufferShortfall = Math.max(
    0,
    Math.floor(Number.isFinite(args.targetBufferShortfall)
      ? args.targetBufferShortfall
      : 0),
  );
  const verifiedHorizonShortfall = Math.max(
    0,
    Math.floor(Number.isFinite(args.verifiedHorizonShortfall)
      ? args.verifiedHorizonShortfall
      : 0),
  );
  const articleQuotaHeadroom = Math.max(
    0,
    Math.floor(Number.isFinite(args.articleQuotaHeadroom)
      ? args.articleQuotaHeadroom
      : 0),
  );
  const requiredVerifiedYield = Math.min(
    AUTOMATIC_PLAN_TOPIC_CAPACITY,
    articleQuotaHeadroom,
    Math.max(targetBufferShortfall, verifiedHorizonShortfall),
  );
  return {
    version: AUTOMATIC_PLAN_YIELD_TARGET_VERSION,
    targetBufferShortfall,
    verifiedHorizonShortfall,
    articleQuotaHeadroom,
    requiredVerifiedYield,
  };
}

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
  requiredVerifiedYield?: number;
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
  const requiredVerifiedYield = args.requiredVerifiedYield === undefined
    ? AUTOMATIC_PLAN_MINIMUM_VERIFIED_YIELD
    : Math.min(
        AUTOMATIC_PLAN_TOPIC_CAPACITY,
        Math.max(0, Math.floor(args.requiredVerifiedYield)),
      );
  if (
    requiredVerifiedYield === 0 ||
    args.savedTopicCount >= requiredVerifiedYield
  ) {
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
    remainingTopicCapacity: args.requiredVerifiedYield === undefined
      ? AUTOMATIC_PLAN_TOPIC_CAPACITY - args.savedTopicCount
      : Math.min(
          requiredVerifiedYield - args.savedTopicCount,
          AUTOMATIC_PLAN_TOPIC_CAPACITY - args.savedTopicCount,
        ),
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
      "plan_cancelled_before_execution",
      "plan_reservation_day_expired_before_execution",
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
