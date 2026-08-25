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
};

const JOB_RUN_OUTCOME_HEALTH = {
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
}): AutopilotRunHealthClassification {
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
        : args.approvedBufferCount < MIN_APPROVED_BUFFER
          ? "buffer_low"
          : "healthy",
      recognized: true,
    };
  }
  return {
    status: args.approvedBufferCount >= MIN_APPROVED_BUFFER
      ? "healthy"
      : args.approvedBufferCount === 0
        ? "buffer_empty"
        : "buffer_low",
    recognized: true,
  };
}
