// P279 (Nov 1 2026): after P272, 11 live owner-site pages still carried the writer's stock disclaimer in forms its rule
// missed: two modifiers ("not an established industry standard", "not established industry fact", "not an established
// industry statistic") or a sentence of its own after the proposal ("It is not an established industry standard, so
// verify each rule …", "They are not industry standards or benchmarks."). Each is now pipeline text, and the repair
// chain (rule version 6) removes only the disclaimer, leaving the advice word for word.
import test from "node:test";
import assert from "node:assert/strict";
import { readerVisibleIssues } from "../convex/lib/articleQuality.ts";
import { RELATED_REPAIR_VERSION, stockDisclaimerRepairProposal } from "../convex/lib/contentCorrection.ts";

const flagged = (paragraph: string) =>
  readerVisibleIssues({ markdown: `## Intro\n\n${paragraph}\n\n## Next\n\nMore text.`, sources: [] } as never).some((issue) => /pipeline text/.test(issue));
const repaired = (paragraph: string) => stockDisclaimerRepairProposal(`## Intro\n\n${paragraph}\n\n## Next\n\nMore text.`)?.replacement ?? null;

// The 11 live paragraphs (pentra.dev 2, LeadPilot 9), each with the repair the chain makes.
const live: [string, string][] = [
  ["The guidance below is a set of checks you can run yourself and a proposed evaluation framework, not established industry fact.",
    "The guidance below is a set of checks you can run yourself and a proposed evaluation framework."],
  ["The steps below are an author-proposed evaluation framework, not an established industry benchmark.",
    "The steps below are an author-proposed evaluation framework."],
  ["The framework is the author's recommendation, based on how the pieces logically fit together. It is not an established industry standard, so verify each rule against your own CRM data.",
    "The framework is the author's recommendation, based on how the pieces logically fit together. Verify each rule against your own CRM data."],
  ["This is a recommended way of thinking about the choice, not an established industry standard.",
    "This is a recommended way of thinking about the choice."],
  ["The grid and the cell actions below are recommendations for you to adapt. They are not industry standards or benchmarks.",
    "The grid and the cell actions below are recommendations for you to adapt."],
  ["The framework below is a recommendation based on reasoning about how inference fails, not an established industry standard.",
    "The framework below is a recommendation based on reasoning about how inference fails."],
  ["Every item below is a recommendation to test against your own pipeline data, not an established industry rule.",
    "Every item below is a recommendation to test against your own pipeline data."],
  ["The following are failure points worth checking against your own process — treat each as a question to answer with your own data, not an established industry statistic:",
    "The following are failure points worth checking against your own process — treat each as a question to answer with your own data:"],
  ["This is a recommendation, not an established industry rule, but it holds up under most process reviews:",
    "This is a recommendation, but it holds up under most process reviews:"],
  ["The following is a framework we're proposing for you to test against your own flow — not an established industry standard or a claim about how all conversational systems behave. Treat it as a starting point to adapt, and validate each step against your own conversation data.",
    "The following is a framework we're proposing for you to test against your own flow. Treat it as a starting point to adapt, and validate each step against your own conversation data."],
  ["The following is an author-proposed framework for organizing sales scoring signals, not an established industry standard.",
    "The following is an author-proposed framework for organizing sales scoring signals."],
];

test("P279 the stock disclaimer with two modifiers or in a sentence of its own is caught and repaired, the advice kept", () => {
  assert.equal(RELATED_REPAIR_VERSION, 6, "a fresh repair pass runs under the new rules");
  for (const [paragraph, repair] of live) {
    assert.ok(flagged(paragraph), `caught: ${paragraph}`);
    assert.equal(repaired(paragraph), repair);
    assert.ok(!flagged(repair), `clean after the repair: ${repair}`);
  }
});

test("P279 facts and a hypothesis's honest caveat are not the stock disclaimer", () => {
  for (const sentence of [
    "Markdown itself is not a formal standard, so renderers differ.",
    "We follow the Markdown approach. It is not a formal standard, so renderers differ.",
    "ISO 9001 is an international standard for quality management systems.",
    "One hypothesis worth testing on your own site: a longer form may perform acceptably when visitors already expect to invest time before submitting, such as in a high-consideration purchase — but treat that as something to verify, not an established fact about buyer behavior.",
  ]) assert.equal(flagged(sentence), false, sentence);
});
