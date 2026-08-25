import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS,
  TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS,
  topicPlanSettlementDecision,
} from "../convex/lib/planProviderBudget.ts";
import {
  classifyCadenceFailure,
  deriveCadenceRecoveryStrategy,
} from "../convex/lib/cadenceLiveness.ts";

test("a slow live plan remains observed past the continuation lease and then settles failed", () => {
  const continuationLease = TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS;
  const live = topicPlanSettlementDecision({
    receiptState: "claimed",
    currentSettlementAttempt: 1,
    expectedSettlementAttempt: 1,
    jobStatus: "running",
    leaseExpiresAt: continuationLease * 4,
    now: continuationLease * 2,
  });
  assert.deepEqual(live, { decision: "wait", settlementAttempt: 2 });

  const terminal = topicPlanSettlementDecision({
    receiptState: "claimed",
    currentSettlementAttempt: 2,
    expectedSettlementAttempt: 2,
    jobStatus: "failed",
    now: continuationLease * 3,
  });
  assert.deepEqual(terminal, { decision: "terminal_failed" });
});

test("done, ambiguous, exhausted, and stale settlement receipts fail closed", () => {
  assert.deepEqual(topicPlanSettlementDecision({
    receiptState: "claimed",
    currentSettlementAttempt: 4,
    expectedSettlementAttempt: 4,
    jobStatus: "done",
    now: 10_000,
  }), { decision: "terminal_done" });
  assert.deepEqual(topicPlanSettlementDecision({
    receiptState: "claimed",
    currentSettlementAttempt: 5,
    expectedSettlementAttempt: 5,
    jobStatus: "running",
    leaseExpiresAt: 9_999,
    now: 10_000,
  }), { decision: "ambiguous", reason: "lease_expired" });
  assert.deepEqual(topicPlanSettlementDecision({
    receiptState: "claimed",
    currentSettlementAttempt: TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS,
    expectedSettlementAttempt: TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS,
    jobStatus: "pending",
    now: 10_000,
  }), { decision: "ambiguous", reason: "monitor_exhausted" });
  assert.deepEqual(topicPlanSettlementDecision({
    receiptState: "claimed",
    currentSettlementAttempt: TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS,
    expectedSettlementAttempt: TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS,
    jobStatus: "failed",
    now: 10_000,
  }), { decision: "terminal_failed" });
  assert.deepEqual(topicPlanSettlementDecision({
    receiptState: "claimed",
    currentSettlementAttempt: TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS + 1,
    expectedSettlementAttempt: TOPIC_PLAN_SETTLEMENT_MAX_ATTEMPTS + 1,
    jobStatus: "failed",
    now: 10_000,
  }), {
    decision: "ambiguous",
    reason: "terminal_finalizer_exhausted",
  });
  assert.deepEqual(topicPlanSettlementDecision({
    receiptState: "claimed",
    currentSettlementAttempt: 6,
    expectedSettlementAttempt: 5,
    jobStatus: "failed",
    now: 10_000,
  }), { decision: "fence_changed" });
  assert.deepEqual(topicPlanSettlementDecision({
    receiptState: "settled",
    currentSettlementAttempt: 6,
    expectedSettlementAttempt: 6,
    jobStatus: "failed",
    now: 10_000,
  }), { decision: "already_settled" });
});

test("binding atomically owns worker dispatch and terminal observation", () => {
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const arm = autopilot.slice(
    autopilot.indexOf("export const armTopicPlanCooldownJobSettlement"),
    autopilot.indexOf("export const inspectTopicPlanCooldownJobSettlement"),
  );
  const runPatch = arm.indexOf("jobId: args.jobId");
  const worker = arm.indexOf("internal.actions.pipeline.processNextJob");
  const observer = arm.indexOf("internal.autopilot.settleTopicPlanCooldownJob");
  assert.ok(runPatch >= 0 && runPatch < worker && worker < observer);
  assert.match(arm, /run!\.jobId !== undefined/);
  assert.match(arm, /different_job_already_bound/);
  assert.match(arm, /job\.createdAt >= args\.dueAt/);
  assert.match(arm, /planCheckpointModeVersion/);
  assert.match(arm, /providerReservationReleasedAt === undefined/);
  assert.doesNotMatch(arm, /DataForSEO|providerCall|reservePlanProviderBudget/);

  const watcher = autopilot.slice(
    autopilot.indexOf("export const settleTopicPlanCooldownJob"),
    autopilot.indexOf("export const recoverTopicPlanCooldownContinuation"),
  );
  assert.match(watcher, /topicPlanSettlementDecision/);
  assert.match(watcher, /internal\.autopilot\.markRunFinished/);
  assert.match(watcher, /decision\.decision === "ambiguous"/);
  assert.match(watcher, /status: "failed"/);
  assert.match(watcher, /status: "run_failed"/);
  assert.match(watcher, /replayed: false as const/);
  assert.doesNotMatch(watcher, /internal\.autopilot\.markRunFailed/);
  assert.doesNotMatch(
    watcher,
    /processNextJob|reservePlanProviderBudget|DataForSEO|providerCall/,
  );
  const genericFailure = autopilot.slice(
    autopilot.indexOf("export const markRunFailed"),
    autopilot.indexOf("export const raiseAlert"),
  );
  assert.match(genericFailure, /bound_job_terminal_settlement_owned/);
  assert.match(
    genericFailure,
    /\["pending", "running", "done", "failed"\]\.includes/,
  );
  const finish = autopilot.slice(
    autopilot.indexOf("export const markRunFinished"),
    autopilot.indexOf("export const markRunFailed"),
  );
  assert.match(finish, /args\.jobId !== run\.jobId/);
  assert.match(finish, /!\["done", "failed"\]\.includes\(boundJob\.status\)/);
  assert.match(finish, /bound_job_settlement_owned/);
  const parked = finish.slice(
    finish.indexOf("if (!runSite ||"),
    finish.indexOf("await ctx.db.patch(args.runId, {", finish.indexOf("if (!runSite ||")) +
      1_200,
  );
  assert.match(parked, /status: "failed"/);
  assert.match(parked, /status: "run_failed"/);
  assert.match(parked, /await upsertHealth/);
  assert.match(parked, /await setAlert/);
  assert.match(parked, /lastNaturalCompletedAt/);
});

