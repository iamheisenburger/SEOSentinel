import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";
import type { Doc } from "../convex/_generated/dataModel";
import { accountDeletionKey } from "../convex/lib/accountDeletion.ts";
import { activeProviderBudgetAuthorization, providerBudgetMonth } from "../convex/lib/providerBudgetAuthorization.ts";
import { reserveSharedProviderBudget, settleSharedProviderReservation, releaseSharedProviderReservation } from "../convex/lib/providerSpendReservation.ts";
import type { MutationCtx } from "../convex/_generated/server";

type Row = Record<string, unknown>;
const now = Date.UTC(2026, 8, 8, 14);
const code = buildSync({ entryPoints: ["convex/providerBudget.ts"], bundle: true,
  platform: "node", format: "cjs", packages: "external", write: false }).outputFiles[0].text;
type Snapshot = { sites: Record<string, Row>; entitlement: Row; authorization: Row | null; reservations: Row[]; timestamp?: number };
function fixture(initial?: Snapshot) {
  let timestamp = initial?.timestamp ?? now;
  const runtimeModule = { exports: {} as Record<string, { _handler: (ctx: unknown, args: unknown) => Promise<Row> }> };
  runInNewContext(code, { module: runtimeModule, exports: runtimeModule.exports,
    require: createRequire(import.meta.url), process: { env: {} }, TextEncoder,
    Date: class extends Date { static now() { return timestamp; } } });
  const features = ["max_sites_unlimited", "max_articles_150"];
  const sites: Record<string, Row> = initial?.sites ?? { a: { _id: "a", userId: "owner", planFeatures: features },
    b: { _id: "b", userId: "owner", planFeatures: features } };
  const entitlement: Row = initial?.entitlement ?? { _id: "ent", userId: "owner", status: "completed", planFeatures: features,
    maxSites: Infinity, maxArticles: 150 };
  let authorization: Row | null = initial?.authorization ?? null;
  const reservations: Row[] = initial?.reservations ?? [];
  let writes = 0;
  const ctx = { db: {
    async get(id: string) { return sites[id] ?? (id === "auth" ? authorization : reservations.find(r => r._id === id) ?? null); },
    async patch(id: string, patch: Row) { const row = id === "ent" ? entitlement : id === "auth" ? authorization : reservations.find(r => r._id === id);
      assert.ok(row); Object.assign(row, patch); writes++; },
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
        async take(limit: number) { return (await chain.collect()).slice(0, limit); } }; return chain;
    },
  } };
  const args = { siteId: "a", comparisonSiteId: "b", month: "2026-09", expectedBaseMonthlyCeilingMicroUsd: 28_000_000,
    monthlyCeilingMicroUsd: 32_000_000, incrementalLimitMicroUsd: 4_000_000, approvalReference: "approved-test-2026-09" };
  return { sites, entitlement, reservations, args, writes: () => writes,
    authorization: () => authorization,
    snapshot: (): Snapshot => structuredClone({ sites, entitlement, authorization, reservations, timestamp }),
    setTime: (value: number) => { timestamp = value; },
    validate: (patch: Row = {}) => runtimeModule.exports.attachCumulativeValidationBudget._handler(ctx, {
      siteId: "a", comparisonSiteId: "b", authorizationId: "auth", expectedMonthlyApprovalReference: args.approvalReference,
      approvalReference: "additional-validation-test", limitMicroUsd: 20_000_000, expiresAt: now + 86_400_000, ...patch }),
    settle: (id: string, actualMicroUsd: number, siteId = "a") => settleSharedProviderReservation(ctx as unknown as MutationCtx,
      { reservationId: id as Doc<"provider_spend_reservations">["_id"], siteId: siteId as Doc<"sites">["_id"], purpose: "cadence_micro_seed", actualMicroUsd,
        reason: "verified_provider_receipt_actual_cost", timestamp: timestamp + 1 }),
    release: (id: string, siteId = "a") => releaseSharedProviderReservation(ctx as unknown as MutationCtx,
      { reservationId: id as Doc<"provider_spend_reservations">["_id"], siteId: siteId as Doc<"sites">["_id"], purpose: "cadence_micro_seed",
        reason: "micro_seed_closed_before_provider_execution", timestamp: timestamp + 1 }),
    approve: (patch: Row = {}) => runtimeModule.exports.approveAccountMonthBudget._handler(ctx, { ...args, ...patch }),
    reserve: (amount = 100_000, at = timestamp + 1, siteId = "a") => reserveSharedProviderBudget(ctx as unknown as MutationCtx,
      { siteId: siteId as Doc<"sites">["_id"], userId: "owner", purpose: "cadence_micro_seed", trigger: "test", reservedMicroUsd: amount, timestamp: at }),
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

async function validationFixture(limitMicroUsd = 20_000_000) {
  const f = fixture();
  const { resolvePlanFromFeatures } = await import("../convex/planLimits.ts");
  f.entitlement.maxSites = resolvePlanFromFeatures(f.entitlement.planFeatures as string[]).maxSites;
  await f.approve(); await f.validate({ limitMicroUsd }); return f;
}

test("cumulative validation attaches once to existing approval without changing its old limits", async () => {
  const f = await validationFixture(); const before = structuredClone(f.authorization());
  const writes = f.writes();
  assert.equal((await f.validate()).created, false); assert.equal(f.writes(), writes);
  assert.deepEqual(structuredClone(f.authorization()), before);
  assert.equal(f.authorization()?.incrementalLimitMicroUsd, 4_000_000);
  assert.equal(f.authorization()?.monthlyCeilingMicroUsd, 32_000_000);
  assert.equal(f.entitlement.providerValidationAuthorizationId, "auth");
  for (const patch of [{ limitMicroUsd: 21_000_000 }, { limitMicroUsd: 19_000_000 },
    { approvalReference: "new-window-reset" }, { expiresAt: now + 85_000_000 }]) {
    await assert.rejects(f.validate(patch), /immutable/);
  }
  const restored = fixture(f.snapshot());
  assert.equal((await restored.validate()).approvedAt, now);
  assert.deepEqual(structuredClone(restored.authorization()), before);
});

test("two sites concurrently reserve against one cumulative total after restart", async () => {
  const seed = await validationFixture();
  seed.reservations.push({ _id: "older-unknown", userId: "owner", siteId: "a", purpose: "cadence_micro_seed",
    reservedMicroUsd: 19_900_000, createdAt: now - 86_400_000 });
  let state = seed.snapshot(), revision = 0, retries = 0;
  async function transaction(siteId: string) {
    for (;;) {
      const observed = revision, f = fixture(structuredClone(state));
      const result = await f.reserve(100_000, now + 1, siteId);
      if (revision !== observed) { retries++; continue; }
      if (f.writes()) { state = f.snapshot(); revision++; }
      return result;
    }
  }
  const results = await Promise.all([transaction("a"), transaction("b")]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.ok(retries > 0);
  const denied = results.find(r => !r.ok)!;
  assert.equal(denied.ok, false);
  if (!denied.ok) { assert.equal(denied.budgetScope, "cumulative_validation"); assert.equal(denied.validationState, "exhausted"); }
  assert.equal(state.reservations.length, 2);
  const restarted = fixture(state), again = await restarted.reserve(1);
  assert.equal(again.ok, false); assert.equal(restarted.reservations.length, 2);
});

test("concurrent validation approval retries preserve one immutable run clock and reject invalid first contracts", async () => {
  const f = await validationFixture();
  const seed = f.snapshot(); delete seed.authorization!.cumulativeValidation; delete seed.entitlement.providerValidationAuthorizationId;
  for (const patch of [{ limitMicroUsd: 20_000_001 }, { limitMicroUsd: 0 }, { expiresAt: now },
    { expiresAt: now + 86_400_001 }, { approvalReference: "bad" }]) {
    const invalid = fixture(structuredClone(seed)); await assert.rejects(invalid.validate(patch), /invalid/); assert.equal(invalid.writes(), 0);
  }
  let state = seed, revision = 0, retries = 0;
  async function transaction() {
    for (;;) {
      const observed = revision, attempt = fixture(structuredClone(state)); const result = await attempt.validate();
      if (revision !== observed) { retries++; continue; }
      if (attempt.writes()) { state = attempt.snapshot(); revision++; } return result;
    }
  }
  const receipts = await Promise.all([transaction(), transaction()]);
  assert.equal(receipts.filter(r => r.created).length, 1); assert.ok(retries > 0);
  assert.equal((state.authorization!.cumulativeValidation as Row).approvedAt, now);
});

test("unknown costs retain full ceilings; settlement replaces once and valid cancellation releases once", async () => {
  const f = await validationFixture(200_000);
  const held = await f.reserve(150_000); assert.ok(held.ok);
  f.reservations[0].settledMicroUsd = 0; // Incomplete/corrupt receipt cannot create headroom.
  const unknown = await f.reserve(60_000); assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.reservedMicroUsd, 150_000);
  delete f.reservations[0].settledMicroUsd;
  assert.equal((await f.settle(held.reservationId, 40_000)).settled, true);
  assert.equal((await f.settle(held.reservationId, 40_000)).settled, false);
  await assert.rejects(f.settle(held.reservationId, 39_999), /changed/);
  await assert.rejects(f.release(held.reservationId), /settled/);
  const unused = await f.reserve(160_000, now + 2, "b"); assert.ok(unused.ok);
  assert.equal((await f.reserve(1, now + 2)).ok, false);
  f.setTime(now + 2);
  await assert.rejects(f.release(unused.reservationId, "a"), /tenant/);
  assert.equal((await f.release(unused.reservationId, "b")).released, true);
  assert.equal((await f.release(unused.reservationId, "b")).released, false);
  assert.ok((await f.reserve(160_000, now + 3, "b")).ok);
  assert.equal(f.reservations.length, 3); // No erased history or duplicate settlement row.
});

test("UTC rollover, changed monthly pointer, deleted site reference and run expiry never renew total", async () => {
  const f = fixture(), start = Date.UTC(2026, 8, 30, 23, 30);
  const { resolvePlanFromFeatures } = await import("../convex/planLimits.ts");
  f.entitlement.maxSites = resolvePlanFromFeatures(f.entitlement.planFeatures as string[]).maxSites;
  f.setTime(start); await f.approve();
  await f.validate({ limitMicroUsd: 200_000, expiresAt: start + 86_400_000 });
  const held = await f.reserve(190_000); assert.ok(held.ok);
  delete f.reservations[0].siteId; // Existing account ledger survives tenant deletion.
  f.entitlement.providerBudgetAuthorizationId = "new-month-approval";
  const restarted = fixture(f.snapshot()); restarted.setTime(start + 3_600_000);
  const nextMonth = await restarted.reserve(20_000); assert.equal(nextMonth.ok, false);
  if (!nextMonth.ok) assert.equal(nextMonth.budgetScope, "cumulative_validation");
  assert.ok((await restarted.reserve(10_000)).ok);
  restarted.setTime(start + 86_400_000);
  const expired = await restarted.reserve(1); assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.validationState, "expired");
  assert.equal((await restarted.validate({ limitMicroUsd: 200_000, expiresAt: start + 86_400_000 })).created, false);
  assert.equal(restarted.entitlement.providerValidationAuthorizationId, "auth");
});

