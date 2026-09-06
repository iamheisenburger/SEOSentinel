import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { buildSync } from "esbuild";

type Row = Record<string, unknown>;
const now = Date.UTC(2026, 8, 6, 16);
const code = buildSync({ entryPoints: ["convex/providerBudget.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
function fixture(rows: Row[], siteId = "site-a", siteExists = true) {
  const runtimeModule = { exports: {} as { getSiteReservationSnapshot: {
    _handler: (ctx: unknown, args: unknown) => Promise<Row> } } };
  runInNewContext(code, { module: runtimeModule, exports: runtimeModule.exports,
    require: createRequire(import.meta.url), process: { env: {} },
    Date: class extends Date { static now() { return now; } } });
  const site = { _id: siteId, userId: "owner", token: "private-site-token", planFeatures: [] };
  let queries = 0;
  const ctx = { db: {
    async get(id: string) { assert.equal(id, siteId); return siteExists ? site : null; },
    query(table: string) {
      queries++;
      assert.ok(["account_plan_entitlements", "provider_spend_reservations"].includes(table));
      const predicates: Array<(row: Row) => boolean> = [];
      const expected = table === "account_plan_entitlements" ? { userId: "owner" } : { siteId };
      const range = {
        eq(key: string, value: unknown) {
          assert.equal(value, (expected as Row)[key]); predicates.push(row => row[key] === value); return range;
        },
        gte(key: string, value: number) {
          assert.equal(key, "createdAt"); assert.equal(value, Date.UTC(2026, 8, 1));
          predicates.push(row => Number(row[key]) >= value); return range;
        },
      };
      const chain = {
        withIndex(index: string, fn: (r: typeof range) => unknown) {
          assert.equal(index, table === "account_plan_entitlements" ? "by_user" : "by_site_created");
          fn(range); return chain;
        },
        order(direction: string) { assert.equal(direction, "desc"); return chain; },
        async unique() {
          assert.equal(table, "account_plan_entitlements");
          return { userId: "owner", planFeatures: ["max_sites_unlimited", "max_articles_150"], private: "private-entitlement" };
        },
        async take(limit: number) {
          assert.equal(table, "provider_spend_reservations"); assert.equal(limit, 501);
          return rows.filter(row => predicates.every(p => p(row)))
            .sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, limit);
        },
      }; return chain;
    },
  } };
  return { run: () => runtimeModule.exports.getSiteReservationSnapshot._handler(ctx, { siteId }),
    queries: () => queries };
}

test("real reservation query is exact-site, credential-free and distinguishes consumption from ceilings", async () => {
  for (const siteId of ["site-a", "site-b"]) {
    const base = { siteId, userId: "owner", createdAt: now - 1_000, reservedMicroUsd: 2_000_000, secret: "private-row" };
    const f = fixture([base,
      { ...base, settledMicroUsd: 100_000, settledAt: now },
      { ...base, createdAt: now - 86_400_000 },
      { ...base, releasedAt: now },
      { ...base, userId: "previous-owner" },
      { ...base, siteId: "foreign-site" },
      { ...base, createdAt: Date.UTC(2026, 7, 31) },
    ], siteId);
    const result = await f.run();
    assert.equal(result.siteWindowComplete, true);
    assert.equal(result.examined, 5);
    assert.equal(result.monthlyOriginalMicroUsd, 6_000_000);
    assert.equal(result.monthlyConsumedMicroUsd, 4_100_000);
    assert.equal(result.dailyConsumedMicroUsd, 2_100_000);
    assert.equal(result.settledCount, 1); assert.equal(result.releasedCount, 1);
    assert.equal(result.unmatchedOwnerCount, 1); assert.equal(result.tier, "enterprise");
    assert.equal(result.accountMonthlyHeadroomAtMostMicroUsd, 23_900_000);
    assert.equal(result.accountAndFleetCapacity, "not_inspected");
    for (const forbidden of ["private", "owner\"", "foreign-site", "reservedMicroUsd\""])
      assert.ok(!JSON.stringify(result).includes(forbidden));
    assert.equal(f.queries(), 2);
  }
});

test("overflow is explicitly incomplete and cannot be reported as account capacity", async () => {
  const result = await fixture(Array.from({ length: 502 }, (_, i) => ({
    siteId: "site-a", userId: "owner", reservedMicroUsd: 100_000, createdAt: now - i,
  }))).run();
  assert.equal(result.siteWindowComplete, false); assert.equal(result.examined, 500);
  assert.equal(result.monthlyConsumedMicroUsd, 50_000_000);
  assert.equal(result.accountMonthlyHeadroomAtMostMicroUsd, 0);
  assert.equal(result.accountDailyHeadroomAtMostMicroUsd, 0);
  assert.equal(result.accountAndFleetCapacity, "not_inspected");
});

test("missing site fails before any reservation or entitlement query", async () => {
  const f = fixture([], "missing", false);
  await assert.rejects(f.run(), /Site owner unavailable/);
  assert.equal(f.queries(), 0);
});
