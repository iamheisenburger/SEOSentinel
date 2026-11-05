// Site diagnosis (Nov 5 2026): the five things traffic needs, scored from a site's own data, for ANY site. Fictional sites
// only (Fernwood Decks, Quillpad, Brightwater): every rule fires on a measured symptom, never on who the site is.
import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseSite, sharesTopic, type GscRow } from "../convex/lib/siteDiagnosis.ts";
import { parseSearchIntents, searchIntentRequest } from "../convex/lib/searchIntent.ts";

const day = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
/** Spread a query's impressions and clicks evenly over 28 days at one position, on one page (impressions in 28s). */
const series = (query: string, impressions: number, clicks: number, position: number, page = "https://fernwood.example/blog/a"): GscRow[] =>
  Array.from({ length: 28 }, (_, i) => ({ date: day(i), query, page, impressions: Math.round(impressions / 28),
    clicks: Math.floor(clicks / 28) + (i < clicks % 28 ? 1 : 0), position }));

test("no Search Console: nothing is guessed; the owner is asked to connect it", () => {
  const d = diagnoseSite({ domain: "fernwood.example", gsc: [] });
  assert.equal(d.siteType, "new");
  assert.equal(d.window, null);
  assert.equal(d.factors.searches, "unknown");
  assert.equal(d.factors.authority, "unknown");
  assert.equal(d.factors.ai, "unknown");
  assert.ok(d.findings.some((f) => f.problem === "Search Console isn't connected"));
});

test("a new site: Google barely shows it yet, so only easy searches while links build authority", () => {
  const d = diagnoseSite({ domain: "fernwood.example", gsc: series("deck stain colors", 120, 0, 34) });
  assert.equal(d.siteType, "new");
  assert.equal(d.factors.searches, "weak");
});