test("action death before binding is recoverable without replaying a live bound job", () => {
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const watchdog = autopilot.slice(
    autopilot.indexOf("export const recoverTopicPlanCooldownContinuation"),
    autopilot.indexOf("export const markRunStarted"),
  );
  assert.ok(
    watchdog.indexOf("if (run.jobId !== undefined)") <
      watchdog.indexOf("topicPlanCooldownWatchdogDecision"),
  );
  assert.match(watchdog, /bound_job_settlement_owned/);
  assert.match(watchdog, /const continuationAttempt = decision\.continuationAttempt/);

  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  assert.match(scheduler, /const activePlanJob = siteJobs\.find/);
  assert.match(
    scheduler,
    /mode: "pending_plan"[\s\S]*planJobId: activePlanJob\._id/,
  );
  assert.match(
    scheduler,
    /mode: "work_in_progress"[\s\S]*planJobId: activePlanJob\._id/,
  );
  assert.match(
    scheduler,
    /topic_replenishment_exhausted[\s\S]*planJobId: replenishment\.cooldownPlanJobId/,
  );
  assert.match(
    scheduler,
    /mode: "work_in_progress"[\s\S]*planJobId: replenishment\.jobId/,
  );
  assert.match(
    scheduler,
    /mode: "topic_replenishment"[\s\S]*planJobId: replenishment\.jobId/,
  );

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const tick = pipeline.slice(
    pipeline.indexOf("export const autopilotTick"),
    pipeline.indexOf("export const processSpecificJob"),
  );
  assert.match(tick, /inspectTopicPlanCooldownJobSettlement/);
  assert.match(tick, /inspection\.state === "bound"/);
  assert.ok(
    tick.indexOf("armTopicPlanCooldownJobSettlement") <
      tick.indexOf("internal.actions.pipeline.processNextJob as any"),
  );
});

test("the observed production zero-yield phrase rotates only the next paid window", () => {
  const now = Date.UTC(2026, 7, 25, 15, 2, 17, 844);
  const message =
    "Terminal planner outcome (permanent): No topic survived live SERP evidence, tenant intent, cannibalization, and business-fit gates; refusing authority collection.";
  const failure = classifyCadenceFailure({ message, now });
  assert.equal(failure.category, "semantic_zero_yield");
  assert.equal(failure.retryable, false);
  assert.equal(failure.terminal, true);

  const strategy = deriveCadenceRecoveryStrategy({
    recentPlans: [{
      status: "failed",
      error: message,
      cadenceFailure: failure,
      payload: { reason: "topic_evidence_replenishment" },
    }],
    targetBufferShortfall: 3,
    requiredVerifiedYield: 7,
  });
  assert.equal(strategy.stage, 1);
  assert.equal(strategy.sourceMode, "profile_gsc");
  assert.equal(strategy.intentMode, "commercial");

  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const terminal = jobs.slice(
    jobs.indexOf("export const markFailed"),
    jobs.indexOf("export const markRetryableFailure"),
  );
  assert.match(terminal, /semanticPlanEligibleAt/);
  assert.match(terminal, /topicPlanCooldownWakeAt\(job\.createdAt\)/);
  assert.match(terminal, /TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER/);
  assert.match(terminal, /internal\.autopilot\.claimTopicPlanCooldownWake/);
  assert.doesNotMatch(terminal, /status: "pending"|processNextJob/);
});
