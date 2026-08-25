import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES,
  AUTOMATIC_PLAN_MINIMUM_VERIFIED_YIELD,
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  AUTOMATIC_PLAN_PROVIDER_DAILY_CEILING_MICRO_USD,
  AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
  UNDERFILLED_PLAN_CONTINUATION_RECOVERY_VERSION,
  automaticPlanAllowanceForArticleHeadroom,
  atomicPlanPersistenceCumulativeCount,
  automaticPlanYieldTarget,
  automaticPlanYieldTargetFromPayload,
  classifyPlanFailure,
  countsTowardTopicPlanRecentLimit,
  evaluateAutomaticPlanContinuation,
  evaluatePlanProviderReservationCapacity,
  planRetryUsesCurrentReservationDay,
  topicPlanProviderReservationTriggerFromPayload,
} from "../convex/lib/planProviderBudget.ts";

test("atomic plan receipts retain exact execution and cumulative counts", () => {
  assert.equal(atomicPlanPersistenceCumulativeCount({
    workerExecution: 1,
    acceptedTopicCount: 5,
  }), 5);
  assert.equal(atomicPlanPersistenceCumulativeCount({
    workerExecution: 2,
    acceptedTopicCount: 4,
  }), 4, "a transient retry has no prior accepted output");
  assert.equal(atomicPlanPersistenceCumulativeCount({
    workerExecution: 2,
    acceptedTopicCount: 2,
    continuation: {
      version: 1,
      firstExecutionCount: 5,
      remainingTopicCapacity: 5,
    },
  }), 7);
  assert.equal(atomicPlanPersistenceCumulativeCount({
    workerExecution: 2,
    acceptedTopicCount: 6,
    continuation: {
      version: 1,
      firstExecutionCount: 5,
      remainingTopicCapacity: 5,
    },
  }), null);
  assert.equal(atomicPlanPersistenceCumulativeCount({
    workerExecution: 3,
    acceptedTopicCount: 1,
  }), null);
});

test("plan reservation triggers bind ordinary and migration payloads exactly", () => {
  assert.equal(topicPlanProviderReservationTriggerFromPayload(undefined),
    "topic_plan");
  assert.equal(topicPlanProviderReservationTriggerFromPayload({
    reason: "topic_horizon_replenishment",
  }), "topic_plan");
  assert.equal(topicPlanProviderReservationTriggerFromPayload({
    expectedClickPlanMigrationVersion: 1,
  }), "expected_click_plan_migration_v1");
  assert.equal(topicPlanProviderReservationTriggerFromPayload({
    expectedClickPlanMigrationVersion: "1",
  }), "topic_plan");
});

test("automatic plan reservation covers at most two provider executions", () => {
  assert.equal(AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD, 1_000_000);
  assert.equal(AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES, 1);
  assert.equal(AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD, 2_000_000);
  assert.equal(
    AUTOMATIC_PLAN_PROVIDER_DAILY_CEILING_MICRO_USD,
    AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  );
});

test("one successful underfilled plan can consume only its reserved second execution", () => {
  const reservationDay = "2026-08-23";
  const executionAt = Date.UTC(2026, 7, 23, 12);
  assert.equal(AUTOMATIC_PLAN_MINIMUM_VERIFIED_YIELD, 7);
  assert.equal(UNDERFILLED_PLAN_CONTINUATION_RECOVERY_VERSION, 1);
  assert.deepEqual(
    evaluateAutomaticPlanContinuation({
      automaticTopicPlan: true,
      savedTopicCount: 1,
      requiredVerifiedYield: 7,
      workerAttempts: 0,
      continuationAlreadyQueued: false,
      reservationDay,
      executionAt,
    }),
    { allowed: true, remainingTopicCapacity: 6, workerExecution: 2 },
  );
  assert.deepEqual(
    evaluateAutomaticPlanContinuation({
      automaticTopicPlan: true,
      savedTopicCount: 6,
      requiredVerifiedYield: 7,
      workerAttempts: 0,
      continuationAlreadyQueued: false,
      reservationDay,
      executionAt,
    }),
    { allowed: true, remainingTopicCapacity: 1, workerExecution: 2 },
  );
  assert.deepEqual(
    evaluateAutomaticPlanContinuation({
      automaticTopicPlan: true,
      savedTopicCount: 1,
      requiredVerifiedYield: 3,
      workerAttempts: 0,
      continuationAlreadyQueued: false,
      reservationDay,
      executionAt,
    }),
    { allowed: true, remainingTopicCapacity: 2, workerExecution: 2 },
  );
});