test("searches it can't win: most impressions past page 2", () => {
  const gsc = [...series("deck builder", 900, 0, 48), ...series("composite decking", 600, 0, 61), ...series("deck stain how often", 200, 2, 9)];
  const d = diagnoseSite({ domain: "fernwood.example", gsc });
  assert.equal(d.siteType, "struggling");
  assert.equal(d.factors.searches, "failing");
  const f = d.findings.find((x) => x.factor === "searches")!;
  assert.match(f.evidence, /^88% of its non-branded impressions are past page 2$/);
  assert.match(f.items![0], /^deck builder \(position 48/);
});

test("ranks on page one, but nobody clicks: clicks far below what those positions earn", () => {
  const gsc = [...series("what is a ledger board", 1400, 0, 4), ...series("deck permit cost", 280, 0, 6), ...series("deck builder", 420, 0, 35)];
  const d = diagnoseSite({ domain: "fernwood.example", gsc });
  assert.equal(d.factors.clicks, "failing");
  const f = d.findings.find((x) => x.factor === "clicks")!;
  assert.match(f.evidence, /^0 clicks from 1680 page-one impressions \(about 109 expected at those positions\)$/);
  assert.deepEqual(f.items!.map((i) => i.split(" (")[0]), ["what is a ledger board", "deck permit cost"]);
});

test("a strong site: good clicks, so the job is pages just off page one (good to great)", () => {
  const gsc = [...series("composite deck cost", 3920, 392, 3), ...series("deck repair", 1512, 76, 5),
    ...series("deck lighting ideas", 840, 0, 14, "https://fernwood.example/blog/lighting"), ...series("deck stain", 308, 0, 9)];
  const d = diagnoseSite({ domain: "fernwood.example", gsc, authority: { domainRank: 41 }, pageOneMedianRank: 45 });
  assert.equal(d.siteType, "strong");
  assert.equal(d.factors.clicks, "ok");
  assert.equal(d.factors.authority, "ok");
  const near = d.findings.find((x) => x.problem === "Pages close to page one")!;
  assert.deepEqual(near.items, ["/blog/lighting (position 14, 840 impressions)"]);
});

test("its own pages compete for the same searches: measured by Search Console's overlap", () => {
  const gsc = [...series("deck stain", 600, 0, 22, "https://fernwood.example/blog/stain"), ...series("deck stain", 400, 0, 25, "https://fernwood.example/blog/stain-2")];
  const d = diagnoseSite({ domain: "fernwood.example", gsc });
  const f = d.findings.find((x) => x.problem === "Its own pages compete for the same searches")!;
  assert.deepEqual(f.items, ['/blog/stain and /blog/stain-2: 100% overlap (e.g. "deck stain")']);
  assert.deepEqual(d.merges, [], "nothing is merged without the crawl proving both are live, settled articles");
});

test("pages as crawled: one naming another page as the real one, no images, slow by Google's own speed test", () => {
  const d = diagnoseSite({ domain: "fernwood.example", gsc: [], pages: [
    { url: "https://fernwood.example/blog/a", canonical: "https://fernwood.example/blog/b", images: 0, loadMs: 2600, article: true },
    { url: "https://fernwood.example/blog/c", canonical: "https://www.fernwood.example/blog/c/", images: 3, loadMs: 9000, article: true }],
    speed: [{ url: "https://fernwood.example/blog/a", score: 31, lcpMs: 6200 }, { url: "https://fernwood.example/blog/c", score: 92, lcpMs: 1800 }] });
  assert.equal(d.factors.pages, "failing");
  assert.deepEqual(d.findings.find((x) => x.problem === "Pages name a different page as the real one")!.items, ["/blog/a → /blog/b"]);
  assert.match(d.findings.find((x) => x.problem === "Pages without images")!.evidence, /^1 of 2 pages/);
  const slow = d.findings.find((x) => x.problem === "Slow pages")!;
  assert.equal(slow.evidence, "1 of 2 pages Google's mobile speed test checked are slow", "one timing from Pentra's server (9 s on /blog/c) decides nothing");
  assert.deepEqual(slow.items, ["/blog/a (speed score 31/100, main content in 6.2s)"]);
});

test("authority: almost none, or far below page one, fails; a fair match passes", () => {
  const verdict = (domainRank: number, pageOneMedianRank?: number) =>
    diagnoseSite({ domain: "quillpad.example", gsc: [], authority: { domainRank, referringDomains: 30 }, pageOneMedianRank }).factors.authority;
  assert.equal(verdict(3), "failing");
  assert.equal(verdict(15), "weak");
  assert.equal(verdict(40, 80), "failing", "40 points below page one");
  assert.equal(verdict(40, 58), "weak");
  assert.equal(verdict(40, 45), "ok");
});

test("AI answers: named in under a fifth of buyer questions is a problem; unmeasured is unknown, never ok", () => {
  const ai = (named: number) => diagnoseSite({ domain: "brightwater.example", gsc: [], aiAnswers: { asked: 10, named } }).factors.ai;
  assert.equal(ai(0), "failing");
  assert.equal(ai(1), "weak");
  assert.equal(ai(3), "ok");
  assert.equal(diagnoseSite({ domain: "brightwater.example", gsc: [] }).factors.ai, "unknown");
});

test("searches for the business's own name are not counted as earned traffic", () => {
  const gsc = [...series("fernwood decks", 3000, 25, 1), ...series("deck builder", 500, 0, 40)];
  const d = diagnoseSite({ domain: "fernwood.example", gsc });
  assert.equal(d.totals.impressions, 504);
  assert.equal(d.totals.clicks, 0);
  assert.equal(d.totals.brandedClicks, 25);
});

const site = "https://fernwood.example";
test("redirects are recorded, not followed: a chain, a dead end, and a ranked page sent to another topic (weighted by what the ranking was worth)", () => {
  const gsc = [...series("deck lighting ideas", 840, 0, 14, `${site}/blog/lighting`), ...series("deck stain colors", 560, 0, 44, `${site}/blog/stain-colors`),
    ...series("deck builder", 280, 0, 30, `${site}/blog/builder`)];
  const pages = [
    { url: `${site}/blog/lighting`, status: 308, location: `${site}/blog/railings` },
    { url: `${site}/blog/stain-colors`, status: 308, location: `${site}/blog/pressure-washing` },
    { url: `${site}/blog/old`, status: 301, location: `${site}/blog/lighting` },
    { url: `${site}/blog/gone`, status: 301, location: `${site}/blog/missing` },
    { url: `${site}/blog/railings`, status: 200, title: "Deck Railing Styles and Costs", images: 2, words: 1400, structuredData: true },
    { url: `${site}/blog/pressure-washing`, status: 200, title: "How to Pressure Wash a Deck", images: 1, words: 1200, structuredData: true },
    { url: `${site}/blog/missing`, status: 404 },
  ];
  const d = diagnoseSite({ domain: "fernwood.example", gsc, pages });
  const mismatch = d.findings.find((f) => f.problem === "Ranked pages redirect to a page about something else")!;
  assert.equal(mismatch.severity, "high", "the lighting page ranked at 14: a real loss");
  assert.deepEqual(mismatch.items, ['/blog/lighting (top search "deck lighting ideas", position 14, 840 impressions) → "Deck Railing Styles and Costs"',
    '/blog/stain-colors (top search "deck stain colors", position 44, 560 impressions) → "How to Pressure Wash a Deck"']);
  assert.deepEqual(d.findings.find((f) => f.problem === "Redirect chains")!.items, ["/blog/old → /blog/lighting → …"]);
  assert.deepEqual(d.findings.find((f) => f.problem === "Published pages that don't load")!.items, ["/blog/missing (HTTP 404)", "/blog/gone (HTTP 301)"]);
  const low = diagnoseSite({ domain: "fernwood.example", gsc: series("deck stain colors", 560, 0, 44, `${site}/blog/stain-colors`), pages: pages.slice(1, 2).concat(pages.slice(5, 6)) });
  assert.equal(low.findings.find((f) => f.problem === "Ranked pages redirect to a page about something else")!.severity, "low", "position 44 was worth little");
});

test("noindex and index coverage: settled pages Google hasn't indexed are named with Google's own reason; new ones get their grace", () => {
  const now = Date.UTC(2026, 10, 5), day = 86_400_000;
  const pages = [
    { url: `${site}/blog/a`, status: 200, title: "A", images: 1, words: 900, indexVerdict: "PASS", publishedAt: now - 60 * day, article: true },
    { url: `${site}/blog/b`, status: 200, title: "B", images: 1, words: 900, indexVerdict: "NEUTRAL", coverageState: "Crawled - currently not indexed", publishedAt: now - 40 * day, article: true },
    { url: `${site}/blog/c`, status: 200, title: "C", images: 1, words: 900, indexVerdict: "NEUTRAL", coverageState: "Discovered - currently not indexed", publishedAt: now - 3 * day, article: true },
    { url: `${site}/blog/d`, status: 200, title: "D", images: 1, words: 900, noindex: true, article: true },
  ];
  const d = diagnoseSite({ domain: "fernwood.example", gsc: [], pages, now });
  assert.deepEqual(d.findings.find((f) => f.problem === "Published pages Google hasn't indexed")!.items, ["/blog/b (Crawled - currently not indexed)"]);
  assert.match(d.findings.find((f) => f.problem === "Published pages Google hasn't indexed")!.evidence, /^1 of 2 inspected pages/);
  assert.deepEqual(d.findings.find((f) => f.problem === "Published pages tell Google not to index them")!.items, ["/blog/d"]);
});

test("who the readers are: page-one rankings in front of job seekers and definition lookups, with the breakdown", () => {
  const gsc = [...series("what is a deck foreman", 840, 0, 4, `${site}/blog/foreman`), ...series("deck foreman salary", 280, 0, 6, `${site}/blog/foreman`),
    ...series("composite deck builder near me", 280, 3, 7, `${site}/blog/builders`)];
  const intents = [{ query: "what is a deck foreman", label: "learner" as const }, { query: "deck foreman salary", label: "job_seeker" as const },
    { query: "composite deck builder near me", label: "buyer" as const }];
  const d = diagnoseSite({ domain: "fernwood.example", gsc, intents });
  const f = d.findings.find((x) => x.problem === "Its page-one rankings reach people who won't buy")!;
  assert.equal(f.severity, "high");
  assert.equal(f.evidence, "80% of its page-one impressions come from people looking up a definition or explanation (840), job seekers (280)");
  assert.equal(d.totals.nonBuyerPageOneShare, 0.8);
  assert.ok(d.pageActions.find((p) => p.url.endsWith("/blog/foreman"))!.actions.some((a) => /^Retitle/.test(a)));
});

test("every page gets its own actions, and the summary says where the site stands, its biggest problems and what Pentra does next", () => {
  const gsc = [...series("deck lighting ideas", 840, 0, 14, `${site}/blog/lighting`), ...series("deck builder", 1680, 0, 48, `${site}/blog/builder`)];
  const d = diagnoseSite({ domain: "fernwood.example", gsc, authority: { domainRank: 2, referringDomains: 9 },
    pages: [{ url: `${site}/blog/lighting`, status: 200, title: "Deck Lighting Ideas", images: 0, words: 1100, structuredData: true }] });
  assert.deepEqual(d.pageActions.find((p) => p.url.endsWith("/blog/lighting"))!.actions, ["Improve it: it sits just off page one", "Add real images"]);
  assert.match(d.summary, /^This site got 0 clicks from 2520 search impressions in 28 days/);
  assert.match(d.summary, /Biggest problems\. It writes for searches it can't win: 67% of its non-branded impressions are past page 2\. Too little authority to compete: Domain rank 2 of 100, 9 sites link to it\./);
  assert.match(d.summary, /What Pentra does next\. Choose only searches whose page one it can reach at its authority; stop new articles on these\. Earn links every week/,
    "each action its own sentence");
});

test("same topic or not: more than half of the search's words in the title", () => {
  assert.equal(sharesTopic("best free seo tools", "Free AI Tools for SEO Optimization: A Practical Guide"), true);
  assert.equal(sharesTopic("keyword clustering", "Keywords for Research: How to Find Search Terms"), false);
  assert.equal(sharesTopic("seo workflow", "Intelligent Content Automation"), false);
  assert.equal(sharesTopic("deck builders", "How to Choose a Deck Builder"), true);
});

test("search intent: one request for all searches; only the requested searches with a known label come back", () => {
  const business = { name: "Fernwood Decks", domain: "fernwood.example", summary: "Builds composite and wood decks in Knoxville." };
  const req = searchIntentRequest(business, ["What is a deck foreman", "deck foreman salary", "deck foreman salary", "composite deck builder near me"]);
  assert.deepEqual(req.queries, ["what is a deck foreman", "deck foreman salary", "composite deck builder near me"]);
  assert.match(req.userMessage, /What it sells: Builds composite and wood decks in Knoxville\./);
  assert.deepEqual(parseSearchIntents(req.queries, { intents: [
    { query: "what is a deck foreman", label: "learner", reason: "wants a definition" }, { query: "deck foreman salary", label: "salary" },
    { query: "composite deck builder near me", label: "buyer", reason: "looking for a builder" }, { query: "not asked", label: "buyer" },
    { query: "what is a deck foreman", label: "buyer" }] }),
    [{ query: "what is a deck foreman", label: "learner", reason: "wants a definition" }, { query: "composite deck builder near me", label: "buyer", reason: "looking for a builder" }]);
});
