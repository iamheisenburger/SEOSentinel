// P296 (Nov 3 2026): Vercel paused pentra.dev and leadpilot.chat on Nov 2 for the Hobby plan's Fluid Active CPU limit (the
// team's dashboard: "Paused since Nov 2, 2026 for Fluid Active CPU"). In Next 16 the request proxy runs as a Node function,
// so Clerk ran on every request, bots included, and the blog, its articles and the sitemap were rendered fresh each time.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const matcher = (() => {
  const source = readFileSync("src/proxy.ts", "utf8");
  const pattern = /matcher: \[\n\s+"([^"]+)",/.exec(source)![1].replace(/\\\\/g, "\\");
  return new RegExp(`^${pattern}$`);
})();

test("P296 public pages that never read the session skip the Clerk proxy; the app and the API keep it", () => {
  for (const path of ["/blog", "/blog/seo-automation", "/check/plausible.io", "/legal/privacy", "/sitemap.xml", "/robots.txt",
    "/0123456789abcdef0123456789abcdef.txt", "/_next/static/x.js", "/logo.png"]) assert.ok(!matcher.test(path), `${path} skips the proxy`);
  for (const path of ["/", "/dashboard", "/sign-in", "/settings/billing", "/articles/abc", "/pricing", "/my-prefix/article-slug", "/blogger"])
    assert.ok(matcher.test(path), `${path} keeps the proxy`);
  assert.match(readFileSync("src/proxy.ts", "utf8"), /"\/\(api\|trpc\)\(\.\*\)",/, "every API route keeps it");
});

test("P296 the blog and sitemap are served from Vercel's CDN for 5 minutes", () => {
  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /\{ key: "Vercel-CDN-Cache-Control", value: "max-age=300, stale-while-revalidate=86400" \}/);
  for (const source of ['"/blog"', '"/blog/:path*"', '"/sitemap.xml"']) assert.ok(config.includes(`source: ${source}`), source);
});
