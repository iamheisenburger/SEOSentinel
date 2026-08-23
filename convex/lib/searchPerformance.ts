export function normalizeSearchConsolePage(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`,
    );
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${host}${path}`;
  } catch {
    return trimmed
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

export function isSameSearchConsolePage(candidate: string, target: string): boolean {
  return normalizeSearchConsolePage(candidate) === normalizeSearchConsolePage(target);
}

export function publishedArticlePageUrl(
  domain: string,
  urlStructure: string | undefined,
  slug: string,
): string {
  const rawDomain = domain.trim().replace(/\/+$/, "");
  const origin = new URL(
    /^[a-z][a-z0-9+.-]*:\/\//i.test(rawDomain)
      ? rawDomain
      : `https://${rawDomain}`,
  ).origin;
  const template = urlStructure?.trim() || "/blog/[slug]";
  const placeholderCount = template.match(/\[slug\]/gi)?.length ?? 0;
  if (!template.startsWith("/") || placeholderCount !== 1) {
    throw new Error("Article URL structure must contain one [slug] path segment");
  }
  const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, "");
  if (!cleanSlug) throw new Error("Article slug is required");
  return `${origin}${template.replace(/\[slug\]/i, cleanSlug)}`;
}

// Search Console dates are reported in Pacific Time. Converting publication
// timestamps through UTC can move an evening Pacific publication into the
// following day and make every 7/14/28/56-day checkpoint one day late.
export function searchConsoleDate(
  timestamp: number,
  timeZone = "America/Los_Angeles",
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export function addSearchConsoleDays(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Search Console date must use YYYY-MM-DD");
  }
  const value = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(value.getTime())) {
    throw new Error("Search Console date is invalid");
  }
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().split("T")[0];
}

export const GSC_INSPECTION_COHORT_DAYS = 56;
export const GSC_INSPECTION_COOLDOWN_MS = 20 * 60 * 60 * 1000;

export type GscInspectionQueueCandidate = {
  articleId: string;
  siteId: string;
  publishedAt: number;
  gscInspectedAt?: number;
  openIndexingIncidentPriority?: number;
};

export type GscGrowthAction = {
  siteId: string;
  status: string;
  stage: string;
  actionKind: string;
  indexState: string;
};

/**
 * Only an unresolved indexing problem may jump the ordinary inspection queue.
 * The explicit tenant comparison is a second boundary in addition to the
 * tenant-scoped database index used by the caller.
 */
export function isOpenIndexingIncident(
  action: GscGrowthAction,
  siteId: string,
): boolean {
  return action.siteId === siteId && action.status === "open" && (
    action.actionKind === "repair_discovery" ||
    action.actionKind === "repair_technical_indexing" ||
    action.stage === "indexing_stalled" ||
    action.indexState === "blocked"
  );
}

/**
 * Select a bounded, deterministic URL Inspection queue from the tenant's full
 * 56-day measurement cohort. New publications cannot monopolize the queue:
 * open indexing incidents lead, then never-inspected URLs, then the URLs with
 * the oldest inspection receipt. Older publications break ties so a steady
 * stream of new articles cannot strand a 14/28/56-day checkpoint.
 */
export function selectGscInspectionQueue<
  Candidate extends GscInspectionQueueCandidate,
>(
  candidates: readonly Candidate[],
  args: {
    siteId: string;
    now: number;
    limit?: number;
  },
): Candidate[] {
  const limit = Math.max(1, Math.min(args.limit ?? 20, 50));
  const cohortStart = args.now -
    GSC_INSPECTION_COHORT_DAYS * 24 * 60 * 60 * 1000;
  const inspectionDueBefore = args.now - GSC_INSPECTION_COOLDOWN_MS;

  return candidates
    .filter((candidate) =>
      candidate.siteId === args.siteId &&
      candidate.publishedAt >= cohortStart &&
      candidate.publishedAt <= args.now &&
      (
        candidate.gscInspectedAt === undefined ||
        candidate.gscInspectedAt <= inspectionDueBefore
      )
    )
    .sort((left, right) => {
      const leftHasIncident =
        left.openIndexingIncidentPriority !== undefined;
      const rightHasIncident =
        right.openIndexingIncidentPriority !== undefined;
      if (leftHasIncident !== rightHasIncident) {
        return leftHasIncident ? -1 : 1;
      }
      if (leftHasIncident && rightHasIncident) {
        const priorityDifference =
          (right.openIndexingIncidentPriority ?? 0) -
          (left.openIndexingIncidentPriority ?? 0);
        if (priorityDifference !== 0) return priorityDifference;
      }

      const leftNeverInspected = left.gscInspectedAt === undefined;
      const rightNeverInspected = right.gscInspectedAt === undefined;
      if (leftNeverInspected !== rightNeverInspected) {
        return leftNeverInspected ? -1 : 1;
      }
      const inspectionDifference =
        (left.gscInspectedAt ?? 0) - (right.gscInspectedAt ?? 0);
      if (inspectionDifference !== 0) return inspectionDifference;
      if (left.publishedAt !== right.publishedAt) {
        return left.publishedAt - right.publishedAt;
      }
      return String(left.articleId).localeCompare(String(right.articleId));
    })
    .slice(0, limit);
}

