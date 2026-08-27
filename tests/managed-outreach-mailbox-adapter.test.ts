import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Doc, Id } from "../convex/_generated/dataModel.ts";
import {
  MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED,
  MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE,
  MANAGED_OUTREACH_MAILBOX_ACCOUNT_DELETION_QUIESCENCE_MS,
  managedOutreachMailboxAdapterConfiguration,
  managedOutreachMailboxCanaryReleasePending,
  managedOutreachMailboxLeaseIsCurrent,
  managedOutreachMailboxOperationalIssues,
  managedOutreachMailboxOperationallyReady,
  managedOutreachMailboxReleaseSealed,
  managedOutreachMailboxRequestFenceIssues,
  managedOutreachMailboxVerifiedDeletionSettled,
  nextManagedOutreachMailboxGeneration,
} from "../convex/lib/managedOutreachMailbox.ts";
import {
  inboundRelayConfigurationHash,
  OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION,
  type InboundRelayRuntimeConfig,
} from "../convex/lib/outreachInboundRelay.ts";

const schema = readFileSync("convex/schema.ts", "utf8");
const ledger = readFileSync("convex/managedOutreachMailbox.ts", "utf8");
const action = readFileSync(
  "convex/actions/managedOutreachMailbox.ts",
  "utf8",
);
const outreach = readFileSync("convex/outreach.ts", "utf8");
const dispatcher = readFileSync("convex/managedProvisioning.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const wizard = readFileSync(
  "src/components/onboarding/setup-wizard.tsx",
  "utf8",
);
const autonomy = readFileSync("convex/lib/outreachAutonomy.ts", "utf8");
const canonicalReadiness = readFileSync(
  "convex/lib/oneSetupCanonical.ts",
  "utf8",
);
const http = readFileSync("convex/http.ts", "utf8");
const gmailAuthRoute = readFileSync(
  "src/app/api/outreach/gmail/auth/route.ts",
  "utf8",
);
const gmailCallbackRoute = readFileSync(
  "src/app/api/outreach/gmail/callback/route.ts",
  "utf8",
);

test("mailbox generation is stable across retries and passive dispatcher revisions", () => {
  assert.equal(nextManagedOutreachMailboxGeneration({
    nextMode: "managed",
    hardReset: false,
  }), 1);
  assert.equal(nextManagedOutreachMailboxGeneration({
    previousGeneration: 4,
    previousMode: "managed",
    nextMode: "managed",
    hardReset: false,
  }), 4);
  assert.equal(nextManagedOutreachMailboxGeneration({
    previousGeneration: 4,
    previousMode: "managed",
    nextMode: "connect_existing",
    hardReset: false,
  }), 5);
  assert.equal(nextManagedOutreachMailboxGeneration({
    previousGeneration: 4,
    previousMode: "managed",
    nextMode: "managed",
    hardReset: true,
  }), 5);
  assert.match(sites, /outreachMailboxGeneration = nextManagedOutreachMailboxGeneration/);
  assert.doesNotMatch(dispatcher, /outreachMailboxGeneration:\s*request\.revision/);
});

test("lease and every request/domain/config/deletion interleaving fail closed", () => {
  const base = {
    siteActive: true,
    requestMode: "managed" as const,
    requestOwnerAccountKey: "owner-a",
    currentOwnerAccountKey: "owner-a",
    requestDomainSnapshot: "example.com",
    currentDomainSnapshot: "example.com",
    requestDomainRevisionSnapshot: 7,
    currentDomainRevision: 7,
    expectedConfigurationRevision: 11,
    actualConfigurationRevision: 11,
    expectedGeneration: 3,
    actualGeneration: 3,
    expectedContractVersion: 1,
    actualContractVersion: 1,
  };
  assert.deepEqual(managedOutreachMailboxRequestFenceIssues(base), []);
  const mutations: Array<[string, object]> = [
    ["site_inactive_or_deleting", { siteActive: false }],
    ["request_not_managed", { requestMode: "connect_existing" }],
    ["owner_changed", { currentOwnerAccountKey: "owner-b" }],
    ["domain_changed", { currentDomainRevision: 8 }],
    ["configuration_changed", { actualConfigurationRevision: 12 }],
    ["generation_changed", { actualGeneration: 4 }],
    ["contract_changed", { actualContractVersion: 2 }],
  ];
  for (const [issue, change] of mutations) {
    assert.ok(managedOutreachMailboxRequestFenceIssues({
      ...base,
      ...change,
    }).includes(issue), issue);
  }
  assert.equal(managedOutreachMailboxLeaseIsCurrent({
    expectedLeaseToken: "lease-a",
    actualLeaseToken: "lease-a",
    leaseExpiresAt: 101,
    timestamp: 100,
  }), true);
  assert.equal(managedOutreachMailboxLeaseIsCurrent({
    expectedLeaseToken: "lease-a",
    actualLeaseToken: "lease-b",
    leaseExpiresAt: 101,
    timestamp: 100,
  }), false);
  assert.equal(managedOutreachMailboxLeaseIsCurrent({
    expectedLeaseToken: "lease-a",
    actualLeaseToken: "lease-a",
    leaseExpiresAt: 100,
    timestamp: 100,
  }), false);
});

