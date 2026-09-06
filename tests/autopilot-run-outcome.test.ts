import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTOPILOT_OPERATOR_HEALTH_STATUSES,
  AUTOPILOT_OPERATOR_RUN_OUTCOMES,
  classifyAutopilotRunOutcome,
  classifyProcessedJobOutcome,
  JOB_RUN_OUTCOME_HEALTH,
  SCHEDULER_RUN_OUTCOME_HEALTH,
} from "../convex/lib/autopilotRunOutcome.ts";
import { autopilotHealthStatus } from "../convex/lib/autopilotBuffer.ts";

test("durable provider pauses remain distinct from failed jobs and green buffer outcomes", () => {
  for (const failureKind of ["provider_funding_paused", "provider_allowance_paused"] as const) {
    const outcome = classifyProcessedJobOutcome({ processed: true, error: "unavailable", failureKind });
    assert.equal(outcome, failureKind);
    for (const approvedBufferCount of [0, 4, 12]) {
      assert.equal(classifyAutopilotRunOutcome({ outcome, approvedBufferCount }).status, failureKind);
      assert.equal(autopilotHealthStatus({ schedulerStale: false, publicationMissed: false,
        bufferCount: approvedBufferCount, lastOutcome: outcome }), failureKind);
    }
    assert.equal(classifyProcessedJobOutcome({ processed: false, error: "handoff lost", failureKind }), "job_failed");
    assert.equal(classifyProcessedJobOutcome({ processed: false, failureKind }), "claim_lost");
  }
  assert.equal(classifyProcessedJobOutcome({ processed: true, error: "busy", failureKind: "provider_capacity_deferred" }), "provider_capacity_deferred");
  assert.equal(classifyAutopilotRunOutcome({ outcome: "provider_capacity_deferred", approvedBufferCount: 12 }).status, "recovering");
  assert.equal(autopilotHealthStatus({ schedulerStale: false, publicationMissed: true,
    bufferCount: 12, lastOutcome: "provider_funding_paused" }), "missed");
});

test("provider deferral classification does not conceal unrelated or terminal errors", () => {
  assert.equal(classifyProcessedJobOutcome({ processed: true, error: "unexpected", failureKind: "unknown" }), "job_failed");
  assert.equal(classifyProcessedJobOutcome({ processed: true, error: "publication", failureKind: "publication_failed" }), "publication_failed");
  assert.equal(classifyProcessedJobOutcome({ processed: true, buffered: true }), "buffer_ready");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(pipeline, /return classifyProcessedJobOutcome\(processed\)/);
  assert.match(pipeline, /deferArticleProviderMonthlyAllowance[\s\S]*?failureKind: "provider_allowance_paused"/);
  assert.match(pipeline, /deferArticleProviderFunding[\s\S]*?failureKind: "provider_funding_paused"/);
});

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

test("run health honors the cadence-specific buffer minimum", () => {
  assert.equal(
    classifyAutopilotRunOutcome({
      outcome: "buffer_full",
      approvedBufferCount: 8,
      bufferMinimum: 9,
    }).status,
    "buffer_low",
  );
  assert.equal(
    classifyAutopilotRunOutcome({
      outcome: "buffer_ready",
      approvedBufferCount: 9,
      bufferMinimum: 9,
    }).status,
    "healthy",
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
