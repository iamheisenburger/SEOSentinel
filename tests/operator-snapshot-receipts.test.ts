import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OPERATOR_PLAN_CHECKPOINT_READ_LIMIT,
  OPERATOR_PLAN_RECEIPT_LIMIT,
  latestTerminalPlanJobs,
  operatorActiveJobReceipt,
  operatorArticleReceipt,
  operatorContinuationRunReceipt,
  operatorCheckpointIdsAreBoundedUniqueSubset,
  operatorHealthReceipt,
  operatorPlanCheckpointReceipt,
  operatorPlanJobReceipt,
  operatorPersistedTopicCountReceipt,
  operatorTerminalPlanReceipt,
} from "../convex/lib/operatorSnapshot.ts";
import { PLAN_CANDIDATE_CHECKPOINT_VERSION } from
  "../convex/lib/planCandidateCheckpoint.ts";
import { AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD } from
  "../convex/lib/planProviderBudget.ts";

const autopilot = readFileSync("convex/autopilot.ts", "utf8");
const operatorProjection = readFileSync(
  "convex/lib/operatorSnapshot.ts",
  "utf8",
);
const schema = readFileSync("convex/schema.ts", "utf8");

test("operator plan receipts are bounded before projection", () => {
  assert.equal(OPERATOR_PLAN_RECEIPT_LIMIT, 8);
  assert.equal(OPERATOR_PLAN_CHECKPOINT_READ_LIMIT, 2);
  assert.match(
    schema,
    /\.index\("by_site_type_status_created", \[[\s\S]*"siteId",[\s\S]*"type",[\s\S]*"status",[\s\S]*"createdAt",[\s\S]*\]\)/,
  );
  const start = autopilot.indexOf("export const getOperatorSnapshot");
  const end = autopilot.indexOf("export const getFleetReadiness", start);
  const snapshot = autopilot.slice(start, end);
  assert.match(
    snapshot,
    /by_site_type_status_created[\s\S]*eq\("status", "done"\)[\s\S]*\.take\(OPERATOR_PLAN_RECEIPT_LIMIT\)/,
  );
  assert.match(
    snapshot,
    /by_site_type_status_created[\s\S]*eq\("status", "failed"\)[\s\S]*\.take\(OPERATOR_PLAN_RECEIPT_LIMIT\)/,
  );
  assert.match(snapshot, /latestTerminalPlanJobs\(donePlanJobs, failedPlanJobs\)/);
  assert.match(snapshot, /by_plan_job[\s\S]*\.take\(OPERATOR_PLAN_CHECKPOINT_READ_LIMIT\)/);
  assert.match(snapshot, /operatorTerminalPlanReceipt/);
  assert.match(operatorProjection, /checkpoint\.userId === args\.siteUserId/);
  assert.match(operatorProjection, /args\.reservation\.userId === args\.siteUserId/);
  assert.match(operatorProjection, /args\.reservation\.purpose === "topic_plan"/);
  assert.doesNotMatch(snapshot, /domain: site\.domain/);
  assert.doesNotMatch(snapshot, /detail: run\.detail/);
  assert.doesNotMatch(snapshot, /title: article\.title/);
  assert.doesNotMatch(snapshot, /error: job\.error/);
  assert.doesNotMatch(snapshot, /stepProgress: job\.stepProgress/);
});

test("latest terminal plan merge is globally bounded and deterministic", () => {
  const done = Array.from({ length: 8 }, (_, index) => ({
    id: `done-${index}`,
    createdAt: index * 2,
    _creationTime: index * 2,
  }));
  const failed = Array.from({ length: 8 }, (_, index) => ({
    id: `failed-${index}`,
    createdAt: index * 2 + 1,
    _creationTime: index * 2 + 1,
  }));
  const latest = latestTerminalPlanJobs(done, failed);
  assert.equal(latest.length, 8);
  assert.deepEqual(
    latest.map((row) => row.createdAt),
    [15, 14, 13, 12, 11, 10, 9, 8],
  );
});

