import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  selectPlanEntitledSiteIds,
  siteExecutionActive,
} from "../convex/lib/planSiteAllowance.ts";

function source(path: string): string {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exportedBlock(text: string, name: string): string {
  const start = text.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = text.indexOf("\nexport const ", start + 1);
  return text.slice(start, next < 0 ? text.length : next);
}

test("canonical site allowance always selects oldest non-deleting sites", () => {
  const candidates = [
    { siteId: "site-c", creationTime: 300 },
    { siteId: "site-b", creationTime: 100 },
    { siteId: "site-a", creationTime: 100 },
    { siteId: "site-deleting", creationTime: 1, deleting: true },
  ];

  assert.deepEqual(
    [...selectPlanEntitledSiteIds(candidates, 1)],
    ["site-a"],
  );
  assert.deepEqual(
    [...selectPlanEntitledSiteIds(candidates, 3)],
    ["site-a", "site-b", "site-c"],
  );
  assert.deepEqual([...selectPlanEntitledSiteIds(candidates, 0)], []);
});

test("parked and deleting sites are readable records but never executable", () => {
  assert.equal(siteExecutionActive({}), true);
  assert.equal(siteExecutionActive({ planParkedAt: 123 }), false);
  assert.equal(siteExecutionActive({ deletionStatus: "running" }), false);
  assert.equal(siteExecutionActive({ domainOwnershipConflictAt: 123 }), false);
  assert.equal(siteExecutionActive(null), false);
});

test("trusted plan sync parks excess sites without deleting configuration", () => {
  const sites = source("convex/sites.ts");
  const schema = source("convex/schema.ts");
  const sync = exportedBlock(sites, "syncPlanFeaturesInternal");
  const helperStart = sites.indexOf("async function reconcileCanonicalPlanSitePage");
  const helperEnd = sites.indexOf("async function requireSiteOwnerIncludingDeleting");
  const helper = sites.slice(helperStart, helperEnd);

  assert.match(schema, /planParkedAt: v\.optional\(v\.number\(\)\)/);
  assert.match(sync, /applyCanonicalPlanToUserSites\(ctx, userId, planFeatures\)/);
  assert.match(helper, /selectPlanEntitledSiteIds/);
  assert.match(helper, /creationTime: site\._creationTime/);
  assert.match(helper, /planParkedAt: shouldPark \? timestamp : undefined/);
  assert.match(helper, /autopilotRolloutEpoch:[\s\S]*\+ 1/);
  assert.match(
    helper,
    /cancelAutonomousJobsForEpochTransition\([\s\S]*site moved outside the current plan allowance[\s\S]*true/,
  );
  for (const secret of ["githubToken", "gscRefreshToken", "wpAppPassword"]) {
    assert.doesNotMatch(helper, new RegExp(`${secret}: undefined`));
  }
});

test("new sites inherit the canonical plan and cannot bypass parked inventory", () => {
  const sites = source("convex/sites.ts");
  const upsert = exportedBlock(sites, "upsert");
  assert.match(
    upsert,
    /activeExistingSites = existingSites\.filter[\s\S]*!site\.deletionStatus/,
  );
  assert.match(upsert, /activeExistingSites\.length >= limits\.maxSites/);
  assert.match(upsert, /ctx\.db\.insert\("sites", \{[\s\S]*planFeatures,/);
  assert.doesNotMatch(
    upsert.slice(0, upsert.indexOf("const planFeatures")),
    /planParkedAt/,
  );
});

test("all autonomous fleet projections exclude parked sites", () => {
  const sites = source("convex/sites.ts");
  for (const name of [
    "listAllForAutopilot",
    "listAutopilotPage",
    "listGrowthPage",
    "listExpectedClickBackfillFleetPage",
    "listOutreachFleetPage",
    "countByUserBounded",
  ]) {
    assert.match(exportedBlock(sites, name), /planParkedAt/);
  }
  const autopilot = source("convex/autopilot.ts");
  assert.match(exportedBlock(autopilot, "dispatchActiveSites"), /planParkedAt/);
  assert.match(exportedBlock(autopilot, "auditSla"), /planParkedAt/);
  assert.match(exportedBlock(autopilot, "getFleetReadiness"), /planParkedAt/);
});

test("manual queue paths and atomic generation reservation re-read current allowance", () => {
  const jobs = source("convex/jobs.ts");
  const pipeline = source("convex/actions/pipeline.ts");
  const reserve = exportedBlock(jobs, "reserveGenerationSlot");
  const runQueued = exportedBlock(jobs, "runQueuedTopic");
  const queueNow = exportedBlock(jobs, "queueArticleNow");
  const allowanceStart = jobs.indexOf("async function currentSitePlanAllowance");
  const allowanceEnd = jobs.indexOf("export const listPending", allowanceStart);
  const allowance = jobs.slice(allowanceStart, allowanceEnd);
  const reservationCallStart = pipeline.indexOf("internal.jobs.reserveGenerationSlot");
  const reservationCall = pipeline.slice(reservationCallStart, reservationCallStart + 350);

  assert.match(reserve, /ctx\.db\.get\(args\.siteId\)/);
  assert.match(reserve, /currentSitePlanAllowance\(ctx, site\)/);
  assert.match(allowance, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(allowance, /entitlement\?\.planFeatures \?\? site\.planFeatures/);
  assert.doesNotMatch(reserve.slice(0, reserve.indexOf("handler:")), /userId|maxArticles/);
  assert.doesNotMatch(reservationCall, /userId|maxArticles/);
  assert.match(runQueued, /currentSitePlanAllowance\(ctx, requestedSite\)/);
  assert.ok(
    runQueued.indexOf("currentSitePlanAllowance") <
      runQueued.indexOf("activeJobsForSite"),
  );
  assert.match(queueNow, /currentSitePlanAllowance\(ctx, site\)/);
});

test("provider, growth, and publication boundaries fail closed for parked sites", () => {
  const sharedProvider = source("convex/lib/providerSpendReservation.ts");
  const planProvider = source("convex/lib/planProviderReservation.ts");
  const growth = source("convex/seoGrowth.ts");
  const authority = source("convex/seoAuthority.ts");
  const articles = source("convex/articles.ts");
  const revisions = source("convex/publishedRevisions.ts");

  assert.match(sharedProvider, /siteExecutionActive\(site\)/);
  assert.match(planProvider, /reason: "site_parked"/);
  assert.match(exportedBlock(growth, "getSiteInputs"), /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(exportedBlock(growth, "reconcileSite"), /siteExecutionAuthorized\(ctx, currentSite\)/);
  assert.match(
    exportedBlock(authority, "reserveDiscoveryRun"),
    /siteExecutionAuthorized\(ctx, site\)/,
  );
  assert.match(exportedBlock(articles, "beginPublication"), /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(exportedBlock(revisions, "claimExecution"), /siteExecutionAuthorized\(ctx, site\)/);
});

test("outreach blocks a parked pre-send claim but preserves post-send receipt finalization", () => {
  const outreach = source("convex/outreach.ts");
  const claim = exportedBlock(outreach, "claimApprovedDelivery");
  const complete = exportedBlock(outreach, "completeDeliveryAttempt");

  assert.match(claim, /siteExecutionAuthorized\(ctx, site\)/);
  assert.ok(claim.indexOf("siteExecutionAuthorized(ctx, site)") < claim.indexOf('status: "sending"'));
  assert.doesNotMatch(complete, /siteExecutionActive/);
  assert.match(complete, /status: "sent"/);
});

test("an in-flight exact external receipt survives a later plan transition", () => {
  const articles = source("convex/articles.ts");
  const revisions = source("convex/publishedRevisions.ts");
  const begin = exportedBlock(articles, "beginPublication");
  const complete = exportedBlock(articles, "completePublication");
  const revisionAttempt = exportedBlock(revisions, "recordAttempted");
  const revisionDelivery = exportedBlock(revisions, "recordDelivery");

  assert.ok(
    begin.indexOf("siteExecutionAuthorized(ctx, site)") <
      begin.indexOf("acquirePublicationLease"),
  );
  assert.match(complete, /executionLeasePredatesPlanTransition/);
  assert.match(complete, /normalSettlementAuthorized/);
  assert.match(complete, /receiptOnlyPlanTransition/);
  assert.match(complete, /site\.publicationLeaseOwner !== leaseOwner/);
  assert.match(complete, /currentConfigHash !== expectedConfigHash/);
  assert.ok(
    revisionAttempt.indexOf("siteExecutionAuthorized(ctx, site)") <
      revisionAttempt.indexOf('status: "attempted"'),
  );
  assert.match(revisionDelivery, /executionLeasePredatesPlanTransition/);
  assert.match(revisionDelivery, /receiptOnlyPlanTransition/);
  assert.match(revisionDelivery, /validatePublishedRevisionReceipt/);
});

test("plan reconciliation is bounded, recoverable, idempotent, and reactivates after deletion", () => {
  const sites = source("convex/sites.ts");
  const crons = source("convex/crons.ts");
  const applyStart = sites.indexOf("async function applyCanonicalPlanToUserSites");
  const applyEnd = sites.indexOf("async function requireSiteOwnerIncludingDeleting");
  const apply = sites.slice(applyStart, applyEnd);
  const deletion = exportedBlock(sites, "continueSiteDeletionInternal");

  assert.match(apply, /status === "completed"/);
  assert.match(apply, /unchanged: true/);
  assert.match(apply, /options\?\.forceReconcile !== true/);
  assert.match(sites, /PLAN_SITE_RECONCILIATION_PAGE_SIZE = 25/);
  assert.match(sites, /continuePlanFeatureSyncInternal/);
  assert.match(sites, /recoverStalePlanFeatureSyncsInternal/);
  assert.match(crons, /plan-entitlement-reconciliation-recovery/);
  assert.ok(deletion.indexOf("ctx.db.delete(siteId)") < deletion.indexOf("forceReconcile: true"));
  assert.match(sites, /autopilotRolloutMode: "observe"/);
});

test("enterprise site allowance is truly unbounded while account plan work stays bounded", () => {
  const sites = source("convex/sites.ts");
  const provider = source("convex/lib/planProviderReservation.ts");
  const schema = source("convex/schema.ts");
  const sitesPage = source("src/app/(dashboard)/sites/page.tsx");
  const dashboard = source("src/app/(dashboard)/dashboard/page.tsx");

  assert.match(sites, /limits\.maxSites >= 9999 \? Number\.MAX_SAFE_INTEGER/);
  assert.match(provider, /by_user_purpose_created/);
  assert.match(provider, /\.take\(limits\.maxArticles \+ 1\)/);
  assert.match(schema, /index\("by_user_purpose_created", \["userId", "purpose", "createdAt"\]\)/);
  assert.match(sitesPage, /maxSites < 9999 &&/);
  assert.match(dashboard, /maxSites < 9999 &&/);
});

test("job and expected-click provider claims pause during account reconciliation", () => {
  const jobs = source("convex/jobs.ts");
  for (const name of ["markRunning", "claimPending", "heartbeatWorker"]) {
    assert.match(exportedBlock(jobs, name), /siteExecutionAuthorized\(ctx, site\)/);
  }
  for (const path of [
    "convex/expectedClickDemandBackfill.ts",
    "convex/expectedClickEvidenceBackfill.ts",
  ]) {
    const file = source(path);
    assert.match(exportedBlock(file, "claimWorker"), /siteExecutionAuthorized\(ctx, site\)/);
    const requireStart = file.indexOf("async function requireWorker");
    const requireEnd = file.indexOf("async function", requireStart + 20);
    assert.match(file.slice(requireStart, requireEnd), /siteExecutionAuthorized\(ctx, site\)/);
  }
});

test("autopilot cannot schedule or mutate rollout during account reconciliation", () => {
  const autopilot = source("convex/autopilot.ts");
  for (const name of [
    "dispatchActiveSites",
    "dispatchSiteFollowup",
    "recoverFailedPublicUrlVerifiedFollowup",
    "promoteWarmSiteIfReady",
    "scheduleCadenceDeadline",
    "markRunStarted",
    "recordTopicPortfolioAudit",
    "auditSla",
    "refreshSiteCadenceHealth",
  ]) {
    assert.match(
      exportedBlock(autopilot, name),
      /siteExecutionAuthorized\(ctx, site\)/,
      `${name} must re-read the account entitlement`,
    );
  }
  assert.match(
    exportedBlock(autopilot, "markRunFinished"),
    /siteExecutionAuthorized\(ctx, runSite\)/,
  );
});

test("GSC staged writers re-check entitlement at every transition", () => {
  const searchPerformance = source("convex/searchPerformance.ts");
  for (const name of [
    "upsert",
    "upsertBatch",
    "upsertPageBatch",
    "beginSyncEpoch",
    "completeSyncEpoch",
    "recordUrlInspection",
  ]) {
    assert.match(
      exportedBlock(searchPerformance, name),
      /siteExecutionAuthorized\(ctx, site\)/,
      `${name} must pause during account entitlement reconciliation`,
    );
  }
});

test("outreach fleet verification cannot bypass a reconciling account", () => {
  const sites = source("convex/sites.ts");
  const outreachAction = source("convex/actions/outreach.ts");
  assert.match(
    exportedBlock(sites, "listOutreachFleetPage"),
    /siteExecutionAuthorized\(ctx, site\)/,
  );
  assert.match(
    exportedBlock(sites, "getOutreachFleetState"),
    /siteExecutionAuthorized\(ctx, site\)/,
  );
  const verification = exportedBlock(
    outreachAction,
    "verifyAcquiredLinksInternal",
  );
  assert.match(verification, /internal\.sites\.getFull/);
  assert.ok(
    verification.indexOf("internal.sites.getFull") <
      verification.indexOf("verifyHandler"),
  );
});

test("owner site responses explain parking while preserving the record", () => {
  const security = source("convex/lib/siteSecurity.ts");
  assert.match(security, /planAccessStatus: "active" \| "parked"/);
  assert.match(security, /outside your current plan's site allowance/);
  assert.match(security, /data and integrations are preserved/);
});

test("dashboard parking UX is truthful and links to the real upgrade flow", () => {
  const banner = source("src/components/layout/over-limit-banner.tsx");
  const sidebar = source("src/components/layout/sidebar.tsx");

  assert.match(banner, /planAccessStatus === "parked"/);
  assert.match(banner, /Active entitled sites continue running normally/);
  assert.match(banner, /activeSite\.planAccessReason/);
  assert.match(banner, /href="\/upgrade"/);
  assert.doesNotMatch(banner, /href="\/pricing"/);
  assert.doesNotMatch(banner, /continue generating articles/);
  assert.match(sidebar, /Parked by plan/);
  assert.match(sidebar, /isPlanLoaded && isFreePlan/);
  assert.ok(
    sidebar.indexOf('activeSite.planAccessStatus === "parked"') <
      sidebar.indexOf('activeSite.autopilotEnabled !== false'),
  );
});
