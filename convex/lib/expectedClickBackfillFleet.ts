export type ExpectedClickFleetJob = {
  _id: string;
  origin?: string;
  status: string;
  createdAt: number;
};

const UNRESOLVED_STATUSES = new Set([
  "pending",
  "running",
  "partial",
  "provider_response_unverified",
]);

/**
 * Recovery always chooses the oldest unresolved autonomous receipt. Newer
 * terminal/operator rows can never mask it.
 */
export function oldestUnresolvedFleetJob<T extends ExpectedClickFleetJob>(
  jobs: T[],
): T | undefined {
  return jobs
    .filter((job) =>
      job.origin === "autonomous_fleet" && UNRESOLVED_STATUSES.has(job.status)
    )
    .sort((left, right) =>
      left.createdAt - right.createdAt ||
      String(left._id).localeCompare(String(right._id))
    )[0];
}

export type DemandPhaseReservationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "evidence_phase_already_started"
        | "unresolved_job_read_limit_exhausted"
        | "prior_fleet_job_incomplete";
    };

export function planDemandPhaseReservation(args: {
  todayEvidenceJobs: number;
  unresolvedDemandJobs: number;
  unresolvedEvidenceJobs: number;
  unresolvedReadLimitExhausted: boolean;
}): DemandPhaseReservationDecision {
  if (args.todayEvidenceJobs > 0) {
    return { allowed: false, reason: "evidence_phase_already_started" };
  }
  if (args.unresolvedReadLimitExhausted) {
    return { allowed: false, reason: "unresolved_job_read_limit_exhausted" };
  }
  if (args.unresolvedDemandJobs > 0 || args.unresolvedEvidenceJobs > 0) {
    return { allowed: false, reason: "prior_fleet_job_incomplete" };
  }
  return { allowed: true };
}

export type EvidenceDemandPrerequisite = {
  id: string;
  status: string;
  origin?: string;
};

export type EvidencePhaseReservationDecision =
  | {
      allowed: true;
      prerequisiteMode:
        | "completed_fleet_demand"
        | "completed_operator_demand"
        | "no_remaining_demand_candidates";
      prerequisiteJobId?: string;
    }
  | {
      allowed: false;
      reason:
        | "unresolved_job_read_limit_exhausted"
        | "prior_fleet_job_incomplete"
        | "demand_phase_not_completed"
        | "demand_phase_origin_mismatch"
        | "demand_candidates_remaining";
    };

export function planEvidencePhaseReservation(args: {
  origin: "operator_canary" | "autonomous_fleet";
  todayDemandJob?: EvidenceDemandPrerequisite;
  pendingDemandCandidates: number;
  unresolvedDemandJobs: number;
  unresolvedEvidenceJobs: number;
  unresolvedReadLimitExhausted: boolean;
}): EvidencePhaseReservationDecision {
  if (args.unresolvedReadLimitExhausted) {
    return { allowed: false, reason: "unresolved_job_read_limit_exhausted" };
  }
  if (args.unresolvedDemandJobs > 0 || args.unresolvedEvidenceJobs > 0) {
    return { allowed: false, reason: "prior_fleet_job_incomplete" };
  }
  if (args.todayDemandJob && args.todayDemandJob.status !== "completed") {
    return { allowed: false, reason: "demand_phase_not_completed" };
  }
  if (
    args.origin === "autonomous_fleet" &&
    args.todayDemandJob &&
    args.todayDemandJob.origin !== "autonomous_fleet"
  ) {
    return { allowed: false, reason: "demand_phase_origin_mismatch" };
  }
  if (args.pendingDemandCandidates > 0) {
    return { allowed: false, reason: "demand_candidates_remaining" };
  }
  if (!args.todayDemandJob) {
    return {
      allowed: true,
      prerequisiteMode: "no_remaining_demand_candidates",
    };
  }
  return {
    allowed: true,
    prerequisiteMode: args.todayDemandJob.origin === "autonomous_fleet"
      ? "completed_fleet_demand"
      : "completed_operator_demand",
    prerequisiteJobId: args.todayDemandJob.id,
  };
}

export type ExpectedClickFleetRecoverySignal = {
  phase: "demand" | "evidence";
  action: "process" | "resume" | "blocked" | "none";
  reason?: string;
  actionable?: boolean;
  jobId?: string;
  policyVersion?: number;
  createdAt?: number;
};

export type ExpectedClickFleetRecoveryPlan =
  | {
      action: "recover";
      phase: "demand" | "evidence";
      mode: "process" | "resume";
      jobId: string;
      policyVersion: number;
    }
  | {
      action: "blocked" | "wait" | "none";
      phase?: "demand" | "evidence";
      reason: string;
      actionable: boolean;
    };

/**
 * Decide recovery across both phases before either worker is invoked. Any
 * ambiguous receipt wins globally, a live worker blocks the other phase, and
 * coexisting safe legacy jobs recover exactly one oldest receipt.
 */
export function planExpectedClickFleetRecovery(
  signals: ExpectedClickFleetRecoverySignal[],
): ExpectedClickFleetRecoveryPlan {
  const ambiguity = signals.find((signal) =>
    signal.action === "blocked" &&
    signal.reason === "provider_attempt_ambiguous"
  );
  if (ambiguity) {
    return {
      action: "blocked",
      phase: ambiguity.phase,
      reason: ambiguity.reason!,
      actionable: true,
    };
  }
  const blocked = signals.find((signal) => signal.action === "blocked");
  if (blocked) {
    return {
      action: "blocked",
      phase: blocked.phase,
      reason: blocked.reason ?? "recovery_blocked",
      actionable: blocked.actionable === true,
    };
  }
  const live = signals.find((signal) =>
    signal.action === "none" &&
    !["no_fleet_job", "terminal"].includes(signal.reason ?? "")
  );
  if (live) {
    return {
      action: "wait",
      phase: live.phase,
      reason: live.reason ?? "other_phase_active",
      actionable: false,
    };
  }
  const recoverable = signals
    .filter((signal): signal is ExpectedClickFleetRecoverySignal & {
      action: "process" | "resume";
      jobId: string;
      policyVersion: number;
      createdAt: number;
    } =>
      (signal.action === "process" || signal.action === "resume") &&
      typeof signal.jobId === "string" &&
      typeof signal.policyVersion === "number" &&
      Number.isFinite(signal.createdAt)
    )
    .sort((left, right) =>
      left.createdAt - right.createdAt ||
      (left.phase === right.phase ? 0 : left.phase === "demand" ? -1 : 1) ||
      left.jobId.localeCompare(right.jobId)
    );
  const selected = recoverable[0];
  if (selected) {
    return {
      action: "recover",
      phase: selected.phase,
      mode: selected.action,
      jobId: selected.jobId,
      policyVersion: selected.policyVersion,
    };
  }
  const malformed = signals.find((signal) =>
    signal.action === "process" || signal.action === "resume"
  );
  if (malformed) {
    return {
      action: "blocked",
      phase: malformed.phase,
      reason: "recovery_receipt_incomplete",
      actionable: true,
    };
  }
  return {
    action: "none",
    reason: "no_recovery_needed",
    actionable: false,
  };
}
