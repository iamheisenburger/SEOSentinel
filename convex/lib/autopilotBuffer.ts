import { PUBLICATION_AUDIT_VERSION } from "./publicationArtifact.ts";

export const MIN_APPROVED_BUFFER = 2;
export const TARGET_APPROVED_BUFFER = 3;
// Three passing candidates fill the target. Two additional candidates are the
// bounded replacement allowance when the strict gate quarantines work; this
// prevents two rejections from forcing a 24-hour empty-buffer dead zone.
export const MAX_QUALITY_REPLACEMENTS_PER_24H = 2;
export const MAX_NEW_CANDIDATES_PER_24H =
  TARGET_APPROVED_BUFFER + MAX_QUALITY_REPLACEMENTS_PER_24H;

export type BufferArticle = {
  status: string;
  publicationGateStatus?: string;
  publicationAuditVersion?: number;
  auditedContentHash?: string;
};

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
  const failClosedOutcomes = new Set([
    "migration_pending",
    "quality_budget_exhausted",
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
  const coveredTokens = new Set(coveredKeywords.flatMap(keywordTokens));
  return topics.find((topic) => {
    const tokens = keywordTokens(topic.primaryKeyword);
    const overlap = tokens.filter((token) => coveredTokens.has(token)).length;
    return tokens.length > 0 && overlap / tokens.length < maximumOverlap;
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
