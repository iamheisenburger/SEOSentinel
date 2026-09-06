import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import type { Doc } from "../convex/_generated/dataModel";
import type { MutationCtx } from "../convex/_generated/server";
import { retireSingleExecutionPlanContingencies } from "../convex/lib/planProviderSettlement.ts";
import { automaticPlanYieldTarget } from "../convex/lib/planProviderBudget.ts";

const now = Date.UTC(2026, 8, 6, 1);
function fixture() {
  const site = { _id: "site", userId: "owner" };
  const job: Record<string, unknown> = {
    _id: "job", siteId: "site", type: "plan", status: "failed", workerAttempts: 0,
    payload: { reason: "topic_evidence_replenishment", planCheckpointModeVersion: 1,
      planYieldTarget: automaticPlanYieldTarget({ targetBufferShortfall: 4,
        verifiedHorizonShortfall: 7, articleQuotaHeadroom: 20 }) },
    createdAt: now - 60_000, updatedAt: now - 1_000,
    error: "Terminal planner outcome: Verified discovery returned no measured, authority-attainable, tenant-product-fit keyword",
    cadenceFailure: { category: "semantic_zero_yield", terminal: true },
    providerCostCeilingMicroUsd: 2_000_000, providerCostReservedMicroUsd: 2_000_000,
    providerCostReservationDay: "2026-09-06", providerSpendReservationId: "reservation",
  };
  const reservation: Record<string, unknown> = {
    _id: "reservation", siteId: "site", userId: "owner", purpose: "topic_plan",
    trigger: "topic_plan", reservedMicroUsd: 2_000_000,
    createdAt: job.createdAt, reservationDay: "2026-09-06",
  };
  const checkpoints: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  const ctx = { db: {
    query(table: string) {
      assert.ok(["jobs", "plan_candidate_checkpoints"].includes(table));
      const expected = table === "jobs" ? { siteId: "site", type: "plan" } : { planJobId: "job" };
      const range = {
        eq(key: keyof typeof expected, value: unknown) { assert.equal(value, expected[key]); return range; },
        gte(key: string, value: number) { assert.equal(key, "createdAt"); assert.equal(value, Date.UTC(2026, 8, 1)); return range; },
      };
      const chain = {
        withIndex(name: string, fn: (r: typeof range) => unknown) {
          assert.equal(name, table === "jobs" ? "by_site_type_created" : "by_plan_job"); fn(range); return chain;
        },
        order(direction: string) { assert.equal(direction, "desc"); return chain; },
        async take(limit: number) { assert.equal(limit, table === "jobs" ? 32 : 2); return table === "jobs" ? [job] : checkpoints; },
      }; return chain;
    },
    async get(id: string) { assert.equal(id, "reservation"); return reservation; },
    async patch(id: string, patch: Record<string, unknown>) {
      assert.equal(id, "reservation"); patches.push(patch); Object.assign(reservation, patch);
    },
  } };
  return { job, reservation, checkpoints, patches,
    run: () => retireSingleExecutionPlanContingencies(ctx as unknown as MutationCtx, site as unknown as Doc<"sites">, now) };
}

test("terminal single-execution plan keeps the full spent ceiling and retires only unused contingency", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { examined: 1, retired: 1, reclaimedMicroUsd: 1_000_000 });
  assert.equal(f.reservation.reservedMicroUsd, 2_000_000);
  assert.equal(f.reservation.settledMicroUsd, 1_000_000);
  assert.equal(f.reservation.settlementReason, "single_execution_plan_contingency_retired");
  assert.equal(f.reservation.releasedAt, undefined);
  assert.equal((await f.run()).retired, 0);
  assert.equal(f.patches.length, 1);
});

test("successful single-execution plan requires an exact terminal checkpoint", async () => {
  const f = fixture(); f.job.status = "done";
  assert.equal((await f.run()).retired, 0);
  f.checkpoints.push({ siteId: "site", planJobId: "job", workerExecution: 1, status: "inline_completed" });
  assert.equal((await f.run()).retired, 1);
});

test("a prospective one-execution envelope has no unused contingency to retire", async () => {
  const f = fixture();
  Object.assign(f.job, { providerCostCeilingMicroUsd: 1_000_000, providerCostReservedMicroUsd: 1_000_000,
    payload: { ...(f.job.payload as Record<string, unknown>), planProviderEnvelopeVersion: 2 } });
  f.reservation.reservedMicroUsd = 1_000_000;
  assert.equal((await f.run()).retired, 0);
  assert.equal(f.patches.length, 0);
  assert.equal(f.reservation.settledMicroUsd, undefined);
});

