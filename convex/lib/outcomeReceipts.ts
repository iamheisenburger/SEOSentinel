import { normalizeSiteOrigin } from "./articleQuality.ts";
import { sha256Hex } from "./publicationArtifact.ts";

export const OUTCOME_TOKEN_PREFIX = "pto_v1_";
export const OUTCOME_RECEIPT_MAX_AGE_MS = 31 * 24 * 60 * 60 * 1000;
export const OUTCOME_RECEIPT_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const OUTCOME_QUERY_MAX_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;
// These are request ceilings, not billing entitlements. Exact replays consume
// the accepted ceiling too, which prevents a valid credential from turning an
// idempotent event into an unbounded public mutation surface.
export const OUTCOME_ACCEPTED_DAILY_LIMIT = 5_000;
export const OUTCOME_REJECTED_DAILY_LIMIT = 500;
export const OUTCOME_TOKEN_FAILURE_GRACE = 8;
export const OUTCOME_TOKEN_FAILURE_BASE_BLOCK_MS = 1_000;
export const OUTCOME_TOKEN_FAILURE_MAX_BLOCK_MS = 15 * 60 * 1000;
// Bumping this value deliberately keeps a previously reviewed environment
// toggle dark until the operator has reviewed the richer four-stage funnel.
// The endpoint therefore cannot start accepting the new contract because an
// old `tenant-daily-v1` value happened to remain in production.
export const OUTCOME_INGEST_SAFETY_VERSION = "organic-funnel-v1";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const GOAL_KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,63}$/;
const OUTCOME_TOKEN_PATTERN = /^pto_v1_[A-Za-z0-9_-]{43}$/;
const PUBLICATION_DELIVERY_KEY_PATTERN = /^pentra:([a-f0-9]{64})$/;

/**
 * `landing_session` and `qualified_action` are the immutable v1 receipt
 * contract. They remain readable and replayable, but cannot be mixed into the
 * exact v2 organic funnel. New integrations use the four explicit stages so a
 * generic "conversion" can never be presented as a signup, activation, or
 * paid customer.
 */
export type OutcomeEventType =
  | "landing_session"
  | "qualified_action"
  | "organic_landing"
  | "signup"
  | "activation"
  | "paid_conversion";

export const EXACT_ORGANIC_FUNNEL_EVENT_TYPES = Object.freeze([
  "organic_landing",
  "signup",
  "activation",
  "paid_conversion",
] as const satisfies readonly OutcomeEventType[]);

const SUPPORTED_OUTCOME_EVENT_TYPES = new Set<OutcomeEventType>([
  "landing_session",
  "qualified_action",
  ...EXACT_ORGANIC_FUNNEL_EVENT_TYPES,
]);

export function isOutcomeEventType(value: unknown): value is OutcomeEventType {
  return (
    typeof value === "string" &&
    SUPPORTED_OUTCOME_EVENT_TYPES.has(value as OutcomeEventType)
  );
}

export function isExactOrganicFunnelEventType(
  value: OutcomeEventType,
): boolean {
  return EXACT_ORGANIC_FUNNEL_EVENT_TYPES.includes(
    value as (typeof EXACT_ORGANIC_FUNNEL_EVENT_TYPES)[number],
  );
}

export type OutcomeReceiptCandidate = {
  siteId: string;
  articleId: string;
  publicationDeliveryKey?: string;
  eventId: string;
  eventType: OutcomeEventType;
  articleUrl: string;
  sessionId: string;
  goalKey: string;
  occurredAt: number;
};

export type OutcomeAggregateReceipt = {
  siteId: string;
  articleId: string;
  eventType: OutcomeEventType;
  goalKey: string;
  count?: number;
};

export type OutcomeIngestUsageState = {
  usageUtcDate?: string;
  acceptedToday?: number;
  rejectedToday?: number;
  tokenFailuresToday?: number;
  tokenFailureBlockedUntil?: number;
};

export type OutcomeIngestUsageSnapshot = {
  date: string;
  accepted: number;
  rejected: number;
  tokenFailures: number;
  tokenFailureBlockedUntil?: number;
};

export type OutcomeIngestUsageKind =
  | "accepted"
  | "rejected"
  | "token_failure";

