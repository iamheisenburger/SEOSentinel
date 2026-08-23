/**
 * One shared budget for a complete outreach-preparation action.
 *
 * Contact discovery and replacement-page verification both consume the same
 * public-fetch allowance. Keeping the limits in one object prevents a large
 * opportunity queue from multiplying per-opportunity timeouts into an
 * unbounded Convex action.
 */

export const OUTREACH_PREPARE_MAX_OPPORTUNITIES = 25;
export const OUTREACH_PREPARE_MAX_PUBLIC_FETCHES = 30;
export const OUTREACH_PREPARE_MAX_RUNTIME_MS = 90_000;

// Stop starting network work early enough to persist the last completed
// opportunity and return an honest partial result before the action deadline.
export const OUTREACH_PREPARE_SETTLEMENT_RESERVE_MS = 5_000;

export type OutreachPreparationStopReason =
  | "opportunity_limit_reached"
  | "public_fetch_budget_exhausted"
  | "runtime_budget_exhausted";

export type OutreachPreparationBudget = {
  startedAt: number;
  deadlineAt: number;
  opportunityLimit: number;
  publicFetchLimit: number;
  publicFetches: number;
  stopReason?: Exclude<
    OutreachPreparationStopReason,
    "opportunity_limit_reached"
  >;
};

export type OutreachPreparationBudgetSummary = {
  partial: boolean;
  stopReason?: OutreachPreparationStopReason;
  deferredAtLeast: number;
  opportunityLimit: number;
  publicFetchLimit: number;
  publicFetches: number;
  runtimeLimitMs: number;
  elapsedMs: number;
};

export function createOutreachPreparationBudget(args: {
  requestedLimit?: number;
  now?: number;
}): OutreachPreparationBudget {
  const startedAt = args.now ?? Date.now();
  const requested = Number.isFinite(args.requestedLimit)
    ? Math.floor(args.requestedLimit as number)
    : OUTREACH_PREPARE_MAX_OPPORTUNITIES;
  return {
    startedAt,
    deadlineAt: startedAt + OUTREACH_PREPARE_MAX_RUNTIME_MS,
    opportunityLimit: Math.max(
      1,
      Math.min(requested, OUTREACH_PREPARE_MAX_OPPORTUNITIES),
    ),
    publicFetchLimit: OUTREACH_PREPARE_MAX_PUBLIC_FETCHES,
    publicFetches: 0,
  };
}

/**
 * Reserve one HTTP fetch and return the maximum time that fetch may occupy.
 * Null means the caller must stop the whole preparation run, not misreport a
 * partially searched domain as having no published contact.
 */
export function reserveOutreachPreparationFetch(
  budget: OutreachPreparationBudget,
  preferredTimeoutMs: number,
  now = Date.now(),
): number | null {
  if (budget.stopReason) return null;
  const remainingWorkMs =
    budget.deadlineAt - now - OUTREACH_PREPARE_SETTLEMENT_RESERVE_MS;
  if (remainingWorkMs <= 0) {
    budget.stopReason = "runtime_budget_exhausted";
    return null;
  }
  if (budget.publicFetches >= budget.publicFetchLimit) {
    budget.stopReason = "public_fetch_budget_exhausted";
    return null;
  }
  budget.publicFetches += 1;
  return Math.max(1, Math.min(Math.floor(preferredTimeoutMs), remainingWorkMs));
}

export function haltOutreachPreparationWhenRuntimeSpent(
  budget: OutreachPreparationBudget,
  now = Date.now(),
): boolean {
  if (
    !budget.stopReason &&
    budget.deadlineAt - now <= OUTREACH_PREPARE_SETTLEMENT_RESERVE_MS
  ) {
    budget.stopReason = "runtime_budget_exhausted";
  }
  return Boolean(budget.stopReason);
}

export function summarizeOutreachPreparationBudget(args: {
  budget: OutreachPreparationBudget;
  considered: number;
  offered: number;
  hasMore: boolean;
  unsettledCurrent?: boolean;
  now?: number;
}): OutreachPreparationBudgetSummary {
  const now = args.now ?? Date.now();
  const stopReason =
    args.budget.stopReason ??
    (args.hasMore ? "opportunity_limit_reached" : undefined);
  const deferredAtLeast = Math.max(0, args.offered - args.considered) +
    (args.unsettledCurrent ? 1 : 0) +
    (args.hasMore ? 1 : 0);
  return {
    partial: Boolean(stopReason),
    stopReason,
    deferredAtLeast,
    opportunityLimit: args.budget.opportunityLimit,
    publicFetchLimit: args.budget.publicFetchLimit,
    publicFetches: args.budget.publicFetches,
    runtimeLimitMs: OUTREACH_PREPARE_MAX_RUNTIME_MS,
    elapsedMs: Math.max(0, now - args.budget.startedAt),
  };
}
