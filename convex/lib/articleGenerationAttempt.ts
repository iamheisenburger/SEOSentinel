/**
 * A generated article can use several paid providers before its draft exists.
 * Successful articles are already bounded by the immutable article usage log,
 * but that log deliberately releases a pre-draft reservation after failure.
 * This separate allowance therefore bounds paid worker executions, including
 * failures, without changing the customer's purchased article quota.
 */
export const ARTICLE_PROVIDER_ACCOUNT_CONCURRENCY = 2;
export const ARTICLE_PROVIDER_FLEET_CONCURRENCY = 3;

/** Keep a paid-attempt reservation alive slightly longer than the worker's
 * thirty-minute lease. Heartbeats renew both leases together. */
export const ARTICLE_PROVIDER_ATTEMPT_LEASE_MS = 35 * 60 * 1000;

export type ArticleProviderAttemptStatus =
  | "reserved"
  | "funding_paused"
  | "completed"
  | "failed"
  | "ambiguous";

/**
 * Each plan can attempt every purchased article plus a bounded recovery
 * margin. The margin is 20%, with a minimum of two and a maximum of twenty.
 * Capacity by public plan is therefore:
 *   3 -> 5, 10 -> 12, 25 -> 30, 60 -> 72, 150 -> 170.
 */
export function articleGenerationAttemptAllowance(
  maxArticles: number,
): number {
  const articleAllowance = Math.max(0, Math.floor(maxArticles));
  const recoveryAllowance = Math.min(
    20,
    Math.max(2, Math.ceil(articleAllowance * 0.2)),
  );
  return articleAllowance + recoveryAllowance;
}

export function articleGenerationAttemptMonth(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The workerAttempts field is incremented only after an execution settles.
 * It is therefore a stable ordinal for one exact provider-bearing execution. */
export function articleGenerationAttemptKey(
  jobId: string,
  workerAttempt: number,
): string {
  return `${jobId}:${Math.max(0, Math.floor(workerAttempt))}`;
}

export type ArticleProviderAdmissionDecision =
  | { status: "reuse" }
  | { status: "reserve" }
  | {
      status: "reject";
      reason:
        | "attempt_already_settled"
        | "monthly_attempt_limit"
        | "account_concurrency"
        | "fleet_concurrency";
    };

export function decideArticleProviderAdmission(input: {
  existingStatus?: ArticleProviderAttemptStatus;
  existingOwnedByAccount?: boolean;
  attemptsUsed: number;
  attemptAllowance: number;
  activeAccountAttempts: number;
  activeFleetAttempts: number;
}): ArticleProviderAdmissionDecision {
  if (input.existingStatus !== undefined) {
    return ["reserved", "funding_paused"].includes(input.existingStatus) &&
        input.existingOwnedByAccount === true
      ? { status: "reuse" }
      : { status: "reject", reason: "attempt_already_settled" };
  }
  if (input.attemptsUsed >= input.attemptAllowance) {
    return { status: "reject", reason: "monthly_attempt_limit" };
  }
  if (input.activeAccountAttempts >= ARTICLE_PROVIDER_ACCOUNT_CONCURRENCY) {
    return { status: "reject", reason: "account_concurrency" };
  }
  if (input.activeFleetAttempts >= ARTICLE_PROVIDER_FLEET_CONCURRENCY) {
    return { status: "reject", reason: "fleet_concurrency" };
  }
  return { status: "reserve" };
}
