import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

const now = () => Date.now();
type ArticleSummaryFields = Omit<Doc<"article_summaries">, "_id" | "_creationTime">;

function summaryFields(article: Doc<"articles">): ArticleSummaryFields {
  return {
    articleId: article._id,
    siteId: article.siteId,
    topicId: article.topicId,
    articleType: article.articleType,
    status: article.status,
    title: article.title,
    slug: article.slug,
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
    metaKeywords: article.metaKeywords,
    language: article.language,
    featuredImage: article.featuredImage,
    readingTime: article.readingTime,
    wordCount: article.wordCount,
    factCheckScore: article.factCheckScore,
    contentScore: article.contentScore,
    publicationGateStatus: article.publicationGateStatus,
    publicationGateIssues: article.publicationGateIssues,
    publicationGateWarnings: article.publicationGateWarnings,
    publicationCheckedAt: article.publicationCheckedAt,
    entityCoverage: article.entityCoverage,
    topicCompleteness: article.topicCompleteness,
    serpDifficulty: article.serpDifficulty,
    decayStatus: article.decayStatus,
    decayDetectedAt: article.decayDetectedAt,
    decayReason: article.decayReason,
    lastRefreshedAt: article.lastRefreshedAt,
    refreshCount: article.refreshCount,
    articleCreatedAt: article.createdAt,
    articleUpdatedAt: article.updatedAt,
  };
}

async function syncSummary(ctx: MutationCtx, articleId: Doc<"articles">["_id"]) {
  const article = await ctx.db.get(articleId);
  if (!article) return;

  const existing = await ctx.db
    .query("article_summaries")
    .withIndex("by_article", (q) => q.eq("articleId", articleId))
    .first();
  const fields = summaryFields(article);

  if (existing) {
    await ctx.db.patch(existing._id, fields);
  } else {
    await ctx.db.insert("article_summaries", fields);
  }
}

function summaryListItem(summary: ArticleSummaryFields) {
  return {
    _id: summary.articleId,
    _creationTime: summary.articleCreatedAt,
    siteId: summary.siteId,
    topicId: summary.topicId,
    articleType: summary.articleType,
    status: summary.status,
    title: summary.title,
    slug: summary.slug,
    // Compatibility field for older clients. List views must use wordCount;
    // full markdown is available only through articles.get.
    markdown: "",
    metaTitle: summary.metaTitle,
    metaDescription: summary.metaDescription,
    metaKeywords: summary.metaKeywords,
    language: summary.language,
    featuredImage: summary.featuredImage,
    readingTime: summary.readingTime,
    wordCount: summary.wordCount,
    factCheckScore: summary.factCheckScore,
    contentScore: summary.contentScore,
    publicationGateStatus: summary.publicationGateStatus,
    publicationGateIssues: summary.publicationGateIssues,
    publicationGateWarnings: summary.publicationGateWarnings,
    publicationCheckedAt: summary.publicationCheckedAt,
    entityCoverage: summary.entityCoverage,
    topicCompleteness: summary.topicCompleteness,
    serpDifficulty: summary.serpDifficulty,
    decayStatus: summary.decayStatus,
    decayDetectedAt: summary.decayDetectedAt,
    decayReason: summary.decayReason,
    lastRefreshedAt: summary.lastRefreshedAt,
    refreshCount: summary.refreshCount,
    createdAt: summary.articleCreatedAt,
    updatedAt: summary.articleUpdatedAt,
  };
}

export const listBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const summaries = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_created", (q) => q.eq("siteId", siteId))
      .order("desc")
      .collect();

    if (summaries.length > 0) {
      return summaries.map(summaryListItem);
    }

    // Safe migration fallback until the one-time production backfill runs.
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .order("desc")
      .collect();
    return articles.map((article) => summaryListItem(summaryFields(article)));
  },
});

export const get = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => ctx.db.get(articleId),
});

