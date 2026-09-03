import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CALL_LIMIT,
  EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_DEMAND_BACKFILL_TOPIC_LIMIT,
  EXPECTED_CLICK_DEMAND_BACKFILL_VERSION,
  EXPECTED_CLICK_DEMAND_PROVIDER_ENDPOINT,
  ExpectedClickDemandRuntimeError,
  consumeExpectedClickDemandProviderCall,
  createExpectedClickDemandRuntime,
  expectedClickDemandTerminalNoMetricReceiptFingerprint,
  normalizeExactDemandKeyword,
  reconcileExactDemandMetrics,
  selectExpectedClickDemandCandidates,
} from "../convex/lib/expectedClickDemandBackfill.ts";
import { hasCurrentExpectedClickDemand } from
  "../convex/lib/expectedClickEvidenceBackfill.ts";
import { DATAFORSEO_DEMAND_SOURCE } from
  "../convex/lib/expectedClickPortfolio.ts";
import { getExactKeywordDemandFromDataForSEO } from
  "../convex/actions/seoData.ts";

const model = readFileSync("convex/expectedClickDemandBackfill.ts", "utf8");
const action = readFileSync(
  "convex/actions/expectedClickDemandBackfill.ts",
  "utf8",
);
const seoData = readFileSync("convex/actions/seoData.ts", "utf8");
const evidenceModel = readFileSync(
  "convex/expectedClickEvidenceBackfill.ts",
  "utf8",
);
const reservation = readFileSync(
  "convex/lib/providerSpendReservation.ts",
  "utf8",
);
const schema = readFileSync("convex/schema.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const runbook = readFileSync(
  "docs/EXPECTED_CLICK_DEMAND_BACKFILL_RUNBOOK.md",
  "utf8",
);

function candidate(index: number, overrides: Record<string, unknown> = {}) {
  return {
    topicId: `topic-${index}`,
    keyword: `keyword ${index}`,
    legacySearchVolume: index * 100,
    priority: 1,
    gscClicks: 0,
    gscImpressions: 0,
    createdAt: index,
    ...overrides,
  };
}

function terminalNoMetricReceipt() {
  const createdAt = Date.UTC(2026, 8, 1, 13, 15, 0);
  const attemptedAt = createdAt + 1_000;
  const completedAt = attemptedAt + 2_000;
  const selectedTopics = Array.from({ length: 10 }, (_, index) => ({
    topicId: `topic-${index + 1}`,
    keyword: `keyword ${index + 1}`,
  }));
  const keywordAttempts = selectedTopics.map((topic, index) => ({
    ...topic,
    attemptedAt: attemptedAt + index,
  }));
  return {
    jobId: "demand-job",
    siteId: "site-1",
    userId: "user-1",
    status: "completed",
    origin: "autonomous_fleet",
    policyVersion: 1,
    expectedPolicyVersion: 1,
    rolloutEpoch: 5,
    expectedRolloutEpoch: 5,
    reservationDay: "2026-09-01",
    createdAt,
    now: completedAt + 1_000,
    providerEndpoint: EXPECTED_CLICK_DEMAND_PROVIDER_ENDPOINT,
    providerCostCeilingMicroUsd:
      EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    providerSpendReservationId: "reservation-1",
    selectionScope: "all_eligible",
    candidateArtifactEligible: 38,
    selectedTopics,
    keywordAttempts,
    metricReceiptCount: 0,
    metricFailures: keywordAttempts.map((attempt) => ({
      topicId: attempt.topicId,
      keyword: attempt.keyword,
      code: "exact_metric_missing",
      recordedAt: completedAt - 1,
    })),
    providerCallAttempted: true,
    providerCallCompleted: true,
    providerAttemptedAt: attemptedAt,
    providerCallsAttempted: 1,
    providerCallsCompleted: 1,
    persistedTopics: 0,
    missingTopics: 10,
    skippedTopics: 0,
    workerAttempts: 1,
    completedAt,
    reservation: {
      id: "reservation-1",
      siteId: "site-1",
      userId: "user-1",
      purpose: "expected_click_demand_backfill",
      trigger: "expected_click_demand_autonomous_fleet_v1",
      reservedMicroUsd:
        EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
      reservationDay: "2026-09-01",
      createdAt,
    },
  };
}

