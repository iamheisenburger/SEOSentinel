/**
 * Bounded policy and deterministic selection for legacy expected-click proof.
 *
 * This job does not discover topics or generate content. It measures only
 * existing topic rows that still map to a published/current sealed artifact,
 * using demand already attached to the topic and page performance already
 * measured for that tenant in Search Console.
 */

import {
  DATAFORSEO_DEMAND_SOURCE,
  DEFAULT_EVIDENCE_MAX_AGE_MS,
  EXPECTED_CLICK_PORTFOLIO_VERSION,
} from "./expectedClickPortfolio.ts";

export const EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION = 2;
export const EXPECTED_CLICK_EVIDENCE_BACKFILL_TOPIC_LIMIT = 10;
export const EXPECTED_CLICK_EVIDENCE_BACKFILL_SERP_CALL_LIMIT = 10;
export const EXPECTED_CLICK_EVIDENCE_BACKFILL_AUTHORITY_CALL_LIMIT = 1;
export const EXPECTED_CLICK_EVIDENCE_BACKFILL_TOTAL_CALL_LIMIT = 11;
export const EXPECTED_CLICK_EVIDENCE_BACKFILL_TOTAL_DEADLINE_MS = 90_000;
export const EXPECTED_CLICK_EVIDENCE_BACKFILL_CALL_TIMEOUT_MS = 20_000;
export const EXPECTED_CLICK_EVIDENCE_BACKFILL_LEASE_MS = 90 * 1000;
export const EXPECTED_CLICK_EVIDENCE_INVENTORY_READ_LIMIT = 2_000;
export const EXPECTED_CLICK_EVIDENCE_GSC_READ_LIMIT = 5_000;

// A regular live organic SERP currently costs materially less than this
// reservation allowance. Keeping a conservative $0.005 task envelope plus
// the existing bounded authority estimate makes price drift fail closed while
// remaining tiny beside the shared $2.95/day and $35/month fleet breakers.
export const EXPECTED_CLICK_EVIDENCE_SERP_RESERVATION_MICRO_USD = 5_000;
export const EXPECTED_CLICK_EVIDENCE_AUTHORITY_RESERVATION_MICRO_USD = 30_000;
export const EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD =
  100_000;

export type ExpectedClickBackfillCandidate = {
  topicId: string;
  articleId?: string;
  keyword: string;
  searchVolume: number;
  priority?: number;
  gscClicks: number;
  gscImpressions: number;
  gscPosition?: number;
  createdAt: number;
};

export type ExpectedClickBackfillDemandEvidence = {
  searchVolume?: number;
  searchDemandSource?: string;
  searchDemandMeasuredAt?: number;
  searchDemandLocationCode?: number;
  searchDemandLanguageCode?: string;
};

export type ExpectedClickBackfillAuditEvidence = {
  expectedClickStatus?: string;
  expectedClickAuditVersion?: number;
  expectedClickAuditedAt?: number;
  expectedClickBackfillVersion?: number;
};

export function utcBackfillDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function hasCurrentExpectedClickDemand(args: {
  evidence: ExpectedClickBackfillDemandEvidence;
  locationCode: number;
  languageCode: string;
  now: number;
  maxAgeMs?: number;
}): boolean {
  const evidence = args.evidence;
  const measuredAt = evidence.searchDemandMeasuredAt;
  const maxAgeMs = args.maxAgeMs ?? DEFAULT_EVIDENCE_MAX_AGE_MS;
  const languageCode = args.languageCode.trim().toLowerCase();
  const evidenceLanguage = evidence.searchDemandLanguageCode
    ?.trim()
    .toLowerCase();
  return Boolean(
    Number.isFinite(evidence.searchVolume) &&
      (evidence.searchVolume ?? -1) >= 0 &&
      evidence.searchDemandSource === DATAFORSEO_DEMAND_SOURCE &&
      Number.isFinite(measuredAt) &&
      (measuredAt ?? 0) > 0 &&
      (measuredAt ?? Infinity) <= args.now + 5 * 60 * 1000 &&
      args.now - (measuredAt ?? 0) <= maxAgeMs &&
      evidence.searchDemandLocationCode === args.locationCode &&
      Boolean(languageCode) &&
      evidenceLanguage === languageCode,
  );
}

/**
 * A current complete planner audit does not need this compatibility path.
 * A completed versioned backfill is also terminal for the current version,
 * including a measured insufficient-evidence outcome: paying every day cannot
 * turn the same observed authority distribution into new proof.
 */
export function needsExpectedClickEvidenceBackfill(
  evidence: ExpectedClickBackfillAuditEvidence,
  now: number,
  maxAgeMs = DEFAULT_EVIDENCE_MAX_AGE_MS,
): boolean {
  const auditedAt = evidence.expectedClickAuditedAt;
  const fresh =
    Number.isFinite(auditedAt) &&
    (auditedAt ?? 0) > 0 &&
    (auditedAt ?? Infinity) <= now + 5 * 60 * 1000 &&
    now - (auditedAt ?? 0) <= maxAgeMs;
  if (
    evidence.expectedClickBackfillVersion ===
      EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION &&
    evidence.expectedClickAuditVersion === EXPECTED_CLICK_PORTFOLIO_VERSION &&
    fresh
  ) {
    return false;
  }
  return !(
    evidence.expectedClickStatus === "eligible" &&
    evidence.expectedClickAuditVersion === EXPECTED_CLICK_PORTFOLIO_VERSION &&
    fresh
  );
}

