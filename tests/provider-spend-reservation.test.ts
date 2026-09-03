import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  evaluateProviderAccountCapacity,
  PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
  PROVIDER_ACCOUNT_MONTHLY_CEILING_MICRO_USD,
  PROVIDER_OTHER_ACCOUNTS_DAILY_RESERVE_MICRO_USD,
  PROVIDER_OTHER_ACCOUNTS_MONTHLY_RESERVE_MICRO_USD,
  providerAccountMonthlyCeilingMicroUsd,
  SHARED_PROVIDER_DAILY_CEILING_MICRO_USD,
  SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD,
  summarizeProviderReservationLedger,
} from "../convex/lib/providerSpendReservation.ts";

test("every canonical plan has its exact account-level monthly provider ceiling", () => {
  assert.deepEqual(PROVIDER_ACCOUNT_MONTHLY_CEILING_MICRO_USD, {
    free: 2_500_000,
    starter: 5_000_000,
    pro: 10_000_000,
    scale: 20_000_000,
    enterprise: 28_000_000,
  });
  assert.equal(providerAccountMonthlyCeilingMicroUsd("free"), 2_500_000);
  assert.equal(providerAccountMonthlyCeilingMicroUsd("starter"), 5_000_000);
  assert.equal(providerAccountMonthlyCeilingMicroUsd("pro"), 10_000_000);
  assert.equal(providerAccountMonthlyCeilingMicroUsd("scale"), 20_000_000);
  assert.equal(providerAccountMonthlyCeilingMicroUsd("enterprise"), 28_000_000);
});

test("one account cannot reserve the entire daily or monthly fleet wallet", () => {
  assert.equal(PROVIDER_OTHER_ACCOUNTS_DAILY_RESERVE_MICRO_USD, 250_000);
  assert.equal(PROVIDER_OTHER_ACCOUNTS_MONTHLY_RESERVE_MICRO_USD, 7_000_000);
  assert.equal(
    PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD +
      PROVIDER_OTHER_ACCOUNTS_DAILY_RESERVE_MICRO_USD,
    SHARED_PROVIDER_DAILY_CEILING_MICRO_USD,
  );
  assert.equal(
    PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
    2_950_000,
    "one account can fund a complete plan, recovery chain, and bounded policy-upgrade recoveries",
  );
  assert.equal(
    providerAccountMonthlyCeilingMicroUsd("enterprise") +
      PROVIDER_OTHER_ACCOUNTS_MONTHLY_RESERVE_MICRO_USD,
    SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD,
  );
});

test("one account can complete every bounded cadence-recovery phase after a full plan", () => {
  const completePlanAndRecovery =
    2_000_000 + // initial plan plus its one reserved retry/continuation
    100_000 + // primary cadence micro-seed
    50_000 + // fallback cadence micro-seed
    100_000 + // exact demand backfill
    100_000 + // live SERP and authority evidence
    100_000 + // versioned exact-demand recovery
    100_000 + // versioned SERP-evidence recovery
    100_000 + // versioned primary micro-seed recovery
    50_000 + // versioned fallback micro-seed recovery
    100_000 + // category-based primary micro-seed recovery
    50_000 + // category-based fallback micro-seed recovery
    100_000; // exact evidence for the category-based recovery

  assert.equal(
    completePlanAndRecovery,
    PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
  );
  assert.deepEqual(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: completePlanAndRecovery - 100_000,
    accountReservedThisMonthMicroUsd: completePlanAndRecovery - 100_000,
    requestedMicroUsd: 100_000,
    monthlyCeilingMicroUsd: 5_000_000,
  }), { allowed: true });
  assert.equal(evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: completePlanAndRecovery,
    accountReservedThisMonthMicroUsd: completePlanAndRecovery,
    requestedMicroUsd: 1,
    monthlyCeilingMicroUsd: 5_000_000,
  }).allowed, false);
});

