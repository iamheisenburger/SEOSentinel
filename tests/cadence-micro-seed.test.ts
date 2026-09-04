import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { discoverCadenceMicroSeedFromDataForSEO } from
  "../convex/actions/seoData.ts";
import {
  CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT,
  CADENCE_MICRO_SEED_FALLBACK_PROVIDER_CEILING_MICRO_USD,
  CADENCE_MICRO_SEED_MAX_FALLBACK_PARENT_AGE_MS,
  CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES,
  CADENCE_MICRO_SEED_MAX_SOURCE_PLAN_AGE_MS,
  CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD,
  CADENCE_MICRO_SEED_PROVIDER_TIMEOUT_MS,
  CADENCE_MICRO_SEED_RESULT_LIMIT,
  CADENCE_MICRO_SEED_VERSION,
  CADENCE_MICRO_SEED_ANCHOR_AUDIT_VERSION,
  cadenceMicroSeedAnchors,
  cadenceMicroSeedCheckpointSourcePlanExhausted,
  cadenceMicroSeedCheckpointSourcePlanExhaustionKind,
  cadenceMicroSeedAttemptKind,
  cadenceMicroSeedCandidateMatchesAnchor,
  cadenceMicroSeedLegacyAnchorReceiptEligible,
  cadenceMicroSeedPreSerpDifficultyCeiling,
  cadenceMicroSeedProviderCeilingMicroUsd,
  cadenceMicroSeedProviderPurpose,
  cadenceMicroSeedProviderReceiptValid,
  cadenceMicroSeedProviderTrigger,
  cadenceMicroSeedSourcePlanExecutionExhausted,
  cadenceMicroSeedSourcePlanFresh,
  cadenceMicroSeedTerminalMissReceiptValid,
  selectCadenceMicroSeedAnchor,
  selectCadenceMicroSeedCandidate,
  selectCadenceMicroSeedFallbackAnchor,
  type CadenceMicroSeedMetric,
} from "../convex/lib/cadenceMicroSeed.ts";
import {
  evaluateProviderAccountCapacity,
  evaluateSharedProviderCapacity,
  PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
  SHARED_PROVIDER_DAILY_CEILING_MICRO_USD,
  SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD,
} from "../convex/lib/providerSpendReservation.ts";
import {
  CADENCE_QUALITY_RECOVERY_READ_LIMIT,
  DETERMINISTIC_QUALITY_REPAIR_VERSION,
  deterministicMechanicalRepairArticles,
  hasRecoverableQualityWork,
  recoverableQualityArticlesSince,
} from "../convex/lib/autopilotCadence.ts";
import { PUBLICATION_AUDIT_VERSION } from
  "../convex/lib/publicationArtifact.ts";

