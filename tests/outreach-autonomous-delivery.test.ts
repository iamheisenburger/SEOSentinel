import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = readFileSync("convex/outreach.ts", "utf8");
const action = readFileSync("convex/actions/outreach.ts", "utf8");
const fleet = readFileSync("convex/actions/outreachFleet.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const crons = readFileSync("convex/crons.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");
const authority = readFileSync("convex/seoAuthority.ts", "utf8");

test("one-time autonomy is explicit, versioned, inbox-bound and kill-switchable", () => {
  const enable = backend.slice(
    backend.indexOf("export const enableAutonomousOutreach"),
    backend.indexOf("export const disconnectInbox"),
  );
  assert.match(enable, /OUTREACH_AUTONOMOUS_DELIVERY_ENABLED/);
  assert.match(enable, /OUTREACH_AUTONOMY_CONSENT_VERSION/);
  assert.match(enable, /OUTREACH_AUTONOMY_POLICY_HASH/);
  assert.match(enable, /confirmsAutomaticSending/);
  assert.match(enable, /confirmsBusinessRecipientsAndLawfulBasis/);
  assert.match(enable, /confirmsSenderIdentityAndAddress/);
  assert.match(enable, /acceptsMailboxReputationRisk/);
  assert.match(enable, /autonomyConsentInboxConfigurationVersion/);
  assert.match(enable, /inboundRelayDsnRoutingReady/);
  assert.match(enable, /OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP/);

  const disable = backend.slice(
    backend.indexOf("export const setInboxMode"),
    backend.indexOf("export const enableAutonomousOutreach"),
  );
  assert.match(disable, /mode !== "approval"/);
  assert.match(disable, /autonomyDisabledAt/);
  assert.match(disable, /approvalKind", "account_autopilot"/);
  assert.doesNotMatch(
    disable,
    /assertNoActiveDelivery/,
    "a kill switch must stop new claims even while one already-claimed send settles",
  );
});

test("owner approval and account-autopilot authorization cannot cross release paths", () => {
  const claim = backend.slice(
    backend.indexOf("export const claimApprovedDelivery"),
    backend.indexOf("export const getApprovedDeliveryEvidenceInternal"),
  );
  assert.match(claim, /deliveryReleaseValidator/);
  assert.match(claim, /autonomousMessageAuthorizationMatches/);
  assert.match(claim, /message\.approvalKind === "account_autopilot"/);
  assert.match(claim, /release === "automatic" && !inboundRelay/);
  assert.match(claim, /isSeoGrowthActuationEligible\(site\)/);
  assert.match(claim, /message\.scheduledAt/);
  assert.match(claim, /outreachSendDecision\(\{ inbox, now, release \}\)/);

  assert.match(action, /sendHandler\(ctx, siteId, "approved"\)/);
  assert.match(action, /sendHandler\(ctx, siteId, "automatic"\)/);
  assert.match(action, /export const sendAutomaticOutreachInternal = internalAction/);
  assert.doesNotMatch(action, /export const sendAutomaticOutreach = action/);
});

test("fleet delivery is due-only, tenant-isolated and rechecked before Gmail", () => {
  assert.match(sites, /by_site_status_autonomy_consent_scheduled/);
  assert.match(sites, /approvalKind", "account_autopilot"/);
  assert.match(sites, /autonomousOutreachConsentActive\(inbox, site\.userId\)/);
  assert.match(fleet, /hasDueAutomaticMessages === true/);
  assert.match(fleet, /internal\.sites\.getOutreachFleetState/);
  assert.match(fleet, /sendAutomaticOutreachInternal/);
  assert.match(crons, /outreach-autonomous-delivery-fleet/);
  assert.match(crons, /phase: "delivery"/);
  assert.match(schema, /by_site_status_autonomy_consent_scheduled/);
});

test("a verified receipt atomically creates at most two threaded follow-ups", () => {
  const completion = backend.slice(
    backend.indexOf("export const completeDeliveryAttempt"),
    backend.indexOf("export const failDeliveryAttempt"),
  );
  assert.match(completion, /message\.sequenceStep < MAX_SEQUENCE_STEP/);
  assert.match(completion, /nextFollowUpAt/);
  assert.match(completion, /draftFollowUp/);
  assert.match(completion, /sameOpportunity\.some\(\(row\) => row\.sequenceStep === nextStep\)/);
  assert.match(completion, /inReplyToRfcMessageId: safeOutboundRfcMessageId/);
  assert.match(backend, /predecessorIdentityMatches/);
  assert.match(backend, /inboundRelayMessageIdHash\(predecessorRfcMessageId\)/);
  assert.match(action, /In-Reply-To/);
  assert.match(action, /References/);
  assert.match(action, /threadId: message\.providerThreadId/);
  assert.match(action, /outboundRfcMessageId: relayBinding\?\.outboundRfcMessageId/);
});

test("reply, STOP, bounce, lost evidence and acquired links retire queued sends", () => {
  assert.match(backend, /async function cancelQueuedThread/);
  assert.ok(
    backend.match(/await cancelQueuedThread\(/g)?.length === 2,
    "both signed-relay and legacy Gmail receipts cancel the sequence",
  );
  assert.match(backend, /The recipient replied before this message became due/);
  assert.match(authority, /The exact backlink was acquired before this message became due/);
  assert.match(authority, /The authority opportunity was not reconfirmed/);
});

test("the release is tenant-generic and never shares an outbound identity", () => {
  const changedSurface = [backend, action, fleet, sites, crons, schema].join("\n");
  assert.doesNotMatch(changedSurface, /leadpilot/i);
  assert.match(backend, /Exactly one outreach inbox must be connected for this tenant/);
  assert.match(backend, /siteDomain: site\.domain/);
  assert.match(action, /inbox\.fromEmail/);
  assert.match(schema, /\.index\("by_from_email", \["fromEmail"\]\)/);
  assert.match(schema, /\.index\("by_sender_domain", \["senderDomain"\]\)/);
  assert.match(backend, /async function outboundIdentityUsedByAnotherTenant/);
  assert.match(backend, /sameMailbox\.length === scanLimit/);
  assert.match(backend, /sameDomain\.length === scanLimit/);
  assert.ok(
    (backend.match(/await outboundIdentityUsedByAnotherTenant\(/g) ?? []).length >= 3,
    "connect, one-time opt-in and every delivery claim must reject shared identities",
  );
  assert.match(backend, /row\.siteId !== siteId && row\.status !== "disconnected"/);
});
