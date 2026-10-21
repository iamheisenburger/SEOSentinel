import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// P149 (Oct 21 2026): the Compost Notes test site's first article (live 14:18Z) told readers which advice
// came from its sources and which did not, and its call to action kept a capital mid-sentence.

test("talk about what the sources do or do not say is caught as pipeline text", async () => {
  const { readerVisibleDefects } = await import("../convex/lib/articleQuality.ts");
  for (const sentence of [
    "These are practical suggestions, not figures from the sources.",
    "The practical conclusion, offered as a recommendation rather than a rule from the sources: aim for a hot, managed heap.",
    "These habits are recommendations, not source-specified rules.",
    "Because the sources do not give a hold time at temperature, some caution is still sensible.",
    "The cited sources don't specify how long to wait.",
  ]) {
    assert.ok(readerVisibleDefects(sentence).some((defect) => /pipeline text/.test(defect)), sentence);
  }
});

test("ordinary prose about guidance and sources is not pipeline text", async () => {
  const { readerVisibleDefects } = await import("../convex/lib/articleQuality.ts");
  for (const sentence of [
    "Penn State Extension says composting before spreading can inactivate any pathogens present [4].",
    "Data from the sources listed below shows the same seasonal pattern.",
    "This is not a rule from Google; it is a habit that keeps reports comparable.",
    "Open-source tools give you the same data without a subscription.",
    "Check each source of leads in your CRM before you change the scoring rules.",
  ]) {
    assert.deepEqual(readerVisibleDefects(sentence), [], sentence);
  }
});

test("the writer and the rewriter never contrast advice with the sources, and the CTA starts its own sentence", async () => {
  const { remediationRequest } = await import("../convex/lib/finalArticleReview.ts");
  const request = remediationRequest({ articleType: "standard", primaryKeyword: "chicken manure compost", productName: "Compost Notes", maxWords: 2400,
    minWords: 900, currentYear: 2026, auditNotes: [], productEvidence: "", researchEvidence: "", sources: [], markdown: "# A\n\nText." } as never);
  assert.match(request.userMessage, /never contrast it with the sources/);
  const writer = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(writer, /Never contrast your advice with the sources or say which parts are or are not from them/);
  assert.match(writer, /as its own sentence that starts with the link/);
});
