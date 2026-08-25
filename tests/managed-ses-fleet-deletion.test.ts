import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  planOutreachFleetSite,
  type OutreachFleetSiteState,
} from "../convex/actions/outreachFleet.ts";

const sites = readFileSync(
  new URL("../convex/sites.ts", import.meta.url),
  "utf8",
);

function block(startMarker: string, endMarker: string): string {
  const start = sites.indexOf(startMarker);
  const end = sites.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return sites.slice(start, end);
}

function managedState(
  overrides: Partial<OutreachFleetSiteState> = {},
): OutreachFleetSiteState {
  return {
    siteId: "managed-site",
    autopilotEnabled: true,
    autopilotRolloutMode: "live",
    inboxConfigurationValid: true,
    hasInbox: true,
    inboxProvider: "managed_ses",
    inboxStatus: "active",
    inboxMode: "live",
    inboxVerified: true,
    inboxOwnerCurrent: true,
    outboundTransportReady: true,
    autonomyConsentActive: true,
    autonomyDurabilityMigrationPending: false,
    autonomyReconciliationPending: false,
    hasVerifiedOpportunities: false,
    hasApprovedMessages: true,
    hasDueAutomaticMessages: true,
    hasLinksToVerify: false,
    inboundMonitoringReady: true,
    inboundMonitoringMode: "signed_relay",
    hasMessagesToMonitor: true,
    ...overrides,
  };
}

test("managed SES enters fleet delivery without Gmail identity fields", () => {
  const ready = planOutreachFleetSite(managedState(), "delivery");
  assert.equal(ready.deliver, true);
  assert.equal(ready.failClosedReason, undefined);

  for (const unsafe of [
    { inboxOwnerCurrent: false },
    { inboxOwnerCurrent: undefined },
    { outboundTransportReady: false },
    { outboundTransportReady: undefined },
    { inboxStatus: "disconnected" },
    { inboxVerified: false },
    { inboundMonitoringReady: false },
    { inboundMonitoringMode: "unavailable" as const },
  ]) {
    assert.equal(
      planOutreachFleetSite(managedState(unsafe), "delivery").deliver,
      false,
    );
  }
});

