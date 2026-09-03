import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateSchedulerReadyTopicInventory,
  opportunityDecisionInputHash,
  opportunityEvidenceVersionFromInputHash,
  schedulerReadyTopic,
} from "../convex/lib/schedulerTopicReadiness.ts";

const baseTopic = {
  _id: "topic-1",
  status: "planned",
  primaryKeyword: "lead qualification software",
  searchVolume: 500,
  keywordDifficulty: 18,
  keywordDifficultyMeasured: true,
  serpIntent: "commercial",
  serpTopUrls: [
    "https://one.example/a",
    "https://two.example/b",
    "https://three.example/c",
    "https://four.example/d",
    "https://five.example/e",
  ],
};

function ready(overrides: Partial<typeof baseTopic> = {}) {
  return schedulerReadyTopic({
    topic: { ...baseTopic, ...overrides },
    businessFitEligible: true,
    serpBusinessIntentAligned: true,
    expectedClickStatus: "eligible",
    serpAttainable: true,
  });
}

test("the shared scheduler predicate accepts only exact live evidence inventory", () => {
  assert.equal(ready(), true);
  assert.equal(ready({ keywordDifficultyMeasured: false }), false);
  assert.equal(ready({ serpIntent: "" }), false);
  assert.equal(ready({ serpTopUrls: baseTopic.serpTopUrls.slice(0, 4) }), false);
  assert.equal(
    schedulerReadyTopic({
      topic: baseTopic,
      businessFitEligible: true,
      serpBusinessIntentAligned: true,
      expectedClickStatus: "awaiting_live_demand",
      serpAttainable: true,
    }),
    false,
  );
});

test("workflow residue can never make setup or runtime topic-ready", () => {
  for (const status of [
    "plan_checkpoint",
    "used",
    "queued",
    "cannibalizing",
    "disqualified",
  ]) {
    assert.equal(ready({ status }), false, `${status} must not be inventory`);
  }
  assert.equal(ready({ status: "future_workflow_state" }), false);
  assert.equal(
    schedulerReadyTopic({
      topic: {
        ...baseTopic,
        planCheckpointTerminalFailureCode: "semantic_zero_yield",
      },
      businessFitEligible: true,
      serpBusinessIntentAligned: true,
      expectedClickStatus: "eligible",
      serpAttainable: true,
    }),
    false,
  );
});

test("immutable opportunity receipts advance when decision evidence changes", () => {
  const site = {
    domain: "leadpilot.example",
    siteName: "LeadPilot",
    niche: "AI sales and lead qualification software",
    siteSummary: "Qualifies website visitors and routes sales-ready leads.",
    targetAudienceSummary: "B2B sales and marketing teams",
    productUsage: "Automated website lead qualification",
    painPoints: ["slow lead response", "manual qualification"],
  };
  const planned = evaluateSchedulerReadyTopicInventory({
    site,
    topics: [baseTopic],
    monthlyOrganicClickGoal: 100,
    currentLocationCode: 2840,
    currentLanguageCode: "en",
  }).opportunityDecisions[0];
  const consumed = evaluateSchedulerReadyTopicInventory({
    site,
    topics: [{ ...baseTopic, status: "used" }],
    monthlyOrganicClickGoal: 100,
    currentLocationCode: 2840,
    currentLanguageCode: "en",
  }).opportunityDecisions[0];

  assert.notEqual(planned.inputHash, consumed.inputHash);
  assert.notEqual(planned.evidenceVersion, consumed.evidenceVersion);
  assert.equal(consumed.classification, "coverage_conflict");
  assert.equal(Number.isSafeInteger(planned.evidenceVersion), true);
  assert.equal(Number.isSafeInteger(consumed.evidenceVersion), true);
  assert.equal(
    opportunityEvidenceVersionFromInputHash(planned.inputHash),
    planned.evidenceVersion,
  );
});

test("missing SERP is recoverable evidence work, never a false business-fit failure", () => {
  const site = {
    domain: "leadpilot.example",
    siteName: "LeadPilot",
    niche: "AI sales and lead qualification software",
    siteSummary: "Qualifies website visitors and routes sales-ready leads.",
    targetAudienceSummary: "B2B sales and marketing teams",
    productUsage: "Automated website lead qualification",
    painPoints: ["slow lead response", "manual qualification"],
  };
  const decisions = evaluateSchedulerReadyTopicInventory({
    site,
    topics: [{
      ...baseTopic,
      serpIntent: undefined,
      serpTopUrls: undefined,
    }],
    monthlyOrganicClickGoal: 100,
    currentLocationCode: 2840,
    currentLanguageCode: "en",
  }).opportunityDecisions;
  assert.equal(
    decisions.find((decision) => decision.topicId === baseTopic._id)
      ?.classification,
    "needs_evidence",
  );
  assert.equal(decisions.some((decision) =>
    decision.classification === "opportunity_space_exhausted"
  ), false);
});

