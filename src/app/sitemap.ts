import type { MetadataRoute } from "next";
import { convexHttp } from "@/lib/convexHttpClient";
import { api } from "../../convex/_generated/api";
import { servedOnItsOwnUrl } from "@/lib/pentra-consolidation";

// A build-time outage must not freeze an incomplete sitemap until redeploy.
// Read current publication/domain state; never cache revoked URLs as truth.
export const dynamic = "force-dynamic";

// Domain from env or fallback — not hardcoded
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pentra.dev";
const domain = baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages carry no lastmod: "now" on every request (as before Oct 21
  // 2026) is a date Google learns to ignore. The blog index takes its newest
  // article's date below.
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/blog`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/pricing`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/check`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/contact`, changeFrequency: "monthly", priority: 0.5 },
  ];

  // Dynamic blog posts from Convex
  const result = await convexHttp.query(api.blog.listPublishedSlugs, { domain });
  const urlStructure = result.urlStructure ?? "/blog/[slug]";

  const blogPages = result.articles.filter((article: { slug: string }) => servedOnItsOwnUrl(domain, article.slug)).map((article: { slug: string; updatedAt?: number }) => {
    // Build URL respecting the site's configured URL structure.
    const path = urlStructure.replace(/\[slug\]/i, article.slug);
    return {
      url: `${baseUrl}${path}`,
      ...(article.updatedAt ? { lastModified: new Date(article.updatedAt) } : {}),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    };
  });
  const newest = Math.max(0, ...result.articles.map((article: { updatedAt?: number }) => article.updatedAt ?? 0));
  if (newest > 0) staticPages[1] = { ...staticPages[1], lastModified: new Date(newest) };

  return [...staticPages, ...blogPages];
}
