// P394 (Nov 9 2026): Cowork's end-to-end test 2 (Boise dentist 6/10, Fathom Analytics 7/10). Root causes, each pinned here:
// treg's routed reply (`output.pages[].markdown`) was never parsed, so a host that blocks cloud servers (the dentist's
// SiteGround check) was never read; the direct fetch's raw HTML went to the writer and the sources box ("<!DOCTYPE html>…",
// a competing practice's meta description with its phone number); sources were any page the assistants cited (other
// dentists); facts about the business could come from third-party pages ("EU servers only"); a page could say the site
// "doesn't mention" what its features page lists; "winnable" included questions already naming the business and most of
// a local business's questions; "Nth of M" took the place from the model's list order but the total from every name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tregExtractedText } from "../convex/lib/tregFetch.ts";
import { challengeText, htmlToText, markdownLinks, markdownToText, preferredSitemaps, readableText, sitemapEntries } from "../convex/lib/pageText.ts";
import { keyLinks, relevantLinks } from "../convex/lib/siteLinks.ts";
import {
  answerPageRequest, checkDraftPage, citedPassage, editedDraft, ownFactsRequest, pageSource, parseDraftPage, parseOwnFacts, parseSourceKinds,
  removeSentences, sourceKindsRequest,
} from "../convex/lib/answerPages.ts";
import { judgeAnswer, questionOpportunity, rankOpportunities, type Opportunity } from "../convex/lib/answerEngine.ts";
import { sourceQuote } from "../src/lib/answers/format.ts";

const DENTIST = "osterkampfamilydental.com";
// treg's reply for the dentist's homepage, as production receives it (Nov 9 2026, shape measured live; text shortened).
const DENTIST_HOME_MD = [
  "[Skip to content](#jupiterx-main)", "", "# Boise Dentistry for Whole-Body WellnessHealthier Smiles. Healthier Lives.", "",
  "Your oral health is connected to more than your smile. At Osterkamp Family Dental in Boise, we provide evidence-based care designed to support your health, comfort, and long-term wellness.", "",
  "[(208) 342-8000](tel:\\(208\\)%20342-8000)", "", "[Request Appointment](https://osterkampfamilydental.com/request-appointment/) ", "",
  "Dr. James Osterkamp is Kois-trained, with advanced education in diagnostically driven treatment planning, esthetics, function, periodontics, and biomechanics.", "",
  "[Meet Dr. Osterkamp](https://osterkampfamilydental.com/dentist-james-osterkamp/) ", "", "### Adult Plan", "", "[Learn More](https://osterkampfamilydental.com/loyalty-program/) ", "",
  "## Cookie Consent", "", "We use cookies, including some from third parties.", "", "## Cookie Preferences", "", "Essential", "", "30 days", "",
  "Address 3157 South Bown Way Suite #200 Boise, ID 83706 (208) 342-8000 (208) 342-8011",
].join("\n");
const ROUTED_REPLY = { output: { pages: [{ bytes: 183490, cache: "archive", content_hash: "9d64", engine: "cache", fell_back: false, markdown: DENTIST_HOME_MD, ms: 30, ok: true,
  text_len: 3972, usage: { boxes: ["crawl"], units: 1 } }], count: 1 }, raw: { markdown: DENTIST_HOME_MD }, _treg: { served_by: "crawl4ai.web.scrape", charged_micro: 150 } };
// The dentist's page-sitemap.xml as treg's renderer returns it: addresses and dates separated by spaces, images included.
const SITEMAP_TEXT = [" https://osterkampfamilydental.com/ 2026-07-11T08:53:48+00:00",
  "https://osterkampfamilydental.com/wp-content/uploads/2025/02/Dr-Osterkamp-Sq.jpg", "https://osterkampfamilydental.com/loyalty-program/ 2026-07-11T08:45:42+00:00",
  "https://osterkampfamilydental.com/dentist-james-osterkamp/ 2026-07-13T13:26:17+00:00", "https://osterkampfamilydental.com/team/ 2026-10-12T01:23:00+00:00",
  "https://osterkampfamilydental.com/dental-services/sleep-apnea/ 2026-10-27T15:08:51+00:00", "https://osterkampfamilydental.com/dental-services/ 2026-10-27T15:40:25+00:00",
  "https://osterkampfamilydental.com/dental-services/sedation-dentistry/ 2026-10-27T15:44:17+00:00", "https://osterkampfamilydental.com/privacy-policy/ 2026-07-13T13:26:26+00:00"].join(" ");

