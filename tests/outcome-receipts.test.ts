import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aggregateOutcomeRollups,
  constantTimeHexEqual,
  formatOutcomeIngestToken,
  isBrowserOutcomeRequest,
  isOutcomeIngestPubliclyEnabled,
  normalizeOutcomeGoalKey,
  outcomeAttributionOccurredAt,
  outcomeIngestUsageSnapshot,
  outcomePublicationDeliveryHash,
  outcomeTokenHash,
  parseOutcomeBearerToken,
  requireOwnedArticleUrl,
  reserveOutcomeIngestUsage,
  sameOutcomeReceipt,
  sanitizeOutcomeCredential,
  validateOutcomeReceiptCandidate,
  validateOutcomeSessionTransition,
  OUTCOME_ACCEPTED_DAILY_LIMIT,
  OUTCOME_INGEST_SAFETY_VERSION,
  OUTCOME_REJECTED_DAILY_LIMIT,
  OUTCOME_TOKEN_FAILURE_GRACE,
} from "../convex/lib/outcomeReceipts.ts";

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const TOKEN = formatOutcomeIngestToken(new Uint8Array(32).fill(7));
const DELIVERY_KEY = `pentra:${"a".repeat(64)}`;

test("outcome credentials are high-entropy-shaped and tenant-bound", () => {
  assert.match(TOKEN, /^pto_v1_[A-Za-z0-9_-]{43}$/);
  assert.equal(parseOutcomeBearerToken(`Bearer ${TOKEN}`), TOKEN);
  assert.equal(parseOutcomeBearerToken(TOKEN), null);
  const siteA = outcomeTokenHash("site-a", TOKEN);
  const siteB = outcomeTokenHash("site-b", TOKEN);
  assert.notEqual(siteA, siteB);
  assert.equal(constantTimeHexEqual(siteA, siteA), true);
  assert.equal(constantTimeHexEqual(siteA, siteB), false);
});

test("credential status sanitization never exposes the stored digest", () => {
  const safe = sanitizeOutcomeCredential({
    siteId: "site-a",
    tokenHash: "a".repeat(64),
    status: "active",
    version: 2,
    qualifiedActionGoalKey: "free_signup",
  }) as Record<string, unknown>;
  assert.equal("tokenHash" in safe, false);
  assert.equal(safe.configured, true);
  assert.equal(safe.qualifiedActionGoalKey, "free_signup");
});

test("article attribution requires the exact configured HTTPS host and path", () => {
  assert.equal(
    requireOwnedArticleUrl({
      siteDomain: "https://tenant.example",
      expectedArticleUrl: "https://tenant.example/blog/qualified-leads",
      reportedArticleUrl: "https://tenant.example/blog/qualified-leads/",
    }),
    "https://tenant.example/blog/qualified-leads",
  );
  for (const reportedArticleUrl of [
    "https://attacker.example/blog/qualified-leads",
    "https://tenant.example/blog/other-page",
    "https://tenant.example/blog/qualified-leads?utm_source=fake",
    "http://tenant.example/blog/qualified-leads",
  ]) {
    assert.throws(() => requireOwnedArticleUrl({
      siteDomain: "tenant.example",
      expectedArticleUrl: "https://tenant.example/blog/qualified-leads",
      reportedArticleUrl,
    }));
  }
});

test("public delivery keys resolve only the sealed Pentra hash shape", () => {
  const hash = "a".repeat(64);
  assert.equal(outcomePublicationDeliveryHash(`pentra:${hash}`), hash);
  for (const candidate of [
    hash,
    `pentra:${"A".repeat(64)}`,
    `pentra:${"a".repeat(63)}`,
    `other:${hash}`,
  ]) {
    assert.throws(() => outcomePublicationDeliveryHash(candidate));
  }
});

