import assert from "node:assert/strict";
import test from "node:test";
import { analyzePageHealth, healthScore, sitemapUrls } from "../convex/lib/siteHealth.ts";

const good = `<!doctype html><html><head><title>Acme Plumbing | Emergency plumbers in Leeds</title>
<meta name="description" content="Acme Plumbing fixes leaks, boilers and blocked drains across Leeds with same-day emergency visits and upfront fixed prices.">
<link rel="canonical" href="https://acme.example/"><script type="application/ld+json">{"@type":"Plumber"}</script></head><body><h1>Emergency plumbers in Leeds</h1>
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
  assert.deepEqual(codes, ["canonical_other", "description_missing", "h1_multiple", "no_internal_links", "noindex", "schema_missing", "thin_text", "title_missing"].sort());
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
  const blocking = robotsTxtFindings("User-agent: *\nDisallow: /\nSitemap: https://acme.example/sm.xml");
  assert.equal(blocking.blocksAll, true); assert.deepEqual(blocking.sitemaps, ["https://acme.example/sm.xml"]);
  assert.equal(robotsTxtFindings("User-agent: *\nDisallow: /admin\n").blocksAll, false);
  assert.equal(robotsTxtFindings("User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n").blocksAll, false);
  assert.equal(robotsTxtFindings("User-agent: Googlebot\nDisallow: / # everything\n").blocksAll, true);
  assert.deepEqual(sitemapIndexChildren(`<sitemapindex><sitemap><loc>https://acme.example/posts.xml</loc></sitemap><sitemap><loc>https://evil.example/x.xml</loc></sitemap></sitemapindex>`, "acme.example"), ["https://acme.example/posts.xml"]);
  assert.deepEqual(sitemapIndexChildren("<urlset></urlset>", "acme.example"), []);
});

test("titles are measured after decoding HTML entities", () => {
  const html = `<html><head><title>Sales Automation Chat Widget: A Practical Buyer&#x27;s Guide | LeadPilot</title></head><body><h1>x</h1></body></html>`;
  const result = analyzePageHealth({ url: "https://acme.example/", status: 200, html });
  assert.equal(result.title, "Sales Automation Chat Widget: A Practical Buyer's Guide | LeadPilot");
  assert.ok(result.issues.find(i => i.code === "title_long")!.message.includes("67 characters"));
});

test("speed findings come only from real PageSpeed data", async () => {
  const { speedFindings } = await import("../convex/lib/siteHealth.ts");
  const slow = speedFindings({ lighthouseResult: { categories: { performance: { score: 0.42 } },
    audits: { "largest-contentful-paint": { numericValue: 5200 }, "cumulative-layout-shift": { numericValue: 0.02 } } } });
  assert.deepEqual(slow.map(i => [i.code, i.severity]), [["speed_poor", "critical"], ["lcp_slow", "critical"]]);
  assert.match(slow[0].message, /42\/100/);
  assert.deepEqual(speedFindings({ lighthouseResult: { categories: { performance: { score: 0.97 } }, audits: {} } }), []);
  assert.deepEqual(speedFindings(null), []);
  assert.deepEqual(speedFindings({ error: { code: 429 } }), []);
});

test("a Googlebot group overrides a blocking * group, and bad entities never crash", async () => {
  const { robotsTxtFindings } = await import("../convex/lib/siteHealth.ts");
  assert.equal(robotsTxtFindings("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow:\n").blocksAll, false);
  assert.equal(robotsTxtFindings("User-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /\n").blocksAll, true);
  const odd = analyzePageHealth({ url: "https://acme.example/", status: 200, html: "<title>A &#1114112; B &#x110000; title here</title>" });
  assert.equal(odd.title, "A B title here");
});

test("pages without a link to the next-step page are flagged; the next-step page itself is not", () => {
  const cta = "https://acme.example/book";
  assert.ok(analyzePageHealth({ url: "https://acme.example/", status: 200, html: good, ctaUrl: cta }).issues.some(i => i.code === "no_next_step"));
  const linked = good.replace('<a href="/services">', '<a href="/book/">Book</a><a href="/services">');
  assert.deepEqual(analyzePageHealth({ url: "https://acme.example/", status: 200, html: linked, ctaUrl: cta }).issues, []);
  assert.ok(!analyzePageHealth({ url: "https://acme.example/book", status: 200, html: good, ctaUrl: cta }).issues.some(i => i.code === "no_next_step"));
});

test("AI answer engines blocked by robots.txt are named; training-only bots are not", async () => {
  const { robotsTxtFindings } = await import("../convex/lib/siteHealth.ts");
  assert.deepEqual(robotsTxtFindings("User-agent: *\nAllow: /\n").aiBlocked, []);
  assert.deepEqual(robotsTxtFindings("User-agent: GPTBot\nDisallow: /\n\nUser-agent: Google-Extended\nDisallow: /\n").aiBlocked, []);
  assert.deepEqual(robotsTxtFindings("User-agent: PerplexityBot\nUser-agent: OAI-SearchBot\nDisallow: /\n").aiBlocked, ["ChatGPT search", "Perplexity"]);
  const all = robotsTxtFindings("User-agent: *\nDisallow: /\n");
  assert.equal(all.blocksAll, true); assert.equal(all.aiBlocked.length, 5);
  assert.deepEqual(robotsTxtFindings("User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n\nUser-agent: Bingbot\nAllow: /\n").aiBlocked,
    ["ChatGPT search", "ChatGPT", "Perplexity", "Claude search"]);
});

