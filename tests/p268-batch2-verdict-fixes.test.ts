// P268 (Oct 31 2026): Cowork judged batch 2 of the fixed plan 0 of 5 (ops/COWORK-JUDGE-RESULTS.md, batch 2). The fixes:
// the plan reads all of Google's results and its People Also Ask, research cites each owned fact's owner, there is no word
// target, and the one fix gets what code and one claims check find (repeats, referrals, steps without code, short lists,
// wrong science, garbled prices). Nothing new ever holds a draft.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflections, fixFindings, listOptionCount, numbersOutsideFactSheet, repeatedPassages, sectionsWithoutCode } from "../convex/lib/articlePlanChecks.ts";
import { LIST_MIN_OPTIONS, LIST_RESEARCH_SOURCES, SEARCHER_LED_RESEARCH_SYSTEM, SOURCE_ROLE_LABEL, optionSourcesRequest, rankedResearchSources,
  type SourceRole } from "../convex/lib/researchPasses.ts";

const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");

test("P268 the plan reads Google's advanced results: People Also Ask, and a goto result recovered from a second request", async () => {
  const { analyzeSerpForPlan } = await import("../convex/actions/seoData.ts");
  const realFetch = globalThis.fetch;
  const saved = { login: process.env.DATAFORSEO_LOGIN, password: process.env.DATAFORSEO_PASSWORD };
  process.env.DATAFORSEO_LOGIN = "synthetic"; process.env.DATAFORSEO_PASSWORD = "synthetic";
  const endpoints: string[] = [];
  let asked = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    endpoints.push(new URL(url).pathname);
    asked++;
    const organic = (rank: number, url: string, title: string, breadcrumb: string) => ({ type: "organic", rank_group: rank, rank_absolute: rank + 1, url, title, breadcrumb, description: "" });
    const items = asked === 1 ? [
      { type: "ai_overview", rank_absolute: 1 },
      organic(1, "https://google.com/goto?url=CAESkgEB6zsw", "What are the 4 steps in bank reconciliation?", "https://www.moderntreasury.com › questions › what-ar..."),
      { type: "people_also_ask", rank_absolute: 3, items: [{ title: "What steps do you take to reconcile a bank statement?" }, { title: "Who prepares a bank reconciliation?" }] },
      organic(2, "https://koblesystems.com/knowledge/financials/reconciling_a_bank_account.htm", "Reconciling a Bank Account", "https://koblesystems.com › knowledge"),
      organic(3, "https://google.com/goto?url=CAESbAHrOzAV", "Bank reconciliation: what it is and how to do it", "https://ramp.com › Blog › Accounting"),
    ] : [
      organic(1, "https://www.moderntreasury.com/questions/what-are-the-four-steps-in-bank-reconciliation", "What are the 4 steps in bank reconciliation?", ""),
      organic(2, "https://google.com/goto?url=CAESother", "Reconciling a Bank Account", "https://koblesystems.com › knowledge"),
      // Same site, most of the title: the same result.
      organic(3, "https://ramp.com/blog/what-is-bank-reconciliation", "Bank reconciliation: what it is and how to do it in 2026", ""),
    ];
    return new Response(JSON.stringify({ status_code: 20000, cost: 0.002, tasks: [{ status_code: 20000, cost: 0.002, result: [{ items }] }] }),
      { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const analysis = await analyzeSerpForPlan("how to reconcile bank statements", 2840, "en");
    assert.ok(endpoints.every((path) => path === "/v3/serp/google/organic/live/advanced"), "the advanced results (People Also Ask), never the regular ones");
    assert.equal(asked, 2, "one more request recovered every wrapped result");
    assert.deepEqual(analysis.results.map((r) => r.url), ["https://www.moderntreasury.com/questions/what-are-the-four-steps-in-bank-reconciliation",
      "https://koblesystems.com/knowledge/financials/reconciling_a_bank_account.htm", "https://ramp.com/blog/what-is-bank-reconciliation"]);
    assert.deepEqual(analysis.paaQuestions, ["What steps do you take to reconcile a bank statement?", "Who prepares a bank reconciliation?"]);
  } finally {
    globalThis.fetch = realFetch;
    process.env.DATAFORSEO_LOGIN = saved.login; process.env.DATAFORSEO_PASSWORD = saved.password;
    if (saved.login === undefined) delete process.env.DATAFORSEO_LOGIN;
    if (saved.password === undefined) delete process.env.DATAFORSEO_PASSWORD;
  }
  // A result still wrapped keeps its title for the plan; its script page is never followed; an older brief is read again.
  assert.match(pipeline, /if \(googleRedirect\(result\.url\)\) return \{ result, page: null \};/);
  assert.doesNotMatch(pipeline, /resolveGoogleRedirect/);
  assert.match(pipeline, /\|\| \(articlePlanEnabled\(\) && \(brief\.reader \?\? 1\) < PLAN_SERP_READER\)\) \{/);
  assert.match(readFileSync("convex/topics.ts", "utf8"), /const newerRead = Boolean\(topic\.serpBrief && \(brief\.reader \?\? 1\) > \(topic\.serpBrief\.reader \?\? 1\)\);/);
});

test("P268 a wrapped result's breadcrumb is an address only when it is a whole path; a programming search stays a tutorial", async () => {
  const { breadcrumbUrl } = await import("../convex/actions/seoData.ts");
  const { planFormat } = await import("../convex/lib/serpBrief.ts");
  assert.equal(breadcrumbUrl("https://www.wellnessliving.com › yoga › software"), "https://www.wellnessliving.com/yoga/software");
  assert.equal(breadcrumbUrl("https://www.yogobooking.com › blog › best-booking-s..."), null, "shortened");
  assert.equal(breadcrumbUrl("https://ramp.com › Blog › Accounting"), null, "the site's own trail, not a path");
  assert.equal(breadcrumbUrl("https://lunacal.ai"), null, "a homepage is not the result");
  assert.equal(breadcrumbUrl("70+ comments · 1 year ago"), null);
  const titles = (list: string[]) => ({ results: list.map((title, i) => ({ title, url: `https://r${i}.example/` })), pages: [] });
  const vs = titles(["Pino vs Bunyan: which Node.js logger", "Pino vs Winston in 2026", "Pino logger guide"]);
  assert.equal(planFormat(vs, false, true, "node.js structured logging with pino"), "tutorial", "the search asks how to use Pino");
  assert.equal(planFormat(vs, false, false, "structured logging"), "comparison");
  assert.equal(planFormat(titles(["Guide"]), false, true, "pino vs winston"), "comparison", "the search itself asks to compare");
});

test("P268 research cites each owned fact's owner; a blog is context only, and only while fewer than 4 stronger sources exist", () => {
  assert.match(SEARCHER_LED_RESEARCH_SYSTEM, /a rebate or incentive from the utility, agency or program that pays it; a permit, fee or local rule from the city's or county's own page or fee schedule/);
  assert.match(SEARCHER_LED_RESEARCH_SYSTEM, /A blog, review site, cost guide or another company's page never supports an owned fact, even when it repeats one: find the owner's page\./);
  const roles = new Map<string, SourceRole>([["https://www.texasgasservice.com/rebates", "owner"], ["https://www.angi.com/tankless", "publication"],
    ["https://homeshow.ai/blog/austin", "blog"], ["https://kitchenbap.com/x", "blog"], ["https://another.blog/y", "blog"]]);
  const sources = [...roles.keys()].reverse().map((url) => ({ url }));
  const few = rankedResearchSources(sources, roles, 6);
  assert.deepEqual(few.kept.map((s) => s.url), ["https://www.texasgasservice.com/rebates", "https://www.angi.com/tankless", "https://another.blog/y", "https://kitchenbap.com/x"],
    "owners first, then publications; two blogs fill in as context while fewer than 4 stronger sources exist");
  assert.deepEqual(few.counts, { owner: 1, publication: 1, context: 2, dropped: 1 });
  const strong = new Map(roles); for (const url of ["https://austintexas.gov/fees", "https://www.irs.gov/25c"]) strong.set(url, "owner");
  const many = rankedResearchSources([...strong.keys()].map((url) => ({ url })), strong, 6);
  assert.equal(many.kept.filter((s) => strong.get(s.url) === "blog").length, 0, "with 4 stronger sources no blog is kept");
  assert.match(SOURCE_ROLE_LABEL.blog, /^CONTEXT ONLY: may explain; never the source of a number, price, fee, rebate, specification, date or rule$/);
  assert.match(pipeline, /const roles = await classifyResearchSources\(\{ search: topic\.primaryKeyword, sources: readable, namedProducts \}\)/);
  assert.match(pipeline, /return classifyResearchSourcesInCode\(readable, namedProducts\);/, "a failed check never stops the draft");
  assert.match(pipeline, /\$\{role \? ` \(\$\{SOURCE_ROLE_LABEL\[role\]\}\)` : ""\}/, "the writer sees who publishes each source");
  const provider = readFileSync("convex/actions/contentWorkProvider.ts", "utf8");
  assert.match(provider, /"classify_sources", "check_claims"\]\.includes\(args\.toolName\)/, "both priced at the checks model");
});

