import { sha256Hex } from "./publicationArtifact.ts";

export const ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION = 1;

/**
 * Merge-time dependency owned by the canonical-domain transition slice. This
 * slice stores and enforces the receipts; it deliberately does not duplicate
 * the site rename mutation that stamps zero on new sites and increments on
 * every true normalized-domain transition.
 */
export const ONE_SETUP_DOMAIN_REVISION_INTEGRATION_CONTRACT = Object.freeze({
  siteSchemaField: "canonicalDomainRevision",
  newSiteInitialRevision: 0,
  transitionHelper: "nextCanonicalDomainRevision",
  legacyCompatibility: "raw_field_undefined_only",
  requestReceiptField: "domainRevisionSnapshot",
  executionReceiptField: "domainRevisionSnapshot",
  jobReceiptField: "oneSetupCanonicalDomainRevision",
  siteWriterOwner: "canonical_domain_transition_slice",
} as const);

/** Paid One-Setup work needs both the shared tenant allowance and no pending
 * account-deletion request in the same final authorization transaction. */
export function oneSetupPaidBoundaryLifecycleAllowed(args: {
  siteExecutionAuthorized: boolean;
  accountDeletionRequestedAt?: number;
}): boolean {
  return args.siteExecutionAuthorized &&
    args.accountDeletionRequestedAt === undefined;
}
export const ONE_SETUP_ZERO_SPEND_RECOVERY_BASE_MS = 15 * 60 * 1000;
export const ONE_SETUP_ZERO_SPEND_RECOVERY_MAX_MS = 24 * 60 * 60 * 1000;

export type OneSetupPlanningContext = {
  domain: string;
  canonicalDomain?: string | null;
  niche?: string | null;
  language?: string | null;
  siteName?: string | null;
  siteType?: string | null;
  siteSummary?: string | null;
  blogTheme?: string | null;
  keyFeatures?: string[] | null;
  pricingInfo?: string | null;
  targetCountry?: string | null;
  targetAudienceSummary?: string | null;
  painPoints?: string[] | null;
  productUsage?: string | null;
  competitors?: string[] | null;
  anchorKeywords?: string[] | null;
  verifiedKeywordDataRequired?: boolean | null;
  expectedClickSchedulingEnabled?: boolean | null;
};

function normalizedPlanningText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function oneSetupPlanningDomain(value: string): string {
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    return parsed.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return normalizedPlanningText(value);
  }
}

function normalizedPlanningList(
  values: string[] | null | undefined,
): string[] {
  return [...new Set(
    (values ?? [])
      .map(normalizedPlanningText)
      .filter(Boolean),
  )].sort();
}

/**
 * Exact, non-secret fingerprint of the owner/site inputs that can change topic
 * discovery or its evidence gates. Managed connection choices and cadence are
 * deliberately absent: changing machinery must not repurchase the same site's
 * initial content plan. Live measurements and topic inventory are also absent;
 * their normal evolution cannot invalidate an already-paid receipt.
 */
export function oneSetupInitialPlanContextFingerprint(
  site: OneSetupPlanningContext,
): string {
  return sha256Hex(JSON.stringify({
    version: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
    domain: oneSetupPlanningDomain(site.canonicalDomain ?? site.domain),
    niche: normalizedPlanningText(site.niche),
    language: normalizedPlanningText(site.language),
    siteName: normalizedPlanningText(site.siteName),
    siteType: normalizedPlanningText(site.siteType),
    siteSummary: normalizedPlanningText(site.siteSummary),
    blogTheme: normalizedPlanningText(site.blogTheme),
    keyFeatures: normalizedPlanningList(site.keyFeatures),
    pricingInfo: normalizedPlanningText(site.pricingInfo),
    targetCountry: normalizedPlanningText(site.targetCountry),
    targetAudienceSummary: normalizedPlanningText(
      site.targetAudienceSummary,
    ),
    painPoints: normalizedPlanningList(site.painPoints),
    productUsage: normalizedPlanningText(site.productUsage),
    competitors: normalizedPlanningList(site.competitors),
    anchorKeywords: normalizedPlanningList(site.anchorKeywords),
    verifiedKeywordDataRequired:
      site.verifiedKeywordDataRequired === true,
    expectedClickSchedulingEnabled:
      site.expectedClickSchedulingEnabled === true,
  }));
}

export type OneSetupInitialPlanReceiptDecision = {
  generation: number;
  reset: boolean;
  adoptBoundJob: boolean;
};

/**
 * Domain epochs are an independent no-replay fence. A missing receipt is
 * compatible only while the site itself is still an unstamped legacy row;
 * after the first canonical-domain transition, missing must never mean epoch
 * zero.
 */
export function oneSetupDomainRevisionReceiptMatches(args: {
  currentCanonicalDomainRevision: number;
  receiptDomainRevision?: unknown;
  legacyUnstampedAllowed: boolean;
}): boolean {
  if (args.receiptDomainRevision === undefined) {
    return args.legacyUnstampedAllowed;
  }
  return Number.isSafeInteger(args.receiptDomainRevision) &&
    (args.receiptDomainRevision as number) >= 0 &&
    args.receiptDomainRevision === args.currentCanonicalDomainRevision;
}

