import type { Doc } from "../_generated/dataModel";
import {
  PLAN_CANDIDATE_CHECKPOINT_LIMIT,
  PLAN_CANDIDATE_CHECKPOINT_VERSION,
} from "./planCandidateCheckpoint.ts";
import {
  AUTOMATIC_PLAN_TOPIC_CAPACITY,
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
  automaticSingleExecutionCheckpointTargetFromPayload,
  topicPlanCooldownWakeAt,
} from "./planProviderBudget.ts";
import {
  CADENCE_BALANCE_RECHECK_MS,
  CADENCE_LIVENESS_VERSION,
  CADENCE_PROVIDER_RECHECK_MS,
  classifyCadenceFailure,
  nextUtcDayAt,
  nextUtcMonthAt,
} from "./cadenceLiveness.ts";

export const OPERATOR_PLAN_RECEIPT_LIMIT = 8;
export const OPERATOR_PLAN_CHECKPOINT_READ_LIMIT = 2;

export type OperatorPlanDomainBinding =
  | "current"
  | "legacy_current"
  | "stale";

const CADENCE_FAILURE_CATEGORIES = new Set([
  "semantic_zero_yield",
  "transient_provider",
  "provider_funding",
  "budget_window",
  "monthly_quota",
  "readiness",
  "entitlement",
  "terminal_invariant",
]);

const PLAN_RELEASE_REASONS = new Set([
  "provider_balance_insufficient",
  "provider_balance_preflight_unavailable",
  "plan_cancelled_before_execution",
  "plan_reservation_day_expired_before_execution",
  "one_setup_planning_context_superseded_before_execution",
]);

const TERMINAL_CHECKPOINT_STATUSES = new Set([
  "inline_completed",
  "activated",
  "empty",
  "terminal_blocked",
]);

const RUN_STATUSES = new Set([
  "scheduled",
  "running",
  "completed",
  "failed",
]);

const RUN_OUTCOMES = new Set([
  "autopilot_disabled",
  "cadence_paused",
  "rollout_observe",
  "readiness_regressed",
  "migration_pending",
  "public_url_failed",
  "rollout_buffer_ready",
  "quality_budget_exhausted",
  "quota_reached",
  "site_limit_reached",
  "topic_replenishment_exhausted",
  "cadence_failure_cooldown",
  "public_url_pending",
  "automatic_live_promotion",
  "buffer_delivery",
  "buffer_delivery_pending",
  "pending_plan",
  "work_in_progress",
  "approval_waiting",
  "manual_delivery_waiting",
  "cadence_not_due",
  "quality_revision",
  "deterministic_repair",
  "topic_portfolio_goal_replenishment",
  "topic_portfolio_evidence_replenishment",
  "topic_replenishment",
  "buffer_fill",
  "cadence_generation",
  "idle",
  "buffer_full",
  "claim_lost",
  "retry_scheduled",
  "plan_continuation_queued",
  "buffer_ready",
  "quality_recovered",
  "job_processed",
  "publication_succeeded",
  "quality_quarantined",
  "publication_failed",
  "job_failed",
  "site_parked",
  "failed",
  "domain_epoch_invalidated",
  "cadence_held",
  "onboarding_in_progress",
  "onboarding_cooling_down",
  "onboarding_budget_blocked",
  "onboarding_failed",
  "onboarding_cache_invalid",
  "wake_receipt_incompatible",
  "autopilot_or_entitlement_ineligible",
  "rollout_epoch_changed",
  "plan_cooldown_fence_changed",
  "plan_history_overflow",
  "newer_topic_plan_exists",
  "continuation_before_claim",
  "active_job",
]);

const HEALTH_STATUSES = new Set([
  "recovering",
  "cadence_paused",
  "readiness_blocked",
  "run_failed",
  "rollout_observe",
  "migration_pending",
  "autopilot_disabled",
  "readiness_regressed",
  "public_url_failed",
  "quota_reached",
  "site_limit_reached",
  "topic_replenishment_exhausted",
  "cadence_failure_cooldown",
  "quality_quarantined",
  "publication_failed",
  "job_failed",
  "site_parked",
  "run_outcome_unclassified",
  "healthy",
  "buffer_empty",
  "buffer_low",
  "public_url_pending",
  "scheduler_stale",
  "missed",
  "quality_budget_exhausted",
  "job_lease_exhausted",
  "rollout_conflict",
  "rollout_buffer_ready",
  "topic_portfolio_below_goal",
  "topic_portfolio_evidence_missing",
]);