test("the entire snapshot projection excludes credentials, free-form content, identities, and raw provider ledger data", () => {
  const secretValues = [
    "payload-secret",
    "worker-secret",
    "tenant-user",
    "provider-body",
    "claim-secret",
    "seed-secret",
  ];
  const job = operatorPlanJobReceipt({
    _id: "job-1",
    status: "failed",
    createdAt: 10,
    updatedAt: 20,
    nextAttemptAt: 30,
    heartbeatAt: 15,
    leaseExpiresAt: 25,
    workerAttempts: 1,
    cadenceFailure: {
      version: 1,
      category: "terminal_invariant",
      code: "verified_zero_yield",
      retryable: false,
      terminal: true,
      eligibleAt: undefined,
      recordedAt: 20,
    },
    payload: { secret: secretValues[0] },
    workerToken: secretValues[1],
    result: { body: secretValues[3] },
    error: secretValues[3],
  } as never, "current");
  const checkpointDoc = {
    _id: "checkpoint-1",
    siteId: "site-1",
    planJobId: "job-1",
    providerSpendReservationId: "reservation-1",
    workerExecution: 1,
    policyVersion: PLAN_CANDIDATE_CHECKPOINT_VERSION,
    rolloutEpoch: 7,
    requiredVerifiedYield: 2,
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "2026-08-25",
    status: "terminal_blocked",
    activationScheduledAt: 11,
    completedAt: 12,
    activatedAt: undefined,
    createdAt: 10,
    updatedAt: 12,
    candidateTopicIds: ["topic-1", "topic-2"],
    candidateFingerprints: ["fingerprint-1", "fingerprint-2"],
    inlineCompletedTopicIds: ["topic-1"],
    activatedTopicIds: [],
    terminallyExcludedTopicIds: ["topic-2"],
    userId: secretValues[2],
    seedBatches: [[secretValues[5]]],
  } as never;
  const checkpoint = operatorPlanCheckpointReceipt(checkpointDoc);
  const reservationDoc = {
    _id: "reservation-1",
    siteId: "site-1",
    purpose: "topic_plan",
    trigger: "topic_plan",
    reservedMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "2026-08-25",
    createdAt: 10,
    releasedAt: 40,
    releaseReason: "provider_balance_insufficient",
    userId: secretValues[2],
  } as never;
  const run = operatorContinuationRunReceipt({
    _id: "run-1",
    recoveryOfRunId: "run-0",
    jobId: "job-1",
    status: "failed",
    outcome: "job_failed",
    scheduledAt: 1,
    startedAt: 2,
    heartbeatAt: 3,
    completedAt: 4,
    continuationAttempt: 2,
    topicPlanSettlementAttempt: 3,
    claimNonce: secretValues[4],
    detail: secretValues[3],
  } as never);
  const health = operatorHealthReceipt({
    status: "run_failed",
    heartbeatAt: 4,
    updatedAt: 5,
    detail: secretValues[3],
  } as never);
  const article = operatorArticleReceipt({
    articleId: "article-1",
    status: "ready",
    title: secretValues[3],
    articleCreatedAt: 1,
    articleUpdatedAt: 2,
  } as never, true);
  const activeJob = operatorActiveJobReceipt({
    _id: "active-job",
    type: "article",
    status: "running",
    createdAt: 1,
    updatedAt: 2,
    error: secretValues[3],
    workerToken: secretValues[1],
    stepProgress: {
      current: 1,
      total: 2,
      stepLabel: secretValues[3],
      topicLabel: secretValues[5],
    },
  } as never);
  const terminal = operatorTerminalPlanReceipt({
    siteId: "site-1" as never,
    siteUserId: secretValues[2],
    job: {
      _id: "job-1",
      status: "failed",
      createdAt: 10,
      updatedAt: 20,
      workerAttempts: 1,
      rolloutEpoch: 7,
      providerSpendReservationId: "reservation-1",
      providerCostCeilingMicroUsd:
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservedMicroUsd:
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservationDay: "2026-08-25",
      providerReservationReleasedAt: 40,
      providerReservationReleaseReason: "provider_balance_insufficient",
      payload: {
        secret: secretValues[0],
        reason: "topic_buffer_replenishment",
        planCheckpointModeVersion: 1,
        planYieldTarget: {
          version: 1,
          targetBufferShortfall: 2,
          verifiedHorizonShortfall: 2,
          articleQuotaHeadroom: 2,
          requiredVerifiedYield: 2,
        },
      },
    } as never,
    domainBinding: "current",
    expectedReservationTrigger: "topic_plan",
    checkpoints: [checkpointDoc],
    reservation: reservationDoc,
  });
  const serialized = JSON.stringify({
    job,
    checkpoint,
    run,
    health,
    article,
    activeJob,
    terminal,
  });
  for (const secret of secretValues) assert.doesNotMatch(serialized, new RegExp(secret));
  assert.deepEqual(job.cadenceFailure, {
    category: "terminal_invariant",
    code: "verified_zero_yield",
    eligibleAt: undefined,
    terminal: true,
  });
  assert.equal(checkpoint.candidateCount, 2);
  assert.equal(checkpoint.inlineCompletedCount, 1);
  assert.equal(checkpoint.activatedCount, 0);
  assert.equal(checkpoint.excludedCount, 1);
  assert.equal(run.continuationAttempt, 2);
  assert.equal(run.topicPlanSettlementAttempt, 3);
  assert.equal(run.trigger, "recovery");
  assert.equal(terminal.checkpointState, "single");
  assert.equal(
    terminal.providerReservationState,
    "released_before_paid_work",
  );
  const forbiddenKeys = new Set([
    "payload",
    "result",
    "error",
    "workerToken",
    "userId",
    "domain",
    "canonicalDomain",
    "detail",
    "title",
    "topicLabel",
    "stepLabel",
    "seedBatches",
    "candidateTopicIds",
    "providerSpendReservationId",
    "reservedMicroUsd",
    "releaseReason",
  ]);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `forbidden key: ${key}`);
      visit(nested);
    }
  };
  visit({ job, checkpoint, run, health, article, activeJob, terminal });
});

