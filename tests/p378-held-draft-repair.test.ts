// P378 (Nov 7 2026): LeadPilot's Nov 7 article was held for "a numbered list jumps from 4 to 6" the day before P375
// renumbered such lists in code. A held draft is reused at its review (P277), which never passes through the fix that
// renumbers, and LeadPilot had no new topic for the slot: the slot would have been missed for a one-line, $0 repair.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CONTENT_CHECKS_VERSION, readerVisibleIssues, renumberOrderedLists } from "../convex/lib/articleQuality.ts";

const draft = ["## Setting one up", "", "1. Pick the questions", "2. Map the scores", "3. Route the leads", "4. Review weekly", "6. Tune the rules", "", "Done."].join("\n");

test("a held draft's only defect, a list that skips a number, is repaired by code and passes", () => {
  const before = readerVisibleIssues({ markdown: draft, sources: [] });
  assert.ok(before.includes("Reader-visible defect: a numbered list jumps from 4 to 6."), JSON.stringify(before));
  const repaired = renumberOrderedLists(draft);
  assert.deepEqual(readerVisibleIssues({ markdown: repaired, sources: [] }), []);
  assert.equal(repaired.split("\n").filter((line, i) => line !== draft.split("\n")[i]).length, 1, "only the skipped number changes");
});

test("drafts held under the previous checks are judged again, with the repair, and the repaired text is what gets sealed", () => {
  assert.ok(CONTENT_CHECKS_VERSION >= 4, "4 since P378: drafts held under 3 are judged again");
  const work = fs.readFileSync(path.join(import.meta.dirname, "..", "convex", "contentWork.ts"), "utf8");
  const reuse = work.slice(work.indexOf("async function reusableHeldDraft"), work.indexOf("const RELATED_LINKS_RULE_AT"));
  assert.match(reuse, /const markdown = renumberOrderedLists\(article\.markdown \?\? ""\);/);
  assert.match(reuse, /const candidate: Doc<"articles"> = \{ \.\.\.article, markdown,/, "today's checks see the repaired text");
  assert.match(reuse, /if \(markdown !== article\.markdown\) \{\n\s+await ctx\.db\.patch\(article\._id, \{ markdown, updatedAt: Date\.now\(\) \}\);\n\s+await syncSummary\(ctx, article\._id\);/,
    "the review seals the repaired draft");
  assert.match(reuse, /return \{ job, article: \{ \.\.\.article, markdown \}, topic \};/);
});
