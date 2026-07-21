import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";

const PUBLICATION_INTEGRITY_MIGRATION_KEY = "publication-integrity-v4";

// Normalize stored domain (could be "https://example.com/" or "example.com") to bare hostname
function normalizeDomain(raw: string): string {
  let d = raw;
  if (d.startsWith("https://")) d = d.slice(8);
  if (d.startsWith("http://")) d = d.slice(7);
  if (d.startsWith("www.")) d = d.slice(4);
  if (d.endsWith("/")) d = d.slice(0, -1);
  return d;
}

function normalizeSlug(s: string): string {
  if (s.startsWith("/")) return s.slice(1);
  return s;
}

async function findSiteByDomain(ctx: QueryCtx, requested: string) {
  const bare = normalizeDomain(requested.trim().toLowerCase());
  const candidates = [
    requested,
    bare,
    `www.${bare}`,
    `https://${bare}`,
    `https://${bare}/`,
    `http://${bare}`,
    `http://${bare}/`,
  ];
  for (const candidate of new Set(candidates)) {
    const site = await ctx.db
      .query("sites")
      .withIndex("by_domain", (q) => q.eq("domain", candidate))
      .first();
    if (site) return site;
  }
  return null;
}

async function summariesAreComplete(ctx: QueryCtx): Promise<boolean> {
  const state = await ctx.db
    .query("maintenance_state")
    .withIndex("by_key", (q) =>
      q.eq("key", PUBLICATION_INTEGRITY_MIGRATION_KEY),
    )
    .first();
  return state?.status === "completed";
}

export const listPublishedByDomain = query({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) => {
    const site = await findSiteByDomain(ctx, domain);
    if (!site) return [];

    const useSummaries = await summariesAreComplete(ctx);
    const published = useSummaries
      ? await ctx.db
          .query("article_summaries")
          .withIndex("by_site_status_published", (q) =>
            q.eq("siteId", site._id).eq("status", "published"),
          )
          .order("desc")
          .collect()
      : await ctx.db
          .query("articles")
          .withIndex("by_site_status_created", (q) =>
            q.eq("siteId", site._id).eq("status", "published"),
          )
          .order("desc")
          .collect();
    return published.map((a) => ({
        _id: "articleId" in a ? a.articleId : a._id,
        title: a.title,
        slug: normalizeSlug(a.slug || ""),
        metaDescription: a.metaDescription,
        featuredImage: a.featuredImage,
        readingTime: a.readingTime,
        createdAt: "articleCreatedAt" in a
          ? a.publishedAt ?? a.articleCreatedAt
          : a.publishedAt ?? a.createdAt,
      }));
  },
});

// For sitemap generation — returns all published article slugs + dates for a domain
export const listPublishedSlugs = query({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) => {
    const site = await findSiteByDomain(ctx, domain);
    if (!site) return { articles: [], urlStructure: "/blog/[slug]" };

    const urlStructure = site.urlStructure ?? "/blog/[slug]";

    const useSummaries = await summariesAreComplete(ctx);
    const published = useSummaries
      ? await ctx.db
          .query("article_summaries")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", site._id).eq("status", "published"),
          )
          .collect()
      : await ctx.db
          .query("articles")
          .withIndex("by_site_status_created", (q) =>
            q.eq("siteId", site._id).eq("status", "published"),
          )
          .collect();
    const articles = published.map((a) => ({
        slug: normalizeSlug(a.slug || ""),
        updatedAt: "articleUpdatedAt" in a
          ? a.publishedAt ?? a.articleUpdatedAt ?? a.articleCreatedAt
          : a.publishedAt ?? a.updatedAt ?? a.createdAt,
      }));
    return { articles, urlStructure };
  },
});

export const getPublishedBySlug = query({
  args: { domain: v.string(), slug: v.string() },
  handler: async (ctx, { domain, slug }) => {
    const site = await findSiteByDomain(ctx, domain);
    if (!site) return null;

    const normalizedSlug = normalizeSlug(slug);
    const useSummaries = await summariesAreComplete(ctx);
    let article = null;
    if (useSummaries) {
      let summary = await ctx.db
        .query("article_summaries")
        .withIndex("by_site_slug", (q) =>
          q.eq("siteId", site._id).eq("slug", normalizedSlug),
        )
        .first();
      if (!summary) {
        summary = await ctx.db
          .query("article_summaries")
          .withIndex("by_site_slug", (q) =>
            q.eq("siteId", site._id).eq("slug", `/${normalizedSlug}`),
          )
          .first();
      }
      if (!summary || summary.status !== "published") return null;
      article = await ctx.db.get(summary.articleId);
    } else {
      article = await ctx.db
        .query("articles")
        .withIndex("by_site_slug", (q) =>
          q.eq("siteId", site._id).eq("slug", normalizedSlug),
        )
        .first();
      if (!article) {
        article = await ctx.db
          .query("articles")
          .withIndex("by_site_slug", (q) =>
            q.eq("siteId", site._id).eq("slug", `/${normalizedSlug}`),
          )
          .first();
      }
    }
    if (!article || article.status !== "published") return null;

    return {
      _id: article._id,
      title: article.title,
      slug: normalizeSlug(article.slug || ""),
      markdown: article.markdown,
      metaDescription: article.metaDescription,
      metaKeywords: article.metaKeywords,
      featuredImage: article.featuredImage,
      readingTime: article.readingTime,
      wordCount: article.wordCount,
      sources: (article.sources ?? []).map((source) => ({
        url: source.url,
        title: source.title,
      })),
      internalLinks: article.internalLinks,
      factCheckScore: article.factCheckScore,
      createdAt: article.publishedAt ?? article.publicationDate ?? article.createdAt,
      publishedAt: article.publishedAt ?? article.publicationDate,
      updatedAt: article.updatedAt,
      brandPrimaryColor: site.brandPrimaryColor,
      brandAccentColor: site.brandAccentColor,
      brandFontFamily: site.brandFontFamily,
      siteName: site.siteName,
      domain: site.domain,
      urlStructure: site.urlStructure ?? "/blog/[slug]",
    };
  },
});
