import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MANAGED_SES_AMBIGUOUS_DISPOSITION_MS,
  MANAGED_SES_EVENT_CANARY_VALID_MS,
  MANAGED_SES_INBOUND_CANARY_VALID_MS,
  managedSesDispositionAuthorization,
  managedSesCombinedPacingDecision,
  managedSesEventCanaryClaimDecision,
  managedSesGlobalPacingDecision,
  managedSesIdentityTupleMatchesEstablished,
  managedSesInboundCanaryCurrent,
  managedSesPacingBoundaryTransition,
  managedSesScopedPacingDecision,
  parseManagedSesResourceReceipt,
  parseManagedSesSendReceipt,
} from "../convex/lib/managedSes.ts";
import {
  managedOutreachMailboxRequestFenceIssues,
  managedSesRotationCandidateEligible,
  managedSesSuccessorHandoffDecision,
  nextManagedOutreachMailboxGeneration,
} from "../convex/lib/managedOutreachMailbox.ts";
import {
  deliveryExternalBoundaryDecision,
  deliveryLeaseRecoveryDecision,
  deliveryOpportunityBoundaryCurrent,
} from "../convex/lib/outreachDelivery.ts";
import { managedSesFollowUpPredecessorDecision } from
  "../convex/lib/outreachSequence.ts";
import { GET as unsubscribeGet, POST as unsubscribePost } from
  "../src/app/unsubscribe/[token]/route.ts";

const source = (path: string) => readFileSync(
  new URL(`../${path}`, import.meta.url),
  "utf8",
);
const actionOutreach = source("convex/actions/outreach.ts");
const actionMailbox = source("convex/actions/managedOutreachMailbox.ts");
const mailbox = source("convex/managedOutreachMailbox.ts");
const outreach = source("convex/outreach.ts");
const http = source("convex/http.ts");
const schema = source("convex/schema.ts");
const sites = source("convex/sites.ts");
const middleware = source("src/middleware.ts");
const unsubscribeRoute = source("src/app/unsubscribe/[token]/route.ts");

