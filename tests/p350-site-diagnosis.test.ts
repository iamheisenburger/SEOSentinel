// Site diagnosis (Nov 5 2026): the five things traffic needs, scored from a site's own data, for ANY site. Fictional sites
// only (Fernwood Decks, Quillpad, Brightwater): every rule fires on a measured symptom, never on who the site is.
import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseSite, type GscRow } from "../convex/lib/siteDiagnosis.ts";

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

test("its own pages compete for one search: merge them", () => {
  const gsc = [...series("deck stain", 600, 0, 22, "https://fernwood.example/blog/stain"), ...series("deck stain", 400, 0, 25, "https://fernwood.example/blog/stain-2")];
  const d = diagnoseSite({ domain: "fernwood.example", gsc });
  const f = d.findings.find((x) => x.problem === "Its own pages compete for the same searches")!;
  assert.deepEqual(f.items, ["deck stain: /blog/stain, /blog/stain-2"]);
});

test("pages as crawled: one naming another page as the real one, no images, slow", () => {
  const d = diagnoseSite({ domain: "fernwood.example", gsc: [], pages: [
    { url: "https://fernwood.example/blog/a", canonical: "https://fernwood.example/blog/b", images: 0, loadMs: 2600 },
    { url: "https://fernwood.example/blog/c", canonical: "https://www.fernwood.example/blog/c/", images: 3, loadMs: 400 }] });
  assert.equal(d.factors.pages, "failing");
  assert.deepEqual(d.findings.find((x) => x.problem === "Pages point Google to a different page")!.items, ["/blog/a → /blog/b"]);
  assert.match(d.findings.find((x) => x.problem === "Pages without images")!.evidence, /^1 of 2 pages/);
  assert.match(d.findings.find((x) => x.problem === "Slow pages")!.evidence, /^1 of 2 pages took over 2 seconds/);
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
