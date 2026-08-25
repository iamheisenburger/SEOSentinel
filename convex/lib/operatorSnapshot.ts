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
} from "./planProviderBudget.ts";

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

function safeOperatorCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return /^[a-z0-9][a-z0-9_:-]{0,99}$/i.test(value)
    ? value
    : "unclassified";
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
  const category = job.cadenceFailure?.category;
  const code = job.cadenceFailure?.code;
  const safeFailure = job.cadenceFailure &&
      category && CADENCE_FAILURE_CATEGORIES.has(category) &&
      code && /^[a-z0-9][a-z0-9_:-]{0,99}$/i.test(code)
    ? {
        category,
        code,
        eligibleAt: job.cadenceFailure.eligibleAt,
        terminal: job.cadenceFailure.terminal,
      }
    : undefined;
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
    status: checkpoint.status,
    completedAt: checkpoint.completedAt,
    activatedAt: checkpoint.activatedAt,
    updatedAt: checkpoint.updatedAt,
    workerExecution: checkpoint.workerExecution,
    requiredVerifiedYield: checkpoint.requiredVerifiedYield,
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
  const checkpointTerminalStateMatchesJob = Boolean(
    checkpoint &&
      (
        args.job.status === "done"
          ? checkpoint.status === "inline_completed" &&
            Number.isFinite(checkpoint.completedAt) &&
            persistedTopicCount.persistedTopicCountState === "recorded" &&
            persistedTopicCount.persistedTopicCount ===
              (checkpoint.inlineCompletedTopicIds?.length ?? 0)
          : checkpoint.status === "activated"
            ? Number.isFinite(checkpoint.activatedAt)
            : checkpoint.status === "empty"
              ? Number.isFinite(checkpoint.completedAt)
              : checkpoint.status === "terminal_blocked" &&
                (
                  Number.isFinite(checkpoint.completedAt) ||
                  Number.isFinite(checkpoint.activatedAt)
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
      checkpoint.candidateTopicIds.length ===
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
      operatorCheckpointStatusAllowed(checkpoint.status) &&
      checkpointTerminalStateMatchesJob
  );
  const reservationUnreleased = args.reservation?.releasedAt === undefined &&
    args.reservation?.releaseReason === undefined &&
    args.job.providerReservationReleasedAt === undefined &&
    args.job.providerReservationReleaseReason === undefined;
  const reservationReleased = Boolean(
    Number.isFinite(args.reservation?.releasedAt) &&
      (args.reservation?.releasedAt ?? -Infinity) >=
        (args.reservation?.createdAt ?? Infinity) &&
      args.reservation?.releasedAt ===
        args.job.providerReservationReleasedAt &&
      typeof args.reservation?.releaseReason === "string" &&
      args.reservation.releaseReason ===
        args.job.providerReservationReleaseReason &&
      PLAN_RELEASE_REASONS.has(args.reservation.releaseReason),
  );
  const releasePairMatches = reservationUnreleased || reservationReleased;
  const exactReservation = Boolean(
    args.reservation &&
      args.siteUserId &&
      args.reservation._id === args.job.providerSpendReservationId &&
      args.reservation.siteId === args.siteId &&
      args.reservation.userId === args.siteUserId &&
      args.reservation.purpose === "topic_plan" &&
      args.reservation.trigger === args.expectedReservationTrigger &&
      args.reservation.createdAt === args.job.createdAt &&
      args.reservation.reservationDay ===
        args.job.providerCostReservationDay &&
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
    status: safeOperatorCode(run.status),
    outcome: safeOperatorCode(run.outcome),
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
    status: safeOperatorCode(health.status),
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
    portfolioStatus: safeOperatorCode(health.portfolioStatus),
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
    status: safeOperatorCode(article.status),
    editorialQualityScore: article.editorialQualityScore,
    factCheckScore: article.factCheckScore,
    mediaQualityStatus: safeOperatorCode(article.mediaQualityStatus),
    publicationGateStatus: safeOperatorCode(article.publicationGateStatus),
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
    type: safeOperatorCode(job.type),
    status: safeOperatorCode(job.status),
    retries: job.retries,
    workerAttempts: job.workerAttempts,
    publicationAttempts: job.publicationAttempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