function block(
  text: string,
  start: string,
  end: string,
): string {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing source block: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing source block terminator: ${end}`);
  return text.slice(from, to);
}

function ordered(text: string, needles: string[]): void {
  let cursor = -1;
  for (const needle of needles) {
    const found = text.indexOf(needle, cursor + 1);
    assert.notEqual(found, -1, `missing ordered source contract: ${needle}`);
    assert.ok(found > cursor, `out-of-order source contract: ${needle}`);
    cursor = found;
  }
}

const OPERATION = "o".repeat(48);
const RESOURCE = "r".repeat(48);
const THREAD = "t".repeat(48);
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const ADAPTER = "managed_ses_v1";

test("provision, status, send, and disposition keep exact immutable operation bindings", async () => {
  const ready = {
    state: "ready",
    operationKey: RESOURCE,
    generation: 7,
    adapterVersion: ADAPTER,
    updatedAt: 1_900_000_000,
    fromEmail: "tenant@mail.pentra.dev",
    verifiedAt: 1_900_000_000,
    resourceReceipt: DIGEST_A,
    eventCanaryRequired: true,
    inboundCanaryRequired: true,
  };
  assert.ok(parseManagedSesResourceReceipt(ready));
  for (const field of ["operationKey", "generation", "adapterVersion", "updatedAt"] as const) {
    const invalid = { ...ready };
    delete invalid[field];
    assert.equal(parseManagedSesResourceReceipt(invalid), null, field);
  }

  const submitted = {
    state: "submitted",
    operationKey: OPERATION,
    resourceOperationKey: RESOURCE,
    generation: 7,
    adapterVersion: ADAPTER,
    sequenceStep: 1,
    purpose: "outreach",
    updatedAt: 1_900_000_000,
    providerMessageIdDigest: DIGEST_A,
    rfcMessageIdDigest: DIGEST_B,
    threadReceipt: THREAD,
  };
  assert.ok(parseManagedSesSendReceipt(submitted));
  for (const field of [
    "operationKey",
    "resourceOperationKey",
    "generation",
    "adapterVersion",
    "sequenceStep",
    "purpose",
    "updatedAt",
  ] as const) {
    const invalid = { ...submitted };
    delete invalid[field];
    assert.equal(parseManagedSesSendReceipt(invalid), null, field);
  }

  const provision = block(
    actionMailbox,
    "export const provision =",
    "export const sendManagedSesEventCanary =",
  );
  for (const binding of [
    "receipt.operationKey !== claim.operation.operationKey",
    "receipt.generation !== claim.operation.generation",
    "receipt.adapterVersion !== config.adapterVersion",
  ]) assert.match(provision, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const disposition = block(
    actionMailbox,
    "export const disposeManagedSesAmbiguity =",
    "export const release =",
  );
  for (const binding of [
    "statusReceipt.operationKey === claim.operationKey",
    "statusReceipt.resourceOperationKey === claim.resourceOperationKey",
    "statusReceipt.generation === claim.generation",
    "statusReceipt.adapterVersion === claim.adapterVersion",
    "statusReceipt.sequenceStep === claim.sequenceStep",
    "statusReceipt.purpose === claim.purpose",
    "receipt.operationKey !== claim.operationKey",
    "receipt.resourceOperationKey !== claim.resourceOperationKey",
    "receipt.sequenceStep !== claim.sequenceStep",
    "receipt.purpose !== claim.purpose",
  ]) assert.ok(disposition.includes(binding), binding);
  const dispositionPayload = block(
    disposition,
    'route: "disposition"',
    "timeoutMs: 30_000",
  );
  assert.match(dispositionPayload, /sequenceStep:\s*claim\.sequenceStep/);
  assert.match(dispositionPayload, /purpose:\s*claim\.purpose/);

  const secret = "s".repeat(32);
  const base = {
    secret,
    operationKey: OPERATION,
    resourceOperationKey: RESOURCE,
    generation: 7,
    authorizedAtSeconds: 1_900_000_000,
  };
  const receipt = await managedSesDispositionAuthorization(base);
  assert.match(receipt ?? "", /^[a-f0-9]{64}$/);
  for (const mutation of [
    { operationKey: "x".repeat(48) },
    { resourceOperationKey: "y".repeat(48) },
    { generation: 8 },
    { authorizedAtSeconds: base.authorizedAtSeconds + 1 },
  ]) {
    assert.notEqual(
      await managedSesDispositionAuthorization({ ...base, ...mutation }),
      receipt,
    );
  }
  assert.equal(
    await managedSesDispositionAuthorization({ ...base, generation: 0 }),
    null,
    "generation zero is not a real managed resource binding",
  );
});

test("application claim and provider boundary are separate, paced, and never replayed", () => {
  ordered(actionOutreach, [
    "internal.outreach.claimApprovedDelivery",
    "internal.outreach.markManagedSesDeliveryExternalBoundary",
    'route: "send"',
    "internal.outreach.completeManagedSesDeliveryAttempt",
  ]);
  const boundary = block(
    outreach,
    "export const markManagedSesDeliveryExternalBoundary =",
    "export const getApprovedDeliveryEvidenceInternal =",
  );
  for (const contract of [
    "authorizeClaimedDeliveryAtExternalBoundary",
    "message.managedSesOperationKey !== args.attemptId",
    "reserveManagedSesPacingAttempt",
    "managedSesPacingBoundaryTransition",
    "deferClaimedDeliveryBeforeProvider",
    "deliveryExternalAttemptedAt: timestamp",
    "managedSesExternalAttemptedAt: timestamp",
  ]) assert.ok(boundary.includes(contract), contract);
  const failed = block(
    outreach,
    "export const failDeliveryAttempt =",
    "export const resolveUnverifiedDelivery =",
  );
  assert.match(failed, /unverified\s*\?\s*"delivery_unverified"/);
  assert.doesNotMatch(failed, /unverified[\s\S]{0,240}status:\s*"approved"/);
});

test("every active or retiring post-boundary ambiguity is reconciled after exactly 72 hours", () => {
  assert.equal(MANAGED_SES_AMBIGUOUS_DISPOSITION_MS, 72 * 60 * 60 * 1000);
  const fence = block(
    mailbox,
    "async function managedSesDispositionFence",
    "async function claimEligibleManagedSesDisposition",
  );
  for (const contract of [
    'resource.lifecycleState === "canonicalized"',
    'resource.releaseState === "active"',
    'resource.lifecycleState === "cancelled"',
    '["requested", "blocked"].includes(resource.releaseState)',
    'return "active"',
    'return "release"',
  ]) assert.ok(fence.includes(contract), contract);

  const claim = block(
    mailbox,
    "async function claimEligibleManagedSesDisposition",
    "export const getManagedSesDispositionOperation =",
  );
  assert.match(claim, /managedSesDispositionFence\(ctx, resource\)/);
  assert.match(claim, /MANAGED_SES_AMBIGUOUS_DISPOSITION_MS/);
  assert.match(claim, /internal\.actions\.managedOutreachMailbox\.disposeManagedSesAmbiguity/);

  const messageSettlement = block(
    outreach,
    "export const failDeliveryAttempt =",
    "export const resolveUnverifiedDelivery =",
  );
  const canarySettlement = block(
    mailbox,
    "export const recordManagedSesEventCanaryAttempt =",
    "export const claimManagedSesInboundCanaryActivation =",
  );
  for (const settlement of [messageSettlement, canarySettlement]) {
    assert.match(settlement, /scheduler\.runAt/);
    assert.match(settlement, /MANAGED_SES_AMBIGUOUS_DISPOSITION_MS/);
    assert.match(
      settlement,
      /internal\.managedOutreachMailbox\s*\.claimManagedSesAmbiguityReconciliation/,
    );
  }

  for (const start of [
    "export const getManagedSesDispositionOperation =",
    "export const markManagedSesDispositionExternalBoundary =",
    "export const recordManagedSesDispositionOutcome =",
  ]) {
    const from = mailbox.indexOf(start);
    assert.notEqual(from, -1, start);
    const nextExport = mailbox.indexOf("\nexport const ", from + start.length);
    assert.notEqual(nextExport, -1, `${start} terminator`);
    assert.match(
      mailbox.slice(from, nextExport),
      /managedSesDispositionFence\(ctx, resource\)/,
      `${start} must preserve the same active-or-release fence`,
    );
  }
});

test("released delivery tombstones accept late signed events without recreating site data", () => {
  const event = block(
    outreach,
    "export const recordManagedSesDeliveryEvent =",
    "export const recordManagedSesUnsubscribe =",
  );
  assert.match(
    event,
    /release[_A-Za-z]*tombstone|managedSes[A-Za-z]*Tombstone|managed_adapter_retiring/,
    "late events need an immutable release-safe binding after inbox provenance is cleared",
  );
  assert.match(
    event,
    /(?:deletionStatus|accountDeletionRequestedAt)[\s\S]{0,900}(?:managed_ses_delivery_events|recordSiteEvent)|(?:managed_ses_delivery_events|recordSiteEvent)[\s\S]{0,900}(?:deletionStatus|accountDeletionRequestedAt)/,
    "deletion must suppress any new site-scoped event row",
  );
  assert.match(event, /managed_outreach_mailbox_release_tombstones/);
  const canaryEvent = block(
    event,
    "if (canary) {",
    "const [inbox, eventSite, releaseTombstone]",
  );
  for (const contract of [
    "deletionStatus",
    "accountDeletionRequestedAt",
    "deletion_fenced_tombstone_only",
  ]) {
    assert.ok(
      canaryEvent.includes(contract),
      `managed canary late-event path missing ${contract}`,
    );
  }

  const deletedMessageEvent = block(
    event,
    "if (!canary && !message) {",
    "if (canary) {",
  );
  for (const contract of [
    'query("managed_ses_send_tombstones")',
    '.withIndex("by_operation"',
    'q.eq("operationKey", args.operationKey)',
    "sendTombstone.resourceOperationKey !== args.resourceOperationKey",
    "sendTombstone.generation !== args.generation",
    "sendTombstone.adapterVersion !== args.adapterVersion",
    "sendTombstone.sequenceStep !== args.sequenceStep",
    "sendTombstone.purpose !== args.purpose",
    "terminalEventReceipt: args.eventReceipt",
    "terminalEventBindingHash: tombstoneEventBindingHash",
    "deletion_fenced_tombstone_only",
  ]) {
    assert.ok(
      deletedMessageEvent.includes(contract),
      `deleted-message event path missing ${contract}`,
    );
  }
  assert.doesNotMatch(
    deletedMessageEvent,
    /insert\("managed_ses_delivery_events"/,
    "a deletion-fenced retry must not recreate a site-scoped event row",
  );

  const tombstoneMaterialization = block(
    outreach,
    "export async function materializeManagedSesSendTombstoneForDeletion",
    "export async function materializeManagedSesCanaryTombstoneForDeletion",
  );
  for (const contract of [
    "message.managedSesExternalAttemptedAt",
    'releaseTombstone.state !== "released"',
    "releaseTombstone.generation !== message.managedSesGeneration",
    "releaseTombstone.adapterVersion !== message.managedSesAdapterVersion",
    "releaseTombstone.ownerAccountKey !== message.deliveryOwnerAccountKey",
    'query("managed_ses_send_tombstones")',
    "MANAGED_SES_SEND_TOMBSTONE_RETENTION_MS",
  ]) {
    assert.ok(
      tombstoneMaterialization.includes(contract),
      `send tombstone materialization missing ${contract}`,
    );
  }
  const tombstoneRecord = block(
    tombstoneMaterialization,
    "const record = {",
    "if (existing)",
  );
  for (const contract of [
    "operationKey: message.managedSesOperationKey",
    "resourceOperationKey: message.managedSesResourceOperationKey",
    "generation: message.managedSesGeneration",
    "adapterVersion: message.managedSesAdapterVersion",
    "sequenceStep: message.sequenceStep",
    'purpose: "outreach"',
    'releaseState: "released"',
    "expiresAt:",
  ]) {
    assert.ok(tombstoneRecord.includes(contract), `tombstone record missing ${contract}`);
  }
  assert.doesNotMatch(
    tombstoneRecord,
    /\b(?:siteId|ownerAccountKey|toEmail|toDomain|subject|body)\b/,
    "privacy tombstone must not retain tenant, address, or content fields",
  );

  assert.ok(
    (sites.match(/materializeManagedSesSendTombstoneForDeletion/g) ?? [])
      .length >= 3,
    "normal and foreign-account deletion must materialize before deleting a send",
  );
  const prune = block(
    outreach,
    "export const pruneExpiredSenderPacingReceiptsInternal =",
    "// ── Contacts and prior-contact history",
  );
  assert.match(
    prune,
    /query\("managed_ses_send_tombstones"\)[\s\S]*\.withIndex\("by_expires"/,
  );
  assert.match(prune, /await ctx\.db\.delete\(row\._id\)/);

  const tombstoneSchema = block(
    schema,
    "managed_ses_send_tombstones: defineTable({",
    "managed_ses_pacing_receipts: defineTable({",
  );
  for (const field of [
    "operationKey:",
    "resourceOperationKey:",
    "generation:",
    "adapterVersion:",
    "sequenceStep:",
    "purpose:",
    "terminalEventBindingHash:",
    "expiresAt:",
    '.index("by_operation"',
    '.index("by_expires"',
  ]) assert.ok(tombstoneSchema.includes(field), `send tombstone schema missing ${field}`);
  assert.doesNotMatch(
    tombstoneSchema,
    /\b(?:siteId|ownerAccountKey|toEmail|toDomain|subject|body)\b/,
    "send tombstone schema must remain privacy reduced",
  );
});

test("signed submitted status adoption terminalizes the message and accepted-send counters", () => {
  const dispositionResult = block(
    mailbox,
    "export const recordManagedSesDispositionOutcome =",
    "export const claimRelease =",
  );
  assert.match(dispositionResult, /settleManagedSesAcceptedMessage/);
  assert.match(dispositionResult, /rfcMessageIdDigest:\s*args\.rfcMessageIdDigest/);
  assert.match(dispositionResult, /threadReceipt:\s*args\.threadReceipt/);
  assert.match(dispositionResult, /acceptedAt:\s*args\.receiptUpdatedAt\s*\*\s*1_000/);
  assert.match(dispositionResult, /status:\s*"failed"/);
  assert.match(dispositionResult, /const accepted\s*=\s*[\s\S]{0,80}args\.state\s*===\s*"submitted"/);
  const acceptedSettlement = block(
    outreach,
    "export async function settleManagedSesAcceptedMessage",
    "export const completeManagedSesDeliveryAttempt =",
  );
  assert.match(acceptedSettlement, /settleAcceptedDeliveryCounter/);
  assert.match(acceptedSettlement, /queueNextVerifiedAutonomousFollowUp/);
  assert.match(acceptedSettlement, /status:\s*"sent"/);
});

test("generic event-confirmed status cannot masquerade as accepted-send proof", () => {
  const generic = parseManagedSesSendReceipt({
    state: "event_confirmed",
    operationKey: OPERATION,
    resourceOperationKey: RESOURCE,
    generation: 7,
    adapterVersion: ADAPTER,
    sequenceStep: 0,
    purpose: "outreach",
    updatedAt: 1_900_000_000,
    providerMessageIdDigest: DIGEST_A,
    rfcMessageIdDigest: DIGEST_B,
    threadReceipt: THREAD,
  });
  assert.ok(generic);
  assert.equal("eventType" in generic, false);
  assert.equal("eventReceipt" in generic, false);

  const dispositionResult = block(
    mailbox,
    "export const recordManagedSesDispositionOutcome =",
    "export const claimRelease =",
  );
  const settledStates = block(
    dispositionResult,
    "const settled = identityMismatch || [",
    "].includes(args.state);",
  );
  const acceptedStates = block(
    dispositionResult,
    "const accepted =",
    "let followUpQueued",
  );
  const genericStatusTerminal =
    /event_confirmed/.test(settledStates) ||
    /event_confirmed/.test(acceptedStates);
  const exactSemanticEventProof =
    /eventType:\s*managedSesEventTypeValidator/.test(dispositionResult) &&
    /eventReceipt:\s*v\.string\(\)/.test(dispositionResult) &&
    /\["sent",\s*"delivered"\]\.includes\(args\.eventType\)/.test(
      dispositionResult,
    );
  assert.equal(
    genericStatusTerminal && !exactSemanticEventProof,
    false,
    "event_confirmed without signed event semantics must remain pending/retryable",
  );

  const semantic = {
    state: "event_confirmed",
    operationKey: OPERATION,
    resourceOperationKey: RESOURCE,
    generation: 7,
    adapterVersion: ADAPTER,
    sequenceStep: 0,
    purpose: "outreach",
    updatedAt: 1_900_000_000,
    providerMessageIdDigest: DIGEST_A,
    rfcMessageIdDigest: DIGEST_B,
    threadReceipt: THREAD,
    terminalDeliveryEvent: {
      eventType: "bounced",
      occurredAt: "2026-08-25T19:00:00Z",
      eventReceipt: "c".repeat(64),
    },
  };
  assert.deepEqual(parseManagedSesSendReceipt(semantic), semantic);
  const invalidTerminalReceipts: Array<Record<string, unknown>> = [
    { ...semantic, state: "submitted" },
    {
      ...semantic,
      terminalDeliveryEvent: { ...semantic.terminalDeliveryEvent, extra: true },
    },
    {
      ...semantic,
      terminalDeliveryEvent: {
        ...semantic.terminalDeliveryEvent,
        eventType: "delivered",
      },
    },
    {
      ...semantic,
      terminalDeliveryEvent: {
        ...semantic.terminalDeliveryEvent,
        occurredAt: "2026-08-25T19:00:00+00:00",
      },
    },
    {
      ...semantic,
      terminalDeliveryEvent: {
        ...semantic.terminalDeliveryEvent,
        eventReceipt: "not-a-receipt",
      },
    },
    {
      ...semantic,
      terminalDeliveryEvent: {
        eventType: semantic.terminalDeliveryEvent.eventType,
        occurredAt: semantic.terminalDeliveryEvent.occurredAt,
      },
    },
  ];
  for (const invalid of invalidTerminalReceipts) {
    assert.equal(
      parseManagedSesSendReceipt(invalid),
      null,
      "partial or malformed terminalDeliveryEvent must be rejected",
    );
  }

  const dispositionAction = block(
    actionMailbox,
    "export const disposeManagedSesAmbiguity =",
    "export const release =",
  );
  const semanticSettlement = block(
    dispositionAction,
    "const settleTerminalDeliveryEvent =",
    "if (\n      !config",
  );
  for (const contract of [
    "internal.outreach.recordManagedSesDeliveryEvent",
    "eventType: terminal.eventType",
    "occurredAt: Date.parse(terminal.occurredAt)",
    "eventReceipt: terminal.eventReceipt",
  ]) {
    assert.ok(
      semanticSettlement.includes(contract),
      `terminal status settlement missing ${contract}`,
    );
  }
  assert.doesNotMatch(semanticSettlement, /ok:\s*true/);
  assert.doesNotMatch(semanticSettlement, /queueNextVerifiedAutonomousFollowUp/);
  ordered(dispositionAction, [
    "statusReceipt.terminalDeliveryEvent",
    "settleTerminalDeliveryEvent(statusReceipt)",
    'if (statusReceipt.state !== "external_attempted")',
  ]);

  const directManagedSend = block(
    actionOutreach,
    "const receipt = response.authenticated && response.ok",
    "// The application claim and provider transport both enforce",
  );
  assert.match(
    directManagedSend,
    /receipt\.state\s*===\s*"submitted"|\[\s*"submitted"\s*\]\.includes\(receipt\.state\)/,
    "a complete submitted receipt may be adopted synchronously",
  );
  assert.doesNotMatch(
    directManagedSend,
    /\[[\s\S]{0,120}"event_confirmed"[\s\S]{0,120}\]\.includes\(receipt\.state\)[\s\S]{0,300}ok:\s*true/,
    "generic event_confirmed must not return ok:true or queue a follow-up",
  );
  const directSemanticSettlement = block(
    directManagedSend,
    "if (\n            receipt &&",
    "} else if (",
  );
  for (const contract of [
    "receipt.terminalDeliveryEvent",
    "internal.outreach.recordManagedSesDeliveryEvent",
    "eventType: receipt.terminalDeliveryEvent.eventType",
    "occurredAt: Date.parse(",
    "receipt.terminalDeliveryEvent.occurredAt",
    "eventReceipt: receipt.terminalDeliveryEvent.eventReceipt",
    "terminalEventSettled: true",
    "ok: false",
  ]) {
    assert.ok(
      directSemanticSettlement.includes(contract),
      `direct terminal-event settlement missing ${contract}`,
    );
  }
  assert.doesNotMatch(directSemanticSettlement, /ok:\s*true/);
  assert.doesNotMatch(
    directSemanticSettlement,
    /queueNextVerifiedAutonomousFollowUp/,
  );
});

test("signed delivery events are monotonic across stale and terminal races", () => {
  const event = block(
    outreach,
    "export const recordManagedSesDeliveryEvent =",
    "export const recordManagedSesUnsubscribe =",
  );
  for (const contract of [
    '.order("desc")',
    "args.occurredAt < latestEvent.occurredAt",
    '["replied", "bounced"].includes(message!.status)',
    "!message!.sentAt",
    '["bounced", "complaint"].includes(args.eventType)',
  ]) assert.ok(event.includes(contract), contract);
  assert.doesNotMatch(
    event,
    /\["rejected",\s*"rendering_failed"\][\s\S]{0,600}status:\s*"sent"/,
  );
});

test("per-tenant inbound canary is purpose-bound, activated, retried, and refreshed", () => {
  const now = 1_900_000_000_000;
  assert.equal(managedSesInboundCanaryCurrent({
    verifiedAt: now - 1,
    receipt: DIGEST_A,
    operationKey: OPERATION,
    inboxBinding: DIGEST_B,
    adapterVersion: ADAPTER,
    relayConfigurationHash: DIGEST_A,
    retentionPolicyHash: DIGEST_B,
    expectedRelayConfigurationHash: DIGEST_A,
    expectedRetentionPolicyHash: DIGEST_B,
    expectedAdapterVersion: ADAPTER,
    now,
  }), true);
  assert.equal(managedSesInboundCanaryCurrent({
    verifiedAt: now - MANAGED_SES_INBOUND_CANARY_VALID_MS - 1,
    receipt: DIGEST_A,
    operationKey: OPERATION,
    inboxBinding: DIGEST_B,
    adapterVersion: ADAPTER,
    relayConfigurationHash: DIGEST_A,
    retentionPolicyHash: DIGEST_B,
    expectedRelayConfigurationHash: DIGEST_A,
    expectedRetentionPolicyHash: DIGEST_B,
    expectedAdapterVersion: ADAPTER,
    now,
  }), false);
  const sendCanary = block(
    actionMailbox,
    "export const sendManagedSesEventCanary =",
    "export const activateManagedSesInboundCanary =",
  );
  assert.match(sendCanary, /purpose:\s*"inbound_relay_canary"/);
  assert.match(sendCanary, /sequenceStep:\s*0/);
  assert.match(sendCanary, /replyTo/);
  const activation = block(
    actionMailbox,
    "export const activateManagedSesInboundCanary =",
    "export const disposeManagedSesAmbiguity =",
  );
  assert.match(activation, /route:\s*"inbound-canary"/);
  assert.match(activation, /classifications:\s*\["reply",\s*"stop"\]/);
  assert.match(activation, /markManagedSesInboundCanaryActivationBoundary/);
  assert.match(activation, /recordManagedSesInboundCanaryActivation/);
  assert.match(
    `${mailbox}\n${actionMailbox}`,
    new RegExp(`MANAGED_SES_EVENT_CANARY_VALID_MS[\\s\\S]{0,1600}sendManagedSesEventCanary|sendManagedSesEventCanary[\\s\\S]{0,1600}MANAGED_SES_EVENT_CANARY_VALID_MS`),
    "a bounded scheduler must refresh the canary before its 30-day readiness expires",
  );
  assert.equal(MANAGED_SES_EVENT_CANARY_VALID_MS, 30 * 24 * 60 * 60 * 1000);
});

test("event-canary attempt accounting is exact after more than twenty historical rows", () => {
  const claim = block(
    mailbox,
    "export const claimManagedSesEventCanary =",
    "export const markManagedSesEventCanaryExternalBoundary =",
  );
  for (const contract of [
    'withIndex("by_inbox_configuration_adapter_issued_at"',
    '.eq("inboxConfigurationVersion", inboxConfigurationVersion)',
    '.eq("adapterVersion", resourceAdapterVersion)',
    '.gte("issuedAt", cycleStartedAt)',
    '.lt("issuedAt", cycleEndsAt)',
    "managedSesEventCanaryClaimDecision",
    "currentCycleAttemptCount: currentCycleAttempts.length",
    "const cycleAttempts = canaryDecision.attemptOrdinal",
  ]) assert.ok(claim.includes(contract), contract);
  assert.doesNotMatch(
    claim,
    /withIndex\("by_inbox"[\s\S]{0,120}\.take\(20\)/,
    "the oldest twenty inbox rows must not determine the current attempt ordinal",
  );
  const canarySchema = block(
    schema,
    "managed_ses_event_canaries: defineTable({",
    "managed_ses_delivery_events: defineTable({",
  );
  assert.match(
    canarySchema,
    /\.index\("by_inbox_configuration_adapter_issued_at",\s*\[\s*"inboxId",\s*"inboxConfigurationVersion",\s*"adapterVersion",\s*"issuedAt",?\s*\]\)/,
  );
});

test("canaries consume the same global, tenant, and mailbox attempt pacing", () => {
  const boundary = block(
    mailbox,
    "export const markManagedSesEventCanaryExternalBoundary =",
    "export const recordManagedSesEventCanaryAttempt =",
  );
  assert.match(boundary, /reserveManagedSesPacingAttempt/);
  ordered(actionMailbox, [
    "markManagedSesEventCanaryExternalBoundary",
    'route: "send"',
  ]);
  const pacing = source("convex/lib/managedSesPacing.ts");
  for (const scope of ["global_domain", "tenant_account", "tenant_mailbox"]) {
    assert.ok(pacing.includes(scope), scope);
  }
});

test("generation rotation can safely reuse a fully released canonical inbox", () => {
  assert.equal(nextManagedOutreachMailboxGeneration({
    previousGeneration: 4,
    previousMode: "managed",
    nextMode: "managed",
    hardReset: true,
  }), 5);
  assert.equal(nextManagedOutreachMailboxGeneration({
    previousGeneration: 4,
    previousMode: "managed",
    nextMode: "managed",
    hardReset: false,
  }), 4);
  const install = block(
    outreach,
    "export const installManagedSesInboxInternal =",
    "const managedSesEventTypeValidator =",
  );
  assert.match(
    install,
    /(?:rotationReusable|releasedExisting|reusableExisting|credentialSource\s*===\s*undefined|managedTransportOperationKey\s*===\s*undefined)/,
    "a sealed released row must be reusable by the next managed generation",
  );
  assert.match(
    install,
    /const configurationVersion[\s\S]{0,220}existing\?\.configurationVersion[\s\S]{0,80}\+\s*1/,
  );
  const reconcile = block(
    mailbox,
    "export const reconcileProvisioningResource =",
    "export const getProvisioningOperation =",
  );
  ordered(reconcile, [
    '"managed_mailbox_generation_superseded"',
    "managedSuccessorHandoffResource(",
    "pruneSealedManagedResources(",
    'query("managed_outreach_mailbox_resources")',
  ]);
  assert.match(
    reconcile,
    /row\.generation !== args\.expectedGeneration\s*&&\s*row\._id !== handoff\.resource\?\._id/,
    "the one sealed handoff bridge must not block successor creation",
  );
  const handoff = block(
    mailbox,
    "async function managedSuccessorHandoffResource",
    "async function cancelProvisioningRequestAfterMailboxRetirement",
  );
  for (const contract of [
    'resource.lifecycleState === "cancelled"',
    'resource.releaseState === "released"',
    'tombstone?.state === "released"',
    'inbox.status === "disconnected"',
    "inbox.credentialSource === undefined",
    "managedSesRotationCandidateEligible",
    "managedSesSuccessorHandoffDecision",
    'decision.state === "retain_one"',
    'decision.state === "ambiguous"',
  ]) assert.ok(handoff.includes(contract), contract);
  ordered(install, [
    "await ctx.db.patch(resource._id, {",
    "if (rotationReusableResourceId)",
    "await ctx.db.delete(rotationReusableResourceId)",
  ]);
});

test("provider-progress finalization has the complete request, tenant, deletion, auth, and lease fence", () => {
  const progress = block(
    mailbox,
    "export const recordProvisioningAdapterProgress =",
    "export const claimManagedSesEventCanary =",
  );
  for (const contract of [
    "resource.requestId !== request._id",
    "resource.siteId !== request.siteId",
    "resource.ownerAccountKey !== request.ownerAccountKey",
    "resource.domainSnapshot !== request.domainSnapshot",
    "resource.domainRevisionSnapshot !== request.domainRevisionSnapshot",
    "resource.requestContractVersion !== request.contractVersion",
    "request.revision !== args.expectedRequestRevision",
    "resource.requestConfigurationRevision !==",
    "resource.generation !== args.expectedGeneration",
    "managedOutreachMailboxLeaseIsCurrent",
    "requestFenceIssues",
    "siteExecutionAuthorized",
    "requestResourceRelease",
  ]) assert.ok(progress.includes(contract), contract);
  const base = {
    siteActive: true,
    requestMode: "managed" as const,
    requestOwnerAccountKey: "owner-a",
    currentOwnerAccountKey: "owner-a",
    requestDomainSnapshot: "example.com",
    currentDomainSnapshot: "example.com",
    requestDomainRevisionSnapshot: 3,
    currentDomainRevision: 3,
    expectedConfigurationRevision: 8,
    actualConfigurationRevision: 8,
    expectedGeneration: 4,
    actualGeneration: 4,
    expectedContractVersion: 1,
    actualContractVersion: 1,
  };
  assert.deepEqual(managedOutreachMailboxRequestFenceIssues(base), []);
  assert.ok(managedOutreachMailboxRequestFenceIssues({
    ...base,
    siteActive: false,
  }).includes("site_inactive_or_deleting"));
});

test("managed ambiguity and managed inbox mutations cannot use Gmail manual paths", () => {
  const resolve = block(
    outreach,
    "export const resolveUnverifiedDelivery =",
    "export const recordReply =",
  );
  assert.match(resolve, /message\.deliveryTransport === MANAGED_SES_TRANSPORT/);
  assert.match(resolve, /signed status, event, or no-replay disposition receipts/);
  const profile = block(
    outreach,
    "export const setInboxComplianceProfile =",
    "export const rotateInboundRelayDsnRoutingTarget =",
  );
  assert.match(profile, /inbox\.provider === MANAGED_SES_TRANSPORT/);
  assert.match(profile, /through One Setup/);
  const disconnect = block(
    outreach,
    "export const disconnectInbox =",
    "export const getInboxInternal =",
  );
  assert.match(disconnect, /inbox\.provider === MANAGED_SES_TRANSPORT/);
  assert.match(disconnect, /through One Setup/);
});

test("unsubscribe GET is scanner-safe and POST reports durable settlement failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.CONVEX_SITE_URL;
  const token = "u".repeat(43);
  let fetchCalls = 0;
  try {
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const get = await unsubscribeGet();
    assert.equal(get.status, 200);
    assert.equal(fetchCalls, 0);

    delete process.env.CONVEX_SITE_URL;
    assert.equal((await unsubscribePost(
      new Request(`https://pentra.dev/unsubscribe/${token}`, { method: "POST" }),
      { params: Promise.resolve({ token }) },
    )).status, 503);
    assert.equal(fetchCalls, 0);

    process.env.CONVEX_SITE_URL = "https://example.convex.site";
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(null, { status: 503 });
    }) as typeof fetch;
    assert.equal((await unsubscribePost(
      new Request(`https://pentra.dev/unsubscribe/${token}`, { method: "POST" }),
      { params: Promise.resolve({ token }) },
    )).status, 503);

    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("network unavailable");
    }) as typeof fetch;
    assert.equal((await unsubscribePost(
      new Request(`https://pentra.dev/unsubscribe/${token}`, { method: "POST" }),
      { params: Promise.resolve({ token }) },
    )).status, 503);

    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    assert.equal((await unsubscribePost(
      new Request(`https://pentra.dev/unsubscribe/${token}`, { method: "POST" }),
      { params: Promise.resolve({ token }) },
    )).status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = originalUrl;
  }
  assert.match(unsubscribeRoute, /export async function GET/);
  assert.match(middleware, /"\/unsubscribe\(\.\*\)"/);
  assert.match(middleware, /"analytics", "backlinks", "unsubscribe"/);
  assert.doesNotMatch(
    block(http, "const managedSesUnsubscribeHandler", "http.route({\n  pathPrefix: \"/unsubscribe/\""),
    /request\.method === "GET"[\s\S]{0,500}runMutation/,
  );
  assert.match(http, /request\.method === "POST" && match/);
});

