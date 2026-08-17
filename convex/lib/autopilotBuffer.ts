import { PUBLICATION_AUDIT_VERSION } from "./publicationArtifact.ts";

export const MIN_APPROVED_BUFFER = 2;
export const TARGET_APPROVED_BUFFER = 3;
// Keep at least one week of verified, non-overlapping topics ahead of a daily
// tenant. Topic planning is comparatively slow and paid, so waiting until the
// final topic is consumed makes an otherwise healthy publication buffer
// unnecessarily fragile.
export const MIN_VERIFIED_TOPIC_HORIZON = 7;
// Three passing candidates fill the target. Two additional candidates are the
// bounded replacement allowance when the strict gate quarantines work; this
// prevents two rejections from forcing a 24-hour empty-buffer dead zone.
export const MAX_QUALITY_REPLACEMENTS_PER_24H = 2;
export const MAX_NEW_CANDIDATES_PER_24H =
  TARGET_APPROVED_BUFFER + MAX_QUALITY_REPLACEMENTS_PER_24H;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function cadenceIntervalMs(cadencePerWeek: number): number {
  if (
    !Number.isFinite(cadencePerWeek) ||
    cadencePerWeek <= 0 ||
    cadencePerWeek > 21
  ) {
    throw new Error("Cadence must be greater than zero and no higher than 21 articles per week");
  }
  return Math.floor(WEEK_MS / cadencePerWeek);
}

export function autopilotCandidateBudget(rolloutMode: string): number {
  return ["warm", "live"].includes(rolloutMode)
    ? MAX_NEW_CANDIDATES_PER_24H
    : 1;
}

export function autopilotCandidateWindowStart(args: {
  now: number;
  rolloutMode: string;
  rolloutStartedAt?: number;
}): number {
  const dayStart = args.now - 24 * 60 * 60 * 1000;
  if (
    args.rolloutMode === "warm" &&
    Number.isFinite(args.rolloutStartedAt)
  ) {
    return Math.max(dayStart, args.rolloutStartedAt as number);
  }
  return dayStart;
}

export type BufferArticle = {
  status: string;
  publicationGateStatus?: string;
  publicationAuditVersion?: number;
  auditedContentHash?: string;
};

export type PublicationClockArticle = {
  createdAt: number;
  publishedAt?: number;
  publicationAuditVersion?: number;
  auditedContentHash?: string;
};

export type TopicCoverageArticle = {
  topicId?: string;
  slug: string;
};

export type TopicCoverageTopic = {
  _id: string;
  status: string;
  primaryKeyword: string;
  serpTopUrls?: string[];
};

/**
 * Build the cannibalization corpus from the canonical primary keywords that
 * actually produced articles. Broad article meta-keywords are deliberately
 * excluded: they contain category synonyms and previously caused mature sites
 * to reject every genuinely distinct topic in the same product category.
 */
