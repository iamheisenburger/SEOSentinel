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
import {
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  topicPlanCooldownWakeAt,
} from
  "../convex/lib/planProviderBudget.ts";
import {
  CADENCE_BALANCE_RECHECK_MS,
  CADENCE_PROVIDER_RECHECK_MS,
  nextUtcDayAt,
  nextUtcMonthAt,
} from "../convex/lib/cadenceLiveness.ts";

const autopilot = readFileSync("convex/autopilot.ts", "utf8");
const operatorProjection = readFileSync(
  "convex/lib/operatorSnapshot.ts",
  "utf8",
);
const schema = readFileSync("convex/schema.ts", "utf8");

function assertNoForbiddenStrings(
  value: unknown,
  forbidden: readonly string[],
): void {
  if (typeof value === "string") {
    for (const secret of forbidden) {
      assert.equal(
        value.includes(secret),
        false,
        `projected forbidden string: ${secret}`,
      );
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value)) {
    assertNoForbiddenStrings(nested, forbidden);
  }
}

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
    type: "plan",
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
      code: "terminal_planner_invariant",
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
    candidateCapacity: 2,
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "1970-01-01",
    status: "terminal_blocked",
    completedAt: 12,
    activatedAt: undefined,
    createdAt: 10,
    updatedAt: 12,
    candidateTopicIds: ["topic-1", "topic-2"],
    candidateFingerprints: ["fingerprint-1", "fingerprint-2"],
    inlineCompletedTopicIds: [],
    activatedTopicIds: [],
    terminallyExcludedTopicIds: ["topic-1", "topic-2"],
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
    reservationDay: "1970-01-01",
    reservationMonth: "1970-01",
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
      type: "plan",
      status: "failed",
      createdAt: 10,
      updatedAt: 12,
      workerAttempts: 0,
      rolloutEpoch: 7,
      providerSpendReservationId: "reservation-1",
      providerCostCeilingMicroUsd:
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservedMicroUsd:
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservationDay: "1970-01-01",
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
    code: "terminal_planner_invariant",
    eligibleAt: undefined,
    terminal: true,
  });
  assert.equal(checkpoint.candidateCount, 2);
  assert.equal(checkpoint.inlineCompletedCount, 0);
  assert.equal(checkpoint.activatedCount, 0);
  assert.equal(checkpoint.excludedCount, 2);
  assert.equal(run.continuationAttempt, 2);
  assert.equal(run.topicPlanSettlementAttempt, 3);
  assert.equal(run.trigger, "recovery");
  assert.equal(terminal.checkpointState, "single");
  assert.equal(
    terminal.providerReservationState,
    "invalid",
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
    workerAttempts: 0,
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservationDay: "1970-01-01",
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
    reservationDay: "1970-01-01",
    reservationMonth: "1970-01",
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
    candidateCapacity: 2,
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
    workerAttempts: 0,
    rolloutEpoch: 4,
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservationDay: "1970-01-01",
    result: {
      count: 1,
      planPersistenceCommit: { version: 1, cumulativeTopicCount: 1 },
      planCheckpointCommit: {
        version: 1,
        completionNonce: "completion-1",
        checkpointId: "checkpoint-1",
        workerExecution: 1,
        acceptedTopicIds: ["topic-1"],
        committedAt: 20,
      },
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
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "1970-01-01",
    requiredVerifiedYield: 2,
    candidateCapacity: 2,
    status: "inline_completed",
    inlineSuccessCommitNonce: "completion-1",
    candidateTopicIds: candidateIds,
    candidateFingerprints: ["fingerprint-1", "fingerprint-2"],
    inlineCompletedTopicIds: ["topic-1"],
    terminallyExcludedTopicIds: ["topic-2"],
    completedAt: 20,
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
    workerAttempts: 0,
    rolloutEpoch: 4,
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservationDay: "1970-01-01",
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
    candidateCapacity: 2,
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "1970-01-01",
    candidateTopicIds: ["topic-1", "topic-2"],
    candidateFingerprints: ["fingerprint-1", "fingerprint-2"],
    createdAt: 10,
    updatedAt: 20,
  };
  const inlineJobResult = {
    count: 1,
    planCheckpointCommit: {
      version: 1,
      completionNonce: "completion-1",
      checkpointId: "checkpoint-1",
      workerExecution: 1,
      acceptedTopicIds: ["topic-1"],
      committedAt: 20,
    },
  };
  const inlineCheckpoint = {
    status: "inline_completed",
    inlineSuccessCommitNonce: "completion-1",
    inlineCompletedTopicIds: ["topic-1"],
    terminallyExcludedTopicIds: ["topic-2"],
    completedAt: 20,
  };
  const cases = [
    {
      jobStatus: "done",
      workerAttempts: 0,
      jobResult: inlineJobResult,
      checkpoint: inlineCheckpoint,
    },
    {
      jobStatus: "failed",
      workerAttempts: 1,
      checkpoint: {
        status: "activated",
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-2"],
        activationScheduledAt: 20,
        activatedAt: 20,
      },
    },
    {
      jobStatus: "failed",
      workerAttempts: 0,
      checkpoint: {
        status: "terminal_blocked",
        inlineCompletedTopicIds: [],
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-1", "topic-2"],
        completedAt: 20,
      },
    },
    {
      jobStatus: "failed",
      workerAttempts: 0,
      checkpoint: {
        status: "empty",
        candidateTopicIds: [],
        candidateFingerprints: [],
        completedAt: 10,
        updatedAt: 10,
      },
    },
    {
      jobStatus: "failed",
      workerAttempts: 1,
      checkpoint: {
        status: "empty",
        candidateTopicIds: [],
        candidateFingerprints: [],
        completedAt: 10,
        updatedAt: 10,
      },
    },
    {
      jobStatus: "failed",
      workerAttempts: 1,
      checkpoint: {
        status: "terminal_blocked",
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-1", "topic-2"],
        activatedAt: 20,
      },
    },
  ] as const;
  for (const row of cases) {
    const receipt = operatorTerminalPlanReceipt({
      siteId: "site-1" as never,
      siteUserId: "owner-1",
      job: {
        ...baseJob,
        status: row.jobStatus,
        workerAttempts: row.workerAttempts,
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

  const project = (
    jobPatch: Record<string, unknown>,
    checkpointPatch: Record<string, unknown>,
  ) => operatorTerminalPlanReceipt({
    siteId: "site-1" as never,
    siteUserId: "owner-1",
    job: { ...baseJob, ...jobPatch } as never,
    domainBinding: "current",
    expectedReservationTrigger: "topic_plan",
    checkpoints: [{ ...baseCheckpoint, ...checkpointPatch } as never],
    reservation: null,
  });
  for (const contradiction of [
    {
      job: { status: "failed", workerAttempts: 2 },
      checkpoint: {
        status: "empty",
        candidateTopicIds: [],
        candidateFingerprints: [],
        completedAt: 10,
        updatedAt: 10,
      },
      label: "empty checkpoint after more than one terminal attempt",
    },
    {
      job: { status: "failed", workerAttempts: 0 },
      checkpoint: { status: "empty", completedAt: 10, updatedAt: 10 },
      label: "empty checkpoint with candidates",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: { status: "activated", activatedAt: 20 },
      label: "activated checkpoint without a result partition",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: {
        status: "activated",
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-1"],
        activatedAt: 20,
      },
      label: "activated checkpoint with an overlapping partition",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: {
        status: "terminal_blocked",
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-1"],
        activatedAt: 20,
      },
      label: "activation-blocked checkpoint with an incomplete partition",
    },
    {
      job: { status: "done", workerAttempts: 0, result: inlineJobResult },
      checkpoint: {
        status: "inline_completed",
        inlineSuccessCommitNonce: "completion-1",
        inlineCompletedTopicIds: ["topic-1"],
        completedAt: 20,
      },
      label: "inline checkpoint without an excluded partition",
    },
    {
      job: { status: "done", workerAttempts: 1, result: inlineJobResult },
      checkpoint: inlineCheckpoint,
      label: "inline checkpoint after a consumed worker attempt",
    },
    {
      job: { status: "done", workerAttempts: 0, result: inlineJobResult },
      checkpoint: { ...inlineCheckpoint, activatedTopicIds: [] },
      label: "inline checkpoint with an impossible activation array",
    },
    {
      job: { status: "done", workerAttempts: 0, result: inlineJobResult },
      checkpoint: { ...inlineCheckpoint, activationScheduledAt: 20 },
      label: "inline checkpoint with impossible activation scheduling metadata",
    },
    {
      job: {
        status: "done",
        workerAttempts: 0,
        result: inlineJobResult,
        updatedAt: 21,
      },
      checkpoint: inlineCheckpoint,
      label: "inline checkpoint terminal time older than the job",
    },
    {
      job: { status: "failed", workerAttempts: 0 },
      checkpoint: {
        status: "empty",
        candidateTopicIds: [],
        candidateFingerprints: [],
        inlineCompletedTopicIds: [],
        completedAt: 10,
        updatedAt: 10,
      },
      label: "empty checkpoint with a terminal result array",
    },
    {
      job: { status: "failed", workerAttempts: 0 },
      checkpoint: {
        status: "empty",
        candidateTopicIds: [],
        candidateFingerprints: [],
        inlineSuccessCommitNonce: "impossible",
        completedAt: 10,
        updatedAt: 10,
      },
      label: "empty checkpoint with impossible inline success metadata",
    },
    {
      job: { status: "failed", workerAttempts: 0 },
      checkpoint: {
        status: "empty",
        candidateTopicIds: [],
        candidateFingerprints: [],
        activationScheduledAt: 10,
        completedAt: 10,
        updatedAt: 10,
      },
      label: "empty checkpoint with impossible activation scheduling metadata",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: {
        status: "activated",
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-2"],
        activationScheduledAt: 20,
        completedAt: 20,
        activatedAt: 20,
      },
      label: "activated checkpoint with two terminal timestamps",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: {
        status: "activated",
        inlineCompletedTopicIds: [],
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-2"],
        activationScheduledAt: 20,
        activatedAt: 20,
      },
      label: "positive activation with an impossible inline result array",
    },
    {
      job: { status: "failed", workerAttempts: 1, updatedAt: 21 },
      checkpoint: {
        status: "activated",
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-2"],
        activationScheduledAt: 20,
        activatedAt: 20,
      },
      label: "activated checkpoint terminal time older than the job",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: {
        status: "activated",
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-2"],
        activatedAt: 20,
      },
      label: "positive activation missing its scheduling receipt",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: {
        status: "activated",
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-2"],
        activationScheduledAt: 19,
        activatedAt: 20,
      },
      label: "positive activation with inexact scheduling time",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: {
        status: "activated",
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-1", "topic-2"],
        activationScheduledAt: 20,
        activatedAt: 20,
      },
      label: "zero activation with impossible scheduling metadata",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: {
        status: "activated",
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-2"],
        activationScheduledAt: 20,
        inlineSuccessCommitNonce: "impossible",
        activatedAt: 20,
      },
      label: "activation with impossible inline success metadata",
    },
    {
      job: { status: "failed", workerAttempts: 1 },
      checkpoint: {
        status: "activated",
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-2"],
        activationScheduledAt: 20,
        activatedAt: 20,
        candidateFingerprints: ["fingerprint-1", "fingerprint-1"],
      },
      label: "duplicate candidate fingerprints",
    },
    {
      job: { status: "failed", workerAttempts: 0 },
      checkpoint: {
        status: "terminal_blocked",
        completedAt: -100,
        updatedAt: -100,
        terminallyExcludedTopicIds: ["topic-1"],
      },
      label: "terminal time before checkpoint creation",
    },
    {
      job: { status: "failed", workerAttempts: 0 },
      checkpoint: {
        status: "terminal_blocked",
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-1", "topic-2"],
        completedAt: 20,
      },
      label: "semantic terminal close missing its inline result array",
    },
    {
      job: { status: "failed", workerAttempts: 0, updatedAt: 21 },
      checkpoint: {
        status: "terminal_blocked",
        inlineCompletedTopicIds: [],
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-1", "topic-2"],
        completedAt: 20,
      },
      label: "semantic terminal close older than the job",
    },
    {
      job: { status: "failed", workerAttempts: 0 },
      checkpoint: {
        status: "terminal_blocked",
        inlineCompletedTopicIds: [],
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-1", "topic-2"],
        activationScheduledAt: 20,
        completedAt: 20,
      },
      label: "semantic terminal close with impossible scheduling metadata",
    },
    {
      job: { status: "failed", workerAttempts: 0 },
      checkpoint: {
        status: "terminal_blocked",
        inlineCompletedTopicIds: [],
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-1", "topic-2"],
        inlineSuccessCommitNonce: "impossible",
        completedAt: 20,
      },
      label: "semantic terminal close with impossible inline success metadata",
    },
  ]) {
    assert.equal(
      project(contradiction.job, contradiction.checkpoint).checkpointState,
      "multiple_or_invalid",
      contradiction.label,
    );
  }
  for (const candidateCapacity of [undefined, 0, 1, 3, 2.5]) {
    assert.equal(
      project(
        { status: "failed", workerAttempts: 1 },
        {
          status: "activated",
          activatedTopicIds: ["topic-1"],
          terminallyExcludedTopicIds: ["topic-2"],
          activationScheduledAt: 20,
          activatedAt: 20,
          candidateCapacity,
        },
      ).checkpointState,
      "multiple_or_invalid",
    );
  }
  const tenIds = Array.from({ length: 10 }, (_, index) => `topic-${index}`);
  assert.equal(
    project(
      {
        status: "done",
        workerAttempts: 0,
        result: {
          count: 10,
          planCheckpointCommit: {
            version: 1,
            completionNonce: "completion-10",
            checkpointId: "checkpoint-1",
            workerExecution: 1,
            acceptedTopicIds: tenIds,
            committedAt: 20,
          },
        },
      },
      {
        status: "inline_completed",
        inlineSuccessCommitNonce: "completion-10",
        completedAt: 20,
        candidateCapacity: 2,
        candidateTopicIds: tenIds,
        candidateFingerprints: tenIds.map((id) => `fingerprint-${id}`),
        inlineCompletedTopicIds: tenIds,
        activatedTopicIds: [],
        terminallyExcludedTopicIds: [],
      },
    ).checkpointState,
    "multiple_or_invalid",
  );
  assert.equal(
    project(
      { status: "failed", workerAttempts: 1, result: { count: 1 } },
      {
        status: "activated",
        activatedTopicIds: ["topic-1"],
        terminallyExcludedTopicIds: ["topic-2"],
        activationScheduledAt: 20,
        activatedAt: 20,
      },
    ).checkpointState,
    "multiple_or_invalid",
  );
  assert.equal(
    project(
      { status: "done", workerAttempts: 0, result: { count: 1 } },
      {
        status: "inline_completed",
        inlineSuccessCommitNonce: "completion-1",
        inlineCompletedTopicIds: ["topic-1"],
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-2"],
        completedAt: 20,
      },
    ).checkpointState,
    "multiple_or_invalid",
  );
  assert.equal(
    project(
      {
        status: "done",
        workerAttempts: 0,
        result: {
          count: 1,
          planCheckpointCommit: {
            version: 1,
            completionNonce: "wrong-completion",
            checkpointId: "checkpoint-1",
            workerExecution: 1,
            acceptedTopicIds: ["topic-1"],
            committedAt: 20,
          },
        },
      },
      {
        status: "inline_completed",
        inlineSuccessCommitNonce: "completion-1",
        inlineCompletedTopicIds: ["topic-1"],
        activatedTopicIds: [],
        terminallyExcludedTopicIds: ["topic-2"],
        completedAt: 20,
      },
    ).checkpointState,
    "multiple_or_invalid",
  );
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
    updatedAt: 30,
    workerAttempts: 0,
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservationDay: "1970-01-01",
  };
  const reservation = {
    _id: "reservation-1",
    siteId: "site-1",
    userId: "owner-1",
    purpose: "topic_plan",
    trigger: "topic_plan",
    reservedMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "1970-01-01",
    reservationMonth: "1970-01",
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
  assert.equal(
    project(
      {
        updatedAt: 20,
        providerReservationReleasedAt: 30,
        providerReservationReleaseReason: "provider_balance_insufficient",
      },
      { releasedAt: 30, releaseReason: "provider_balance_insufficient" },
    ),
    "invalid",
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
  assert.equal(project({}, { reservationDay: "1970-01-02" }), "invalid");
  assert.equal(project({}, { reservationMonth: "1970-02" }), "invalid");
});

test("released-before-paid-work rejects attempts, success, and validated checkpoints", () => {
  const releaseJobFields = {
    providerReservationReleasedAt: 30,
    providerReservationReleaseReason: "provider_balance_insufficient",
  };
  const reservation = {
    _id: "reservation-1",
    siteId: "site-1",
    userId: "owner-1",
    purpose: "topic_plan",
    trigger: "topic_plan",
    reservedMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    reservationDay: "1970-01-01",
    reservationMonth: "1970-01",
    createdAt: 10,
    releasedAt: 30,
    releaseReason: "provider_balance_insufficient",
  } as never;
  const job = {
    _id: "job-1",
    status: "failed",
    createdAt: 10,
    updatedAt: 30,
    workerAttempts: 0,
    rolloutEpoch: 4,
    providerSpendReservationId: "reservation-1",
    providerCostCeilingMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservedMicroUsd:
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
    providerCostReservationDay: "1970-01-01",
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
    ...releaseJobFields,
  };
  const project = (
    jobPatch: Record<string, unknown>,
    checkpoints: readonly Record<string, unknown>[] = [],
  ) => operatorTerminalPlanReceipt({
    siteId: "site-1" as never,
    siteUserId: "owner-1",
    job: { ...job, ...jobPatch } as never,
    domainBinding: "current",
    expectedReservationTrigger: "topic_plan",
    checkpoints: checkpoints as never,
    reservation,
  }).providerReservationState;

  assert.equal(project({ workerAttempts: 1 }), "invalid");
  assert.equal(project({ workerAttempts: undefined }), "invalid");
  assert.equal(project({ status: "done" }), "invalid");
  assert.equal(project({ result: { count: 0 } }), "invalid");
  assert.equal(
    project({ result: { planPersistenceCommit: { version: 1 } } }),
    "invalid",
  );

  const checkpoint = {
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
    candidateCapacity: 1,
    status: "terminal_blocked",
    completedAt: 29,
    candidateTopicIds: ["topic-1"],
    candidateFingerprints: ["fingerprint-1"],
    inlineCompletedTopicIds: [],
    activatedTopicIds: [],
    terminallyExcludedTopicIds: ["topic-1"],
    createdAt: 10,
    updatedAt: 29,
  };
  assert.equal(project({}, [checkpoint]), "invalid");
  assert.equal(project({}, [{ ...checkpoint, status: "active" }]), "invalid");
});

test("cadence failure projection accepts only exact terminal writer receipts", () => {
  const recordedAt = Date.UTC(2026, 7, 25, 12, 0, 0);
  const createdAt = recordedAt - 1_000;
  const automaticPayload = {
    reason: "topic_buffer_replenishment",
    planCheckpointModeVersion: 1,
    planYieldTarget: {
      version: 1,
      targetBufferShortfall: 1,
      verifiedHorizonShortfall: 1,
      articleQuotaHeadroom: 1,
      requiredVerifiedYield: 1,
    },
  };
  const baseJob = {
    _id: "job-cadence",
    type: "plan",
    status: "failed",
    createdAt,
    updatedAt: recordedAt,
    workerAttempts: 0,
  };
  const failure = (
    category: string,
    code: string,
    retryable: boolean,
    terminal: boolean,
    eligibleAt?: number,
  ) => ({
    version: 1,
    category,
    code,
    retryable,
    terminal,
    eligibleAt,
    recordedAt,
  });
  const recheckAt = recordedAt + CADENCE_PROVIDER_RECHECK_MS;
  const accepted = [
    {
      receipt: failure(
        "semantic_zero_yield",
        "strict_zero_yield",
        false,
        true,
      ),
      payload: { manual: true },
      error: "No topic survived live SERP evidence",
    },
    {
      receipt: failure(
        "semantic_zero_yield",
        "strict_zero_yield",
        false,
        true,
        topicPlanCooldownWakeAt(createdAt)!,
      ),
      payload: automaticPayload,
      error: "No topic survived live SERP evidence",
    },
    ...[
      "provider_preflight_unavailable",
      "provider_balance_preflight_unavailable",
      "transient_provider_failure",
      "one_setup_planning_context_superseded_before_execution",
    ].map((code) => ({
      receipt: failure(
        "transient_provider",
        code,
        true,
        false,
        recheckAt,
      ),
      error: code === "provider_balance_preflight_unavailable"
        ? "Provider account funding preflight blocked paid topic planning."
        : code === "one_setup_planning_context_superseded_before_execution"
          ? "The saved setup planning context changed before paid topic planning."
          : code === "provider_preflight_unavailable"
            ? "Provider preflight unavailable"
            : "network timeout",
    })),
    {
      receipt: failure(
        "transient_provider",
        "transient_provider_failure",
        false,
        true,
      ),
      workerAttempts: 1,
      error: "Worker failure exhausted after 1 attempts: network timeout",
    },
    {
      receipt: failure(
        "provider_funding",
        "provider_balance_insufficient",
        false,
        true,
        recordedAt + CADENCE_BALANCE_RECHECK_MS,
      ),
      error: "insufficient balance",
    },
    {
      receipt: failure(
        "provider_funding",
        "provider_balance_insufficient",
        false,
        true,
        recordedAt + CADENCE_BALANCE_RECHECK_MS,
      ),
      error: "Provider account funding preflight blocked paid topic planning.",
    },
    ...[
      "provider_reservation_day_expired",
      "plan_reservation_day_expired_before_execution",
    ].map((code) => ({
      receipt: failure(
        "budget_window",
        code,
        false,
        true,
        nextUtcDayAt(recordedAt)!,
      ),
      error: code === "plan_reservation_day_expired_before_execution"
        ? "The plan reservation expired before its first paid execution."
        : "reservation expired",
    })),
    {
      receipt: failure(
        "monthly_quota",
        "monthly_generation_quota",
        false,
        true,
        nextUtcMonthAt(recordedAt)!,
      ),
      error: "monthly generation quota",
    },
    {
      receipt: failure(
        "readiness",
        "tenant_readiness_blocked",
        false,
        true,
      ),
      error: "tenant readiness blocked",
    },
    {
      receipt: failure(
        "entitlement",
        "tenant_entitlement_blocked",
        false,
        true,
      ),
      error: "tenant entitlement blocked",
    },
    {
      receipt: failure(
        "terminal_invariant",
        "terminal_planner_invariant",
        false,
        true,
      ),
      error: "unrecognized permanent planner fault",
    },
  ];
  for (const row of accepted) {
    const projection = operatorPlanJobReceipt({
      ...baseJob,
      payload: "payload" in row ? row.payload : undefined,
      workerAttempts: "workerAttempts" in row
        ? row.workerAttempts
        : baseJob.workerAttempts,
      error: row.error,
      cadenceFailure: row.receipt,
    } as never, "current");
    assert.equal(
      projection.cadenceFailureState,
      "recorded",
      `${row.receipt.category}/${row.receipt.code}`,
    );
    assert.equal(projection.cadenceFailure?.category, row.receipt.category);
    assert.equal(projection.cadenceFailure?.code, row.receipt.code);
    assert.equal(projection.cadenceFailure?.terminal, row.receipt.terminal);
    assert.equal(
      projection.cadenceFailure?.eligibleAt,
      row.receipt.eligibleAt,
    );
  }

  const longPendingCreatedAt = recordedAt - (25 * 60 * 60 * 1_000);
  const elapsedSemanticCooldown = topicPlanCooldownWakeAt(
    longPendingCreatedAt,
  )!;
  assert.ok(elapsedSemanticCooldown < recordedAt);
  assert.equal(operatorPlanJobReceipt({
    ...baseJob,
    createdAt: longPendingCreatedAt,
    payload: automaticPayload,
    error: "No topic survived live SERP evidence",
    cadenceFailure: {
      ...failure(
        "semantic_zero_yield",
        "strict_zero_yield",
        false,
        true,
        elapsedSemanticCooldown,
      ),
    },
  } as never, "current").cadenceFailureState, "recorded");

  const funding = failure(
    "provider_funding",
    "provider_balance_insufficient",
    false,
    true,
    recordedAt + CADENCE_BALANCE_RECHECK_MS,
  );
  const project = (
    jobPatch: Record<string, unknown>,
    failurePatch: Record<string, unknown>,
  ) => operatorPlanJobReceipt({
    ...baseJob,
    error: "insufficient balance",
    ...jobPatch,
    cadenceFailure: { ...funding, ...failurePatch },
  } as never, "current").cadenceFailureState;
  for (const [jobPatch, failurePatch, label] of [
    [{ status: "done" }, {}, "done job"],
    [{ type: "article" }, {}, "non-plan job"],
    [{}, { version: 2 }, "wrong version"],
    [{}, { recordedAt: recordedAt - 1 }, "stale recordedAt"],
    [{}, { recordedAt: recordedAt + 1 }, "future recordedAt"],
    [{}, { code: "terminal_planner_invariant" }, "category/code mismatch"],
    [{}, { retryable: true }, "funding marked retryable"],
    [{}, { terminal: false }, "funding marked nonterminal"],
    [{}, { eligibleAt: undefined }, "missing funding deadline"],
    [{}, { eligibleAt: recordedAt }, "unordered funding deadline"],
    [{}, { eligibleAt: funding.eligibleAt! + 1 }, "inexact funding deadline"],
  ] as const) {
    assert.equal(project(jobPatch, failurePatch), "invalid", label);
  }

  const directTransient = failure(
    "transient_provider",
    "transient_provider_failure",
    true,
    false,
    recheckAt,
  );
  for (const patch of [
    { eligibleAt: undefined },
    { eligibleAt: recheckAt + 1 },
    { retryable: false },
    { terminal: true },
  ]) {
    assert.equal(operatorPlanJobReceipt({
      ...baseJob,
      error: "network timeout",
      cadenceFailure: { ...directTransient, ...patch },
    } as never, "current").cadenceFailureState, "invalid");
  }
  assert.equal(operatorPlanJobReceipt({
    ...baseJob,
    workerAttempts: 1,
    error: "Worker failure exhausted after 1 attempts: network timeout",
    cadenceFailure: {
      ...failure(
        "transient_provider",
        "transient_provider_failure",
        false,
        true,
      ),
      eligibleAt: recheckAt,
    },
  } as never, "current").cadenceFailureState, "invalid");
  for (const jobPatch of [
    {
      workerAttempts: 0,
      error: "Worker failure exhausted after 0 attempts: network timeout",
    },
    {
      workerAttempts: undefined,
      error: "Worker failure exhausted after undefined attempts: network timeout",
    },
    {
      workerAttempts: 1,
      error: "Worker failure exhausted after 2 attempts: network timeout",
    },
    {
      workerAttempts: 1,
      error: "Worker failure exhausted after 1 attempts: insufficient balance",
    },
  ]) {
    assert.equal(operatorPlanJobReceipt({
      ...baseJob,
      ...jobPatch,
      cadenceFailure: failure(
        "transient_provider",
        "transient_provider_failure",
        false,
        true,
      ),
    } as never, "current").cadenceFailureState, "invalid");
  }
  assert.equal(operatorPlanJobReceipt({
    ...baseJob,
    error: "No topic survived live SERP evidence",
    cadenceFailure: failure(
      "terminal_invariant",
      "terminal_planner_invariant",
      false,
      true,
    ),
  } as never, "current").cadenceFailureState, "invalid");
  assert.equal(operatorPlanJobReceipt({
    ...baseJob,
    error: "provider preflight unavailable",
    cadenceFailure: failure(
      "transient_provider",
      "provider_balance_preflight_unavailable",
      true,
      false,
      recheckAt,
    ),
  } as never, "current").cadenceFailureState, "invalid");
  assert.equal(operatorPlanJobReceipt({
    ...baseJob,
    payload: automaticPayload,
    error: "No topic survived live SERP evidence",
    cadenceFailure: failure(
      "semantic_zero_yield",
      "strict_zero_yield",
      false,
      true,
    ),
  } as never, "current").cadenceFailureState, "invalid");
  assert.equal(operatorPlanJobReceipt({
    ...baseJob,
    payload: { manual: true },
    error: "No topic survived live SERP evidence",
    cadenceFailure: failure(
      "semantic_zero_yield",
      "strict_zero_yield",
      false,
      true,
      topicPlanCooldownWakeAt(createdAt)!,
    ),
  } as never, "current").cadenceFailureState, "invalid");
  assert.throws(() => operatorPlanJobReceipt({
    ...baseJob,
    status: "pending",
    error: "insufficient balance",
    cadenceFailure: funding,
  } as never, "current"), /terminal job/);
});

test("credential-shaped values are never echoed by string projections", () => {
  const secrets = [
    `ghp_${"0123456789abcdefghijklmnopqrstuvwxyz"}`,
    "sk_test_0123456789abcdefghijklmnopqrstuvwxyz",
    "whsec_0123456789abcdefghijklmnopqrstuvwxyz",
  ];
  for (const secret of secrets) {
    const cadenceCategory = operatorPlanJobReceipt({
      _id: "job-category",
      status: "failed",
      createdAt: 1,
      updatedAt: 2,
      cadenceFailure: {
        version: 1,
        category: secret,
        code: "terminal_planner_invariant",
        retryable: false,
        terminal: true,
        recordedAt: 2,
      },
    } as never, "current");
    const cadenceCode = operatorPlanJobReceipt({
      _id: "job-code",
      status: "failed",
      createdAt: 1,
      updatedAt: 2,
      cadenceFailure: {
        version: 1,
        category: "terminal_invariant",
        code: secret,
        retryable: false,
        terminal: true,
        recordedAt: 2,
      },
    } as never, "current");
    const checkpoint = operatorPlanCheckpointReceipt({
      status: secret,
      workerExecution: 1,
      requiredVerifiedYield: 1,
      candidateCapacity: 1,
      candidateTopicIds: [],
      candidateFingerprints: [],
      createdAt: 1,
      updatedAt: 2,
    } as never);
    const run = operatorContinuationRunReceipt({
      _id: "run-1",
      trigger: secret,
      status: secret,
      outcome: secret,
      scheduledAt: 1,
      heartbeatAt: 2,
    } as never);
    const health = operatorHealthReceipt({
      status: secret,
      portfolioStatus: secret,
      portfolioDecision: secret,
      heartbeatAt: 1,
      updatedAt: 2,
    } as never);
    const article = operatorArticleReceipt({
      articleId: "article-1",
      status: secret,
      mediaQualityStatus: secret,
      publicationGateStatus: secret,
      articleCreatedAt: 1,
      articleUpdatedAt: 2,
    } as never, false);
    const activeJob = operatorActiveJobReceipt({
      _id: "active-job",
      type: secret,
      status: secret,
      createdAt: 1,
      updatedAt: 2,
    } as never);
    const projections = {
      cadenceCategory,
      cadenceCode,
      checkpoint,
      run,
      health,
      article,
      activeJob,
    };
    assertNoForbiddenStrings(projections, secrets);
    assert.equal(cadenceCategory.cadenceFailureState, "invalid");
    assert.equal(cadenceCode.cadenceFailureState, "invalid");
    assert.equal(checkpoint.status, "unclassified");
    assert.equal(run.trigger, "followup");
    assert.equal(run.status, "unclassified");
    assert.equal(run.outcome, "unclassified");
    assert.equal(health?.status, "unclassified");
    assert.equal(health?.portfolioStatus, "unclassified");
    assert.equal(health?.portfolioDecision, "unclassified");
    assert.equal(article.status, "unclassified");
    assert.equal(article.mediaQualityStatus, "unclassified");
    assert.equal(article.publicationGateStatus, "unclassified");
    assert.equal(activeJob.type, "unclassified");
    assert.equal(activeJob.status, "unclassified");
  }
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
