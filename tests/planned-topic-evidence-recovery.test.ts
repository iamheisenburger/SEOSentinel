import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
} from "../convex/lib/expectedClickDemandBackfill.ts";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
} from "../convex/lib/expectedClickEvidenceBackfill.ts";
import {
  PLANNED_TOPIC_EVIDENCE_RECOVERY_VERSION,
  cadenceInventoryNeedsPlannedRecovery,
  cadenceMicroSeedRecoveryBlockReason,
  exactPlannedRecoverySelectionMatches,
  expectedClickTargetKind,
  filterPlannedTopicRecoveryCoverage,
  guardedEvidenceContinuationAllowed,
  hasExactPlannedEvidenceAttempt,
  isCurrentExpectedClickBatch,
  partitionPlannedTopicRecoveryCoverage,
  plannedTargetsAllowedForQueue,
  plannedTopicDemandAdmission,
  plannedTopicEvidenceAdmission,
  plannedTopicRecoveryFingerprint,
  prioritizeCadenceRecoveryCandidates,
  selectPlannedRecoveryPhase,
  uniqueExactPlannedTargets,
  verifiedKeywordPlanningActive,
} from "../convex/lib/plannedTopicEvidenceRecovery.ts";
import { planSerpResultFingerprint } from
  "../convex/lib/planCandidateCheckpoint.ts";
import {
  coveredIntentTopics,
  evaluateTopicBusinessFit,
  filterNonCannibalizingIntentTopics,
  tenantTopicBusinessSignals,
} from "../convex/lib/autopilotBuffer.ts";

const helper = readFileSync(
  "convex/lib/plannedTopicEvidenceRecovery.ts",
  "utf8",
);
const demand = readFileSync(
  "convex/expectedClickDemandBackfill.ts",
  "utf8",
);
const demandAction = readFileSync(
  "convex/actions/expectedClickDemandBackfill.ts",
  "utf8",
);
const evidence = readFileSync(
  "convex/expectedClickEvidenceBackfill.ts",
  "utf8",
);
const evidenceAction = readFileSync(
  "convex/actions/expectedClickEvidenceBackfill.ts",
  "utf8",
);
const fleet = readFileSync(
  "convex/actions/expectedClickBackfillFleet.ts",
  "utf8",
);
const operatorRecovery = readFileSync(
  "convex/actions/plannedTopicEvidenceRecovery.ts",
  "utf8",
);
const schema = readFileSync("convex/schema.ts", "utf8");
const lifecycle = readFileSync("convex/lib/topicLifecycle.ts", "utf8");
const runbook = readFileSync(
  "docs/PLANNED_TOPIC_EVIDENCE_RECOVERY_RUNBOOK.md",
  "utf8",
);

const now = 1_787_500_000_000;
const site = {
  _id: "site-1",
  domain: "example.com",
  niche: "B2B lead qualification software",
  blogTheme: "lead qualification and conversion",
  siteSummary: "Software that qualifies inbound B2B leads",
  targetAudienceSummary: "B2B sales teams",
  productUsage: "score and qualify leads",
  siteType: "SaaS",
  anchorKeywords: ["lead scoring software", "lead qualification"],
  keyFeatures: ["AI lead scoring software", "lead qualification automation"],
  painPoints: ["sales teams waste time on unqualified leads"],
  targetCountry: "United States",
  language: "English",
  cadencePerWeek: 2,
  autopilotEnabled: true,
  autopilotRolloutMode: "live",
  autopilotRolloutEpoch: 4,
  expectedClickSchedulingEnabled: true,
  verifiedKeywordDataRequired: true,
};
const fit = evaluateTopicBusinessFit({
  keyword: "lead scoring software",
  label: "Lead Scoring Software",
  ...tenantTopicBusinessSignals(site as never),
});
const topic = {
  _id: "topic-1",
  siteId: "site-1",
  primaryKeyword: "lead scoring software",
  label: "Lead Scoring Software",
  status: "planned",
  keywordDifficulty: 6,
  keywordDifficultyMeasured: true,
  serpIntent: "commercial",
  serpTopUrls: [
    "https://a.example/one",
    "https://b.example/two",
    "https://c.example/three",
    "https://d.example/four",
    "https://e.example/five",
  ],
  serpObservedAt: now - 1_000,
  serpLocationCode: 2840,
  serpLanguageCode: "en",
  searchVolume: 20,
  businessFitEligible: fit.eligible,
  businessFitScore: fit.score,
  businessFitVersion: fit.version,
  businessFitReasons: fit.reasons,
};