test("a saturated exact no-metric fleet batch is a fail-closed cadence receipt", () => {
  const receipt = terminalNoMetricReceipt();
  const fingerprint = expectedClickDemandTerminalNoMetricReceiptFingerprint(
    receipt,
  );
  assert.match(fingerprint ?? "", /expected-click-demand-terminal-no-metric-v1/);
  assert.equal(
    expectedClickDemandTerminalNoMetricReceiptFingerprint({
      ...receipt,
      metricReceiptCount: 1,
    }),
    null,
  );
  assert.equal(
    expectedClickDemandTerminalNoMetricReceiptFingerprint({
      ...receipt,
      selectedTopics: receipt.selectedTopics.slice(0, 9),
    }),
    null,
  );
  assert.equal(
    expectedClickDemandTerminalNoMetricReceiptFingerprint({
      ...receipt,
      metricFailures: receipt.metricFailures.map((failure, index) =>
        index === 0 ? { ...failure, code: "provider_error" } : failure
      ),
    }),
    null,
  );
  assert.equal(
    expectedClickDemandTerminalNoMetricReceiptFingerprint({
      ...receipt,
      now: receipt.completedAt + 24 * 60 * 60 * 1000 + 1,
    }),
    null,
  );
  assert.equal(
    expectedClickDemandTerminalNoMetricReceiptFingerprint({
      ...receipt,
      reservation: { ...receipt.reservation, releasedAt: receipt.completedAt },
    }),
    null,
  );
});

test("selection is deterministic, unique by exact keyword, and capped at ten", () => {
  const selected = selectExpectedClickDemandCandidates([
    ...Array.from({ length: 20 }, (_, index) => candidate(index + 1)),
    candidate(21, {
      topicId: "duplicate",
      keyword: "  KEYWORD   20 ",
      legacySearchVolume: 1,
    }),
  ]);
  assert.equal(EXPECTED_CLICK_DEMAND_BACKFILL_VERSION, 2);
  assert.equal(EXPECTED_CLICK_DEMAND_BACKFILL_TOPIC_LIMIT, 10);
  assert.equal(selected.length, 10);
  assert.equal(new Set(selected.map((item) =>
    normalizeExactDemandKeyword(item.keyword)
  )).size, 10);
  assert.equal(selected[0].topicId, "topic-20");

  const exposed = candidate(1, {
    topicId: "gsc-opportunity",
    legacySearchVolume: 100,
    gscImpressions: 500,
    gscPosition: 12,
  });
  const unobserved = candidate(2, {
    topicId: "unobserved",
    legacySearchVolume: 100,
  });
  assert.equal(
    selectExpectedClickDemandCandidates([unobserved, exposed], 1)[0].topicId,
    "gsc-opportunity",
  );
});

test("strict exact demand helper parses official rows without inventing null metrics", async () => {
  const calls: Array<{ endpoint: string; body: unknown[] }> = [];
  const metrics = await getExactKeywordDemandFromDataForSEO(
    [
      "website sales agent",
      "zero demand phrase",
      "null demand phrase",
      "volume only phrase",
    ],
    2826,
    "en",
    {
      request: async (endpoint, body) => {
        calls.push({ endpoint, body });
        return {
          status_code: 20000,
          tasks: [{
            status_code: 20000,
            result: [
              {
                keyword: "website sales agent",
                search_volume: 720,
                cpc: 4.2,
                competition: "HIGH",
                competition_index: 82,
                monthly_searches: [
                  { search_volume: 700 },
                  { search_volume: null },
                  { search_volume: 0 },
                  { search_volume: -1 },
                  { search_volume: 650 },
                ],
              },
              {
                keyword: "zero demand phrase",
                search_volume: 0,
                cpc: 0,
                competition: "LOW",
                competition_index: 0,
                monthly_searches: [],
              },
              {
                keyword: "null demand phrase",
                search_volume: null,
                cpc: null,
                competition: "MEDIUM",
                competition_index: 50,
                monthly_searches: null,
              },
              {
                keyword: "volume only phrase",
                search_volume: 90,
                cpc: null,
                competition: "HIGH",
                competition_index: null,
                monthly_searches: null,
              },
              {
                keyword: "foreign phrase",
                search_volume: 50_000,
                cpc: 20,
                competition: "HIGH",
                competition_index: 100,
                monthly_searches: [{ search_volume: 50_000 }],
              },
            ],
          }],
        };
      },
    },
  );
  const request = calls[0].body[0] as {
    keywords: string[];
    location_code: number;
    language_code: string;
  };
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, EXPECTED_CLICK_DEMAND_PROVIDER_ENDPOINT);
  assert.deepEqual(request.keywords, [
    "website sales agent",
    "zero demand phrase",
    "null demand phrase",
    "volume only phrase",
  ]);
  assert.equal(request.location_code, 2826);
  assert.equal(request.language_code, "en");
  assert.equal(metrics.length, 3);
  assert.equal(metrics[0].searchVolume, 720);
  assert.equal(metrics[0].cpc, 4.2);
  assert.equal(metrics[0].competition, 0.82);
  assert.deepEqual(metrics[0].trend, [700, 0, 650]);
  assert.equal(metrics[1].searchVolume, 0);
  assert.equal(metrics[1].cpc, 0);
  assert.equal(metrics[1].competition, 0);
  assert.equal(metrics[2].keyword, "volume only phrase");
  assert.equal(metrics[2].searchVolume, 90);
  assert.equal("cpc" in metrics[2], false);
  assert.equal("competition" in metrics[2], false);
  assert.deepEqual(metrics[2].trend, []);
  assert.equal(
    metrics.some((metric) => metric.keyword === "null demand phrase"),
    false,
  );
  assert.equal(
    metrics.some((metric) => metric.keyword === "foreign phrase"),
    false,
  );
  const reconciled = reconcileExactDemandMetrics(
    [
      { topicId: "one", keyword: "website sales agent" },
      { topicId: "two", keyword: "zero demand phrase" },
      { topicId: "three", keyword: "null demand phrase" },
      { topicId: "four", keyword: "volume only phrase" },
    ],
    metrics,
  );
  assert.deepEqual(reconciled.missing, [{
    topicId: "three",
    keyword: "null demand phrase",
  }]);
  await assert.rejects(
    getExactKeywordDemandFromDataForSEO(
      Array.from({ length: 11 }, (_, index) => `keyword ${index}`),
      2840,
      "en",
      { request: async () => ({}) },
    ),
    /outside its bounded contract/,
  );
});

