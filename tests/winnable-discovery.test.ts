import assert from "node:assert/strict";
import test from "node:test";

import {
  MIN_VIABLE_MONTHLY_DEMAND,
  OPEN_SERP_AUTHORITY,
  authorityLimitedForecast,
  rankWinnableCandidates,
  serpIsWinnableNow,
  winnabilityScore,
  winnableAuthorityBand,
  orderDiscoveryByWinnability,
  preSerpWinnability,
} from "../convex/lib/winnableDiscovery.ts";

/**
 * These fixtures are the measured leadpilot.chat inventory on 2026-08-26:
 * tenant authority 4, twenty eligible topics whose page-one median authority
 * ranged 34-87, every rank probability pinned to the 1% floor, 1.64 expected
 * clicks per month in total.
 */
const LEADPILOT_AUTHORITY = 4;

const MEASURED_INVENTORY = [
  { keyword: "ai sales agent", monthlySearches: 1300, medianSerpAuthority: 63, observedCompetitors: 7 },
  { keyword: "sales team", monthlySearches: 1000, medianSerpAuthority: 86, observedCompetitors: 8 },
  { keyword: "conversion rate sales", monthlySearches: 480, medianSerpAuthority: 80, observedCompetitors: 8 },
  { keyword: "customer engagement software", monthlySearches: 390, medianSerpAuthority: 61, observedCompetitors: 8 },
  { keyword: "chatbot for lead generation", monthlySearches: 170, medianSerpAuthority: 60, observedCompetitors: 5 },
  { keyword: "lead sales software", monthlySearches: 170, medianSerpAuthority: 87, observedCompetitors: 8 },
];

test("a weak tenant is pointed at open SERPs, not head terms", () => {
  const band = winnableAuthorityBand(LEADPILOT_AUTHORITY);
  assert.equal(band.floor, OPEN_SERP_AUTHORITY);
  assert.ok(band.ceiling >= OPEN_SERP_AUTHORITY);
  assert.ok(
    band.ceiling < 34,
    "the ceiling must exclude the weakest SERP LeadPilot ever discovered",
  );
});

test("the band widens as the tenant gets stronger — the weak-to-strong ladder", () => {
  const weak = winnableAuthorityBand(4).ceiling;
  const climbing = winnableAuthorityBand(25).ceiling;
  const strong = winnableAuthorityBand(60).ceiling;
  assert.ok(weak < climbing && climbing < strong);
  // A strong tenant can reach the very SERPs that were hopeless at rank 4.
  assert.ok(strong >= 63, "a rank-60 tenant must be able to target DR-63 SERPs");
  assert.equal(
    serpIsWinnableNow({
      tenantAuthority: 60,
      medianSerpAuthority: 63,
      observedCompetitors: 7,
    }),
    true,
  );
});

test("every keyword LeadPilot actually discovered is correctly rejected", () => {
  const ranked = rankWinnableCandidates(LEADPILOT_AUTHORITY, MEASURED_INVENTORY);
  assert.deepEqual(
    ranked,
    [],
    "none of the measured inventory is winnable at authority 4",
  );
});

test("genuine long-tail opportunity is found and ordered by winnable traffic", () => {
  const longTail = [
    // Lower volume, but an open SERP the tenant can actually enter.
    { keyword: "chatbot for plumber website", monthlySearches: 90, medianSerpAuthority: 8, observedCompetitors: 7 },
    { keyword: "qualify leads without a form", monthlySearches: 140, medianSerpAuthority: 14, observedCompetitors: 6 },
    // High volume but hopeless: must never outrank the winnable ones.
    { keyword: "crm software", monthlySearches: 90_000, medianSerpAuthority: 88, observedCompetitors: 10 },
  ];
  const ranked = rankWinnableCandidates(LEADPILOT_AUTHORITY, longTail);
  assert.deepEqual(
    ranked.map((candidate) => candidate.keyword),
    ["qualify leads without a form", "chatbot for plumber website"],
  );
  assert.ok(
    ranked[0].winnabilityScore > 0,
    "a winnable keyword must score above the 1% floor the old model produced",
  );
});

test("volume never outranks winnability", () => {
  const hopelessButHuge = winnabilityScore({
    tenantAuthority: LEADPILOT_AUTHORITY,
    medianSerpAuthority: 88,
    monthlySearches: 90_000,
    observedCompetitors: 10,
  });
  const modestButOpen = winnabilityScore({
    tenantAuthority: LEADPILOT_AUTHORITY,
    medianSerpAuthority: 10,
    monthlySearches: 90,
    observedCompetitors: 7,
  });
  assert.equal(hopelessButHuge, 0);
  assert.ok(modestButOpen > 0);
});

test("discovery fails closed without observed page-one authority", () => {
  for (const args of [
    { tenantAuthority: 4, medianSerpAuthority: null, observedCompetitors: 8 },
    { tenantAuthority: 4, medianSerpAuthority: undefined, observedCompetitors: 8 },
    { tenantAuthority: 4, medianSerpAuthority: 8, observedCompetitors: 2 },
    { tenantAuthority: 4, medianSerpAuthority: 8, observedCompetitors: 0 },
  ]) {
    assert.equal(serpIsWinnableNow(args), false, JSON.stringify(args));
  }
});

test("the forecast states the gap in pages instead of declaring failure", () => {
  const winnable = Array.from({ length: 12 }, () => ({ winnabilityScore: 30 }));
  const forecast = authorityLimitedForecast({
    tenantAuthority: LEADPILOT_AUTHORITY,
    monthlyClickGoal: 1000,
    winnableCandidates: winnable,
  });
  assert.ok(forecast.reachableMonthlyClicks > 0);
  assert.equal(forecast.goalAttainableFromCurrentEvidence, false);
  assert.ok(
    forecast.pagesNeededForGoal !== null && forecast.pagesNeededForGoal > 0,
    "an unmet goal must resolve to a concrete number of pages, not despair",
  );
});