test("managed follow-ups require the exact signed parent operation and thread receipt", () => {
  const sentAt = 1_900_000_000_000;
  const predecessor = {
    _id: "parent",
    siteId: "site",
    ownerAccountKey: "owner",
    inboxId: "inbox",
    opportunityId: "opportunity",
    toEmail: "editor@example.com",
    toDomain: "example.com",
    threadKey: "thread",
    sequenceStep: 0,
    status: "sent",
    sentAt,
    deliveryTransport: "managed_ses",
    managedSesOperationKey: OPERATION,
    managedSesThreadReceipt: THREAD,
    inboundRelayOutboundMessageIdHash: DIGEST_A,
  };
  const message = {
    ...predecessor,
    _id: "child",
    parentMessageId: predecessor._id,
    sequenceStep: 1,
    status: "approved",
    sentAt: undefined,
    scheduledAt: sentAt + 4 * 24 * 60 * 60 * 1000,
    managedSesParentOperationKey: OPERATION,
    managedSesParentThreadReceipt: THREAD,
    inReplyToRfcMessageIdHash: DIGEST_A,
  };
  assert.deepEqual(managedSesFollowUpPredecessorDecision({
    message,
    predecessor,
    ownerAccountKey: "owner",
    threadStopped: false,
  }), {
    allowed: true,
    operationId: OPERATION,
    threadReceipt: THREAD,
    rfcMessageIdDigest: DIGEST_A,
  });
  for (const mutation of [
    { managedSesParentOperationKey: "x".repeat(48) },
    { managedSesParentThreadReceipt: "y".repeat(48) },
    { inReplyToRfcMessageIdHash: DIGEST_B },
  ]) {
    assert.deepEqual(managedSesFollowUpPredecessorDecision({
      message: { ...message, ...mutation },
      predecessor,
      ownerAccountKey: "owner",
      threadStopped: false,
    }), { allowed: false, reason: "predecessor_mismatch" });
  }
  const send = block(
    actionOutreach,
    "const managedSesParent =",
    "let outcome: DeliveryOutcome",
  );
  assert.match(send, /operationId:\s*claim\.message\.managedSesParentOperationKey/);
  assert.match(send, /threadReceipt:\s*claim\.message\.managedSesParentThreadReceipt/);
  const payload = block(
    actionOutreach,
    'route: "send"',
    "timeoutMs: 30_000",
  );
  assert.match(payload, /\.\.\.\(managedSesParent \? \{ parent: managedSesParent \} : \{\}\)/);
});

