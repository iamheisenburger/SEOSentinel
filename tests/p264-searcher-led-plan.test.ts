// P264 (Oct 31 2026): Cowork judged the fixed plan's first 5 articles 0 of 5 (ops/COWORK-JUDGE-RESULTS.md): "The plan is
// source-led, not searcher-led. Research collects mostly official and government pages, and the writer may only use facts
// from them. The things searchers want are then missing: prices, cost ranges, named products, the basic code, the rebate."
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { articleOutlinePrompt } from "../convex/lib/articlePlanChecks.ts";
import { coverageSourcesRequest, PLANNED_RESEARCH_SOURCES, SEARCHER_LED_RESEARCH_SYSTEM } from "../convex/lib/researchPasses.ts";
import { medianWords } from "../convex/lib/serpBrief.ts";
import { reputableSecondarySource, strictEvidenceSources } from "../convex/lib/sourceQuality.ts";
import { withSourcesSection } from "../convex/lib/sourcesHeading.ts";

const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");

test("P264 the outline comes first and lists what the top results give a searcher; research looks for each item", () => {
  const outline = pipeline.indexOf("// ── Step 0b: The fixed article plan's outline"), research = pipeline.indexOf("// ── Step 1: Web Research");
  assert.ok(outline > 0 && outline < research, "the plan is made before research");
  assert.match(pipeline, /coverage: \{ type: "array", items: \{ type: "string" \} \},\n\s+\}, required: \["sections", "extra", "coverage"\] \},/);
  assert.doesNotMatch(pipeline, /never plan a section that needs facts no source gives/, "the plan is what searchers need, not what is easy to source");
  assert.match(pipeline, /\["COVERAGE \(what the top results give a searcher; find a source for each item\):", \.\.\.coverage\.map/);
  assert.match(pipeline, /system: planned \? SEARCHER_LED_RESEARCH_SYSTEM : \[/);
  // P268: an owned fact comes from its owner; cost guides and publications give context.
  assert.match(SEARCHER_LED_RESEARCH_SYSTEM, /OWNED FACTS come from their owner's own page: a product's prices, plans and features from the seller's pricing or product page; a rebate or incentive from the utility, agency or program that pays it/);
  assert.match(SEARCHER_LED_RESEARCH_SYSTEM, /major cost guides \(for example Angi or HomeGuide\)/);
  assert.match(SEARCHER_LED_RESEARCH_SYSTEM, /check that a rule is still in force/, "Cowork: the vacated FTC rule was stated as current");
  const second = coverageSourcesRequest({ label: "Tankless installation", primaryKeyword: "tankless water heater installation austin",
    coverage: ["Installed cost range in Austin", "Texas Gas Service rebate amounts"], targetCountry: "United States", avoidHosts: ["energystar.gov"] });
  assert.match(second.userMessage, /COVERAGE still without its owner's page or a reputable source \(find one for each item you can\):\n- Installed cost range in Austin\n- Texas Gas Service rebate amounts/);
  assert.equal(PLANNED_RESEARCH_SOURCES, 6);
});

test("P264 reputable secondary pages are evidence for a planned article; forums, social media and marketplaces never are", () => {
  const pool = [{ url: "https://www.angi.com/articles/how-much-does-tankless-water-heater-cost.htm" }, { url: "https://www.reddit.com/r/Austin/x" },
    { url: "https://www.facebook.com/groups/x" }, { url: "https://www.energy.gov/energysaver/tankless-or-demand-type-water-heaters" }];
  assert.deepEqual(strictEvidenceSources(pool).accepted.map((s) => s.url), ["https://www.energy.gov/energysaver/tankless-or-demand-type-water-heaters"],
    "the old pipeline is unchanged");
  assert.deepEqual(strictEvidenceSources(pool, { reputableSecondary: true }).accepted.map((s) => s.url),
    ["https://www.angi.com/articles/how-much-does-tankless-water-heater-cost.htm", "https://www.energy.gov/energysaver/tankless-or-demand-type-water-heaters"]);
  assert.equal(reputableSecondarySource("https://www.amazon.com/dp/B0"), false);
  assert.equal(reputableSecondarySource("https://momence.com/pricing"), true, "a product's own pricing page");
  assert.match(readFileSync("convex/actions/contentWorkProvider.ts", "utf8"), /const secondary = reputableSecondary && reputableSecondarySource\(source\.url\);/,
    "their passages are read from the page, like documentation");
});

test("P264 the writer gives every coverage item, finishes its examples, says each thing once, and formats deliver what searchers need", () => {
  // P268: never a referral in place of an item ("ask your plumber"); an item no excerpt supports is left out.
  assert.match(pipeline, /- COVERAGE: Give the reader every item below \(what the top results give a searcher\), with its specific figures, names and steps from the fact sheet\. Never answer an item by sending the reader elsewhere/);
  assert.match(pipeline, /- SYNTHESIZE: Give a worked example its own section headed "Worked example".*make every number add up\. Say each step and each piece of advice once/);
  assert.match(pipeline, /State a law, rule or program as current only when a fact-sheet page from the last 12 months says it is in force/);
  const tutorial = articleOutlinePrompt({ format: "tutorial", sections: ["Install"] }, new Map());
  assert.match(tutorial, /the install command, then a complete fenced code block for each step \(one file, or the lines it adds\), how to run it, and the output it prints/);
  const list = articleOutlinePrompt({ format: "list", sections: ["Options"], minItems: 6 }, new Map());
  assert.match(list, /name at least 6 real options built for this search's audience, each as an H3 \(### Name\) with its price/);
  assert.match(articleOutlinePrompt({ format: "comparison", sections: ["Compare"] }, new Map()), /Say what each option is, compare them in a markdown table/);
  const page = (words: number) => ({ url: "https://x.example/", headings: [], words, codeBlocks: 0, tables: 0, items: 0 });
  assert.equal(medianWords({ pages: [page(3000), page(4000), page(5000), page(400), page(500)] }), 4000, "the median of the top 3 (Cowork's bar)");
});

test("P264 a draft that cites [n] keeps its Sources list on every platform", () => {
  const sources = [{ url: "https://www.irs.gov/publications/p583", title: "Publication 583" }, { url: "https://www.angi.com/x" }];
  const markdown = "Keep records for three years [1]. Costs vary [2].";
  assert.equal(withSourcesSection(markdown, sources),
    "Keep records for three years [1]. Costs vary [2].\n\n## Sources\n\n1. [Publication 583](https://www.irs.gov/publications/p583)\n2. [angi.com](https://www.angi.com/x)\n");
  assert.equal(withSourcesSection(`${markdown}\n\n## Sources\n\n1. [P](https://x.example/)`, sources), `${markdown}\n\n## Sources\n\n1. [P](https://x.example/)`, "one list only");
  assert.equal(withSourcesSection("No citations here.", sources), "No citations here.");
  assert.match(pipeline, /if \(articlePlan\) article\.markdown = withSourcesSection\(article\.markdown, dedupedSources\);\n  let finalMarkdown = article\.markdown;/);
  // P268: the fixed draft (kept unless it fails more objective checks) keeps its Sources list.
  assert.match(pipeline, /const fixedFields = fixed \? \{ \.\.\.fields, markdown: withSourcesSection\(fixed\.markdown, article\.sources \?\? \[\]\) \} : null;/);
});

test("P264 planned research has room for its cited brief; a programming search is a tutorial unless 3 pages show no code", async () => {
  assert.match(pipeline, /\.\.\.\(planned \? \{ reputableSecondary: true, maxTokens: 8000 \} : \{\}\),/);
  assert.doesNotMatch(pipeline, /analyzeBingSERP/, "DataForSEO's Bing results were unrelated pages (Yahoo Mail for a Pino search)");
  const { planFormat } = await import("../convex/lib/serpBrief.ts");
  const page = (codeBlocks: number) => ({ url: "https://x.example/", headings: [], words: 900, codeBlocks, tables: 0, items: 0 });
  assert.equal(planFormat({ results: [], pages: [page(0), page(0)] }, false, true, "node.js structured logging with pino"), "tutorial");
  assert.equal(planFormat({ results: [], pages: [page(0), page(0), page(0)] }, false, true, "what is an api"), "guide");
});

test("P264 a planned article matches the top results' depth: the longer of two pages, a format default, a ceiling that follows the target", async () => {
  const { plannedWordCeiling } = await import("../convex/lib/articleQuality.ts");
  const { FORMAT_DEFAULT_WORDS } = await import("../convex/lib/serpBrief.ts");
  const page = (words: number) => ({ url: "https://x.example/", headings: [], words, codeBlocks: 0, tables: 0, items: 0 });
  assert.equal(medianWords({ pages: [page(1662), page(3567)] }), 3567, "Cowork compared the how-to with Brex's 3,567-word page");
  assert.equal(FORMAT_DEFAULT_WORDS.tutorial, 2500, "no page read: a tutorial still gets tutorial depth");
  // P268: no word target (Cowork: "Length targets cause repetition"); the ceiling only stops a runaway draft.
  assert.equal(plannedWordCeiling("how-to", 4000), 7000);
  assert.equal(plannedWordCeiling("how-to", 1500), 7000);
  assert.equal(plannedWordCeiling("standard", 9000), 7000, "at most 7,000 words");
  assert.match(readFileSync("convex/lib/articleQuality.ts", "utf8"), /const maxWords = planned \? plannedWordCeiling\(article\.articleType, article\.articlePlan\?\.targetWords\) : articleWordCeiling\(article\.articleType\);/);
});

test("P264 a worked example may use illustrative amounts; real statistics elsewhere still need their source", async () => {
  const { exampleSections, missingOutlineSections, numbersOutsideFactSheet } = await import("../convex/lib/articlePlanChecks.ts");
  const sheet = { sources: [{ url: "https://www.irs.gov/p583", text: "Keep records for 3 years." }], profile: "", productName: "" };
  const markdown = "Keep records for 3 years [1]. Most owners save 40% of their time.\n\n## Worked example\n\nThe bank shows $10,000 and the books $11,425.\n\n" +
    "| Item | Bank | Books |\n|---|---|---|\n| Deposit in transit | +$2,000 | |\n\n## Common errors\n\nA transposed $54 entry reads as $45.";
  assert.equal(exampleSections(markdown).length, 1);
  assert.deepEqual(numbersOutsideFactSheet(markdown, sheet).map((f) => f.line), ["Most owners save 40% of their time.", "A transposed $54 entry reads as $45."],
    "the example's amounts are exempt; a statistic and an amount outside it are not");
  assert.deepEqual(missingOutlineSections("## Worked template for a reconciliation\n\nText.", { format: "how-to", sections: ["Worked example of a reconciliation"] }), [],
    "a renamed heading that keeps most words is present");
  assert.equal(missingOutlineSections("## Pricing\n\nText.", { format: "how-to", sections: ["Worked example of a reconciliation"] }).length, 1);
  assert.match(pipeline, /Give a worked example its own section headed "Worked example" \(or an H3 "Example"\): its illustrative amounts need no source, but finish it/);
  assert.match(readFileSync("convex/lib/articleQuality.ts", "utf8"), /const examples = article\.qualityPlan === "fixed_v1" \? exampleSections\(markdown\) : \[\];/);
});

test("P265 the global numbers rule names the worked example as its one exception, so examples get real amounts", () => {
  assert.match(pipeline, /The one exception is a worked example in its own section headed as an example \(see SYNTHESIZE\): give it realistic illustrative amounts \(dollar figures, not letters or placeholders\) and make them add up\./);
});

test("P265 the length never drops below the format's depth; a worked example the coverage asks for gets its own section", () => {
  assert.match(pipeline, /const targetWords = Math\.max\(minimumWords, Math\.min\(7000, Math\.max\(median \?\? 0, FORMAT_DEFAULT_WORDS\[format\]\)\)\);/);
  assert.match(pipeline, /sections\.splice\(faq >= 0 \? faq : sections\.length, 0, "Worked example"\);/);
});
