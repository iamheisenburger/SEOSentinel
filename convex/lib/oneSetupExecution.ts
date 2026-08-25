import {
  nextUtcDayAt,
  nextUtcMonthAt,
} from "./cadenceLiveness.ts";

export type OneSetupExecutionStatus =
  | "pending"
  | "running"
  | "plan_queued"
  | "completed"
  | "blocked";

export type OneSetupExecutionTerminalPatch = {
  status: "completed" | "blocked";
  blockerCode: string | undefined;
  claimNonce: undefined;
  leaseExpiresAt: undefined;
  claimWatchGeneration: undefined;
  claimWatchAttempt: undefined;
  claimWatchNextAt: undefined;
  pendingResumeGeneration: undefined;
  pendingResumeAttempt: undefined;
  pendingResumeNextAt: undefined;
  bootstrapAuthorizationWatchAttempt: undefined;
  bootstrapAuthorizationNextAt: undefined;
  planSettlementWatchGeneration: undefined;
  planSettlementWatchAttempt: undefined;
  planSettlementNextAt: undefined;
  completedAt: number;
  updatedAt: number;
};

/** One canonical terminal projection prevents any exhausted state from
 * retaining a stale lease or presenting a future wake that no longer exists. */
export function oneSetupExecutionTerminalPatch(args: {
  status: "completed" | "blocked";
  blockerCode?: string;
  timestamp: number;
}): OneSetupExecutionTerminalPatch {
  if (!Number.isSafeInteger(args.timestamp) || args.timestamp < 0) {
    throw new Error("Invalid one-setup terminal timestamp");
  }
  if (args.status === "blocked" && !args.blockerCode?.trim()) {
    throw new Error("A blocked one-setup execution requires an exact blocker");
  }
  return {
    status: args.status,
    blockerCode: args.status === "blocked" ? args.blockerCode : undefined,
    claimNonce: undefined,
    leaseExpiresAt: undefined,
    claimWatchGeneration: undefined,
    claimWatchAttempt: undefined,
    claimWatchNextAt: undefined,
    pendingResumeGeneration: undefined,
    pendingResumeAttempt: undefined,
    pendingResumeNextAt: undefined,
    bootstrapAuthorizationWatchAttempt: undefined,
    bootstrapAuthorizationNextAt: undefined,
    planSettlementWatchGeneration: undefined,
    planSettlementWatchAttempt: undefined,
    planSettlementNextAt: undefined,
    completedAt: args.timestamp,
    updatedAt: args.timestamp,
  };
}

export function oneSetupExecutionNextEligibleAt(args: {
  planSettlementNextAt?: number;
  bootstrapAuthorizationNextAt?: number;
  pendingResumeNextAt?: number;
  claimWatchNextAt?: number;
}): number | undefined {
  const candidates = [
    args.planSettlementNextAt,
    args.bootstrapAuthorizationNextAt,
    args.pendingResumeNextAt,
    args.claimWatchNextAt,
  ].filter((value): value is number =>
    Number.isSafeInteger(value) && (value ?? -1) >= 0
  );
  return candidates.length > 0 ? Math.min(...candidates) : undefined;
}

/** Every scheduled watcher is scoped to one immutable execution/config pair.
 * Counter equality alone is insufficient because a same-context resave may
 * create a new execution whose counters begin at the same values. */
export function oneSetupExecutionWatchIdentityMatches(args: {
  expectedExecutionId: string;
  expectedConfigurationRevision: number;
  actualExecutionId: string;
  actualConfigurationRevision: number;
  currentConfigurationRevision: number;
}): boolean {
  return Boolean(args.expectedExecutionId) &&
    args.expectedExecutionId === args.actualExecutionId &&
    Number.isSafeInteger(args.expectedConfigurationRevision) &&
    args.expectedConfigurationRevision > 0 &&
    args.actualConfigurationRevision ===
      args.expectedConfigurationRevision &&
    args.currentConfigurationRevision ===
      args.expectedConfigurationRevision;
}

/** Watch generations are epochs, not transient state. Nonterminal paths may
 * clear attempts/deadlines but must retain the last generation so a later
 * handoff cannot reuse an old scheduled wake's identity. */