function operationalFixture() {
  const now = 1_900_000_000_000;
  const runtimeConfig: InboundRelayRuntimeConfig = {
    domain: "relay.example.net",
    secrets: ["s".repeat(32)],
    dsnTargetSecret: "t".repeat(32),
    adapterVersion: "relay-v1",
    retentionPolicyHash: "a".repeat(64),
    retentionAudited: true,
  };
  const relayHash = inboundRelayConfigurationHash(runtimeConfig);
  assert.ok(relayHash);
  const inbox = {
    _id: "inbox-a" as Id<"outreach_inboxes">,
    siteId: "site-a" as Id<"sites">,
    provider: "gmail",
    fromEmail: "authority@example-mail.net",
    fromName: "Example Partnerships",
    physicalMailingAddress: "123 Market Street, San Francisco, CA 94105, USA",
    complianceConfirmedAt: now - 10_000,
    credentialOwnerAccountKey: "owner-a",
    credentialSource: "managed_adapter",
    managedTransportOperationKey: "d".repeat(64),
    managedTransportGeneration: 3,
    managedTransportAdapterVersion: "adapter-v1",
    senderDomain: "example-mail.net",
    status: "warming",
    verifiedAt: now - 20_000,
    spfVerifiedAt: now - 400 * 24 * 60 * 60 * 1000,
    dkimVerifiedAt: now - 400 * 24 * 60 * 60 * 1000,
    dmarcVerifiedAt: now - 400 * 24 * 60 * 60 * 1000,
    oauthRefreshToken: "server-secret-not-projected",
    oauthScopes: "openid email https://www.googleapis.com/auth/gmail.send",
    configurationVersion: 9,
    inboundRelayDsnRoutingVerifiedAt: now - 60_000,
    inboundRelayDsnRoutingConfigurationVersion: 9,
    inboundRelayDsnRoutingRolloutEpoch: 4,
    inboundRelayDsnRoutingSenderDomain: "example-mail.net",
    inboundRelayDsnRoutingRelayConfigurationHash: relayHash,
    inboundRelayDsnRoutingEvidenceHash: "b".repeat(64),
    inboundRelayDsnRoutingAdapterVersion: runtimeConfig.adapterVersion,
    inboundRelayDsnRoutingRetentionPolicyHash:
      runtimeConfig.retentionPolicyHash,
    inboundRelayDsnRoutingTargetHash: "c".repeat(64),
    inboundRelayDsnRoutingTargetVersion:
      OUTREACH_INBOUND_RELAY_DSN_TARGET_VERSION,
    inboundRelayDsnRoutingTargetGeneration: 1,
  } as Doc<"outreach_inboxes">;
  const resource = {
    _id: "resource-a" as Id<"managed_outreach_mailbox_resources">,
    siteId: inbox.siteId,
    requestId: "request-a" as Id<"managed_provisioning_requests">,
    ownerAccountKey: "owner-a",
    domainSnapshot: "example.com",
    domainRevisionSnapshot: 7,
    requestConfigurationRevision: 11,
    requestContractVersion: 1,
    generation: 3,
    operationKey: "d".repeat(64),
    lifecycleState: "canonicalized",
    releaseState: "active",
    attempt: 1,
    adapterVersion: "adapter-v1",
    canonicalInboxId: inbox._id,
    externalProvisioningAttemptedAt: now - 30_000,
    externalAllocatedAt: now - 20_000,
    createdAt: now - 30_000,
    updatedAt: now - 20_000,
  } as Doc<"managed_outreach_mailbox_resources">;
  return { now, runtimeConfig, inbox, resource };
}

