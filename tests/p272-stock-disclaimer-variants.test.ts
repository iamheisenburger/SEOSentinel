// P272 (Oct 31 2026): the stock disclaimer had more shapes than P248's check knew ("…recommendation, not an industry
// standard"): 29 sentences on 23 live owner-site pages (pentra.dev 10 of 35, LeadPilot 13 of 123), 15 of them in forms it
// missed ("This breakdown is an author-proposed way to organize your stack, not an industry standard", "The grouping below
// is not an industry standard or a formal taxonomy — it's a way of…"). Each is now pipeline text, and the live repair
// chain removes only its contrast with a standard, under a new rule version so every page is checked again.
import assert from "node:assert/strict";
import test from "node:test";
import { readerVisibleIssues } from "../convex/lib/articleQuality.ts";
import { planCorrectiveChange, RELATED_REPAIR_VERSION, stockDisclaimerRepairProposal } from "../convex/lib/contentCorrection.ts";

const pipelineText = (markdown: string) => readerVisibleIssues({ markdown, sources: [] } as never).filter((issue) => /pipeline text/.test(issue));
const page = (body: string) => ({ editable: { active: true, kind: "github", markdown: body, sourceContent: `---\ntitle: "T"\n---\n\n${body}\n` } }) as never;

test("P272 every live shape of the stock disclaimer is pipeline text, and the repair keeps the advice around it", () => {
  const live = [ // the live sentences P248 missed (owner sites, Oct 31 2026), each with what the page keeps
    ["This is a recommendation, not an industry rule: decide those two things first, then compare products only within the matching category.",
      "This is a recommendation: decide those two things first, then compare products only within the matching category."],
    ["As a working recommendation (the author's own grouping, not an industry standard), it helps to sort them into three types: Prompt-box writers.",
      "As a working recommendation (the author's own grouping), it helps to sort them into three types: Prompt-box writers."],
    ["The following is an author-proposed decision framework, not an industry standard.",
      "The following is an author-proposed decision framework."],
    ["The order is the author's proposed framework, not an industry standard.",
      "The order is the author's proposed framework."],
    ["This breakdown is an author-proposed way to organize your stack, not an industry standard.",
      "This breakdown is an author-proposed way to organize your stack."],
    ["This is the author's view, not an established rule.",
      "This is the author's view."],
    ["They are recommendations for an editorial workflow, not an industry standard.",
      "They are recommendations for an editorial workflow."],
    ["This section proposes a working method for the reader to run, not an industry standard — treat it as a template to adapt for your own business.",
      "This section proposes a working method for the reader to run — treat it as a template to adapt for your own business."],
    ["This table is an author-proposed recommendation framework, not an industry benchmark.",
      "This table is an author-proposed recommendation framework."],
    ["The framework is a proposal, not an industry standard.",
      "The framework is a proposal."],
    ["Below is a conceptual framework you can test against your own data — not a universal standard, but a reader-usable starting point for organizing score bands into action.",
      "Below is a conceptual framework you can test against your own data — a reader-usable starting point for organizing score bands into action."],
    ["If you don't already have a documented framework, the following structure is a reasonable starting point to adapt — not a universal standard, and not a guarantee of specific outcomes.",
      "If you don't already have a documented framework, the following structure is a reasonable starting point to adapt."],
    ["The following are dimensions worth checking for, not an industry standard: Fit, Intent and Timing.",
      "The following are dimensions worth checking for: Fit, Intent and Timing."],
    ["This is a recommended structure, not an industry standard — adapt it to your own sales cycle and available data.",
      "This is a recommended structure — adapt it to your own sales cycle and available data."],
    ["The grouping below is not an industry standard or a formal taxonomy — it's a way of organizing lead scoring approaches.",
      "The grouping below is a way of organizing lead scoring approaches."],
    ["This is an author-proposed diagnostic, not an established benchmark—treat each point as a question to answer from your own data, not a pass/fail score.",
      "This is an author-proposed diagnostic—treat each point as a question to answer from your own data, not a pass/fail score."],
    ["This is an evaluation framework we're proposing for you to run yourself — not an industry standard — so treat each question as a test to perform against a candidate.",
      "This is an evaluation framework we're proposing for you to run yourself, so treat each question as a test to perform against a candidate."],
  ];
  for (const [paragraph, expected] of live) {
    const markdown = `## Intro\n\n${paragraph}\n\n## Next\n\nMore text that stays.`;
    assert.ok(pipelineText(markdown).length > 0, paragraph);
    const proposal = stockDisclaimerRepairProposal(markdown);
    assert.deepEqual(proposal, { before: paragraph, replacement: expected }, paragraph);
    assert.equal(pipelineText(expected).length, 0);
    const patch = planCorrectiveChange({} as never, page(markdown), { kind: "reader_text_repair", before: proposal!.before, replacement: proposal!.replacement,
      reason: "Autopilot removes the stock clause its writer added before P248." });
    assert.equal(patch.sourceAfter, expected, "the GitHub source changes in exactly that paragraph");
  }
  assert.equal(RELATED_REPAIR_VERSION, 5, "a fresh pass re-checks every page");
});

test("P272 a sentence that states a fact about a standard is not the disclaimer", () => {
  for (const fact of ["Markdown itself is not a formal standard, so renderers differ.", "ISO 9001 is an international standard for quality management systems.",
    "HTTP/3 is now an official standard (RFC 9114)."]) assert.equal(pipelineText(fact).length, 0, fact);
});
