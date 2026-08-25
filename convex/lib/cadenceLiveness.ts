/**
 * Tenant-generic liveness policy for the autonomous content cadence.
 *
 * This module deliberately does not decide whether a keyword is safe. Product
 * fit, measured demand/difficulty, authority, SERP intent/attainability and
 * cannibalization remain hard gates in the planner. Liveness may only rotate
 * bounded discovery inputs, order candidates that already passed those gates,
 * and state when a blocked tenant is eligible to be reconsidered.
 */

export const CADENCE_LIVENESS_VERSION = 1;
export const CADENCE_PROVIDER_RECHECK_MS = 15 * 60 * 1000;
export const CADENCE_BALANCE_RECHECK_MS = 24 * 60 * 60 * 1000;

export type CadenceFailureCategory =
  | "semantic_zero_yield"
  | "transient_provider"
  | "provider_funding"
  | "budget_window"
  | "monthly_quota"
  | "readiness"
  | "entitlement"
  | "terminal_invariant";

export type CadenceFailureReceipt = {
  version: 1;
  category: CadenceFailureCategory;
  code: string;
  retryable: boolean;
  terminal: boolean;
  eligibleAt?: number;
  recordedAt: number;
};

function safeFuture(now: number, delta: number): number | undefined {
  const candidate = now + delta;
  return Number.isSafeInteger(candidate) ? candidate : undefined;
}

export function nextUtcDayAt(now: number): number | undefined {
  if (!Number.isSafeInteger(now) || now < 0) return undefined;
  const date = new Date(now);
  const next = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  ) + 1_000;
  return Number.isSafeInteger(next) ? next : undefined;
}

export function nextUtcMonthAt(now: number): number | undefined {
  if (!Number.isSafeInteger(now) || now < 0) return undefined;
  const date = new Date(now);
  const next = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    1,
  ) + 1_000;
  return Number.isSafeInteger(next) ? next : undefined;
}

/** Stable, non-secret classification persisted on the owning job. */
export function classifyCadenceFailure(args: {
  message: string;
  now: number;
  retryAt?: number;
  explicitCode?: string;
}): CadenceFailureReceipt {
  const normalized = args.message.trim().toLowerCase();
  const base = {
    version: CADENCE_LIVENESS_VERSION as 1,
    recordedAt: args.now,
  };
  if (
    /retained zero exact candidates|no measured, authority-attainable|no new scheduler-eligible topics|honest inventory miss|zero accepted topic|no topic survived live serp evidence/.test(
      normalized,
    )
  ) {
    return {
      ...base,
      category: "semantic_zero_yield",
      code: args.explicitCode ?? "strict_zero_yield",
      retryable: false,
      terminal: true,
    };
  }
  if (
    /insufficient balance|funding preflight blocked|provider_balance_insufficient/.test(
      normalized,
    )
  ) {
    return {
      ...base,
      category: "provider_funding",
      code: args.explicitCode ?? "provider_balance_insufficient",
      retryable: false,
      terminal: true,
      eligibleAt: safeFuture(args.now, CADENCE_BALANCE_RECHECK_MS),
    };
  }
  if (
    /preflight unavailable|provider_balance_preflight_unavailable/.test(
      normalized,
    )
  ) {
    return {
      ...base,
      category: "transient_provider",
      code: args.explicitCode ?? "provider_preflight_unavailable",
      retryable: true,
      terminal: false,
      eligibleAt:
        args.retryAt ?? safeFuture(args.now, CADENCE_PROVIDER_RECHECK_MS),
    };
  }
  if (/reservation expired|reservation day expired|reservation_day_expired/.test(normalized)) {
    return {
      ...base,
      category: "budget_window",
      code: args.explicitCode ?? "provider_reservation_day_expired",
      retryable: false,
      terminal: true,
      eligibleAt: nextUtcDayAt(args.now),
    };
  }
  if (/monthly generation quota|quota_reached/.test(normalized)) {
    return {
      ...base,
      category: "monthly_quota",
      code: args.explicitCode ?? "monthly_generation_quota",
      retryable: false,
      terminal: true,
      eligibleAt: nextUtcMonthAt(args.now),
    };
  }
  if (/readiness|observe mode|autopilot disabled|cadence paused/.test(normalized)) {
    return {
      ...base,
      category: "readiness",
      code: args.explicitCode ?? "tenant_readiness_blocked",
      retryable: false,
      terminal: true,
    };
  }
  if (/entitlement|plan allowance|current plan/.test(normalized)) {
    return {
      ...base,
      category: "entitlement",
      code: args.explicitCode ?? "tenant_entitlement_blocked",
      retryable: false,
      terminal: true,
    };
  }
  if (
    args.retryAt !== undefined ||
    /timeout|timed out|temporar|network|fetch failed|rate limit|\b429\b|\b5\d\d\b/.test(
      normalized,
    )
  ) {
    return {
      ...base,
      category: "transient_provider",
      code: args.explicitCode ?? "transient_provider_failure",
      retryable: true,
      terminal: false,
      eligibleAt:
        args.retryAt ?? safeFuture(args.now, CADENCE_PROVIDER_RECHECK_MS),
    };
  }
  return {
    ...base,
    category: "terminal_invariant",
    code: args.explicitCode ?? "terminal_planner_invariant",
    retryable: false,
    terminal: true,
  };
}

