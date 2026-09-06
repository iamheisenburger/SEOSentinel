import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";
import { CADENCE_BALANCE_RECHECK_MS } from "../convex/lib/cadenceLiveness.ts";
import { articleGenerationAttemptMonth } from "../convex/lib/articleGenerationAttempt.ts";

const bundled = buildSync({ entryPoints: ["convex/jobs.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Row = Record<string, unknown>;
type Handler = { _handler: (ctx: unknown, args: unknown) => Promise<Row> };

function fixture(owner = "tenant-a") {
  const timestamp = Date.UTC(2026, 8, 6, 1);
  const runtimeModule = { exports: {} as Record<string, Handler> };
  runInNewContext(bundled, { module: runtimeModule, exports: runtimeModule.exports,
    require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} },
    Date: class extends Date { static now() { return timestamp; } } });
  const site: Row = { _id: "site", userId: owner, domain: "example.org",
    autopilotEnabled: true, autopilotRolloutMode: "live", autopilotRolloutEpoch: 4 };
  const job: Row = { _id: "job", siteId: "site", type: "article", status: "running",
    rolloutEpoch: 4, workerToken: "first-worker", workerAttempts: 0,
    leaseExpiresAt: timestamp + 60_000, reservationId: "usage", createdAt: timestamp - 1000,
    updatedAt: timestamp - 1000, payload: { bufferFill: true } };
  const attempt: Row = { _id: "attempt", userId: owner, jobKey: "job", attemptKey: "job:0",
    workerAttempt: 0, monthKey: articleGenerationAttemptMonth(timestamp), status: "reserved",
    attemptAllowance: 5, expiresAt: timestamp + 60_000, createdAt: timestamp - 1000 };
  const tables: Record<string, Row[]> = {
    sites: [site], jobs: [job], article_generation_attempts: [attempt],
    usage_log: [{ _id: "usage", jobId: "job", siteId: "site", userId: owner,
      type: "article_generated", state: "reserved" }],
    autopilot_alerts: [], account_deletion_receipts: [], account_plan_entitlements: [],
  };
  const writes: string[] = [];
  const scheduled: Array<{ at: number; name: string; args: Row }> = [];
  const find = (id: string) => Object.values(tables).flat().find(row => row._id === id);
  const ctx = {
    db: {
      async get(id: string) { return structuredClone(find(id) ?? null); },
      async patch(id: string, patch: Row) {
        const row = find(id); assert.ok(row); writes.push(id);
        for (const [key, value] of Object.entries(patch)) {
          if (value === undefined) delete row[key]; else row[key] = structuredClone(value);
        }
      },
      async delete(id: string) {
        writes.push(id);
        for (const [table, rows] of Object.entries(tables)) tables[table] = rows.filter(row => row._id !== id);
      },
      async insert(table: string, values: Row) {
        assert.ok(tables[table], table);
        const id = `${table}-${tables[table].length}`;
        tables[table].push({ _id: id, ...structuredClone(values) }); writes.push(id); return id;
      },
      query(table: string) {
        assert.ok(tables[table], `Unexpected table ${table}`);
        const predicates: Array<(row: Row) => boolean> = [];
        const range = {
          eq(key: string, value: unknown) { predicates.push(row => row[key] === value); return range; },
          gt(key: string, value: number) { predicates.push(row => Number(row[key]) > value); return range; },
        };
        const rows = () => structuredClone(tables[table].filter(row => predicates.every(p => p(row))));
        const chain = {
          withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
          filter() { assert.equal(table, "sites"); return chain; },
          async unique() { const found = rows(); assert.ok(found.length <= 1); return found[0] ?? null; },
          async first() { return rows()[0] ?? null; },
          async collect() { return rows(); },
          async take(limit: number) { return rows().slice(0, limit); },
        };
        return chain;
      },
    },
    scheduler: {
      async runAt(at: number, ref: Parameters<typeof getFunctionName>[0], args: Row) {
        scheduled.push({ at, name: getFunctionName(ref), args: structuredClone(args) });
      },
    },
  };
  return { timestamp, site, job, attempt, tables, scheduled, writes,
    run: async (name: string, args: Row) => structuredClone(await runtimeModule.exports[name]._handler(ctx, args)),
    pause: () => runtimeModule.exports.deferArticleProviderFunding._handler(ctx, {
      jobId: "job", workerToken: "first-worker", error: "Article provider outcome (article_provider_funding_unavailable): no available funded capacity",
    }),
    reclaim() { job.status = "running"; job.workerToken = "next-worker"; job.leaseExpiresAt = timestamp + 60_000; },
    reserve() { return this.run("reserveArticleProviderAttempt", {
      jobId: "job", siteId: "site", workerToken: "next-worker", providerWorkKind: "generation",
    }); },
  };
}

test("actual funding deferral preserves one attempt, releases only unspent usage and arms one future wake", async () => {
  for (const owner of ["tenant-a", "tenant-b"]) {
    const f = fixture(owner);
    const originalAttemptCreatedAt = f.attempt.createdAt;
    const result = await f.pause();
    assert.equal(result.deferred, true);
    assert.equal(f.job.status, "pending");
    assert.equal(f.job.workerToken, undefined);
    assert.equal(f.job.workerAttempts, 0);
    assert.equal(f.attempt.status, "funding_paused");
    assert.equal(f.attempt.expiresAt, undefined);
    assert.equal(f.attempt.createdAt, originalAttemptCreatedAt);
    assert.equal(f.tables.usage_log.length, 0);
    assert.equal(f.tables.article_generation_attempts.length, 1);
    assert.equal(f.job.nextAttemptAt, f.timestamp + CADENCE_BALANCE_RECHECK_MS);
    assert.deepEqual(f.scheduled.map(s => [s.at, s.name, s.args.siteId]), [
      [f.timestamp + CADENCE_BALANCE_RECHECK_MS, "autopilot:dispatchSiteFollowup", "site"],
    ]);
    const writesBeforeReplay = f.writes.length;
    assert.equal((await f.pause()).deferred, false);
    assert.equal(f.writes.length, writesBeforeReplay);
    assert.equal(f.scheduled.length, 1);
  }
});

test("actual funding pause cannot discard an existing draft usage receipt or fake a missing attempt", async () => {
  const checkpoint = fixture();
  checkpoint.job.articleId = "draft";
  await checkpoint.pause();
  assert.equal(checkpoint.tables.usage_log.length, 1);
  assert.equal(checkpoint.job.reservationId, "usage");
  assert.equal(checkpoint.job.articleId, "draft");
  const missing = fixture();
  missing.tables.article_generation_attempts = [];
  await assert.rejects(missing.pause(), /exact provider-attempt reservation/);
  assert.equal(missing.writes.length, 0);
  assert.equal(missing.scheduled.length, 0);
});

test("actual resumed-worker admission honors current concurrency and then reuses its immutable attempt", async () => {
  for (const mode of ["account", "fleet"]) {
    const f = fixture(); await f.pause(); f.reclaim();
    for (let i = 0; i < (mode === "account" ? 2 : 3); i++) {
      f.tables.article_generation_attempts.push({ _id: `other-${i}`, userId: mode === "account" ? "tenant-a" : `other-${i}`,
        attemptKey: `other-${i}:0`, monthKey: articleGenerationAttemptMonth(f.timestamp),
        status: "reserved", expiresAt: f.timestamp + 60_000 });
    }
    assert.equal((await f.reserve()).reason, `${mode}_concurrency`);
    assert.equal(f.attempt.status, "funding_paused");
    for (const attempt of f.tables.article_generation_attempts.slice(1)) attempt.status = "completed";
    while (f.tables.article_generation_attempts.length < 5) f.tables.article_generation_attempts.push({
      _id: `spent-${f.tables.article_generation_attempts.length}`, userId: "tenant-a",
      monthKey: articleGenerationAttemptMonth(f.timestamp), status: "completed",
    });
    const before = f.tables.article_generation_attempts.length;
    const resumed = await f.reserve();
    assert.equal(resumed.ok, true);
    assert.equal(resumed.reused, true);
    assert.equal(resumed.attemptId, "attempt");
    assert.equal(f.tables.article_generation_attempts.length, before);
    assert.equal(f.attempt.status, "reserved");
    assert.equal(f.job.workerAttempts, 0);
    assert.equal((await f.reserve()).attemptId, "attempt");
  }
});

test("resuming a paused attempt still enforces the current tenant and rollout fence", async () => {
  for (const change of ["owner", "epoch", "paused", "lease"]) {
    const f = fixture(); await f.pause(); f.reclaim();
    if (change === "owner") f.attempt.userId = "another-account";
    if (change === "epoch") f.site.autopilotRolloutEpoch = 5;
    if (change === "paused") f.site.autopilotEnabled = false;
    if (change === "lease") f.job.leaseExpiresAt = f.timestamp;
    assert.equal((await f.reserve()).ok, false);
    assert.equal(f.attempt.status, "funding_paused");
  }
});