test("release ambiguity scans cannot hide an unsettled row behind twenty settled rows", () => {
  const releaseGate = block(
    mailbox,
    "async function managedReleaseBlocker",
    "async function releaseTombstoneForOperation",
  );
  for (const contract of [
    'withIndex("by_managed_resource_status_disposition"',
    '.eq("managedSesResourceOperationKey", resource.operationKey)',
    '.eq("status", "delivery_unverified")',
    '.eq("managedSesDispositionSettledAt", undefined)',
    'withIndex("by_resource_status_disposition"',
    '.eq("resourceOperationKey", resource.operationKey)',
    '.eq("status", "unverified")',
    '.eq("dispositionSettledAt", undefined)',
  ]) assert.ok(releaseGate.includes(contract), contract);
  assert.doesNotMatch(
    releaseGate,
    /(?:delivery_unverified|"unverified")[\s\S]{0,220}\.take\(20\)/,
    "a positional 20-row scan can miss the 21st unsettled operation",
  );
  for (const index of [
    "by_managed_resource_status_disposition",
    "by_resource_status_disposition",
  ]) assert.ok(schema.includes(index), index);
  assert.match(schema, /managedSesDispositionSettledAt:\s*v\.optional\(v\.number\(\)\)/);
  assert.match(schema, /dispositionSettledAt:\s*v\.optional\(v\.number\(\)\)/);
});