export type OutcomeIngestUsageReservation =
  | {
      allowed: true;
      patch: {
        usageUtcDate: string;
        acceptedToday: number;
        rejectedToday: number;
        tokenFailuresToday: number;
        tokenFailureBlockedUntil?: number;
      };
    }
  | {
      allowed: false;
      retryAfterMs: number;
      reason: "accepted_daily_limit" | "rejected_daily_limit" | "token_backoff";
    };

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function formatOutcomeIngestToken(bytes: Uint8Array): string {
  if (bytes.length !== 32) {
    throw new Error("Outcome ingest credentials require exactly 32 random bytes");
  }
  return `${OUTCOME_TOKEN_PREFIX}${base64Url(bytes)}`;
}

export function isValidOutcomeIngestToken(token: string): boolean {
  return OUTCOME_TOKEN_PATTERN.test(token);
}

/** Resolve the sealed, public frontmatter identifier without treating it as a
 * credential. Database callers must still scope the resulting hash by site
 * and confirm the persisted external publication receipt before attribution. */
export function outcomePublicationDeliveryHash(deliveryKey: string): string {
  const match = deliveryKey.trim().match(PUBLICATION_DELIVERY_KEY_PATTERN);
  if (!match) throw new Error("Invalid Pentra publication delivery key");
  return match[1];
}

export function outcomeTokenHash(siteId: string, token: string): string {
  if (!siteId || !isValidOutcomeIngestToken(token)) {
    throw new Error("Invalid outcome ingest credential");
  }
  return sha256Hex(`pentra-outcome-ingest:v1:${siteId}:${token}`);
}

export function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function normalizeOutcomeGoalKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!GOAL_KEY_PATTERN.test(normalized)) {
    throw new Error(
      "Outcome goal keys must contain 3-64 lowercase letters, numbers, dots, colons, underscores, or hyphens",
    );
  }
  return normalized;
}

function normalizeOpaqueId(value: string, label: string): string {
  const normalized = value.trim();
  if (!OPAQUE_ID_PATTERN.test(normalized)) {
    throw new Error(
      `${label} must contain 8-128 URL-safe identifier characters`,
    );
  }
  return normalized;
}

function canonicalOutcomeUrl(value: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "Outcome article URLs must be canonical HTTPS URLs without credentials, query strings, or fragments",
    );
  }
  parsed.pathname = parsed.pathname === "/"
    ? "/"
    : parsed.pathname.replace(/\/+$/, "");
  return parsed.href;
}

export function requireOwnedArticleUrl(input: {
  siteDomain: string;
  expectedArticleUrl: string;
  reportedArticleUrl: string;
}): string {
  const siteOrigin = new URL(normalizeSiteOrigin(input.siteDomain));
  const expected = new URL(canonicalOutcomeUrl(input.expectedArticleUrl));
  const reported = new URL(canonicalOutcomeUrl(input.reportedArticleUrl));
  if (
    expected.hostname !== siteOrigin.hostname ||
    expected.port !== siteOrigin.port ||
    reported.hostname !== siteOrigin.hostname ||
    reported.port !== siteOrigin.port ||
    reported.href !== expected.href
  ) {
    throw new Error("Outcome receipt URL is not the exact owned article URL");
  }
  return reported.href;
}

export function validateOutcomeReceiptCandidate(input: {
  candidate: OutcomeReceiptCandidate;
  expectedGoalKey: string;
  now: number;
  articlePublishedAt?: number;
}): OutcomeReceiptCandidate {
  const eventId = normalizeOpaqueId(input.candidate.eventId, "eventId");
  const sessionId = normalizeOpaqueId(input.candidate.sessionId, "sessionId");
  const goalKey = normalizeOutcomeGoalKey(input.candidate.goalKey);
  const expectedGoalKey = normalizeOutcomeGoalKey(input.expectedGoalKey);
  if (goalKey !== expectedGoalKey) {
    throw new Error("Outcome receipt goal key does not match this tenant");
  }
  if (!isOutcomeEventType(input.candidate.eventType)) {
    throw new Error("Unsupported outcome event type");
  }
  let publicationDeliveryKey = input.candidate.publicationDeliveryKey;
  if (isExactOrganicFunnelEventType(input.candidate.eventType)) {
    const hash = outcomePublicationDeliveryHash(publicationDeliveryKey ?? "");
    publicationDeliveryKey = `pentra:${hash}`;
  }
  if (
    !Number.isSafeInteger(input.candidate.occurredAt) ||
    input.candidate.occurredAt < input.now - OUTCOME_RECEIPT_MAX_AGE_MS ||
    input.candidate.occurredAt > input.now + OUTCOME_RECEIPT_FUTURE_SKEW_MS
  ) {
    throw new Error("Outcome receipt timestamp is outside the accepted window");
  }
  if (
    input.articlePublishedAt !== undefined &&
    input.candidate.occurredAt <
      input.articlePublishedAt - OUTCOME_RECEIPT_FUTURE_SKEW_MS
  ) {
    throw new Error("Outcome receipt predates the published article");
  }
  return {
    ...input.candidate,
    eventId,
    sessionId,
    goalKey,
    publicationDeliveryKey,
  };
}

