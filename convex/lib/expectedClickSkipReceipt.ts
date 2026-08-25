/**
 * Bounded diagnostic receipt for expected-click backfill reservation.
 *
 * The natural dispatchers evaluate every active tenant hourly and daily, and a
 * refusal previously returned its reason to a caller that discarded it. Four
 * days of correct idling and four days of a silent stall therefore looked
 * identical from production evidence, which is what made the LeadPilot stall
 * unreadable.
 *
 * This records exactly one current receipt per site and phase. It is a durable
 * write on a natural-scheduler path, so it is deliberately overwrite-only,
 * finite-enum, payload-free and monotonic: it can never grow with traffic, can
 * never carry a provider response or credential, and a slow in-flight refusal
 * can never bury a newer transaction that actually queued work.
 *
 * Pure so every transition is provable without a database.
 */

export const EXPECTED_CLICK_SKIP_RECEIPT_VERSION = 1;

export type ExpectedClickBackfillKind = "demand" | "evidence";
export type ExpectedClickSkipDecision = "skipped" | "queued";

/**
 * Every reason an authoritative reservation can return. Anything outside this
 * allowlist is recorded as "unclassified" rather than persisted verbatim, so a
 * future branch can never leak free text or a provider message into the
 * operational ledger.
 */
export const EXPECTED_CLICK_SKIP_REASONS = [
  // Tenant/site state
  "site_unavailable",
  "rollout_ineligible",
  // Phase sequencing
  "evidence_phase_already_started",
  "prior_fleet_job_incomplete",
  "unresolved_job_read_limit_exhausted",
  "demand_prerequisite_missing",
  // Existing work for the reservation day
  "daily_batch_exists",
  "resume_required",
  // Read bounds
  "evidence_read_limit_exhausted",
  // Evidence prerequisites
  "tenant_authority_unavailable",
  // Candidate selection
  "no_eligible_legacy_topics",
  "covered_evidence_precedes_planned",
  // Operator recovery guards
  "planned_recovery_origin_invalid",
  "planned_recovery_precondition_changed",
  "planned_recovery_inspection_stale",
  // Provider budget
  "provider_account_entitlement_unavailable",
  "provider_account_daily_budget_reserved",
  "provider_account_monthly_budget_reserved",
  "provider_fleet_daily_budget_reserved",
  "provider_fleet_monthly_budget_reserved",
  "provider_account_preflight_cooling_down",
  // Successful reservation
  "queued",
  // Fallback
  "unclassified",
] as const;

export type ExpectedClickSkipReason =
  (typeof EXPECTED_CLICK_SKIP_REASONS)[number];

const REASON_SET: ReadonlySet<string> = new Set(EXPECTED_CLICK_SKIP_REASONS);

/** Never persist an unrecognised or free-text reason. */
export function normalizeSkipReason(reason: unknown): ExpectedClickSkipReason {
  return typeof reason === "string" && REASON_SET.has(reason)
    ? (reason as ExpectedClickSkipReason)
    : "unclassified";
}

/**
 * Candidate counts are the discriminator between refusals that share one
 * reason, so they are kept — but only as a fixed set of clamped integers. An
 * unbounded map or a topic list would turn a diagnostic into a data leak.
 */
export const EXPECTED_CLICK_CANDIDATE_COUNT_KEYS = [
  "covered",
  "currentDemand",
  "alreadyAttempted",
  "businessFitBlocked",
  "eligible",
  "artifactEligible",
  "plannedUnmaterialized",
  "plannedGateBlocked",
] as const;

export type ExpectedClickCandidateCounts = Partial<
  Record<(typeof EXPECTED_CLICK_CANDIDATE_COUNT_KEYS)[number], number>
>;

const MAX_COUNT = 1_000_000;