const model = readFileSync("convex/cadenceMicroSeed.ts", "utf8");
const demandBackfill = readFileSync(
  "convex/expectedClickDemandBackfill.ts",
  "utf8",
);
const action = readFileSync("convex/actions/cadenceMicroSeed.ts", "utf8");
const articles = readFileSync("convex/articles.ts", "utf8");
const topics = readFileSync("convex/topics.ts", "utf8");
const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
const jobs = readFileSync("convex/jobs.ts", "utf8");
const provider = readFileSync("convex/actions/seoData.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const crons = readFileSync("convex/crons.ts", "utf8");
const runbook = readFileSync(
  "docs/CADENCE_MICRO_SEED_RECOVERY_RUNBOOK.md",
  "utf8",
);

function metric(
  keyword: string,
  overrides: Partial<CadenceMicroSeedMetric> = {},
): CadenceMicroSeedMetric {
  return {
    keyword,
    searchVolume: 90,
    difficulty: 8,
    difficultyMeasured: true,
    cpc: 2.4,
    competition: 0.4,
    intent: "commercial",
    trend: [70, 75, 80, 90],
    ...overrides,
  };
}

function providerFixture() {
  const seed = "lead scoring software";
  const tag = "cadence-micro-seed-v3-job-placeholder";
  const data = {
    status_code: 20_000,
    tasks_count: 1,
    tasks_error: 0,
    cost: 0.024,
    tasks: [{
      status_code: 20_000,
      cost: 0.024,
      path: [
        "v3",
        "dataforseo_labs",
        "google",
        "keyword_ideas",
        "live",
      ],
      data: {
        api: "dataforseo_labs",
        function: "keyword_ideas",
        se_type: "google",
        keywords: [seed],
        location_code: 2840,
        language_code: "en",
        closely_variants: true,
        include_serp_info: false,
        include_clickstream_data: false,
        tag,
        filters: ["keyword_info.search_volume", ">=", 10],
        order_by: [
          "relevance,desc",
          "keyword_info.search_volume,desc",
          "keyword_properties.keyword_difficulty,asc",
        ],
        limit: 100,
      },
      result: [{
        seed_keywords: [seed],
        se_type: "google",
        location_code: 2840,
        language_code: "en",
        items: [{
          se_type: "google",
          location_code: 2840,
          language_code: "en",
          keyword: "predictive lead scoring platform",
          keyword_info: {
            search_volume: 90,
            cpc: 2.4,
            competition: 0.4,
            monthly_searches: [
              { search_volume: 70 },
              { search_volume: 75 },
              { search_volume: 80 },
              { search_volume: 90 },
            ],
          },
          keyword_properties: { keyword_difficulty: 8 },
          search_intent_info: { main_intent: "commercial" },
        }],
      }],
    }],
  };
  return { seed, tag, data };
}

test("paid seeds preserve search anchors and rotate deterministically", () => {
  assert.deepEqual(cadenceMicroSeedAnchors({
    anchorKeywords: [
      "lead scoring and qualification tool",
      "sales automation chat widget",
    ],
    keyFeatures: ["qualification tool"],
  }), [
    "lead scoring and qualification tool",
    "sales automation chat widget",
    "qualification tool",
  ]);
  const anchors = cadenceMicroSeedAnchors({
    anchorKeywords: [
      "Lead scoring software",
      "Predictive lead qualification",
      "Automated sales routing",
      "Buyer intent scoring",
    ],
    keyFeatures: [
      "Predictive lead qualification",
      "Automated sales routing",
      "Buyer intent scoring",
    ],
    productUsage: "write generic sales advice",
    painPoints: ["sales teams need more pipeline"],
  } as Parameters<typeof cadenceMicroSeedAnchors>[0] & Record<string, unknown>);
  assert.deepEqual(anchors.slice(0, 4), [
    "lead scoring software",
    "predictive lead qualification",
    "automated sales routing",
    "buyer intent scoring",
  ]);
  assert.ok(anchors.includes("sales teams need more pipeline"));
  assert.ok(anchors.includes("write generic sales advice"));
  assert.equal(
    selectCadenceMicroSeedAnchor(anchors, "source-plan-placeholder"),
    selectCadenceMicroSeedAnchor(anchors, "source-plan-placeholder"),
  );
  assert.equal(selectCadenceMicroSeedAnchor([], "source"), null);
  const primary = selectCadenceMicroSeedAnchor(
    anchors,
    "source-plan-placeholder",
  )!;
  const fallback = selectCadenceMicroSeedFallbackAnchor(
    anchors,
    "source-plan-placeholder",
    primary,
  );
  assert.ok(fallback);
  assert.notEqual(fallback, primary);
  assert.equal(
    fallback,
    selectCadenceMicroSeedFallbackAnchor(
      anchors,
      "source-plan-placeholder",
      primary,
    ),
  );
  assert.equal(selectCadenceMicroSeedFallbackAnchor(
    [primary],
    "source-plan-placeholder",
    primary,
  ), null);
  assert.equal(selectCadenceMicroSeedFallbackAnchor(
    anchors,
    "source-plan-placeholder",
    "profile anchor removed",
  ), null);
  const repairedPrimary = selectCadenceMicroSeedAnchor(
    anchors,
    "source-plan-placeholder",
    1,
  );
  assert.ok(repairedPrimary);
  assert.notEqual(repairedPrimary, primary);
  assert.notEqual(
    selectCadenceMicroSeedFallbackAnchor(
      anchors,
      "source-plan-placeholder",
      repairedPrimary!,
      1,
    ),
    fallback,
  );
});

test("paid seeds supplement all search profiles without replacing explicit anchors", () => {
  const mature = cadenceMicroSeedAnchors({
    anchorKeywords: [
      "AI SEO content generator",
      "automated SEO content creation",
      "autonomous content marketing platform",
    ],
    keyFeatures: [
      "Keyword clustering and planning",
      "Automated content publishing",
    ],
  });
  assert.deepEqual(mature.slice(0, 3), [
    "ai seo content generator",
    "automated seo content creation",
    "autonomous content marketing platform",
  ]);
  assert.ok(mature.includes("keyword clustering and planning"));
  assert.ok(mature.includes("automated content publishing"));
  assert.deepEqual(cadenceMicroSeedAnchors({
    anchorKeywords: ["Lead scoring software"],
    keyFeatures: [
      "Predictive lead qualification",
      "Automated sales routing",
    ],
  }), [
    "lead scoring software",
    "predictive lead qualification",
    "automated sales routing",
  ]);
  assert.deepEqual(cadenceMicroSeedAnchors({
    keyFeatures: [
      "Predictive lead qualification",
      "Automated sales routing",
      "Buyer intent scoring",
    ],
  }), [
    "predictive lead qualification",
    "automated sales routing",
    "buyer intent scoring",
  ]);
});

test("paid seeds expose bounded explicit buyer problems after product anchors", () => {
  const anchors = cadenceMicroSeedAnchors({
    anchorKeywords: ["website lead generation automation"],
    keyFeatures: ["booking link integration"],
    painPoints: [
      "Lost leads from visitors who don't immediately fill out forms",
      "Manual lead qualification consuming sales team time",
    ],
    productUsage:
      "The AI agent captures contact details and books qualified calls",
    targetAudienceSummary:
      "Growth teams with high website traffic but low conversion rates",
  });
  assert.equal(anchors[0], "website lead generation automation");
  assert.ok(anchors.includes("booking link integration"));
  assert.ok(anchors.includes("lost leads visitors who don t"));
  assert.ok(anchors.includes("manual lead qualification consuming sales team"));
  assert.ok(anchors.length <= 32);
  assert.equal(new Set(anchors).size, anchors.length);
});

test("a policy upgrade advances past every previously attempted tenant anchor", () => {
  const anchors = [
    "lead qualification chatbot",
    "website lead generation automation",
    "lost leads from website visitors",
    "booking qualified sales calls",
  ];
  const attempted = [
    "Lead Qualification Chatbot",
    "website lead generation automation",
  ];
  const primary = selectCadenceMicroSeedAnchor(
    anchors,
    "mature-source-plan",
    15,
    attempted,
  );
  assert.ok([
    "lost leads from website visitors",
    "booking qualified sales calls",
  ].includes(primary ?? ""));
  const fallback = selectCadenceMicroSeedFallbackAnchor(
    anchors,
    "mature-source-plan",
    primary!,
    15,
    attempted,
  );
  assert.ok(fallback);
  assert.notEqual(fallback, primary);
  assert.equal(attempted.includes(fallback!), false);
  assert.equal(
    selectCadenceMicroSeedAnchor(
      anchors,
      "mature-source-plan",
      15,
      anchors,
    ),
    null,
  );
});

test("legacy unpublished inventory remains eligible only with exact current anchor provenance", () => {
  const currentAnchors = [
    "lead scoring and qualification tool",
    "sales automation chat widget",
  ];
  assert.equal(cadenceMicroSeedLegacyAnchorReceiptEligible({
    currentAnchors,
    jobSeed: "lead scoring and qualification tool",
    selectedKeyword: "lead qualification tool",
    topicKeyword: "lead qualification tool",
  }), true);
  assert.equal(cadenceMicroSeedLegacyAnchorReceiptEligible({
    currentAnchors,
    jobSeed: "qualification tool",
    selectedKeyword: "tool qualification",
    topicKeyword: "tool qualification",
  }), false, "a lossy historical seed cannot reserve the corrected tenant intent");
  assert.equal(cadenceMicroSeedLegacyAnchorReceiptEligible({
    currentAnchors,
    jobSeed: "lead scoring and qualification tool",
    selectedKeyword: "generic marketing software",
    topicKeyword: "lead qualification tool",
  }), false, "the immutable provider selection must equal the topic receipt");
  assert.equal(cadenceMicroSeedLegacyAnchorReceiptEligible({
    currentAnchors,
    jobSeed: "lead scoring and qualification tool",
    selectedKeyword: "lead qualification tool",
    topicKeyword: "generic marketing software",
  }), false, "an off-anchor topic cannot survive through a matching receipt alone");
});

test("fallback is a distinct $0.05 receipt after an exact terminal primary miss", () => {
  assert.equal(cadenceMicroSeedAttemptKind(undefined), "primary");
  assert.equal(cadenceMicroSeedAttemptKind("primary"), "primary");
  assert.equal(cadenceMicroSeedAttemptKind("fallback"), "fallback");
  assert.equal(cadenceMicroSeedAttemptKind("third"), null);
  assert.equal(
    cadenceMicroSeedProviderCeilingMicroUsd("fallback"),
    CADENCE_MICRO_SEED_FALLBACK_PROVIDER_CEILING_MICRO_USD,
  );
  assert.equal(
    cadenceMicroSeedProviderPurpose("fallback"),
    "cadence_micro_seed_fallback",
  );
  assert.equal(
    cadenceMicroSeedProviderTrigger("fallback"),
    `cadence_micro_seed_fallback_v${CADENCE_MICRO_SEED_VERSION}`,
  );

  const createdAt = Date.UTC(2026, 7, 23, 15, 0, 0);
  const attemptedAt = createdAt + 1_000;
  const providerCompletedAt = attemptedAt + 2_000;
  const completedAt = providerCompletedAt + 1_000;
  const receipt = {
    attemptKind: undefined,
    hasParent: false,
    status: "missed",
    policyVersion: 1,
    expectedPolicyVersion: 1,
    rolloutEpoch: 4,
    expectedRolloutEpoch: 4,
    reservationDay: "2026-08-23",
    expectedReservationDay: "2026-08-23",
    createdAt,
    now: completedAt + 1_000,
    seed: "lead scoring software",
    expectedSeed: "Lead Scoring Software",
    locationCode: 2840,
    expectedLocationCode: 2840,
    languageCode: "en",
    expectedLanguageCode: "EN",
    providerEndpoint: CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT,
    providerResultLimit: 100,
    includeSerpInfo: false,
    includeClickstreamData: false,
    providerCostCeilingMicroUsd: 100_000,
    providerCostReservedMicroUsd: 100_000,
    providerCallAttempted: true,
    providerCallCompleted: true,
    providerAttemptedAt: attemptedAt,
    providerCompletedAt,
    completedAt,
    providerRequestTag: "cadence-micro-seed-v1-job-placeholder",
    expectedProviderRequestTag: "cadence-micro-seed-v1-job-placeholder",
    providerTaskCostUsd: 0.012,
    candidateReceiptCount: 0,
    candidateAudit: {
      received: 0,
      accepted: 0,
      invalidMetric: 0,
      intentUnavailable: 0,
      difficulty: 0,
      brand: 0,
      businessFit: 0,
      duplicate: 0,
      overlap: 0,
    },
    errorCode: "no_strict_candidate",
    workerToken: undefined,
    leaseExpiresAt: undefined,
    hasSelectedOrTopicReceipt: false,
    hasEvidenceOrCadenceReceipt: false,
    finalizeAttempts: 0,
    cadenceScheduleAttempts: 0,
  } satisfies Parameters<typeof cadenceMicroSeedTerminalMissReceiptValid>[0];
  assert.equal(cadenceMicroSeedTerminalMissReceiptValid(receipt), true);

  const strictlyRejected = {
    ...receipt,
    candidateReceiptCount: 4,
    candidateAudit: {
      ...receipt.candidateAudit,
      received: 4,
      difficulty: 4,
    },
  };
  assert.equal(
    cadenceMicroSeedTerminalMissReceiptValid(strictlyRejected),
    true,
  );
  assert.equal(cadenceMicroSeedTerminalMissReceiptValid({
    ...strictlyRejected,
    expectedReservationDay: "2026-08-24",
    now: Date.UTC(2026, 7, 24, 0, 0, 30),
  }), true);
  assert.equal(cadenceMicroSeedTerminalMissReceiptValid({
    ...strictlyRejected,
    expectedReservationDay: "2026-08-24",
    now: createdAt + CADENCE_MICRO_SEED_MAX_FALLBACK_PARENT_AGE_MS + 1,
  }), false);
  for (const invalid of [
    { candidateReceiptCount: 3 },
    { candidateAudit: { ...strictlyRejected.candidateAudit, accepted: 1 } },
    { candidateAudit: { ...strictlyRejected.candidateAudit, difficulty: 3 } },
    { candidateAudit: { ...strictlyRejected.candidateAudit, overlap: -1 } },
    { candidateAudit: { ...strictlyRejected.candidateAudit, brand: 0.5 } },
  ]) {
    assert.equal(cadenceMicroSeedTerminalMissReceiptValid({
      ...strictlyRejected,
      ...invalid,
    }), false);
  }
  for (const invalid of [
    { attemptKind: "fallback" },
    { hasParent: true },
    { status: "provider_response_unverified" },
    { rolloutEpoch: 5 },
    { reservationDay: "2026-08-22" },
    { locationCode: 2826 },
    { languageCode: "de" },
    { providerCallCompleted: false },
    { providerTaskCostUsd: 0.024_01 },
    { candidateReceiptCount: 1 },
    { candidateAudit: { ...receipt.candidateAudit, received: 1 } },
    { hasSelectedOrTopicReceipt: true },
    { hasEvidenceOrCadenceReceipt: true },
    { leaseExpiresAt: completedAt + 10_000 },
    { errorCode: "no_strict_candidate_after_rejections" },
    { completedAt: Date.UTC(2026, 7, 24, 0, 0, 0) },
  ]) {
    assert.equal(cadenceMicroSeedTerminalMissReceiptValid({
      ...receipt,
      ...invalid,
    }), false);
  }
});

test("a terminal primary accounts for provider rows rejected before persistence", () => {
  const timestamp = Date.UTC(2026, 8, 3, 14, 0, 0);
  assert.equal(cadenceMicroSeedTerminalMissReceiptValid({
    attemptKind: "primary",
    hasParent: false,
    status: "missed",
    policyVersion: CADENCE_MICRO_SEED_VERSION,
    expectedPolicyVersion: CADENCE_MICRO_SEED_VERSION,
    rolloutEpoch: 5,
    expectedRolloutEpoch: 5,
    reservationDay: "2026-09-03",
    expectedReservationDay: "2026-09-03",
    createdAt: timestamp,
    now: timestamp + 3_000,
    seed: "content refresh automation",
    expectedSeed: "content refresh automation",
    locationCode: 2840,
    expectedLocationCode: 2840,
    languageCode: "en",
    expectedLanguageCode: "en",
    providerEndpoint: CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT,
    providerResultLimit: CADENCE_MICRO_SEED_RESULT_LIMIT,
    includeSerpInfo: false,
    includeClickstreamData: false,
    providerCostCeilingMicroUsd:
      CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD,
    providerCallAttempted: true,
    providerCallCompleted: true,
    providerAttemptedAt: timestamp + 500,
    providerCompletedAt: timestamp + 1_500,
    completedAt: timestamp + 2_000,
    providerRequestTag:
      `cadence-micro-seed-v${CADENCE_MICRO_SEED_VERSION}-job`,
    expectedProviderRequestTag:
      `cadence-micro-seed-v${CADENCE_MICRO_SEED_VERSION}-job`,
    providerTaskCostUsd: 0.024,
    candidateReceiptCount: 59,
    candidateAudit: {
      received: 100,
      accepted: 0,
      invalidMetric: 41,
      intentUnavailable: 0,
      difficulty: 27,
      brand: 0,
      businessFit: 32,
      duplicate: 0,
      overlap: 0,
    },
    errorCode: "no_strict_candidate",
    workerToken: undefined,
    leaseExpiresAt: undefined,
    hasSelectedOrTopicReceipt: false,
    hasEvidenceOrCadenceReceipt: false,
    finalizeAttempts: 0,
    cadenceScheduleAttempts: 0,
  }), true);
});

test("cadence rescue binds a saturated terminal demand receipt without disabling daily recovery", () => {
  assert.match(model, /terminalNoMetricDemandReceiptFingerprint/);
  assert.match(model, /by_site_origin_status/);
  assert.match(demandBackfill, /candidateArtifactEligible/);
  assert.match(model, /terminalNoMetricDemandReceiptFingerprint/);
  assert.match(model, /cadenceMicroSeedRecoveryBlockReason\([\s\S]*Boolean\(terminalDemandNoMetricFingerprint\)/);
  assert.doesNotMatch(model, /expected_click_demand_jobs[\s\S]{0,300}(patch|delete)\(/);
});

test("cadence rescue remains eligible until the shared launch buffer minimum is met", () => {
  assert.match(
    model,
    /sealedBuffer\.length >=[\s\S]{0,100}approvedBufferPolicy\(site\.cadencePerWeek \?\? 4\)\.minimum[\s\S]*buffer_minimum_met/,
  );
  assert.doesNotMatch(model, /sealedBuffer\.length > 0/);
  assert.match(runbook, /sealed buffer below the cadence-derived launch minimum/);
  assert.match(crons, /Below-minimum-buffer rescue is tenant-generic/);
});

test("candidate selection fails closed on metrics, brands, fit, exact reuse, and overlap", () => {
  assert.equal(cadenceMicroSeedCandidateMatchesAnchor(
    "lead scoring and qualification tool",
    "automated lead qualification software",
  ), true);
  assert.equal(cadenceMicroSeedCandidateMatchesAnchor(
    "lead scoring and qualification tool",
    "tool qualification",
  ), false);
  assert.equal(cadenceMicroSeedCandidateMatchesAnchor(
    "seo ranking monitoring",
    "seo rank tracker",
  ), true);
  const selected = selectCadenceMicroSeedCandidate({
    metrics: [
      metric("predictive lead scoring platform"),
      metric("high difficulty lead scoring", { difficulty: 80 }),
      metric("hubspot lead scoring"),
      metric("payroll workflow software"),
      metric("unknown intent lead scoring", { intent: "unknown" }),
      metric("zero demand lead scoring", { searchVolume: 0 }),
      metric("already used lead scoring"),
    ],
    seed: "lead scoring software",
    maximumDifficulty: 20,
    existingExactKeywords: new Set(["already used lead scoring"]),
    coveredTopics: [{ primaryKeyword: "email deliverability monitoring" }],
    siteName: "Example Product",
    competitors: ["Competitor Placeholder"],
    businessFitEligible: (candidate) => !candidate.keyword.includes("payroll"),
  });
  assert.equal(selected.selected?.keyword, "predictive lead scoring platform");
  assert.equal(selected.accepted, 1);
  assert.equal(selected.rejected.invalidMetric, 1);
  assert.equal(selected.rejected.intentUnavailable, 1);
  assert.equal(selected.rejected.difficulty, 1);
  assert.equal(selected.rejected.brand, 1);
  assert.equal(selected.rejected.businessFit, 1);
  assert.equal(selected.rejected.duplicate, 1);

  const overlap = selectCadenceMicroSeedCandidate({
    metrics: [metric("b2b lead scoring software")],
    seed: "lead scoring software",
    maximumDifficulty: 20,
    existingExactKeywords: new Set(),
    coveredTopics: [{ primaryKeyword: "lead scoring software" }],
    businessFitEligible: () => true,
  });
  assert.equal(overlap.selected, null);
  assert.equal(overlap.rejected.overlap, 1);
});

test("candidate selection preserves a bounded score-ordered SERP shortlist", () => {
  const selected = selectCadenceMicroSeedCandidate({
    metrics: [
      metric("ai sales agent for websites", { searchVolume: 70, difficulty: 9 }),
      metric("website sales agent automation", { searchVolume: 90, difficulty: 7 }),
      metric("automated website sales agent", { searchVolume: 50, difficulty: 5 }),
      metric("sales agent website automation", { searchVolume: 40, difficulty: 12 }),
    ],
    seed: "ai sales agent for websites",
    maximumDifficulty: 20,
    existingExactKeywords: new Set(),
    coveredTopics: [],
    businessFitEligible: () => true,
  });
  assert.equal(selected.accepted, 4);
  assert.equal(
    selected.acceptedCandidates.length,
    CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES,
  );
  assert.equal(selected.selected, selected.acceptedCandidates[0]);
  assert.deepEqual(
    selected.acceptedCandidates.map((candidate) => candidate.keyword),
    [
      "website sales agent automation",
      "automated website sales agent",
      "ai sales agent for websites",
    ],
  );
});

test("cadence discovery uses the bounded pre-SERP reach ceiling", () => {
  assert.equal(cadenceMicroSeedPreSerpDifficultyCeiling(0), 32);
  assert.equal(cadenceMicroSeedPreSerpDifficultyCeiling(4), 32);
  assert.equal(cadenceMicroSeedPreSerpDifficultyCeiling(40), 64);
  assert.match(model, /maximumDifficulty:\s*cadenceMicroSeedPreSerpDifficultyCeiling/);
  assert.match(
    model,
    /Expected-click evidence remains the strict generation boundary/,
  );
});

test("materialization treats terminal content misses as upstream topic feedback", () => {
  assert.match(model, /terminalContentFeasibility/);
  assert.match(model, /const failedContentCoverage = topics/);
  assert.match(
    model,
    /coveredTopics:\s*\[\s*\.\.\.reservedCoverage,\s*\.\.\.activeInventoryCoverage,\s*\.\.\.failedContentCoverage,/,
  );
});

test("receipt envelope is exactly one bounded Labs task", () => {
  assert.equal(CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD, 100_000);
  assert.equal(CADENCE_MICRO_SEED_PROVIDER_TIMEOUT_MS, 60_000);
  assert.equal(CADENCE_MICRO_SEED_RESULT_LIMIT, 100);
  assert.equal(
    CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT,
    "dataforseo_labs/google/keyword_ideas/live",
  );
  assert.equal(cadenceMicroSeedProviderReceiptValid({
    endpoint: CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT,
    requestedSeed: "Lead Scoring Software",
    returnedSeed: "lead scoring software",
    resultLimit: 100,
    providerTaskCostUsd: 0.024,
    candidateCount: 100,
  }), true);
  assert.equal(cadenceMicroSeedProviderReceiptValid({
    endpoint: CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT,
    requestedSeed: "lead scoring software",
    returnedSeed: "lead scoring platform",
    resultLimit: 100,
    providerTaskCostUsd: 0.024,
    candidateCount: 1,
  }), false);
});

test("the terminal plan, recovery chain, and bounded policy upgrades fit exactly", () => {
  assert.equal(PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD, 9_600_000);
  assert.deepEqual(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: 6_000_000,
    accountReservedThisMonthMicroUsd: 6_000_000,
    requestedMicroUsd: 3_600_000,
    monthlyCeilingMicroUsd: 10_000_000,
  }), { allowed: true });
  assert.equal(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: 6_000_000,
    accountReservedThisMonthMicroUsd: 6_000_000,
    requestedMicroUsd: 3_600_001,
    monthlyCeilingMicroUsd: 10_000_000,
  }).allowed, false);
});

