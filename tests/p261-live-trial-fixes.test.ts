// P261 (Oct 31 2026): what the live trial of the fixed article plan found (5 isolated test businesses, real Google results,
// pages, sources and models; ops/COWORK-JUDGE-QUEUE.md), and P262's "best X" sourcing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { namesOutsideSources, type FactSheet } from "../convex/lib/articlePlanChecks.ts";
import { plainPunctuation, verifyLivePublicationPage } from "../convex/lib/publicationLive.ts";
import { listedOptions, planFormat } from "../convex/lib/serpBrief.ts";
import { firstPartyProductPage } from "../convex/lib/sourceQuality.ts";

const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
const sheet: FactSheet = { sources: [{ url: "https://getpino.io/#/docs/api", title: "Pino API", text: "Pino is a fast JSON logger for Node.js." }],
  profile: "Name: Shipyard Logs", productName: "Shipyard Logs" };

test("P261 a WordPress article whose title has an apostrophe is marked live (WordPress prints it curly)", () => {
  // The WordPress test site printed "A Homeowner&#8217;s Guide" for "A Homeowner's Guide": the check never matched.
  const url = "https://celtic-courage-factor-pursuit.trycloudflare.com/tankless-water-heater-installation-austin/";
  const html = `<html><head><link rel="canonical" href="${url}"></head><body><h1>Tankless Water Heater Installation in Austin: A Homeowner&#8217;s Guide</h1>` +
    `<p>Gas &#8211; or electric&#8230;</p></body></html>`;
  assert.doesNotThrow(() => verifyLivePublicationPage({ expectedUrl: url, fetchedUrl: url, html, title: "Tankless Water Heater Installation in Austin: A Homeowner's Guide" }));
  assert.throws(() => verifyLivePublicationPage({ expectedUrl: url, fetchedUrl: url, html, title: "A Different Guide" }), /does not contain the published article title/);
  assert.equal(plainPunctuation("“Quoted” – it’s 1920×1080…"), "\"Quoted\" - it's 1920x1080...");
});

test("P261 the names check reads attributions and organisations, not every capitalised word", () => {
  const flagged = (text: string) => namesOutsideSources(text, sheet).map(f => f.detail);
  assert.deepEqual(flagged("Morgan is an HTTP request logger, while Winston and Bunyan are general-purpose loggers."), [], "other libraries");
  assert.deepEqual(flagged("NIST SP 800-92 is the United States government's guide to log management."), [], "acronyms and places");
  assert.deepEqual(flagged("ESM files work even if your project is written in CommonJS."), []);
  assert.deepEqual(flagged("According to Jane Doe, structured logs save hours."), ["Jane Doe is not named in the sources or your details"]);
  assert.deepEqual(flagged("Jane Doe said structured logs save hours."), ["Jane Doe is not named in the sources or your details"]);
  assert.deepEqual(flagged("Dr. Alan Smith recommends JSON logs."), ["Alan Smith is not named in the sources or your details"]);
  assert.deepEqual(flagged("Brightway Labs Inc. found the same."), ["Brightway Labs Inc is not named in the sources or your details"]);
  assert.deepEqual(flagged("The Pino docs say the logger is fast."), [], "a name the sources give");
  // The names the top results use are part of the subject.
  assert.match(pipeline, /const context = serpBrief \? \[\.\.\.serpBrief\.results\.map\(\(r\) => r\.title\), \.\.\.\(serpBrief\.pages \?\? \[\]\)\.flatMap\(\(p\) => p\.headings\),/);
});

test("P261 a search naming a programming tool is a tutorial; \"best practices\" titles are not a list", () => {
  const brief = { results: [{ title: "best logging framework : r/node", url: "https://www.reddit.com/r/node/x" },
    { title: "Best practices for writing app logs with Pino", url: "https://x.example/a" }], pages: [] };
  assert.equal(planFormat(brief, false, true, "node.js structured logging with pino"), "tutorial");
  assert.equal(planFormat({ results: [{ title: "Best practices for invoices", url: "https://a.example/" }, { title: "Invoice best practices", url: "https://b.example/" }], pages: [] }, false), "guide");
});

test("P261 the one fix's output bound follows the article's length, so it fits the $0.50 cap", () => {
  assert.match(pipeline, /export const plannedFixMaxTokens = \(markdown: string\) => Math\.min\(16_384, Math\.max\(4_000, Math\.ceil\(markdown\.length \/ 2\.5\) \+ 2_000\)\);/);
  assert.match(pipeline, /maxTokens: plannedFixMaxTokens\(fields\.markdown\) \}\)/);
  assert.match(pipeline, /\.\.\.\(args\.maxTokens \? \{ maxTokens: args\.maxTokens \} : \{\}\),/);
});