test("continuation never makes failure, retry, manual work, or stale budget free", () => {
  const base = {
    automaticTopicPlan: true,
    savedTopicCount: 1,
    requiredVerifiedYield: 7,
    workerAttempts: 0,
    continuationAlreadyQueued: false,
    reservationDay: "2026-08-23",
    executionAt: Date.UTC(2026, 7, 23, 12),
  };
  assert.deepEqual(
    evaluateAutomaticPlanContinuation({ ...base, savedTopicCount: 0 }),
    { allowed: false, reason: "first_execution_not_successful" },
  );
  assert.deepEqual(
    evaluateAutomaticPlanContinuation({ ...base, savedTopicCount: 7 }),
    { allowed: false, reason: "verified_yield_sufficient" },
  );
  assert.deepEqual(
    evaluateAutomaticPlanContinuation({ ...base, workerAttempts: 1 }),
    { allowed: false, reason: "execution_allowance_consumed" },
  );
  assert.deepEqual(
    evaluateAutomaticPlanContinuation({
      ...base,
      continuationAlreadyQueued: true,
    }),
    { allowed: false, reason: "continuation_already_queued" },
  );
  assert.deepEqual(
    evaluateAutomaticPlanContinuation({
      ...base,
      automaticTopicPlan: false,
    }),
    { allowed: false, reason: "not_automatic_topic_plan" },
  );
  assert.deepEqual(
    evaluateAutomaticPlanContinuation({
      ...base,
      executionAt: Date.UTC(2026, 7, 24),
    }),
    { allowed: false, reason: "reservation_day_expired" },
  );
});

test("queue-time yield target is horizon-aware, quota-capped, and immutable", () => {
  assert.deepEqual(automaticPlanYieldTarget({
    targetBufferShortfall: 2,
    verifiedHorizonShortfall: 6,
    articleQuotaHeadroom: 8,
  }), {
    version: 1,
    targetBufferShortfall: 2,
    verifiedHorizonShortfall: 6,
    articleQuotaHeadroom: 8,
    requiredVerifiedYield: 6,
  });
  assert.equal(automaticPlanYieldTarget({
    targetBufferShortfall: 0,
    verifiedHorizonShortfall: 0,
    articleQuotaHeadroom: 10,
  }).requiredVerifiedYield, 0);
  assert.equal(automaticPlanYieldTarget({
    targetBufferShortfall: 3,
    verifiedHorizonShortfall: 7,
    articleQuotaHeadroom: 2,
  }).requiredVerifiedYield, 2);

  const payload = {
    reason: "topic_horizon_replenishment",
    planYieldTarget: automaticPlanYieldTarget({
      targetBufferShortfall: 3,
      verifiedHorizonShortfall: 7,
      articleQuotaHeadroom: 10,
    }),
  };
  assert.deepEqual(
    automaticPlanYieldTargetFromPayload(payload),
    payload.planYieldTarget,
  );
  assert.equal(automaticPlanYieldTargetFromPayload({
    ...payload,
    manual: true,
  }), null);
  assert.equal(automaticPlanYieldTargetFromPayload({
    ...payload,
    planYieldTarget: {
      ...payload.planYieldTarget,
      requiredVerifiedYield: 10,
    },
  }), null);
});

test("paid plan allowance cannot exceed remaining ten-topic article headroom", () => {
  assert.equal(automaticPlanAllowanceForArticleHeadroom(0), 0);
  assert.equal(automaticPlanAllowanceForArticleHeadroom(-1), 0);
  assert.equal(automaticPlanAllowanceForArticleHeadroom(Number.NaN), 0);
  assert.equal(automaticPlanAllowanceForArticleHeadroom(1), 1);
  assert.equal(automaticPlanAllowanceForArticleHeadroom(10), 1);
  assert.equal(automaticPlanAllowanceForArticleHeadroom(11), 2);
  assert.equal(automaticPlanAllowanceForArticleHeadroom(25), 3);
});

test("a free tenant gets one reserved plan and repeated customer clicks fail closed", () => {
  const first = evaluatePlanProviderReservationCapacity({
    remainingArticles: 3,
    budgetedPlansThisMonth: 0,
    reservedTodayMicroUsd: 0,
  });
  assert.deepEqual(first, { allowed: true, monthlyPlanAllowance: 1 });

  const repeated = evaluatePlanProviderReservationCapacity({
    remainingArticles: 3,
    budgetedPlansThisMonth: 1,
    reservedTodayMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  });
  assert.deepEqual(repeated, {
    allowed: false,
    reason: "plan_headroom_exhausted",
    monthlyPlanAllowance: 1,
  });
});

