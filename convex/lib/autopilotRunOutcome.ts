import { MIN_APPROVED_BUFFER } from "./autopilotBuffer.ts";
import type { Id } from "../_generated/dataModel";

export const SCHEDULER_RUN_OUTCOME_HEALTH = {
  autopilot_disabled: "blocked",
  cadence_paused: "blocked",
  rollout_observe: "blocked",
  readiness_regressed: "blocked",
  migration_pending: "blocked",
  public_url_failed: "blocked",
  rollout_buffer_ready: "blocked",
  quality_budget_exhausted: "buffer_protected",
  quota_reached: "blocked",
  site_limit_reached: "blocked",
  topic_replenishment_exhausted: "blocked",
  opportunity_space_exhausted: "blocked",
  planning_blocked: "blocked",
  topic_admission_blocked: "blocked",
  scheduler_state_conflict: "blocked",
  cadence_failure_cooldown: "blocked",
  public_url_pending: "waiting",
  automatic_live_promotion: "waiting",
  buffer_delivery: "waiting",
  buffer_delivery_pending: "waiting",
  pending_plan: "waiting",
  work_in_progress: "waiting",
  approval_waiting: "waiting",
  manual_delivery_waiting: "waiting",
  cadence_not_due: "waiting",
  quality_revision: "waiting",
  deterministic_repair: "waiting",
  topic_portfolio_goal_replenishment: "waiting",
  topic_portfolio_evidence_replenishment: "waiting",
  topic_replenishment: "waiting",
  cadence_micro_seed_continuation: "waiting",
  buffer_fill: "waiting",
  cadence_generation: "waiting",
  idle: "waiting",
  buffer_full: "healthy",
} as const;

export type SchedulerRunOutcome = keyof typeof SCHEDULER_RUN_OUTCOME_HEALTH;

export type CadenceScheduleResult = {
  scheduled: number;
  mode?: SchedulerRunOutcome;
  bufferCount?: number;
  blockers?: string[];
  eligibleAt?: number;
  // Exact automatic-plan receipt observed/created by the scheduler. Cooldown
  // runs use it only to bind a terminal observer; it is not queue authority.
  planJobId?: Id<"jobs">;
  // `work_in_progress` is truthful only when it is bound to an exact active
  // job. The pipeline enforces this field at runtime so a rejected queue
  // request can never masquerade as leased work.
  activeJobId?: Id<"jobs">;
};

export function schedulerWorkIsBound(
  result: Pick<CadenceScheduleResult, "mode" | "activeJobId">,
): boolean {
  return result.mode !== "work_in_progress" || result.activeJobId !== undefined;
}

export const JOB_RUN_OUTCOME_HEALTH = {
  claim_lost: "waiting",
  retry_scheduled: "waiting",
  plan_continuation_queued: "waiting",
  buffer_ready: "buffer_protected",
  quality_recovered: "buffer_protected",
  job_processed: "buffer_protected",
  publication_succeeded: "waiting",
  quality_quarantined: "blocked",
  publication_failed: "blocked",
  job_failed: "blocked",
  site_parked: "blocked",
} as const;

/**
 * Outcomes written outside the scheduler/job classifiers (for example by
 * onboarding, cooldown wake, or domain-epoch invalidation paths). Keeping the
 * complete operator projection beside the runtime classifier prevents a
 * legitimate stored receipt from being silently rewritten to `unclassified`
 * by a second, stale allowlist.
 */
const SYSTEM_RUN_OUTCOMES = [
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
] as const;

export const AUTOPILOT_OPERATOR_RUN_OUTCOMES: ReadonlySet<string> = new Set([
  ...Object.keys(SCHEDULER_RUN_OUTCOME_HEALTH),
  ...Object.keys(JOB_RUN_OUTCOME_HEALTH),
  ...SYSTEM_RUN_OUTCOMES,
]);

const SCHEDULER_BLOCKED_HEALTH_STATUSES = Object.entries(
  SCHEDULER_RUN_OUTCOME_HEALTH,
).filter(([, kind]) => kind === "blocked").map(([outcome]) => outcome);

/** Every health status that can be persisted or derived by runtime audits. */
export const AUTOPILOT_OPERATOR_HEALTH_STATUSES: ReadonlySet<string> = new Set([
  ...SCHEDULER_BLOCKED_HEALTH_STATUSES,
  "recovering",
  "readiness_blocked",
  "run_failed",
  "run_outcome_unclassified",
  "healthy",
  "buffer_empty",
  "buffer_low",
  "scheduler_stale",
  "missed",
  "quality_budget_exhausted",
  "job_lease_exhausted",
  "rollout_conflict",
  "rollout_buffer_ready",
  "topic_portfolio_below_goal",
  "topic_portfolio_evidence_missing",
  ...Object.entries(JOB_RUN_OUTCOME_HEALTH)
    .filter(([, kind]) => kind === "blocked")
    .map(([outcome]) => outcome),
]);

export type AutopilotRunHealthClassification = {
  status: string;
  detail?: string;
  recognized: boolean;
};

/**
 * Classify every scheduler mode explicitly. Unknown outcomes fail closed; a
 * newly added string can never inherit a green status by omission.
 */
export function classifyAutopilotRunOutcome(args: {
  outcome: string;
  approvedBufferCount: number;
  bufferMinimum?: number;
}): AutopilotRunHealthClassification {
  const bufferMinimum = Math.max(
    1,
    Math.floor(args.bufferMinimum ?? MIN_APPROVED_BUFFER),
  );
  const schedulerKind = Object.prototype.hasOwnProperty.call(
      SCHEDULER_RUN_OUTCOME_HEALTH,
      args.outcome,
    )
    ? SCHEDULER_RUN_OUTCOME_HEALTH[
        args.outcome as SchedulerRunOutcome
      ]
    : undefined;
  const jobKind = Object.prototype.hasOwnProperty.call(
      JOB_RUN_OUTCOME_HEALTH,
      args.outcome,
    )
    ? JOB_RUN_OUTCOME_HEALTH[
        args.outcome as keyof typeof JOB_RUN_OUTCOME_HEALTH
      ]
    : undefined;
  const kind = schedulerKind ?? jobKind;
  if (!kind) {
    return {
      status: "run_outcome_unclassified",
      detail: `Unclassified autopilot outcome: ${args.outcome}.`,
      recognized: false,
    };
  }
  if (kind === "waiting") {
    return { status: "recovering", recognized: true };
  }
  if (kind === "blocked") {
    return { status: args.outcome, recognized: true };
  }
  if (kind === "buffer_protected") {
    return {
      status: args.approvedBufferCount === 0
        ? "buffer_empty"
        : args.approvedBufferCount < bufferMinimum
          ? "buffer_low"
          : "healthy",
      recognized: true,
    };
  }
  return {
    status: args.approvedBufferCount >= bufferMinimum
      ? "healthy"
      : args.approvedBufferCount === 0
        ? "buffer_empty"
        : "buffer_low",
    recognized: true,
  };
}
