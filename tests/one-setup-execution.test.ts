import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  oneSetupConfigurationRevisionIsCurrent,
  oneSetupExecutionClaimDisposition,
  oneSetupPlanSettlement,
} from "../convex/lib/oneSetupExecution.ts";

test("an ambiguous response resumes the bound plan after the lease", () => {
  assert.deepEqual(
    oneSetupExecutionClaimDisposition({
      status: "running",
      hasPlanJob: false,
      claimNonce: "first-client",
      leaseExpiresAt: 2_000,
      now: 1_000,
    }),
    { kind: "in_progress" },
  );
  assert.deepEqual(
    oneSetupExecutionClaimDisposition({
      status: "plan_queued",
      hasPlanJob: true,
      claimNonce: "lost-response-client",
      leaseExpiresAt: 2_000,
      now: 2_001,
    }),
    { kind: "claimable", resumePlan: true },
  );
});

test("terminal paid-plan receipts are reused and never replayed", () => {
  assert.deepEqual(
    oneSetupExecutionClaimDisposition({
      status: "completed",
      hasPlanJob: true,
      now: 10_000,
    }),
    { kind: "terminal", status: "completed" },
  );
  assert.deepEqual(oneSetupPlanSettlement({ jobStatus: "done", resultCount: 3 }), {
    state: "completed",
    topicCount: 3,
  });
  assert.deepEqual(oneSetupPlanSettlement({ jobStatus: "done", resultCount: 0 }), {
    state: "blocked",
    blockerCode: "plan_zero_yield",
    topicCount: 0,
  });
  assert.deepEqual(oneSetupPlanSettlement({ jobStatus: "failed" }), {
    state: "blocked",
    blockerCode: "plan_failed_no_replay",
  });
});

test("passive reconciliation cannot invalidate the saved owner configuration", () => {
  const saved = { requestRevision: 7, configurationRevision: 3 };
  const afterPassiveReconcile = {
    requestRevision: 8,
    configurationRevision: 3,
  };
  assert.notEqual(
    saved.requestRevision,
    afterPassiveReconcile.requestRevision,
  );
  assert.equal(
    oneSetupConfigurationRevisionIsCurrent({
      expected: saved.configurationRevision,
      actual: afterPassiveReconcile.configurationRevision,
    }),
    true,
  );
  assert.equal(
    oneSetupConfigurationRevisionIsCurrent({
      expected: saved.configurationRevision,
      actual: saved.configurationRevision + 1,
    }),
    false,
  );
});

test("the job and configuration receipt bind atomically before any retry can reserve", () => {
  const schema = readFileSync("convex/schema.ts", "utf8");
  const jobs = readFileSync("convex/jobs.ts", "utf8");
  const executions = readFileSync("convex/oneSetupExecutions.ts", "utf8");
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");

  assert.match(
    schema,
    /one_setup_executions:[\s\S]*\.index\("by_request_configuration", \["requestId", "configurationRevision"\]\)/,
  );
  const queueStart = jobs.indexOf("export const queuePlanIfAbsent");
  const queueEnd = jobs.indexOf(
    "export const queueExpectedClickPlanMigrationAfterPreflight",
    queueStart,
  );
  const queue = jobs.slice(queueStart, queueEnd);
  const receiptReuseAt = queue.indexOf("if (setupExecution.planJobId)");
  const reserveAt = queue.indexOf("reservePlanProviderBudget");
  const insertAt = queue.indexOf('ctx.db.insert("jobs"');
  const bindAt = queue.indexOf('status: "plan_queued"', insertAt);
  assert.ok(receiptReuseAt >= 0 && receiptReuseAt < reserveAt);
  assert.ok(insertAt >= 0 && bindAt > insertAt);
  assert.match(queue, /oneSetupExecutionId: setupExecution\._id/);
  assert.match(
    queue,
    /oneSetupConfigurationRevision:[\s\S]*setupExecution\.configurationRevision/,
  );
  assert.match(
    queue,
    /setupRequest\.configurationRevision \?\? 0\)[\s\S]*oneSetupConfigurationRevision/,
  );
  assert.match(executions, /payload\.oneSetupExecutionId/);
  assert.ok(
    [...executions.matchAll(/request\.configurationRevision \?\? 0/g)].length >= 2,
  );
  assert.match(executions, /oneSetupPlanSettlement\(\{/);

  const actionStart = pipeline.indexOf(
    "export const resumeOneSetupExecution = action",
  );
  const actionEnd = pipeline.indexOf("export const generateArticle", actionStart);
  const action = pipeline.slice(actionStart, actionEnd);
  assert.match(action, /internal\.oneSetupExecutions\.claim/);
  assert.match(action, /internal\.oneSetupExecutions\.inspectPlan/);
  assert.match(action, /internal\.oneSetupExecutions\.settleFromPlan/);
  assert.match(action, /oneSetupExecutionId: claim\.executionId/);
  assert.match(
    action,
    /queued\.queued \|\| queued\.reason === "setup_receipt"/,
  );
});

test("browser retry preserves the exact owner configuration receipt", () => {
  const wizard = readFileSync(
    "src/components/onboarding/setup-wizard.tsx",
    "utf8",
  );
  assert.match(wizard, /if \(!receipt\) \{[\s\S]*saveOneSetupRequest/);
  assert.match(wizard, /setSetupReceipt\(receipt\)/);
  assert.match(wizard, /requestId: receipt\.requestId/);
  assert.match(
    wizard,
    /configurationRevision: receipt\.configurationRevision/,
  );
  assert.match(wizard, /finishSetup\(siteId, setupReceipt\)/);
  assert.doesNotMatch(wizard, /useAction\(api\.actions\.pipeline\.generatePlan\)/);
});