test("deterministic planner exhaustion is terminal", () => {
  const deterministic = [
    "Verified discovery returned no measured, authority-attainable keyword",
    "No topic retained five fresh page-one authority measurements",
    "Verified planning produced no new scheduler-eligible topics",
    "Expected-click evidence requires a fresh tenant authority measurement",
    "Budgeted plan provider reservation is missing or invalid",
    "Paid plan retry crossed its UTC reservation day",
  ];
  for (const message of deterministic) {
    assert.deepEqual(classifyPlanFailure(message), {
      retryable: false,
      category: "terminal_planner",
    });
  }
});

test("only explicit provider transport, throttling, and 5xx failures retry", () => {
  const transient = [
    "DataForSEO API error (HTTP 429)",
    "DataForSEO API error (HTTP 503)",
    "fetch failed",
    "request timed out",
    "ECONNRESET",
    "service unavailable",
  ];
  for (const message of transient) {
    assert.deepEqual(classifyPlanFailure(message), {
      retryable: true,
      category: "transient_provider",
    });
  }
  assert.equal(classifyPlanFailure("DataForSEO task error 40501").retryable, false);
  assert.equal(classifyPlanFailure("Worker lease lost").retryable, false);
});

test("a transient retry cannot spend after its UTC reservation day", () => {
  assert.equal(
    planRetryUsesCurrentReservationDay(
      "2026-08-20",
      Date.UTC(2026, 7, 20, 23, 59, 59),
    ),
    true,
  );
  assert.equal(
    planRetryUsesCurrentReservationDay(
      "2026-08-20",
      Date.UTC(2026, 7, 21, 0, 0, 0),
    ),
    false,
  );
  assert.equal(
    planRetryUsesCurrentReservationDay(undefined, Date.UTC(2026, 7, 20)),
    false,
  );
});

test("a proven zero-spend pre-provider exit does not consume recovery cadence", () => {
  assert.equal(
    countsTowardTopicPlanRecentLimit({
      type: "plan",
      providerReservationReleasedAt: 1_000,
      providerReservationReleaseReason: "provider_balance_insufficient",
    }),
    false,
  );
  assert.equal(
    countsTowardTopicPlanRecentLimit({
      type: "plan",
      providerReservationReleasedAt: 1_000,
      providerReservationReleaseReason:
        "provider_balance_preflight_unavailable",
    }),
    false,
  );
  assert.equal(
    countsTowardTopicPlanRecentLimit({
      type: "plan",
      providerReservationReleasedAt: 1_000,
      providerReservationReleaseReason:
        "one_setup_planning_context_superseded_before_execution",
    }),
    false,
  );
  assert.equal(
    countsTowardTopicPlanRecentLimit({ type: "plan" }),
    true,
  );
  assert.equal(
    countsTowardTopicPlanRecentLimit({
      type: "plan",
      providerReservationReleasedAt: 1_000,
      providerReservationReleaseReason: "ambiguous_provider_state",
    }),
    true,
  );
  assert.equal(countsTowardTopicPlanRecentLimit({ type: "article" }), false);
});