export const createDraft = mutation({
  args: {
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
    articleType: v.optional(v.string()),
    title: v.string(),
    slug: v.string(),
    markdown: v.string(),
    metaTitle: v.optional(v.string()),
    metaDescription: v.optional(v.string()),
    metaKeywords: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    sources: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.optional(v.string()),
        }),
      ),
    ),
    featuredImage: v.optional(v.string()),
    readingTime: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    factCheckScore: v.optional(v.number()),
    factCheckNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Deduplicate slug — prevent multiple articles with the same URL path
    let slug = args.slug;
    const existing = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .collect();
    const existingSlugs = new Set(existing.map((a) => a.slug));

    if (existingSlugs.has(slug)) {
      let suffix = 2;
      while (existingSlugs.has(`${slug}-${suffix}`)) {
        suffix++;
      }
      slug = `${slug}-${suffix}`;
      console.log(`Duplicate slug detected, using: ${slug}`);
    }

    const articleId = await ctx.db.insert("articles", {
      siteId: args.siteId,
      topicId: args.topicId,
      articleType: args.articleType,
      status: "draft",
      title: args.title,
      slug,
      markdown: args.markdown,
      metaTitle: args.metaTitle,
      metaDescription: args.metaDescription,
      metaKeywords: args.metaKeywords,
      language: args.language,
      sources: args.sources,
      featuredImage: args.featuredImage,
      readingTime: args.readingTime,
      wordCount: args.wordCount,
      factCheckScore: args.factCheckScore,
      factCheckNotes: args.factCheckNotes,
      internalLinks: [],
      createdAt: now(),
      updatedAt: now(),
    });
    await syncSummary(ctx, articleId);
    return articleId;
  },
});

