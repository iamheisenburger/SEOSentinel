import { addSearchConsoleDays } from "./searchPerformance.ts";

export const DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL = 100;

export type SeoWindow = {
  days: number;
  complete: boolean;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  nonBrandedClicks: number;
  nonBrandedImpressions: number;
  nonBrandedCtr: number;
  nonBrandedPosition: number | null;
};

export type SeoGrowthInput = {
  articleId: string;
  startDate: string;
  dataThrough?: string;
  indexInspection: {
    verdict?: string;
    coverageState?: string;
    pageFetchState?: string;
    robotsTxtState?: string;
    error?: string;
  };
  windows: SeoWindow[];
};

export type SeoGrowthStage =
  | "awaiting_data"
  | "indexing_pending"
  | "indexing_stalled"
  | "no_visibility"
  | "low_visibility"
  | "striking_distance"
  | "low_ctr"
  | "performing";

export type SeoGrowthActionKind =
  | "observe"
  | "repair_technical_indexing"
  | "repair_discovery"
  | "strengthen_cluster"
  | "reassess_opportunity"
  | "improve_snippet"
  | "build_authority";

export type SeoGrowthClassification = {
  articleId: string;
  stage: SeoGrowthStage;
  actionKind: SeoGrowthActionKind;
  priority: number;
  reason: string;
  indexState: "indexed" | "not_indexed" | "blocked" | "unknown";
  nextReviewDate?: string;
  evidence: {
    dataThrough?: string;
    windowDays?: number;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number | null;
    nonBrandedClicks: number;
    nonBrandedImpressions: number;
    nonBrandedCtr: number;
    nonBrandedPosition: number | null;
    indexVerdict?: string;
    coverageState?: string;
    pageFetchState?: string;
    robotsTxtState?: string;
  };
};