const PORTFOLIO_STATUSES = new Set([
  "supports_goal",
  "below_goal",
  "insufficient_evidence",
  "goal_unconfigured",
]);

const ARTICLE_STATUSES = new Set([
  "draft",
  "review",
  "ready",
  "rejected",
  "published",
]);
const MEDIA_QUALITY_STATUSES = new Set(["passed", "failed"]);
const PUBLICATION_GATE_STATUSES = new Set(["passed", "blocked"]);
const JOB_TYPES = new Set([
  "onboarding",
  "plan",
  "article",
  "links",
  "scheduler",
]);
const JOB_STATUSES = new Set(["pending", "running", "done", "failed"]);

const CADENCE_FAILURE_CODES = new Map<string, ReadonlySet<string>>([
  ["semantic_zero_yield", new Set(["strict_zero_yield"])],
  [
    "transient_provider",
    new Set([
      "provider_preflight_unavailable",
      "provider_balance_preflight_unavailable",
      "transient_provider_failure",
      "one_setup_planning_context_superseded_before_execution",
    ]),
  ],
  ["provider_funding", new Set(["provider_balance_insufficient"])],
  [
    "budget_window",
    new Set([
      "provider_reservation_day_expired",
      "plan_reservation_day_expired_before_execution",
    ]),
  ],
  ["monthly_quota", new Set(["monthly_generation_quota"])],
  ["readiness", new Set(["tenant_readiness_blocked"])],
  ["entitlement", new Set(["tenant_entitlement_blocked"])],
  ["terminal_invariant", new Set(["terminal_planner_invariant"])],
]);

function safeOperatorCode(
  value: string | undefined,
  allowed: ReadonlySet<string>,
): string | undefined {
  if (value === undefined) return undefined;
  return allowed.has(value) ? value : "unclassified";
}

type SafeCadenceFailure = {
  category: string;
  code: string;
  eligibleAt?: number;
  terminal: boolean;
};

/** Mirror the finite set of receipts emitted by the three terminal plan
 * writers. A recognized category/code is not sufficient: timing and
 * retryability must describe an actual writer branch on this exact job. */