test("planned recovery selection equality ignores serialized object key order", () => {
  const expected = [{
    topicId: "topic-1",
    keyword: "lead scoring software",
    fingerprint: "exact-fingerprint",
  }];
  const serialized = JSON.parse(JSON.stringify([{
    fingerprint: "exact-fingerprint",
    keyword: "lead scoring software",
    topicId: "topic-1",
  }])) as typeof expected;
  assert.equal(exactPlannedRecoverySelectionMatches(expected, serialized), true);
  assert.equal(exactPlannedRecoverySelectionMatches(expected, [{
    ...serialized[0],
    fingerprint: "different",
  }]), false);
});

test("selected target kind is discriminated and malformed mixed rows fail closed", () => {
  assert.equal(expectedClickTargetKind({
    articleId: "article-1",
    articleStatus: "published",
    artifactHash: "published:hash",
  }), "artifact");
  assert.equal(expectedClickTargetKind({
    targetKind: "planned_topic",
    plannedTopicFingerprint: "exact-topic-profile",
  }), "planned_topic");
  assert.equal(expectedClickTargetKind({
    targetKind: "planned_topic",
    articleId: "article-1",
    articleStatus: "published",
    artifactHash: "published:hash",
    plannedTopicFingerprint: "mixed",
  }), null);
  assert.equal(expectedClickTargetKind({ targetKind: "unknown" }), null);
  assert.equal(expectedClickTargetKind({}), null);
  assert.match(schema, /targetKind: v\.optional\(v\.union\([\s\S]*planned_topic/);
  assert.match(demand, /const targetKind = expectedClickTargetKind\(selected\)/);
  assert.match(evidence, /const targetKind = expectedClickTargetKind\(selected\)/);
});

test("phase admission accepts legacy SERP provenance but preserves strict inventory gates", () => {
  const legacyTopic = {
    ...topic,
    keywordDifficulty: 0,
    serpTopUrls: [
      ...topic.serpTopUrls,
      "https://f.example/six",
      "https://g.example/seven",
      "https://h.example/eight",
      "https://i.example/nine",
    ],
  } as Record<string, unknown>;
  Reflect.deleteProperty(legacyTopic, "serpObservedAt");
  Reflect.deleteProperty(legacyTopic, "serpLocationCode");
  Reflect.deleteProperty(legacyTopic, "serpLanguageCode");
  const demandAdmission = plannedTopicDemandAdmission({
    site: site as never,
    topic: legacyTopic as never,
    hasLinkedArticle: false,
    hasActiveArticleJob: false,
  });
  const evidenceAdmission = plannedTopicEvidenceAdmission({
    site: site as never,
    topic: legacyTopic as never,
    hasLinkedArticle: false,
    hasActiveArticleJob: false,
    hasCurrentPositiveDemand: true,
  });
  assert.equal(PLANNED_TOPIC_EVIDENCE_RECOVERY_VERSION, 2);
  assert.equal(demandAdmission.eligible, true);
  assert.equal(evidenceAdmission.eligible, true);
  assert.ok(demandAdmission.fingerprint);
  assert.ok(evidenceAdmission.fingerprint);
  assert.notEqual(demandAdmission.fingerprint, evidenceAdmission.fingerprint);
  const noLegacySerpTrust = { ...legacyTopic };
  Reflect.deleteProperty(noLegacySerpTrust, "serpIntent");
  Reflect.deleteProperty(noLegacySerpTrust, "serpTopUrls");
  assert.equal(plannedTopicDemandAdmission({
    site: site as never,
    topic: noLegacySerpTrust as never,
    hasLinkedArticle: false,
    hasActiveArticleJob: false,
  }).eligible, true);
  assert.equal(plannedTopicEvidenceAdmission({
    site: site as never,
    topic: noLegacySerpTrust as never,
    hasLinkedArticle: false,
    hasActiveArticleJob: false,
    hasCurrentPositiveDemand: true,
  }).eligible, true);
  assert.equal(plannedTopicEvidenceAdmission({
    site: site as never,
    topic: legacyTopic as never,
    hasLinkedArticle: false,
    hasActiveArticleJob: false,
    hasCurrentPositiveDemand: false,
  }).reason, "current_positive_demand_required");
  assert.match(demand, /plannedTopicDemandAdmission\(/);
  assert.match(evidence, /plannedTopicEvidenceAdmission\(/);
  assert.doesNotMatch(helper, /export function plannedTopicAdmission\(/);
  for (const [name, hasLinkedArticle, hasActiveArticleJob] of [
    ["linked", true, false],
    ["queued", false, true],
  ] as const) {
    assert.equal(plannedTopicDemandAdmission({
      site: site as never,
      topic: legacyTopic as never,
      hasLinkedArticle,
      hasActiveArticleJob,
    }).eligible, false, name);
    assert.equal(plannedTopicEvidenceAdmission({
      site: site as never,
      topic: legacyTopic as never,
      hasLinkedArticle,
      hasActiveArticleJob,
      hasCurrentPositiveDemand: true,
    }).eligible, false, `${name} evidence`);
  }
  for (const [name, changed] of [
    ["orphan status", { status: "pending" }],
    ["unmeasured KD", { keywordDifficultyMeasured: false }],
    ["malformed KD", { keywordDifficulty: Number.NaN }],
    ["old fit", { businessFitVersion: 4 }],
    ["disqualified", { disqualifiedReason: "failed" }],
  ] as const) {
    assert.equal(plannedTopicDemandAdmission({
      site: site as never,
      topic: { ...topic, ...changed } as never,
      hasLinkedArticle: false,
      hasActiveArticleJob: false,
    }).eligible, false, name);
    assert.equal(plannedTopicEvidenceAdmission({
      site: site as never,
      topic: { ...topic, ...changed } as never,
      hasLinkedArticle: false,
      hasActiveArticleJob: false,
      hasCurrentPositiveDemand: true,
    }).eligible, false, `${name} evidence`);
  }
});

test("checkpoint SERP attempts are never adopted or replayed by planned recovery", () => {
  const attemptedAt = now - 2_000;
  const results = [1, 2, 3, 4, 5].map((position) => ({
    position,
    url: `https://result-${position}.example/page`,
  }));
  const normalizedUrlFingerprint = planSerpResultFingerprint(results);
  assert.ok(normalizedUrlFingerprint);
  const checkpointTopic = {
    ...topic,
    planCheckpointSerpAttemptedAt: attemptedAt,
    planCheckpointCandidateFingerprint: "candidate-fingerprint",
    planCheckpointSeedManifestHash: "seed-manifest",
    planCheckpointWorkerExecution: 1,
    planCheckpointSerpReceipt: {
      version: 1,
      candidateFingerprint: "candidate-fingerprint",
      seedManifestHash: "seed-manifest",
      workerExecution: 1,
      normalizedUrlFingerprint: normalizedUrlFingerprint!,
      observedAt: attemptedAt + 1_000,
      locationCode: 2840,
      languageCode: "en",
      results,
      businessIntentAligned: true,
      attainable: true,
      cannibalizationClear: true,
    },
  };
  assert.equal(plannedTopicDemandAdmission({
    site: site as never,
    topic: checkpointTopic as never,
    hasLinkedArticle: false,
    hasActiveArticleJob: false,
  }).reason, "plan_checkpoint_serp_already_attempted");
  assert.equal(plannedTopicEvidenceAdmission({
    site: site as never,
    topic: checkpointTopic as never,
    hasLinkedArticle: false,
    hasActiveArticleJob: false,
    hasCurrentPositiveDemand: true,
    timestamp: now,
  }).reason, "plan_checkpoint_serp_already_attempted");
  assert.equal(plannedTopicEvidenceAdmission({
    site: site as never,
    topic: {
      ...checkpointTopic,
      planCheckpointSerpReceipt: undefined,
    } as never,
    hasLinkedArticle: false,
    hasActiveArticleJob: false,
    hasCurrentPositiveDemand: true,
    timestamp: now,
  }).reason, "plan_checkpoint_serp_already_attempted");
  assert.equal(plannedTopicEvidenceAdmission({
    site: site as never,
    topic: {
      ...checkpointTopic,
      planCheckpointTerminalFailureCode: "semantic_failure",
    } as never,
    hasLinkedArticle: false,
    hasActiveArticleJob: false,
    hasCurrentPositiveDemand: true,
    timestamp: now,
  }).reason, "plan_checkpoint_terminal");
});

test("planned recovery and micro admission cannot trust legacy SERPs past lexical coverage", () => {
  const covered = [{
    primaryKeyword: "b2b lead scoring",
    serpTopUrls: [
      "https://covered-a.example/one",
      "https://covered-b.example/two",
      "https://covered-c.example/three",
      "https://covered-d.example/four",
      "https://covered-e.example/five",
    ],
  }];
  const legacyCandidate = {
    primaryKeyword: "lead scoring saas",
    serpTopUrls: [
      "https://legacy-a.example/one",
      "https://legacy-b.example/two",
      "https://legacy-c.example/three",
      "https://legacy-d.example/four",
      "https://legacy-e.example/five",
    ],
  };

  // This is the former contradiction: two complete but unverified SERPs can
  // appear disjoint and bypass the lexical conflict.
  assert.equal(filterNonCannibalizingIntentTopics(
    [legacyCandidate],
    covered,
    0.4,
    0.35,
    1,
  ).length, 1);
  assert.deepEqual(
    filterPlannedTopicRecoveryCoverage([legacyCandidate], covered, 1),
    [],
  );
  assert.match(
    demand,
    /plannedCoverage = partitionPlannedTopicRecoveryCoverage/,
  );
  assert.match(
    evidence,
    /plannedCandidates = filterPlannedTopicRecoveryCoverage/,
  );
  assert.match(
    evidence,
    /plannedPendingDemand = filterPlannedTopicRecoveryCoverage/,
  );
});

test("guarded recovery and micro admission share the exact executable phase selector", () => {
  const plannedSelection = [{
    topicId: "topic-1" as never,
    keyword: "lead qualification software",
    fingerprint: "exact-fingerprint",
  }];
  const readyDemand = {
    ready: true,
    reservationDay: "2026-08-23",
    rolloutEpoch: 4,
    candidateCounts: { artifactEligible: 0 },
    plannedSelection,
  };
  assert.deepEqual(selectPlannedRecoveryPhase(readyDemand, null), {
    phase: "demand",
    inspectionDay: "2026-08-23",
    rolloutEpoch: 4,
    selected: plannedSelection,
  });
  assert.equal(selectPlannedRecoveryPhase({
    ...readyDemand,
    candidateCounts: { artifactEligible: 1 },
  }, null), null);
  assert.equal(selectPlannedRecoveryPhase({
    ...readyDemand,
    ready: false,
  }, null), null);
  assert.equal(selectPlannedRecoveryPhase({
    ...readyDemand,
    plannedSelection: [],
  }, null), null);
  assert.equal(
    cadenceMicroSeedRecoveryBlockReason(readyDemand, null),
    "planned_topic_recovery_available",
  );
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ...readyDemand,
    candidateCounts: { artifactEligible: 1 },
    plannedSelection: [],
  }, null), "expected_click_recovery_available");
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ...readyDemand,
    candidateCounts: { artifactEligible: 38 },
    plannedSelection: [],
  }, {
    ready: false,
    actionable: false,
    reason: "demand_candidates_remaining",
  }, true), null);
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ...readyDemand,
    candidateCounts: { artifactEligible: 38 },
    plannedSelection: [],
  }, {
    ready: true,
    actionable: true,
    reason: "queued",
  }, true), "expected_click_recovery_available");
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ...readyDemand,
    candidateCounts: { artifactEligible: 0 },
    plannedSelection,
  }, {
    ready: false,
    actionable: false,
    reason: "demand_candidates_remaining",
  }, true), "planned_topic_recovery_available");
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: false,
    actionable: true,
    reason: "provider_attempt_ambiguous",
  }, {
    ready: false,
    actionable: false,
    reason: "no_current_demand_candidates",
  }), "expected_click_recovery_unresolved");
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: false,
    actionable: false,
    reason: "no_eligible_legacy_topics",
  }, {
    ready: false,
    actionable: false,
    reason: "no_current_demand_candidates",
  }), null);
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
  }, {
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
  }), "expected_click_recovery_unresolved");
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
    continueToEvidence: true,
  }, {
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
    continueToCadenceMicroSeed: true,
  }), null);
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: true,
    actionable: false,
    reason: "eligible",
    candidateCounts: { artifactEligible: 30 },
    plannedSelection: [],
  }, {
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
    continueToCadenceMicroSeed: true,
  }), null);
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: true,
    actionable: true,
    reason: "provider_attempt_ambiguous",
    candidateCounts: { artifactEligible: 30 },
    plannedSelection: [],
  }, {
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
    continueToCadenceMicroSeed: true,
  }), "expected_click_recovery_available");
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
    continueToEvidence: true,
  }, {
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
    guardedContinuationReady: true,
    candidateCounts: { artifactEligible: 0 },
    plannedSelection,
    reservationDay: "2026-08-23",
    rolloutEpoch: 4,
  }), "planned_topic_recovery_available");
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
    continueToEvidence: true,
  }, {
    ready: false,
    actionable: false,
    reason: "demand_candidates_remaining",
  }), null);
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
    continueToEvidence: false,
  }, {
    ready: false,
    actionable: false,
    reason: "demand_candidates_remaining",
  }), "expected_click_recovery_unresolved");
  assert.equal(cadenceMicroSeedRecoveryBlockReason({
    ready: false,
    actionable: false,
    reason: "daily_batch_exists",
  }, {
    ready: false,
    actionable: false,
    reason: "demand_phase_incomplete",
  }), "expected_click_recovery_unresolved");
  assert.match(operatorRecovery, /selectPlannedRecoveryPhase/);
});