test("treg's routed reply is read: the page a host blocks from cloud servers comes back as its words", () => {
  const text = tregExtractedText(ROUTED_REPLY);
  assert.ok(text.length > 500, "the old parser returned nothing for `output.pages[].markdown`");
  assert.match(text, /Kois-trained/);
  const readable = markdownToText(text);
  assert.doesNotMatch(readable, /\]\(|jupiterx|Cookie Preferences|30 days/, "links become words; the cookie banner is dropped");
  assert.match(readable, /Meet Dr\. Osterkamp/);
  assert.match(readable, /Address 3157 South Bown Way/, "the footer's address after the banner is kept");
  assert.deepEqual(markdownLinks(text, DENTIST).map((l) => l.url), ["https://osterkampfamilydental.com/request-appointment",
    "https://osterkampfamilydental.com/dentist-james-osterkamp", "https://osterkampfamilydental.com/loyalty-program"]);
  assert.equal(challengeText(`<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2F"></head><body></body></html>`), true);
  assert.equal(challengeText("Just a moment... Checking if the site connection is secure"), true);
  assert.equal(challengeText(readable), false);
});

test("a business's service pages are found from its sitemap, and the right ones are read for each question", () => {
  const { pages, sitemaps } = sitemapEntries(SITEMAP_TEXT, DENTIST);
  assert.ok(pages.some((p) => p.url.endsWith("/dental-services/sleep-apnea")) && pages.some((p) => p.url.endsWith("/dental-services/sedation-dentistry")));
  assert.ok(!pages.some((p) => /wp-content|\.jpg/.test(p.url)), "images are not pages");
  assert.deepEqual(sitemaps, []);
  assert.deepEqual(sitemapEntries(`<sitemapindex><sitemap><loc>https://${DENTIST}/post-sitemap.xml</loc></sitemap><sitemap><loc>https://${DENTIST}/page-sitemap.xml</loc></sitemap>`
    + `<sitemap><loc>https://${DENTIST}/image-sitemap.xml</loc></sitemap></sitemapindex>`, DENTIST).sitemaps.length, 3);
  assert.deepEqual(preferredSitemaps([`https://${DENTIST}/post-sitemap.xml`, `https://${DENTIST}/page-sitemap.xml`, `https://${DENTIST}/image-sitemap.xml`]),
    [`https://${DENTIST}/page-sitemap.xml`, `https://${DENTIST}/post-sitemap.xml`]);
  assert.ok(relevantLinks(pages, "Which Boise dentist offers sedation for anxious patients?", 3).some((l) => l.url === `https://${DENTIST}/dental-services/sedation-dentistry`),
    "the sedation question reads the practice's own sedation page (test 2's draft cited another practice's)");
  // One of each kind found by common page names (P395 cleanup: no words taken from one site, so a loyalty programme is no
  // pricing page); this site has no pricing page.
  assert.deepEqual(keyLinks(pages).map((l) => new URL(l.url).pathname), ["/dental-services", "/team"], "services and about: one of each found");
});

test("a short sitemap reply is kept, and a large site's own page about the question beats its blog posts", async () => {
  const { tregPageText } = await import("../convex/lib/tregFetch.ts");
  const index = { output: { pages: [{ markdown: "https://usefathom.com/sitemap-0.xml 2026-11-01" }], count: 1 } };
  assert.equal(tregPageText(index), "https://usefathom.com/sitemap-0.xml 2026-11-01", "a sitemap index is a few addresses; the 200-character floor dropped it");
  const fetcher = readFileSync("convex/lib/tregFetch.ts", "utf8");
  assert.match(fetcher, /allowedContentTypes: SITEMAP_TYPES/, "the page fetch refuses XML unless told otherwise");
  // Fathom's 400 sitemap pages: "analytics" and "data" are in many of them; the EU question needs its data isolation page.
  const fathomPages = [
    ...Array.from({ length: 60 }, (_, i) => ({ url: `https://usefathom.com/blog/analytics-post-${i}`, text: `analytics post ${i}` })),
    ...Array.from({ length: 40 }, (_, i) => ({ url: `https://usefathom.com/learn/analytics-guide-${i}`, text: `analytics guide ${i}` })),
    { url: "https://usefathom.com/blog/export-universal-analytics-data", text: "export universal analytics data" },
    { url: "https://usefathom.com/blog/import-data-from-google-analytics", text: "import data from google analytics" },
    { url: "https://usefathom.com/features/data-isolation", text: "features data isolation" },
    { url: "https://usefathom.com/features", text: "features" },
  ];
  const picked = relevantLinks(fathomPages, "Which website analytics tools keep visitor data in the EU?", 3).map((l) => l.url);
  assert.equal(picked[0], "https://usefathom.com/features/data-isolation", "its own page first, not a blog post about Google Analytics");
});