test("managed readiness requires canonical Gmail identity, compliance, refresh scope, and signed DSN seal", () => {
  const { now, runtimeConfig, inbox, resource } = operationalFixture();
  const args = {
    siteDomain: "example.com",
    inboxes: [inbox],
    resource,
    requestId: String(resource.requestId),
    siteId: String(resource.siteId),
    ownerAccountKey: "owner-a",
    expectedDomainRevision: 7,
    expectedConfigurationRevision: 11,
    expectedGeneration: 3,
    expectedRequestContractVersion: 1,
    expectedProfile: {
      fromName: inbox.fromName!,
      physicalMailingAddress: inbox.physicalMailingAddress!,
      attestationVersion: 1,
      senderIdentityAndAddressAttestedAt: now - 10_000,
      dedicatedSenderIdentityAttestedAt: now - 10_000,
      deliveryEventCanaryAuthorizedAt: now - 120_000,
      canaryConsentVersion: 1,
    },
    now,
    rolloutEpoch: 4,
    runtimeConfig,
  };
  assert.deepEqual(managedOutreachMailboxOperationalIssues(args), []);
  assert.equal(managedOutreachMailboxOperationallyReady(args), true);
  assert.equal(
    managedOutreachMailboxOperationallyReady({ ...args, resource: null }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      resource: { ...resource, canonicalInboxId: "inbox-b" as Id<"outreach_inboxes"> },
    }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      inboxes: [{ ...inbox, credentialSource: "owner_oauth" }],
    }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      inboxes: [{
        ...inbox,
        managedTransportOperationKey: "e".repeat(64),
      }],
    }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      inboxes: [{ ...inbox, provider: "smtp" }],
    }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      inboxes: [{ ...inbox, physicalMailingAddress: undefined }],
    }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      expectedProfile: {
        ...args.expectedProfile,
        fromName: "A different sender",
      },
    }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      inboxes: [{
        ...inbox,
        oauthScopes:
          `${inbox.oauthScopes} https://www.googleapis.com/auth/gmail.readonly`,
      }],
    }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      expectedProfile: {
        ...args.expectedProfile,
        deliveryEventCanaryAuthorizedAt: now,
      },
    }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      inboxes: [{ ...inbox, oauthRefreshToken: undefined }],
    }),
    false,
  );
  assert.equal(
    managedOutreachMailboxOperationallyReady({
      ...args,
      inboxes: [{ ...inbox, inboundRelayDsnRoutingEvidenceHash: undefined }],
    }),
    false,
  );
  assert.match(dispatcher, /oneSetupManagedOutreachMailboxReceiptVerified/);
  assert.match(sites, /outreachProgress\.mode === "managed"/);
  assert.match(outreach, /nextRequiredReceipt: "signed_dsn_canary"/);
  assert.match(outreach, /liveDnsEvidenceIssues/,
    "claim-time live DNS remains in the delivery implementation");
});

