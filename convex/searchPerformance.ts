import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  addSearchConsoleDays,
  aggregateSearchQueries,
  isBrandedSearchQuery,
  isSameSearchConsolePage,
  publishedArticlePageUrl,
  searchConsoleDate,
  summarizeSearchPerformance,
} from "./lib/searchPerformance";
import { effectivePublishedAt } from "./lib/autopilotBuffer";
import { v } from "convex/values";

const DAILY_SYNC_VERSION = 2;
const SEO_WINDOWS_DAYS = [7, 14, 28, 56] as const;

async function requireSiteOwner(ctx: QueryCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId);
  const identity = await ctx.auth.getUserIdentity();
  if (!site?.userId || !identity || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site's search performance");
  }
  return site;
}

// Upsert a search performance record (avoids duplicates for same site+date+query)
export const upsert = internalMutation({
  args: {
    siteId: v.id("sites"),
    date: v.string(),
    query: v.string(),
    page: v.optional(v.string()),
    clicks: v.number(),
    impressions: v.number(),
    ctr: v.number(),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("search_performance")
      .withIndex("by_site_date_query", (q) =>
        q.eq("siteId", args.siteId).eq("date", args.date).eq("query", args.query),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        clicks: args.clicks,
        impressions: args.impressions,
        ctr: args.ctr,
        position: args.position,
        page: args.page,
      });
      return existing._id;
    }

    // Insert new record
    return await ctx.db.insert("search_performance", {
      siteId: args.siteId,
      date: args.date,
      query: args.query,
      page: args.page,
      clicks: args.clicks,
      impressions: args.impressions,
      ctr: args.ctr,
      position: args.position,
      createdAt: Date.now(),
    });
  },
});

// Save one daily GSC response in a single Convex mutation. Version 2 keeps
// actual date+query+page rows separate from the legacy rolling-window
// snapshots so article-level trends remain attributable.
export const upsertBatch = internalMutation({
  args: {
    siteId: v.id("sites"),
    rows: v.array(v.object({
      date: v.string(),
      query: v.string(),
      page: v.optional(v.string()),
      clicks: v.number(),
      impressions: v.number(),
      ctr: v.number(),
      position: v.number(),
    })),
  },
  handler: async (ctx, { siteId, rows }) => {
    let inserted = 0;
    let updated = 0;
    const syncedAt = Date.now();

    for (const row of rows) {
      const existing = await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date_query_page", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .eq("date", row.date)
            .eq("query", row.query)
            .eq("page", row.page),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
          syncedAt,
        });
        updated++;
      } else {
        await ctx.db.insert("search_performance", {
          siteId,
          ...row,
          syncVersion: DAILY_SYNC_VERSION,
          syncedAt,
          createdAt: syncedAt,
        });
        inserted++;
      }
    }

    return { inserted, updated, saved: rows.length };
  },
});

export const upsertPageBatch = internalMutation({
  args: {
    siteId: v.id("sites"),
    rows: v.array(v.object({
      date: v.string(),
      page: v.string(),
      clicks: v.number(),
      impressions: v.number(),
      weightedPosition: v.number(),
      nonBrandedClicks: v.number(),
      nonBrandedImpressions: v.number(),
      nonBrandedWeightedPosition: v.number(),
    })),
  },
  handler: async (ctx, { siteId, rows }) => {
    const syncedAt = Date.now();
    let inserted = 0;
    let updated = 0;
    for (const row of rows) {
      const existing = await ctx.db
        .query("search_page_daily")
        .withIndex("by_site_date_page", (q) =>
          q.eq("siteId", siteId).eq("date", row.date).eq("page", row.page),
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { ...row, syncedAt });
        updated++;
      } else {
        await ctx.db.insert("search_page_daily", {
          siteId,
          ...row,
          syncedAt,
          createdAt: syncedAt,
        });
        inserted++;
      }
    }
    return { inserted, updated, saved: rows.length };
  },
});

// Get top queries over the same honest 28-day window as the summary.
export const getTopQueries = query({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }) => {
    await requireSiteOwner(ctx, siteId);
    const latestDaily = await ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", siteId).eq("syncVersion", DAILY_SYNC_VERSION),
      )
      .order("desc")
      .first();
    const latest = latestDaily ?? await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) => q.eq("siteId", siteId))
      .order("desc")
      .first();
    if (!latest) return [];

    const windowStart = addSearchConsoleDays(latest.date, -27);
    const recent = latestDaily
      ? await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .gte("date", windowStart)
            .lte("date", latest.date),
        )
        .collect()
      : await ctx.db
        .query("search_performance")
        .withIndex("by_site_date", (q) =>
          q.eq("siteId", siteId).eq("date", latest.date),
        )
        .collect();

    return latestDaily
      ? aggregateSearchQueries(recent).slice(0, limit ?? 20)
      : recent
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .slice(0, limit ?? 20);
  },
});

