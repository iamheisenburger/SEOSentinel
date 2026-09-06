import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName, type FunctionReference } from "convex/server";

const source = buildSync({ entryPoints: ["convex/jobs.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Row = Record<string, unknown>;
type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<unknown> };
const NOW = Date.UTC(2026, 8, 6, 12);

function fixture(siteId = "tenant-a", checkpoint = false) {
  const runtime = { exports: {} as Record<string, Handler> };
  runInNewContext(source, { module: runtime, exports: runtime.exports,
    require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} },
    Date: class extends Date { static now() { return NOW; } } });
  const job: Row = { _id: "job", siteId, type: "article", status: "running",
    workerToken: "owned-worker", workerAttempts: 0, leaseExpiresAt: NOW - 1,
    heartbeatAt: NOW - 1_800_001, updatedAt: NOW - 1_800_001,
    reservationId: "usage", ...(checkpoint ? { articleId: "saved-draft" } : {}) };
  const tables: Record<string, Row[]> = {
    jobs: [job], sites: [{ _id: siteId, userId: "owner" }],
    article_generation_attempts: [{ _id: "attempt", attemptKey: "job:0", status: "reserved" }],
    usage_log: [{ _id: "usage", jobId: "job", type: "article_generated", state: checkpoint ? "settled" : "reserved" }],
    autopilot_alerts: [],
  };
  const writes: string[] = [];
  const wakes: Array<{ at: number; name: string; args: Row }> = [];
  const find = (id: string) => Object.values(tables).flat().find(row => row._id === id);
  const ctx = { db: {
    async get(id: string) { return structuredClone(find(id) ?? null); },
    normalizeId() { return null; },
    async patch(id: string, values: Row) {
      const row = find(id); assert.ok(row); writes.push(id);
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete row[key]; else row[key] = structuredClone(value);
      }
    },
    async delete(id: string) {
      for (const rows of Object.values(tables)) {
        const index = rows.findIndex(row => row._id === id);
        if (index !== -1) { rows.splice(index, 1); writes.push(id); return; }
      }
      assert.fail(`Missing row ${id}`);
    },
    async insert(table: string, values: Row) {
      assert.ok(tables[table], table); const id = `${table}-${tables[table].length}`;
      tables[table].push({ _id: id, ...structuredClone(values) }); writes.push(id); return id;
    },
    query(table: string) {
      assert.ok(tables[table], `Unexpected table ${table}`);
      const predicates: Array<(row: Row) => boolean> = [];
      const range = { eq(key: string, value: unknown) {
        predicates.push(row => row[key] === value); return range;
      } };
      const rows = () => structuredClone(tables[table].filter(row => predicates.every(p => p(row))));
      const chain = {
        withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        async collect() { return rows(); },
        async unique() { const found = rows(); assert.ok(found.length <= 1); return found[0] ?? null; },
        async first() { return rows()[0] ?? null; },
      };
      return chain;
    },
  }, scheduler: {
    async runAt(at: number, ref: FunctionReference<"mutation">, args: Row) {
      wakes.push({ at, name: getFunctionName(ref), args: structuredClone(args) }); return "wake";
    },
  } };
  const run = (name: string, args: Row) => runtime.exports[name]._handler(ctx, args);
  return { job, tables, wakes, writes, run };
}

test("expired article leases atomically arm their exact canonical retry wake for either tenant", async () => {
  for (const siteId of ["tenant-a", "tenant-b"]) {
    for (const checkpoint of [false, true]) {
      const f = fixture(siteId, checkpoint);
      await f.run("resetStuckJobs", { siteId });
      assert.equal(f.job.status, "pending");
      assert.equal(f.job.workerToken, undefined);
      assert.equal(f.job.leaseExpiresAt, undefined);
      assert.equal(f.tables.article_generation_attempts[0].status, "ambiguous");
      assert.equal(f.job.workerAttempts, 1);
      assert.equal(f.job.nextAttemptAt, NOW + 60_000);
      assert.equal(f.wakes.length, 1, "A stored retry timestamp alone does not wake the job");
      assert.equal(f.wakes[0].at, f.job.nextAttemptAt);
      assert.equal(f.wakes[0].name, "autopilot:dispatchSiteFollowup");
      assert.equal(f.wakes[0].args.siteId, siteId);
      assert.equal(f.job.articleId, checkpoint ? "saved-draft" : undefined);
      assert.equal(f.tables.usage_log.length, checkpoint ? 1 : 0);
      const writes = f.writes.length;
      await f.run("resetStuckJobs", { siteId });
      assert.equal(f.wakes.length, 1);
      assert.equal(f.writes.length, writes);
    }
  }
});

test("lease recovery cannot requeue fresh, foreign or exhausted article executions", async () => {
  const fresh = fixture(); fresh.job.leaseExpiresAt = NOW + 1;
  await fresh.run("resetStuckJobs", { siteId: "tenant-a" });
  assert.equal(fresh.writes.length, 0); assert.equal(fresh.wakes.length, 0);
  const foreign = fixture();
  await foreign.run("resetStuckJobs", { siteId: "tenant-b" });
  assert.equal(foreign.writes.length, 0); assert.equal(foreign.wakes.length, 0);
  const exhausted = fixture(); exhausted.job.workerAttempts = 3;
  await exhausted.run("resetStuckJobs", { siteId: "tenant-a" });
  assert.equal(exhausted.job.status, "failed");
  assert.equal(exhausted.job.nextAttemptAt, undefined); assert.equal(exhausted.wakes.length, 0);
});

test("transient failure commits retry and wake together without depending on the action surviving", async () => {
  const f = fixture("tenant-b", true);
  await f.run("markRetryableFailure", { jobId: "job", workerToken: "owned-worker", error: "Provider timeout" });
  assert.equal(f.job.status, "pending");
  assert.equal(f.tables.article_generation_attempts[0].status, "failed");
  assert.equal(f.wakes.length, 1);
  assert.equal(f.wakes[0].at, NOW + 120_000);
  assert.equal(f.wakes[0].name, "autopilot:dispatchSiteFollowup");
  assert.equal(f.wakes[0].args.siteId, "tenant-b");
  assert.equal(f.job.articleId, "saved-draft");
  await f.run("markRetryableFailure", { jobId: "job", workerToken: "owned-worker", error: "Duplicate completion" });
  assert.equal(f.wakes.length, 1);
  assert.equal(f.job.workerAttempts, 1);
});

test("a stale failure or exhausted retry never arms more provider work", async () => {
  const stale = fixture();
  await stale.run("markRetryableFailure", { jobId: "job", workerToken: "wrong", error: "Timeout" });
  assert.equal(stale.writes.length, 0); assert.equal(stale.wakes.length, 0);
  const exhausted = fixture(); exhausted.job.workerAttempts = 3;
  await exhausted.run("markRetryableFailure", { jobId: "job", workerToken: "owned-worker", error: "Timeout" });
  assert.equal(exhausted.job.status, "failed"); assert.equal(exhausted.wakes.length, 0);
});
