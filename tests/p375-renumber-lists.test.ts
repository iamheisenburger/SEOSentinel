/** P375 (Nov 6 2026): a numbered list that skips a number is renumbered by code before the checks, at no cost; nothing
 * else changes. LeadPilot's Nov 7 article was held back for "a numbered list jumps from 4 to 6" after its fix pass had
 * reached its cost cap. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readerVisibleDefects, renumberOrderedLists } from "../convex/lib/articleQuality.ts";

test("a skipping numbered list counts up by one again; everything else stays byte for byte", () => {
  const md = "Intro.\n\n1. One\n2. Two\n   - nested note\n3. Three\n4. Four\n6. Six\n\nAfter.\n\n7. Starts at seven\n8. Eight\n\nA paragraph.\n\n1. Same\n1. Same";
  const fixed = renumberOrderedLists(md);
  assert.equal(fixed, md.replace("6. Six", "5. Six"));
  assert.ok(!readerVisibleDefects(fixed).some((d) => d.includes("numbered list jumps")));
  assert.ok(readerVisibleDefects(md).some((d) => d.includes("numbered list jumps from 4 to 6")));
  assert.equal(renumberOrderedLists("1. A\n\n2. B\n\n4. C"), "1. A\n\n2. B\n\n3. C", "blank lines between items stay");
  assert.equal(renumberOrderedLists("No lists here."), "No lists here.");
  assert.match(readFileSync("convex/actions/pipeline.ts", "utf8"), /const renumbered = renumberOrderedLists\(fields\.markdown\);/);
});