test("P268 a list names at least 6 options built for its audience, the business's own product not counted", () => {
  assert.equal(LIST_MIN_OPTIONS, 6); assert.equal(LIST_RESEARCH_SOURCES, 10);
  const request = optionSourcesRequest({ label: "Yoga scheduling", primaryKeyword: "best scheduling software for yoga studios", options: [], productName: "StudioFlow" });
  assert.match(request.system, /Name at least 6 options built for that audience: the options the current top lists for this search name, not general-purpose tools/);
  assert.match(request.system, /with each price's conditions \(plan name, billing period, introductory period, per location or per user, transaction fees and which plan they apply to\)/);
  assert.match(request.userMessage, /Find at least 6 options the current top lists for this search name/);
  assert.match(request.userMessage, /Do not research StudioFlow: it is the business this article is for\./);
  const md = "## Options\n\n### Mindbody\n\nx\n\n### StudioFlow\n\ny\n\n### Momoyoga\n\nz\n\n## Sources\n\n### Not an option\n";
  assert.equal(listOptionCount(md, "StudioFlow"), 2);
  assert.deepEqual(fixFindings(md, { format: "list", sections: ["Options"], minItems: 6 }, "StudioFlow").map((f) => f.kind), ["options"]);
  assert.match(pipeline, /minItems: Math\.max\(LIST_MIN_OPTIONS, Math\.min\(15, items \?\? LIST_MIN_OPTIONS\)\)/);
});

test("P268 no word target: coverage sets the length; no referral in place of an answer; owned facts from owners; explanations from sources", () => {
  assert.doesNotMatch(pipeline, /- LENGTH: At least \$\{Math\.max\(minimumWords, Math\.round\(articlePlan\.targetWords/, "Cowork: length targets cause repetition");
  assert.match(pipeline, /- LENGTH: There is no word target: the outline and the coverage set the length\./);
  assert.match(pipeline, /Never answer an item by sending the reader elsewhere \("check the manufacturer", "ask your plumber", "contact your utility", "see the vendor's site"\); when no excerpt supports an item, leave that item out\./);
  assert.doesNotMatch(pipeline, /say in one plain sentence that it isn't published or varies and what the reader should ask or check/);
  assert.match(pipeline, /- OWNED FACTS: .*never total, average or extend a price or fee beyond what the page says\./);
  assert.match(pipeline, /- EXPLANATIONS: Explain a cause or mechanism \(physics, chemistry, health, money, software internals\) only as a fact-sheet source explains it/);
  assert.match(pipeline, /Every section that teaches a step or a pattern shows it in a complete, runnable fenced code block/);
  assert.match(pipeline, /name in the same line whose page states it \(for example: 'rebate amounts, from the utility or program that pays them'/);
  assert.doesNotMatch(readFileSync("convex/lib/finalArticleReview.ts", "utf8"), /check the vendor's current documentation for the full list/, "the fix never adds a referral");
});

test("P268 code finds what Cowork marked: a passage said again, a reader sent elsewhere, a tutorial step without code", () => {
  const md = [
    "Reconciling finds differences early.",
    "## Why it matters",
    "Any gap is a human mistake, a bank issue, or fraud, so look at it the same day. Compare outstanding checks and deposits in transit.",
    "## Find the difference",
    "When the totals differ, it is a human mistake, a bank issue, or fraud. List outstanding checks and deposits in transit.",
    "## Frequently asked questions",
    "**Why don't they match?** Usually a human mistake, a bank issue, or fraud.",
  ].join("\n\n");
  const repeated = repeatedPassages(md, 6, "outstanding checks, deposits in transit");
  assert.deepEqual(repeated.map((r) => [r.phrase, r.count]), [["is a human mistake a bank issue or fraud", 2]],
    "the caveat is found (not in the FAQ, which may sum up); the subject's own terms are vocabulary, not a repeat");
  assert.deepEqual(deflections("Ask your plumber who pulls the permit. Hire a licensed plumber for gas work. Check the manufacturer's care label for oven limits."),
    ["Ask your plumber who pulls the permit.", "Check the manufacturer's care label for oven limits."]);
  const tutorial = ["## What structured logging is", "Plain text is hard to search.", "## Install Pino", "1. Install it:", "   ```bash", "   npm install pino", "   ```",
    "## Child loggers", "Use a child logger to add the request id to every line.", "## Frequently asked questions", "**Is Pino fast?** Yes."].join("\n");
  assert.deepEqual(sectionsWithoutCode(tutorial), ["Child loggers"], "a fence indented inside a numbered step is code");
  // Code output is code, not a claim (batch 2's tutorial: "pid": 11187 read as a number missing from the fact sheet).
  const output = "## Run it\n\n1. Run it:\n\n   ```json\n   { \"level\": 30, \"pid\": 11187 }\n   ```\n";
  assert.deepEqual(numbersOutsideFactSheet(output, { sources: [], profile: "", productName: "" }), []);
});

test("P268 the one fix runs on the first review with the claims check and the code findings; a later review never fixes twice", () => {
  assert.match(pipeline, /const fixedBefore = \(article\.qualityRevisionCount \?\? 0\) >= 1;\n\s+let fixedNow = false;\n\s+if \(!fixedBefore\) \{/);
  assert.match(pipeline, /const qualityRevisionCount = \(article\.qualityRevisionCount \?\? 0\) \+ \(incrementRevision \|\| fixedNow \? 1 : 0\);/);
  assert.match(pipeline, /const claims = plan \? await checkPlannedClaims\(/);
  assert.match(pipeline, /\.\.\.claims\.map\(\(claim\) => `Correct this sentence \(/);
  assert.match(pipeline, /\.\.\.found\.map\(\(finding\) => finding\.line \? `\$\{finding\.detail\}: «\$\{finding\.line\}»` : `\$\{finding\.detail\}\.`\),/);
  assert.match(pipeline, /an introductory or promotional price given as the regular price/);
  assert.match(pipeline, /a scientific, technical or causal statement that is wrong, such as a physical explanation stated backwards/);
  assert.match(readFileSync("convex/contentWork.ts", "utf8"), /:review:check_claims\$\/;/, "the claims check is optional under the $0.50 cap");
  // Never a gate: the new findings are not plan checks.
  assert.doesNotMatch(readFileSync("convex/lib/articlePlanChecks.ts", "utf8").slice(0, readFileSync("convex/lib/articlePlanChecks.ts", "utf8").indexOf("export function runPlanChecks")),
    /fixFindings\(/);
});
