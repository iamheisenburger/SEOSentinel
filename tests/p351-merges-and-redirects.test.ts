// Phase 1 (Nov 2026): a published address never changes what it is; duplicates (pages Google shows for the same
// searches) merge into the stronger page with a permanent redirect, delivered where the site's pages are served and
// checked by fetching the old address; the diagnosis crawl reads links, the sitemap, descriptions and headings.
// Fictional sites only (Quillpad, Fernwood Decks): every rule fires on measured data, never on who the site is.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import { duplicatePairs, planMerges, searchOverlap, slugKey, type PageSearches } from "../convex/lib/duplicatePages.ts";
import { diagnoseSite, type CrawledPage, type GscRow } from "../convex/lib/siteDiagnosis.ts";
import { editVercelRedirects } from "../convex/lib/vercelRedirects.ts";
import { servedDestinations, servedOnItsOwnUrl } from "../convex/lib/pentraConsolidation.ts";

type Row = Record<string, unknown>;
const page = (url: string, clicks: number, entries: Array<[string, number, number]>): PageSearches => ({
  url, clicks, impressions: entries.reduce((s, [, n]) => s + n, 0),
  queries: new Map(entries.map(([query, impressions, position]) => [query, { impressions, position }])),
});

test("duplicates are measured from Search Console's overlap, and each group merges into the page Google ranks best", () => {
  // Shaped like LeadPilot's real "lead scoring system" articles (Nov 5 2026): ~0.5 overlap with one another, every other
  // pair far below.
  const a = page("https://quillpad.example/blog/scoring-handoff", 0, [["lead scoring system", 50, 14.8], ["lead handoff", 48, 30]]);
  const b = page("https://quillpad.example/blog/scoring-system-2", 0, [["lead scoring system", 49, 16], ["scoring model build", 49, 22]]);
  const c = page("https://quillpad.example/blog/crm-scoring", 0, [["lead scoring system", 48, 24.4], ["scoring model build", 30, 25], ["crm scoring", 50, 30]]);
  const d = page("https://quillpad.example/blog/best-practices", 0, [["lead scoring best practices", 109, 14], ["scoring model build", 5, 40]]);
  const e = page("https://quillpad.example/blog/solutions", 0, [["lead scoring solutions", 200, 40], ["lead scoring best practices", 6, 58]]);
  assert.equal(searchOverlap(a, b).overlap, 0.5);
  assert.ok(searchOverlap(d, e).overlap < 0.1, "a page that barely shows for another's search is not its duplicate");
  assert.deepEqual(duplicatePairs([a, b, c, d, e]).map((p) => [p.a.url.split("/").pop(), p.b.url.split("/").pop()]),
    [["scoring-system-2", "crm-scoring"], ["scoring-handoff", "scoring-system-2"], ["scoring-handoff", "crm-scoring"]]);
  const merges = planMerges([a, b, c, d, e], () => true);
  assert.deepEqual(merges.map((m) => [m.from.split("/").pop(), m.to.split("/").pop()]),
    [["scoring-system-2", "scoring-handoff"], ["crm-scoring", "scoring-handoff"]], "the page ranking 14.8 on the shared searches keeps them");
  assert.equal(merges[0].searches[0], "lead scoring system");
});

test("merging: clicks beat position, two page-one results stay, nothing merges through a third page, nothing below the minimums", () => {
  const withClicks = planMerges([
    page("https://quillpad.example/blog/a", 0, [["q", 60, 12]]), page("https://quillpad.example/blog/b", 6, [["q", 50, 19]])], () => true);
  assert.deepEqual(withClicks.map((m) => m.to.split("/").pop()), ["b"], "the page people click is kept");
  assert.deepEqual(planMerges([page("https://quillpad.example/blog/a", 0, [["q", 60, 3]]), page("https://quillpad.example/blog/b", 0, [["q", 50, 6]])], () => true), [],
    "two results on page one is a win, not a split");
  const chain = planMerges([
    page("https://quillpad.example/blog/a", 0, [["q1", 60, 12], ["q9", 40, 30]]),
    page("https://quillpad.example/blog/b", 0, [["q1", 50, 15], ["q2", 50, 18]]),
    page("https://quillpad.example/blog/c", 0, [["q2", 60, 25], ["q3", 40, 40]])], () => true);
  assert.deepEqual(chain.map((m) => [m.from.split("/").pop(), m.to.split("/").pop()]), [["b", "a"]], "c doesn't duplicate a: it stays");
  assert.deepEqual(planMerges([page("https://quillpad.example/blog/a", 0, [["q", 12, 12]]), page("https://quillpad.example/blog/b", 0, [["q", 12, 15]])], () => true), [],
    "a dozen impressions decide nothing");
  assert.deepEqual(planMerges([page("https://quillpad.example/blog/a", 0, [["q", 60, 12]]), page("https://quillpad.example/blog/b", 0, [["q", 50, 19]])],
    (url) => !url.endsWith("/b")), [], "a page that may not be merged is never merged");
  assert.equal(slugKey("/blog-post/"), "blog-post");
});

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
const series = (query: string, impressions: number, position: number, url: string): GscRow[] =>
  Array.from({ length: 28 }, (_, i) => ({ date: day(i), query, page: url, impressions: Math.round(impressions / 28), clicks: 0, position }));
