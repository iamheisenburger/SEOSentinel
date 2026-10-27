import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PENTRA_CONSOLIDATED, canonicalBlogHref, consolidatedTarget, servedDestinations, servedOnItsOwnUrl } from "../src/lib/pentra-consolidation.ts";

test("pentra.dev consolidation: one hop to a served article, never a chain or a loop", () => {
  const entries = Object.entries(PENTRA_CONSOLIDATED);
  assert.ok(entries.length >= 85);
  for (const [from, to] of entries) {
    assert.notEqual(from, to);
    assert.match(from, /^[a-z0-9-]+$/); assert.match(to, /^[a-z0-9-]+$/);
    assert.equal(PENTRA_CONSOLIDATED[to], undefined, `${to} must be served, not redirected again`);
  }
  assert.equal(consolidatedTarget("pentra.dev", "keyword-clustering-explained"), "keyword-clustering-strategy-organize-by-intent");
  assert.equal(consolidatedTarget("www.pentra.dev", "/keyword-clustering-explained/"), "keyword-clustering-strategy-organize-by-intent");
  assert.equal(consolidatedTarget("leadpilot.chat", "keyword-clustering-explained"), null, "customer sites are never affected");
  assert.equal(consolidatedTarget("pentra.dev", "niche-detection-practical-guide"), null);
  assert.equal(consolidatedTarget("pentra.dev", "constructor"), null);
  assert.equal(servedOnItsOwnUrl("pentra.dev", "keyword-clustering-strategy-organize-by-intent"), true);
});

