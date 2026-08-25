import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TOPIC_PLAN_COOLDOWN_WAKE_SAFETY_MS,
  TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
  TOPIC_PLAN_COOLDOWN_WINDOW_MS,
  TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS,
  TOPIC_PLAN_COOLDOWN_MAX_CONTINUATION_ATTEMPTS,
  TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT,
  evaluateBoundedRecentPlanWindow,
  topicPlanCooldownClaimNonce,
  topicPlanCooldownReceiptState,
  topicPlanCooldownTerminalWriteAllowed,
  topicPlanCooldownWatchdogDecision,
  topicPlanCooldownWakeAt,
} from "../convex/lib/planProviderBudget.ts";

test("topic-plan cooldown wake is strictly outside the inclusive 24-hour window", () => {
  const createdAt = Date.UTC(2026, 7, 24, 15, 0, 33, 592);
  assert.equal(TOPIC_PLAN_COOLDOWN_WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.equal(TOPIC_PLAN_COOLDOWN_WAKE_SAFETY_MS, 1_000);
  assert.equal(TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER, "topic_plan_cooldown");
  assert.equal(
    topicPlanCooldownWakeAt(createdAt),
    Date.UTC(2026, 7, 25, 15, 0, 34, 592),
  );
  assert.equal(topicPlanCooldownWakeAt(Number.NaN), null);
  assert.equal(topicPlanCooldownWakeAt(-1), null);
  assert.equal(TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT, 200);
  assert.equal(TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS, 60_000);
  assert.equal(TOPIC_PLAN_COOLDOWN_MAX_CONTINUATION_ATTEMPTS, 3);
  assert.equal(
    topicPlanCooldownClaimNonce({
      planJobId: "plan-1",
      rolloutEpoch: 7,
      dueAt: createdAt,
    }),
    `topic_plan_cooldown:plan-1:7:${createdAt}`,
  );
  assert.equal(topicPlanCooldownClaimNonce({
    planJobId: "plan-1",
    rolloutEpoch: -1,
    dueAt: createdAt,
  }), null);
});

test("truncated non-counting history cannot authorize another paid plan", () => {
  const rows = Array.from({ length: TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT + 1 },
    (_, index) => ({ counted: index === TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT }));
  const hiddenCounted = evaluateBoundedRecentPlanWindow({
    rows,
    maximumRecent: 1,
    isCounted: (row) => row.counted,
  });
  assert.equal(hiddenCounted.decision, "overflow");
  assert.equal(hiddenCounted.counted.length, 0);

  const provenLimit = evaluateBoundedRecentPlanWindow({
    rows: [{ counted: true }, ...rows],
    maximumRecent: 1,
    isCounted: (row) => row.counted,
  });
  assert.equal(provenLimit.decision, "limited");
  assert.equal(provenLimit.counted.length, 1);
});

test("an exact running claim is resumable after an ambiguous response", () => {
  const dueAt = Date.UTC(2026, 7, 25, 15, 0, 34, 592);
  const claimNonce = topicPlanCooldownClaimNonce({
    planJobId: "plan-1",
    rolloutEpoch: 7,
    dueAt,
  })!;
  const base = {
    siteId: "site-1",
    trigger: TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
    claimNonce,
    scheduledAt: dueAt,
  };
  const receipt = (status: string, suppliedNonce = claimNonce) =>
    topicPlanCooldownReceiptState({
      run: { ...base, status },
      siteId: "site-1",
      planJobId: "plan-1",
      rolloutEpoch: 7,
      dueAt,
      claimNonce: suppliedNonce,
    });
  assert.equal(receipt("scheduled"), "scheduled");
  assert.equal(receipt("running"), "claimed");
  assert.equal(receipt("completed"), "settled");
  assert.equal(receipt("running", `${claimNonce}:wrong`), "missing");
});

test("a committed claim with a dead action gets one bounded continuation generation", () => {
  const firstRecovery = topicPlanCooldownWatchdogDecision({
    receiptState: "claimed",
    currentAttempt: 1,
    expectedAttempt: 1,
    heartbeatAt: 1_000,
    now: 1_000 + TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS,
  });
  assert.deepEqual(firstRecovery, {
    decision: "recover",
    continuationAttempt: 2,
  });
  assert.deepEqual(topicPlanCooldownWatchdogDecision({
    receiptState: "claimed",
    currentAttempt: 2,
    expectedAttempt: 1,
    heartbeatAt: 1_000,
    now: 1_000 + TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS,
  }), { decision: "fence_changed" });
  assert.deepEqual(topicPlanCooldownWatchdogDecision({
    receiptState: "claimed",
    currentAttempt: TOPIC_PLAN_COOLDOWN_MAX_CONTINUATION_ATTEMPTS,
    expectedAttempt: TOPIC_PLAN_COOLDOWN_MAX_CONTINUATION_ATTEMPTS,
    heartbeatAt: 1_000,
    now: 1_000 + TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS,
  }), { decision: "exhausted" });
});

test("a stale watchdog generation cannot finish or fail the current run", () => {
  const current = {
    runClaimNonce: "nonce-1",
    runContinuationAttempt: 2,
    runStatus: "running",
  };
  assert.equal(topicPlanCooldownTerminalWriteAllowed({
    ...current,
    claimNonce: "nonce-1",
    continuationAttempt: 1,
  }), false);
  assert.equal(topicPlanCooldownTerminalWriteAllowed({
    ...current,
    claimNonce: "nonce-1",
    continuationAttempt: 2,
  }), true);
  assert.equal(topicPlanCooldownTerminalWriteAllowed({
    ...current,
    runStatus: "completed",
    claimNonce: "nonce-1",
    continuationAttempt: 2,
  }), false);
  assert.equal(topicPlanCooldownTerminalWriteAllowed({}), true);
});

test("recent-limit handling arms one exact tenant-generic durable wake", () => {
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const recentWindow = jobs.slice(
    jobs.indexOf("const recentRows = await ctx.db"),
    jobs.indexOf("const reservation = await reservePlanProviderBudget"),
  );
  const recentLimit = recentWindow.slice(
    recentWindow.indexOf('if (recentWindow.decision === "limited")'),
  );
  assert.match(recentLimit, /topicPlanCooldownWakeAt\(latestPlan\.createdAt\)/);
  assert.match(recentLimit, /by_site_scheduled/);
  assert.match(recentLimit, /TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER/);
  assert.match(recentLimit, /ctx\.scheduler\.runAt/);
  assert.match(recentLimit, /internal\.autopilot\.claimTopicPlanCooldownWake/);
  assert.match(recentWindow, /TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT \+ 1/);
  assert.match(recentWindow, /recent_history_overflow/);
  assert.match(recentLimit, /claimNonce/);
  assert.doesNotMatch(recentLimit, /leadpilot/i);
  assert.ok(
    recentLimit.indexOf("existingWake") < recentLimit.indexOf("ctx.db.insert"),
    "the durable run receipt must be deduplicated before insertion",
  );
  assert.match(
    recentLimit,
    /if \(existingWake\)[\s\S]*if \(existingWake\.claimNonce === claimNonce\)[\s\S]*else \{[\s\S]*ctx\.db\.insert/,
    "a conflicting exact-time receipt must fail closed instead of inserting a second wake",
  );
  assert.ok(
    jobs.indexOf("recent_history_overflow") <
      jobs.indexOf("const reservation = await reservePlanProviderBudget"),
    "truncated history must fail closed before provider reservation",
  );
});

test("cooldown execution is fenced before ordinary scheduler and paid work", () => {
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const scheduler = readFileSync("convex/actions/scheduler.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const claim = autopilot.slice(
    autopilot.indexOf("export const claimTopicPlanCooldownWake"),
    autopilot.indexOf("export const markRunStarted"),
  );
  assert.match(claim, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(claim, /autopilotRolloutEpoch/);
  assert.match(claim, /expectedDueAt !== args\.dueAt/);
  assert.match(claim, /latestCountedTopicPlan\?\._id !== args\.planJobId/);
  assert.match(claim, /TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT \+ 1/);
  assert.match(claim, /topicPlanCooldownReceiptState/);
  assert.match(claim, /receiptState === "claimed"/);
  assert.match(claim, /jobAuthorizedForExecution\(site, job\)/);
  assert.match(claim, /status: "running"/);
  assert.match(claim, /recoverTopicPlanCooldownContinuation/);
  assert.ok(
    claim.indexOf("status: \"running\"") <
      claim.indexOf("internal.actions.pipeline.autopilotTick"),
    "the claim transaction must atomically enqueue its continuation",
  );

  const inspection = autopilot.slice(
    autopilot.indexOf("export const inspectTopicPlanCooldownWakeClaim"),
    autopilot.indexOf("export const markRunStarted"),
  );
  assert.match(inspection, /topicPlanCooldownReceiptState/);
  assert.match(inspection, /"unclaimed" as const/);

  const tick = pipeline.slice(
    pipeline.indexOf("export const autopilotTick"),
    pipeline.indexOf("export const processSpecificJob"),
  );
  assert.ok(
    tick.indexOf("claimTopicPlanCooldownWake") <
      tick.indexOf("internal.actions.scheduler.scheduleCadence"),
    "the exact receipt fence must run before scheduler re-entry",
  );
  assert.match(tick, /inspectTopicPlanCooldownWakeClaim/);
  assert.match(tick, /inspection\.state !== "claimed"/);
  assert.match(tick, /runClaimNonce: topicPlanCooldown\.claimNonce/);
  assert.doesNotMatch(claim, /DataForSEO|handlePlan|providerCall/);
  assert.match(scheduler, /internal\.jobs\.queuePlanIfAbsent/);
  assert.match(jobs, /reservePlanProviderBudget\(ctx, site, timestamp\)/);
});

test("claim-committed action death has a bounded exactly-once watchdog", () => {
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const watchdog = autopilot.slice(
    autopilot.indexOf("export const recoverTopicPlanCooldownContinuation"),
    autopilot.indexOf("export const markRunStarted"),
  );
  assert.match(watchdog, /TOPIC_PLAN_COOLDOWN_MAX_CONTINUATION_ATTEMPTS/);
  assert.match(watchdog, /continuation_lease_live/);
  assert.match(watchdog, /recovery_exhausted/);
  assert.match(watchdog, /internal\.actions\.pipeline\.autopilotTick/);
  assert.match(watchdog, /expectedAttempt: continuationAttempt/);
  assert.doesNotMatch(watchdog, /reservePlanProviderBudget|DataForSEO|providerCall/);

  const terminal = autopilot.slice(
    autopilot.indexOf("export const markRunFinished"),
    autopilot.indexOf("export const raiseAlert"),
  );
  assert.match(terminal, /topicPlanCooldownTerminalWriteAllowed/g);
  assert.match(terminal, /stale_continuation/g);
});
