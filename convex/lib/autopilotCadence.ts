import {
  effectivePublishedAt,
  hasTerminalTopicFitFailure,
} from "./autopilotBuffer.ts";

export type CadenceArticle = {
  _id?: string;
  createdAt: number;
  publishedAt?: number;
  publicationAuditVersion?: number;
  auditedContentHash?: string;
  status?: string;
  publicationGateStatus?: string;
  publicationGateIssues?: string[];
  qualityRevisionCount?: number;
  qualityRecoveryVersion?: number;
  qualityRecoveryAttemptVersion?: number;
};

export type CadenceWindow = {
  canGenerate: boolean;
  recentAttempts: number;
  hasRecentPublication: boolean;
  recoveryArticleId?: string;
  recoveryRevisionCount?: number;
};

export const MAX_CADENCE_CANDIDATES = 2;
export const MAX_QUALITY_REVISIONS = 2;
export const QUALITY_RECOVERY_VERSION = 1;
// Immutable deployment boundary for the first recovery algorithm. Jobs queued
// by that release did not yet carry an explicit recovery version, so this lets
// the durable queue settle those attempts without replaying provider work.
export const QUALITY_RECOVERY_VERSION_INTRODUCED_AT = 1_788_048_939_388;

export type QualityRecoveryAttemptJob = {
  createdAt: number;
  payload?: unknown;
};

export function qualityRecoveryAttemptVersionFromJob(
  job: QualityRecoveryAttemptJob,
): number {
  const payload = job.payload && typeof job.payload === "object"
    ? job.payload as Record<string, unknown>
    : {};
  if (
    payload.qualityRetry !== true ||
    payload.metadataOnlyRepair === true ||
    payload.deterministicRepair === true
  ) {
    return 0;
  }
  if (
    typeof payload.qualityRecoveryVersion === "number" &&
    Number.isInteger(payload.qualityRecoveryVersion) &&
    payload.qualityRecoveryVersion > 0
  ) {
    return payload.qualityRecoveryVersion;
  }
  return job.createdAt >= QUALITY_RECOVERY_VERSION_INTRODUCED_AT ? 1 : 0;
}

export function hasAttemptedVersionedQualityRecovery(
  jobs: QualityRecoveryAttemptJob[],
  articleId: string,
  version = QUALITY_RECOVERY_VERSION,
): boolean {
  return jobs.some((job) => {
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    return (
      payload.articleId === articleId &&
      qualityRecoveryAttemptVersionFromJob(job) >= version
    );
  });
}

const VERSIONED_MEDIA_RECOVERY_ISSUES = new Set([
  "Strict publication requires a completed media-quality review.",
  "Strict publication requires a reviewed HTTPS hero image.",
  "A product-specific section requires validated first-party visual evidence.",
]);

const DETERMINISTIC_METADATA_ISSUES = new Set([
  "Meta description must end as a complete sentence.",
  "Meta description ends with a dangling or incomplete phrase.",
]);
const DETERMINISTIC_STRUCTURE_ISSUE_PATTERN =
  /^Structured introduction near line \d+ promises a list or table but none follows\.$/;

export function needsDeterministicMechanicalRepair(
  article: CadenceArticle,
): boolean {
  const issues = article.publicationGateIssues ?? [];
  return (
    article.status === "review" &&
    article.publicationGateStatus === "blocked" &&
    (article.qualityRevisionCount ?? 0) >= MAX_QUALITY_REVISIONS &&
    issues.length > 0 &&
    issues.every(
      (issue) =>
        DETERMINISTIC_METADATA_ISSUES.has(issue) ||
        DETERMINISTIC_STRUCTURE_ISSUE_PATTERN.test(issue),
    )
  );
}

/**
 * A bounded quality budget must not strand drafts that exhausted their retries
 * under an older recovery algorithm. One pass is admitted for a known media
 * defect after the recovery version changes; recording the current version on
 * every new review makes the allowance one-shot and prevents retry loops.
 */
export function needsVersionedQualityRecovery(
  article: CadenceArticle,
): boolean {
  const issues = article.publicationGateIssues ?? [];
  return (
    article.status === "review" &&
    article.publicationGateStatus === "blocked" &&
    (article.qualityRevisionCount ?? 0) >= MAX_QUALITY_REVISIONS &&
    (article.qualityRecoveryVersion ?? 0) < QUALITY_RECOVERY_VERSION &&
    (article.qualityRecoveryAttemptVersion ?? 0) < QUALITY_RECOVERY_VERSION &&
    issues.some((issue) => VERSIONED_MEDIA_RECOVERY_ISSUES.has(issue))
  );
}

/**
 * Return whether the scheduler has quality recovery work that must take
 * priority over new article generation. Keep admission paths that can create
 * new work on this shared predicate so they cannot race or spend ahead of a
 * recoverable draft.
 */
export function hasRecoverableQualityWork(
  articles: CadenceArticle[],
  candidateWindowStart: number,
): boolean {
  return articles.some((article) =>
    (article.status === "review" &&
      article.publicationGateStatus === "blocked" &&
      !hasTerminalTopicFitFailure(article.publicationGateIssues) &&
      ((article.createdAt >= candidateWindowStart &&
        (article.qualityRevisionCount ?? 0) < MAX_QUALITY_REVISIONS) ||
        needsVersionedQualityRecovery(article))) ||
    needsDeterministicMechanicalRepair(article)
  );
}

export function findRecoverableQualityArticle(
  articles: CadenceArticle[],
  now: number,
  hoursPerArticle: number,
): CadenceArticle | undefined {
  const windowMs = Math.max(1, hoursPerArticle) * 60 * 60 * 1000;
  return articles
    .filter(
      (article) =>
        article._id &&
        article.createdAt <= now &&
        article.status === "review" &&
        article.publicationGateStatus === "blocked" &&
        ((now - article.createdAt < windowMs &&
          (article.qualityRevisionCount ?? 0) < MAX_QUALITY_REVISIONS) ||
          needsVersionedQualityRecovery(article)),
    )
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

export function evaluateCadenceWindow({
  articles,
  now,
  hoursPerArticle,
  maxAttempts,
}: {
  articles: CadenceArticle[];
  now: number;
  hoursPerArticle: number;
  maxAttempts: number;
}): CadenceWindow {
  const windowMs = Math.max(1, hoursPerArticle) * 60 * 60 * 1000;
  const recent = articles.filter(
    (article) =>
      article.createdAt <= now && now - article.createdAt < windowMs,
  );
  const hasRecentPublication = articles.some(
    (article) =>
      article.status === "published" &&
      effectivePublishedAt(article) <= now &&
      now - effectivePublishedAt(article) < windowMs,
  );
  const recovery = hasRecentPublication
    ? undefined
    : findRecoverableQualityArticle(articles, now, hoursPerArticle);

  return {
    canGenerate:
      !hasRecentPublication &&
      !recovery &&
      recent.length < Math.max(1, maxAttempts),
    recentAttempts: recent.length,
    hasRecentPublication,
    recoveryArticleId: recovery?._id,
    recoveryRevisionCount: recovery?.qualityRevisionCount,
  };
}
