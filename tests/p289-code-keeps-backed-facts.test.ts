// P289 (Nov 3 2026, ops/ARTICLE-PLAN-V2.md step 4 and holes 1-3): code decides what stays. Batches 1-3 failed Cowork 0 of 15,
// mostly on wrong facts: a rebate credited to the wrong utility, an introductory price shown as regular, old fees from small
// blogs, backwards physics ("low specific heat, so it stores a lot of heat"), a caveat said 3-7 times, "check the
// manufacturer". A sentence its cited source doesn't back is now deleted by code before the article is checked again;
// nothing is handed to the customer to check.
import test from "node:test";
import assert from "node:assert/strict";
import { backedFactsOnly, namedEntities } from "../convex/lib/backedFacts.ts";

const sources = [
  { text: "Texas Gas Service pays a $400 rebate for a qualifying tankless water heater. Installed prices run $2,100 to $5,600." },
  { text: "Cast iron has a high heat capacity, so it holds heat well once hot. Enameled cast iron should not be heated empty." },
  { text: "Pino logs at level 30 (info) by default. Install it with npm." },
];
const input = { sources, profile: "Name: Cedar Ridge Plumbing\nEstimates are free.", allowedNames: ["Cedar Ridge Plumbing", "Austin"], topic: "tankless water heater installation austin" };
const run = (markdown: string, extra = {}) => backedFactsOnly(markdown, { ...input, ...extra });

