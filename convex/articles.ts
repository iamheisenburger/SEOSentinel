import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const now = () => Date.now();

export const listBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    return await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .order("desc")
      .collect();
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

    return await ctx.db.insert("articles", {
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
  },
});

export const updateStatus = mutation({
  args: { articleId: v.id("articles"), status: v.string() },
  handler: async (ctx, { articleId, status }) => {
    await ctx.db.patch(articleId, { status, updatedAt: now() });
  },
});

export const updateMarkdown = mutation({
  args: { articleId: v.id("articles"), markdown: v.string() },
  handler: async (ctx, { articleId, markdown }) => {
    await ctx.db.patch(articleId, { markdown, updatedAt: now() });
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
  },
});

export const updateFeaturedImage = mutation({
  args: { articleId: v.id("articles"), featuredImage: v.string() },
  handler: async (ctx, { articleId, featuredImage }) => {
    await ctx.db.patch(articleId, { featuredImage, updatedAt: now() });
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
      .withIndex("by_user_type", (q) =>
        q.eq("userId", userId).eq("type", "article_generated"),
      )
      .collect();
    return logs.filter((l) => l.createdAt >= monthStart).length;
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
      .withIndex("by_user_type", (q) =>
        q.eq("userId", userId).eq("type", "article_generated"),
      )
      .collect();
    const count = logs.filter((l) => l.createdAt >= monthStart).length;

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
    await ctx.db.delete(articleId);
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


// ── Public Blog Queries (no auth required) ──────────────

export const listPublishedByDomain = query({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) => {
    // Find site by domain
    const sites = await ctx.db.query("sites").collect();
    const site = sites.find((s) => s.domain === domain);
    if (!site) return [];

    const all = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .order("desc")
      .collect();
    return all
      .filter((a) => a.status === "published")
      .map((a) => ({
        _id: a._id,
        title: a.title,
        slug: a.slug,
        metaDescription: a.metaDescription,
        featuredImage: a.featuredImage,
        readingTime: a.readingTime,
        createdAt: a.createdAt,
      }));
  },
});

export const getPublishedBySlug = query({
  args: { domain: v.string(), slug: v.string() },
  handler: async (ctx, { domain, slug }) => {
    const sites = await ctx.db.query("sites").collect();
    const site = sites.find((s) => s.domain === domain);
    if (!site) return null;

    const all = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();
    const article = all.find(
      (a) => a.slug === slug && a.status === "published",
    );
    if (!article) return null;

    return {
      _id: article._id,
      title: article.title,
      slug: article.slug,
      markdown: article.markdown,
      metaDescription: article.metaDescription,
      metaKeywords: article.metaKeywords,
      featuredImage: article.featuredImage,
      readingTime: article.readingTime,
      wordCount: article.wordCount,
      sources: article.sources,
      internalLinks: article.internalLinks,
      factCheckScore: article.factCheckScore,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      brandPrimaryColor: site.brandPrimaryColor,
      brandAccentColor: site.brandAccentColor,
      brandFontFamily: site.brandFontFamily,
      siteName: site.siteName,
      domain: site.domain,
    };
  },
});