test("inbound canary activation finalizer rejects owner, domain, config, and deletion drift", () => {
  const activation = block(
    mailbox,
    "export const recordManagedSesInboundCanaryActivation =",
    "type ManagedSesDispositionTarget =",
  );
  for (const contract of [
    "requestFenceIssues({",
    "expectedConfigurationRevision:",
    "resource.requestConfigurationRevision",
    "expectedGeneration: resource.generation",
    "resource.ownerAccountKey !== request.ownerAccountKey",
    "inbox.siteId !== site._id",
    "inbox.credentialOwnerAccountKey !== resource.ownerAccountKey",
    "(inbox.configurationVersion ?? 0) !==",
    "canary.inboxConfigurationVersion",
    "siteExecutionAuthorized",
  ]) assert.ok(activation.includes(contract), contract);

  const base = {
    siteActive: true,
    requestMode: "managed" as const,
    requestOwnerAccountKey: "owner-a",
    currentOwnerAccountKey: "owner-a",
    requestDomainSnapshot: "example.com",
    currentDomainSnapshot: "example.com",
    requestDomainRevisionSnapshot: 3,
    currentDomainRevision: 3,
    expectedConfigurationRevision: 8,
    actualConfigurationRevision: 8,
    expectedGeneration: 4,
    actualGeneration: 4,
    expectedContractVersion: 1,
    actualContractVersion: 1,
  };
  for (const [expected, mutation] of [
    ["site_inactive_or_deleting", { siteActive: false }],
    ["owner_changed", { currentOwnerAccountKey: "owner-b" }],
    ["domain_changed", { currentDomainRevision: 4 }],
    ["configuration_changed", { actualConfigurationRevision: 9 }],
  ] as const) {
    assert.ok(managedOutreachMailboxRequestFenceIssues({
      ...base,
      ...mutation,
    }).includes(expected), expected);
  }
});

