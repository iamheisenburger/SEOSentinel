import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path: string): string {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function exportedBlock(text: string, name: string): string {
  const start = text.indexOf(`export const ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = text.indexOf("\nexport const ", start + 1);
  return text.slice(start, end < 0 ? text.length : end);
}

test("trusted account deletion HTTP boundary is authenticated and bounded", () => {
  const http = source("convex/http.ts");
  const start = http.indexOf('path: "/account-deletion"');
  const end = http.indexOf("// This endpoint", start);
  const route = http.slice(start, end);

  assert.ok(start >= 0);
  assert.match(route, /if \(!isAuthorized\(request\)\)/);
  assert.match(route, /body\.userId\.startsWith\("user_"\)/);
  assert.match(route, /body\.userId\.length > 512/);
  assert.match(route, /internal\.sites\.requestAccountDeletionInternal/);
  assert.doesNotMatch(route, /console\./);
});

test("verified deletion atomically fences execution before asynchronous purge", () => {
  const sites = source("convex/sites.ts");
  const allowance = source("convex/lib/planSiteAllowance.ts");
  const request = exportedBlock(sites, "requestAccountDeletionInternal");
  const planApplyStart = sites.indexOf("async function applyCanonicalPlanToUserSites");
  const planApplyEnd = sites.indexOf(
    "async function requireSiteOwnerIncludingDeleting",
    planApplyStart,
  );
  const planApply = sites.slice(planApplyStart, planApplyEnd);

  assert.match(request, /status: "deleting"/);
  assert.match(request, /account_plan_entitlements/);
  assert.ok(
    request.indexOf('status: "deleting"') <
      request.indexOf("continueAccountDeletionPage"),
  );
  assert.match(request, /by_account_key/);
  assert.match(request, /alreadyRequested: true/);
  assert.match(planApply, /existing\?\.status === "deleting"/);
  assert.match(planApply, /deleting: true/);
  assert.match(planApply, /account_deletion_receipts/);
  assert.match(planApply, /accountDeletionKey\(userId\)/);
  const upsert = exportedBlock(sites, "upsert");
  assert.match(upsert, /account_deletion_receipts/);
  assert.match(upsert, /account has been deleted/);
  const updateSite = exportedBlock(sites, "updateSite");
  assert.match(updateSite, /account_deletion_receipts/);
  assert.match(updateSite, /site\.accountDeletionRequestedAt \|\| accountDeletion/);
  assert.ok(
    updateSite.indexOf("account_deletion_receipts") <
      updateSite.indexOf("ctx.db.patch(siteId"),
  );
  assert.match(request, /unexpectedSite/);
  assert.match(request, /status: "revoking"/);
  assert.match(allowance, /account_deletion_receipts/);
  assert.match(allowance, /accountDeletionKey\(site\.userId!\)/);
  assert.match(allowance, /if \(deletionReceipt\) return false/);
});

test("credential revocation is bounded, resumable, and cannot be restored late", () => {
  const sites = source("convex/sites.ts");
  const outreach = source("convex/outreach.ts");
  const crons = source("convex/crons.ts");
  const github = exportedBlock(sites, "setGithubTokenInternal");
  const gsc = exportedBlock(sites, "setGscTokenInternal");

  assert.match(sites, /ACCOUNT_DELETION_SITE_PAGE_SIZE = 5/);
  assert.match(sites, /async function continueAccountDeletionPage/);
  assert.match(sites, /revokeSiteCredentialsForAccountDeletion/);
  for (const credential of [
    "githubToken",
    "wpAppPassword",
    "webhookSecret",
    "gscAccessToken",
    "gscRefreshToken",
    "oauthAccessToken",
    "oauthRefreshToken",
  ]) {
    assert.match(sites, new RegExp(`${credential}: undefined`));
  }
  assert.match(github, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(gsc, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(outreach, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(crons, /account-deletion-recovery/);
  assert.match(crons, /recoverAccountDeletionsInternal/);
});

test("account purge respects external leases and never retries an ambiguous write", () => {
  const sites = source("convex/sites.ts");
  const finalize = exportedBlock(
    sites,
    "finalizeAccountSiteDeletionInternal",
  );

  assert.match(sites, /SITE_DELETION_QUIESCENCE_MS = 20 \* 60 \* 1000/);
  assert.match(finalize, /publicationLeaseExpiresAt/);
  assert.match(finalize, /deliveryLeaseExpiresAt/);
  assert.ok(
    finalize.indexOf("safeAfter > timestamp") <
      finalize.indexOf('deletionStatus: "running"'),
  );
  assert.match(finalize, /status: "unverified"/);
  assert.match(finalize, /will not be retried/);
  assert.doesNotMatch(finalize, /publishTo|sendGmail|fetch\(/);
});

test("completion retains only scrubbed billing and abuse receipts", () => {
  const sites = source("convex/sites.ts");
  const schema = source("convex/schema.ts");
  const finalize = exportedBlock(sites, "finalizeAccountDeletionInternal");

  assert.match(schema, /account_deletion_receipts: defineTable/);
  assert.match(schema, /userId: v\.optional\(v\.string\(\)\)/);
  for (const table of [
    "article_generation_attempts",
    "provider_spend_reservations",
    "usage_log",
  ]) {
    assert.match(finalize, new RegExp(`"${table}"`));
  }
  assert.match(finalize, /accountDeletionTombstoneUserId/);
  assert.match(finalize, /userId: undefined/);
  assert.match(finalize, /sourceEventKey: undefined/);
  assert.match(finalize, /status: "completed"/);
  assert.match(finalize, /ctx\.db\.delete\(entitlement\._id\)/);
});

test("verified deletion scrubs outreach owned through a foreign current site", () => {
  const sites = source("convex/sites.ts");
  const schema = source("convex/schema.ts");
  const finalize = exportedBlock(sites, "finalizeAccountDeletionInternal");
  const siteDeletion = exportedBlock(sites, "continueSiteDeletionInternal");

  assert.match(schema, /index\("by_credential_owner", \["credentialOwnerAccountKey"\]\)/);
  assert.match(schema, /index\("by_delivery_owner", \["deliveryOwnerAccountKey"\]\)/);
  assert.match(schema, /index\("by_inbox", \["inboxId"\]\)/);
  assert.match(schema, /outreach_contacts: defineTable\([\s\S]*ownerAccountKey: v\.optional/);
  assert.match(schema, /outreach_suppressions: defineTable\([\s\S]*ownerAccountKey: v\.optional/);
  assert.ok((schema.match(/ownerLineageUnresolvedAt: v\.optional/g) ?? []).length >= 2);
  assert.ok((schema.match(/index\("by_site_owner_unresolved"/g) ?? []).length >= 2);
  assert.match(finalize, /outreach_foreign_owner_messages/);
  const foreignMessageStage = sites.slice(
    sites.indexOf('case "outreach_foreign_owner_messages"'),
    sites.indexOf('case "outreach_foreign_owner_contacts"'),
  );
  assert.match(foreignMessageStage, /withIndex\("by_owner"/);
  assert.match(foreignMessageStage, /withIndex\("by_delivery_owner"/);
  assert.match(finalize, /outreach_foreign_owner_contacts/);
  assert.match(finalize, /outreach_foreign_owner_suppressions/);
  assert.match(finalize, /outreach_foreign_owner_inboxes/);
  assert.match(finalize, /scrubForeignAccountOutreachMessage/);
  assert.match(finalize, /deliveryLeaseExpiresAt/);
  assert.match(sites, /outreach_inbound_relay_receipts/);
  assert.match(sites, /outreach_inbound_relay_canaries/);
  assert.match(sites, /outreach_imap_receipts/);
  assert.match(sites, /withIndex\("by_owner"/);
  const foreignInboxBranch = finalize.slice(
    finalize.indexOf('name === "outreach_foreign_owner_inboxes"'),
    finalize.indexOf('name === "outreach_foreign_owner_contacts"'),
  );
  assert.match(foreignInboxBranch, /withIndex\("by_site_owner_unresolved"/);
  assert.match(foreignInboxBranch, /\.eq\("ownerAccountKey", undefined\)/);
  assert.match(foreignInboxBranch, /ownerLineageUnresolvedAt: unresolvedAt/);
  assert.doesNotMatch(foreignInboxBranch, /withIndex\("by_site",/);
  assert.doesNotMatch(
    foreignInboxBranch,
    /\.eq\("ownerAccountKey", accountDeletionKey\(receipt\.userId\)\)/,
  );
  assert.match(siteDeletion, /verifiedAccountDeletion/);
  assert.match(siteDeletion, /recordUnlinkedDurablePacingReceipt/);
  assert.doesNotMatch(
    siteDeletion,
    /settlementAccountKey[\s\S]{0,180}accountDeletionKey\(site\.userId\)/,
  );
});

test("deleted account keys cannot be resurrected by late outreach settlement", () => {
  const accountDeletion = source("convex/lib/accountDeletion.ts");
  const durability = source("convex/lib/outreachDurability.ts");
  const suppression = source("convex/lib/outreachSuppression.ts");
  const outreach = source("convex/outreach.ts");

  assert.match(accountDeletion, /accountDeletionRequestedForKey/);
  assert.match(accountDeletion, /account_deletion_receipts/);
  assert.match(durability, /accountDeletionRequestedForKey\(ctx, accountKey\)/);
  assert.match(durability, /recordUnlinkedDurablePacingReceipt/);
  assert.match(suppression, /accountDeletionRequestedForKey\(ctx, accountKey\)/);
  const relay = exportedBlock(outreach, "recordInboundRelayReceipt");
  assert.match(relay, /settlementOwnerDeleting/);
  assert.ok(
    relay.indexOf("settlementOwnerDeleting") <
      relay.indexOf('ctx.db.insert("outreach_inbound_relay_receipts"'),
  );
});

test("account deletion recovery resumes an interrupted running site purge", () => {
  const sites = source("convex/sites.ts");
  const finalize = exportedBlock(sites, "finalizeAccountDeletionInternal");
  assert.match(finalize, /remainingSite\.deletionStatus === "running"/);
  assert.match(finalize, /internal\.sites\.continueSiteDeletionInternal/);
  assert.match(
    finalize,
    /stage: Math\.max\(0, Math\.floor\(remainingSite\.deletionStage \?\? 0\)\)/,
  );
});

test("site deletion never mints an authoritative receipt from a stale site mirror", () => {
  const sites = source("convex/sites.ts");
  const deletion = exportedBlock(sites, "continueSiteDeletionInternal");
  assert.match(deletion, /currentEntitlement &&/);
  assert.match(deletion, /currentEntitlement\.planFeatures/);
  assert.doesNotMatch(
    deletion,
    /currentEntitlement\?\.planFeatures \?\? site\.planFeatures/,
  );
});
