import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { serpFingerprintOverlap } from "./lib/autopilotBuffer";

const now = () => Date.now();

async function requireSiteOwner(
  ctx: QueryCtx | MutationCtx,
  siteId: Doc<"sites">["_id"],
) {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!site?.userId || !identity || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site's topics");
  }
}

async function listBySiteHandler(ctx: QueryCtx, siteId: Doc<"sites">["_id"]) {
  return ctx.db
    .query("topic_clusters")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .order("asc")
    .collect();
}

export const listBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    return listBySiteHandler(ctx, siteId);
  },
});

export const listBySiteInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => listBySiteHandler(ctx, siteId),
});

export const listGrowthSupportInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const topics = await listBySiteHandler(ctx, siteId);
    return topics
      .filter((topic) => Boolean(topic.growthActionFingerprint))
      .map((topic) => ({
        topicId: topic._id,
        primaryKeyword: topic.primaryKeyword,
        status: topic.status,
        priority: topic.priority,
        searchVolume: topic.searchVolume,
        keywordDifficulty: topic.keywordDifficulty,
        serpCount: topic.serpTopUrls?.length ?? 0,
        growthParentArticleId: topic.growthParentArticleId,
        growthActionFingerprint: topic.growthActionFingerprint,
      }));
  },
});

export const get = query({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic) return null;
    await requireSiteOwner(ctx, topic.siteId);
    return topic;
  },
});

export const getInternal = internalQuery({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => ctx.db.get(topicId),
});

export const getSerpFingerprintAudit = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const topics = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    const missing = topics
      .filter((topic) => (topic.serpTopUrls?.length ?? 0) < 5)
      .map((topic) => ({
        topicId: topic._id,
        primaryKeyword: topic.primaryKeyword,
        status: topic.status,
      }));
    return {
      total: topics.length,
      fingerprinted: topics.length - missing.length,
      missing,
    };
  },
});

export const getSerpCorpusAudit = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const topics = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < topics.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < topics.length;
        rightIndex += 1
      ) {
        const left = topics[leftIndex];
        const right = topics[rightIndex];
        const evidence = serpFingerprintOverlap(
          left.serpTopUrls,
          right.serpTopUrls,
        );
        if (evidence.shared < 3 || evidence.coefficient < 0.4) continue;
        overlaps.push({
          leftTopicId: left._id,
          rightTopicId: right._id,
          leftKeyword: left.primaryKeyword,
          rightKeyword: right.primaryKeyword,
          leftStatus: left.status,
          rightStatus: right.status,
          ...evidence,
        });
      }
    }
    return {
      total: topics.length,
      fingerprinted: topics.filter(
        (topic) => (topic.serpTopUrls?.length ?? 0) >= 5,
      ).length,
      overlaps,
    };
  },
});