/**
 * Exact v1 job proof used by the first post-v1 owner save. The caller still
 * has to prove that exactly one prior execution row exists through the
 * composite request/configuration index. This predicate deliberately accepts
 * every job status: pending, running, done and failed all represent the same
 * immutable provider reservation.
 */
export function oneSetupLegacyInitialPlanJobBindingMatches(args: {
  requestId: string;
  requestSiteId: string;
  requestOwnerAccountKey: string;
  requestDomainSnapshot: string;
  requestContractVersion: number;
  siteId: string;
  ownerAccountKey: string;
  domainSnapshot: string;
  contractVersion: number;
  executionId: string;
  executionRequestId: string;
  executionSiteId: string;
  executionOwnerAccountKey: string;
  executionDomainSnapshot: string;
  executionConfigurationRevision: number;
  jobId: string;
  jobSiteId?: string;
  jobType?: string;
  payloadManual?: unknown;
  payloadReason?: unknown;
  payloadExecutionId?: unknown;
  payloadConfigurationRevision?: unknown;
  payloadRequestId?: unknown;
  payloadReceiptVersion?: unknown;
  payloadGeneration?: unknown;
  payloadCanonicalDomainRevision?: unknown;
  currentCanonicalDomainRevision: number;
  legacyUnstampedAllowed: boolean;
}): boolean {
  return args.requestId === args.executionRequestId &&
    args.requestSiteId === args.siteId &&
    args.executionSiteId === args.siteId &&
    args.requestOwnerAccountKey === args.ownerAccountKey &&
    args.executionOwnerAccountKey === args.ownerAccountKey &&
    args.requestDomainSnapshot === args.domainSnapshot &&
    args.executionDomainSnapshot === args.domainSnapshot &&
    args.requestContractVersion === args.contractVersion &&
    args.jobSiteId === args.siteId &&
    args.jobType === "plan" &&
    Boolean(args.jobId) &&
    args.payloadManual === true &&
    args.payloadReason === "one_setup_initial_plan" &&
    String(args.payloadExecutionId ?? "") === args.executionId &&
    args.payloadConfigurationRevision ===
      args.executionConfigurationRevision &&
    args.payloadRequestId === undefined &&
    args.payloadReceiptVersion === undefined &&
    args.payloadGeneration === undefined &&
    args.payloadCanonicalDomainRevision === undefined &&
    oneSetupDomainRevisionReceiptMatches({
      currentCanonicalDomainRevision: args.currentCanonicalDomainRevision,
      receiptDomainRevision: args.payloadCanonicalDomainRevision,
      legacyUnstampedAllowed: args.legacyUnstampedAllowed,
    });
}

/** Exact proof that a failed J released its untouched provider reservation. */
export function oneSetupFailedPlanRecoveryReceiptMatches(args: {
  recoveryCount?: number;
  workerAttempts?: number;
  recordedAt?: number;
  eligibleAt?: number;
  failureCode?: string;
  releaseReason?: string;
  jobSiteId?: string;
  jobUserId?: string;
  jobTrigger: string;
  jobCreatedAt: number;
  jobReservationDay?: string;
  jobReservedMicroUsd?: number;
  jobCeilingMicroUsd?: number;
  jobReleasedAt?: number;
  reservationSiteId?: string;
  reservationUserId?: string;
  reservationPurpose?: string;
  reservationTrigger?: string;
  reservationCreatedAt?: number;
  reservationDay?: string;
  reservationReservedMicroUsd?: number;
  reservationReleasedAt?: number;
  reservationReleaseReason?: string;
  expectedProviderCeilingMicroUsd: number;
}): boolean {
  const exactPreProviderReason =
    args.releaseReason === "provider_balance_insufficient" ||
    args.releaseReason === "provider_balance_preflight_unavailable" ||
    args.releaseReason === "plan_reservation_day_expired_before_execution" ||
    args.releaseReason ===
      "one_setup_planning_context_superseded_before_execution";
  return Number.isSafeInteger(args.recoveryCount ?? 0) &&
    (args.recoveryCount ?? 0) >= 0 &&
    (args.recoveryCount ?? 0) < Number.MAX_SAFE_INTEGER &&
    (args.workerAttempts ?? 0) === 0 &&
    Number.isSafeInteger(args.recordedAt) &&
    Number.isSafeInteger(args.eligibleAt) &&
    (args.recordedAt ?? 0) > 0 &&
    (args.eligibleAt ?? 0) > (args.recordedAt ?? 0) &&
    exactPreProviderReason &&
    args.failureCode === args.releaseReason &&
    Boolean(args.jobSiteId) &&
    Boolean(args.jobUserId) &&
    args.reservationSiteId === args.jobSiteId &&
    args.reservationUserId === args.jobUserId &&
    args.reservationPurpose === "topic_plan" &&
    args.reservationTrigger === args.jobTrigger &&
    args.reservationCreatedAt === args.jobCreatedAt &&
    args.reservationDay === args.jobReservationDay &&
    args.reservationReservedMicroUsd ===
      args.expectedProviderCeilingMicroUsd &&
    args.jobReservedMicroUsd === args.expectedProviderCeilingMicroUsd &&
    args.jobCeilingMicroUsd === args.expectedProviderCeilingMicroUsd &&
    args.reservationReleasedAt !== undefined &&
    args.reservationReleasedAt === args.jobReleasedAt &&
    args.reservationReleaseReason === args.releaseReason;
}

