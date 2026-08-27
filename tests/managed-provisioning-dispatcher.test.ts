import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  managedProvisioningDecision,
  managedProvisioningIdentityIsCurrent,
  managedProvisioningLeaseIsCurrent,
  managedProvisioningRetryAt,
  MANAGED_PROVIDER_PROGRESS_STALE_MS,
  MANAGED_PROVISIONING_RECONCILE_MS,
  ONE_SETUP_CONTRACT_VERSION,
  oneSetupCapabilityReadiness,
} from "../convex/lib/oneSetup.ts";

const dispatcher = readFileSync("convex/managedProvisioning.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");
const crons = readFileSync("convex/crons.ts", "utf8");
const autopilot = readFileSync("convex/autopilot.ts", "utf8");
const readinessUi = readFileSync(
  "src/components/onboarding/setup-readiness.tsx",
  "utf8",
);

test("a managed request with no worker adapter becomes an exact honest blocker", () => {
  assert.deepEqual(
    managedProvisioningDecision({
      capability: "publisher",
      mode: "managed",
      canonicalReceiptVerified: false,
    }),
    {
      state: "blocked",
      blockedReasonCode: "managed_publisher_adapter_unavailable",
      actionRequiredBy: "operator",
    },
  );
  assert.deepEqual(
    managedProvisioningDecision({
      capability: "search_measurement",
      mode: "managed",
      canonicalReceiptVerified: false,
    }),
    {
      state: "blocked",
      blockedReasonCode: "search_console_oauth_consent_required",
      actionRequiredBy: "owner",
    },
  );
  assert.deepEqual(
    managedProvisioningDecision({
      capability: "outreach_mailbox",
      mode: "managed",
      canonicalReceiptVerified: false,
    }),
    {
      state: "blocked",
      blockedReasonCode: "managed_outreach_mailbox_adapter_unavailable",
      actionRequiredBy: "operator",
    },
  );
  assert.equal(
    oneSetupCapabilityReadiness({
      connectionVerified: false,
      progress: { mode: "managed", state: "blocked" },
    }),
    "blocked",
  );
});

test("Connect Existing remains an owner action and canonical receipts are the only ready path", () => {
  assert.deepEqual(
    managedProvisioningDecision({
      capability: "publisher",
      mode: "connect_existing",
      canonicalReceiptVerified: false,
    }),
    {
      state: "owner_action_required",
      blockedReasonCode: "publisher_connection_required",
      actionRequiredBy: "owner",
    },
  );
  assert.deepEqual(
    managedProvisioningDecision({
      capability: "publisher",
      mode: "managed",
      canonicalReceiptVerified: true,
    }),
    { state: "ready" },
  );
  assert.match(
    sites,
    /Provider progress cannot mark a capability ready; canonical reconciliation is required/,
  );
  assert.match(dispatcher, /oneSetupPublisherReceiptVerified\(site\)/);
  assert.match(dispatcher, /oneSetupSearchMeasurementReceiptVerified\(site\)/);
  assert.match(dispatcher, /oneSetupOutreachMailboxReceiptVerified/);
  assert.match(dispatcher, /complete = aggregateState === "ready"/);
});

test("provider-neutral progress is preserved briefly but a dead adapter cannot look live forever", () => {
  const providerReportedAt = 1_900_000_000_000;
  let currentProgress: NonNullable<
    Parameters<typeof managedProvisioningDecision>[0]["currentProgress"]
  > = {
    state: "in_progress" as const,
    providerReportedAt,
    updatedAt: providerReportedAt,
  };
  for (const elapsed of [
    MANAGED_PROVISIONING_RECONCILE_MS,
    MANAGED_PROVISIONING_RECONCILE_MS * 2,
  ]) {
    const timestamp = providerReportedAt + elapsed;
    const decision = managedProvisioningDecision({
      capability: "publisher",
      mode: "managed",
      canonicalReceiptVerified: false,
      currentProgress,
      timestamp,
    });
    assert.deepEqual(decision, { state: "in_progress" });
    // This is the passive reconciler's write: wall-clock updatedAt advances,
    // while the provider-owned source timestamp remains immutable.
    currentProgress = { ...currentProgress, ...decision, updatedAt: timestamp };
  }
  const timestamp = providerReportedAt + MANAGED_PROVISIONING_RECONCILE_MS * 3;
  assert.deepEqual(
    managedProvisioningDecision({
      capability: "publisher",
      mode: "managed",
      canonicalReceiptVerified: false,
      currentProgress,
      timestamp,
    }),
    {
      state: "blocked",
      blockedReasonCode: "managed_publisher_adapter_stalled",
      actionRequiredBy: "operator",
    },
  );
  assert.ok(timestamp - providerReportedAt > MANAGED_PROVIDER_PROGRESS_STALE_MS);
  assert.match(dispatcher, /providerReportedAt:[\s\S]*providerReportedAt \?\? args\.current\.updatedAt/);
});