export const upsertMany = internalMutation({
  args: {
    siteId: v.id("sites"),
    growthParentArticleId: v.optional(v.id("articles")),
    growthActionFingerprint: v.optional(v.string()),
    topics: v.array(
      v.object({
        label: v.string(),
        primaryKeyword: v.string(),
        secondaryKeywords: v.array(v.string()),
        intent: v.optional(v.string()),
        priority: v.optional(v.number()),
        articleType: v.optional(v.string()),
        status: v.optional(v.string()),
        notes: v.optional(v.string()),
        // SEO metrics — saved in one shot so topics never appear without data
        searchVolume: v.optional(v.number()),
        keywordDifficulty: v.optional(v.number()),
        cpc: v.optional(v.number()),
        serpIntent: v.optional(v.string()),
        recommendedArticleType: v.optional(v.string()),
        paaQuestions: v.optional(v.array(v.string())),
        serpTopUrls: v.optional(v.array(v.string())),
        volumeTrend: v.optional(v.array(v.number())),
        businessFitEligible: v.optional(v.boolean()),
        businessFitScore: v.optional(v.number()),
        businessFitVersion: v.optional(v.number()),
        businessFitReasons: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (
    ctx,
    { siteId, topics, growthParentArticleId, growthActionFingerprint },
  ) => {
    if (growthParentArticleId) {
      const parent = await ctx.db.get(growthParentArticleId);
      if (
        !parent ||
        parent.siteId !== siteId ||
        parent.status !== "published" ||
        !growthActionFingerprint
      ) {
        throw new Error(
          "Growth support topics require a published same-tenant parent and action fingerprint",
        );
      }
      const action = await ctx.db
        .query("seo_growth_actions")
        .withIndex("by_fingerprint", (q) =>
          q.eq("fingerprint", growthActionFingerprint)
        )
        .unique();
      if (
        !action ||
        action.siteId !== siteId ||
        action.articleId !== growthParentArticleId ||
        action.status !== "open"
      ) {
        throw new Error("Growth support topic does not match its measured action");
      }
    } else if (growthActionFingerprint) {
      throw new Error("Growth action fingerprint requires a parent article");
    }
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
        articleType: topic.articleType,
        status: topic.status ?? "planned",
        notes: topic.notes,
        // SEO metrics — included at insert time so topics never appear without data
        ...(topic.searchVolume !== undefined ? { searchVolume: topic.searchVolume } : {}),
        ...(topic.keywordDifficulty !== undefined ? { keywordDifficulty: topic.keywordDifficulty } : {}),
        ...(topic.cpc !== undefined ? { cpc: topic.cpc } : {}),
        ...(topic.serpIntent ? { serpIntent: topic.serpIntent } : {}),
        ...(topic.recommendedArticleType ? { recommendedArticleType: topic.recommendedArticleType } : {}),
        ...(topic.paaQuestions ? { paaQuestions: topic.paaQuestions } : {}),
        ...(topic.serpTopUrls ? { serpTopUrls: topic.serpTopUrls } : {}),
        ...(topic.volumeTrend ? { volumeTrend: topic.volumeTrend } : {}),
        ...(topic.businessFitEligible !== undefined
          ? {
              businessFitEligible: topic.businessFitEligible,
              businessFitCheckedAt: now(),
            }
          : {}),
        ...(topic.businessFitScore !== undefined
          ? { businessFitScore: topic.businessFitScore }
          : {}),
        ...(topic.businessFitVersion !== undefined
          ? { businessFitVersion: topic.businessFitVersion }
          : {}),
        ...(topic.businessFitReasons
          ? { businessFitReasons: topic.businessFitReasons }
          : {}),
        ...(growthParentArticleId ? { growthParentArticleId } : {}),
        ...(growthActionFingerprint ? { growthActionFingerprint } : {}),
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
    return { inserted, skipped };
  },
});

export const remove = mutation({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic) return;
    await requireSiteOwner(ctx, topic.siteId);
    await ctx.db.delete(topicId);
  },
});

export const removeInternal = internalMutation({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    await ctx.db.delete(topicId);
  },
});

export const updateStatus = internalMutation({
  args: {
    topicId: v.id("topic_clusters"),
    status: v.string(),
  },
  handler: async (ctx, { topicId, status }) => {
    const allowed = new Set([
      "pending", "queued", "planned", "used", "cannibalizing", "disqualified",
    ]);
    if (!allowed.has(status)) throw new Error("Invalid topic status");
    await ctx.db.patch(topicId, { status, updatedAt: now() });
  },
});

export const recordBusinessFitAuditsInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    audits: v.array(v.object({
      topicId: v.id("topic_clusters"),
      eligible: v.boolean(),
      score: v.number(),
      version: v.number(),
      reasons: v.array(v.string()),
    })),
  },
  handler: async (ctx, { siteId, audits }) => {
    let disqualified = 0;
    let requalified = 0;
    let updated = 0;
    const checkedAt = now();
    for (const audit of audits) {
      const topic = await ctx.db.get(audit.topicId);
      if (!topic || topic.siteId !== siteId) continue;
      if (["used", "queued", "cannibalizing"].includes(topic.status ?? "")) {
        continue;
      }
      const nextStatus = audit.eligible
        ? topic.status === "disqualified" ? "planned" : topic.status ?? "planned"
        : "disqualified";
      if (!audit.eligible && topic.status !== "disqualified") disqualified += 1;
      if (audit.eligible && topic.status === "disqualified") requalified += 1;
      const reason = audit.reasons.join("; ");
      const changed =
        topic.businessFitEligible !== audit.eligible ||
        topic.businessFitScore !== audit.score ||
        topic.businessFitVersion !== audit.version ||
        JSON.stringify(topic.businessFitReasons ?? []) !==
          JSON.stringify(audit.reasons) ||
        topic.status !== nextStatus;
      if (!changed) continue;
      await ctx.db.patch(audit.topicId, {
        businessFitEligible: audit.eligible,
        businessFitScore: audit.score,
        businessFitVersion: audit.version,
        businessFitReasons: audit.reasons,
        businessFitCheckedAt: checkedAt,
        status: nextStatus,
        disqualifiedReason: audit.eligible ? undefined : reason,
        updatedAt: checkedAt,
      });
      updated += 1;
    }
    return { disqualified, requalified, updated };
  },
});

