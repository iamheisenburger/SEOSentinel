/**
 * Expected-click portfolio contract.
 *
 * Publishing capacity is not an SEO outcome. A tenant's topic inventory must
 * contain enough measured demand, on SERPs it can plausibly enter, to support
 * the organic-click goal the tenant configured. This module keeps that proof
 * deterministic and independent from GSC synchronization, topic lifecycle,
 * article generation, and any one tenant's niche.
 *
 * The estimate is deliberately conservative and auditable:
 *
 *   measured monthly demand x organic CTR at projected rank x rank probability
 *
 * Rank probability compares fresh tenant authority evidence with fresh
 * authority measurements for the actual page-one competitors. It never treats
 * missing measurements as an easy SERP.
 */

export const EXPECTED_CLICK_PORTFOLIO_VERSION = 1;

export const DATAFORSEO_AUTHORITY_SOURCE =
  "dataforseo:backlinks_bulk_pages_summary:one_hundred";
export const DATAFORSEO_DEMAND_SOURCE =
  "dataforseo:keyword_metrics";
export const MAX_AUTHORITY_TOPICS_PER_PLAN = 10;
export const MAX_AUTHORITY_DOMAINS_PER_PLAN = 50;
export const AUTHORITY_POSITIONS_PER_TOPIC = 5;
export const MAX_CLICK_GOAL_REPLENISHMENTS_PER_DAY = 1;
export const DATAFORSEO_BACKLINKS_REQUEST_USD = 0.024;
export const DATAFORSEO_BACKLINKS_ROW_USD = 0.000036;

