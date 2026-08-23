import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("src/app/(dashboard)/backlinks/page.tsx", "utf8");
const authority = readFileSync("convex/seoAuthority.ts", "utf8");
const legacyActions = readFileSync("convex/actions/backlinks.ts", "utf8");

test("Backlinks dashboard reads the tenant's durable authority and outreach ledgers", () => {
  assert.match(dashboard, /api\.seoAuthority\.listForSite/);
  assert.match(dashboard, /api\.outreach\.listMessages/);
  assert.match(dashboard, /api\.outreach\.getInbox/);
  assert.doesNotMatch(dashboard, /setProfile|setOpportunities|setOutreachEmails/);
  assert.doesNotMatch(dashboard, /api\.actions\.backlinks\.generateOutreach/);
});

test("authority ledger query is owner-scoped and includes terminal evidence states", () => {
  const listForSite = authority.slice(
    authority.indexOf("export const listForSite"),
    authority.indexOf("export const listVerifiedInternal"),
  );
  assert.match(listForSite, /await requireSiteOwner\(ctx, siteId\)/);
  for (const status of [
    "verified",
    "outreach_prepared",
    "contacted",
    "acquired",
    "rejected",
  ]) {
    assert.match(listForSite, new RegExp(`"${status}"`));
  }
  assert.match(listForSite, /q\.eq\("siteId", siteId\)\.eq\("status", status\)/);
});

test("Backlinks workflow keeps approval, send, verification and blocked evidence visible", () => {
  assert.match(dashboard, /api\.actions\.outreach\.prepareOutreach/);
  assert.match(dashboard, /api\.outreach\.approveMessage/);
  assert.match(dashboard, /api\.actions\.outreach\.sendApprovedOutreach/);
  assert.match(dashboard, /api\.actions\.outreach\.verifyAcquiredLinks/);
  assert.match(dashboard, /blockedReason/);
  assert.match(dashboard, /pacingReason/);
  assert.match(dashboard, /complianceIssues/);
  assert.match(dashboard, /failureReason/);
  assert.match(dashboard, /Exact href observed on the requested page/);
  assert.match(dashboard, /Draft approved\. It has not been sent yet\./);
  assert.match(dashboard, /Send next approved \(1 of/);
  assert.match(dashboard, /api\.actions\.outreach\.syncInboundReplies/);
  assert.match(dashboard, /Check replies/);
  assert.match(dashboard, /Inbound message bodies are processed transiently and are not stored/);
  assert.match(dashboard, /api\.outreach\.suppress/);
  assert.match(dashboard, /Record opt-out/);
  assert.match(dashboard, /api\.outreach\.resolveUnverifiedDelivery/);
  assert.match(dashboard, /Found in Sent/);
  assert.match(dashboard, /Not in Sent/);
  assert.doesNotMatch(dashboard, /Every draft, block, approval, send, failure, and reply remains visible/);
});

test("bounded outreach preparation reports partial queue work honestly", () => {
  assert.match(dashboard, /prepareOutreach\(\{ siteId: site\._id, limit: 25 \}\)/);
  assert.match(dashboard, /result\.partial/);
  assert.match(dashboard, /result\.deferredAtLeast/);
  assert.match(dashboard, /result\.stopReason/);
});

test("Gmail connection starts through the tenant-scoped OAuth entry point", () => {
  assert.match(dashboard, /\/api\/outreach\/gmail\/auth\?siteId=/);
  assert.match(dashboard, /returnTo=.*backlinks/);
  assert.match(dashboard, /Connect a secondary-domain Gmail inbox/);
  assert.match(dashboard, /approval mode/);
  assert.match(dashboard, /credentialsPresent/);
  assert.match(dashboard, /spfVerifiedAt/);
  assert.match(dashboard, /dkimVerifiedAt/);
  assert.match(dashboard, /dmarcVerifiedAt/);
});

test("the legacy client-supplied outreach generator fails closed", () => {
  const legacy = legacyActions.slice(
    legacyActions.indexOf("export const generateOutreach"),
  );
  assert.match(legacy, /await requireOwnedSite\(ctx, siteId\)/);
  assert.match(legacy, /Legacy outreach generation is disabled/);
  assert.doesNotMatch(legacy, /anthropic\.messages\.create/);
  assert.doesNotMatch(legacy, /markOutreachPrepared/);
});
