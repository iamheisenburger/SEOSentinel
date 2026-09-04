export const CADENCE_REVISION_RECOVERY_VERSION = 1;
export const CADENCE_REVISION_RECOVERY_MAX_AGE_MS =
  7 * 24 * 60 * 60 * 1000;
export const CADENCE_REVISION_RECOVERY_MAX_SERP_CANDIDATES = 5;

export type CadenceRevisionCandidateAudit = {
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

export type CadenceRevisionExhaustionAttempt = {
  id: string;
  siteId: string;
  sourcePlanId: string;
  attemptKind?: string;
  policyVersion: number;
  rolloutEpoch: number;
  status: string;
  errorCode?: string;
  providerCallAttempted: boolean;
  providerCallCompleted: boolean;
  providerAttemptedAt?: number;
  providerCompletedAt?: number;
  completedAt?: number;
  createdAt: number;
  candidateReceiptCount: number;
  candidateAudit?: CadenceRevisionCandidateAudit;
  candidateShortlistCount: number;
  candidateAttemptCount?: number;
  priorCandidateAttemptCount: number;
  hasSelectedOrTopicReceipt: boolean;
  hasEvidenceReceipt: boolean;
  cadenceScheduleAttempts: number;
  hasCadenceScheduleReceipt: boolean;
  finalizeAttempts: number;
  workerToken?: string;
  leaseExpiresAt?: number;
  parentMicroSeedJobId?: string;
  parentMicroSeedReceiptFingerprint?: string;
};

function safeTimestamp(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! >= 0;
}

function auditAccountsForEveryRow(
  attempt: CadenceRevisionExhaustionAttempt,
): boolean {
  const audit = attempt.candidateAudit;
  if (
    !audit ||
    !Object.values(audit).every((value) =>
      Number.isSafeInteger(value) && value >= 0
    ) ||
    attempt.candidateReceiptCount > audit.received ||
    audit.invalidMetric < audit.received - attempt.candidateReceiptCount
  ) return false;
  const rejected = audit.invalidMetric + audit.intentUnavailable +
    audit.difficulty + audit.brand + audit.businessFit + audit.duplicate +
    audit.overlap;
  return rejected + audit.accepted === audit.received;
}

function terminalAttemptValid(
  attempt: CadenceRevisionExhaustionAttempt,
  expectedAttemptKind: "primary" | "fallback",
  expectedPolicyVersion: number,
  expectedRolloutEpoch: number,
  now: number,
): boolean {
  if (
    (attempt.attemptKind ?? "primary") !== expectedAttemptKind ||
    attempt.policyVersion !== expectedPolicyVersion ||
    attempt.rolloutEpoch !== expectedRolloutEpoch ||
    attempt.status !== "missed" ||
    !attempt.providerCallAttempted ||
    !attempt.providerCallCompleted ||
    !safeTimestamp(attempt.createdAt) ||
    !safeTimestamp(attempt.providerAttemptedAt) ||
    !safeTimestamp(attempt.providerCompletedAt) ||
    !safeTimestamp(attempt.completedAt) ||
    attempt.createdAt > attempt.providerAttemptedAt ||
    attempt.providerAttemptedAt > attempt.providerCompletedAt ||
    attempt.providerCompletedAt > attempt.completedAt ||
    attempt.completedAt > now ||
    now - attempt.completedAt > CADENCE_REVISION_RECOVERY_MAX_AGE_MS ||
    attempt.workerToken !== undefined ||
    attempt.leaseExpiresAt !== undefined ||
    attempt.cadenceScheduleAttempts !== 0 ||
    attempt.hasCadenceScheduleReceipt ||
    !auditAccountsForEveryRow(attempt)
  ) return false;

  const audit = attempt.candidateAudit!;
  if (attempt.errorCode === "no_strict_candidate") {
    return audit.accepted === 0 &&
      attempt.candidateShortlistCount === 0 &&
      (attempt.candidateAttemptCount ?? 0) === 0 &&
      attempt.priorCandidateAttemptCount === 0 &&
      !attempt.hasSelectedOrTopicReceipt &&
      !attempt.hasEvidenceReceipt &&
      attempt.finalizeAttempts === 0;
  }
  if (attempt.errorCode === "semantic_failure") {
    const expectedShortlistCount = Math.min(
      audit.accepted,
      CADENCE_REVISION_RECOVERY_MAX_SERP_CANDIDATES,
    );
    return audit.accepted > 0 &&
      attempt.candidateShortlistCount === expectedShortlistCount &&
      attempt.candidateAttemptCount === expectedShortlistCount &&
      attempt.priorCandidateAttemptCount === expectedShortlistCount - 1 &&
      attempt.hasSelectedOrTopicReceipt &&
      attempt.hasEvidenceReceipt &&
      attempt.finalizeAttempts === 1;
  }
  return false;
}

/**
 * A cadence revision is authorized only after the current algorithm's exact
 * primary and one-shot fallback have both completed every paid and live-SERP
 * boundary without finding a safe new page. This never converts provider,
 * lease, or scheduling ambiguity into publication authority.
 */
export function cadenceRevisionRecoveryReceiptValid(args: {
  siteId: string;
  rolloutEpoch: number;
  policyVersion: number;
  expectedParentReceiptFingerprint: string;
  parent: CadenceRevisionExhaustionAttempt;
  child: CadenceRevisionExhaustionAttempt;
  now: number;
}): boolean {
  const { parent, child } = args;
  return Boolean(
    safeTimestamp(args.now) &&
      parent.siteId === args.siteId &&
      child.siteId === args.siteId &&
      parent.sourcePlanId === child.sourcePlanId &&
      child.parentMicroSeedJobId === parent.id &&
      typeof child.parentMicroSeedReceiptFingerprint === "string" &&
      /^[a-f0-9]{64}$/.test(child.parentMicroSeedReceiptFingerprint) &&
      child.parentMicroSeedReceiptFingerprint ===
        args.expectedParentReceiptFingerprint &&
      parent.parentMicroSeedJobId === undefined &&
      parent.parentMicroSeedReceiptFingerprint === undefined &&
      parent.completedAt !== undefined &&
      child.createdAt >= parent.completedAt &&
      terminalAttemptValid(
        parent,
        "primary",
        args.policyVersion,
        args.rolloutEpoch,
        args.now,
      ) &&
      terminalAttemptValid(
        child,
        "fallback",
        args.policyVersion,
        args.rolloutEpoch,
        args.now,
      )
  );
}

export function effectiveCadencePublicationAt(args: {
  articlePublishedAt?: number;
  verifiedRevisionAt?: number;
}): number | undefined {
  const candidates = [args.articlePublishedAt, args.verifiedRevisionAt]
    .filter((value): value is number => safeTimestamp(value));
  return candidates.length > 0 ? Math.max(...candidates) : undefined;
}