test("account daily and tier monthly ceilings fail closed with stable reasons", () => {
  assert.deepEqual(
    evaluateProviderAccountCapacity({
      accountReservedTodayMicroUsd:
        PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD - 100_000,
      accountReservedThisMonthMicroUsd: 2_400_000,
      requestedMicroUsd: 100_000,
      monthlyCeilingMicroUsd: 2_500_000,
    }),
    { allowed: true },
  );

  assert.deepEqual(
    evaluateProviderAccountCapacity({
      accountReservedTodayMicroUsd:
        PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
      accountReservedThisMonthMicroUsd: 2_000_000,
      requestedMicroUsd: 1,
      monthlyCeilingMicroUsd: 5_000_000,
    }),
    {
      allowed: false,
      reason: "provider_account_daily_budget_reserved",
      reservedMicroUsd: PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
      ceilingMicroUsd: PROVIDER_ACCOUNT_DAILY_CEILING_MICRO_USD,
    },
  );

  assert.deepEqual(
    evaluateProviderAccountCapacity({
      accountReservedTodayMicroUsd: 0,
      accountReservedThisMonthMicroUsd: 2_500_000,
      requestedMicroUsd: 1,
      monthlyCeilingMicroUsd: 2_500_000,
    }),
    {
      allowed: false,
      reason: "provider_account_monthly_budget_reserved",
      reservedMicroUsd: 2_500_000,
      ceilingMicroUsd: 2_500_000,
    },
  );
});

test("ledger summaries isolate accounts, ignore released rows, and survive site scrubbing", () => {
  const now = Date.UTC(2026, 7, 20, 12);
  const summary = summarizeProviderReservationLedger(
    [
      {
        userId: "owner-a",
        reservedMicroUsd: 100_000,
        createdAt: now - 60_000,
      },
      {
        userId: "owner-a",
        reservedMicroUsd: 200_000,
        createdAt: now - 2 * 24 * 60 * 60 * 1000,
      },
      {
        userId: "owner-b",
        reservedMicroUsd: 300_000,
        createdAt: now - 60_000,
      },
      {
        userId: "owner-a",
        reservedMicroUsd: 400_000,
        releasedAt: now - 30_000,
        createdAt: now - 60_000,
      },
      {
        userId: "owner-a",
        reservedMicroUsd: 500_000,
        createdAt: Date.UTC(2026, 6, 31, 23, 59),
      },
    ],
    "owner-a",
    now,
  );

  assert.deepEqual(summary, {
    fleetReservedTodayMicroUsd: 400_000,
    fleetReservedThisMonthMicroUsd: 600_000,
    accountReservedTodayMicroUsd: 100_000,
    accountReservedThisMonthMicroUsd: 300_000,
  });
});

test("atomic reservation re-reads ownership and applies account capacity before fleet capacity", () => {
  const source = readFileSync(
    "convex/lib/providerSpendReservation.ts",
    "utf8",
  );
  const reserve = source.slice(
    source.indexOf("export async function reserveSharedProviderBudget"),
    source.indexOf("export async function releaseSharedProviderReservation"),
  );
  const siteRead = reserve.indexOf("ctx.db.get(args.siteId)");
  const ownerCheck = reserve.indexOf("site.userId !== args.userId");
  const tierResolution = reserve.indexOf("resolvePlanFromFeatures(");
  const accountCheck = reserve.indexOf("evaluateProviderAccountCapacity(");
  const fleetCheck = reserve.indexOf("evaluateSharedProviderCapacity(");
  const insert = reserve.indexOf('ctx.db.insert("provider_spend_reservations"');

  assert.ok(siteRead >= 0);
  assert.ok(siteRead < ownerCheck);
  assert.ok(ownerCheck < tierResolution);
  assert.ok(tierResolution < accountCheck);
  assert.ok(accountCheck < fleetCheck);
  assert.ok(fleetCheck < insert);
  assert.match(reserve, /reason: "provider_account_entitlement_unavailable"/);
  assert.match(reserve, /summarizeProviderReservationLedger\([\s\S]*site\.userId/);
});