export type CadenceRecoveryStrategy = {
  version: 1;
  stage: 0 | 1 | 2;
  sourceMode: "gsc_profile" | "profile_gsc" | "problem_intent";
  intentMode: "exact" | "commercial" | "workflow";
  yieldMode: "buffer_first" | "verified_horizon";
  requiredVerifiedYield: number;
  evidenceReuse: true;
  priorFailureCodes: string[];
};

type PriorPlanReceipt = {
  status?: string;
  error?: string;
  result?: unknown;
  cadenceFailure?: { category?: string; code?: string };
  payload?: unknown;
};

function resultCount(result: unknown): number | undefined {
  if (!result || typeof result !== "object") return undefined;
  const value = (result as Record<string, unknown>).count;
  return Number.isInteger(value) ? value as number : undefined;
}

function semanticZero(row: PriorPlanReceipt): boolean {
  if (row.cadenceFailure?.category === "semantic_zero_yield") return true;
  if (resultCount(row.result) === 0) return true;
  return /retained zero exact candidates|no measured, authority-attainable|no new scheduler-eligible topics|honest inventory miss|no topic survived live serp evidence/.test(
    (row.error ?? "").toLowerCase(),
  );
}

function isAutomaticTopicPlanReceipt(row: PriorPlanReceipt): boolean {
  if (row.payload === undefined) return true;
  if (!row.payload || typeof row.payload !== "object") return false;
  const payload = row.payload as Record<string, unknown>;
  return payload.manual !== true &&
    typeof payload.reason === "string" &&
    payload.reason.startsWith("topic_") &&
    payload.growthParentArticleId === undefined;
}

