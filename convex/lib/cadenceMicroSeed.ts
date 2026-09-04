import {
  filterNonCannibalizingIntentTopics,
  filterNonCannibalizingTopics,
  keywordDifficultyCeiling,
  tenantDiscoveryAnchors,
  type SerpCoverageTopic,
} from "./autopilotBuffer.ts";
import { preSerpReachCeiling } from "./winnableDiscovery.ts";

/**
 * A last-resort, bounded topic discovery lane for an imminent empty-buffer
 * cadence gap after the ordinary plan has exhausted its immutable executions.
 * It is intentionally much smaller than a topic plan and never reuses the
 * source plan's provider reservation.
 */
// Version 27 keeps the category-based fallback tenant-grounded at the provider
// boundary. Keyword Ideas now uses phrase-match plus a bounded regex built
// only from the tenant's explicit product anchors, so a broad category result
// cannot consume the paid candidate window before the independent business-
// fit, difficulty, SERP, expected-click, and article-quality gates run.
// Version 25 measures a deterministic portfolio of tenant-grounded search
// queries directly with Keyword Overview, then uses the category-based Ideas
// graph as its separately receipted fallback. This closes the sparse-provider
// failure where Suggestions and Related Keywords can both return zero rows for
// a legitimate B2B product phrase. Query probes are derived only from explicit
// product anchors, retain the independent business-fit/difficulty/SERP gates,
// and are bounded in one provider task instead of relying on repeated policy
// bumps to explore the rest of the tenant's search surface.
// Version 24 replaces the exhausted multi-anchor Ideas query with one literal
// Suggestions request per exact tenant product anchor, followed by a distinct
// Related Keywords graph for the one fallback. DataForSEO permits only one
// task per Labs Live request, so both envelopes fan out at most six calls while
// retaining one aggregate 300-row receipt and every downstream quality gate.
// Version 23 revalidates every semantic-retry candidate against the tenant's
// current article/topic coverage. A shortlist captured before the first
// article was sealed can no longer introduce a now-overlapping candidate and
// strand the evidence handoff.
// Version 18 keeps recovery on the tenant's explicit search/product surface
// and ranks those anchors by current lexical saturation before choosing a
// deterministic primary plus a genuinely distinct fallback. Broad audience
// and pain-point prose may still rescue a sparse profile, but can no longer
// displace configured product anchors on a complete profile.
// Version 17 is the one-shot recovery generation for planner checkpoints
// created while the planning action compared the shared v8 business-fit
// result to a stale v5 literal. It advances to the next unused, tenant-owned
// anchor under the existing demand, SERP, cannibalization and article-quality
// gates, protecting the imminent cadence while the repaired full planner
// takes over future replenishment.
// Version 16 preserves every explicit search anchor first, then supplements
// the recovery rotation with bounded capability and buyer-problem phrases from
// the tenant's own profile. A mature site can therefore move beyond a
// saturated head-term set without inventing a business topic or weakening any
// downstream quality boundary.
// Version 15 preserves a bounded, immutable shortlist from the paid discovery
// receipt and advances through it when live SERP evidence rejects one intent.
// A semantic miss therefore cannot silently discard another candidate that
// already passed every pre-SERP gate, while each candidate still has to pass
// the unchanged live intent, attainability, cannibalization, expected-click,
// article-quality, publication, and live-verification boundaries.
// Version 14 also quarantines unpublished inventory created by an older
// micro-seed whose selected keyword no longer satisfies the exact source
// anchor. Without this provenance migration, a sealed but off-anchor legacy
// article can reserve the only useful intent and make every corrected recovery
// candidate look like cannibalization. Version 13's whole-phrase anchor
// preservation, version 12's indexed history, and the meaningful-concept gate
// remain unchanged.
export const CADENCE_MICRO_SEED_VERSION = 27;
export const CADENCE_MICRO_SEED_ANCHOR_AUDIT_VERSION = 1;
// A successful free balance check is bound to the reservation transaction.
// This window fences that receipt against a stale or replayed admission action;
// the reservation ledger owns capacity after the job is created.
export const CADENCE_MICRO_SEED_BALANCE_RECEIPT_MAX_AGE_MS = 30_000;
export const CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES = 3;
export const CADENCE_MICRO_SEED_PROVIDER_SEED_LIMIT = 32;
export const CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD = 100_000;
export const CADENCE_MICRO_SEED_FALLBACK_PROVIDER_CEILING_MICRO_USD = 100_000;
export const CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT =
  "dataforseo_labs/google/keyword_overview/live";
export const CADENCE_MICRO_SEED_FALLBACK_DISCOVERY_ENDPOINT =
  "dataforseo_labs/google/keyword_ideas/live";
export const CADENCE_MICRO_SEED_RESULT_LIMIT = 300;
export const CADENCE_MICRO_SEED_TASK_COST_CEILING_USD = 0.10;
export const CADENCE_MICRO_SEED_PROVIDER_TIMEOUT_MS = 60_000;
export const CADENCE_MICRO_SEED_LEASE_MS = 2 * 60 * 1000;
export const CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS = 5 * 60 * 1000;
export const CADENCE_MICRO_SEED_MAX_WATCHDOG_RECOVERIES = 12;
export const CADENCE_MICRO_SEED_MAX_JOB_AGE_MS = 2 * 60 * 60 * 1000;
// A terminal primary may authorize its one distinct fallback after midnight,
// but never as an indefinitely reusable historical spend receipt.
export const CADENCE_MICRO_SEED_MAX_FALLBACK_PARENT_AGE_MS =
  24 * 60 * 60 * 1000;
// A terminal ordinary plan remains valid recovery evidence across a UTC-day
// rollover. The micro-seed owns a fresh daily reservation and rechecks current
// tenant/domain/evidence state; the source plan is only an immutable proof that
// the larger discovery lane already exhausted its bounded executions. Seven
// days covers the slowest supported weekly cadence without admitting stale
// historical plans indefinitely.
export const CADENCE_MICRO_SEED_MAX_SOURCE_PLAN_AGE_MS =
  7 * 24 * 60 * 60 * 1000;