// Get performance summary for a site
export const getSummary = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const latestDaily = await ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", siteId).eq("syncVersion", DAILY_SYNC_VERSION),
      )
      .order("desc")
      .first();
    const latest = latestDaily ?? await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) => q.eq("siteId", siteId))
      .order("desc")
      .first();
    if (!latest) return null;

    const windowStart = addSearchConsoleDays(latest.date, -27);
    const recent = latestDaily
      ? await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .gte("date", windowStart)
            .lte("date", latest.date),
        )
        .collect()
      : await ctx.db
        .query("search_performance")
        .withIndex("by_site_date", (q) =>
          q.eq("siteId", siteId).eq("date", latest.date),
        )
        .collect();

    const summary = summarizeSearchPerformance(recent, site.domain);

    return {
      ...summary,
      lastSync: latest.date,
      dataThrough: latest.date,
      windowStart: latestDaily ? windowStart : undefined,
      windowDays: latestDaily ? 28 : undefined,
      syncVersion: latestDaily?.syncVersion ?? 1,
    };
  },
});

// Get performance data for a specific article/page URL
export const getByPage = query({
  args: { siteId: v.id("sites"), pageUrl: v.string() },
  handler: async (ctx, { siteId, pageUrl }) => {
    await requireSiteOwner(ctx, siteId);
    const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const hasDailyRows = await ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", siteId).eq("syncVersion", DAILY_SYNC_VERSION),
      )
      .first();
    const all = hasDailyRows
      ? await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .gte("date", cutoff),
        )
        .collect()
      : await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) =>
        q.eq("siteId", siteId).gte("date", cutoff),
      )
      .collect();

    return all.filter((r) => {
      if (!r.page) return false;
      return isSameSearchConsolePage(r.page, pageUrl);
    });
  },
});

async function articleSeoScorecard(
  ctx: QueryCtx,
  articleId: Id<"articles">,
) {
  const article = await ctx.db.get(articleId);
  if (!article) throw new Error("Article not found");
  if (article.status !== "published") {
    throw new Error("SEO scorecards require a published article");
  }
  const site = await ctx.db.get(article.siteId);
  if (!site) throw new Error("Site not found");

  const publicationTime = effectivePublishedAt(article);
  const startDate = searchConsoleDate(publicationTime);
  const maximumEndDate = addSearchConsoleDays(startDate, 55);
  const [latest, rows] = await Promise.all([
    ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", article.siteId).eq("syncVersion", DAILY_SYNC_VERSION),
      )
      .order("desc")
      .first(),
    ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q
          .eq("siteId", article.siteId)
          .eq("syncVersion", DAILY_SYNC_VERSION)
          .gte("date", startDate)
          .lte("date", maximumEndDate),
      )
      .collect(),
  ]);

  const pageUrl = publishedArticlePageUrl(
    site.domain,
    site.urlStructure,
    article.slug,
  );
  const pageRows = rows.filter(
    (row) => !!row.page && isSameSearchConsolePage(row.page, pageUrl),
  );
  const dataThrough = latest?.date;

  const windows = SEO_WINDOWS_DAYS.map((days) => {
    const expectedEndDate = addSearchConsoleDays(startDate, days - 1);
    const available = pageRows.filter((row) => row.date <= expectedEndDate);
    const clicks = available.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = available.reduce((sum, row) => sum + row.impressions, 0);
    const nonBranded = available.filter(
      (row) => !isBrandedSearchQuery(row.query, site.domain),
    );
    const nonBrandedClicks = nonBranded.reduce((sum, row) => sum + row.clicks, 0);
    const nonBrandedImpressions = nonBranded.reduce(
      (sum, row) => sum + row.impressions,
      0,
    );
    const position = impressions > 0
      ? available.reduce(
        (sum, row) => sum + row.position * row.impressions,
        0,
      ) / impressions
      : null;
    const nonBrandedPosition = nonBrandedImpressions > 0
      ? nonBranded.reduce(
        (sum, row) => sum + row.position * row.impressions,
        0,
      ) / nonBrandedImpressions
      : null;
    const topQueries = [...available]
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, 10)
      .map((row) => ({
        query: row.query,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        branded: isBrandedSearchQuery(row.query, site.domain),
      }));
    return {
      days,
      expectedEndDate,
      complete: !!dataThrough && dataThrough >= expectedEndDate,
      status: !dataThrough || dataThrough < startDate
        ? "awaiting_data"
        : dataThrough < expectedEndDate
          ? "collecting"
          : impressions > 0
            ? "measured"
            : "no_search_visibility",
      clicks,
      impressions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      position: position === null ? null : Math.round(position * 10) / 10,
      nonBrandedClicks,
      nonBrandedImpressions,
      nonBrandedCtr: nonBrandedImpressions > 0
        ? nonBrandedClicks / nonBrandedImpressions
        : 0,
      nonBrandedPosition: nonBrandedPosition === null
        ? null
        : Math.round(nonBrandedPosition * 10) / 10,
      queryCount: new Set(available.map((row) => row.query)).size,
      topQueries,
    };
  });

  return {
    articleId,
    title: article.title,
    pageUrl,
    publishedAt: publicationTime,
    recordedPublishedAt: article.publishedAt,
    startDate,
    dataThrough,
    syncVersion: DAILY_SYNC_VERSION,
    indexInspection: {
      verdict: article.gscIndexVerdict,
      coverageState: article.gscCoverageState,
      pageFetchState: article.gscPageFetchState,
      robotsTxtState: article.gscRobotsTxtState,
      lastCrawlTime: article.gscLastCrawlTime,
      inspectedAt: article.gscInspectedAt,
      error: article.gscInspectionError,
    },
    windows,
  };
}

