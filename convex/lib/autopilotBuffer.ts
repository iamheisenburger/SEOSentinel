import { PUBLICATION_AUDIT_VERSION } from "./publicationArtifact.ts";
import {
  articleReservesTopicIntent,
  type TopicReservationArticle,
} from "./topicLifecycle.ts";
import {
  AUTOMATIC_PLAN_MINIMUM_VERIFIED_YIELD,
  AUTOMATIC_PLAN_TOPIC_CAPACITY,
} from "./planProviderBudget.ts";
import { planCheckpointTopicExecutionLocked } from "./planCandidateCheckpoint.ts";

export const MIN_APPROVED_BUFFER = 2;
export const TARGET_APPROVED_BUFFER = 3;
export const BUFFER_PROVIDER_OUTAGE_HORIZON_HOURS = 72;
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

/**
 * Protect every configured cadence from a bounded three-day provider outage.
 * A flat three-article target protects a four-per-week tenant, but gives a
 * three-per-day tenant only one day of inventory. Scale the minimum with the
 * customer's own cadence and keep one additional publishing day as the fill
 * target. This changes inventory, never the quality gate.
 */
export function approvedBufferPolicy(cadencePerWeek: number): {
  minimum: number;
  target: number;
} {
  const boundedCadence = Number.isFinite(cadencePerWeek) && cadencePerWeek > 0
    ? Math.min(21, cadencePerWeek)
    : 4;
  const outageCoverage = Math.ceil(
    boundedCadence * BUFFER_PROVIDER_OUTAGE_HORIZON_HOURS / (7 * 24),
  );
  const onePublishingDay = Math.max(1, Math.ceil(boundedCadence / 7));
  const minimum = Math.max(MIN_APPROVED_BUFFER, outageCoverage);
  return {
    minimum,
    target: Math.max(TARGET_APPROVED_BUFFER, minimum + onePublishingDay),
  };
}

/**
 * Bound paid topic recovery to the tenant's configured publishing pressure.
 * A fixed two-plan allowance cannot sustain a tenant that publishes three
 * times a day, while giving every tenant an arbitrary large allowance would
 * hide a broken discovery loop and waste provider credits.
 */
export function topicReplenishmentBudget(cadencePerWeek: number): number {
  const dailyDemand = Number.isFinite(cadencePerWeek) && cadencePerWeek > 0
    ? Math.ceil(cadencePerWeek / 7)
    : 1;
  return Math.max(2, Math.min(8, dailyDemand + 2));
}

/**
 * Neither a warm nor live tenant is cadence-safe until the shared sealed
 * buffer minimum exists. Current inventory exhaustion describes only the
 * already-measured topic set; it must not terminate bounded fresh planning
 * while an active tenant lacks the outage buffer required to meet cadence.
 * Observe-mode tenants remain provider-free and fail closed.
 */
export function terminalOpportunityNeedsCadenceReplenishment(args: {
  rolloutMode: string;
  sealedBufferCount: number;
  minimumApprovedBuffer?: number;
}): boolean {
  return ["warm", "live"].includes(args.rolloutMode) &&
    args.sealedBufferCount <
      (args.minimumApprovedBuffer ?? MIN_APPROVED_BUFFER);
}

/**
 * The same authority ceiling must be used before and after strategist
 * selection. Otherwise low-volume keywords that can never pass the final gate
 * consume scarce strategist/SERP slots and make a healthy inventory look
 * exhausted.
 */
export function keywordDifficultyCeiling(
  maximumDifficulty: number,
  monthlySearchVolume: number,
): number {
  return monthlySearchVolume >= 1_000
    ? maximumDifficulty + 10
    : maximumDifficulty;
}

const DISCOVERY_SPLIT_PATTERN =
  /[,;:.|/]+|\b(?:and|or|but|because|despite|without|before|after|while|which|that|leading to|resulting in|due to|powered by|grounded in|integrated with|connected to)\b/gi;
const DISCOVERY_LEADING_NOISE = new Set([
  "a", "an", "the", "low", "lower", "poor", "weak", "high", "higher",
  "lack", "lacking", "inability", "unable", "difficulty", "difficult",
  "need", "needs", "needed", "no",
]);
const DISCOVERY_GLUE_WORDS = new Set([
  "a", "an", "the", "to", "of", "in", "on", "at", "as", "by", "from",
  "with", "is", "are", "was", "were", "be", "being", "been", "has",
  "have", "had", "can", "could", "would", "should",
]);

function normalizeDiscoveryPhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn the tenant's own long-form profile fields into bounded search phrases.
 * Profile inference often stores useful features and pain points as sentences;
 * the old six-word seed filter silently discarded them. This extractor is
 * deterministic and tenant-generic: it never invents a product or keyword and
 * every returned phrase remains traceable to configured/crawled tenant data.
 */
export function tenantDiscoveryAnchors(
  signals: Array<string | undefined>,
  limit = 40,
): string[] {
  if (limit <= 0) return [];
  const anchors: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    let words = normalizeDiscoveryPhrase(candidate).split(" ").filter(Boolean);
    while (words.length > 0 && DISCOVERY_LEADING_NOISE.has(words[0])) {
      words = words.slice(1);
    }
    const phrase = words.join(" ");
    if (words.length < 2 || words.length > 6 || seen.has(phrase)) return;
    seen.add(phrase);
    anchors.push(phrase);
  };

  for (const signal of signals) {
    if (!signal || anchors.length >= limit) continue;
    const normalized = normalizeDiscoveryPhrase(signal);
    const fullWords = normalized.split(" ").filter(Boolean);
    if (fullWords.length <= 6) add(normalized);

    const clauses = signal.split(DISCOVERY_SPLIT_PATTERN);
    for (const clause of clauses) {
      const normalizedClause = normalizeDiscoveryPhrase(clause);
      if (!normalizedClause) continue;
      add(normalizedClause);

      const meaningful = normalizedClause
        .split(" ")
        .filter((word) => !DISCOVERY_GLUE_WORDS.has(word));
      while (
        meaningful.length > 0 &&
        DISCOVERY_LEADING_NOISE.has(meaningful[0])
      ) {
        meaningful.shift();
      }
      if (meaningful.length >= 2) {
        add(meaningful.slice(0, 6).join(" "));
        if (meaningful.length > 6) add(meaningful.slice(-6).join(" "));
      }
      if (anchors.length >= limit) break;
    }
  }
  return anchors.slice(0, limit);
}

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

/**
 * How many candidates a tenant may generate in 24 hours.
 *
 * The flat allowance assumed a low cadence: three passing candidates plus two
 * replacements. A tenant publishing three articles a day must then clear the
 * strict gate on 60% of first attempts every single day, and a normal run of
 * quarantines exhausts the budget and misses cadence with an empty buffer.
 *
 * Scaling replacements with the tenant's own daily cadence keeps the bound
 * meaningful for slow tenants while giving fast ones enough attempts to
 * survive ordinary rejection rates. This does not weaken any quality gate; it
 * only stops a healthy tenant from running out of tries.
 */