test("corrupt tenant bindings and multiple checkpoints expose no counts or ledger fields", () => {
  const job = {
    _id: "job-1",
    status: "failed",
    createdAt: 10,
    updatedAt: 20,
    workerAttempts: 1,
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservationDay: "2026-08-25",
  } as never;
  const checkpoint = {
    _id: "checkpoint-1",
    siteId: "foreign-site",
    userId: "foreign-user",
    planJobId: "job-1",
    providerSpendReservationId: "reservation-1",
    status: "activated",
    candidateTopicIds: ["secret-topic"],
    activatedTopicIds: ["secret-topic"],
    createdAt: 10,
    updatedAt: 20,
  } as never;
  const reservation = {
    _id: "reservation-1",
    siteId: "foreign-site",
    userId: "foreign-user",
    purpose: "topic_plan",
    trigger: "topic_plan",
    reservedMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "2026-08-25",
    createdAt: 10,
  } as never;
  const corrupt = operatorTerminalPlanReceipt({
    siteId: "site-1" as never,
    siteUserId: "owner-1",
    job,
    domainBinding: "current",
    expectedReservationTrigger: "topic_plan",
    checkpoints: [checkpoint],
    reservation,
  });
  assert.equal(corrupt.checkpointState, "multiple_or_invalid");
  assert.equal(corrupt.checkpoint, undefined);
  assert.equal(corrupt.providerReservationState, "invalid");
  const multiple = operatorTerminalPlanReceipt({
    siteId: "site-1" as never,
    siteUserId: "owner-1",
    job,
    domainBinding: "current",
    expectedReservationTrigger: "topic_plan",
    checkpoints: [checkpoint, checkpoint],
    reservation: null,
  });
  assert.equal(multiple.checkpointState, "multiple_or_invalid");
  assert.equal(multiple.checkpoint, undefined);
});

test("terminal checkpoint states expose only bounded yield counts", () => {
  const base = {
    _id: "checkpoint-1",
    siteId: "site-1",
    userId: "owner-1",
    planJobId: "job-1",
    workerExecution: 1,
    policyVersion: PLAN_CANDIDATE_CHECKPOINT_VERSION,
    rolloutEpoch: 4,
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "2026-08-25",
    requiredVerifiedYield: 2,
    candidateTopicIds: ["topic-1", "topic-2"],
    candidateFingerprints: ["fingerprint-1", "fingerprint-2"],
    createdAt: 10,
    updatedAt: 20,
  };
  const expected = [
    {
      status: "inline_completed",
      inlineCompletedTopicIds: ["topic-1"],
      usable: 1,
    },
    {
      status: "activated",
      activatedTopicIds: ["topic-1", "topic-2"],
      usable: 2,
    },
    { status: "empty", usable: 0 },
    {
      status: "terminal_blocked",
      terminallyExcludedTopicIds: ["topic-1", "topic-2"],
      usable: 0,
    },
  ] as const;
  for (const row of expected) {
    const projected = operatorPlanCheckpointReceipt({
      ...base,
      ...row,
    } as never);
    assert.equal(projected.status, row.status);
    assert.equal(projected.workerExecution, 1);
    assert.equal(projected.requiredVerifiedYield, 2);
    assert.equal(projected.candidateCount, 2);
    assert.equal(projected.usableTopicCount, row.usable);
  }
});

