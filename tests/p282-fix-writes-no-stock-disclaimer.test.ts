// P282 (Nov 1 2026): LeadPilot's Nov 3 refresh (/lead-scoring-best-practices-2) was held after its one fix with
// "Reader-visible defect: pipeline text". The review asked to present an uncited claim "as the author's recommendation
// rather than settled fact", and the fix prompt said to make such a section "unmistakably an author-proposed evaluation
// framework ... or conditional recommendation": the fix wrote "This section is a recommendation, not an industry rule."
// The prompt now asks for plain advice, and a stock disclaimer the fix writes anyway is removed in code before the
// refresh keeps its section (and from the fixed plan's one fix).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readerVisibleIssues } from "../convex/lib/articleQuality.ts";
import { withoutStockDisclaimers } from "../convex/lib/contentCorrection.ts";

const flagged = (markdown: string) => readerVisibleIssues({ markdown, sources: [] } as never).some((issue) => /pipeline text/.test(issue));

test("P282 a stock disclaimer in a fix's output is removed in code, the advice kept", () => {
  const section = "## Weigh Explicit Data More Heavily Than Inferred Behavior\n\nThis section is a recommendation, not an industry rule. Explicit data is what a prospect directly states: company size, budget, timeline.";
  const fixed = `## Intro\n\nLead scoring starts with fit.\n\n${section}\n\n## Next\n\nMore text.`;
  assert.ok(flagged(fixed));
  const repaired = withoutStockDisclaimers(fixed);
  assert.equal(repaired, "## Intro\n\nLead scoring starts with fit.\n\n## Weigh Explicit Data More Heavily Than Inferred Behavior\n\nExplicit data is what a prospect directly states: company size, budget, timeline.\n\n## Next\n\nMore text.");
  assert.ok(!flagged(repaired));
  // Several in one draft go together; text without one is returned unchanged.
  const two = `${fixed}\n\nThe steps below are an author-proposed evaluation framework, not an established industry benchmark.`;
  assert.ok(!flagged(withoutStockDisclaimers(two)));
  assert.equal(withoutStockDisclaimers("## A\n\nPlain advice.\n"), "## A\n\nPlain advice.\n");
});

test("P282 the fix prompt asks for plain advice, and both fix paths strip what it writes anyway", () => {
  const review = readFileSync("convex/lib/finalArticleReview.ts", "utf8");
  assert.doesNotMatch(review, /so it is unmistakably an author-proposed evaluation framework/);
  assert.match(review, /never add a sentence saying it is a recommendation, framework or method rather than an industry standard, rule or benchmark/);
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /reviewMarkdown = keepRefreshSection\(withoutStockDisclaimers\(remediated\.markdown\)\);/);
  assert.match(pipeline, /withSourcesSection\(withoutStockDisclaimers\(fixed\.markdown\), article\.sources \?\? \[\]\)/);
});
