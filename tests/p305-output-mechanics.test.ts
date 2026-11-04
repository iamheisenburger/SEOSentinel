// P305 (Nov 3 2026, Cowork's batch 9 verdicts): the output mechanics. Pins: code fences are immune to the deletion
// cascade (batch 9's python article lost every "def …:" / "try:" line — the cascade read a fenced next line as a
// dangling intro); a price sentence already dated "As of November 2026" gets no second date; a record's prose display is
// normalized ("$4 and $11" is "$4–$11"), stated at most once, lowercased after a colon, and a value repeating its
// sentence's words drops its parenthetical aside or the paragraph; nav-label and non-Latin source titles fall back to
// the page's heading then the site; a timing heading with no timing fact goes; waveapps.com and squareup.com count as
// Wave's and Square's own domains.
import test from "node:test";
import assert from "node:assert/strict";
import { deleteSentencesCoherently } from "../convex/lib/coherentDeletion.ts";
import { withPriceDate, withoutUntimedSections } from "../convex/lib/backedFacts.ts";
import { proseDisplay, proseParagraphs } from "../convex/lib/articleAssembly.ts";
import { readableSourceTitle } from "../convex/lib/sourceQuality.ts";
import { firstPartyProductPage } from "../convex/lib/sourceQuality.ts";

test("P305: the deletion cascade never blanks a ':' line inside a code fence", () => {
  const markdown = [
    "The helper below retries a request.",
    "",
    "```python",
    "def fetch(url):",
    "    for attempt in range(3):",
    "        try:",
    "            return requests.get(url, timeout=5)",
    "        except RetryError:",
    "            raise",
    "```",
    "",
    "A sentence with an unbacked number 424242 goes.",
  ].join("\n");
  const result = deleteSentencesCoherently(markdown, (sentence) => sentence.includes("424242"));
  assert.match(result.markdown, /def fetch\(url\):/);
  assert.match(result.markdown, /for attempt in range\(3\):/);
  assert.match(result.markdown, /try:/);
  assert.match(result.markdown, /except RetryError:/);
  assert.doesNotMatch(result.markdown, /424242/);
});

test("P305: a prose ':' intro before a code fence stays (code following is content, not a deleted block)", () => {
  const markdown = [
    "Add the retry guard to your client:",
    "",
    "```python",
    "session.mount(\"https://\", HTTPAdapter(max_retries=retries))",
    "```",
    "",
    "An unbacked sentence with number 99999 disappears.",
  ].join("\n");
  const result = deleteSentencesCoherently(markdown, (sentence) => sentence.includes("99999"));
  assert.match(result.markdown, /Add the retry guard to your client:/);
  assert.match(result.markdown, /HTTPAdapter/);
});

test("P305: a ':' intro whose introduced block really was deleted still goes", () => {
  const markdown = [
    "The steps are:",
    "",
    "Run the compressor at 42424 psi until the lines are dry.",
    "",
    "## What happens next",
    "",
    "After that, this paragraph stays.",
  ].join("\n");
  const result = deleteSentencesCoherently(markdown, (sentence) => sentence.includes("42424"));
  assert.doesNotMatch(result.markdown, /The steps are:/);
  assert.match(result.markdown, /this paragraph stays/);
});

test("P305: a sentence-initial 'As of November 2026' dates the price; no second date is inserted", () => {
  const article = "## Costs\n\nAs of November 2026, the service starts at $250 a month and includes reconciliation.";
  const dated = withPriceDate(article, Date.UTC(2026, 10, 3));
  assert.equal((dated.match(/as of November 2026/gi) ?? []).length, 1);
});

test("P305: proseDisplay normalizes ranges and never invents digits", () => {
  assert.equal(proseDisplay("$4 and $11 per square foot"), "$4–11 per square foot");
  assert.equal(proseDisplay("$9,000 –$13,500"), "$9,000–13,500");
  assert.equal(proseDisplay("40 to 60 gallons"), "40–60 gallons");
  assert.equal(proseDisplay("Almost always full tear-offs"), "Almost always full tear-offs");
  // A normalization that changed the digits falls back to the trimmed value.
  assert.equal(proseDisplay("3 reviews"), "3 reviews");
});

const pool = {
  r1: { display: "$10,000 –$16,000 (typical Denver tract ranch or two-story)", source: 1, label: "cost" },
  r2: { display: "Almost always full tear-offs", source: 1, label: "pattern" },
  r3: { display: "$4 and $11 per square foot", source: 1, label: "cost per square foot" },
};

test("P305: a fill's parenthetical aside goes when the sentence already says its words", () => {
  const used = new Map<string, number>();
  const result = proseParagraphs("A typical Denver tract ranch or two-story falls at {{r1}}.", { pool, scope: [], used, allowedText: "Denver tract ranch" });
  assert.equal(result.kept, "A typical Denver tract ranch or two-story falls at $10,000–16,000 [1].");
});

