import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTHORITY_DISCOVERY_CANARY_POLICY,
  AUTHORITY_DISCOVERY_ENTITLED_POLICY,
  AuthorityDiscoveryBudgetError,
  authorityDiscoveryPolicyFor,
  consumeAuthorityCandidate,
  consumeAuthorityOpenAiCall,
  consumeAuthorityPageFetch,
  consumeAuthorityProviderCall,
  createAuthorityDiscoveryRuntime,
  evaluateAuthorityDiscoveryCapacity,
  remainingAuthorityDiscoveryMs,
} from "../convex/lib/authorityDiscoveryBudget.ts";
import {
  evaluateSharedProviderCapacity,
  SHARED_PROVIDER_DAILY_CEILING_MICRO_USD,
  SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD,
} from "../convex/lib/providerSpendReservation.ts";

const backlinks = readFileSync("convex/actions/backlinks.ts", "utf8");
const authority = readFileSync("convex/seoAuthority.ts", "utf8");
const authorityBudget = readFileSync(
  "convex/lib/authorityDiscoveryBudget.ts",
  "utf8",
);
const planReservation = readFileSync(
  "convex/lib/planProviderReservation.ts",
  "utf8",
);
const jobs = readFileSync("convex/jobs.ts", "utf8");
const planJobs = readFileSync("convex/planJobs.ts", "utf8");
const planLimits = readFileSync("convex/planLimits.ts", "utf8");
const schema = readFileSync("convex/schema.ts", "utf8");
const sites = readFileSync("convex/sites.ts", "utf8");

test("every advertised plan gets authority discovery within its capacity policy", () => {
  assert.equal(
    authorityDiscoveryPolicyFor({
      trigger: "growth",
      planFeatures: ["max_articles_10"],
    })?.mode,
    "entitled",
  );
  assert.equal(
    authorityDiscoveryPolicyFor({
      trigger: "growth",
      planFeatures: ["seo_authority_discovery"],
    })?.mode,
    "manual_canary",
  );
  assert.equal(
    authorityDiscoveryPolicyFor({
      trigger: "growth",
      planFeatures: [
        "max_sites_1",
        "max_articles_3",
        "seo_authority_discovery",
      ],
    })?.mode,
    "manual_canary",
  );
  assert.equal(
    authorityDiscoveryPolicyFor({
      trigger: "growth",
      planFeatures: [
        "max_sites_10",
        "authority_discovery",
      ],
    })?.mode,
    "manual_canary",
  );
  assert.equal(
    authorityDiscoveryPolicyFor({
      trigger: "growth",
      planFeatures: [
        "max_sites_3",
        "max_articles_10",
        "authority_discovery",
      ],
    })?.mode,
    "entitled",
  );
  assert.equal(
    authorityDiscoveryPolicyFor({ trigger: "growth", planFeatures: [] })?.mode,
    "manual_canary",
  );
  assert.equal(
    authorityDiscoveryPolicyFor({ trigger: "owner", planFeatures: [] })?.mode,
    "manual_canary",
  );
  assert.ok(
    AUTHORITY_DISCOVERY_CANARY_POLICY.providerCallLimit <
      AUTHORITY_DISCOVERY_ENTITLED_POLICY.providerCallLimit,
  );
  assert.ok(
    AUTHORITY_DISCOVERY_CANARY_POLICY.pageFetchLimit <
      AUTHORITY_DISCOVERY_ENTITLED_POLICY.pageFetchLimit,
  );
});

test("active and recently settled site attempts cannot be bypassed by repeat clicks", () => {
  assert.deepEqual(
    evaluateAuthorityDiscoveryCapacity({
      hasActiveReservation: true,
      now: 1_000,
      cooldownMs: 100,
    }),
    { allowed: false, reason: "scan_already_active" },
  );
  assert.deepEqual(
    evaluateAuthorityDiscoveryCapacity({
      hasActiveReservation: false,
      latestSiteAttemptAt: 950,
      now: 1_000,
      cooldownMs: 100,
    }),
    { allowed: false, reason: "site_cooldown" },
  );
});

test("different tenants and features consume one shared fleet day/month budget", () => {
  const firstTenantPlan = evaluateSharedProviderCapacity({
    fleetReservedTodayMicroUsd:
      SHARED_PROVIDER_DAILY_CEILING_MICRO_USD - 2_000_000,
    fleetReservedThisMonthMicroUsd: 10_000_000,
    requestedMicroUsd: 2_000_000,
  });
  assert.deepEqual(firstTenantPlan, { allowed: true });

  // Model the atomic total after tenant A's topic-plan reservation. Tenant B's
  // authority request cannot obtain a separate feature-specific allowance.
  const secondTenantAuthority = evaluateSharedProviderCapacity({
    fleetReservedTodayMicroUsd: SHARED_PROVIDER_DAILY_CEILING_MICRO_USD,
    fleetReservedThisMonthMicroUsd: 12_000_000,
    requestedMicroUsd: 200_000,
  });
  assert.equal(secondTenantAuthority.allowed, false);
  if (!secondTenantAuthority.allowed) {
    assert.equal(
      secondTenantAuthority.reason,
      "provider_fleet_daily_budget_reserved",
    );
  }

  const monthly = evaluateSharedProviderCapacity({
    fleetReservedTodayMicroUsd: 0,
    fleetReservedThisMonthMicroUsd:
      SHARED_PROVIDER_MONTHLY_CEILING_MICRO_USD,
    requestedMicroUsd: 200_000,
  });
  assert.equal(monthly.allowed, false);
  if (!monthly.allowed) {
    assert.equal(
      monthly.reason,
      "provider_fleet_monthly_budget_reserved",
    );
  }
});

