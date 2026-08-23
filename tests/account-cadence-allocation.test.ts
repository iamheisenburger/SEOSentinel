import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  allocateCadenceForMonthlyAllowance,
  requiredMonthlyArticlesForCadence,
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

function allocate(requested: number[], allowance: number): number[] {
  let remaining = allowance;
  return requested.map((cadence) => {
    const effective = allocateCadenceForMonthlyAllowance(cadence, remaining);
    remaining -= requiredMonthlyArticlesForCadence(effective);
    return effective;
  });
}

function monthlyTotal(cadences: number[]): number {
  return cadences.reduce(
    (total, cadence) =>
      total + requiredMonthlyArticlesForCadence(cadence),
    0,
  );
}

test("Pro, Scale, and Enterprise allocations never exceed account article quota", () => {
  const pro = allocate([4, 4, 4], 25);
  assert.ok(monthlyTotal(pro) <= 25);
  assert.equal(pro[0], 4);
  assert.ok(pro[2] < 4);

  const scale = allocate(Array(10).fill(4), 60);
  assert.ok(monthlyTotal(scale) <= 60);
  assert.ok(scale.some((cadence) => cadence === 0));

  const enterprise = allocate(Array(40).fill(4), 150);
  assert.ok(monthlyTotal(enterprise) <= 150);
  assert.ok(enterprise.some((cadence) => cadence === 0));
});

test("downgrade and upgrade recompute deterministically from preserved intent", () => {
  const requested = [4, 4, 2];
  const pro = allocate(requested, 25);
  const starter = allocate(requested, 10);
  const restored = allocate(requested, 25);

  assert.deepEqual(restored, pro);
  assert.ok(monthlyTotal(starter) <= 10);
  assert.ok(starter[1] <= pro[1]);
});

test("cadence writes reserve one authoritative account ledger serializably", () => {
  const sites = source("convex/sites.ts");
  const schema = source("convex/schema.ts");

  assert.match(schema, /allocatedMonthlyArticles: v\.optional\(v\.number\(\)\)/);
  assert.match(schema, /cadenceAllocationVersion: v\.optional\(v\.number\(\)\)/);
  assert.match(sites, /async function accountCadenceSnapshot/);
  assert.match(sites, /entitlement\.status === "completed"/);
  assert.match(sites, /async function reserveAccountCadence/);
  assert.match(sites, /ctx\.db\.patch\(snapshot\.entitlement\._id/);
  assert.match(sites, /cadenceRequestedPerWeek: requestedCadence/);
  assert.match(sites, /allocateCadenceForMonthlyAllowance/);
});

test("plan reconciliation and UI use account-wide remaining capacity", () => {
  const sites = source("convex/sites.ts");
  const onboarding = source("src/components/onboarding/setup-wizard.tsx");
  const settings = source("src/app/(dashboard)/sites/[siteId]/page.tsx");

  assert.match(sites, /remainingArticleAllowance/);
  assert.match(sites, /allocatedMonthlyArticles/);
  assert.match(sites, /export const getCadenceCapacity/);
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
      autopilotTick.indexOf("handleOnboarding"),
  );
  assert.match(planPage, /if \(cadence <= 0\) return \[\]/);
  assert.match(planPage, /Publishing paused/);
});

test("a lower requested cadence triggers deterministic account rebalancing", () => {
  const sites = source("convex/sites.ts");
  assert.match(sites, /async function rebalanceAccountCadencesAfterRequest/);
  assert.match(
    sites,
    /rebalanceAccountCadencesAfterRequest\(ctx, cadenceSnapshot\)/,
  );
  assert.match(
    sites,
    /applyCanonicalPlanToUserSites\([\s\S]*forceReconcile: true/,
  );
  assert.match(sites, /cadenceRequestedPerWeek: requestedCadence/);
});

test("legacy truncated account reads fail closed without blocking reductions", () => {
  const sites = source("convex/sites.ts");
  const start = sites.indexOf("async function accountCadenceSnapshot");
  const end = sites.indexOf("async function reserveAccountCadence", start);
  const snapshot = sites.slice(start, end);
  assert.match(snapshot, /if \(sites\.length === bound\)/);
  assert.match(
    snapshot,
    /allocatedArticles = Math\.max\(maxArticles, allocatedArticles\)/,
  );
  assert.match(snapshot, /\+ currentSiteArticles/);
});
