// P263 (Oct 31 2026): the plan's live trial kept 2 sources for "tankless water heater installation austin" and 4 on the
// next run of the same search. Sources were dropped when the API's cited quote (with the page's markdown, typographic
// quotes and line breaks) was not found verbatim on the fetched page: the excerpt stayed under 160 characters.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { pageExcerpt, quoteAt } from "../convex/lib/evidenceExcerpt.ts";

const page = "Permits | Abacus Plumbing Blog. When do you need a permit? Converting from one type of water heater to another (like switching " +
  "from a traditional gallon tank to tankless water) needs a plumbing permit in Austin. Moving a water heater to a new spot does too. " +
  "It doesn’t matter whether the new unit is gas or electric: the City of Austin issues the permit through its AB+C portal.";

test("P263 a cited quote is found on its page through markdown, typographic quotes and spacing", () => {
  // The quote exactly as the API returned it in the live trial.
  const quote = "- **Converting from one type of water heater to another** (like switching from a traditional gallon tank to tankless water).";
  assert.equal(page.toLowerCase().indexOf(quote.slice(0, 60).toLowerCase()), -1, "the old exact probe misses it");
  assert.ok(quoteAt(page, quote));
  const excerpt = pageExcerpt(page, [quote], false)!;
  assert.ok(excerpt.length >= 160, "a readable excerpt, so the source is kept");
  assert.match(excerpt, /needs a plumbing permit in Austin/);
  assert.ok(quoteAt(page, "It doesn't matter whether the new unit is gas or electric"), "a straight apostrophe finds a curly one");
  assert.equal(quoteAt(page, "Austin issues a Plumbing and Mechanical change out permit for water heaters"), null, "words not on the page are not found");
  assert.equal(quoteAt(page, "Austin permit"), null, "too few words to locate safely");
  assert.match(readFileSync("convex/actions/contentWorkProvider.ts", "utf8"),
    /excerpt = pageExcerpt\(plainPageText\(\(await fetchText\(source\.url\)\)\.text\), source\.excerpts, docs\) \?\? excerpt;/);
});