test("runtime counters and the total deadline fail closed at exact limits", () => {
  const runtime = createAuthorityDiscoveryRuntime({
    ...AUTHORITY_DISCOVERY_CANARY_POLICY,
    providerCallLimit: 1,
    openAiCallLimit: 1,
    candidateLimit: 1,
    pageFetchLimit: 1,
    totalDeadlineMs: 100,
  }, Date.now());
  assert.ok(consumeAuthorityProviderCall(runtime) > 0);
  assert.throws(
    () => consumeAuthorityProviderCall(runtime),
    (error) =>
      error instanceof AuthorityDiscoveryBudgetError &&
      error.code === "provider_limit",
  );
  assert.ok(consumeAuthorityOpenAiCall(runtime) > 0);
  assert.throws(
    () => consumeAuthorityOpenAiCall(runtime),
    (error) =>
      error instanceof AuthorityDiscoveryBudgetError &&
      error.code === "openai_limit",
  );
  consumeAuthorityCandidate(runtime);
  assert.throws(
    () => consumeAuthorityCandidate(runtime),
    (error) =>
      error instanceof AuthorityDiscoveryBudgetError &&
      error.code === "candidate_limit",
  );
  assert.ok(consumeAuthorityPageFetch(runtime) > 0);
  assert.throws(
    () => consumeAuthorityPageFetch(runtime),
    (error) =>
      error instanceof AuthorityDiscoveryBudgetError &&
      error.code === "page_fetch_limit",
  );

  const expired = createAuthorityDiscoveryRuntime(
    { ...AUTHORITY_DISCOVERY_CANARY_POLICY, totalDeadlineMs: 10 },
    1_000,
  );
  assert.throws(
    () => remainingAuthorityDiscoveryMs(expired, 100, 1_011),
    (error) =>
      error instanceof AuthorityDiscoveryBudgetError &&
      error.code === "deadline_exhausted",
  );
  assert.equal(expired.deadlineExhausted, true);
});

test("public and growth authority paths share reservation, settlement and runtime bounds", () => {
  const runnerStart = backlinks.indexOf("async function runReservedBacklinkAnalysis");
  const publicStart = backlinks.indexOf("export const analyzeBacklinks = action");
  const internalStart = backlinks.indexOf(
    "export const analyzeBacklinksInternal = internalAction",
  );
  const legacyStart = backlinks.indexOf("export const generateOutreach");
  const runner = backlinks.slice(runnerStart, publicStart);
  const publicAction = backlinks.slice(publicStart, internalStart);
  const internalAction = backlinks.slice(internalStart, legacyStart);

  assert.match(runner, /reserveDiscoveryRun/);
  assert.match(runner, /finally\s*\{/);
  assert.match(runner, /settleDiscoveryRun/);
  assert.match(publicAction, /runReservedBacklinkAnalysis/);
  assert.match(publicAction, /trigger: "owner"/);
  assert.match(internalAction, /runReservedBacklinkAnalysis/);
  assert.match(internalAction, /trigger: "growth"/);
  assert.match(authority, /reserveSharedProviderBudget/);
  assert.match(authority, /plan_entitlement_missing/);
  assert.match(authorityBudget, /manual_canary/);
  assert.match(planLimits, /"seo_authority_discovery"/);
  assert.match(authorityBudget, /site_cooldown/);
});

test("provider, model and public-page work has hard time and cardinality bounds", () => {
  assert.match(backlinks, /signal: AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(backlinks, /\{ timeout: openAiTimeoutMs \}/);
  assert.match(backlinks, /timeoutMs: fetchTimeoutMs/);
  assert.match(backlinks, /runtime\.policy\.competitorLimit/);
  assert.match(backlinks, /runtime\.policy\.candidateLimit/);
  assert.match(backlinks, /runtime\.policy\.pageFetchLimit/);
  assert.match(backlinks, /limit: Math\.max\(1, Math\.min\(20,/);
  assert.match(backlinks, /hasExactAnchorHref/);
  assert.match(backlinks, /isSameOrganisationHost/);
});

test("topic plans and authority scans reserve the same immutable provider ledger", () => {
  assert.match(planReservation, /reserveSharedProviderBudget/);
  assert.match(planReservation, /purpose: "topic_plan"/);
  assert.match(authority, /purpose: "authority_discovery"/);
  assert.match(jobs, /providerSpendReservationId/);
  assert.match(planJobs, /providerSpendReservationId/);
  assert.match(schema, /provider_spend_reservations: defineTable/);
  assert.match(schema, /seo_authority_runs: defineTable/);
  assert.match(sites, /"provider_spend_reservations"/);
  assert.match(sites, /"seo_authority_runs"/);
});
