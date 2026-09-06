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
const start = Date.UTC(2026, 8, 6, 12);
const grace = 12 * 60_000;

function fixture() {
  let now = start;
  let rejectWake = false;
  const runtime = { exports: {} as Record<string, Handler> };
  runInNewContext(source, { module: runtime, exports: runtime.exports,
    require: createRequire(import.meta.url), URL, TextEncoder, console, process: { env: {} },
    Date: class extends Date { static now() { return now; } } });
  const tables: Record<string, Row[]> = {
    sites: ["a", "b"].map(id => ({ _id: id, userId: `owner-${id}`,
      autopilotEnabled: true, cadencePerWeek: 7, autopilotRolloutMode: "live",
      planFeatures: ["max_sites_unlimited", "max_articles_150"] })),
    account_plan_entitlements: ["a", "b"].map(id => ({ _id: `entitlement-${id}`,
      userId: `owner-${id}`, status: "completed", maxSites: 9999, maxArticles: 150 })),
    account_deletion_receipts: [],
    autopilot_runs: ["a", "b"].map(id => ({ _id: `run-${id}`, siteId: id,
      trigger: "natural", status: "scheduled", scheduledAt: start, heartbeatAt: start })),
    autopilot_health: ["a", "b"].map(id => ({ _id: `health-${id}`, siteId: id,
      lastRunId: `run-${id}`, status: "healthy", heartbeatAt: start,
      nextPublicationDueAt: start + 86_400_000 })),
    autopilot_alerts: [],
  };
  const wakes: Array<{ at: number; name: string; args: Row }> = [];
  const row = (id: string) => Object.values(tables).flat().find(value => value._id === id)!;
  const ctx = {
    db: {
      async get(id: string) { return structuredClone(row(id) ?? null); },
      async patch(id: string, patch: Row) { assert.ok(row(id)); Object.assign(row(id), structuredClone(patch)); },
      async insert(table: string, fields: Row) {
        assert.equal(table, "autopilot_alerts");
        const id = `alert-${tables[table].length}`;
        tables[table].push({ _id: id, ...structuredClone(fields) }); return id;
      },
      query(table: string) {
        assert.ok(tables[table], `Unexpected table ${table}`);
        const predicates: Array<(value: Row) => boolean> = [];
        const range = { eq(key: string, value: unknown) { predicates.push(r => r[key] === value); return range; } };
        const found = () => tables[table].filter(value => predicates.every(p => p(value)));
        const chain = {
          withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
          async first() { return structuredClone(found()[0] ?? null); },
          async unique() { assert.ok(found().length <= 1); return structuredClone(found()[0] ?? null); },
        };
        return chain;
      },
    },
    scheduler: { async runAt(at: number, ref: Parameters<typeof getFunctionName>[0], args: Row) {
      if (rejectWake) throw new Error("Injected scheduling failure");
      wakes.push({ at, name: getFunctionName(ref), args: structuredClone(args) });
    } },
  };
  return { tables, wakes, row, at(value: number) { now = value; },
    rejectWake() { rejectWake = true; },
    async run(name: string, args: Row) {
      assert.ok(runtime.exports[name], `Missing registered handler ${name}`);
      const before = structuredClone(tables); const wakeCount = wakes.length;
      try { return structuredClone(await runtime.exports[name]._handler(ctx, args)); }
      catch (error) {
        for (const [table, rows] of Object.entries(before)) tables[table] = rows;
        wakes.length = wakeCount; rejectWake = false; throw error;
      }
    },
  };
}

test("ordinary run claim atomically arms one provider-free interruption receipt per execution", async () => {
  const f = fixture();
  for (const siteId of ["a", "b"]) {
    const runId = `run-${siteId}`;
    assert.equal((await f.run("markRunStarted", { runId })).started, true);
    assert.equal((await f.run("markRunStarted", { runId })).started, false);
    const wake = f.wakes.find(item => item.args.runId === runId);
    assert.deepEqual(wake, { at: start + grace, name: "autopilot:settleInterruptedRun",
      args: { siteId, runId, expectedStartedAt: start } });
  }
  assert.equal(f.wakes.length, 2);
});

