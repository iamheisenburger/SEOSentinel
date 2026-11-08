import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Force the project root to this directory to avoid picking up parent lockfiles.
    root: __dirname,
  },
  // P385 (Nov 8 2026): Next 16.3 caches Turbopack's build work in .next/cache by default and Vercel restores that cache,
  // which served the previous design's stylesheet with P384's new pages (and a stale globals.css on Sep 24). Every
  // production build starts cold: a slower build is better than a stale page.
  experimental: {
    turbopackFileSystemCacheForBuild: false,
  },
  // P240 (Oct 29 2026): pentra.dev's article page and sitemap read the committed articles when Convex cannot be read.
  outputFileTracingIncludes: {
    "/blog/*": ["./content/blog/**/*"],
    "/sitemap.xml": ["./content/blog/**/*"],
  },
  // P296 (Nov 3 2026): the pages bots read most are served from Vercel's CDN for 5 minutes (stale up to a day while one
  // refresh runs), not a server render and a Convex read per request. A new article's address is never cached before its
  // first request, and Pentra's live checks retry for hours, so publication checks are unaffected.
  async headers() {
    const cdn = [{ key: "Vercel-CDN-Cache-Control", value: "max-age=300, stale-while-revalidate=86400" }];
    return [{ source: "/blog", headers: cdn }, { source: "/blog/:path*", headers: cdn }, { source: "/sitemap.xml", headers: cdn }];
  },
};

export default nextConfig;
