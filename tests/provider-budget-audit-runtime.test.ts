import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";

type Row = Record<string, unknown>;
const now = Date.UTC(2026, 8, 8, 13);
const code = buildSync({ entryPoints: ["convex/providerBudget.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
function fixture(data: Record<string, Row[]>, comparisonOwner = "owner-a") {
  const runtimeModule = { exports: {} as { getSiteReservationAudit: {
    _handler: (ctx: unknown, args: unknown) => Promise<Row> } } };
  runInNewContext(code, { module: runtimeModule, exports: runtimeModule.exports,
    require: createRequire(import.meta.url), process: { env: {} },
    Date: class extends Date { static now() { return now; } } });
  const reads: string[] = [];
  const ctx = { db: {
    async get(id: string) {
      assert.ok(["site-a", "site-b"].includes(id)); reads.push(id);
      return { _id: id, userId: id === "site-a" ? "owner-a" : comparisonOwner,
        secret: "private-token", planFeatures: [] };
    },
    query(table: string) {
      const predicates: Array<(row: Row) => boolean> = [];
      const range = {
        eq(key: string, value: unknown) {
          if (table === "account_plan_entitlements") { assert.equal(key, "userId"); assert.equal(value, "owner-a"); }
          else if (table === "plan_candidate_checkpoints") { assert.equal(key, "planJobId"); }
          else if (key === "siteId") assert.equal(value, "site-a");
          else { assert.equal(key, "type"); assert.ok(["plan", "onboarding"].includes(String(value))); }
          predicates.push(row => row[key] === value); return range;
        },
        gte(key: string, value: number) {
          assert.equal(key, "createdAt"); assert.equal(value, Date.UTC(2026, 8, 1));
          predicates.push(row => Number(row[key]) >= value); return range;
        },
      };
      const chain = {
        withIndex(index: string, fn: (r: typeof range) => unknown) {
          assert.equal(index, table === "account_plan_entitlements" ? "by_user" :
            table === "jobs" ? "by_site_type_created" : table === "plan_candidate_checkpoints" ? "by_plan_job" : "by_site_created");
          fn(range); reads.push(table); return chain;
        },
        order(direction: string) { assert.equal(direction, "desc"); return chain; },
        async unique() { assert.equal(table, "account_plan_entitlements");
          return { planFeatures: ["max_sites_unlimited", "max_articles_150"], secret: "private-entitlement" }; },
        async take(limit: number) { assert.equal(limit, table === "plan_candidate_checkpoints" ? 2 : 501);
          return (data[table] ?? []).filter(row => predicates.every(p => p(row)))
            .sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, limit); },
      }; return chain;
    },
  } };
  return { run: (comparisonSiteId?: string) => runtimeModule.exports.getSiteReservationAudit._handler(ctx,
    { siteId: "site-a", comparisonSiteId }), reads };
}

const base = { siteId: "site-a", userId: "owner-a", createdAt: now - 1_000,
  reservedMicroUsd: 100_000, purpose: "cadence_micro_seed", payload: "private-payload" };
test("audit partitions actual spend, spent ceilings, retained and released rows without double counting", async () => {
  const f = fixture({ provider_spend_reservations: [
    { ...base, _id: "actual", settledMicroUsd: 12_240, settledAt: now,
      settlementReason: "verified_provider_receipt_actual_cost" },
    { ...base, _id: "closed", reservedMicroUsd: 2_000_000, settledMicroUsd: 1_000_000,
      settledAt: now, settlementReason: "single_execution_plan_contingency_retired" },
    { ...base, _id: "retained" }, { ...base, _id: "released", releasedAt: now },
    { ...base, _id: "old-owner", userId: "previous-owner" },
    { ...base, _id: "other-tenant", siteId: "forbidden-site" },
    { ...base, _id: "old-month", createdAt: Date.UTC(2026, 7, 31) },
  ], cadence_micro_seed_jobs: [{ ...base, _id: "job", status: "missed", updatedAt: now,
    providerSpendReservationId: "actual", providerCostReservedMicroUsd: 100_000,
    providerCallCompleted: true, providerCallAttempted: true, providerTaskCostUsd: 0.01224 }] });
  const result = await f.run("site-b");
  assert.equal(result.sameAccountAsComparison, true);
  assert.equal(result.verifiedSettledMicroUsd, 12_240);
  assert.equal(result.contingencySettledMicroUsd, 1_000_000);
  assert.equal(result.retainedMicroUsd, 100_000);
  assert.equal(result.releasedOriginalMicroUsd, 100_000);
  assert.equal(result.monthlyConsumedMicroUsd, 1_112_240);
  assert.equal(result.resetAt, Date.UTC(2026, 9, 1));
  assert.equal(result.accountMonthlyCeilingMicroUsd, 28_000_000);
  assert.equal(result.siteWindowComplete, true); assert.equal(result.sourceWindowsComplete, true);
  const rows = result.rows as Row[];
  assert.equal(rows.length, 4);
  assert.equal((rows.find(r => r.reservationId === "actual")!.sources as Row[])[0].reservationAmountMatches, true);
  for (const token of ["private", "previous-owner", "forbidden-site", "owner-a", "old-month"])
    assert.ok(!JSON.stringify(result).includes(token));
  assert.equal(f.reads.filter(r => r === "provider_spend_reservations").length, 1);
  assert.equal(result.accountAndFleetCapacity, "not_inspected");
});

test("terminal, expired and retrying work retain capacity; audit cannot release or reschedule", async () => {
  const statuses = ["done", "failed", "cancelled", "pending", "running", "expired"];
  const result = await fixture({
    provider_spend_reservations: statuses.map(status => ({ ...base, _id: status })),
    jobs: statuses.map(status => ({ ...base, _id: `job-${status}`, type: "plan", status,
      updatedAt: now, providerSpendReservationId: status, workerAttempts: 1,
      leaseExpiresAt: now - 1, nextAttemptAt: now + 1, providerCostReservedMicroUsd: 100_000,
      error: "private-provider-error", workerToken: "private-worker-token" })),
  }).run();
  assert.equal(result.retainedMicroUsd, 600_000);
  assert.equal(result.sameAccountAsComparison, null);
  for (const r of result.rows as Row[]) {
    assert.equal(r.accountingState, "retained_ceiling");
    const source = (r.sources as Row[])[0];
    assert.equal(source.leaseExpired, true); assert.equal(source.retryScheduled, true);
    assert.equal(source.reservationAmountMatches, true);
  }
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("audit makes mismatches, duplicate source references and truncated windows explicit", async () => {
  const result = await fixture({ provider_spend_reservations: [
    { ...base, _id: "r", settledMicroUsd: -1, settledAt: now },
  ], cadence_micro_seed_jobs: Array.from({ length: 502 }, (_, i) => ({
    ...base, _id: `j${i}`, status: "private-unknown-status", updatedAt: now,
    providerSpendReservationId: "r", providerCostReservedMicroUsd: 99,
  })) }, "different-owner").run("site-b");
  assert.equal(result.sameAccountAsComparison, false);
  assert.equal(result.invalidSettlementCount, 1); assert.equal(result.retainedMicroUsd, 100_000);
  assert.equal(result.siteWindowComplete, true); assert.equal(result.sourceWindowsComplete, false);
  const sources = ((result.rows as Row[])[0].sources as Row[]);
  assert.equal(sources.length, 500);
  assert.ok(sources.every(s => s.status === "other" && s.reservationAmountMatches === false));
  assert.ok(!JSON.stringify(result).includes("private"));
});
