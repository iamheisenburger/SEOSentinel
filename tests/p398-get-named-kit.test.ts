// P398 (Nov 10 2026): Get named, part two. Threads found by search, directory listings, answer videos and comparison pages,
// for any business. Cases from other trades and countries: an Australian accounting app, a UK bakery, a US plumber.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanThreadUrl, comparisonRequest, directoryPlan, DIRECTORIES, parseListingKit, parseScreenshot, parseThreadResults, parseTtsAudio,
  rivalNumberIssues, rivalPairs, threadSearchRequest, videoQuestions, wavDurationMs,
} from "../convex/lib/growthKit.ts";
import { chapters, segmentAt, segmentTimings } from "../convex/lib/videoTiming.ts";
import { pageSource } from "../convex/lib/answerPages.ts";

test("threads are found by searching the question on Reddit and Quora, and only real threads are kept", () => {
  assert.deepEqual(threadSearchRequest("Which bakery in Leeds does the best sourdough?", "gb"),
    { query: "Which bakery in Leeds does the best sourdough site:reddit.com OR site:quora.com", gl: "GB", pages: 1 });
  const payload = { success: true, result: { organicResults: [
    { title: "Best sourdough in Leeds?", link: "https://old.reddit.com/r/Leeds/comments/abc123/best_sourdough/?utm_source=x#c" },
    { title: "dup", link: "https://www.reddit.com/r/Leeds/comments/abc123/best_sourdough/" },
    { title: "Reddit for business", link: "https://www.business.reddit.com/agency/lead-generation" },
    { title: "Where to buy bread in Leeds", link: "https://www.quora.com/Where-can-I-buy-good-bread-in-Leeds" },
    { title: "A blog", link: "https://leedsfood.example.co.uk/sourdough" },
  ] } };
  assert.deepEqual(parseThreadResults(payload), [
    { url: "https://www.reddit.com/r/Leeds/comments/abc123/best_sourdough/", title: "Best sourdough in Leeds?" },
    { url: "https://www.quora.com/Where-can-I-buy-good-bread-in-Leeds", title: "Where to buy bread in Leeds" },
  ]);
  assert.deepEqual(parseThreadResults(null), []);
  assert.equal(cleanThreadUrl("javascript:alert(1)"), null);
});

