import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  adaptiveDiscoverySeeds,
  adaptiveOpportunityScore,
  CADENCE_BALANCE_RECHECK_MS,
  CADENCE_PROVIDER_RECHECK_MS,
  cadenceProgressionDecision,
  classifyCadenceFailure,
  deriveCadenceRecoveryStrategy,
  nextUtcDayAt,
  nextUtcMonthAt,
} from "../convex/lib/cadenceLiveness.ts";

const NOW = Date.UTC(2026, 7, 25, 12, 0, 0);

test("funding recovery shares the bounded maintenance interval", () => {
  assert.equal(CADENCE_BALANCE_RECHECK_MS, 15 * 60 * 1000);
  assert.equal(CADENCE_BALANCE_RECHECK_MS, CADENCE_PROVIDER_RECHECK_MS);
});

test("failure taxonomy exposes exact eligible deadlines without inventing a terminal retry", () => {
  const semantic = classifyCadenceFailure({
    message:
      "Verified planning checkpoint retained zero exact candidates; recording an honest inventory miss",
    now: NOW,
  });
  assert.deepEqual(
    {
      category: semantic.category,
      code: semantic.code,
      retryable: semantic.retryable,
      terminal: semantic.terminal,
      eligibleAt: semantic.eligibleAt,
    },
    {
      category: "semantic_zero_yield",
      code: "strict_zero_yield",
      retryable: false,
      terminal: true,
      eligibleAt: undefined,
    },
  );

  const transient = classifyCadenceFailure({
    message: "provider balance preflight unavailable",
    now: NOW,
  });
  assert.equal(transient.category, "transient_provider");
  assert.equal(transient.retryable, true);
  assert.ok((transient.eligibleAt ?? 0) > NOW);

  for (const message of [
    "Article provider outcome (article_provider_funding_unavailable)",
    "The primary article provider has no available funded capacity.",
  ]) {
    const funding = classifyCadenceFailure({ message, now: NOW });
    assert.equal(funding.category, "provider_funding");
    assert.equal(funding.code, "provider_balance_insufficient");
    assert.equal(funding.eligibleAt, NOW + CADENCE_BALANCE_RECHECK_MS);
  }

  const reservation = classifyCadenceFailure({
    message: "plan_reservation_day_expired_before_execution",
    now: NOW,
  });
  assert.equal(reservation.category, "budget_window");
  assert.equal(reservation.eligibleAt, nextUtcDayAt(NOW));

  const quota = classifyCadenceFailure({
    message: "monthly generation quota reached",
    now: NOW,
  });
  assert.equal(quota.category, "monthly_quota");
  assert.equal(quota.eligibleAt, nextUtcMonthAt(NOW));

  const readiness = classifyCadenceFailure({
    message: "autopilot readiness regressed",
    now: NOW,
  });
  assert.equal(readiness.category, "readiness");
  assert.equal(readiness.eligibleAt, undefined);
});

test("consecutive strict empty plans rotate bounded sources and intent while a yield resets them", () => {
  const initial = deriveCadenceRecoveryStrategy({
    recentPlans: [],
    targetBufferShortfall: 3,
    requiredVerifiedYield: 7,
  });
  assert.deepEqual(
    [initial.stage, initial.sourceMode, initial.intentMode, initial.yieldMode],
    [0, "gsc_profile", "exact", "buffer_first"],
  );

  const oneMiss = deriveCadenceRecoveryStrategy({
    recentPlans: [{
      status: "failed",
      cadenceFailure: {
        category: "semantic_zero_yield",
        code: "strict_zero_yield",
      },
    }],
    targetBufferShortfall: 2,
    requiredVerifiedYield: 5,
  });
  assert.deepEqual(
    [oneMiss.stage, oneMiss.sourceMode, oneMiss.intentMode],
    [1, "profile_gsc", "commercial"],
  );

  const twoMisses = deriveCadenceRecoveryStrategy({
    recentPlans: [
      { status: "failed", error: "honest inventory miss" },
      { status: "done", result: { count: 0 } },
    ],
    targetBufferShortfall: 0,
    requiredVerifiedYield: 20,
  });
  assert.deepEqual(
    [twoMisses.stage, twoMisses.sourceMode, twoMisses.intentMode],
    [2, "problem_intent", "workflow"],
  );
  assert.equal(twoMisses.requiredVerifiedYield, 10);
  assert.equal(twoMisses.yieldMode, "verified_horizon");

  const reset = deriveCadenceRecoveryStrategy({
    recentPlans: [
      { status: "done", result: { count: 3 } },
      { status: "failed", error: "honest inventory miss" },
    ],
    targetBufferShortfall: 1,
    requiredVerifiedYield: 3,
  });
  assert.equal(reset.stage, 0);
});

test("alternative discovery stays tenant-derived and hard-bounded", () => {
  const strategy = deriveCadenceRecoveryStrategy({
    recentPlans: [
      { status: "failed", error: "honest inventory miss" },
      { status: "failed", error: "honest inventory miss" },
    ],
    targetBufferShortfall: 3,
    requiredVerifiedYield: 3,
  });
  const seeds = adaptiveDiscoverySeeds({
    strategy,
    gscSeeds: ["lead qualification chatbot"],
    profileSeeds: ["website sales agent", "buyer intent detection"],
    problemSeeds: ["low website conversion", "slow lead response"],
    rotatingSeeds: Array.from({ length: 30 }, (_, index) =>
      `tenant sales topic ${index}`
    ),
  });
  assert.ok(seeds.length <= 20);
  assert.equal(seeds[0], "low website conversion");
  assert.ok(seeds.includes("low website conversion workflow"));
  assert.ok(seeds.includes("how to low website conversion"));
  assert.ok(seeds.every((seed) => seed.split(/\s+/).length <= 6));
});