test("opportunity evidence versions reject malformed fingerprints", () => {
  assert.throws(
    () => opportunityEvidenceVersionFromInputHash("not-a-sha256"),
    /input hash is invalid/,
  );
});

test("opportunity receipt identity advances when policy changes the decision", () => {
  const evidence = {
    topicId: "topic-1",
    status: "planned",
    searchVolume: undefined,
    serpResultCount: 0,
  };
  const legacy = opportunityDecisionInputHash(evidence, {
    classification: "business_fit_failed",
    admitted: false,
    score: 0,
    reasons: ["The topic is not anchored to this tenant's product or buyer problem."],
    version: 1,
  });
  const repaired = opportunityDecisionInputHash(evidence, {
    classification: "needs_evidence",
    admitted: false,
    score: 0,
    reasons: ["The opportunity needs fresh demand, SERP, or authority evidence."],
    version: 1,
  });

  assert.notEqual(legacy, repaired);
  assert.notEqual(
    opportunityEvidenceVersionFromInputHash(legacy),
    opportunityEvidenceVersionFromInputHash(repaired),
  );
});

test("terminal content feasibility is reported as too thin, never coverage", () => {
  const site = {
    domain: "leadpilot.example",
    siteName: "LeadPilot",
    niche: "AI sales and lead qualification software",
  };
  const decision = evaluateSchedulerReadyTopicInventory({
    site,
    topics: [{
      ...baseTopic,
      status: "disqualified",
      contentFeasibilityStatus: "too_thin",
    }],
    monthlyOrganicClickGoal: 100,
    currentLocationCode: 2840,
    currentLanguageCode: "en",
  }).opportunityDecisions[0];
  assert.equal(decision.classification, "too_thin");
  assert.equal(decision.admitted, false);
});

test("zero forward inventory emits one durable site-level exhaustion receipt", () => {
  const site = {
    domain: "leadpilot.example",
    siteName: "LeadPilot",
    niche: "AI sales and lead qualification software",
  };
  const decisions = evaluateSchedulerReadyTopicInventory({
    site,
    topics: [{
      ...baseTopic,
      status: "disqualified",
      contentFeasibilityStatus: "too_thin",
    }],
    monthlyOrganicClickGoal: 100,
    currentLocationCode: 2840,
    currentLanguageCode: "en",
  }).opportunityDecisions;
  const exhausted = decisions.find((decision) =>
    decision.classification === "opportunity_space_exhausted"
  );
  assert.ok(exhausted);
  assert.equal(exhausted.topicId, undefined);
  assert.equal(exhausted.opportunityKey, "__forward_opportunity_space__");
  assert.ok((exhausted.nextEligibleAt ?? 0) > Date.now());
});

test("terminally refused forward inventory also converges to exhaustion", () => {
  const site = {
    domain: "leadpilot.example",
    siteName: "LeadPilot",
    niche: "AI sales and lead qualification software",
  };
  const decisions = evaluateSchedulerReadyTopicInventory({
    site,
    topics: [{
      ...baseTopic,
      status: "planned",
      contentFeasibilityStatus: "too_thin",
    }],
    monthlyOrganicClickGoal: 100,
    currentLocationCode: 2840,
    currentLanguageCode: "en",
  }).opportunityDecisions;
  assert.equal(
    decisions.find((decision) => decision.topicId === baseTopic._id)
      ?.classification,
    "too_thin",
  );
  const exhausted = decisions.find((decision) =>
    decision.classification === "opportunity_space_exhausted"
  );
  assert.ok(exhausted);
  assert.equal(exhausted.opportunityKey, "__forward_opportunity_space__");
  assert.ok((exhausted.nextEligibleAt ?? 0) > Date.now());
});

test("setup readiness and automatic runtime consume the same projection", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  const topics = readFileSync("convex/topics.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");

  assert.match(sites, /evaluateSchedulerReadyTopicInventory\(\{/);
  assert.match(
    sites,
    /schedulerReadiness\?\.schedulerReadyTopicIds\.length \?\? 0\) > 0/,
  );
  assert.doesNotMatch(
    sites.slice(
      sites.indexOf("export const getOneSetupReadiness"),
      sites.indexOf("export const setOneSetupCapabilityProgressInternal"),
    ),
    /status", "planned"\)[\s\S]*\.first\(\)/,
  );
  assert.match(topics, /evaluateSchedulerReadyTopicInventory\(\{/);
  assert.match(jobs, /evaluateSchedulerReadyTopicInventory\(\{/);
  assert.match(scheduler, /inventoryAudit\.schedulerReadyTopicIds/);
  assert.match(
    scheduler,
    /schedulerReadyTopicIds\.has\(String\(topic\._id\)\)/,
  );
});
