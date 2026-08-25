import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OUTREACH_AUTONOMY_CONSENT_TEXT,
  OUTREACH_AUTONOMY_CONSENT_VERSION,
  OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP,
  OUTREACH_AUTONOMY_POLICY_HASH,
  OUTREACH_DURABILITY_MIGRATION_VERSION,
  legacyUnownedPresendMessageMayBeQuarantined,
  outreachMessageOwnerMatches,
} from "../convex/lib/outreachAutonomy.ts";

const backend = readFileSync("convex/outreach.ts", "utf8");
const authorityBackend = readFileSync("convex/seoAuthority.ts", "utf8");
const action = readFileSync("convex/actions/outreach.ts", "utf8");
const fleet = readFileSync("convex/actions/outreachFleet.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const crons = readFileSync("convex/crons.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");
const http = readFileSync("convex/http.ts", "utf8");
const autonomy = readFileSync("convex/lib/outreachAutonomy.ts", "utf8");
const sequence = readFileSync("convex/lib/outreachSequence.ts", "utf8");

test("the v3 bounded-sequence consent receipt has an exact audited hash", () => {
  assert.equal(OUTREACH_AUTONOMY_CONSENT_VERSION, 3);
  assert.equal(OUTREACH_AUTONOMY_MAX_DAILY_SEND_CAP, 30);
  assert.match(OUTREACH_AUTONOMY_CONSENT_TEXT, /at most two timed follow-ups/i);
  assert.match(OUTREACH_AUTONOMY_CONSENT_TEXT, /same message thread/i);
  assert.match(
    OUTREACH_AUTONOMY_CONSENT_TEXT,
    /reply, STOP request, bounce, verified link acquisition, tenant parking, consent withdrawal, or sender configuration change cancels/i,
  );
  assert.match(
    OUTREACH_AUTONOMY_CONSENT_TEXT,
    /disabling autonomy stops new delivery claims; one attempt already claimed by the provider boundary may settle once/i,
  );
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

test("only verified autonomous receipts create and release bounded threaded follow-ups", () => {
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
  const cancellation = backend.slice(
    backend.indexOf("export const cancelAutonomousSequenceInternal"),
    backend.indexOf("export const enableAutonomousOutreach"),
  );

  assert.match(insert, /args\.sequenceStep !== 0/);
  assert.match(approve, /message\.sequenceStep !== 0/);
  assert.match(claim, /message\.sequenceStep > MAX_SEQUENCE_STEP/);
  assert.match(claim, /message\.sequenceStep > 0 && release !== "automatic"/);
  assert.match(claim, /message\.parentMessageId/);
  assert.match(claim, /followUpPredecessorDecision/);
  assert.match(sequence, /providerThreadId !== predecessor\.providerThreadId/);
  assert.match(sequence, /message\.scheduledAt !== expectedDue/);
  assert.match(evidence, /MAX_SEQUENCE_STEP \+ 1/);
  assert.match(evidence, /\.eq\("sequenceStep", sequenceStep\)/);
  assert.match(completion, /queueNextVerifiedAutonomousFollowUp/);
  assert.match(completion, /safeProviderThreadId !== message\.deliveryExpectedThreadId/);
  assert.match(completion, /followUpQueued: false/);
  assert.match(action, /In-Reply-To/);
  assert.match(action, /References/);
  assert.match(action, /threadId: message\.providerThreadId/);
  assert.match(schema, /parentMessageId/);
  assert.match(schema, /deliveryExpectedThreadId/);
  assert.match(schema, /inReplyToRfcMessageIdHash/);
  assert.doesNotMatch(schema, /inReplyToRfcMessageId: v\.optional/);
  assert.match(claim, /inboundRelayOutboundMessageIdForAttempt/);
  assert.match(claim, /deliveryInReplyToRfcMessageId/);
  assert.match(cancellation, /approvalConsentAcceptedAt/);
  assert.match(cancellation, /status: "skipped"/);
  assert.match(cancellation, /status: "draft"/);
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
  assert.equal(OUTREACH_DURABILITY_MIGRATION_VERSION, 3);
  assert.match(sites, /OUTREACH_DURABILITY_MIGRATION_VERSION/);
  assert.doesNotMatch(sites, /durabilityMigration\?\.version === 1/);
  const fleetState = sites.slice(
    sites.indexOf("async function outreachFleetState"),
    sites.indexOf("export const listOutreachFleetPage"),
  );
  const manualMigrationBootstrap = fleetState.slice(
    fleetState.indexOf("const durabilityMigrationBootstrapEligible"),
    fleetState.indexOf("const autonomyAuthorizationEligible"),
  );
  const autonomousAuthorization = fleetState.slice(
    fleetState.indexOf("const autonomyAuthorizationEligible"),
    fleetState.indexOf("const durabilityMigrationComplete"),
  );
  assert.match(manualMigrationBootstrap, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(
    manualMigrationBootstrap,
    /inbox\?\.credentialOwnerAccountKey === siteOwnerAccountKey/,
  );
  assert.doesNotMatch(
    manualMigrationBootstrap,
    /autonomousOutreachConsentActive|autonomousOutreachRuntimeEnabled/,
  );
  assert.match(autonomousAuthorization, /autonomousOutreachConsentActive/);
  assert.match(autonomousAuthorization, /autonomousOutreachRuntimeEnabled/);
  const ensure = backend.slice(
    backend.indexOf("export const ensureOutreachDurabilityMigrationInternal"),
    backend.indexOf("export const migrateOutreachDurabilityInternal"),
  );
  assert.match(ensure, /currentMigrationComplete/);
  assert.match(ensure, /autonomyReconciliationStatus: "pending"/);
  assert.ok(
    ensure.indexOf('autonomyReconciliationStatus: "pending"') <
      ensure.indexOf("migrateOutreachDurabilityInternal"),
    "a version bump must close old reconciliation before migration runs",
  );
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
  assert.match(claim, /readDurablePacingReceipt/);
  assert.match(claim, /effectiveDurablePacingState/);
  assert.match(claim, /inbox: effectiveInbox/);
  assert.match(claim, /reserveDurableContactClaim/);
  assert.match(claim, /status: "sending"/);
  assert.match(action, /sendHandler\(ctx, siteId, "automatic"\)/);
  assert.match(action, /export const sendAutomaticOutreachInternal = internalAction/);
  assert.doesNotMatch(action, /export const sendAutomaticOutreach = action/);
});

test("every provider-credential boundary rejects a changed site owner", () => {
  const publicInbox = backend.slice(
    backend.indexOf("export const getInbox = query"),
    backend.indexOf("export const connectGmailInboxInternal"),
  );
  const internalInbox = backend.slice(
    backend.indexOf("export const getInboxInternal"),
    backend.indexOf("export const getGmailReconnectReadinessInternal"),
  );
  const canary = backend.slice(
    backend.indexOf("export const createInboundRelayDsnCanary"),
    backend.indexOf("export const finalizeInboundRelayDsnCanaryDelivery"),
  );
  const canaryCandidate = backend.slice(
    backend.indexOf("export const getInboundRelayDsnCanaryCandidate"),
    backend.indexOf("export const recordInboundRelayDsnCanaryReceipt"),
  );
  const canaryReceipt = backend.slice(
    backend.indexOf("export const recordInboundRelayDsnCanaryReceipt"),
    backend.indexOf("const inboundRelayKindValidator"),
  );
  const legacyFleet = backend.slice(
    backend.indexOf("export const listLegacyInboundFleetPage"),
    backend.indexOf("export const getLegacyInboundFleetState"),
  );
  const inboundClaim = backend.slice(
    backend.indexOf("export const claimInboundSync"),
    backend.indexOf("export const bindInboundProviderThread"),
  );
  assert.match(publicInbox, /credentialOwnerAccountKey !== accountDeletionKey/);
  assert.match(publicInbox, /return null/);
  assert.match(internalInbox, /credentialOwnerAccountKey !== accountDeletionKey/);
  assert.match(canary, /credentialOwnerAccountKey !== accountDeletionKey/);
  assert.match(canaryCandidate, /credentialOwnerAccountKey !== accountDeletionKey/);
  assert.match(canaryReceipt, /credentialOwnerAccountKey !== accountDeletionKey/);
  assert.match(legacyFleet, /credentialOwnerAccountKey !== accountDeletionKey/);
  assert.match(inboundClaim, /credentialOwnerAccountKey !== accountDeletionKey/);
  assert.match(inboundClaim, /oauthRefreshToken: undefined/);
  assert.match(inboundClaim, /status: "disconnected"/);
  assert.match(inboundClaim, /!site\?\.userId \|\| !inbox\.credentialOwnerAccountKey/);
  assert.ok(
    inboundClaim.indexOf("!inbox.credentialOwnerAccountKey") <
      inboundClaim.indexOf("oauthRefreshToken: undefined"),
  );
});

test("legacy owner rollout reconnects only through a fresh scrubbed OAuth grant", () => {
  const connect = backend.slice(
    backend.indexOf("export const connectGmailInboxInternal"),
    backend.indexOf("export const setInboxComplianceProfile"),
  );
  const readiness = backend.slice(
    backend.indexOf("export const getGmailReconnectReadinessInternal"),
    backend.indexOf("export const listLegacyInboundFleetPage"),
  );
  assert.match(readiness, /credentialOwnerAccountKey !== ownerKey/);
  assert.match(readiness, /freshGrantRequired: true/);
  assert.match(connect, /cannot be transferred/);
  assert.match(connect, /quarantineLegacyUnownedDeliveryBeforeReconnect/);
  assert.match(
    connect,
    /physicalMailingAddress: existingOwnerMatches\s*\? existing\?\.physicalMailingAddress\s*: undefined/,
  );
  assert.match(
    connect,
    /complianceConfirmedAt: existingOwnerMatches\s*\? existing\?\.complianceConfirmedAt\s*: undefined/,
  );
  assert.match(connect, /oauthRefreshToken: args\.oauthRefreshToken/);
  assert.match(connect, /autonomyConsentAcceptedBy: undefined/);
  assert.match(connect, /inboundSyncLeaseId: undefined/);
});

test("an ownerless legacy readonly drain is adopted, never overwritten by send-only OAuth", () => {
  const connect = backend.slice(
    backend.indexOf("export const connectGmailInboxInternal"),
    backend.indexOf("export const setInboxComplianceProfile"),
  );
  const drainAdoption = connect.slice(
    connect.indexOf("if (legacyInboundDrainPending)"),
    connect.indexOf("let durablePacing"),
  );
  assert.match(drainAdoption, /existing!\.fromEmail\.trim\(\)\.toLowerCase\(\) !== fromEmail/);
  assert.match(drainAdoption, /credentialOwnerAccountKey/);
  assert.match(drainAdoption, /physicalMailingAddress: undefined/);
  assert.match(drainAdoption, /complianceConfirmedAt: undefined/);
  assert.match(drainAdoption, /legacyDrainAdopted: true/);
  assert.doesNotMatch(drainAdoption, /oauthRefreshToken:/);
  assert.doesNotMatch(drainAdoption, /oauthScopes:/);

  const disconnect = backend.slice(
    backend.indexOf("export const disconnectInbox"),
    backend.indexOf("export const getInboxInternal"),
  );
  assert.match(disconnect, /pendingLegacyUnboundMessageCount/);
  assert.match(disconnect, /status: "pending"/);
  assert.match(disconnect, /migrateOutreachDurabilityInternal/);
  assert.ok(
    disconnect.indexOf('status: "pending"') <
      disconnect.indexOf("oauthRefreshToken: undefined"),
  );
});

test("delivery settlement remains bound to the immutable claiming account", () => {
  const claim = backend.slice(
    backend.indexOf("export const claimApprovedDelivery"),
    backend.indexOf("export const getApprovedDeliveryEvidenceInternal"),
  );
  const settlement = backend.slice(
    backend.indexOf("function immutableDeliveryOwnerAccountKey"),
    backend.indexOf("export const getInboundRelayCandidate"),
  );
  const relay = backend.slice(
    backend.indexOf("export const getInboundRelayCandidate"),
    backend.indexOf("export const getInboundRelayFleetPage"),
  );
  assert.match(schema, /deliveryOwnerAccountKey: v\.optional\(v\.string\(\)\)/);
  assert.match(claim, /deliveryOwnerAccountKey: inbox\.credentialOwnerAccountKey/);
  assert.match(settlement, /recordDurableContactReceiptForAccount/);
  assert.match(settlement, /recordDurablePacingReceiptForAccount/);
  assert.match(settlement, /releaseDurableContactClaimForAccount/);
  assert.match(settlement, /Only the account that claimed this Gmail delivery/);
  assert.match(settlement, /status: "delivery_unverified",\s*\/\/[^]*sentAt: now/);
  assert.match(relay, /args\.deliveryOwnerAccountKey !== settlementAccountKey/);
  assert.match(relay, /inboundProvesAmbiguousDelivery && !message\.sentAt/);
  assert.match(relay, /materializeOutreachSuppressionTombstoneForAccount/);
  assert.match(http, /deliveryOwnerAccountKey: candidate\.deliveryOwnerAccountKey/);

  const deletion = sites.slice(
    sites.indexOf("export const continueSiteDeletionInternal"),
    sites.indexOf("export const requestSiteDeletionInternal"),
  );
  assert.match(deletion, /message\.deliveryOwnerAccountKey \?\?/);
  assert.match(deletion, /messageInbox\.credentialOwnerAccountKey/);
  assert.doesNotMatch(
    deletion,
    /messageInbox[\s\S]{0,300}accountDeletionKey\(site\.userId\)/,
  );
  assert.match(deletion, /materializeOutreachSuppressionTombstoneForAccount/);
  assert.match(deletion, /const settlementAccountKey = inbox\.credentialOwnerAccountKey/);
  assert.match(deletion, /unresolved immutable ownership/);
  assert.match(deletion, /site\.deletionRequestedBy === "verified_account_deletion"/);
  assert.match(deletion, /recordUnlinkedDurablePacingReceipt/);
  assert.match(deletion, /if \(!settlementAccountKey && !verifiedAccountDeletion\)/);
  assert.match(
    deletion,
    /else if \(messageInbox && messageInbox\.siteId === siteId\)[\s\S]{0,600}recordUnlinkedDurablePacingReceipt/,
  );
});

test("legacy inbound rows bind immutable ownership inside the current-owner lease", () => {
  const evidence = backend.slice(
    backend.indexOf("export const getInboundCandidatesForEvidence"),
    backend.indexOf("export const completeInboundSync"),
  );
  assert.match(
    evidence,
    /message\.deliveryOwnerAccountKey === undefined/,
  );
  assert.match(
    evidence,
    /deliveryOwnerAccountKey: inbox\.inboundSyncOwnerAccountKey/,
  );
  assert.match(
    evidence,
    /inbox\.credentialOwnerAccountKey !== inbox\.inboundSyncOwnerAccountKey/,
  );
});

test("manual and automatic delivery wait for account-wide legacy compliance migration", () => {
  const send = action.slice(
    action.indexOf("async function sendHandler"),
    action.indexOf("export const sendApprovedOutreach"),
  );
  const claim = backend.slice(
    backend.indexOf("export const claimApprovedDelivery"),
    backend.indexOf("export const getApprovedDeliveryEvidenceInternal"),
  );
  assert.match(send, /ensureOutreachDurabilityMigrationInternal/);
  assert.match(send, /if \(!durability\.complete\)/);
  assert.match(
    claim,
    /if \(!\(await outreachDurabilityMigrationComplete\(ctx, site\)\)\)/,
  );
  const migration = backend.slice(
    backend.indexOf("export const migrateOutreachDurabilityInternal"),
    backend.indexOf("export const reconcileAutonomousInitialMessagesInternal"),
  );
  assert.match(
    migration,
    /message\.deliveryOwnerAccountKey \?\?[\s\S]*messageInbox\.credentialOwnerAccountKey/,
  );
  assert.doesNotMatch(
    migration,
    /message\.deliveryOwnerAccountKey \?\? accountKey/,
  );
  assert.match(migration, /legacy_delivery_owner_unresolved/);
  assert.match(migration, /legacyDeliveryOwnerWasUnbound/);
  assert.match(migration, /materializeOutreachSuppressionTombstoneForAccount/);
  const exactDurableSuppression = migration.slice(
    migration.indexOf("if (alreadyDurable && currentIdentity)"),
    migration.indexOf('stopped: "legacy_suppression_owner_unresolved"'),
  );
  assert.match(
    exactDurableSuppression,
    /ownerAccountKey: currentIdentity\.accountKey/,
  );
  assert.ok(
    exactDurableSuppression.indexOf("ownerAccountKey") <
      exactDurableSuppression.indexOf("continue"),
    "an exact durable STOP must bind the legacy raw row before migration advances",
  );
  assert.ok(
    (migration.match(/credentialOwnerAccountKey === accountKey/g) ?? []).length >= 2,
    "legacy contact/suppression ownership may only be adopted by the exact migrating account",
  );
  assert.match(migration, /ownerLineageUnresolvedAt/);
});

test("recipient rows retain immutable owner lineage across defensive owner drift", () => {
  const addSuppression = backend.slice(
    backend.indexOf("async function addSuppression"),
    backend.indexOf("export const suppress = mutation"),
  );
  const contacts = backend.slice(
    backend.indexOf("export const upsertContact"),
    backend.indexOf("export const getContactCooldownInternal"),
  );
  const suppressionList = backend.slice(
    backend.indexOf("export const listSuppressions"),
    backend.indexOf("export const isSuppressedInternal"),
  );
  assert.match(schema, /outreach_contacts: defineTable[\s\S]*ownerLineageUnresolvedAt/);
  assert.match(schema, /outreach_suppressions: defineTable[\s\S]*ownerLineageUnresolvedAt/);
  assert.doesNotMatch(addSuppression, /writableOutreachOwnerAccountKey/);
  assert.match(addSuppression, /materializeOutreachSuppressionTombstone/);
  assert.match(contacts, /existing\.ownerLineageUnresolvedAt/);
  assert.match(suppressionList, /\.eq\("ownerAccountKey", ownerAccountKey\)/);
  assert.match(suppressionList, /\.eq\("ownerLineageUnresolvedAt", undefined\)/);
});

test("every raw outreach message is owner-bound before claim and hidden across owner drift", () => {
  const list = backend.slice(
    backend.indexOf("export const listMessages"),
    backend.indexOf("export const insertDraft"),
  );
  const insert = backend.slice(
    backend.indexOf("export const insertDraft"),
    backend.indexOf("export const approveMessage"),
  );
  const approve = backend.slice(
    backend.indexOf("export const approveMessage"),
    backend.indexOf("export const discardMessage"),
  );
  const discard = backend.slice(
    backend.indexOf("export const discardMessage"),
    backend.indexOf("const dnsEvidenceValidator"),
  );
  const review = backend.slice(
    backend.indexOf("export const resolveUnverifiedDelivery"),
    backend.indexOf("export const recordReply"),
  );
  const evidence = backend.slice(
    backend.indexOf("export const getApprovedDeliveryEvidenceInternal"),
    backend.indexOf("export const retireInvalidApprovedDeliveryEvidenceInternal"),
  );
  const migration = backend.slice(
    backend.indexOf("export const migrateOutreachDurabilityInternal"),
    backend.indexOf("export const reconcileAutonomousInitialMessagesInternal"),
  );
  assert.match(schema, /outreach_messages: defineTable\([\s\S]*ownerAccountKey: v\.optional/);
  assert.match(schema, /outreach_messages: defineTable\([\s\S]*ownerLineageUnresolvedAt/);
  assert.match(schema, /by_site_owner_lineage_status/);
  assert.match(schema, /\.index\("by_site_created", \["siteId", "createdAt"\]\)/);
  assert.match(schema, /\.index\("by_owner", \["ownerAccountKey"\]\)/);
  assert.match(list, /withIndex\("by_site_owner_lineage_status"/);
  assert.match(list, /\.eq\("ownerAccountKey", ownerAccountKey\)/);
  assert.match(list, /\.eq\("ownerLineageUnresolvedAt", undefined\)/);
  assert.match(insert, /ownerAccountKey/);
  assert.match(insert, /ownershipConflict/);
  assert.match(insert, /outreachMessageOwnerMatches\(message, ownerAccountKey\)/);
  assert.match(approve, /outreachMessageOwnerMatches\(message, ownerAccountKey\)/);
  assert.match(discard, /outreachMessageOwnerMatches/);
  assert.match(review, /outreachMessageOwnerMatches/);
  assert.ok((evidence.match(/\.eq\("ownerAccountKey", ownerAccountKey\)/g) ?? []).length >= 2);
  assert.match(migration, /exactMessageOwnerAccountKey/);
  assert.match(migration, /ownerLineageUnresolvedAt: Date\.now\(\)/);
  assert.match(migration, /legacyUnownedPresendMessageMayBeQuarantined/);
  assert.match(migration, /withIndex\("by_site_created"/);
  assert.match(migration, /toEmail: "redacted@invalid\.local"/);
  assert.match(migration, /threadKey: `quarantined:\$\{message\._id\}`/);
  assert.match(migration, /status: "failed"/);
  const cancellation = backend.slice(
    backend.indexOf("async function cancelQueuedThread"),
    backend.indexOf("async function writableOutreachOwnerAccountKey"),
  );
  const suppression = backend.slice(
    backend.indexOf("async function addSuppression"),
    backend.indexOf("export const suppress = mutation"),
  );
  const opportunityCancellation = authorityBackend.slice(
    authorityBackend.indexOf("async function messageBelongsToAuthorityOpportunity"),
    authorityBackend.indexOf("export const getVerifiedBySource"),
  );
  assert.match(cancellation, /outreachMessageOwnerMatches/);
  assert.match(suppression, /outreachMessageOwnerMatches/);
  assert.match(opportunityCancellation, /outreachMessageOwnerMatches/);
  const contactUpsert = backend.slice(
    backend.indexOf("export const upsertContact"),
    backend.indexOf("export const getContactCooldownInternal"),
  );
  assert.match(contactUpsert, /legacyUnresolvedContactMayBeReplaced/);
  assert.match(contactUpsert, /if \(!hasExactOwnerInbox\)/);
  assert.match(contactUpsert, /ownerLineageUnresolvedAt: undefined/);
  assert.match(contactUpsert, /lastContactedAt: undefined/);
  assert.match(contactUpsert, /name: args\.name/);
  assert.doesNotMatch(
    contactUpsert.slice(
      contactUpsert.indexOf("if (legacyUnresolvedContactMayBeReplaced"),
      contactUpsert.indexOf("if (existing.ownerLineageUnresolvedAt"),
    ),
    /existing\.name|existing\.role|existing\.lastContactedAt/,
  );
  for (const status of ["draft", "sent", "delivery_unverified"]) {
    assert.equal(
      outreachMessageOwnerMatches({ ownerAccountKey: "account-a" }, "account-a"),
      true,
      `${status} should remain visible and mutable to its immutable owner`,
    );
    assert.equal(
      outreachMessageOwnerMatches({ ownerAccountKey: "account-a" }, "account-b"),
      false,
      `${status} must be hidden and immutable after site owner drift`,
    );
    assert.equal(
      outreachMessageOwnerMatches(
        { ownerAccountKey: "account-a", ownerLineageUnresolvedAt: 1 },
        "account-a",
      ),
      false,
      `${status} with unresolved lineage must fail closed`,
    );
  }
  assert.equal(
    legacyUnownedPresendMessageMayBeQuarantined({ status: "blocked" }),
    true,
    "a legacy no-inbox blocked draft is terminally released, not adopted",
  );
  assert.equal(
    legacyUnownedPresendMessageMayBeQuarantined({
      status: "draft",
      inboxId: "inbox-a",
    }),
    false,
    "an inbox-bound draft requires exact owner proof",
  );
  assert.equal(
    legacyUnownedPresendMessageMayBeQuarantined({
      status: "delivery_unverified",
      deliveryAttemptId: "attempt-a",
    }),
    false,
    "an ambiguous provider attempt is never treated as an unsent draft",
  );
});

test("fleet selection is due-only, exact-consent, bounded-sequence and preflighted", () => {
  assert.match(sites, /by_site_owner_lineage_status_autonomy_consent_sequence_scheduled/);
  assert.match(sites, /\.eq\("ownerAccountKey", siteOwnerAccountKey\)/);
  assert.match(sites, /Array\.from\(\{ length: MAX_SEQUENCE_STEP \+ 1 \}/);
  assert.match(sites, /\.eq\("sequenceStep", sequenceStep\)/);
  assert.match(sites, /autonomousOutreachReconciliationComplete\(inbox\)/);
  assert.match(fleet, /hasDueAutomaticMessages === true/);
  assert.match(fleet, /internal\.sites\.getOutreachFleetState/);
  assert.match(fleet, /sendAutomaticOutreachInternal/);
  assert.match(crons, /outreach-autonomous-delivery-fleet/);
  assert.match(schema, /by_site_status_autonomy_consent_sequence_scheduled/);
  assert.match(schema, /by_site_owner_lineage_status_autonomy_consent_sequence_scheduled/);
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
  assert.match(schema, /outreach_contacts: defineTable\([\s\S]*ownerAccountKey/);
  assert.match(schema, /outreach_suppressions: defineTable\([\s\S]*ownerAccountKey/);
  assert.match(backend, /writableOutreachOwnerAccountKey/);
  assert.match(
    backend,
    /contact\.ownerAccountKey !== inbox\.credentialOwnerAccountKey/,
  );
});