test("active, legacy, ambiguous, retried or unbound plan work retains its entire envelope", async () => {
  for (const patch of [
    { status: "running" }, { status: "pending" }, { workerAttempts: 1 }, { workerAttempts: undefined },
    { workerToken: "lease" }, { leaseExpiresAt: now - 1 }, { nextAttemptAt: now + 1 },
    { payload: { manual: true } }, { siteId: "different" }, { type: "article" },
    { error: "Provider timeout" }, { cadenceFailure: { category: "transient_provider", terminal: true } },
    { providerCostReservedMicroUsd: 3_000_000 }, { providerReservationReleasedAt: now - 1 },
    { providerSpendReservationId: undefined }, { updatedAt: now + 1 },
  ]) {
    const f = fixture(); Object.assign(f.job, patch);
    assert.equal((await f.run()).retired, 0, JSON.stringify(patch));
    assert.equal(f.patches.length, 0);
  }
});

test("conflicting ownership, purpose, dates, amounts or existing settlement cannot free capacity", async () => {
  for (const patch of [
    { siteId: "other" }, { userId: "other" }, { purpose: "authority_discovery" }, { trigger: "operator" },
    { reservedMicroUsd: 1_000_000 }, { createdAt: now }, { reservationDay: "2026-09-05" },
    { releasedAt: now - 1 }, { settledAt: now - 1 }, { settledMicroUsd: 0 },
  ]) {
    const f = fixture(); Object.assign(f.reservation, patch);
    assert.equal((await f.run()).retired, 0, JSON.stringify(patch));
  }
});

test("incomplete, duplicate or mismatched candidate checkpoints remain fully reserved", async () => {
  for (const checkpoint of [
    { siteId: "other", planJobId: "job", workerExecution: 1, status: "terminal_blocked" },
    { siteId: "site", planJobId: "other", workerExecution: 1, status: "terminal_blocked" },
    { siteId: "site", planJobId: "job", workerExecution: 2, status: "terminal_blocked" },
    { siteId: "site", planJobId: "job", workerExecution: 1, status: "active" },
  ]) {
    const f = fixture(); f.checkpoints.push(checkpoint);
    assert.equal((await f.run()).retired, 0);
  }
  const f = fixture();
  f.checkpoints.push(...Array.from({ length: 2 }, () => ({ siteId: "site", planJobId: "job", workerExecution: 1, status: "terminal_blocked" })));
  assert.equal((await f.run()).retired, 0);
});

test("real paid-boundary authorization rejects any settled single-execution reservation", async () => {
  const bundled = buildSync({ entryPoints: ["convex/planCandidateCheckpoints.ts"], bundle: true,
    platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
  const runtimeModule = { exports: {} as { authorizeSingleExecution: { _handler: (ctx: unknown, args: unknown) => Promise<unknown> } } };
  class TestDate extends Date { static now() { return now; } }
  runInNewContext(bundled, { module: runtimeModule, exports: runtimeModule.exports, require: createRequire(import.meta.url),
    Date: TestDate, URL, TextEncoder, console, process: { env: {} } });
  const f = fixture();
  const site = { _id: "site", userId: "owner", domain: "example.org", autopilotEnabled: true,
    autopilotRolloutMode: "live", autopilotRolloutEpoch: 1, expectedClickSchedulingEnabled: true };
  Object.assign(f.job, { status: "running", workerToken: "lease", leaseExpiresAt: now + 60_000, rolloutEpoch: 1 });
  const ctx = { db: {
    async get(id: string) { return id === "site" ? site : id === "job" ? f.job : id === "reservation" ? f.reservation : null; },
    query(table: string) {
      assert.ok(["account_deletion_receipts", "account_plan_entitlements"].includes(table));
      const range = { eq() { return range; } };
      const chain = { withIndex(_name: string, fn: (r: typeof range) => unknown) { fn(range); return chain; }, async unique() { return null; } };
      return chain;
    },
  } };
  const args = { siteId: "site", jobId: "job", workerToken: "lease", workerExecution: 1 };
  assert.equal(JSON.stringify(await runtimeModule.exports.authorizeSingleExecution._handler(ctx, args)),
    JSON.stringify({ checkpointEnabled: true, workerExecution: 1 }));
  for (const patch of [{ settledAt: now }, { settledMicroUsd: 1_000_000 }, { settledMicroUsd: 0 }]) {
    Object.assign(f.reservation, patch);
    await assert.rejects(runtimeModule.exports.authorizeSingleExecution._handler(ctx, args), /resume fence changed/);
    delete f.reservation.settledAt; delete f.reservation.settledMicroUsd;
  }
});
