import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

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

// Save one GSC response in a single Convex mutation. The previous action made
// one function call per query and scanned every row for that site/date again.
export const upsertBatch = mutation({
  args: {
    siteId: v.id("sites"),
    date: v.string(),
    rows: v.array(v.object({
      query: v.string(),
      page: v.optional(v.string()),
      clicks: v.number(),
      impressions: v.number(),
      ctr: v.number(),
      position: v.number(),
    })),
  },
  handler: async (ctx, { siteId, date, rows }) => {
    let inserted = 0;
    let updated = 0;

    for (const row of rows) {
      const existing = await ctx.db
        .query("search_performance")
        .withIndex("by_site_date_query", (q) =>
          q.eq("siteId", siteId).eq("date", date).eq("query", row.query),
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          page: row.page,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        });
        updated++;
      } else {
        await ctx.db.insert("search_performance", {
          siteId,
          date,
          ...row,
          createdAt: Date.now(),
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
    const latest = await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) => q.eq("siteId", siteId))
      .order("desc")
      .first();
    if (!latest) return [];

    const recent = await ctx.db
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
    const latest = await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) => q.eq("siteId", siteId))
      .order("desc")
      .first();
    if (!latest) return null;

    const recent = await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) =>
        q.eq("siteId", siteId).eq("date", latest.date),
      )
      .collect();

    const totalClicks = recent.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = recent.reduce((s, r) => s + r.impressions, 0);
    const avgPosition = recent.length > 0
      ? Math.round((recent.reduce((s, r) => s + r.position, 0) / recent.length) * 10) / 10
      : 0;
    const avgCtr = totalImpressions > 0 ? Math.round((totalClicks / totalImpressions) * 1000) / 10 : 0;

    return {
      totalClicks,
      totalImpressions,
      avgPosition,
      avgCtr,
      queryCount: recent.length,
      lastSync: latest.date,
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
    const all = await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) =>
        q.eq("siteId", siteId).gte("date", cutoff),
      )
      .collect();

    // Match by page URL (partial match for flexibility)
    const pageClean = pageUrl.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
    return all.filter((r) => {
      if (!r.page) return false;
      const rClean = r.page.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase();
      return rClean.includes(pageClean) || pageClean.includes(rClean);
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
    return await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) =>
        q.eq("siteId", siteId).gte("date", cutoff),
      )
      .collect();
  },
});
