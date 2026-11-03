// P297 (Nov 3 2026): batch 5's how-to was held on its Stripe fee illustration ("$3,500 - $102 = $3,398"), the worked
// example Cowork asked for in batch 4, because only a section headed "example" counted as one; and the re-review after its one
// fix judged the draft without step 4's deletion. A section that opens by saying it is an illustration is an example wherever
// it sits, and code deletion runs on every review.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { exampleSections, illustrativeNumbers, numbersOutsideFactSheet } from "../convex/lib/articlePlanChecks.ts";

test("P297 a section that opens as a hypothetical is an example: its amounts need no source", () => {
  const md = ["## Payouts and platform fees", "", "Suppose two client payments arrive through Stripe: $2,000 and $1,500.",
    "", "1. Record each payment at its gross amount in a clearing account: $2,000 + $1,500 = $3,500.",
    "2. The clearing account now holds $3,500 - $102 = $3,398.", "", "## Fees", "", "Stripe charges 2.9% per card payment."].join("\n");
  assert.equal(exampleSections(md).length, 1);
  assert.ok(illustrativeNumbers(md).has(3398));
  const failures = numbersOutsideFactSheet(md, { sources: [{ url: "", text: "Stripe pricing" }], profile: "", productName: "" });
  assert.deepEqual(failures.map((f) => f.line), ["Stripe charges 2.9% per card payment."], "a real statistic elsewhere still needs its source");
});

test("P297 step 4's deletion runs on a re-review too", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const review = pipeline.slice(pipeline.indexOf("async function reviewPlannedArticle("), pipeline.indexOf("  if (!fixedBefore) {\n    const plan = article.articlePlan;"));
  assert.match(review, /if \(fixedBefore && !assembled\) \{\n\s+const recheck = backedFactsOnly\(fields\.markdown, \{ \.\.\.plannedBacking\(article, topic, productName, \[\]\), unbacked: flaggedNow\(fields\.markdown\) \}\);/);
});