export function sameOutcomeReceipt(
  existing: OutcomeReceiptCandidate,
  candidate: OutcomeReceiptCandidate,
): boolean {
  return (
    existing.siteId === candidate.siteId &&
    existing.articleId === candidate.articleId &&
    existing.publicationDeliveryKey === candidate.publicationDeliveryKey &&
    existing.eventId === candidate.eventId &&
    existing.eventType === candidate.eventType &&
    existing.articleUrl === candidate.articleUrl &&
    existing.sessionId === candidate.sessionId &&
    existing.goalKey === candidate.goalKey &&
    existing.occurredAt === candidate.occurredAt
  );
}

export type OutcomeSessionTransition =
  | { kind: "insert" }
  | { kind: "duplicate"; eventId: string };

const LEGACY_OUTCOME_EVENT_TYPES = new Set<OutcomeEventType>([
  "landing_session",
  "qualified_action",
]);
const EXACT_OUTCOME_STAGE = new Map<OutcomeEventType, number>(
  EXACT_ORGANIC_FUNNEL_EVENT_TYPES.map((eventType, index) => [
    eventType,
    index,
  ]),
);

/**
 * Enforce a two-step, once-per-session funnel. The database caller queries by
 * tenant + session before calling this helper, so a session cannot be reused
 * to attribute outcomes to a different article or goal. Convex's serializable
 * mutation retries make the read followed by insert safe under concurrency.
 */
export function validateOutcomeSessionTransition(
  existing: OutcomeReceiptCandidate[],
  candidate: OutcomeReceiptCandidate,
): OutcomeSessionTransition {
  if (existing.length > EXACT_ORGANIC_FUNNEL_EVENT_TYPES.length) {
    throw new Error("Outcome session contains too many receipts");
  }
  for (const receipt of existing) {
    if (
      receipt.siteId !== candidate.siteId ||
      receipt.sessionId !== candidate.sessionId ||
      receipt.articleId !== candidate.articleId ||
      receipt.publicationDeliveryKey !== candidate.publicationDeliveryKey ||
      receipt.articleUrl !== candidate.articleUrl ||
      receipt.goalKey !== candidate.goalKey
    ) {
      throw new Error("Outcome session attribution conflicts with the receipt");
    }
  }

  const candidateIsLegacy = LEGACY_OUTCOME_EVENT_TYPES.has(candidate.eventType);
  const containsLegacy = existing.some((receipt) =>
    LEGACY_OUTCOME_EVENT_TYPES.has(receipt.eventType)
  );
  if (
    (candidateIsLegacy && existing.some((receipt) =>
      !LEGACY_OUTCOME_EVENT_TYPES.has(receipt.eventType)
    )) ||
    (!candidateIsLegacy && containsLegacy)
  ) {
    throw new Error("Legacy and exact outcome funnels cannot be mixed");
  }

  if (!candidateIsLegacy) {
    const seen = new Map<OutcomeEventType, OutcomeReceiptCandidate>();
    for (const receipt of existing) {
      if (!EXACT_OUTCOME_STAGE.has(receipt.eventType)) {
        throw new Error("Outcome session contains an unsupported receipt type");
      }
      if (seen.has(receipt.eventType)) {
        throw new Error("Outcome session contains duplicate receipt types");
      }
      seen.set(receipt.eventType, receipt);
    }

    const duplicate = seen.get(candidate.eventType);
    if (duplicate) {
      if (duplicate.eventId !== candidate.eventId) {
        throw new Error("Outcome session contains a conflicting receipt type");
      }
      return { kind: "duplicate", eventId: duplicate.eventId };
    }

    const candidateStage = EXACT_OUTCOME_STAGE.get(candidate.eventType);
    if (candidateStage === undefined) {
      throw new Error("Outcome session contains an unsupported receipt type");
    }
    for (let stage = 0; stage < candidateStage; stage += 1) {
      const requiredType = EXACT_ORGANIC_FUNNEL_EVENT_TYPES[stage];
      const prior = seen.get(requiredType);
      if (!prior) {
        throw new Error(
          `${candidate.eventType} requires a prior ${requiredType} receipt`,
        );
      }
      if (prior.occurredAt > candidate.occurredAt) {
        throw new Error(`${candidate.eventType} predates ${requiredType}`);
      }
    }
    for (
      let stage = candidateStage + 1;
      stage < EXACT_ORGANIC_FUNNEL_EVENT_TYPES.length;
      stage += 1
    ) {
      if (seen.has(EXACT_ORGANIC_FUNNEL_EVENT_TYPES[stage])) {
        throw new Error("Outcome session contains a later stage already");
      }
    }
    return { kind: "insert" };
  }

  const landings = existing.filter(
    (receipt) => receipt.eventType === "landing_session",
  );
  const actions = existing.filter(
    (receipt) => receipt.eventType === "qualified_action",
  );
  if (landings.length > 1 || actions.length > 1) {
    throw new Error("Outcome session contains duplicate receipt types");
  }

  if (candidate.eventType === "landing_session") {
    if (landings[0]) {
      if (landings[0].eventId !== candidate.eventId) {
        throw new Error("Outcome session contains a conflicting receipt type");
      }
      return { kind: "duplicate", eventId: landings[0].eventId };
    }
    if (actions[0]) {
      throw new Error("Outcome action exists without its landing receipt");
    }
    return { kind: "insert" };
  }

  const landing = landings[0];
  if (!landing) {
    throw new Error("Qualified action requires a prior landing session");
  }
  if (landing.occurredAt > candidate.occurredAt) {
    throw new Error("Qualified action predates its landing session");
  }
  if (actions[0]) {
    if (actions[0].eventId !== candidate.eventId) {
      throw new Error("Outcome session contains a conflicting receipt type");
    }
    return { kind: "duplicate", eventId: actions[0].eventId };
  }
  return { kind: "insert" };
}

