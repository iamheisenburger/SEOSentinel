"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { assertDataForSeoAccountBalance } from
  "../lib/dataForSeoAccountBalance";
import {
  AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
  EXPECTED_CLICK_PLAN_MIGRATION_VERSION,
} from "../lib/planProviderBudget";
import {
  EXPECTED_CLICK_PLAN_MIGRATION_RECOVERY_VERSION,
} from "../lib/expectedClickMigrationRecovery";

/**
 * Operator-only entry point for the one-shot expected-click migration.
 *
 * Convex mutations cannot perform external HTTP checks. This bounded action
 * therefore checks the provider's free user-data endpoint before the atomic
 * reservation/marker mutation, while the worker checks again immediately
 * before any paid request to cover the intervening TOCTOU window.
 */
export const queueExpectedClickPlanMigration = internalAction({
  args: {
    siteId: v.id("sites"),
    migrationVersion: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (args.migrationVersion !== EXPECTED_CLICK_PLAN_MIGRATION_VERSION) {
      throw new Error("Unsupported expected-click plan migration version");
    }
    await assertDataForSeoAccountBalance(
      AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
    );
    return ctx.runMutation(
      internal.jobs.queueExpectedClickPlanMigrationAfterPreflight,
      args,
    );
  },
});

/**
 * Operator-only recovery for the reviewed zero-insert migration incident.
 *
 * The original job already reserved two bounded $1 executions. This action
 * performs the free wallet check for the remaining execution before the
 * mutation atomically consumes that retry slot. It never creates a new job or
 * reservation, and the mutation validates the exact incident signature and
 * immutable reservation receipt again before scheduling one worker.
 */
export const recoverExpectedClickPlanMigration = internalAction({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    migrationVersion: v.number(),
    recoveryVersion: v.number(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    if (args.migrationVersion !== EXPECTED_CLICK_PLAN_MIGRATION_VERSION) {
      throw new Error("Unsupported expected-click plan migration version");
    }
    if (
      args.recoveryVersion !==
        EXPECTED_CLICK_PLAN_MIGRATION_RECOVERY_VERSION
    ) {
      throw new Error("Unsupported expected-click plan recovery version");
    }
    await assertDataForSeoAccountBalance(
      AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
    );
    return ctx.runMutation(
      internal.jobs.recoverExpectedClickPlanMigrationAfterPreflight,
      args,
    );
  },
});
