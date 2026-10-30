// P248 (Oct 30 2026): 4 of pentra.dev's 34 live articles carried one stock sentence ("The framework is the author's
// recommendation, not an industry standard"), because the writer was told to label proposed frameworks "as
// recommendations, not established industry facts". Cowork's launch audit read it as boilerplate.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("P248 a stock recommendation-versus-standard disclaimer is caught; plain advice is not", async () => {
  const { readerVisibleDefects } = await import("../convex/lib/articleQuality.ts");
  for (const sentence of [
    "The framework is the author's recommendation, not an industry standard.",
    "This is a recommendation, not an industry rule: decide those two things first.",
    "The method is a recommendation, not an industry standard, and every judgement call in it is something you can check.",
    "The workflow in the later sections is the author's recommendation, not an industry standard, so adjust it to your own pace.",
  ]) assert.ok(readerVisibleDefects(sentence).some(defect => /pipeline text/.test(defect)), sentence);
  for (const sentence of [
    "This is not a rule from Google; it is a habit that keeps reports comparable.",
    "A simple way to decide is to compare the two pages' clicks over 28 days.",
    "Google's recommendation is to keep titles short, not to stuff keywords.",
  ]) assert.deepEqual(readerVisibleDefects(sentence), [], sentence);
  const writer = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.doesNotMatch(writer, /Label proposed frameworks as recommendations/);
  assert.match(writer, /never add a sentence saying it is a recommendation rather than a standard/);
});
