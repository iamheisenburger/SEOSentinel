import { test } from "node:test";
import assert from "node:assert/strict";

// P106 (Oct 19 2026): leadpilot.chat/infusionsoft-lead-scoring-keap-max was
// sealed with the rewriter's evidence vocabulary in its prose ("the
// documentation we can verify", "the documentation excerpt we can verify is
// truncated"), which P103's patterns did not match.

test("evidence-process wording is caught as pipeline text", async () => {
  const { readerVisibleDefects } = await import("../convex/lib/articleQuality.ts");
  for (const sentence of [
    "If you are researching Infusionsoft lead scoring, the documentation we can verify describes lead scoring in Keap Max.",
    "The documentation excerpt we can verify is truncated, so confirm the full list of other rule inputs in the current documentation.",
    "The product information we can verify does not specify a direct connection to Keap.",
    "The source excerpt was cut off after the second rule, so this list may be incomplete.".replace("was cut off", "is truncated"),
  ]) {
    assert.ok(readerVisibleDefects(sentence).some((defect) => /pipeline text/.test(defect)), sentence);
  }
});

test("ordinary prose about verification is not pipeline text", async () => {
  const { readerVisibleDefects } = await import("../convex/lib/articleQuality.ts");
  for (const sentence of [
    "Before the call, list the details we can confirm by email.",
    "Search Console asks you to verify that you own the domain before it shows data.",
    "Check the vendor's current documentation for the full list of rule inputs.",
    "We can verify the result in your own analytics a week later.",
  ]) {
    assert.deepEqual(readerVisibleDefects(sentence), [], sentence);
  }
});

test("the writer and the rewriter are told to state limits in reader terms, never in evidence terms", async () => {
  const { remediationRequest } = await import("../convex/lib/finalArticleReview.ts");
  const request = remediationRequest({ articleType: "standard", primaryKeyword: "lead scoring", productName: "LeadPilot", maxWords: 2400,
    minWords: 900, currentYear: 2026, auditNotes: [], productEvidence: "", researchEvidence: "", sources: [], markdown: "# A\n\nText." } as never);
  assert.match(request.userMessage, /never in terms of your evidence or process/);
  assert.match(request.userMessage, /"we can verify"/);
});