test("one provider call and total deadline are hard runtime breakers", () => {
  assert.equal(EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CALL_LIMIT, 1);
  assert.equal(
    EXPECTED_CLICK_DEMAND_BACKFILL_PROVIDER_CEILING_MICRO_USD,
    100_000,
  );
  const runtime = createExpectedClickDemandRuntime(1_000);
  consumeExpectedClickDemandProviderCall(runtime, 1_001);
  assert.throws(
    () => consumeExpectedClickDemandProviderCall(runtime, 1_002),
    (error) =>
      error instanceof ExpectedClickDemandRuntimeError &&
      error.code === "provider_call_limit",
  );
  const expired = createExpectedClickDemandRuntime(1_000);
  assert.throws(
    () => consumeExpectedClickDemandProviderCall(expired, expired.deadlineAt),
    (error) =>
      error instanceof ExpectedClickDemandRuntimeError &&
      error.code === "deadline_exhausted",
  );
});

test("receipt reconciliation separates zero from missing and rejects foreign rows", () => {
  const reconciled = reconcileExactDemandMetrics(
    [
      { topicId: "one", keyword: "measured zero" },
      { topicId: "two", keyword: "not returned" },
      { topicId: "three", keyword: "volume only" },
    ],
    [
      {
        keyword: "MEASURED   ZERO",
        searchVolume: 0,
        cpc: 0,
        competition: 0,
        trend: [],
      },
      {
        keyword: "volume only",
        searchVolume: 90,
        trend: [0, 80],
      },
    ],
  );
  assert.equal(reconciled.measured.length, 2);
  assert.equal(reconciled.measured[0].metric.searchVolume, 0);
  assert.equal(reconciled.measured[1].metric.cpc, undefined);
  assert.deepEqual(reconciled.missing, [
    { topicId: "two", keyword: "not returned" },
  ]);
  assert.throws(
    () => reconcileExactDemandMetrics(
      [{ topicId: "one", keyword: "expected" }],
      [{
        keyword: "foreign",
        searchVolume: 100,
        cpc: 1,
        competition: 0.2,
        trend: [],
      }],
    ),
    /incompatible exact keyword metrics/,
  );
});

