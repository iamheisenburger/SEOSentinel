/**
 * Spend and runtime contract for evidence-first authority discovery.
 *
 * Pentra's public plan contract includes authority discovery on every tier.
 * Article/site capacity is the commercial differentiator: tiers above Free
 * receive the standard daily policy, while Free receives the same evidence-
 * first workflow on a smaller 30-day allowance. Both owner-triggered and
 * autonomous growth paths enter the same durable site/fleet reservation before
 * any provider is contacted.
 */

import { resolvePlanFromFeatures } from "../planLimits.ts";

export const AUTHORITY_DISCOVERY_EXPLICIT_FEATURES = [
  "seo_authority_discovery",
  "authority_discovery",
] as const;

export const AUTHORITY_DISCOVERY_RESERVATION_TTL_MS = 3 * 60 * 1000;
export const AUTHORITY_DISCOVERY_CANARY_COOLDOWN_MS =
  30 * 24 * 60 * 60 * 1000;
export const AUTHORITY_DISCOVERY_STANDARD_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type AuthorityDiscoveryTrigger = "owner" | "growth";
export type AuthorityDiscoveryMode = "entitled" | "manual_canary";

export type AuthorityDiscoveryPolicy = {
  version: number;
  mode: AuthorityDiscoveryMode;
  providerCostCeilingMicroUsd: number;
  providerCallLimit: number;
  openAiCallLimit: number;
  competitorLimit: number;
  candidateLimit: number;
  pageFetchLimit: number;
  providerTimeoutMs: number;
  openAiTimeoutMs: number;
  pageFetchTimeoutMs: number;
  totalDeadlineMs: number;
  cooldownMs: number;
};

export const AUTHORITY_DISCOVERY_ENTITLED_POLICY: AuthorityDiscoveryPolicy = {
  version: 1,
  mode: "entitled",
  // Five Backlinks Live requests plus one bounded web-search model call fit
  // inside this conservative envelope. The reservation is a ceiling, not a
  // claim that each successful scan spends this amount.
  providerCostCeilingMicroUsd: 250_000,
  providerCallLimit: 5,
  openAiCallLimit: 1,
  competitorLimit: 2,
  candidateLimit: 10,
  pageFetchLimit: 10,
  providerTimeoutMs: 8_000,
  openAiTimeoutMs: 15_000,
  pageFetchTimeoutMs: 5_000,
  totalDeadlineMs: 90_000,
  cooldownMs: AUTHORITY_DISCOVERY_STANDARD_COOLDOWN_MS,
};

export const AUTHORITY_DISCOVERY_CANARY_POLICY: AuthorityDiscoveryPolicy = {
  version: 1,
  mode: "manual_canary",
  providerCostCeilingMicroUsd: 200_000,
  providerCallLimit: 4,
  openAiCallLimit: 1,
  competitorLimit: 1,
  candidateLimit: 4,
  pageFetchLimit: 4,
  providerTimeoutMs: 8_000,
  openAiTimeoutMs: 15_000,
  pageFetchTimeoutMs: 5_000,
  totalDeadlineMs: 75_000,
  cooldownMs: AUTHORITY_DISCOVERY_CANARY_COOLDOWN_MS,
};

export function hasAuthorityDiscoveryEntitlement(
  planFeatures: string[],
): boolean {
  // Every public plan includes the feature. The boolean aliases remain valid
  // availability metadata, but cannot elevate a Free or malformed volume
  // bundle into a paid capacity policy. Only the canonical purchased tier
  // controls how often the shared provider wallet may be used.
  return resolvePlanFromFeatures(planFeatures).tier !== "free";
}

export function authorityDiscoveryPolicyFor(args: {
  trigger: AuthorityDiscoveryTrigger;
  planFeatures: string[];
}): AuthorityDiscoveryPolicy | null {
  if (hasAuthorityDiscoveryEntitlement(args.planFeatures)) {
    return AUTHORITY_DISCOVERY_ENTITLED_POLICY;
  }
  // Free still includes backlink intelligence and approval-first outreach.
  // Its smaller allowance is a capacity boundary, not a hidden feature denial.
  return AUTHORITY_DISCOVERY_CANARY_POLICY;
}

export type AuthorityDiscoveryCapacityDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "scan_already_active"
        | "site_cooldown";
    };