test("receipts fail closed on tenant goal and timestamp boundaries", () => {
  const candidate = {
    siteId: "site-a",
    articleId: "article-a",
    eventId: "evt_12345678",
    eventType: "qualified_action" as const,
    articleUrl: "https://tenant.example/blog/page",
    sessionId: "session_12345678",
    goalKey: "FREE_SIGNUP",
    occurredAt: NOW,
  };
  assert.equal(
    validateOutcomeReceiptCandidate({
      candidate,
      expectedGoalKey: "free_signup",
      now: NOW,
      articlePublishedAt: NOW - 60_000,
    }).goalKey,
    "free_signup",
  );
  assert.throws(() => validateOutcomeReceiptCandidate({
    candidate: { ...candidate, goalKey: "paid_upgrade" },
    expectedGoalKey: "free_signup",
    now: NOW,
  }));
  assert.throws(() => validateOutcomeReceiptCandidate({
    candidate: { ...candidate, occurredAt: NOW + 6 * 60_000 },
    expectedGoalKey: "free_signup",
    now: NOW,
  }));
  assert.throws(() => validateOutcomeReceiptCandidate({
    candidate: { ...candidate, occurredAt: NOW - 60_000 },
    expectedGoalKey: "free_signup",
    now: NOW,
    articlePublishedAt: NOW + 10 * 60_000,
  }));
  assert.equal(normalizeOutcomeGoalKey(" Free_Signup "), "free_signup");
  assert.throws(() =>
    validateOutcomeReceiptCandidate({
      candidate: { ...candidate, eventType: "organic_landing" },
      expectedGoalKey: "free_signup",
      now: NOW,
    })
  );
  assert.equal(
    validateOutcomeReceiptCandidate({
      candidate: {
        ...candidate,
        eventType: "organic_landing",
        publicationDeliveryKey: DELIVERY_KEY,
      },
      expectedGoalKey: "free_signup",
      now: NOW,
    }).publicationDeliveryKey,
    DELIVERY_KEY,
  );
});

test("idempotency accepts an exact replay but rejects event mutation", () => {
  const receipt = {
    siteId: "site-a",
    articleId: "article-a",
    eventId: "evt_12345678",
    eventType: "landing_session" as const,
    articleUrl: "https://tenant.example/blog/page",
    sessionId: "session_12345678",
    goalKey: "free_signup",
    occurredAt: NOW,
  };
  assert.equal(sameOutcomeReceipt(receipt, { ...receipt }), true);
  assert.equal(sameOutcomeReceipt(receipt, {
    ...receipt,
    eventType: "qualified_action",
  }), false);
  assert.equal(sameOutcomeReceipt(receipt, {
    ...receipt,
    siteId: "site-b",
  }), false);
  assert.equal(sameOutcomeReceipt(receipt, {
    ...receipt,
    publicationDeliveryKey: DELIVERY_KEY,
  }), false);
});

test("a session is counted once and actions require their matching landing", () => {
  const landing = {
    siteId: "site-a",
    articleId: "article-a",
    eventId: "evt_landing_123",
    eventType: "landing_session" as const,
    articleUrl: "https://tenant.example/blog/page",
    sessionId: "session_12345678",
    goalKey: "free_signup",
    occurredAt: NOW - 60_000,
  };
  const action = {
    ...landing,
    eventId: "evt_action_1234",
    eventType: "qualified_action" as const,
    occurredAt: NOW,
  };
  assert.deepEqual(
    validateOutcomeSessionTransition([], landing),
    { kind: "insert" },
  );
  assert.deepEqual(validateOutcomeSessionTransition([landing], landing), {
    kind: "duplicate",
    eventId: landing.eventId,
  });
  assert.throws(() =>
    validateOutcomeSessionTransition(
      [landing],
      { ...landing, eventId: "evt_retry_1234" },
    )
  );
  assert.throws(() => validateOutcomeSessionTransition([], action));
  // Even a replayed action is invalid if persistent state has no matching
  // landing. An event id alone is not sufficient evidence of the funnel.
  assert.throws(() => validateOutcomeSessionTransition([action], action));
  assert.throws(() => validateOutcomeSessionTransition([landing], {
    ...action,
    occurredAt: landing.occurredAt - 1,
  }));
  assert.deepEqual(
    validateOutcomeSessionTransition([landing], action),
    { kind: "insert" },
  );
  assert.deepEqual(validateOutcomeSessionTransition([landing, action], action), {
    kind: "duplicate",
    eventId: action.eventId,
  });
  assert.throws(() =>
    validateOutcomeSessionTransition([landing, action], {
      ...action,
      eventId: "evt_retry_5678",
    })
  );
});

