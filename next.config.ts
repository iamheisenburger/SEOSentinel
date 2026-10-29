import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // Force the project root to this directory to avoid picking up parent lockfiles.
    root: __dirname,
  },
  // P240 (Oct 29 2026): pentra.dev's article page and sitemap read the committed articles when Convex cannot be read.
  outputFileTracingIncludes: {
    "/blog/*": ["./content/blog/**/*"],
    "/sitemap.xml": ["./content/blog/**/*"],
  },
};

export default nextConfig;