test("same-day evidence continuation is exact, terminal, and non-replayable", () => {
  const completed = [{
    status: "completed",
    plannedRecoveryInspectionKey: "prior-key",
  }];
  assert.equal(guardedEvidenceContinuationAllowed({
    origin: "operator_canary",
    inspectionKey: "new-key",
    todayJobs: completed,
  }), true);
  assert.equal(guardedEvidenceContinuationAllowed({
    origin: "autonomous_fleet",
    inspectionKey: "new-key",
    todayJobs: completed,
  }), false);
  assert.equal(guardedEvidenceContinuationAllowed({
    origin: "operator_canary",
    inspectionKey: "prior-key",
    todayJobs: completed,
  }), false);
  assert.equal(guardedEvidenceContinuationAllowed({
    origin: "operator_canary",
    inspectionKey: "new-key",
    todayJobs: [...completed, { status: "running" }],
  }), false);
  assert.equal(guardedEvidenceContinuationAllowed({
    origin: "operator_canary",
    inspectionKey: "new-key",
    todayJobs: [],
  }), false);
});

test("planned recovery terminally separates covered intent without classifying valid overflow", () => {
  const covered = [{
    primaryKeyword: "b2b lead scoring",
    serpTopUrls: [
      "https://one.example/a",
      "https://two.example/b",
      "https://three.example/c",
      "https://four.example/d",
      "https://five.example/e",
    ],
  }];
  const conflicting = {
    primaryKeyword: "lead scoring saas",
    serpTopUrls: [
      "https://legacy.example/1",
      "https://legacy.example/2",
      "https://legacy.example/3",
      "https://legacy.example/4",
      "https://legacy.example/5",
    ],
  };
  const distinct = [
    { primaryKeyword: "inbound qualification checklist" },
    { primaryKeyword: "sales routing automation" },
  ];
  const result = partitionPlannedTopicRecoveryCoverage(
    [conflicting, ...distinct],
    covered,
    1,
  );

  assert.deepEqual(
    result.eligible.map((candidate) => candidate.primaryKeyword),
    ["inbound qualification checklist"],
  );
  assert.deepEqual(
    result.blocked.map((candidate) => candidate.primaryKeyword),
    ["lead scoring saas"],
  );
  assert.match(demand, /readiness\?\.plannedCoverageBlockedTopicIds/);
  assert.match(demand, /topic\?\.siteId !== siteId \|\| topic\.status !== "planned"/);
  assert.match(demand, /status: "cannibalizing"/);
  assert.match(demand, /planned_recovery_coverage_conflict/);
});

