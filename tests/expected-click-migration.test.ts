import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EXPECTED_CLICK_PLAN_MIGRATION_VERSION,
  hasExplicitPlanProviderReservation,
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
} from "../convex/lib/planProviderBudget.ts";

const jobs = readFileSync("convex/jobs.ts", "utf8");
const reservation = readFileSync(
  "convex/lib/planProviderReservation.ts",
  "utf8",
);
const schema = readFileSync("convex/schema.ts", "utf8");
const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
const migrationAction = readFileSync(
  "convex/actions/expectedClickMigration.ts",
  "utf8",
);
const migrationRunbook = readFileSync(
  "docs/EXPECTED_CLICK_PLAN_MIGRATION_RUNBOOK.md",
  "utf8",
);

test("only a complete modern provider reservation discounts legacy history", () => {
  assert.equal(EXPECTED_CLICK_PLAN_MIGRATION_VERSION, 1);
  assert.equal(
    hasExplicitPlanProviderReservation({
      type: "plan",
      payload: { reason: "legacy_plan" },
    }),
    false,
  );
  assert.equal(
    hasExplicitPlanProviderReservation({
      type: "plan",
      payload: { reason: "modern_plan" },
      providerCostCeilingMicroUsd:
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservedMicroUsd:
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservationDay: "2026-08-20",
      providerSpendReservationId: "reservation-id",
    }),
    true,
  );
  assert.equal(
    hasExplicitPlanProviderReservation({
      type: "plan",
      payload: {},
      providerCostCeilingMicroUsd:
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservedMicroUsd: 1,
      providerCostReservationDay: "2026-08-20",
      providerSpendReservationId: "reservation-id",
    }),
    false,
  );
});

test("the expected-click bridge is versioned, one-shot, and tenant scoped", () => {
  assert.match(
    schema,
    /expectedClickPlanMigrationVersion: v\.optional\(v\.number\(\)\)/,
  );
  assert.match(
    schema,
    /expectedClickPlanMigrationJobId: v\.optional\(v\.id\("jobs"\)\)/,
  );

  const migration = jobs.slice(
    jobs.indexOf("export const queueExpectedClickPlanMigrationAfterPreflight"),
    jobs.indexOf(
      "export const recoverExpectedClickPlanMigrationAfterPreflight",
    ),
  );
  assert.match(migration, /internalMutation/);
  assert.match(migration, /migrationVersion !== EXPECTED_CLICK_PLAN_MIGRATION_VERSION/);
  assert.match(migration, /siteExecutionActive\(site\)/);
  assert.match(migration, /site\.expectedClickSchedulingEnabled !== true/);
  assert.match(migration, /!activeRollout\(site\)/);
  assert.match(
    migration,
    /site\.expectedClickPlanMigrationVersion \?\? 0[\s\S]*>= migrationVersion/,
  );
  assert.match(migration, /health\?\.portfolioSupportsGoal !== false/);
  assert.match(migration, /activeJobsForSite\(ctx, siteId\)/);
  assert.match(
    migration,
    /reservePlanProviderBudget\([\s\S]*expectedClickMigrationVersion: migrationVersion/,
  );
  assert.match(migration, /expectedClickPlanMigrationVersion: migrationVersion/);
  assert.match(migration, /expectedClickPlanMigrationJobId: jobId/);
  assert.match(migration, /internal\.actions\.pipeline\.processNextJob/);
  assert.equal(
    migration.match(/ctx\.scheduler\.runAfter\(/g)?.length,
    1,
    "the transactional queue must schedule exactly one durable worker",
  );
  assert.doesNotMatch(migration, /operatorBudgetBypass/);

  assert.match(migrationAction, /internalAction/);
  assert.ok(
    migrationAction.indexOf("assertDataForSeoAccountBalance") <
      migrationAction.indexOf("queueExpectedClickPlanMigrationAfterPreflight"),
    "the free account check must run before the one-shot marker mutation",
  );

  assert.ok(
    migration.indexOf("expectedClickPlanMigrationVersion ?? 0") <
      migration.indexOf("reservePlanProviderBudget("),
    "idempotency must be checked before any provider spend is reserved",
  );
  assert.ok(
    migration.indexOf("site.deletionStatus") <
      migration.indexOf("reservePlanProviderBudget("),
    "tenant deletion must fail closed before any provider reservation",
  );

  assert.match(
    pipeline,
    /expectedClickMigrationVersion !== undefined[\s\S]*site\.expectedClickSchedulingEnabled !== true[\s\S]*site\.expectedClickPlanMigrationJobId !== jobId/,
  );
  assert.match(
    pipeline,
    /Expected-click plan migration authorization is no longer current/,
  );
  assert.match(jobs, /abortPlanForProviderBalance/);
  assert.match(jobs, /migrationRolledBack = true/);
});

test("migration discounts only legacy plan counters, never shared fleet spend", () => {
  assert.match(
    reservation,
    /options\s*\?\s*hasExplicitPlanProviderReservation\(job\)\s*:\s*isBudgetedPlanJob\(job\)/,
  );
  assert.match(
    reservation,
    /reserveSharedProviderBudget\(ctx, \{[\s\S]*reservedMicroUsd:\s*AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD/,
  );
  assert.match(
    reservation,
    /expected_click_plan_migration_v\$\{options\.expectedClickMigrationVersion\}/,
  );
  assert.doesNotMatch(reservation, /SHARED_PROVIDER_.*CEILING.*=/);
});

test("the operator runbook invokes the preflight action, not its mutation", () => {
  assert.match(
    migrationRunbook,
    /convex run actions\/expectedClickMigration:queueExpectedClickPlanMigration/,
  );
  assert.doesNotMatch(
    migrationRunbook,
    /convex run jobs:queueExpectedClickPlanMigration(?:\s|')/,
  );
  assert.match(migrationRunbook, /--prod --codegen disable/);
  assert.match(migrationAction, /export const queueExpectedClickPlanMigration = internalAction/);
});
