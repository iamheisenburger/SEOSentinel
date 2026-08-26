import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN_SERP_AUTHORITY,
  authorityLimitedForecast,
  rankWinnableCandidates,
  serpIsWinnableNow,
  winnabilityScore,
  winnableAuthorityBand,
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