test("automatic queue and worker enforce entitlement, headroom, reservation, and terminal policy", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const planJobs = readFileSync("convex/planJobs.ts", "utf8");
  const underfillRecovery = readFileSync(
    "convex/actions/underfilledPlanRecovery.ts",
    "utf8",
  );
  const reservation = readFileSync(
    "convex/lib/planProviderReservation.ts",
    "utf8",
  );
  const schema = readFileSync("convex/schema.ts", "utf8");

  assert.match(jobs, /reservePlanProviderBudget\(ctx, site, timestamp\)/);
  assert.doesNotMatch(jobs, /operatorBudgetBypass/);
  assert.match(jobs, /providerCostReservedMicroUsd/);
  assert.match(jobs, /AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES/);
  assert.match(jobs, /countsTowardTopicPlanRecentLimit\(job\)/);
  assert.match(jobs, /continueSuccessfulUnderfilledPlan/);
  assert.match(jobs, /authorizeUnderfilledPlanContinuationExecution/);
  assert.match(jobs, /recoverCompletedUnderfilledPlanContinuation/);
  assert.match(jobs, /underfilledPlanContinuation/);
  assert.match(jobs, /outstandingArticleJobs/);
  assert.match(
    jobs,
    /maximumArticles - activeUsage\.length - outstandingArticleJobs/,
  );
  assert.match(jobs, /workerAttempts: 1/);
  assert.match(jobs, /Plan worker lease expired after provider work may have started/);
  assert.match(jobs, /plan_spend_ambiguous/);
  assert.match(
    jobs,
    /isUnderfilledPlanContinuationPayload\(job\.payload\)/,
  );
  assert.match(jobs, /trigger: "underfilled_plan_settled"/);

  const balanceAbort = jobs.slice(
    jobs.indexOf("export const abortPlanForProviderBalance"),
    jobs.indexOf("export const queuePublicationIfAbsent"),
  );
  assert.match(balanceAbort, /reservation\.userId === site\.userId/);
  assert.match(
    balanceAbort,
    /topicPlanProviderReservationTriggerFromPayload\(payload\)/,
  );
  assert.ok((balanceAbort.match(/AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD/g) ?? [])
    .length >= 3);
  assert.match(
    balanceAbort,
    /expectedClickPlanMigrationReservedAt === job\.createdAt/,
  );

  assert.match(pipeline, /Budgeted plan provider reservation is missing or invalid/);
  assert.match(pipeline, /Paid plan execution crossed its UTC reservation day/);
  assert.match(pipeline, /planRetryUsesCurrentReservationDay/);
  assert.match(pipeline, /classifyPlanFailure\(message\)/);
  assert.ok(
    pipeline.indexOf("classification.retryable") <
      pipeline.indexOf("internal.jobs.markRetryableFailure"),
  );
  assert.match(pipeline, /payload\?\.replenishmentSequence \?\? 0/);
  assert.match(pipeline, /underfilledContinuation \? 1 : 0/);
  assert.match(pipeline, /underfilledContinuation\?\.remainingTopicCapacity/);
  assert.match(
    pipeline,
    /authorizeUnderfilledPlanContinuationExecution/,
  );
  assert.match(
    pipeline,
    /AUTOMATIC_PLAN_TOPIC_CAPACITY -[\s\S]{0,120}underfilledContinuation\.firstExecutionCount/,
  );
  assert.match(pipeline, /\(job\.workerAttempts \?\? 0\) !== 1/);
  assert.match(pipeline, /cumulativeCount/);
  assert.match(
    pipeline,
    /Checkpoint plan is missing its immutable verified-yield target;[\s\S]*refusing provider work/,
  );
  assert.match(
    pipeline,
    /reason: "owner_requested_plan",[\s\S]*manual: true/,
  );

  assert.match(planJobs, /reservePlanProviderBudget\(ctx, site, timestamp\)/);
  assert.match(planJobs, /providerCostCeilingMicroUsd/);
  assert.match(planJobs, /providerCostReservedMicroUsd/);
  assert.match(underfillRecovery, /internalAction/);
  assert.match(underfillRecovery, /if \(!args\.apply\)/);
  assert.match(underfillRecovery, /preview\.eligible !== true/);
  assert.match(underfillRecovery, /assertDataForSeoAccountBalance/);
  assert.match(
    underfillRecovery,
    /internal\.jobs\.recoverCompletedUnderfilledPlanContinuation/,
  );
  assert.match(reservation, /activeArticleUsageForMonth/);
  assert.match(reservation, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(reservation, /account_plan_entitlements/);
  assert.match(
    reservation,
    /entitlement\?\.planFeatures \?\? site\.planFeatures/,
  );
  assert.match(reservation, /cadenceFitsMonthlyLimit/);
  assert.match(
    reservation,
    /q\.eq\(q\.field\("deletionStatus"\), undefined\)/,
  );
  assert.match(reservation, /article_quota_no_headroom/);
  assert.match(reservation, /plan_headroom_exhausted/);
  assert.match(reservation, /provider_daily_budget_reserved/);
  assert.match(reservation, /isBudgetedPlanJob/);
  assert.match(
    reservation,
    /Every historical plan execution is counted conservatively/,
  );
  assert.match(reservation, /evaluatePlanProviderReservationCapacity/);

  assert.match(schema, /providerCostCeilingMicroUsd/);
  assert.match(schema, /providerCostReservedMicroUsd/);
  assert.match(schema, /providerCostReservationDay/);

  const continuation = jobs.slice(
    jobs.indexOf("export const continueSuccessfulUnderfilledPlan"),
    jobs.indexOf("export const markDone"),
  );
  assert.match(continuation, /providerSpendReservationId/);
  assert.match(continuation, /reservation\.releasedAt !== undefined/);
  assert.match(continuation, /remainingTopicCapacity/);
  assert.match(continuation, /accountHasArticleHeadroom/);
  assert.doesNotMatch(
    continuation,
    /reservePlanProviderBudget|reserveSharedProviderBudget|ctx\.db\.insert\("jobs"/,
  );
  const executionAuthorization = jobs.slice(
    jobs.indexOf(
      "export const authorizeUnderfilledPlanContinuationExecution",
    ),
    jobs.indexOf(
      "export const recoverCompletedUnderfilledPlanContinuation",
    ),
  );
  assert.match(executionAuthorization, /ownsJob\(job, args\.workerToken\)/);
  assert.match(executionAuthorization, /\(job\.workerAttempts \?\? 0\) !== 1/);
  assert.match(
    executionAuthorization,
    /isUnderfilledPlanContinuationPayload\(job\.payload\)/,
  );
  assert.match(executionAuthorization, /accountHasArticleHeadroom/);
  assert.match(executionAuthorization, /article_quota_no_headroom/);
  assert.match(executionAuthorization, /planRetryUsesCurrentReservationDay/);
  assert.doesNotMatch(
    executionAuthorization,
    /workerAttempts:\s*0|reservePlanProviderBudget|reserveSharedProviderBudget|ctx\.db\.insert/,
  );
  const paidBoundary = pipeline.slice(
    pipeline.indexOf("if (job.type === \"plan\")"),
    pipeline.indexOf("if (job.type === \"links\")"),
  );
  assert.ok(
    paidBoundary.indexOf("automaticSingleExecutionCheckpointTargetFromPayload") <
      paidBoundary.indexOf("assertDataForSeoAccountBalance"),
    "checkpoint target validation precedes every paid provider boundary",
  );
  assert.ok(
    paidBoundary.indexOf("authorizeUnderfilledPlanContinuationExecution") <
      paidBoundary.indexOf("assertDataForSeoAccountBalance"),
    "the continuation rechecks quota before the provider wallet boundary",
  );
  assert.ok(
    paidBoundary.indexOf("assertDataForSeoAccountBalance") <
      paidBoundary.indexOf("handlePlan"),
    "the wallet preflight remains before any paid planning work",
  );
  const completedRecovery = jobs.slice(
    jobs.indexOf("export const recoverCompletedUnderfilledPlanContinuation"),
    jobs.indexOf("export const markDone"),
  );
  assert.match(completedRecovery, /apply: v\.boolean\(\)/);
  assert.match(completedRecovery, /job\.status !== "done"/);
  assert.match(completedRecovery, /providerBudget\.workerExecution !== 1/);
  assert.match(completedRecovery, /reason: "active_job"/);
  assert.match(completedRecovery, /reason: "newer_plan"/);
  assert.match(completedRecovery, /reason: "already_applied"/);
  assert.match(completedRecovery, /recoveryVersion: args\.recoveryVersion/);
  assert.doesNotMatch(
    completedRecovery,
    /reservePlanProviderBudget|reserveSharedProviderBudget|ctx\.db\.insert\("jobs"/,
  );
});

test("no operator or internal plan path can bypass the shared provider reservation", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const reservation = readFileSync(
    "convex/lib/planProviderReservation.ts",
    "utf8",
  );

  for (const source of [jobs, pipeline, reservation]) {
    assert.doesNotMatch(source, /operatorBudgetBypass/);
  }
  const queue = jobs.slice(
    jobs.indexOf("export const queuePlanIfAbsent"),
    jobs.indexOf("export const queuePublicationIfAbsent"),
  );
  const worker = pipeline.slice(
    pipeline.indexOf("function assertPlanProviderReservation"),
    pipeline.indexOf("const TopicSchema"),
  );
  assert.match(queue, /reservePlanProviderBudget\(ctx, site, timestamp\)/);
  assert.match(worker, /providerCostReservedMicroUsd/);
  assert.match(worker, /providerReservationReleasedAt/);
  assert.match(worker, /refusing paid discovery/);
});

test("deleting tenants cannot queue or reserve paid topic-plan work", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const planJobs = readFileSync("convex/planJobs.ts", "utf8");

  const publicQueue = planJobs.slice(
    planJobs.indexOf("export const queuePlanGeneration"),
  );
  assert.match(publicQueue, /site\.deletionStatus/);
  assert.ok(
    publicQueue.indexOf("site.deletionStatus") <
      publicQueue.indexOf("reservePlanProviderBudget(ctx, site, timestamp)"),
    "the public queue must fence deletion before reserving provider spend",
  );

  const internalQueue = jobs.slice(
    jobs.indexOf("export const queuePlanIfAbsent"),
    jobs.indexOf("export const queuePublicationIfAbsent"),
  );
  assert.match(internalQueue, /siteExecutionActive\(site\)/);
  assert.ok(
    internalQueue.indexOf("siteExecutionActive(site)") <
      internalQueue.indexOf("reservePlanProviderBudget(ctx, site, timestamp)"),
    "the internal queue must fence deletion before reserving provider spend",
  );
});
