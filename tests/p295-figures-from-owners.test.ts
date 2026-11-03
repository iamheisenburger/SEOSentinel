// P295 (Nov 3 2026, Cowork's batch 4: 0 of 7, ops/COWORK-JUDGE-RESULTS.md): accuracy was high, but deletion emptied the
// sections searchers want (a cost section with no prices, a column of dashes, "Rebates" with no rebate) though every missing
// figure was on its owner's page. Fix 1: each required item that asks for a figure and has none in the kept sources gets a
// targeted search on its owner's site before writing. Fix 2: a figure heading over no figure, and a column of dashes, go.
// Fix 3: the same number and unit, or claim, said again in other words goes. Fix 4: "ask your installer", "check in a trial"
// and "ask for an estimate" go from a figure section. Fix 5: the FAQ is last.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { itemLookupRequest, missingFigureItems } from "../convex/lib/researchPasses.ts";
import { backedFactsOnly, withFaqLast, withoutEmptyFigureSections } from "../convex/lib/backedFacts.ts";

test("P295 fix 1: a required figure missing from the kept sources is looked up on its owner's site before writing", () => {
  const coverage = ["Installed cost range in Austin and what drives it, from local price guides",
    "Whether a permit is required and the permit fee, from City of Austin permit pages",
    "Utility rebate amounts for tankless units, from the utility that pays them",
    "Flow rate sizing guidance and how many fixtures can run at once"];
  const sources = [{ title: "Tankless cost guide", excerpt: "Installed cost in Austin runs $1,400 to $5,600 depending on fuel type." }];
  const missing = missingFigureItems(coverage, sources, ["WellnessLiving"]);
  assert.deepEqual(missing, ["WellnessLiving pricing, from WellnessLiving's own pricing page", coverage[1], coverage[2]],
    "the cost is covered with a figure; the permit fee and rebate are not; sizing asks for no figure");
  const request = itemLookupRequest({ label: "Tankless", primaryKeyword: "tankless water heater installation austin", items: missing });
  assert.match(request.system, /search the owner's own website directly, for example "WellnessLiving pricing", "site:austintexas\.gov water heater permit fee"/);
  assert.match(request.userMessage, /ITEMS WITHOUT A FIGURE YET/);
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const lookup = pipeline.indexOf("const missing = missingFigureItems(coverage, kept.readable, uncoveredOptions);");
  assert.ok(lookup > 0 && lookup < pipeline.indexOf("const { strict, accepted, readable } = kept;"), "before the sources are ranked and anything is written");
  assert.match(pipeline, /pass: "gap", reputableSecondary: true, maxTokens: 8000/);
});

test("P295 fix 2: a figure heading over no figure goes, and so does a column of dashes", () => {
  const md = ["## Installed cost in Austin", "", "Gas units run $2,100 to $5,600 [2].", "", "## Rebates and incentives", "",
    "Rebates change, so look for current programs.", "", "## FAQ", "", "### How much does a permit cost?", "", "It depends on the city.", "",
    "### Is a permit required?", "", "Yes, the city requires one [1].", "", "| Option | Price | Weight |", "|---|---|---|", "| Cast iron | $50 [3] | — |",
    "| Ceramic | $40 [4] | — |", "", "## Sources", "", "1. Rebates and incentives"].join("\n");
  const out = withoutEmptyFigureSections(md);
  assert.match(out.markdown, /## Installed cost in Austin\n\nGas units run/);
  assert.doesNotMatch(out.markdown, /## Rebates and incentives|How much does a permit cost/);
  assert.match(out.markdown, /### Is a permit required\?/);
  // v3.1 (batch 6, Cowork's A3): a column of dashes takes the whole table with it — never a column or a cell (the
  // bank-reconciliation payout example lost its Credit column and stopped balancing).
  assert.doesNotMatch(out.markdown, /\| Option \||Cast iron/);
  assert.match(out.markdown, /## Sources\n\n1\. Rebates and incentives$/, "Sources are never edited");
});

test("P295 fixes 3 and 4: a restated figure or claim goes; so does homework in a figure section", () => {
  const sources = [{ text: "A standard heat pump loses capacity below about 40°F; cold-climate models keep output to -5°F. Costs: $4,000 to $8,000 installed." }];
  const md = ["A standard heat pump loses heating capacity below about 40°F [1].", "", "## Cold weather", "",
    "Below about 40°F a standard heat pump loses heating capacity, so a cold-climate model matters [1].", "",
    "## Upfront cost", "", "Installed costs run $4,000 to $8,000 [1]. Get a written estimate before you sign.", "",
    "## Choosing an installer", "", "Get a written quote from each installer you compare."].join("\n");
  const out = backedFactsOnly(md, { sources, profile: "", allowedNames: [], topic: "heat pump vs gas furnace" });
  assert.equal(out.markdown.match(/40°F/g)?.length, 1, out.markdown);
  assert.doesNotMatch(out.markdown, /Get a written estimate before you sign/, "homework in a figure section goes");
  assert.match(out.markdown, /Get a written quote from each installer you compare\./, "outside a figure section it is advice");
});

test("P295 fix 5: the FAQ is the last section; the plan's review applies fixes 2 and 5 before the gate", () => {
  const md = "Intro.\n\n## Steps\n\nDo it.\n\n## FAQ\n\n### Q?\n\nA.\n\n## Spring start-up\n\nOpen the valve.\n\n## Sources\n\n1. A";
  assert.equal(withFaqLast(md), "Intro.\n\n## Steps\n\nDo it.\n\n## Spring start-up\n\nOpen the valve.\n\n## FAQ\n\n### Q?\n\nA.\n\n## Sources\n\n1. A");
  assert.equal(withFaqLast("Intro.\n\n## FAQ\n\nA.\n\n## Sources\n\n1. A"), "Intro.\n\n## FAQ\n\nA.\n\n## Sources\n\n1. A");
  assert.match(readFileSync("convex/actions/pipeline.ts", "utf8"),
    /fields = \{ \.\.\.fields, markdown: rebuildSourcesSection\(withPriceDate\(withFaqLast\(emptied\.markdown\), article\.createdAt \?\? Date\.now\(\)\), article\.sources \?\? \[\]\) \};\n\s+const candidate = candidateFor\(fields\);/);
});
