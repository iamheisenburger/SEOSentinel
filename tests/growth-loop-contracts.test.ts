import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  capabilityReceipt,
  decideOpportunity,
  decideOutreachPolicy,
  growthLoopRolloutAllowsSite,
  growthLoopRolloutBucket,
  growthLoopOperationalSiteInScope,
  growthLoopReleaseBlockers,
  isGrowthLoopSevereIncident,
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
  assert.match(
    growthLoop,
    /await startEligibleRollout\([\s\S]*args\.releaseCommit,[\s\S]*args\.profile,[\s\S]*args\.deploymentReceiptHash/,
  );
  assert.match(growthLoop, /export const advanceRolloutInternal/);
  assert.match(growthLoop, /staged_rollout_incomplete/);
  assert.match(growthLoop, /silent_state_over_15_minutes/);
  assert.match(autopilot, /growthLoopRolloutAllowsSite/);
  assert.match(autopilot, /growth_loop_rollout_cohort_not_enabled/);
  assert.match(crons, /growth-loop-ga-rollout/);
  assert.match(crons, /growth-loop-ga-rollout-start/);
});

test("bootstrap operational evidence is scoped to its authorized tenant pair", () => {
  const authorized = new Set(["pentra", "leadpilot"]);
  assert.equal(
    growthLoopOperationalSiteInScope("bootstrap_v1", authorized, "pentra"),
    true,
  );
  assert.equal(
    growthLoopOperationalSiteInScope("bootstrap_v1", authorized, "unrelated"),
    false,
  );
  assert.equal(
    growthLoopOperationalSiteInScope("full_managed", authorized, "unrelated"),
    true,
  );
  assert.equal(isGrowthLoopSevereIncident("job_failed"), false);
  assert.equal(isGrowthLoopSevereIncident("quality_revision_run_failed"), false);
  assert.equal(isGrowthLoopSevereIncident("cross_tenant_receipt"), true);
  assert.equal(
    isGrowthLoopSevereIncident("outreach", "Suppression boundary failed"),
    true,
  );
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
  const exhausted = decideOpportunity({ remainingCandidateCount: 0 }, 1);
  assert.equal(exhausted.classification, "opportunity_space_exhausted");
  assert.ok((exhausted.nextEligibleAt ?? 0) > 1);
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
  assert.equal(decideOutreachPolicy({
    recipientClass: "corporate",
    jurisdiction: "US",
    jurisdictionEvidence: "business-address-country",
    businessRoleEvidence: "customer",
    businessRelevance: "requested product update",
    contactSource: "customer record",
    lawfulBasisClass: "recipient-opt-in",
    requiredDisclosuresPresent: true,
    tenantConsentVersion: 1,
    suppressed: false,
    legalRuleEnabled: false,
    transport: "gmail_oauth",
  }).decision, "needs_evidence");
  assert.equal(decideOutreachPolicy({
    recipientClass: "corporate",
    jurisdiction: "US",
    jurisdictionEvidence: "business-address-country",
    businessRoleEvidence: "customer",
    businessRelevance: "requested product update",
    contactSource: "customer record",
    lawfulBasisClass: "recipient-opt-in",
    requiredDisclosuresPresent: true,
    tenantConsentVersion: 1,
    suppressed: false,
    legalRuleEnabled: false,
    transport: "gmail_oauth",
    gmailRecipientConsentVerified: true,
    gmailRecipientConsentEvidence: "a".repeat(64),
    gmailRecipientConsentRecordedAt: 1,
  }).decision, "approval_only");
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

test("bootstrap v1 has a separate truthful zero-cost acceptance profile", () => {
  const base = {
    profile: "bootstrap_v1" as const,
    releaseCommit: "a".repeat(40),
    publisherCanaries: ["github"] as const,
    tenantCanaryIds: ["pentra", "leadpilot"],
    unrelatedTenantCount: 2,
    naturalPlanningVerified: true,
    sealedBufferVerified: true,
    publicationVerified: true,
    measurementDecisionExecuted: true,
    terminalConvergenceVerified: true,
    smtpConnectionVerified: true,
    smtpDeliveryVerified: true,
    imapReplyVerified: true,
    imapBounceVerified: true,
    imapStopVerified: true,
    smtpFollowupCancellationVerified: true,
    controlledConversionVerified: true,
    acquiredBacklinkVerified: true,
    unresolvedSevereIncidentCount: 0,
    silentStateCount: 0,
  };
  assert.deepEqual(growthLoopReleaseBlockers(base), []);
  assert.ok(growthLoopReleaseBlockers({ ...base, imapStopVerified: false })
    .includes("imap_stop_missing"));
  assert.ok(growthLoopReleaseBlockers({ ...base, unrelatedTenantCount: 1 })
    .includes("two_authorized_tenant_canaries_missing"));
});

test("the controlled conversion proves ingestion without entering customer metrics", () => {
  const outcomes = readFileSync("convex/outcomes.ts", "utf8");
  const start = outcomes.indexOf(
    "export const recordControlledConversionCanaryInternal",
  );
  const end = outcomes.indexOf("async function requireSiteOwner", start);
  assert.ok(start >= 0 && end > start);
  const block = outcomes.slice(start, end);
  assert.match(block, /isCanary: true/);
  assert.match(block, /__pentra_controlled_canary__/);
  assert.doesNotMatch(block, /outcome_daily_rollups/);
});

test("the SMTP connection release proof can bind a post-deploy controlled socket receipt", () => {
  const growthLoopSource = readFileSync("convex/growthLoop.ts", "utf8");
  assert.match(growthLoopSource, /controlledDelivery\.controlledCanaryKind !== "smtp_delivery"/);
  assert.match(growthLoopSource, /controlledDeliverySentAt: controlledDelivery\?\.sentAt/);
  assert.match(growthLoopSource, /controlledDelivery\?\.sentAt \?\? 0/);
});

test("measurement release evidence recognizes a later GSC re-observation", () => {
  const growthLoopSource = readFileSync("convex/growthLoop.ts", "utf8");
  assert.match(
    growthLoopSource,
    /lastObservedAt: action\.lastObservedAt[\s\S]*Math\.max\([\s\S]*action\.automatedAt[\s\S]*action\.resolvedAt[\s\S]*action\.lastObservedAt/,
  );
});

test("a partial bootstrap release gets one bounded natural post-deploy GSC re-observation", () => {
  const growthLoopSource = readFileSync("convex/growthLoop.ts", "utf8");
  const actions = readFileSync("convex/actions/seoGrowth.ts", "utf8");
  assert.match(
    growthLoopSource,
    /export const listPendingMeasurementRecoverySitesInternal/,
  );
  assert.match(
    growthLoopSource,
    /row\.kind === "measurement_decision" && row\.status === "passed"/,
  );
  assert.match(
    growthLoopSource,
    /action\.lastObservedAt[\s\S]*< latest\.deployedAt/,
  );
  assert.match(
    actions,
    /internal\.growthLoop\.listPendingMeasurementRecoverySitesInternal/,
  );
});

test("durable growth deadlines have a bounded natural recovery lane", () => {
  const schema = readFileSync("convex/schema.ts", "utf8");
  const growth = readFileSync("convex/seoGrowth.ts", "utf8");
  const actions = readFileSync("convex/actions/seoGrowth.ts", "utf8");
  const crons = readFileSync("convex/crons.ts", "utf8");
  assert.match(schema, /index\("by_next_review", \["nextReviewAt"\]\)/);
  assert.match(growth, /export const listDueGrowthSitesInternal/);
  assert.match(growth, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(growth, /now \+ GROWTH_REVIEW_RECOVERY_DELAY_MS/);
  assert.match(actions, /export const scanDueSites/);
  assert.match(crons, /due-seo-growth-recovery/);
});

test("bootstrap release evidence binds Pentra's natural role separately from the secondary convergence canary", () => {
  const release = readFileSync("convex/growthLoop.ts", "utf8");
  assert.match(release, /primary_natural/);
  assert.match(release, /secondary_convergence/);
  assert.match(
    release,
    /tenant_terminal_convergence[\s\S]*bootstrapTenantRole !== "secondary_convergence"/,
  );
  assert.match(
    release,
    /primaryNaturalCanaries\.length >= 1/,
  );
  assert.match(
    release,
    /inboundMonitoringCapability\(currentInbox[\s\S]*inboundCapability\.ready/,
  );
});