test("checkpoint result counts require bounded duplicate-free candidate subsets", () => {
  const candidateIds = ["topic-1", "topic-2"];
  assert.equal(
    operatorCheckpointIdsAreBoundedUniqueSubset(
      candidateIds,
      ["topic-1"],
    ),
    true,
  );
  assert.equal(
    operatorCheckpointIdsAreBoundedUniqueSubset(
      candidateIds,
      ["topic-1", "topic-1"],
    ),
    false,
  );
  assert.equal(
    operatorCheckpointIdsAreBoundedUniqueSubset(
      candidateIds,
      ["foreign-topic"],
    ),
    false,
  );
  assert.equal(
    operatorCheckpointIdsAreBoundedUniqueSubset(
      ["topic-1", "topic-1"],
      ["topic-1"],
    ),
    false,
  );

  const job = {
    _id: "job-1",
    status: "done",
    createdAt: 10,
    updatedAt: 20,
    workerAttempts: 1,
    rolloutEpoch: 4,
    result: {
      count: 1,
      planPersistenceCommit: { version: 1, cumulativeTopicCount: 1 },
    },
    payload: {
      reason: "topic_buffer_replenishment",
      planCheckpointModeVersion: 1,
      planYieldTarget: {
        version: 1,
        targetBufferShortfall: 2,
        verifiedHorizonShortfall: 2,
        articleQuotaHeadroom: 2,
        requiredVerifiedYield: 2,
      },
    },
  } as never;
  const baseCheckpoint = {
    _id: "checkpoint-1",
    siteId: "site-1",
    userId: "owner-1",
    planJobId: "job-1",
    workerExecution: 1,
    policyVersion: PLAN_CANDIDATE_CHECKPOINT_VERSION,
    rolloutEpoch: 4,
    requiredVerifiedYield: 2,
    status: "inline_completed",
    candidateTopicIds: candidateIds,
    candidateFingerprints: ["fingerprint-1", "fingerprint-2"],
    inlineCompletedTopicIds: ["topic-1"],
    activatedTopicIds: [],
    terminallyExcludedTopicIds: ["topic-2"],
    createdAt: 10,
    updatedAt: 20,
  };
  for (const corruptArrays of [
    { inlineCompletedTopicIds: ["topic-1", "topic-1"] },
    { activatedTopicIds: ["foreign-topic"] },
    { terminallyExcludedTopicIds: ["topic-2", "topic-2"] },
  ]) {
    const receipt = operatorTerminalPlanReceipt({
      siteId: "site-1" as never,
      siteUserId: "owner-1",
      job,
      domainBinding: "current",
      expectedReservationTrigger: "topic_plan",
      checkpoints: [{ ...baseCheckpoint, ...corruptArrays } as never],
      reservation: null,
    });
    assert.equal(receipt.checkpointState, "multiple_or_invalid");
    assert.equal(receipt.checkpoint, undefined);
  }
});

test("terminal checkpoint acceptance binds status, terminal time, and persisted count to its job", () => {
  const baseJob = {
    _id: "job-1",
    createdAt: 10,
    updatedAt: 20,
    workerAttempts: 1,
    rolloutEpoch: 4,
    payload: {
      reason: "topic_buffer_replenishment",
      planCheckpointModeVersion: 1,
      planYieldTarget: {
        version: 1,
        targetBufferShortfall: 2,
        verifiedHorizonShortfall: 2,
        articleQuotaHeadroom: 2,
        requiredVerifiedYield: 2,
      },
    },
  };
  const baseCheckpoint = {
    _id: "checkpoint-1",
    siteId: "site-1",
    userId: "owner-1",
    planJobId: "job-1",
    workerExecution: 1,
    policyVersion: PLAN_CANDIDATE_CHECKPOINT_VERSION,
    rolloutEpoch: 4,
    requiredVerifiedYield: 2,
    candidateTopicIds: ["topic-1", "topic-2"],
    candidateFingerprints: ["fingerprint-1", "fingerprint-2"],
    createdAt: 10,
    updatedAt: 20,
  };
  const cases = [
    {
      jobStatus: "done",
      jobResult: { count: 1 },
      checkpoint: {
        status: "inline_completed",
        inlineCompletedTopicIds: ["topic-1"],
        completedAt: 20,
      },
    },
    {
      jobStatus: "failed",
      checkpoint: { status: "activated", activatedAt: 20 },
    },
    {
      jobStatus: "failed",
      checkpoint: { status: "empty", completedAt: 20 },
    },
    {
      jobStatus: "failed",
      checkpoint: { status: "terminal_blocked", activatedAt: 20 },
    },
  ] as const;
  for (const row of cases) {
    const receipt = operatorTerminalPlanReceipt({
      siteId: "site-1" as never,
      siteUserId: "owner-1",
      job: {
        ...baseJob,
        status: row.jobStatus,
        result: "jobResult" in row ? row.jobResult : undefined,
      } as never,
      domainBinding: "current",
      expectedReservationTrigger: "topic_plan",
      checkpoints: [{ ...baseCheckpoint, ...row.checkpoint } as never],
      reservation: null,
    });
    assert.equal(receipt.checkpointState, "single", row.checkpoint.status);
  }

  for (const row of [
    {
      jobStatus: "failed",
      checkpoint: { status: "inline_completed", completedAt: 20 },
    },
    { jobStatus: "done", checkpoint: { status: "activated", activatedAt: 20 } },
    { jobStatus: "failed", checkpoint: { status: "empty" } },
    { jobStatus: "failed", checkpoint: { status: "terminal_blocked" } },
  ]) {
    const receipt = operatorTerminalPlanReceipt({
      siteId: "site-1" as never,
      siteUserId: "owner-1",
      job: { ...baseJob, status: row.jobStatus } as never,
      domainBinding: "current",
      expectedReservationTrigger: "topic_plan",
      checkpoints: [{ ...baseCheckpoint, ...row.checkpoint } as never],
      reservation: null,
    });
    assert.equal(receipt.checkpointState, "multiple_or_invalid");
  }
});