/**
 * Exact funnel rollups are landing cohorts, not a mixture of event dates. A
 * customer who activates or pays later still belongs to the article visit
 * that earned the signup. Legacy two-step receipts preserve their historical
 * per-event date behavior.
 */
export function outcomeAttributionOccurredAt(
  existing: OutcomeReceiptCandidate[],
  candidate: OutcomeReceiptCandidate,
): number {
  if (LEGACY_OUTCOME_EVENT_TYPES.has(candidate.eventType)) {
    return candidate.occurredAt;
  }
  if (candidate.eventType === "organic_landing") {
    return candidate.occurredAt;
  }
  const landing = existing.find(
    (receipt) => receipt.eventType === "organic_landing",
  );
  if (!landing) {
    throw new Error("Exact outcome attribution requires its organic landing");
  }
  return landing.occurredAt;
}

export function outcomeUtcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function boundedUsageCount(value: number | undefined, limit: number): number {
  if (value === undefined) return 0;
  // Persisted corruption must not silently reopen a public quota.
  return Number.isSafeInteger(value) && value >= 0
    ? Math.min(value, limit)
    : limit;
}

function millisecondsUntilNextUtcDay(now: number): number {
  const current = new Date(now);
  const next = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() + 1,
  );
  return Math.max(1_000, next - now);
}

export function outcomeIngestUsageSnapshot(
  state: OutcomeIngestUsageState,
  now: number,
): OutcomeIngestUsageSnapshot {
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new Error("Outcome ingest usage requires a valid timestamp");
  }
  const date = outcomeUtcDay(now);
  if (state.usageUtcDate !== date) {
    return {
      date,
      accepted: 0,
      rejected: 0,
      tokenFailures: 0,
    };
  }
  return {
    date,
    accepted: boundedUsageCount(
      state.acceptedToday,
      OUTCOME_ACCEPTED_DAILY_LIMIT,
    ),
    rejected: boundedUsageCount(
      state.rejectedToday,
      OUTCOME_REJECTED_DAILY_LIMIT,
    ),
    tokenFailures: boundedUsageCount(
      state.tokenFailuresToday,
      OUTCOME_REJECTED_DAILY_LIMIT,
    ),
    tokenFailureBlockedUntil:
      Number.isSafeInteger(state.tokenFailureBlockedUntil) &&
      (state.tokenFailureBlockedUntil ?? 0) > 0
        ? state.tokenFailureBlockedUntil
        : undefined,
  };
}

/**
 * Atomically reserve one public ingest request against the tenant credential.
 * A bad-token backoff never applies to an authenticated request: the database
 * caller verifies the digest first, then calls this helper with `accepted` or
 * `rejected`. This prevents a third party who knows a site id from locking out
 * that site's real server while still making brute-force failures increasingly
 * expensive and finally fail closed for the rest of the UTC day.
 */
