// P188 (Oct 25 2026): every LeadPilot scheduler pass after its 18:00Z publication ran past Convex's 1-second limit:
// the business-fit gate re-derived the same word stems, profile readings and verdicts thousands of times in one pass
// (each Search Console query recurs on every day it was seen). Verdicts are computed once per exact input now.
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTopicBusinessFit, tenantTopicBusinessSignals, topicFitComputations } from "../convex/lib/autopilotBuffer.ts";

const site = { niche: "AI lead qualification chatbot for B2B websites", siteType: "saas",
  siteSummary: "LeadPilot is an AI sales agent for websites that qualifies leads with lead scoring and books meetings for sales teams.",
  targetAudienceSummary: "B2B SaaS marketing and sales teams that want more qualified leads from website traffic.",
  anchorKeywords: ["lead scoring", "lead qualification", "website chatbot"], keyFeatures: ["AI lead scoring", "meeting booking", "lead qualification chat"],
  painPoints: ["How do I qualify website leads faster?", "Which leads should sales call first?"] };

test("the same search, title and profile are judged once; every caller gets its own copy of the verdict", () => {
  const signals = tenantTopicBusinessSignals(site);
  const before = topicFitComputations();
  const first = evaluateTopicBusinessFit({ keyword: "lead scoring template", label: "Lead Scoring Template", ...signals });
  for (let i = 0; i < 2_000; i++) {
    // A fresh projection of the same profile each time, as callers that recompute it per row do.
    const again = evaluateTopicBusinessFit({ keyword: "lead scoring template", label: "Lead Scoring Template", ...tenantTopicBusinessSignals(site) });
    assert.deepEqual(again, first);
  }
  assert.equal(topicFitComputations() - before, 1, "judged once for 2,001 identical questions");
  const copy = evaluateTopicBusinessFit({ keyword: "lead scoring template", label: "Lead Scoring Template", ...signals });
  copy.reasons.push("changed by a caller");
  assert.deepEqual(evaluateTopicBusinessFit({ keyword: "lead scoring template", label: "Lead Scoring Template", ...signals }).reasons, first.reasons);
});

test("a different search, title or profile is judged on its own", () => {
  const signals = tenantTopicBusinessSignals(site), before = topicFitComputations();
  const fit = evaluateTopicBusinessFit({ keyword: "lead qualification questions", label: "Lead Qualification Questions", ...signals });
  const unfit = evaluateTopicBusinessFit({ keyword: "mortgage lead generation", label: "Mortgage Lead Generation", ...signals });
  const otherTitle = evaluateTopicBusinessFit({ keyword: "lead qualification questions", label: "Questions", ...signals });
  const otherProfile = evaluateTopicBusinessFit({ keyword: "lead qualification questions", label: "Lead Qualification Questions",
    ...tenantTopicBusinessSignals({ ...site, keyFeatures: ["invoice reminders"] }) });
  assert.equal(topicFitComputations() - before, 4);
  assert.equal(fit.eligible, true); assert.equal(unfit.eligible, false);
  assert.ok(otherTitle && otherProfile);
});