test("fallback, demand, and evidence fit the exact remaining account and fleet ledgers", () => {
  assert.equal(CADENCE_MICRO_SEED_FALLBACK_PROVIDER_CEILING_MICRO_USD, 50_000);
  assert.deepEqual(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: 6_100_000,
    accountReservedThisMonthMicroUsd: 6_100_000,
    requestedMicroUsd: 3_500_000,
    monthlyCeilingMicroUsd: 10_000_000,
  }), { allowed: true });
  assert.equal(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: 6_100_000,
    accountReservedThisMonthMicroUsd: 6_100_000,
    requestedMicroUsd: 3_500_001,
    monthlyCeilingMicroUsd: 10_000_000,
  }).allowed, false);
  assert.deepEqual(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: 6_150_000,
    accountReservedThisMonthMicroUsd: 6_150_000,
    requestedMicroUsd: 3_450_000,
    monthlyCeilingMicroUsd: 10_000_000,
  }), { allowed: true });
  assert.equal(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: 6_150_000,
    accountReservedThisMonthMicroUsd: 6_150_000,
    requestedMicroUsd: 3_450_001,
    monthlyCeilingMicroUsd: 10_000_000,
  }).allowed, false);
  assert.deepEqual(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: 0,
    accountReservedThisMonthMicroUsd: 2_350_000,
    requestedMicroUsd: 150_000,
    monthlyCeilingMicroUsd: 2_500_000,
  }), { allowed: true });
  assert.equal(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: 0,
    accountReservedThisMonthMicroUsd: 2_350_000,
    requestedMicroUsd: 150_001,
    monthlyCeilingMicroUsd: 2_500_000,
  }).allowed, false);

  assert.equal(SHARED_PROVIDER_DAILY_CEILING_MICRO_USD, 9_850_000);
  assert.deepEqual(evaluateSharedProviderCapacity({
    fleetReservedTodayMicroUsd: 9_600_000,
    fleetReservedThisMonthMicroUsd: 9_600_000,
    requestedMicroUsd: 250_000,
  }), { allowed: true });
  assert.equal(evaluateSharedProviderCapacity({
    fleetReservedTodayMicroUsd: 9_600_000,
    fleetReservedThisMonthMicroUsd: 9_600_000,
    requestedMicroUsd: 250_001,
  }).allowed, false);

  assert.match(
    model,
    /evidenceHeadroomMicroUsd \* CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES/,
  );
  assert.match(
    action,
    /EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD \*\s*CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES/,
  );
  assert.deepEqual(evaluateSharedProviderCapacity({
    fleetReservedTodayMicroUsd: 0,
    fleetReservedThisMonthMicroUsd:
      SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD - 150_000,
    requestedMicroUsd: 150_000,
  }), { allowed: true });
  assert.equal(evaluateSharedProviderCapacity({
    fleetReservedTodayMicroUsd: 0,
    fleetReservedThisMonthMicroUsd:
      SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD - 150_000,
    requestedMicroUsd: 150_001,
  }).allowed, false);
});

