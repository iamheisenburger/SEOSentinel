import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { schedulerWorkIsBound } from
  "../convex/lib/autopilotRunOutcome.ts";

const scheduler = readFileSync(
  new URL("../convex/actions/scheduler.ts", import.meta.url),
  "utf8",
);

test("work-in-progress requires an exact active job receipt", () => {
  assert.equal(
    schedulerWorkIsBound({ mode: "work_in_progress" }),
    false,
  );
  assert.equal(
    schedulerWorkIsBound({
      mode: "work_in_progress",
      activeJobId: "j_active" as never,
    }),
    true,
  );
  assert.equal(schedulerWorkIsBound({ mode: "planning_blocked" }), true);

  const workOutcomes = scheduler.match(/mode: "work_in_progress"/g) ?? [];
  const bindings = scheduler.match(/activeJobId:/g) ?? [];
  assert.ok(workOutcomes.length > 0);
  assert.equal(bindings.length, workOutcomes.length);
});

test("a settled one-shot recovery falls through to fresh inventory", () => {
  const recovery = scheduler.slice(
    scheduler.indexOf("if (recoverable)"),
    scheduler.indexOf("const mechanicallyRecoverable"),
  );
  assert.match(recovery, /if \(recovery\.queued\)/);
  assert.match(recovery, /if \(recovery\.jobId\)/);
  assert.doesNotMatch(
    recovery,
    /mode: recovery\.queued \? "quality_revision" : "work_in_progress"/,
  );
});

test("terminal inventory settles before candidate or paid planning gates", () => {
  const terminalDecision = scheduler.indexOf(
    "const terminalOpportunity = inventoryAudit.opportunityDecisions.find",
  );
  const terminalOutcome = scheduler.indexOf(
    'mode: "opportunity_space_exhausted"',
  );
  const candidateBudget = scheduler.indexOf("const candidateBudget");
  const queuePlan = scheduler.indexOf(
    "internal.jobs.queuePlanIfAbsent",
    candidateBudget,
  );
  assert.ok(terminalDecision >= 0);
  assert.ok(terminalOutcome > terminalDecision);
  assert.ok(terminalOutcome < candidateBudget);
  assert.ok(terminalOutcome < queuePlan);
});

test("queue denials without jobs are explicit blockers, never fake work", () => {
  assert.match(scheduler, /mode: "planning_blocked"/);
  assert.match(scheduler, /mode: "topic_admission_blocked"/);
  assert.match(scheduler, /unclassified_plan_queue_denial/);
  assert.match(scheduler, /unclassified_topic_queue_denial/);

  const pipeline = readFileSync(
    new URL("../convex/actions/pipeline.ts", import.meta.url),
    "utf8",
  );
  assert.match(pipeline, /schedulerWorkIsBound\(cadenceSchedule\)/);
  assert.match(pipeline, /"scheduler_state_conflict"/);
});

test("the bounded operator view exposes the exact terminal receipt", () => {
  const autopilot = readFileSync(
    new URL("../convex/autopilot.ts", import.meta.url),
    "utf8",
  );
  const operator = autopilot.slice(
    autopilot.indexOf("export const getOperatorSnapshot"),
    autopilot.indexOf("export const getFleetReadiness"),
  );
  assert.match(operator, /__forward_opportunity_space__/);
  assert.match(operator, /terminalOpportunity: latestTerminalOpportunity/);
  assert.match(operator, /automaticWakeAt:/);
  assert.doesNotMatch(operator, /reasonCodes:/);
});
