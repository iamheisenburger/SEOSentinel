import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateTopicBusinessFit,
  hasPractitionerIntent,
} from "../convex/lib/autopilotBuffer.ts";

/**
 * Regression for research-intent topics reaching article generation.
 *
 * LeadPilot's feature list contains "intent detection", so "intent detection
 * dataset" cleared product fit on the head term alone. The search intent is
 * academic: it wants CLINC150 sample counts, not a way to qualify website
 * visitors. Three articles were generated on it and the editorial reviewer
 * rejected all three — "a research abstraction distant from LeadPilot's
 * operational use case", "could run under any domain", "factual accuracy on
 * academic content cannot offset zero product utility".
 *
 * The prose was sound; one draft was called ready for publication. It still
 * failed, because the only way to add product grounding to a dataset survey is
 * to assert something first-party evidence cannot support, which the claim
 * audit correctly refuses. The topic must be rejected before generation.
 */

const LEADPILOT_SIGNALS = {
  coreBusinessSignals: [
    "lead qualification",
    "intent detection",
    "visitor chat",
  ],
  productAnchorSignals: ["lead qualification", "intent detection"],
  businessModelSignals: ["SaaS"],
};

test("research and implementation modifiers are recognised", () => {
  for (const keyword of [
    "intent detection dataset",
    "intent detection datasets",
    "intent classification benchmark",
    "intent detection python",
    "lead scoring github repo",
    "intent detection arxiv paper",
    "intent detection neural architecture",
  ]) {
    assert.equal(hasPractitionerIntent(keyword), true, keyword);
  }
});

test("genuine buyer problems are never mistaken for research queries", () => {
  for (const keyword of [
    "lead qualification software",
    "qualify leads without a form",
    "chatbot for lead generation",
    "how to detect buyer intent on your website",
    "b2b lead scoring",
  ]) {
    assert.equal(hasPractitionerIntent(keyword), false, keyword);
  }
});

test("the exact production topic is rejected before generation", () => {
  const fit = evaluateTopicBusinessFit({
    keyword: "intent detection dataset",
    label: "Intent Detection Datasets",
    ...LEADPILOT_SIGNALS,
  });
  assert.equal(fit.eligible, false);
  assert.ok(
    fit.reasons.some((reason) => /research or implementation intent/.test(reason)),
    "the reason must name the actual defect",
  );
});

test("the head term alone still admits a real buyer topic", () => {
  const fit = evaluateTopicBusinessFit({
    keyword: "intent detection software",
    label: "Intent Detection Software For Sales Teams",
    ...LEADPILOT_SIGNALS,
  });
  assert.equal(fit.eligible, true);
  assert.deepEqual(fit.reasons, []);
});
