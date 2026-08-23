/**
 * Bounded policy for recovering exact DataForSEO demand provenance on legacy
 * topics that still reserve a published/current sealed article intent.
 *
 * This policy never discovers or rewrites a keyword. Existing stored volume
 * and known non-branded GSC performance are used only to decide which exact
 * covered keywords enter the next small provider batch.
 */

export const EXPECTED_CLICK_DEMAND_BACKFILL_VERSION = 1;
export const EXPECTED_CLICK_DEMAND_BACKFILL_TOPIC_LIMIT = 10;
export const EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CALL_LIMIT = 1;
export const EXPECTED_CLICK_DEMAND_BACKFILL_TOTAL_DEADLINE_MS = 45_000;
export const EXPECTED_CLICK_DEMAND_BACKFILL_LEASE_MS = 2 * 60 * 1000;
export const EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD =
  100_000;
export const EXPECTED_CLICK_DEMAND_PROVIDER_ENDPOINT =
  "keywords_data/google_ads/search_volume/live";
export const EXPECTED_CLICK_DEMAND_INVENTORY_READ_LIMIT = 2_000;
export const EXPECTED_CLICK_DEMAND_GSC_READ_LIMIT = 5_000;

export type ExpectedClickDemandCandidate = {
  topicId: string;
  keyword: string;
  legacySearchVolume: number;
  priority?: number;
  gscClicks: number;
  gscImpressions: number;
  gscPosition?: number;
  createdAt: number;
};

export function utcDemandBackfillDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function normalizeExactDemandKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

/**
 * This score orders measurement only. Legacy volume is explicitly untrusted
 * as evidence until the live receipt is persisted, but remains useful for
 * choosing which old rows to verify first. Known non-branded GSC exposure can
 * lift a page that Google is already testing.
 */
export function expectedClickDemandSelectionScore(
  candidate: ExpectedClickDemandCandidate,
): number {
  const legacyVolume = Math.max(0, candidate.legacySearchVolume);
  const clicks = Math.max(0, candidate.gscClicks);
  const impressions = Math.max(0, candidate.gscImpressions);
  const position = candidate.gscPosition;
  const strikingDistance =
    Number.isFinite(position) && (position ?? 0) >= 4 && (position ?? 0) <= 30
      ? 500
      : 0;
  return legacyVolume + clicks * 1_000 + impressions * 4 + strikingDistance +
    Math.max(0, candidate.priority ?? 0) * 10;
}

/** Select at most one topic for each exact normalized keyword. */
export function selectExpectedClickDemandCandidates<
  Candidate extends ExpectedClickDemandCandidate,
