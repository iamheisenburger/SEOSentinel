// P280 (Nov 1 2026): of the 29 paragraphs on the owner sites' live pages that still carry the writer's stock disclaimer
// under P279's rule, one could not be repaired: LeadPilot's how-to-increase-conversion-rate-of-website says "The table
// below is an author-proposed diagnostic for prioritizing your effort, not measured data and not an industry taxonomy."
// The repair now removes the "not X and not a standard" pair, and nothing else.
import test from "node:test";
import assert from "node:assert/strict";
import { readerVisibleIssues } from "../convex/lib/articleQuality.ts";
import { RELATED_REPAIR_VERSION, stockDisclaimerRepairProposal } from "../convex/lib/contentCorrection.ts";

const markdown = (paragraph: string) => `## Find where visitors stall\n\n${paragraph}\n\n## Next\n\nMore text.`;
const flagged = (paragraph: string) => readerVisibleIssues({ markdown: markdown(paragraph), sources: [] } as never).some((issue) => /pipeline text/.test(issue));

test("P280 \"not measured data and not an industry taxonomy\" is repaired, the advice kept", () => {
  assert.equal(RELATED_REPAIR_VERSION, 7, "a fresh repair pass runs under the new rules");
  const live = "Before changing anything, decide which kind of stall you have. The table below is an author-proposed diagnostic for prioritizing your effort, not measured data and not an industry taxonomy.";
  assert.ok(flagged(live));
  const proposal = stockDisclaimerRepairProposal(markdown(live));
  assert.deepEqual(proposal, { before: live,
    replacement: "Before changing anything, decide which kind of stall you have. The table below is an author-proposed diagnostic for prioritizing your effort." });
  assert.ok(!flagged(proposal!.replacement));
  // A plain "not X and not Y" with no standard in it is left alone.
  assert.equal(stockDisclaimerRepairProposal(markdown("The table below is an author-proposed diagnostic, not a forecast and not a promise.")), null);
});