test("exact organic attribution requires landing, signup, activation, then paid", () => {
  const organicLanding = {
    siteId: "site-a",
    articleId: "article-a",
    publicationDeliveryKey: DELIVERY_KEY,
    eventId: "evt_organic_123",
    eventType: "organic_landing" as const,
    articleUrl: "https://tenant.example/blog/page",
    sessionId: "attribution_12345678",
    goalKey: "primary_revenue",
    occurredAt: NOW - 4_000,
  };
  const signup = {
    ...organicLanding,
    eventId: "evt_signup_1234",
    eventType: "signup" as const,
    occurredAt: NOW - 3_000,
  };
  const activation = {
    ...organicLanding,
    eventId: "evt_activation_1",
    eventType: "activation" as const,
    occurredAt: NOW - 2_000,
  };
  const paid = {
    ...organicLanding,
    eventId: "evt_paid_123456",
    eventType: "paid_conversion" as const,
    occurredAt: NOW - 1_000,
  };

  assert.deepEqual(validateOutcomeSessionTransition([], organicLanding), {
    kind: "insert",
  });
  assert.throws(() => validateOutcomeSessionTransition([], signup));
  assert.deepEqual(
    validateOutcomeSessionTransition([organicLanding], signup),
    { kind: "insert" },
  );
  assert.equal(
    outcomeAttributionOccurredAt([organicLanding, signup, activation], paid),
    organicLanding.occurredAt,
  );
  assert.equal(outcomeAttributionOccurredAt([], organicLanding), organicLanding.occurredAt);
  assert.throws(() =>
    validateOutcomeSessionTransition([organicLanding, signup], paid)
  );
  assert.deepEqual(
    validateOutcomeSessionTransition([organicLanding, signup], activation),
    { kind: "insert" },
  );
  assert.deepEqual(
    validateOutcomeSessionTransition(
      [organicLanding, signup, activation],
      paid,
    ),
    { kind: "insert" },
  );
  assert.throws(() =>
    validateOutcomeSessionTransition([organicLanding], {
      ...signup,
      eventId: "evt_signup_other",
      occurredAt: organicLanding.occurredAt - 1,
    })
  );
  assert.throws(() =>
    validateOutcomeSessionTransition([organicLanding], {
      ...signup,
      publicationDeliveryKey: `pentra:${"b".repeat(64)}`,
    })
  );
  assert.throws(() =>
    validateOutcomeSessionTransition([organicLanding], {
      ...organicLanding,
      eventType: "qualified_action" as const,
    })
  );
});

test("sessions cannot cross tenant, article, URL, or goal boundaries", () => {
  const landing = {
    siteId: "site-a",
    articleId: "article-a",
    eventId: "evt_landing_123",
    eventType: "landing_session" as const,
    articleUrl: "https://tenant.example/blog/page",
    sessionId: "session_12345678",
    goalKey: "free_signup",
    occurredAt: NOW - 60_000,
  };
  for (const action of [
    { ...landing, siteId: "site-b", eventType: "qualified_action" as const },
    { ...landing, articleId: "article-b", eventType: "qualified_action" as const },
    { ...landing, articleUrl: "https://tenant.example/blog/other", eventType: "qualified_action" as const },
    { ...landing, goalKey: "paid_signup", eventType: "qualified_action" as const },
  ]) {
    assert.throws(() => validateOutcomeSessionTransition([landing], action));
  }
});

test("outcome aggregation remains tenant-isolated and article-specific", () => {
  const result = aggregateOutcomeRollups("site-a", [
    { siteId: "site-a", articleId: "article-1", eventType: "landing_session", goalKey: "signup", count: 10 },
    { siteId: "site-a", articleId: "article-1", eventType: "qualified_action", goalKey: "signup", count: 2 },
    { siteId: "site-a", articleId: "article-2", eventType: "landing_session", goalKey: "signup", count: 5 },
    { siteId: "site-b", articleId: "article-1", eventType: "qualified_action", goalKey: "signup", count: 99 },
  ]);
  assert.equal(result.landingSessions, 15);
  assert.equal(result.qualifiedActions, 2);
  assert.equal(result.byArticle.length, 2);
  assert.deepEqual(
    result.byArticle.find((row) => row.articleId === "article-1"),
    {
      articleId: "article-1",
      landingSessions: 10,
      qualifiedActions: 2,
      organicLandingSessions: 0,
      signups: 0,
      activations: 0,
      paidConversions: 0,
      conversionRate: 0.2,
      organicLandingToSignupRate: 0,
      signupToActivationRate: 0,
      activationToPaidRate: 0,
      organicLandingToPaidRate: 0,
    },
  );
});

test("exact organic funnel aggregation exposes each commercial stage", () => {
  const result = aggregateOutcomeRollups("site-a", [
    { siteId: "site-a", articleId: "article-1", eventType: "organic_landing", goalKey: "primary_revenue", count: 100 },
    { siteId: "site-a", articleId: "article-1", eventType: "signup", goalKey: "primary_revenue", count: 20 },
    { siteId: "site-a", articleId: "article-1", eventType: "activation", goalKey: "primary_revenue", count: 10 },
    { siteId: "site-a", articleId: "article-1", eventType: "paid_conversion", goalKey: "primary_revenue", count: 4 },
  ]);
  assert.equal(result.landingSessions, 100);
  assert.equal(result.organicLandingSessions, 100);
  assert.equal(result.signups, 20);
  assert.equal(result.activations, 10);
  assert.equal(result.paidConversions, 4);
  assert.equal(result.organicLandingToSignupRate, 0.2);
  assert.equal(result.signupToActivationRate, 0.5);
  assert.equal(result.activationToPaidRate, 0.4);
  assert.equal(result.organicLandingToPaidRate, 0.04);
});