export const CADENCE_MICRO_SEED_FINALIZE_DELAY_MS = 2 * 60 * 1000;
export const CADENCE_MICRO_SEED_MAX_FINALIZE_ATTEMPTS = 3;
export const CADENCE_MICRO_SEED_MAX_SCHEDULE_ATTEMPTS = 3;
export const CADENCE_MICRO_SEED_MAX_CADENCE_HORIZON_MS =
  24 * 60 * 60 * 1000;
export const CADENCE_MICRO_SEED_READ_LIMIT = 2_000;

export type CadenceMicroSeedAttemptKind = "primary" | "fallback";

/** Missing legacy values are primary; unknown future values fail closed. */
export function cadenceMicroSeedAttemptKind(
  value?: string,
): CadenceMicroSeedAttemptKind | null {
  if (value === undefined || value === "primary") return "primary";
  if (value === "fallback") return "fallback";
  return null;
}

export function cadenceMicroSeedProviderCeilingMicroUsd(
  kind: CadenceMicroSeedAttemptKind,
): number {
  return kind === "fallback"
    ? CADENCE_MICRO_SEED_FALLBACK_PROVIDER_CEILING_MICRO_USD
    : CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD;
}

export function cadenceMicroSeedDiscoveryEndpoint(
  kind: CadenceMicroSeedAttemptKind,
):
  | typeof CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT
  | typeof CADENCE_MICRO_SEED_FALLBACK_DISCOVERY_ENDPOINT {
  return kind === "fallback"
    ? CADENCE_MICRO_SEED_FALLBACK_DISCOVERY_ENDPOINT
    : CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT;
}

export function cadenceMicroSeedProviderPurpose(
  kind: CadenceMicroSeedAttemptKind,
): "cadence_micro_seed" | "cadence_micro_seed_fallback" {
  return kind === "fallback"
    ? "cadence_micro_seed_fallback"
    : "cadence_micro_seed";
}

export function cadenceMicroSeedProviderTrigger(
  kind: CadenceMicroSeedAttemptKind,
): string {
  return `${cadenceMicroSeedProviderPurpose(kind)}_v${CADENCE_MICRO_SEED_VERSION}`;
}

/**
 * The underfill bridge stores `workerAttempts: 1` before execution two is
 * scheduled. A deterministic terminal failure preserves 1; a retryable
 * execution-two failure settles at 2 because the plan retry ceiling is 1.
 * Neither value grants a third execution. Bind the complete queued execution
 * receipt instead of misreading this field as a completed-execution count.
 */
export function cadenceMicroSeedSourcePlanExecutionExhausted(args: {
  status?: string;
  workerAttempts?: number;
  workerToken?: string;
  heartbeatAt?: number;
  leaseExpiresAt?: number;
  nextAttemptAt?: number;
  jobCreatedAt: number;
  reservationDay?: string;
  marker: Record<string, unknown>;
  result: Record<string, unknown>;
}): boolean {
  const attempts = args.workerAttempts;
  const firstExecutionCount = args.marker.firstExecutionCount;
  const remainingTopicCapacity = args.marker.remainingTopicCapacity;
  const queuedAt = args.marker.queuedAt;
  return Boolean(
    args.status === "failed" &&
      (attempts === 1 || attempts === 2) &&
      args.workerToken === undefined &&
      args.heartbeatAt === undefined &&
      args.leaseExpiresAt === undefined &&
      args.nextAttemptAt === undefined &&
      args.marker.version === 1 &&
      Number.isInteger(firstExecutionCount) &&
      (firstExecutionCount as number) > 0 &&
      Number.isInteger(remainingTopicCapacity) &&
      (remainingTopicCapacity as number) > 0 &&
      Number.isFinite(queuedAt) &&
      (queuedAt as number) >= args.jobCreatedAt &&
      (queuedAt as number) <= 8_640_000_000_000_000 &&
      new Date(queuedAt as number).toISOString().slice(0, 10) ===
        args.reservationDay &&
      args.result.count === firstExecutionCount &&
      args.result.continuationStatus === "queued" &&
      args.result.continuationWorkerExecution === 2 &&
      args.result.remainingTopicCapacity === remainingTopicCapacity
  );
}

export function cadenceMicroSeedSourcePlanFresh(args: {
  jobCreatedAt: number;
  reservationDay?: string;
  timestamp: number;
  maximumAgeMs?: number;
}): boolean {
  const maximumAgeMs = args.maximumAgeMs ??
    CADENCE_MICRO_SEED_MAX_SOURCE_PLAN_AGE_MS;
  return Boolean(
    Number.isSafeInteger(args.jobCreatedAt) &&
      Number.isSafeInteger(args.timestamp) &&
      Number.isSafeInteger(maximumAgeMs) &&
      maximumAgeMs > 0 &&
      args.jobCreatedAt <= args.timestamp &&
      args.timestamp - args.jobCreatedAt <= maximumAgeMs &&
      new Date(args.jobCreatedAt).toISOString().slice(0, 10) ===
        args.reservationDay
  );
}