test("P262 a \"best X\" search researches the options its top lists name, from their own sites", () => {
  const page = (headings: string[]) => ({ url: "https://x.example/", words: 2000, codeBlocks: 0, tables: 0, items: 10, headings });
  const options = listedOptions({ pages: [
    page(["What to look for", "1. Mindbody", "2. Momence: Best for hybrid studios", "3. WellnessLiving", "4. Glofox", "5. Zen Planner", "Key Features to Compare", "Online Booking", "Final Thoughts"]),
    page(["Top 7 yoga studio booking apps", "Mindbody – the industry standard", "Momence", "Walla", "Arketa (best for boutique studios)", "WellnessLiving", "Class Scheduling Features"]),
    page(["Why scheduling matters", "How to choose", "Troubleshooting"]),
  ] });
  assert.deepEqual(options, ["Mindbody", "Momence", "WellnessLiving", "Glofox", "Zen Planner", "Walla", "Arketa"], "most named first; a guide's headings are not options");
  assert.equal(firstPartyProductPage("https://www.mindbodyonline.com/business/pricing", ["mindbody"]), true);
  assert.equal(firstPartyProductPage("https://www.hellowalla.com/pricing", ["walla"]), true);
  assert.equal(firstPartyProductPage("https://www.obsidianportal.com/", ["notion"]), false);
  assert.equal(firstPartyProductPage("https://zoomcar.com/", ["zoom"]), false, "only the affixes brands use for their own domain");
  assert.equal(firstPartyProductPage("https://seobotreview.com/seobot", ["seobot"]), false, "a review site is not the product");
  assert.match(pipeline, /The top results name these: \$\{listOptions\.join\(", "\)\}\. Search for each by name and cite its own website/);
});

test("P262 a list's second research pass looks up its options' own pages, never government pages", async () => {
  const { optionSourcesRequest, LIST_RESEARCH_SOURCES } = await import("../convex/lib/researchPasses.ts");
  const request = optionSourcesRequest({ label: "Yoga studio scheduling", primaryKeyword: "best scheduling software for yoga studios",
    options: ["Mindbody", "Momence", "Glofox"], targetCountry: "United States" });
  assert.match(request.system, /For each option, use web search to find its own official pages: plans and pricing, features/);
  assert.match(request.userMessage, /Options the top results name \(research each on its own website; add others the top lists for this search name until there are at least 6\): Mindbody, Momence, Glofox/);
  // P268: a list keeps up to 10 sources and looks for options until 6 have their own pages.
  assert.equal(LIST_RESEARCH_SOURCES, 10);
  assert.match(pipeline, /if \(listPass \? optionsCovered\(kept\.readable\) < LIST_MIN_OPTIONS : coveragePass \? ownerPages\(kept\.readable\) < 4 : kept\.readable\.length < PRIMARY_PASS_BELOW\) \{/);
  assert.match(pipeline, /listOptions\.length \|\| listFormat \? `Do not research \$\{site\.siteName \?\? site\.domain\} itself\$\{competitorList\.length/,
    "P268: a list researches its options even when no list could be read (P271: never the business's competitors)");
});
