import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const sites = fs.readFileSync(new URL("../convex/sites.ts", import.meta.url), "utf8");
const schema = fs.readFileSync(new URL("../convex/schema.ts", import.meta.url), "utf8");

function exportedBlock(source: string, name: string): string {
  const start = source.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test("tenant deletion drains every site-scoped sensitive and growth table", () => {
  for (const table of [
    "outreach_messages",
    "outreach_contacts",
    "outreach_suppressions",
    "outreach_inboxes",
    "outcome_receipts",
    "outcome_daily_rollups",
    "outcome_ingest_credentials",
    "seo_authority_runs",
    "seo_authority_opportunities",
    "provider_spend_reservations",
    "legacy_publication_receipt_adoptions",
    "published_article_revisions",
    "seo_growth_actions",
    "seo_growth_health",
    "seo_growth_goals",
    "search_page_daily",
    "search_performance",
    "autopilot_alerts",
    "autopilot_health",
    "autopilot_runs",
    "article_summaries",
    "jobs",
    "topic_clusters",
    "pages",
    "articles",
    "usage_log",
  ]) {
    assert.match(sites, new RegExp(`"${table}"`), `${table} must be purged`);
  }
});

test("tenant deletion preserves quota consumption while scrubbing content references", () => {
  assert.match(
    sites,
    /SITE_DELETION_STAGES\[safeStage\] === "usage_log"[\s\S]*siteId: undefined[\s\S]*jobId: undefined[\s\S]*articleId: undefined/,
  );
  assert.match(schema, /Immutable user-level quota audit/);
});

test("tenant deletion preserves shared provider reservations without the site reference", () => {
  assert.match(
    sites,
    /SITE_DELETION_STAGES\[safeStage\] === "provider_spend_reservations"/,
  );
  assert.match(
    sites,
    /row\._id as Id<"provider_spend_reservations">[\s\S]*siteId: undefined/,
  );
});

test("credentials are revoked before resumable data deletion begins", () => {
  for (const field of [
    "githubToken",
    "wpAppPassword",
    "webhookSecret",
    "mediumToken",
    "linkedinAccessToken",
    "gscAccessToken",
    "gscRefreshToken",
    "gscEmail",
    "wpUsername",
    "webhookUrl",
    "oauthAccessToken",
    "oauthRefreshToken",
    "smtpPassword",
    "apiKey",
  ]) {
    assert.match(sites, new RegExp(`${field}: undefined`));
  }
  assert.match(sites, /continueSiteDeletionInternal/);
  assert.match(schema, /\.index\("by_site", \["siteId"\]\)/);
});

test("account reset preflights all site and article leases before scheduling", () => {
  const reset = sites.slice(
    sites.indexOf("export const resetAll"),
    sites.indexOf("export const fixOrphanSites"),
  );
  const firstSchedule = reset.indexOf("ctx.scheduler.runAfter");
  const articleLeaseCheck = reset.indexOf("leasedArticles.some");

  assert.ok(articleLeaseCheck >= 0);
  assert.ok(firstSchedule > articleLeaseCheck);
  assert.match(reset, /Cannot reset data while an article publication lease exists/);
});

test("deletion revokes every inbox and waits for captured actions to quiesce", () => {
  assert.match(sites, /SITE_DELETION_QUIESCENCE_MS = 20 \* 60 \* 1000/);
  assert.match(sites, /cancelAutonomousJobsForEpochTransition\([\s\S]*true/);
  assert.match(
    sites,
    /query\("outreach_inboxes"\)[\s\S]*withIndex\("by_site"[\s\S]*\.collect\(\)/,
  );
  assert.match(sites, /site\?\.deletionStatus \? null : site/);
  assert.match(sites, /filter\(\(site\) => !site\.deletionStatus\)/);
  assert.match(
    sites,
    /for \(let verifyStage = 0; verifyStage < SITE_DELETION_STAGES\.length; verifyStage\+\+\)[\s\S]*final_verification/,
  );
});

test("deletion cannot race a claimed Gmail send or erase an ambiguous outcome", () => {
  assert.match(sites, /gateSiteDeletionForOutreach/);
  assert.match(
    sites,
    /eq\("siteId", siteId\)\.eq\("status", "sending"\)/,
  );
  assert.match(
    sites,
    /eq\("siteId", siteId\)\.eq\("status", "delivery_unverified"\)/,
  );
  assert.match(sites, /Cannot delete a site while outreach delivery is in progress/);
  assert.match(
    sites,
    /status: "delivery_unverified"[\s\S]*will not be retried automatically/,
  );
  assert.match(
    sites,
    /if \(!outreachDeletion\.ready\)[\s\S]*scheduled: false[\s\S]*deferred: true/,
  );

  const outreach = fs.readFileSync(
    new URL("../convex/outreach.ts", import.meta.url),
    "utf8",
  );
  const claim = outreach.slice(
    outreach.indexOf("export const claimApprovedDelivery"),
    outreach.indexOf("export const getApprovedDeliveryEvidenceInternal"),
  );
  assert.match(claim, /siteExecutionAuthorized\(ctx, site\)/);
  assert.doesNotMatch(claim, /status: "approved"/);
});

test("OAuth completions cannot restore credentials after deletion starts", () => {
  const github = sites.slice(
    sites.indexOf("export const setGithubTokenInternal"),
    sites.indexOf("export const setGscTokenInternal"),
  );
  const gsc = sites.slice(
    sites.indexOf("export const setGscTokenInternal"),
    sites.indexOf("export const disconnectGsc"),
  );
  const outreach = fs.readFileSync(
    new URL("../convex/outreach.ts", import.meta.url),
    "utf8",
  );
  const gmail = outreach.slice(
    outreach.indexOf("export const connectGmailInboxInternal"),
    outreach.indexOf("export const setInboxComplianceProfile"),
  );
  for (const credentialWriter of [github, gsc, gmail]) {
    assert.match(
      credentialWriter,
      /(?:!site \|\| site\.deletionStatus|siteExecutionActive\(site\)|siteExecutionAuthorized\(ctx, site\))/,
    );
  }
});

test("ordinary owner mutations cannot revive a deleting tenant", () => {
  assert.match(
    sites,
    /async function requireSiteOwner[\s\S]*site\.deletionStatus[\s\S]*throw new Error\("Site not found"\)/,
  );
  const upsert = sites.slice(
    sites.indexOf("export const upsert"),
    sites.indexOf("export const updateSite"),
  );
  assert.match(upsert, /activeExistingSites = existingSites\.filter/);
  assert.match(upsert, /if \(existing\.deletionStatus\)/);
  const deletion = sites.slice(
    sites.indexOf("export const deleteSite"),
    sites.indexOf("export const listAllForAutopilot"),
  );
  assert.match(deletion, /requireSiteOwnerIncludingDeleting/);
});

test("GSC persistence and growth reconciliation fence tenant deletion", () => {
  const performance = fs.readFileSync("convex/searchPerformance.ts", "utf8");
  const growth = fs.readFileSync("convex/seoGrowth.ts", "utf8");
  for (const marker of ["export const upsertBatch", "export const upsertPageBatch"]) {
    const start = performance.indexOf(marker);
    const end = performance.indexOf("\n});", start);
    const block = performance.slice(start, end);
    assert.match(block, /ctx\.db\.get\(siteId\)/);
    assert.match(block, /siteExecutionAuthorized\(ctx, site\)/);
  }
  const reconcileStart = growth.indexOf("export const reconcileSite");
  const reconcileEnd = growth.indexOf(
    "export const recordAuthorityDiscovery",
    reconcileStart,
  );
  const reconcile = growth.slice(reconcileStart, reconcileEnd);
  assert.match(reconcile, /const currentSite = await ctx\.db\.get\(siteId\)/);
  assert.match(reconcile, /siteExecutionAuthorized\(ctx, currentSite\)/);
});

test("authority and outreach writers cannot recreate rows after deletion starts", () => {
  const authority = fs.readFileSync(
    new URL("../convex/seoAuthority.ts", import.meta.url),
    "utf8",
  );
  const outreach = fs.readFileSync(
    new URL("../convex/outreach.ts", import.meta.url),
    "utf8",
  );
  const writers = [
    exportedBlock(authority, "upsertVerifiedBatch"),
    exportedBlock(authority, "markOutreachPrepared"),
    exportedBlock(outreach, "upsertContact"),
    exportedBlock(outreach, "insertDraft"),
    exportedBlock(sites, "recordSeoAuthorityEvidenceInternal"),
  ];

  for (const writer of writers) {
    assert.match(writer, /ctx\.db\.get\((?:args\.)?siteId\)/);
    assert.match(
      writer,
      /(?:siteExecutionActive\(site\)|siteExecutionAuthorized\(ctx, site\))/,
    );
    const writes = [writer.indexOf("ctx.db.insert"), writer.indexOf("ctx.db.patch")]
      .filter((index) => index >= 0);
    assert.ok(writes.length > 0, "writer must persist a row or patch");
    const guardIndex = Math.max(
      writer.indexOf("siteExecutionActive(site)"),
      writer.indexOf("siteExecutionAuthorized(ctx, site)"),
    );
    assert.ok(
      guardIndex >= 0 && guardIndex < Math.min(...writes),
      "the current deletion state must be read before any insert or patch",
    );
  }
});

test("scheduler site limits ignore tenants already in deletion quiescence", () => {
  const boundedCount = sites.match(
    /export const countByUserBounded = internalQuery\([\s\S]*?\n}\);/,
  )?.[0];

  assert.ok(boundedCount, "countByUserBounded should remain available");
  assert.match(
    boundedCount,
    /q\.eq\(q\.field\("deletionStatus"\), undefined\)/,
  );
});

test("outcome credential rotation cannot revive a deleting tenant", () => {
  const outcomes = fs.readFileSync(
    new URL("../convex/outcomes.ts", import.meta.url),
    "utf8",
  );
  const ownerGuard = outcomes.slice(
    outcomes.indexOf("async function requireSiteOwner"),
    outcomes.indexOf("async function credentialForSite"),
  );
  const credentialCheck = outcomes.slice(
    outcomes.indexOf("export const canManageCredentialInternal"),
    outcomes.indexOf("export const storeRotatedCredentialInternal"),
  );
  const credentialStore = outcomes.slice(
    outcomes.indexOf("export const storeRotatedCredentialInternal"),
    outcomes.indexOf("export const getIngestCredentialStatus"),
  );

  assert.match(ownerGuard, /site\.deletionStatus/);
  assert.match(credentialCheck, /!site\.deletionStatus/);
  assert.match(credentialStore, /site\.deletionStatus/);
});
