import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_AUTHORITY_CALL_LIMIT,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_SERP_CALL_LIMIT,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_TOPIC_LIMIT,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
  ExpectedClickBackfillRuntimeError,
  consumeExpectedClickBackfillAuthorityCall,
  consumeExpectedClickBackfillSerpCall,
  createExpectedClickBackfillRuntime,
  expectedClickBackfillRemainingCostMicroUsd,
  hasCurrentExpectedClickDemand,
  hasReusableExpectedClickSerpEvidence,
  needsExpectedClickEvidenceBackfill,
  selectExpectedClickBackfillCandidates,
} from "../convex/lib/expectedClickEvidenceBackfill.ts";
import {
  DATAFORSEO_DEMAND_SOURCE,
  EXPECTED_CLICK_PORTFOLIO_VERSION,
} from "../convex/lib/expectedClickPortfolio.ts";

const model = readFileSync("convex/expectedClickEvidenceBackfill.ts", "utf8");
const action = readFileSync(
  "convex/actions/expectedClickEvidenceBackfill.ts",
  "utf8",
);
const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
const seoData = readFileSync("convex/actions/seoData.ts", "utf8");
const reservation = readFileSync(
  "convex/lib/providerSpendReservation.ts",
  "utf8",
);
const schema = readFileSync("convex/schema.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const runbook = readFileSync(
  "docs/EXPECTED_CLICK_EVIDENCE_BACKFILL_RUNBOOK.md",
  "utf8",
);

function candidate(index: number, overrides: Record<string, unknown> = {}) {
  return {
    topicId: `topic-${index}`,
    articleId: `article-${index}`,
    keyword: `keyword ${index}`,
    searchVolume: index * 100,
    priority: 1,
    gscClicks: 0,
    gscImpressions: 0,
    createdAt: index,
    ...overrides,
  };
}

test("legacy evidence selection is deterministic and hard-capped to ten", () => {
  const selected = selectExpectedClickBackfillCandidates(
    Array.from({ length: 30 }, (_, index) => candidate(index + 1)),
    100,
  );
  assert.equal(EXPECTED_CLICK_EVIDENCE_BACKFILL_TOPIC_LIMIT, 10);
  assert.equal(selected.length, 10);
  assert.deepEqual(
    selected.map((item) => item.topicId),
    Array.from({ length: 10 }, (_, index) => `topic-${30 - index}`),
  );

  const gscOpportunity = candidate(1, {
    topicId: "gsc-opportunity",
    searchVolume: 100,
    gscImpressions: 500,
    gscPosition: 12,
  });
  const unobserved = candidate(2, {
    topicId: "unobserved",
    searchVolume: 100,
  });
  assert.equal(
    selectExpectedClickBackfillCandidates([unobserved, gscOpportunity], 1)[0]
      .topicId,
    "gsc-opportunity",
  );
});

test("only current locale-bound DataForSEO demand can fund a backfill", () => {
  const now = 1_787_270_000_000;
  const evidence = {
    searchVolume: 1_000,
    searchDemandSource: DATAFORSEO_DEMAND_SOURCE,
    searchDemandMeasuredAt: now - 1_000,
    searchDemandLocationCode: 2840,
    searchDemandLanguageCode: "en",
  };
  assert.equal(hasCurrentExpectedClickDemand({
    evidence,
    locationCode: 2840,
    languageCode: "en",
    now,
  }), true);
  assert.equal(hasCurrentExpectedClickDemand({
    evidence,
    locationCode: 2826,
    languageCode: "en",
    now,
  }), false);
  assert.equal(hasCurrentExpectedClickDemand({
    evidence: { ...evidence, searchDemandSource: "estimate" },
    locationCode: 2840,
    languageCode: "en",
    now,
  }), false);
});

