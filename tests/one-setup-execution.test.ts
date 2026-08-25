import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  oneSetupConfigurationRevisionIsCurrent,
  oneSetupExecutionClaimDisposition,
  oneSetupExecutionNextEligibleAt,
  oneSetupExecutionTerminalPatch,
  oneSetupExecutionWatchIdentityMatches,
  oneSetupPlanSettlement,
  oneSetupQueueDenialDisposition,
  oneSetupTerminalReceiptSettlementAllowed,
  nextOneSetupWatchGeneration,
} from "../convex/lib/oneSetupExecution.ts";
import {
  ONE_SETUP_DOMAIN_REVISION_INTEGRATION_CONTRACT,
  ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
  oneSetupDomainRevisionReceiptMatches,
  oneSetupFailedPlanRecoveryReceiptMatches,
  oneSetupInitialPlanContextFingerprint,
  oneSetupInitialPlanJobBindingMatches,
  oneSetupInitialPlanReceiptDecision,
  oneSetupLegacyInitialPlanJobBindingMatches,
  oneSetupPaidBoundaryLifecycleAllowed,
  oneSetupZeroSpendRecoveryEligibleAt,
} from "../convex/lib/oneSetupInitialPlan.ts";
import { oneSetupInitialPlanCurrency } from
  "../convex/lib/oneSetupInitialPlanDb.ts";
import { accountDeletionKey } from "../convex/lib/accountDeletion.ts";
import {
  nextCanonicalDomainRevision,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
} from "../convex/lib/siteDomainBinding.ts";

test("an ambiguous response resumes the bound plan after the lease", () => {
  assert.deepEqual(
    oneSetupExecutionClaimDisposition({
      status: "running",
      hasPlanJob: false,
      claimNonce: "first-client",
      leaseExpiresAt: 2_000,
      now: 1_000,
    }),
    { kind: "in_progress" },
  );
  assert.deepEqual(
    oneSetupExecutionClaimDisposition({
      status: "plan_queued",
      hasPlanJob: true,
      claimNonce: "lost-response-client",
      leaseExpiresAt: 2_000,
      now: 2_001,
    }),
    { kind: "claimable", resumePlan: true },
  );
});

test("terminal paid-plan receipts are reused and never replayed", () => {
  assert.deepEqual(
    oneSetupExecutionClaimDisposition({
      status: "completed",
      hasPlanJob: true,
      now: 10_000,
    }),
    { kind: "terminal", status: "completed" },
  );
  assert.deepEqual(oneSetupPlanSettlement({ jobStatus: "done", resultCount: 3 }), {
    state: "completed",
    topicCount: 3,
  });
  assert.deepEqual(oneSetupPlanSettlement({ jobStatus: "done", resultCount: 0 }), {
    state: "blocked",
    blockerCode: "plan_zero_yield",
    topicCount: 0,
  });
  assert.deepEqual(oneSetupPlanSettlement({ jobStatus: "failed" }), {
    state: "blocked",
    blockerCode: "plan_failed_no_replay",
  });
});

test("a terminal J settles after parking or downgrade but never through deletion", () => {
  const terminalReceiptFence = {
    hasUser: true,
    accountDeletionReceiptExists: false,
    ownerMatches: true,
    domainMatches: true,
    contractMatches: true,
  };
  for (const lifecycle of [
    {},
    { planParkedAt: 10_000 },
    { entitlementCurrent: false },
    { planParkedAt: 10_000, entitlementCurrent: false },
  ]) {
    assert.equal(
      oneSetupTerminalReceiptSettlementAllowed({
        ...terminalReceiptFence,
        ...lifecycle,
      }),
      true,
      "parking/downgrade may stop new work but cannot strand a paid terminal receipt",
    );
  }
  assert.deepEqual(
    oneSetupPlanSettlement({ jobStatus: "done", resultCount: 3 }),
    { state: "completed", topicCount: 3 },
  );
  assert.equal(
    oneSetupTerminalReceiptSettlementAllowed({
      ...terminalReceiptFence,
      deletionStatus: "running",
      planParkedAt: 10_000,
      entitlementCurrent: false,
    }),
    false,
  );
  assert.equal(
    oneSetupTerminalReceiptSettlementAllowed({
      ...terminalReceiptFence,
      accountDeletionReceiptExists: true,
    }),
    false,
  );
  for (const lifecycle of [
    { hasUser: false },
    { accountDeletionRequestedAt: 0 },
    { accountDeletionRequestedAt: 10_000 },
    { ownerMatches: false },
    { domainMatches: false },
    { contractMatches: false },
  ]) {
    assert.equal(
      oneSetupTerminalReceiptSettlementAllowed({
        ...terminalReceiptFence,
        ...lifecycle,
      }),
      false,
      "deletion/owner/domain/contract lifecycle drift is a hard settlement fence",
    );
  }
});

test("paid authorization and receipt-only settlement use distinct lifecycle matrices", () => {
  assert.equal(
    oneSetupPaidBoundaryLifecycleAllowed({
      siteExecutionAuthorized: true,
    }),
    true,
  );
  for (const lifecycle of [
    { siteExecutionAuthorized: false }, // parking
    { siteExecutionAuthorized: false }, // entitlement downgrade
    { siteExecutionAuthorized: false }, // deletion status/receipt
    {
      siteExecutionAuthorized: true,
      accountDeletionRequestedAt: 12_000,
    },
  ]) {
    assert.equal(
      oneSetupPaidBoundaryLifecycleAllowed(lifecycle),
      false,
    );
  }

  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const authorizeAt = jobs.indexOf(
    "export const authorizeOneSetupInitialPlanWorker",
  );
  const authorize = jobs.slice(
    authorizeAt,
    jobs.indexOf("export const reserveGenerationSlot", authorizeAt),
  );
  assert.match(
    authorize,
    /ownsJob[\s\S]*siteExecutionAuthorized\(ctx, site\)[\s\S]*accountDeletionRequestedAt[\s\S]*oneSetupInitialPlanCurrency/,
    "the exact lease, live tenant authorization, deletion request, and currency fence must share the final paid mutation",
  );

  const currency = readFileSync(
    "convex/lib/oneSetupInitialPlanDb.ts",
    "utf8",
  );
  assert.doesNotMatch(currency, /siteExecutionAuthorized|planParkedAt/);

  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  const settleAt = executions.indexOf("export const settleFromPlan");
  const settle = executions.slice(
    settleAt,
    executions.indexOf(
      "export const recoverFailedInitialPlanReceipt",
      settleAt,
    ),
  );
  assert.match(
    settle,
    /receiptRequestContext[\s\S]*requestMatchesExecution[\s\S]*planBindingMatches[\s\S]*settleTerminalPlan/,
  );
  assert.doesNotMatch(settle, /activeRequestContext|siteExecutionAuthorized/);
});

test("passive reconciliation cannot invalidate the saved owner configuration", () => {
  const saved = { requestRevision: 7, configurationRevision: 3 };
  const afterPassiveReconcile = {
    requestRevision: 8,
    configurationRevision: 3,
  };
  assert.notEqual(
    saved.requestRevision,
    afterPassiveReconcile.requestRevision,
  );
  assert.equal(
    oneSetupConfigurationRevisionIsCurrent({
      expected: saved.configurationRevision,
      actual: afterPassiveReconcile.configurationRevision,
    }),
    true,
  );
  assert.equal(
    oneSetupConfigurationRevisionIsCurrent({
      expected: saved.configurationRevision,
      actual: saved.configurationRevision + 1,
    }),
    false,
  );
});

