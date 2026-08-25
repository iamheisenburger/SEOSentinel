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

// The fleet cron is intentionally coarse, but a tenant whose only blocker is
// the rolling topic-plan window should not wait for another three-hour slot.
// One second keeps the exact wake strictly outside the inclusive `gte`
// recent-job query without meaningfully delaying recovery.
export const TOPIC_PLAN_COOLDOWN_WINDOW_MS = 24 * 60 * 60 * 1000;
export const TOPIC_PLAN_COOLDOWN_WAKE_SAFETY_MS = 1_000;
export const TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER = "topic_plan_cooldown";
export const TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT = 200;
export const TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS = 60_000;
export const TOPIC_PLAN_COOLDOWN_MAX_CONTINUATION_ATTEMPTS = 3;
// A bound plan is never re-executed by this monitor. The mutation only reads
// the exact job receipt and advances one fenced poll generation; sixty
// minutes is longer than the worker action plus its ambiguity lease while
// remaining a finite, auditable recovery envelope.
export const TOPIC_PLAN_SETTLEMENT_POLL_MS = 30_000;
export const TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS = 120;

export type BoundedRecentPlanWindow<T> =
  | { decision: "available"; counted: T[] }
  | { decision: "limited"; counted: T[] }
  | { decision: "overflow"; counted: T[] }
  | { decision: "invalid_limit"; counted: [] };

/** Payload and zero-spend release state are not indexed, so callers read one
 * sentinel row beyond a fixed bound. A truncated window may prove the limit
 * is reached, but it may never prove capacity is available. */
export function evaluateBoundedRecentPlanWindow<T>(args: {
  rows: readonly T[];
  maximumRecent: number;
  isCounted: (row: T) => boolean;
  readLimit?: number;
}): BoundedRecentPlanWindow<T> {
  const readLimit = args.readLimit ?? TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT;
  if (
    !Number.isSafeInteger(readLimit) ||
    readLimit <= 0 ||
    !Number.isSafeInteger(args.maximumRecent) ||
    args.maximumRecent <= 0 ||
    args.maximumRecent > readLimit
  ) return { decision: "invalid_limit", counted: [] };
  const overflow = args.rows.length > readLimit;
  const counted = args.rows.slice(0, readLimit).filter(args.isCounted);
  if (counted.length >= args.maximumRecent) {
    return { decision: "limited", counted };
  }
  if (overflow) return { decision: "overflow", counted };
  return { decision: "available", counted };
}

export function topicPlanCooldownWakeAt(planCreatedAt: number): number | null {
  if (!Number.isFinite(planCreatedAt) || planCreatedAt < 0) return null;
  const dueAt = planCreatedAt + TOPIC_PLAN_COOLDOWN_WINDOW_MS +
    TOPIC_PLAN_COOLDOWN_WAKE_SAFETY_MS;
  return Number.isSafeInteger(dueAt) ? dueAt : null;
}

/** Deterministic execution receipt. It is a fencing token, not a secret: the
 * run, plan, rollout epoch, and exact due time must all independently match. */
export function topicPlanCooldownClaimNonce(args: {
  planJobId: string;
  rolloutEpoch: number;
  dueAt: number;
}): string | null {
  if (
    !args.planJobId ||
    !Number.isSafeInteger(args.rolloutEpoch) ||
    args.rolloutEpoch < 0 ||
    !Number.isSafeInteger(args.dueAt) ||
    args.dueAt < 0
  ) return null;
  return [
    TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
    args.planJobId,
    args.rolloutEpoch,
    args.dueAt,
  ].join(":");
}

export type TopicPlanCooldownReceiptState =
  | "missing"
  | "scheduled"
  | "claimed"
  | "settled";

/** Pure exact-receipt classification used both for the atomic claim and for a
 * readback after an ambiguous mutation response. */
export function topicPlanCooldownReceiptState(args: {
  run: {
    siteId: string;
    trigger: string;
    claimNonce?: string;
    scheduledAt: number;
    status: string;
  } | null | undefined;
  siteId: string;
  planJobId: string;
  rolloutEpoch: number;
  dueAt: number;
  claimNonce: string;
}): TopicPlanCooldownReceiptState {
  const expectedClaimNonce = topicPlanCooldownClaimNonce({
    planJobId: args.planJobId,
    rolloutEpoch: args.rolloutEpoch,
    dueAt: args.dueAt,
  });
  const exactReceipt = Boolean(
    args.run &&
    expectedClaimNonce &&
    args.run.siteId === args.siteId &&
    args.run.trigger === TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER &&
    args.run.claimNonce === expectedClaimNonce &&
    args.claimNonce === expectedClaimNonce &&
    args.run.scheduledAt === args.dueAt
  );
  if (!exactReceipt) return "missing";
  if (args.run!.status === "scheduled") return "scheduled";
  if (args.run!.status === "running") return "claimed";
  if (args.run!.status === "completed" || args.run!.status === "failed") {
    return "settled";
  }
  return "missing";
}

export type TopicPlanCooldownWatchdogDecision =
  | { decision: "fence_changed" }
  | { decision: "lease_live"; retryAt: number }
  | { decision: "exhausted" }
  | { decision: "recover"; continuationAttempt: number };

