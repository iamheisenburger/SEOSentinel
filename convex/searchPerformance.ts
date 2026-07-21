import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { isSameSearchConsolePage } from "./lib/searchPerformance";
import { v } from "convex/values";

const DAILY_SYNC_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEO_WINDOWS_DAYS = [7, 14, 28, 56] as const;

async function requireSiteOwner(ctx: QueryCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId);
  const identity = await ctx.auth.getUserIdentity();
  if (!site?.userId || !identity || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site's search performance");
  }
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

// Get top queries for a site (last sync)
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

    const recent = latestDaily
      ? await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .eq("date", latest.date),
        )
        .collect()
      : await ctx.db
        .query("search_performance")
        .withIndex("by_site_date", (q) =>
          q.eq("siteId", siteId).eq("date", latest.date),
        )
        .collect();

    // Sort by clicks desc, then impressions desc
    recent.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
    return recent.slice(0, limit ?? 20);
  },
});

// Get performance summary for a site
export const getSummary = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
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
    if (!latest) return null;

    const recent = latestDaily
      ? await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .eq("date", latest.date),
        )
        .collect()
      : await ctx.db
        .query("search_performance")
        .withIndex("by_site_date", (q) =>
          q.eq("siteId", siteId).eq("date", latest.date),
        )
        .collect();

    const totalClicks = recent.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = recent.reduce((s, r) => s + r.impressions, 0);
    const avgPosition = totalImpressions > 0
      ? Math.round((
        recent.reduce((s, r) => s + r.position * r.impressions, 0) /
        totalImpressions
      ) * 10) / 10
      : 0;
    const avgCtr = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 1000) / 10 : 0;

    return {
      totalClicks,
      totalImpressions,
      avgPosition,
      avgCtr,
      queryCount: new Set(recent.map((row) => row.query)).size,
      lastSync: latest.date,
      dataThrough: latest.date,
      syncedAt: latestDaily
        ? Math.max(...recent.map((row) => row.syncedAt ?? row.createdAt))
        : undefined,
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

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().split("T")[0];
}

function isBrandedQuery(queryText: string, domain: string): boolean {
  const normalized = queryText.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const brand = domain.toLowerCase().replace(/^www\./, "").split(".")[0]
    .replace(/[^a-z0-9]+/g, " ").trim();
  return !!brand && (
    normalized.includes(brand) ||
    normalized.includes(domain.toLowerCase().replace(/^www\./, ""))
  );
}

async function articleSeoScorecard(
  ctx: QueryCtx,
  articleId: Id<"articles">,
) {
  const article = await ctx.db.get(articleId);
  if (!article) throw new Error("Article not found");
  if (article.status !== "published" || !article.publishedAt) {
    throw new Error("SEO scorecards require a published article");
  }
  const site = await ctx.db.get(article.siteId);
  if (!site) throw new Error("Site not found");

  const startDate = isoDate(article.publishedAt);
  const maximumEndDate = isoDate(article.publishedAt + 56 * DAY_MS - 1);
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

  const pageUrl = `https://${site.domain}${
    article.slug.startsWith("/") ? article.slug : `/${article.slug}`
  }`;
  const pageRows = rows.filter(
    (row) => !!row.page && isSameSearchConsolePage(row.page, pageUrl),
  );
  const dataThrough = latest?.date;

  const windows = SEO_WINDOWS_DAYS.map((days) => {
    const expectedEndDate = isoDate(article.publishedAt! + days * DAY_MS - 1);
    const available = pageRows.filter((row) => row.date <= expectedEndDate);
    const clicks = available.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = available.reduce((sum, row) => sum + row.impressions, 0);
    const nonBranded = available.filter(
      (row) => !isBrandedQuery(row.query, site.domain),
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
        branded: isBrandedQuery(row.query, site.domain),
      }));
    return {
      days,
      expectedEndDate,
      complete: !!dataThrough && dataThrough >= expectedEndDate,
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
    publishedAt: article.publishedAt,
    startDate,
    dataThrough,
    syncVersion: DAILY_SYNC_VERSION,
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
