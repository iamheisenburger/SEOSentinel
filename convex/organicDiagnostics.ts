import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { addSearchConsoleDays, isBrandedSearchQuery, publishedArticlePageUrl } from "./lib/searchPerformance";
import { articleMatchesCurrentDomain, gscConnectionMatchesCurrentDomain } from "./lib/siteDomainBinding";
import { takeCurrentGscPageRows, takeCurrentGscQueryRows } from "./lib/currentGscRows";

/** Read-only organic health snapshot for ONE site (operator diagnostics).
 * Aggregates only: no OAuth material, no other tenant, nothing written. */
export const snapshot = internalQuery({
  args: { siteId: v.id("sites"), days: v.optional(v.number()) },
  handler: async (ctx, { siteId, days }) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus) throw new Error("Site not found");
    const window = Math.max(28, Math.min(days ?? 90, 180));
    const through = site.gscDataThrough ?? null;

    // Published articles and Google's index verdicts (URL Inspection, recent cohort only).
    const summaries = (await ctx.db.query("article_summaries").withIndex("by_site_status", q => q.eq("siteId", siteId).eq("status", "published")).take(2001))
      .filter(row => articleMatchesCurrentDomain(site, row));
    const count = (values: (string | undefined)[]) => values.reduce<Record<string, number>>((acc, value) => {
      const key = value ?? "none"; acc[key] = (acc[key] ?? 0) + 1; return acc;
    }, {});
    const month = (at?: number) => at ? new Date(at).toISOString().slice(0, 7) : "unknown";
    const inspected = summaries.filter(row => row.gscInspectedAt);
    const notIndexed = inspected.filter(row => row.gscIndexVerdict && row.gscIndexVerdict !== "PASS")
      .slice(0, 25).map(row => ({ slug: row.slug, coverage: row.gscCoverageState ?? null, verdict: row.gscIndexVerdict ?? null,
        lastCrawl: row.gscLastCrawlTime ?? null, published: month(row.publishedAt) }));
    const articles = {
      published: summaries.length,
      liveVerified: summaries.filter(row => row.publicUrlStatus === "verified").length,
      byMonth: count(summaries.map(row => month(row.publishedAt ?? row.articleCreatedAt))),
      inspected: inspected.length,
      byVerdict: count(inspected.map(row => row.gscIndexVerdict)),
      byCoverage: count(inspected.map(row => row.gscCoverageState)),
      inspectionErrors: inspected.filter(row => row.gscInspectionError).length,
      crawledAtLeastOnce: inspected.filter(row => row.gscLastCrawlTime).length,
      notIndexedSample: notIndexed,
    };

    if (!gscConnectionMatchesCurrentDomain(site) || !through) {
      return { domain: site.domain, gscProperty: site.gscProperty ?? null, gscConnected: false, through, articles };
    }
    const start = addSearchConsoleDays(through, -(window - 1));
    const pages = await takeCurrentGscPageRows(ctx, site, 12_000, { startDate: start, endDate: through });
    const receiptDays = new Set((site.gscDateEpochs ?? []).filter(r => r.date >= start && r.date <= through).map(r => r.date)).size;
    const articleUrls = new Set(summaries.map(row => publishedArticlePageUrl(site.domain, site.urlStructure, row.slug)));
    const byPage = new Map<string, { impressions: number; clicks: number; weighted: number }>();
    const byWeek = new Map<string, { impressions: number; clicks: number }>();
    const buckets: Record<string, number> = { "1-3": 0, "4-10": 0, "11-20": 0, "21-50": 0, "51+": 0 };
    let impressions = 0, clicks = 0, nonBrandedImpressions = 0, nonBrandedClicks = 0;
    for (const row of pages.rows) {
      impressions += row.impressions; clicks += row.clicks;
      nonBrandedImpressions += row.nonBrandedImpressions; nonBrandedClicks += row.nonBrandedClicks;
      const page = byPage.get(row.page) ?? { impressions: 0, clicks: 0, weighted: 0 };
      page.impressions += row.impressions; page.clicks += row.clicks; page.weighted += row.weightedPosition;
      byPage.set(row.page, page);
      const weekStart = addSearchConsoleDays(row.date, -((new Date(`${row.date}T00:00:00Z`).getUTCDay() + 6) % 7));
      const week = byWeek.get(weekStart) ?? { impressions: 0, clicks: 0 };
      week.impressions += row.impressions; week.clicks += row.clicks; byWeek.set(weekStart, week);
      if (row.impressions > 0) {
        const position = row.weightedPosition / row.impressions;
        const bucket = position <= 3 ? "1-3" : position <= 10 ? "4-10" : position <= 20 ? "11-20" : position <= 50 ? "21-50" : "51+";
        buckets[bucket] += row.impressions;
      }
    }
    const pageList = [...byPage.entries()].map(([page, p]) => ({ page, impressions: p.impressions, clicks: p.clicks,
      position: p.impressions ? Math.round((p.weighted / p.impressions) * 10) / 10 : null, article: articleUrls.has(page) }));
    const queriesStart = addSearchConsoleDays(through, -27);
    const queries = await takeCurrentGscQueryRows(ctx, site, 12_000, { startDate: queriesStart, endDate: through });
    const byQuery = new Map<string, { impressions: number; clicks: number; weighted: number; pages: Set<string> }>();
    for (const row of queries.rows) {
      const q = byQuery.get(row.query) ?? { impressions: 0, clicks: 0, weighted: 0, pages: new Set<string>() };
      q.impressions += row.impressions; q.clicks += row.clicks; q.weighted += row.position * row.impressions;
      if (row.page) q.pages.add(row.page);
      byQuery.set(row.query, q);
    }
    const queryList = [...byQuery.entries()].map(([query, q]) => ({ query, impressions: q.impressions, clicks: q.clicks,
      position: q.impressions ? Math.round((q.weighted / q.impressions) * 10) / 10 : null, pages: q.pages.size,
      branded: isBrandedSearchQuery(query, site.domain) }));
    return {
      domain: site.domain, gscProperty: site.gscProperty ?? null, gscConnected: true, through,
      window: { start, days: window, receiptDays, pageRowsExhausted: pages.exhausted, queryRowsExhausted: queries.exhausted },
      totals: { impressions, clicks, nonBrandedImpressions, nonBrandedClicks },
      pages: {
        withImpressions: pageList.filter(p => p.impressions > 0).length,
        articlePagesWithImpressions: pageList.filter(p => p.article && p.impressions > 0).length,
        articlePagesWithClicks: pageList.filter(p => p.article && p.clicks > 0).length,
        impressionsByPosition: buckets,
        top: pageList.sort((a, b) => b.impressions - a.impressions).slice(0, 20),
      },
      weeks: [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, w]) => ({ week, ...w })),
      queries28: {
        distinct: queryList.length,
        withPositionUnder20: queryList.filter(q => q.position !== null && q.position <= 20).length,
        multiPageQueries: queryList.filter(q => q.pages > 1).length,
        top: queryList.sort((a, b) => b.impressions - a.impressions).slice(0, 25),
      },
      articles,
    };
  },
});
