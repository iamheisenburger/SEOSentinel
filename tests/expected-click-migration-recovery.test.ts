import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXPECTED_CLICK_PLAN_MIGRATION_RECOVERY_VERSION,
  EXPECTED_CLICK_ZERO_INSERT_TERMINAL_ERROR,
  isExpectedClickZeroInsertTerminalError,
} from "../convex/lib/expectedClickMigrationRecovery.ts";
import {
  AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES,
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
} from "../convex/lib/planProviderBudget.ts";

const actions = readFileSync(
  "convex/actions/expectedClickMigration.ts",
  "utf8",
);
const jobs = readFileSync("convex/jobs.ts", "utf8");
const runbook = readFileSync(
  "docs/EXPECTED_CLICK_PLAN_MIGRATION_RUNBOOK.md",
  "utf8",
);

function recoveryMutation(): string {
  return jobs.slice(
    jobs.indexOf(
      "export const recoverExpectedClickPlanMigrationAfterPreflight",
    ),
    jobs.indexOf("export const abortPlanForProviderBalance"),
  );
}

test("zero-insert recovery recognizes only the exact reviewed terminal error", () => {
  assert.equal(EXPECTED_CLICK_PLAN_MIGRATION_RECOVERY_VERSION, 1);
  assert.equal(
    isExpectedClickZeroInsertTerminalError(
      EXPECTED_CLICK_ZERO_INSERT_TERMINAL_ERROR,
    ),
    true,
  );
  assert.equal(
    isExpectedClickZeroInsertTerminalError(
      `${EXPECTED_CLICK_ZERO_INSERT_TERMINAL_ERROR} extra context`,
    ),
    false,
  );
  assert.equal(
    isExpectedClickZeroInsertTerminalError(
      "Terminal planner outcome (terminal_planner): another failure",
    ),
    false,
  );
  assert.equal(isExpectedClickZeroInsertTerminalError(undefined), false);
});

test("operator recovery free-preflights one execution before mutation", () => {
  const recovery = actions.slice(
    actions.indexOf("export const recoverExpectedClickPlanMigration"),
  );
  assert.match(recovery, /internalAction/);
  assert.match(
    recovery,
    /AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD/,
  );
  assert.equal(
    AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
    1_000_000,
  );
  assert.ok(
    recovery.indexOf("assertDataForSeoAccountBalance") <
      recovery.indexOf(
        "recoverExpectedClickPlanMigrationAfterPreflight",
      ),
  );
});

test("recovery reuses the exact active receipt and cannot create spend", () => {
  const recovery = recoveryMutation();
  assert.match(recovery, /internalMutation/);
  assert.match(
    recovery,
    /site\.autopilotRolloutMode !== "live"[\s\S]*site\.expectedClickSchedulingEnabled !== true/,
  );
  assert.match(
    recovery,
    /site\.expectedClickPlanMigrationVersion !== migrationVersion[\s\S]*site\.expectedClickPlanMigrationJobId !== jobId[\s\S]*site\.expectedClickPlanMigrationReservedAt !== job\.createdAt/,
  );
  assert.match(
    recovery,
    /job\.type !== "plan"[\s\S]*job\.status !== "failed"[\s\S]*\(job\.workerAttempts \?\? 0\) !== 0/,
  );
  assert.match(
    recovery,
    /isExpectedClickZeroInsertTerminalError\(job\.error\)/,
  );
  assert.match(
    recovery,
    /job\.providerCostReservedMicroUsd !==[\s\S]*AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD/,
  );
  assert.equal(AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD, 2_000_000);
  assert.match(
    recovery,
    /job\.providerCostReservationDay !== reservationDay/,
  );
  assert.match(recovery, /reservation\.siteId !== siteId/);
  assert.match(recovery, /reservation\.purpose !== "topic_plan"/);
  assert.match(recovery, /reservation\.releasedAt !== undefined/);
  assert.match(
    recovery,
    /reservation\.trigger !==[\s\S]*expected_click_plan_migration_v/,
  );
  assert.doesNotMatch(recovery, /ctx\.db\.insert\(/);
  assert.doesNotMatch(recovery, /reservePlanProviderBudget\(/);
  assert.doesNotMatch(recovery, /reserveSharedProviderBudget\(/);
});

test("recovery is idempotent, blocks supersession, and consumes execution two", () => {
  const recovery = recoveryMutation();
  assert.ok(
    recovery.indexOf(
      "payload.expectedClickPlanMigrationRecoveryVersion === recoveryVersion",
    ) < recovery.indexOf('job.status !== "failed"'),
  );
  assert.match(recovery, /reason: "already_applied"/);
  assert.match(recovery, /status: "pending"/);
  assert.match(recovery, /workerAttempts: 1/);
  assert.equal(AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES, 1);
  assert.match(recovery, /error: undefined/);
  assert.match(recovery, /result: undefined/);
  assert.match(recovery, /workerToken: undefined/);
  assert.match(recovery, /heartbeatAt: undefined/);
  assert.match(recovery, /leaseExpiresAt: undefined/);
  assert.match(recovery, /\.gte\("createdAt", job\.createdAt\)/);
  assert.match(
    recovery,
    /candidate\._creationTime > job\._creationTime/,
  );
  assert.match(recovery, /candidate\.type === "plan"/);
  assert.equal(
    recovery.match(/ctx\.scheduler\.runAfter\(/g)?.length,
    1,
    "the atomic recovery mutation may schedule exactly one worker",
  );
  assert.match(
    recovery,
    /internal\.actions\.pipeline\.processNextJob/,
  );
  assert.match(recovery, /workerExecution: 2/);
});

test("runbook requires private reviewed IDs and pins all version arguments", () => {
  assert.match(
    runbook,
    /actions\/expectedClickMigration:recoverExpectedClickPlanMigration/,
  );
  assert.match(runbook, /<reviewed-site-id>/);
  assert.match(runbook, /<reviewed-terminal-job-id>/);
  assert.match(runbook, /migrationVersion\\":1/);
  assert.match(runbook, /recoveryVersion\\":1/);
  assert.match(runbook, /--prod --codegen disable/);
});
