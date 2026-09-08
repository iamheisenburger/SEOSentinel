import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { CADENCE_MICRO_SEED_VERSION } from "../convex/lib/cadenceMicroSeed.ts";
import { reserveSharedProviderBudget, summarizeProviderReservationLedger } from "../convex/lib/providerSpendReservation.ts";
import { releaseClosedMicroSeedBeforeProvider } from "../convex/lib/cadenceMicroSeedSettlement.ts";
import type { MutationCtx } from "../convex/_generated/server";
import type { Doc, Id } from "../convex/_generated/dataModel";

type Row = Record<string, unknown>;
const now = Date.UTC(2026, 8, 8, 13);
const code = buildSync({ entryPoints: ["convex/cadenceMicroSeed.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
function fixture(siteId = "site-a") {
  const runtimeModule = { exports: {} as Record<string, { _handler: (ctx: unknown, args: unknown) => Promise<Row | null> }> };
  runInNewContext(code, { module: runtimeModule, exports: runtimeModule.exports,
    require: createRequire(import.meta.url), process: { env: {} }, URL, TextEncoder,
    Date: class extends Date { static now() { return now; } } });
  const site = { _id: siteId, userId: `owner-${siteId}`, autopilotEnabled: true,
    autopilotRolloutMode: "live", autopilotRolloutEpoch: 1, planFeatures: [],
    expectedClickSchedulingEnabled: true };
  const job: Row = { _id: "job", siteId, userId: site.userId, status: "running",
    policyVersion: CADENCE_MICRO_SEED_VERSION, attemptKind: "primary", rolloutEpoch: 1,
    createdAt: now - 1000, updatedAt: now - 1000, workerToken: "lease", leaseExpiresAt: now + 1000,
    workerAttempts: 1, providerCallAttempted: false, providerCallCompleted: false,
    candidateReceipts: [], providerSpendReservationId: "reservation",
    providerCostCeilingMicroUsd: 100_000, providerCostReservedMicroUsd: 100_000,
    reservationDay: "2026-09-08", finalizeAttempts: 0, watchdogRecoveries: 0 };
  const reservation: Row = { _id: "reservation", siteId, userId: site.userId,
    purpose: "cadence_micro_seed", trigger: `cadence_micro_seed_v${CADENCE_MICRO_SEED_VERSION}`,
    reservedMicroUsd: 100_000, createdAt: job.createdAt, reservationDay: job.reservationDay,
    reservationMonth: "2026-09" };
  const patches: Row[] = []; const scheduled: Row[] = [];
  const ctx = { db: {
    async get(id: string) {
      assert.ok([siteId, "job", "reservation"].includes(id), "must not read any unrelated record");
      return id === siteId ? site : id === "job" ? job : reservation;
    },
    async patch(id: string, patch: Row) {
      assert.ok(["job", "reservation"].includes(id)); patches.push({ id, ...patch });
      Object.assign(id === "job" ? job : reservation, patch);
    },
    query(table: string) {
      const range = { eq(key: string, value: unknown) {
        if (key === "siteId") assert.equal(value, siteId); return range;
      }, gte() { return range; } };
      const chain = { withIndex(_index: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        order() { return chain; }, async unique() {
          assert.ok(["account_plan_entitlements", "account_deletion_receipts"].includes(table)); return null;
        }, async take() { assert.equal(table, "jobs"); return []; },
        async paginate() { assert.equal(table, "cadence_micro_seed_jobs"); return { page: [job], isDone: true }; } };
      return chain;
    },
  }, scheduler: { async runAfter(delay: number, _fn: unknown, args: unknown) { scheduled.push({ delay, args }); } } };
  const run = (name: string, args: Row = {}) => runtimeModule.exports[name]._handler(ctx,
    { siteId, jobId: job._id, workerToken: "lease", ...args });
  return { site, job, reservation, patches, scheduled, run };
}

test("pre-provider terminal fence failure releases unused money in the same mutation for either tenant", async () => {
  for (const tenant of ["site-a", "site-b"]) {
    const f = fixture(tenant);
    await f.run("markProviderResponseUnverified", { errorCode: "execution_fence_changed" });
    assert.equal(f.job.status, "missed"); assert.equal(f.job.workerAttempts, 1);
    assert.equal(f.job.providerCallAttempted, false);
    assert.equal(f.reservation.releasedAt, now);
    assert.equal(f.reservation.reservedMicroUsd, 100_000);
    assert.equal(f.scheduled.length, 0);
  }
});

test("historical v11 no-call failure is reconciled once without resetting attempts or reopening the job", async () => {
  const f = fixture();
  Object.assign(f.job, { status: "missed", policyVersion: 11, workerToken: undefined,
    leaseExpiresAt: undefined, completedAt: now - 100, updatedAt: now - 100,
    errorCode: "execution_fence_changed" });
  f.reservation.trigger = "cadence_micro_seed_v11";
  const before = JSON.stringify(f.job);
  const first = await f.run("reconcileVerifiedProviderCosts");
  assert.equal(first?.releasedBeforeProvider, 1); assert.equal(first?.reclaimedMicroUsd, 100_000);
  const second = await f.run("reconcileVerifiedProviderCosts");
  assert.equal(second?.releasedBeforeProvider, 0); assert.equal(second?.reclaimedMicroUsd, 0);
  assert.equal(JSON.stringify(f.job), before);
  assert.equal(f.reservation.releaseReason, "micro_seed_closed_before_provider_execution");
  assert.equal(f.patches.length, 1); assert.equal(f.scheduled.length, 0);
  assert.equal(await f.run("claimWorker", { policyVersion: CADENCE_MICRO_SEED_VERSION }), null);
});

test("cancellation, expiry and permanent pre-call failure reclaim only explicitly unattempted terminal work", async () => {
  for (const status of ["missed", "failed", "cancelled", "expired"]) {
    const f = fixture(); Object.assign(f.job, { status, workerToken: undefined, leaseExpiresAt: undefined,
      completedAt: now - 100, updatedAt: now - 100 });
    assert.equal((await f.run("reconcileVerifiedProviderCosts"))?.releasedBeforeProvider, 1);
    assert.equal(f.job.status, status); assert.equal(f.job.workerAttempts, 1);
  }
  for (const patch of [
    { providerCallAttempted: true }, { providerCallAttempted: undefined }, { providerCallCompleted: true },
    { providerAttemptedAt: now - 200 }, { providerCompletedAt: now - 200 }, { providerRequestTag: "sent" },
    { providerTaskCostUsd: 0 }, { workerToken: "live" }, { leaseExpiresAt: now - 1 },
    { status: "pending" }, { status: "running" }, { status: "completed" }, { policyVersion: 10 },
    { policyVersion: CADENCE_MICRO_SEED_VERSION + 1 }, { completedAt: undefined },
    { completedAt: now + 1 }, { workerAttempts: undefined }, { topicId: "topic" },
    { evidenceJobId: "evidence" }, { candidateReceipts: [{}] }, { candidateAudit: {} },
    { userId: "foreign-owner" }, { siteId: "foreign-site" },
  ]) {
    const f = fixture(); Object.assign(f.job, { status: "missed", workerToken: undefined,
      leaseExpiresAt: undefined, completedAt: now - 100, updatedAt: now - 100, ...patch });
    assert.equal((await f.run("reconcileVerifiedProviderCosts"))?.releasedBeforeProvider, 0, JSON.stringify(patch));
    assert.equal(f.reservation.releasedAt, undefined);
  }
});

test("ownership, amount, purpose, date and settlement mismatches retain money", async () => {
  for (const patch of [{ siteId: "foreign-site" }, { userId: "foreign-owner" },
    { purpose: "topic_plan" }, { trigger: "cadence_micro_seed_v0" }, { reservedMicroUsd: 1 },
    { reservationDay: "2026-09-07" }, { reservationMonth: "2026-08" }, { createdAt: now },
    { settledMicroUsd: 0 }, { settledAt: now }, { releasedAt: now - 1 }]) {
    const f = fixture(); Object.assign(f.job, { status: "missed", workerToken: undefined,
      leaseExpiresAt: undefined, completedAt: now - 100, updatedAt: now - 100 });
    Object.assign(f.reservation, patch);
    assert.equal((await f.run("reconcileVerifiedProviderCosts"))?.releasedBeforeProvider, 0, JSON.stringify(patch));
    assert.equal(f.patches.length, 0);
  }
});

test("paid ambiguous failure retains its ceiling and exact settlement is never also refunded", async () => {
  const f = fixture(); Object.assign(f.job, { providerCallAttempted: true, providerAttemptedAt: now - 500 });
  await f.run("markProviderResponseUnverified", { errorCode: "provider_attempt_ambiguous" });
  assert.equal(f.job.status, "provider_response_unverified");
  assert.equal(f.reservation.releasedAt, undefined);
  const paid = fixture(); Object.assign(paid.job, { status: "completed", workerToken: undefined,
    leaseExpiresAt: undefined, completedAt: now - 100, updatedAt: now - 100,
    providerCallAttempted: true, providerCallCompleted: true,
    providerAttemptedAt: now - 500, providerCompletedAt: now - 200, providerTaskCostUsd: 0.01224 });
  assert.equal((await paid.run("reconcileVerifiedProviderCosts"))?.settled, 1);
  assert.equal(paid.reservation.settledMicroUsd, 12_240);
  assert.equal(paid.reservation.releasedAt, undefined);
  assert.equal((await paid.run("reconcileVerifiedProviderCosts"))?.settled, 0);
  assert.equal(paid.patches.length, 1);
});

test("watchdog fences cancellation and day expiry atomically before releasing, while live pre-call retries keep money", async () => {
  for (const reason of ["cancel", "expiry"]) {
    const f = fixture();
    if (reason === "cancel") f.site.autopilotEnabled = false;
    else { f.job.reservationDay = "2026-09-07"; f.job.createdAt = now - 86_400_000;
      f.reservation.createdAt = f.job.createdAt; f.reservation.reservationDay = "2026-09-07"; }
    assert.equal((await f.run("reconcileWatchdog"))?.action, "terminal_execution_fence_changed");
    assert.equal(f.job.status, "missed"); assert.equal(f.job.workerToken, undefined);
    assert.equal(f.reservation.releasedAt, now);
    await assert.rejects(f.run("beginProviderAttempt"), /worker lease is invalid/);
  }
  const live = fixture();
  // A non-terminal job cannot be released by historical reconciliation even
  // when its lease has expired; the watchdog still owns resumption/closure.
  live.job.leaseExpiresAt = now - 1;
  assert.equal((await live.run("reconcileVerifiedProviderCosts"))?.releasedBeforeProvider, 0);
  assert.equal(live.reservation.releasedAt, undefined);
});

test("concurrent duplicate closures and cross-site reservations preserve the account ceiling under transaction retries", async () => {
  // Optimistic transaction harness: simultaneous operations read a snapshot;
  // only a matching revision can commit, otherwise the real handlers rerun.
  // This models Convex's serializable OCC contract, not a production load test.
  const site = { _id: "site-a", userId: "owner", planFeatures: ["max_sites_unlimited", "max_articles_150"] };
  const base = fixture();
  let state: Record<string, Row> = {
    "site-a": site, "site-b": { ...site, _id: "site-b" },
    job: { ...base.job, userId: "owner", status: "missed", workerToken: undefined,
      leaseExpiresAt: undefined, completedAt: now - 100, updatedAt: now - 100 },
    reservation: { ...base.reservation, userId: "owner" },
    historical: { _id: "historical", siteId: "site-b", userId: "owner",
      reservedMicroUsd: 27_800_160, createdAt: now - 86_400_000 },
  };
  let revision = 0; let retries = 0;
  async function transaction<T>(fn: (ctx: MutationCtx) => Promise<T>): Promise<T> {
    for (;;) {
      const atRevision = revision; const local = structuredClone(state);
      let changed = false;
      const ctx = { db: {
        async get(id: string) { return local[id] ?? null; },
        async patch(id: string, patch: Row) { Object.assign(local[id], patch); changed = true; },
        async insert(table: string, row: Row) { assert.equal(table, "provider_spend_reservations");
          const id = `new-${Object.keys(local).length}`; local[id] = { _id: id, ...row }; changed = true; return id; },
        query(table: string) {
          const predicates: Array<(r: Row) => boolean> = [];
          const range = { eq(k: string, v: unknown) { predicates.push(r => r[k] === v); return range; },
            gte(k: string, v: number) { predicates.push(r => Number(r[k]) >= v); return range; } };
          const chain = { withIndex(_index: string, f: (q: typeof range) => unknown) { f(range); return chain; },
            order() { return chain; }, async unique() {
              assert.ok(["account_deletion_receipts", "account_plan_entitlements"].includes(table)); return null;
            }, async collect() { assert.equal(table, "provider_spend_reservations");
              return Object.values(local).filter(r => r.reservedMicroUsd !== undefined && predicates.every(p => p(r))); },
            async take() { return chain.collect(); } }; return chain;
        },
      } } as unknown as MutationCtx;
      const result = await fn(ctx);
      if (revision !== atRevision) { retries++; continue; }
      if (changed) { state = local; revision++; }
      return result;
    }
  }
  const close = () => transaction(ctx => releaseClosedMicroSeedBeforeProvider(ctx,
    site as unknown as Doc<"sites">, "job" as Id<"cadence_micro_seed_jobs">, now));
  const closures = await Promise.all([close(), close()]);
  assert.equal(closures.filter(r => r.released).length, 1);
  const admissions = await Promise.all(["site-a", "site-b"].map(siteId => transaction(ctx =>
    reserveSharedProviderBudget(ctx, { siteId: siteId as Id<"sites">, userId: "owner",
      purpose: "cadence_micro_seed", trigger: "race-test", reservedMicroUsd: 100_000, timestamp: now }))));
  assert.equal(admissions.filter(r => r.ok).length, 1);
  assert.equal(admissions.find(r => !r.ok)?.reason, "provider_account_monthly_budget_reserved");
  assert.ok(retries >= 2);
  const rows = Object.values(state).filter(r => r.reservedMicroUsd !== undefined);
  const ledger = summarizeProviderReservationLedger(rows as unknown as Parameters<typeof summarizeProviderReservationLedger>[0], "owner", now);
  assert.equal(ledger.accountReservedThisMonthMicroUsd, 27_900_160);
  assert.equal(state.job.workerAttempts, 1); assert.equal(state.job.status, "missed");
});