export const updateStatus = mutation({
  args: { articleId: v.id("articles"), status: v.string() },
  handler: async (ctx, { articleId, status }) => {
    await ctx.db.patch(articleId, { status, updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

export const recordPublicationCheck = mutation({
  args: {
    articleId: v.id("articles"),
    status: v.string(),
    issues: v.array(v.string()),
    warnings: v.array(v.string()),
  },
  handler: async (ctx, { articleId, status, issues, warnings }) => {
    await ctx.db.patch(articleId, {
      publicationGateStatus: status,
      publicationGateIssues: issues,
      publicationGateWarnings: warnings,
      publicationCheckedAt: now(),
      updatedAt: now(),
    });
    await syncSummary(ctx, articleId);
  },
});

export const updateMarkdown = mutation({
  args: { articleId: v.id("articles"), markdown: v.string() },
  handler: async (ctx, { articleId, markdown }) => {
    await ctx.db.patch(articleId, { markdown, updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

export const updateLinks = mutation({
  args: {
    articleId: v.id("articles"),
    internalLinks: v.array(
      v.object({
        anchor: v.string(),
        href: v.string(),
      }),
    ),
  },
  handler: async (ctx, { articleId, internalLinks }) => {
    await ctx.db.patch(articleId, { internalLinks, updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

export const updateFeaturedImage = mutation({
  args: { articleId: v.id("articles"), featuredImage: v.string() },
  handler: async (ctx, { articleId, featuredImage }) => {
    await ctx.db.patch(articleId, { featuredImage, updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

export const approve = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    if (article.status === "published") {
      throw new Error("Article is already published");
    }
    await ctx.db.patch(articleId, { status: "ready", updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

export const reject = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    if (article.status === "published") {
      throw new Error("Cannot reject a published article");
    }
    await ctx.db.patch(articleId, { status: "rejected", updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

// Count article generations this calendar month (immutable — deletions don't reduce count)
export const countThisMonth = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).getTime();

    const logs = await ctx.db
      .query("usage_log")
      .withIndex("by_user_type_created", (q) =>
        q
          .eq("userId", userId)
          .eq("type", "article_generated")
          .gte("createdAt", monthStart),
      )
      .collect();
    return logs.length;
  },
});

// Record an article generation in the usage log (called from pipeline after article is created)
export const logGeneration = mutation({
  args: { userId: v.string(), siteId: v.id("sites") },
  handler: async (ctx, { userId, siteId }) => {
    await ctx.db.insert("usage_log", {
      userId,
      siteId,
      type: "article_generated",
      createdAt: Date.now(),
    });
  },
});

// Atomically check article limit AND reserve a slot (prevents race conditions)
// Returns { ok: true } if slot claimed, { ok: false, reason: string } if over limit
export const claimGenerationSlot = mutation({
  args: { userId: v.string(), siteId: v.id("sites"), maxArticles: v.number() },
  handler: async (ctx, { userId, siteId, maxArticles }) => {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).getTime();

    const logs = await ctx.db
      .query("usage_log")
      .withIndex("by_user_type_created", (q) =>
        q
          .eq("userId", userId)
          .eq("type", "article_generated")
          .gte("createdAt", monthStart),
      )
      .collect();
    const count = logs.length;

    if (count >= maxArticles) {
      return { ok: false, reason: `Limit reached (${count}/${maxArticles})` };
    }

    // Claim the slot by logging immediately (before article generation starts)
    await ctx.db.insert("usage_log", {
      userId,
      siteId,
      type: "article_generated",
      createdAt: Date.now(),
    });

    return { ok: true, reason: "" };
  },
});

export const deleteArticle = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const summary = await ctx.db
      .query("article_summaries")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .first();
    if (summary) await ctx.db.delete(summary._id);
    await ctx.db.delete(articleId);
  },
});

export const updateContentScore = mutation({
  args: {
    articleId: v.id("articles"),
    contentScore: v.optional(v.number()),
    entityCoverage: v.optional(v.number()),
    topicCompleteness: v.optional(v.number()),
    missingEntities: v.optional(v.array(v.string())),
    missingTopics: v.optional(v.array(v.string())),
    serpDifficulty: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { articleId, ...scores } = args;
    const patch: Record<string, any> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(scores)) {
      if (val !== undefined) patch[k] = val;
    }
    await ctx.db.patch(articleId, patch);
    await syncSummary(ctx, articleId);
  },
});

export const updateBacklinks = mutation({
  args: {
    articleId: v.id("articles"),
    backlinkSuggestions: v.array(
      v.object({
        site: v.string(),
        reason: v.string(),
        anchor: v.string(),
        targetUrl: v.string(),
      }),
    ),
  },
  handler: async (ctx, { articleId, backlinkSuggestions }) => {
    await ctx.db.patch(articleId, { backlinkSuggestions, updatedAt: Date.now() });
    await syncSummary(ctx, articleId);
  },
});

// ── Content Decay Tracking ──

export const updateDecayStatus = mutation({
  args: {
    articleId: v.id("articles"),
    decayStatus: v.string(),
    decayReason: v.optional(v.string()),
    decayDetectedAt: v.optional(v.number()),
    positionHistory: v.optional(v.array(v.object({
      date: v.string(),
      position: v.number(),
      clicks: v.number(),
      impressions: v.number(),
    }))),
  },
  handler: async (ctx, { articleId, decayStatus, decayReason, decayDetectedAt, positionHistory }) => {
    const patch: Record<string, any> = { decayStatus, updatedAt: Date.now() };
    if (decayReason !== undefined) patch.decayReason = decayReason;
    if (decayDetectedAt !== undefined) patch.decayDetectedAt = decayDetectedAt;
    if (positionHistory !== undefined) patch.positionHistory = positionHistory;
    await ctx.db.patch(articleId, patch);
    await syncSummary(ctx, articleId);
  },
});

export const markRefreshing = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    await ctx.db.patch(articleId, {
      decayStatus: "refreshing",
      previousVersion: article.markdown,
      updatedAt: Date.now(),
    });
    await syncSummary(ctx, articleId);
  },
});

export const completeRefresh = mutation({
  args: {
    articleId: v.id("articles"),
    markdown: v.string(),
    wordCount: v.optional(v.number()),
    readingTime: v.optional(v.number()),
    sources: v.optional(v.array(v.object({ url: v.string(), title: v.optional(v.string()) }))),
    factCheckScore: v.optional(v.number()),
    factCheckNotes: v.optional(v.string()),
  },
  handler: async (ctx, { articleId, markdown, wordCount, readingTime, sources, factCheckScore, factCheckNotes }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    const patch: Record<string, any> = {
      markdown,
      decayStatus: "refreshed",
      lastRefreshedAt: Date.now(),
      refreshCount: (article.refreshCount ?? 0) + 1,
      updatedAt: Date.now(),
    };
    if (wordCount !== undefined) patch.wordCount = wordCount;
    if (readingTime !== undefined) patch.readingTime = readingTime;
    if (sources !== undefined) patch.sources = sources;
    if (factCheckScore !== undefined) patch.factCheckScore = factCheckScore;
    if (factCheckNotes !== undefined) patch.factCheckNotes = factCheckNotes;
    await ctx.db.patch(articleId, patch);
    await syncSummary(ctx, articleId);
  },
});

// Get articles flagged for decay (for dashboard display)
export const listDecaying = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const summaries = await ctx.db
      .query("article_summaries")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    return summaries
      .filter((summary) =>
        summary.decayStatus === "warning" || summary.decayStatus === "declining"
      )
      .map(summaryListItem);
  },
});

// Admin: reset usage log for a user (temporary — remove after use)
export const resetUsageLog = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const logs = await ctx.db
      .query("usage_log")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const log of logs) {
      await ctx.db.delete(log._id);
    }
    return { deleted: logs.length };
  },
});