test("no measured opportunity reports unknown, never impossible", () => {
  const forecast = authorityLimitedForecast({
    tenantAuthority: LEADPILOT_AUTHORITY,
    monthlyClickGoal: 1000,
    winnableCandidates: [],
  });
  assert.equal(forecast.reachableMonthlyClicks, 0);
  assert.equal(forecast.goalGap, 1000);
  assert.equal(
    forecast.pagesNeededForGoal,
    null,
    "unknown until discovery widens is honest; impossible is not",
  );
});

test("a goal already covered by winnable opportunity is reported attainable", () => {
  const forecast = authorityLimitedForecast({
    tenantAuthority: 40,
    monthlyClickGoal: 100,
    winnableCandidates: Array.from({ length: 40 }, () => ({ winnabilityScore: 60 })),
  });
  assert.equal(forecast.goalAttainableFromCurrentEvidence, true);
  assert.equal(forecast.goalGap, 0);
});

test("discovery ordering keeps the winnable long tail instead of head terms", () => {
  // A realistic provider response: a few huge head terms and a long tail.
  const raw = [
    { keyword: "crm software", searchVolume: 90_000, difficulty: 92, difficultyMeasured: true },
    { keyword: "sales team", searchVolume: 1000, difficulty: 78, difficultyMeasured: true },
    { keyword: "ai sales agent", searchVolume: 1300, difficulty: 64, difficultyMeasured: true },
    { keyword: "chatbot for plumber website", searchVolume: 90, difficulty: 6, difficultyMeasured: true },
    { keyword: "qualify leads without a form", searchVolume: 140, difficulty: 11, difficultyMeasured: true },
    { keyword: "book demos from live chat", searchVolume: 70, difficulty: 4, difficultyMeasured: true },
  ];

  // The old rule: rank by volume and truncate to what can be measured.
  const byVolume = raw.slice().sort((a, b) => b.searchVolume - a.searchVolume)
    .slice(0, 3).map((c) => c.keyword);
  assert.deepEqual(byVolume, ["crm software", "ai sales agent", "sales team"]);

  // The new rule at authority 4: keep only what this domain can enter.
  const winnable = orderDiscoveryByWinnability(4, raw).slice(0, 3)
    .map((c) => c.keyword);
  assert.deepEqual(winnable, [
    "qualify leads without a form",
    "chatbot for plumber website",
    "book demos from live chat",
  ]);

  // A strong tenant legitimately gets the head terms back.
  assert.equal(orderDiscoveryByWinnability(75, raw)[0].keyword, "crm software");
});

test("unmeasured difficulty never outranks a measured winnable keyword", () => {
  const guessed = preSerpWinnability({
    tenantAuthority: 4,
    keywordDifficulty: undefined,
    monthlySearches: 5000,
  });
  const measured = preSerpWinnability({
    tenantAuthority: 4,
    keywordDifficulty: 8,
    keywordDifficultyMeasured: true,
    monthlySearches: 200,
  });
  assert.ok(measured > 0);
  assert.ok(
    guessed < measured * 40,
    "an unverified head term must not dominate the shortlist on volume alone",
  );
  assert.equal(preSerpWinnability({ tenantAuthority: 4, monthlySearches: 0 }), 0);
});

test("a winnable topic too thin to write about is not selected", () => {
  // The exact production failure: winnability discovery selected volume-10,
  // KD-0 topics like "intent detection datasets". Seven consecutive articles
  // came out at 1,016-1,055 words against a 1,200 minimum and 73-82 against an
  // 85 editorial minimum. Media is deferred until prose clears strict review,
  // so no hero image was ever produced, the gate then also failed for the
  // missing image, and two bounded revisions could not converge. Every run
  // ended quality_budget_exhausted with an empty buffer.
  const tooThin = {
    keyword: "intent detection datasets",
    monthlySearches: 10,
    medianSerpAuthority: 4,
    observedCompetitors: 7,
  };
  assert.equal(winnabilityScore({ tenantAuthority: 4, ...tooThin }), 0);
  assert.equal(
    preSerpWinnability({
      tenantAuthority: 4,
      keywordDifficulty: 0,
      keywordDifficultyMeasured: true,
      monthlySearches: 10,
    }),
    0,
  );
  assert.deepEqual(rankWinnableCandidates(4, [tooThin]), []);
});

test("the demand floor does not reject genuine long-tail opportunity", () => {
  const viable = {
    keyword: "qualify leads without a form",
    monthlySearches: MIN_VIABLE_MONTHLY_DEMAND,
    medianSerpAuthority: 12,
    observedCompetitors: 7,
  };
  assert.ok(winnabilityScore({ tenantAuthority: 4, ...viable }) > 0);
  assert.equal(rankWinnableCandidates(4, [viable]).length, 1);
});

test("thin topics never outrank viable ones in the shortlist", () => {
  const ranked = orderDiscoveryByWinnability(4, [
    { keyword: "intent detection datasets", searchVolume: 10, difficulty: 0, difficultyMeasured: true },
    { keyword: "chatbot for plumber website", searchVolume: 90, difficulty: 6, difficultyMeasured: true },
  ]);
  assert.equal(ranked[0].keyword, "chatbot for plumber website");
  assert.equal(
    preSerpWinnability({
      tenantAuthority: 4,
      keywordDifficulty: 0,
      keywordDifficultyMeasured: true,
      monthlySearches: 10,
    }),
    0,
    "a thin topic must score zero, not merely rank lower",
  );
});
