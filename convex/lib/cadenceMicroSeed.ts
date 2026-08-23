import {
  filterNonCannibalizingIntentTopics,
  keywordDifficultyCeiling,
  tenantDiscoveryAnchors,
  type SerpCoverageTopic,
} from "./autopilotBuffer.ts";

/**
 * A last-resort, one-call topic discovery lane for an imminent empty-buffer
 * cadence gap after the ordinary plan has exhausted its immutable executions.
 * It is intentionally much smaller than a topic plan and never reuses the
 * source plan's provider reservation.
 */
export const CADENCE_MICRO_SEED_VERSION = 1;
export const CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD = 100_000;
export const CADENCE_MICRO_SEED_FALLBACK_PROVIDER_CEILING_MICRO_USD = 50_000;
export const CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT =
  "dataforseo_labs/google/keyword_suggestions/live";
export const CADENCE_MICRO_SEED_RESULT_LIMIT = 100;
export const CADENCE_MICRO_SEED_TASK_COST_CEILING_USD = 0.024;
export const CADENCE_MICRO_SEED_LEASE_MS = 2 * 60 * 1000;
export const CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS = 5 * 60 * 1000;
export const CADENCE_MICRO_SEED_MAX_WATCHDOG_RECOVERIES = 12;
export const CADENCE_MICRO_SEED_MAX_JOB_AGE_MS = 2 * 60 * 60 * 1000;
export const CADENCE_MICRO_SEED_FINALIZE_DELAY_MS = 2 * 60 * 1000;
export const CADENCE_MICRO_SEED_MAX_FINALIZE_ATTEMPTS = 3;
export const CADENCE_MICRO_SEED_MAX_SCHEDULE_ATTEMPTS = 3;
export const CADENCE_MICRO_SEED_MAX_CADENCE_HORIZON_MS =
  24 * 60 * 60 * 1000;
export const CADENCE_MICRO_SEED_READ_LIMIT = 2_000;

export type CadenceMicroSeedAttemptKind = "primary" | "fallback";

/** Missing legacy values are primary; unknown future values fail closed. */
export function cadenceMicroSeedAttemptKind(
  value?: string,
): CadenceMicroSeedAttemptKind | null {
  if (value === undefined || value === "primary") return "primary";
  if (value === "fallback") return "fallback";
  return null;
}

export function cadenceMicroSeedProviderCeilingMicroUsd(
  kind: CadenceMicroSeedAttemptKind,
): number {
  return kind === "fallback"
    ? CADENCE_MICRO_SEED_FALLBACK_PROVIDER_CEILING_MICRO_USD
    : CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD;
}

export function cadenceMicroSeedProviderPurpose(
  kind: CadenceMicroSeedAttemptKind,
): "cadence_micro_seed" | "cadence_micro_seed_fallback" {
  return kind === "fallback"
    ? "cadence_micro_seed_fallback"
    : "cadence_micro_seed";
}

export function cadenceMicroSeedProviderTrigger(
  kind: CadenceMicroSeedAttemptKind,
): string {
  return `${cadenceMicroSeedProviderPurpose(kind)}_v${CADENCE_MICRO_SEED_VERSION}`;
}

/**
 * The underfill bridge stores `workerAttempts: 1` before execution two is
 * scheduled. A deterministic terminal failure preserves 1; a retryable
 * execution-two failure settles at 2 because the plan retry ceiling is 1.
 * Neither value grants a third execution. Bind the complete queued execution
 * receipt instead of misreading this field as a completed-execution count.
 */
export function cadenceMicroSeedSourcePlanExecutionExhausted(args: {
  status?: string;
  workerAttempts?: number;
  workerToken?: string;
  heartbeatAt?: number;
  leaseExpiresAt?: number;
  nextAttemptAt?: number;
  jobCreatedAt: number;
  reservationDay?: string;
  marker: Record<string, unknown>;
  result: Record<string, unknown>;
}): boolean {
  const attempts = args.workerAttempts;
  const firstExecutionCount = args.marker.firstExecutionCount;
  const remainingTopicCapacity = args.marker.remainingTopicCapacity;
  const queuedAt = args.marker.queuedAt;
  return Boolean(
    args.status === "failed" &&
      (attempts === 1 || attempts === 2) &&
      args.workerToken === undefined &&
      args.heartbeatAt === undefined &&
      args.leaseExpiresAt === undefined &&
      args.nextAttemptAt === undefined &&
      args.marker.version === 1 &&
      Number.isInteger(firstExecutionCount) &&
      (firstExecutionCount as number) > 0 &&
      Number.isInteger(remainingTopicCapacity) &&
      (remainingTopicCapacity as number) > 0 &&
      Number.isFinite(queuedAt) &&
      (queuedAt as number) >= args.jobCreatedAt &&
      (queuedAt as number) <= 8_640_000_000_000_000 &&
      new Date(queuedAt as number).toISOString().slice(0, 10) ===
        args.reservationDay &&
      args.result.count === firstExecutionCount &&
      args.result.continuationStatus === "queued" &&
      args.result.continuationWorkerExecution === 2 &&
      args.result.remainingTopicCapacity === remainingTopicCapacity
  );
}