test("managed inbound identity stays retryable until a signed RFC digest is adopted", () => {
  const claim = block(
    outreach,
    "export const claimApprovedDelivery =",
    "export const markManagedSesDeliveryExternalBoundary =",
  );
  const relayPatch = block(
    claim,
    "...(inboundRelay",
    "updatedAt: now,",
  );
  assert.match(
    relayPatch,
    /(?:\.\.\.\(\s*!managedSes\s*\?\s*\{[\s\S]{0,500}inboundRelayOutboundMessageIdHash:\s*inboundRelayMessageIdHash\(|inboundRelayOutboundMessageIdHash:\s*managedSes\s*\?\s*undefined\s*:\s*inboundRelayMessageIdHash\()/,
    "a managed claim must not persist the locally invented outbound RFC hash",
  );

  const candidate = block(
    outreach,
    "export const getInboundRelayCandidate =",
    "export const recordInboundRelayReceipt =",
  );
  assert.match(
    candidate,
    /const managedSesIdentityPending\s*=[\s\S]{0,400}message\.deliveryTransport\s*===\s*MANAGED_SES_TRANSPORT[\s\S]{0,400}inboundRelayOutboundMessageIdHash/,
    "managed transport needs an explicit absence-of-signed-RFC identity state",
  );
  const identityPending = block(
    candidate,
    "if (managedSesIdentityPending)",
    'message.status === "sending"',
  );
  assert.match(identityPending, /state:\s*"pending"/);
  assert.doesNotMatch(
    identityPending,
    /deliveryLeaseExpiresAt/,
    "missing signed identity remains pending independent of delivery lease expiry",
  );
  ordered(candidate, [
    "if (managedSesIdentityPending)",
    'state: "pending"',
    'message.status === "sending"',
    "message.deliveryLeaseExpiresAt",
  ]);

  const inboundHandler = block(
    http,
    'path: "/webhooks/outreach-inbound"',
    "const managedSesUnsubscribeHandler",
  );
  ordered(inboundHandler, [
    'if (candidate.state === "pending")',
    "425",
    '"Retry-After": "30"',
    "const classification = classifyInboundRelay",
  ]);
  const unresolved = block(
    inboundHandler,
    'if (candidate.state === "pending")',
    "const classification = classifyInboundRelay",
  );
  assert.doesNotMatch(
    unresolved,
    /accepted:\s*false|status:\s*200/,
    "an unresolved managed identity cannot fall through to an ignored 200",
  );

  const statusAdoption = block(
    mailbox,
    "export const recordManagedSesDispositionOutcome =",
    "export const claimRelease =",
  );
  assert.match(
    statusAdoption,
    /inboundRelayOutboundMessageIdHash:\s*args\.rfcMessageIdDigest/,
  );
  const eventAdoption = block(
    outreach,
    "export const recordManagedSesDeliveryEvent =",
    "export const recordManagedSesUnsubscribe =",
  );
  assert.match(
    eventAdoption,
    /inboundRelayOutboundMessageIdHash:\s*args\.rfcMessageIdDigest/,
  );
});

test("an action death after the managed provider boundary schedules its exact 72-hour reconciliation", () => {
  const claim = block(
    outreach,
    "export const claimApprovedDelivery =",
    "export const markManagedSesDeliveryExternalBoundary =",
  );
  const expired = block(
    claim,
    "if (expired) {",
    'reason: "Another outreach delivery is already in progress for this tenant.",',
  );
  assert.match(expired, /deliveryLeaseRecoveryDecision/);
  assert.match(expired, /recoveryDecision === "restore_approved"/);
  assert.match(expired, /deferClaimedDeliveryBeforeProvider/);
  assert.match(expired, /status:\s*"delivery_unverified"/);
  assert.match(
    expired,
    /scheduler\.runAt\(\s*Math\.max\(\s*now,\s*expired\.managedSesExternalAttemptedAt\s*\+\s*MANAGED_SES_AMBIGUOUS_DISPOSITION_MS/,
    "the first lease-expiry transition must durably schedule the finite ambiguity boundary",
  );
  ordered(expired, [
    "scheduler.runAt",
    "internal.managedOutreachMailbox",
    "claimManagedSesAmbiguityReconciliation",
    "{ resourceId:",
    "return {",
  ]);
  assert.match(
    expired,
    /expired\.managedSesResourceOperationKey|expired\.inboxId/,
    "the scheduler must resolve the exact resource owned by the expired operation",
  );

  const boundary = block(
    outreach,
    "export const markManagedSesDeliveryExternalBoundary =",
    "export const getApprovedDeliveryEvidenceInternal =",
  );
  assert.match(boundary, /scheduler\.runAt/);
  assert.match(boundary, /message\.deliveryLeaseExpiresAt/);
  assert.match(boundary, /recoverManagedSesDelivery[A-Za-z0-9_]*Lease/);
  assert.match(boundary, /messageId:\s*(?:message\._id|args\.messageId)/);
  assert.match(boundary, /attemptId:\s*args\.attemptId/);
  assert.match(boundary, /resourceId:\s*resource\._id/);

  const recoveryExport = outreach.match(
    /export const recoverManagedSesDelivery[A-Za-z0-9_]*Lease\s*=/,
  );
  assert.ok(recoveryExport, "missing exact managed-delivery lease watchdog");
  const recoveryFrom = outreach.indexOf(recoveryExport[0]);
  const recoveryTo = outreach.indexOf(
    "\nexport const ",
    recoveryFrom + recoveryExport[0].length,
  );
  assert.notEqual(recoveryTo, -1, "managed-delivery watchdog terminator");
  const recovery = outreach.slice(recoveryFrom, recoveryTo);
  for (const contract of [
    'message.status !== "sending"',
    "message.deliveryAttemptId !== args.attemptId",
    "!message.managedSesExternalAttemptedAt",
    'status: "delivery_unverified"',
    "MANAGED_SES_AMBIGUOUS_DISPOSITION_MS",
    "claimManagedSesAmbiguityReconciliation",
    "{ resourceId: args.resourceId }",
  ]) assert.ok(recovery.includes(contract), contract);
});

test("canary, activation, and disposition boundaries own exact action-death watchdogs", () => {
  const canaryBoundary = block(
    mailbox,
    "export const markManagedSesEventCanaryExternalBoundary =",
    "export const recoverManagedSesEventCanaryLease =",
  );
  ordered(canaryBoundary, [
    "externalAttemptedAt: timestamp",
    "scheduler.runAt",
    "canary.sendLeaseExpiresAt",
    "recoverManagedSesEventCanaryLease",
    "canaryId: canary._id",
    "operationKey: canary.operationKey",
  ]);
  assert.doesNotMatch(canaryBoundary, /dispatchRequest|claimFleet/);
  const canaryRecovery = block(
    mailbox,
    "export const recoverManagedSesEventCanaryLease =",
    "export const recordManagedSesEventCanaryAttempt =",
  );
  for (const contract of [
    "canary.operationKey !== args.operationKey",
    'canary.status !== "claimed"',
    "canary.sendLeaseExpiresAt",
    'status: "unverified"',
    "canary.externalAttemptedAt + MANAGED_SES_AMBIGUOUS_DISPOSITION_MS",
    "claimManagedSesAmbiguityReconciliation",
    "{ resourceId: canary.resourceId }",
  ]) assert.ok(canaryRecovery.includes(contract), contract);

  const activationBoundary = block(
    mailbox,
    "export const markManagedSesInboundCanaryActivationBoundary =",
    "export const recordManagedSesInboundCanaryActivation =",
  );
  ordered(activationBoundary, [
    'inboundCanaryActivationState: "external_attempted"',
    "scheduler.runAt",
    "canary.inboundCanaryActivationLeaseExpiresAt",
    "activateManagedSesInboundCanary",
    "canaryId: canary._id",
  ]);
  assert.doesNotMatch(activationBoundary, /dispatchRequest|claimFleet/);

  const dispositionBoundary = block(
    mailbox,
    "export const markManagedSesDispositionExternalBoundary =",
    "export const recordManagedSesDispositionOutcome =",
  );
  assert.match(dispositionBoundary, /scheduler\.runAt/);
  assert.match(
    dispositionBoundary,
    /(?:managedSesDispositionLeaseExpiresAt|dispositionLeaseExpiresAt)/,
  );
  assert.match(
    dispositionBoundary,
    /recoverManagedSesDisposition[A-Za-z0-9_]*Lease/,
  );
  for (const binding of [
    /resourceId:\s*resource\._id/,
    /operationKey:\s*args\.operationKey/,
    /leaseToken:\s*args\.leaseToken/,
  ]) assert.match(dispositionBoundary, binding);

  const dispositionRecoveryExport = mailbox.match(
    /export const recoverManagedSesDisposition[A-Za-z0-9_]*Lease\s*=/,
  );
  assert.ok(
    dispositionRecoveryExport,
    "missing exact disposition action-death watchdog",
  );
  const dispositionFrom = mailbox.indexOf(dispositionRecoveryExport[0]);
  const dispositionTo = mailbox.indexOf(
    "\nexport const ",
    dispositionFrom + dispositionRecoveryExport[0].length,
  );
  assert.notEqual(dispositionTo, -1, "disposition watchdog terminator");
  const dispositionRecovery = mailbox.slice(dispositionFrom, dispositionTo);
  for (const contract of [
    "args.operationKey",
    "args.leaseToken",
    "managedSesDispositionTarget",
    "nextLeaseExpiresAt",
    "scheduler.runAt",
    "nextLeaseExpiresAt + 1_000",
    "recoverManagedSesDispositionLease",
    "leaseToken: nextLeaseToken",
    "disposeManagedSesAmbiguity",
  ]) assert.ok(dispositionRecovery.includes(contract), contract);
  ordered(dispositionRecovery, [
    "target.row.managedSesDispositionLeaseToken === args.leaseToken",
    "nextLeaseToken",
    "scheduler.runAt",
    "leaseToken: nextLeaseToken",
    "scheduler.runAfter",
    "disposeManagedSesAmbiguity",
  ]);
  const recoverLease = (
    currentToken: string,
    wakeToken: string,
    generation: number,
  ) => currentToken === wakeToken ? `lease-${generation + 1}` : currentToken;
  const firstToken = "lease-1";
  const secondToken = recoverLease(firstToken, firstToken, 1);
  assert.equal(secondToken, "lease-2");
  assert.equal(
    recoverLease(secondToken, firstToken, 2),
    secondToken,
    "the stale first watchdog cannot rotate the recovered lease",
  );
  assert.equal(
    recoverLease(secondToken, secondToken, 2),
    "lease-3",
    "a second pre-boundary action death receives another exact lease",
  );
  assert.doesNotMatch(dispositionRecovery, /route:\s*"send"/);
});

test("shared Gmail and managed boundaries give STOP, suppression, and consent the zero-provider win", () => {
  const authorized = {
    alreadyExternalAttempted: false,
    exactClaimCurrent: true,
    siteExecutionAuthorized: true,
    ownerAndConfigurationCurrent: true,
    consentCurrent: true,
    recipientUnsuppressed: true,
    threadCurrent: true,
    predecessorCurrent: true,
    opportunityEvidenceCurrent: true,
    inboundRelayCurrent: true,
  };
  for (const transport of ["gmail", "managed_ses"] as const) {
    let providerCalls = 0;
    const cross = (decision: ReturnType<typeof deliveryExternalBoundaryDecision>) => {
      if (decision.providerCallAllowed) providerCalls += 1;
    };
    cross(deliveryExternalBoundaryDecision(authorized));
    assert.equal(providerCalls, 1, `${transport} exact claim crosses once`);
    for (const revoked of [
      "exactClaimCurrent",
      "siteExecutionAuthorized",
      "ownerAndConfigurationCurrent",
      "consentCurrent",
      "recipientUnsuppressed",
      "threadCurrent",
      "predecessorCurrent",
      "opportunityEvidenceCurrent",
      "inboundRelayCurrent",
    ] as const) {
      providerCalls = 0;
      const decision = deliveryExternalBoundaryDecision({
        ...authorized,
        [revoked]: false,
      });
      cross(decision);
      assert.deepEqual(decision, {
        state: "deny_preboundary",
        providerCallAllowed: false,
      }, `${transport}:${revoked}`);
      assert.equal(providerCalls, 0, `${transport}:${revoked} called provider`);
    }
    providerCalls = 0;
    cross(deliveryExternalBoundaryDecision({
      ...authorized,
      alreadyExternalAttempted: true,
    }));
    assert.equal(providerCalls, 0, `${transport} replayed external boundary`);
  }

  const sharedBoundary = block(
    outreach,
    "async function authorizeClaimedDeliveryAtExternalBoundary",
    "export const markManagedSesDeliveryExternalBoundary =",
  );
  for (const contract of [
    "deliveryExternalBoundaryDecision",
    "autonomousOutreachConsentActive",
    "persistentSuppressionExists",
    "siteSuppressionExists",
    'eq("status", "replied")',
    'eq("status", "bounced")',
    "managedSesFollowUpPredecessorDecision",
    "followUpPredecessorDecision",
    "deliveryOpportunityBoundaryCurrent",
    "authorityOpportunityMatchesCurrentDomain",
    "opportunityEvidenceIsFresh",
    "inboundRelayDsnRoutingReady",
    "inboundRelayRuntimeConfig",
    "terminalizeClaimedDeliveryBeforeProvider",
  ]) assert.ok(sharedBoundary.includes(contract), contract);
  ordered(actionOutreach, [
    "internal.outreach.claimApprovedDelivery",
    "internal.outreach.markManagedSesDeliveryExternalBoundary",
    'route: "send"',
  ]);
  ordered(actionOutreach, [
    "internal.outreach.markGmailDeliveryExternalBoundary",
    "outcome = await deliver(",
  ]);

  const exactOpportunity = {
    messageSiteId: "site-a",
    opportunitySiteId: "site-a",
    sequenceStep: 0,
    opportunityStatus: "outreach_prepared",
    messageEvidenceHash: "evidence-a",
    opportunityEvidenceHash: "evidence-a",
    messageSourceUrl: "https://publisher.test/source",
    opportunitySourceUrl: "https://publisher.test/source",
    messageTargetUrl: "https://tenant.test/target",
    opportunityTargetUrl: "https://tenant.test/target",
    currentDomainBinding: true,
    initialEvidenceFresh: true,
  };
  assert.equal(deliveryOpportunityBoundaryCurrent(exactOpportunity), true);
  for (const opportunityStatus of ["acquired", "rejected"]) {
    for (const transport of ["gmail", "managed_ses"] as const) {
      let providerCalls = 0;
      const opportunityEvidenceCurrent = deliveryOpportunityBoundaryCurrent({
        ...exactOpportunity,
        opportunityStatus,
      });
      const decision = deliveryExternalBoundaryDecision({
        ...authorized,
        opportunityEvidenceCurrent,
      });
      if (decision.providerCallAllowed) providerCalls += 1;
      assert.equal(providerCalls, 0, `${transport}:${opportunityStatus}`);
      assert.equal(decision.state, "deny_preboundary");
    }
  }
  const terminalizer = block(
    outreach,
    "async function terminalizeClaimedDeliveryBeforeProvider",
    "async function deferClaimedDeliveryBeforeProvider",
  );
  assert.match(terminalizer, /releaseDurableContactClaimForAccount/);
});

test("claim-owned lease watchdogs distinguish pre-boundary retry from post-boundary no-replay", () => {
  for (const transport of ["gmail", "managed_ses"] as const) {
    assert.equal(deliveryLeaseRecoveryDecision({
      exactClaimCurrent: true,
      leaseExpired: true,
      externalAttempted: false,
    }), "restore_approved", transport);
    assert.equal(deliveryLeaseRecoveryDecision({
      exactClaimCurrent: true,
      leaseExpired: true,
      externalAttempted: true,
    }), "delivery_unverified_no_replay", transport);
    assert.equal(deliveryLeaseRecoveryDecision({
      exactClaimCurrent: true,
      leaseExpired: false,
      externalAttempted: false,
    }), "noop", transport);
    assert.equal(deliveryLeaseRecoveryDecision({
      exactClaimCurrent: false,
      leaseExpired: true,
      externalAttempted: false,
    }), "noop", transport);
  }
  const claim = block(
    outreach,
    "export const claimApprovedDelivery =",
    "type DeliveryBoundaryTransport =",
  );
  ordered(claim, [
    'status: "sending"',
    "scheduler.runAt",
    "recoverApprovedDeliveryBoundaryLease",
    "{ siteId, messageId: message._id, attemptId }",
    "claimed: true",
  ]);
  const recovery = block(
    outreach,
    "export const recoverApprovedDeliveryBoundaryLease =",
    "export const recoverManagedSesDeliveryBoundaryLease =",
  );
  for (const contract of [
    "deliveryLeaseRecoveryDecision",
    'recoveryDecision === "restore_approved"',
    "deferClaimedDeliveryBeforeProvider",
    'status: "delivery_unverified"',
    "claimManagedSesAmbiguityReconciliation",
  ]) assert.ok(recovery.includes(contract), contract);

  const canaryClaim = block(
    mailbox,
    "export const claimManagedSesEventCanary =",
    "export const markManagedSesEventCanaryExternalBoundary =",
  );
  ordered(canaryClaim, [
    'status: "claimed"',
    "scheduler.runAt",
    "recoverManagedSesEventCanaryLease",
    "{ canaryId, operationKey }",
    "claimed: true",
  ]);
  const canaryRecovery = block(
    mailbox,
    "export const recoverManagedSesEventCanaryLease =",
    "export const recordManagedSesEventCanaryAttempt =",
  );
  ordered(canaryRecovery, [
    "if (!canary.externalAttemptedAt)",
    "ctx.db.delete(canary._id)",
    "sendManagedSesEventCanary",
    'status: "unverified"',
    "MANAGED_SES_AMBIGUOUS_DISPOSITION_MS",
  ]);

  const activationClaim = block(
    mailbox,
    "export const claimManagedSesInboundCanaryActivation =",
    "export const markManagedSesInboundCanaryActivationBoundary =",
  );
  ordered(activationClaim, [
    'inboundCanaryActivationState: "claimed"',
    "scheduler.runAt",
    "activateManagedSesInboundCanary",
    "{ canaryId: canary._id }",
    "claimed: true",
  ]);
  const dispositionClaim = block(
    mailbox,
    "async function claimEligibleManagedSesDisposition",
    "export const claimManagedSesAmbiguityReconciliation =",
  );
  ordered(dispositionClaim, [
    'managedSesDispositionState: "claimed"',
    "scheduler.runAt",
    "recoverManagedSesDispositionLease",
    "operationKey",
    "leaseToken",
    "disposeManagedSesAmbiguity",
  ]);
});

test("canary saturation model isolates cycle/config history and never reuses a live ordinal", () => {
  assert.deepEqual(managedSesEventCanaryClaimDecision({
    currentCycleAttemptCount: 0,
    rollingAttemptCount: 20,
    liveStatuses: ["unverified"],
  }), { state: "attempt_exists" });
  assert.deepEqual(managedSesEventCanaryClaimDecision({
    currentCycleAttemptCount: 4,
    rollingAttemptCount: 20,
    liveStatuses: [],
  }), { state: "create", attemptOrdinal: 4 });
  assert.deepEqual(managedSesEventCanaryClaimDecision({
    currentCycleAttemptCount: 10,
    rollingAttemptCount: 20,
    liveStatuses: [],
  }), { state: "attempt_limit" });
  assert.deepEqual(managedSesEventCanaryClaimDecision({
    currentCycleAttemptCount: 0,
    rollingAttemptCount: 21,
    liveStatuses: [],
  }), { state: "attempt_limit" });
  assert.deepEqual(managedSesEventCanaryClaimDecision({
    currentCycleAttemptCount: 2,
    rollingAttemptCount: 2,
    liveStatuses: ["delivered"],
  }), { state: "already_verified" });
});

test("generation handoff model retains exactly one matching released bridge", () => {
  const candidate = {
    differentGeneration: true,
    resourceRequestMatches: true,
    siteMatches: true,
    ownerMatches: true,
    domainMatches: true,
    domainRevisionMatches: true,
    contractMatches: true,
    resourceReleased: true,
    tombstoneMatches: true,
    inboxIdentityMatches: true,
    inboxProvenanceCleared: true,
    noPendingWork: true,
  };
  assert.equal(managedSesRotationCandidateEligible(candidate), true);
  for (const changed of [
    "ownerMatches",
    "domainMatches",
    "domainRevisionMatches",
    "tombstoneMatches",
    "inboxProvenanceCleared",
    "noPendingWork",
  ] as const) {
    assert.equal(managedSesRotationCandidateEligible({
      ...candidate,
      [changed]: false,
    }), false, changed);
  }
  assert.deepEqual(managedSesSuccessorHandoffDecision({
    successorAlreadyInstalled: false,
    eligibleResourceIds: ["old-resource"],
  }), { state: "retain_one", resourceId: "old-resource" });
  assert.deepEqual(managedSesSuccessorHandoffDecision({
    successorAlreadyInstalled: false,
    eligibleResourceIds: ["old-a", "old-b"],
  }), { state: "ambiguous" });
  assert.deepEqual(managedSesSuccessorHandoffDecision({
    successorAlreadyInstalled: true,
    eligibleResourceIds: ["old-resource"],
  }), { state: "none" });
});

test("managed pacing denial defers deliveries and discards unattempted canary ordinals", () => {
  const now = Date.UTC(2026, 7, 25, 19, 0, 0);
  const globalDenied = managedSesGlobalPacingDecision({
    now,
    lastAttemptAt: now - 1,
  });
  const accountDenied = managedSesScopedPacingDecision({
    now,
    lastAttemptAt: now - 1,
    dailyCap: 30,
    minimumIntervalMs: 30 * 60 * 1000,
    scope: "account",
  });
  const mailboxDenied = managedSesScopedPacingDecision({
    now,
    lastAttemptAt: now - 1,
    dailyCap: 30,
    minimumIntervalMs: 30 * 60 * 1000,
    scope: "mailbox",
  });
  for (const denial of [globalDenied, accountDenied, mailboxDenied]) {
    assert.equal(denial.allowed, false);
    assert.ok(denial.nextEligibleAt && denial.nextEligibleAt > now);
    assert.equal(managedSesPacingBoundaryTransition({
      kind: "delivery",
      reserved: false,
      nextEligibleAt: denial.nextEligibleAt,
    }), "defer_delivery");
    assert.equal(managedSesPacingBoundaryTransition({
      kind: "canary",
      reserved: false,
      nextEligibleAt: denial.nextEligibleAt,
    }), "discard_canary_and_retry");
  }
  const combined = managedSesCombinedPacingDecision([
    globalDenied,
    accountDenied,
    { allowed: true, reason: "mailbox-b-allowed" },
  ]);
  assert.equal(combined.allowed, false);
  if (!combined.allowed) {
    assert.equal(
      combined.nextEligibleAt,
      Math.max(globalDenied.nextEligibleAt!, accountDenied.nextEligibleAt!),
      "the retry wake must honor the latest denied scope, not herd at the global interval",
    );
  }
  assert.deepEqual(managedSesCombinedPacingDecision([
    { allowed: true, reason: "global-allowed" },
    { allowed: true, reason: "other-account-allowed" },
    { allowed: true, reason: "other-mailbox-allowed" },
  ]), { allowed: true });
  assert.equal(managedSesPacingBoundaryTransition({
    kind: "delivery",
    reserved: true,
  }), "cross_external_boundary");
  assert.equal(managedSesPacingBoundaryTransition({
    kind: "canary",
    reserved: false,
  }), "invalid_binding");

  const deliveryBoundary = block(
    outreach,
    "export const markManagedSesDeliveryExternalBoundary =",
    "export const markGmailDeliveryExternalBoundary =",
  );
  ordered(deliveryBoundary, [
    "reserveManagedSesPacingAttempt",
    "managedSesPacingBoundaryTransition",
    'pacingTransition === "defer_delivery"',
    "deferClaimedDeliveryBeforeProvider",
    "deliveryExternalAttemptedAt: timestamp",
  ]);
  const deferral = block(
    outreach,
    "async function deferClaimedDeliveryBeforeProvider",
    "async function authorizeClaimedDeliveryAtExternalBoundary",
  );
  for (const contract of [
    'status: "approved"',
    "scheduledAt: deferredUntil",
    "deliveryAttemptId: undefined",
    "releaseDurableContactClaimForAccount",
    "actions.outreachFleet.runSite",
  ]) assert.ok(deferral.includes(contract), contract);
  const canaryBoundary = block(
    mailbox,
    "export const markManagedSesEventCanaryExternalBoundary =",
    "export const recoverManagedSesEventCanaryLease =",
  );
  ordered(canaryBoundary, [
    "reserveManagedSesPacingAttempt",
    "managedSesPacingBoundaryTransition",
    'pacingTransition === "discard_canary_and_retry"',
    "ctx.db.delete(canary._id)",
    "sendManagedSesEventCanary",
    "externalAttemptedAt: timestamp",
  ]);
});

test("provider, RFC, and thread identity is immutable across status, disposition, and events", () => {
  const tupleA = {
    establishedProviderMessageIdDigest: DIGEST_A,
    establishedRfcMessageIdDigest: DIGEST_A,
    establishedThreadReceipt: THREAD,
    providerMessageIdDigest: DIGEST_A,
    rfcMessageIdDigest: DIGEST_A,
    threadReceipt: THREAD,
  };
  assert.equal(managedSesIdentityTupleMatchesEstablished(tupleA), true);
  assert.equal(managedSesIdentityTupleMatchesEstablished({
    ...tupleA,
    rfcMessageIdDigest: DIGEST_B,
  }), false);
  assert.equal(managedSesIdentityTupleMatchesEstablished({
    ...tupleA,
    threadReceipt: "x".repeat(48),
  }), false);
  assert.equal(managedSesIdentityTupleMatchesEstablished({
    ...tupleA,
    rfcMessageIdDigest: undefined,
  }), false);
  const statusLearnedTuple = {
    establishedProviderMessageIdDigest: DIGEST_A,
    establishedRfcMessageIdDigest: DIGEST_A,
    establishedThreadReceipt: THREAD,
  };
  assert.equal(managedSesIdentityTupleMatchesEstablished({
    ...statusLearnedTuple,
    providerMessageIdDigest: DIGEST_A,
    rfcMessageIdDigest: DIGEST_B,
    threadReceipt: THREAD,
  }), false, "status tuple A cannot be replaced by disposition tuple B");
  assert.equal(managedSesIdentityTupleMatchesEstablished({
    ...statusLearnedTuple,
  }), false, "status tuple A cannot be followed by an identity-less receipt");

  const partial = {
    state: "submitted",
    operationKey: OPERATION,
    resourceOperationKey: RESOURCE,
    generation: 7,
    adapterVersion: ADAPTER,
    sequenceStep: 0,
    purpose: "outreach",
    updatedAt: 1_900_000_000,
    providerMessageIdDigest: DIGEST_A,
    threadReceipt: THREAD,
  };
  assert.equal(parseManagedSesSendReceipt(partial), null);

  const dispositionAction = block(
    actionMailbox,
    "export const disposeManagedSesAmbiguity =",
    "export const release =",
  );
  for (const contract of [
    "claim.providerMessageIdDigest",
    "claim.rfcMessageIdDigest",
    "claim.threadReceipt",
    "statusIdentityCount",
    "effectiveProviderMessageIdDigest",
    "effectiveRfcMessageIdDigest",
    "effectiveThreadReceipt",
    'record({ state: "identity_mismatch" })',
  ]) assert.ok(dispositionAction.includes(contract), contract);
  ordered(dispositionAction, [
    'statusReceipt.state !== "external_attempted"',
    "markManagedSesDispositionExternalBoundary",
    "providerMessageIdDigest: effectiveProviderMessageIdDigest",
    'route: "disposition"',
    "dispositionIdentityCount",
    'record({ state: "identity_mismatch" })',
  ]);
  assert.match(
    dispositionAction,
    /receipt\.state === "missing"[\s\S]{0,350}identity_mismatch/,
  );
  const dispositionBoundary = block(
    mailbox,
    "export const markManagedSesDispositionExternalBoundary =",
    "export const recordManagedSesDispositionOutcome =",
  );
  for (const contract of [
    "establishedIdentityCount",
    "suppliedIdentityCount",
    "managedSesIdentityTupleMatchesEstablished",
    "managedSesProviderMessageIdDigest: args.providerMessageIdDigest",
    "inboundRelayOutboundMessageIdHash: args.rfcMessageIdDigest",
    "managedSesThreadReceipt: args.threadReceipt",
  ]) assert.ok(dispositionBoundary.includes(contract), contract);
  const dispositionOutcome = block(
    mailbox,
    "export const recordManagedSesDispositionOutcome =",
    "export const claimRelease =",
  );
  ordered(dispositionOutcome, [
    "const identityMismatch =",
    "managedSesIdentityTupleMatchesEstablished",
    "if (identityMismatch)",
    "quarantineManagedSesMessageIdentityMismatch",
    "settleManagedSesAcceptedMessage",
  ]);
  assert.match(dispositionOutcome, /if \(!identityMismatch\) \{[\s\S]{0,500}managedSesProviderMessageIdDigest/);

  const event = block(
    outreach,
    "export const recordManagedSesDeliveryEvent =",
    "export const recordManagedSesUnsubscribe =",
  );
  assert.ok(
    (event.match(/managedSesIdentityTupleMatchesEstablished/g) ?? []).length >= 2,
    "message and canary events must both bind the full established tuple",
  );
  ordered(event, [
    "quarantineManagedSesEventCanaryIdentityMismatch",
    'insert("managed_ses_delivery_events"',
  ]);
  const messageEvent = block(
    outreach,
    "const [inbox, eventSite, releaseTombstone]",
    "export const recordManagedSesUnsubscribe =",
  );
  ordered(messageEvent, [
    "managedSesIdentityTupleMatchesEstablished",
    "quarantineManagedSesMessageIdentityMismatch",
    'query("managed_ses_delivery_events")',
    'insert("managed_ses_delivery_events"',
  ]);
});
