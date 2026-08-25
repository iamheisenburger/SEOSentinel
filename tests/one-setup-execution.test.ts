import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  oneSetupConfigurationRevisionIsCurrent,
  oneSetupExecutionClaimDisposition,
  oneSetupPlanSettlement,
  oneSetupTerminalReceiptSettlementAllowed,
} from "../convex/lib/oneSetupExecution.ts";
import {
  ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
  oneSetupInitialPlanContextFingerprint,
  oneSetupInitialPlanJobBindingMatches,
  oneSetupInitialPlanReceiptDecision,
} from "../convex/lib/oneSetupInitialPlan.ts";
import { oneSetupInitialPlanCurrency } from
  "../convex/lib/oneSetupInitialPlanDb.ts";
import { accountDeletionKey } from "../convex/lib/accountDeletion.ts";

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
  assert.equal(
    oneSetupTerminalReceiptSettlementAllowed({
      ...terminalReceiptFence,
      planParkedAt: 10_000,
      entitlementCurrent: false,
    }),
    true,
    "parking/downgrade may stop new work but cannot strand a paid terminal receipt",
  );
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

test("the stable generation is current at spend and stale after a true context reset", async () => {
  type CurrencyContext = Parameters<typeof oneSetupInitialPlanCurrency>[0];
  type CurrencyArgs = Parameters<typeof oneSetupInitialPlanCurrency>[1];
  const site = {
    _id: "site-s",
    userId: "user-u",
    domain: "https://www.example.com",
    canonicalDomain: "example.com",
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

test("partial stable setup payloads fail closed while additive legacy receipts remain compatible", async () => {
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
    { kind: "legacy_one_setup" },
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
  assert.ok(insertAt >= 0 && bindAt > insertAt);
  assert.match(queue, /oneSetupExecutionId: setupExecution\._id/);
  assert.match(
    queue,
    /oneSetupConfigurationRevision:[\s\S]*setupExecution\.configurationRevision/,
  );
  assert.match(queue, /oneSetupRequestId: setupRequest!\._id/);
  assert.match(queue, /oneSetupInitialPlanReceiptVersion/);
  assert.match(queue, /oneSetupInitialPlanGeneration/);
  assert.match(
    queue,
    /initialPlanJobId: jobId[\s\S]*status: "plan_queued"[\s\S]*planJobId: jobId/,
    "the request receipt and source execution must bind in the reservation mutation",
  );
  assert.match(
    queue,
    /setupRequest\.configurationRevision \?\? 0\)[\s\S]*oneSetupConfigurationRevision/,
  );
  assert.match(executions, /payload\.oneSetupExecutionId/);
  assert.ok(
    [...executions.matchAll(/requestMatchesExecution\(request, execution\)/g)]
        .length >= 2,
  );
  assert.match(executions, /oneSetupPlanSettlement\(\{/);
  assert.match(executions, /oneSetupInitialPlanJobBindingMatches/);

  const actionStart = pipeline.indexOf(
    "export const resumeOneSetupExecution = action",
  );
  const actionEnd = pipeline.indexOf("export const generateArticle", actionStart);
  const action = pipeline.slice(actionStart, actionEnd);
  assert.match(action, /internal\.oneSetupExecutions\.claim/);
  assert.match(action, /internal\.oneSetupExecutions\.inspectPlan/);
  assert.match(action, /internal\.oneSetupExecutions\.settleFromPlan/);
  assert.match(action, /oneSetupExecutionId: claim\.executionId/);
  assert.match(
    action,
    /queued\.queued \|\| queued\.reason === "setup_receipt"/,
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
