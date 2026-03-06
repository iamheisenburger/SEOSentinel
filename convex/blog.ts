import { query } from "./_generated/server";
import { v } from "convex/values";

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

export const listPublishedByDomain = query({
  args: { domain: v.string() },
  handler: async (ctx, { domain }) => {
    const sites = await ctx.db.query("sites").collect();
    const site = sites.find((s) => normalizeDomain(s.domain || "") === domain);
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
        slug: normalizeSlug(a.slug || ""),
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
    const site = sites.find((s) => normalizeDomain(s.domain || "") === domain);
    if (!site) return null;

    const all = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();
    const article = all.find(
      (a) => normalizeSlug(a.slug || "") === normalizeSlug(slug) && a.status === "published",
    );
    if (!article) return null;

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
