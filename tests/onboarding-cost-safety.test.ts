import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decideOnboardingClaim,
  onboardingFailureCooldownMs,
  onboardingInputFingerprint,
  ONBOARDING_CACHE_VERSION,
  ONBOARDING_FAILURE_COOLDOWN_MS,
  ONBOARDING_LEASE_MS,
  ONBOARDING_PROVIDER_COST_CEILING_MICRO_USD,
  ONBOARDING_REPEATED_FAILURE_COOLDOWN_MS,
  ONBOARDING_SECOND_FAILURE_COOLDOWN_MS,
  ONBOARDING_WORKFLOW,
} from "../convex/lib/onboardingClaim.ts";

const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
const claims = readFileSync("convex/onboardingClaims.ts", "utf8");
const articlePage = readFileSync(
  "src/app/(dashboard)/articles/[id]/page.tsx",
  "utf8",
);
const INPUT_FINGERPRINT = onboardingInputFingerprint("https://acme.test");

function publicAction(name: string, nextMarker: string): string {
  const start = pipeline.indexOf(`export const ${name} = action(`);
  const end = pipeline.indexOf(nextMarker, start);
  assert.ok(start >= 0, `${name} action must exist`);
  assert.ok(end > start, `${name} action must have a stable end marker`);
  return pipeline.slice(start, end);
}

function onboardingJob(
  patch: Partial<{
    status: string;
    result: unknown;
    leaseExpiresAt: number;
    nextAttemptAt: number;
    updatedAt: number;
    payload: unknown;
  }> = {},
) {
  return {
    status: "running",
    payload: {
      workflow: ONBOARDING_WORKFLOW,
      cacheVersion: ONBOARDING_CACHE_VERSION,
      inputFingerprint: INPUT_FINGERPRINT,
    },
    updatedAt: 1_000,
    ...patch,
  };
}

test("successful onboarding is a durable provider-free cache hit", () => {
  const result = { analysis: { siteName: "Acme" }, pages: [] };
  assert.deepEqual(
    decideOnboardingClaim(
      [onboardingJob({ status: "done", result })],
      5_000,
      INPUT_FINGERPRINT,
    ),
    { status: "cached", result },
  );
});

test("one live onboarding lease rejects concurrent duplicate provider work", () => {
  assert.equal(ONBOARDING_LEASE_MS, 15 * 60 * 1000);
  assert.deepEqual(
    decideOnboardingClaim(
      [onboardingJob({ leaseExpiresAt: 20_000 })],
      5_000,
      INPUT_FINGERPRINT,
    ),
    { status: "in_progress", retryAt: 20_000 },
  );
});