const site = "https://quillpad.example";
const now = Date.UTC(2026, 9, 29);
const settled = now - 60 * 86_400_000;
const live = (path: string, extra: Partial<CrawledPage> = {}): CrawledPage => ({ url: `${site}${path}`, status: 200, title: path, description: true, h1: 1,
  words: 1200, images: 2, links: [], structuredData: true, article: true, publishedAt: settled, ...extra });

test("the diagnosis merges only live, settled articles Pentra published; a page that already redirects no longer competes", () => {
  const gsc = [...series("deck stain colors", 560, 18, `${site}/blog/stain`), ...series("deck stain colors", 392, 24, `${site}/blog/stain-2`),
    ...series("composite deck cost", 280, 30, `${site}/blog/cost`)];
  const pages = [live("/blog/stain"), live("/blog/stain-2"), live("/blog/cost")];
  const d = diagnoseSite({ domain: "quillpad.example", gsc, pages, now });
  assert.deepEqual(d.merges.map((m) => [m.from, m.to]), [[`${site}/blog/stain-2`, `${site}/blog/stain`]]);
  assert.ok(d.pageActions.find((p) => p.url.endsWith("/blog/stain-2"))!.actions.some((a) => a.startsWith("Merge into /blog/stain with a permanent redirect")));
  const fresh = diagnoseSite({ domain: "quillpad.example", gsc, pages: [live("/blog/stain"), live("/blog/stain-2", { publishedAt: now - 10 * 86_400_000 })], now });
  assert.deepEqual(fresh.merges, [], "a page published 10 days ago hasn't settled");
  const ownPage = diagnoseSite({ domain: "quillpad.example", gsc, pages: [live("/blog/stain"), live("/blog/stain-2", { article: false })], now });
  assert.deepEqual(ownPage.merges, [], "the site's own pages are never redirected by Pentra");
  assert.ok(ownPage.findings.some((f) => f.problem === "Its own pages compete for the same searches"), "but the overlap is still reported");
  const done = diagnoseSite({ domain: "quillpad.example", gsc, pages: [live("/blog/stain"), { url: `${site}/blog/stain-2`, status: 308, location: `${site}/blog/stain` }], now });
  assert.equal(done.findings.find((f) => f.problem === "Its own pages compete for the same searches"), undefined, "merged pages no longer compete");
});

