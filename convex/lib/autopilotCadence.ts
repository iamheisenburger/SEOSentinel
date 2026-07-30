import { effectivePublishedAt } from "./autopilotBuffer.ts";

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
        now - article.createdAt < windowMs &&
        article.status === "review" &&
        article.publicationGateStatus === "blocked" &&
        (article.qualityRevisionCount ?? 0) < MAX_QUALITY_REVISIONS,
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
