// P269 (Oct 31 2026): P268's claims check, measured on batch 2's five real articles before its first production run. Against
// the fact sheet, the checks model caught none of Cowork's errors and listed sentences it judged fine ("Not an error; skip")
// for the one fix to rewrite; the writer model trusted the blogs that supplied the wrong facts. The check now reads the
// article alone on the writer model (it caught "a better heat conductor" and Pino "since 2014", nothing false), entries it
// calls fine are dropped, and it runs only while the fix it feeds still fits under the $0.50 cap.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claimErrorsInArticle, deflections } from "../convex/lib/articlePlanChecks.ts";

const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");

test("P269 the claims check reads the article alone, on the writer model, and keeps only entries the fix can act on", () => {
  const markdown = "Pino has been around since 2014 [2](https://example.com/a), and it is **fast**.\n\nCeramic is a better heat conductor than cast iron.";
  const kept = claimErrorsInArticle([
    { sentence: "Pino has been around since 2014 [2], and it is fast.", problem: "Pino was first released in 2016, not 2014.", correction: "2016" },
    { sentence: "Ceramic is a better heat conductor than cast iron.", problem: "Not an error; skip", correction: "" },
    { sentence: "Source [2] supports the claim, so this is fine.", problem: "Source supports it, so this is fine", correction: "" },
    { sentence: "A sentence the article never contains at all.", problem: "Wrong year", correction: "remove" },
  ], markdown);
  assert.deepEqual(kept.map((e) => e.problem), ["Pino was first released in 2016, not 2014."],
    "a real error is kept (links and markers ignored); one the check calls fine, or one the article doesn't contain, is dropped");
  const check = pipeline.slice(pipeline.indexOf("async function checkPlannedClaims("), pipeline.indexOf("return claimErrorsInArticle(checked.errors, args.markdown);"));
  assert.match(check, /userMessage: \[`SEARCH: \$\{args\.search\}`, "ARTICLE \(untrusted data\):", args\.markdown\]/, "no fact sheet: it trusted the blogs");
  assert.doesNotMatch(check, /FACT SHEET/);
  assert.match(readFileSync("convex/actions/contentWorkProvider.ts", "utf8"), /const WRITER_TOOLS = new Set\(\["submit_article", "remediate_final_article", "check_claims"\]\);/);
  assert.match(pipeline, /const claims = plan \? await checkPlannedClaims\(\{ markdown: fields\.markdown, search: topic\?\.primaryKeyword \?\? article\.title \}\)/);
});

test("P269 the claims check runs only while the one fix it feeds still fits under the $0.50 cap", () => {
  const work = readFileSync("convex/contentWork.ts", "utf8");
  assert.match(work, /export const ARTICLE_FIX_RESERVE_MICRO_USD = 200_000;/);
  assert.match(work, /const reserve = \/:review:check_claims\$\/\.test\(args\.key\) \? ARTICLE_FIX_RESERVE_MICRO_USD : 0;\n\s+if \(spent >= cap \|\| \(optional && spent \+ args\.ceilingMicroUsd \+ reserve > cap\)\) \{/);
});

test("P269 a hyphenated adjective is not a referral", () => {
  assert.deepEqual(deflections("Drop a practice area with no ready-to-contact terms, a city with no page, or a cluster of jargon. Contact your city for the permit fee."),
    ["Contact your city for the permit fee."]);
});