/**
 * A proven released pre-provider receipt did not spend. It may be reinspected
 * again without replaying paid work, but persistent outages back off
 * exponentially and cap at one attempt per 24-hour window. The provider's own
 * durable eligibility receipt always wins when it is later (for example an
 * insufficient-funding or next-UTC-day boundary).
 */
export function oneSetupZeroSpendRecoveryEligibleAt(args: {
  recoveryCount?: number;
  receiptRecordedAt: number;
  receiptEligibleAt: number;
}): number {
  const recoveryCount = args.recoveryCount ?? 0;
  if (
    !Number.isSafeInteger(recoveryCount) ||
    recoveryCount < 0 ||
    !Number.isSafeInteger(args.receiptRecordedAt) ||
    args.receiptRecordedAt < 0 ||
    !Number.isSafeInteger(args.receiptEligibleAt) ||
    args.receiptEligibleAt <= args.receiptRecordedAt
  ) throw new Error("Invalid zero-spend recovery receipt");
  const exponent = Math.min(recoveryCount, 7);
  const delayMs = Math.min(
    ONE_SETUP_ZERO_SPEND_RECOVERY_MAX_MS,
    ONE_SETUP_ZERO_SPEND_RECOVERY_BASE_MS * (2 ** exponent),
  );
  const backoffAt = args.receiptRecordedAt + delayMs;
  if (!Number.isSafeInteger(backoffAt)) {
    throw new Error("Zero-spend recovery deadline overflowed");
  }
  return Math.max(args.receiptEligibleAt, backoffAt);
}

/**
 * Advance the plan generation only when its actual planning contract changes.
 * Job status is intentionally not an input: pending, running, failed and done
 * are all terminally associated with the same paid receipt and must be adopted.
 */
export function oneSetupInitialPlanReceiptDecision(args: {
  storedVersion?: number;
  storedGeneration?: number;
  storedContextFingerprint?: string;
  storedJobId?: string;
  currentContextFingerprint: string;
  hardReset: boolean;
}): OneSetupInitialPlanReceiptDecision {
  const storedGeneration = Number.isSafeInteger(args.storedGeneration) &&
      (args.storedGeneration ?? 0) > 0
    ? args.storedGeneration!
    : 0;
  const initialized =
    args.storedVersion === ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION &&
    storedGeneration > 0 &&
    Boolean(args.storedContextFingerprint);
  const reset = args.hardReset || !initialized ||
    args.storedContextFingerprint !== args.currentContextFingerprint;
  return {
    generation: reset ? storedGeneration + 1 : storedGeneration,
    reset,
    adoptBoundJob: !reset && Boolean(args.storedJobId),
  };
}

/** Stable request/generation binding shared by queueing and settlement. */
export function oneSetupInitialPlanJobBindingMatches(args: {
  requestId: string;
  requestPlanJobId?: string;
  requestReceiptVersion?: number;
  requestGeneration?: number;
  jobId: string;
  payloadRequestId?: unknown;
  payloadReceiptVersion?: unknown;
  payloadGeneration?: unknown;
  requestDomainRevisionSnapshot?: number;
  payloadCanonicalDomainRevision?: unknown;
  currentCanonicalDomainRevision: number;
  legacyUnstampedAllowed: boolean;
}): boolean {
  return args.requestPlanJobId === args.jobId &&
    args.requestReceiptVersion === ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION &&
    Number.isSafeInteger(args.requestGeneration) &&
    (args.requestGeneration ?? 0) > 0 &&
    String(args.payloadRequestId ?? "") === args.requestId &&
    args.payloadReceiptVersion === args.requestReceiptVersion &&
    args.payloadGeneration === args.requestGeneration &&
    oneSetupDomainRevisionReceiptMatches({
      currentCanonicalDomainRevision: args.currentCanonicalDomainRevision,
      receiptDomainRevision: args.requestDomainRevisionSnapshot,
      legacyUnstampedAllowed: args.legacyUnstampedAllowed,
    }) &&
    oneSetupDomainRevisionReceiptMatches({
      currentCanonicalDomainRevision: args.currentCanonicalDomainRevision,
      receiptDomainRevision: args.payloadCanonicalDomainRevision,
      legacyUnstampedAllowed: args.legacyUnstampedAllowed,
    }) &&
    args.requestDomainRevisionSnapshot ===
      args.payloadCanonicalDomainRevision;
}