/** Rows must be newest-first. A successful yield resets strategy escalation. */
export function deriveCadenceRecoveryStrategy(args: {
  recentPlans: readonly PriorPlanReceipt[];
  targetBufferShortfall: number;
  requiredVerifiedYield: number;
}): CadenceRecoveryStrategy {
  let consecutiveSemanticMisses = 0;
  const priorFailureCodes: string[] = [];
  for (const row of args.recentPlans.slice(0, 12)) {
    if (!isAutomaticTopicPlanReceipt(row)) continue;
    const count = resultCount(row.result);
    if (row.status === "done" && (count ?? 0) > 0) break;
    if (!semanticZero(row)) continue;
    consecutiveSemanticMisses += 1;
    const code = row.cadenceFailure?.code ?? "strict_zero_yield";
    if (!priorFailureCodes.includes(code)) priorFailureCodes.push(code);
    if (consecutiveSemanticMisses >= 2) break;
  }
  const stage = Math.min(2, consecutiveSemanticMisses) as 0 | 1 | 2;
  return {
    version: CADENCE_LIVENESS_VERSION,
    stage,
    sourceMode:
      stage === 0 ? "gsc_profile" : stage === 1 ? "profile_gsc" : "problem_intent",
    intentMode:
      stage === 0 ? "exact" : stage === 1 ? "commercial" : "workflow",
    yieldMode:
      args.targetBufferShortfall > 0 ? "buffer_first" : "verified_horizon",
    requiredVerifiedYield: Math.max(
      1,
      Math.min(10, Math.floor(args.requiredVerifiedYield || 1)),
    ),
    evidenceReuse: true,
    priorFailureCodes: priorFailureCodes.slice(0, 3),
  };
}

export function parseCadenceRecoveryStrategy(
  value: unknown,
): CadenceRecoveryStrategy | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<CadenceRecoveryStrategy>;
  if (
    item.version !== CADENCE_LIVENESS_VERSION ||
    ![0, 1, 2].includes(item.stage as number) ||
    !["gsc_profile", "profile_gsc", "problem_intent"].includes(
      item.sourceMode ?? "",
    ) ||
    !["exact", "commercial", "workflow"].includes(item.intentMode ?? "") ||
    !["buffer_first", "verified_horizon"].includes(item.yieldMode ?? "") ||
    !Number.isInteger(item.requiredVerifiedYield) ||
    (item.requiredVerifiedYield ?? 0) < 1 ||
    (item.requiredVerifiedYield ?? 0) > 10 ||
    item.evidenceReuse !== true ||
    !Array.isArray(item.priorFailureCodes)
  ) return undefined;
  return item as CadenceRecoveryStrategy;
}

function normalizeSeed(value: string): string | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  const words = normalized.split(" ").filter(Boolean);
  return normalized.length >= 4 && words.length <= 6 ? normalized : undefined;
}

function intentVariants(
  anchors: readonly string[],
  mode: CadenceRecoveryStrategy["intentMode"],
): string[] {
  if (mode === "exact") return [];
  const suffixes = mode === "commercial"
    ? ["software", "tool"]
    : ["workflow", "checklist"];
  const variants: string[] = [];
  for (const anchor of anchors.slice(0, 6)) {
    for (const suffix of suffixes) variants.push(`${anchor} ${suffix}`);
    if (mode === "workflow") variants.push(`how to ${anchor}`);
  }
  return variants;
}

/**
 * Bounded alternatives alter only discovery inputs. Every returned keyword
 * still traverses the unchanged measured semantic and authority gates.
 */
export function adaptiveDiscoverySeeds(args: {
  strategy: CadenceRecoveryStrategy;
  gscSeeds: readonly string[];
  profileSeeds: readonly string[];
  problemSeeds: readonly string[];
  rotatingSeeds: readonly string[];
  growthSeed?: string;
  limit?: number;
}): string[] {
  const limit = Math.max(1, Math.min(args.limit ?? 20, 20));
  const profile = args.profileSeeds.flatMap((seed) => normalizeSeed(seed) ?? []);
  const gsc = args.gscSeeds.flatMap((seed) => normalizeSeed(seed) ?? []);
  const problems = args.problemSeeds.flatMap((seed) => normalizeSeed(seed) ?? []);
  const variants = intentVariants(
    args.strategy.intentMode === "workflow" ? problems : profile,
    args.strategy.intentMode,
  );
  const ordered = args.strategy.sourceMode === "gsc_profile"
    ? [gsc, profile, args.rotatingSeeds, variants]
    : args.strategy.sourceMode === "profile_gsc"
      ? [profile, variants, gsc, args.rotatingSeeds]
      : [problems, variants, profile, gsc, args.rotatingSeeds];
  const values = [
    ...(args.growthSeed ? [args.growthSeed] : []),
    ...ordered.flat(),
  ];
  const result: string[] = [];
  for (const value of values) {
    const seed = normalizeSeed(value);
    if (seed && !result.includes(seed)) result.push(seed);
    if (result.length >= limit) break;
  }
  return result;
}