test("index coverage from both sides, links between articles, the sitemap, descriptions and headings", () => {
  const gsc = [...series("deck stain colors", 560, 18, `${site}/blog/stain`), ...series("composite deck cost", 280, 30, `${site}/blog/cost`)];
  const pages = [
    live("/blog/stain", { links: ["quillpad.example/blog/cost"] }),
    live("/blog/cost", { links: ["quillpad.example/blog/stain"], description: false }),
    live("/blog/never-shown", { links: ["quillpad.example/blog/stain"], h1: 0, indexVerdict: "NEUTRAL", coverageState: "Crawled - currently not indexed" }),
    live("/blog/new", { publishedAt: now - 5 * 86_400_000, links: [] }),
    { url: `${site}/blog/old`, status: 308, location: `${site}/blog/stain` },
  ];
  const sitemap = { found: true, urls: [`${site}/blog/stain`, `${site}/blog/cost`, `${site}/blog/old`, `${site}/blog/new`] };
  const d = diagnoseSite({ domain: "quillpad.example", gsc, pages, sitemap, crawlComplete: true, now });
  const find = (problem: string) => d.findings.find((f) => f.problem === problem);
  assert.equal(find("Articles Google never shows")!.evidence, "1 of 3 articles older than 21 days got no impressions in 28 days (1 of them aren't indexed)");
  assert.deepEqual(find("Articles Google never shows")!.items, ["/blog/never-shown (Crawled - currently not indexed)"]);
  assert.deepEqual(find("Articles no other article links to")!.items, ["/blog/never-shown", "/blog/new"]);
  assert.deepEqual(find("Articles missing from the sitemap")!.items, ["/blog/never-shown"]);
  assert.deepEqual(find("The sitemap lists addresses that redirect or fail")!.items, ["/blog/old (HTTP 308)"]);
  assert.match(find("Pages without a meta description")!.evidence, /^1 of 4 pages have none/);
  assert.match(find("Pages without a main heading")!.evidence, /^1 of 4 pages have no H1/);
  const partial = diagnoseSite({ domain: "quillpad.example", gsc, pages, sitemap, crawlComplete: false, now });
  assert.equal(partial.findings.find((f) => f.problem === "Articles no other article links to"), undefined, "links are only counted when every article was read");
  assert.ok(diagnoseSite({ domain: "quillpad.example", gsc, pages, sitemap: { found: false, urls: [] }, now }).findings.some((f) => f.problem === "No sitemap"));
});

test("vercel.json: Pentra's entries are added or re-pointed; everything else stays as written; an unsafe file is never touched", () => {
  const created = editVercelRedirects(null, [{ source: "/blog/a-2", destination: "/blog/a" }]);
  assert.ok(created.ok && created.changed);
  assert.deepEqual(JSON.parse(created.text), { redirects: [{ source: "/blog/a-2", destination: "/blog/a", permanent: true }] });
  const owner = JSON.stringify({ framework: "nextjs", headers: [{ source: "/(.*)", headers: [] }], redirects: [{ source: "/old", destination: "/new", permanent: false }] });
  const added = editVercelRedirects(owner, [{ source: "/blog/b-2", destination: "/blog/b" }]);
  assert.ok(added.ok && added.changed);
  const parsed = JSON.parse(added.text);
  assert.equal(parsed.framework, "nextjs");
  assert.deepEqual(parsed.redirects, [{ source: "/old", destination: "/new", permanent: false }, { source: "/blog/b-2", destination: "/blog/b", permanent: true }]);
  assert.deepEqual(editVercelRedirects(added.text, [{ source: "/blog/b-2", destination: "/blog/b" }]), { ok: true, changed: false, skipped: [] }, "already there: no commit");
  const repointed = editVercelRedirects(added.text, [{ source: "/blog/b-2", destination: "/blog/c" }]);
  assert.ok(repointed.ok && repointed.changed);
  assert.deepEqual(JSON.parse(repointed.text).redirects.at(-1), { source: "/blog/b-2", destination: "/blog/c", permanent: true }, "re-pointed, never chained");
  assert.deepEqual(editVercelRedirects("{ not json", []), { ok: false, reason: "vercel.json isn't valid JSON" });
  assert.equal(editVercelRedirects(JSON.stringify({ routes: [] }), [{ source: "/a", destination: "/b" }]).ok, false);
  assert.equal(editVercelRedirects(JSON.stringify({ redirects: {} }), [{ source: "/a", destination: "/b" }]).ok, false);
  const unsafe = editVercelRedirects(null, [{ source: "/blog/:slug", destination: "/blog/x" }]);
  assert.deepEqual(unsafe, { ok: true, changed: false, skipped: ["/blog/:slug"] }, "a pattern would redirect every page");
});

/** Values made inside the bundle's sandbox, as plain values of this realm. */
const plain = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