test("each real provider pass reserves a small account and fleet envelope", () => {
  assert.equal(ONBOARDING_PROVIDER_COST_CEILING_MICRO_USD, 250_000);
  assert.match(claims, /reserveSharedProviderBudget\(ctx/);
  assert.match(claims, /purpose: "onboarding_analysis"/);
  assert.match(
    claims,
    /reservedMicroUsd: ONBOARDING_PROVIDER_COST_CEILING_MICRO_USD/,
  );
  assert.match(claims, /providerSpendReservationId: reservation\.reservationId/);
  assert.match(claims, /status: "budget_blocked"/);
});

test("failed onboarding is cooled down, then becomes retryable", () => {
  assert.equal(ONBOARDING_FAILURE_COOLDOWN_MS, 15 * 60 * 1000);
  assert.equal(onboardingFailureCooldownMs(1), ONBOARDING_FAILURE_COOLDOWN_MS);
  assert.equal(
    onboardingFailureCooldownMs(2),
    ONBOARDING_SECOND_FAILURE_COOLDOWN_MS,
  );
  assert.equal(
    onboardingFailureCooldownMs(3),
    ONBOARDING_REPEATED_FAILURE_COOLDOWN_MS,
  );
  assert.equal(
    onboardingFailureCooldownMs(99),
    ONBOARDING_REPEATED_FAILURE_COOLDOWN_MS,
  );
  const failed = onboardingJob({
    status: "failed",
    nextAttemptAt: 20_000,
    updatedAt: 4_000,
  });
  assert.deepEqual(decideOnboardingClaim([failed], 5_000, INPUT_FINGERPRINT), {
    status: "cooling_down",
    retryAt: 20_000,
  });
  assert.deepEqual(decideOnboardingClaim([failed], 20_000, INPUT_FINGERPRINT), {
    status: "claim",
  });
});

test("other onboarding workflow versions cannot poison the current cache", () => {
  assert.deepEqual(
    decideOnboardingClaim(
      [
        onboardingJob({
          status: "done",
          result: { stale: true },
          payload: { workflow: "old", cacheVersion: 0 },
        }),
      ],
      5_000,
      INPUT_FINGERPRINT,
    ),
    { status: "claim" },
  );
});

test("changing the normalized site domain invalidates old success and failure receipts", () => {
  assert.equal(
    onboardingInputFingerprint("HTTPS://ACME.TEST///?stale=1#old"),
    "https://acme.test/",
  );
  const oldFingerprint = onboardingInputFingerprint("https://old.example");
  const newFingerprint = onboardingInputFingerprint("https://new.example");
  const oldSuccess = onboardingJob({
    status: "done",
    result: { stale: true },
    payload: {
      workflow: ONBOARDING_WORKFLOW,
      cacheVersion: ONBOARDING_CACHE_VERSION,
      inputFingerprint: oldFingerprint,
    },
  });
  assert.deepEqual(
    decideOnboardingClaim([oldSuccess], 5_000, newFingerprint),
    { status: "claim" },
  );
});

test("core crawl claims before providers and closes the exact receipt", () => {
  const publicBlock = publicAction(
    "crawlAndAnalyze",
    "// Bounded operator/fleet repair",
  );
  const authAt = publicBlock.indexOf("await requireOwnedSite(ctx, siteId)");
  const executeAt = publicBlock.indexOf("executeClaimedCrawlAndAnalyze(ctx, siteId)");
  assert.ok(authAt >= 0 && executeAt > authAt);
  const helperStart = pipeline.indexOf("async function executeClaimedCrawlAndAnalyze");
  const helperEnd = pipeline.indexOf("function cachedCrawledPages", helperStart);
  const block = pipeline.slice(helperStart, helperEnd);
  const claimAt = block.indexOf("internal.onboardingClaims.claim");
  const providerAt = block.indexOf("performCrawlAndAnalyze(ctx, siteId)");
  assert.ok(claimAt >= 0 && providerAt > claimAt);
  assert.match(block, /claim\.status === "cached"/);
  assert.match(block, /claim\.status !== "claimed"/);
  assert.match(publicBlock, /execution\.status === "in_progress"/);
  assert.match(publicBlock, /execution\.status === "cooling_down"/);
  assert.match(publicBlock, /execution\.status === "budget_blocked"/);
  assert.match(block, /internal\.onboardingClaims\.complete/);
  assert.match(block, /internal\.onboardingClaims\.fail/);
});

test("internal onboarding repair uses the same claim, cache, and cooldown", () => {
  const start = pipeline.indexOf(
    "export const repairOnboardingInternal = internalAction(",
  );
  const end = pipeline.indexOf("async function generatePlanHandler", start);
  const block = pipeline.slice(start, end);
  assert.match(block, /executeClaimedCrawlAndAnalyze\(ctx, siteId\)/);
  assert.match(block, /execution\.status === "in_progress"/);
  assert.match(block, /execution\.status === "cooling_down"/);
  assert.match(block, /execution\.status === "budget_blocked"/);
  assert.match(block, /execution\.status === "failed"/);
  assert.doesNotMatch(block, /handleOnboarding\(ctx, siteId\)/);
});

test("onboarding receipts enforce canonical plan activity and cache legacy profiles", () => {
  assert.match(claims, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(claims, /completeLegacyProfile\(site\)/);
  assert.match(claims, /source: "legacy_profile"/);
  assert.match(claims, /onboardingInputFingerprint\(site\.domain\)/);
  assert.match(claims, /pagesMatchSiteDomain\(site\.domain, pages\)/);
  assert.match(claims, /!hasVersionedReceipt/);
  assert.match(claims, /status: "running"/);
  assert.match(claims, /Website analysis lease expired before completion/);
  assert.match(claims, /expiredCurrentRetryAt/);
  assert.match(claims, /onboardingFailureCooldownMs\(failureCount\)/);
  assert.match(claims, /status: "cooling_down"/);
  assert.match(claims, /onboardingFailureCooldownMs\(priorFailures \+ 1\)/);
  assert.doesNotMatch(
    claims,
    /callClaude|openaiClient|anthropicClient|getKeywordMetrics/,
  );
});

for (const legacy of [
  {
    name: "onboardSite",
    next: "async function performCrawlAndAnalyze",
    forbidden: /handleOnboarding/,
  },
  {
    name: "reviewExistingArticle",
    next: "// Publish an approved article",
    forbidden: /reviewExistingArticleHandler/,
  },
  {
    name: "suggestInternalLinks",
    next: "// Cron driver",
    forbidden: /handleLinks/,
  },
] as const) {
  test(`${legacy.name} authenticates and fails closed before provider work`, () => {
    const block = publicAction(legacy.name, legacy.next);
    const authAt = block.indexOf("await requireOwnedSite(ctx, siteId)");
    const disabledAt = block.indexOf("throw new Error(");
    assert.ok(authAt >= 0 && disabledAt > authAt);
    assert.doesNotMatch(block, legacy.forbidden);
  });
}

test("every public owner action uses the account-level execution fence", () => {
  const helperStart = pipeline.indexOf("async function requireOwnedSite");
  const helperEnd = pipeline.indexOf("export const onboardSite", helperStart);
  const helper = pipeline.slice(helperStart, helperEnd);
  assert.match(
    helper,
    /internal\.executionAuthorization\.isSiteExecutionAuthorized/,
  );
});

test("legacy publish queues one bounded quality job instead of reviewing inline", () => {
  const block = publicAction(
    "publishApproved",
    "// Generate an article immediately",
  );
  assert.match(block, /internal\.jobs\.queueQualityRetryIfAbsent/);
  assert.match(block, /internal\.actions\.pipeline\.processSpecificJob/);
  assert.match(block, /queuedForQualityReview: true/);
  assert.match(block, /reason === "revision_limit"/);
  assert.doesNotMatch(block, /reviewExistingArticleHandler/);
});

test("the dashboard no longer exposes the unmetered internal-link action", () => {
  assert.doesNotMatch(
    articlePage,
    /useAction\(api\.actions\.pipeline\.suggestInternalLinks\)/,
  );
  assert.doesNotMatch(articlePage, /onClick=\{handleLinks\}/);
});
