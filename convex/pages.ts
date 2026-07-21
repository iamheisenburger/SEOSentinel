import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const now = () => Date.now();

async function listBySiteHandler(ctx: QueryCtx, siteId: Id<"sites">) {
  return ctx.db
    .query("pages")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
}

export const listBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to access this site's pages");
    }
    return listBySiteHandler(ctx, siteId);
  },
});

export const listBySiteInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => listBySiteHandler(ctx, siteId),
});

export const bulkUpsert = internalMutation({
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
