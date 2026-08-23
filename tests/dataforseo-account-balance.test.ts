import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DATAFORSEO_BALANCE_PREFLIGHT_TIMEOUT_MS,
  DATAFORSEO_USER_DATA_ENDPOINT,
  DataForSeoBalancePreflightError,
  assertDataForSeoAccountBalance,
  parseDataForSeoBalanceMicroUsd,
} from "../convex/lib/dataForSeoAccountBalance.ts";
import {
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
  requiredPlanProviderBalanceMicroUsd,
} from "../convex/lib/planProviderBudget.ts";

function userData(balance: number): unknown {
  return {
    status_code: 20_000,
    status_message: "must never be relayed",
    tasks: [{
      status_code: 20_000,
      status_message: "must never be relayed",
      result: [{
        login: "must-never-be-read@example.com",
        money: { balance },
      }],
    }],
  };
}

test("the documented free user-data balance is parsed conservatively", () => {
  assert.equal(parseDataForSeoBalanceMicroUsd(userData(1.751728)), 1_751_728);
  assert.equal(parseDataForSeoBalanceMicroUsd(userData(0.0000019)), 1);
  assert.throws(
    () => parseDataForSeoBalanceMicroUsd({ status_code: 20_000, tasks: [] }),
    (error) =>
      error instanceof DataForSeoBalancePreflightError &&
      error.code === "provider_error",
  );
});

test("wallet preflight funds one execution while the ledger reserves both", () => {
  assert.equal(
    requiredPlanProviderBalanceMicroUsd(),
    AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD,
  );
  assert.equal(AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD, 2_000_000);
});

test("preflight uses GET, a hard timeout, and never sends a request body", async () => {
  let observedInput = "";
  let observedInit: RequestInit | undefined;
  const result = await assertDataForSeoAccountBalance(250_000, {
    login: "test-login",
    password: "test-password",
    fetch: async (input, init) => {
      observedInput = input;
      observedInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => userData(0.25),
      };
    },
  });
  assert.deepEqual(result, {
    availableMicroUsd: 250_000,
    requiredMicroUsd: 250_000,
  });
  assert.equal(observedInput, DATAFORSEO_USER_DATA_ENDPOINT);
  assert.equal(observedInit?.method, "GET");
  assert.equal("body" in (observedInit ?? {}), false);
  assert.ok(observedInit?.signal instanceof AbortSignal);
  assert.equal(DATAFORSEO_BALANCE_PREFLIGHT_TIMEOUT_MS, 5_000);
});

test("low balance fails closed without exposing the account balance", async () => {
  await assert.rejects(
    assertDataForSeoAccountBalance(1_000_000, {
      login: "test-login",
      password: "test-password",
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => userData(0.751728),
      }),
    }),
    (error) => {
      assert.ok(error instanceof DataForSeoBalancePreflightError);
      assert.equal(error.code, "insufficient_balance");
      assert.doesNotMatch(error.message, /0\.751728|test-login|test-password/);
      return true;
    },
  );
});

test("HTTP failures never read or relay provider response bodies", async () => {
  let jsonCalled = false;
  await assert.rejects(
    assertDataForSeoAccountBalance(1, {
      login: "test-login",
      password: "test-password",
      fetch: async () => ({
        ok: false,
        status: 402,
        json: async () => {
          jsonCalled = true;
          throw new Error("private provider response");
        },
      }),
    }),
    (error) =>
      error instanceof DataForSeoBalancePreflightError &&
      error.code === "http_error" &&
      !error.message.includes("402"),
  );
  assert.equal(jsonCalled, false);
});

test("plan and authority workers gate paid calls and release only untouched work", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const backlinks = readFileSync("convex/actions/backlinks.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const authority = readFileSync("convex/seoAuthority.ts", "utf8");
  const shared = readFileSync(
    "convex/lib/providerSpendReservation.ts",
    "utf8",
  );
  const migration = readFileSync(
    "convex/actions/expectedClickMigration.ts",
    "utf8",
  );

  const planBranch = pipeline.slice(
    pipeline.indexOf('if (job.type === "plan")'),
    pipeline.indexOf('if (job.type === "links")'),
  );
  assert.ok(
    planBranch.indexOf("assertDataForSeoAccountBalance") <
      planBranch.indexOf("handlePlan("),
  );
  const reservedAuthority = backlinks.slice(
    backlinks.indexOf("async function runReservedBacklinkAnalysis"),
    backlinks.indexOf("export const analyzeBacklinks = action"),
  );
  assert.ok(
    reservedAuthority.indexOf("assertDataForSeoAccountBalance") <
      reservedAuthority.indexOf("analyzeBacklinksHandler("),
  );
  assert.match(jobs, /firstExecution = \(job\.workerAttempts \?\? 0\) === 0/);
  assert.match(jobs, /expectedClickPlanMigrationVersion: undefined/);
  assert.match(authority, /provider_balance_unavailable/);
  assert.match(shared, /row\.releasedAt !== undefined \|\| row\.createdAt < monthStart/);
  assert.match(shared, /provider_account_preflight_cooling_down/);
  assert.match(migration, /assertDataForSeoAccountBalance/);
  assert.match(
    migration,
    /AUTOMATIC_PLAN_PROVIDER_EXECUTION_CEILING_MICRO_USD/,
  );
  assert.doesNotMatch(
    migration,
    /AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD/,
  );
  assert.match(migration, /queueExpectedClickPlanMigrationAfterPreflight/);
});
