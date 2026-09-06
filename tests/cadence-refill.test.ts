import assert from "node:assert/strict";
import test from "node:test";
import {
  CADENCE_REFILL_RECHECK_MS,
  cadencePlanDailyLimit,
  cadencePlanFailureEligibleAt,
  nextPlanWindowSlotAt,
  topicReplenishmentBudget,
} from "../convex/lib/cadenceRefill.ts";
import {
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  automaticPlanDailyCeilingMicroUsd,
  evaluatePlanProviderReservationCapacity,
} from "../convex/lib/planProviderBudget.ts";
import { blockedByUnfingerprintedCoverage } from "../convex/lib/autopilotBuffer.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 6);

test("known legacy conflicts cannot occupy every candidate slot ahead of fresh intents", () => {
  const coverage = [{ primaryKeyword: "keyword research automation" }];
  const ranked = ["bing keyword research tool", "customer support onboarding", "website migration checklist"];
  const selected = ranked.filter(keyword => !blockedByUnfingerprintedCoverage(keyword, coverage)).slice(0, 2);
  assert.deepEqual(selected, ["customer support onboarding", "website migration checklist"]);
});

test("preselection never replaces live SERP comparisons with lexical rejection", () => {
  const keyword = "bing keyword research tool";
  const coverage = [{
    primaryKeyword: "keyword research automation",
    serpTopUrls: Array.from({ length: 5 }, (_, i) => `https://example.org/article-${i}`),
  }];
  assert.equal(blockedByUnfingerprintedCoverage(keyword, coverage), false);
  assert.equal(blockedByUnfingerprintedCoverage(keyword, []), false);
});

test("refill capacity follows customer cadence, never a tenant identity", () => {
  for (const [cadence, limit] of [[1, 3], [7, 3], [14, 4], [21, 5]]) {
    assert.equal(cadencePlanDailyLimit(cadence, 1), limit);
    assert.equal(cadencePlanDailyLimit(cadence, 12), limit);
    assert.equal(cadencePlanDailyLimit(cadence, 0), 1);
    assert.equal(automaticPlanDailyCeilingMicroUsd(cadence),
      limit * AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD);
  }
  for (const invalid of [NaN, Infinity, -1, 0, 1e9]) {
    assert.ok(topicReplenishmentBudget(invalid) <= 5);
  }
  assert.equal(cadencePlanDailyLimit(21, NaN), 1);
});

test("only a terminal semantic miss with a current buffer shortfall gets a shorter backoff", () => {
  const failure = { category: "semantic_zero_yield", terminal: true, eligibleAt: NOW + DAY };
  assert.equal(cadencePlanFailureEligibleAt({ failure, planCreatedAt: NOW, targetBufferShortfall: 3 }), NOW + CADENCE_REFILL_RECHECK_MS);
  assert.equal(cadencePlanFailureEligibleAt({ failure, planCreatedAt: NOW, targetBufferShortfall: 0 }), NOW + DAY);
  for (const category of ["provider_funding", "transient_provider", "budget_window", "monthly_quota", "readiness", "entitlement", "terminal_invariant"]) {
    assert.equal(cadencePlanFailureEligibleAt({ failure: { ...failure, category }, planCreatedAt: NOW, targetBufferShortfall: 3 }), NOW + DAY);
  }
  assert.equal(cadencePlanFailureEligibleAt({ failure: { ...failure, terminal: false }, planCreatedAt: NOW, targetBufferShortfall: 3 }), NOW + DAY);
  assert.equal(cadencePlanFailureEligibleAt({ failure, planCreatedAt: NaN, targetBufferShortfall: 3 }), NOW + DAY);
});

test("multiple plans wake at the next genuinely free slot, including a lowered limit", () => {
  const rows = [3, 2, 1, 0].map(hour => ({ createdAt: NOW + hour * 3_600_000 }));
  assert.equal(nextPlanWindowSlotAt(rows, 3), NOW + 3_600_000 + DAY + 1_000);
  assert.equal(nextPlanWindowSlotAt(rows, 1), NOW + 3 * 3_600_000 + DAY + 1_000);
  assert.equal(nextPlanWindowSlotAt(rows, 5), undefined);
  assert.equal(nextPlanWindowSlotAt(rows, 0), undefined);
});

test("published articles do not shrink and double-charge purchased monthly planning capacity", () => {
  const result = evaluatePlanProviderReservationCapacity({
    remainingArticles: 10,
    monthlyArticleAllowance: 100,
    cadencePerWeek: 7,
    budgetedPlansThisMonth: 9,
    reservedTodayMicroUsd: 0,
  });
  assert.deepEqual(result, { allowed: true, monthlyPlanAllowance: 10 });
  const full = evaluatePlanProviderReservationCapacity({
    remainingArticles: 0, monthlyArticleAllowance: 100, cadencePerWeek: 7,
    budgetedPlansThisMonth: 9, reservedTodayMicroUsd: 0,
  });
  assert.equal(full.allowed, false);
  if (!full.allowed) assert.equal(full.reason, "article_quota_no_headroom");
});

test("zero-yield refill is finite and cannot create a fourth daily plan for a daily tenant", () => {
  for (let plans = 0; plans <= 3; plans++) {
    const result = evaluatePlanProviderReservationCapacity({
      remainingArticles: 100, monthlyArticleAllowance: 100, cadencePerWeek: 7,
      budgetedPlansThisMonth: plans,
      reservedTodayMicroUsd: plans * AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    });
    assert.equal(result.allowed, plans < 3);
    if (!result.allowed) assert.equal(result.reason, "provider_daily_budget_reserved");
  }
});