export function nextOneSetupWatchGeneration(
  previousGeneration?: number,
): number {
  if (
    previousGeneration !== undefined &&
    (
      !Number.isSafeInteger(previousGeneration) ||
      previousGeneration < 0
    )
  ) throw new Error("Invalid one-setup watch generation");
  const nextGeneration = (previousGeneration ?? 0) + 1;
  if (!Number.isSafeInteger(nextGeneration)) {
    throw new Error("One-setup watch generation exhausted");
  }
  return nextGeneration;
}

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

export type OneSetupQueueDenialDisposition =
  | { kind: "retry"; eligibleAt: number }
  | { kind: "blocked"; blockerCode: string };

const ONE_SETUP_QUEUE_RECHECK_MS = 30 * 1000;
const ONE_SETUP_AUTHORIZATION_RECHECK_MS = 30 * 60 * 1000;
const ONE_SETUP_PREFLIGHT_RECHECK_MS = 15 * 60 * 1000;

function safeRetryAt(now: number, delayMs: number): number {
  const candidate = now + delayMs;
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(delayMs) ||
    delayMs <= 0 ||
    !Number.isSafeInteger(candidate)
  ) throw new Error("Invalid one-setup queue retry deadline");
  return candidate;
}

/**
 * Translate an exact no-reservation queue receipt into one durable wake. Daily
 * and monthly budget windows jump directly to their UTC boundary instead of
 * burning the bounded 30-second retry allowance before capacity can change.
 */
export function oneSetupQueueDenialDisposition(args: {
  reason: string;
  now: number;
  retryAfterMs?: number;
}): OneSetupQueueDenialDisposition {
  if (args.reason === "owner_unbound") {
    return { kind: "blocked", blockerCode: args.reason };
  }
  if (
    args.reason === "provider_daily_budget_reserved" ||
    args.reason === "provider_account_daily_budget_reserved" ||
    args.reason === "provider_fleet_daily_budget_reserved"
  ) {
    const eligibleAt = nextUtcDayAt(args.now);
    if (eligibleAt === undefined) {
      throw new Error("Invalid one-setup daily budget deadline");
    }
    return { kind: "retry", eligibleAt };
  }
  if (
    args.reason === "article_quota_no_headroom" ||
    args.reason === "plan_headroom_exhausted" ||
    args.reason === "provider_account_monthly_budget_reserved" ||
    args.reason === "provider_fleet_monthly_budget_reserved"
  ) {
    const eligibleAt = nextUtcMonthAt(args.now);
    if (eligibleAt === undefined) {
      throw new Error("Invalid one-setup monthly budget deadline");
    }
    return { kind: "retry", eligibleAt };
  }
  if (args.reason === "provider_account_preflight_cooling_down") {
    return {
      kind: "retry",
      eligibleAt: safeRetryAt(
        args.now,
        Number.isSafeInteger(args.retryAfterMs) &&
            (args.retryAfterMs ?? 0) > 0
          ? args.retryAfterMs!
          : ONE_SETUP_PREFLIGHT_RECHECK_MS,
      ),
    };
  }
  if (
    args.reason === "setup_execution_not_authorized" ||
    args.reason === "plan_entitlement_missing" ||
    args.reason === "provider_account_entitlement_unavailable" ||
    args.reason === "site_parked" ||
    args.reason === "site_limit_reached"
  ) {
    return {
      kind: "retry",
      eligibleAt: safeRetryAt(
        args.now,
        ONE_SETUP_AUTHORIZATION_RECHECK_MS,
      ),
    };
  }
  return {
    kind: "retry",
    eligibleAt: safeRetryAt(args.now, ONE_SETUP_QUEUE_RECHECK_MS),
  };
}

/**
 * Existing terminal work may be reconciled after plan parking or entitlement
 * downgrade because this authorizes no external work. Tenant deletion remains
 * a hard fence, as do owner/domain/contract drift. The plan fields are
 * deliberately accepted but ignored to make that distinction testable.
 */
export function oneSetupTerminalReceiptSettlementAllowed(args: {
  hasUser: boolean;
  deletionStatus?: string;
  accountDeletionRequestedAt?: number;
  accountDeletionReceiptExists: boolean;
  ownerMatches: boolean;
  domainMatches: boolean;
  contractMatches: boolean;
  planParkedAt?: number;
  entitlementCurrent?: boolean;
}): boolean {
  return args.hasUser &&
    !args.deletionStatus &&
    args.accountDeletionRequestedAt === undefined &&
    !args.accountDeletionReceiptExists &&
    args.ownerMatches &&
    args.domainMatches &&
    args.contractMatches;
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
