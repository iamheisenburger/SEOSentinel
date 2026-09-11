import type { MetadataRoute } from "next";
import { convexHttp } from "@/lib/convexHttpClient";
import { api } from "../../convex/_generated/api";

// A build-time outage must not freeze an incomplete sitemap until redeploy.
// Read current publication/domain state; never cache revoked URLs as truth.
export const dynamic = "force-dynamic";

// Domain from env or fallback — not hardcoded
const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pentra.dev";
const domain = baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/pricing`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/contact`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];

  // Dynamic blog posts from Convex
  const result = await convexHttp.query(api.blog.listPublishedSlugs, { domain });
  const urlStructure = result.urlStructure ?? "/blog/[slug]";

  const blogPages = result.articles.map((article: { slug: string; updatedAt?: number }) => {
    // Build URL respecting the site's configured URL structure.
    const path = urlStructure.replace(/\[slug\]/i, article.slug);
    return {
      url: `${baseUrl}${path}`,
      lastModified: article.updatedAt ? new Date(article.updatedAt) : new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    };
  });

  return [...staticPages, ...blogPages];
}