>(
  candidates: readonly Candidate[],
  limit = EXPECTED_CLICK_DEMAND_BACKFILL_TOPIC_LIMIT,
): Candidate[] {
  const boundedLimit = Math.max(
    1,
    Math.min(
      Math.floor(limit),
      EXPECTED_CLICK_DEMAND_BACKFILL_TOPIC_LIMIT,
    ),
  );
  const seenKeywords = new Set<string>();
  const selected: Candidate[] = [];
  for (const candidate of candidates.slice().sort((left, right) => {
    const score = expectedClickDemandSelectionScore(right) -
      expectedClickDemandSelectionScore(left);
    if (score !== 0) return score;
    if (right.legacySearchVolume !== left.legacySearchVolume) {
      return right.legacySearchVolume - left.legacySearchVolume;
    }
    if (right.gscImpressions !== left.gscImpressions) {
      return right.gscImpressions - left.gscImpressions;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.topicId.localeCompare(right.topicId);
  })) {
    const key = normalizeExactDemandKeyword(candidate.keyword);
    if (!key || seenKeywords.has(key)) continue;
    seenKeywords.add(key);
    selected.push(candidate);
    if (selected.length >= boundedLimit) break;
  }
  return selected;
}

export type ExactDemandMetric = {
  keyword: string;
  searchVolume: number;
  cpc?: number;
  competition?: number;
  trend: number[];
};

/**
 * Reconcile a provider response against the exact initiated keyword set.
 * Missing rows remain explicitly missing; zero is retained as a real metric.
 * Foreign, duplicate or malformed rows invalidate the whole receipt.
 */
export function reconcileExactDemandMetrics<TopicId extends string>(
  attempts: ReadonlyArray<{ topicId: TopicId; keyword: string }>,
  metrics: ReadonlyArray<ExactDemandMetric>,
): {
  measured: Array<{
    topicId: TopicId;
    requestedKeyword: string;
    metric: ExactDemandMetric;
  }>;
  missing: Array<{ topicId: TopicId; keyword: string }>;
} {
  if (metrics.length > attempts.length) {
    throw new Error("Provider returned incompatible exact keyword metrics");
  }
  const attemptedKeys = new Set<string>();
  for (const attempt of attempts) {
    const key = normalizeExactDemandKeyword(attempt.keyword);
    if (!key || attemptedKeys.has(key)) {
      throw new Error("Provider returned incompatible exact keyword metrics");
    }
    attemptedKeys.add(key);
  }
  const byKeyword = new Map<string, ExactDemandMetric>();
  for (const metric of metrics) {
    const key = normalizeExactDemandKeyword(metric.keyword);
    if (
      !key ||
      !attemptedKeys.has(key) ||
      byKeyword.has(key) ||
      !Number.isFinite(metric.searchVolume) ||
      metric.searchVolume < 0 ||
      (metric.cpc !== undefined &&
        (!Number.isFinite(metric.cpc) || metric.cpc < 0)) ||
      (metric.competition !== undefined &&
        (!Number.isFinite(metric.competition) ||
          metric.competition < 0 ||
          metric.competition > 1)) ||
      metric.trend.length > 12 ||
      metric.trend.some((value) => !Number.isFinite(value) || value < 0)
    ) {
      throw new Error("Provider returned incompatible exact keyword metrics");
    }
    byKeyword.set(key, metric);
  }
  const measured: Array<{
    topicId: TopicId;
    requestedKeyword: string;
    metric: ExactDemandMetric;
  }> = [];
  const missing: Array<{ topicId: TopicId; keyword: string }> = [];
  for (const attempt of attempts) {
    const metric = byKeyword.get(normalizeExactDemandKeyword(attempt.keyword));
    if (metric) {
      measured.push({
        topicId: attempt.topicId,
        requestedKeyword: attempt.keyword,
        metric,
      });
    } else {
      missing.push({ topicId: attempt.topicId, keyword: attempt.keyword });
    }
  }
  return { measured, missing };
}

export class ExpectedClickDemandRuntimeError extends Error {
  readonly code: "deadline_exhausted" | "provider_call_limit";

  constructor(code: "deadline_exhausted" | "provider_call_limit") {
    super(`Expected-click demand backfill stopped (${code})`);
    this.name = "ExpectedClickDemandRuntimeError";
    this.code = code;
  }
}

export type ExpectedClickDemandRuntime = {
  deadlineAt: number;
  providerCalls: number;
};

export function createExpectedClickDemandRuntime(
  now = Date.now(),
): ExpectedClickDemandRuntime {
  return {
    deadlineAt: now + EXPECTED_CLICK_DEMAND_BACKFILL_TOTAL_DEADLINE_MS,
    providerCalls: 0,
  };
}

export function consumeExpectedClickDemandProviderCall(
  runtime: ExpectedClickDemandRuntime,
  now = Date.now(),
): void {
  if (now >= runtime.deadlineAt) {
    throw new ExpectedClickDemandRuntimeError("deadline_exhausted");
  }
  if (
    runtime.providerCalls >= EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CALL_LIMIT
  ) {
    throw new ExpectedClickDemandRuntimeError("provider_call_limit");
  }
  runtime.providerCalls += 1;
}