function operatorCadenceFailureReceipt(
  job: Doc<"jobs">,
): SafeCadenceFailure | null {
  const failure = job.cadenceFailure;
  if (!failure) return null;
  const category = failure.category;
  const code = failure.code;
  const allowedFailureCodes = CADENCE_FAILURE_CODES.get(category);
  if (
    job.type !== "plan" || job.status !== "failed" ||
    typeof job.error !== "string" ||
    failure.version !== CADENCE_LIVENESS_VERSION ||
    !CADENCE_FAILURE_CATEGORIES.has(category) ||
    !allowedFailureCodes?.has(code) ||
    !Number.isSafeInteger(job.createdAt) || job.createdAt < 0 ||
    !Number.isSafeInteger(job.updatedAt) || job.updatedAt < job.createdAt ||
    !Number.isSafeInteger(failure.recordedAt) ||
    failure.recordedAt !== job.updatedAt
  ) return null;

  const exactEligibleAt = (
    expected: number | undefined,
    requireFuture = true,
  ): boolean =>
    expected === undefined
      ? failure.eligibleAt === undefined
      : Number.isSafeInteger(expected) &&
        (!requireFuture || expected > failure.recordedAt) &&
        failure.eligibleAt === expected;
  let expectedEligibleAt: number | undefined;
  let retryable = false;
  let terminal = true;

  switch (category) {
    case "semantic_zero_yield": {
      const payload = job.payload && typeof job.payload === "object" &&
          !Array.isArray(job.payload)
        ? job.payload as Record<string, unknown>
        : {};
      const automaticCheckpointPlan = payload.manual !== true &&
        typeof payload.reason === "string" &&
        payload.reason.startsWith("topic_") &&
        automaticSingleExecutionCheckpointTargetFromPayload(job.payload) !==
          null;
      expectedEligibleAt = automaticCheckpointPlan
        ? topicPlanCooldownWakeAt(job.createdAt) ?? undefined
        : undefined;
      break;
    }
    case "transient_provider":
      if (
        code === "transient_provider_failure" &&
        failure.retryable === false && failure.terminal === true &&
        failure.eligibleAt === undefined
      ) {
        // markRetryableFailure exhausts the job's bounded attempts and clears
        // its same-job retry deadline.
        if (
          !Number.isSafeInteger(job.workerAttempts) ||
          (job.workerAttempts ?? 0) < 1
        ) return null;
        const prefix = `Worker failure exhausted after ${job.workerAttempts} attempts: `;
        if (!job.error.startsWith(prefix)) return null;
        const classified = classifyCadenceFailure({
          message: job.error.slice(prefix.length),
          now: failure.recordedAt,
          retryAt: failure.recordedAt + CADENCE_PROVIDER_RECHECK_MS,
          explicitCode: "transient_provider_failure",
        });
        if (
          classified.category !== category || classified.code !== code
        ) return null;
        return { category, code, eligibleAt: undefined, terminal: true };
      }
      retryable = true;
      terminal = false;
      expectedEligibleAt = failure.recordedAt + CADENCE_PROVIDER_RECHECK_MS;
      break;
    case "provider_funding":
      expectedEligibleAt = failure.recordedAt + CADENCE_BALANCE_RECHECK_MS;
      break;
    case "budget_window":
      expectedEligibleAt = nextUtcDayAt(failure.recordedAt);
      break;
    case "monthly_quota":
      expectedEligibleAt = nextUtcMonthAt(failure.recordedAt);
      break;
    case "readiness":
    case "entitlement":
    case "terminal_invariant":
      expectedEligibleAt = undefined;
      break;
    default:
      return null;
  }
  if (
    failure.retryable !== retryable || failure.terminal !== terminal ||
    !exactEligibleAt(
      expectedEligibleAt,
      category !== "semantic_zero_yield",
    )
  ) return null;
  const exactAbortError = code ===
      "provider_balance_preflight_unavailable"
    ? "Provider account funding preflight blocked paid topic planning."
    : code === "plan_reservation_day_expired_before_execution"
      ? "The plan reservation expired before its first paid execution."
      : code === "one_setup_planning_context_superseded_before_execution"
        ? "The saved setup planning context changed before paid topic planning."
        : null;
  if (exactAbortError !== null) {
    if (job.error !== exactAbortError) return null;
  } else {
    const classified = classifyCadenceFailure({
      message: job.error,
      now: failure.recordedAt,
    });
    if (classified.category !== category || classified.code !== code) {
      return null;
    }
  }
  return { category, code, eligibleAt: failure.eligibleAt, terminal };
}

export function latestTerminalPlanJobs<
  T extends { createdAt: number; _creationTime: number },
>(done: readonly T[], failed: readonly T[]): T[] {
  return [...done, ...failed]
    .sort((left, right) =>
      right.createdAt - left.createdAt ||
      right._creationTime - left._creationTime
    )
    .slice(0, OPERATOR_PLAN_RECEIPT_LIMIT);
}

/** A deliberately narrow terminal/continuation receipt. Raw job inputs,
 * results, errors and worker credentials are never part of this projection. */
export function operatorPlanJobReceipt(
  job: Doc<"jobs">,
  domainBinding: OperatorPlanDomainBinding,
) {
  if (job.status !== "done" && job.status !== "failed") {
    throw new Error("Operator plan receipts require a terminal job");
  }
  const safeFailure = operatorCadenceFailureReceipt(job) ?? undefined;
  const persistedTopicCount = operatorPersistedTopicCountReceipt(job);
  return {
    jobId: job._id,
    status: job.status,
    domainBinding,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    workerAttempts: job.workerAttempts,
    cadenceFailureState: job.cadenceFailure
      ? safeFailure ? "recorded" as const : "invalid" as const
      : "none" as const,
    cadenceFailure: safeFailure,
    ...persistedTopicCount,
  };
}

/** Derive the only safe terminal plan result field. Modern atomic persistence
 * receipts must agree with the compact count; legacy/manual results may lack
 * that additive receipt but remain bounded to the same ten-topic envelope. */