test("the Node boundary keeps legacy managed SES behind its signed adapter", () => {
  assert.equal(managedOutreachMailboxAdapterConfiguration({}), null);
  assert.equal(managedOutreachMailboxAdapterConfiguration({
    endpoint: "http://adapter.invalid",
    adapterVersion: "v1",
  }), null);
  assert.deepEqual(managedOutreachMailboxAdapterConfiguration({
    endpoint: "https://adapter.example.test/managed-mailbox",
    adapterVersion: "contract-v1",
  }), {
    endpoint: "https://adapter.example.test/managed-mailbox",
    adapterVersion: "contract-v1",
  });
  assert.match(action, /^"use node";/);
  assert.equal(
    MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE,
    "managed_outreach_mailbox_adapter_unavailable",
  );
  assert.equal(
    MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED,
    "managed_outreach_mailbox_adapter_contract_not_implemented",
  );
  assert.match(action, /MANAGED_OUTREACH_MAILBOX_ADAPTER_UNAVAILABLE/);
  assert.doesNotMatch(action, /MANAGED_OUTREACH_MAILBOX_ADAPTER_NOT_IMPLEMENTED/);
  assert.match(
    action,
    /runMutation\(\s*internal\.managedOutreachMailbox\.getProvisioningOperation/,
  );
  assert.match(action, /managedSesAdapterConfiguration/);
  assert.match(action, /callManagedSesAdapter/);
  assert.match(action, /parseManagedSesResourceReceipt/);
  assert.ok(
    action.indexOf("markProvisioningExternalBoundaryInternal") <
      action.indexOf('route: "provision"'),
  );
  assert.doesNotMatch(action, /from ["']googleapis|admin\.directory\s*\(/i);
  assert.match(
    action,
    /fetch\(url, \{[\s\S]*redirect: "error"/,
    "the Smartlead path is allowed to call its bounded provider API directly",
  );
  assert.match(action, /recordReleaseCompletedInternal/);
  assert.match(action, /internal\.managedOutreachMailbox\.markProvisioningExternalBoundaryInternal/);
  assert.match(ledger, /markProvisioningExternalBoundaryInternal/);
});

test("request, ledger, and operator projections cannot carry provider secrets", () => {
  const requestStart = schema.indexOf("managed_provisioning_requests: defineTable");
  const resourceStart = schema.indexOf(
    "managed_outreach_mailbox_resources: defineTable",
  );
  const releaseStart = schema.indexOf(
    "managed_outreach_mailbox_release_tombstones: defineTable",
  );
  const request = schema.slice(requestStart, resourceStart);
  const resource = schema.slice(resourceStart, releaseStart);
  const tombstone = schema.slice(
    releaseStart,
    schema.indexOf("one_setup_executions: defineTable", releaseStart),
  );
  for (const block of [request, resource, tombstone]) {
    for (const forbiddenField of [
      "oauthAccessToken:",
      "oauthRefreshToken:",
      "smtpPassword:",
      "apiKey:",
      "providerId:",
      "resellerId:",
      "mailboxPassword:",
      "dnsSecret:",
    ]) assert.doesNotMatch(block, new RegExp(forbiddenField, "i"));
  }
  const projection = ledger.slice(
    ledger.indexOf("export const getProvisioningOperation"),
    ledger.indexOf("export const recordProvisioningAdapterBlocked"),
  );
  assert.doesNotMatch(
    projection,
    /oauthAccessToken|oauthRefreshToken|smtpPassword|apiKey|providerId|resellerId/,
  );
  assert.match(projection, /tenantIsolatedSenderIdentity: true/);
  assert.match(projection, /tenantBoundSendingAuthority: true/);
  assert.match(projection, /idempotentOperationKey: true/);
  assert.match(projection, /doNotCommitAfterExternalDeadline: true/);
  assert.match(projection, /scopedOutboundAuthority: true/);
  assert.match(projection, /senderIdentityAndAddressAttestedAt/);
  assert.match(projection, /dedicatedSenderIdentityAttestedAt/);
  assert.doesNotMatch(projection, /gmailProvider/);
});

test("managed install shares the canonical Gmail writer and cannot authorize auto-send", () => {
  const managedInstall = outreach.slice(
    outreach.indexOf("export const installManagedGmailInboxInternal"),
    outreach.indexOf("export const setInboxComplianceProfile"),
  );
  assert.match(managedInstall, /installCanonicalGmailInbox/);
  for (const fence of [
    "expectedRequestRevision",
    "expectedConfigurationRevision",
    "expectedGeneration",
    "leaseToken",
    "site.deletionStatus",
    "site.accountDeletionRequestedAt",
    "requestDomainRevisionSnapshot",
  ]) assert.match(managedInstall, new RegExp(fence.replace(".", "\\.")));
  assert.match(managedInstall, /resource\.releaseState !== "active"/);
  assert.match(managedInstall, /!resource\.externalProvisioningAttemptedAt/);
  assert.match(managedInstall, /!resource\.externalProvisioningSettleAfter/);
  assert.match(
    managedInstall,
    /resource\.adapterVersion !== args\.adapterVersion/,
  );
  assert.match(managedInstall, /releaseState: "active"/);
  assert.match(managedInstall, /operationKey: resource\.operationKey/);
  assert.match(managedInstall, /externalProvisioningSettleAfter: undefined/);
  assert.match(managedInstall, /operationallyReady: false/);
  assert.doesNotMatch(managedInstall, /autonomyConsentAcceptedAt:\s*timestamp/);
  assert.match(autonomy, /OUTREACH_AUTONOMY_CONSENT_VERSION = 3/);
  assert.match(wizard, /does not authorize automatic sending/);
  assert.match(wizard, /separate versioned consent/);
  assert.doesNotMatch(wizard, /enableAutonomousOutreach/);
});

test("external release tombstone precedes every local managed-resource deletion", () => {
  assert.equal(managedOutreachMailboxReleaseSealed({
    releaseState: "released",
    tombstoneState: "not_required",
  }), true);
  assert.equal(managedOutreachMailboxReleaseSealed({
    hasCanonicalInbox: true,
    releaseState: "released",
    tombstoneState: "not_required",
  }), false);
  assert.equal(managedOutreachMailboxReleaseSealed({
    externalProvisioningAttemptedAt: 1,
    releaseState: "released",
    tombstoneState: "not_required",
  }), false);
  assert.equal(managedOutreachMailboxReleaseSealed({
    externalAllocatedAt: 1,
    releaseState: "released",
    tombstoneState: "not_required",
  }), false);
  assert.equal(managedOutreachMailboxReleaseSealed({
    externalAllocatedAt: 1,
    releaseState: "released",
    tombstoneState: "released",
  }), true);
  const stages = sites.slice(
    sites.indexOf("const SITE_DELETION_STAGES"),
    sites.indexOf("async function gateInboundRelayCanaryExternalLease"),
  );
  assert.ok(
    stages.indexOf('"managed_outreach_mailbox_resources"') <
      stages.indexOf('"managed_provisioning_requests"'),
  );
  const deletion = sites.slice(
    sites.indexOf("export const continueSiteDeletionInternal"),
    sites.indexOf("export const continueAccountDeletionInternal"),
  );
  assert.match(deletion, /managedOutreachMailboxReleaseSealed/);
  assert.match(deletion, /managed_mailbox_external_release_pending/);
  assert.match(deletion, /await ctx\.db\.delete\(resource\._id\)/);
  assert.ok(
    deletion.indexOf("managedOutreachMailboxReleaseSealed") <
      deletion.indexOf("await ctx.db.delete(resource._id)"),
  );
  assert.match(ledger, /"release_requested" as const/);
  assert.match(ledger, /recordReleaseCompletedInternal/);
  assert.match(sites, /stageManagedOutreachMailboxRelease[\s\S]*oauthAccessToken: undefined/);
  const accountDeletion = sites.slice(
    sites.indexOf("export const finalizeAccountDeletionInternal"),
    sites.indexOf("export const recoverAccountDeletionsInternal"),
  );
  assert.match(
    accountDeletion,
    /managed_outreach_mailbox_release_tombstones[\s\S]*\[\s*"released",\s*"not_required",?\s*\]\.includes\(tombstone\.state\)[\s\S]*ctx\.db\.delete\(tombstone\._id\)/,
  );
});

test("mode and domain retirement quarantine the exact managed inbox before release", () => {
  const quarantine = ledger.slice(
    ledger.indexOf("async function quarantineManagedCanonicalInbox"),
    ledger.indexOf("async function clearManagedInboxProvenanceAfterRelease"),
  );
  for (const fence of [
    'credentialSource: "managed_adapter_retiring"',
    'status: "disconnected"',
    'mode: "approval"',
    "oauthAccessToken: undefined",
    "oauthRefreshToken: undefined",
    "autonomyConsentAcceptedAt: undefined",
    "inboundRelayDsnRoutingVerifiedAt: undefined",
    "configurationVersion:",
    "cancelAutonomousSequenceInternal",
  ]) assert.match(quarantine, new RegExp(fence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(
    quarantine,
    /managedTransportKind: resource\.transportKind === SMARTLEAD_MANAGED_TRANSPORT/,
  );
  assert.match(
    ledger,
    /inbox\.provider === "smartlead"[\s\S]*inbox\.managedTransportKind === SMARTLEAD_MANAGED_TRANSPORT[\s\S]*inbox\.managedTransportResourceReceipt === resource\.resourceReceipt/,
  );

  const releaseRequest = ledger.slice(
    ledger.indexOf("async function requestResourceRelease"),
    ledger.indexOf("export async function stageManagedOutreachMailboxRelease"),
  );
  assert.ok(
    releaseRequest.indexOf("quarantineManagedCanonicalInbox") <
      releaseRequest.indexOf("claimRelease"),
  );
  const save = sites.slice(
    sites.indexOf("export const saveOneSetupRequest"),
    sites.indexOf("export const getOneSetupReadiness"),
  );
  assert.match(save, /owner_selected_connect_existing/);
  assert.ok(
    save.indexOf("stageManagedOutreachMailboxRelease") <
      save.indexOf("ctx.db.patch(existing._id, record)"),
  );
  assert.ok(
    (sites.match(/managed_mailbox_domain_invalidated/g) ?? []).length >= 3,
  );
  assert.match(canonicalReadiness, /\["warming", "active"\]\.includes\(inbox\.status\)/);
});

test("release defers provider deprovision across provision, send, and canary ambiguity", () => {
  const blocker = ledger.slice(
    ledger.indexOf("async function managedReleaseBlocker"),
    ledger.indexOf("async function releaseTombstoneForOperation"),
  );
  assert.match(blocker, /externalProvisioningSettleAfter/);
  assert.match(blocker, /by_inbox_status/);
  assert.match(blocker, /"sending"/);
  assert.match(blocker, /"delivery_unverified"/);
  assert.match(blocker, /"claimed"/);
  assert.match(blocker, /"accepted"/);
  assert.match(blocker, /"unverified"/);
  assert.match(schema, /\.index\("by_inbox_status", \["inboxId", "status"\]\)/);
  assert.match(
    schema,
    /\.index\("by_inbox_status", \["inboxId", "deliveryStatus"\]\)/,
  );
  const claimRelease = ledger.slice(
    ledger.indexOf("export const claimRelease"),
    ledger.indexOf("export const getReleaseOperation"),
  );
  assert.ok(
    claimRelease.indexOf("managedReleaseBlocker") <
      claimRelease.indexOf("internal.actions.managedOutreachMailbox.release"),
  );
  const completeRelease = ledger.slice(
    ledger.indexOf("export const recordReleaseCompletedInternal"),
  );
  assert.ok(
    completeRelease.indexOf("managedReleaseBlocker") <
      completeRelease.indexOf('state: "released"'),
  );
  assert.match(ledger, /externalDeadlineAt: resource\.leaseExpiresAt/);
  assert.match(ledger, /EXTERNAL_PROVISIONING_LATE_RESULT_GRACE_MS/);
  assert.match(
    ledger,
    /externalProvisioningSettleAfter:[\s\S]*resource\.leaseExpiresAt![\s\S]*EXTERNAL_PROVISIONING_LATE_RESULT_GRACE_MS/,
  );
  const provision = action.slice(
    action.indexOf("export const provision"),
    action.indexOf("export const sendManagedSesEventCanary"),
  );
  assert.ok(
    provision.indexOf("markProvisioningExternalBoundaryInternal") <
      provision.indexOf('route: "provision"'),
  );
  assert.match(ledger, /reconcileProvisioningStatusByOperationKey: true/);
  assert.match(ledger, /releaseWinsLateProvision: true/);
  const releaseAction = action.slice(action.indexOf("export const release"));
  const release = releaseAction.slice(
    releaseAction.indexOf("const config = adapterConfig()"),
  );
  assert.ok(
    release.indexOf("getReleaseOperation") < release.indexOf('route: "release"'),
  );
  assert.ok(
    release.indexOf('route: "release"') <
      release.indexOf("recordReleaseCompletedInternal"),
  );
  assert.match(release, /receipt\.operationKey === claim\.operation\.operationKey/);
  assert.match(release, /receipt\.generation === claim\.operation\.generation/);
  assert.match(release, /receipt\.adapterVersion === config\.adapterVersion/);
});

test("lost DSN canaries become terminal after their exact deadline so site deletion cannot deadlock", () => {
  const timestamp = 10_000;
  for (const deliveryStatus of ["claimed", "accepted", "unverified"]) {
    assert.equal(managedOutreachMailboxCanaryReleasePending({
      deliveryStatus,
      deliveryLeaseExpiresAt: timestamp - 1,
      expiresAt: timestamp + 1,
      timestamp,
    }), true);
    assert.equal(managedOutreachMailboxCanaryReleasePending({
      deliveryStatus,
      deliveryLeaseExpiresAt: timestamp - 1,
      expiresAt: timestamp,
      timestamp,
    }), false);
  }
  assert.equal(managedOutreachMailboxCanaryReleasePending({
    deliveryStatus: "claimed",
    deliveryLeaseExpiresAt: timestamp + 1,
    expiresAt: timestamp,
    timestamp,
  }), true);
  assert.equal(managedOutreachMailboxCanaryReleasePending({
    deliveryStatus: "failed",
    expiresAt: timestamp + 1,
    timestamp,
  }), false);
  assert.match(ledger, /managedOutreachMailboxCanaryReleasePending/);
  assert.match(ledger, /expiresAt: canary\.expiresAt/);
});

test("verified account deletion settles ambiguous sends only after exact receipt quiescence", () => {
  const timestamp = 50_000_000;
  const base = {
    timestamp,
    accountDeletionRequestedAt:
      timestamp - MANAGED_OUTREACH_MAILBOX_ACCOUNT_DELETION_QUIESCENCE_MS,
    siteUserId: "user-a",
    receiptUserId: "user-a",
    receiptStatus: "purging",
    resourceOwnerMatches: true,
  };
  assert.equal(managedOutreachMailboxVerifiedDeletionSettled(base), true);
  assert.equal(managedOutreachMailboxVerifiedDeletionSettled({
    ...base,
    accountDeletionRequestedAt: base.accountDeletionRequestedAt + 1,
  }), false);
  assert.equal(managedOutreachMailboxVerifiedDeletionSettled({
    ...base,
    receiptStatus: "completed",
  }), false);
  assert.equal(managedOutreachMailboxVerifiedDeletionSettled({
    ...base,
    receiptUserId: "user-b",
  }), false);
  assert.equal(managedOutreachMailboxVerifiedDeletionSettled({
    ...base,
    resourceOwnerMatches: false,
  }), false);
  assert.match(ledger, /account_deletion_receipts/);
  assert.match(ledger, /withIndex\("by_account_key"/);
  assert.match(ledger, /blockingUnverified/);
});

test("release terminalizes expired leases without replay and requires canonical quarantine", () => {
  const terminalizer = ledger.slice(
    ledger.indexOf("async function terminalizeExpiredManagedDeliveryLeases"),
    ledger.indexOf("async function verifiedAccountDeletionAmbiguitySettled"),
  );
  assert.match(terminalizer, /status: "delivery_unverified"/);
  assert.match(terminalizer, /deliveryStatus: "unverified"/);
  assert.match(terminalizer, /will never be replayed/);
  assert.doesNotMatch(terminalizer, /status: "approved"|status: "queued"/);
  const releaseClaim = ledger.slice(
    ledger.indexOf("export const claimRelease"),
    ledger.indexOf("export const getReleaseOperation"),
  );
  assert.ok(
    releaseClaim.indexOf("quarantineManagedCanonicalInbox") <
      releaseClaim.indexOf("managedReleaseBlocker"),
  );
  assert.ok(
    releaseClaim.indexOf("terminalizeExpiredManagedDeliveryLeases") <
      releaseClaim.indexOf("managedReleaseBlocker"),
  );
  assert.match(ledger, /managedInboxIsQuarantinedForResource/);
  assert.match(ledger, /managed_mailbox_canonical_inbox_quarantine_required/);
});

test("every future allocation boundary rechecks full execution authority", () => {
  const operation = ledger.slice(
    ledger.indexOf("export const getProvisioningOperation"),
    ledger.indexOf("export const markProvisioningExternalBoundaryInternal"),
  );
  const boundary = ledger.slice(
    ledger.indexOf("export const markProvisioningExternalBoundaryInternal"),
    ledger.indexOf("export const recordProvisioningAdapterBlocked"),
  );
  assert.match(operation, /internalMutation/);
  assert.match(operation, /siteExecutionAuthorized/);
  assert.match(operation, /requestResourceRelease/);
  assert.match(operation, /cancelProvisioningRequestAfterMailboxRetirement/);
  assert.match(boundary, /siteExecutionAuthorized/);
  assert.match(boundary, /requestResourceRelease/);
  assert.match(ledger, /currentOwnerAccountKey\(args\.site\) !== args\.resource\.ownerAccountKey/);
  assert.match(ledger, /siteCanonicalDomainRevision\(args\.site\)/);
  assert.match(ledger, /!\(await siteExecutionAuthorized\(ctx, args\.site\)\)/);
});

test("publisher parking still hands mailbox retirement to its lifecycle reconciler", () => {
  const dispatch = dispatcher.slice(
    dispatcher.indexOf("export const dispatchRequest"),
    dispatcher.indexOf("export const reconcileRequest"),
  );
  const pausedFence = dispatch.indexOf(
    "if (!(await siteExecutionAuthorized(ctx, site)))",
  );
  const mailboxReconcile = dispatch.indexOf(
    "internal.managedOutreachMailbox.reconcileProvisioningResource",
    pausedFence,
  );
  const pausedReturn = dispatch.indexOf(
    'reason: "execution_paused"',
    pausedFence,
  );
  assert.ok(pausedFence >= 0);
  assert.ok(mailboxReconcile > pausedFence);
  assert.ok(pausedReturn > mailboxReconcile);
  assert.match(
    dispatch.slice(pausedFence, pausedReturn),
    /expectedConfigurationRevision: request\.configurationRevision \?\? 0[\s\S]*expectedGeneration: request\.outreachMailboxGeneration \?\? 1/,
  );
});

test("publisher owner action and crashed preflight cannot starve mailbox provisioning", () => {
  const settlement = dispatcher.slice(
    dispatcher.indexOf("export const settlePublisherPreflightActionRequired"),
    dispatcher.indexOf("export const dispatchRequest"),
  );
  const dispatch = dispatcher.slice(
    dispatcher.indexOf("export const dispatchRequest"),
    dispatcher.indexOf("export const reconcileRequest"),
  );

  assert.match(
    settlement,
    /revision = request\.revision \+ 1[\s\S]*reconcileProvisioningResource[\s\S]*expectedRequestRevision: revision/,
    "publisher owner-action settlement must wake mailbox work at its newly committed revision",
  );
  assert.match(
    dispatch,
    /leaseExpiresAt \+ 1[\s\S]*reconcileProvisioningResource[\s\S]*expectedRequestRevision: request\.revision/,
    "a crashed publisher preflight must arm mailbox recovery only after its exact lease expires",
  );
  assert.doesNotMatch(
    dispatch.slice(
      dispatch.indexOf('fulfillmentState: "leased"'),
      dispatch.indexOf("const publisherReady"),
    ),
    /reconcileProvisioningResource/,
    "mailbox work must not race the live publisher lease at the same request revision",
  );
  assert.match(
    ledger,
    /resource\.lifecycleState === "leased"[\s\S]*resource\.leaseExpiresAt! \+ 1[\s\S]*reconcileProvisioningResource[\s\S]*state: "lease_live"/,
    "a live resource lease must retain an exact post-expiry recovery wake",
  );
});

test("owner OAuth cannot overwrite managed provenance and a managed legacy drain is rejected", () => {
  for (const field of [
    "credentialSource",
    "managedTransportOperationKey",
    "managedTransportGeneration",
    "managedTransportAdapterVersion",
  ]) assert.match(schema, new RegExp(`${field}:`));
  const ownerFence = outreach.slice(
    outreach.indexOf("if (\n      existing &&\n      !managedBinding"),
    outreach.indexOf("const existingOwnerMatches"),
  );
  assert.match(ownerFence, /connect_existing/);
  assert.match(ownerFence, /stageManagedOutreachMailboxRelease/);
  assert.match(ownerFence, /freshOwnerConnectionRequired: true/);
  assert.match(outreach, /credentialSource: managedBinding[\s\S]*"managed_adapter"[\s\S]*"owner_oauth"/);
  assert.match(outreach, /managedTransportOperationKey: managedBinding\?\.operationKey/);
  assert.match(outreach, /if \(managedBinding\)[\s\S]*managedInstallRejected: true/);
  const ownerPreflight = outreach.slice(
    outreach.indexOf("export const getGmailReconnectReadinessInternal"),
    outreach.indexOf("export const listLegacyInboundFleetPage"),
  );
  assert.match(ownerPreflight, /setupRequest\.outreachMailbox\.mode !== "connect_existing"/);
  assert.match(ownerPreflight, /setupRequest\.outreachTransport !== "gmail_oauth"/);
  assert.match(ownerPreflight, /managed_adapter_retiring/);
  assert.match(http, /outreach-gmail\/preflight[\s\S]*return json\(result\)/);
  assert.match(gmailAuthRoute, /if \(!preflight\.ready\)[\s\S]*status: 409/);
  assert.match(
    gmailCallbackRoute,
    /freshOwnerConnectionRequired[\s\S]*No Google credential was saved/,
  );
  assert.ok(
    gmailCallbackRoute.indexOf("outreach-gmail/preflight") <
      gmailCallbackRoute.indexOf("oauth2.googleapis.com/token"),
  );
  const managedInstall = outreach.slice(
    outreach.indexOf("export const installManagedGmailInboxInternal"),
    outreach.indexOf("export const setInboxComplianceProfile"),
  );
  assert.ok(
    managedInstall.indexOf('"managedInstallRejected" in installation') <
      managedInstall.indexOf('lifecycleState: "canonicalized"'),
  );
  assert.match(managedInstall, /installed: false/);
  assert.match(managedInstall, /managed_mailbox_legacy_drain_not_installable/);
});

test("sealed generations are pruned without a 20-row deletion deadlock", () => {
  let generation = 1;
  let mode: "managed" | "connect_existing" = "managed";
  for (let index = 0; index < 25; index += 1) {
    const nextMode: "managed" | "connect_existing" = mode === "managed"
      ? "connect_existing"
      : "managed";
    generation = nextManagedOutreachMailboxGeneration({
      previousGeneration: generation,
      previousMode: mode,
      nextMode,
      hardReset: false,
    });
    mode = nextMode;
  }
  assert.equal(generation, 26);
  assert.doesNotMatch(ledger, /inventory is saturated/);
  assert.match(ledger, /const RESOURCE_RELEASE_BATCH = 100/);
  assert.match(ledger, /async function pruneSealedManagedResources/);
  assert.match(ledger, /managedOutreachMailboxReleaseSealed/);
  assert.match(ledger, /await ctx\.db\.delete\(resource\._id\)/);
  assert.match(ledger, /prior_generation_release_pending/);
  assert.ok(
    ledger.indexOf("prior_generation_release_pending") <
      ledger.indexOf('lifecycleState: "queued"'),
  );
  assert.match(dispatcher, /withIndex\("by_request"/);
  assert.match(dispatcher, /managedMailboxResources\.length === 1/);
  assert.match(sites, /managedMailboxResources\.length === 1/);
  assert.match(ledger, /managed_outreach_mailbox_release_tombstones/);
});