test("fresh complete or already backfilled evidence is not repurchased", () => {
  const now = 1_787_270_000_000;
  assert.equal(needsExpectedClickEvidenceBackfill({
    expectedClickStatus: "eligible",
    expectedClickAuditVersion: EXPECTED_CLICK_PORTFOLIO_VERSION,
    expectedClickAuditedAt: now - 1_000,
  }, now), false);
  assert.equal(needsExpectedClickEvidenceBackfill({
    expectedClickStatus: "insufficient_evidence",
    expectedClickAuditVersion: EXPECTED_CLICK_PORTFOLIO_VERSION,
    expectedClickAuditedAt: now - 1_000,
    expectedClickBackfillVersion: EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
  }, now), false);
  assert.equal(needsExpectedClickEvidenceBackfill({
    expectedClickStatus: "insufficient_evidence",
  }, now), true);
});

test("generation reuses only a fresh locale-bound audited SERP", () => {
  const now = 1_787_270_000_000;
  const evidence = {
    expectedClickStatus: "eligible",
    expectedClickAuditVersion: EXPECTED_CLICK_PORTFOLIO_VERSION,
    expectedClickAuditedAt: now - 1_000,
    serpTopUrls: Array.from(
      { length: 5 },
      (_, index) => `https://example-${index}.test/result`,
    ),
    serpObservedAt: now - 2_000,
    serpLocationCode: 2840,
    serpLanguageCode: "en",
  };
  assert.equal(hasReusableExpectedClickSerpEvidence({
    evidence,
    locationCode: 2840,
    languageCode: "EN",
    now,
  }), true);
  assert.equal(hasReusableExpectedClickSerpEvidence({
    evidence: { ...evidence, expectedClickStatus: "insufficient_evidence" },
    locationCode: 2840,
    languageCode: "en",
    now,
  }), false);
  assert.equal(hasReusableExpectedClickSerpEvidence({
    evidence,
    locationCode: 2826,
    languageCode: "en",
    now,
  }), false);
  assert.equal(hasReusableExpectedClickSerpEvidence({
    evidence: { ...evidence, serpTopUrls: ["http://insecure.test"] },
    locationCode: 2840,
    languageCode: "en",
    now,
  }), false);
  const articleHandler = pipeline.slice(
    pipeline.indexOf("async function handleArticle"),
    pipeline.indexOf("async function handleReview"),
  );
  assert.match(articleHandler, /hasReusableExpectedClickSerpEvidence/);
  assert.match(articleHandler, /else \{[\s\S]*analyzeSERP/);
});

test("provider calls and remaining wallet requirement stay inside one small envelope", () => {
  assert.equal(EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION, 2);
  assert.equal(EXPECTED_CLICK_EVIDENCE_BACKFILL_SERP_CALL_LIMIT, 10);
  assert.equal(EXPECTED_CLICK_EVIDENCE_BACKFILL_AUTHORITY_CALL_LIMIT, 1);
  assert.equal(EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD, 100_000);
  assert.ok(expectedClickBackfillRemainingCostMicroUsd({
    selectedTopics: 10,
    serpSnapshots: 0,
    authoritySnapshotComplete: false,
  }) <= EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD);
  assert.ok(expectedClickBackfillRemainingCostMicroUsd({
    selectedTopics: 10,
    serpSnapshots: 8,
    authoritySnapshotComplete: false,
  }) < expectedClickBackfillRemainingCostMicroUsd({
    selectedTopics: 10,
    serpSnapshots: 0,
    authoritySnapshotComplete: false,
  }));

  const runtime = createExpectedClickBackfillRuntime(1_000);
  for (let index = 0; index < 10; index += 1) {
    consumeExpectedClickBackfillSerpCall(runtime, 1_001 + index);
  }
  assert.throws(
    () => consumeExpectedClickBackfillSerpCall(runtime, 1_020),
    (error) =>
      error instanceof ExpectedClickBackfillRuntimeError &&
      error.code === "serp_call_limit",
  );
  consumeExpectedClickBackfillAuthorityCall(runtime, 1_020);
  assert.throws(
    () => consumeExpectedClickBackfillAuthorityCall(runtime, 1_021),
    (error) =>
      error instanceof ExpectedClickBackfillRuntimeError &&
      error.code === "authority_call_limit",
  );
});

test("the operator canary is evidence-only, resumable, and tenant fenced", () => {
  assert.match(action, /export const queueExpectedClickEvidenceBackfill = internalAction/);
  assert.match(action, /export const resumeExpectedClickEvidenceBackfill = internalAction/);
  assert.doesNotMatch(action, /export const .* = action\(/);
  assert.match(action, /assertDataForSeoAccountBalance/);
  assert.match(action, /analyzeSERPFromDataForSEO/);
  assert.match(action, /getDomainAuthorities/);
  assert.doesNotMatch(action, /OpenAI|Anthropic|discoverKeywords|handlePlan|generateArticle/);
  assert.match(seoData, /export async function analyzeSERPFromDataForSEO/);
  const strictStart = seoData.indexOf(
    "export async function analyzeSERPFromDataForSEO",
  );
  const strictEnd = seoData.indexOf("async function analyzeSERPFromAPI", strictStart);
  assert.doesNotMatch(seoData.slice(strictStart, strictEnd), /analyzeSERPFromAI/);

  assert.match(model, /site\.expectedClickSchedulingEnabled === true/);
  assert.match(model, /\["warm", "live"\]/);
  assert.match(model, /site\.deletionStatus/);
  assert.match(model, /job\.rolloutEpoch !== \(site\.autopilotRolloutEpoch \?\? 0\)/);
  assert.match(model, /article\.topicId !== selected\.topicId/);
  assert.match(model, /artifactFingerprint\(article\) !== selected\.artifactHash/);
  assert.match(model, /topic\.updatedAt !== selected\.topicUpdatedAt/);
  assert.match(model, /evaluateTopicBusinessFit/);
  assert.match(model, /row\.nonBrandedClicks/);
  assert.match(model, /row\.nonBrandedImpressions/);
  assert.match(model, /row\.nonBrandedWeightedPosition/);
  assert.match(model, /\(topic\.searchVolume \?\? 0\) <= 0/);
  assert.match(model, /providerCallsAttempted >= EXPECTED_CLICK_EVIDENCE_BACKFILL_TOTAL_CALL_LIMIT/);
});

test("one batch/policy/day reserves the shared provider ledger before its durable job", () => {
  const reservationIndex = model.indexOf("reserveSharedProviderBudget(ctx");
  const insertIndex = model.indexOf(
    'db.insert("expected_click_evidence_jobs"',
  );
  assert.ok(reservationIndex >= 0 && insertIndex > reservationIndex);
  assert.match(model, /withIndex\("by_site_day"/);
  assert.match(model, /purpose: "expected_click_evidence_backfill"/);
  assert.match(reservation, /expected_click_evidence_backfill/);
  assert.match(model, /const existing = todayJobs\[0\]/);
  assert.match(model, /providerCallsAttempted !== 0/);
  assert.match(model, /releaseSharedProviderReservation/);
});

test("schema, deletion and runbook preserve the durable tenant boundary", () => {
  assert.match(schema, /expected_click_evidence_jobs: defineTable/);
  assert.match(schema, /expectedClickBackfillVersion: v\.optional\(v\.number\(\)\)/);
  assert.match(schema, /expectedClickBackfillJobId: v\.optional/);
  assert.match(schema, /\.index\("by_site_day", \["siteId", "reservationDay"\]\)/);
  assert.match(sites, /"expected_click_evidence_jobs"/);
  assert.match(
    sites,
    /query\("expected_click_evidence_jobs"\)[\s\S]*withIndex\("by_site_created"/,
  );
  assert.match(
    runbook,
    /actions\/expectedClickEvidenceBackfill:queueExpectedClickEvidenceBackfill/,
  );
  assert.match(
    runbook,
    /expectedClickEvidenceBackfill:getStatusInternal/,
  );
  assert.match(runbook, /--prod --codegen disable/);
  assert.doesNotMatch(runbook, /reserveAndQueue '\{/);
});