test("consolidated slugs redirect permanently and leave the sitemap, the blog index and the homepage", () => {
  const post = readFileSync("src/app/blog/[slug]/page.tsx", "utf8");
  assert.equal(post.match(/permanentRedirect\(`\/blog\/\$\{merged\}`\)/g)?.length, 2, "metadata and page both redirect before reading the article");
  for (const file of ["src/app/blog/page.tsx", "src/app/sitemap.ts", "src/app/page.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /servedOnItsOwnUrl\(/, file);
  }
});

// P193 (Oct 25 2026): Google showed 30 of pentra.dev's 82 live articles. Round-1 survivors it never showed and recent
// copies of pages it already indexed (left "Discovered - currently not indexed") join the page Google shows.
test("P193: copies Google skipped and pages it never showed join the page Google shows, in one hop", () => {
  const to = (slug: string) => consolidatedTarget("pentra.dev", slug);
  assert.equal(to("auto-posting-wordpress-methods-and-checks"), "publish-blog-posts-wordpress-nextjs-automatically");
  assert.equal(to("keyword-research-digital-marketing-channel-routing"), "digital-marketing-keyword-guide");
  assert.equal(to("international-keyword-research"), "localized-keyword-research-2");
  assert.equal(to("automatic-content-creation"), "intelligent-content-automation");
  assert.equal(to("automate-seo-article-writing-at-scale"), "automated-seo-workflow-complete-guide");
  // A round-1 survivor Google never showed now points on, and its round-1 duplicates follow it directly.
  assert.equal(to("when-update-blog-posts-seo-rankings"), "article-refresh-strategy-guide");
  assert.equal(to("when-to-refresh-old-blog-posts"), "article-refresh-strategy-guide");
  assert.equal(to("monitor-seo-rankings-automatically"), "best-seo-monitoring-tools-small-teams");
  assert.equal(to("free-seo-content-generator-evaluation-guide"), "ai-content-generator-seo-automated-article-writing");
  for (const shown of ["automated-seo-workflow-complete-guide", "digital-marketing-keyword-guide", "localized-keyword-research-2",
    "intelligent-content-automation", "how-to-detect-ranking-drops-seo", "best-seo-monitoring-tools-small-teams", "seo-content-calendar-tools-small-teams",
    "article-refresh-strategy-guide", "publish-blog-posts-wordpress-nextjs-automatically"]) {
    assert.equal(servedOnItsOwnUrl("pentra.dev", shown), true, shown);
  }
  // Recent articles Google indexed, or has not had 14 days to judge, keep their own URLs.
  for (const kept of ["saas-keyword-research", "how-often-should-small-business-publish-blog-posts",
    "ecommerce-keyword-research-2", "free-seo-content-writing-software", "improving-pages-close-to-page-one"]) {
    assert.equal(servedOnItsOwnUrl("pentra.dev", kept), true, kept);
  }
});

// P227 (Oct 27 2026): each page Google stopped showing fell 1-5 days after Pentra published another page on its topic:
// the fact-check framework (positions 8-15) last showed Oct 1, two days after "How Do I Fact-Check AI-Generated Articles
// Before Publishing?" went live; neither has been shown since. Two pages answering one question become one again.
test("P227: two pages answering one question become one, in one hop", () => {
  const to = (slug: string) => consolidatedTarget("pentra.dev", slug);
  assert.equal(to("how-to-fact-check-ai-generated-articles"), "fact-check-ai-generated-content-verification-framework");
  assert.equal(to("how-often-publish-blog-posts-seo"), "how-often-should-small-business-publish-blog-posts");
  // The page that pointed to the calendar article goes straight to its new destination.
  assert.equal(to("saas-blog-publishing-frequency-rankings"), "how-often-should-small-business-publish-blog-posts");
  for (const kept of ["fact-check-ai-generated-content-verification-framework", "how-often-should-small-business-publish-blog-posts",
    "website-crawling-keyword-research-guide", "website-crawling-for-seo-guide", "get-customers-from-google-without-writing-every-article",
    "writing-every-article-yourself-practical-guide"]) assert.equal(servedOnItsOwnUrl("pentra.dev", kept), true, kept);
});

test("P193: links inside an article go straight to the consolidated article; any other link is untouched", () => {
  assert.equal(canonicalBlogHref("pentra.dev", "/blog/auto-posting-wordpress-methods-and-checks"), "/blog/publish-blog-posts-wordpress-nextjs-automatically");
  assert.equal(canonicalBlogHref("pentra.dev", "https://pentra.dev/blog/when-update-blog-posts-seo/"), "/blog/article-refresh-strategy-guide");
  assert.equal(canonicalBlogHref("www.pentra.dev", "https://www.pentra.dev/blog/international-keyword-research#steps"), "/blog/localized-keyword-research-2");
  assert.equal(canonicalBlogHref("pentra.dev", "/blog/saas-keyword-research"), "/blog/saas-keyword-research");
  assert.equal(canonicalBlogHref("pentra.dev", "https://example.com/blog/international-keyword-research"), "https://example.com/blog/international-keyword-research");
  assert.equal(canonicalBlogHref("leadpilot.chat", "/blog/international-keyword-research"), "/blog/international-keyword-research", "customer sites are never affected");
  const post = readFileSync("src/app/blog/[slug]/page.tsx", "utf8");
  assert.match(post, /const target = href \? canonicalBlogHref\(domain, href\) : href;/);
  assert.match(post, /if \(target !== href && target === `\/blog\/\$\{slug\}`\) return <>\{children\}<\/>;/, "never a link to the page itself");
  assert.match(post, /<MarkdownRenderer markdown=\{article\.markdown\} domain=\{domain\} slug=\{slug\} \/>/);
});

test("P193: the sitemap lists only pages that answer 200 (/pricing redirects to the home page)", () => {
  assert.doesNotMatch(readFileSync("src/app/sitemap.ts", "utf8"), /url: `\$\{baseUrl\}\/pricing`/);
});

test("the IndexNow key file is public and matches its script", () => {
  const script = readFileSync("scripts/indexnow-submit.mjs", "utf8");
  const key = /const KEY = "([a-f0-9]{32})"/.exec(script)?.[1];
  assert.ok(key);
  assert.equal(readFileSync(`public/${key}.txt`, "utf8").trim(), key);
  const proxy = readFileSync("src/proxy.ts", "utf8");
  assert.ok(new RegExp(/PUBLIC_VERIFICATION_FILE = \/(.+)\/;/.exec(proxy)![1].replace(/\\\//g, "/")).test(`/${key}.txt`));
});


// P217 (Oct 26 2026): Convex still treated consolidated pentra.dev pages as live, so new articles linked them and the
// page they lead to showed under the merged page's title (45 Related reading links on 19 pages, 10 lists linking one
// page twice). Every link builder now offers only pages served on their own URL.
test("P217 new internal links go only to pentra.dev pages served on their own URL", () => {
  const merged = "how-to-refresh-blog-posts-for-seo", survivor = PENTRA_CONSOLIDATED[merged];
  const kept = servedDestinations("pentra.dev", [{ href: `/blog/${merged}`, title: "Merged page" },
    { href: `/blog/${survivor}`, title: "Survivor" }, { href: "/pricing", title: "Pricing" },
    { href: `https://pentra.dev/blog/${merged}`, title: "Merged, absolute" }]);
  assert.deepEqual(kept.map(d => d.title), ["Survivor", "Pricing"]);
  assert.equal(servedDestinations("leadpilot.chat", [{ href: `/blog/${merged}` }]).length, 1, "another site's links are untouched");
  for (const [file, count] of [["convex/actions/pipeline.ts", 1], ["convex/articles.ts", 1], ["convex/publishedRevisions.ts", 2]] as const) {
    assert.equal((readFileSync(file, "utf8").match(/servedDestinations\(site\.domain,/g) ?? []).length, count, `${file} filters its link destinations`);
  }
});

// P219 (Oct 26 2026): a page consolidated away answers 308, so a change delivered to it can never be verified live
// (Pentra's live check needs the page at its own address). Once P218 made merged-link lists repair work, 3 of
// pentra.dev's 19 queued pages were such redirects, and P209 would have renewed another for the repair.
test("P219 the link repair, its adoption and page refreshes never pick a page consolidated away", () => {
  const improvements = readFileSync("convex/contentImprovements.ts", "utf8"), selected = readFileSync("convex/selectedPages.ts", "utf8");
  assert.match(improvements, /for \(const page of pages\) \{\n    const e = page\.editable;\n    \/\/ P219[^\n]*\n    if \(!servedOnItsOwnUrl\(site\.domain, page\.slug\)\) continue;/,
    "the repair chain skips a page that redirects");
  assert.match(selected, /const candidates = pages\.filter\(p => p\.editable\?\.active && servedOnItsOwnUrl\(site\.domain, p\.slug\)/, "page refreshes skip it");
  assert.match(selected, /article\.status !== "published" \|\| !servedOnItsOwnUrl\(site\.domain, article\.slug\)/, "adoption skips it");
  assert.match(readFileSync("convex/opsProbes.ts", "utf8"), /!servedOnItsOwnUrl\(site\.domain, row\.slug\) \? "redirects"/, "the probe says so");
  assert.equal(servedOnItsOwnUrl("pentra.dev", "/international-keyword-research"), false, "a queued page that redirects");
});