test("a terminal underfill continuation proves execution two without granting three", () => {
  const jobCreatedAt = Date.UTC(2026, 7, 23, 8, 0, 0);
  const receipt = {
    status: "failed",
    workerAttempts: 1,
    jobCreatedAt,
    reservationDay: "2026-08-23",
    marker: {
      version: 1,
      firstExecutionCount: 1,
      remainingTopicCapacity: 9,
      queuedAt: jobCreatedAt + 60_000,
    },
    result: {
      count: 1,
      continuationStatus: "queued",
      continuationWorkerExecution: 2,
      remainingTopicCapacity: 9,
    },
  };
  // Deterministic execution-two failure preserves the pre-consumed ordinal.
  assert.equal(cadenceMicroSeedSourcePlanExecutionExhausted(receipt), true);
  // Retryable execution-two settlement increments once, then is terminal.
  assert.equal(cadenceMicroSeedSourcePlanExecutionExhausted({
    ...receipt,
    workerAttempts: 2,
  }), true);
  for (const invalid of [
    { workerAttempts: 0 },
    { workerAttempts: 3 },
    { status: "pending" },
    { nextAttemptAt: jobCreatedAt + 120_000 },
    { workerToken: "live-worker" },
    { reservationDay: "2026-08-24" },
    { result: { ...receipt.result, continuationWorkerExecution: 3 } },
    { result: { ...receipt.result, continuationStatus: "completed" } },
  ]) {
    assert.equal(cadenceMicroSeedSourcePlanExecutionExhausted({
      ...receipt,
      ...invalid,
    }), false);
  }
  assert.match(
    model,
    /isUnderfilledPlanContinuationPayload[\s\S]*cadenceMicroSeedSourcePlanExecutionExhausted[\s\S]*providerBudget\.workerExecution === 1/,
  );
});

