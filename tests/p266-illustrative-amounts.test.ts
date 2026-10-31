// P266 (Oct 31 2026): the fixed plan's how-to drew 10 code-check findings in the live trial, every one of them its worked
// example's own amounts reused after the example (journal entries, the transposition check). The one fix then turned the
// whole example into letters; Cowork had judged the earlier example "stops halfway". Arshad's rule is about made-up
// statistics, not illustrations: the example's amounts are illustrative wherever the article reuses them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { illustrativeNumbers, numbersOutsideFactSheet } from "../convex/lib/articlePlanChecks.ts";

const sheet = { sources: [{ url: "https://www.irs.gov/p583", text: "Keep records for 3 years." }], profile: "", productName: "" };
// The first draft's lines, as the live trial recorded them (ops/data/judge-batch/howto.json firstDraft).
const draft = [
  "## Worked example", "",
  "A studio's statement shows a $35.00 service fee and $12.00 of interest. A $400.00 customer check came back unpaid, and a $450.00 check was recorded as $540.00.", "",
  "## Recording adjusting journal entries", "",
  "- Debit Bank Fees Expense $35.00", "- Credit Cash $35.00", "- Debit Cash $12.00", "- Credit Interest Income $12.00",
  "- Debit Accounts Receivable $400.00", "- Credit Cash $400.00", "",
  "In the example above, $540.00 versus $450.00 is a $90.00 difference, and 90 ÷ 9 = 10.", "",
  "## Why it matters", "",
  "About 40% of small firms reconcile only once a year.",
].join("\n");

test("P266 the worked example's amounts are illustrations wherever the article reuses them; statistics still need a source", () => {
  assert.deepEqual([...illustrativeNumbers(draft)].sort((a, b) => a - b), [12, 35, 400, 450, 540]);
  const flagged = numbersOutsideFactSheet(draft, sheet).map((f) => f.line);
  assert.deepEqual(flagged, ["About 40% of small firms reconcile only once a year."], "only the statistic; the 10 example lines are not findings");
  assert.equal(numbersOutsideFactSheet("## Worked example\n\nA $40.00 fee.\n\n## Facts\n\nAbout 40% of owners skip it.", sheet).length, 1,
    "a percentage is never illustrative, even when the example uses the same number");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /"Fix only these points and change nothing else\. Keep the worked example's illustrative amounts exactly as they are:"/);
  assert.match(readFileSync("convex/lib/articleQuality.ts", "utf8"), /const illustrative = article\.qualityPlan === "fixed_v1" \? illustrativeNumbers\(markdown\) : new Set<number>\(\);/);
});