test("pages and sources are words, never HTML: no <head>, no scripts, no meta description", () => {
  const html = `<!DOCTYPE html><html lang="en-US"><head><title>Sleep Apnea | Bristol Heights Dental</title><meta name="description" content="Call Bristol Heights Dental at (208) 938-9912">`
    + `<script>window.dataLayer=[];</script></head><body><nav><a href="/">Home</a></nav><main><h1>Sleep apnea</h1><p>Obstructive sleep apnea affects an estimated 26% of adults aged 30 to 70.</p>`
    + `<ul><li>Snoring</li><li>Daytime fatigue</li></ul></main><footer>Boise, ID</footer></body></html>`;
  const text = htmlToText(html);
  assert.doesNotMatch(text, /DOCTYPE|dataLayer|938-9912|<\w/);
  assert.match(text, /Sleep apnea\nObstructive sleep apnea affects an estimated 26% of adults/);
  assert.match(text, /- Snoring\n- Daytime fatigue/);
  assert.equal(readableText(html), text);
  const source = pageSource(1, "https://example.org/osa", "OSA", html, 1);
  assert.doesNotMatch(source.excerpt, /DOCTYPE|<head|938-9912/, "test 2's sources box showed the raw HTML and a competitor's phone number");
  assert.match(citedPassage(source.excerpt, ["Sleep apnea affects about 26% of adults aged 30 to 70 [1]."]), /^Obstructive sleep apnea affects an estimated 26% of adults/);
});

