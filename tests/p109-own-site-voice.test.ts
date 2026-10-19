import { test } from "node:test";
import assert from "node:assert/strict";

// P109 (Oct 19 2026): LeadPilot drafts described LeadPilot from outside on
// LeadPilot's own blog ("LeadPilot's site lists a free plan", "pricing details
// are not on the homepage", "the product information we can verify does not
// specify"). Every customer's article sits on that customer's own site.

test("the rewriter states the business's product facts directly, never as an outside observer", async () => {
  const { remediationRequest } = await import("../convex/lib/finalArticleReview.ts");
  const request = remediationRequest({ articleType: "standard", primaryKeyword: "lead scoring", productName: "LeadPilot", maxWords: 2400,
    minWords: 900, currentYear: 2026, auditNotes: [], productEvidence: "", researchEvidence: "", sources: [], markdown: "# A\n\nText." } as never);
  assert.match(request.userMessage, /published on LeadPilot's own website: state its product facts directly, never as an outside observer/);
});