export function operatorPersistedTopicCountReceipt(job: Doc<"jobs">): {
  persistedTopicCountState: "missing" | "invalid" | "recorded";
  persistedTopicCount?: number;
} {
  const result = job.result && typeof job.result === "object" &&
      !Array.isArray(job.result)
    ? job.result as Record<string, unknown>
    : null;
  if (!result || !("count" in result)) {
    return { persistedTopicCountState: "missing" };
  }
  const count = result.count;
  if (
    !Number.isSafeInteger(count) ||
    (count as number) < 0 ||
    (count as number) > AUTOMATIC_PLAN_TOPIC_CAPACITY
  ) return { persistedTopicCountState: "invalid" };
  const rawCommit = result.planPersistenceCommit;
  if (rawCommit !== undefined) {
    if (
      !rawCommit ||
      typeof rawCommit !== "object" ||
      Array.isArray(rawCommit) ||
      (rawCommit as Record<string, unknown>).version !== 1 ||
      (rawCommit as Record<string, unknown>).cumulativeTopicCount !== count
    ) return { persistedTopicCountState: "invalid" };
  }
  return {
    persistedTopicCountState: "recorded",
    persistedTopicCount: count as number,
  };
}

/** Checkpoint candidate contents stay private. Counts are sufficient to prove
 * whether the exact paid plan staged, sealed, activated or excluded work. */
export function operatorPlanCheckpointReceipt(
  checkpoint: Doc<"plan_candidate_checkpoints">,
) {
  return {
    status: safeOperatorCode(checkpoint.status, TERMINAL_CHECKPOINT_STATUSES),
    completedAt: checkpoint.completedAt,
    activatedAt: checkpoint.activatedAt,
    updatedAt: checkpoint.updatedAt,
    workerExecution: checkpoint.workerExecution,
    requiredVerifiedYield: checkpoint.requiredVerifiedYield,
    candidateCapacity: checkpoint.candidateCapacity,
    candidateCount: checkpoint.candidateTopicIds.length,
    inlineCompletedCount: checkpoint.inlineCompletedTopicIds?.length ?? 0,
    activatedCount: checkpoint.activatedTopicIds?.length ?? 0,
    excludedCount: checkpoint.terminallyExcludedTopicIds?.length ?? 0,
    usableTopicCount: checkpoint.status === "inline_completed"
      ? checkpoint.inlineCompletedTopicIds?.length ?? 0
      : checkpoint.status === "activated"
        ? checkpoint.activatedTopicIds?.length ?? 0
        : 0,
  };
}

/** Only terminal states from the single-execution checkpoint contract can
 * contribute count-only acceptance evidence. */
export function operatorCheckpointStatusAllowed(status: string): boolean {
  return TERMINAL_CHECKPOINT_STATUSES.has(status);
}

/** Validate count-bearing checkpoint arrays without exposing their IDs.
 * Every result list must be a bounded, duplicate-free subset of the immutable
 * candidate set; the candidate set itself must also be unique and bounded. */
