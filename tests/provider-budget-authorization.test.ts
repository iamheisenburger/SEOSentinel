import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import type { Doc } from "../convex/_generated/dataModel";
import { accountDeletionKey } from "../convex/lib/accountDeletion.ts";
import { activeProviderBudgetAuthorization, providerBudgetMonth } from "../convex/lib/providerBudgetAuthorization.ts";
import { reserveSharedProviderBudget } from "../convex/lib/providerSpendReservation.ts";
import type { MutationCtx } from "../convex/_generated/server";

type Row = Record<string, unknown>;
const now = Date.UTC(2026, 8, 8, 14);
const code = buildSync({ entryPoints: ["convex/providerBudget.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Snapshot = { sites: Record<string, Row>; entitlement: Row; authorization: Row | null; reservations: Row[] };
function fixture(initial?: Snapshot) {
  const runtimeModule = { exports: {} as Record<string, { _handler: (ctx: unknown, args: unknown) => Promise<Row> }> };
  runInNewContext(code, { module: runtimeModule, exports: runtimeModule.exports,
    require: createRequire(import.meta.url), process: { env: {} }, TextEncoder,
    Date: class extends Date { static now() { return now; } } });
  const features = ["max_sites_unlimited", "max_articles_150"];
  const sites: Record<string, Row> = initial?.sites ?? { a: { _id: "a", userId: "owner", planFeatures: features },
    b: { _id: "b", userId: "owner", planFeatures: features } };
  const entitlement: Row = initial?.entitlement ?? { _id: "ent", userId: "owner", status: "completed", planFeatures: features,
    maxSites: Infinity, maxArticles: 150 };
  let authorization: Row | null = initial?.authorization ?? null;
  const reservations: Row[] = initial?.reservations ?? [];
  let writes = 0;
  const ctx = { db: {
    async get(id: string) { return sites[id] ?? (id === "auth" ? authorization : null); },
    async patch(id: string, patch: Row) { assert.equal(id, "ent"); Object.assign(entitlement, patch); writes++; },
    async insert(table: string, row: Row) { writes++;
      if (table === "provider_budget_authorizations") { assert.equal(authorization, null); authorization = { _id: "auth", ...row }; return "auth"; }
      assert.equal(table, "provider_spend_reservations"); const id = `r${reservations.length}`;
      reservations.push({ _id: id, ...row }); return id;
    },
    query(table: string) {
      const filters: Array<(row: Row) => boolean> = [];
      const range = { eq(key: string, value: unknown) { filters.push(r => r[key] === value); return range; },
        gte(key: string, value: number) { filters.push(r => Number(r[key]) >= value); return range; } };
      const chain = { withIndex(_index: string, fn: (q: typeof range) => unknown) { fn(range); return chain; },
        order() { return chain; }, async unique() {
          if (table === "account_deletion_receipts") return null;
          if (table === "account_plan_entitlements") return entitlement;
          assert.equal(table, "provider_budget_authorizations"); return authorization;
        }, async collect() { assert.equal(table, "provider_spend_reservations"); return reservations.filter(r => filters.every(f => f(r))); },
        async take() { return chain.collect(); } }; return chain;
    },
  } };
  const args = { siteId: "a", comparisonSiteId: "b", month: "2026-09", expectedBaseMonthlyCeilingMicroUsd: 28_000_000,
    monthlyCeilingMicroUsd: 32_000_000, incrementalLimitMicroUsd: 4_000_000, approvalReference: "approved-test-2026-09" };
  return { sites, entitlement, reservations, args, writes: () => writes,
    authorization: () => authorization,
    snapshot: (): Snapshot => structuredClone({ sites, entitlement, authorization, reservations }),
    approve: (patch: Row = {}) => runtimeModule.exports.approveAccountMonthBudget._handler(ctx, { ...args, ...patch }),
    reserve: (amount = 100_000, timestamp = now + 1, siteId = "a") => reserveSharedProviderBudget(ctx as unknown as MutationCtx,
      { siteId: siteId as Doc<"sites">["_id"], userId: "owner", purpose: "cadence_micro_seed", trigger: "test", reservedMicroUsd: amount, timestamp }),
  };
}

test("approval is exact-account, immutable, idempotent and expires without a scheduled mutation", async () => {
  const f = fixture();
  // ResolvePlanFromFeatures represents unlimited site allowance as -1.
  const { resolvePlanFromFeatures } = await import("../convex/planLimits.ts");
  f.entitlement.maxSites = resolvePlanFromFeatures(f.entitlement.planFeatures as string[]).maxSites;
  const first = await f.approve(); assert.equal(first.created, true); assert.equal(first.expiresAt, Date.UTC(2026, 9, 1));
  const second = await f.approve(); assert.equal(second.created, false); assert.equal(second.approvedAt, now);
  assert.equal(f.writes(), 2);
  const row = f.authorization() as unknown as Doc<"provider_budget_authorizations">;
  assert.ok(activeProviderBudgetAuthorization(row, "owner", 28_000_000, now));
  assert.equal(activeProviderBudgetAuthorization(row, "other", 28_000_000, now), null);
  assert.equal(activeProviderBudgetAuthorization(row, "owner", 10_000_000, now), null);
  assert.equal(activeProviderBudgetAuthorization(row, "owner", 28_000_000, Date.UTC(2026, 9, 1)), null);
  assert.equal(activeProviderBudgetAuthorization(row, "owner", 28_000_000, now - 1), null);
  assert.equal("userId" in row, false); assert.equal("siteId" in row, false);
  assert.equal(row.accountKey, accountDeletionKey("owner"));
  for (const patch of [{ approvedAt: NaN }, { approvedAt: Infinity }, { expiresAt: now + 1 },
    { windowStartAt: now }, { month: "2026-08" }, { incrementalLimitMicroUsd: 4_000_001 }]) {
    assert.equal(activeProviderBudgetAuthorization({ ...row, ...patch }, "owner", 28_000_000, now), null);
  }
  await assert.rejects(f.approve({ approvalReference: "different-approved-request" }), /already exists/);
  await assert.rejects(f.approve({ monthlyCeilingMicroUsd: 33_000_000 }), /already exists/);
});

test("concurrent approval retries cannot restart the window and cross-site admissions cannot overspend it", async () => {
  const seed = fixture(); const { resolvePlanFromFeatures } = await import("../convex/planLimits.ts");
  seed.entitlement.maxSites = resolvePlanFromFeatures(seed.entitlement.planFeatures as string[]).maxSites;
  let state = seed.snapshot(); let revision = 0; let retries = 0;
  // Serializable OCC model: conflicted handlers re-read the committed receipt
  // and ledger, just as the production Convex mutation does.
  async function transaction<T>(run: (f: ReturnType<typeof fixture>) => Promise<T>): Promise<T> {
    for (;;) {
      const atRevision = revision; const f = fixture(structuredClone(state));
      const result = await run(f);
      if (atRevision !== revision) { retries++; continue; }
      if (f.writes() > 0) { state = f.snapshot(); revision++; }
      return result;
    }
  }
  const approvals = await Promise.all([transaction(f => f.approve()), transaction(f => f.approve())]);
  assert.equal(approvals.filter(r => r.created).length, 1);
  assert.equal(state.authorization?.approvedAt, now);
  state.reservations.push({ userId: "owner", reservedMicroUsd: 3_850_000, createdAt: now });
  const admissions = await Promise.all(["a", "b"].map(siteId => transaction(f => f.reserve(100_000, now + 1, siteId))));
  assert.equal(admissions.filter(r => r.ok).length, 1);
  assert.equal(state.reservations.length, 2);
  assert.equal(state.reservations.reduce((sum, r) => sum + Number(r.reservedMicroUsd), 0), 3_950_000);
  assert.ok(retries >= 2);
});

test("approved cap preserves incremental, monthly, daily, fleet and expiry guards", async () => {
  const f = fixture(); const { resolvePlanFromFeatures } = await import("../convex/planLimits.ts");
  f.entitlement.maxSites = resolvePlanFromFeatures(f.entitlement.planFeatures as string[]).maxSites;
  f.reservations.push({ userId: "owner", reservedMicroUsd: 27_900_000, createdAt: now - 86_400_000 });
  assert.equal((await f.reserve(200_000)).ok, false);
  await f.approve(); assert.equal((await f.reserve(200_000)).ok, true);
  f.reservations.push({ userId: "owner", reservedMicroUsd: 3_800_000, createdAt: now });
  // An old receipt settlement opens ordinary month capacity, not new approval money.
  f.reservations[0].settledMicroUsd = 20_000_000;
  assert.equal((await f.reserve(1)).ok, false);
  f.reservations.pop();
  f.reservations.push({ userId: "other-owner", reservedMicroUsd: 15_000_000, createdAt: now - 86_400_000 });
  const fleet = await f.reserve(1); assert.equal(fleet.ok, false);
  if (!fleet.ok) assert.equal(fleet.reason, "provider_fleet_monthly_budget_reserved");
  f.reservations.pop();
  f.reservations.push({ userId: "owner", reservedMicroUsd: 9_600_000, createdAt: now - 1 });
  const daily = await f.reserve(1); assert.equal(daily.ok, false);
  if (!daily.ok) assert.equal(daily.reason, "provider_account_daily_budget_reserved");
  f.reservations.length = 0;
  f.reservations.push({ userId: "owner", reservedMicroUsd: 28_000_000, createdAt: Date.UTC(2026, 9, 1) });
  const expired = await f.reserve(1, Date.UTC(2026, 9, 1)); assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.ceilingMicroUsd, 28_000_000);
});

test("scope and contract errors fail before creating an approval", async () => {
  for (const patch of [{ month: "2026-10" }, { incrementalLimitMicroUsd: 4_000_001 },
    { monthlyCeilingMicroUsd: 36_000_000 }, { expectedBaseMonthlyCeilingMicroUsd: 1 },
    { approvalReference: "private email@example.com" }]) {
    const f = fixture(); const { resolvePlanFromFeatures } = await import("../convex/planLimits.ts");
    f.entitlement.maxSites = resolvePlanFromFeatures(f.entitlement.planFeatures as string[]).maxSites;
    await assert.rejects(f.approve(patch), /invalid/); assert.equal(f.writes(), 0);
  }
  const f = fixture(); f.sites.b.userId = "other";
  await assert.rejects(f.approve(), /scope/); assert.equal(f.writes(), 0);
  assert.deepEqual(providerBudgetMonth(Date.UTC(2026, 11, 31)), { month: "2026-12", startAt: Date.UTC(2026, 11, 1), endAt: Date.UTC(2027, 0, 1) });
});