// Traffic is the outcome metric. These fixed post-publication windows prevent
// a young article from being compared with an older article's longer exposure.
export const getArticleSeoScorecard = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    await requireSiteOwner(ctx, article.siteId);
    return articleSeoScorecard(ctx, articleId);
  },
});

export const getArticleSeoScorecardInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => articleSeoScorecard(ctx, articleId),
});

export const listPublishedForInspection = internalQuery({
  args: {
    siteId: v.id("sites"),
    publishedAfter: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { siteId, publishedAfter, limit }) => {
    const articles = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_status_published", (q) =>
        q
          .eq("siteId", siteId)
          .eq("status", "published")
          .gte("publishedAt", publishedAfter),
      )
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? 20, 50)));
    return articles.map((article) => ({
      articleId: article.articleId,
      slug: article.slug,
      publishedAt: article.publishedAt ?? article.articleCreatedAt,
      gscInspectedAt: article.gscInspectedAt,
    }));
  },
});

export const recordUrlInspection = internalMutation({
  args: {
    articleId: v.id("articles"),
    verdict: v.optional(v.string()),
    coverageState: v.optional(v.string()),
    pageFetchState: v.optional(v.string()),
    robotsTxtState: v.optional(v.string()),
    lastCrawlTime: v.optional(v.string()),
    inspectedAt: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article) throw new Error("Article not found");
    const patch = args.error
      ? {
        gscInspectedAt: args.inspectedAt,
        gscInspectionError: args.error,
      }
      : {
        gscIndexVerdict: args.verdict,
        gscCoverageState: args.coverageState,
        gscPageFetchState: args.pageFetchState,
        gscRobotsTxtState: args.robotsTxtState,
        gscLastCrawlTime: args.lastCrawlTime,
        gscInspectedAt: args.inspectedAt,
        gscInspectionError: undefined,
      };
    await ctx.db.patch(args.articleId, patch);
    const summary = await ctx.db
      .query("article_summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .unique();
    if (summary) {
      await ctx.db.patch(summary._id, {
        ...patch,
        articleUpdatedAt: Date.now(),
      });
    }
  },
});

// Get all historical data for trend detection (content decay)
export const getHistory = internalQuery({
  args: { siteId: v.id("sites"), days: v.optional(v.number()) },
  handler: async (ctx, { siteId, days }) => {
    const boundedDays = Math.max(30, Math.min(days ?? 180, 365));
    const cutoff = new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const hasDailyRows = await ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", siteId).eq("syncVersion", DAILY_SYNC_VERSION),
      )
      .first();
    if (hasDailyRows) {
      return await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .gte("date", cutoff),
        )
        .collect();
    }
    return await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) =>
        q.eq("siteId", siteId).gte("date", cutoff),
      )
      .collect();
  },
});