test("browser-origin outcome submission is rejected", () => {
  assert.equal(isBrowserOutcomeRequest(new Headers()), false);
  assert.equal(
    isBrowserOutcomeRequest(new Headers({ Origin: "https://tenant.example" })),
    true,
  );
  assert.equal(
    isBrowserOutcomeRequest(new Headers({ "Sec-Fetch-Site": "same-origin" })),
    true,
  );
});

test("public outcome ingestion requires both the operator and safety gates", () => {
  assert.equal(isOutcomeIngestPubliclyEnabled({}), false);
  assert.equal(isOutcomeIngestPubliclyEnabled({ enabled: "true" }), false);
  assert.equal(isOutcomeIngestPubliclyEnabled({
    enabled: "false",
    safetyVersion: OUTCOME_INGEST_SAFETY_VERSION,
  }), false);
  assert.equal(isOutcomeIngestPubliclyEnabled({
    enabled: "true",
    safetyVersion: "stale-version",
  }), false);
  assert.equal(isOutcomeIngestPubliclyEnabled({
    enabled: "true",
    safetyVersion: OUTCOME_INGEST_SAFETY_VERSION,
  }), true);
});

test("accepted and rejected request ceilings are durable per tenant UTC day", () => {
  const acceptedLimit = reserveOutcomeIngestUsage({
    state: {
      usageUtcDate: "2026-08-20",
      acceptedToday: OUTCOME_ACCEPTED_DAILY_LIMIT,
      rejectedToday: 0,
      tokenFailuresToday: 0,
    },
    kind: "accepted",
    now: NOW,
  });
  assert.equal(acceptedLimit.allowed, false);
  if (!acceptedLimit.allowed) {
    assert.equal(acceptedLimit.reason, "accepted_daily_limit");
    assert.ok(acceptedLimit.retryAfterMs > 0);
  }

  const rejectedLimit = reserveOutcomeIngestUsage({
    state: {
      usageUtcDate: "2026-08-20",
      acceptedToday: 0,
      rejectedToday: OUTCOME_REJECTED_DAILY_LIMIT,
      tokenFailuresToday: 0,
    },
    kind: "rejected",
    now: NOW,
  });
  assert.equal(rejectedLimit.allowed, false);
  if (!rejectedLimit.allowed) {
    assert.equal(rejectedLimit.reason, "rejected_daily_limit");
  }

  const nextDay = NOW + 24 * 60 * 60 * 1000;
  const reset = reserveOutcomeIngestUsage({
    state: {
      usageUtcDate: "2026-08-20",
      acceptedToday: OUTCOME_ACCEPTED_DAILY_LIMIT,
      rejectedToday: OUTCOME_REJECTED_DAILY_LIMIT,
      tokenFailuresToday: OUTCOME_REJECTED_DAILY_LIMIT,
      tokenFailureBlockedUntil: nextDay + 60_000,
    },
    kind: "accepted",
    now: nextDay,
  });
  assert.equal(reset.allowed, true);
  if (reset.allowed) {
    assert.equal(reset.patch.usageUtcDate, "2026-08-21");
    assert.equal(reset.patch.acceptedToday, 1);
    assert.equal(reset.patch.rejectedToday, 0);
    assert.equal(reset.patch.tokenFailuresToday, 0);
    assert.equal(reset.patch.tokenFailureBlockedUntil, undefined);
  }
});

test("bad-token failures back off without locking out valid requests", () => {
  let state = {};
  for (let failure = 0; failure <= OUTCOME_TOKEN_FAILURE_GRACE; failure += 1) {
    const reservation = reserveOutcomeIngestUsage({
      state,
      kind: "token_failure",
      now: NOW,
    });
    assert.equal(reservation.allowed, true);
    if (!reservation.allowed) return;
    state = reservation.patch;
  }
  const blocked = reserveOutcomeIngestUsage({
    state,
    kind: "token_failure",
    now: NOW,
  });
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.equal(blocked.reason, "token_backoff");

  // The backoff is deliberately checked only for a token failure. A request
  // whose digest matched can still reserve accepted or validation-rejected
  // volume, so an attacker cannot deny service by knowing only a site id.
  const validRequest = reserveOutcomeIngestUsage({
    state,
    kind: "accepted",
    now: NOW,
  });
  assert.equal(validRequest.allowed, true);
});