// A topic can already be queued when a newer product-fit policy is deployed or
// a tenant profile changes. The worker calls this mutation immediately before
// incurring research or model spend, so only that exact queued topic can be
// quarantined while unrelated tenant work remains untouched.
export const disqualifyQueuedTopicInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    topicId: v.id("topic_clusters"),
    score: v.number(),
    version: v.number(),
    reasons: v.array(v.string()),
  },
  handler: async (ctx, { siteId, topicId, score, version, reasons }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic || topic.siteId !== siteId || topic.status !== "queued") {
      return { updated: false };
    }
    const checkedAt = now();
    await ctx.db.patch(topicId, {
      status: "disqualified",
      businessFitEligible: false,
      businessFitScore: score,
      businessFitVersion: version,
      businessFitReasons: reasons,
      businessFitCheckedAt: checkedAt,
      disqualifiedReason: reasons.join("; "),
      updatedAt: checkedAt,
    });
    return { updated: true };
  },
});

export const updateLabel = internalMutation({
  args: {
    topicId: v.id("topic_clusters"),
    label: v.string(),
  },
  handler: async (ctx, { topicId, label }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic) throw new Error("Topic not found");
    const normalizedLabel = label.trim();
    if (!normalizedLabel) throw new Error("Topic label cannot be empty");
    await ctx.db.patch(topicId, {
      label: normalizedLabel,
      updatedAt: now(),
    });
  },
});

export const removeUsed = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    const all = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    let deleted = 0;
    for (const topic of all) {
      if (topic.status === "used") {
        await ctx.db.delete(topic._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

export const updateSEOMetrics = internalMutation({
  args: {
    topicId: v.id("topic_clusters"),
    searchVolume: v.optional(v.number()),
    keywordDifficulty: v.optional(v.number()),
    cpc: v.optional(v.number()),
    serpIntent: v.optional(v.string()),
    recommendedArticleType: v.optional(v.string()),
    paaQuestions: v.optional(v.array(v.string())),
    serpTopUrls: v.optional(v.array(v.string())),
    volumeTrend: v.optional(v.array(v.number())),
    priority: v.optional(v.number()),
    articleType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { topicId, ...metrics } = args;
    // Strip undefined values to avoid clearing fields
    const patch: Record<string, any> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(metrics)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(topicId, patch);
  },
});

export const removeUnused = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    const all = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    let deleted = 0;
    for (const topic of all) {
      if (topic.status !== "used") {
        await ctx.db.delete(topic._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
