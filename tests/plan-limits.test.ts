import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  cadenceFitsMonthlyLimit,
  cadenceLabel,
  cadenceOptionsForMonthlyLimit,
  defaultCadenceForMonthlyLimit,
  maximumSustainableCadencePerWeek,
  requiredMonthlyArticlesForCadence,
} from "../convex/planLimits.ts";
import { cadenceIntervalMs } from "../convex/lib/autopilotBuffer.ts";

test("the free plan receives an honest three-per-month autonomous cadence", () => {
  const options = cadenceOptionsForMonthlyLimit(3);
  assert.equal(options.length, 1);
  assert.equal(options[0].label, "3/month");
  assert.equal(requiredMonthlyArticlesForCadence(options[0].value), 3);
  assert.equal(cadenceLabel(options[0].value), "3/month");
  assert.equal(defaultCadenceForMonthlyLimit(3), options[0].value);
  assert.equal(
    cadenceIntervalMs(options[0].value),
    Math.floor((31 * 24 * 60 * 60 * 1000) / 3),
  );
});

test("every selectable cadence fits its monthly plan capacity", () => {
  for (const maxArticles of [3, 10, 25, 60, 150]) {
    const options = cadenceOptionsForMonthlyLimit(maxArticles);
    assert.ok(options.length > 0);
    assert.ok(
      options.every((option) =>
        cadenceFitsMonthlyLimit(option.value, maxArticles)
      ),
    );
  }
  assert.equal(defaultCadenceForMonthlyLimit(10), 2);
  assert.equal(defaultCadenceForMonthlyLimit(25), 4);
  assert.equal(maximumSustainableCadencePerWeek(3), 21 / 31);
});

test("tenant cadence writes are enforced server-side and legacy mismatches are migratable", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(sites, /function assertCadenceFitsPlan/);
  assert.match(sites, /export const reconcileUnsustainableCadences/);
  assert.match(sites, /maximumSelectableCadenceForMonthlyLimit/);
});

test("Search Console outcomes run for the paginated tenant fleet", () => {
  const crons = readFileSync("convex/crons.ts", "utf8");
  const gscSync = readFileSync("convex/actions/gscSync.ts", "utf8");
  assert.match(crons, /all-sites-gsc-sync/);
  assert.match(crons, /internal\.actions\.gscSync\.syncAllSites/);
  assert.doesNotMatch(crons, /LEADPILOT_SITE_ID/);
  assert.match(gscSync, /internal\.sites\.listGrowthPage/);
  assert.match(gscSync, /internal\.actions\.gscSync\.syncAllSites/);
});
