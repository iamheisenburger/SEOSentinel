import { PUBLICATION_AUDIT_VERSION } from "./publicationArtifact.ts";

export const MIN_APPROVED_BUFFER = 2;
export const TARGET_APPROVED_BUFFER = 3;
// Three passing candidates fill the target. Two additional candidates are the
// bounded replacement allowance when the strict gate quarantines work; this
// prevents two rejections from forcing a 24-hour empty-buffer dead zone.
export const MAX_QUALITY_REPLACEMENTS_PER_24H = 2;
export const MAX_NEW_CANDIDATES_PER_24H =
  TARGET_APPROVED_BUFFER + MAX_QUALITY_REPLACEMENTS_PER_24H;

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
    "your", "that", "this", "from", "have", "will",
  ]);
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !stopWords.has(word));
}

export function selectNonCannibalizingTopic<T extends { primaryKeyword: string }>(
  topics: T[],
  coveredKeywords: string[],
  maximumOverlap = 0.35,
): T | undefined {
  const coveredTokenSets = coveredKeywords
    .map((keyword) => new Set(keywordTokens(keyword)))
    .filter((tokens) => tokens.size > 0);
  return topics.find((topic) => {
    const tokens = keywordTokens(topic.primaryKeyword);
    if (tokens.length === 0) return false;
    return coveredTokenSets.every((coveredTokens) => {
      const overlap = tokens.filter((token) => coveredTokens.has(token)).length;
      // One shared category word (for example "chatbot") is not evidence of
      // cannibalization. Requiring two shared meaningful tokens preserves
      // distinct long-tail intents while still blocking near-duplicates such
      // as "lead scoring model" and "automated lead scoring".
      if (overlap < 2) return true;
      return overlap / tokens.length < maximumOverlap;
    });
  });
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