test("directories: the ones the assistants cite first, then the ones that fit the business's kind and country", () => {
  const software = directoryPlan("software", "AU", [{ domain: "www.capterra.com.au", answers: 2 }, { domain: "g2.com", answers: 5 }, { domain: "smallbizreviews.example.com", answers: 1 }]);
  assert.deepEqual(software.slice(0, 4).map((d) => [d.name, d.citedIn]),
    [["G2", 5], ["capterra.com.au", 2], ["smallbizreviews.example.com", 1], ["LinkedIn company page", 0]], "cited first, most-cited first; a site Pentra doesn't know keeps its address");
  assert.ok(software.some((d) => d.name === "Product Hunt"));
  assert.ok(!software.some((d) => d.name === "Yelp"), "a software product isn't listed on Yelp");
  assert.equal(software.filter((d) => d.domain === "g2.com").length, 1, "never twice");
  const bakery = directoryPlan("local", "GB", []);
  assert.ok(bakery.some((d) => d.name === "Google Business Profile"));
  assert.ok(bakery.some((d) => d.name === "Yelp"), "Yelp serves the UK");
  assert.ok(!bakery.some((d) => d.name === "Manta"), "Manta is US only");
  assert.ok(!bakery.some((d) => d.name === "G2"));
  const unknown = directoryPlan(null, "US", []);
  assert.ok(unknown.every((d) => DIRECTORIES.find((x) => x.domain === d.domain)?.kinds === "all"), "without a known kind, only the ones every business can use");
  assert.ok(DIRECTORIES.every((d) => /^https:\/\//.test(d.submitUrl)));
});

test("the listing is kept only when it is complete and within each directory's limits", () => {
  const long = "Ledgerly sends invoices and reconciles bank feeds for Australian sole traders. ".repeat(4);
  const kit = parseListingKit({ kind: "software", tagline: "Bookkeeping for sole traders that does itself, every day of the week", shortDescription: "Invoices and bank feeds for sole traders.",
    longDescription: long, categories: ["Accounting", "Invoicing"], features: ["Invoices", "Bank feeds", "GST reports"], useCases: ["Quarterly BAS"], pricing: "See ledgerly.com.au",
    audience: "Australian sole traders", faqs: [{ q: "Does it do BAS?", a: "Yes, from your bank feeds." }, { q: "", a: "x" }] });
  assert.ok(kit);
  assert.equal(kit!.tagline.length, 60);
  assert.equal(kit!.faqs.length, 1);
  assert.equal(parseListingKit({ kind: "software", tagline: "x", shortDescription: "y", longDescription: "short", features: [] }), null);
  assert.equal(parseListingKit({ ...kit!, kind: "spaceship" })!.kind, "other");
});

test("videos: the questions whose answers cite videos first; the voice and screenshot are read", () => {
  const check = (question: string, domains: string[], status = "answered") => ({ status, question, sources: domains.map((domain) => ({ domain })) });
  assert.deepEqual(videoQuestions([check("How to unblock a drain?", ["youtube.com", "a.com"]), check("How to unblock a drain?", ["www.youtube.com"]),
    check("Plumber cost in Ohio?", ["b.com"]), check("Plumber cost in Ohio?", ["b.com"]), check("Plumber cost in Ohio?", ["b.com"]), check("x", ["youtube.com"], "error")]),
    [{ question: "How to unblock a drain?", videoAnswers: 2 }, { question: "Plumber cost in Ohio?", videoAnswers: 0 }]);
  assert.deepEqual(parseTtsAudio({ candidates: [{ content: { parts: [{ text: "x" }, { inlineData: { mimeType: "audio/wav", data: "UklGRg==" } }] } }] }), { mimeType: "audio/wav", base64: "UklGRg==" });
  assert.equal(parseTtsAudio({}), null);
  assert.equal(parseScreenshot({ output: { data: { items: [{ image: "https://media.example.com/shot.png" }] } } }), "https://media.example.com/shot.png");
  assert.equal(parseScreenshot({ output: { data: { items: [{ image: "http://insecure.example.com/x.png" }] } } }), null);
});

test("a WAV's length comes from its header", () => {
  const header = new Uint8Array(44 + 48_000);
  const view = new DataView(header.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF"); view.setUint32(4, 36 + 48_000, true); ascii(8, "WAVE"); ascii(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 24_000, true); view.setUint32(28, 48_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, 48_000, true);
  assert.equal(wavDurationMs(header), 1000);
  assert.equal(wavDurationMs(new Uint8Array(10)), null);
});

test("each segment is on screen for its share of the voice, and the description gets chapters", () => {
  const t = segmentTimings(["one two", "three four five six", "seven eight"], 8_000);
  assert.deepEqual(t, [{ startMs: 0, endMs: 2000 }, { startMs: 2000, endMs: 6000 }, { startMs: 6000, endMs: 8000 }]);
  assert.equal(segmentAt(t, 1999), 0);
  assert.equal(segmentAt(t, 2000), 1);
  assert.equal(segmentAt(t, 9_000), 2);
  assert.equal(chapters(["Intro", "Steps", "Wrap"], t), "0:00 Intro\n0:02 Steps\n0:06 Wrap");
});

test("comparison pages: the rival only from its own pages, never its numbers without the page showing them", () => {
  const sources = [pageSource(1, "https://xero.com/", "Xero", "Xero is accounting software for small businesses. Plans from $29 a month.", 1), pageSource(2, "https://xero.com/pricing", "Xero pricing", "Starter, Standard and Premium plans.", 1)];
  const req = comparisonRequest({ businessName: "Ledgerly", productEvidence: "Ledgerly does bookkeeping for sole traders.", rival: { name: "Xero", domain: "xero.com" }, sources, market: "AU", language: "en" });
  assert.match(req.system, /Never state Xero's prices/);
  assert.match(req.system, /Never say Xero lacks/);
  assert.match(req.system, /when Xero is the better choice/i);
  assert.match(req.userMessage, /\[1\] Xero — https:\/\/xero\.com\//);
  assert.deepEqual(rivalNumberIssues("Xero has plans from $29 a month [1].", sources), []);
  assert.equal(rivalNumberIssues("Xero has 4 million customers [1]. Xero costs $59 [2].", sources).length, 2);
  assert.deepEqual(rivalNumberIssues("Ledgerly costs $19 a month.", sources), [], "a sentence citing no rival page isn't the rival's");
});

test("rivals are paired with their own sites from the answers: name matched to a cited address", () => {
  const pairs = rivalPairs([{ name: "Xero", answers: 9 }, { name: "QuickBooks", answers: 7 }, { name: "MYOB", answers: 5 }, { name: "Reddit", answers: 4 }, { name: "Ledgerly", answers: 2 }, { name: "Wave", answers: 1 }],
    ["xero.com", "quickbooks.intuit.com", "myob.com", "reddit.com", "ledgerly.com.au", "www.waveapps.com"], "ledgerly.com.au");
  assert.deepEqual(pairs, [{ name: "Xero", domain: "xero.com", answers: 9 }, { name: "QuickBooks", domain: "quickbooks.intuit.com", answers: 7 }, { name: "MYOB", domain: "myob.com", answers: 5 }]);
});

test("a page the assistants cite is pitched even when it links to no competitor; other pages still need one", async () => {
  const { readListingPage, pitchRequest } = await import("../convex/lib/linkOutreach.ts");
  const html = `<html lang="en"><head><title>How much does a plumber cost in Ohio?</title></head><body><main><p>${"Plumbers in Ohio charge by the hour or by the job. ".repeat(20)}</p>
    <a href="https://www.angi.com/">Angi</a></main></body></html>`;
  const plain = readListingPage(html, "https://ohiohomeguide.example.com/plumber-cost", { competitors: ["rotorooter.com"], siteDomain: "riversideplumbing.com" });
  assert.deepEqual(plain, { ok: false, reason: "it doesn't link to the competitors" });
  const cited = readListingPage(html, "https://ohiohomeguide.example.com/plumber-cost", { competitors: ["rotorooter.com"], siteDomain: "riversideplumbing.com", aiCited: true });
  assert.equal(cited.ok, true);
  assert.equal(cited.ok && cited.kind, "resource");
  const req = pitchRequest({ sender: "Sam", site: { name: "Riverside Plumbing", domain: "riversideplumbing.com" },
    their: { url: "https://ohiohomeguide.example.com/plumber-cost", title: "How much does a plumber cost in Ohio?", kind: "resource", excerpt: "x", competitors: [] },
    ours: { url: "https://riversideplumbing.com/", title: "Riverside Plumbing", as: "product" } });
  assert.match(req.system, /mentioning Riverside Plumbing on the page as a resource/);
  assert.doesNotMatch(req.system, /alternatives it already lists/);
  assert.match(req.userMessage, /links to no similar product yet/);
});

test("one business under two spellings is counted once", async () => {
  const { recommendedInstead } = await import("../convex/lib/answerEngine.ts");
  const check = (businessesNamed: string[]) => ({ assistant: "chatgpt", status: "answered", named: false, cited: false, competitorsNamed: [], businessesNamed, sources: [] });
  assert.deepEqual(recommendedInstead([check(["Xero", "QuickBooks Online"]), check(["xero.com"]), check(["Xero.com", "Xero"])]),
    [{ name: "Xero", answers: 3 }, { name: "QuickBooks Online", answers: 1 }]);
});