export function estimatedAuthorityBulkCostUsd(targetCount: number): number {
  const boundedTargets = Math.max(
    0,
    Math.min(Math.floor(targetCount), MAX_AUTHORITY_DOMAINS_PER_PLAN),
  );
  if (boundedTargets === 0) return 0;
  return round(
    DATAFORSEO_BACKLINKS_REQUEST_USD +
      boundedTargets * DATAFORSEO_BACKLINKS_ROW_USD,
    6,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_EVIDENCE_MAX_AGE_MS = 45 * DAY_MS;
export const MIN_SERP_AUTHORITY_OBSERVATIONS = 5;

/**
 * Conservative, non-branded planning curve for classic organic results.
 *
 * CTR varies by query, device and SERP features. These values are therefore a
 * planning baseline, not a traffic promise. Keeping the curve versioned makes
 * later calibration against each tenant's GSC data explicit rather than an
 * invisible scoring change.
 */
export const ORGANIC_CTR_BY_POSITION: Readonly<Record<number, number>> =
  Object.freeze({
    1: 0.28,
    2: 0.15,
    3: 0.10,
    4: 0.07,
    5: 0.05,
    6: 0.04,
    7: 0.03,
    8: 0.025,
    9: 0.02,
    10: 0.015,
  });

export type MeasuredSearchDemand = {
  /** Audited monthly search volume for the exact keyword and locale. */
  monthlySearches: number;
  /** Measurement provider or dataset name, for example DataForSEO. */
  source: string;
  measuredAt: number;
};

export type MeasuredAuthority = {
  /** Domain-level authority on a bounded 0-100 scale from one provider. */
  domainRank: number;
  /** Retained as supporting evidence; domainRank remains the common formula. */
  referringDomains?: number;
  source: string;
  measuredAt: number;
};

export type MeasuredSerpCompetitor = MeasuredAuthority & {
  /** Organic position observed on the live SERP. */
  position: number;
  url?: string;
};

export type ExpectedClickTopicInput = {
  topicId: string;
  keyword: string;
  /**
   * Supply the same key for keywords proven to share one intent/SERP. Only the
   * strongest topic in that group contributes to portfolio demand, preventing
   * cannibalizing variants from multiplying the forecast.
   */
  intentKey?: string;
  demand?: MeasuredSearchDemand;
  serpCompetitors: MeasuredSerpCompetitor[];
};

export type TopicExpectedClickEstimate = {
  topicId: string;
  keyword: string;
  intentKey?: string;
  status: "eligible" | "insufficient_evidence";
  expectedClicksMonthly: number;
  measuredDemandMonthly: number;
  projectedPosition: number | null;
  ctr: number;
  rankProbability: number;
  tenantAuthority: number | null;
  medianSerpAuthority: number | null;
  upperQuartileSerpAuthority: number | null;
  observedCompetitors: number;
  reasons: string[];
  version: number;
};

export type ExpectedClickPortfolioDecision = "accept" | "reject" | "flag";

export type ExpectedClickPortfolioEvaluation = {
  decision: ExpectedClickPortfolioDecision;
  status:
    | "supports_goal"
    | "below_goal"
    | "insufficient_evidence"
    | "goal_unconfigured";
  supportsGoal: boolean;
  monthlyOrganicClickGoal: number | null;
  expectedClicksMonthly: number;
  coverageRatio: number | null;
  clickDeficit: number | null;
  countedTopicIds: string[];
  duplicateIntentTopicIds: string[];
  insufficientEvidenceTopicIds: string[];
  topics: TopicExpectedClickEstimate[];
  reasons: string[];
  version: number;
};

export type SerpAuthorityCandidate = {
  position: number;
  url: string;
  domain: string;
};

export type SerpAuthorityCollectionPlan = {
  domains: string[];
  topics: Array<{
    topicId: string;
    candidates: SerpAuthorityCandidate[];
  }>;
  skippedTopicIds: string[];
};

export type StoredExpectedClickTopicEvidence = {
  topicId: string;
  keyword: string;
  searchVolume?: number;
  searchDemandSource?: string;
  searchDemandMeasuredAt?: number;
  searchDemandLocationCode?: number;
  searchDemandLanguageCode?: string;
  serpTopUrls?: string[];
  serpObservedAt?: number;
  serpLocationCode?: number;
  serpLanguageCode?: string;
  serpAuthorityCompetitors?: Array<{
    position: number;
    url: string;
    domainRank: number;
    referringDomains?: number;
    source: string;
    measuredAt: number;
  }>;
};

export type StoredTenantAuthorityEvidence = {
  domain?: string;
  currentDomain?: string;
  domainRank?: number;
  referringDomains?: number;
  source?: string;
  measuredAt?: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, places = 4): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedDomain(value: string): string | null {
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    return parsed.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function normalizedSerpUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    parsed.search = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${path}`;
  } catch {
    return null;
  }
}

/**
 * Stable explicit intent key for a measured SERP. It intentionally uses only
 * the observed URLs; lexical similarity is not evidence that two keywords
 * share one intent.
 */
export function expectedClickIntentKey(urls: string[] | undefined): string | undefined {
  const normalized = [...new Set(
    (urls ?? []).map(normalizedSerpUrl).filter((url): url is string => Boolean(url)),
  )].sort().slice(0, 10);
  return normalized.length >= MIN_SERP_AUTHORITY_OBSERVATIONS
    ? normalized.join("|")
    : undefined;
}

/**
 * Build the paid authority-measurement worklist before making any request.
 * Each topic contributes at most five organic positions, domains are looked up
 * once across the whole plan, and the hard global bound cannot be bypassed by
 * a large or duplicate candidate set.
 */
export function planSerpAuthorityCollection(args: {
  tenantDomain: string;
  topics: Array<{
    topicId: string;
    results: Array<{ position: number; url: string }>;
  }>;
  maxTopics?: number;
  positionsPerTopic?: number;
  maxDomains?: number;
}): SerpAuthorityCollectionPlan {
  const tenantDomain = normalizedDomain(args.tenantDomain);
  const maxTopics = Math.max(
    1,
    Math.min(args.maxTopics ?? MAX_AUTHORITY_TOPICS_PER_PLAN, MAX_AUTHORITY_TOPICS_PER_PLAN),
  );
  const positionsPerTopic = Math.max(
    1,
    Math.min(
      args.positionsPerTopic ?? AUTHORITY_POSITIONS_PER_TOPIC,
      AUTHORITY_POSITIONS_PER_TOPIC,
    ),
  );
  const maxDomains = Math.max(
    1,
    Math.min(args.maxDomains ?? MAX_AUTHORITY_DOMAINS_PER_PLAN, MAX_AUTHORITY_DOMAINS_PER_PLAN),
  );
  const domains: string[] = [];
  const domainSet = new Set<string>();
  const topics: SerpAuthorityCollectionPlan["topics"] = [];
  const skippedTopicIds: string[] = [];

  for (const topic of args.topics.slice(0, maxTopics)) {
    const candidates = topic.results
      .filter((result) =>
        Number.isInteger(result.position) &&
        result.position >= 1 &&
        result.position <= 10,
      )
      .sort((left, right) => left.position - right.position)
      .filter(
        (result, index, all) =>
          index === all.findIndex((other) => other.position === result.position),
      )
      .flatMap((result) => {
        const domain = normalizedDomain(result.url);
        if (!domain || domain === tenantDomain) return [];
        return [{ ...result, domain }];
      })
      .slice(0, positionsPerTopic);

    const requiredNewDomains = candidates
      .map((candidate) => candidate.domain)
      .filter((domain, index, all) =>
        !domainSet.has(domain) && all.indexOf(domain) === index,
      );
    if (domains.length + requiredNewDomains.length > maxDomains) {
      skippedTopicIds.push(topic.topicId);
      continue;
    }
    for (const domain of requiredNewDomains) {
      domainSet.add(domain);
      domains.push(domain);
    }
    topics.push({ topicId: topic.topicId, candidates });
  }

  return { domains, topics, skippedTopicIds };
}

export function expectedClickTopicFromStoredEvidence(
  topic: StoredExpectedClickTopicEvidence,
  currentLocale?: { locationCode: number; languageCode: string },
): ExpectedClickTopicInput {
  const snapshotUrls = new Set(
    (topic.serpTopUrls ?? [])
      .map(normalizedSerpUrl)
      .filter((url): url is string => Boolean(url)),
  );
  const snapshotObservedAt = Number.isFinite(topic.serpObservedAt)
    ? topic.serpObservedAt!
    : undefined;
  const localeBound =
    Number.isInteger(topic.searchDemandLocationCode) &&
    Number.isInteger(topic.serpLocationCode) &&
    topic.searchDemandLocationCode === topic.serpLocationCode &&
    nonEmpty(topic.searchDemandLanguageCode) &&
    nonEmpty(topic.serpLanguageCode) &&
    topic.searchDemandLanguageCode!.trim().toLowerCase() ===
      topic.serpLanguageCode!.trim().toLowerCase() &&
    (!currentLocale ||
      (topic.searchDemandLocationCode === currentLocale.locationCode &&
        topic.searchDemandLanguageCode!.trim().toLowerCase() ===
          currentLocale.languageCode.trim().toLowerCase()));
  return {
    topicId: topic.topicId,
    keyword: topic.keyword,
    intentKey: expectedClickIntentKey(topic.serpTopUrls),
    demand:
      Number.isFinite(topic.searchVolume) &&
      nonEmpty(topic.searchDemandSource) &&
      Number.isFinite(topic.searchDemandMeasuredAt) &&
      localeBound
        ? {
            monthlySearches: topic.searchVolume!,
            source: topic.searchDemandSource!,
            measuredAt: topic.searchDemandMeasuredAt!,
          }
        : undefined,
    serpCompetitors: (topic.serpAuthorityCompetitors ?? []).flatMap((competitor) => {
      const normalizedUrl = normalizedSerpUrl(competitor.url);
      // A new SERP snapshot invalidates old authority rows. Without this join,
      // replacing serpTopUrls could make evidence for yesterday's competitors
      // appear to describe today's page one.
      if (
        snapshotObservedAt === undefined ||
        !localeBound ||
        !normalizedUrl ||
        !snapshotUrls.has(normalizedUrl) ||
        competitor.measuredAt < snapshotObservedAt
      ) {
        return [];
      }
      return [{
        position: competitor.position,
        url: competitor.url,
        domainRank: competitor.domainRank,
        referringDomains: competitor.referringDomains,
        source: competitor.source,
        measuredAt: competitor.measuredAt,
      }];
    }),
  };
}

export function tenantAuthorityFromStoredEvidence(
  evidence: StoredTenantAuthorityEvidence,
): MeasuredAuthority | undefined {
  const evidenceDomain = evidence.domain
    ? normalizedDomain(evidence.domain)
    : null;
  const currentDomain = evidence.currentDomain
    ? normalizedDomain(evidence.currentDomain)
    : null;
  if (
    !evidenceDomain ||
    !currentDomain ||
    evidenceDomain !== currentDomain ||
    !Number.isFinite(evidence.domainRank) ||
    !nonEmpty(evidence.source) ||
    !Number.isFinite(evidence.measuredAt)
  ) {
    return undefined;
  }
  return {
    domainRank: evidence.domainRank!,
    referringDomains: evidence.referringDomains,
    source: evidence.source!,
    measuredAt: evidence.measuredAt!,
  };
}

export function evaluateStoredExpectedClickPortfolio(args: {
  topics: StoredExpectedClickTopicEvidence[];
  tenantAuthority: StoredTenantAuthorityEvidence;
  monthlyOrganicClickGoal?: number;
  now?: number;
  maxEvidenceAgeMs?: number;
  currentLocationCode?: number;
  currentLanguageCode?: string;
}): ExpectedClickPortfolioEvaluation {
  return evaluateExpectedClickPortfolio({
    topics: args.topics.map((topic) => expectedClickTopicFromStoredEvidence(
      topic,
      args.currentLocationCode !== undefined && args.currentLanguageCode
        ? {
            locationCode: args.currentLocationCode,
            languageCode: args.currentLanguageCode,
          }
        : undefined,
    )),
    tenantAuthority: tenantAuthorityFromStoredEvidence(args.tenantAuthority),
    monthlyOrganicClickGoal: args.monthlyOrganicClickGoal,
    now: args.now,
    maxEvidenceAgeMs: args.maxEvidenceAgeMs,
  });
}

function evidenceTimestampIsFresh(
  measuredAt: number,
  now: number,
  maxAgeMs: number,
): boolean {
  if (!Number.isFinite(measuredAt) || measuredAt <= 0) return false;
  // Small clock skew is harmless; future-dated evidence beyond it is not.
  if (measuredAt > now + 5 * 60 * 1000) return false;
  return now - measuredAt <= maxAgeMs;
}

function validAuthorityMeasurement(
  authority: MeasuredAuthority | undefined,
  now: number,
  maxAgeMs: number,
): authority is MeasuredAuthority {
  return Boolean(
    authority &&
      Number.isFinite(authority.domainRank) &&
      authority.domainRank >= 0 &&
      authority.domainRank <= 100 &&
      nonEmpty(authority.source) &&
      evidenceTimestampIsFresh(authority.measuredAt, now, maxAgeMs),
  );
}

export function measuredAuthorityIsFresh(
  authority: MeasuredAuthority | undefined,
  now = Date.now(),
  maxAgeMs = DEFAULT_EVIDENCE_MAX_AGE_MS,
): authority is MeasuredAuthority {
  return validAuthorityMeasurement(authority, now, maxAgeMs);
}

function validDemandMeasurement(
  demand: MeasuredSearchDemand | undefined,
  now: number,
  maxAgeMs: number,
): demand is MeasuredSearchDemand {
  return Boolean(
    demand &&
      Number.isFinite(demand.monthlySearches) &&
      demand.monthlySearches >= 0 &&
      nonEmpty(demand.source) &&
      evidenceTimestampIsFresh(demand.measuredAt, now, maxAgeMs),
  );
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = clamp(Math.ceil(sorted.length * fraction) - 1, 0, sorted.length - 1);
  return sorted[index];
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/** Return the versioned organic CTR assumption for an integer top-ten rank. */
export function organicCtrAtPosition(position: number): number {
  if (!Number.isFinite(position)) return 0;
  const rank = Math.round(position);
  return ORGANIC_CTR_BY_POSITION[rank] ?? 0;
}

/**
 * Validate a tenant-configured monthly organic-click goal before persistence.
 * A missing goal is allowed for legacy tenants, but it cannot yield an accepted
 * portfolio audit.
 */
export function validateOrganicClickGoal(
  monthlyGoal: number | undefined,
): number | undefined {
  if (monthlyGoal === undefined) return undefined;
  if (
    !Number.isInteger(monthlyGoal) ||
    monthlyGoal < 1 ||
    monthlyGoal > 1_000_000
  ) {
    throw new Error(
      "Monthly organic-click goal must be a whole number between 1 and 1,000,000.",
    );
  }
  return monthlyGoal;
}

/**
 * Estimate clicks for one keyword from fresh measured evidence only.
 */
export function estimateTopicExpectedClicks(args: {
  topic: ExpectedClickTopicInput;
  tenantAuthority?: MeasuredAuthority;
  now?: number;
  maxEvidenceAgeMs?: number;
  minimumSerpObservations?: number;
}): TopicExpectedClickEstimate {
  const now = args.now ?? Date.now();
  const maxAgeMs = args.maxEvidenceAgeMs ?? DEFAULT_EVIDENCE_MAX_AGE_MS;
  const minimumObservations = Math.max(
    1,
    Math.min(10, args.minimumSerpObservations ?? MIN_SERP_AUTHORITY_OBSERVATIONS),
  );
  const reasons: string[] = [];

  if (!validDemandMeasurement(args.topic.demand, now, maxAgeMs)) {
    reasons.push("Exact-keyword monthly demand is missing, stale, or not auditable.");
  }
  if (!validAuthorityMeasurement(args.tenantAuthority, now, maxAgeMs)) {
    reasons.push("Tenant authority is missing, stale, or not auditable.");
  }

  // Keep one fresh measurement per observed organic rank. Mixed authority
  // providers are rejected because their 0-100 scales are not interchangeable.
  const freshCompetitors = args.topic.serpCompetitors
    .filter(
      (competitor) =>
        Number.isInteger(competitor.position) &&
        competitor.position >= 1 &&
        competitor.position <= 10 &&
        validAuthorityMeasurement(competitor, now, maxAgeMs),
    )
    .sort((left, right) => left.position - right.position)
    .filter(
      (competitor, index, all) =>
        index === all.findIndex((other) => other.position === competitor.position),
    );

  const authoritySources = new Set(freshCompetitors.map((item) => item.source.trim()));
  if (args.tenantAuthority && validAuthorityMeasurement(args.tenantAuthority, now, maxAgeMs)) {
    authoritySources.add(args.tenantAuthority.source.trim());
  }
  if (authoritySources.size > 1) {
    reasons.push("Tenant and SERP authority were measured on incompatible provider scales.");
  }
  if (freshCompetitors.length < minimumObservations) {
    reasons.push(
      `Only ${freshCompetitors.length}/${minimumObservations} required page-one authority measurements are fresh.`,
    );
  }

  if (reasons.length > 0) {
    return {
      topicId: args.topic.topicId,
      keyword: args.topic.keyword,
      intentKey: args.topic.intentKey,
      status: "insufficient_evidence",
      expectedClicksMonthly: 0,
      measuredDemandMonthly: validDemandMeasurement(args.topic.demand, now, maxAgeMs)
        ? args.topic.demand.monthlySearches
        : 0,
      projectedPosition: null,
      ctr: 0,
      rankProbability: 0,
      tenantAuthority: validAuthorityMeasurement(args.tenantAuthority, now, maxAgeMs)
        ? args.tenantAuthority.domainRank
        : null,
      medianSerpAuthority: null,
      upperQuartileSerpAuthority: null,
      observedCompetitors: freshCompetitors.length,
      reasons,
      version: EXPECTED_CLICK_PORTFOLIO_VERSION,
    };
  }

  const tenantAuthority = args.tenantAuthority!.domainRank;
  const strengths = freshCompetitors
    .map((competitor) => competitor.domainRank)
    .sort((left, right) => left - right);
  const medianStrength = median(strengths);
  const upperQuartileStrength = percentile(strengths, 0.75);

  // Approximate where equal-quality content would sit in the observed
  // authority distribution. Near-ties share half a rank instead of all being
  // treated as either stronger or weaker.
  const tieBand = 2;
  const stronger = strengths.filter((strength) => strength > tenantAuthority + tieBand).length;
  const tied = strengths.filter(
    (strength) => Math.abs(strength - tenantAuthority) <= tieBand,
  ).length;
  const projectedPosition = clamp(
    Math.round(1 + stronger + tied * 0.5),
    1,
    10,
  );
  const ctr = organicCtrAtPosition(projectedPosition);

  // A 12-point authority gap materially changes the chance of reaching the
  // projected rank without turning the estimate into a binary DR threshold.
  const authorityProbability = sigmoid((tenantAuthority - medianStrength) / 12);
  const observationCoverage = Math.min(1, freshCompetitors.length / 10);
  const upperQuartilePenalty = clamp(
    1 - Math.max(0, upperQuartileStrength - tenantAuthority) / 100,
    0.55,
    1,
  );
  const rankProbability = round(
    clamp(
      authorityProbability * observationCoverage * upperQuartilePenalty,
      0.01,
      0.85,
    ),
  );
  const expectedClicksMonthly = round(
    args.topic.demand!.monthlySearches * ctr * rankProbability,
    2,
  );

  return {
    topicId: args.topic.topicId,
    keyword: args.topic.keyword,
    intentKey: args.topic.intentKey,
    status: "eligible",
    expectedClicksMonthly,
    measuredDemandMonthly: args.topic.demand!.monthlySearches,
    projectedPosition,
    ctr,
    rankProbability,
    tenantAuthority,
    medianSerpAuthority: round(medianStrength, 2),
    upperQuartileSerpAuthority: round(upperQuartileStrength, 2),
    observedCompetitors: freshCompetitors.length,
    reasons: [
      `Projected position ${projectedPosition} uses a ${(ctr * 100).toFixed(1)}% planning CTR.`,
      `Rank probability ${(rankProbability * 100).toFixed(1)}% compares tenant authority ${tenantAuthority} with measured page-one median ${round(medianStrength, 2)}.`,
    ],
    version: EXPECTED_CLICK_PORTFOLIO_VERSION,
  };
}

function normalizedIntentKey(topic: ExpectedClickTopicInput): string {
  const supplied = topic.intentKey?.trim().toLowerCase();
  // Do not infer shared intent lexically. Without an explicit SERP-backed key,
  // each topic remains independent.
  return supplied || `topic:${topic.topicId}`;
}

function measuredSerpIntentTokens(topic: ExpectedClickTopicInput): Set<string> | null {
  const supplied = topic.intentKey?.trim().toLowerCase();
  if (!supplied) return null;
  const tokens = new Set(supplied.split("|").filter(Boolean));
  return tokens.size >= MIN_SERP_AUTHORITY_OBSERVATIONS ? tokens : null;
}

/**
 * Group exact and materially overlapping measured SERPs before summing demand.
 * Reordered result sets and query variants sharing at least three URLs and 40%
 * of the smaller page-one set represent one search intent, not extra traffic.
 */
function buildIntentGroups(inputs: ExpectedClickTopicInput[]): Map<string, string> {
  const parent = new Map(inputs.map((topic) => [topic.topicId, topic.topicId]));
  const find = (id: string): string => {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].sort();
    parent.set(second, first);
  };

  for (let leftIndex = 0; leftIndex < inputs.length; leftIndex += 1) {
    const left = inputs[leftIndex];
    const leftKey = normalizedIntentKey(left);
    const leftTokens = measuredSerpIntentTokens(left);
    for (let rightIndex = leftIndex + 1; rightIndex < inputs.length; rightIndex += 1) {
      const right = inputs[rightIndex];
      const rightKey = normalizedIntentKey(right);
      if (leftKey === rightKey) {
        union(left.topicId, right.topicId);
        continue;
      }
      const rightTokens = measuredSerpIntentTokens(right);
      if (!leftTokens || !rightTokens) continue;
      let shared = 0;
      for (const token of leftTokens) {
        if (rightTokens.has(token)) shared += 1;
      }
      if (
        shared >= 3 &&
        shared / Math.min(leftTokens.size, rightTokens.size) >= 0.4
      ) {
        union(left.topicId, right.topicId);
      }
    }
  }

  return new Map(inputs.map((topic) => [topic.topicId, find(topic.topicId)]));
}

/**
 * Decide whether a complete topic inventory can support its configured click
 * goal. The result is an explicit contract for planners and operators:
 *
 * - accept: measured portfolio meets the goal;
 * - reject: complete measured portfolio is mathematically below the goal;
 * - flag: missing/stale evidence prevents a defensible decision.
 */
export function evaluateExpectedClickPortfolio(args: {
  topics: ExpectedClickTopicInput[];
  tenantAuthority?: MeasuredAuthority;
  monthlyOrganicClickGoal?: number;
  now?: number;
  maxEvidenceAgeMs?: number;
  minimumSerpObservations?: number;
}): ExpectedClickPortfolioEvaluation {
  const goal = validateOrganicClickGoal(args.monthlyOrganicClickGoal);
  const topics = args.topics.map((topic) =>
    estimateTopicExpectedClicks({
      topic,
      tenantAuthority: args.tenantAuthority,
      now: args.now,
      maxEvidenceAgeMs: args.maxEvidenceAgeMs,
      minimumSerpObservations: args.minimumSerpObservations,
    }),
  );
  const inputById = new Map(args.topics.map((topic) => [topic.topicId, topic]));
  const intentGroupByTopicId = buildIntentGroups(args.topics);
  const eligible = topics
    .filter((topic) => topic.status === "eligible")
    .sort(
      (left, right) =>
        right.expectedClicksMonthly - left.expectedClicksMonthly ||
        left.topicId.localeCompare(right.topicId),
    );
  const counted: TopicExpectedClickEstimate[] = [];
  const duplicateIntentTopicIds: string[] = [];
  const countedIntentKeys = new Set<string>();
  for (const estimate of eligible) {
    const input = inputById.get(estimate.topicId)!;
    const intentKey = intentGroupByTopicId.get(input.topicId) ?? normalizedIntentKey(input);
    if (countedIntentKeys.has(intentKey)) {
      duplicateIntentTopicIds.push(estimate.topicId);
      continue;
    }
    countedIntentKeys.add(intentKey);
    counted.push(estimate);
  }

  const expectedClicksMonthly = round(
    counted.reduce((total, topic) => total + topic.expectedClicksMonthly, 0),
    2,
  );
  const insufficientEvidenceTopicIds = topics
    .filter((topic) => topic.status === "insufficient_evidence")
    .map((topic) => topic.topicId);

  if (goal === undefined) {
    return {
      decision: "flag",
      status: "goal_unconfigured",
      supportsGoal: false,
      monthlyOrganicClickGoal: null,
      expectedClicksMonthly,
      coverageRatio: null,
      clickDeficit: null,
      countedTopicIds: counted.map((topic) => topic.topicId),
      duplicateIntentTopicIds,
      insufficientEvidenceTopicIds,
      topics,
      reasons: [
        "No monthly organic-click goal is configured, so portfolio sufficiency cannot be proven.",
      ],
      version: EXPECTED_CLICK_PORTFOLIO_VERSION,
    };
  }

  const coverageRatio = round(expectedClicksMonthly / goal);
  const clickDeficit = round(Math.max(0, goal - expectedClicksMonthly), 2);
  if (expectedClicksMonthly >= goal) {
    return {
      decision: "accept",
      status: "supports_goal",
      supportsGoal: true,
      monthlyOrganicClickGoal: goal,
      expectedClicksMonthly,
      coverageRatio,
      clickDeficit,
      countedTopicIds: counted.map((topic) => topic.topicId),
      duplicateIntentTopicIds,
      insufficientEvidenceTopicIds,
      topics,
      reasons: [
        `Measured expected clicks ${expectedClicksMonthly} meet the configured ${goal}/month goal.`,
      ],
      version: EXPECTED_CLICK_PORTFOLIO_VERSION,
    };
  }

  if (insufficientEvidenceTopicIds.length > 0) {
    return {
      decision: "flag",
      status: "insufficient_evidence",
      supportsGoal: false,
      monthlyOrganicClickGoal: goal,
      expectedClicksMonthly,
      coverageRatio,
      clickDeficit,
      countedTopicIds: counted.map((topic) => topic.topicId),
      duplicateIntentTopicIds,
      insufficientEvidenceTopicIds,
      topics,
      reasons: [
        `Measured topics are ${clickDeficit} expected clicks/month below goal, but ${insufficientEvidenceTopicIds.length} topic(s) lack evidence and require measurement before rejection.`,
      ],
      version: EXPECTED_CLICK_PORTFOLIO_VERSION,
    };
  }

  return {
    decision: "reject",
    status: "below_goal",
    supportsGoal: false,
    monthlyOrganicClickGoal: goal,
    expectedClicksMonthly,
    coverageRatio,
    clickDeficit,
    countedTopicIds: counted.map((topic) => topic.topicId),
    duplicateIntentTopicIds,
    insufficientEvidenceTopicIds,
    topics,
    reasons: [
      `Complete measured inventory is ${clickDeficit} expected clicks/month below the configured ${goal}/month goal; replenish or revise it instead of treating publishing volume as success.`,
    ],
    version: EXPECTED_CLICK_PORTFOLIO_VERSION,
  };
}