export function operatorCheckpointIdsAreBoundedUniqueSubset<T>(
  candidateIds: readonly T[],
  resultIds: readonly T[] | undefined,
): boolean {
  if (candidateIds.length > PLAN_CANDIDATE_CHECKPOINT_LIMIT) return false;
  const candidates = new Set(candidateIds);
  if (candidates.size !== candidateIds.length) return false;
  if (resultIds === undefined) return true;
  if (
    resultIds.length > candidateIds.length ||
    resultIds.length > PLAN_CANDIDATE_CHECKPOINT_LIMIT
  ) return false;
  const seen = new Set<T>();
  for (const id of resultIds) {
    if (!candidates.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

function operatorCheckpointIdsExactlyPartition<T>(
  candidateIds: readonly T[],
  acceptedIds: readonly T[] | undefined,
  excludedIds: readonly T[] | undefined,
): boolean {
  if (acceptedIds === undefined || excludedIds === undefined) return false;
  const partition = [...acceptedIds, ...excludedIds];
  if (partition.length !== candidateIds.length) return false;
  const partitionSet = new Set(partition);
  return partitionSet.size === candidateIds.length &&
    candidateIds.every((id) => partitionSet.has(id));
}

function utcProviderReservationPeriod(timestamp: number): {
  day: string;
  month: string;
} | null {
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return { day: iso.slice(0, 10), month: iso.slice(0, 7) };
}

export function operatorTerminalPlanReceipt(args: {
  siteId: Doc<"sites">["_id"];
  siteUserId?: string;
  job: Doc<"jobs">;
  domainBinding: OperatorPlanDomainBinding;
  expectedReservationTrigger: string;
  checkpoints: readonly Doc<"plan_candidate_checkpoints">[];
  reservation: Doc<"provider_spend_reservations"> | null;
}) {
  const checkpoint = args.checkpoints.length === 1
    ? args.checkpoints[0]
    : null;
  const checkpointTarget = automaticSingleExecutionCheckpointTargetFromPayload(
    args.job.payload,
  );
  const persistedTopicCount = operatorPersistedTopicCountReceipt(args.job);
  const result = args.job.result && typeof args.job.result === "object" &&
      !Array.isArray(args.job.result)
    ? args.job.result as Record<string, unknown>
    : null;
  const rawCheckpointCommit = result?.planCheckpointCommit;
  const checkpointCommit = rawCheckpointCommit &&
      typeof rawCheckpointCommit === "object" &&
      !Array.isArray(rawCheckpointCommit)
    ? rawCheckpointCommit as Record<string, unknown>
    : null;
  const checkpointAcceptedKeys = checkpoint?.inlineCompletedTopicIds?.map(String) ??
    [];
  const committedKeys = Array.isArray(checkpointCommit?.acceptedTopicIds)
    ? checkpointCommit.acceptedTopicIds.map(String)
    : [];
  const exactInlineSuccessCommit = Boolean(
    checkpoint && checkpointCommit &&
      typeof checkpoint.inlineSuccessCommitNonce === "string" &&
      checkpoint.inlineSuccessCommitNonce.length > 0 &&
      checkpointCommit.version === 1 &&
      checkpointCommit.completionNonce === checkpoint.inlineSuccessCommitNonce &&
      String(checkpointCommit.checkpointId) === String(checkpoint._id) &&
      checkpointCommit.workerExecution === checkpoint.workerExecution &&
      checkpointCommit.committedAt === checkpoint.completedAt &&
      JSON.stringify(committedKeys) === JSON.stringify(checkpointAcceptedKeys),
  );
  const checkpointTimelineValid = Boolean(
    checkpoint &&
      Number.isFinite(args.job.createdAt) &&
      Number.isFinite(args.job.updatedAt) &&
      Number.isFinite(checkpoint.createdAt) &&
      Number.isFinite(checkpoint.updatedAt) &&
      args.job.createdAt <= checkpoint.createdAt &&
      checkpoint.createdAt <= checkpoint.updatedAt &&
      checkpoint.updatedAt <= args.job.updatedAt,
  );
  const completedAtMatchesCheckpoint = Boolean(
    checkpoint && Number.isFinite(checkpoint.completedAt) &&
      checkpoint.completedAt === checkpoint.updatedAt,
  );
  const activatedAtMatchesCheckpoint = Boolean(
    checkpoint && Number.isFinite(checkpoint.activatedAt) &&
      checkpoint.activatedAt === checkpoint.updatedAt,
  );
  const candidateCount = checkpoint?.candidateTopicIds.length ?? 0;
  const inlineCompletedCount = checkpoint?.inlineCompletedTopicIds?.length ?? 0;
  const activatedCount = checkpoint?.activatedTopicIds?.length ?? 0;
  const excludedCount = checkpoint?.terminallyExcludedTopicIds?.length ?? 0;
  const inlinePartitionMatches = Boolean(
    checkpoint && operatorCheckpointIdsExactlyPartition(
      checkpoint.candidateTopicIds,
      checkpoint.inlineCompletedTopicIds,
      checkpoint.terminallyExcludedTopicIds,
    ),
  );
  const activatedPartitionMatches = Boolean(
    checkpoint && operatorCheckpointIdsExactlyPartition(
      checkpoint.candidateTopicIds,
      checkpoint.activatedTopicIds,
      checkpoint.terminallyExcludedTopicIds,
    ),
  );
  const fullyExcludedPartitionMatches = Boolean(
    checkpoint && operatorCheckpointIdsExactlyPartition(
      checkpoint.candidateTopicIds,
      [],
      checkpoint.terminallyExcludedTopicIds,
    ),
  );
  const providerReservationPeriod = utcProviderReservationPeriod(
    args.job.createdAt,
  );
  const checkpointTerminalStateMatchesJob = Boolean(
    checkpoint && checkpointTimelineValid &&
      (
        args.job.status === "done"
          ? checkpoint.status === "inline_completed" &&
            args.job.workerAttempts === 0 &&
            completedAtMatchesCheckpoint &&
            checkpoint.updatedAt === args.job.updatedAt &&
            checkpoint.activatedAt === undefined &&
            checkpoint.activationScheduledAt === undefined &&
            checkpoint.activatedTopicIds === undefined &&
            candidateCount > 0 &&
            inlineCompletedCount > 0 &&
            activatedCount === 0 &&
            inlinePartitionMatches &&
            exactInlineSuccessCommit &&
            persistedTopicCount.persistedTopicCountState === "recorded" &&
            persistedTopicCount.persistedTopicCount ===
              inlineCompletedCount
          : args.job.result !== undefined
            ? false
            : checkpoint.status === "empty"
              ? (args.job.workerAttempts === 0 ||
                  args.job.workerAttempts === 1) &&
                completedAtMatchesCheckpoint &&
                checkpoint.completedAt === checkpoint.createdAt &&
                checkpoint.activatedAt === undefined &&
                checkpoint.activationScheduledAt === undefined &&
                checkpoint.inlineSuccessCommitNonce === undefined &&
                checkpoint.inlineCompletedTopicIds === undefined &&
                checkpoint.activatedTopicIds === undefined &&
                checkpoint.terminallyExcludedTopicIds === undefined &&
                candidateCount === 0 &&
                inlineCompletedCount === 0 &&
                activatedCount === 0 &&
                excludedCount === 0
              : checkpoint.status === "activated"
                ? args.job.workerAttempts === 1 &&
                  activatedAtMatchesCheckpoint &&
                  checkpoint.updatedAt === args.job.updatedAt &&
                  checkpoint.completedAt === undefined &&
                  checkpoint.inlineSuccessCommitNonce === undefined &&
                  candidateCount > 0 &&
                  (activatedCount === 0 ||
                    checkpoint.inlineCompletedTopicIds === undefined) &&
                  (activatedCount > 0
                    ? checkpoint.activationScheduledAt ===
                      checkpoint.activatedAt
                    : checkpoint.activationScheduledAt === undefined) &&
                  activatedPartitionMatches
                : checkpoint.status === "terminal_blocked" &&
                  candidateCount > 0 &&
                  activatedCount === 0 &&
                  checkpoint.activationScheduledAt === undefined &&
                  checkpoint.inlineSuccessCommitNonce === undefined &&
                  checkpoint.terminallyExcludedTopicIds !== undefined &&
                  (
                    (
                      completedAtMatchesCheckpoint &&
                      checkpoint.updatedAt === args.job.updatedAt &&
                      checkpoint.activatedAt === undefined &&
                      args.job.workerAttempts === 0 &&
                      checkpoint.inlineCompletedTopicIds !== undefined &&
                      checkpoint.inlineCompletedTopicIds.length === 0 &&
                      checkpoint.activatedTopicIds !== undefined &&
                      checkpoint.activatedTopicIds.length === 0 &&
                      fullyExcludedPartitionMatches
                    ) ||
                    (
                      activatedAtMatchesCheckpoint &&
                      checkpoint.updatedAt === args.job.updatedAt &&
                      checkpoint.completedAt === undefined &&
                      args.job.workerAttempts === 1 &&
                      activatedPartitionMatches
                    )
                  )
      )
  );
  const exactCheckpoint = Boolean(
    checkpoint &&
      checkpointTarget &&
      args.siteUserId &&
      checkpoint.siteId === args.siteId &&
      checkpoint.userId === args.siteUserId &&
      checkpoint.planJobId === args.job._id &&
      checkpoint.workerExecution === 1 &&
      checkpoint.policyVersion === PLAN_CANDIDATE_CHECKPOINT_VERSION &&
      checkpoint.rolloutEpoch === args.job.rolloutEpoch &&
      checkpoint.providerSpendReservationId ===
        args.job.providerSpendReservationId &&
      checkpoint.providerCostCeilingMicroUsd ===
        args.job.providerCostCeilingMicroUsd &&
      checkpoint.providerCostReservedMicroUsd ===
        args.job.providerCostReservedMicroUsd &&
      checkpoint.reservationDay === args.job.providerCostReservationDay &&
      checkpoint.reservationDay === providerReservationPeriod?.day &&
      checkpoint.candidateTopicIds.length ===
        checkpoint.candidateFingerprints.length &&
      new Set(checkpoint.candidateFingerprints).size ===
        checkpoint.candidateFingerprints.length &&
      checkpoint.candidateTopicIds.length <=
        PLAN_CANDIDATE_CHECKPOINT_LIMIT &&
      operatorCheckpointIdsAreBoundedUniqueSubset(
        checkpoint.candidateTopicIds,
        checkpoint.inlineCompletedTopicIds,
      ) &&
      operatorCheckpointIdsAreBoundedUniqueSubset(
        checkpoint.candidateTopicIds,
        checkpoint.activatedTopicIds,
      ) &&
      operatorCheckpointIdsAreBoundedUniqueSubset(
        checkpoint.candidateTopicIds,
        checkpoint.terminallyExcludedTopicIds,
      ) &&
      Number.isInteger(checkpoint.requiredVerifiedYield) &&
      checkpoint.requiredVerifiedYield ===
        checkpointTarget.requiredVerifiedYield &&
      Number.isInteger(checkpoint.candidateCapacity) &&
      checkpoint.candidateCapacity === checkpoint.requiredVerifiedYield &&
      checkpoint.candidateCapacity === checkpointTarget.requiredVerifiedYield &&
      checkpoint.candidateTopicIds.length <= checkpoint.candidateCapacity &&
      operatorCheckpointStatusAllowed(checkpoint.status) &&
      checkpointTerminalStateMatchesJob
  );
  const reservationUnreleased = args.reservation?.releasedAt === undefined &&
    args.reservation?.releaseReason === undefined &&
    args.job.providerReservationReleasedAt === undefined &&
    args.job.providerReservationReleaseReason === undefined;
  const reservationReleasedBeforePaidWork = Boolean(
    Number.isFinite(args.reservation?.releasedAt) &&
      Number.isFinite(args.reservation?.createdAt) &&
      Number.isFinite(args.job.createdAt) &&
      Number.isFinite(args.job.updatedAt) &&
      (args.reservation?.releasedAt ?? -Infinity) >=
        (args.reservation?.createdAt ?? Infinity) &&
      args.reservation?.releasedAt ===
        args.job.providerReservationReleasedAt &&
      typeof args.reservation?.releaseReason === "string" &&
      args.reservation.releaseReason ===
        args.job.providerReservationReleaseReason &&
      PLAN_RELEASE_REASONS.has(args.reservation.releaseReason) &&
      (args.reservation.releasedAt ?? Infinity) <= args.job.updatedAt &&
      args.job.status === "failed" &&
      args.job.workerAttempts === 0 &&
      args.checkpoints.length === 0 &&
      args.job.result === undefined,
  );
  const releasePairMatches = reservationUnreleased ||
    reservationReleasedBeforePaidWork;
  const exactReservation = Boolean(
    args.reservation &&
      args.siteUserId &&
      providerReservationPeriod &&
      Number.isFinite(args.job.createdAt) &&
      Number.isFinite(args.job.updatedAt) &&
      args.job.createdAt <= args.job.updatedAt &&
      Number.isFinite(args.reservation.createdAt) &&
      args.reservation._id === args.job.providerSpendReservationId &&
      args.reservation.siteId === args.siteId &&
      args.reservation.userId === args.siteUserId &&
      args.reservation.purpose === "topic_plan" &&
      args.reservation.trigger === args.expectedReservationTrigger &&
      args.reservation.createdAt === args.job.createdAt &&
      args.reservation.reservationDay ===
        args.job.providerCostReservationDay &&
      args.reservation.reservationDay === providerReservationPeriod.day &&
      args.reservation.reservationMonth === providerReservationPeriod.month &&
      args.reservation.reservedMicroUsd ===
        args.job.providerCostReservedMicroUsd &&
      args.reservation.reservedMicroUsd ===
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
      args.job.providerCostReservedMicroUsd ===
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
      args.job.providerCostCeilingMicroUsd ===
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
      releasePairMatches
  );
  return {
    ...operatorPlanJobReceipt(args.job, args.domainBinding),
    checkpointState: args.checkpoints.length === 0
      ? "none" as const
      : exactCheckpoint
        ? "single" as const
        : "multiple_or_invalid" as const,
    checkpoint: exactCheckpoint
      ? operatorPlanCheckpointReceipt(checkpoint!)
      : undefined,
    providerReservationState: !args.job.providerSpendReservationId
      ? "missing" as const
      : exactReservation
        ? args.reservation!.releasedAt === undefined
          ? "retained_no_replay" as const
          : "released_before_paid_work" as const
        : "invalid" as const,
  };
}

export function operatorPlanReleaseReasonAllowed(
  reason: string | undefined,
): boolean {
  return reason === undefined || PLAN_RELEASE_REASONS.has(reason);
}

/** Only fields required to follow the provider-free terminal observer are
 * retained. In particular, claim nonces and free-form details are omitted. */
export function operatorContinuationRunReceipt(
  run: Doc<"autopilot_runs">,
) {
  const trigger = run.recoveryOfRunId
    ? "recovery" as const
    : run.trigger === "natural"
      ? "natural" as const
      : run.trigger === "manual"
        ? "manual" as const
        : run.trigger === TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER
          ? "cooldown" as const
          : [
              "cadence_deadline",
              "quality_budget_deadline",
              "generation_quota_deadline",
            ].includes(run.trigger)
            ? "deadline" as const
            : "followup" as const;
  return {
    runId: run._id,
    recoveryOfRunId: run.recoveryOfRunId,
    jobId: run.jobId,
    trigger,
    status: safeOperatorCode(run.status, RUN_STATUSES),
    outcome: safeOperatorCode(run.outcome, RUN_OUTCOMES),
    scheduledAt: run.scheduledAt,
    startedAt: run.startedAt,
    heartbeatAt: run.heartbeatAt,
    completedAt: run.completedAt,
    continuationAttempt: run.continuationAttempt,
    topicPlanSettlementAttempt: run.topicPlanSettlementAttempt,
  };
}

export function operatorHealthReceipt(
  health: Doc<"autopilot_health"> | null,
) {
  if (!health) return null;
  return {
    status: safeOperatorCode(health.status, HEALTH_STATUSES),
    lastRunId: health.lastRunId,
    heartbeatAt: health.heartbeatAt,
    lastNaturalScheduledAt: health.lastNaturalScheduledAt,
    lastNaturalStartedAt: health.lastNaturalStartedAt,
    lastNaturalCompletedAt: health.lastNaturalCompletedAt,
    lastPublishedAt: health.lastPublishedAt,
    nextPublicationDueAt: health.nextPublicationDueAt,
    approvedBufferCount: health.approvedBufferCount,
    bufferMinimum: health.bufferMinimum,
    bufferTarget: health.bufferTarget,
    portfolioStatus: safeOperatorCode(
      health.portfolioStatus,
      PORTFOLIO_STATUSES,
    ),
    portfolioDecision: ["accept", "reject", "flag"].includes(
        health.portfolioDecision ?? "",
      )
      ? health.portfolioDecision
      : health.portfolioDecision === undefined
        ? undefined
        : "unclassified",
    portfolioSupportsGoal: health.portfolioSupportsGoal,
    portfolioExpectedClicksMonthly: health.portfolioExpectedClicksMonthly,
    portfolioGoalMonthly: health.portfolioGoalMonthly,
    portfolioClickDeficit: health.portfolioClickDeficit,
    portfolioEvidenceMissing: health.portfolioEvidenceMissing,
    portfolioEvaluatedAt: health.portfolioEvaluatedAt,
    portfolioVersion: health.portfolioVersion,
    updatedAt: health.updatedAt,
  };
}

export function operatorArticleReceipt(
  article: Doc<"article_summaries">,
  sealed: boolean,
) {
  return {
    articleId: article.articleId,
    status: safeOperatorCode(article.status, ARTICLE_STATUSES),
    editorialQualityScore: article.editorialQualityScore,
    factCheckScore: article.factCheckScore,
    mediaQualityStatus: safeOperatorCode(
      article.mediaQualityStatus,
      MEDIA_QUALITY_STATUSES,
    ),
    publicationGateStatus: safeOperatorCode(
      article.publicationGateStatus,
      PUBLICATION_GATE_STATUSES,
    ),
    publicationAuditVersion: article.publicationAuditVersion,
    sealed,
    qualityRevisionCount: article.qualityRevisionCount,
    createdAt: article.articleCreatedAt,
    updatedAt: article.articleUpdatedAt,
  };
}

export function operatorActiveJobReceipt(job: Doc<"jobs">) {
  return {
    jobId: job._id,
    type: safeOperatorCode(job.type, JOB_TYPES),
    status: safeOperatorCode(job.status, JOB_STATUSES),
    retries: job.retries,
    workerAttempts: job.workerAttempts,
    publicationAttempts: job.publicationAttempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
