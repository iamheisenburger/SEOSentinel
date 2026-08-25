export type OneSetupExecutionStatus =
  | "pending"
  | "running"
  | "plan_queued"
  | "completed"
  | "blocked";

export type OneSetupExecutionClaimDisposition =
  | { kind: "terminal"; status: "completed" | "blocked" }
  | { kind: "in_progress" }
  | { kind: "claimable"; resumePlan: boolean };

export function oneSetupConfigurationRevisionIsCurrent(args: {
  expected: number;
  actual: number;
}): boolean {
  return Number.isSafeInteger(args.expected) &&
    args.expected > 0 &&
    args.expected === args.actual;
}

/**
 * Pure claim decision used by the durable mutation and interleaving tests.
 * An unexpired claimant owns the exact revision; an expired claimant may be
 * replaced, but a bound paid job is always resumed rather than recreated.
 */
export function oneSetupExecutionClaimDisposition(args: {
  status: OneSetupExecutionStatus;
  hasPlanJob: boolean;
  claimNonce?: string;
  leaseExpiresAt?: number;
  now: number;
}): OneSetupExecutionClaimDisposition {
  if (args.status === "completed" || args.status === "blocked") {
    return { kind: "terminal", status: args.status };
  }
  if (args.claimNonce && (args.leaseExpiresAt ?? 0) > args.now) {
    return { kind: "in_progress" };
  }
  return { kind: "claimable", resumePlan: args.hasPlanJob };
}

export type OneSetupPlanSettlement =
  | { state: "completed"; topicCount: number }
  | { state: "blocked"; blockerCode: string; topicCount?: number }
  | { state: "in_progress" };

/** Paid provider work is never replayed after a terminal job receipt. */
export function oneSetupPlanSettlement(args: {
  jobStatus: string;
  resultCount?: unknown;
}): OneSetupPlanSettlement {
  if (args.jobStatus === "done") {
    const topicCount = Number.isSafeInteger(args.resultCount) &&
        (args.resultCount as number) >= 0
      ? args.resultCount as number
      : 0;
    return topicCount > 0
      ? { state: "completed", topicCount }
      : { state: "blocked", blockerCode: "plan_zero_yield", topicCount };
  }
  if (args.jobStatus === "failed") {
    return { state: "blocked", blockerCode: "plan_failed_no_replay" };
  }
  return { state: "in_progress" };
}