type DemandSignal = {
  query: string;
  clicks: number;
  impressions: number;
  position?: number;
};

type OutcomeSignal = {
  keyword: string;
  qualifiedActions: number;
  organicLandingSessions: number;
  signups: number;
  activations: number;
  paidConversions: number;
};

const PRIORITY_STOP_WORDS = new Set([
  "the", "and", "for", "with", "how", "what", "best", "guide", "tool",
  "software", "workflow", "checklist", "platform", "using",
]);

function keywordTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !PRIORITY_STOP_WORDS.has(token)));
}

function keywordSimilarity(left: string, right: string): number {
  const a = keywordTokens(left);
  const b = keywordTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const overlap = [...a].filter((token) => b.has(token)).length;
  return overlap / Math.max(a.size, b.size);
}

/** Feedback is a bounded tie-breaker after strict eligibility, never a gate. */
export function adaptiveOpportunityScore(args: {
  keyword: string;
  baseOpportunity: number;
  demandSignals: readonly DemandSignal[];
  outcomeSignals: readonly OutcomeSignal[];
}): { score: number; feedbackBonus: number } {
  let demandBonus = 0;
  for (const signal of args.demandSignals.slice(0, 30)) {
    const similarity = keywordSimilarity(args.keyword, signal.query);
    if (similarity < 0.5) continue;
    const ctr = signal.impressions > 0
      ? Math.max(0, signal.clicks) / signal.impressions
      : 0;
    const rankOpportunity = signal.position !== undefined &&
        signal.position >= 4 && signal.position <= 20
      ? 2
      : 0;
    demandBonus = Math.max(
      demandBonus,
      similarity * Math.min(
        12,
        Math.log2(Math.max(1, signal.impressions) + 1) +
          Math.min(4, Math.max(0, signal.clicks)) +
          Math.min(2, ctr * 20) + rankOpportunity,
      ),
    );
  }
  let outcomeBonus = 0;
  for (const signal of args.outcomeSignals.slice(0, 50)) {
    const similarity = keywordSimilarity(args.keyword, signal.keyword);
    if (similarity < 0.5) continue;
    const value = signal.paidConversions * 8 + signal.activations * 4 +
      signal.signups * 2 + signal.qualifiedActions +
      Math.log2(Math.max(1, signal.organicLandingSessions) + 1);
    outcomeBonus = Math.max(outcomeBonus, similarity * Math.min(18, value));
  }
  const feedbackBonus = Math.round(Math.min(24, demandBonus + outcomeBonus));
  return {
    score: Math.max(0, Math.round(args.baseOpportunity + feedbackBonus)),
    feedbackBonus,
  };
}

export type CadenceProgressionDecision =
  | "terminal_blocker"
  | "plan_topics"
  | "generate_buffer"
  | "publish_due"
  | "wait_for_cadence";

/** Small executable contract used by behavioral tests for the full journey. */
export function cadenceProgressionDecision(args: {
  terminalBlockers: readonly string[];
  schedulerReadyTopics: number;
  sealedBuffer: number;
  targetBuffer: number;
  publicationDue: boolean;
}): CadenceProgressionDecision {
  if (args.terminalBlockers.length > 0) return "terminal_blocker";
  if (args.publicationDue && args.sealedBuffer > 0) return "publish_due";
  if (args.sealedBuffer >= args.targetBuffer) return "wait_for_cadence";
  if (args.schedulerReadyTopics > 0) return "generate_buffer";
  return "plan_topics";
}