test("managed SES signed relay is event-driven and never schedules Gmail polling", () => {
  const inbound = planOutreachFleetSite(managedState(), "inbound");
  assert.equal(inbound.monitor, false);
  assert.equal(inbound.deliver, false);

  const fleetProjection = block(
    "async function outreachFleetState",
    "export const listOutreachFleetPage",
  );
  assert.match(fleetProjection, /managedSesInboxReceiptCurrent/);
  assert.match(fleetProjection, /inboundRelayConfigurationHash/);
  assert.match(fleetProjection, /managed_outreach_mailbox_resources/);
  assert.match(fleetProjection, /withIndex\("by_canonical_inbox"/);
  assert.match(fleetProjection, /managedSesResource\.ownerAccountKey === siteOwnerAccountKey/);
  assert.match(fleetProjection, /managedSesResource\.resourceReceipt ===[\s\S]*inbox\.managedTransportResourceReceipt/);
  assert.match(fleetProjection, /managedSesResource\.externalVerifiedAt ===[\s\S]*inbox\.managedTransportResourceVerifiedAt/);
  assert.match(fleetProjection, /inboundRelayOutboundMessageIdHash/);
  assert.match(fleetProjection, /managedTransportInboundCanaryRelayConfigurationHash/);
  assert.match(fleetProjection, /managedTransportInboundCanaryRetentionPolicyHash/);
  assert.match(fleetProjection, /inboxOwnerCurrent/);
  assert.match(fleetProjection, /outboundTransportReady/);
});

test("ordinary site deletion stages exact managed release before ambiguity gating", () => {
  const request = block(
    "async function requestSiteDeletion",
    "async function revokeSiteCredentialsForAccountDeletion",
  );
  assert.ok(
    request.indexOf("stageManagedOutreachMailboxRelease(") <
      request.indexOf("gateSiteDeletionForOutreach(ctx, siteId)"),
  );
  const gate = block(
    "async function managedSesDeliveryHasExactReleaseFence",
    "async function requestSiteDeletion",
  );
  assert.match(gate, /deliveryTransport !== MANAGED_SES_TRANSPORT/);
  assert.match(gate, /managedSesResourceOperationKey/);
  assert.match(gate, /managedSesGeneration/);
  assert.match(gate, /managedSesAdapterVersion/);
  assert.match(gate, /managed_adapter_retiring/);
  assert.match(gate, /managedOutreachMailboxReleaseSealed/);

  const reset = block("export const resetAll", "export const fixOrphanSites");
  assert.match(reset, /allowAtomicManagedReleaseStaging: true/);
});

test("verified account deletion fences immediately then honors every external lease", () => {
  const revoke = block(
    "async function revokeSiteCredentialsForAccountDeletion",
    "async function continueAccountDeletionPage",
  );
  assert.doesNotMatch(revoke, /gateInboundRelayCanaryExternalLease/);
  assert.match(revoke, /stageManagedOutreachMailboxRelease/);
  assert.match(revoke, /accountDeletionRequestedAt/);

  const finalizeSite = block(
    "export const finalizeAccountSiteDeletionInternal",
    "async function accountReceiptRowsForStage",
  );
  assert.match(finalizeSite, /managed_ses_event_canaries/);
  assert.match(finalizeSite, /sendLeaseExpiresAt/);
  assert.match(finalizeSite, /dispositionLeaseExpiresAt/);
  assert.ok(
    finalizeSite.indexOf("safeAfter > timestamp") <
      finalizeSite.indexOf('deletionStatus: "running"'),
  );
});

test("foreign-owner managed cleanup releases and drains only the exact inbox", () => {
  const helper = block(
    "async function stageForeignOwnerManagedInboxRelease",
    "export const finalizeAccountDeletionInternal",
  );
  assert.match(helper, /stageManagedOutreachMailboxReleaseForInbox/);
  assert.match(helper, /withIndex\("by_canonical_inbox"/);
  assert.match(helper, /resource\.ownerAccountKey !== deletingOwnerAccountKey/);
  assert.match(helper, /managedOutreachMailboxReleaseSealed/);
  assert.doesNotMatch(helper, /stageManagedOutreachMailboxRelease\(\s*ctx,\s*inbox\.siteId/);

  const finalize = block(
    "export const finalizeAccountDeletionInternal",
    "export const recoverAccountDeletionsInternal",
  );
  const foreignInbox = finalize.slice(
    finalize.indexOf('name === "outreach_foreign_owner_inboxes"'),
    finalize.indexOf('name === "outreach_foreign_owner_contacts"'),
  );
  assert.match(foreignInbox, /stageForeignOwnerManagedInboxRelease/);
  assert.match(foreignInbox, /query\("managed_ses_delivery_events"\)[\s\S]*withIndex\("by_inbox"/);
  assert.match(foreignInbox, /query\("managed_ses_event_canaries"\)[\s\S]*withIndex\("by_inbox"/);
  assert.match(foreignInbox, /ctx\.db\.delete\(managedRelease\.resource\._id\)/);
  assert.doesNotMatch(foreignInbox, /managed_ses_(?:delivery_events|event_canaries)"\)[\s\S]{0,120}withIndex\("by_site"/);
});

test("site deletion performs a terminal SES-event sweep after event parents", () => {
  const stages = block(
    "const SITE_DELETION_STAGES",
    "async function gateInboundRelayCanaryExternalLease",
  );
  const firstEvents = stages.indexOf('"managed_ses_delivery_events"');
  const canaries = stages.indexOf('"managed_ses_event_canaries"');
  const messages = stages.indexOf('"outreach_messages"');
  const terminalEvents = stages.indexOf(
    '"managed_ses_delivery_events_terminal"',
  );
  assert.ok(firstEvents >= 0 && firstEvents < canaries);
  assert.ok(canaries < messages && messages < terminalEvents);

  const rows = block(
    "async function deletionRowsForStage",
    "export const continueSiteDeletionInternal",
  );
  assert.match(
    rows,
    /case "managed_ses_delivery_events":\s*case "managed_ses_delivery_events_terminal":[\s\S]*withIndex\("by_site"/,
  );
  const continuation = block(
    "export const continueSiteDeletionInternal",
    "export const requestSiteDeletionInternal",
  );
  assert.match(
    continuation,
    /for \(let verifyStage = 0; verifyStage < SITE_DELETION_STAGES\.length; verifyStage\+\+\)/,
  );
});
