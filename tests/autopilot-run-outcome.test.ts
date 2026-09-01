import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTOPILOT_OPERATOR_HEALTH_STATUSES,
  AUTOPILOT_OPERATOR_RUN_OUTCOMES,
  classifyAutopilotRunOutcome,
  JOB_RUN_OUTCOME_HEALTH,
  SCHEDULER_RUN_OUTCOME_HEALTH,
} from "../convex/lib/autopilotRunOutcome.ts";

test("every declared scheduler outcome has an explicit health decision", () => {
  for (const outcome of Object.keys(SCHEDULER_RUN_OUTCOME_HEALTH)) {
    assert.equal(
      classifyAutopilotRunOutcome({ outcome, approvedBufferCount: 0 })
        .recognized,
      true,
      `${outcome} must be classified`,
    );
  }
});

test("runtime and operator projections share one exhaustive outcome contract", () => {
  for (const outcome of [
    ...Object.keys(SCHEDULER_RUN_OUTCOME_HEALTH),
    ...Object.keys(JOB_RUN_OUTCOME_HEALTH),
  ]) {
    assert.equal(
      AUTOPILOT_OPERATOR_RUN_OUTCOMES.has(outcome),
      true,
      `${outcome} must remain visible to operators`,
    );
    for (const approvedBufferCount of [0, 1, 2]) {
      const classification = classifyAutopilotRunOutcome({
        outcome,
        approvedBufferCount,
      });
      assert.equal(classification.recognized, true);
      assert.equal(
        AUTOPILOT_OPERATOR_HEALTH_STATUSES.has(classification.status),
        true,
        `${classification.status} must remain visible to operators`,
      );
    }
  }
  const operator = readFileSync("convex/lib/operatorSnapshot.ts", "utf8");
  assert.match(operator, /AUTOPILOT_OPERATOR_RUN_OUTCOMES/);
  assert.match(operator, /AUTOPILOT_OPERATOR_HEALTH_STATUSES/);
  assert.doesNotMatch(operator, /const RUN_OUTCOMES =/);
  assert.doesNotMatch(operator, /const HEALTH_STATUSES =/);
});

test("cooldown and unknown nonprogress can never report healthy at zero buffer", () => {
  assert.deepEqual(
    classifyAutopilotRunOutcome({
      outcome: "cadence_failure_cooldown",
      approvedBufferCount: 0,
    }),
    {
      status: "cadence_failure_cooldown",
      recognized: true,
    },
  );
  const unknown = classifyAutopilotRunOutcome({
    outcome: "new_scheduler_mode_not_yet_classified",
    approvedBufferCount: 3,
  });
  assert.equal(unknown.recognized, false);
  assert.equal(unknown.status, "run_outcome_unclassified");
  assert.notEqual(unknown.status, "healthy");
});

test("a nominal buffer-full outcome still derives health from the real buffer", () => {
  assert.equal(
    classifyAutopilotRunOutcome({
      outcome: "buffer_full",
      approvedBufferCount: 0,
    }).status,
    "buffer_empty",
  );
  assert.equal(
    classifyAutopilotRunOutcome({
      outcome: "pending_plan",
      approvedBufferCount: 0,
    }).status,
    "recovering",
  );
});

test("runtime uses the exhaustive classifier and alerts on future unknown modes", () => {
  const autopilot = readFileSync("convex/autopilot.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(autopilot, /classifyAutopilotRunOutcome\(\{/);
  assert.match(autopilot, /run_outcome_unclassified/);
  assert.match(
    pipeline,
    /satisfies Record<SchedulerRunOutcome, string>/,
  );
});