test("the canary is internal, exact-keyword-only, and records before HTTP", () => {
  assert.match(action, /export const queueExpectedClickDemandBackfill = internalAction/);
  assert.match(action, /export const resumeExpectedClickDemandBackfill = internalAction/);
  assert.doesNotMatch(action, /export const .* = action\(/);
  assert.doesNotMatch(model, /export const getStatus = query\(/);
  assert.match(action, /assertDataForSeoAccountBalance/);
  assert.match(action, /getExactKeywordDemandFromDataForSEO/);
  assert.doesNotMatch(action, /discoverKeywords|OpenAI|Anthropic|generateArticle|publish/);
  assert.ok(
    action.indexOf("api.beginProviderAttempt") <
      action.indexOf("getExactKeywordDemandFromDataForSEO("),
  );
  const strictStart = seoData.indexOf(
    "export async function getExactKeywordDemandFromDataForSEO",
  );
  const strictEnd = seoData.indexOf(
    "async function getKeywordSearchVolumeFromAPI",
    strictStart,
  );
  assert.doesNotMatch(
    seoData.slice(strictStart, strictEnd),
    /getKeywordMetricsFromAI|bulk_keyword_difficulty|discoverKeywords/,
  );
});

test("queue, provider call, and persistence retain every tenant fence", () => {
  assert.match(model, /site\.expectedClickSchedulingEnabled === true/);
  assert.match(model, /\["warm", "live"\]/);
  assert.match(model, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(model, /job\.rolloutEpoch !== \(site\.autopilotRolloutEpoch \?\? 0\)/);
  assert.match(model, /reservation\.purpose !== "expected_click_demand_backfill"/);
  assert.match(model, /reservation\.releasedAt !== undefined/);
  assert.match(model, /job\.reservationDay !== utcDemandBackfillDay\(timestamp\)/);
  assert.match(model, /article\.topicId !== selected\.topicId/);
  assert.match(model, /artifactFingerprint\(article\) !== selected\.artifactHash/);
  assert.match(model, /topic\.primaryKeyword !== selected\.keyword/);
  assert.match(model, /topic\.updatedAt !== attempt\.topicUpdatedAt/);
  assert.match(model, /evaluateTopicBusinessFit/);
  assert.match(model, /locationCode !== job\.locationCode/);
});

test("ambiguous or missing responses cannot be replayed or invented", () => {
  assert.match(model, /searchDemandBackfillAttemptVersion/);
  assert.match(model, /searchDemandBackfillAttemptKeyword/);
  assert.match(model, /hasCurrentVersionAttempt\(topic\)/);
  assert.match(action, /providerCallAttempted === true[\s\S]*providerCallCompleted !== true/);
  assert.match(action, /throw new Error\("provider_attempt_ambiguous"\)/);
  assert.match(model, /"provider_response_unverified"/);
  assert.match(model, /code: "exact_metric_missing"/);
  assert.match(model, /normalizeExactDemandKeyword\(receipt\.returnedKeyword\)/);
  assert.match(model, /reason: "reservation_day_expired"/);
  assert.doesNotMatch(model, /exact_metric_missing[\s\S]{0,200}searchVolume: 0/);
});

test("exact receipts feed the existing evidence backfill without stale projections", () => {
  const now = 1_787_270_000_000;
  assert.equal(hasCurrentExpectedClickDemand({
    evidence: {
      searchVolume: 720,
      searchDemandSource: DATAFORSEO_DEMAND_SOURCE,
      searchDemandMeasuredAt: now,
      searchDemandLocationCode: 2826,
      searchDemandLanguageCode: "en",
    },
    locationCode: 2826,
    languageCode: "en",
    now,
  }), true);
  assert.match(model, /searchDemandSource: receipt\.source/);
  assert.match(model, /searchDemandMeasuredAt: receipt\.measuredAt/);
  assert.match(model, /expectedClickAuditVersion: undefined/);
  assert.match(model, /expectedClickBackfillJobId: undefined/);
  assert.match(evidenceModel, /\(topic\.searchVolume \?\? 0\) <= 0/);
});

test("one daily job shares the fleet ledger and tenant deletion drains it", () => {
  const reservationIndex = model.indexOf("reserveSharedProviderBudget(ctx");
  const insertIndex = model.indexOf('db.insert("expected_click_demand_jobs"');
  assert.ok(reservationIndex >= 0 && insertIndex > reservationIndex);
  assert.match(model, /const existing = todayJobs\[0\]/);
  assert.match(model, /purpose: "expected_click_demand_backfill"/);
  assert.match(reservation, /expected_click_demand_backfill/);
  assert.match(schema, /expected_click_demand_jobs: defineTable/);
  assert.match(schema, /searchDemandBackfillAttemptJobId: v\.optional/);
  assert.match(schema, /\.index\("by_site_day", \["siteId", "reservationDay"\]\)/);
  assert.match(sites, /"expected_click_demand_jobs"/);
  assert.match(
    sites,
    /query\("expected_click_demand_jobs"\)[\s\S]*withIndex\("by_site_created"/,
  );
});

test("runbook exposes only the safe status, action and exact resume commands", () => {
  assert.match(runbook, /expectedClickDemandBackfill:getStatusInternal/);
  assert.match(
    runbook,
    /actions\/expectedClickDemandBackfill:queueExpectedClickDemandBackfill/,
  );
  assert.match(
    runbook,
    /actions\/expectedClickDemandBackfill:resumeExpectedClickDemandBackfill/,
  );
  assert.match(runbook, /--prod --codegen disable/);
  assert.match(runbook, /<reviewed-site-id>/);
  assert.doesNotMatch(runbook, /convex run expectedClickDemandBackfill:reserveAndQueue/);
});