test("same-domain setup resaves adopt one paid plan in every job state", () => {
  const contextFingerprint = oneSetupInitialPlanContextFingerprint({
    domain: "https://example.com",
    siteName: "Example",
    niche: "Workflow automation",
    keyFeatures: ["Lead routing", "Pipeline analytics"],
    targetCountry: "US",
    language: "en",
    expectedClickSchedulingEnabled: true,
  });
  const stableReceipt = {
    storedVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
    storedGeneration: 4,
    storedContextFingerprint: contextFingerprint,
    storedJobId: "job-j",
    currentContextFingerprint: contextFingerprint,
    hardReset: false,
  };

  const ownerConfigurations = [
    {
      configurationRevision: 11,
      cadence: 3,
      publisher: "managed",
      measurement: "managed",
      mailbox: "managed",
      automation: "full",
    },
    {
      configurationRevision: 12,
      cadence: 7,
      publisher: "connect_existing",
      measurement: "connect_existing",
      mailbox: "connect_existing",
      automation: "assisted",
    },
  ];
  // Same and changed machinery configurations both advance their own revision.
  // They are deliberately absent from the planning context, so every current
  // execution adopts J rather than reserving J2.
  for (const ownerConfiguration of ownerConfigurations) {
    for (const jobStatus of ["pending", "running", "done", "failed"]) {
      const decision = oneSetupInitialPlanReceiptDecision(stableReceipt);
      assert.deepEqual(
        decision,
        { generation: 4, reset: false, adoptBoundJob: true },
        `configuration ${ownerConfiguration.configurationRevision} with job ${jobStatus} must adopt J`,
      );
      assert.equal(
        oneSetupInitialPlanJobBindingMatches({
          requestId: "request-r",
          requestPlanJobId: "job-j",
          requestReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
          requestGeneration: 4,
          jobId: "job-j",
          payloadRequestId: "request-r",
          payloadReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
          payloadGeneration: 4,
          requestDomainRevisionSnapshot: 0,
          payloadCanonicalDomainRevision: 0,
          currentCanonicalDomainRevision: 0,
          legacyUnstampedAllowed: false,
        }),
        true,
      );
    }
  }

  // A lost queue/action response repeats the same decision and therefore
  // cannot authorize another provider reservation.
  assert.deepEqual(
    oneSetupInitialPlanReceiptDecision(stableReceipt),
    oneSetupInitialPlanReceiptDecision(stableReceipt),
  );
  assert.deepEqual(oneSetupPlanSettlement({ jobStatus: "done", resultCount: 7 }), {
    state: "completed",
    topicCount: 7,
  });
  assert.deepEqual(oneSetupPlanSettlement({ jobStatus: "failed" }), {
    state: "blocked",
    blockerCode: "plan_failed_no_replay",
  });
});

test("only a genuine planning-context or tenant-contract change resets J", () => {
  const original = oneSetupInitialPlanContextFingerprint({
    domain: "example.com",
    niche: "Workflow automation",
    keyFeatures: ["Analytics", "Lead routing"],
    language: "en",
  });
  const normalizedEquivalent = oneSetupInitialPlanContextFingerprint({
    domain: "https://www.EXAMPLE.COM/pricing",
    niche: "  workflow   automation ",
    keyFeatures: ["lead routing", "analytics", "analytics"],
    language: "EN",
  });
  assert.equal(normalizedEquivalent, original);
  assert.deepEqual(
    oneSetupInitialPlanReceiptDecision({
      storedVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
      storedGeneration: 9,
      storedContextFingerprint: original,
      storedJobId: "job-j",
      currentContextFingerprint: normalizedEquivalent,
      hardReset: false,
    }),
    { generation: 9, reset: false, adoptBoundJob: true },
  );

  const changedBusiness = oneSetupInitialPlanContextFingerprint({
    domain: "example.com",
    niche: "Customer support software",
    keyFeatures: ["Analytics", "Lead routing"],
    language: "en",
  });
  assert.deepEqual(
    oneSetupInitialPlanReceiptDecision({
      storedVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
      storedGeneration: 9,
      storedContextFingerprint: original,
      storedJobId: "job-j",
      currentContextFingerprint: changedBusiness,
      hardReset: false,
    }),
    { generation: 10, reset: true, adoptBoundJob: false },
  );
  assert.deepEqual(
    oneSetupInitialPlanReceiptDecision({
      storedVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
      storedGeneration: 9,
      storedContextFingerprint: original,
      storedJobId: "job-j",
      currentContextFingerprint: original,
      hardReset: true,
    }),
    { generation: 10, reset: true, adoptBoundJob: false },
  );
});

test("legacy J is migratable only through one exact prior execution binding", () => {
  const exactLegacyBinding = {
    requestId: "request-r",
    requestSiteId: "site-s",
    requestOwnerAccountKey: "owner-u",
    requestDomainSnapshot: "example.com",
    requestContractVersion: 1,
    siteId: "site-s",
    ownerAccountKey: "owner-u",
    domainSnapshot: "example.com",
    contractVersion: 1,
    executionId: "execution-e",
    executionRequestId: "request-r",
    executionSiteId: "site-s",
    executionOwnerAccountKey: "owner-u",
    executionDomainSnapshot: "example.com",
    executionConfigurationRevision: 7,
    jobId: "job-j",
    jobSiteId: "site-s",
    jobType: "plan",
    payloadManual: true,
    payloadReason: "one_setup_initial_plan",
    payloadExecutionId: "execution-e",
    payloadConfigurationRevision: 7,
    currentCanonicalDomainRevision: 0,
    legacyUnstampedAllowed: true,
  };
  for (const status of ["pending", "running", "done", "failed"]) {
    assert.equal(
      oneSetupLegacyInitialPlanJobBindingMatches(exactLegacyBinding),
      true,
      `${status} is the same immutable J and must migrate without a new reservation`,
    );
  }
  assert.equal(
    oneSetupLegacyInitialPlanJobBindingMatches({
      ...exactLegacyBinding,
      payloadExecutionId: "execution-other",
    }),
    false,
  );
  assert.equal(
    oneSetupLegacyInitialPlanJobBindingMatches({
      ...exactLegacyBinding,
      payloadRequestId: "partially-enriched",
    }),
    false,
  );
  assert.equal(
    oneSetupLegacyInitialPlanJobBindingMatches({
      ...exactLegacyBinding,
      legacyUnstampedAllowed: false,
    }),
    false,
    "an unstamped legacy J cannot cross a stamped domain epoch",
  );
});

test("A0 to B1 to A2 fences old J even when the hostname returns to A", () => {
  assert.deepEqual(
    ONE_SETUP_DOMAIN_REVISION_INTEGRATION_CONTRACT,
    {
      siteSchemaField: "canonicalDomainRevision",
      newSiteInitialRevision: 0,
      transitionHelper: "nextCanonicalDomainRevision",
      legacyCompatibility: "raw_field_undefined_only",
      requestReceiptField: "domainRevisionSnapshot",
      executionReceiptField: "domainRevisionSnapshot",
      jobReceiptField: "oneSetupCanonicalDomainRevision",
      siteWriterOwner: "canonical_domain_transition_slice",
    },
    "One-Setup must merge with, not partially duplicate, the authoritative site-domain writer",
  );
  const a0 = {
    domain: "a.example",
    canonicalDomain: "a.example",
    canonicalDomainRevision: 0,
  };
  const b1 = {
    ...a0,
    domain: "b.example",
    canonicalDomain: "b.example",
    canonicalDomainRevision: nextCanonicalDomainRevision(a0),
  };
  const a2 = {
    ...b1,
    domain: "a.example",
    canonicalDomain: "a.example",
    canonicalDomainRevision: nextCanonicalDomainRevision(b1),
  };
  assert.equal(siteCanonicalDomainRevision(a0), 0);
  assert.equal(siteCanonicalDomainRevision(b1), 1);
  assert.equal(siteCanonicalDomainRevision(a2), 2);
  assert.equal(siteUsesLegacyDomainReceipts(a0), false);
  assert.equal(siteUsesLegacyDomainReceipts(a2), false);
  assert.equal(
    siteUsesLegacyDomainReceipts({ canonicalDomainRevision: undefined }),
    true,
    "only a raw missing site epoch is legacy",
  );
  assert.equal(
    oneSetupDomainRevisionReceiptMatches({
      currentCanonicalDomainRevision: 0,
      receiptDomainRevision: undefined,
      legacyUnstampedAllowed: true,
    }),
    true,
  );
  assert.equal(
    oneSetupDomainRevisionReceiptMatches({
      currentCanonicalDomainRevision: 0,
      receiptDomainRevision: undefined,
      legacyUnstampedAllowed: false,
    }),
    false,
    "explicit revision zero is stamped, not legacy",
  );
  assert.equal(
    oneSetupInitialPlanJobBindingMatches({
      requestId: "request-r",
      requestPlanJobId: "job-j",
      requestReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
      requestGeneration: 1,
      jobId: "job-j",
      payloadRequestId: "request-r",
      payloadReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
      payloadGeneration: 1,
      requestDomainRevisionSnapshot: 0,
      payloadCanonicalDomainRevision: 0,
      currentCanonicalDomainRevision: 2,
      legacyUnstampedAllowed: false,
    }),
    false,
    "same final domain string cannot revive epoch-zero request/job receipts",
  );
});