test("phase fingerprint binds keyword observations, locale, domain, and tenant profile", () => {
  const base = plannedTopicRecoveryFingerprint({
    phase: "demand",
    site: site as never,
    topic: topic as never,
  });
  const variants = [
    plannedTopicRecoveryFingerprint({
      phase: "evidence",
      site: site as never,
      topic: topic as never,
    }),
    plannedTopicRecoveryFingerprint({
      phase: "demand",
      site: { ...site, domain: "other.example" } as never,
      topic: topic as never,
    }),
    plannedTopicRecoveryFingerprint({
      phase: "demand",
      site: { ...site, targetAudienceSummary: "consumer shoppers" } as never,
      topic: topic as never,
    }),
    plannedTopicRecoveryFingerprint({
      phase: "demand",
      site: { ...site, targetCountry: "United Kingdom" } as never,
      topic: topic as never,
    }),
    plannedTopicRecoveryFingerprint({
      phase: "demand",
      site: site as never,
      topic: { ...topic, keywordDifficulty: 7 } as never,
    }),
    plannedTopicRecoveryFingerprint({
      phase: "demand",
      site: site as never,
      topic: { ...topic, serpIntent: "informational" } as never,
    }),
    plannedTopicRecoveryFingerprint({
      phase: "demand",
      site: site as never,
      topic: { ...topic, searchVolume: 21 } as never,
    }),
  ];
  for (const variant of variants) assert.notEqual(variant, base);
});