test("P305: a fill after a colon follows the sentence's case, and a record is stated at most once", () => {
  const used = new Map<string, number>();
  const first = proseParagraphs("The pattern: {{r2}} in that era.", { pool, scope: [], used, allowedText: "roof" });
  assert.equal(first.kept, "The pattern: almost always full tear-offs [1] in that era.");
  const second = proseParagraphs("Across the city, the pattern is again {{r2}} for most homes.", { pool, scope: [], used, allowedText: "roof" });
  assert.equal(second.kept, "");
  assert.ok(second.dropped.length === 1);
});

test("P305: a value repeating the sentence's own words drops the paragraph", () => {
  const used = new Map<string, number>();
  const result = proseParagraphs("The cost per square foot runs {{r3}} typically.", { pool, scope: [], used, allowedText: "roof" });
  assert.equal(result.kept, "");
});

test("P305: nav-label and non-Latin titles fall back to the page's heading, then the site", () => {
  assert.equal(readableSourceTitle("Back to Garden & Landscape", "https://extension.colostate.edu/topic-areas/"),
    "extension.colostate.edu");
  assert.equal(readableSourceTitle("urllib3.util.retry 源代码", "https://urllib3.readthedocs.io/en/stable/reference/urllib3.util.html",
    "# urllib3.util.util — Utilities\n\nThe Retry class…"), "urllib3.util.util — Utilities");
  assert.equal(readableSourceTitle("How to Winterize a Sprinkler System", "https://example.com/x"), "How to Winterize a Sprinkler System");
});

test("P305: a timing heading with no timing fact goes; one with a sourced month stays", () => {
  const article = [
    "## When to winterize your sprinkler system",
    "",
    "If you are reading this in early November, treat it as the time to do the job now.",
    "",
    "## How to drain the lines",
    "",
    "Open the manual drains with 50 psi of pressure.",
  ].join("\n");
  const removed = withoutUntimedSections(article);
  assert.doesNotMatch(removed.markdown, /When to winterize/);
  assert.match(removed.markdown, /How to drain the lines/);

  const timed = article.replace("If you are reading this in early November, treat it as the time to do the job now.",
    "Blow the lines out before the first hard freeze, typically by early October along the Front Range.");
  assert.match(withoutUntimedSections(timed).markdown, /When to winterize/);
});

test("P305: waveapps.com and squareup.com are Wave's and Square's own domains (the invoicing list's missing options)", () => {
  assert.equal(firstPartyProductPage("https://www.waveapps.com/pricing/", ["wave"]), true);
  assert.equal(firstPartyProductPage("https://squareup.com/us/en/pricing", ["square"]), true);
  assert.equal(firstPartyProductPage("https://www.seobotreview.com/wave", ["wave"]), false);
});

// P306 (batch 10's Austin): the authority keeps its seat, and only an authority figures a permit.
import { rankedResearchSources, missingFigureItems } from "../convex/lib/researchPasses.ts";

test("P306: a .gov source past the cap keeps its seat beside the cost pages", () => {
  const sources = [
    { url: "https://homeshow.ai/blog/water-heater-cost-austin/" },
    { url: "https://www.abacusplumbing.com/tank-tankless-hot-water-heaters" },
    { url: "https://permitcalculator.com/cities/austin-tx/" },
    { url: "https://koalacooling.com/plumbing-service/tankless" },
    { url: "https://homeshow.ai/blog/water-heater-cost-austin-2/" },
    { url: "https://www.austintexas.gov/department/permitting" },
    { url: "https://www.texasgasservice.com/rebates" },
  ];
  const roles = new Map<string, "owner" | "publication" | "blog">([
    ["https://www.austintexas.gov/department/permitting", "publication"],
    ["https://www.texasgasservice.com/rebates", "owner"],
  ]);
  const ranked = rankedResearchSources(sources, roles, 6);
  assert.ok(ranked.kept.some((s) => s.url.includes("austintexas.gov")), "the city's page survives the cap");
  assert.ok(ranked.kept.some((s) => s.url.includes("homeshow.ai")), "the cost guides keep their seats too");
});

test("P306: a permit fee a third-party calculator states is not covered; the city's page covers it", () => {
  const calculator = { title: "Permit pricing", url: "https://permitcalculator.com/cities/austin-tx/", excerpt: "Permit pricing for Austin runs $75 to $150 for most residential swaps." };
  const city = { title: "Development Services", url: "https://www.austintexas.gov/department/development-services", excerpt: "The City of Austin charges a $98 fee to permit a water heater replacement." };
  const missing = missingFigureItems(["water heater permit cost"], [calculator]);
  assert.equal(missing.length, 1, "the permit item is still missing: only an authority page can cover it");
  const covered = missingFigureItems(["water heater permit cost"], [calculator, city]);
  assert.equal(covered.length, 0, "the city's own fee figure covers the item");
});