export type CadenceMicroSeedMetric = {
  keyword: string;
  searchVolume: number;
  difficulty: number;
  difficultyMeasured: true;
  cpc?: number;
  competition?: number;
  intent: string;
  trend: number[];
};

export function normalizeCadenceMicroSeedText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Only explicit product/capability phrases may seed the rescue request. */
export function cadenceMicroSeedAnchors(args: {
  anchorKeywords?: string[] | null;
  keyFeatures?: string[] | null;
}): string[] {
  return tenantDiscoveryAnchors([
    ...(args.anchorKeywords ?? []),
    ...(args.keyFeatures ?? []),
  ].filter((value): value is string => typeof value === "string"), 24).filter((anchor) => {
    const words = normalizeCadenceMicroSeedText(anchor).split(" ");
    return words.length >= 2 && words.length <= 6;
  });
}

/**
 * Rotate deterministically from the exact exhausted plan. Replaying inspect
 * yields the same seed; another plan can select a different explicit anchor.
 */
export function selectCadenceMicroSeedAnchor(
  anchors: readonly string[],
  sourcePlanKey: string,
): string | null {
  const normalized = [...new Set(
    anchors.map(normalizeCadenceMicroSeedText).filter(Boolean),
  )];
  if (normalized.length === 0) return null;
  let hash = 0;
  for (const character of sourcePlanKey) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return normalized[hash % normalized.length] ?? null;
}

/**
 * Select exactly the next explicit anchor after the durable primary seed.
 * The original seed must still be authorized by the tenant's current profile;
 * profile drift cannot silently turn a different phrase into a retry.
 */
export function selectCadenceMicroSeedFallbackAnchor(
  anchors: readonly string[],
  sourcePlanKey: string,
  primarySeed: string,
): string | null {
  const normalized = [...new Set(
    anchors.map(normalizeCadenceMicroSeedText).filter(Boolean),
  )];
  if (normalized.length < 2) return null;
  const expectedPrimary = selectCadenceMicroSeedAnchor(
    normalized,
    sourcePlanKey,
  );
  const primary = normalizeCadenceMicroSeedText(primarySeed);
  if (!expectedPrimary || expectedPrimary !== primary) return null;
  const primaryIndex = normalized.indexOf(primary);
  if (primaryIndex < 0) return null;
  const alternate = normalized[(primaryIndex + 1) % normalized.length] ?? null;
  return alternate && alternate !== primary ? alternate : null;
}

export type CadenceMicroSeedZeroResultAudit = {
  received: number;
  accepted: number;
  invalidMetric: number;
  intentUnavailable: number;
  difficulty: number;
  brand: number;
  businessFit: number;
  duplicate: number;
  overlap: number;
};

/**
 * Pure proof that the first paid task returned zero rows. A non-empty provider
 * response whose rows were rejected is deliberately not a fallback receipt.
 */