test("cadence-critical planned evidence cannot be starved by legacy artifacts", () => {
  const legacyCoverage = coveredIntentTopics([], [{
    slug: "legacy-lead-scoring-guide",
    status: "published",
  }]);
  assert.deepEqual(legacyCoverage, [{
    primaryKeyword: "legacy lead scoring guide",
  }]);
  assert.deepEqual(
    uniqueExactPlannedTargets([
      { keyword: "Lead Scoring SaaS", topicId: "preferred" },
      { keyword: " lead   scoring saas ", topicId: "duplicate" },
      { keyword: "lead qualification", topicId: "distinct" },
    ]).map((candidate) => candidate.topicId),
    ["preferred", "distinct"],
  );
  for (const model of [demand, evidence]) {
    assert.match(model, /filterNonCannibalizingIntentTopics\(/);
    assert.match(model, /artifactEligible/);
    assert.match(model, /plannedUnmaterialized/);
    assert.match(model, /coveredIntentTopics\(/);
    assert.match(model, /uniqueExactPlannedTargets\(/);
  }
  assert.deepEqual(
    prioritizeCadenceRecoveryCandidates(
      ["ready-artifact"],
      ["ready-planned"],
      true,
    ),
    ["ready-planned"],
  );
  assert.deepEqual(
    prioritizeCadenceRecoveryCandidates(
      ["ready-artifact"],
      ["ready-planned"],
      false,
    ),
    ["ready-artifact"],
  );
  assert.equal(cadenceInventoryNeedsPlannedRecovery(
    { cadencePerWeek: 7 },
    [],
  ), true);
  const sealed = {
    status: "ready",
    publicationGateStatus: "passed",
    publicationAuditVersion: 6,
    auditedContentHash: "sealed",
  };
  assert.equal(cadenceInventoryNeedsPlannedRecovery(
    { cadencePerWeek: 7 },
    [sealed, sealed, sealed],
  ), false);
  assert.equal(isCurrentExpectedClickBatch(
    { rolloutEpoch: 5, policyVersion: 2 },
    5,
    2,
  ), true);
  assert.equal(isCurrentExpectedClickBatch(
    { rolloutEpoch: 5, policyVersion: 1 },
    5,
    2,
  ), false);
  assert.match(demand, /cadenceInventoryNeedsPlannedRecovery/);
  assert.match(demand, /prioritizeCadenceRecoveryCandidates/);
  assert.match(evidence, /cadenceInventoryNeedsPlannedRecovery/);
  assert.match(
    evidence,
    /plannedPendingDemand > 0[\s\S]*prioritizeCadenceRecoveryCandidates\([\s\S]*artifactCandidates,[\s\S]*plannedCandidates/,
  );
  assert.match(
    evidence,
    /plannedRecoveryGuard[\s\S]*inventory\.artifactCandidates\.length === 0[\s\S]*inventory\.plannedCandidates/,
  );
});

test("plan, quota, job, article, authority, locale and epoch gates repeat at paid boundaries", () => {
  assert.match(helper, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(helper, /article_quota_no_headroom/);
  assert.match(helper, /PLANNED_TOPIC_ARTICLE_USAGE_READ_LIMIT/);
  assert.match(helper, /activeArticleJobTopicIds/);
  assert.match(helper, /verifiedKeywordPlanningActive\(site\)/);
  assert.match(helper, /site\.cadencePerWeek/);
  assert.match(demand, /beginProviderAttempt[\s\S]*currentSelectedTopic/);
  assert.match(demand, /persistDemand[\s\S]*currentSelectedTopic/);
  assert.match(evidence, /beginProviderCall[\s\S]*currentSelectedTopic/);
  assert.match(evidence, /persistEvidence[\s\S]*currentSelectedTopic/);
  assert.match(demand, /job\.rolloutEpoch !== \(site\.autopilotRolloutEpoch \?\? 0\)/);
  assert.match(evidence, /job\.rolloutEpoch !== \(site\.autopilotRolloutEpoch \?\? 0\)/);
  assert.match(demand, /measuredAuthorityIsFresh/);
  assert.match(evidence, /measuredAuthorityIsFresh/);
});

test("enabled legacy autopilot tenants inherit verified keyword planning", () => {
  assert.equal(verifiedKeywordPlanningActive({ autopilotEnabled: true }), true);
  assert.equal(verifiedKeywordPlanningActive({
    autopilotEnabled: true,
    verifiedKeywordDataRequired: false,
  }), true);
  assert.equal(verifiedKeywordPlanningActive({
    autopilotEnabled: false,
    verifiedKeywordDataRequired: true,
  }), true);
  assert.equal(verifiedKeywordPlanningActive({ autopilotEnabled: false }), false);
});

test("attempt receipts are durable before HTTP and generic updatedAt churn cannot grant replay", () => {
  assert.match(demand, /searchDemandBackfillAttemptVersion/);
  assert.match(demandAction, /api\.beginProviderAttempt[\s\S]*getExactKeywordDemandFromDataForSEO/);
  assert.match(evidence, /function hasAnyExactEvidenceAttempt[\s\S]*hasExactPlannedEvidenceAttempt/);
  const exactAttempt = evidence.slice(
    evidence.indexOf("function hasAnyExactEvidenceAttempt"),
    evidence.indexOf("function selectedPlannedDescriptors"),
  );
  assert.doesNotMatch(exactAttempt, /updatedAt/);
  const attempted = {
    primaryKeyword: "lead scoring saas",
    expectedClickEvidenceAttemptVersion: 1,
    expectedClickEvidenceAttemptKeyword: " Lead   Scoring SaaS ",
    updatedAt: 10,
  };
  assert.equal(hasExactPlannedEvidenceAttempt(attempted, 1), true);
  assert.equal(hasExactPlannedEvidenceAttempt({
    ...attempted,
    updatedAt: 99,
  }, 1), true);
  const beginBoundary = evidence.slice(
    evidence.indexOf("export const beginProviderCall"),
    evidence.indexOf("export const recordSerpSnapshot"),
  );
  assert.match(
    beginBoundary,
    /expectedClickTargetKind\(selectedTopic\) === "planned_topic"[\s\S]*hasAnyExactEvidenceAttempt/,
  );
  assert.match(evidenceAction, /api\.beginProviderCall[\s\S]*analyzeSERPFromDataForSEO/);
  assert.match(demand, /provider_response_unverified/);
  assert.match(evidence, /authority_attempt_ambiguous/);
});

test("fresh planned SERP must pass intent, attainability and cannibalization before authority", () => {
  assert.match(evidence, /evaluateSerpBusinessIntent/);
  assert.match(evidence, /evaluateSerpAttainability/);
  assert.match(evidence, /serp_business_intent_mismatch/);
  assert.match(evidence, /serp_unattainable/);
  assert.match(evidence, /serp_cannibalization_conflict/);
  assert.match(evidence, /serp_locale_receipt_mismatch/);
  assert.match(evidence, /plannedSerpSnapshotMatchesCurrentLocale/);
  assert.match(evidenceAction, /const observedAt = Date\.now\(\);[\s\S]*locationCode,[\s\S]*languageCode,/);
  assert.match(schema, /serpSnapshots: v\.array\(v\.object\(\{[\s\S]*locationCode: v\.optional\(v\.number\(\)\)[\s\S]*languageCode: v\.optional\(v\.string\(\)\)/);
  const authorityBoundary = evidence.slice(
    evidence.indexOf("export const beginProviderCall"),
    evidence.indexOf("export const recordSerpSnapshot"),
  );
  assert.match(authorityBoundary, /plannedValidationVersion/);
  assert.match(authorityBoundary, /plannedSerpSnapshotMatchesCurrentLocale/);
  assert.match(authorityBoundary, /plannedTopicClearsCurrentCoverage/);
  assert.match(evidence, /persistEvidence[\s\S]*plannedBusinessIntentAligned/);
  assert.match(evidence, /persistEvidence[\s\S]*serpLocationCode: snapshot\.locationCode/);
  const snapshotBoundary = evidence.slice(
    evidence.indexOf("export const recordSerpSnapshot"),
    evidence.indexOf("export const recordSerpFailure"),
  );
  assert.doesNotMatch(snapshotBoundary, /ctx\.db\.patch\(args\.topicId/);
});

test("inspect/apply binds the exact inventory and cannot create plan work", () => {
  const recovery = operatorRecovery.slice(
    operatorRecovery.indexOf("export const recoverPlannedTopicEvidence"),
  );
  assert.match(recovery, /mode: v\.union\(v\.literal\("inspect"\), v\.literal\("apply"\)\)/);
  assert.match(operatorRecovery, /createHash\("sha256"\)/);
  assert.match(operatorRecovery, /artifactCandidates: 0/);
  assert.match(operatorRecovery, /topicId: String\(item\.topicId\)/);
  assert.match(operatorRecovery, /keyword: item\.keyword/);
  assert.match(operatorRecovery, /fingerprint: item\.fingerprint/);
  assert.match(recovery, /planned_recovery_inspection_stale/);
  assert.match(recovery, /const applied = queuedSuccessfully\(result\)/);
  assert.doesNotMatch(recovery, /topic_plan|generateArticle|discoverKeywords|publish/);
  assert.doesNotMatch(
    fleet,
    /\.queueExpectedClick(?:Demand|Evidence)Backfill,/,
  );
  assert.match(demand, /exactPlannedGuardMatches/);
  assert.match(evidence, /exactPlannedGuardMatches/);
});

test("unguarded operator canaries are artifact-only while fleet fallback remains enabled", () => {
  assert.equal(plannedTargetsAllowedForQueue("operator_canary", false), false);
  assert.equal(plannedTargetsAllowedForQueue("operator_canary", true), true);
  assert.equal(plannedTargetsAllowedForQueue("autonomous_fleet", false), true);
  assert.equal(plannedTargetsAllowedForQueue("unknown", true), false);
  for (const model of [demand, evidence]) {
    assert.match(model, /plannedTargetsAllowedForQueue\(origin, false\)/);
    assert.match(model, /planned_recovery_origin_invalid/);
  }
});

test("ordinary ledgers cap the two-stage recovery at exactly $0.20", () => {
  assert.equal(EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD, 100_000);
  assert.equal(EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD, 100_000);
  assert.equal(
    EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD +
      EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    200_000,
  );
  assert.match(operatorRecovery, /PLANNED_RECOVERY_COMBINED_CEILING_MICRO_USD/);
  assert.match(demand, /purpose: "expected_click_demand_backfill"/);
  assert.match(evidence, /purpose: "expected_click_evidence_backfill"/);
  assert.match(runbook, /Combined worst case is \$0\.20/);
  assert.match(runbook, /never reopens a plan job or its provider reservation/i);
});

test("planned measurement does not weaken durable topic coverage or publish itself", () => {
  assert.match(lifecycle, /article\.status === "published"/);
  assert.match(lifecycle, /article\.status === "ready"/);
  assert.doesNotMatch(lifecycle, /planned_topic/);
  assert.doesNotMatch(demand, /status: "used"/);
  assert.doesNotMatch(evidence, /status: "used"/);
  assert.doesNotMatch(demandAction, /generateArticle|publish/);
  assert.doesNotMatch(evidenceAction, /generateArticle|publish/);
});