test("an exact terminal source plan survives UTC rollover only within the bounded cadence window", () => {
  const createdAt = Date.UTC(2026, 7, 29, 23, 59, 0);
  assert.equal(cadenceMicroSeedSourcePlanFresh({
    jobCreatedAt: createdAt,
    reservationDay: "2026-08-29",
    timestamp: Date.UTC(2026, 8, 1, 13, 45, 0),
  }), true);
  assert.equal(cadenceMicroSeedSourcePlanFresh({
    jobCreatedAt: createdAt,
    reservationDay: "2026-08-29",
    timestamp: createdAt + CADENCE_MICRO_SEED_MAX_SOURCE_PLAN_AGE_MS + 1,
  }), false);
  assert.equal(cadenceMicroSeedSourcePlanFresh({
    jobCreatedAt: createdAt,
    reservationDay: "2026-08-30",
    timestamp: createdAt + 1,
  }), false);
  assert.equal(cadenceMicroSeedSourcePlanFresh({
    jobCreatedAt: createdAt,
    reservationDay: "2026-08-29",
    timestamp: createdAt - 1,
  }), false);
  assert.match(
    model,
    /createdAt[\s\S]*CADENCE_MICRO_SEED_MAX_SOURCE_PLAN_AGE_MS/,
  );
  assert.doesNotMatch(
    model,
    /providerCostReservationDay === utcDay\(timestamp\)/,
  );
});