export function reserveOutcomeIngestUsage(input: {
  state: OutcomeIngestUsageState;
  kind: OutcomeIngestUsageKind;
  now: number;
}): OutcomeIngestUsageReservation {
  const snapshot = outcomeIngestUsageSnapshot(input.state, input.now);
  if (
    input.kind === "token_failure" &&
    snapshot.tokenFailureBlockedUntil !== undefined &&
    snapshot.tokenFailureBlockedUntil > input.now
  ) {
    return {
      allowed: false,
      reason: "token_backoff",
      retryAfterMs: snapshot.tokenFailureBlockedUntil - input.now,
    };
  }
  if (
    input.kind === "accepted" &&
    snapshot.accepted >= OUTCOME_ACCEPTED_DAILY_LIMIT
  ) {
    return {
      allowed: false,
      reason: "accepted_daily_limit",
      retryAfterMs: millisecondsUntilNextUtcDay(input.now),
    };
  }
  if (
    input.kind !== "accepted" &&
    snapshot.rejected >= OUTCOME_REJECTED_DAILY_LIMIT
  ) {
    return {
      allowed: false,
      reason: "rejected_daily_limit",
      retryAfterMs: millisecondsUntilNextUtcDay(input.now),
    };
  }

  const accepted = snapshot.accepted + (input.kind === "accepted" ? 1 : 0);
  const rejected = snapshot.rejected + (input.kind === "accepted" ? 0 : 1);
  const tokenFailures =
    snapshot.tokenFailures + (input.kind === "token_failure" ? 1 : 0);
  let tokenFailureBlockedUntil = snapshot.tokenFailureBlockedUntil;
  if (input.kind === "token_failure") {
    const exponent = Math.max(
      0,
      tokenFailures - OUTCOME_TOKEN_FAILURE_GRACE - 1,
    );
    const blockMs = tokenFailures > OUTCOME_TOKEN_FAILURE_GRACE
      ? Math.min(
          OUTCOME_TOKEN_FAILURE_MAX_BLOCK_MS,
          OUTCOME_TOKEN_FAILURE_BASE_BLOCK_MS * (2 ** Math.min(exponent, 20)),
        )
      : 0;
    tokenFailureBlockedUntil = blockMs > 0 ? input.now + blockMs : undefined;
  }
  return {
    allowed: true,
    patch: {
      usageUtcDate: snapshot.date,
      acceptedToday: accepted,
      rejectedToday: rejected,
      tokenFailuresToday: tokenFailures,
      tokenFailureBlockedUntil,
    },
  };
}

export function isOutcomeIngestPubliclyEnabled(input: {
  enabled?: string;
  safetyVersion?: string;
}): boolean {
  return (
    input.enabled === "true" &&
    input.safetyVersion === OUTCOME_INGEST_SAFETY_VERSION
  );
}

export function normalizeOutcomeQueryWindow(input: {
  now: number;
  since?: number;
  until?: number;
}): { since: number; until: number } {
  const until = input.until ?? input.now;
  const since = input.since ?? until - 90 * 24 * 60 * 60 * 1000;
  if (
    !Number.isSafeInteger(since) ||
    !Number.isSafeInteger(until) ||
    since > until ||
    until > input.now + OUTCOME_RECEIPT_FUTURE_SKEW_MS ||
    until - since > OUTCOME_QUERY_MAX_WINDOW_MS
  ) {
    throw new Error("Outcome query window is invalid or too large");
  }
  return { since, until };
}

export function sanitizeOutcomeCredential<T extends Record<string, unknown>>(
  credential: T | null | undefined,
): (Omit<T, "tokenHash"> & { configured: boolean }) | null {
  if (!credential) return null;
  const { tokenHash: _tokenHash, ...safe } = credential;
  return {
    ...safe,
    configured: credential.status === "active" && Boolean(_tokenHash),
  } as Omit<T, "tokenHash"> & { configured: boolean };
}