test("the sources box never shows page code and never scrolls sideways on a phone", () => {
  assert.equal(sourceQuote(`<!DOCTYPE html><html lang="en-US"><head ><!-- Google Tag Manager --> <script>(function(w,d,s,l,i){w[l]=w[l]||[];`), "",
    "a draft saved before P394 shows no quote rather than code");
  assert.equal(sourceQuote("Obstructive sleep apnea affects an estimated 26% of adults."), "Obstructive sleep apnea affects an estimated 26% of adults.");
  assert.ok(sourceQuote("word ".repeat(200)).length <= 360);
  const preview = readFileSync("src/components/answers/page-preview.tsx", "utf8");
  assert.match(preview, /\[overflow-wrap:anywhere\]">&ldquo;\{sourceQuote\(source\.excerpt\)\}&rdquo;/);
});

const fathom = { name: "Fathom Analytics", domain: "usefathom.com" };
const fathomEvidence = "Name: Fathom Analytics\nDomain: usefathom.com\nCrawled page https://usefathom.com/features:\nGet weekly or monthly emails with your site's stats.\nCrawled page https://usefathom.com/data:\nAnonymized analytics data is stored in the US.";

test("a page's links go only to the business's own pages, a source never backs a fact about the business, and what its own pages don't support is taken out", () => {
  // P395 cleanup: the wording patches (a regex for "the site doesn't mention", a phone-number regex) are gone. A claim
  // about the business that its own pages don't support, an absence claim included, is found by the own-pages check
  // (any wording, any language) and taken out by the edit pass; links out and third-party citations stay structural rules.
  const sources = [1, 2].map((n) => pageSource(n, `https://ref${n}.example/a`, `Ref ${n}`, "Privacy-first analytics tools avoid cookies and personal data. ".repeat(20), 1));
  const body = ["Fathom Analytics is a privacy-first analytics tool that doesn't use cookies.", "",
    "## Does it email reports?", "", "Fathom's site doesn't mention a weekly email schedule.", "",
    "## Where is data kept?", "", "Fathom Analytics keeps data only on EU servers [2].", "",
    "For more, see [this guide](https://otherguide.example/osa).", "",
    ...Array.from({ length: 70 }, (_, i) => `Practical point ${i + 1} for site owners.`)].join("\n");
  const draft = parseDraftPage({ title: "Privacy-first analytics with email reports", metaDescription: "m", markdown: body,
    facts: [{ text: "Fathom keeps data only on EU servers", source: "source", sourceNumber: 2 }], fit: "strong" }, sources)!;
  const args = { businessName: fathom.name, businessDomain: fathom.domain, sources, productEvidence: fathomEvidence };
  const blocking = checkDraftPage(draft, args).blocking.join("\n");
  assert.match(blocking, /Remove the link to otherguide\.example/);
  assert.match(blocking, /states something about Fathom Analytics with a source's citation/);
  assert.doesNotMatch(blocking, /doesn't mention|phone number/, "no wording rules: the own-pages check judges what a sentence claims");
  // The own-pages check reports the unsupported claims (the cookie claim and the absence claim); the edit pass removes them.
  const edited = editedDraft(draft, { businessName: fathom.name, businessDomain: fathom.domain, productEvidence: fathomEvidence,
    ownProblems: [{ sentence: "Fathom Analytics is a privacy-first analytics tool that doesn't use cookies." }, { sentence: "Fathom's site doesn't mention a weekly email schedule." }] });
  assert.doesNotMatch(edited.markdown, /doesn't mention|EU servers|otherguide|doesn't use cookies/);
  assert.match(edited.markdown, /For more, see this guide\./, "a link out becomes its words");
  // A heading left with nothing under it goes with its sentence (a bare heading is a defect a reader sees).
  assert.doesNotMatch(edited.markdown, /## Does it email reports\?/);
  assert.match(edited.markdown, /## Where is data kept\?/);
  assert.deepEqual(edited.facts, [], "the removed claim's fact goes with it");
  const clean = checkDraftPage(edited, args).blocking.join("\n");
  assert.doesNotMatch(clean, /link to|citation/);
  const missed = removeSentences("One line.\n\nAnother  line here.", ["Another line here.", "Not in the page."]);
  assert.deepEqual([missed.markdown, missed.missed], ["One line.", ["Not in the page."]], "whitespace differences still match; a sentence not found is reported");
});

test("facts about the business come from its own pages: the writer is told so, and a second reader checks every claim", () => {
  const request = answerPageRequest({ question: "Which analytics tools keep data in the EU?", businessName: fathom.name, productEvidence: fathomEvidence, market: "US",
    language: "en", landscape: [{ assistant: "chatgpt", excerpt: "Fathom keeps EU data in the EU.", named: true, competitorsNamed: [] }], sources: [], competitorNames: [] });
  assert.match(request.system, /3b\. Every fact about Fathom Analytics .* comes from the business facts below and nowhere else/);
  assert.match(request.system, /4\. Never say or imply that Fathom Analytics does not offer, do or include something unless its own pages say so in those words\./);
  assert.match(request.userMessage, /never trust what they say about Fathom Analytics/);
  const check = ownFactsRequest({ businessName: fathom.name, productEvidence: fathomEvidence, markdown: "Fathom keeps data only on EU servers." });
  assert.match(check.userMessage, /stored in the US/);
  assert.match(check.system, /Quote each sentence exactly as it appears/);
  assert.deepEqual(parseOwnFacts({ problems: [{ sentence: "Fathom keeps data only on EU servers.", verdict: "contradicted", ownPagesSay: "stored in the US" }] }),
    [{ sentence: "Fathom keeps data only on EU servers.", verdict: "contradicted", ownPagesSay: "stored in the US" }]);
  assert.equal(parseOwnFacts({ nope: true }), null);
});

test("a source is a reference, never another business that sells the same thing or a listing of them", () => {
  const candidates = [
    { n: 1, url: "https://www.bristolheightsdental.com/sleep-apnea", title: "Sleep Apnea Treatment", text: "Call Bristol Heights Dental at (208) 938-9912." },
    { n: 2, url: "https://www.sleepfoundation.org/sleep-apnea", title: "Sleep Apnea", text: "Obstructive sleep apnea is a sleep disorder." },
    { n: 3, url: "https://www.yelp.com/search?find_desc=sleep+dentist&find_loc=Boise", title: "Top 10 Sleep Dentists in Boise", text: "Best sleep dentists near Boise." },
  ];
  const request = sourceKindsRequest({ businessName: "Osterkamp Family Dental", sells: "Family and restorative dentistry in Boise", market: "Boise, ID", candidates });
  assert.match(request.system, /"seller": published by any business that sells or provides what Osterkamp Family Dental sells/);
  assert.match(request.userMessage, /\[1\] Sleep Apnea Treatment — https:\/\/www\.bristolheightsdental\.com\/sleep-apnea/);
  assert.deepEqual(parseSourceKinds({ pages: [{ n: 1, kind: "seller" }, { n: 2, kind: "reference" }, { n: 3, kind: "listing" }] }, candidates), [2]);
  assert.deepEqual(parseSourceKinds({ pages: [{ n: 2, kind: "reference" }] }, candidates), [2], "a page the reply leaves out is not kept");
  assert.equal(parseSourceKinds("not json", candidates), null);
  const action = readFileSync("convex/actions/answerPages.ts", "utf8");
  assert.match(action, /const sorted = await referenceSources\(candidates,/);
  // P395 cleanup: when the sorting call fails twice, no outside page is used (no list of sites or address endings, which
  // differ by country); the writer then writes from the business's own pages with general guidance.
  assert.match(action, /for \(let attempt = 0; attempt < 2; attempt\+\+\)[\s\S]*?if \(keep\) return[\s\S]*?return \{ keep: \[\] as SourceCandidate\[\], cost \};/);
  assert.doesNotMatch(action, /referenceByAddress/);
  assert.match(action, /const factCheck = .*await ownFactsProblems\(business\.name, productEvidence, parsed\.markdown\)/);
  assert.match(action, /draft = editedDraft\(draft, \{/);
});

test("Nth of M counts the same businesses on both sides, in the answer's own order", () => {
  const text = "Unlike Google Analytics, privacy-first tools skip cookies. Plausible is the simplest; Fathom Analytics adds uptime alerts; Simple Analytics is EU-based.";
  // The listing model put the recommended tools first; the answer names Google Analytics first.
  const judged = judgeAnswer({ text, sources: [] }, fathom, [], { namedOrder: ["Plausible", "Fathom Analytics", "Simple Analytics", "Google Analytics"] });
  assert.deepEqual([judged.position, judged.brandsNamed], [3, 4], "3rd of the 4 named, never 2nd of 4");
  const invented = judgeAnswer({ text: "Fathom Analytics is a good choice.", sources: [] }, fathom, [], { namedOrder: ["Fathom Analytics", "Matomo"] });
  assert.deepEqual([invented.position, invented.brandsNamed], [1, 1], "a name the answer doesn't contain isn't counted");
});

test("winnable means no answer names the business yet, and it is the short list of the strongest openings", () => {
  const answer = (named: boolean) => ({ status: "answered", named, cited: false, competitorsNamed: ["Plausible"],
    sources: [{ domain: "smallblog.example", own: false, title: "Some page" }] });
  const namedOnce = questionOpportunity("Which privacy-first analytics tools send weekly email reports?", [answer(true), answer(false), answer(false), answer(false), answer(false)]);
  assert.notEqual(namedOnce.status, "winnable", "test 2: questions already naming Fathom were marked winnable");
  const noSources = questionOpportunity("Which privacy-first analytics tools send weekly email reports?",
    [{ ...answer(false), sources: [] }, { ...answer(false), sources: [] }]);
  assert.equal(noSources.status, "monitoring");
  assert.match(noSources.reasons.join(" "), /cite no web pages/);
  const items = Array.from({ length: 30 }, (_, i) => ({ id: i, opportunity: { score: 100 - i, status: "winnable", reasons: ["Not named in any of 4 answers."] } as Opportunity }));
  const ranked = rankOpportunities(items);
  assert.equal(ranked.filter((r) => r.opportunity.status === "winnable").length, 10, "test 2: 26 of 30 for a local dentist");
  assert.deepEqual(ranked.filter((r) => r.opportunity.status === "winnable").map((r) => r.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "the strongest first");
  assert.match(ranked[29].opportunity.reasons.join(" "), /Pentra writes for the strongest openings first/);
  assert.equal(rankOpportunities(items.slice(0, 4)).filter((r) => r.opportunity.status === "winnable").length, 3, "at least three when there are");
  const answers = readFileSync("convex/answers.ts", "utf8");
  assert.match(answers, /for \(const \{ question, list, opportunity \} of rankOpportunities\(judged\)\)/);
});