test("persisted plan counts and reservation release state are strictly derived", () => {
  assert.deepEqual(
    operatorPersistedTopicCountReceipt({
      result: {
        count: 3,
        planPersistenceCommit: { version: 1, cumulativeTopicCount: 3 },
      },
    } as never),
    { persistedTopicCountState: "recorded", persistedTopicCount: 3 },
  );
  assert.deepEqual(
    operatorPersistedTopicCountReceipt({ result: { count: 11 } } as never),
    { persistedTopicCountState: "invalid" },
  );
  assert.deepEqual(
    operatorPersistedTopicCountReceipt({
      result: {
        count: 2,
        planPersistenceCommit: { version: 1, cumulativeTopicCount: 1 },
      },
    } as never),
    { persistedTopicCountState: "invalid" },
  );

  const job = {
    _id: "job-1",
    status: "failed",
    createdAt: 10,
    updatedAt: 20,
    workerAttempts: 1,
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservationDay: "2026-08-25",
  };
  const reservation = {
    _id: "reservation-1",
    siteId: "site-1",
    userId: "owner-1",
    purpose: "topic_plan",
    trigger: "topic_plan",
    reservedMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "2026-08-25",
    createdAt: 10,
  };
  const project = (
    jobPatch: Record<string, unknown>,
    reservationPatch: Record<string, unknown>,
  ) => operatorTerminalPlanReceipt({
    siteId: "site-1" as never,
    siteUserId: "owner-1",
    job: { ...job, ...jobPatch } as never,
    domainBinding: "current",
    expectedReservationTrigger: "topic_plan",
    checkpoints: [],
    reservation: { ...reservation, ...reservationPatch } as never,
  }).providerReservationState;
  assert.equal(project({}, {}), "retained_no_replay");
  assert.equal(
    project(
      {
        providerReservationReleasedAt: 30,
        providerReservationReleaseReason: "provider_balance_insufficient",
      },
      { releasedAt: 30, releaseReason: "provider_balance_insufficient" },
    ),
    "released_before_paid_work",
  );
  assert.equal(project(
    { providerReservationReleasedAt: 30 },
    { releasedAt: 30 },
  ), "invalid");
  assert.equal(project(
    { providerReservationReleaseReason: "provider_balance_insufficient" },
    { releaseReason: "provider_balance_insufficient" },
  ), "invalid");
  assert.equal(
    project({}, { _id: "reservation-foreign" }),
    "invalid",
  );
});

test("run triggers are classified without exposing raw trigger strings", () => {
  const base = {
    _id: "run-1",
    status: "completed",
    scheduledAt: 1,
    heartbeatAt: 2,
  };
  assert.equal(
    operatorContinuationRunReceipt({ ...base, trigger: "natural" } as never)
      .trigger,
    "natural",
  );
  assert.equal(
    operatorContinuationRunReceipt({
      ...base,
      trigger: "topic_plan_cooldown",
    } as never).trigger,
    "cooldown",
  );
  assert.equal(
    operatorContinuationRunReceipt({
      ...base,
      trigger: "public_url_verified",
      recoveryOfRunId: "run-0",
    } as never).trigger,
    "recovery",
  );
  assert.equal(
    operatorContinuationRunReceipt({
      ...base,
      trigger: "provider-secret-trigger",
    } as never).trigger,
    "followup",
  );
});