function bundle(entry: string): Record<string, unknown> {
  const text = buildSync({ entryPoints: [entry], bundle: true, platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const mod = { exports: {} as Record<string, unknown> };
  runInNewContext(text, { module: mod, exports: mod.exports, require: createRequire(import.meta.url), URL, TextEncoder, TextDecoder, console,
    process: { env: {} }, Buffer, setTimeout, clearTimeout });
  return mod.exports;
}

test("the crawl records redirects without following them, and reads a page's description, heading and same-site links", async () => {
  const crawl = bundle("convex/lib/pageCrawl.ts") as { crawlPage: (url: string, deps: unknown) => Promise<CrawledPage>;
    readSitemap: (domain: string, deps: unknown) => Promise<{ found: boolean; urls: string[] }> };
  const html = `<html><head><title>Deck Stain Colors for Cedar</title><meta name="description" content="Which stain colors suit a cedar deck, with photos of each finish after a year outdoors.">
    <link rel="canonical" href="/blog/stain"></head><body><h1>Deck Stain Colors</h1><img src="a.jpg"><a href="/blog/cost">cost</a>
    <a href="https://www.quillpad.example/blog/railings#top">railings</a><a href="https://elsewhere.example/x">x</a><a href="mailto:a@b.c">mail</a></body></html>`;
  const deps = (status: number, location: string | null) => ({ redirectStatus: async () => ({ status, location }),
    fetch: async (url: string) => ({ status: 200, finalUrl: url, html, robots: null }), clock: (() => { let t = 0; return () => (t += 150); })() });
  assert.deepEqual(plain(await crawl.crawlPage(`${site}/blog/old`, deps(308, "/blog/stain"))), { url: `${site}/blog/old`, status: 308, location: `${site}/blog/stain` });
  assert.deepEqual(plain(await crawl.crawlPage(`${site}/blog/gone`, deps(404, null))), { url: `${site}/blog/gone`, status: 404 });
  const read = plain(await crawl.crawlPage(`${site}/blog/stain`, deps(200, null)));
  assert.equal(read.title, "Deck Stain Colors for Cedar");
  assert.equal(read.description, true);
  assert.equal(read.h1, 1);
  assert.equal(read.images, 1);
  assert.equal(read.canonical, `${site}/blog/stain`);
  assert.deepEqual(read.links, ["quillpad.example/blog/cost", "quillpad.example/blog/railings"], "same site only, www and fragments folded");
  const fallback = await crawl.crawlPage(`${site}/blog/stain`, { ...deps(200, null), redirectStatus: async () => { throw new Error("not html"); } });
  assert.equal(fallback.status, 200, "a page the redirect check can't read is read in full");
  const files: Record<string, string> = {
    "https://quillpad.example/robots.txt": "User-agent: *\nSitemap: https://quillpad.example/posts-sitemap.xml",
    "https://quillpad.example/sitemap.xml": `<sitemapindex><sitemap><loc>https://quillpad.example/pages-sitemap.xml</loc></sitemap></sitemapindex>`,
    "https://quillpad.example/pages-sitemap.xml": `<urlset><url><loc>https://quillpad.example/pricing</loc></url></urlset>`,
    "https://quillpad.example/posts-sitemap.xml": `<urlset><url><loc>https://www.quillpad.example/blog/stain</loc></url><url><loc>https://other.example/x</loc></url></urlset>`,
  };
  const sitemap = await crawl.readSitemap("quillpad.example", { fetch: async (url: string) => files[url]
    ? { status: 200, finalUrl: url, html: files[url], robots: null } : { status: 404, finalUrl: url, html: "", robots: null } });
  assert.deepEqual(plain(sitemap), { found: true, urls: ["https://www.quillpad.example/blog/stain", "https://quillpad.example/pricing"] });
});

/** A small in-memory Convex database: indexed equality reads, inserts and patches. */
function fakeDb(tables: Record<string, Row[]>) {
  const all = () => Object.values(tables).flat();
  return {
    async get(id: string) { return structuredClone(all().find((row) => row._id === id) ?? null); },
    async patch(id: string, patch: Row) {
      const row = all().find((r) => r._id === id)!;
      for (const [key, value] of Object.entries(patch)) { if (value === undefined) delete row[key]; else row[key] = structuredClone(value); }
    },
    async insert(table: string, values: Row) { const id = `${table}-${tables[table].length}`; tables[table].push({ _id: id, ...structuredClone(values) }); return id; },
    query(table: string) {
      const predicates: Array<(row: Row) => boolean> = [];
      const range = { eq(key: string, value: unknown) { predicates.push((row) => row[key] === value); return range; } };
      const rows = () => structuredClone((tables[table] ?? []).filter((row) => predicates.every((p) => p(row))));
      const chain = {
        withIndex(_name: string, fn?: (q: typeof range) => unknown) { fn?.(range); return chain; },
        order() { return chain; },
        async take(n: number) { return rows().slice(0, n); },
        async first() { return rows()[0] ?? null; },
        async unique() { return rows()[0] ?? null; },
        async collect() { return rows(); },
      };
      return chain;
    },
  };
}
type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };

test("recording merges: both articles published, no chains, and pages merged into the old address are re-pointed", async () => {
  const mod = bundle("convex/siteRedirects.ts") as Record<string, Handler>;
  const siteRow = { _id: "site", domain: "quillpad.example", canonicalDomain: "quillpad.example", canonicalDomainRevision: 0 };
  const summary = (slug: string, status = "published") => ({ _id: `sum-${slug}`, siteId: "site", slug, status, canonicalDomain: "quillpad.example", domainRevision: 0 });
  const tables: Record<string, Row[]> = { sites: [siteRow], article_summaries: [summary("a"), summary("/b"), summary("c"), summary("d"), summary("draft", "draft")],
    site_redirects: [{ _id: "old", siteId: "site", fromSlug: "x", toSlug: "b", reason: "merged_duplicate", delivery: "repository", verifiedAt: 1, createdAt: 1 }] };
  const ctx = { db: fakeDb(tables) };
  const recorded = plain(await mod.recordMerges._handler(ctx, { siteId: "site", merges: [
    { fromSlug: "/b", toSlug: "a", evidence: "same searches" },
    { fromSlug: "c", toSlug: "x", evidence: "x already redirects" },
    { fromSlug: "d", toSlug: "draft", evidence: "the target isn't published" },
    { fromSlug: "a", toSlug: "a", evidence: "itself" }] })) as Array<{ fromSlug: string; toSlug: string }>;
  assert.deepEqual(recorded.map((r) => [r.fromSlug, r.toSlug]), [["b", "a"]]);
  const old = tables.site_redirects.find((r) => r._id === "old")!;
  assert.equal(old.toSlug, "a", "x went to b; b now redirects to a, so x goes straight to a");
  assert.equal(old.delivery, "pending", "its repository entry must be rewritten");
  assert.equal(old.verifiedAt, undefined);
  const again = plain(await mod.recordMerges._handler(ctx, { siteId: "site", merges: [{ fromSlug: "b", toSlug: "c", evidence: "twice" }] })) as unknown[];
  assert.deepEqual(again, [], "an address already redirected is never redirected again");
});

test("the blog route's lookup: a merged slug answers with its new home under the site's URL structure", async () => {
  const mod = bundle("convex/blog.ts") as Record<string, Handler>;
  const tables: Record<string, Row[]> = { sites: [{ _id: "site", domain: "quillpad.example", urlStructure: "/guides/[slug]" }],
    site_redirects: [{ _id: "r1", siteId: "site", fromSlug: "stain-2", toSlug: "stain" }, { _id: "r2", siteId: "site", fromSlug: "old", toSlug: "cost", revertedAt: 5 }] };
  const ctx = { db: fakeDb(tables) };
  assert.deepEqual(plain(await mod.redirectForSlug._handler(ctx, { domain: "www.quillpad.example", slug: "stain-2" })), { toSlug: "stain", urlStructure: "/guides/[slug]" });
  assert.equal(await mod.redirectForSlug._handler(ctx, { domain: "quillpad.example", slug: "old" }), null, "a reverted redirect is history");
  assert.equal(await mod.redirectForSlug._handler(ctx, { domain: "quillpad.example", slug: "stain" }), null);
  const blog = readFileSync("convex/blog.ts", "utf8");
  assert.match(blog, /servedRows\(site, \[\.\.\.published\], await mergedSlugs\(ctx, site\._id\)\)/, "merged pages leave the listing and the sitemap");
  const route = readFileSync("src/app/blog/[slug]/page.tsx", "utf8");
  assert.equal((route.match(/if \(moved\) permanentRedirect\(articlePath\(moved\.urlStructure, moved\.toSlug\)\);/g) ?? []).length, 2,
    "the page and its metadata both redirect");
});

test("a published address never changes: the URL structure is fixed once an article is published", async () => {
  const mod = bundle("convex/sites.ts") as { assertPublishedAddressesKept: (ctx: unknown, site: Row, next: Row) => Promise<void>;
    sameUrlStructure: (a?: string, b?: string) => boolean };
  const site = { _id: "site", domain: "quillpad.example", urlStructure: "/blog/[slug]", publishMethod: "github" };
  const published = { db: fakeDb({ article_summaries: [{ _id: "s", siteId: "site", status: "published", slug: "a" }], articles: [] }) };
  const none = { db: fakeDb({ article_summaries: [], articles: [{ _id: "a", siteId: "site", status: "draft" }] }) };
  await assert.rejects(mod.assertPublishedAddressesKept(published, site, { urlStructure: "/articles/[slug]" }),
    (error: { data?: unknown }) => typeof error.data === "string" && /can't change after an article is published/.test(error.data));
  await mod.assertPublishedAddressesKept(published, site, { urlStructure: "/blog/[slug]/" });
  await mod.assertPublishedAddressesKept(published, { ...site, urlStructure: undefined }, { urlStructure: "/blog/[slug]" });
  await mod.assertPublishedAddressesKept(published, site, { siteName: "Quillpad" });
  await mod.assertPublishedAddressesKept(none, site, { urlStructure: "/articles/[slug]" });
  await mod.assertPublishedAddressesKept(published, { ...site, publishMethod: "wordpress" }, { urlStructure: "/%postname%/[slug]" });
  assert.equal(mod.sameUrlStructure("/Blog/[slug]", "/blog/[slug]"), false, "paths are case-sensitive");
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.ok(sites.indexOf("await assertPublishedAddressesKept(ctx, currentSite!, definedData);") > 0, "setup saves check it");
  assert.ok(sites.indexOf("await assertPublishedAddressesKept(ctx, site, patch);") > 0, "settings saves check it");
  const settings = readFileSync("src/app/(dashboard)/sites/[siteId]/page.tsx", "utf8");
  assert.match(settings, /disabled=\{urlStructureLocked\}/);
  assert.match(settings, /\.\.\.\(publishedCount > 0 \? \{\} : \{ urlStructure: urlStructure \|\| undefined \}\)/);
});

test("delivery: Pentra's own blog first (its repository is never written), then the site's own platform (P356: every platform)", () => {
  const action = readFileSync("convex/actions/siteDiagnosis.ts", "utf8");
  const hosted = action.indexOf("if (HOSTED_BLOG_DOMAINS.includes(host(site.domain)))");
  const repository = action.indexOf('if (method === "github") return site.repository ? deliverToRepository(ctx, site, rows)');
  assert.ok(hosted > 0 && repository > hosted, "a blog Pentra renders is handled before any repository write");
  assert.match(action, /probe\.host === "vercel" \? \{ candidates: \["vercel\.json"\]/, "vercel.json is written only where Vercel serves the site");
  assert.match(action, /ownerReview/, "owner review keeps merges waiting");
  assert.match(readFileSync("convex/crons.ts", "utf8"), /crons\.weekly\("site-diagnosis"/);
  assert.match(readFileSync("convex/siteDiagnosis.ts", "utf8"), /if \(!onNewSystem\(site\)\) continue;/,
    "the weekly paid run covers only the sites whose cost the owner approved");
  assert.match(readFileSync("convex/lib/providerSpendReservation.ts", "utf8"), /args\.purpose !== "site_diagnosis"/);
});

test("a merged page is no longer a page: never a link target, never improved, never listed", () => {
  const merged = new Set(["stain-2"]);
  assert.equal(servedOnItsOwnUrl("quillpad.example", "stain-2", merged), false);
  assert.equal(servedOnItsOwnUrl("quillpad.example", "/blog/stain-2/", merged), false);
  assert.equal(servedOnItsOwnUrl("quillpad.example", "stain", merged), true);
  assert.equal(servedOnItsOwnUrl("quillpad.example", "stain-2"), true, "without merges, nothing changes");
  assert.deepEqual(servedDestinations("quillpad.example", [{ href: "/blog/stain-2" }, { href: "https://quillpad.example/guides/stain-2?x=1" }, { href: "/blog/stain" }, { href: "/" }], merged)
    .map((d) => d.href), ["/blog/stain", "/"]);
  for (const file of ["convex/articles.ts", "convex/publishedRevisions.ts", "convex/actions/pipeline.ts", "convex/selectedPages.ts", "convex/contentImprovements.ts"]) {
    assert.match(readFileSync(file, "utf8"), /merged/, `${file} passes the merged pages`);
  }
});