test("recovery seed families reach the provider-consumed first fifteen slots", () => {
  const strategy = deriveCadenceRecoveryStrategy({
    recentPlans: [{
      status: "failed",
      cadenceFailure: {
        category: "semantic_zero_yield",
        code: "strict_zero_yield",
      },
    }],
    targetBufferShortfall: 3,
    requiredVerifiedYield: 7,
  });
  const profileSeeds = Array.from(
    { length: 16 },
    (_, index) => `tenant product anchor ${index}`,
  );
  const gscSeeds = ["measured search demand query"];
  const rotatingSeeds = Array.from(
    { length: 20 },
    (_, index) => `rotating discovery phrase ${index}`,
  );
  const seeds = adaptiveDiscoverySeeds({
    strategy,
    gscSeeds,
    profileSeeds,
    problemSeeds: ["slow lead response"],
    rotatingSeeds,
  });
  const providerWindow = seeds.slice(0, 15);

  assert.equal(strategy.sourceMode, "profile_gsc");
  assert.equal(strategy.intentMode, "commercial");
  assert.equal(seeds.length, 20);
  assert.equal(providerWindow[0], profileSeeds[0]);
  assert.ok(providerWindow.some((seed) => seed.endsWith(" software")));
  assert.ok(providerWindow.includes(gscSeeds[0]));
  assert.ok(providerWindow.some((seed) => seed.startsWith("rotating discovery")));
});

test("GSC rank/CTR and attributed conversions only add a bounded priority bonus", () => {
  const neutral = adaptiveOpportunityScore({
    keyword: "lead qualification chatbot",
    baseOpportunity: 48,
    demandSignals: [],
    outcomeSignals: [],
  });
  assert.deepEqual(neutral, { score: 48, feedbackBonus: 0 });

  const measured = adaptiveOpportunityScore({
    keyword: "automated lead qualification chatbot",
    baseOpportunity: 48,
    demandSignals: [{
      query: "lead qualification chatbot",
      clicks: 8,
      impressions: 400,
      position: 8,
    }],
    outcomeSignals: [{
      keyword: "lead qualification software",
      qualifiedActions: 8,
      organicLandingSessions: 50,
      signups: 4,
      activations: 2,
      paidConversions: 1,
    }],
  });
  assert.ok(measured.score > neutral.score);
  assert.ok(measured.feedbackBonus > 0);
  assert.ok(measured.feedbackBonus <= 24);
});

test("behavioral journey advances zero inventory to buffer 3 then natural publication", () => {
  assert.equal(cadenceProgressionDecision({
    terminalBlockers: [],
    schedulerReadyTopics: 0,
    sealedBuffer: 0,
    targetBuffer: 3,
    publicationDue: false,
  }), "plan_topics");

  for (const [topics, buffer] of [[3, 0], [2, 1], [1, 2]] as const) {
    assert.equal(cadenceProgressionDecision({
      terminalBlockers: [],
      schedulerReadyTopics: topics,
      sealedBuffer: buffer,
      targetBuffer: 3,
      publicationDue: false,
    }), "generate_buffer");
  }
  assert.equal(cadenceProgressionDecision({
    terminalBlockers: [],
    schedulerReadyTopics: 0,
    sealedBuffer: 3,
    targetBuffer: 3,
    publicationDue: false,
  }), "wait_for_cadence");
  assert.equal(cadenceProgressionDecision({
    terminalBlockers: [],
    schedulerReadyTopics: 0,
    sealedBuffer: 3,
    targetBuffer: 3,
    publicationDue: true,
  }), "publish_due");
});

test("honest terminal blockers stop the journey and production wiring preserves strict gates", () => {
  assert.equal(cadenceProgressionDecision({
    terminalBlockers: ["publication adapter is not verified"],
    schedulerReadyTopics: 10,
    sealedBuffer: 3,
    targetBuffer: 3,
    publicationDue: true,
  }), "terminal_blocker");

  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  const evidence = readFileSync(
    "convex/expectedClickEvidenceBackfill.ts",
    "utf8",
  );
  assert.match(jobs, /cadenceRecoveryStrategy/);
  assert.match(jobs, /\.take\(12\)/);
  assert.match(jobs, /cadence_failure_deadline/);
  assert.match(pipeline, /adaptiveDiscoverySeeds/);
  assert.match(pipeline, /adaptiveOpportunityScore/);
  assert.match(pipeline, /evaluateTopicBusinessFit/);
  assert.match(pipeline, /keywordDifficultyCeiling/);
  assert.match(pipeline, /evaluateSerpBusinessIntent/);
  assert.match(pipeline, /planCandidateCheckpoints\.stage/);
  assert.match(scheduler, /filterNonCannibalizingIntentTopics/);
  assert.match(scheduler, /scheduleEligibilityDeadline/);
  assert.match(evidence, /cadenceFollowupScheduledAt: timestamp/);
  assert.match(evidence, /expected_click_evidence_ready/);
});