test("an exact retained checkpoint underfill can seed recovery without replaying its plan", () => {
  assert.equal(cadenceMicroSeedCheckpointSourcePlanExhausted({
    status: "done",
    checkpointState: "single",
    providerReservationState: "retained_no_replay",
    persistedTopicCountState: "recorded",
    requiredVerifiedYield: 7,
    usableTopicCount: 1,
  }), true);
  assert.equal(cadenceMicroSeedCheckpointSourcePlanExhausted({
    status: "done",
    checkpointState: "single",
    providerReservationState: "retained_no_replay",
    persistedTopicCountState: "recorded",
    requiredVerifiedYield: 7,
    usableTopicCount: 7,
  }), false);
  assert.equal(cadenceMicroSeedCheckpointSourcePlanExhaustionKind({
    status: "failed",
    checkpointState: "single",
    checkpointStatus: "empty",
    providerReservationState: "retained_no_replay",
    persistedTopicCountState: "missing",
    requiredVerifiedYield: 10,
    usableTopicCount: 0,
    cadenceFailureCategory: "semantic_zero_yield",
    cadenceFailureCode: "strict_zero_yield",
    cadenceFailureTerminal: true,
  }), "strict_zero_yield");
  assert.equal(cadenceMicroSeedCheckpointSourcePlanExhaustionKind({
    status: "failed",
    checkpointState: "single",
    checkpointStatus: "terminal_blocked",
    providerReservationState: "retained_no_replay",
    persistedTopicCountState: "missing",
    requiredVerifiedYield: 7,
    usableTopicCount: 0,
    cadenceFailureCategory: "semantic_zero_yield",
    cadenceFailureCode: "strict_zero_yield",
    cadenceFailureTerminal: true,
  }), "strict_zero_yield");
  assert.equal(cadenceMicroSeedCheckpointSourcePlanExhaustionKind({
    status: "failed",
    checkpointState: "single",
    checkpointStatus: "empty",
    providerReservationState: "retained_no_replay",
    persistedTopicCountState: "missing",
    requiredVerifiedYield: 10,
    usableTopicCount: 0,
    cadenceFailureCategory: "transient_provider",
    cadenceFailureCode: "transient_provider_failure",
    cadenceFailureTerminal: true,
  }), null);
  assert.equal(cadenceMicroSeedCheckpointSourcePlanExhausted({
    status: "done",
    checkpointState: "multiple_or_invalid",
    providerReservationState: "retained_no_replay",
    persistedTopicCountState: "recorded",
    requiredVerifiedYield: 7,
    usableTopicCount: 1,
  }), false);
  assert.match(
    model,
    /operatorTerminalPlanReceipt[\s\S]*checkpointExecutionExhausted/,
  );
  assert.match(
    model,
    /sourcePlanFingerprint[\s\S]*checkpoints:/,
  );
});