export function coveredPrimaryKeywords(
  topics: TopicCoverageTopic[],
  articles: TopicCoverageArticle[],
): string[] {
  const usedTopicIds = new Set(
    articles
      .map((article) => article.topicId)
      .filter((topicId): topicId is string => Boolean(topicId)),
  );
  const canonical = topics
    .filter(
      (topic) => topic.status === "used" || usedTopicIds.has(topic._id),
    )
    .map((topic) => topic.primaryKeyword);
  const legacy = articles
    .filter((article) => !article.topicId)
    .map((article) => article.slug.replace(/^\//, "").replace(/-/g, " "));
  return [...new Set([...canonical, ...legacy].filter(Boolean))];
}

/**
 * Preserve each covered page's live SERP fingerprint for the scheduler. Plan
 * creation already uses this evidence to distinguish adjacent cluster support
 * from duplicate intent; discarding it at scheduling time creates a false
 * deadlock where a verified support topic is saved and then rejected by a
 * weaker lexical-only rule.
 */
export function coveredIntentTopics(
  topics: TopicCoverageTopic[],
  articles: TopicCoverageArticle[],
): SerpCoverageTopic[] {
  const usedTopicIds = new Set(
    articles
      .map((article) => article.topicId)
      .filter((topicId): topicId is string => Boolean(topicId)),
  );
  const canonical = topics
    .filter(
      (topic) => topic.status === "used" || usedTopicIds.has(topic._id),
    )
    .map((topic) => ({
      primaryKeyword: topic.primaryKeyword,
      serpTopUrls: topic.serpTopUrls,
    }));
  const legacy = articles
    .filter((article) => !article.topicId)
    .map((article) => ({
      primaryKeyword: article.slug.replace(/^\//, "").replace(/-/g, " "),
    }));
  const seen = new Set<string>();
  return [...canonical, ...legacy].filter((topic) => {
    const key = topic.primaryKeyword.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A mutable legacy row must not become a fresh publication merely because a
 * maintenance migration touched it. Only the modern sealed publisher receipt
 * is authoritative for a later publication timestamp; legacy rows use their
 * immutable creation time as the conservative cadence clock.
 */
export function effectivePublishedAt(
  article: PublicationClockArticle,
): number {
  const sealedModernPublication =
    article.publicationAuditVersion === PUBLICATION_AUDIT_VERSION &&
    typeof article.auditedContentHash === "string" &&
    article.auditedContentHash.length > 0 &&
    Number.isFinite(article.publishedAt);
  return sealedModernPublication
    ? (article.publishedAt as number)
    : article.createdAt;
}

export function isSealedReady(article: BufferArticle): boolean {
  return (
    article.status === "ready" &&
    article.publicationGateStatus === "passed" &&
    article.publicationAuditVersion === PUBLICATION_AUDIT_VERSION &&
    typeof article.auditedContentHash === "string" &&
    article.auditedContentHash.length > 0
  );
}

/**
 * A coarse fleet cron is allowed to discover work, but it must not define a
 * tenant's publication time. Once an autonomous tenant has a sealed artifact,
 * arm one durable wake-up for the exact cadence deadline. This keeps a daily
 * tenant from drifting up to the three-hour fleet interval after every post.
 */
export function exactCadenceWakeupAt(args: {
  autonomousDelivery: boolean;
  sealedBufferCount: number;
  lastPublishedAt?: number;
  cadenceMs: number;
  now: number;
}): number | undefined {
  if (
    !args.autonomousDelivery ||
    args.sealedBufferCount < 1 ||
    !Number.isFinite(args.lastPublishedAt) ||
    !Number.isFinite(args.cadenceMs) ||
    args.cadenceMs <= 0
  ) {
    return undefined;
  }
  const dueAt = (args.lastPublishedAt as number) + args.cadenceMs;
  return dueAt > args.now ? dueAt : undefined;
}

export function migrationBlocksAutopilot(
  migrationStatus: string | undefined,
  hasAnyArticle: boolean,
): boolean {
  return hasAnyArticle && migrationStatus !== "completed";
}

export function autopilotHealthStatus(args: {
  schedulerStale: boolean;
  publicationMissed: boolean;
  bufferCount: number;
  lastOutcome?: string;
}): string {
  if (args.schedulerStale) return "scheduler_stale";
  if (args.publicationMissed) return "missed";
  // Exhausting today's bounded generation allowance is only an operational
  // failure when the protected publication buffer is still below its minimum.
  // A later strict review may legitimately seal an existing candidate without
  // creating another candidate. In that case cadence is protected and the
  // stale generation outcome must not keep fleet health red.
  if (
    args.lastOutcome === "quality_budget_exhausted" &&
    args.bufferCount < MIN_APPROVED_BUFFER
  ) {
    return "quality_budget_exhausted";
  }
  const failClosedOutcomes = new Set([
    "migration_pending",
    "quota_reached",
    "site_limit_reached",
    "topic_replenishment_exhausted",
    "job_lease_exhausted",
    "rollout_observe",
    "rollout_conflict",
    "rollout_buffer_ready",
    "readiness_blocked",
  ]);
  if (args.lastOutcome && failClosedOutcomes.has(args.lastOutcome)) {
    return args.lastOutcome;
  }
  if (args.lastOutcome === "publication_failed" || args.lastOutcome === "job_failed") {
    return "publication_failed";
  }
  if (args.lastOutcome === "quality_quarantined") return "quality_quarantined";
  if (args.bufferCount === 0) return "buffer_empty";
  if (args.bufferCount < MIN_APPROVED_BUFFER) return "buffer_low";
  return "healthy";
}

function keywordTokens(value: string): string[] {
  const stopWords = new Set([
    "the", "and", "for", "with", "how", "what", "why", "are", "can",
    "your", "that", "this", "from", "have", "will", "when", "use", "using",
    "guide", "tips",
  ]);
  const aliases = new Map([
    ["automated", "automate"],
    ["automation", "automate"],
    ["automating", "automate"],
    ["conversion", "convert"],
    ["converting", "convert"],
    ["engagement", "engage"],
    ["engaging", "engage"],
    ["generation", "generate"],
    ["generating", "generate"],
    ["qualification", "qualify"],
    ["qualifying", "qualify"],
    ["management", "manage"],
    ["managing", "manage"],
    ["alignment", "align"],
    ["nurturing", "nurture"],
    ["forms", "form"],
    ["leads", "lead"],
    ["prospects", "prospect"],
    ["visitors", "visitor"],
    ["websites", "website"],
  ]);
  const normalized = value
    .toLowerCase()
    .replace(/\b(?:conversational[ -]+ai|artificial[ -]+intelligence[ -]+chatbots?|ai[ -]+chatbots?|chat[ -]+bots?)\b/g, "chatbot")
    .replace(/\bvirtual[ -]+assistants?\b/g, "chatbot");
  return normalized
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !stopWords.has(word))
    .map((word) => aliases.get(word) ?? word);
}

function sharedTokensPreserveOrder(
  tokens: string[],
  shared: Set<string>,
): string[] {
  return tokens.filter((token) => shared.has(token));
}

/**
 * Word order is meaningful in short commercial phrases. "Sales leads" and
 * "lead sales software" share the same bag of words but describe different
 * intents. For two-token intersections, only treat them as the same intent
 * when the shared concepts occur in the same order. Three or more shared
 * concepts remain strong enough evidence even when a question-style keyword
 * rearranges them (for example "website visitor engagement" versus "how to
 * engage website visitors").
 */
function sharedIntentOrderMatches(
  candidateTokens: string[],
  coveredTokens: string[],
  shared: Set<string>,
): boolean {
  if (shared.size >= 3) return true;
  return sharedTokensPreserveOrder(candidateTokens, shared).join("\u0000") ===
    sharedTokensPreserveOrder(coveredTokens, shared).join("\u0000");
}

export function selectNonCannibalizingTopic<T extends { primaryKeyword: string }>(
  topics: T[],
  coveredKeywords: string[],
  maximumOverlap = 0.35,
): T | undefined {
  const coveredTokenSequences = coveredKeywords
    .map(keywordTokens)
    .filter((tokens) => tokens.length > 0);
  return topics.find((topic) => {
    const candidateTokens = [...new Set(keywordTokens(topic.primaryKeyword))];
    if (candidateTokens.length === 0) return false;
    return coveredTokenSequences.every((coveredSequence) => {
      const coveredTokens = [...new Set(coveredSequence)];
      const coveredSet = new Set(coveredTokens);
      const shared = new Set(
        candidateTokens.filter((token) => coveredSet.has(token)),
      );
      // One shared category word (for example "chatbot") is not evidence of
      // cannibalization. Requiring two shared meaningful tokens preserves
      // distinct long-tail intents while still blocking near-duplicates such
      // as "lead scoring model" and "automated lead scoring".
      if (shared.size < 2) return true;
      if (
        !sharedIntentOrderMatches(candidateTokens, coveredTokens, shared)
      ) {
        return true;
      }
      const candidateCoverage = shared.size / candidateTokens.length;
      const coveredCoverage = shared.size / coveredTokens.length;
      return Math.max(candidateCoverage, coveredCoverage) < maximumOverlap;
    });
  });
}

/**
 * Apply the exact scheduler cannibalization rule to a whole candidate plan.
 * Accepted candidates become coverage for the remainder of the batch, so a
 * replenishment cannot save ten mutually overlapping variations and then
 * discover the problem only after paying to plan them.
 */
export function filterNonCannibalizingTopics<
  T extends { primaryKeyword: string },
>(
  topics: T[],
  coveredKeywords: string[],
  maximumOverlap = 0.35,
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const accepted: T[] = [];
  const coverage = [...coveredKeywords];
  for (const topic of topics) {
    if (
      !selectNonCannibalizingTopic(
        [topic],
        coverage,
        maximumOverlap,
      )
    ) {
      continue;
    }
    accepted.push(topic);
    coverage.push(topic.primaryKeyword);
    if (accepted.length >= limit) break;
  }
  return accepted;
}

export type SerpCoverageTopic = {
  primaryKeyword: string;
  serpTopUrls?: string[];
};

function normalizeSerpUrl(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (!/^https?:$/.test(parsed.protocol)) return undefined;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return undefined;
  }
}

export function reliableSerpFingerprint(urls: string[] | undefined): string[] {
  return [...new Set(
    (urls ?? [])
      .map(normalizeSerpUrl)
      .filter((url): url is string => Boolean(url)),
  )].slice(0, 10);
}

export function hasReliableSerpFingerprint(
  urls: string[] | undefined,
): boolean {
  return reliableSerpFingerprint(urls).length >= 5;
}

export function normalizedSerpQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (question): question is string =>
      typeof question === "string" && question.trim().length > 0,
  );
}

export function serpFingerprintOverlap(
  left: string[] | undefined,
  right: string[] | undefined,
): { shared: number; coefficient: number } {
  const leftFingerprint = reliableSerpFingerprint(left);
  const rightFingerprint = reliableSerpFingerprint(right);
  if (leftFingerprint.length < 5 || rightFingerprint.length < 5) {
    return { shared: 0, coefficient: 0 };
  }
  const rightSet = new Set(rightFingerprint);
  const shared = leftFingerprint.filter((url) => rightSet.has(url)).length;
  return {
    shared,
    coefficient: shared /
      Math.min(leftFingerprint.length, rightFingerprint.length),
  };
}

/**
 * Lexical matching cannot prove that differently-worded keywords have distinct
 * search intent. DataForSEO's live top-ten URLs provide the stronger signal:
 * three shared pages covering at least 40% of the smaller result set means the
 * two keywords compete in materially the same SERP and must not both enter the
 * publication plan.
 */
export function filterNonCannibalizingSerpTopics<
  T extends SerpCoverageTopic,
>(
  topics: T[],
  coveredTopics: SerpCoverageTopic[],
  maximumOverlap = 0.4,
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const accepted: T[] = [];
  const coverage = coveredTopics.filter((topic) =>
    hasReliableSerpFingerprint(topic.serpTopUrls)
  );
  for (const topic of topics) {
    const overlaps = coverage.some((covered) => {
      const evidence = serpFingerprintOverlap(
        topic.serpTopUrls,
        covered.serpTopUrls,
      );
      return evidence.shared >= 3 && evidence.coefficient >= maximumOverlap;
    });
    if (overlaps) continue;
    accepted.push(topic);
    if (hasReliableSerpFingerprint(topic.serpTopUrls)) coverage.push(topic);
    if (accepted.length >= limit) break;
  }
  return accepted;
}

/**
 * Use live SERP evidence when both topics have it, with the normalized keyword
 * rule as a fail-closed fallback for legacy rows awaiting fingerprint
 * backfill. This prevents both failure modes: publishing two differently-worded
 * keywords into the same SERP, and rejecting distinct intents merely because
 * their wording is similar.
 */
export function filterNonCannibalizingIntentTopics<
  T extends SerpCoverageTopic,
>(
  topics: T[],
  coveredTopics: SerpCoverageTopic[],
  maximumSerpOverlap = 0.4,
  maximumKeywordOverlap = 0.35,
  limit = Number.POSITIVE_INFINITY,
): T[] {
  const accepted: T[] = [];
  const coverage = [...coveredTopics];
  for (const topic of topics) {
    const conflicts = coverage.some((covered) => {
      if (
        hasReliableSerpFingerprint(topic.serpTopUrls) &&
        hasReliableSerpFingerprint(covered.serpTopUrls)
      ) {
        const evidence = serpFingerprintOverlap(
          topic.serpTopUrls,
          covered.serpTopUrls,
        );
        return evidence.shared >= 3 &&
          evidence.coefficient >= maximumSerpOverlap;
      }
      return !selectNonCannibalizingTopic(
        [topic],
        [covered.primaryKeyword],
        maximumKeywordOverlap,
      );
    });
    if (conflicts) continue;
    accepted.push(topic);
    coverage.push(topic);
    if (accepted.length >= limit) break;
  }
  return accepted;
}

function circularTake<T>(values: T[], start: number, count: number): T[] {
  if (values.length === 0 || count <= 0) return [];
  const result: T[] = [];
  for (let index = 0; index < Math.min(count, values.length); index += 1) {
    result.push(values[(start + index) % values.length]);
  }
  return result;
}

/**
 * DataForSEO accepts twenty seeds in one economical discovery request. The
 * former planner always sent the same first twenty, so every replenishment
 * rediscovered the same exhausted cluster. Preserve core business anchors,
 * then rotate a balanced set of intent variants on every plan generation.
 */
export function topicDiscoverySeedWindow(
  baseSeeds: string[],
  cycle: number,
  limit = 20,
): string[] {
  const normalized = [...new Set(
    baseSeeds
      .map((seed) => seed.trim().toLowerCase().replace(/\s+/g, " "))
      .filter((seed) => seed.length > 3 && seed.split(" ").length <= 6),
  )];
  if (normalized.length === 0 || limit <= 0) return [];

  const anchorCount = Math.min(normalized.length, limit, 8);
  const anchors = circularTake(
    normalized,
    Math.max(0, cycle) % normalized.length,
    anchorCount,
  );
  const suffixes = [
    "software",
    "tool",
    "automation",
    "strategy",
    "guide",
    "best practices",
    "examples",
    "checklist",
    "template",
    "mistakes",
    "for small business",
    "for agencies",
  ];
  const prefixes = [
    "how to improve",
    "how to automate",
    "how to measure",
    "how to choose",
  ];
  const variants: string[] = [];
  for (const suffix of suffixes) {
    for (const seed of normalized) variants.push(`${seed} ${suffix}`);
  }
  for (const prefix of prefixes) {
    for (const seed of normalized) variants.push(`${prefix} ${seed}`);
  }

  const selected = [...anchors];
  const seen = new Set(selected);
  const rotated = circularTake(
    variants,
    (Math.max(0, cycle) * 13) % variants.length,
    variants.length,
  );
  for (const variant of rotated) {
    if (seen.has(variant) || variant.split(" ").length > 8) continue;
    seen.add(variant);
    selected.push(variant);
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * Smaller keyword-suggestion requests are materially more reliable than one
 * heterogeneous twenty-seed request. Keep the request count bounded while
 * ensuring every batch contains a distinct portion of the already-rotated
 * discovery window.
 */
export function topicDiscoverySeedBatches(
  seeds: string[],
  batchSize = 5,
  maximumBatches = 3,
): string[][] {
  if (batchSize <= 0 || maximumBatches <= 0) return [];
  const normalized = [...new Set(
    seeds
      .map((seed) => seed.trim().toLowerCase().replace(/\s+/g, " "))
      .filter(Boolean),
  )];
  const batches: string[][] = [];
  for (
    let start = 0;
    start < normalized.length && batches.length < maximumBatches;
    start += batchSize
  ) {
    batches.push(normalized.slice(start, start + batchSize));
  }
  return batches;
}

const GENERIC_BUSINESS_SIGNAL_WORDS = new Set([
  "agent",
  "ai",
  "best",
  "business",
  "businesses",
  "companies",
  "company",
  "cost",
  "costs",
  "customer",
  "customers",
  "development",
  "digital",
  "generation",
  "guide",
  "implementation",
  "job",
  "jobs",
  "lead",
  "leads",
  "marketing",
  "market",
  "markets",
  "analysis",
  "budget",
  "planning",
  "project",
  "projects",
  "program",
  "programs",
  "online",
  "outside",
  "page",
  "pages",
  "platform",
  "platforms",
  "process",
  "processes",
  "product",
  "products",
  "representative",
  "report",
  "reports",
  "sales",
  "service",
  "services",
  "site",
  "sites",
  "software",
  "solution",
  "solutions",
  "strategies",
  "strategy",
  "technique",
  "techniques",
  "time",
  "times",
  "tool",
  "tools",
  "user",
  "users",
  "website",
  "websites",
  "workflow",
  "workflows",
]);

const BUSINESS_QUERY_MODIFIER_WORDS = new Set([
  "course",
  "courses",
  "definition",
  "example",
  "examples",
  "framework",
  "frameworks",
  "meaning",
  "template",
  "templates",
  "train",
  "training",
  "tutorial",
  "tutorials",
]);

const PRODUCT_OFFERING_WORDS = new Set([
  "agency",
  "agent",
  "app",
  "application",
  "assistant",
  "company",
  "consultant",
  "consulting",
  "firm",
  "platform",
  "plugin",
  "product",
  "service",
  "software",
  "solution",
  "system",
  "tool",
  "widget",
]);

function relevanceRoot(word: string): string {
  let normalized = word
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const suffixes = [
    "izations", "ization", "ations", "ation", "itions", "ition", "ments",
    "ment", "ness", "ingly", "ing", "edly", "ies", "ers", "ed", "er", "s",
  ];
  for (const suffix of suffixes) {
    if (
      normalized.endsWith(suffix) &&
      normalized.length - suffix.length >= 4
    ) {
      normalized = normalized.slice(0, -suffix.length);
      break;
    }
  }
  return normalized.length >= 5 ? normalized.slice(0, 5) : normalized;
}

const RELEVANCE_STOP_WORDS = new Set([
  "about", "and", "are", "can", "for", "from", "have", "how", "into",
  "more", "per", "that", "the", "this", "using", "what", "why", "will", "with",
  "your",
]);

function relevanceTokens(value: string): string[] {
  return value
    .split(/[^a-z0-9]+/i)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && !RELEVANCE_STOP_WORDS.has(word));
}

function distinctiveRelevanceRoots(words: string[]): Set<string> {
  return new Set(
    words
      .filter((word) =>
        !GENERIC_BUSINESS_SIGNAL_WORDS.has(word) &&
        !BUSINESS_QUERY_MODIFIER_WORDS.has(word)
      )
      .map(relevanceRoot),
  );
}

function genericOfferingAlignment(
  keywordWords: string[],
  signalWords: string[],
): boolean {
  const keywordRoots = new Set(keywordWords.map(relevanceRoot));
  const signalRoots = new Set(signalWords.map(relevanceRoot));
  let sharedRoots = 0;
  for (const root of keywordRoots) {
    if (signalRoots.has(root)) sharedRoots += 1;
  }
  const sharedOffering = keywordWords.some((word) =>
    PRODUCT_OFFERING_WORDS.has(word) && signalWords.includes(word)
  );
  return sharedOffering && sharedRoots >= 2;
}

export type BusinessSignalMatch = {
  eligible: boolean;
  matchedDistinctiveRoots: string[];
  unmatchedDistinctiveRoots: string[];
  score: number;
};

export function businessSignalMatch(
  keyword: string,
  businessSignals: string[],
): BusinessSignalMatch {
  const keywordWords = relevanceTokens(keyword);
  if (keywordWords.length === 0) {
    return {
      eligible: false,
      matchedDistinctiveRoots: [],
      unmatchedDistinctiveRoots: [],
      score: 0,
    };
  }

  const signalWords = businessSignals.flatMap(relevanceTokens);
  if (signalWords.length === 0) {
    return {
      eligible: false,
      matchedDistinctiveRoots: [],
      unmatchedDistinctiveRoots: [],
      score: 0,
    };
  }

  const keywordRoots = distinctiveRelevanceRoots(keywordWords);
  const signalRoots = distinctiveRelevanceRoots(signalWords);
  const matched = [...keywordRoots].filter((root) => signalRoots.has(root));
  const unmatched = [...keywordRoots].filter((root) => !signalRoots.has(root));

  if (keywordRoots.size === 0) {
    const aligned = genericOfferingAlignment(keywordWords, signalWords);
    return {
      eligible: aligned,
      matchedDistinctiveRoots: [],
      unmatchedDistinctiveRoots: [],
      score: aligned ? 70 : 0,
    };
  }

  const ratio = matched.length / keywordRoots.size;
  const eligible = keywordRoots.size === 1
    ? matched.length === 1
    : matched.length >= 2 || ratio > 0.5;
  const score = eligible
    ? Math.min(100, 55 + matched.length * 15 + Math.round(ratio * 15))
    : Math.min(49, matched.length * 20 + Math.round(ratio * 10));
  return {
    eligible,
    matchedDistinctiveRoots: matched,
    unmatchedDistinctiveRoots: unmatched,
    score,
  };
}

/**
 * Search volume alone is not business relevance. Require each discovered
 * keyword to share a specific product/problem signal with the site profile.
 * If a profile contains only generic terms (for example "AI sales agent"),
 * require two of those terms instead of allowing any single broad word.
 */
export function keywordMatchesBusinessSignals(
  keyword: string,
  businessSignals: string[],
): boolean {
  return businessSignalMatch(keyword, businessSignals).eligible;
}

const PROFESSIONAL_SERVICE_TERM = /\b(?:consulting|consultant|agency|firm)\b/i;
const PROFESSIONAL_SERVICE_QUERY =
  /(?:\b(?:hire|hiring|find|choose|best|top)\b.*\b(?:consultant|agency|firm|expert)\b|\b(?:consulting|consultant|agency|firm)\b\s*$|\b(?:consulting|consultant|agency|firm)\b.*\b(?:career|careers|course|courses|definition|job|jobs|meaning|role|roles|salary|training|what)\b)/i;

/**
 * A SaaS may serve consultants without being a consultancy. Keep product
 * queries such as "agency lead generation software", but reject queries whose
 * primary intent is to hire a service provider unless the tenant actually
 * describes itself as that kind of provider.
 */
export function keywordMatchesBusinessModel(
  keyword: string,
  siteSignals: string[],
): boolean {
  if (!PROFESSIONAL_SERVICE_QUERY.test(keyword.trim())) return true;
  return siteSignals.some((signal) => PROFESSIONAL_SERVICE_TERM.test(signal));
}

export const TOPIC_BUSINESS_FIT_VERSION = 2;

export type TopicBusinessFitEvaluation = {
  eligible: boolean;
  score: number;
  reasons: string[];
  version: number;
};

export function evaluateTopicBusinessFit(args: {
  keyword: string;
  label?: string;
  coreBusinessSignals: string[];
  businessModelSignals: string[];
  growthSeed?: string;
}): TopicBusinessFitEvaluation {
  const core = businessSignalMatch(args.keyword, args.coreBusinessSignals);
  const modelAligned = keywordMatchesBusinessModel(
    args.keyword,
    args.businessModelSignals,
  );
  // Titles naturally add framing words ("how to choose", "complete guide").
  // Validate that the measured query survives in the title, rather than
  // treating every editorial modifier in the title as a new business subject.
  const titleAligned = !args.label || keywordMatchesBusinessSignals(
    args.keyword,
    [args.label],
  );
  const growthAligned = !args.growthSeed || keywordMatchesBusinessSignals(
    args.keyword,
    [args.growthSeed],
  );
  const reasons: string[] = [];
  if (!core.eligible) {
    reasons.push(
      core.unmatchedDistinctiveRoots.length > 0
        ? `keyword introduces unsupported subject signals: ${core.unmatchedDistinctiveRoots.join(", ")}`
        : "keyword lacks a product-specific tenant signal",
    );
  }
  if (!modelAligned) reasons.push("search intent targets a different business model");
  if (!titleAligned) reasons.push("article title does not preserve the measured keyword intent");
  if (!growthAligned) reasons.push("support topic is not adjacent to its measured parent query");
  return {
    eligible: core.eligible && modelAligned && titleAligned && growthAligned,
    score: core.score,
    reasons,
    version: TOPIC_BUSINESS_FIT_VERSION,
  };
}

export function evergreenTopicLabel(
  label: string,
  currentYear = new Date().getUTCFullYear(),
): string {
  return label
    .replace(/\b20\d{2}\b/g, (year) =>
      Number(year) === currentYear ? year : "")
    .replace(/\s+([:;,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function pendingJobPriority(payload: unknown): number {
  const record = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : undefined;
  if (record?.publishOnly === true) return 3;
  if (record?.manual === true) return 2;
  if (record?.qualityRetry === true || record?.bufferFill === true) return 1;
  return 0;
}

/** A pending topic-plan must not strand an already-created article that needs
 * its bounded quality repair. Active article work still serializes all prose
 * mutations for the tenant. */
export function contentWorkBlocksQualityRecovery(
  jobs: Array<{ type: string }>,
  qualityRecoveryAvailable: boolean,
): boolean {
  if (jobs.length === 0) return false;
  if (jobs.some((job) => job.type === "article")) return true;
  return !qualityRecoveryAvailable;
}