export function evaluateAuthorityDiscoveryCapacity(args: {
  hasActiveReservation: boolean;
  latestSiteAttemptAt?: number;
  now: number;
  cooldownMs: number;
}): AuthorityDiscoveryCapacityDecision {
  if (args.hasActiveReservation) {
    return { allowed: false, reason: "scan_already_active" };
  }
  if (
    args.latestSiteAttemptAt !== undefined &&
    args.latestSiteAttemptAt > args.now - args.cooldownMs
  ) {
    return { allowed: false, reason: "site_cooldown" };
  }
  return { allowed: true };
}

export type AuthorityDiscoveryRuntime = {
  policy: AuthorityDiscoveryPolicy;
  startedAt: number;
  deadlineAt: number;
  providerCallsAttempted: number;
  openAiCallsAttempted: number;
  candidatesConsidered: number;
  pageFetchesAttempted: number;
  deadlineExhausted: boolean;
};

export class AuthorityDiscoveryBudgetError extends Error {
  readonly code: "deadline_exhausted" | "provider_limit" | "openai_limit" |
    "candidate_limit" | "page_fetch_limit";

  constructor(code: AuthorityDiscoveryBudgetError["code"]) {
    super(`Authority discovery stopped at its ${code.replaceAll("_", " ")}`);
    this.name = "AuthorityDiscoveryBudgetError";
    this.code = code;
  }
}

export function createAuthorityDiscoveryRuntime(
  policy: AuthorityDiscoveryPolicy,
  startedAt = Date.now(),
): AuthorityDiscoveryRuntime {
  return {
    policy,
    startedAt,
    deadlineAt: startedAt + policy.totalDeadlineMs,
    providerCallsAttempted: 0,
    openAiCallsAttempted: 0,
    candidatesConsidered: 0,
    pageFetchesAttempted: 0,
    deadlineExhausted: false,
  };
}

export function remainingAuthorityDiscoveryMs(
  runtime: AuthorityDiscoveryRuntime,
  requestedTimeoutMs: number,
  now = Date.now(),
): number {
  const remaining = runtime.deadlineAt - now;
  if (remaining <= 0) {
    runtime.deadlineExhausted = true;
    throw new AuthorityDiscoveryBudgetError("deadline_exhausted");
  }
  return Math.max(1, Math.min(requestedTimeoutMs, remaining));
}

export function consumeAuthorityProviderCall(
  runtime: AuthorityDiscoveryRuntime,
): number {
  remainingAuthorityDiscoveryMs(runtime, runtime.policy.providerTimeoutMs);
  if (runtime.providerCallsAttempted >= runtime.policy.providerCallLimit) {
    throw new AuthorityDiscoveryBudgetError("provider_limit");
  }
  runtime.providerCallsAttempted += 1;
  return remainingAuthorityDiscoveryMs(runtime, runtime.policy.providerTimeoutMs);
}

export function consumeAuthorityOpenAiCall(
  runtime: AuthorityDiscoveryRuntime,
): number {
  remainingAuthorityDiscoveryMs(runtime, runtime.policy.openAiTimeoutMs);
  if (runtime.openAiCallsAttempted >= runtime.policy.openAiCallLimit) {
    throw new AuthorityDiscoveryBudgetError("openai_limit");
  }
  runtime.openAiCallsAttempted += 1;
  return remainingAuthorityDiscoveryMs(runtime, runtime.policy.openAiTimeoutMs);
}

export function consumeAuthorityCandidate(
  runtime: AuthorityDiscoveryRuntime,
): void {
  remainingAuthorityDiscoveryMs(runtime, runtime.policy.pageFetchTimeoutMs);
  if (runtime.candidatesConsidered >= runtime.policy.candidateLimit) {
    throw new AuthorityDiscoveryBudgetError("candidate_limit");
  }
  runtime.candidatesConsidered += 1;
}

export function consumeAuthorityPageFetch(
  runtime: AuthorityDiscoveryRuntime,
): number {
  remainingAuthorityDiscoveryMs(runtime, runtime.policy.pageFetchTimeoutMs);
  if (runtime.pageFetchesAttempted >= runtime.policy.pageFetchLimit) {
    throw new AuthorityDiscoveryBudgetError("page_fetch_limit");
  }
  runtime.pageFetchesAttempted += 1;
  return remainingAuthorityDiscoveryMs(runtime, runtime.policy.pageFetchTimeoutMs);
}

export function isAuthorityDiscoveryBudgetError(
  error: unknown,
): error is AuthorityDiscoveryBudgetError {
  return error instanceof AuthorityDiscoveryBudgetError;
}