/** Pure recovery decision for a committed claim whose at-most-once action may
 * have died. Every retry remains bounded and must traverse the claim again. */
export function topicPlanCooldownWatchdogDecision(args: {
  receiptState: TopicPlanCooldownReceiptState;
  currentAttempt?: number;
  expectedAttempt: number;
  heartbeatAt: number;
  now: number;
}): TopicPlanCooldownWatchdogDecision {
  if (
    args.receiptState !== "claimed" ||
    !Number.isSafeInteger(args.expectedAttempt) ||
    args.expectedAttempt <= 0 ||
    args.currentAttempt !== args.expectedAttempt ||
    !Number.isSafeInteger(args.heartbeatAt) ||
    !Number.isSafeInteger(args.now)
  ) return { decision: "fence_changed" };
  const retryAt = args.heartbeatAt +
    TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS;
  if (!Number.isSafeInteger(retryAt)) return { decision: "fence_changed" };
  if (retryAt > args.now) return { decision: "lease_live", retryAt };
  if (
    args.expectedAttempt >= TOPIC_PLAN_COOLDOWN_MAX_CONTINUATION_ATTEMPTS
  ) return { decision: "exhausted" };
  return {
    decision: "recover",
    continuationAttempt: args.expectedAttempt + 1,
  };
}

/** Terminal writes from an action generation may settle only the exact run
 * generation they own. Ordinary unfenced runs retain their existing path. */
export function topicPlanCooldownTerminalWriteAllowed(args: {
  runClaimNonce?: string;
  runContinuationAttempt?: number;
  runStatus?: string;
  claimNonce?: string;
  continuationAttempt?: number;
}): boolean {
  if (!args.runClaimNonce) {
    return args.claimNonce === undefined &&
      args.continuationAttempt === undefined;
  }
  return Boolean(
    args.runStatus === "running" &&
    args.claimNonce === args.runClaimNonce &&
    Number.isSafeInteger(args.runContinuationAttempt) &&
    args.runContinuationAttempt === args.continuationAttempt
  );
}

export type TopicPlanSettlementDecision =
  | { decision: "fence_changed" }
  | { decision: "already_settled" }
  | { decision: "terminal_done" }
  | { decision: "terminal_failed" }
  | {
      decision: "ambiguous";
      reason:
        | "lease_expired"
        | "monitor_exhausted"
        | "terminal_finalizer_exhausted";
    }
  | { decision: "wait"; settlementAttempt: number };

/**
 * Provider-free terminal observer for the exact plan bound to a cooldown run.
 * It never changes or requeues the job. `settlementAttempt` is a durable CAS
 * generation, so an old poll cannot settle a newer binding or schedule an
 * unbounded fan-out after an ambiguous scheduler response.
 */
export function topicPlanSettlementDecision(args: {
  receiptState: TopicPlanCooldownReceiptState;
  currentSettlementAttempt?: number;
  expectedSettlementAttempt: number;
  jobStatus?: string;
  leaseExpiresAt?: number;
  now: number;
}): TopicPlanSettlementDecision {
  if (args.receiptState === "settled") {
    return { decision: "already_settled" };
  }
  if (
    args.receiptState !== "claimed" ||
    !Number.isSafeInteger(args.expectedSettlementAttempt) ||
    args.expectedSettlementAttempt <= 0 ||
    args.currentSettlementAttempt !== args.expectedSettlementAttempt ||
    !Number.isSafeInteger(args.now)
  ) return { decision: "fence_changed" };
  if (["done", "failed"].includes(args.jobStatus ?? "")) {
    // A terminal receipt first observed on the final active-monitor attempt
    // still gets one exact finalizer dispatch. Its pre-armed confirmation is
    // generation MAX + 1; if that finalizer persistently rejects or rolls
    // back, fail closed instead of scheduling an unbounded confirmation loop.
    if (
      args.expectedSettlementAttempt >
        TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS
    ) {
      return {
        decision: "ambiguous",
        reason: "terminal_finalizer_exhausted",
      };
    }
    return args.jobStatus === "done"
      ? { decision: "terminal_done" }
      : { decision: "terminal_failed" };
  }
  if (
    args.jobStatus === "running" &&
    Number.isSafeInteger(args.leaseExpiresAt) &&
    (args.leaseExpiresAt as number) <= args.now
  ) {
    return { decision: "ambiguous", reason: "lease_expired" };
  }
  if (!["pending", "running"].includes(args.jobStatus ?? "")) {
    return { decision: "fence_changed" };
  }
  if (
    args.expectedSettlementAttempt >=
      TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS
  ) {
    return { decision: "ambiguous", reason: "monitor_exhausted" };
  }
  return {
    decision: "wait",
    settlementAttempt: args.expectedSettlementAttempt + 1,
  };
}

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

/** A pre-provider release proves that the plan stopped before its first paid
 * request. It must not consume the tenant's one-per-window topic replenishment
 * allowance after funding or the current setup context is restored. Unknown
 * or ambiguous releases remain counted fail-closed. */
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
      "one_setup_planning_context_superseded_before_execution",
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