test("exact wakes, lease watchdog, and a bounded recovery fleet prevent starvation", () => {
  const timestamp = 1_900_000_000_000;
  assert.equal(
    managedProvisioningRetryAt(timestamp),
    timestamp + MANAGED_PROVISIONING_RECONCILE_MS,
  );
  assert.match(sites, /internal\.managedProvisioning\.dispatchRequest/);
  assert.match(dispatcher, /ctx\.scheduler\.runAt\(/);
  assert.match(dispatcher, /leaseExpiresAt \+ 1_000/);
  assert.match(dispatcher, /by_fulfillment_due/);
  assert.match(dispatcher, /by_fulfillment_updated/);
  assert.match(dispatcher, /MANAGED_PROVISIONING_FLEET_BATCH = 25/);
  assert.match(dispatcher, /q\.eq\("fulfillmentState", undefined\)/);
  assert.doesNotMatch(dispatcher, /field\("fulfillmentState"\)/);
  assert.match(schema, /by_fulfillment_updated/);
  assert.match(crons, /managed-provisioning-recovery/);
  assert.match(crons, /internal\.managedProvisioning\.dispatchFleet/);
});

test("revision and lease CAS reject replay, expiry, and a superseding save", () => {
  const base = {
    expectedRevision: 7,
    actualRevision: 7,
    expectedLeaseToken: "lease-a",
    actualLeaseToken: "lease-a",
    leaseExpiresAt: 5_000,
    timestamp: 4_000,
  };
  assert.equal(managedProvisioningLeaseIsCurrent(base), true);
  assert.equal(
    managedProvisioningLeaseIsCurrent({ ...base, actualRevision: 8 }),
    false,
  );
  assert.equal(
    managedProvisioningLeaseIsCurrent({ ...base, actualLeaseToken: "lease-b" }),
    false,
  );
  assert.equal(
    managedProvisioningLeaseIsCurrent({ ...base, timestamp: 5_000 }),
    false,
  );
});

test("tenant deletion, owner change, domain change, and contract change fail closed", () => {
  const base = {
    siteActive: true,
    requestOwnerAccountKey: "owner-a",
    currentOwnerAccountKey: "owner-a",
    requestDomainSnapshot: "example.com",
    currentDomainSnapshot: "example.com",
    requestDomainRevisionSnapshot: 0,
    currentCanonicalDomainRevision: 0,
    legacyUnstampedAllowed: false,
    requestContractVersion: ONE_SETUP_CONTRACT_VERSION,
  };
  assert.equal(managedProvisioningIdentityIsCurrent(base), true);
  assert.equal(
    managedProvisioningIdentityIsCurrent({ ...base, siteActive: false }),
    false,
  );
  assert.equal(
    managedProvisioningIdentityIsCurrent({
      ...base,
      currentOwnerAccountKey: "owner-b",
    }),
    false,
  );
  assert.equal(
    managedProvisioningIdentityIsCurrent({
      ...base,
      currentDomainSnapshot: "new.example.com",
    }),
    false,
  );
  assert.equal(
    managedProvisioningIdentityIsCurrent({
      ...base,
      requestContractVersion: ONE_SETUP_CONTRACT_VERSION + 1,
    }),
    false,
  );
  assert.equal(
    managedProvisioningIdentityIsCurrent({
      ...base,
      requestDomainRevisionSnapshot: 0,
      currentCanonicalDomainRevision: 2,
    }),
    false,
    "A0 intent must not revive after A0 -> B1 -> A2",
  );
  assert.equal(
    managedProvisioningIdentityIsCurrent({
      ...base,
      requestDomainRevisionSnapshot: undefined,
    }),
    false,
    "an explicit revision-zero site must reject an unstamped request",
  );
  assert.equal(
    managedProvisioningIdentityIsCurrent({
      ...base,
      requestDomainRevisionSnapshot: undefined,
      legacyUnstampedAllowed: true,
    }),
    true,
    "only a raw-undefined legacy site may accept an unstamped request",
  );
  assert.match(dispatcher, /fulfillmentState: "cancelled"/);
  assert.match(dispatcher, /nextAttemptAt: undefined/);
});

test("durable lifecycle is additive, credential-free, and visible to the owner", () => {
  const start = schema.indexOf("managed_provisioning_requests: defineTable");
  const end = schema.indexOf("account_plan_entitlements: defineTable", start);
  const table = schema.slice(start, end);
  for (const field of [
    "fulfillmentState",
    "fulfillmentAttempt",
    "nextAttemptAt",
    "leaseToken",
    "leaseExpiresAt",
    "lastClaimedAt",
    "lastReconciledAt",
    "actionRequiredBy",
    "operatorActionRequiredAt",
  ]) {
    assert.match(table, new RegExp(`${field}:`));
  }
  for (const forbidden of ["password:", "oauthToken:", "resellerId:", "providerId:"]) {
    assert.doesNotMatch(table, new RegExp(forbidden, "i"));
  }
  assert.match(table, /by_fulfillment_due/);
  assert.match(table, /by_operator_action/);
  assert.match(dispatcher, /listOperatorQueue/);
  assert.match(dispatcher, /managed_provisioning_operator_action_required/);
  assert.match(sites, /actionMessage: oneSetupActionMessage/);
  assert.match(readinessUi, /Automatic receipt recheck/);
  assert.match(readinessUi, /Your action/);
  assert.match(readinessUi, /Pentra action/);
});

test("legacy tenants enter the universal explicit-adapter contract without guessing", () => {
  const start = schema.indexOf("managed_provisioning_requests: defineTable");
  const end = schema.indexOf("account_plan_entitlements: defineTable", start);
  const table = schema.slice(start, end);
  assert.match(table, /universalContractMigrationVersion/);
  assert.match(table, /by_universal_contract_migration/);
  assert.match(dispatcher, /migrateUniversalOneSetupContract/);
  assert.match(dispatcher, /UNIVERSAL_CONTRACT_MIGRATION_BATCH = 25/);
  assert.match(dispatcher, /explicit_publisher_selection_required/);
  assert.match(dispatcher, /explicit_outreach_transport_selection_required/);
  assert.match(dispatcher, /managedTransportKind === "smartlead_managed"/);
  assert.doesNotMatch(
    dispatcher,
    /managedTransportKind === "managed_ses"[\s\S]{0,100}return "smartlead_managed"/,
  );
  assert.match(sites, /universalContractMigrationVersion: 1/);
});

test("warm content is publisher-only while live rollout also requires fresh measurement", () => {
  assert.match(autopilot, /oneSetupPromotionBlockers\(ctx, site\)/);
  assert.match(autopilot, /oneSetupPromotionBlockers\(ctx, site, "live"\)/);
  assert.match(sites, /One-setup canonical receipts are incomplete/);
  assert.match(sites, /setupBlockers\.length === 0/);
  assert.match(sites, /oneSetupPromotionBlockers\(ctx, site, "live"\)/);
  assert.match(sites, /oneSetupPromotionBlockers\(ctx, site, "warm"\)/);
  const runtime = readFileSync("convex/lib/oneSetupRuntime.ts", "utf8");
  assert.match(runtime, /oneSetupDomainRevisionReceiptMatches/);
  assert.match(runtime, /siteUsesLegacyDomainReceipts\(site\)/);
  assert.match(runtime, /oneSetupPublisherReceiptVerified\(site\)/);
  assert.match(runtime, /oneSetupSearchMeasurementReceiptVerified\(site\)/);
  assert.doesNotMatch(runtime, /oneSetupOutreachMailboxReceiptVerified/);
});