/**
 * Transparent opportunity score for a paid, bounded batch. Existing exact
 * monthly demand is the dominant signal. Search Console then lifts pages that
 * Google already exposes, particularly striking-distance pages where fresh
 * evidence is most actionable. This affects measurement order only; it never
 * changes ranking forecasts or invents demand.
 */
export function expectedClickBackfillSelectionScore(
  candidate: ExpectedClickBackfillCandidate,
): number {
  const searchVolume = Math.max(0, candidate.searchVolume);
  const clicks = Math.max(0, candidate.gscClicks);
  const impressions = Math.max(0, candidate.gscImpressions);
  const position = candidate.gscPosition;
  const strikingDistance =
    Number.isFinite(position) && (position ?? 0) >= 4 && (position ?? 0) <= 30
      ? 500
      : 0;
  const priority = Math.max(0, candidate.priority ?? 0);
  return (
    searchVolume + clicks * 1_000 + impressions * 4 + strikingDistance +
    priority * 10
  );
}

export function selectExpectedClickBackfillCandidates<
  Candidate extends ExpectedClickBackfillCandidate,
>(
  candidates: readonly Candidate[],
  limit = EXPECTED_CLICK_EVIDENCE_BACKFILL_TOPIC_LIMIT,
): Candidate[] {
  const boundedLimit = Math.max(
    1,
    Math.min(
      Math.floor(limit),
      EXPECTED_CLICK_EVIDENCE_BACKFILL_TOPIC_LIMIT,
    ),
  );
  return candidates
    .slice()
    .sort((left, right) => {
      const score = expectedClickBackfillSelectionScore(right) -
        expectedClickBackfillSelectionScore(left);
      if (score !== 0) return score;
      if (right.searchVolume !== left.searchVolume) {
        return right.searchVolume - left.searchVolume;
      }
      if (right.gscImpressions !== left.gscImpressions) {
        return right.gscImpressions - left.gscImpressions;
      }
      if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
      }
      return left.topicId.localeCompare(right.topicId);
    })
    .slice(0, boundedLimit);
}

export function expectedClickBackfillRemainingCostMicroUsd(args: {
  selectedTopics: number;
  serpSnapshots: number;
  authoritySnapshotComplete: boolean;
}): number {
  const selectedTopics = Math.max(
    0,
    Math.min(
      Math.floor(args.selectedTopics),
      EXPECTED_CLICK_EVIDENCE_BACKFILL_TOPIC_LIMIT,
    ),
  );
  const serpSnapshots = Math.max(
    0,
    Math.min(Math.floor(args.serpSnapshots), selectedTopics),
  );
  const remainingSerps = selectedTopics - serpSnapshots;
  const remaining =
    remainingSerps * EXPECTED_CLICK_EVIDENCE_SERP_RESERVATION_MICRO_USD +
    (args.authoritySnapshotComplete
      ? 0
      : EXPECTED_CLICK_EVIDENCE_AUTHORITY_RESERVATION_MICRO_USD);
  return Math.max(1, Math.min(
    remaining,
    EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  ));
}

export class ExpectedClickBackfillRuntimeError extends Error {
  readonly code:
    | "deadline_exhausted"
    | "serp_call_limit"
    | "authority_call_limit";

  constructor(
    code:
      | "deadline_exhausted"
      | "serp_call_limit"
      | "authority_call_limit",
  ) {
    super(`Expected-click evidence backfill stopped (${code})`);
    this.name = "ExpectedClickBackfillRuntimeError";
    this.code = code;
  }
}

export type ExpectedClickBackfillRuntime = {
  startedAt: number;
  deadlineAt: number;
  serpCalls: number;
  authorityCalls: number;
};

export function createExpectedClickBackfillRuntime(
  now = Date.now(),
): ExpectedClickBackfillRuntime {
  return {
    startedAt: now,
    deadlineAt: now + EXPECTED_CLICK_EVIDENCE_BACKFILL_TOTAL_DEADLINE_MS,
    serpCalls: 0,
    authorityCalls: 0,
  };
}

export function consumeExpectedClickBackfillSerpCall(
  runtime: ExpectedClickBackfillRuntime,
  now = Date.now(),
): void {
  if (now >= runtime.deadlineAt) {
    throw new ExpectedClickBackfillRuntimeError("deadline_exhausted");
  }
  if (
    runtime.serpCalls >= EXPECTED_CLICK_EVIDENCE_BACKFILL_SERP_CALL_LIMIT
  ) {
    throw new ExpectedClickBackfillRuntimeError("serp_call_limit");
  }
  runtime.serpCalls += 1;
}

export function consumeExpectedClickBackfillAuthorityCall(
  runtime: ExpectedClickBackfillRuntime,
  now = Date.now(),
): void {
  if (now >= runtime.deadlineAt) {
    throw new ExpectedClickBackfillRuntimeError("deadline_exhausted");
  }
  if (
    runtime.authorityCalls >=
      EXPECTED_CLICK_EVIDENCE_BACKFILL_AUTHORITY_CALL_LIMIT
  ) {
    throw new ExpectedClickBackfillRuntimeError("authority_call_limit");
  }
  runtime.authorityCalls += 1;
}
