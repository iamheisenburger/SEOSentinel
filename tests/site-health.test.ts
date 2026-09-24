import assert from "node:assert/strict";
import test from "node:test";
import { analyzePageHealth, healthScore, sitemapUrls } from "../convex/lib/siteHealth.ts";

const good = `<!doctype html><html><head><title>Acme Plumbing | Emergency plumbers in Leeds</title>
<meta name="description" content="Acme Plumbing fixes leaks, boilers and blocked drains across Leeds with same-day emergency visits and upfront fixed prices.">
<link rel="canonical" href="https://acme.example/"></head><body><h1>Emergency plumbers in Leeds</h1>
<p>${"We repair leaks and boilers across Leeds. ".repeat(30)}</p><a href="/services">Services</a></body></html>`;

test("a healthy page has no findings", () => {
  const result = analyzePageHealth({ url: "https://acme.example/", status: 200, html: good });
  assert.deepEqual(result.issues, []);
  assert.equal(result.h1Count, 1);
  assert.equal(healthScore([result]), 100);
});

test("common on-page problems are reported in plain language", () => {
  const html = `<html><head><meta name="robots" content="noindex,follow"><link rel="canonical" href="https://other.example/page"></head>
<body><h1>A</h1><h1>B</h1><p>Short.</p></body></html>`;
  const result = analyzePageHealth({ url: "https://acme.example/page", status: 200, html });
  const codes = result.issues.map(i => i.code).sort();
  assert.deepEqual(codes, ["canonical_other", "description_missing", "h1_multiple", "no_internal_links", "noindex", "thin_text", "title_missing"].sort());
  assert.ok(result.issues.find(i => i.code === "noindex")!.severity === "critical");
  assert.ok(healthScore([result]) < 50);
});

test("unreachable pages and X-Robots-Tag noindex are critical", () => {
  assert.equal(analyzePageHealth({ url: "https://acme.example/x", status: 404, html: "" }).issues[0].code, "unreachable");
  const header = analyzePageHealth({ url: "https://acme.example/", status: 200, html: good, robotsHeader: "noindex" });
  assert.ok(header.issues.some(i => i.code === "noindex"));
});

test("sitemap parsing keeps only first-party HTTPS pages and is bounded", () => {
  const xml = `<urlset><url><loc>https://acme.example/</loc></url><url><loc>https://www.acme.example/a</loc></url>
<url><loc>http://acme.example/insecure</loc></url><url><loc>https://evil.example/x</loc></url><url><loc>https://acme.example/sitemap-2.xml</loc></url>
<url><loc>https://acme.example/b</loc></url></urlset>`;
  assert.deepEqual(sitemapUrls(xml, "acme.example"), ["https://acme.example/", "https://www.acme.example/a", "https://acme.example/b"]);
  assert.equal(sitemapUrls(xml, "acme.example", 1).length, 1);
});

test("robots.txt that blocks everything is found, and declared sitemaps are read", async () => {
  const { robotsTxtFindings, sitemapIndexChildren } = await import("../convex/lib/siteHealth.ts");
  assert.deepEqual(robotsTxtFindings("User-agent: *\nDisallow: /\nSitemap: https://acme.example/sm.xml"), { blocksAll: true, sitemaps: ["https://acme.example/sm.xml"] });
  assert.equal(robotsTxtFindings("User-agent: *\nDisallow: /admin\n").blocksAll, false);
  assert.equal(robotsTxtFindings("User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n").blocksAll, false);
  assert.equal(robotsTxtFindings("User-agent: Googlebot\nDisallow: / # everything\n").blocksAll, true);
  assert.deepEqual(sitemapIndexChildren(`<sitemapindex><sitemap><loc>https://acme.example/posts.xml</loc></sitemap><sitemap><loc>https://evil.example/x.xml</loc></sitemap></sitemapindex>`, "acme.example"), ["https://acme.example/posts.xml"]);
  assert.deepEqual(sitemapIndexChildren("<urlset></urlset>", "acme.example"), []);
});