export function cadenceMicroSeedCheckpointSourcePlanExhaustionKind(args: {
  status?: string;
  checkpointState?: string;
  checkpointStatus?: string;
  providerReservationState?: string;
  persistedTopicCountState?: string;
  requiredVerifiedYield?: number;
  usableTopicCount?: number;
  cadenceFailureCategory?: string;
  cadenceFailureCode?: string;
  cadenceFailureTerminal?: boolean;
}): "underfilled" | "strict_zero_yield" | null {
  const exactCheckpoint =
    args.checkpointState === "single" &&
    args.providerReservationState === "retained_no_replay" &&
    Number.isSafeInteger(args.requiredVerifiedYield) &&
    (args.requiredVerifiedYield ?? 0) > 0 &&
    Number.isSafeInteger(args.usableTopicCount) &&
    (args.usableTopicCount ?? -1) >= 0;
  if (!exactCheckpoint) return null;
  if (
    args.status === "done" &&
    args.persistedTopicCountState === "recorded" &&
    (args.usableTopicCount ?? Infinity) <
      (args.requiredVerifiedYield ?? -Infinity)
  ) return "underfilled";
  // A strict zero-yield job has already completed its only paid execution,
  // retained the exact reservation, and atomically closed either an empty
  // checkpoint or a non-empty checkpoint whose every candidate was proven
  // ineligible. Both are final exhaustion receipts for the distinct
  // micro-seed lane even though there is deliberately no plan result/count to
  // bind. Other failed plans remain ineligible, so a transient or malformed
  // failure can never grant new spend.
  if (
    args.status === "failed" &&
    (args.checkpointStatus === "empty" ||
      args.checkpointStatus === "terminal_blocked") &&
    args.persistedTopicCountState === "missing" &&
    args.usableTopicCount === 0 &&
    args.cadenceFailureCategory === "semantic_zero_yield" &&
    args.cadenceFailureCode === "strict_zero_yield" &&
    args.cadenceFailureTerminal === true
  ) return "strict_zero_yield";
  return null;
}

export function cadenceMicroSeedCheckpointSourcePlanExhausted(
  args: Parameters<typeof cadenceMicroSeedCheckpointSourcePlanExhaustionKind>[0],
): boolean {
  return cadenceMicroSeedCheckpointSourcePlanExhaustionKind(args) !== null;
}

export type CadenceMicroSeedMetric = {
  keyword: string;
  searchVolume: number;
  difficulty: number;
  difficultyMeasured: true;
  cpc?: number;
  competition?: number;
  intent: string;
  trend: number[];
};

export function normalizeCadenceMicroSeedText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Only an attempted request from the current-or-stronger discovery envelope
 * exhausts an anchor. A historical 100-row singleton receipt cannot poison a
 * materially expanded 300-row multi-anchor contract forever, while any v20+
 * attempt remains a durable no-replay receipt for every seed it carried.
 */
export function cadenceMicroSeedAttemptExhaustsCurrentEnvelope(args: {
  providerCallAttempted?: boolean;
  providerEndpoint?: string;
  providerResultLimit?: number;
}): boolean {
  return args.providerCallAttempted === true &&
    (args.providerEndpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT ||
      args.providerEndpoint ===
        CADENCE_MICRO_SEED_FALLBACK_DISCOVERY_ENDPOINT) &&
    Number.isInteger(args.providerResultLimit) &&
    (args.providerResultLimit ?? 0) >= CADENCE_MICRO_SEED_RESULT_LIMIT;
}

