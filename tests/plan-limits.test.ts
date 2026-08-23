import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  allocateCadenceForMonthlyAllowance,
  cadenceFitsMonthlyAllowance,
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
  assert.deepEqual(options.map((option) => option.label), ["Paused", "3/month"]);
  const active = options[1];
  assert.equal(requiredMonthlyArticlesForCadence(active.value), 3);
  assert.equal(cadenceLabel(active.value), "3/month");
  assert.equal(defaultCadenceForMonthlyLimit(3), active.value);
  assert.equal(
    cadenceIntervalMs(active.value),
    Math.floor((31 * 24 * 60 * 60 * 1000) / 3),
  );
});

test("every selectable cadence fits its monthly plan capacity", () => {
  for (const maxArticles of [3, 10, 25, 60, 150]) {
    const options = cadenceOptionsForMonthlyLimit(maxArticles);
    assert.ok(options.length > 0);
    assert.ok(
      options.every((option) =>
        cadenceFitsMonthlyAllowance(option.value, maxArticles)
      ),
    );
  }
  assert.equal(defaultCadenceForMonthlyLimit(10), 2);
  assert.equal(defaultCadenceForMonthlyLimit(25), 4);
  assert.equal(maximumSustainableCadencePerWeek(3), 21 / 31);
});

test("tenant cadence writes are enforced server-side and legacy mismatches are migratable", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(sites, /function assertCadenceFitsAccountAllowance/);
  assert.match(sites, /async function reserveAccountCadence/);
  assert.match(sites, /export const reconcileUnsustainableCadences/);
  assert.match(sites, /applyCanonicalPlanToUserSites/);
});

test("the allocator uses remaining account capacity and pauses truthfully at zero", () => {
  assert.equal(allocateCadenceForMonthlyAllowance(4, 25), 4);
  assert.equal(requiredMonthlyArticlesForCadence(4), 18);
  const reduced = allocateCadenceForMonthlyAllowance(4, 7);
  assert.ok(requiredMonthlyArticlesForCadence(reduced) <= 7);
  assert.equal(allocateCadenceForMonthlyAllowance(4, 0), 0);
  assert.equal(cadenceLabel(0), "Paused");
  assert.equal(cadenceFitsMonthlyAllowance(0, 0), true);
  assert.equal(cadenceFitsMonthlyLimit(0, 25), false);
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