// P307 (overnight, Cowork's two cautions): coverage holds, range-context normalization, deletion holds, step dedup.
const now = Date.UTC(2026, 10, 4);
import { verifiedRecords, unsatisfiedFigureItems } from "../convex/lib/articleAssembly.ts";
import { FIGURE_ITEM, ITEM_FILLER } from "../convex/lib/researchPasses.ts";

test("P307: ranges normalize only in range wording; two separate amounts stay", () => {
  assert.equal(proseDisplay("between $4 and $11 per square foot"), "$4–11 per square foot");
  assert.equal(proseDisplay("$60 to $130"), "$60–130");
  assert.equal(proseDisplay("$400 and $650 rebate tiers"), "$400 and $650 rebate tiers");
});

test("P307: the section's only prose before code is never deleted", () => {
  const markdown = [
    "## Writing logs to a file",
    "",
    "The transports option writes each log line to a file with 77777 rotation.",
    "",
    "```js",
    "const transport = pino.transport({ target: 'pino/file' })",
    "```",
  ].join("\n");
  const result = deleteSentencesCoherently(markdown, () => true);
  assert.match(result.markdown, /transports option writes each log line/);
  assert.match(result.markdown, /pino\.transport/);
});

test("P307: a numbered step referenced later is never deleted", () => {
  const markdown = [
    "1. Shut off the water at the valve with 42424 psi.",
    "2. Open the drains.",
    "",
    "Step 1 is what protects the pipes from freezing.",
  ].join("\n");
  const result = deleteSentencesCoherently(markdown, (s) => s.includes("42424"));
  assert.match(result.markdown, /Shut off the water/);
});

test("P307: two steps saying the same thing in one procedure keep the first", () => {
  const sources = [{ url: "https://denverwater.org/winterize", title: "Denver Water winterization",
    excerpt: "1. Turn off the water supply to the sprinkler system at the shutoff valve. 2. Open the boiler drain. 3. Shut off the water supply at the valve using the shutoff." }];
  const v = verifiedRecords({ options: [], facts: [], faqs: [],
    steps: [
      { section: "Steps", step: "Turn off the water supply to the sprinkler system at the shutoff valve", quote: "Turn off the water supply to the sprinkler system at the shutoff valve", source: 1 },
      { section: "Steps", step: "Open the boiler drain valve", quote: "Open the boiler drain", source: 1 },
      { section: "Steps", step: "Shut off the water supply at the valve using the shutoff", quote: "Shut off the water supply at the valve using the shutoff", source: 1 }] },
    { sources, profile: "", productName: "X", competitors: [], sections: ["Steps"], now });
  const steps = v.steps ?? [];
  assert.equal(steps.length, 2, `expected the duplicate shut-off to collapse, got ${steps.length}`);
});

test("P307: a planned figure item with no record is named unsatisfied", () => {
  const v = verifiedRecords({ options: [], facts: [
      { section: "Costs", subject: "roof", kind: "cost", label: "Typical total cost", value: "$11,712",
        quote: "Denver roofs average $11,712 installed", source: 1 }], faqs: [] },
    { sources: [{ url: "https://example.com/cost", title: "Costs", excerpt: "Denver roofs average $11,712 installed" }],
      profile: "", productName: "X", competitors: [], sections: ["Costs", "Permits"], now });
  const missing = unsatisfiedFigureItems(["roof permit fee from the city", "typical total roof cost in dollars"], v, FIGURE_ITEM, ITEM_FILLER);
  assert.ok(missing.some((m) => m.includes("permit")), "the permit item has no record");
  assert.ok(!missing.some((m) => m.includes("total roof cost")), "the cost item is satisfied");
});

test("P307: 'undefined' and bare-domain titles use the excerpt's first content line", () => {
  assert.equal(readableSourceTitle(undefined, "https://raw.githubusercontent.com/pinojs/pino/docs/api.md",
    "pino(opts, stream)\nsends JSON objects to a stream"), "pino(opts, stream)");
});

// P308 (batch 11's three range leaks): "between {{r}}" folds a two-amount value into one dashed range; FAQ answers
// and the intro's money records print normalized.
test("P308: a 'between' before a placeholder folds the record's two amounts", () => {
  const pool = { r1: { display: "$2,500 and $10,000", source: 1, label: "installed cost" } };
  const used = new Map<string, number>();
  const out = proseParagraphs("New heat pumps typically cost between {{r1}} to install, depending on the home.",
    { pool, scope: [], used, allowedText: "heat pump install" });
  assert.equal(out.kept, "New heat pumps typically cost $2,500–10,000 [1] to install, depending on the home.");
});
