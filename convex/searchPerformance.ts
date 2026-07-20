import { mutation, query } from "./_generated/server";
import { isSameSearchConsolePage } from "./lib/searchPerformance";
import { v } from "convex/values";

const DAILY_SYNC_VERSION = 2;

// Upsert a search performance record (avoids duplicates for same site+date+query)
export const upsert = mutation({
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
export const upsertBatch = mutation({
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

// Get all historical data for trend detection (content decay)
export const getHistory = query({
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