export function aggregateOutcomeRollups(
  siteId: string,
  rows: OutcomeAggregateReceipt[],
): {
  landingSessions: number;
  qualifiedActions: number;
  organicLandingSessions: number;
  signups: number;
  activations: number;
  paidConversions: number;
  conversionRate: number;
  organicLandingToSignupRate: number;
  signupToActivationRate: number;
  activationToPaidRate: number;
  organicLandingToPaidRate: number;
  byArticle: Array<{
    articleId: string;
    landingSessions: number;
    qualifiedActions: number;
    organicLandingSessions: number;
    signups: number;
    activations: number;
    paidConversions: number;
    conversionRate: number;
    organicLandingToSignupRate: number;
    signupToActivationRate: number;
    activationToPaidRate: number;
    organicLandingToPaidRate: number;
  }>;
  byGoal: Array<{
    goalKey: string;
    landingSessions: number;
    qualifiedActions: number;
    organicLandingSessions: number;
    signups: number;
    activations: number;
    paidConversions: number;
    conversionRate: number;
    organicLandingToSignupRate: number;
    signupToActivationRate: number;
    activationToPaidRate: number;
    organicLandingToPaidRate: number;
  }>;
} {
  type FunnelCounts = {
    landingSessions: number;
    qualifiedActions: number;
    organicLandingSessions: number;
    signups: number;
    activations: number;
    paidConversions: number;
  };
  const emptyCounts = (): FunnelCounts => ({
    landingSessions: 0,
    qualifiedActions: 0,
    organicLandingSessions: 0,
    signups: 0,
    activations: 0,
    paidConversions: 0,
  });
  const byArticle = new Map<string, FunnelCounts>();
  const byGoal = new Map<string, FunnelCounts>();
  let landingSessions = 0;
  let qualifiedActions = 0;
  let organicLandingSessions = 0;
  let signups = 0;
  let activations = 0;
  let paidConversions = 0;

  for (const row of rows) {
    if (row.siteId !== siteId) continue;
    const count = Math.max(0, Math.floor(row.count ?? 1));
    const article = byArticle.get(row.articleId) ?? emptyCounts();
    const goal = byGoal.get(row.goalKey) ?? emptyCounts();
    if (row.eventType === "landing_session") {
      landingSessions += count;
      article.landingSessions += count;
      goal.landingSessions += count;
    } else if (row.eventType === "qualified_action") {
      qualifiedActions += count;
      article.qualifiedActions += count;
      goal.qualifiedActions += count;
    } else if (row.eventType === "organic_landing") {
      landingSessions += count;
      organicLandingSessions += count;
      article.landingSessions += count;
      article.organicLandingSessions += count;
      goal.landingSessions += count;
      goal.organicLandingSessions += count;
    } else if (row.eventType === "signup") {
      signups += count;
      article.signups += count;
      goal.signups += count;
    } else if (row.eventType === "activation") {
      activations += count;
      article.activations += count;
      goal.activations += count;
    } else if (row.eventType === "paid_conversion") {
      paidConversions += count;
      article.paidConversions += count;
      goal.paidConversions += count;
    }
    byArticle.set(row.articleId, article);
    byGoal.set(row.goalKey, goal);
  }
  const rate = (actions: number, sessions: number) =>
    sessions > 0 ? actions / sessions : 0;
  const withRates = <T extends FunnelCounts>(counts: T) => ({
    ...counts,
    conversionRate: rate(counts.qualifiedActions, counts.landingSessions),
    organicLandingToSignupRate: rate(
      counts.signups,
      counts.organicLandingSessions,
    ),
    signupToActivationRate: rate(counts.activations, counts.signups),
    activationToPaidRate: rate(counts.paidConversions, counts.activations),
    organicLandingToPaidRate: rate(
      counts.paidConversions,
      counts.organicLandingSessions,
    ),
  });
  return {
    landingSessions,
    qualifiedActions,
    organicLandingSessions,
    signups,
    activations,
    paidConversions,
    conversionRate: rate(qualifiedActions, landingSessions),
    organicLandingToSignupRate: rate(signups, organicLandingSessions),
    signupToActivationRate: rate(activations, signups),
    activationToPaidRate: rate(paidConversions, activations),
    organicLandingToPaidRate: rate(paidConversions, organicLandingSessions),
    byArticle: [...byArticle.entries()].map(([articleId, counts]) => ({
      articleId,
      ...withRates(counts),
    })),
    byGoal: [...byGoal.entries()].map(([goalKey, counts]) => ({
      goalKey,
      ...withRates(counts),
    })),
  };
}

export function parseOutcomeBearerToken(
  authorization: string | null,
): string | null {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  return isValidOutcomeIngestToken(token) ? token : null;
}

export function isBrowserOutcomeRequest(headers: Headers): boolean {
  return Boolean(
    headers.get("origin") ||
      headers.get("sec-fetch-site") ||
      headers.get("sec-fetch-mode"),
  );
}
