import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const now = () => Date.now();

export const listBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    return await ctx.db
      .query("pages")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
  },
});

export const bulkUpsert = mutation({
  args: {
    siteId: v.id("sites"),
    pages: v.array(
      v.object({
        url: v.string(),
        slug: v.string(),
        title: v.optional(v.string()),
        keywords: v.optional(v.array(v.string())),
        summary: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { siteId, pages }) => {
    for (const page of pages) {
      const existing = await ctx.db
        .query("pages")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .filter((q) => q.eq(q.field("slug"), page.slug))
        .unique();

      if (existing?._id) {
        await ctx.db.patch(existing._id, {
          title: page.title ?? existing.title,
          keywords: page.keywords ?? existing.keywords,
          summary: page.summary ?? existing.summary,
        });
      } else {
        await ctx.db.insert("pages", {
          siteId,
          url: page.url,
          slug: page.slug,
          title: page.title,
          keywords: page.keywords,
          summary: page.summary,
          createdAt: now(),
        });
      }
    }
  },
});

