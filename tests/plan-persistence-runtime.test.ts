import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD } from "../convex/lib/planProviderBudget.ts";

const contents = process.env.PLAN_PERSISTENCE_BASELINE_REF
  ? execFileSync("git", ["show", `${process.env.PLAN_PERSISTENCE_BASELINE_REF}:convex/topics.ts`], { encoding: "utf8" })
  : readFileSync("convex/topics.ts", "utf8");
const bundle = buildSync({ stdin: { contents, resolveDir: `${process.cwd()}/convex`, sourcefile: "topics.ts", loader: "ts" }, bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Row = Record<string, unknown>;
const now = Date.UTC(2026, 8, 6, 14);

function fixture(flag: boolean | undefined, id = "a") {
  const createdAt = now - 1000;
  const tables: Record<string, Row[]> = {
    sites: [{ _id: id, userId: `owner-${id}`, domain: `${id}.example`, canonicalDomainRevision: 0,
      autopilotEnabled: true, expectedClickSchedulingEnabled: flag,
      planFeatures: ["max_sites_unlimited", "max_articles_150"] }],
    jobs: [{ _id: "plan", siteId: id, type: "plan", status: "running", workerToken: "lease",
      payload: { manual: true, reason: "owner_requested_plan" }, workerAttempts: 0,
      canonicalDomain: `${id}.example`, domainRevision: 0,
      leaseExpiresAt: now + 60_000, createdAt, updatedAt: createdAt,
      providerSpendReservationId: "spend", providerCostReservationDay: "2026-09-06",
      providerCostCeilingMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
      providerCostReservedMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD }],
    provider_spend_reservations: [{ _id: "spend", siteId: id, userId: `owner-${id}`,
      purpose: "topic_plan", trigger: "topic_plan", createdAt,
      reservationDay: "2026-09-06", reservedMicroUsd: AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD }],
    account_plan_entitlements: [{ _id: "entitlement", userId: `owner-${id}`, status: "completed", maxSites: 9999, maxArticles: 150 }],
    account_deletion_receipts: [], topic_clusters: [], article_summaries: [], articles: [],
  };
  const row = (key: string) => Object.values(tables).flat().find(r => r._id === key);
  const ctx = { db: {
    async get(key: string) { return structuredClone(row(key) ?? null); },
    async patch(key: string, patch: Row) { assert.ok(row(key)); Object.assign(row(key)!, structuredClone(patch)); },
    async insert(table: string, value: Row) {
      assert.equal(table, "topic_clusters"); const key = `topic-${tables[table].length}`;
      tables[table].push({ _id: key, ...structuredClone(value) }); return key;
    },
    query(table: string) {
      assert.ok(tables[table], `Unexpected table ${table}`);
      const predicates: Array<(row: Row) => boolean> = [];
      const range = { eq(key: string, value: unknown) { predicates.push(r => r[key] === value); return range; } };
      const found = () => tables[table].filter(r => predicates.every(p => p(r)));
      const chain = {
        withIndex(_index: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        async collect() { return structuredClone(found()); },
        async first() { return structuredClone(found()[0] ?? null); },
        async unique() { assert.ok(found().length <= 1); return structuredClone(found()[0] ?? null); },
      }; return chain;
    },
  } };
  const runtime = { exports: {} as { upsertMany: { _handler: (ctx: unknown, args: Row) => Promise<Row> } } };
  runInNewContext(bundle, { module: runtime, exports: runtime.exports, require: createRequire(import.meta.url),
    URL, TextEncoder, console, Date: class extends Date { static now() { return now; } } });
  return { tables, row,
    async commit(expectedFlag = flag === true, patch: Row = {}) {
      const before = structuredClone(tables);
      try { return structuredClone(await runtime.exports.upsertMany._handler(ctx, {
        siteId: id, expectedCanonicalDomain: `${id}.example`, expectedDomainRevision: 0,
        topics: [{ label: "Support request assignment workflow", primaryKeyword: "support request assignment workflow", secondaryKeywords: [] }],
        planExecution: { jobId: "plan", workerToken: "lease", workerExecution: 1,
          expectedClickSchedulingEnabled: expectedFlag, commitNonce: "commit-once", rejectZeroAccepted: true, ...patch },
      })); } catch (error) {
        for (const [table, rows] of Object.entries(before)) tables[table] = rows;
        throw error;
      }
    },
  };
}

for (const flag of [undefined, false, true]) test(`ordinary plan persistence uses producer policy semantics (flag=${flag})`, async () => {
  for (const id of ["a", "b"]) {
    const f = fixture(flag, id);
    assert.equal((await f.commit()).inserted, 1);
    assert.equal(f.tables.topic_clusters.length, 1);
    assert.equal(f.row("plan")?.status, "done");
    assert.equal((f.row("plan")?.result as { count: number }).count, 1);
    const committed = structuredClone(f.tables);
    await assert.rejects(f.commit(), /Plan topic persistence lost/);
    assert.deepEqual(f.tables, committed, "a completed paid plan cannot be replayed");
  }
});

test("real policy transitions and exact tenant, lease, execution and spend fences still reject atomically", async () => {
  for (const [flag, expected] of [[true, false], [false, true], [undefined, true]] as const) {
    const f = fixture(flag); const before = structuredClone(f.tables);
    await assert.rejects(f.commit(expected), /Plan topic persistence lost/);
    assert.deepEqual(f.tables, before);
  }
  for (const [key, patch] of [
    ["plan", { siteId: "foreign" }], ["plan", { workerToken: "different" }],
    ["plan", { leaseExpiresAt: now }], ["plan", { workerAttempts: 1 }],
    ["plan", { providerReservationReleasedAt: now }],
    ["plan", { domainRevision: 1 }], ["spend", { reservedMicroUsd: 1 }],
    ["spend", { userId: "foreign" }], ["spend", { releasedAt: now }],
  ] as Array<[string, Row]>) {
    const f = fixture(undefined); Object.assign(f.row(key)!, patch); const before = structuredClone(f.tables);
    await assert.rejects(f.commit(), /Plan topic persistence lost/);
    assert.deepEqual(f.tables, before);
  }
});