test("discovery findings: missing homepage canonical, soft 404s and a temporary www redirect", async () => {
  const { discoveryFindings } = await import("../convex/lib/siteHealth.ts");
  const codes = (input: Parameters<typeof discoveryFindings>[0]) => discoveryFindings(input).map(issue => issue.code);
  assert.deepEqual(codes({ homeUrl: "https://example.com/", homeStatus: 200, homeHtml: "<html><head><title>x</title></head></html>",
    missingPageStatus: 200, alternateHost: { status: 307, location: "https://example.com/" } }),
    ["home_canonical_missing", "soft_404", "host_redirect_temporary"]);
  assert.deepEqual(codes({ homeUrl: "https://example.com/", homeStatus: 200, homeHtml: '<link rel="canonical" href="https://example.com/">',
    missingPageStatus: 404, alternateHost: { status: 308, location: "https://example.com/" } }), []);
  assert.deepEqual(codes({ homeUrl: "https://example.com/", homeStatus: 200, homeHtml: '<link rel="canonical" href="/">',
    missingPageStatus: null, alternateHost: { status: 307, location: "https://elsewhere.example/" } }), [], "a redirect to another site is not ours to judge");
  assert.match(discoveryFindings({ homeUrl: "https://www.example.com/", homeStatus: 200, homeHtml: '<link rel="canonical" href="/">',
    missingPageStatus: 404, alternateHost: { status: 302, location: "https://www.example.com/" } })[0].message, /non-www address/);
});

test("article discovery: live articles missing from the sitemap and an unlinked newest article are found", async () => {
  const { articleDiscoveryFindings, discoveryPageKey, linkedPageKeys, listingPageCandidates, sitemapPageKeys } = await import("../convex/lib/siteHealth.ts");
  // One page identity regardless of protocol, www, trailing slash, query or fragment.
  assert.equal(discoveryPageKey("http://www.Acme.example/blog/post/?utm=1#top"), "acme.example/blog/post");
  assert.equal(discoveryPageKey("https://acme.example/"), "acme.example/");
  assert.equal(discoveryPageKey("mailto:hi@acme.example"), null);
  const listed = new Set(sitemapPageKeys(`<urlset><url><loc>http://acme.example/blog/listed/</loc></url><url><loc>https://www.acme.example/</loc></url></urlset>`));
  assert.deepEqual([...listed], ["acme.example/blog/listed", "acme.example/"], "an http:// or www sitemap entry still counts");
  const articles = ["https://acme.example/blog/listed", "https://acme.example/blog/missing", "https://acme.example/blog/merged", "https://acme.example/blog/unknown"];
  const codes = (input: Parameters<typeof articleDiscoveryFindings>[0]) => articleDiscoveryFindings(input).map(issue => issue.code);
  const found = articleDiscoveryFindings({ articleUrls: articles, sitemapKeys: listed,
    servedStatus: { "https://acme.example/blog/missing": 200, "https://acme.example/blog/merged": 308 }, newestLinked: true });
  assert.deepEqual(found.map(issue => [issue.code, issue.severity]), [["articles_missing_from_sitemap", "critical"]]);
  assert.match(found[0].message, /^1 of your recent articles is live but not in your sitemap.*\/blog\/missing/,
    "only a page served on its own address counts: a permanent redirect (consolidated) or an unknown status never does");
  assert.deepEqual(codes({ articleUrls: articles, sitemapKeys: null, servedStatus: { "https://acme.example/blog/missing": 200 }, newestLinked: null }), [],
    "a sitemap that couldn't be read completely, or an unknown link state, never produces a finding");
  assert.deepEqual(codes({ articleUrls: [], sitemapKeys: listed, servedStatus: {}, newestLinked: false }), ["newest_article_not_linked"]);
  // Links resolve against the page, with or without www, trailing slash or fragment.
  const links = linkedPageKeys(`<a class="x" href="/blog/new-post/">New</a><a href='https://www.acme.example/about#team'>About</a><a href="javascript:void(0)">x</a>`, "https://acme.example/blog");
  assert.ok(links.has("acme.example/blog/new-post") && links.has("acme.example/about"));
  assert.equal(links.size, 2);
  assert.deepEqual(listingPageCandidates(`<a href="/blog/">Blog</a><a href="https://other.example/news">x</a><a href="/pricing">p</a><a href="/news?page=1">News</a>`, "https://acme.example/"),
    ["https://acme.example/blog/", "https://acme.example/news"], "only same-site listing pages are followed");
});