test("P289 a number its cited source states stays; one it doesn't, or an uncited one, goes", () => {
  const out = run([
    "Gas units cost $2,100 to $5,600 installed [1]. Most jobs take 9 hours [1]. Pino's default level is 30 [3].",
    "",
    "Permits in town cost $119. Cedar Ridge Plumbing gives free estimates.",
  ].join("\n"));
  assert.match(out.markdown, /Gas units cost \$2,100 to \$5,600 installed \[1\]\./);
  assert.match(out.markdown, /Pino's default level is 30 \[3\]\./);
  assert.doesNotMatch(out.markdown, /9 hours|\$119/);
  assert.match(out.markdown, /Cedar Ridge Plumbing gives free estimates\./, "the business's own facts need no citation");
  assert.deepEqual(out.removed.map((r) => r.reason).sort(), ["number", "number"]);
});

test("P289 the right number under the wrong company goes (hole 2)", () => {
  const out = run("Austin Energy pays a $400 rebate for tankless heaters [1]. Texas Gas Service pays a $400 rebate [1].");
  assert.doesNotMatch(out.markdown, /Austin Energy/);
  assert.match(out.markdown, /Texas Gas Service pays a \$400 rebate \[1\]\./);
  assert.deepEqual(out.removed.map((r) => r.reason), ["name"]);
  assert.deepEqual(namedEntities("Austin Energy pays a $400 rebate."), ["Austin", "Energy"]);
  assert.deepEqual(namedEntities("Budget for permits."), [], "a sentence's first word is not a name by itself");
});

test("P289 a cause its source doesn't state goes, a backwards one included (hole 1); advice stays", () => {
  const out = run([
    "Cast iron has low specific heat, so it stores a lot of heat [2].",
    "",
    "Cast iron has a high heat capacity, so it holds heat well once hot [2].",
    "",
    "Ceramic pans warp because of thermal shock.",
    "",
    "Preheat the pan slowly, because enameled cast iron should not be heated empty.",
  ].join("\n"));
  assert.doesNotMatch(out.markdown, /low specific heat|thermal shock/);
  assert.match(out.markdown, /high heat capacity, so it holds heat well/);
  assert.match(out.markdown, /^Preheat the pan slowly/m);
});

test("P289 the later copy of a passage, a referral and a claim the check found go", () => {
  const caveat = "Rebate amounts and eligibility rules change every year without notice";
  const out = run([
    `${caveat} [1].`,
    "",
    `Note that ${caveat.toLowerCase()} [1]. Ask your plumber about the permit fee.`,
    "",
    "Pino was first released in 2014.",
  ].join("\n"), { wrongClaims: ["Pino was first released in 2014."] });
  assert.equal(out.markdown.match(/change every year without notice/g)?.length, 1);
  assert.doesNotMatch(out.markdown, /Ask your plumber|2014/);
  assert.deepEqual(out.removed.map((r) => r.reason).sort(), ["claim", "referral", "repeat"]);
});

test("P289 an FAQ answer left with nothing goes with its question (hole 3); a worked example keeps its amounts", () => {
  const bold = run([
    "## Frequently asked questions",
    "",
    "**How long does a tankless heater last?**",
    "It lasts 25 years.",
    "",
    "**Is the estimate free?**",
    "Yes, Cedar Ridge Plumbing gives free estimates.",
  ].join("\n"));
  assert.doesNotMatch(bold.markdown, /How long does|25 years/);
  assert.match(bold.markdown, /\*\*Is the estimate free\?\*\*\nYes, Cedar Ridge Plumbing gives free estimates\./);
  const headings = run([
    "## FAQ",
    "",
    "### Do I need a permit?",
    "",
    "A permit costs $67 in most cities.",
    "",
    "### Is the estimate free?",
    "",
    "Yes, Cedar Ridge Plumbing gives free estimates.",
    "",
    "## Worked example",
    "",
    "A $10,450 balance less $350 in fees leaves $10,100.",
  ].join("\n"));
  assert.doesNotMatch(headings.markdown, /Do I need a permit|\$67/);
  assert.match(headings.markdown, /### Is the estimate free\?/);
  assert.match(headings.markdown, /A \$10,450 balance less \$350 in fees leaves \$10,100\./, "a worked example's amounts are illustrations");
});

test("P289 a table row whose figure no source states goes; a table left empty goes whole; Sources are never edited", () => {
  const out = run([
    "| Option | Installed price |",
    "|---|---|",
    "| Gas | $2,100 to $5,600 |",
    "| Electric | $999 to $1,111 |",
    "",
    "| Fee | Amount |",
    "|---|---|",
    "| Permit | $67 |",
    "",
    "## Sources",
    "",
    "1. Texas Gas Service rebates, 2026: $1,234.",
  ].join("\n"));
  assert.match(out.markdown, /\| Gas \| \$2,100 to \$5,600 \|/);
  assert.doesNotMatch(out.markdown, /Electric|\| Fee \||Permit/);
  assert.match(out.markdown, /1\. Texas Gas Service rebates, 2026: \$1,234\./);
  assert.equal(out.removed.filter((r) => r.reason === "table").length, 2);
});

test("P289 the planned review deletes by code before the one fix and again after it; the writer cites every factual sentence", async () => {
  const { readFileSync } = await import("node:fs");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const review = pipeline.slice(pipeline.indexOf("async function reviewPlannedArticle("), pipeline.indexOf("const candidate = candidateFor(fields);\n  const quality = evaluatePublicationQuality(candidate, \"strict\");"));
  const deleted = review.indexOf("const cleaned = backedFactsOnly(fields.markdown, { ...backing, unbacked: flaggedNow(fields.markdown) });"), fix = review.indexOf("await remediateFinalArticle(");
  assert.ok(deleted > 0 && fix > deleted, "code deletes first, then the one fix");
  assert.match(review, /const refixed = fixed \? backedFactsOnly\(/, "the fix's output is checked by code again");
  assert.doesNotMatch(review, /Correct this sentence \(/, "the claims check's finds are deleted, not sent to the fix");
  assert.match(pipeline, /End EVERY sentence that states a fact \(a number, price, fee, date, name, rule, or why something happens\) with the \[n\]/);
  assert.match(pipeline, /- DATES: Give each price, fee, rebate, incentive and rule "as of \$\{new Date\(\)\.toLocaleString\("en-US", \{ month: "long", year: "numeric", timeZone: "UTC" \}\)\}"/);
});
