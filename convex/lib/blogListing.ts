import { v, type Infer } from "convex/values";

/** P241 (Oct 29 2026): one row of a Pentra-hosted blog's listing (the /blog index, each article's related guides, the home
 * page's latest guides) and of its sitemap, exactly as convex/blog.ts computes them. A site's rows are stored in
 * blog_listings and refreshed every 3 hours: computed on every request, the listing and the sitemap read ~2 MB each from
 * Convex (the sitemap was the largest single reader, 51.5 MB in the 24 hours to Oct 29, plus 25.7 MB for the listing). */
export const blogListingRow = v.object({
  _id: v.id("articles"),
  title: v.string(),
  slug: v.string(),
  metaDescription: v.optional(v.string()),
  featuredImage: v.optional(v.string()),
  readingTime: v.optional(v.number()),
  createdAt: v.number(),
});
export const blogSitemapRow = v.object({ slug: v.string(), updatedAt: v.number() });
export type BlogListingRow = Infer<typeof blogListingRow>;
export type BlogSitemapRow = Infer<typeof blogSitemapRow>;

/** The blogs Pentra renders itself (its own site). Every other site's articles live on its own platform. */
export const HOSTED_BLOG_DOMAINS: readonly string[] = ["pentra.dev"];

/** A stored listing older than this is not served; the live computation answers instead (the refresh stopped). */
export const BLOG_LISTING_MAX_AGE_MS = 12 * 3_600_000;
