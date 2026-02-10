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
    // Fetch existing topics to prevent duplicates
    const existing = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    const existingKeywords = new Set(
      existing.map((t) => t.primaryKeyword.toLowerCase().trim()),
    );

    let inserted = 0;
    let skipped = 0;
    for (const topic of topics) {
      const normalizedKw = topic.primaryKeyword.toLowerCase().trim();

      // Skip if this exact keyword already exists
      if (existingKeywords.has(normalizedKw)) {
        skipped++;
        continue;
      }

      // Skip if a very similar keyword exists (one is a substring of the other)
      let tooSimilar = false;
      for (const existingKw of existingKeywords) {
        if (
          normalizedKw.includes(existingKw) ||
          existingKw.includes(normalizedKw)
        ) {
          tooSimilar = true;
          break;
        }
      }
      if (tooSimilar) {
        skipped++;
        continue;
      }

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

      // Add to the set so subsequent topics in this batch also deduplicate
      existingKeywords.add(normalizedKw);
      inserted++;
    }

    if (skipped > 0) {
      console.log(`Topics upsert: ${inserted} inserted, ${skipped} duplicates skipped.`);
    }
  },
});

export const remove = mutation({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    await ctx.db.delete(topicId);
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