test("validation is conjunctive with old approval, monthly, fleet and tenant guards", async () => {
  const f = await validationFixture();
  f.reservations.push({ userId: "owner", reservedMicroUsd: 4_000_000, createdAt: now });
  const oldFour = await f.reserve(1); assert.equal(oldFour.ok, false);
  if (!oldFour.ok) assert.equal(oldFour.budgetScope, "approved_incremental_window");
  f.reservations[0] = { userId: "owner", reservedMicroUsd: 32_000_000, settledMicroUsd: 32_000_000,
    settledAt: now - 1, settlementReason: "verified_provider_receipt_actual_cost", createdAt: now - 86_400_000 };
  const monthly = await f.reserve(1); assert.equal(monthly.ok, false);
  if (!monthly.ok) { assert.equal(monthly.ceilingMicroUsd, 32_000_000); assert.equal(monthly.budgetScope, undefined); }
  f.reservations.length = 0;
  f.reservations.push({ userId: "other-owner", reservedMicroUsd: 35_000_000, createdAt: now - 86_400_000 });
  const fleet = await f.reserve(1); assert.equal(fleet.ok, false);
  if (!fleet.ok) assert.equal(fleet.reason, "provider_fleet_monthly_budget_reserved");
  f.reservations.length = 0; f.sites.b.userId = "other-owner";
  await assert.rejects(f.validate(), /scope/);
  assert.equal((await f.reserve(1, now + 1, "b")).ok, false);
  assert.ok((await f.reserve(1, now + 1, "a")).ok);
  f.authorization()!.accountKey = accountDeletionKey("another-owner");
  const wrongAnchor = await f.reserve(1); assert.equal(wrongAnchor.ok, false);
  if (!wrongAnchor.ok) assert.equal(wrongAnchor.validationState, "invalid");
});

test("cumulative inventory saturation fails closed without counting another account", async () => {
  const f = await validationFixture();
  for (let i = 0; i < 5001; i++) f.reservations.push({ userId: "owner", reservedMicroUsd: 1, createdAt: now - 86_400_000,
    settledMicroUsd: 0, settledAt: now - 1, settlementReason: "verified_provider_receipt_actual_cost" });
  const result = await f.reserve(1); assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.validationState, "incomplete");
  assert.equal(f.reservations.length, 5001);
});
