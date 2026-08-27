import assert from "node:assert/strict";
import test from "node:test";

import {
  capabilityReceipt,
  decideOpportunity,
  decideOutreachPolicy,
  growthLoopRolloutAllowsSite,
  growthLoopRolloutBucket,
  growthLoopReleaseBlockers,
} from "../convex/lib/growthLoopContracts.ts";

test("unfinished capability receipts cannot be silent", () => {
  assert.throws(() => capabilityReceipt({
    capability: "publication",
    state: "waiting_provider",
    binding: "site:1",
    evaluatedAt: 1,
  }), /blocker code/);
  assert.throws(() => capabilityReceipt({
    capability: "publication",
    state: "waiting_provider",
    blockerCode: "provider_verification_pending",
    binding: "site:1",
    evaluatedAt: 1,
  }), /automatic wake/);
  const receipt = capabilityReceipt({
    capability: "publication",
    state: "waiting_provider",
    blockerCode: "provider_verification_pending",
    nextEligibleAt: 10,
    automaticWakeAt: 10,
    binding: "site:1",
    evaluatedAt: 1,
  });
  assert.equal(receipt.responsibleParty, "provider");
  assert.equal(receipt.nextEligibleAt, 10);
});

test("GA widening uses stable 10, 50, and 100 percent tenant cohorts", async () => {
  const bucket = growthLoopRolloutBucket("tenant-a");
  assert.ok(bucket >= 0 && bucket < 100);
  assert.equal(growthLoopRolloutBucket("tenant-a"), bucket);
  assert.equal(growthLoopRolloutAllowsSite("tenant-a", 100), true);
  assert.equal(
    growthLoopRolloutAllowsSite("tenant-a", 10),
    bucket < 10,
  );
  assert.throws(() => growthLoopRolloutAllowsSite("tenant-a", 25), /0, 10, 50, or 100/);
  const [growthLoop, autopilot, crons] = await Promise.all([
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/growthLoop.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/autopilot.ts", import.meta.url), "utf8")),
    import("node:fs/promises").then((fs) => fs.readFile(new URL("../convex/crons.ts", import.meta.url), "utf8")),
  ]);
  assert.match(growthLoop, /export const startRolloutInternal/);
  assert.match(growthLoop, /export const ensureEligibleRolloutInternal/);
  assert.match(growthLoop, /await startEligibleRollout\(ctx, args\.releaseCommit\)/);
  assert.match(growthLoop, /export const advanceRolloutInternal/);
  assert.match(growthLoop, /staged_rollout_incomplete/);
  assert.match(growthLoop, /silent_state_over_15_minutes/);
  assert.match(autopilot, /growthLoopRolloutAllowsSite/);
  assert.match(autopilot, /growth_loop_rollout_cohort_not_enabled/);
  assert.match(crons, /growth-loop-ga-rollout/);
  assert.match(crons, /growth-loop-ga-rollout-start/);
});

test("opportunity admission combines evidence and does not use a global volume floor", () => {
  const decision = decideOpportunity({
    businessFitScore: 100,
    businessFitEligible: true,
    monthlyDemand: 20,
    expectedClicksMonthly: 12,
    serpAttainable: true,
    commercialRelevance: 1,
    contentDepthScore: 0.9,
    evidenceFresh: true,
  }, 1);
  assert.equal(decision.classification, "eligible");
  assert.equal(decision.admitted, true);
  assert.equal(decideOpportunity({ coverageConflict: true }, 1).classification, "coverage_conflict");
  assert.equal(decideOpportunity({ remainingCandidateCount: 0 }, 1).classification, "opportunity_space_exhausted");
});

test("outreach policy is globally usable but automatic sending is fail closed", () => {
  assert.equal(decideOutreachPolicy({
    requiredDisclosuresPresent: true,
    suppressed: false,
    legalRuleEnabled: false,
  }).decision, "needs_evidence");
  assert.equal(decideOutreachPolicy({
    recipientClass: "corporate",
    jurisdiction: "US",
    jurisdictionEvidence: "business-address-country",
    businessRoleEvidence: "editor role",
    businessRelevance: "broken-link replacement",
    contactSource: "public corporate page",
    lawfulBasisClass: "reviewed-us-b2b-rule",
    requiredDisclosuresPresent: true,
    tenantConsentVersion: 1,
    suppressed: false,
    legalRuleEnabled: false,
  }).decision, "approval_only");
  assert.equal(decideOutreachPolicy({
    recipientClass: "personal",
    jurisdiction: "US",
    jurisdictionEvidence: "x",
    businessRoleEvidence: "x",
    businessRelevance: "x",
    contactSource: "x",
    lawfulBasisClass: "x",
    requiredDisclosuresPresent: true,
    tenantConsentVersion: 1,
    suppressed: false,
    legalRuleEnabled: true,
  }).decision, "blocked");
});

test("GA cannot be stamped without every real adapter and outcome canary", () => {
  const base = {
    releaseCommit: "abcdef1",
    publisherCanaries: ["github", "wordpress", "webhook"] as const,
    tenantCanaryIds: ["a", "b", "c"],
    unrelatedTenantCount: 3,
    naturalPlanningVerified: true,
    sealedBufferVerified: true,
    publicationVerified: true,
    measurementDecisionExecuted: true,
    smartleadProvisioningVerified: true,
    smartleadWarmupVerified: true,
    smartleadDeliveryVerified: true,
    smartleadReplyVerified: true,
    smartleadBounceVerified: true,
    smartleadUnsubscribeVerified: true,
    smartleadCancellationVerified: true,
    acquiredBacklinkVerified: true,
    unresolvedSevereIncidentCount: 0,
    silentStateCount: 0,
  };
  assert.deepEqual(growthLoopReleaseBlockers({ ...base, publisherCanaries: [...base.publisherCanaries] }), []);
  assert.ok(growthLoopReleaseBlockers({
    ...base,
    publisherCanaries: [...base.publisherCanaries],
    acquiredBacklinkVerified: false,
  }).includes("acquired_backlink_missing"));
});
