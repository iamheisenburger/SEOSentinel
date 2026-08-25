import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateTopicBusinessFit,
  hasTerminalTopicFitFailure,
  terminalTopicFitSettlement,
} from "../convex/lib/autopilotBuffer.ts";

/**
 * Regression for the generated-title quarantine bypass.
 *
 * Pre-generation gates evaluate business fit against the topic's stored label,
 * so a topic can clear both the cadence audit and the pre-spend recheck. The
 * final alignment gate evaluates the generated article title, which does not
 * exist until after paid model work. When that gate fails terminally the
 * article is correctly frozen, but before this settlement the linked topic
 * stayed schedulable, so the next cadence pass re-selected the same intent and
 * paid to generate it again.
 */

const CHECKED_AT = Date.UTC(2026, 7, 25, 18, 0, 0);

// A tenant that genuinely sells lead scoring. These signals admit the keyword
// outright, so the generated title is the ONLY variable that can reject it —
// which is exactly what makes the failure unreachable before model spend.
const SITE_SIGNALS = {
  coreBusinessSignals: ["lead scoring saas", "lead scoring", "lead qualification"],
  productAnchorSignals: ["lead scoring", "lead scoring saas"],
  businessModelSignals: ["SaaS"],
};

// The stored topic label is on-product, which is why the pre-spend gates pass.
const TOPIC = {
  _id: "topic_lead_scoring",
  siteId: "site_a",
  status: "queued",
  primaryKeyword: "lead scoring saas",
  label: "Lead scoring for SaaS sales teams",
};

// The generated title drifted off-product. This is the value the final gate
// sees and the value no pre-generation check could have known.
const DRIFTED_TITLE = "Best Hiking Trails In Patagonia For Winter Travellers";

const TERMINAL_ISSUE =
  `The primary keyword "lead scoring saas" does not align with both the ` +
  `configured business and the final article title.`;

const ARTICLE = {
  siteId: "site_a",
  title: DRIFTED_TITLE,
  status: "review",
  topicId: "topic_lead_scoring",
};

function settle(overrides: Record<string, unknown> = {}) {
  return terminalTopicFitSettlement({
    gateStatus: "blocked",
    issues: [TERMINAL_ISSUE],
    article: ARTICLE,
    topic: TOPIC,
    siteSignals: SITE_SIGNALS,
    checkedAt: CHECKED_AT,
    ...overrides,
  } as Parameters<typeof terminalTopicFitSettlement>[0]);
}

test("the bypass premise holds: stored label passes, generated title fails", () => {
  // Exactly the asymmetry that makes this reachable only after model spend.
  const preSpend = evaluateTopicBusinessFit({
    keyword: TOPIC.primaryKeyword,
    label: TOPIC.label,
    ...SITE_SIGNALS,
  });
  assert.equal(preSpend.eligible, true, "pre-spend gate must admit this topic");

  const finalGate = evaluateTopicBusinessFit({
    keyword: TOPIC.primaryKeyword,
    label: DRIFTED_TITLE,
    ...SITE_SIGNALS,
  });
  assert.equal(finalGate.eligible, false, "final title gate must reject it");
  assert.equal(hasTerminalTopicFitFailure([TERMINAL_ISSUE]), true);
});

test("a terminal title-alignment failure quarantines the exact linked topic", () => {
  const settlement = settle();
  assert.ok(settlement, "terminal title drift must produce a topic quarantine");
  const patch = settlement.topicPatch;
  assert.equal(patch.status, "disqualified");
  assert.equal(patch.businessFitEligible, false);
  assert.equal(patch.businessFitCheckedAt, CHECKED_AT);
  assert.equal(patch.updatedAt, CHECKED_AT);
  // The reason must be durable operator evidence, not an empty string.
  assert.ok(patch.businessFitReasons.length > 0);
  assert.equal(patch.disqualifiedReason, patch.businessFitReasons.join("; "));
  assert.equal(typeof patch.businessFitScore, "number");
  assert.equal(typeof patch.businessFitVersion, "number");
  assert.equal(settlement.topicId, TOPIC._id);
});

test("a quarantined topic can no longer satisfy the pre-spend admission gate", () => {
  const settlement = settle();
  assert.ok(settlement);
  const quarantined = { ...TOPIC, ...settlement.topicPatch };
  // The scheduler's schedulable statuses never include "disqualified", and the
  // persisted receipt independently records ineligibility.
  assert.equal(quarantined.status, "disqualified");
  assert.equal(quarantined.businessFitEligible, false);
  // Re-settling is idempotent: an already-disqualified topic is not rewritten.
  assert.equal(settle({ topic: quarantined }), null);
});

test("only terminal topic-fit issues quarantine; ordinary defects never do", () => {
  assert.equal(
    settle({ issues: ["Meta description is too long."] }),
    null,
    "an ordinary quality defect must remain a revisable article problem",
  );
  assert.equal(settle({ issues: [] }), null);
  assert.equal(
    settle({ gateStatus: "passed", issues: [TERMINAL_ISSUE] }),
    null,
    "a passing gate must never quarantine",
  );
});

test("the publish-path marker is settled by the same transaction", () => {
  // publisher.ts records this second marker; both must reach one settlement.
  const publishMarker =
    `Measured topic "lead scoring saas" failed the current tenant ` +
    `product-fit gate: keyword is not anchored to a specific tenant product`;
  const settlement = settle({ issues: [publishMarker] });
  assert.ok(settlement);
  assert.equal(settlement.topicPatch.status, "disqualified");
});

test("tenant, topic-link and checkpoint fences are enforced", () => {
  // Cross-tenant topic must never be mutated by another site's article.
  assert.equal(settle({ topic: { ...TOPIC, siteId: "site_b" } }), null);
  // An article with no linked topic settles nothing.
  assert.equal(settle({ topic: null }), null);
  assert.equal(
    settle({ article: { ...ARTICLE, topicId: undefined }, topic: TOPIC }),
    null,
  );
  // The article must reference this exact topic.
  assert.equal(
    settle({ article: { ...ARTICLE, topicId: "topic_other" } }),
    null,
  );
  // A plan-checkpoint terminal failure owns the topic lifecycle; do not race it.
  assert.equal(
    settle({
      topic: { ...TOPIC, planCheckpointTerminalFailureCode: "ambiguous" },
    }),
    null,
  );
  assert.equal(settle({ topic: { ...TOPIC, status: "plan_checkpoint" } }), null);
});

test("sealed and published work is never re-settled", () => {
  assert.equal(settle({ article: { ...ARTICLE, status: "published" } }), null);
});

test("a topic whose intent still fits the tenant is left alone", () => {
  // Defensive: if the recorded issue is terminal but the current tenant
  // configuration genuinely fits, requalification must remain possible rather
  // than the topic being destroyed by a stale receipt.
  const onProduct = settle({
    article: { ...ARTICLE, title: "Lead Scoring For SaaS Sales Teams" },
  });
  assert.equal(onProduct, null);
});

test("the settlement is wired into the authoritative publication check", () => {
  const articles = readFileSync("convex/articles.ts", "utf8");
  const check = articles.slice(articles.indexOf("export const recordPublicationCheck"));
  assert.match(
    check.slice(0, 3000),
    /terminalTopicFitSettlement/,
    "recordPublicationCheck must settle the linked topic atomically",
  );
});