export type SearchPerformanceRow = {
  date: string;
  query: string;
  page?: string;
  clicks: number;
  impressions: number;
  position: number;
  syncedAt?: number;
  createdAt: number;
};

export type SearchPagePerformanceRow = {
  date: string;
  clicks: number;
  impressions: number;
  weightedPosition: number;
  nonBrandedClicks: number;
  nonBrandedImpressions: number;
  unattributedClicks?: number;
  unattributedImpressions?: number;
  queryCoverageComplete?: boolean;
  syncedAt: number;
};

export function summarizeSearchPagePerformance(
  rows: SearchPagePerformanceRow[],
) {
  const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const totalImpressions = rows.reduce(
    (sum, row) => sum + row.impressions,
    0,
  );
  const nonBrandedClicks = rows.reduce(
    (sum, row) => sum + row.nonBrandedClicks,
    0,
  );
  const nonBrandedImpressions = rows.reduce(
    (sum, row) => sum + row.nonBrandedImpressions,
    0,
  );
  const unattributedClicks = rows.reduce(
    (sum, row) => sum + (row.unattributedClicks ?? 0),
    0,
  );
  const unattributedImpressions = rows.reduce(
    (sum, row) => sum + (row.unattributedImpressions ?? 0),
    0,
  );
  const queryCoverageComplete = totalClicks === 0 && totalImpressions === 0
    ? true
    : rows.every((row) => row.queryCoverageComplete === true);
  return {
    totalClicks,
    totalImpressions,
    nonBrandedClicks,
    nonBrandedImpressions,
    unattributedClicks,
    unattributedImpressions,
    queryCoverageComplete,
    avgPosition: totalImpressions > 0
      ? Math.round((rows.reduce(
        (sum, row) => sum + row.weightedPosition,
        0,
      ) / totalImpressions) * 10) / 10
      : 0,
    avgCtr: totalImpressions > 0
      ? Math.round((totalClicks / totalImpressions) * 1000) / 10
      : 0,
    dataDays: new Set(rows.map((row) => row.date)).size,
    syncedAt: rows.length > 0
      ? Math.max(...rows.map((row) => row.syncedAt))
      : undefined,
  };
}

export function isBrandedSearchQuery(queryText: string, domain: string): boolean {
  const normalized = queryText.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedDomain = domain
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  const brand = normalizedDomain
    .split(".")[0]
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const compactQuery = normalized.replace(/\s+/g, "");
  const compactBrand = brand.replace(/\s+/g, "");
  return !!brand && (
    normalized.includes(brand) ||
    normalized.includes(normalizedDomain) ||
    (!!compactBrand && compactQuery.includes(compactBrand))
  );
}

/**
 * Summarize real daily Search Console rows over an explicit reporting window.
 * This deliberately does not call one day's values a lifetime "total".
 */
export function summarizeSearchPerformance(
  rows: SearchPerformanceRow[],
  domain: string,
) {
  const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const totalImpressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const brandedRows = rows.filter((row) =>
    isBrandedSearchQuery(row.query, domain)
  );
  const brandedClicks = brandedRows.reduce((sum, row) => sum + row.clicks, 0);
  const brandedImpressions = brandedRows.reduce(
    (sum, row) => sum + row.impressions,
    0,
  );
  const weightedPosition = totalImpressions > 0
    ? rows.reduce(
      (sum, row) => sum + row.position * row.impressions,
      0,
    ) / totalImpressions
    : 0;

  return {
    totalClicks,
    totalImpressions,
    nonBrandedClicks: totalClicks - brandedClicks,
    nonBrandedImpressions: totalImpressions - brandedImpressions,
    brandedClicks,
    brandedImpressions,
    avgPosition: Math.round(weightedPosition * 10) / 10,
    avgCtr: totalImpressions > 0
      ? Math.round((totalClicks / totalImpressions) * 1000) / 10
      : 0,
    queryCount: new Set(rows.map((row) => row.query)).size,
    dataDays: new Set(rows.map((row) => row.date)).size,
    syncedAt: rows.length > 0
      ? Math.max(...rows.map((row) => row.syncedAt ?? row.createdAt))
      : undefined,
  };
}

export function aggregateSearchQueries(rows: SearchPerformanceRow[]) {
  const byQuery = new Map<string, {
    query: string;
    clicks: number;
    impressions: number;
    weightedPosition: number;
    page?: string;
    pageImpressions: number;
  }>();
  for (const row of rows) {
    const current = byQuery.get(row.query) ?? {
      query: row.query,
      clicks: 0,
      impressions: 0,
      weightedPosition: 0,
      page: undefined,
      pageImpressions: -1,
    };
    current.clicks += row.clicks;
    current.impressions += row.impressions;
    current.weightedPosition += row.position * row.impressions;
    if (row.page && row.impressions > current.pageImpressions) {
      current.page = row.page;
      current.pageImpressions = row.impressions;
    }
    byQuery.set(row.query, current);
  }
  return [...byQuery.values()]
    .map((row) => ({
      query: row.query,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.impressions > 0 ? row.clicks / row.impressions : 0,
      position: row.impressions > 0
        ? Math.round((row.weightedPosition / row.impressions) * 10) / 10
        : 0,
      page: row.page,
    }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}