test("failed watchdog scheduling rolls back the run claim and does not leave false live work", async () => {
  const f = fixture(); const before = structuredClone(f.tables);
  f.rejectWake();
  await assert.rejects(f.run("markRunStarted", { runId: "run-a" }), /Injected scheduling failure/);
  assert.deepEqual(f.tables, before); assert.equal(f.wakes.length, 0);
  assert.equal((await f.run("markRunStarted", { runId: "run-a" })).started, true);
  assert.equal(f.wakes.length, 1);
});

test("ordinary claiming cannot take ownership of any fenced run, including an invalid empty fence", async () => {
  for (const claimNonce of ["plan-observer-fence", ""]) {
    const f = fixture(); f.row("run-a").claimNonce = claimNonce;
    const before = structuredClone(f.tables);
    assert.equal((await f.run("markRunStarted", { runId: "run-a" })).started, false);
    assert.deepEqual(f.tables, before); assert.equal(f.wakes.length, 0);
  }
});

test("expired run becomes an interruption failure, never a successful job or a provider replay", async () => {
  for (const siteId of ["a", "b"]) {
    const f = fixture(); const runId = `run-${siteId}`;
    await f.run("markRunStarted", { runId });
    const args = { siteId, runId, expectedStartedAt: start };
    f.at(start + grace - 1);
    assert.equal((await f.run("settleInterruptedRun", args)).settled, false);
    f.at(start + grace);
    assert.equal((await f.run("settleInterruptedRun", args)).settled, true);
    assert.equal(f.row(runId).status, "failed");
    assert.equal(f.row(runId).outcome, "execution_interrupted");
    assert.equal(f.row(runId).completedAt, start + grace);
    assert.equal(f.row(`health-${siteId}`).status, "run_failed");
    assert.equal(f.row(`health-${siteId}`).nextPublicationDueAt, start + 86_400_000);
    assert.equal(f.row(`health-${siteId}`).lastNaturalCompletedAt, undefined);
    assert.equal(f.tables.autopilot_alerts.length, 1);
    assert.equal(f.wakes.length, 1, "settlement must not replay or schedule paid work");
    const settled = structuredClone(f.tables);
    assert.equal((await f.run("settleInterruptedRun", args)).settled, false);
    assert.deepEqual(f.tables, settled);
  }
});

test("interruption settlement preserves newer health and a late finish cannot rewrite the failed receipt", async () => {
  const f = fixture(); await f.run("markRunStarted", { runId: "run-a" });
  Object.assign(f.row("health-a"), { lastRunId: "newer-run", status: "buffer_low", heartbeatAt: start + grace });
  const newerHealth = structuredClone(f.row("health-a"));
  f.at(start + grace);
  await f.run("settleInterruptedRun", { siteId: "a", runId: "run-a", expectedStartedAt: start });
  assert.deepEqual(f.row("health-a"), newerHealth);
  assert.equal(f.tables.autopilot_alerts.length, 0);
  assert.equal((await f.run("markRunFinished", { runId: "run-a", outcome: "buffer_ready" })).updated, false);
  assert.deepEqual(f.row("health-a"), newerHealth);
  assert.equal(f.row("run-a").outcome, "execution_interrupted");
});

test("tenant, execution identity, terminal state and long-lived fenced continuations are immutable boundaries", async () => {
  for (const patch of [{ status: "completed" }, { status: "failed" },
    { status: "scheduled" }, { startedAt: start + 1 }, { startedAt: undefined },
    { claimNonce: "separate-plan-observer" }]) {
    const f = fixture(); await f.run("markRunStarted", { runId: "run-a" });
    Object.assign(f.row("run-a"), patch); f.at(start + grace * 2);
    const before = structuredClone(f.tables);
    assert.equal((await f.run("settleInterruptedRun", { siteId: "a", runId: "run-a", expectedStartedAt: start })).settled, false);
    assert.deepEqual(f.tables, before);
  }
  for (const args of [{ siteId: "b", runId: "run-a", expectedStartedAt: start },
    { siteId: "a", runId: "missing", expectedStartedAt: start },
    { siteId: "a", runId: "run-a", expectedStartedAt: NaN },
    { siteId: "a", runId: "run-a", expectedStartedAt: Infinity }]) {
    const f = fixture(); await f.run("markRunStarted", { runId: "run-a" }); f.at(start + grace * 2);
    const before = structuredClone(f.tables);
    assert.equal((await f.run("settleInterruptedRun", args)).settled, false);
    assert.deepEqual(f.tables, before);
  }
});
