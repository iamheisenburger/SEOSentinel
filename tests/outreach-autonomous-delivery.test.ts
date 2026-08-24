import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OUTREACH_AUTONOMY_CONSENT_TEXT,
  OUTREACH_AUTONOMY_CONSENT_VERSION,
  OUTREACH_AUTONOMY_POLICY_HASH,
} from "../convex/lib/outreachAutonomy.ts";

const backend = readFileSync("convex/outreach.ts", "utf8");
const action = readFileSync("convex/actions/outreach.ts", "utf8");
const fleet = readFileSync("convex/actions/outreachFleet.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const crons = readFileSync("convex/crons.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");
const autonomy = readFileSync("convex/lib/outreachAutonomy.ts", "utf8");

test("the v2 initial-only consent receipt has an exact audited hash", () => {
  assert.equal(OUTREACH_AUTONOMY_CONSENT_VERSION, 2);
  assert.match(OUTREACH_AUTONOMY_CONSENT_TEXT, /initial commercial business outreach/i);
  assert.match(OUTREACH_AUTONOMY_CONSENT_TEXT, /does not permit automated follow-ups/i);
  assert.equal(
    createHash("sha256").update(OUTREACH_AUTONOMY_CONSENT_TEXT).digest("hex"),
    OUTREACH_AUTONOMY_POLICY_HASH,
  );
});

test("one-time autonomy is inbox-bound, freshly accepted after disable, and kill-switchable", () => {
  const enable = backend.slice(
    backend.indexOf("export const enableAutonomousOutreach"),
    backend.indexOf("export const migrateOutreachDurabilityInternal"),
  );
  assert.match(enable, /expectedInboxId/);
  assert.match(enable, /expectedInboxConfigurationVersion/);
  assert.match(enable, /OUTREACH_AUTONOMY_CONSENT_VERSION/);
  assert.match(enable, /OUTREACH_AUTONOMY_POLICY_HASH/);
  assert.match(enable, /inbox\.autonomyDisabledAt < inbox\.autonomyConsentAcceptedAt/);
  assert.match(enable, /autonomyReconciliationStatus: "pending"/);
  assert.match(enable, /migrateOutreachDurabilityInternal/);

  const disable = backend.slice(
    backend.indexOf("export const setInboxMode"),
    backend.indexOf("export const enableAutonomousOutreach"),
  );
  assert.match(disable, /mode !== "approval"/);
  assert.match(disable, /autonomyDisabledAt/);
  assert.match(disable, /autonomyReconciliationStatus: "paused"/);
  assert.doesNotMatch(
    disable,
    /assertNoActiveDelivery/,
    "disable must stop new claims while one already-claimed attempt may settle",
  );
});

test("all creation, approval, selection and claim paths hard-deny follow-ups", () => {
  const insert = backend.slice(
    backend.indexOf("export const insertDraft"),
    backend.indexOf("export const approveMessage"),
  );
  const approve = backend.slice(
    backend.indexOf("export const approveMessage"),
    backend.indexOf("export const discardMessage"),
  );
  const claim = backend.slice(
    backend.indexOf("export const claimApprovedDelivery"),
    backend.indexOf("export const getApprovedDeliveryEvidenceInternal"),
  );
  const evidence = backend.slice(
    backend.indexOf("export const getApprovedDeliveryEvidenceInternal"),
    backend.indexOf("export const retireInvalidApprovedDeliveryEvidenceInternal"),
  );
  const completion = backend.slice(
    backend.indexOf("export const completeDeliveryAttempt"),
    backend.indexOf("export const failDeliveryAttempt"),
  );

  assert.match(insert, /args\.sequenceStep !== 0/);
  assert.match(approve, /message\.sequenceStep !== 0/);
  assert.match(claim, /message\.sequenceStep !== 0/);
  assert.ok((evidence.match(/\.eq\("sequenceStep", 0\)/g) ?? []).length >= 2);
  assert.doesNotMatch(completion, /ctx\.db\.insert\("outreach_messages"/);
  assert.doesNotMatch(completion, /draftFollowUp|nextFollowUpAt|shouldCreateFollowUp/);
  assert.doesNotMatch(action, /In-Reply-To|References|message\.providerThreadId/);
  assert.doesNotMatch(schema, /deliveryExpectedThreadId|inReplyToRfcMessageId/);
});

test("activation is resumable and claims remain closed until migration and reconciliation complete", () => {
  const migration = backend.slice(
    backend.indexOf("export const migrateOutreachDurabilityInternal"),
    backend.indexOf("export const reconcileAutonomousInitialMessagesInternal"),
  );
  const reconciliation = backend.slice(
    backend.indexOf("export const reconcileAutonomousInitialMessagesInternal"),
    backend.indexOf("export const setInboxDailyCap"),
  );
  const claim = backend.slice(
    backend.indexOf("export const claimApprovedDelivery"),
    backend.indexOf("export const getApprovedDeliveryEvidenceInternal"),
  );

  assert.match(migration, /\.paginate\(/);
  assert.match(migration, /scheduleSelf/);
  assert.match(migration, /scheduleReconciliation/);
  assert.match(reconciliation, /\.take\(50\)/);
  assert.match(reconciliation, /await scheduleNext\(\)/);
  assert.match(reconciliation, /autonomyReconciliationStatus: "complete"/);
  assert.match(claim, /autonomousOutreachReconciliationComplete\(inbox\)/);
  assert.match(claim, /outreachDurabilityMigrationComplete\(ctx, site\)/);
  assert.match(sites, /autonomyReconciliationPending/);
  assert.match(fleet, /state\.autonomyReconciliationPending === true/);
});

test("automatic delivery uses exact current consent, strict send-only credentials and atomic pacing", () => {
  const claim = backend.slice(
    backend.indexOf("export const claimApprovedDelivery"),
    backend.indexOf("export const getApprovedDeliveryEvidenceInternal"),
  );
  assert.match(claim, /autonomousMessageAuthorizationMatches/);
  assert.match(claim, /autonomousGmailCredentialIssues/);
  assert.match(claim, /credentialOwnerAccountKey/);
  assert.match(claim, /isSeoGrowthActuationEligible\(site\)/);
  assert.match(claim, /outreachSendDecision\(\{ inbox, now, release \}\)/);
  assert.match(claim, /reserveDurableContactClaim/);
  assert.match(claim, /status: "sending"/);
  assert.match(action, /sendHandler\(ctx, siteId, "automatic"\)/);
  assert.match(action, /export const sendAutomaticOutreachInternal = internalAction/);
  assert.doesNotMatch(action, /export const sendAutomaticOutreach = action/);
});

test("fleet selection is due-only, exact-consent, sequence-zero and preflighted", () => {
  assert.match(sites, /by_site_status_autonomy_consent_sequence_scheduled/);
  assert.match(sites, /\.eq\("sequenceStep", 0\)/);
  assert.match(sites, /autonomousOutreachReconciliationComplete\(inbox\)/);
  assert.match(fleet, /hasDueAutomaticMessages === true/);
  assert.match(fleet, /internal\.sites\.getOutreachFleetState/);
  assert.match(fleet, /sendAutomaticOutreachInternal/);
  assert.match(crons, /outreach-autonomous-delivery-fleet/);
  assert.match(schema, /by_site_status_autonomy_consent_sequence_scheduled/);
});

test("a permanently invalid oldest row is retired instead of starving later work", () => {
  const evidence = backend.slice(
    backend.indexOf("export const getApprovedDeliveryEvidenceInternal"),
    backend.indexOf("export const retireInvalidApprovedDeliveryEvidenceInternal"),
  );
  const retirement = backend.slice(
    backend.indexOf("export const retireInvalidApprovedDeliveryEvidenceInternal"),
    backend.indexOf("async function settleAcceptedDeliveryCounter"),
  );
  assert.match(evidence, /permanentInvalidReason/);
  assert.match(evidence, /permanentlyInvalid\("source_changed"\)/);
  assert.match(evidence, /permanentlyInvalid\("target_missing"\)/);
  assert.match(evidence, /permanentlyInvalid\("contact_changed"\)/);
  assert.match(action, /retireInvalidApprovedDeliveryEvidenceInternal/);
  assert.match(retirement, /status: "failed"/);
});

test("the release is tenant-generic, identity-isolated and logs no raw recipient result", () => {
  const changedSurface = [backend, action, fleet, sites, crons, schema, autonomy].join("\n");
  assert.doesNotMatch(changedSurface, /leadpilot/i);
  assert.match(backend, /Exactly one outreach inbox must be connected for this tenant/);
  assert.match(backend, /async function outboundIdentityUsedByAnotherTenant/);
  assert.match(schema, /\.index\("by_from_email", \["fromEmail"\]\)/);
  assert.match(schema, /\.index\("by_sender_domain", \["senderDomain"\]\)/);
  assert.ok(
    (backend.match(/await outboundIdentityUsedByAnotherTenant\(/g) ?? []).length >= 3,
    "connect, consent and claim must reject a shared outbound identity",
  );
  assert.doesNotMatch(fleet, /JSON\.stringify\(result\)/);
  assert.match(fleet, /numericCounts/);
});