export function boundedCandidateCounts(
  counts: Record<string, unknown> | null | undefined,
): ExpectedClickCandidateCounts {
  const result: ExpectedClickCandidateCounts = {};
  if (!counts) return result;
  for (const key of EXPECTED_CLICK_CANDIDATE_COUNT_KEYS) {
    const value = counts[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    result[key] = Math.max(0, Math.min(MAX_COUNT, Math.trunc(value)));
  }
  return result;
}

export type ExpectedClickSkipReceipt = {
  version: number;
  kind: ExpectedClickBackfillKind;
  decision: ExpectedClickSkipDecision;
  reason: ExpectedClickSkipReason;
  evaluatedAt: number;
  nextEligibleAt?: number;
  rolloutEpoch: number;
  canonicalDomain: string;
  domainRevision?: number;
  policyVersion: number;
  selectedCandidateCount: number;
  unresolvedJobCount?: number;
  candidateCounts?: ExpectedClickCandidateCounts;
  /** At most one topic id, only when a single candidate explains the refusal. */
  blockingTopicId?: string;
};

export type SkipReceiptWriteDecision =
  | { action: "insert" }
  | { action: "replace" }
  /** Same reason and binding: refresh liveness without creating history. */
  | { action: "touch" }
  | { action: "ignore"; reason: string };

/**
 * Decide how an incoming evaluation may update the one current receipt.
 *
 * The dispatchers overlap by design (hourly recovery inside a daily fleet
 * pass), so ordering is enforced on the data rather than assumed from the
 * caller.
 */
export function skipReceiptWriteDecision(args: {
  existing: ExpectedClickSkipReceipt | null | undefined;
  incoming: ExpectedClickSkipReceipt;
}): SkipReceiptWriteDecision {
  const { existing, incoming } = args;
  if (!existing) return { action: "insert" };

  // A receipt written by a newer rollout epoch describes a tenant lifecycle
  // this evaluation no longer belongs to.
  if (incoming.rolloutEpoch < existing.rolloutEpoch) {
    return { action: "ignore", reason: "stale_rollout_epoch" };
  }
  if (incoming.rolloutEpoch > existing.rolloutEpoch) {
    return { action: "replace" };
  }
  if (incoming.canonicalDomain !== existing.canonicalDomain) {
    // A domain change is a new identity; the newer evaluation wins only if it
    // is genuinely newer.
    return incoming.evaluatedAt >= existing.evaluatedAt
      ? { action: "replace" }
      : { action: "ignore", reason: "stale_domain_binding" };
  }
  if ((incoming.domainRevision ?? 0) < (existing.domainRevision ?? 0)) {
    return { action: "ignore", reason: "stale_domain_revision" };
  }

  if (incoming.evaluatedAt < existing.evaluatedAt) {
    return { action: "ignore", reason: "stale_evaluation" };
  }
  // The critical race: a refusal that started before a successful reservation
  // must never restore the stale skip state afterwards.
  if (
    existing.decision === "queued" &&
    incoming.decision === "skipped" &&
    incoming.evaluatedAt <= existing.evaluatedAt
  ) {
    return { action: "ignore", reason: "superseded_by_queued" };
  }

  const sameShape = existing.decision === incoming.decision &&
    existing.reason === incoming.reason &&
    existing.version === incoming.version &&
    existing.policyVersion === incoming.policyVersion &&
    existing.selectedCandidateCount === incoming.selectedCandidateCount &&
    JSON.stringify(existing.candidateCounts ?? {}) ===
      JSON.stringify(incoming.candidateCounts ?? {}) &&
    existing.blockingTopicId === incoming.blockingTopicId;
  return sameShape ? { action: "touch" } : { action: "replace" };
}

/**
 * Operator-safe projection. Everything returned here is either a finite enum,
 * a bounded integer, or a binding value the operator already owns.
 */
export function sanitizeSkipReceiptForOperator(
  // Accepts the stored row directly, whose kind/decision are plain strings.
  receipt:
    | (Omit<ExpectedClickSkipReceipt, "kind" | "decision" | "reason"> & {
      kind: string;
      decision: string;
      reason: string;
    })
    | null
    | undefined,
): Record<string, unknown> | null {
  if (!receipt) return null;
  return {
    version: receipt.version,
    kind: receipt.kind,
    decision: receipt.decision,
    reason: normalizeSkipReason(receipt.reason),
    evaluatedAt: receipt.evaluatedAt,
    nextEligibleAt: receipt.nextEligibleAt,
    rolloutEpoch: receipt.rolloutEpoch,
    canonicalDomain: receipt.canonicalDomain,
    domainRevision: receipt.domainRevision,
    policyVersion: receipt.policyVersion,
    selectedCandidateCount: receipt.selectedCandidateCount,
    unresolvedJobCount: receipt.unresolvedJobCount,
    candidateCounts: boundedCandidateCounts(receipt.candidateCounts),
    blockingTopicId: receipt.blockingTopicId,
  };
}
