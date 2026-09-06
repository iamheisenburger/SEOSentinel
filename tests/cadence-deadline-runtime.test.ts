import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";

const source = buildSync({ entryPoints: ["convex/autopilot.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Row = Record<string, unknown>;
type Handler = { _handler: (ctx: unknown, args: Row) => Promise<Row> };
const timestamp = Date.UTC(2026, 8, 6, 12);

function fixture() {
  const runtime = { exports: {} as Record<string, Handler> };
  runInNewContext(source, { module: runtime, exports: runtime.exports,
    require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} },
    Date: class extends Date { static now() { return timestamp; } } });
  const tables: Record<string, Row[]> = {
    sites: ["tenant-a", "tenant-b"].map(siteId => ({ _id: siteId,
      userId: `owner-${siteId}`, autopilotEnabled: true, autopilotRolloutMode: "live",
      cadencePerWeek: 7, approvalRequired: false, publishMethod: "github",
      planFeatures: ["max_sites_unlimited", "max_articles_150"],
    })),
    account_plan_entitlements: ["tenant-a", "tenant-b"].map(siteId => ({
      _id: `entitlement-${siteId}`, userId: `owner-${siteId}`, status: "completed",
      maxSites: 9999, maxArticles: 150,
    })),
    account_deletion_receipts: [], autopilot_runs: [],
  };
  const wakes: Array<{ at: number; name: string; args: Row }> = [];
  let rejectWake = false;
  const ctx = {
    db: {
      async get(id: string) { return structuredClone(Object.values(tables).flat().find(row => row._id === id) ?? null); },
      async insert(table: string, fields: Row) {
        assert.equal(table, "autopilot_runs");
        const id = `run-${tables.autopilot_runs.length}`;
        tables[table].push({ _id: id, ...structuredClone(fields) }); return id;
      },
      query(table: string) {
        assert.ok(tables[table]);
        const predicates: Array<(row: Row) => boolean> = [];
        const range = { eq(key: string, value: unknown) { predicates.push(row => row[key] === value); return range; } };
        const expressions = {
          field: (key: string) => (row: Row) => row[key],
          eq: (field: (row: Row) => unknown, value: unknown) => (row: Row) => field(row) === value,
        };
        const rows = () => tables[table].filter(row => predicates.every(p => p(row)));
        const chain = {
          withIndex(_index: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
          filter(fn: (q: typeof expressions) => (row: Row) => boolean) { predicates.push(fn(expressions)); return chain; },
          async first() { return structuredClone(rows()[0] ?? null); },
          async unique() { assert.ok(rows().length <= 1); return structuredClone(rows()[0] ?? null); },
        };
        return chain;
      },
    },
    scheduler: {
      async runAt(at: number, ref: Parameters<typeof getFunctionName>[0], args: Row) {
        if (rejectWake) throw new Error("Injected scheduler rejection");
        wakes.push({ at, name: getFunctionName(ref), args: structuredClone(args) }); return `wake-${wakes.length}`;
      },
    },
  };
  return { tables, wakes, failNextWake() { rejectWake = true; },
    async run(name: string, args: Row) {
      // Match transaction rollback at the database/scheduler boundary. The
      // real handler must await runAt or its rejection would escape rollback.
      const before = structuredClone(tables); const wakeCount = wakes.length;
      try { return structuredClone(await runtime.exports[name]._handler(ctx, args)); }
      catch (error) {
        for (const [table, rows] of Object.entries(before)) tables[table] = rows;
        wakes.length = wakeCount; rejectWake = false; throw error;
      }
    },
  };
}

test("actual deadline mutation keeps one exact run and action per tenant/deadline under repeated calls", async () => {
  const f = fixture();
  for (let cadence = 1; cadence <= 21; cadence++) {
    const dueAt = timestamp + Math.floor(604_800_000 / cadence);
    for (const siteId of ["tenant-a", "tenant-b"]) {
      f.tables.sites.find(site => site._id === siteId)!.cadencePerWeek = cadence;
      const first = await f.run("scheduleCadenceDeadline", { siteId, dueAt });
      assert.equal(first.scheduled, true);
      for (let duplicate = 0; duplicate < 3; duplicate++) {
        const repeated = await f.run("scheduleCadenceDeadline", { siteId, dueAt });
        assert.equal(repeated.scheduled, false); assert.equal(repeated.runId, first.runId);
      }
      const wakes = f.wakes.filter(wake => wake.at === dueAt && wake.args.siteId === siteId);
      assert.equal(wakes.length, 1);
      assert.equal(wakes[0].name, "actions/pipeline:autopilotTick");
      assert.equal(wakes[0].args.runId, first.runId);
      assert.equal(wakes[0].args.trigger, "cadence_deadline");
    }
  }
  assert.equal(f.wakes.length, 42); assert.equal(f.tables.autopilot_runs.length, 42);
});

test("actual deadline creation remains fail-closed for inactive, approval-only and manual tenants", async () => {
  for (const patch of [{ autopilotEnabled: false }, { cadencePerWeek: 0 },
    { autopilotRolloutMode: "observe" }, { autopilotRolloutMode: "warm" },
    { approvalRequired: true }, { publishMethod: "manual" },
    { deletionStatus: "deleting" }, { planParkedAt: timestamp },
    { domainOwnershipConflictAt: timestamp }, { planFeatures: [] }]) {
    const f = fixture(); Object.assign(f.tables.sites[0], patch);
    assert.equal((await f.run("scheduleCadenceDeadline", { siteId: "tenant-a", dueAt: timestamp + 1 })).scheduled, false);
    assert.equal(f.wakes.length, 0); assert.equal(f.tables.autopilot_runs.length, 0);
  }
  for (const dueAt of [timestamp, timestamp - 1, NaN, Infinity]) {
    const f = fixture();
    assert.equal((await f.run("scheduleCadenceDeadline", { siteId: "tenant-a", dueAt })).scheduled, false);
    assert.equal(f.wakes.length, 0);
  }
});

test("publication and refill/quota deadlines at the same instant cannot suppress each other", async () => {
  const f = fixture(); const args = { siteId: "tenant-a", dueAt: timestamp + 1_000 };
  await f.run("scheduleCadenceDeadline", args);
  for (const trigger of ["cadence_refill_deadline", "quality_budget_deadline", "generation_quota_deadline"]) {
    const first = await f.run("scheduleEligibilityDeadline", { ...args, trigger, reason: "Local acceptance" });
    assert.equal(first.scheduled, true);
    assert.equal((await f.run("scheduleEligibilityDeadline", { ...args, trigger, reason: "Duplicate" })).scheduled, false);
  }
  assert.equal(f.wakes.length, 4);
  assert.equal(new Set(f.wakes.map(wake => wake.args.runId)).size, 4);
  await assert.rejects(f.run("scheduleEligibilityDeadline", { ...args, trigger: "unknown", reason: "Invalid" }), /Unsupported/);
  assert.equal(f.wakes.length, 4);
});

test("scheduler rejection cannot leave a false armed receipt and the same request can retry", async () => {
  for (const name of ["scheduleCadenceDeadline", "scheduleEligibilityDeadline"]) {
    const f = fixture(); f.failNextWake();
    const args = { siteId: "tenant-a", dueAt: timestamp + 1_000,
      ...(name === "scheduleEligibilityDeadline" ? { trigger: "cadence_refill_deadline", reason: "Local acceptance" } : {}) };
    await assert.rejects(f.run(name, args), /Injected scheduler rejection/);
    assert.equal(f.tables.autopilot_runs.length, 0); assert.equal(f.wakes.length, 0);
    assert.equal((await f.run(name, args)).scheduled, true);
    assert.equal(f.tables.autopilot_runs.length, 1); assert.equal(f.wakes.length, 1);
  }
});
