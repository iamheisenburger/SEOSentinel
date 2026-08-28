import assert from "node:assert/strict";
import test from "node:test";

import { buildGrowthScorecard } from "../convex/lib/growthScorecard.ts";

const dates = (start: string, count: number) => {
  const first = new Date(`${start}T12:00:00.000Z`);
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(first);
    value.setUTCDate(value.getUTCDate() + index);
    return value.toISOString().slice(0, 10);
  });
};

test("growth scorecard reports exact 7/28/56-day outcomes and comparisons", () => {
  const receiptDates = dates("2026-05-09", 112);
  const rows = receiptDates.map((date, index) => ({
    date,
    clicks: index >= 105 ? 4 : index >= 98 ? 2 : 1,
    impressions: index >= 105 ? 40 : index >= 98 ? 25 : 20,
    weightedPosition: index >= 105 ? 320 : index >= 98 ? 250 : 240,
    nonBrandedClicks: 1,
    nonBrandedImpressions: 10,
    syncedAt: index + 1,
  }));
  const result = buildGrowthScorecard({
    dataThrough: "2026-08-28",
    receiptDates,
    rows,
  });
  assert.ok(result);
  assert.equal(result["7"].comparisonStatus, "complete");
  assert.equal(result["7"].current.clicks, 28);
  assert.equal(result["7"].change.clicks.absolute, 14);
  assert.equal(result["7"].change.clicks.percent, 100);
  assert.equal(result["28"].observedDays, 28);
  assert.equal(result["56"].comparisonObservedDays, 56);
});

test("growth scorecard marks missing baselines unavailable instead of fabricating growth", () => {
  const receiptDates = dates("2026-08-22", 7);
  const result = buildGrowthScorecard({
    dataThrough: "2026-08-28",
    receiptDates,
    rows: [],
  });
  assert.ok(result);
  assert.equal(result["7"].comparisonStatus, "unavailable");
  assert.equal(result["7"].change.clicks.percent, 0);
  assert.equal(buildGrowthScorecard({ receiptDates: [], rows: [] }), null);
});