/** Only explicit product/capability phrases may seed the rescue request. */
export function cadenceMicroSeedAnchors(args: {
  anchorKeywords?: string[] | null;
  keyFeatures?: string[] | null;
  painPoints?: string[] | null;
  productUsage?: string | null;
  targetAudienceSummary?: string | null;
}): string[] {
  const bounded = (signals: string[], limit = 24) => tenantDiscoveryAnchors(
    signals.filter((value): value is string => typeof value === "string"),
    limit,
  ).filter((anchor) => {
    const words = normalizeCadenceMicroSeedText(anchor).split(" ");
    return words.length >= 2 && words.length <= 6;
  });
  const directSearchAnchors: string[] = [];
  const longSearchSignals: string[] = [];
  const seenSearchAnchors = new Set<string>();
  for (const value of args.anchorKeywords ?? []) {
    if (typeof value !== "string") continue;
    const normalized = normalizeCadenceMicroSeedText(value)
      .replace(/[^a-z0-9+ -]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = normalized.split(" ").filter(Boolean);
    if (words.length >= 2 && words.length <= 6) {
      if (!seenSearchAnchors.has(normalized)) {
        seenSearchAnchors.add(normalized);
        directSearchAnchors.push(normalized);
      }
    } else if (words.length > 6) {
      longSearchSignals.push(value);
    }
  }
  const searchAnchors = directSearchAnchors.slice(0, 12);
  for (const anchor of bounded(longSearchSignals)) {
    if (seenSearchAnchors.has(anchor)) continue;
    seenSearchAnchors.add(anchor);
    searchAnchors.push(anchor);
    if (searchAnchors.length >= 12) break;
  }
  // Keep configured search anchors first, but do not let a mature site's
  // already-covered head terms permanently hide the rest of its explicit
  // product surface. These supplements remain traceable to the tenant profile
  // and the independent business-fit gate still requires product alignment.
  const seen = new Set(searchAnchors);
  const supplemented = [...searchAnchors];
  const appendCategory = (signals: string[], categoryLimit: number) => {
    let added = 0;
    for (const anchor of bounded(signals, categoryLimit * 3)) {
      if (seen.has(anchor)) continue;
      seen.add(anchor);
      supplemented.push(anchor);
      added += 1;
      if (added >= categoryLimit || supplemented.length >= 32) break;
    }
  };
  // Category caps prevent one verbose feature from consuming the entire
  // rotation and guarantee that explicit buyer problems and usage language
  // remain discoverable on mature tenants.
  appendCategory(args.keyFeatures ?? [], 6);
  appendCategory(args.painPoints ?? [], 6);
  appendCategory([args.productUsage ?? ""], 4);
  appendCategory([args.targetAudienceSummary ?? ""], 4);
  // One bounded primary batch plus one disjoint fallback batch is the complete
  // paid recovery contract. Profiles with more material retain a wider
  // deterministic rotation; sparse profiles keep their available anchors.
  return supplemented.slice(0, 32);
}

/**
 * Recovery spends on explicit search terms and product capabilities first.
 * Pain/audience prose is useful planner context, but it is not a reliable
 * paid seed when a tenant already supplied at least two product anchors. A
 * sparse tenant retains the full bounded fallback so onboarding never depends
 * on a particular profile shape.
 */
export function cadenceMicroSeedRecoveryAnchors(args: {
  anchorKeywords?: string[] | null;
  keyFeatures?: string[] | null;
  painPoints?: string[] | null;
  productUsage?: string | null;
  targetAudienceSummary?: string | null;
}): string[] {
  // Search anchors are deliberate tenant-authored keyword phrases. Feature
  // prose is useful only when its complete configured phrase is already a
  // provider-safe 2-6 words: clipping a sentence such as "powered by website
  // content learning" can erase the actual product and drift into an
  // unrelated market. Exact feature phrases expand a mature tenant's product
  // surface after historical search anchors are exhausted without admitting
  // synthetic fragments.
  const exactSearchAnchors = cadenceMicroSeedAnchors({
    anchorKeywords: args.anchorKeywords,
  });
  const exactFeaturePhrases = (args.keyFeatures ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => normalizeCadenceMicroSeedText(value)
      .replace(/[^a-z0-9+/-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim())
    .filter((value) => {
      const words = value.split(" ").filter(Boolean);
      return words.length >= 2 && words.length <= 6 && !/\d/.test(value);
    })
    .slice(0, 6);
  const exactProductAnchors = [...new Set([
    ...exactSearchAnchors,
    ...exactFeaturePhrases,
  ])];
  const productAnchors = exactSearchAnchors.length >= 2
    ? exactProductAnchors
    : cadenceMicroSeedAnchors(args);
  // Direct metrics are more useful than another synonym lottery when a
  // provider has no suggestions for a narrow B2B phrase. Expand only from the
  // tenant's own exact product language, round-robin by modifier so a verbose
  // first feature cannot consume the entire bounded probe set. Every probe
  // remains within the provider's six-word recovery contract and still has to
  // pass current tenant business fit, measured demand/difficulty, live SERP,
  // expected-click, article-quality, and publication audits.
  const probes: string[] = [];
  const seen = new Set<string>();
  const append = (value: string) => {
    const normalized = normalizeCadenceMicroSeedText(value)
      .replace(/[^a-z0-9+/-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const words = normalized.split(" ").filter(Boolean);
    if (
      words.length < 2 || words.length > 6 || normalized.length > 80 ||
      seen.has(normalized)
    ) return;
    seen.add(normalized);
    probes.push(normalized);
  };
  for (const anchor of productAnchors) append(anchor);
  const modifiers: Array<(anchor: string) => string> = [
    (anchor) => `${anchor} guide`,
    (anchor) => `${anchor} checklist`,
    (anchor) => `${anchor} examples`,
    (anchor) => `${anchor} best practices`,
    (anchor) => `how to use ${anchor}`,
    (anchor) => `${anchor} for small business`,
  ];
  for (const modifier of modifiers) {
    for (const anchor of productAnchors) append(modifier(anchor));
  }
  return probes.slice(0, 96);
}

/**
 * Deterministically select a broad direct-metric probe portfolio. Unlike the
 * Suggestions request, Keyword Overview benefits from several query shapes
 * for the same product concept, so semantic siblings are intentionally kept.
 */
export function selectCadenceMicroSeedProbeBatch(
  probes: readonly string[],
  sourcePlanKey: string,
  policyGeneration = 0,
  previouslyAttemptedSeeds: readonly string[] = [],
  coveredKeywords: readonly string[] = [],
  limit = CADENCE_MICRO_SEED_PROVIDER_SEED_LIMIT,
): string[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  const attempted = new Set(
    previouslyAttemptedSeeds.map(normalizeCadenceMicroSeedText).filter(Boolean),
  );
  const normalized = [...new Set(
    probes.map(normalizeCadenceMicroSeedText).filter(Boolean),
  )].filter((probe) => !attempted.has(probe));
  if (normalized.length === 0) return [];
  const conflicts = (probe: string) => coveredKeywords.reduce(
    (count, covered) => count + (
      filterNonCannibalizingTopics(
        [{ primaryKeyword: probe }],
        [covered],
        0.35,
        1,
      ).length === 0 ? 1 : 0
    ),
    0,
  );
  const ranked = normalized.map((probe, index) => ({
    probe,
    index,
    conflicts: conflicts(probe),
  })).sort((left, right) =>
    left.conflicts - right.conflicts || left.index - right.index
  ).map((candidate) => candidate.probe);
  let hash = 0;
  for (const character of sourcePlanKey) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  const generation = Number.isSafeInteger(policyGeneration)
    ? Math.max(0, policyGeneration)
    : 0;
  const offset = (hash + generation * limit) % ranked.length;
  const rotated = [...ranked.slice(offset), ...ranked.slice(0, offset)];
  return rotated.slice(0, Math.min(limit, rotated.length));
}

/**
 * Revalidate an unpublished legacy topic against both immutable creation
 * evidence and the tenant's current explicit discovery anchors. This catches
 * historical policies that fragmented a valid user phrase before persisting
 * the job seed, while preserving any legacy topic whose exact seed remains
 * authorized and whose selected provider keyword still satisfies it.
 */
export function cadenceMicroSeedLegacyAnchorReceiptEligible(args: {
  currentAnchors: readonly string[];
  jobSeed: string;
  selectedKeyword?: string;
  topicKeyword: string;
}): boolean {
  const seed = normalizeCadenceMicroSeedText(args.jobSeed);
  const selected = normalizeCadenceMicroSeedText(args.selectedKeyword ?? "");
  const topic = normalizeCadenceMicroSeedText(args.topicKeyword);
  const authorizedSeeds = new Set(
    args.currentAnchors.map(normalizeCadenceMicroSeedText).filter(Boolean),
  );
  return Boolean(
    seed &&
      selected &&
      topic &&
      authorizedSeeds.has(seed) &&
      selected === topic &&
      cadenceMicroSeedCandidateMatchesAnchor(seed, topic)
  );
}

/**
 * Rotate deterministically from the exact exhausted plan. Replaying inspect
 * yields the same seed; another plan can select a different explicit anchor.
 */
export function selectCadenceMicroSeedAnchor(
  anchors: readonly string[],
  sourcePlanKey: string,
  policyGeneration = 0,
  previouslyAttemptedSeeds: readonly string[] = [],
  coveredKeywords: readonly string[] = [],
): string | null {
  const attempted = new Set(
    previouslyAttemptedSeeds.map(normalizeCadenceMicroSeedText).filter(Boolean),
  );
  const normalized = [...new Set(
    anchors.map(normalizeCadenceMicroSeedText).filter(Boolean),
  )].filter((anchor) => !attempted.has(anchor));
  if (normalized.length === 0) return null;
  const conflicts = (anchor: string) => coveredKeywords.reduce(
    (count, covered) => count + (
      filterNonCannibalizingTopics(
        [{ primaryKeyword: anchor }],
        [covered],
        0.35,
        1,
      ).length === 0 ? 1 : 0
    ),
    0,
  );
  const ranked = normalized.map((anchor, index) => ({
    anchor,
    index,
    conflicts: conflicts(anchor),
  })).sort((left, right) =>
    left.conflicts - right.conflicts || left.index - right.index
  );
  const minimumConflicts = ranked[0]!.conflicts;
  const preferred = ranked.filter((candidate) =>
    candidate.conflicts === minimumConflicts
  ).map((candidate) => candidate.anchor);
  let hash = 0;
  for (const character of sourcePlanKey) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  // Each policy generation owns a distinct primary/fallback pair. This lets
  // an algorithm repair try unused product anchors without replaying either
  // paid request from the previous immutable policy.
  const generation = Number.isSafeInteger(policyGeneration)
    ? Math.max(0, policyGeneration)
    : 0;
  return preferred[(hash + generation * 2) % preferred.length] ?? null;
}

function cadenceMicroSeedAnchorsAreDistinct(
  left: string,
  right: string,
): boolean {
  const leftTokens = cadenceMicroSeedAnchorTokens(left);
  const rightTokens = cadenceMicroSeedAnchorTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return false;
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  return shared < 2 ||
    shared / Math.min(leftTokens.size, rightTokens.size) < 0.6;
}

/**
 * Build one deterministic provider request from several exact tenant product
 * phrases. DataForSEO accepts up to 200 seeds in one task; the shared 32-seed
 * bound keeps the request and its receipt small while removing the old
 * two-phrase lottery.
 * Every selected keyword must still match one exact seed and pass the
 * independent tenant-fit, difficulty, overlap, live-SERP, expected-click and
 * publication gates.
 */
export function selectCadenceMicroSeedAnchorBatch(
  anchors: readonly string[],
  sourcePlanKey: string,
  policyGeneration = 0,
  previouslyAttemptedSeeds: readonly string[] = [],
  coveredKeywords: readonly string[] = [],
  limit = CADENCE_MICRO_SEED_PROVIDER_SEED_LIMIT,
): string[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  const selected: string[] = [];
  const excluded = [...previouslyAttemptedSeeds];
  while (selected.length < limit) {
    const distinctAnchors = anchors.filter((anchor) =>
      selected.every((prior) => cadenceMicroSeedAnchorsAreDistinct(anchor, prior))
    );
    const next = selectCadenceMicroSeedAnchor(
      distinctAnchors,
      sourcePlanKey,
      policyGeneration,
      excluded,
      coveredKeywords,
    );
    if (!next) break;
    selected.push(next);
    excluded.push(next);
  }
  return selected;
}

/**
 * Select exactly the next explicit anchor after the durable primary seed.
 * The original seed must still be authorized by the tenant's current profile;
 * profile drift cannot silently turn a different phrase into a retry.
 */
export function selectCadenceMicroSeedFallbackAnchor(
  anchors: readonly string[],
  sourcePlanKey: string,
  primarySeed: string,
  policyGeneration = 0,
  previouslyAttemptedSeeds: readonly string[] = [],
  coveredKeywords: readonly string[] = [],
): string | null {
  const attempted = new Set(
    previouslyAttemptedSeeds.map(normalizeCadenceMicroSeedText).filter(Boolean),
  );
  const normalized = [...new Set(
    anchors.map(normalizeCadenceMicroSeedText).filter(Boolean),
  )].filter((anchor) => !attempted.has(anchor));
  if (normalized.length < 2) return null;
  const expectedPrimary = selectCadenceMicroSeedAnchor(
    normalized,
    sourcePlanKey,
    policyGeneration,
    previouslyAttemptedSeeds,
    coveredKeywords,
  );
  const primary = normalizeCadenceMicroSeedText(primarySeed);
  if (!expectedPrimary || expectedPrimary !== primary) return null;
  const conflicts = (anchor: string) => coveredKeywords.reduce(
    (count, covered) => count + (
      filterNonCannibalizingTopics(
        [{ primaryKeyword: anchor }],
        [covered],
        0.35,
        1,
      ).length === 0 ? 1 : 0
    ),
    0,
  );
  const ranked = normalized.map((anchor, index) => ({
    anchor,
    index,
    conflicts: conflicts(anchor),
  })).sort((left, right) =>
    left.conflicts - right.conflicts || left.index - right.index
  ).map((candidate) => candidate.anchor);
  const primaryIndex = ranked.indexOf(primary);
  if (primaryIndex < 0) return null;
  for (let offset = 1; offset < ranked.length; offset += 1) {
    const alternate = ranked[(primaryIndex + offset) % ranked.length];
    if (
      alternate &&
      alternate !== primary &&
      cadenceMicroSeedAnchorsAreDistinct(primary, alternate)
    ) return alternate;
  }
  return null;
}

export type CadenceMicroSeedTerminalMissAudit = {
  received: number;
  accepted: number;
  invalidMetric: number;
  intentUnavailable: number;
  difficulty: number;
  brand: number;
  businessFit: number;
  duplicate: number;
  overlap: number;
};

/**
 * Pure proof that the first paid task completed without a usable candidate.
 * Every returned row must be accounted for by exactly one strict rejection
 * gate. This authorizes only the existing one-shot alternate product anchor;
 * it never relaxes candidate quality or permits replay of the original seed.
 */
export function cadenceMicroSeedTerminalMissReceiptValid(args: {
  attemptKind?: string;
  hasParent: boolean;
  status: string;
  policyVersion: number;
  expectedPolicyVersion: number;
  rolloutEpoch: number;
  expectedRolloutEpoch: number;
  reservationDay: string;
  expectedReservationDay: string;
  createdAt: number;
  now: number;
  seed: string;
  expectedSeed: string;
  locationCode: number;
  expectedLocationCode: number;
  languageCode: string;
  expectedLanguageCode: string;
  providerEndpoint: string;
  providerResultLimit: number;
  includeSerpInfo: boolean;
  includeClickstreamData: boolean;
  providerCostCeilingMicroUsd: number;
  providerCostReservedMicroUsd: number;
  providerCallAttempted: boolean;
  providerCallCompleted: boolean;
  providerAttemptedAt?: number;
  providerCompletedAt?: number;
  completedAt?: number;
  providerRequestTag?: string;
  expectedProviderRequestTag: string;
  providerTaskCostUsd?: number;
  candidateReceiptCount: number;
  candidateAudit?: CadenceMicroSeedTerminalMissAudit;
  errorCode?: string;
  workerToken?: string;
  leaseExpiresAt?: number;
  hasSelectedOrTopicReceipt: boolean;
  hasEvidenceOrCadenceReceipt: boolean;
  finalizeAttempts: number;
  cadenceScheduleAttempts: number;
  maximumParentAgeMs?: number;
}): boolean {
  const attemptedAt = args.providerAttemptedAt;
  const providerCompletedAt = args.providerCompletedAt;
  const completedAt = args.completedAt;
  const audit = args.candidateAudit;
  const maximumParentAgeMs = args.maximumParentAgeMs ??
    CADENCE_MICRO_SEED_MAX_FALLBACK_PARENT_AGE_MS;
  const rejectionCount = audit
    ? audit.invalidMetric + audit.intentUnavailable + audit.difficulty +
      audit.brand + audit.businessFit + audit.duplicate + audit.overlap
    : -1;
  const candidateAuditValid = Boolean(
    audit &&
      Object.values(audit).every((value) =>
        Number.isSafeInteger(value) && value >= 0
      ) &&
      audit.accepted === 0 &&
      args.candidateReceiptCount <= audit.received &&
      audit.invalidMetric >= audit.received - args.candidateReceiptCount &&
      rejectionCount === audit.received
  );
  const maximumTimestamp = 8_640_000_000_000_000;
  return Boolean(
    cadenceMicroSeedAttemptKind(args.attemptKind) === "primary" &&
      !args.hasParent &&
      args.status === "missed" &&
      args.policyVersion === args.expectedPolicyVersion &&
      args.rolloutEpoch === args.expectedRolloutEpoch &&
      Number.isFinite(args.createdAt) &&
      args.createdAt >= 0 &&
      args.createdAt <= maximumTimestamp &&
      Number.isFinite(args.now) &&
      args.now >= args.createdAt &&
      args.now <= maximumTimestamp &&
      args.createdAt <= args.now &&
      Number.isSafeInteger(maximumParentAgeMs) &&
      maximumParentAgeMs > 0 &&
      args.now - args.createdAt <= maximumParentAgeMs &&
      new Date(args.now).toISOString().slice(0, 10) ===
        args.expectedReservationDay &&
      new Date(args.createdAt).toISOString().slice(0, 10) ===
        args.reservationDay &&
      normalizeCadenceMicroSeedText(args.seed) ===
        normalizeCadenceMicroSeedText(args.expectedSeed) &&
      args.locationCode === args.expectedLocationCode &&
      args.languageCode.trim().toLowerCase() ===
        args.expectedLanguageCode.trim().toLowerCase() &&
      args.providerEndpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT &&
      args.providerResultLimit === CADENCE_MICRO_SEED_RESULT_LIMIT &&
      args.includeSerpInfo === false &&
      args.includeClickstreamData === false &&
      args.providerCostCeilingMicroUsd ===
        CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD &&
      args.providerCostReservedMicroUsd ===
        CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD &&
      args.providerCallAttempted === true &&
      args.providerCallCompleted === true &&
      Number.isFinite(attemptedAt) &&
      (attemptedAt as number) >= args.createdAt &&
      (attemptedAt as number) <= maximumTimestamp &&
      Number.isFinite(providerCompletedAt) &&
      (providerCompletedAt as number) >= (attemptedAt as number) &&
      (providerCompletedAt as number) <= maximumTimestamp &&
      Number.isFinite(completedAt) &&
      (completedAt as number) >= (providerCompletedAt as number) &&
      (completedAt as number) <= maximumTimestamp &&
      (completedAt as number) <= args.now &&
      new Date(attemptedAt as number).toISOString().slice(0, 10) ===
        args.reservationDay &&
      new Date(providerCompletedAt as number).toISOString().slice(0, 10) ===
        args.reservationDay &&
      new Date(completedAt as number).toISOString().slice(0, 10) ===
        args.reservationDay &&
      args.providerRequestTag === args.expectedProviderRequestTag &&
      typeof args.providerTaskCostUsd === "number" &&
      Number.isFinite(args.providerTaskCostUsd) &&
      args.providerTaskCostUsd >= 0 &&
      args.providerTaskCostUsd <=
        CADENCE_MICRO_SEED_TASK_COST_CEILING_USD + Number.EPSILON &&
      candidateAuditValid &&
      args.errorCode === "no_strict_candidate" &&
      args.workerToken === undefined &&
      args.leaseExpiresAt === undefined &&
      !args.hasSelectedOrTopicReceipt &&
      !args.hasEvidenceOrCadenceReceipt &&
      args.finalizeAttempts === 0 &&
      args.cadenceScheduleAttempts === 0
  );
}

const KNOWN_THIRD_PARTY_BRANDS = [
  "chatgpt", "openai", "jasper", "writesonic", "copyai", "surfer",
  "semrush", "ahrefs", "moz", "grammarly", "hubspot", "wordpress",
  "shopify", "wix", "squarespace", "notion", "canva", "mailchimp",
  "salesforce", "zapier", "hootsuite", "buffer", "yoast", "clearscope",
  "frase", "scalenut", "rytr", "anyword", "peppertype", "contentbot",
] as const;

function brandToken(value: string): string {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .replace(/\.[a-z]{2,}$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function cadenceMicroSeedBlockedBrand(args: {
  keyword: string;
  siteName?: string | null;
  competitors?: string[] | null;
}): string | null {
  const keyword = normalizeCadenceMicroSeedText(args.keyword)
    .replace(/[^a-z0-9]+/g, "");
  const ownBrand = brandToken(args.siteName ?? "");
  const blocked = new Set<string>();
  for (const competitor of args.competitors ?? []) {
    const token = brandToken(competitor);
    if (token.length > 2) blocked.add(token);
  }
  for (const brand of KNOWN_THIRD_PARTY_BRANDS) {
    if (brand !== ownBrand && !ownBrand.includes(brand)) blocked.add(brand);
  }
  for (const brand of blocked) {
    if (keyword.includes(brand)) return brand;
  }
  return null;
}

function microSeedOpportunityScore(metric: CadenceMicroSeedMetric): number {
  const volume = Math.min(Math.log10(Math.max(1, metric.searchVolume)) * 13, 40);
  const difficulty = Math.max(0, (100 - metric.difficulty) * 0.6);
  const cpc = Math.min((metric.cpc ?? 0) * 4, 20);
  return Math.round((volume + difficulty + cpc) * 1_000) / 1_000;
}

export type CadenceMicroSeedCandidateEvaluation<T> = {
  selected: T | null;
  /** Score-ordered candidates that passed every pre-SERP gate. */
  acceptedCandidates: T[];
  accepted: number;
  rejected: {
    invalidMetric: number;
    intentUnavailable: number;
    difficulty: number;
    brand: number;
    businessFit: number;
    duplicate: number;
    overlap: number;
  };
};

const CADENCE_MICRO_SEED_ANCHOR_NOISE = new Set([
  "and", "app", "apps", "application", "applications", "best", "business",
  "checklist", "checklists", "example", "examples", "for", "guide", "guides",
  "how", "online", "platform", "platforms", "practice", "practices", "product",
  "products", "service", "services", "small", "software", "solution",
  "solutions", "system", "systems", "the", "tool", "tools", "top", "use",
  "using", "with",
]);

const CADENCE_MICRO_SEED_ANCHOR_ALIASES = new Map([
  ["automated", "automate"], ["automation", "automate"],
  ["automating", "automate"], ["conversions", "convert"],
  ["conversion", "convert"], ["converting", "convert"],
  ["engagement", "engage"], ["engaging", "engage"],
  ["generation", "generate"], ["generating", "generate"],
  ["leads", "lead"], ["monitoring", "monitor"], ["monitors", "monitor"],
  ["qualification", "qualify"], ["qualified", "qualify"],
  ["qualifying", "qualify"], ["ranking", "rank"], ["rankings", "rank"],
  ["scores", "score"], ["scoring", "score"], ["visitors", "visitor"],
  ["websites", "website"],
]);

function cadenceMicroSeedAnchorTokens(value: string): Set<string> {
  return new Set(value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) =>
      token.length >= 3 && !CADENCE_MICRO_SEED_ANCHOR_NOISE.has(token)
    )
    .map((token) => CADENCE_MICRO_SEED_ANCHOR_ALIASES.get(token) ?? token));
}

export const CADENCE_MICRO_SEED_FALLBACK_KEYWORD_REGEX_MAX_LENGTH = 1_000;

function cadenceMicroSeedRegexStem(token: string): string {
  // Tokens are already normalized to ASCII alphanumerics. Keep short product
  // concepts exact and stem longer concepts just enough to cover ordinary
  // inflection (qualify/qualification, automate/automation, rank/ranking).
  const stemLength = token.length <= 5 ? token.length : 5;
  return `${token.slice(0, stemLength)}[a-z0-9]*`;
}

/**
 * Build the exact provider-side relevance fence for Keyword Ideas.
 *
 * The regex is derived solely from current tenant-owned anchors, requires the
 * first two meaningful product concepts from an anchor in either order, and
 * is deterministically capped at DataForSEO's documented 1,000-character
 * filter limit. A genuinely single-concept anchor remains usable, matching
 * the existing downstream anchor gate, while offering words such as
 * "software", "platform", and "best" can never authorize a row.
 */
export function cadenceMicroSeedFallbackKeywordRegex(
  seeds: readonly string[],
): string | null {
  const clauses: string[] = [];
  const seen = new Set<string>();
  for (const seed of seeds) {
    const concepts = [...cadenceMicroSeedAnchorTokens(seed)].slice(0, 2);
    if (concepts.length === 0) continue;
    const stems = concepts.map(cadenceMicroSeedRegexStem);
    const clause = stems.length === 1
      ? stems[0]!
      : `(${stems[0]}.*${stems[1]}|${stems[1]}.*${stems[0]})`;
    if (seen.has(clause)) continue;
    const nextClauses = [...clauses, clause];
    const nextExpression = nextClauses.length === 1
      ? nextClauses[0]!
      : `(${nextClauses.join("|")})`;
    // Leave no ambiguity at the provider contract boundary: only complete
    // clauses enter the alternation, never a truncated regex fragment.
    if (
      nextExpression.length >
        CADENCE_MICRO_SEED_FALLBACK_KEYWORD_REGEX_MAX_LENGTH
    ) continue;
    seen.add(clause);
    clauses.push(clause);
  }
  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0]! : `(${clauses.join("|")})`;
}

/**
 * Provider relevance is not semantic proof. Preserve at least two meaningful
 * concepts from a multi-concept tenant anchor before spending on SERP evidence.
 * Offering wrappers such as "tool" and "software" cannot satisfy the gate.
 */
export function cadenceMicroSeedCandidateMatchesAnchor(
  seed: string,
  candidateKeyword: string,
): boolean {
  const seedTokens = cadenceMicroSeedAnchorTokens(seed);
  const candidateTokens = cadenceMicroSeedAnchorTokens(candidateKeyword);
  if (seedTokens.size === 0 || candidateTokens.size === 0) return false;
  let shared = 0;
  for (const token of seedTokens) {
    if (candidateTokens.has(token)) shared += 1;
  }
  return shared >= Math.min(2, seedTokens.size);
}

/** Exact source phrase authorising a provider keyword, or null when none do. */
export function cadenceMicroSeedMatchingAnchor(
  seeds: readonly string[],
  candidateKeyword: string,
): string | null {
  for (const seed of seeds) {
    if (cadenceMicroSeedCandidateMatchesAnchor(seed, candidateKeyword)) {
      return normalizeCadenceMicroSeedText(seed);
    }
  }
  return null;
}

/**
 * Rank provider-returned rows and expose a bounded shortlist. Product fit is supplied by the
 * caller because it binds the current tenant profile/version; this helper
 * owns only metric, brand, exact-key and fail-closed lexical coverage gates.
 */
export function selectCadenceMicroSeedCandidate<
  T extends CadenceMicroSeedMetric,
>(args: {
  metrics: readonly T[];
  seed: string;
  seeds?: readonly string[];
  maximumDifficulty: number;
  existingExactKeywords: ReadonlySet<string>;
  coveredTopics: SerpCoverageTopic[];
  siteName?: string | null;
  competitors?: string[] | null;
  businessFitEligible: (candidate: T) => boolean;
}): CadenceMicroSeedCandidateEvaluation<T> {
  const rejected = {
    invalidMetric: 0,
    intentUnavailable: 0,
    difficulty: 0,
    brand: 0,
    businessFit: 0,
    duplicate: 0,
    overlap: 0,
  };
  const accepted: T[] = [];
  const seen = new Set<string>();
  for (const candidate of args.metrics) {
    const keyword = normalizeCadenceMicroSeedText(candidate.keyword);
    if (
      !keyword ||
      !Number.isFinite(candidate.searchVolume) ||
      candidate.searchVolume <= 0 ||
      candidate.difficultyMeasured !== true ||
      !Number.isFinite(candidate.difficulty) ||
      candidate.difficulty < 0 ||
      candidate.difficulty > 100
    ) {
      rejected.invalidMetric += 1;
      continue;
    }
    if (!candidate.intent || candidate.intent === "unknown") {
      rejected.intentUnavailable += 1;
      continue;
    }
    if (
      candidate.difficulty > keywordDifficultyCeiling(
        args.maximumDifficulty,
        candidate.searchVolume,
      )
    ) {
      rejected.difficulty += 1;
      continue;
    }
    if (cadenceMicroSeedBlockedBrand({
      keyword,
      siteName: args.siteName,
      competitors: args.competitors,
    })) {
      rejected.brand += 1;
      continue;
    }
    if (
      !cadenceMicroSeedMatchingAnchor(args.seeds ?? [args.seed], keyword) ||
      !args.businessFitEligible(candidate)
    ) {
      rejected.businessFit += 1;
      continue;
    }
    if (
      seen.has(keyword) ||
      args.existingExactKeywords.has(keyword)
    ) {
      rejected.duplicate += 1;
      continue;
    }
    seen.add(keyword);
    const clearsCoverage = filterNonCannibalizingIntentTopics(
      [{ primaryKeyword: keyword }],
      args.coveredTopics,
      0.4,
      0.35,
      1,
    ).length === 1;
    if (!clearsCoverage) {
      rejected.overlap += 1;
      continue;
    }
    accepted.push(candidate);
  }
  accepted.sort((left, right) =>
    microSeedOpportunityScore(right) - microSeedOpportunityScore(left) ||
    left.difficulty - right.difficulty ||
    right.searchVolume - left.searchVolume ||
    normalizeCadenceMicroSeedText(left.keyword).localeCompare(
      normalizeCadenceMicroSeedText(right.keyword),
    )
  );
  return {
    selected: accepted[0] ?? null,
    acceptedCandidates: accepted.slice(0, CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES),
    accepted: accepted.length,
    rejected,
  };
}

/**
 * Keyword difficulty is a discovery proxy, not the publication verdict. The
 * live SERP/evidence handoff that follows this selection measures the actual
 * page-one publishers and expected clicks, and fails closed before article
 * generation. Keep the rescue shortlist consistent with the ordinary
 * winnability model so a young domain can measure plausible long-tail queries
 * instead of rejecting them at the noisier proxy stage.
 */
export function cadenceMicroSeedPreSerpDifficultyCeiling(
  tenantDomainRank: number,
): number {
  return preSerpReachCeiling(tenantDomainRank);
}

export function cadenceMicroSeedProviderReceiptValid(args: {
  endpoint: string;
  requestedSeed: string;
  returnedSeed: string;
  resultLimit: number;
  providerTaskCostUsd: number;
  candidateCount: number;
}): boolean {
  return (args.endpoint === CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT ||
      args.endpoint === CADENCE_MICRO_SEED_FALLBACK_DISCOVERY_ENDPOINT) &&
    normalizeCadenceMicroSeedText(args.requestedSeed) ===
      normalizeCadenceMicroSeedText(args.returnedSeed) &&
    Number.isInteger(args.resultLimit) &&
    args.resultLimit >= 1 &&
    args.resultLimit <= CADENCE_MICRO_SEED_RESULT_LIMIT &&
    Number.isFinite(args.providerTaskCostUsd) &&
    args.providerTaskCostUsd >= 0 &&
    args.providerTaskCostUsd <= CADENCE_MICRO_SEED_TASK_COST_CEILING_USD +
      Number.EPSILON &&
    Number.isInteger(args.candidateCount) &&
    args.candidateCount >= 0 &&
    args.candidateCount <= args.resultLimit;
}