test("A0 J cannot execute or commit after A0 to B1 to A2 without a resave", async () => {
  type CurrencyContext = Parameters<typeof oneSetupInitialPlanCurrency>[0];
  type CurrencyArgs = Parameters<typeof oneSetupInitialPlanCurrency>[1];
  const site = {
    _id: "site-s",
    userId: "user-u",
    domain: "a.example",
    canonicalDomain: "a.example",
    canonicalDomainRevision: 2,
  };
  const request = {
    _id: "request-r",
    siteId: site._id,
    ownerAccountKey: accountDeletionKey(site.userId),
    domainSnapshot: "a.example",
    domainRevisionSnapshot: 0,
    contractVersion: 1,
    initialPlanReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
    initialPlanGeneration: 1,
    initialPlanContextFingerprint:
      oneSetupInitialPlanContextFingerprint(site),
    initialPlanJobId: "job-j",
  };
  const job = {
    _id: "job-j",
    siteId: site._id,
    type: "plan",
    payload: {
      manual: true,
      reason: "one_setup_initial_plan",
      oneSetupRequestId: request._id,
      oneSetupInitialPlanReceiptVersion:
        ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
      oneSetupInitialPlanGeneration: 1,
      oneSetupCanonicalDomainRevision: 0,
    },
  };
  const ctx = {
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === request._id ? request : null,
    },
  };
  assert.deepEqual(
    await oneSetupInitialPlanCurrency(
      ctx as unknown as CurrencyContext,
      {
        site: site as unknown as CurrencyArgs["site"],
        job: job as unknown as CurrencyArgs["job"],
      },
    ),
    { kind: "stale", reason: "receipt_generation_superseded" },
  );
});

test("legacy queue migration binds request, execution, and job before immediate inspection", () => {
  const currentCanonicalDomainRevision = 0;
  const legacyUnstampedAllowed = true;
  const migratedRequestRevision = 0;
  const migratedExecutionRevision = 0;
  const migratedJobRevision = 0;
  for (const receiptDomainRevision of [
    migratedRequestRevision,
    migratedExecutionRevision,
    migratedJobRevision,
  ]) {
    assert.equal(
      oneSetupDomainRevisionReceiptMatches({
        currentCanonicalDomainRevision,
        receiptDomainRevision,
        legacyUnstampedAllowed,
      }),
      true,
    );
  }
  assert.equal(
    migratedExecutionRevision === migratedRequestRevision,
    true,
    "the immediate inspect/settle read must see the same materialized epoch",
  );

  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const start = jobs.indexOf("export const queuePlanIfAbsent");
  const end = jobs.indexOf(
    "export const queueExpectedClickPlanMigrationAfterPreflight",
    start,
  );
  const queue = jobs.slice(start, end);
  const requestBindAt = queue.indexOf(
    "domainRevisionSnapshot: siteCanonicalDomainRevision(site)",
  );
  const executionPatchAt = queue.indexOf(
    'status: "plan_queued"',
    requestBindAt,
  );
  const executionBindAt = queue.indexOf(
    "domainRevisionSnapshot: siteCanonicalDomainRevision(site)",
    requestBindAt + 1,
  );
  const returnAt = queue.indexOf("return { queued: true, jobId", executionBindAt);
  assert.ok(
    requestBindAt >= 0 &&
      executionPatchAt > requestBindAt &&
      executionBindAt > executionPatchAt &&
      returnAt > executionBindAt,
    "the reservation transaction must materialize all three epoch receipts before returning to inspectPlan/settleFromPlan",
  );
});

test("only exact released pre-provider receipts can back off without paid replay", () => {
  const exact = {
    recoveryCount: 0,
    workerAttempts: 0,
    recordedAt: 12_000,
    eligibleAt: 20_000,
    failureCode: "provider_balance_preflight_unavailable",
    releaseReason: "provider_balance_preflight_unavailable",
    jobSiteId: "site-s",
    jobUserId: "user-u",
    jobTrigger: "topic_plan",
    jobCreatedAt: 10_000,
    jobReservationDay: "2026-08-25",
    jobReservedMicroUsd: 2_000_000,
    jobCeilingMicroUsd: 2_000_000,
    jobReleasedAt: 11_000,
    reservationSiteId: "site-s",
    reservationUserId: "user-u",
    reservationPurpose: "topic_plan",
    reservationTrigger: "topic_plan",
    reservationCreatedAt: 10_000,
    reservationDay: "2026-08-25",
    reservationReservedMicroUsd: 2_000_000,
    reservationReleasedAt: 11_000,
    reservationReleaseReason: "provider_balance_preflight_unavailable",
    expectedProviderCeilingMicroUsd: 2_000_000,
  };
  assert.equal(oneSetupFailedPlanRecoveryReceiptMatches(exact), true);
  assert.equal(
    oneSetupFailedPlanRecoveryReceiptMatches({ ...exact, recoveryCount: 1 }),
    true,
    "a second exact released zero-spend receipt is not a paid replay",
  );
  const outageStart = Date.UTC(2026, 7, 25, 8, 0, 0);
  assert.equal(
    oneSetupZeroSpendRecoveryEligibleAt({
      recoveryCount: 0,
      receiptRecordedAt: outageStart,
      receiptEligibleAt: outageStart + 15 * 60 * 1000,
    }),
    outageStart + 15 * 60 * 1000,
  );
  assert.equal(
    oneSetupZeroSpendRecoveryEligibleAt({
      recoveryCount: 20,
      receiptRecordedAt: outageStart,
      receiptEligibleAt: outageStart + 15 * 60 * 1000,
    }),
    outageStart + 24 * 60 * 60 * 1000,
    "persistent zero-spend failures are bounded to one reinspection per 24-hour window",
  );
  assert.equal(
    oneSetupFailedPlanRecoveryReceiptMatches({
      ...exact,
      workerAttempts: 1,
    }),
    false,
    "paid or ambiguous execution is terminal no-replay",
  );
  assert.equal(
    oneSetupFailedPlanRecoveryReceiptMatches({
      ...exact,
      reservationReleasedAt: undefined,
    }),
    false,
  );
  assert.equal(
    oneSetupFailedPlanRecoveryReceiptMatches({
      ...exact,
      releaseReason: "one_setup_planning_context_superseded_before_execution",
      failureCode: "one_setup_planning_context_superseded_before_execution",
      reservationReleaseReason:
        "one_setup_planning_context_superseded_before_execution",
    }),
    true,
    "an exact released legacy authorization race is proven zero-spend",
  );
});

test("a migrated legacy authorization race recovers only for the current stable J", () => {
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const recoveryAt = executions.indexOf(
    "async function failedPlanRecoveryDecision",
  );
  const recovery = executions.slice(
    recoveryAt,
    executions.indexOf("async function armClaimWatchdog", recoveryAt),
  );
  assert.match(
    recovery,
    /one_setup_planning_context_superseded_before_execution[\s\S]*oneSetupInitialPlanCurrency[\s\S]*\.kind === "current"[\s\S]*currentStableBinding &&[\s\S]*oneSetupFailedPlanRecoveryReceiptMatches/,
    "only the post-save request's exact current J/generation may recycle the zero-spend receipt",
  );
  assert.match(
    jobs,
    /one_setup_planning_context_superseded_before_execution"[\s\S]*timestamp \+ CADENCE_PROVIDER_RECHECK_MS/,
    "the save/abort ordering must persist a durable eligibility deadline",
  );
});