export function cadenceMicroSeedZeroResultReceiptValid(args: {
  attemptKind?: string;
  hasParent: boolean;
  status: string;
  policyVersion: number;
  expectedPolicyVersion: number;
  rolloutEpoch: number;
  expectedRolloutEpoch: number;
  reservationDay: string;
  expectedReservationDay: string;
  createdAt: number;
  now: number;
  seed: string;
  expectedSeed: string;
  locationCode: number;
  expectedLocationCode: number;
  languageCode: string;
  expectedLanguageCode: string;
  providerEndpoint: string;
  providerResultLimit: number;
  includeSerpInfo: boolean;
  includeClickstreamData: boolean;
  providerCostCeilingMicroUsd: number;
  providerCostReservedMicroUsd: number;
  providerCallAttempted: boolean;
  providerCallCompleted: boolean;
  providerAttemptedAt?: number;
  providerCompletedAt?: number;
  completedAt?: number;
  providerRequestTag?: string;
  expectedProviderRequestTag: string;
  providerTaskCostUsd?: number;
  candidateReceiptCount: number;
  candidateAudit?: CadenceMicroSeedZeroResultAudit;
  errorCode?: string;
  workerToken?: string;
  leaseExpiresAt?: number;
  hasSelectedOrTopicReceipt: boolean;
  hasEvidenceOrCadenceReceipt: boolean;
  finalizeAttempts: number;
  cadenceScheduleAttempts: number;
}): boolean {
  const attemptedAt = args.providerAttemptedAt;
  const providerCompletedAt = args.providerCompletedAt;
  const completedAt = args.completedAt;
  const audit = args.candidateAudit;
  const maximumTimestamp = 8_640_000_000_000_000;
  return Boolean(
    cadenceMicroSeedAttemptKind(args.attemptKind) === "primary" &&
      !args.hasParent &&
      args.status === "missed" &&
      args.policyVersion === args.expectedPolicyVersion &&
      args.rolloutEpoch === args.expectedRolloutEpoch &&
      args.reservationDay === args.expectedReservationDay &&
      Number.isFinite(args.createdAt) &&
      args.createdAt >= 0 &&
      args.createdAt <= maximumTimestamp &&
      Number.isFinite(args.now) &&
      args.now >= args.createdAt &&
      args.now <= maximumTimestamp &&
      args.createdAt <= args.now &&
      new Date(args.createdAt).toISOString().slice(0, 10) ===
        args.expectedReservationDay &&
      normalizeCadenceMicroSeedText(args.seed) ===
        normalizeCadenceMicroSeedText(args.expectedSeed) &&
      args.locationCode === args.expectedLocationCode &&
      args.languageCode.trim().toLowerCase() ===
        args.expectedLanguageCode.trim().toLowerCase() &&
      args.providerEndpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT &&
      args.providerResultLimit === CADENCE_MICRO_SEED_RESULT_LIMIT &&
      args.includeSerpInfo === false &&
      args.includeClickstreamData === false &&
      args.providerCostCeilingMicroUsd ===
        CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD &&
      args.providerCostReservedMicroUsd ===
        CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD &&
      args.providerCallAttempted === true &&
      args.providerCallCompleted === true &&
      Number.isFinite(attemptedAt) &&
      (attemptedAt as number) >= args.createdAt &&
      (attemptedAt as number) <= maximumTimestamp &&
      Number.isFinite(providerCompletedAt) &&
      (providerCompletedAt as number) >= (attemptedAt as number) &&
      (providerCompletedAt as number) <= maximumTimestamp &&
      Number.isFinite(completedAt) &&
      (completedAt as number) >= (providerCompletedAt as number) &&
      (completedAt as number) <= maximumTimestamp &&
      (completedAt as number) <= args.now &&
      new Date(attemptedAt as number).toISOString().slice(0, 10) ===
        args.expectedReservationDay &&
      new Date(providerCompletedAt as number).toISOString().slice(0, 10) ===
        args.expectedReservationDay &&
      new Date(completedAt as number).toISOString().slice(0, 10) ===
        args.expectedReservationDay &&
      args.providerRequestTag === args.expectedProviderRequestTag &&
      typeof args.providerTaskCostUsd === "number" &&
      Number.isFinite(args.providerTaskCostUsd) &&
      args.providerTaskCostUsd >= 0 &&
      args.providerTaskCostUsd <=
        CADENCE_MICRO_SEED_TASK_COST_CEILING_USD + Number.EPSILON &&
      args.candidateReceiptCount === 0 &&
      audit !== undefined &&
      Object.values(audit).every((value) => value === 0) &&
      args.errorCode === "no_strict_candidate" &&
      args.workerToken === undefined &&
      args.leaseExpiresAt === undefined &&
      !args.hasSelectedOrTopicReceipt &&
      !args.hasEvidenceOrCadenceReceipt &&
      args.finalizeAttempts === 0 &&
      args.cadenceScheduleAttempts === 0
  );
}

const KNOWN_THIRD_PARTY_BRANDS = [
  "chatgpt", "openai", "jasper", "writesonic", "copyai", "surfer",
  "semrush", "ahrefs", "moz", "grammarly", "hubspot", "wordpress",
  "shopify", "wix", "squarespace", "notion", "canva", "mailchimp",
  "salesforce", "zapier", "hootsuite", "buffer", "yoast", "clearscope",
  "frase", "scalenut", "rytr", "anyword", "peppertype", "contentbot",
] as const;

