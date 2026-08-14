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
  return !!brand && (
    normalized.includes(brand) ||
    normalized.includes(normalizedDomain)
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
