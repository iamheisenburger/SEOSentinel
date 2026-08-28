import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  cadenceFitsOperationalLimit,
  targetCadenceOptions,
} from "../convex/planLimits.ts";

function source(path: string): string {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exportedBlock(text: string, name: string): string {
  const start = text.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = text.indexOf("\nexport const ", start + 1);
  return text.slice(start, end < 0 ? text.length : end);
}

test("target cadence is independent of the monthly consumption quota", () => {
  assert.deepEqual(
    targetCadenceOptions().map((option) => option.value),
    [1, 2, 4, 7, 14, 21],
  );
  assert.equal(cadenceFitsOperationalLimit(12), true);
  assert.equal(cadenceFitsOperationalLimit(21), true);
  assert.equal(cadenceFitsOperationalLimit(22), false);
});

test("cadence writes preserve target intent without reserving monthly credits", () => {
  const sites = source("convex/sites.ts");
  const schema = source("convex/schema.ts");

  assert.match(schema, /allocatedMonthlyArticles: v\.optional\(v\.number\(\)\)/);
  assert.match(schema, /cadenceAllocationVersion: v\.optional\(v\.number\(\)\)/);
  assert.match(sites, /async function accountCadenceSnapshot/);
  assert.match(sites, /entitlement\.status === "completed"/);
  assert.doesNotMatch(sites, /async function reserveAccountCadence/);
  assert.match(sites, /assertCadenceTargetSupported/);
  assert.match(sites, /cadenceRequestedPerWeek: requestedCadence/);
  assert.doesNotMatch(sites, /allocateCadenceForMonthlyAllowance/);
});

test("plan reconciliation and UI use immutable monthly consumption", () => {
  const sites = source("convex/sites.ts");
  const onboarding = source("src/components/onboarding/setup-wizard.tsx");
  const settings = source("src/app/(dashboard)/sites/[siteId]/page.tsx");

  assert.match(sites, /remainingArticleAllowance/);
  assert.match(sites, /allocatedMonthlyArticles/);
  assert.match(sites, /export const getCadenceCapacity/);
  assert.match(sites, /by_user_type_created/);
  assert.match(sites, /remainingMonthlyArticles/);
  assert.match(onboarding, /api\.sites\.getCadenceCapacity/);
  assert.match(onboarding, /availableMonthlyArticles/);
  assert.match(settings, /api\.sites\.getCadenceCapacity/);
  assert.match(settings, /availableMonthlyArticles/);
});

test("site rename cannot collide with any existing domain claim", () => {
  const sites = source("convex/sites.ts");
  const upsertStart = sites.indexOf("export const upsert");
  const updateStart = sites.indexOf("export const updateSite", upsertStart);
  const upsert = sites.slice(upsertStart, updateStart);

  assert.match(upsert, /normalizedAuthorityDomain\(args\.domain\)/);
  assert.match(upsert, /withIndex\("by_canonical_domain"/);
  assert.match(upsert, /legacyDomainVariants/);
  assert.match(upsert, /args\.id && domainClaim && domainClaim\._id !== args\.id/);
  assert.match(upsert, /This domain is already connected to another site/);
  assert.match(sites, /export const backfillCanonicalDomains/);
});

test("zero allocation is a stable paused state, never a failing cadence run", () => {
  const autopilot = source("convex/autopilot.ts");
  const scheduler = source("convex/actions/scheduler.ts");
  const pipeline = source("convex/actions/pipeline.ts");
  const planPage = source("src/app/(dashboard)/plan/page.tsx");
  const dispatch = exportedBlock(autopilot, "dispatchActiveSites");
  const refresh = exportedBlock(autopilot, "refreshSiteCadenceHealth");
  const scheduleCadence = exportedBlock(scheduler, "scheduleCadence");
  const autopilotTick = exportedBlock(pipeline, "autopilotTick");

  assert.match(dispatch, /\(site\.cadencePerWeek \?\? 0\) <= 0/);
  assert.match(dispatch, /status: "cadence_paused"/);
  assert.ok(
    dispatch.indexOf('(site.cadencePerWeek ?? 0) <= 0') <
      dispatch.indexOf('ctx.db.insert("autopilot_runs"'),
  );
  assert.match(refresh, /status: "cadence_paused"/);
  assert.match(scheduleCadence, /mode: "cadence_paused"/);
  assert.ok(
    scheduleCadence.indexOf('(site.cadencePerWeek ?? 0) <= 0') <
      scheduleCadence.indexOf("cadenceIntervalMs"),
  );
  assert.match(autopilotTick, /cadenceSchedule\.mode === "cadence_paused"/);
  assert.ok(
    autopilotTick.indexOf('cadenceSchedule.mode === "cadence_paused"') <
      autopilotTick.indexOf("executeClaimedCrawlAndAnalyze"),
  );
  assert.match(planPage, /if \(cadence <= 0\) return \[\]/);
  assert.match(planPage, /Publishing paused/);
});

test("a target cadence change does not rebalance other tenants", () => {
  const sites = source("convex/sites.ts");
  const scheduler = source("convex/actions/scheduler.ts");
  const jobs = source("convex/jobs.ts");
  assert.doesNotMatch(sites, /rebalanceAccountCadencesAfterRequest/);
  assert.match(sites, /cadenceRequestedPerWeek: requestedCadence/);
  assert.match(scheduler, /articlesThisMonth >= limits\.maxArticles/);
  assert.match(scheduler, /generation_quota_deadline/);
  assert.match(jobs, /usage_log/);
  assert.match(jobs, /Article limit reached/);
});

test("legacy allocation metadata cannot reduce the selectable target cadence", () => {
  const sites = source("convex/sites.ts");
  assert.match(sites, /const cadencePerWeek = shouldPark[\s\S]*: requestedCadence/);
  assert.match(sites, /allocatedMonthlyArticles: 0/);
  assert.match(sites, /cadenceFitsOperationalLimit\(requestedCadence\)/);
});