function brandToken(value: string): string {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .replace(/\.[a-z]{2,}$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function cadenceMicroSeedBlockedBrand(args: {
  keyword: string;
  siteName?: string | null;
  competitors?: string[] | null;
}): string | null {
  const keyword = normalizeCadenceMicroSeedText(args.keyword)
    .replace(/[^a-z0-9]+/g, "");
  const ownBrand = brandToken(args.siteName ?? "");
  const blocked = new Set<string>();
  for (const competitor of args.competitors ?? []) {
    const token = brandToken(competitor);
    if (token.length > 2) blocked.add(token);
  }
  for (const brand of KNOWN_THIRD_PARTY_BRANDS) {
    if (brand !== ownBrand && !ownBrand.includes(brand)) blocked.add(brand);
  }
  for (const brand of blocked) {
    if (keyword.includes(brand)) return brand;
  }
  return null;
}

function microSeedOpportunityScore(metric: CadenceMicroSeedMetric): number {
  const volume = Math.min(Math.log10(Math.max(1, metric.searchVolume)) * 13, 40);
  const difficulty = Math.max(0, (100 - metric.difficulty) * 0.6);
  const cpc = Math.min((metric.cpc ?? 0) * 4, 20);
  return Math.round((volume + difficulty + cpc) * 1_000) / 1_000;
}

export type CadenceMicroSeedCandidateEvaluation<T> = {
  selected: T | null;
  accepted: number;
  rejected: {
    invalidMetric: number;
    intentUnavailable: number;
    difficulty: number;
    brand: number;
    businessFit: number;
    duplicate: number;
    overlap: number;
  };
};

/**
 * Select at most one provider-returned row. Product fit is supplied by the
 * caller because it binds the current tenant profile/version; this helper
 * owns only metric, brand, exact-key and fail-closed lexical coverage gates.
 */
export function selectCadenceMicroSeedCandidate<
  T extends CadenceMicroSeedMetric,
>(args: {
  metrics: readonly T[];
  maximumDifficulty: number;
  existingExactKeywords: ReadonlySet<string>;
  coveredTopics: SerpCoverageTopic[];
  siteName?: string | null;
  competitors?: string[] | null;
  businessFitEligible: (candidate: T) => boolean;
}): CadenceMicroSeedCandidateEvaluation<T> {
  const rejected = {
    invalidMetric: 0,
    intentUnavailable: 0,
    difficulty: 0,
    brand: 0,
    businessFit: 0,
    duplicate: 0,
    overlap: 0,
  };
  const accepted: T[] = [];
  const seen = new Set<string>();
  for (const candidate of args.metrics) {
    const keyword = normalizeCadenceMicroSeedText(candidate.keyword);
    if (
      !keyword ||
      !Number.isFinite(candidate.searchVolume) ||
      candidate.searchVolume <= 0 ||
      candidate.difficultyMeasured !== true ||
      !Number.isFinite(candidate.difficulty) ||
      candidate.difficulty < 0 ||
      candidate.difficulty > 100
    ) {
      rejected.invalidMetric += 1;
      continue;
    }
    if (!candidate.intent || candidate.intent === "unknown") {
      rejected.intentUnavailable += 1;
      continue;
    }
    if (
      candidate.difficulty > keywordDifficultyCeiling(
        args.maximumDifficulty,
        candidate.searchVolume,
      )
    ) {
      rejected.difficulty += 1;
      continue;
    }
    if (cadenceMicroSeedBlockedBrand({
      keyword,
      siteName: args.siteName,
      competitors: args.competitors,
    })) {
      rejected.brand += 1;
      continue;
    }
    if (!args.businessFitEligible(candidate)) {
      rejected.businessFit += 1;
      continue;
    }
    if (
      seen.has(keyword) ||
      args.existingExactKeywords.has(keyword)
    ) {
      rejected.duplicate += 1;
      continue;
    }
    seen.add(keyword);
    const clearsCoverage = filterNonCannibalizingIntentTopics(
      [{ primaryKeyword: keyword }],
      args.coveredTopics,
      0.4,
      0.35,
      1,
    ).length === 1;
    if (!clearsCoverage) {
      rejected.overlap += 1;
      continue;
    }
    accepted.push(candidate);
  }
  accepted.sort((left, right) =>
    microSeedOpportunityScore(right) - microSeedOpportunityScore(left) ||
    left.difficulty - right.difficulty ||
    right.searchVolume - left.searchVolume ||
    normalizeCadenceMicroSeedText(left.keyword).localeCompare(
      normalizeCadenceMicroSeedText(right.keyword),
    )
  );
  return { selected: accepted[0] ?? null, accepted: accepted.length, rejected };
}

export function cadenceMicroSeedProviderReceiptValid(args: {
  endpoint: string;
  requestedSeed: string;
  returnedSeed: string;
  resultLimit: number;
  providerTaskCostUsd: number;
  candidateCount: number;
}): boolean {
  return args.endpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT &&
    normalizeCadenceMicroSeedText(args.requestedSeed) ===
      normalizeCadenceMicroSeedText(args.returnedSeed) &&
    Number.isInteger(args.resultLimit) &&
    args.resultLimit >= 1 &&
    args.resultLimit <= CADENCE_MICRO_SEED_RESULT_LIMIT &&
    Number.isFinite(args.providerTaskCostUsd) &&
    args.providerTaskCostUsd >= 0 &&
    args.providerTaskCostUsd <= CADENCE_MICRO_SEED_TASK_COST_CEILING_USD +
      Number.EPSILON &&
    Number.isInteger(args.candidateCount) &&
    args.candidateCount >= 0 &&
    args.candidateCount <= args.resultLimit;
}