function normalized(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

export function inspectedIndexState(
  inspection: SeoGrowthInput["indexInspection"],
): SeoGrowthClassification["indexState"] {
  const verdict = normalized(inspection.verdict);
  const coverage = normalized(inspection.coverageState);
  const fetchState = normalized(inspection.pageFetchState);
  const robots = normalized(inspection.robotsTxtState);
  if (
    robots.includes("disallow") ||
    fetchState.includes("blocked") ||
    fetchState.includes("error") ||
    coverage.includes("blocked by robots")
  ) {
    return "blocked";
  }
  if (
    verdict === "pass" ||
    (coverage.includes("indexed") && !coverage.includes("not indexed"))
  ) {
    return "indexed";
  }
  if (
    verdict === "fail" ||
    verdict === "neutral" ||
    coverage.includes("not indexed") ||
    coverage.includes("discovered") ||
    coverage.includes("crawled - currently")
  ) {
    return "not_indexed";
  }
  return "unknown";
}

function nextReviewDate(input: SeoGrowthInput, days: number): string | undefined {
  return input.dataThrough
    ? addSearchConsoleDays(input.dataThrough, days)
    : undefined;
}

function result(
  input: SeoGrowthInput,
  stage: SeoGrowthStage,
  actionKind: SeoGrowthActionKind,
  priority: number,
  reason: string,
  indexState: SeoGrowthClassification["indexState"],
  window?: SeoWindow,
  reviewDays = 7,
): SeoGrowthClassification {
  return {
    articleId: input.articleId,
    stage,
    actionKind,
    priority,
    reason,
    indexState,
    nextReviewDate: nextReviewDate(input, reviewDays),
    evidence: {
      dataThrough: input.dataThrough,
      windowDays: window?.days,
      clicks: window?.clicks ?? 0,
      impressions: window?.impressions ?? 0,
      ctr: window?.ctr ?? 0,
      position: window?.position ?? null,
      nonBrandedClicks: window?.nonBrandedClicks ?? 0,
      nonBrandedImpressions: window?.nonBrandedImpressions ?? 0,
      nonBrandedCtr: window?.nonBrandedCtr ?? 0,
      nonBrandedPosition: window?.nonBrandedPosition ?? null,
      indexVerdict: input.indexInspection.verdict,
      coverageState: input.indexInspection.coverageState,
      pageFetchState: input.indexInspection.pageFetchState,
      robotsTxtState: input.indexInspection.robotsTxtState,
    },
  };
}

/**
 * Convert measured GSC/index evidence into one conservative next action.
 * A young page is never labelled a failure, and a page with no evidence never
 * triggers speculative content or outreach.
 */
export function classifySeoGrowth(
  input: SeoGrowthInput,
): SeoGrowthClassification {
  const complete = [...input.windows]
    .filter((window) => window.complete)
    .sort((a, b) => b.days - a.days);
  const window = complete[0];
  let indexState = inspectedIndexState(input.indexInspection);
  if (
    indexState === "unknown" &&
    input.windows.some((candidate) => candidate.impressions > 0)
  ) {
    indexState = "indexed";
  }

  if (indexState === "blocked") {
    return result(
      input,
      "indexing_stalled",
      "repair_technical_indexing",
      100,
      "Google reports a robots, fetch, or technical indexing block.",
      indexState,
      window,
      1,
    );
  }

  const completed14 = complete.find((candidate) => candidate.days >= 14);
  if (indexState === "not_indexed" && completed14) {
    return result(
      input,
      "indexing_stalled",
      "repair_discovery",
      95,
      "The URL remains outside the index after a complete 14-day observation window.",
      indexState,
      completed14,
      3,
    );
  }

  if (!window) {
    return result(
      input,
      indexState === "not_indexed" ? "indexing_pending" : "awaiting_data",
      "observe",
      10,
      "The page has not completed its first seven-day Search Console window.",
      indexState,
      undefined,
      3,
    );
  }

  if (window.nonBrandedClicks >= 3 || window.clicks >= 5) {
    return result(
      input,
      "performing",
      "observe",
      20,
      "The page is already earning measured organic clicks; preserve it and monitor the next checkpoint.",
      indexState,
      window,
      14,
    );
  }

  if (window.days >= 28 && window.nonBrandedImpressions === 0) {
    return result(
      input,
      "no_visibility",
      "reassess_opportunity",
      90,
      "A complete 28-day cohort produced no non-branded impressions, so the keyword, intent, or competitive fit must be revalidated.",
      indexState,
      window,
      7,
    );
  }

  if (window.days >= 14 && window.nonBrandedImpressions === 0) {
    return result(
      input,
      "no_visibility",
      "strengthen_cluster",
      75,
      "The indexed page has no non-branded visibility after 14 days and needs stronger crawl paths and topical support.",
      indexState,
      window,
      7,
    );
  }

  const position = window.nonBrandedPosition ?? window.position;
  const impressions = window.nonBrandedImpressions || window.impressions;
  const ctr = window.nonBrandedImpressions > 0
    ? window.nonBrandedCtr
    : window.ctr;

  if (
    window.days >= 28 &&
    impressions >= 50 &&
    position !== null &&
    position <= 10 &&
    ctr < 0.015
  ) {
    return result(
      input,
      "low_ctr",
      "improve_snippet",
      85,
      "The page ranks on page one but earns under 1.5% CTR across at least 50 impressions.",
      indexState,
      window,
      7,
    );
  }

  if (position !== null && position >= 4 && position <= 20) {
    if (window.days >= 56) {
      return result(
        input,
        "striking_distance",
        "build_authority",
        82,
        "The page has remained within positions 4-20 through 56 days; on-site support alone has had time to work, so verified authority opportunities are now appropriate.",
        indexState,
        window,
        14,
      );
    }
    return result(
      input,
      "striking_distance",
      "strengthen_cluster",
      80,
      "The page is within positions 4-20, where stronger internal support and authority can plausibly move it into click-producing rankings.",
      indexState,
      window,
      7,
    );
  }

  if (window.days >= 28 && position !== null && position > 20) {
    return result(
      input,
      "low_visibility",
      "reassess_opportunity",
      70,
      "The page has impressions but remains below position 20 after 28 days; intent and attainable SERP fit need revalidation before more content is produced.",
      indexState,
      window,
      7,
    );
  }

  return result(
    input,
    "low_visibility",
    "observe",
    30,
    "The page has early search visibility but not enough mature evidence for an autonomous intervention.",
    indexState,
    window,
    7,
  );
}

export function growthActionFingerprint(
  siteId: string,
  classification: { articleId: string; stage: string; actionKind: string },
): string {
  return [
    siteId,
    classification.articleId,
    classification.stage,
    classification.actionKind,
  ].join(":");
}