test("micro admission and scheduler share exact quality-recovery priority", () => {
  const candidateWindowStart = 1_000;
  const ordinary = {
    createdAt: 2_000,
    status: "review",
    publicationGateStatus: "blocked",
    qualityRevisionCount: 0,
    publicationGateIssues: ["A correctable prose issue."],
  };
  assert.equal(hasRecoverableQualityWork([ordinary], candidateWindowStart), true);

  const terminalFit = {
    ...ordinary,
    publicationGateIssues: ["Article failed the current tenant product-fit gate."],
  };
  assert.equal(
    hasRecoverableQualityWork([terminalFit], candidateWindowStart),
    false,
  );

  const terminalMechanical = {
    ...terminalFit,
    createdAt: candidateWindowStart - 1,
    qualityRevisionCount: 2,
    publicationGateIssues: [
      "Article failed the current tenant product-fit gate.",
      "Meta description must end as a complete sentence.",
    ],
  };
  assert.equal(
    hasRecoverableQualityWork([terminalMechanical], candidateWindowStart),
    false,
  );

  const terminalSibling = {
    ...terminalFit,
    _id: "terminal-sibling",
    topicId: "bad-topic",
  };
  const staleSibling = {
    ...ordinary,
    _id: "stale-sibling",
    topicId: "bad-topic",
  };
  assert.equal(
    hasRecoverableQualityWork(
      [staleSibling, terminalSibling],
      candidateWindowStart,
    ),
    false,
  );
  assert.deepEqual(
    recoverableQualityArticlesSince(
      [staleSibling, terminalSibling],
      candidateWindowStart,
    ),
    [],
  );

  const oldOrdinary = { ...ordinary, createdAt: candidateWindowStart - 1 };
  assert.equal(
    hasRecoverableQualityWork([oldOrdinary], candidateWindowStart),
    false,
  );

  const oldMechanical = {
    ...oldOrdinary,
    qualityRevisionCount: 2,
    publicationGateIssues: [
      "Meta description must end as a complete sentence.",
    ],
  };
  assert.equal(
    hasRecoverableQualityWork([oldMechanical], candidateWindowStart),
    true,
  );
  assert.deepEqual(
    deterministicMechanicalRepairArticles([oldMechanical, terminalMechanical]),
    [oldMechanical],
  );
  const alreadyAudited = {
    ...ordinary,
    auditedContentHash: "current-audit-hash",
    publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
  };
  assert.equal(
    hasRecoverableQualityWork([alreadyAudited], candidateWindowStart),
    false,
  );
  const attemptedMechanical = {
    ...oldMechanical,
    deterministicQualityRepairAttemptVersion:
      DETERMINISTIC_QUALITY_REPAIR_VERSION,
  };
  assert.deepEqual(
    deterministicMechanicalRepairArticles([attemptedMechanical]),
    [],
  );
  assert.match(model, /hasRecoverableQualityWork\([\s\S]*candidateWindowStart/);
  assert.equal(CADENCE_QUALITY_RECOVERY_READ_LIMIT, 25);
  assert.match(
    model,
    /filter\(\(article\) => article\.status === "review"\)[\s\S]*slice\(0, CADENCE_QUALITY_RECOVERY_READ_LIMIT\)[\s\S]*candidateWindowStart/,
  );
  assert.match(
    readFileSync("convex/articles.ts", "utf8"),
    /takeCurrentSummariesByStatus\([\s\S]*"review"[\s\S]*CADENCE_QUALITY_RECOVERY_READ_LIMIT/,
  );
  assert.match(
    scheduler,
    /qualityRecoveryAvailable = hasRecoverableQualityWork\([\s\S]*candidateWindowStart/,
  );
  assert.match(
    scheduler,
    /const recoverableCandidates = recoverableQualityArticlesSince\([\s\S]*candidateWindowStart/,
  );
  assert.match(scheduler, /for \(const recoverable of recoverableCandidates\)/);
  assert.match(
    scheduler,
    /const mechanicallyRecoverableCandidates =[\s\S]*deterministicMechanicalRepairArticles\(/,
  );
  assert.match(
    scheduler,
    /for \(const mechanicallyRecoverable of mechanicallyRecoverableCandidates\)/,
  );
  assert.match(
    jobs,
    /deterministicQualityRepairAttemptVersion:[\s\S]*DETERMINISTIC_QUALITY_REPAIR_VERSION/,
  );
  assert.match(schema, /deterministicQualityRepairAttemptVersion/);
});

test("provider helper binds request, locale, intent, measured KD, and both cost receipts", async () => {
  const fixture = providerFixture();
  let capturedEndpoint = "";
  let capturedBody: unknown;
  const receipt = await discoverCadenceMicroSeedFromDataForSEO(
    fixture.seed,
    2840,
    "en",
    {
      limit: 100,
      requestTag: fixture.tag,
      request: async (endpoint, body) => {
        capturedEndpoint = endpoint;
        capturedBody = body;
        return fixture.data;
      },
    },
  );
  assert.equal(capturedEndpoint, CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT);
  assert.match(
    provider,
    /dataForSEORequest\([\s\S]*CADENCE_MICRO_SEED_PROVIDER_TIMEOUT_MS/,
  );
  assert.deepEqual(capturedBody, [{
    keywords: [fixture.seed],
    location_code: 2840,
    language_code: "en",
    closely_variants: true,
    include_serp_info: false,
    include_clickstream_data: false,
    tag: fixture.tag,
    filters: ["keyword_info.search_volume", ">=", 10],
    order_by: [
      "relevance,desc",
      "keyword_info.search_volume,desc",
      "keyword_properties.keyword_difficulty,asc",
    ],
    limit: 100,
  }]);
  assert.equal(receipt.providerTaskCostUsd, 0.024);
  assert.equal(receipt.providerRowsReceived, 1);
  assert.equal(receipt.providerRowsRejected, 0);
  assert.deepEqual(receipt.candidates, [metric(
    "predictive lead scoring platform",
  )]);
});

test("receipt drift fails closed while incomplete provider rows are rejected individually", async () => {
  const cases: Array<(data: ReturnType<typeof providerFixture>["data"]) => void> = [
    (data) => { data.tasks[0].cost = null as never; },
    (data) => { data.cost = 0.02; },
    (data) => { data.tasks_count = 2; },
    (data) => { data.tasks_error = 1; },
    (data) => { data.tasks[0].data.se_type = "bing"; },
    (data) => { data.tasks[0].data.closely_variants = false; },
    (data) => { data.tasks[0].result[0].location_code = 2826; },
  ];
  for (const mutate of cases) {
    const fixture = providerFixture();
    mutate(fixture.data);
    await assert.rejects(() => discoverCadenceMicroSeedFromDataForSEO(
      fixture.seed,
      2840,
      "en",
      {
        limit: 100,
        requestTag: fixture.tag,
        request: async () => fixture.data,
      },
    ));
  }
  const incomplete = providerFixture();
  incomplete.data.tasks[0].result[0].items[0].keyword_properties.keyword_difficulty =
    null as never;
  const skipped = await discoverCadenceMicroSeedFromDataForSEO(
    incomplete.seed,
    2840,
    "en",
    {
      limit: 100,
      requestTag: incomplete.tag,
      request: async () => incomplete.data,
    },
  );
  assert.equal(skipped.providerRowsReceived, 1);
  assert.equal(skipped.providerRowsRejected, 1);
  assert.deepEqual(skipped.candidates, []);
  const fixture = providerFixture();
  await assert.rejects(() => discoverCadenceMicroSeedFromDataForSEO(
    fixture.seed,
    2840,
    "en",
    {
      limit: Number.NaN,
      requestTag: fixture.tag,
      request: async () => fixture.data,
    },
  ));
});

test("lifecycle is inspect-first, no-replay, atomic at handoffs, and fleet-generic", () => {
  const worker = action.slice(
    action.indexOf("export const processCadenceMicroSeed"),
    action.indexOf("export const resumeCadenceEvidenceHandoff"),
  );
  assert.ok(action.indexOf("mode: v.union") < action.indexOf("reserveAndQueue"));
  assert.ok(worker.indexOf("api.beginProviderAttempt") <
    worker.indexOf("discoverCadenceMicroSeedFromDataForSEO"));
  assert.match(model, /providerCallAttempted: true[\s\S]*providerRequestTag/);
  assert.match(
    model,
    /validPrimaryFallbackReceipt[\s\S]*selectCadenceMicroSeedFallbackAnchor/,
  );
  assert.match(
    model,
    /reservation\.purpose === "cadence_micro_seed"[\s\S]*reservation\.createdAt === job\.createdAt[\s\S]*reservation\.releasedAt === undefined/,
  );
  assert.match(
    model,
    /parentChildren\.length > 0[\s\S]*attemptKind = "fallback"/,
  );
  assert.match(
    model,
    /cadenceMicroSeedProviderPurpose\(inspected\.attemptKind\)[\s\S]*reservedMicroUsd: inspected\.providerCostCeilingMicroUsd/,
  );
  assert.match(
    model,
    /currentJobId \? 0 : providerCostCeilingMicroUsd[\s\S]*evidenceHeadroomMicroUsd/,
  );
  assert.match(
    action,
    /inspected\.providerCostCeilingMicroUsd \+[\s\S]*EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD/,
  );
  assert.match(model, /recordEvidenceQueued[\s\S]*finalizeCadenceMicroSeed/);
  assert.match(model, /plannedEvidenceFingerprint/);
  assert.match(
    model,
    /cadenceMicroSeedRecoveryBlockReason\([\s\S]*demandReadiness,[\s\S]*evidenceReadiness/,
  );
  assert.match(
    model,
    /expectedClickDemandFleetReadiness[\s\S]*expectedClickEvidenceFleetReadiness[\s\S]*recoverySnapshot/,
  );
  assert.match(model, /findExactEvidenceJobInternal/);
  assert.match(action, /apply action may have committed[\s\S]*reconcileExactEvidenceJob/);
  assert.match(model, /reconcileWatchdog[\s\S]*provider_attempt_ambiguous/);
  assert.match(model, /cadence_scheduling[\s\S]*scheduleCadenceForMicroSeed/);
  assert.match(model, /recordCadenceScheduleResult[\s\S]*exactTopicScheduled/);
  assert.match(crons, /cadence-micro-seed-fleet/);
  assert.match(action, /dispatchCadenceMicroSeedFleet/);
  assert.match(action, /runCadenceMicroSeedFleetSite/);
  assert.match(schema, /cadence_micro_seed_jobs: defineTable/);
  assert.match(schema, /by_site_source_policy_created/);
  assert.match(model, /withIndex\("by_site_source_policy_created"/);
  assert.doesNotMatch(model, /micro_seed_source_history_read_exhausted/);
  assert.match(schema, /parentMicroSeedJobId:[\s\S]*by_site_parent/);
  assert.match(schema, /cadence_micro_seed_fallback/);
  assert.match(sites, /"cadence_micro_seed_jobs"/);
  assert.match(sites, /case "cadence_micro_seed_jobs"/);
  assert.doesNotMatch(
    `${model}\n${action}\n${provider}\n${runbook}`,
    /leadpilot|@[a-z0-9.-]+\.[a-z]{2,}/i,
  );
});

test("the legacy anchor migration is bounded, publication-safe, and runs before new admission", () => {
  assert.equal(CADENCE_MICRO_SEED_ANCHOR_AUDIT_VERSION, 1);
  assert.match(schema, /cadenceMicroSeedAnchorAuditVersion: v\.optional\(v\.number\(\)\)/);
  assert.match(schema, /cadenceMicroSeedAnchorEligible: v\.optional\(v\.boolean\(\)\)/);
  assert.match(model, /export const listLegacyAnchorMismatchRepairsInternal/);
  assert.match(model, /topicIds\.length >= 5/);
  assert.match(model, /cadenceMicroSeedLegacyAnchorReceiptEligible/);
  assert.match(model, /cadenceMicroSeedAnchorEligible: true/);
  const fleetSite = action.slice(
    action.indexOf("export const runCadenceMicroSeedFleetSite"),
    action.indexOf("export const finalizeCadenceMicroSeed"),
  );
  assert.ok(
    fleetSite.indexOf("listLegacyAnchorMismatchRepairsInternal") <
      fleetSite.indexOf("mode: \"inspect\""),
    "legacy intent locks must settle before fresh cadence inspection",
  );
  assert.match(action, /quarantineLegacyCadenceAnchorMismatch/);
  assert.match(articles, /export const quarantineLegacyCadenceAnchorMismatch/);
  assert.match(articles, /article\.status === "published"/);
  assert.match(articles, /reason: "work_in_progress"/);
  assert.match(articles, /assertNotPublishing\(article\)/);
  assert.match(articles, /cadenceMicroSeedAnchorEligible: false/);
  assert.match(articles, /publicationAuditVersion: undefined/);
  assert.match(topics, /topic\.cadenceMicroSeedAnchorEligible === false/);
});

test("semantic evidence misses advance through immutable candidates without lowering quality", () => {
  assert.match(schema, /candidateShortlist:\s*v\.optional/);
  assert.match(schema, /priorCandidateAttempts:\s*v\.optional/);
  assert.match(model, /selection\.acceptedCandidates/);
  assert.match(model, /candidateAttemptCount:\s*1/);
  assert.match(model, /args\.outcome === "semantic_failure"[\s\S]*nextCandidate/);
  assert.match(model, /status:\s*"awaiting_evidence"[\s\S]*retryQueued:\s*true/);
  assert.match(action, /!eligible && !finalized\.retryQueued/);
  assert.match(action, /resumeLegacySemanticCandidateInternal/);
  assert.doesNotMatch(model, /expectedClickStatus:\s*"eligible"/);
});