test("a raw legacy J running across the v1 save recovers in either mutation order", async () => {
  type CurrencyContext = Parameters<typeof oneSetupInitialPlanCurrency>[0];
  type CurrencyArgs = Parameters<typeof oneSetupInitialPlanCurrency>[1];
  const site = {
    _id: "site-s",
    userId: "user-u",
    domain: "https://www.example.com",
    canonicalDomain: "example.com",
    canonicalDomainRevision: undefined,
    niche: "Workflow automation",
    language: "en",
    siteName: "Example",
    keyFeatures: ["Lead routing"],
  };
  const request = {
    _id: "request-r",
    siteId: site._id,
    ownerAccountKey: accountDeletionKey(site.userId),
    domainSnapshot: "example.com",
    domainRevisionSnapshot: 0,
    contractVersion: 1,
    initialPlanReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
    initialPlanGeneration: 1,
    initialPlanContextFingerprint: oneSetupInitialPlanContextFingerprint(site),
    initialPlanJobId: "job-j" as string | undefined,
  };
  const rawRunningJob = {
    _id: "job-j",
    siteId: site._id,
    type: "plan",
    payload: {
      manual: true,
      reason: "one_setup_initial_plan",
    } as Record<string, unknown>,
  };
  const ctx = {
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === request._id ? request : null,
    },
  };
  const currency = (job: typeof rawRunningJob) =>
    oneSetupInitialPlanCurrency(
      ctx as unknown as CurrencyContext,
      {
        site: site as unknown as CurrencyArgs["site"],
        job: job as unknown as CurrencyArgs["job"],
      },
    );
  const exactReleasedReceipt = {
    recoveryCount: 0,
    workerAttempts: 0,
    recordedAt: 12_000,
    eligibleAt: 12_000 + 15 * 60 * 1000,
    failureCode: "one_setup_planning_context_superseded_before_execution",
    releaseReason: "one_setup_planning_context_superseded_before_execution",
    jobSiteId: site._id,
    jobUserId: site.userId,
    jobTrigger: "topic_plan",
    jobCreatedAt: 10_000,
    jobReservationDay: "2026-08-25",
    jobReservedMicroUsd: 2_000_000,
    jobCeilingMicroUsd: 2_000_000,
    jobReleasedAt: 11_000,
    reservationSiteId: site._id,
    reservationUserId: site.userId,
    reservationPurpose: "topic_plan",
    reservationTrigger: "topic_plan",
    reservationCreatedAt: 10_000,
    reservationDay: "2026-08-25",
    reservationReservedMicroUsd: 2_000_000,
    reservationReleasedAt: 11_000,
    reservationReleaseReason:
      "one_setup_planning_context_superseded_before_execution",
    expectedProviderCeilingMicroUsd: 2_000_000,
  };

  assert.deepEqual(
    await currency(rawRunningJob),
    { kind: "stale", reason: "legacy_receipt_unmigrated" },
    "authorization before the v1 save fails closed before provider work",
  );
  assert.equal(
    oneSetupFailedPlanRecoveryReceiptMatches(exactReleasedReceipt),
    true,
  );

  const migratedJob = {
    ...rawRunningJob,
    payload: {
      ...rawRunningJob.payload,
      oneSetupRequestId: request._id,
      oneSetupInitialPlanReceiptVersion:
        ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
      oneSetupInitialPlanGeneration: 1,
      oneSetupCanonicalDomainRevision: 0,
    },
  };
  assert.deepEqual(
    await currency(migratedJob),
    { kind: "current", requestId: request._id },
    "abort-before-save and save-before-abort converge on the same migrated current J",
  );

  request.initialPlanGeneration = 2;
  request.initialPlanJobId = undefined;
  assert.deepEqual(
    await currency(migratedJob),
    { kind: "stale", reason: "receipt_generation_superseded" },
    "a genuine context reset cannot use the otherwise exact zero-spend receipt",
  );
});

test("the stable generation is current at spend and stale after a true context reset", async () => {
  type CurrencyContext = Parameters<typeof oneSetupInitialPlanCurrency>[0];
  type CurrencyArgs = Parameters<typeof oneSetupInitialPlanCurrency>[1];
  const site = {
    _id: "site-s",
    userId: "user-u",
    domain: "https://www.example.com",
    canonicalDomain: "example.com",
    canonicalDomainRevision: 0,
    niche: "Workflow automation",
    language: "en",
    siteName: "Example",
    keyFeatures: ["Lead routing"],
    cadencePerWeek: 3,
    publishMethod: "manual",
  };
  const fingerprint = oneSetupInitialPlanContextFingerprint(site);
  const request = {
    _id: "request-r",
    siteId: site._id,
    ownerAccountKey: accountDeletionKey(site.userId),
    domainSnapshot: "example.com",
    domainRevisionSnapshot: 0,
    contractVersion: 1,
    initialPlanReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
    initialPlanGeneration: 4,
    initialPlanContextFingerprint: fingerprint,
    initialPlanJobId: "job-j" as string | undefined,
  };
  const job = {
    _id: "job-j",
    siteId: site._id,
    type: "plan",
    payload: {
      manual: true,
      reason: "one_setup_initial_plan",
      oneSetupRequestId: request._id,
      oneSetupInitialPlanReceiptVersion:
        ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
      oneSetupInitialPlanGeneration: 4,
      oneSetupCanonicalDomainRevision: 0,
    },
  };
  const ctx = {
    db: {
      normalizeId: (_table: string, id: string) => id,
      get: async (id: string) => id === request._id ? request : null,
    },
  };
  const currency = () => oneSetupInitialPlanCurrency(
    ctx as unknown as CurrencyContext,
    {
      site: site as unknown as CurrencyArgs["site"],
      job: job as unknown as CurrencyArgs["job"],
    },
  );

  assert.deepEqual(
    await currency(),
    { kind: "current", requestId: request._id },
  );

  // Configuration-only edits are not represented in the planning fingerprint
  // or stable payload and therefore leave the same receipt current.
  site.cadencePerWeek = 7;
  site.publishMethod = "github";
  assert.deepEqual(
    await currency(),
    { kind: "current", requestId: request._id },
  );

  // A generation reset fences J even if its old worker is still running.
  request.initialPlanGeneration = 5;
  request.initialPlanJobId = undefined;
  assert.deepEqual(
    await currency(),
    { kind: "stale", reason: "receipt_generation_superseded" },
  );

  // Restoring the old receipt cannot hide a genuine change to planning input.
  request.initialPlanGeneration = 4;
  request.initialPlanJobId = "job-j";
  site.niche = "Customer support software";
  assert.deepEqual(
    await currency(),
    { kind: "stale", reason: "planning_context_changed" },
  );
});

test("unmigrated and partial legacy setup payloads both fail closed", async () => {
  type CurrencyContext = Parameters<typeof oneSetupInitialPlanCurrency>[0];
  type CurrencyArgs = Parameters<typeof oneSetupInitialPlanCurrency>[1];
  const site = {
    _id: "site-s",
    userId: "user-u",
    domain: "example.com",
  };
  const job = {
    _id: "job-j",
    siteId: site._id,
    type: "plan",
    payload: {
      manual: true,
      reason: "one_setup_initial_plan",
      oneSetupRequestId: undefined as string | undefined,
    },
  };
  const ctx = { db: { get: async () => null } };
  const currency = () => oneSetupInitialPlanCurrency(
    ctx as unknown as CurrencyContext,
    {
      site: site as unknown as CurrencyArgs["site"],
      job: job as unknown as CurrencyArgs["job"],
    },
  );
  assert.deepEqual(
    await currency(),
    { kind: "stale", reason: "legacy_receipt_unmigrated" },
  );
  job.payload.oneSetupRequestId = "request-r";
  assert.deepEqual(
    await currency(),
    { kind: "stale", reason: "receipt_payload_invalid" },
  );
});

