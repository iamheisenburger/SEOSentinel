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
    // Check for existing record with same site+date+query
    const existing = await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) => q.eq("siteId", args.siteId).eq("date", args.date))
      .collect();

    const match = existing.find((r) => r.query === args.query);

    if (match) {
      // Update existing record
      await ctx.db.patch(match._id, {
        clicks: args.clicks,
        impressions: args.impressions,
        ctr: args.ctr,
        position: args.position,
        page: args.page,
      });
      return match._id;
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

// Get top queries for a site (last sync)
export const getTopQueries = query({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }) => {
    const all = await ctx.db
      .query("search_performance")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();

    // Get the most recent date
    if (all.length === 0) return [];
    const latestDate = all.reduce((max, r) => (r.date > max ? r.date : max), "");
    const recent = all.filter((r) => r.date === latestDate);

    // Sort by clicks desc, then impressions desc
    recent.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
    return recent.slice(0, limit ?? 20);
  },
});

// Get performance summary for a site
export const getSummary = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const all = await ctx.db
      .query("search_performance")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();

    if (all.length === 0) return null;

    const latestDate = all.reduce((max, r) => (r.date > max ? r.date : max), "");
    const recent = all.filter((r) => r.date === latestDate);

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
      lastSync: latestDate,
    };
  },
});

// Get performance data for a specific article/page URL
export const getByPage = query({
  args: { siteId: v.id("sites"), pageUrl: v.string() },
  handler: async (ctx, { siteId, pageUrl }) => {
    const all = await ctx.db
      .query("search_performance")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
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
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    return await ctx.db
      .query("search_performance")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
  },
});