test("corrupted same-day usage fails closed instead of reopening quota", () => {
  assert.deepEqual(
    outcomeIngestUsageSnapshot({
      usageUtcDate: "2026-08-20",
      acceptedToday: -1,
      rejectedToday: Number.NaN,
      tokenFailuresToday: Number.POSITIVE_INFINITY,
    }, NOW),
    {
      date: "2026-08-20",
      accepted: OUTCOME_ACCEPTED_DAILY_LIMIT,
      rejected: OUTCOME_REJECTED_DAILY_LIMIT,
      tokenFailures: OUTCOME_REJECTED_DAILY_LIMIT,
      tokenFailureBlockedUntil: undefined,
    },
  );
});

test("backend wiring stores hashes, scopes idempotency, and exposes only safe summaries", () => {
  const schema = readFileSync("convex/schema.ts", "utf8");
  const outcomes = readFileSync("convex/outcomes.ts", "utf8");
  const credentials = readFileSync("convex/actions/outcomeCredentials.ts", "utf8");
  const http = readFileSync("convex/http.ts", "utf8");
  assert.match(schema, /outcome_ingest_credentials:[\s\S]*tokenHash/);
  assert.match(schema, /outcome_ingest_credentials:[\s\S]*acceptedToday/);
  assert.match(schema, /outcome_ingest_credentials:[\s\S]*rejectedToday/);
  assert.match(schema, /outcome_ingest_credentials:[\s\S]*tokenFailureBlockedUntil/);
  assert.match(schema, /\.index\("by_site_event", \["siteId", "eventId"\]\)/);
  assert.match(schema, /\.index\("by_site_session", \["siteId", "sessionId"\]\)/);
  assert.match(
    schema,
    /\.index\("by_site_delivery_hash", \["siteId", "publicationDeliveryHash"\]\)/,
  );
  assert.match(schema, /outcome_daily_rollups/);
  assert.match(schema, /outcome_receipts:[\s\S]*publicationDeliveryKey/);
  assert.match(credentials, /randomBytes\(32\)/);
  assert.match(credentials, /outcomeTokenHash\(String\(siteId\), token\)/);
  assert.match(outcomes, /article\.siteId !== siteId/);
  assert.match(outcomes, /withIndex\("by_site_delivery_hash"/);
  assert.match(outcomes, /article\.publicUrlStatus !== "verified"/);
  assert.match(outcomes, /article\.publicationReceipt\?\.deliveryKey/);
  assert.match(outcomes, /latestFinalPublishedRevision/);
  assert.match(outcomes, /revision\.receipt\?\.deliveryKey/);
  assert.match(outcomes, /publicationDeliveryKey: candidate\.publicationDeliveryKey/);
  assert.match(outcomes, /credential\.qualifiedActionGoalKey/);
  assert.match(outcomes, /siteExecutionAuthorized\(ctx, site\)/);
  assert.match(outcomes, /siteExecutionActive\(site\)/);
  assert.match(outcomes, /sameOutcomeReceipt/);
  assert.match(outcomes, /validateOutcomeSessionTransition/);
  assert.match(outcomes, /export const getOutcomeSummary = query/);
  assert.match(outcomes, /export const getOutcomeSummaryInternal = internalQuery/);
  assert.match(http, /path: "\/outcomes\/v1\/receipts"/);
  assert.match(http, /publicationDeliveryKey/);
  assert.match(http, /isOutcomeIngestPubliclyEnabled/);
  assert.match(http, /process\.env\.OUTCOME_INGEST_SAFETY_VERSION/);
  assert.match(http, /result\.code === "rate_limited"/);
  assert.match(http, /"Retry-After"/);
  assert.match(http, /isBrowserOutcomeRequest/);
  assert.match(http, /presentedTokenHash: outcomeTokenHash/);
  assert.doesNotMatch(http, /token:\s*token[,}]/);
  assert.match(outcomes, /reserveIngestRequest/);
  assert.match(outcomes, /tokenMatches/);
  assert.match(credentials, /export const getIngestRuntimeReadiness = action/);
  assert.match(credentials, /OUTCOME_INGEST_SAFETY_VERSION/);
  assert.match(
    outcomes,
    /usage\.rejected >= OUTCOME_REJECTED_DAILY_LIMIT/,
  );
});
