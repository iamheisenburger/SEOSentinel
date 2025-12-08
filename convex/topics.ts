import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const now = () => Date.now();

export const listBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    return await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .order("asc")
      .collect();
  },
});

export const get = query({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => ctx.db.get(topicId),
});

export const upsertMany = mutation({
  args: {
    siteId: v.id("sites"),
    topics: v.array(
      v.object({
        label: v.string(),
        primaryKeyword: v.string(),
        secondaryKeywords: v.array(v.string()),
        intent: v.optional(v.string()),
        priority: v.optional(v.number()),
        status: v.optional(v.string()),
        notes: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, { siteId, topics }) => {
    for (const topic of topics) {
      await ctx.db.insert("topic_clusters", {
        siteId,
        label: topic.label,
        primaryKeyword: topic.primaryKeyword,
        secondaryKeywords: topic.secondaryKeywords ?? [],
        intent: topic.intent,
        priority: topic.priority,
        status: topic.status ?? "planned",
        notes: topic.notes,
        createdAt: now(),
        updatedAt: now(),
      });
    }
  },
});

export const updateStatus = mutation({
  args: {
    topicId: v.id("topic_clusters"),
    status: v.string(),
  },
  handler: async (ctx, { topicId, status }) => {
    await ctx.db.patch(topicId, { status, updatedAt: now() });
  },
});