export function autopilotCandidateBudget(
  rolloutMode: string,
  cadencePerWeek?: number,
): number {
  if (!["warm", "live"].includes(rolloutMode)) return 1;
  const cadence =
    Number.isFinite(cadencePerWeek) && (cadencePerWeek ?? 0) > 0
      ? (cadencePerWeek as number)
      : 4;
  const policy = approvedBufferPolicy(cadence);
  const dailyDemand = Math.max(1, Math.ceil(Math.min(21, cadence) / 7));
  // One bounded window must be capable of filling the cadence-specific target
  // even when an ordinary day's worth of candidates is quarantined. Otherwise
  // high-cadence tenants can be mathematically unable to reach the buffer that
  // protects their next deadline.
  return Math.max(
    MAX_NEW_CANDIDATES_PER_24H,
    policy.target + Math.max(MAX_QUALITY_REPLACEMENTS_PER_24H, dailyDemand),
  );
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

export type TopicCoverageArticle = TopicReservationArticle & {
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
  const reservingArticles = articles.filter(articleReservesTopicIntent);
  const usedTopicIds = new Set(
    reservingArticles
      .map((article) => article.topicId)
      .filter((topicId): topicId is string => Boolean(topicId)),
  );
  const canonical = topics
    .filter((topic) => usedTopicIds.has(topic._id))
    .map((topic) => topic.primaryKeyword);
  const legacy = reservingArticles
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
  const reservingArticles = articles.filter(articleReservesTopicIntent);
  const usedTopicIds = new Set(
    reservingArticles
      .map((article) => article.topicId)
      .filter((topicId): topicId is string => Boolean(topicId)),
  );
  const canonical = topics
    .filter((topic) => usedTopicIds.has(topic._id))
    .map((topic) => ({
      primaryKeyword: topic.primaryKeyword,
      serpTopUrls: topic.serpTopUrls,
    }));
  const legacy = reservingArticles
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

/** Bounded work per cadence pass: reclaiming inventory must never turn one
 * natural run into an unbounded rewrite of a large tenant's back catalogue. */
export const MAX_AUDIT_REFRESH_PER_PASS = 5;
export const DETERMINISTIC_INTERNAL_LINK_REPAIR_VERSION = 1;
const STRICT_INTERNAL_LINK_ISSUE =
  "Strict publication requires at least one internal link so the page joins a topic cluster.";

export type AuditRefreshArticle = BufferArticle & {
  publicationAttemptedAt?: number;
  publicationLeaseOwner?: string;
  publicationLeaseHash?: string;
  publicationAmbiguityDispositionAt?: number;
};

/**
 * Ready inventory stranded by an audit-version increment.
 *
 * When PUBLICATION_AUDIT_VERSION moves, an article sealed under the previous
 * version keeps status "ready" and gate "passed" but stops satisfying
 * isSealedReady. Nothing reclaimed it: the quality-revision and mechanical
 * repair paths only inspect articles in "review", so it counted toward no
 * buffer, blocked nothing, and was never re-audited — a customer's finished
 * work silently stopped existing.
 *
 * Re-evaluating strict publication quality is deterministic and costs no
 * provider call, so this is safe to run on the natural cadence path. The
 * article must not be mid-delivery or hold a reviewed external ambiguity;
 * those carry their own contract and must never be re-sealed underneath it.
 */
export function needsPublicationAuditRefresh(
  article: AuditRefreshArticle,
): boolean {
  return (
    article.status === "ready" &&
    article.publicationGateStatus === "passed" &&
    article.publicationAuditVersion !== PUBLICATION_AUDIT_VERSION &&
    !article.publicationAttemptedAt &&
    !article.publicationLeaseOwner &&
    !article.publicationLeaseHash &&
    !article.publicationAmbiguityDispositionAt
  );
}

/** One bounded, provider-free repair for an otherwise finished orphan page. */
export function needsDeterministicInternalLinkRepair(article: {
  status?: string;
  publicationGateStatus?: string;
  publicationGateIssues?: string[];
  deterministicInternalLinkRepairVersion?: number;
}): boolean {
  const issues = article.publicationGateIssues ?? [];
  return article.status === "review" &&
    article.publicationGateStatus === "blocked" &&
    (article.deterministicInternalLinkRepairVersion ?? 0) <
      DETERMINISTIC_INTERNAL_LINK_REPAIR_VERSION &&
    issues.length === 1 &&
    issues[0] === STRICT_INTERNAL_LINK_ISSUE;
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
  bufferMinimum?: number;
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
    args.bufferCount < (args.bufferMinimum ?? MIN_APPROVED_BUFFER)
  ) {
    return "quality_budget_exhausted";
  }
  const failClosedOutcomes = new Set([
    "migration_pending",
    "quota_reached",
    "site_limit_reached",
    "topic_replenishment_exhausted",
    "opportunity_space_exhausted",
    "planning_blocked",
    "topic_admission_blocked",
    "scheduler_state_conflict",
    "job_lease_exhausted",
    "rollout_observe",
    "rollout_conflict",
    "rollout_buffer_ready",
    "readiness_blocked",
  ]);
  if (args.lastOutcome && failClosedOutcomes.has(args.lastOutcome)) {
    return args.lastOutcome;
  }
  if (args.lastOutcome === "publication_failed") return "publication_failed";
  if (args.lastOutcome === "job_failed") return "job_failed";
  if (args.lastOutcome === "quality_quarantined") return "quality_quarantined";
  if (args.bufferCount === 0) return "buffer_empty";
  if (args.bufferCount < (args.bufferMinimum ?? MIN_APPROVED_BUFFER)) {
    return "buffer_low";
  }
  return "healthy";
}

// A red run outcome is historical evidence, not permanent tenant state. A
// newer strict, sealed buffer item proves recovery from content-generation,
// topic-replenishment, or quality failures. Destination/publication failures
// are deliberately not cleared by a buffered article because no external
// receipt has succeeded yet.
export function currentHealthOutcome(args: {
  lastOutcome?: string;
  lastOutcomeAt?: number;
  latestSealedAt?: number;
}): string | undefined {
  if (!args.lastOutcome) return undefined;
  const contentFailures = new Set([
    "job_failed",
    "job_lease_exhausted",
    "quality_quarantined",
    "quality_budget_exhausted",
    "topic_replenishment_exhausted",
    "planning_blocked",
    "topic_admission_blocked",
    "scheduler_state_conflict",
  ]);
  if (
    contentFailures.has(args.lastOutcome) &&
    (args.latestSealedAt ?? 0) > (args.lastOutcomeAt ?? Number.POSITIVE_INFINITY)
  ) {
    return undefined;
  }
  return args.lastOutcome;
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
  "saas",
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
  const suffixes: Array<[string, string]> = [
    ["izations", "ize"], ["ization", "ize"],
    ["cations", ""], ["cation", ""],
    ["tions", "t"], ["tion", "t"],
    ["sions", "s"], ["sion", "s"],
    ["ments", ""], ["ment", ""], ["ness", ""],
    ["ingly", ""], ["ing", ""], ["edly", ""], ["ies", "y"],
    ["ers", ""], ["ed", ""], ["er", ""], ["s", ""],
  ];
  for (const [suffix, replacement] of suffixes) {
    if (
      normalized.endsWith(suffix) &&
      normalized.length - suffix.length >= 4
    ) {
      normalized = `${normalized.slice(0, -suffix.length)}${replacement}`;
      break;
    }
  }
  if (normalized.endsWith("e") && normalized.length > 5) {
    normalized = normalized.slice(0, -1);
  }
  // Five-character truncation made unrelated words collide (for example,
  // "consultation" and "consuming" both became "consu"). Seven characters
  // still joins common inflections such as qualified/qualification after the
  // suffix pass, without turning a coincidental prefix into product evidence.
  return normalized.length >= 7 ? normalized.slice(0, 7) : normalized;
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

function distinctiveRelevanceRootSequence(words: string[]): string[] {
  return words
    .filter((word) =>
      !GENERIC_BUSINESS_SIGNAL_WORDS.has(word) &&
      !BUSINESS_QUERY_MODIFIER_WORDS.has(word)
    )
    .map(relevanceRoot);
}

function longestSharedContiguousRootRun(
  left: string[],
  right: string[],
): number {
  let longest = 0;
  for (let leftStart = 0; leftStart < left.length; leftStart += 1) {
    for (let rightStart = 0; rightStart < right.length; rightStart += 1) {
      let length = 0;
      while (
        leftStart + length < left.length &&
        rightStart + length < right.length &&
        left[leftStart + length] === right[rightStart + length]
      ) {
        length += 1;
      }
      longest = Math.max(longest, length);
    }
  }
  return longest;
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
  // A union across a profile—or scattered words in one long sentence—can
  // synthesize a product the tenant never described. Multi-concept targets
  // therefore need an ordered contiguous distinctive phrase in one actual
  // tenant signal. "Research quality in AI-generated content" cannot become
  // the unrelated product entity "research question generator".
  const keywordSequence = distinctiveRelevanceRootSequence(keywordWords);
  const cohesiveMatchedCount = businessSignals.reduce((highest, signal) => {
    const sequence = distinctiveRelevanceRootSequence(relevanceTokens(signal));
    return Math.max(
      highest,
      longestSharedContiguousRootRun(keywordSequence, sequence),
    );
  }, 0);
  const eligible = keywordRoots.size === 1
    ? matched.length === 1
    : matched.length >= 2 && ratio > 0.5 && cohesiveMatchedCount >= 2;
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

const PROFESSIONAL_SERVICE_TERM =
  /\b(?:consulting|consultant|agency|firm|professional services?|service provider)\b/i;
const PROFESSIONAL_SERVICE_QUERY =
  /(?:\b(?:hire|hiring|find|choose|best|top)\b.*\b(?:consultant|agency|firm|expert|professional services?|service provider)\b|\b(?:consulting|consultant|agency|firm|professional services?|service provider)\b\s*$|\b(?:consulting|consultant|agency|firm|professional services?|service provider)\b.*\b(?:career|careers|course|courses|definition|job|jobs|meaning|role|roles|salary|training|what)\b|\b(?:conversion rate optimization|lead generation|marketing|seo|search engine optimization|web design|software development)\s+services\b)/i;
const EDUCATION_PROVIDER_TERM =
  /\b(?:academy|college|course provider|education provider|e[-\s]?learning|learning management systems?|instructional design|school|training provider|university)\b/i;
const EDUCATION_QUERY =
  /\b(?:career|careers|certificate|certification|course|courses|degree|degrees|e[-\s]?learning|instructional design|job|jobs|learning management systems?|online learning|salary|salaries)\b|\btraining\s+(?:academy|course|courses|program|programs|provider)\b/i;

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
  const normalized = keyword.trim();
  if (
    PROFESSIONAL_SERVICE_QUERY.test(normalized) &&
    !siteSignals.some((signal) => PROFESSIONAL_SERVICE_TERM.test(signal))
  ) {
    return false;
  }
  if (
    EDUCATION_QUERY.test(normalized) &&
    !siteSignals.some((signal) => EDUCATION_PROVIDER_TERM.test(signal))
  ) {
    return false;
  }
  return true;
}

export const TOPIC_BUSINESS_FIT_VERSION = 9;

export type TopicBusinessFitEvaluation = {
  eligible: boolean;
  score: number;
  reasons: string[];
  version: number;
};

export type TenantTopicSignalSource = {
  niche?: string | null;
  blogTheme?: string | null;
  siteSummary?: string | null;
  targetAudienceSummary?: string | null;
  productUsage?: string | null;
  siteType?: string | null;
  anchorKeywords?: string[] | null;
  keyFeatures?: string[] | null;
  painPoints?: string[] | null;
};

/**
 * One canonical projection of a tenant profile into the deterministic topic
 * fit gate. Discovery, scheduling, generation and final review must all use
 * this projection; otherwise a topic can be accepted by one stage and
 * rejected by the next forever.
 */
export function tenantTopicBusinessSignals(site: TenantTopicSignalSource): {
  coreBusinessSignals: string[];
  productAnchorSignals: string[];
  businessModelSignals: string[];
} {
  const present = (value: string | null | undefined): value is string =>
    typeof value === "string" && value.trim().length > 0;
  return {
    coreBusinessSignals: [
      site.niche,
      site.blogTheme,
      site.siteSummary,
      site.targetAudienceSummary,
      site.productUsage,
      ...(site.anchorKeywords ?? []),
      ...(site.keyFeatures ?? []),
      ...(site.painPoints ?? []),
    ].filter(present),
    productAnchorSignals: [
      // Only explicit product phrases and capabilities may authorize a
      // target. Broad editorial themes and customer pain prose still inform
      // core relevance, but cannot turn adjacent intent into product intent.
      ...(site.anchorKeywords ?? []),
      ...(site.keyFeatures ?? []),
    ].filter(present),
    businessModelSignals: [
      site.siteType,
      site.niche,
      site.siteSummary,
    ].filter(present),
  };
}

const TERMINAL_TOPIC_FIT_ISSUE_MARKERS = [
  "does not align with both the configured business and the final article title",
  "failed the current tenant product-fit gate",
] as const;

/** Product-fit rejection changes the target, not the prose. Re-running a
 * quality revision cannot make that measured search intent relevant, so the
 * scheduler must quarantine it and move on to a different topic. */
export function hasTerminalTopicFitFailure(
  issues: string[] | null | undefined,
): boolean {
  return (issues ?? []).some((issue) =>
    TERMINAL_TOPIC_FIT_ISSUE_MARKERS.some((marker) => issue.includes(marker))
  );
}

export type TerminalTopicFitTopic = {
  _id: string;
  siteId: string;
  primaryKeyword: string;
  label?: string;
  status?: string;
  businessFitEligible?: boolean;
  planCheckpointTerminalFailureCode?: string;
};

export type TerminalTopicFitSettlement = {
  topicId: string;
  topicPatch: {
    status: "disqualified";
    businessFitEligible: false;
    businessFitScore: number;
    businessFitVersion: number;
    businessFitReasons: string[];
    businessFitCheckedAt: number;
    disqualifiedReason: string;
    updatedAt: number;
  };
};

/**
 * Decide whether a terminal publication-gate result must also quarantine the
 * linked topic.
 *
 * Both pre-generation admission gates score business fit against the topic's
 * stored label, but the final gate scores the generated article title, which
 * cannot exist before the model spend. A topic can therefore clear admission,
 * consume a paid generation, and fail terminally on title drift. Freezing only
 * the article leaves that intent schedulable, so the next cadence pass selects
 * it again and pays again — a loop no article-level guard can break.
 *
 * Pure, so the decision is provable without a database, and returned as one
 * patch so the caller settles the article and its exact topic in a single
 * transaction instead of leaving a partial state between two mutations.
 */
export function terminalTopicFitSettlement(args: {
  gateStatus: string;
  issues: string[];
  article: {
    siteId: string;
    title: string;
    status?: string;
    topicId?: string | null;
  };
  topic: TerminalTopicFitTopic | null | undefined;
  siteSignals: {
    coreBusinessSignals: string[];
    productAnchorSignals?: string[];
    businessModelSignals: string[];
  };
  checkedAt: number;
}): TerminalTopicFitSettlement | null {
  if (args.gateStatus !== "blocked") return null;
  if (!hasTerminalTopicFitFailure(args.issues)) return null;

  const topic = args.topic;
  if (!topic) return null;
  // The article must reference this exact topic, and both must belong to the
  // same tenant. A publication check may never reach across a site boundary.
  if (!args.article.topicId || String(args.article.topicId) !== String(topic._id)) {
    return null;
  }
  if (topic.siteId !== args.article.siteId) return null;
  // Published work is immutable here; it uses the audited refresh workflow.
  if (args.article.status === "published") return null;
  // A plan checkpoint owns the topic lifecycle and carries its own no-replay
  // tombstone. Never race it.
  if (planCheckpointTopicExecutionLocked(topic)) return null;
  // Already settled. Rewriting would churn the receipt and its timestamp.
  if (topic.status === "disqualified") return null;

  // Re-evaluate against the generated title so the persisted receipt states the
  // current reason, and so a topic that genuinely still fits the tenant is
  // never destroyed by a stale recorded issue.
  const fit = evaluateTopicBusinessFit({
    keyword: topic.primaryKeyword,
    label: args.article.title,
    ...args.siteSignals,
  });
  if (fit.eligible) return null;

  return {
    topicId: String(topic._id),
    topicPatch: {
      status: "disqualified",
      businessFitEligible: false,
      businessFitScore: fit.score,
      businessFitVersion: fit.version,
      businessFitReasons: fit.reasons,
      businessFitCheckedAt: args.checkedAt,
      disqualifiedReason: fit.reasons.join("; "),
      updatedAt: args.checkedAt,
    },
  };
}

/**
 * Modifiers that turn a buyer problem into a practitioner or research query.
 *
 * A tenant's product vocabulary matches the head term, so "intent detection
 * dataset" cleared product fit purely because "intent detection" is one of
 * LeadPilot's features. But the search intent is academic: it wants CLINC150
 * sample counts and F1 scores, not a way to qualify website visitors.
 *
 * LeadPilot proved the cost in production. Three articles were generated on
 * that keyword and the editorial reviewer rejected every one for the same
 * reason — "a research abstraction distant from LeadPilot's operational use
 * case", "could run under any domain", "factual accuracy on academic content
 * cannot offset zero product utility". The generator's prose was sound; one
 * draft was called ready for publication with strong educational value. It
 * still failed, because the only way to add product grounding to a dataset
 * survey is to assert something the first-party evidence cannot support, and
 * the claim audit correctly refuses that.
 *
 * Rejecting these at selection is cheaper and more honest than generating an
 * article that can only pass by inventing a product claim.
 */
const PRACTITIONER_INTENT_MODIFIERS = new Set([
  "dataset", "datasets", "corpus", "corpora", "benchmark", "benchmarks",
  "arxiv", "paper", "papers", "citation", "preprint", "thesis",
  "python", "pytorch", "tensorflow", "huggingface", "sklearn", "numpy",
  "github", "repo", "repository", "notebook", "colab",
  "algorithm", "architecture", "neural", "transformer", "embedding",
  "annotation", "labelled", "labeled", "training",
]);

/**
 * True when a keyword reads as a research or implementation query rather than
 * a buyer problem the tenant can honestly answer.
 */
export function hasPractitionerIntent(keyword: string): boolean {
  return relevanceTokens(keyword).some((word) =>
    PRACTITIONER_INTENT_MODIFIERS.has(word)
  );
}

export function evaluateTopicBusinessFit(args: {
  keyword: string;
  label?: string;
  coreBusinessSignals: string[];
  /**
   * Concise phrases that describe what the tenant actually sells or solves.
   * These are deliberately separate from broad crawl prose: a single word in
   * a long site summary must not authorize a detached search intent.
   */
  productAnchorSignals?: string[];
  businessModelSignals: string[];
  growthSeed?: string;
}): TopicBusinessFitEvaluation {
  const core = businessSignalMatch(args.keyword, args.coreBusinessSignals);
  const keywordWords = relevanceTokens(args.keyword);
  const keywordRoots = new Set(keywordWords.map(relevanceRoot));
  const anchorWords = (args.productAnchorSignals ?? []).flatMap(relevanceTokens);
  const anchorRoots = new Set(anchorWords.map(relevanceRoot));
  const sharedAnchorRoots = [...keywordRoots].filter((root) =>
    anchorRoots.has(root)
  );
  const matchedDistinctiveAnchorRoots = core.matchedDistinctiveRoots.filter(
    (root) => anchorRoots.has(root),
  );
  const anchorAligned = anchorWords.length === 0 || (
    matchedDistinctiveAnchorRoots.length >= 1 && sharedAnchorRoots.length >= 2
  ) || (
    distinctiveRelevanceRoots(keywordWords).size === 0 &&
    genericOfferingAlignment(keywordWords, anchorWords)
  );
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
  if (!anchorAligned) {
    reasons.push("keyword is not anchored to a specific tenant product or buyer problem");
  }
  const practitionerIntent = hasPractitionerIntent(args.keyword);
  if (practitionerIntent) {
    reasons.push(
      "keyword targets research or implementation intent rather than a buyer problem",
    );
  }
  if (!modelAligned) reasons.push("search intent targets a different business model");
  if (!titleAligned) reasons.push("article title does not preserve the measured keyword intent");
  if (!growthAligned) reasons.push("support topic is not adjacent to its measured parent query");
  return {
    eligible:
      core.eligible && anchorAligned && modelAligned && titleAligned &&
      growthAligned && !practitionerIntent,
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

export function isUnderfilledPlanContinuationPayload(
  payload: unknown,
): boolean {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const marker = record.underfilledPlanContinuation;
  if (!marker || typeof marker !== "object") return false;
  const receipt = marker as Record<string, unknown>;
  return Boolean(
    receipt.version === 1 &&
      Number.isInteger(receipt.firstExecutionCount) &&
      (receipt.firstExecutionCount as number) > 0 &&
      (receipt.firstExecutionCount as number) <
        AUTOMATIC_PLAN_MINIMUM_VERIFIED_YIELD &&
      Number.isInteger(receipt.remainingTopicCapacity) &&
      receipt.remainingTopicCapacity ===
        AUTOMATIC_PLAN_TOPIC_CAPACITY -
          (receipt.firstExecutionCount as number) &&
      Number.isFinite(receipt.queuedAt) &&
      record.manual !== true &&
      typeof record.reason === "string" &&
      record.reason.startsWith("topic_") &&
      record.growthParentArticleId === undefined &&
      record.growthSeed === undefined &&
      record.growthActionFingerprint === undefined &&
      record.expectedClickPlanMigrationVersion === undefined,
  );
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