test("the job and configuration receipt bind atomically before any retry can reserve", () => {
  const schema = readFileSync("convex/schema.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");

  assert.match(
    schema,
    /one_setup_executions:[\s\S]*\.index\("by_request_configuration", \["requestId", "configurationRevision"\]\)/,
  );
  const queueStart = jobs.indexOf("export const queuePlanIfAbsent");
  const queueEnd = jobs.indexOf(
    "export const queueExpectedClickPlanMigrationAfterPreflight",
    queueStart,
  );
  const queue = jobs.slice(queueStart, queueEnd);
  const receiptReuseAt = queue.indexOf("if (setupExecution.planJobId)");
  const stableReceiptReuseAt = queue.indexOf(
    "else if (initialPlanReceipt.adoptBoundJob)",
  );
  const setupAuthorizationAt = queue.indexOf(
    "siteExecutionAuthorized(ctx, site)",
  );
  const activePlanAt = queue.indexOf("activeJobsForSite");
  const reserveAt = queue.indexOf("reservePlanProviderBudget");
  const insertAt = queue.indexOf('ctx.db.insert("jobs"');
  const bindAt = queue.indexOf('status: "plan_queued"', insertAt);
  assert.ok(receiptReuseAt >= 0 && receiptReuseAt < reserveAt);
  assert.ok(
    stableReceiptReuseAt >= 0 &&
      stableReceiptReuseAt < activePlanAt &&
      stableReceiptReuseAt < reserveAt,
    "a current revision must adopt pending/running/done J before active-plan or spend gates",
  );
  assert.ok(
    setupAuthorizationAt > stableReceiptReuseAt &&
      setupAuthorizationAt < activePlanAt &&
      setupAuthorizationAt < reserveAt,
    "claim -> park/downgrade -> queue must fail authorization before reserving a new J",
  );
  assert.match(
    queue,
    /!exactOneSetupBinding && !siteExecutionActive\(site\)/,
    "parking may bypass only the outer gate needed to adopt an exact stable receipt",
  );
  assert.match(
    queue,
    /siteExecutionAuthorized\(ctx, site\)[\s\S]*reason: "setup_execution_not_authorized"/,
  );
  assert.ok(insertAt >= 0 && bindAt > insertAt);
  assert.match(queue, /oneSetupExecutionId: setupExecution\._id/);
  assert.match(
    queue,
    /oneSetupConfigurationRevision:[\s\S]*setupExecution\.configurationRevision/,
  );
  assert.match(queue, /oneSetupRequestId: setupRequest!\._id/);
  assert.match(queue, /oneSetupInitialPlanReceiptVersion/);
  assert.match(queue, /oneSetupInitialPlanGeneration/);
  assert.match(queue, /oneSetupCanonicalDomainRevision/);
  assert.match(
    queue,
    /initialPlanJobId: jobId[\s\S]*status: "plan_queued"[\s\S]*planJobId: jobId[\s\S]*domainRevisionSnapshot: siteCanonicalDomainRevision\(site\)/,
    "the request receipt and source execution must bind in the reservation mutation",
  );
  assert.match(
    queue,
    /setupRequest\.configurationRevision \?\? 0\)[\s\S]*oneSetupConfigurationRevision/,
  );
  assert.doesNotMatch(
    executions,
    /exactExecutionBinding/,
    "an unmigrated exact-execution payload is never an authorization bypass",
  );
  assert.ok(
    [...executions.matchAll(/requestMatchesExecution\(/g)].length >= 8,
    "claim, receipt-only settlement, recovery, and reconciliation share the exact execution fence",
  );
  assert.match(executions, /oneSetupPlanSettlement\(\{/);
  assert.match(executions, /oneSetupInitialPlanJobBindingMatches/);

  const actionStart = pipeline.indexOf(
    "async function resumeOneSetupExecutionHandler",
  );
  const actionEnd = pipeline.indexOf(
    "export const resumeOneSetupExecution = action",
    actionStart,
  );
  const action = pipeline.slice(actionStart, actionEnd);
  assert.match(action, /internal\.oneSetupExecutions\.claim/);
  assert.match(action, /internal\.oneSetupExecutions\.inspectPlan/);
  assert.match(action, /internal\.oneSetupExecutions\.settleFromPlan/);
  assert.match(action, /oneSetupExecutionId: claim\.executionId/);
  assert.match(
    action,
    /queued\.queued \|\| queued\.reason === "setup_receipt"/,
  );
  assert.match(pipeline, /export const resumeOneSetupExecutionInternal/);
});

test("legacy migration, adoption reconciliation, and claim death are durable", () => {
  const schema = readFileSync("convex/schema.ts", "utf8");
  const sites = readFileSync("convex/sites.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");

  const saveAt = sites.indexOf("export const saveOneSetupRequest");
  const save = sites.slice(saveAt, sites.indexOf("export const getOneSetup", saveAt));
  assert.match(
    save,
    /by_request_configuration[\s\S]*configurationRevision[\s\S]*\.take\(2\)/,
  );
  assert.match(save, /oneSetupLegacyInitialPlanJobBindingMatches/);
  assert.match(save, /legacy_initial_plan_execution_ambiguous/);
  assert.match(save, /legacy_initial_plan_receipt_unprovable/);
  assert.match(
    save,
    /oneSetupRequestId: requestId[\s\S]*oneSetupInitialPlanGeneration[\s\S]*oneSetupCanonicalDomainRevision/,
  );
  assert.match(schema, /initialPlanQuarantineCode: v\.optional/);
  assert.match(schema, /domainRevisionSnapshot: v\.optional\(v\.number\(\)\)/);

  const queueAt = jobs.indexOf("export const queuePlanIfAbsent");
  const queue = jobs.slice(
    queueAt,
    jobs.indexOf("export const queueExpectedClickPlanMigrationAfterPreflight", queueAt),
  );
  assert.ok(
    [...queue.matchAll(/internal\.oneSetupExecutions\.reconcileCurrentPlanJob/g)]
        .length >= 2,
    "both an already-bound execution and a stable request adoption schedule immediate reconciliation",
  );

  assert.match(schema, /claimWatchGeneration: v\.optional/);
  assert.match(schema, /claimWatchAttempt: v\.optional/);
  assert.match(executions, /async function armClaimWatchdog/);
  const insertAt = executions.indexOf('ctx.db.insert("one_setup_executions"');
  const firstWatchAt = executions.indexOf("armClaimWatchdog", insertAt);
  assert.ok(insertAt >= 0 && firstWatchAt > insertAt);
  assert.match(executions, /export const recoverExpiredClaim/);
  assert.match(
    executions,
    /recoverExpiredClaim[\s\S]*siteExecutionAuthorized[\s\S]*scheduleExactResumeWithWatchdog/,
  );
});

test("a committed save bootstraps one exact execution without the browser", () => {
  const sites = readFileSync("convex/sites.ts", "utf8");
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");

  const saveAt = sites.indexOf("export const saveOneSetupRequest");
  const save = sites.slice(saveAt, sites.indexOf("export const getOneSetup", saveAt));
  assert.match(
    save,
    /internal\.oneSetupExecutions\.bootstrapSavedExecution[\s\S]*requestId, configurationRevision/,
    "the save transaction must arm the backend path before its response can be lost",
  );

  const bootstrapAt = executions.indexOf(
    "export const bootstrapSavedExecution",
  );
  const bootstrap = executions.slice(
    bootstrapAt,
    executions.indexOf("export const recoverExpiredClaim", bootstrapAt),
  );
  assert.match(
    bootstrap,
    /request\.configurationRevision \?\? 0\) !== args\.configurationRevision/,
  );
  assert.match(
    bootstrap,
    /by_request_configuration[\s\S]*requestId[\s\S]*configurationRevision[\s\S]*\.unique\(\)/,
    "the UI and backend bootstrap must converge through the same exact row",
  );
  assert.match(bootstrap, /ctx\.db\.insert\("one_setup_executions"/);
  assert.match(bootstrap, /scheduleExactResumeWithWatchdog/);
  const stableAdoptionAt = bootstrap.indexOf(
    "context.request.initialPlanJobId",
  );
  const authorizationAt = bootstrap.indexOf(
    "siteExecutionAuthorized(ctx, context.site)",
  );
  assert.ok(
    stableAdoptionAt >= 0 && stableAdoptionAt < authorizationAt,
    "a parked bootstrap must adopt and reconcile an existing J without authorizing new work",
  );
  assert.match(
    bootstrap,
    /stable_receipt_adopted[\s\S]*jobStatus: stableJob\.status/,
  );
  assert.match(
    bootstrap,
    /\["done", "failed"\]\.includes\(stableJob\.status\)[\s\S]*stable_receipt_adopted[\s\S]*execution = await ctx\.db\.get\(execution\._id\)[\s\S]*scheduleExactResumeWithWatchdog/,
    "a pending/running adopted J must reach the exact action+successor watchdog while terminal J stays provider-free",
  );
  const adoptedJobAt = bootstrap.indexOf("planJobId: stableJob._id");
  const terminalReceiptAt = bootstrap.indexOf(
    '["done", "failed"].includes(stableJob.status)',
    adoptedJobAt,
  );
  const authorizationAtAfterAdoption = bootstrap.indexOf(
    "siteExecutionAuthorized(ctx, context.site)",
    terminalReceiptAt,
  );
  const exactResumeAt = bootstrap.lastIndexOf(
    "scheduleExactResumeWithWatchdog",
  );
  assert.ok(
    adoptedJobAt >= 0 &&
      terminalReceiptAt > adoptedJobAt &&
      authorizationAtAfterAdoption > terminalReceiptAt &&
      exactResumeAt > authorizationAtAfterAdoption,
    "terminal receipt settlement bypasses parking, but pending/running provider continuation requires live authorization",
  );
  assert.match(
    bootstrap,
    /receiptRequestContext[\s\S]*requestMatchesExecution[\s\S]*planBindingMatches[\s\S]*planJobId: stableJob\._id/,
    "stable adoption remains exact owner/domain/config/generation fenced",
  );
  assert.doesNotMatch(
    bootstrap,
    /resumeOneSetupExecutionInternal/,
    "the bootstrap must use the helper that atomically arms the successor mutation",
  );

  const claimAt = executions.indexOf("export const claim");
  const claim = executions.slice(claimAt, bootstrapAt);
  assert.match(
    claim,
    /by_request_configuration[\s\S]*requestId[\s\S]*configurationRevision[\s\S]*\.unique\(\)/,
  );
  assert.match(claim, /if \(!existing\)[\s\S]*ctx\.db\.insert\("one_setup_executions"/);

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const resumeAt = pipeline.indexOf(
    "async function resumeOneSetupExecutionHandler",
  );
  const resume = pipeline.slice(
    resumeAt,
    pipeline.indexOf("export const resumeOneSetupExecution = action", resumeAt),
  );
  assert.match(
    resume,
    /let planJobId = claim\.planJobId;[\s\S]*if \(!planJobId\)[\s\S]*queuePlanIfAbsent[\s\S]*inspectPlan[\s\S]*jobId: plan\.jobId/,
    "an adopted J skips the reservation branch and continues that exact job",
  );
});

test("queue denials retain their real eligibility window", () => {
  const morning = Date.UTC(2026, 7, 25, 8, 0, 0);
  const nextDay = Date.UTC(2026, 7, 26, 0, 0, 1);
  const nextMonth = Date.UTC(2026, 8, 1, 0, 0, 1);
  for (const reason of [
    "provider_daily_budget_reserved",
    "provider_account_daily_budget_reserved",
    "provider_fleet_daily_budget_reserved",
  ]) {
    assert.deepEqual(
      oneSetupQueueDenialDisposition({ reason, now: morning }),
      { kind: "retry", eligibleAt: nextDay },
      `${reason} must wake at the next UTC budget window, not exhaust 30-second retries that morning`,
    );
  }
  assert.deepEqual(
    oneSetupQueueDenialDisposition({
      reason: "provider_account_preflight_cooling_down",
      now: morning,
      retryAfterMs: 123_456,
    }),
    { kind: "retry", eligibleAt: morning + 123_456 },
  );
  assert.deepEqual(
    oneSetupQueueDenialDisposition({
      reason: "provider_fleet_monthly_budget_reserved",
      now: morning,
    }),
    { kind: "retry", eligibleAt: nextMonth },
  );
  assert.deepEqual(
    oneSetupQueueDenialDisposition({
      reason: "owner_unbound",
      now: morning,
    }),
    { kind: "blocked", blockerCode: "owner_unbound" },
  );

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  assert.match(
    pipeline,
    /oneSetupQueueDenialDisposition\([\s\S]*retryAfterMs: queued\.retryAfterMs[\s\S]*retryAt: denial\.kind === "retry"/,
  );
  const queueAt = jobs.indexOf("export const queuePlanIfAbsent");
  const queue = jobs.slice(
    queueAt,
    jobs.indexOf("export const queueExpectedClickPlanMigrationAfterPreflight", queueAt),
  );
  assert.match(
    queue,
    /oneSetupQueueDenialDisposition\([\s\S]*retryAfterMs: reservation\.retryAfterMs[\s\S]*eligibleAt: denial\?\.kind === "retry"/,
    "the reservation mutation must return its own UTC/cooldown deadline rather than recomputing it after midnight",
  );
  const releaseAt = executions.indexOf("export const releaseForRetry");
  const release = executions.slice(
    releaseAt,
    executions.indexOf("export const resumePendingExecution", releaseAt),
  );
  assert.match(release, /retryAt: v\.optional\(v\.number\(\)\)/);
  assert.match(release, /pendingResumeNextAt = args\.retryAt === undefined/);
  assert.match(release, /ctx\.scheduler\.runAt\([\s\S]*pendingResumeNextAt/);
  const resumeAt = executions.indexOf("export const resumePendingExecution");
  const resume = executions.slice(
    resumeAt,
    executions.indexOf("export const settleFromPlan", resumeAt),
  );
  assert.match(
    resume,
    /ONE_SETUP_PENDING_RESUME_MAX_ATTEMPTS[\s\S]*setup_pending_resume_exhausted[\s\S]*oneSetupExecutionTerminalPatch\([\s\S]*status: "blocked"/,
    "a persistent denial must become an explicit terminal blocker, never an unscheduled pending row",
  );
});

test("failed J zero-spend recovery is eligibility-bound and authorization-gated", () => {
  const schema = readFileSync("convex/schema.ts", "utf8");
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(schema, /initialPlanRecoveryCount: v\.optional/);
  assert.match(executions, /oneSetupFailedPlanRecoveryReceiptMatches/);
  const recoveryAt = executions.indexOf(
    "export const recoverFailedInitialPlanReceipt",
  );
  const recovery = executions.slice(
    recoveryAt,
    executions.indexOf("export const reconcileCurrentPlanJob", recoveryAt),
  );
  const eligibilityAt = recovery.indexOf("recovery.eligibleAt > timestamp");
  const authorizationAt = recovery.indexOf("siteExecutionAuthorized");
  const rotateAt = recovery.indexOf("initialPlanGeneration: currentGeneration! + 1");
  const scheduleAt = recovery.indexOf("scheduleExactResumeWithWatchdog");
  assert.ok(
    eligibilityAt >= 0 &&
      authorizationAt > eligibilityAt &&
      rotateAt > authorizationAt &&
      scheduleAt > rotateAt,
  );
  assert.match(recovery, /initialPlanRecoveryCount:/);
  assert.match(recovery, /initialPlanJobId: undefined/);
  assert.match(recovery, /planJobId: undefined/);
  assert.match(
    recovery,
    /recoveryWatchGeneration: v\.number\(\)[\s\S]*authorizationWatchAttempt: v\.number\(\)[\s\S]*execution\.planSettlementWatchGeneration !==[\s\S]*args\.recoveryWatchGeneration[\s\S]*execution\.planSettlementWatchAttempt !==[\s\S]*args\.authorizationWatchAttempt[\s\S]*recovery_watch_superseded/,
    "every zero-spend recovery wake is bound to the exact persisted generation and attempt",
  );
  assert.match(
    recovery,
    /planSettlementWatchAttempt: attempt[\s\S]*planSettlementNextAt: nextAt[\s\S]*recoveryWatchGeneration: args\.recoveryWatchGeneration[\s\S]*authorizationWatchAttempt: attempt/,
    "authorization reinspection advances its durable receipt before scheduling",
  );
  assert.match(
    executions,
    /existingRecoveryWatch[\s\S]*planSettlementWatchGeneration[\s\S]*planSettlementWatchAttempt[\s\S]*recoveryWaiting: true[\s\S]*recoveryWatchGeneration[\s\S]*authorizationWatchAttempt: 0/,
    "duplicate terminal reconciliation adopts the already-armed recovery instead of creating another wake chain",
  );
  const readinessAt = sites.indexOf("export const getOneSetupReadiness");
  const readiness = sites.slice(
    readinessAt,
    sites.indexOf("export const getFull", readinessAt),
  );
  assert.match(
    readiness,
    /by_request_configuration[\s\S]*persistentProviderRecovery[\s\S]*actionRequiredBy:[\s\S]*"operator"/,
  );
  assert.match(
    readiness,
    /initialPlanExecution:[\s\S]*recoveryCount:[\s\S]*nextEligibleAt:/,
    "persistent exact zero-spend recovery must remain visible to the owner/operator",
  );
});

test("every exhausted watcher becomes action-required with no phantom wake", () => {
  const timestamp = Date.UTC(2026, 7, 25, 12, 0, 0);
  const exhaustionBlockers = [
    "setup_bootstrap_authorization_watch_exhausted",
    "setup_claim_authorization_watch_exhausted",
    "setup_resume_dispatch_authorization_watch_exhausted",
    "setup_initial_plan_recovery_authorization_watch_exhausted",
    "plan_settlement_watch_exhausted",
  ];
  for (const blockerCode of exhaustionBlockers) {
    const patch = oneSetupExecutionTerminalPatch({
      status: "blocked",
      blockerCode,
      timestamp,
    });
    assert.equal(patch.status, "blocked");
    assert.equal(patch.blockerCode, blockerCode);
    assert.equal(patch.completedAt, timestamp);
    assert.equal(patch.updatedAt, timestamp);
    for (const cleared of [
      "claimNonce",
      "leaseExpiresAt",
      "claimWatchGeneration",
      "claimWatchAttempt",
      "claimWatchNextAt",
      "pendingResumeGeneration",
      "pendingResumeAttempt",
      "pendingResumeNextAt",
      "bootstrapAuthorizationWatchAttempt",
      "bootstrapAuthorizationNextAt",
      "planSettlementWatchGeneration",
      "planSettlementWatchAttempt",
      "planSettlementNextAt",
    ] as const) {
      assert.equal(patch[cleared], undefined, `${blockerCode} clears ${cleared}`);
    }
    assert.equal(oneSetupExecutionNextEligibleAt(patch), undefined);
  }

  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  for (const blockerCode of exhaustionBlockers) {
    assert.match(
      executions,
      new RegExp(
        `${blockerCode}[\\s\\S]{0,500}oneSetupExecutionTerminalPatch`,
      ),
      `${blockerCode} must use the canonical atomic terminal projection`,
    );
  }
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(
    sites,
    /contentPlanActionRequired[\s\S]*currentExecution!\.status === "blocked"[\s\S]*state: planState[\s\S]*actionRequiredBy:/,
    "every exhausted execution is projected as action-required/blocked",
  );

  const reconcileAt = executions.indexOf(
    "export const reconcileCurrentPlanJob",
  );
  const reconcile = executions.slice(reconcileAt);
  assert.match(
    reconcile,
    /execution\.status === "blocked"[\s\S]*!\["done", "failed"\]\.includes\(job\.status\)[\s\S]*settleTerminalPlan/,
    "a later immutable terminal J overrides an operational watcher block",
  );
  assert.match(
    reconcile,
    /setup_initial_plan_recovery_authorization_watch_exhausted" &&[\s\S]*job\.status === "failed"[\s\S]*return \{ state: "blocked"/,
    "the failed J that preceded zero-spend authorization exhaustion cannot restart that exhausted watch",
  );
  assert.doesNotMatch(reconcile, /queuePlanIfAbsent|reservePlanProviderBudget/);
});

test("bootstrap authorization exposes and advances one exact readiness wake", () => {
  const nextAt = Date.UTC(2026, 7, 26, 0, 0, 1);
  assert.equal(
    oneSetupExecutionNextEligibleAt({
      bootstrapAuthorizationNextAt: nextAt,
    }),
    nextAt,
  );
  assert.equal(
    oneSetupExecutionNextEligibleAt({
      planSettlementNextAt: nextAt + 10_000,
      bootstrapAuthorizationNextAt: nextAt,
      pendingResumeNextAt: nextAt + 20_000,
    }),
    nextAt,
    "the projection reports the exact earliest durable mutation wake",
  );

  const schema = readFileSync("convex/schema.ts", "utf8");
  assert.match(schema, /bootstrapAuthorizationWatchAttempt: v\.optional/);
  assert.match(schema, /bootstrapAuthorizationNextAt: v\.optional/);
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  const bootstrapAt = executions.indexOf(
    "export const bootstrapSavedExecution",
  );
  const bootstrap = executions.slice(
    bootstrapAt,
    executions.indexOf("export const recoverExpiredClaim", bootstrapAt),
  );
  assert.match(
    bootstrap,
    /bootstrapAuthorizationWatchAttempt !==[\s\S]*authorization_watch_superseded/,
  );
  assert.match(
    bootstrap,
    /bootstrapAuthorizationWatchAttempt: attempt[\s\S]*bootstrapAuthorizationNextAt: nextAt[\s\S]*ctx\.scheduler\.runAt\([\s\S]*nextAt[\s\S]*authorizationRecheckAttempt: attempt/,
  );
  const sites = readFileSync("convex/sites.ts", "utf8");
  assert.match(
    sites,
    /nextEligibleAt: oneSetupExecutionNextEligibleAt\(\{[\s\S]*bootstrapAuthorizationNextAt/,
  );
});

test("every mutation-to-resume-action handoff has a fenced successor wake", () => {
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  const helperAt = executions.indexOf(
    "async function scheduleExactResumeWithWatchdog",
  );
  const helperEnd = executions.indexOf(
    "async function receiptRequestContext",
    helperAt,
  );
  const helper = executions.slice(helperAt, helperEnd);
  const actionAt = helper.indexOf("resumeOneSetupExecutionInternal");
  const successorAt = helper.indexOf("recoverScheduledResumeDispatch");
  assert.ok(actionAt >= 0 && successorAt > actionAt);
  assert.match(helper, /claimWatchGeneration: generation/);
  assert.match(helper, /claimWatchAttempt: args\.recoveryAttempt/);
  assert.match(helper, /expectedClaimWatchGeneration: generation/);

  const successorStart = executions.indexOf(
    "export const recoverScheduledResumeDispatch",
  );
  const successor = executions.slice(
    successorStart,
    executions.indexOf("export const inspectPlan", successorStart),
  );
  assert.match(successor, /execution\.claimWatchGeneration !== args\.watchGeneration/);
  assert.match(successor, /execution\.claimNonce/);
  assert.match(successor, /ONE_SETUP_CLAIM_WATCHDOG_MAX_RECOVERIES/);
  assert.match(successor, /scheduleExactResumeWithWatchdog/);
  const claimAt = executions.indexOf("export const claim");
  const claim = executions.slice(
    claimAt,
    executions.indexOf("export const recoverExpiredClaim", claimAt),
  );
  assert.match(
    claim,
    /existing\.claimWatchGeneration !==[\s\S]*args\.expectedClaimWatchGeneration/,
  );
  assert.match(claim, /existing\.claimWatchAttempt !== args\.claimRecoveryAttempt/);

  for (const mutation of [
    "export const recoverExpiredClaim",
    "export const resumePendingExecution",
    "export const recoverFailedInitialPlanReceipt",
  ]) {
    const start = executions.indexOf(mutation);
    const nextExport = executions.indexOf("\nexport const ", start + mutation.length);
    assert.match(
      executions.slice(start, nextExport < 0 ? undefined : nextExport),
      /scheduleExactResumeWithWatchdog/,
      `${mutation} must not enqueue an at-most-once action without its mutation successor`,
    );
  }
});

test("scheduled plan watches cannot ABA across a same-context resave", () => {
  const equalCounterReceipt = { generation: 1, attempt: 1 };
  assert.equal(equalCounterReceipt.generation, 1);
  assert.equal(equalCounterReceipt.attempt, 1);
  assert.equal(
    oneSetupExecutionWatchIdentityMatches({
      expectedExecutionId: "execution-e1",
      expectedConfigurationRevision: 1,
      actualExecutionId: "execution-e1",
      actualConfigurationRevision: 1,
      currentConfigurationRevision: 2,
    }),
    false,
    "E1's wake is stale after the request advances to same-context E2 even when counters are equal",
  );
  assert.equal(
    oneSetupExecutionWatchIdentityMatches({
      expectedExecutionId: "execution-e1",
      expectedConfigurationRevision: 2,
      actualExecutionId: "execution-e2",
      actualConfigurationRevision: 2,
      currentConfigurationRevision: 2,
    }),
    false,
    "counter equality cannot cross execution ids",
  );
  assert.equal(
    oneSetupExecutionWatchIdentityMatches({
      expectedExecutionId: "execution-e2",
      expectedConfigurationRevision: 2,
      actualExecutionId: "execution-e2",
      actualConfigurationRevision: 2,
      currentConfigurationRevision: 2,
    }),
    true,
  );

  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  const recoveryAt = executions.indexOf(
    "export const recoverFailedInitialPlanReceipt",
  );
  const reconcileAt = executions.indexOf(
    "export const reconcileCurrentPlanJob",
    recoveryAt,
  );
  const recovery = executions.slice(recoveryAt, reconcileAt);
  const reconcile = executions.slice(reconcileAt);
  assert.match(
    recovery,
    /expectedExecutionId: v\.id\("one_setup_executions"\)[\s\S]*expectedConfigurationRevision: v\.number\(\)[\s\S]*ctx\.db\.get\(args\.expectedExecutionId\)[\s\S]*oneSetupExecutionWatchIdentityMatches[\s\S]*recovery_watch_superseded/,
  );
  assert.match(
    reconcile,
    /expectedExecutionId: v\.optional\(v\.id\("one_setup_executions"\)\)[\s\S]*expectedConfigurationRevision: v\.optional\(v\.number\(\)\)[\s\S]*watchIdentityCount[\s\S]*oneSetupExecutionWatchIdentityMatches[\s\S]*watch_superseded/,
  );
  const armAt = executions.indexOf("async function armPlanSettlementWatch");
  const arm = executions.slice(
    armAt,
    executions.indexOf("export const claim", armAt),
  );
  assert.match(
    arm,
    /expectedExecutionId: args\.execution\._id[\s\S]*expectedConfigurationRevision: args\.execution\.configurationRevision[\s\S]*watchGeneration: generation[\s\S]*watchAttempt: attempt/,
  );
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const terminalWakeAt = jobs.indexOf(
    "async function wakeCurrentOneSetupExecutionForTerminalPlan",
  );
  const terminalWake = jobs.slice(
    terminalWakeAt,
    jobs.indexOf("type PlanPersistenceCommit", terminalWakeAt),
  );
  assert.doesNotMatch(
    terminalWake,
    /expectedExecutionId|watchGeneration/,
    "an immediate terminal receipt intentionally selects the current adopted execution",
  );
});

test("nonterminal re-arms retain watcher epochs so old same-execution wakes no-op", () => {
  const firstHandoffGeneration = nextOneSetupWatchGeneration();
  const retainedAfterRelease = firstHandoffGeneration;
  const secondHandoffGeneration = nextOneSetupWatchGeneration(
    retainedAfterRelease,
  );
  const denialReleaseAt = 30;
  const staleFirstHandoffWakeAt = 60;
  const currentSecondHandoffWakeAt = 90;
  const staleWakeGenerationMatches =
    firstHandoffGeneration === secondHandoffGeneration;
  const currentWakeGeneration = secondHandoffGeneration;
  const currentWakeGenerationMatches =
    currentWakeGeneration === secondHandoffGeneration;
  assert.equal(firstHandoffGeneration, 1);
  assert.equal(secondHandoffGeneration, 2);
  assert.ok(denialReleaseAt < staleFirstHandoffWakeAt);
  assert.ok(staleFirstHandoffWakeAt < currentSecondHandoffWakeAt);
  assert.notEqual(
    firstHandoffGeneration,
    secondHandoffGeneration,
    "handoff1's +60 wake cannot match handoff2's later generation",
  );
  const sameExecutionIdentity = oneSetupExecutionWatchIdentityMatches({
    expectedExecutionId: "execution-e",
    expectedConfigurationRevision: 1,
    actualExecutionId: "execution-e",
    actualConfigurationRevision: 1,
    currentConfigurationRevision: 1,
  });
  assert.equal(sameExecutionIdentity, true);
  assert.equal(
    sameExecutionIdentity &&
      staleWakeGenerationMatches,
    false,
    "handoff1's stale +60 wake is superseded",
  );
  assert.equal(
    sameExecutionIdentity &&
      currentWakeGenerationMatches,
    true,
    "handoff2's +90 wake alone owns recovery",
  );

  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  assert.doesNotMatch(
    executions,
    /(?:claimWatchGeneration|pendingResumeGeneration|planSettlementWatchGeneration): undefined/,
    "only the canonical terminal patch may erase a watcher epoch",
  );
  const terminal = readFileSync("convex/lib/oneSetupExecution.ts", "utf8");
  assert.match(terminal, /claimWatchGeneration: undefined/);
  assert.match(terminal, /pendingResumeGeneration: undefined/);
  assert.match(terminal, /planSettlementWatchGeneration: undefined/);
  const releaseAt = executions.indexOf("export const releaseForRetry");
  const release = executions.slice(
    releaseAt,
    executions.indexOf("export const resumePendingExecution", releaseAt),
  );
  assert.match(
    release,
    /nextOneSetupWatchGeneration\([\s\S]*execution\.pendingResumeGeneration/,
  );
  assert.match(
    executions,
    /scheduleExactResumeWithWatchdog[\s\S]*nextOneSetupWatchGeneration\([\s\S]*args\.execution\.claimWatchGeneration/,
  );
  const handoffAt = executions.indexOf(
    "async function scheduleExactResumeWithWatchdog",
  );
  const handoff = executions.slice(
    handoffAt,
    executions.indexOf("async function receiptRequestContext", handoffAt),
  );
  assert.match(
    handoff,
    /pendingResumeAttempt: undefined[\s\S]*pendingResumeNextAt: undefined/,
    "consuming a pending wake invalidates its attempt while retaining its monotonic generation",
  );
});

test("an adopted running plan autonomously settles the current resaved execution", () => {
  const schema = readFileSync("convex/schema.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const topics = readFileSync("convex/topics.ts", "utf8");
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");

  assert.match(schema, /planSettlementWatchGeneration: v\.optional/);
  assert.match(schema, /planSettlementWatchAttempt: v\.optional/);
  assert.match(schema, /planSettlementNextAt: v\.optional/);
  const settleAt = executions.indexOf("export const settleFromPlan");
  const reconcileAt = executions.indexOf(
    "export const reconcileCurrentPlanJob",
  );
  assert.ok(settleAt >= 0 && reconcileAt > settleAt);
  const settle = executions.slice(settleAt, reconcileAt);
  assert.match(settle, /settleTerminalPlan/);
  assert.match(settle, /armPlanSettlementWatch/);
  assert.match(
    executions.slice(reconcileAt),
    /by_request_configuration[\s\S]*request\.configurationRevision[\s\S]*planBindingMatches[\s\S]*settleTerminalPlan/,
  );
  assert.match(
    executions.slice(reconcileAt),
    /receiptRequestContext/,
  );
  assert.doesNotMatch(
    executions.slice(reconcileAt),
    /activeRequestContext/,
  );
  assert.match(
    executions.slice(reconcileAt),
    /execution\.status === "completed"[\s\S]*const job = await ctx\.db\.get[\s\S]*execution\.status === "blocked"[\s\S]*!\["done", "failed"\]\.includes\(job\.status\)/,
    "a later terminal paid J must override only an operational execution blocker",
  );
  assert.match(
    executions,
    /ONE_SETUP_PLAN_SETTLEMENT_MAX_ATTEMPTS = 180/,
  );

  // Success, explicit failure, lost lease, and pre-provider cancellation all
  // issue the same provider-free terminal wake. Atomic topic persistence does
  // so in the transaction that marks J done.
  assert.ok(
    [...jobs.matchAll(/wakeCurrentOneSetupExecutionForTerminalPlan\(ctx, job\)/g)]
        .length >= 5,
  );
  assert.match(
    topics,
    /status: "done"[\s\S]*internal\.oneSetupExecutions\.reconcileCurrentPlanJob/,
  );
});

test("a superseded generation is fenced before spend and inside terminal persistence", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const topics = readFileSync("convex/topics.ts", "utf8");

  assert.match(jobs, /export const authorizeOneSetupInitialPlanWorker/);
  assert.match(
    jobs,
    /one_setup_planning_context_superseded_before_execution/,
  );
  const directPlan = pipeline.slice(
    pipeline.indexOf("async function generatePlanHandler"),
    pipeline.indexOf("export const generatePlanInternal"),
  );
  const processNext = pipeline.slice(
    pipeline.indexOf("export const processNextJob"),
  );
  const fleetPlan = processNext.slice(
    processNext.indexOf('if (job.type === "plan")'),
    processNext.indexOf('if (job.type === "article")'),
  );
  for (const path of [directPlan, fleetPlan]) {
    const generationFenceAt = path.indexOf(
      "assertCurrentOneSetupInitialPlan",
    );
    const paidBoundaryAt = path.indexOf("assertDataForSeoAccountBalance");
    assert.ok(
      generationFenceAt >= 0 &&
        paidBoundaryAt > generationFenceAt,
      "the stable generation must be checked before provider account access",
    );
  }
  const persistenceAt = topics.indexOf("export const upsertMany");
  const persistence = topics.slice(persistenceAt);
  const terminalFenceAt = persistence.indexOf(
    "oneSetupInitialPlanCurrency",
  );
  const firstTopicWriteAt = Math.min(
    ...["ctx.db.insert(\"topic_clusters\"", "ctx.db.patch(existingTopic._id"]
      .map((needle) => persistence.indexOf(needle))
      .filter((index) => index >= 0),
  );
  assert.ok(
    terminalFenceAt >= 0 && firstTopicWriteAt > terminalFenceAt,
    "the atomic mutation must reject stale J before any topic write",
  );
  assert.match(
    persistence,
    /One-setup initial plan was superseded before topic commit/,
  );
});

test("browser retry preserves the exact owner configuration receipt", () => {
  const wizard = readFileSync(
    "src/components/onboarding/setup-wizard.tsx",
    "utf8",
  );
  assert.match(wizard, /if \(!receipt\) \{[\s\S]*saveOneSetupRequest/);
  assert.match(wizard, /setSetupReceipt\(receipt\)/);
  assert.match(wizard, /requestId: receipt\.requestId/);
  assert.match(
    wizard,
    /configurationRevision: receipt\.configurationRevision/,
  );
  assert.match(wizard, /finishSetup\(siteId, setupReceipt\)/);
  assert.doesNotMatch(wizard, /useAction\(api\.actions\.pipeline\.generatePlan\)/);
});
