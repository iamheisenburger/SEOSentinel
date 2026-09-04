import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import {
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  topicPlanProviderReservationTriggerFromPayload,
} from "./lib/planProviderBudget";
import {
  CADENCE_MICRO_SEED_ANCHOR_AUDIT_VERSION,
  CADENCE_MICRO_SEED_BALANCE_RECEIPT_MAX_AGE_MS,
  CADENCE_MICRO_SEED_COMPACT_RECEIPT_VERSION,
  CADENCE_MICRO_SEED_FINALIZE_DELAY_MS,
  CADENCE_MICRO_SEED_LEASE_MS,
  CADENCE_MICRO_SEED_MAX_CADENCE_HORIZON_MS,
  CADENCE_MICRO_SEED_MAX_FINALIZE_ATTEMPTS,
  CADENCE_MICRO_SEED_MAX_JOB_AGE_MS,
  CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES,
  CADENCE_MICRO_SEED_MAX_SCHEDULE_ATTEMPTS,
  CADENCE_MICRO_SEED_MAX_SOURCE_PLAN_AGE_MS,
  CADENCE_MICRO_SEED_MAX_WATCHDOG_RECOVERIES,
  CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD,
  CADENCE_MICRO_SEED_READ_LIMIT,
  CADENCE_MICRO_SEED_RESULT_LIMIT,
  CADENCE_MICRO_SEED_VERSION,
  CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
  cadenceMicroSeedAttemptExhaustsCurrentEnvelope,
  cadenceMicroSeedPreSerpDifficultyCeiling,
  cadenceMicroSeedAnchors,
  cadenceMicroSeedRecoveryAnchors,
  cadenceMicroSeedLegacyAnchorReceiptEligible,
  cadenceMicroSeedAttemptKind,
  cadenceMicroSeedProviderCeilingMicroUsd,
  cadenceMicroSeedDiscoveryEndpoint,
  cadenceMicroSeedProviderPurpose,
  cadenceMicroSeedProviderReceiptValid,
  cadenceMicroSeedProviderTrigger,
  cadenceMicroSeedCheckpointSourcePlanExhaustionKind,
  cadenceMicroSeedSourcePlanExecutionExhausted,
  cadenceMicroSeedSourcePlanFresh,
  cadenceMicroSeedTerminalMissReceiptValid,
  normalizeCadenceMicroSeedText,
  cadenceMicroSeedMatchingAnchor,
  selectCadenceMicroSeedAnchorBatch,
  selectCadenceMicroSeedProbeBatch,
  selectCadenceMicroSeedCandidate,
  type CadenceMicroSeedAttemptKind,
  type CadenceMicroSeedMetric,
} from "./lib/cadenceMicroSeed";
import { operatorTerminalPlanReceipt } from "./lib/operatorSnapshot";
import {
  autopilotCandidateWindowStart,
  approvedBufferPolicy,
  cadenceIntervalMs,
  coveredIntentTopics,
  effectivePublishedAt,
  evaluateTopicBusinessFit,
  filterNonCannibalizingIntentTopics,
  isSealedReady,
  isUnderfilledPlanContinuationPayload,
  TOPIC_BUSINESS_FIT_VERSION,
  tenantTopicBusinessSignals,
} from "./lib/autopilotBuffer";
import {
  CADENCE_QUALITY_RECOVERY_READ_LIMIT,
  hasRecoverableQualityWork,
} from "./lib/autopilotCadence";
import {
  DATAFORSEO_DEMAND_SOURCE,
  EXPECTED_CLICK_PORTFOLIO_VERSION,
  evaluateStoredExpectedClickPortfolio,
  estimateTopicExpectedClicks,
  expectedClickTopicFromStoredEvidence,
  measuredAuthorityIsFresh,
  tenantAuthorityFromStoredEvidence,
} from "./lib/expectedClickPortfolio";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
} from "./lib/expectedClickEvidenceBackfill";
import { terminalNoMetricDemandReceiptFingerprint } from
  "./expectedClickDemandBackfill";
import { evaluateSerpAttainability } from "./lib/serpAttainability";
import { verifiedAuthorityTarget } from "./lib/publicationLive";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "./lib/dataForSeoLocale";
import {
  releaseSharedProviderReservation,
  reserveSharedProviderBudget,
  settleSharedProviderReservation,
} from "./lib/providerSpendReservation";
import {
  plannedTopicRecoveryFingerprint,
  plannedTopicSiteGate,
  type PlannedRecoveryArticle,
  verifiedKeywordPlanningActive,
} from "./lib/plannedTopicEvidenceRecovery";
import {
  resolvePlanFromFeatures,
} from "./planLimits";
import { terminalContentFeasibility } from "./lib/topicLifecycle";
import { sha256Hex } from "./lib/publicationArtifact";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import {
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  takeCurrentDomainArticleSummariesByStatus,
  takeCurrentDomainArticles,
  takeCurrentDomainTopics,
  takeCurrentDomainTopicsByContentFeasibility,
  takeCurrentDomainTopicsByStatus,
  topicMatchesCurrentDomain,
} from "./lib/siteDomainBinding";

const ACTIVE_CONTENT_STATUSES = ["pending", "running"] as const;
const ACTIVE_EVIDENCE_STATUSES = ["pending", "running", "partial"] as const;
const CADENCE_MICRO_SEED_RELEVANT_TOPIC_READ_LIMIT = 512;
const CADENCE_MICRO_SEED_CANDIDATE_TOPIC_STATUSES = [
  undefined,
  "pending",
  "planned",
  "queued",
] as const;
const CADENCE_MICRO_SEED_ARTICLE_STATUSES = [
  "draft",
  "review",
  "ready",
  "published",
] as const;

function utcMonthStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function sourcePlanFingerprint(
  job: Doc<"jobs">,
  reservation: Doc<"provider_spend_reservations">,
  checkpoints: readonly Doc<"plan_candidate_checkpoints">[],
): string {
  const receipt = {
    contract: "cadence-micro-seed-source-plan-v1",
    jobId: String(job._id),
    siteId: job.siteId ? String(job.siteId) : null,
    status: job.status,
    workerAttempts: job.workerAttempts,
    payload: job.payload,
    result: job.result,
    providerCostCeilingMicroUsd: job.providerCostCeilingMicroUsd,
    providerCostReservedMicroUsd: job.providerCostReservedMicroUsd,
    providerCostReservationDay: job.providerCostReservationDay,
    providerSpendReservationId: job.providerSpendReservationId
      ? String(job.providerSpendReservationId)
      : null,
    providerReservationReleasedAt: job.providerReservationReleasedAt,
    reservation: {
      id: String(reservation._id),
      siteId: reservation.siteId ? String(reservation.siteId) : null,
      userId: reservation.userId,
      purpose: reservation.purpose,
      trigger: reservation.trigger,
      reservedMicroUsd: reservation.reservedMicroUsd,
      reservationDay: reservation.reservationDay,
      releasedAt: reservation.releasedAt,
      createdAt: reservation.createdAt,
    },
  };
  // Preserve the v1 fingerprint byte-for-byte for already-admitted legacy
  // continuation jobs. Checkpoints were never part of that contract. A
  // checkpoint-qualified source is a newly admitted shape and binds its exact
  // immutable partition in addition to the original v1 fields.
  if (checkpoints.length === 0) return JSON.stringify(receipt);
  return JSON.stringify({
    ...receipt,
    checkpoints: checkpoints.map((checkpoint) => ({
      id: String(checkpoint._id),
      siteId: String(checkpoint.siteId),
      userId: checkpoint.userId,
      planJobId: String(checkpoint.planJobId),
      providerSpendReservationId: String(checkpoint.providerSpendReservationId),
      providerCostCeilingMicroUsd: checkpoint.providerCostCeilingMicroUsd,
      providerCostReservedMicroUsd: checkpoint.providerCostReservedMicroUsd,
      reservationDay: checkpoint.reservationDay,
      rolloutEpoch: checkpoint.rolloutEpoch,
      policyVersion: checkpoint.policyVersion,
      status: checkpoint.status,
      workerExecution: checkpoint.workerExecution,
      requiredVerifiedYield: checkpoint.requiredVerifiedYield,
      candidateCapacity: checkpoint.candidateCapacity,
      candidateTopicIds: checkpoint.candidateTopicIds.map(String),
      candidateFingerprints: checkpoint.candidateFingerprints,
      inlineCompletedTopicIds: checkpoint.inlineCompletedTopicIds?.map(String),
      activatedTopicIds: checkpoint.activatedTopicIds?.map(String),
      terminallyExcludedTopicIds:
        checkpoint.terminallyExcludedTopicIds?.map(String),
      inlineSuccessCommitNonce: checkpoint.inlineSuccessCommitNonce,
      activationScheduledAt: checkpoint.activationScheduledAt,
      activatedAt: checkpoint.activatedAt,
      completedAt: checkpoint.completedAt,
      createdAt: checkpoint.createdAt,
      updatedAt: checkpoint.updatedAt,
    })),
  });
}

function sourcePlanFingerprintForPolicy(
  job: Doc<"jobs">,
  reservation: Doc<"provider_spend_reservations">,
  checkpoints: readonly Doc<"plan_candidate_checkpoints">[],
  policyVersion: number,
): string {
  const fingerprint = sourcePlanFingerprint(job, reservation, checkpoints);
  return policyVersion >= CADENCE_MICRO_SEED_COMPACT_RECEIPT_VERSION
    ? sha256Hex(fingerprint)
    : fingerprint;
}

function primaryFallbackReceiptFingerprint(
  job: Doc<"cadence_micro_seed_jobs">,
  reservation: Doc<"provider_spend_reservations">,
): string {
  // Preserve the original zero-row fingerprint byte-for-byte for already
  // admitted fallback children. A fully rejected non-empty response uses a
  // distinct contract so the expanded authority cannot be confused with the
  // earlier zero-result-only policy.
  const zeroResult = job.candidateAudit?.received === 0 &&
    job.candidateReceipts.length === 0;
  const fingerprint = JSON.stringify({
    contract: zeroResult
      ? "cadence-micro-seed-zero-result-parent-v1"
      : "cadence-micro-seed-terminal-miss-parent-v1",
    job: {
      id: String(job._id),
      siteId: String(job.siteId),
      userId: job.userId,
      status: job.status,
      attemptKind: job.attemptKind ?? "primary",
      policyVersion: job.policyVersion,
      rolloutEpoch: job.rolloutEpoch,
      reservationDay: job.reservationDay,
      sourcePlanId: String(job.sourcePlanId),
      sourcePlanFingerprint: job.sourcePlanFingerprint,
      sourcePlanReservationId: String(job.sourcePlanReservationId),
      seed: normalizeCadenceMicroSeedText(job.seed),
      providerSeeds: (job.providerSeeds ?? [job.seed]).map(
        normalizeCadenceMicroSeedText,
      ),
      locationCode: job.locationCode,
      languageCode: job.languageCode.trim().toLowerCase(),
      providerEndpoint: job.providerEndpoint,
      providerResultLimit: job.providerResultLimit,
      includeSerpInfo: job.includeSerpInfo,
      includeClickstreamData: job.includeClickstreamData,
      providerCostCeilingMicroUsd: job.providerCostCeilingMicroUsd,
      providerCostReservedMicroUsd: job.providerCostReservedMicroUsd,
      providerSpendReservationId: String(job.providerSpendReservationId),
      providerCallAttempted: job.providerCallAttempted,
      providerCallCompleted: job.providerCallCompleted,
      providerAttemptedAt: job.providerAttemptedAt,
      providerCompletedAt: job.providerCompletedAt,
      providerRequestTag: job.providerRequestTag,
      providerTaskCostUsd: job.providerTaskCostUsd,
      candidateReceipts: job.candidateReceipts,
      candidateAudit: job.candidateAudit,
      errorCode: job.errorCode,
      finalizeAttempts: job.finalizeAttempts,
      cadenceScheduleAttempts: job.cadenceScheduleAttempts ?? 0,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
    },
    reservation: {
      id: String(reservation._id),
      siteId: reservation.siteId ? String(reservation.siteId) : null,
      userId: reservation.userId,
      purpose: reservation.purpose,
      trigger: reservation.trigger,
      reservedMicroUsd: reservation.reservedMicroUsd,
      reservationDay: reservation.reservationDay,
      reservationMonth: reservation.reservationMonth,
      releasedAt: reservation.releasedAt,
      releaseReason: reservation.releaseReason,
      createdAt: reservation.createdAt,
    },
  });
  return job.policyVersion >= CADENCE_MICRO_SEED_COMPACT_RECEIPT_VERSION
    ? sha256Hex(fingerprint)
    : fingerprint;
}

function validPrimaryFallbackReceipt(args: {
  site: Doc<"sites">;
  job: Doc<"cadence_micro_seed_jobs">;
  reservation: Doc<"provider_spend_reservations"> | null;
  sourcePlanId: Id<"jobs">;
  sourcePlanReservationId: Id<"provider_spend_reservations">;
  sourcePlanFingerprint: string;
  primarySeed: string;
  primarySeeds: readonly string[];
  locationCode: number;
  languageCode: string;
  timestamp: number;
}): args is typeof args & {
  reservation: Doc<"provider_spend_reservations">;
} {
  const { site, job, reservation, timestamp } = args;
  const candidateAudit = job.candidateAudit;
  const hasSelectedOrTopicReceipt = Boolean(
    job.selectedCandidate ||
      job.topicId ||
      job.topicFingerprint ||
      job.plannedEvidenceFingerprint,
  );
  const hasEvidenceOrCadenceReceipt = Boolean(
    job.evidenceJobId ||
      job.evidenceQueueReason ||
      job.evidenceFinalizerScheduledAt ||
      job.cadenceScheduleRequestedAt ||
      job.cadenceScheduleMode ||
      job.cadenceScheduleScheduled !== undefined ||
      job.cadenceScheduleReceiptAt,
  );
  return Boolean(
    site.userId &&
      job.siteId === site._id &&
      job.userId === site.userId &&
      job.sourcePlanId === args.sourcePlanId &&
      job.sourcePlanReservationId === args.sourcePlanReservationId &&
      job.sourcePlanFingerprint === args.sourcePlanFingerprint &&
      job.parentMicroSeedJobId === undefined &&
      job.parentMicroSeedReceiptFingerprint === undefined &&
      JSON.stringify(job.providerSeeds ?? [job.seed]) ===
        JSON.stringify(args.primarySeeds) &&
      cadenceMicroSeedTerminalMissReceiptValid({
        attemptKind: job.attemptKind,
        hasParent: Boolean(
          job.parentMicroSeedJobId || job.parentMicroSeedReceiptFingerprint,
        ),
        status: job.status,
        policyVersion: job.policyVersion,
        expectedPolicyVersion: CADENCE_MICRO_SEED_VERSION,
        rolloutEpoch: job.rolloutEpoch,
        expectedRolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        reservationDay: job.reservationDay,
        expectedReservationDay: utcDay(timestamp),
        createdAt: job.createdAt,
        now: timestamp,
        seed: job.seed,
        expectedSeed: args.primarySeed,
        locationCode: job.locationCode,
        expectedLocationCode: args.locationCode,
        languageCode: job.languageCode,
        expectedLanguageCode: args.languageCode,
        providerEndpoint: job.providerEndpoint,
        providerResultLimit: job.providerResultLimit,
        includeSerpInfo: job.includeSerpInfo,
        includeClickstreamData: job.includeClickstreamData,
        providerCostCeilingMicroUsd: job.providerCostCeilingMicroUsd,
        providerCostReservedMicroUsd: job.providerCostReservedMicroUsd,
        providerCallAttempted: job.providerCallAttempted,
        providerCallCompleted: job.providerCallCompleted,
        providerAttemptedAt: job.providerAttemptedAt,
        providerCompletedAt: job.providerCompletedAt,
        completedAt: job.completedAt,
        providerRequestTag: job.providerRequestTag,
        expectedProviderRequestTag:
          `cadence-micro-seed-v${CADENCE_MICRO_SEED_VERSION}-${String(job._id)}`,
        providerTaskCostUsd: job.providerTaskCostUsd,
        candidateReceiptCount: job.candidateReceipts.length,
        candidateAudit,
        errorCode: job.errorCode,
        workerToken: job.workerToken,
        leaseExpiresAt: job.leaseExpiresAt,
        hasSelectedOrTopicReceipt,
        hasEvidenceOrCadenceReceipt,
        finalizeAttempts: job.finalizeAttempts,
        cadenceScheduleAttempts: job.cadenceScheduleAttempts ?? 0,
      }) &&
      reservation &&
      job.providerSpendReservationId === reservation._id &&
      reservation.siteId === site._id &&
      reservation.userId === site.userId &&
      reservation.purpose === "cadence_micro_seed" &&
      reservation.trigger ===
        `cadence_micro_seed_v${CADENCE_MICRO_SEED_VERSION}` &&
      reservation.reservedMicroUsd ===
        CADENCE_MICRO_SEED_PROVIDER_CEILING_MICRO_USD &&
      reservation.reservationDay === job.reservationDay &&
      reservation.createdAt === job.createdAt &&
      reservation.releasedAt === undefined,
  );
}

function validExhaustedSourcePlan(args: {
  site: Doc<"sites">;
  job: Doc<"jobs">;
  reservation: Doc<"provider_spend_reservations"> | null;
  checkpoints: readonly Doc<"plan_candidate_checkpoints">[];
  timestamp: number;
}): boolean {
  const { site, job, reservation, checkpoints, timestamp } = args;
  const payload = job.payload && typeof job.payload === "object"
    ? job.payload as Record<string, unknown>
    : {};
  const marker = payload.underfilledPlanContinuation &&
      typeof payload.underfilledPlanContinuation === "object"
    ? payload.underfilledPlanContinuation as Record<string, unknown>
    : {};
  const result = job.result && typeof job.result === "object"
    ? job.result as Record<string, unknown>
    : {};
  const providerBudget = result.providerBudget &&
      typeof result.providerBudget === "object"
    ? result.providerBudget as Record<string, unknown>
    : {};
  const terminal = reservation && ["done", "failed"].includes(job.status)
    ? operatorTerminalPlanReceipt({
        siteId: site._id,
        siteUserId: site.userId,
        job,
        domainBinding: "current",
        expectedReservationTrigger:
          topicPlanProviderReservationTriggerFromPayload(job.payload),
        checkpoints,
        reservation,
      })
    : null;
  const legacyExecutionExhausted = isUnderfilledPlanContinuationPayload(
      job.payload,
    ) && cadenceMicroSeedSourcePlanExecutionExhausted({
      status: job.status,
      workerAttempts: job.workerAttempts,
      workerToken: job.workerToken,
      heartbeatAt: job.heartbeatAt,
      leaseExpiresAt: job.leaseExpiresAt,
      nextAttemptAt: job.nextAttemptAt,
      jobCreatedAt: job.createdAt,
      reservationDay: job.providerCostReservationDay,
      marker,
      result,
    });
  const checkpointExhaustionKind = terminal?.checkpoint
    ? cadenceMicroSeedCheckpointSourcePlanExhaustionKind({
      status: terminal.status,
      checkpointState: terminal.checkpointState,
      checkpointStatus: terminal.checkpoint.status,
      providerReservationState: terminal.providerReservationState,
      persistedTopicCountState: terminal.persistedTopicCountState,
      requiredVerifiedYield: terminal.checkpoint.requiredVerifiedYield,
      usableTopicCount: terminal.checkpoint.usableTopicCount,
      cadenceFailureCategory: terminal.cadenceFailure?.category,
      cadenceFailureCode: terminal.cadenceFailure?.code,
      cadenceFailureTerminal: terminal.cadenceFailure?.terminal,
    })
    : null;
  const checkpointExecutionExhausted = checkpointExhaustionKind !== null;
  const executionReceiptBound = checkpointExhaustionKind === "strict_zero_yield"
    ? terminal?.checkpoint?.workerExecution === 1
    : providerBudget.workerExecution === 1 &&
      providerBudget.reservedMicroUsd ===
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
      providerBudget.ceilingMicroUsd ===
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
      providerBudget.reservationDay === job.providerCostReservationDay;
  return Boolean(
    site.userId &&
      job.siteId === site._id &&
      job.type === "plan" &&
      job.canonicalDomain === siteCanonicalDomain(site) &&
      job.domainRevision === siteCanonicalDomainRevision(site) &&
      job.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0) &&
      (legacyExecutionExhausted || checkpointExecutionExhausted) &&
      executionReceiptBound &&
      job.providerCostCeilingMicroUsd ===
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
      job.providerCostReservedMicroUsd ===
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
      cadenceMicroSeedSourcePlanFresh({
        jobCreatedAt: job.createdAt,
        reservationDay: job.providerCostReservationDay,
        timestamp,
      }) &&
      job.providerReservationReleasedAt === undefined &&
      reservation &&
      reservation.siteId === site._id &&
      reservation.userId === site.userId &&
      reservation.purpose === "topic_plan" &&
      reservation.trigger === "topic_plan" &&
      reservation.reservedMicroUsd ===
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
      reservation.reservationDay === job.providerCostReservationDay &&
      reservation.createdAt === job.createdAt &&
      reservation.releasedAt === undefined,
  );
}

function topicFingerprint(args: {
  jobId: Id<"cadence_micro_seed_jobs">;
  sourcePlanFingerprint: string;
  site: Doc<"sites">;
  keyword: string;
  measuredAt: number;
}): string {
  return JSON.stringify({
    contract: "cadence-micro-seed-topic-v1",
    jobId: String(args.jobId),
    sourcePlanFingerprint: args.sourcePlanFingerprint,
    siteId: String(args.site._id),
    rolloutEpoch: args.site.autopilotRolloutEpoch ?? 0,
    businessSignals: tenantTopicBusinessSignals(args.site),
    keyword: normalizeCadenceMicroSeedText(args.keyword),
    measuredAt: args.measuredAt,
  });
}

/** Current jobs and the immediately preceding paid-receipt shape may finish a
 * version-bound semantic continuation. Older policies must start over through
 * ordinary current-policy admission. */
function cadenceMicroSeedContinuationVersion(
  jobVersion: number,
  topicVersion?: number,
): boolean {
  return Number.isInteger(jobVersion) &&
    Number.isInteger(topicVersion) &&
    topicVersion === jobVersion &&
    jobVersion >= CADENCE_MICRO_SEED_VERSION - 1 &&
    jobVersion <= CADENCE_MICRO_SEED_VERSION;
}

type ReadinessResult =
  | {
      ready: true;
      inspectionKey: string;
      reservationDay: string;
      rolloutEpoch: number;
      sourcePlanId: Id<"jobs">;
      sourcePlanReservationId: Id<"provider_spend_reservations">;
      sourcePlanFingerprint: string;
      attemptKind: CadenceMicroSeedAttemptKind;
      parentMicroSeedJobId?: Id<"cadence_micro_seed_jobs">;
      parentMicroSeedReceiptFingerprint?: string;
      seed: string;
      providerSeeds: string[];
      locationCode: number;
      languageCode: string;
      planTier: string;
      nextCadenceDueAt: number;
      providerCostCeilingMicroUsd: number;
      evidenceHeadroomMicroUsd: number;
    }
  | { ready: false; reason: string };

async function activeEvidenceRows(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
): Promise<number> {
  let total = 0;
  for (const status of ACTIVE_EVIDENCE_STATUSES) {
    const rows = await ctx.db
      .query("expected_click_evidence_jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", status)
      )
      .take(2);
    total += rows.length;
  }
  return total;
}

type CadenceTopicInventory = {
  topics: Doc<"topic_clusters">[];
  exhausted: boolean;
};

type CadenceArticleInventory = {
  articles: PlannedRecoveryArticle[];
  exhausted: boolean;
};

type CadenceTopicReadinessPrecheck = {
  ready: true;
  contract: "cadence-topic-readiness-v1";
  siteId: string;
  canonicalDomain: string;
  domainRevision: number;
  rolloutEpoch: number;
  inventoryFingerprint: string;
  schedulerTopicAvailable: boolean;
  coveredKeywords: string[];
};

type CadenceTopicReadinessResult = CadenceTopicReadinessPrecheck | {
  ready: false;
  reason: string;
};

type CadenceOperationalReadinessPrecheck = {
  ready: true;
  contract: "cadence-operational-readiness-v1";
  siteId: string;
  canonicalDomain: string;
  domainRevision: number;
  rolloutEpoch: number;
  currentJobId?: string;
  operationalFingerprint: string;
  remainingArticles: number;
  nextCadenceDueAt: number;
  terminalNoMetricDemandReceiptFingerprint?: string;
};

type CadenceOperationalReadinessResult =
  | CadenceOperationalReadinessPrecheck
  | { ready: false; reason: string };

type CadenceSourceReadinessPrecheck = {
  ready: true;
  contract: "cadence-source-readiness-v1";
  siteId: string;
  canonicalDomain: string;
  domainRevision: number;
  rolloutEpoch: number;
  currentJobId?: string;
  topicInventoryFingerprint: string;
  sourceInventoryFingerprint: string;
  sourcePlanId: Id<"jobs">;
  sourcePlanReservationId: Id<"provider_spend_reservations">;
  sourcePlanFingerprint: string;
  attemptKind: CadenceMicroSeedAttemptKind;
  parentMicroSeedJobId?: Id<"cadence_micro_seed_jobs">;
  parentMicroSeedReceiptFingerprint?: string;
  seed: string;
  providerSeeds: string[];
  locationCode: number;
  languageCode: string;
  planTier: string;
  planFeatures: string[];
  providerCostCeilingMicroUsd: number;
  evidenceHeadroomMicroUsd: number;
};

type CadenceSourceReadinessResult =
  | CadenceSourceReadinessPrecheck
  | { ready: false; reason: string };

type CadenceSourcePlanReadinessPrecheck = {
  ready: true;
  contract: "cadence-source-plan-readiness-v1";
  siteId: string;
  canonicalDomain: string;
  domainRevision: number;
  rolloutEpoch: number;
  sourcePlanId: Id<"jobs">;
  sourcePlanReservationId: Id<"provider_spend_reservations">;
  sourcePlanFingerprint: string;
};

type CadenceSourcePlanReadinessResult =
  | CadenceSourcePlanReadinessPrecheck
  | { ready: false; reason: string };

type CadencePriorPolicyHistoryPrecheck = {
  ready: true;
  contract: "cadence-prior-policy-history-v1";
  siteId: string;
  canonicalDomain: string;
  domainRevision: number;
  rolloutEpoch: number;
  sourcePlanId: Id<"jobs">;
  policyVersion: number;
  attemptedPrimarySeeds: string[];
  attemptedFallbackSeeds: string[];
  historyFingerprint: string;
};

type CadencePriorPolicyHistoryResult =
  | CadencePriorPolicyHistoryPrecheck
  | { ready: false; reason: string };

type CadencePriorPolicyHistoryAggregate = {
  ready: true;
  contract: "cadence-prior-policy-history-aggregate-v1";
  siteId: string;
  canonicalDomain: string;
  domainRevision: number;
  rolloutEpoch: number;
  sourcePlanId: Id<"jobs">;
  policyVersionCount: number;
  attemptedPrimarySeeds: string[];
  attemptedFallbackSeeds: string[];
  historyFingerprint: string;
};

type CadenceCurrentPolicyReadinessPrecheck = {
  ready: true;
  contract: "cadence-current-policy-readiness-v1";
  siteId: string;
  canonicalDomain: string;
  domainRevision: number;
  rolloutEpoch: number;
  currentJobId?: string;
  topicInventoryFingerprint: string;
  priorPolicyHistoryFingerprint: string;
  sourcePlanId: Id<"jobs">;
  sourcePlanReservationId: Id<"provider_spend_reservations">;
  sourcePlanFingerprint: string;
  currentPolicyFingerprint: string;
  attemptKind: CadenceMicroSeedAttemptKind;
  parentMicroSeedJobId?: Id<"cadence_micro_seed_jobs">;
  parentMicroSeedReceiptFingerprint?: string;
  seed: string;
  providerSeeds: string[];
  locationCode: number;
  languageCode: string;
};

type CadenceCurrentPolicyReadinessResult =
  | CadenceCurrentPolicyReadinessPrecheck
  | { ready: false; reason: string };

type CadenceCurrentPolicyLedgerPrecheck = {
  ready: true;
  contract: "cadence-current-policy-ledger-v1";
  siteId: string;
  canonicalDomain: string;
  domainRevision: number;
  rolloutEpoch: number;
  currentJobId?: string;
  sourcePlanId: Id<"jobs">;
  jobIds: Id<"cadence_micro_seed_jobs">[];
  ledgerFingerprint: string;
};

type CadenceCurrentPolicyLedgerResult =
  | CadenceCurrentPolicyLedgerPrecheck
  | { ready: false; reason: string };

type CadenceFallbackParentPrecheck = {
  ready: true;
  contract: "cadence-fallback-parent-readiness-v1";
  siteId: string;
  canonicalDomain: string;
  domainRevision: number;
  rolloutEpoch: number;
  sourcePlanId: Id<"jobs">;
  currentPolicyLedgerFingerprint: string;
  parentMicroSeedJobId: Id<"cadence_micro_seed_jobs">;
  expectedChildJobId?: Id<"cadence_micro_seed_jobs">;
  parentMicroSeedReceiptFingerprint: string;
};

type CadenceFallbackParentResult = CadenceFallbackParentPrecheck | {
  ready: false;
  reason: string;
};

const cadenceTopicReadinessPrecheckValidator = v.object({
  ready: v.literal(true),
  contract: v.literal("cadence-topic-readiness-v1"),
  siteId: v.string(),
  canonicalDomain: v.string(),
  domainRevision: v.number(),
  rolloutEpoch: v.number(),
  inventoryFingerprint: v.string(),
  schedulerTopicAvailable: v.boolean(),
  coveredKeywords: v.array(v.string()),
});

const cadenceOperationalReadinessPrecheckValidator = v.object({
  ready: v.literal(true),
  contract: v.literal("cadence-operational-readiness-v1"),
  siteId: v.string(),
  canonicalDomain: v.string(),
  domainRevision: v.number(),
  rolloutEpoch: v.number(),
  currentJobId: v.optional(v.string()),
  operationalFingerprint: v.string(),
  remainingArticles: v.number(),
  nextCadenceDueAt: v.number(),
  terminalNoMetricDemandReceiptFingerprint: v.optional(v.string()),
});

const cadenceSourceReadinessPrecheckValidator = v.object({
  ready: v.literal(true),
  contract: v.literal("cadence-source-readiness-v1"),
  siteId: v.string(),
  canonicalDomain: v.string(),
  domainRevision: v.number(),
  rolloutEpoch: v.number(),
  currentJobId: v.optional(v.string()),
  topicInventoryFingerprint: v.string(),
  sourceInventoryFingerprint: v.string(),
  sourcePlanId: v.id("jobs"),
  sourcePlanReservationId: v.id("provider_spend_reservations"),
  sourcePlanFingerprint: v.string(),
  attemptKind: v.union(v.literal("primary"), v.literal("fallback")),
  parentMicroSeedJobId: v.optional(v.id("cadence_micro_seed_jobs")),
  parentMicroSeedReceiptFingerprint: v.optional(v.string()),
  seed: v.string(),
  providerSeeds: v.array(v.string()),
  locationCode: v.number(),
  languageCode: v.string(),
  planTier: v.string(),
  planFeatures: v.array(v.string()),
  providerCostCeilingMicroUsd: v.number(),
  evidenceHeadroomMicroUsd: v.number(),
});

const cadenceSourcePlanReadinessPrecheckValidator = v.object({
  ready: v.literal(true),
  contract: v.literal("cadence-source-plan-readiness-v1"),
  siteId: v.string(),
  canonicalDomain: v.string(),
  domainRevision: v.number(),
  rolloutEpoch: v.number(),
  sourcePlanId: v.id("jobs"),
  sourcePlanReservationId: v.id("provider_spend_reservations"),
  sourcePlanFingerprint: v.string(),
});

const cadencePriorPolicyHistoryAggregateValidator = v.object({
  ready: v.literal(true),
  contract: v.literal("cadence-prior-policy-history-aggregate-v1"),
  siteId: v.string(),
  canonicalDomain: v.string(),
  domainRevision: v.number(),
  rolloutEpoch: v.number(),
  sourcePlanId: v.id("jobs"),
  policyVersionCount: v.number(),
  attemptedPrimarySeeds: v.array(v.string()),
  attemptedFallbackSeeds: v.array(v.string()),
  historyFingerprint: v.string(),
});

const cadenceCurrentPolicyReadinessPrecheckValidator = v.object({
  ready: v.literal(true),
  contract: v.literal("cadence-current-policy-readiness-v1"),
  siteId: v.string(),
  canonicalDomain: v.string(),
  domainRevision: v.number(),
  rolloutEpoch: v.number(),
  currentJobId: v.optional(v.string()),
  topicInventoryFingerprint: v.string(),
  priorPolicyHistoryFingerprint: v.string(),
  sourcePlanId: v.id("jobs"),
  sourcePlanReservationId: v.id("provider_spend_reservations"),
  sourcePlanFingerprint: v.string(),
  currentPolicyFingerprint: v.string(),
  attemptKind: v.union(v.literal("primary"), v.literal("fallback")),
  parentMicroSeedJobId: v.optional(v.id("cadence_micro_seed_jobs")),
  parentMicroSeedReceiptFingerprint: v.optional(v.string()),
  seed: v.string(),
  providerSeeds: v.array(v.string()),
  locationCode: v.number(),
  languageCode: v.string(),
});

const cadenceCurrentPolicyLedgerPrecheckValidator = v.object({
  ready: v.literal(true),
  contract: v.literal("cadence-current-policy-ledger-v1"),
  siteId: v.string(),
  canonicalDomain: v.string(),
  domainRevision: v.number(),
  rolloutEpoch: v.number(),
  currentJobId: v.optional(v.string()),
  sourcePlanId: v.id("jobs"),
  jobIds: v.array(v.id("cadence_micro_seed_jobs")),
  ledgerFingerprint: v.string(),
});

const cadenceFallbackParentPrecheckValidator = v.object({
  ready: v.literal(true),
  contract: v.literal("cadence-fallback-parent-readiness-v1"),
  siteId: v.string(),
  canonicalDomain: v.string(),
  domainRevision: v.number(),
  rolloutEpoch: v.number(),
  sourcePlanId: v.id("jobs"),
  currentPolicyLedgerFingerprint: v.string(),
  parentMicroSeedJobId: v.id("cadence_micro_seed_jobs"),
  expectedChildJobId: v.optional(v.id("cadence_micro_seed_jobs")),
  parentMicroSeedReceiptFingerprint: v.string(),
});

/** Read compact article projections by lifecycle state. Article Markdown can
 * grow without increasing scheduler transaction cost. */
async function cadenceMicroSeedArticleInventory(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
): Promise<CadenceArticleInventory> {
  const limit = CADENCE_MICRO_SEED_READ_LIMIT;
  const groups = await Promise.all(CADENCE_MICRO_SEED_ARTICLE_STATUSES.map(
    (status) => takeCurrentDomainArticleSummariesByStatus(
      ctx,
      site,
      status,
      limit + 1,
    ),
  ));
  if (groups.some((rows) => rows.length > limit)) {
    return { articles: [], exhausted: true };
  }
  const articles = groups.flat().map((summary): PlannedRecoveryArticle => ({
    _id: summary.articleId,
    siteId: summary.siteId,
    ...(summary.topicId ? { topicId: summary.topicId } : {}),
    status: summary.status,
    slug: summary.slug,
    createdAt: summary.articleCreatedAt,
    ...(summary.auditedAt === undefined ? {} : { auditedAt: summary.auditedAt }),
    ...(summary.publishedAt === undefined
      ? {}
      : { publishedAt: summary.publishedAt }),
    ...(summary.publicUrl === undefined ? {} : { publicUrl: summary.publicUrl }),
    ...(summary.publicationGateStatus === undefined
      ? {}
      : { publicationGateStatus: summary.publicationGateStatus }),
    ...(summary.publicationGateIssues === undefined
      ? {}
      : { publicationGateIssues: summary.publicationGateIssues }),
    ...(summary.publicationAuditVersion === undefined
      ? {}
      : { publicationAuditVersion: summary.publicationAuditVersion }),
    ...(summary.auditedContentHash === undefined
      ? {}
      : { auditedContentHash: summary.auditedContentHash }),
    ...(summary.publishedContentHash === undefined
      ? {}
      : { publishedContentHash: summary.publishedContentHash }),
    ...(summary.factCheckScore === undefined
      ? {}
      : { factCheckScore: summary.factCheckScore }),
    ...(summary.editorialQualityScore === undefined
      ? {}
      : { editorialQualityScore: summary.editorialQualityScore }),
    ...(summary.qualityRevisionCount === undefined
      ? {}
      : { qualityRevisionCount: summary.qualityRevisionCount }),
    ...(summary.qualityRecoveryVersion === undefined
      ? {}
      : { qualityRecoveryVersion: summary.qualityRecoveryVersion }),
    ...(summary.qualityRecoveryAttemptVersion === undefined
      ? {}
      : { qualityRecoveryAttemptVersion: summary.qualityRecoveryAttemptVersion }),
    ...(summary.deterministicQualityRepairAttemptVersion === undefined
      ? {}
      : {
          deterministicQualityRepairAttemptVersion:
            summary.deterministicQualityRepairAttemptVersion,
        }),
  }));
  return { articles, exhausted: false };
}

/**
 * Build the complete topic set that can affect current cadence admission,
 * without hydrating immutable terminal planning history. The inventory is the
 * union of current candidate lifecycle states, durable quality tombstones,
 * and exact topics referenced by current-domain articles. Every indexed slice
 * is bounded and fails closed when the bound is crossed.
 */
async function cadenceMicroSeedTopicInventory(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
  articles: readonly PlannedRecoveryArticle[],
): Promise<CadenceTopicInventory> {
  const limit = CADENCE_MICRO_SEED_RELEVANT_TOPIC_READ_LIMIT;
  const groups = await Promise.all([
    ...CADENCE_MICRO_SEED_CANDIDATE_TOPIC_STATUSES.map((status) =>
      takeCurrentDomainTopicsByStatus(ctx, site, status, limit + 1)
    ),
    takeCurrentDomainTopicsByContentFeasibility(
      ctx,
      site,
      "too_thin",
      limit + 1,
    ),
    takeCurrentDomainTopicsByContentFeasibility(
      ctx,
      site,
      "quality_exhausted",
      limit + 1,
    ),
  ]);
  if (groups.some((rows) => rows.length > limit)) {
    return { topics: [], exhausted: true };
  }
  const linkedTopicIds = Array.from(new Set(articles.flatMap((article) =>
    article.topicId ? [article.topicId] : []
  )));
  if (linkedTopicIds.length > limit) {
    return { topics: [], exhausted: true };
  }
  const linkedTopics = await Promise.all(linkedTopicIds.map((topicId) =>
    ctx.db.get(topicId)
  ));
  const byId = new Map<string, Doc<"topic_clusters">>();
  for (const topic of [...groups.flat(), ...linkedTopics]) {
    if (
      topic &&
      topic.siteId === site._id &&
      topicMatchesCurrentDomain(site, topic)
    ) byId.set(String(topic._id), topic);
  }
  if (byId.size > limit) return { topics: [], exhausted: true };
  return { topics: Array.from(byId.values()), exhausted: false };
}

/**
 * Evaluate the tenant-sized topic graph in its own read-only transaction.
 * The returned digest binds every field that can affect scheduler admission,
 * exact-keyword reuse, or lexical/SERP coverage. The later reservation
 * transaction re-runs the compact operational fence with this exact snapshot;
 * apply therefore fails stale when inventory changes between inspect/apply.
 */
function cadenceTopicReadinessPrecheck(args: {
  site: Doc<"sites">;
  topics: readonly Doc<"topic_clusters">[];
  articles: readonly PlannedRecoveryArticle[];
  timestamp: number;
}): CadenceTopicReadinessPrecheck | { ready: false; reason: string } {
  const authority = tenantAuthorityFromStoredEvidence({
    domain: args.site.seoAuthorityDomain,
    currentDomain: args.site.domain,
    domainRank: args.site.seoAuthorityDomainRank,
    referringDomains: args.site.seoAuthorityReferringDomains,
    source: args.site.seoAuthoritySource,
    measuredAt: args.site.seoAuthorityMeasuredAt,
  });
  if (!measuredAuthorityIsFresh(authority, args.timestamp)) {
    return { ready: false, reason: "tenant_authority_unavailable" };
  }
  const locationCode = dataForSeoLocationCode(args.site.targetCountry);
  const languageCode = dataForSeoLanguageCode(args.site.language);
  const expectedEligibleIds = args.topics.filter((topic) =>
    topic.status !== "plan_checkpoint" &&
    !topic.planCheckpointTerminalFailureCode
  ).flatMap((topic) => {
    const estimate = estimateTopicExpectedClicks({
      topic: expectedClickTopicFromStoredEvidence({
        topicId: String(topic._id),
        keyword: topic.primaryKeyword,
        searchVolume: topic.searchVolume,
        searchDemandSource: topic.searchDemandSource,
        searchDemandMeasuredAt: topic.searchDemandMeasuredAt,
        searchDemandLocationCode: topic.searchDemandLocationCode,
        searchDemandLanguageCode: topic.searchDemandLanguageCode,
        serpTopUrls: topic.serpTopUrls,
        serpObservedAt: topic.serpObservedAt,
        serpLocationCode: topic.serpLocationCode,
        serpLanguageCode: topic.serpLanguageCode,
        serpAuthorityCompetitors: topic.serpAuthorityCompetitors,
      }, { locationCode, languageCode }),
      tenantAuthority: authority,
      now: args.timestamp,
    });
    return estimate.status === "eligible" ? [String(topic._id)] : [];
  }).sort();
  const expectedEligible = new Set(expectedEligibleIds);
  const businessSignals = tenantTopicBusinessSignals(args.site);
  const schedulerCandidates = args.topics.filter((topic) => {
    const fit = evaluateTopicBusinessFit({
      keyword: topic.primaryKeyword,
      label: topic.label,
      ...businessSignals,
    });
    return ![
      "used",
      "queued",
      "cannibalizing",
      "disqualified",
      "plan_checkpoint",
    ].includes(topic.status ?? "planned") &&
      !topic.planCheckpointTerminalFailureCode &&
      fit.eligible && topic.businessFitEligible === true &&
      topic.cadenceMicroSeedAnchorEligible !== false &&
      Number.isFinite(topic.searchVolume) &&
      Number.isFinite(topic.keywordDifficulty) &&
      topic.keywordDifficultyMeasured === true &&
      Boolean(topic.serpIntent?.trim()) &&
      expectedEligible.has(String(topic._id)) &&
      evaluateSerpAttainability({
        serpTopUrls: topic.serpTopUrls,
        siteHost: args.site.domain,
      }).attainable;
  });
  const coverage = coveredIntentTopics(
    args.topics.map((topic) => ({
      _id: String(topic._id),
      status: topic.status ?? "planned",
      primaryKeyword: topic.primaryKeyword,
      serpTopUrls: topic.serpTopUrls,
    })),
    args.articles.map((article) => ({
      topicId: article.topicId ? String(article.topicId) : undefined,
      slug: article.slug,
      status: article.status,
      publicationGateStatus: article.publicationGateStatus,
      publicationAuditVersion: article.publicationAuditVersion,
      auditedContentHash: article.auditedContentHash,
    })),
  );
  const schedulable = filterNonCannibalizingIntentTopics(
    schedulerCandidates,
    coverage,
    0.4,
    0.35,
    1,
  );
  const topicProjection = args.topics.map((topic) => ({
    id: String(topic._id),
    status: topic.status ?? null,
    label: topic.label,
    primaryKeyword: topic.primaryKeyword,
    searchVolume: topic.searchVolume ?? null,
    keywordDifficulty: topic.keywordDifficulty ?? null,
    keywordDifficultyMeasured: topic.keywordDifficultyMeasured ?? null,
    searchDemandSource: topic.searchDemandSource ?? null,
    searchDemandMeasuredAt: topic.searchDemandMeasuredAt ?? null,
    searchDemandLocationCode: topic.searchDemandLocationCode ?? null,
    searchDemandLanguageCode: topic.searchDemandLanguageCode ?? null,
    serpIntent: topic.serpIntent ?? null,
    serpTopUrls: topic.serpTopUrls ?? [],
    serpObservedAt: topic.serpObservedAt ?? null,
    serpLocationCode: topic.serpLocationCode ?? null,
    serpLanguageCode: topic.serpLanguageCode ?? null,
    serpAuthorityCompetitors: topic.serpAuthorityCompetitors ?? [],
    businessFitEligible: topic.businessFitEligible ?? null,
    cadenceMicroSeedAnchorEligible:
      topic.cadenceMicroSeedAnchorEligible ?? null,
    planCheckpointTerminalFailureCode:
      topic.planCheckpointTerminalFailureCode ?? null,
    contentFeasibilityStatus: topic.contentFeasibilityStatus ?? null,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const articleProjection = args.articles.map((article) => ({
    id: String(article._id),
    topicId: article.topicId ? String(article.topicId) : null,
    slug: article.slug,
    status: article.status,
    publicationGateStatus: article.publicationGateStatus ?? null,
    publicationAuditVersion: article.publicationAuditVersion ?? null,
    auditedContentHash: article.auditedContentHash ?? null,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const canonicalDomain = siteCanonicalDomain(args.site);
  if (!canonicalDomain) return { ready: false, reason: "site_unavailable" };
  const coveredKeywords = coverage.map((topic) => topic.primaryKeyword).sort();
  return {
    ready: true,
    contract: "cadence-topic-readiness-v1",
    siteId: String(args.site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(args.site),
    rolloutEpoch: args.site.autopilotRolloutEpoch ?? 0,
    inventoryFingerprint: sha256Hex(JSON.stringify({
      contract: "cadence-topic-inventory-v1",
      siteId: String(args.site._id),
      canonicalDomain,
      domainRevision: siteCanonicalDomainRevision(args.site),
      rolloutEpoch: args.site.autopilotRolloutEpoch ?? 0,
      locationCode,
      languageCode,
      authority,
      businessSignals,
      topics: topicProjection,
      articles: articleProjection,
      expectedEligibleIds,
      schedulerCandidateIds: schedulerCandidates.map((topic) =>
        String(topic._id)
      ).sort(),
      schedulableIds: schedulable.map((topic) => String(topic._id)).sort(),
      coveredKeywords,
    })),
    schedulerTopicAvailable: schedulable.length > 0,
    coveredKeywords,
  };
}

export const inspectTopicReadinessInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<CadenceTopicReadinessResult> => {
    const site = await ctx.db.get(siteId);
    if (
      !siteExecutionActive(site) ||
      !site.userId ||
      !(await siteExecutionAuthorized(ctx, site))
    ) return { ready: false, reason: "site_unavailable" };
    const articleInventory = await cadenceMicroSeedArticleInventory(ctx, site);
    const topicInventory = await cadenceMicroSeedTopicInventory(
      ctx,
      site,
      articleInventory.articles,
    );
    if (articleInventory.exhausted || topicInventory.exhausted) {
      return { ready: false, reason: "read_limit_exhausted" };
    }
    return cadenceTopicReadinessPrecheck({
      site,
      topics: topicInventory.topics,
      articles: articleInventory.articles,
      timestamp: Date.now(),
    });
  },
});

/**
 * Keep quota, buffer, active-work, and cadence-horizon reads in a second
 * bounded transaction. These checks are independent of both the tenant-sized
 * topic graph and the immutable source-plan/no-replay history, so combining
 * all three only made correctness depend on tenant age.
 */
export const inspectOperationalReadinessInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    currentJobId: v.optional(v.id("cadence_micro_seed_jobs")),
  },
  handler: async (
    ctx,
    { siteId, currentJobId },
  ): Promise<CadenceOperationalReadinessResult> => {
    const timestamp = Date.now();
    const site = await ctx.db.get(siteId);
    if (
      !siteExecutionActive(site) ||
      !site.userId ||
      !(await siteExecutionAuthorized(ctx, site))
    ) return { ready: false, reason: "site_unavailable" };
    if (
      !site.autopilotEnabled ||
      site.expectedClickSchedulingEnabled !== true ||
      !verifiedKeywordPlanningActive(site) ||
      !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe") ||
      (site.cadencePerWeek ?? 0) <= 0
    ) return { ready: false, reason: "rollout_ineligible" };
    const siteGate = await plannedTopicSiteGate(ctx, site, timestamp);
    if (!siteGate.allowed) return { ready: false, reason: siteGate.reason };
    const authority = tenantAuthorityFromStoredEvidence({
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    });
    if (!measuredAuthorityIsFresh(authority, timestamp)) {
      return { ready: false, reason: "tenant_authority_unavailable" };
    }
    const [articleInventory, activeContentGroups, evidenceGroups, demandGroups,
      liveMicroJobs, terminalDemandJobs] = await Promise.all([
      cadenceMicroSeedArticleInventory(ctx, site),
      Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
        ctx.db.query("jobs").withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
      )),
      Promise.all(ACTIVE_EVIDENCE_STATUSES.map((status) =>
        ctx.db.query("expected_click_evidence_jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", status)
          ).take(2)
      )),
      Promise.all(ACTIVE_EVIDENCE_STATUSES.map((status) =>
        ctx.db.query("expected_click_demand_jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", status)
          ).take(2)
      )),
      Promise.all([
        "pending",
        "running",
        "awaiting_evidence",
        "evidence_running",
        "cadence_scheduling",
      ].map((status) =>
        ctx.db.query("cadence_micro_seed_jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", status)
          )
          .take(2)
      )),
      ctx.db.query("expected_click_demand_jobs")
        .withIndex("by_site_origin_status", (q) =>
          q.eq("siteId", siteId).eq("origin", "autonomous_fleet").eq(
            "status",
            "completed",
          )
        )
        .order("desc")
        .take(1),
    ]);
    if (
      articleInventory.exhausted ||
      activeContentGroups.some((rows) =>
        rows.length > CADENCE_MICRO_SEED_READ_LIMIT
      )
    ) return { ready: false, reason: "read_limit_exhausted" };
    const activeContent = activeContentGroups.flat().filter((job) =>
      job.type === "article" || job.type === "plan"
    );
    if (
      activeContent.length > 0 ||
      evidenceGroups.flat().length > 0 ||
      demandGroups.flat().length > 0
    ) return { ready: false, reason: "work_in_progress" };
    const competingMicroJobs = liveMicroJobs.flat().filter((job) =>
      job._id !== currentJobId
    );
    if (competingMicroJobs.length > 0) {
      return { ready: false, reason: "micro_seed_in_progress" };
    }
    const articles = articleInventory.articles;
    if (
      articles.filter(isSealedReady).length >=
        approvedBufferPolicy(site.cadencePerWeek ?? 4).minimum
    ) return { ready: false, reason: "buffer_minimum_met" };
    const latestPublished = articles
      .filter((article) => article.status === "published")
      .slice()
      .sort((left, right) =>
        effectivePublishedAt(right) - effectivePublishedAt(left)
      )[0];
    const nextCadenceDueAt = latestPublished
      ? effectivePublishedAt(latestPublished) +
        cadenceIntervalMs(site.cadencePerWeek!)
      : 0;
    if (
      nextCadenceDueAt - timestamp >
        CADENCE_MICRO_SEED_MAX_CADENCE_HORIZON_MS
    ) return { ready: false, reason: "cadence_not_imminent" };
    const candidateWindowStart = autopilotCandidateWindowStart({
      now: timestamp,
      rolloutMode: site.autopilotRolloutMode ?? "observe",
      rolloutStartedAt: site.autopilotRolloutStartedAt ?? site.updatedAt,
    });
    if (hasRecoverableQualityWork(
      articles
        .filter((article) => article.status === "review")
        .slice(0, CADENCE_QUALITY_RECOVERY_READ_LIMIT),
      candidateWindowStart,
    )) return { ready: false, reason: "quality_recovery_available" };
    const terminalDemandJob = terminalDemandJobs[0];
    const terminalDemandReceiptFingerprint = terminalDemandJob
      ? await terminalNoMetricDemandReceiptFingerprint(
        ctx,
        site,
        terminalDemandJob,
        timestamp,
      )
      : null;
    const canonicalDomain = siteCanonicalDomain(site);
    if (!canonicalDomain) return { ready: false, reason: "site_unavailable" };
    const articleProjection = articles.map((article) => ({
      id: String(article._id),
      topicId: article.topicId ? String(article.topicId) : null,
      status: article.status,
      slug: article.slug,
      createdAt: article.createdAt,
      auditedAt: article.auditedAt ?? null,
      publishedAt: article.publishedAt ?? null,
      publicationGateStatus: article.publicationGateStatus ?? null,
      publicationGateIssues: article.publicationGateIssues ?? [],
      publicationAuditVersion: article.publicationAuditVersion ?? null,
      auditedContentHash: article.auditedContentHash ?? null,
      publishedContentHash: article.publishedContentHash ?? null,
      factCheckScore: article.factCheckScore ?? null,
      editorialQualityScore: article.editorialQualityScore ?? null,
      qualityRevisionCount: article.qualityRevisionCount ?? null,
      qualityRecoveryVersion: article.qualityRecoveryVersion ?? null,
      qualityRecoveryAttemptVersion:
        article.qualityRecoveryAttemptVersion ?? null,
      deterministicQualityRepairAttemptVersion:
        article.deterministicQualityRepairAttemptVersion ?? null,
    })).sort((left, right) => left.id.localeCompare(right.id));
    return {
      ready: true,
      contract: "cadence-operational-readiness-v1",
      siteId: String(site._id),
      canonicalDomain,
      domainRevision: siteCanonicalDomainRevision(site),
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      ...(currentJobId ? { currentJobId: String(currentJobId) } : {}),
      operationalFingerprint: sha256Hex(JSON.stringify({
        contract: "cadence-operational-inventory-v1",
        siteId: String(site._id),
        canonicalDomain,
        domainRevision: siteCanonicalDomainRevision(site),
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        currentJobId: currentJobId ? String(currentJobId) : null,
        siteGate,
        authority,
        articles: articleProjection,
        terminalNoMetricDemandReceiptFingerprint:
          terminalDemandReceiptFingerprint ?? null,
      })),
      remainingArticles: siteGate.remainingArticles,
      nextCadenceDueAt,
      ...(terminalDemandReceiptFingerprint
        ? {
            terminalNoMetricDemandReceiptFingerprint:
              terminalDemandReceiptFingerprint,
          }
        : {}),
    };
  },
});

/** Resolve and bind the exact exhausted plan/checkpoint receipt without
 * touching the independent recovery history. */
async function cadenceSourcePlanReadinessPrecheck(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  timestamp: number,
  sourcePlanId: Id<"jobs">,
): Promise<CadenceSourcePlanReadinessResult> {
  const site = await ctx.db.get(siteId);
  if (
    !siteExecutionActive(site) ||
    !site.userId ||
    !(await siteExecutionAuthorized(ctx, site))
  ) return { ready: false, reason: "site_unavailable" };
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return { ready: false, reason: "site_unavailable" };
  const sourceJob = await ctx.db.get(sourcePlanId);
  if (
    !sourceJob ||
    sourceJob.siteId !== siteId ||
    sourceJob.type !== "plan"
  ) return { ready: false, reason: "source_plan_not_exhausted" };
  const [sourceReservation, sourceCheckpoints] = await Promise.all([
    sourceJob.providerSpendReservationId
      ? ctx.db.get(sourceJob.providerSpendReservationId)
      : Promise.resolve(null),
    ctx.db.query("plan_candidate_checkpoints")
      .withIndex("by_plan_job", (q) => q.eq("planJobId", sourceJob._id))
      .order("desc")
      .take(2),
  ]);
  if (!validExhaustedSourcePlan({
    site,
    job: sourceJob,
    reservation: sourceReservation,
    checkpoints: sourceCheckpoints,
    timestamp,
  }) || !sourceReservation) {
    return { ready: false, reason: "source_plan_not_exhausted" };
  }
  return {
    ready: true,
    contract: "cadence-source-plan-readiness-v1",
    siteId: String(site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    sourcePlanId: sourceJob._id,
    sourcePlanReservationId: sourceReservation._id,
    sourcePlanFingerprint: sourcePlanFingerprintForPolicy(
      sourceJob,
      sourceReservation,
      sourceCheckpoints,
      CADENCE_MICRO_SEED_VERSION,
    ),
  };
}

export const inspectSourcePlanReadinessInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    sourcePlanId: v.id("jobs"),
  },
  handler: async (ctx, args) => cadenceSourcePlanReadinessPrecheck(
    ctx,
    args.siteId,
    Date.now(),
    args.sourcePlanId,
  ),
});

/**
 * Project one historical policy generation at a time. The source/policy index
 * makes each read constant-cardinality even for mature tenants, while the
 * action layer binds every prior generation before admission. This preserves
 * the no-replay invariant without ever loading a tenant's complete recovery
 * history in one Convex transaction.
 */
async function cadencePriorPolicyHistoryPrecheck(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  sourcePlanId: Id<"jobs">,
  policyVersion: number,
): Promise<CadencePriorPolicyHistoryResult> {
  const site = await ctx.db.get(siteId);
  if (
    !siteExecutionActive(site) ||
    !site.userId ||
    !(await siteExecutionAuthorized(ctx, site))
  ) return { ready: false, reason: "site_unavailable" };
  if (
    !Number.isInteger(policyVersion) ||
    policyVersion < 1 ||
    policyVersion >= CADENCE_MICRO_SEED_VERSION
  ) return { ready: false, reason: "micro_seed_policy_version_incompatible" };
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return { ready: false, reason: "site_unavailable" };
  const jobs = await ctx.db.query("cadence_micro_seed_jobs")
    .withIndex("by_site_source_policy_created", (q) =>
      q.eq("siteId", siteId)
        .eq("sourcePlanId", sourcePlanId)
        .eq("policyVersion", policyVersion)
    )
    .order("asc")
    .take(3);
  // Each policy permits one primary and one fallback. More rows mean an old
  // invariant was violated, so fail closed instead of silently omitting a paid
  // attempt from the no-replay ledger.
  if (jobs.length > 2) {
    return { ready: false, reason: "micro_seed_policy_history_exhausted" };
  }
  const attemptedPrimarySeeds = jobs
    .filter((job) =>
      cadenceMicroSeedAttemptExhaustsCurrentEnvelope(job) &&
      job.providerEndpoint === cadenceMicroSeedDiscoveryEndpoint("primary")
    )
    .flatMap((job) => job.providerSeeds ?? [job.seed]);
  const attemptedFallbackSeeds = jobs
    .filter((job) =>
      cadenceMicroSeedAttemptExhaustsCurrentEnvelope(job) &&
      job.providerEndpoint === cadenceMicroSeedDiscoveryEndpoint("fallback")
    )
    .flatMap((job) => job.providerSeeds ?? [job.seed]);
  const receipt = {
    contract: "cadence-prior-policy-history-v1",
    siteId: String(site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    sourcePlanId: String(sourcePlanId),
    policyVersion,
    jobs: jobs.map((job) => ({
      id: String(job._id),
      attemptKind: cadenceMicroSeedAttemptKind(job.attemptKind),
      providerEndpoint: job.providerEndpoint,
      providerSeeds: job.providerSeeds ?? [job.seed],
      providerCallAttempted: job.providerCallAttempted,
      providerAttemptedAt: job.providerAttemptedAt ?? null,
      providerRequestTag: job.providerRequestTag ?? null,
    })),
  };
  return {
    ready: true,
    contract: "cadence-prior-policy-history-v1",
    siteId: String(site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    sourcePlanId,
    policyVersion,
    attemptedPrimarySeeds,
    attemptedFallbackSeeds,
    historyFingerprint: sha256Hex(JSON.stringify(receipt)),
  };
}

export const inspectPriorPolicyHistoryInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    sourcePlanId: v.id("jobs"),
    policyVersion: v.number(),
  },
  handler: async (ctx, args) => cadencePriorPolicyHistoryPrecheck(
    ctx,
    args.siteId,
    args.sourcePlanId,
    args.policyVersion,
  ),
});

function currentPolicyLedgerFingerprint(
  jobs: readonly Doc<"cadence_micro_seed_jobs">[],
): string {
  return sha256Hex(JSON.stringify(jobs.map((job) => ({
    id: String(job._id),
    status: job.status,
    policyVersion: job.policyVersion,
    rolloutEpoch: job.rolloutEpoch,
    sourcePlanId: String(job.sourcePlanId),
    attemptKind: cadenceMicroSeedAttemptKind(job.attemptKind),
    parentMicroSeedJobId: job.parentMicroSeedJobId
      ? String(job.parentMicroSeedJobId)
      : null,
    parentMicroSeedReceiptFingerprint:
      job.parentMicroSeedReceiptFingerprint ?? null,
    providerCallAttempted: job.providerCallAttempted,
    providerCallCompleted: job.providerCallCompleted,
    updatedAt: job.updatedAt,
  }))));
}

async function cadenceCurrentPolicyLedgerPrecheck(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  sourcePlanId: Id<"jobs">,
  currentJobId?: Id<"cadence_micro_seed_jobs">,
): Promise<CadenceCurrentPolicyLedgerResult> {
  const site = await ctx.db.get(siteId);
  if (
    !siteExecutionActive(site) ||
    !site.userId ||
    !(await siteExecutionAuthorized(ctx, site))
  ) return { ready: false, reason: "site_unavailable" };
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return { ready: false, reason: "site_unavailable" };
  const jobs = await ctx.db.query("cadence_micro_seed_jobs")
    .withIndex("by_site_source_policy_created", (q) =>
      q.eq("siteId", siteId)
        .eq("sourcePlanId", sourcePlanId)
        .eq("policyVersion", CADENCE_MICRO_SEED_VERSION)
    )
    .order("asc")
    .take(3);
  if (jobs.length > 2) {
    return { ready: false, reason: "micro_seed_source_history_exhausted" };
  }
  if (currentJobId && !jobs.some((job) => job._id === currentJobId)) {
    return { ready: false, reason: "micro_seed_execution_receipt_unavailable" };
  }
  return {
    ready: true,
    contract: "cadence-current-policy-ledger-v1",
    siteId: String(site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    ...(currentJobId ? { currentJobId: String(currentJobId) } : {}),
    sourcePlanId,
    jobIds: jobs.map((job) => job._id),
    ledgerFingerprint: currentPolicyLedgerFingerprint(jobs),
  };
}

export const inspectCurrentPolicyLedgerInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    sourcePlanId: v.id("jobs"),
    currentJobId: v.optional(v.id("cadence_micro_seed_jobs")),
  },
  handler: async (ctx, args) => cadenceCurrentPolicyLedgerPrecheck(
    ctx,
    args.siteId,
    args.sourcePlanId,
    args.currentJobId,
  ),
});

/** Validate the terminal primary and its child edge in a separate bounded
 * transaction. The current-policy projection already binds the tenant and
 * entitlement; isolating these receipt reads prevents fallback admission from
 * exceeding the transaction budget as tenant history grows. */
async function cadenceFallbackParentReadinessPrecheck(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  timestamp: number,
  sourcePlanId: Id<"jobs">,
  topicPrecheck: CadenceTopicReadinessPrecheck,
  sourcePlanPrecheck: CadenceSourcePlanReadinessPrecheck,
  priorPolicyHistory: CadencePriorPolicyHistoryAggregate,
  currentPolicyLedger: CadenceCurrentPolicyLedgerPrecheck,
  parentMicroSeedJobId: Id<"cadence_micro_seed_jobs">,
  expectedChildJobId?: Id<"cadence_micro_seed_jobs">,
): Promise<CadenceFallbackParentResult> {
  const site = await ctx.db.get(siteId);
  const canonicalDomain = site && siteCanonicalDomain(site);
  if (
    !siteExecutionActive(site) ||
    !site.userId ||
    !canonicalDomain ||
    topicPrecheck.siteId !== String(site._id) ||
    topicPrecheck.canonicalDomain !== canonicalDomain ||
    topicPrecheck.domainRevision !== siteCanonicalDomainRevision(site) ||
    topicPrecheck.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    sourcePlanPrecheck.siteId !== String(site._id) ||
    sourcePlanPrecheck.sourcePlanId !== sourcePlanId ||
    priorPolicyHistory.siteId !== String(site._id) ||
    priorPolicyHistory.sourcePlanId !== sourcePlanId ||
    currentPolicyLedger.siteId !== String(site._id) ||
    currentPolicyLedger.sourcePlanId !== sourcePlanId ||
    currentPolicyLedger.jobIds.length !== (expectedChildJobId ? 2 : 1) ||
    currentPolicyLedger.currentJobId !==
      (expectedChildJobId ? String(expectedChildJobId) : undefined) ||
    !currentPolicyLedger.jobIds.includes(parentMicroSeedJobId) ||
    (expectedChildJobId &&
      !currentPolicyLedger.jobIds.includes(expectedChildJobId))
  ) return { ready: false, reason: "fallback_parent_inspection_stale" };
  const parent = await ctx.db.get(parentMicroSeedJobId);
  const [reservation, children] = parent
    ? await Promise.all([
        ctx.db.get(parent.providerSpendReservationId),
        ctx.db.query("cadence_micro_seed_jobs")
          .withIndex("by_site_parent", (q) =>
            q.eq("siteId", siteId).eq("parentMicroSeedJobId", parent._id)
          )
          .take(2),
      ])
    : [null, []];
  const primarySeeds = selectCadenceMicroSeedProbeBatch(
    cadenceMicroSeedRecoveryAnchors(site),
    String(sourcePlanId),
    CADENCE_MICRO_SEED_VERSION - 1,
    priorPolicyHistory.attemptedPrimarySeeds,
    topicPrecheck.coveredKeywords,
  );
  const primarySeed = primarySeeds[0];
  const childEdgeValid = expectedChildJobId
    ? children.length === 1 && children[0]?._id === expectedChildJobId
    : children.length === 0;
  if (
    !parent ||
    !primarySeed ||
    !childEdgeValid ||
    !validPrimaryFallbackReceipt({
      site,
      job: parent,
      reservation,
      sourcePlanId,
      sourcePlanReservationId: sourcePlanPrecheck.sourcePlanReservationId,
      sourcePlanFingerprint: sourcePlanPrecheck.sourcePlanFingerprint,
      primarySeed,
      primarySeeds,
      locationCode: dataForSeoLocationCode(site.targetCountry),
      languageCode: dataForSeoLanguageCode(site.language),
      timestamp,
    }) ||
    !reservation
  ) return { ready: false, reason: "micro_seed_fallback_parent_ineligible" };
  return {
    ready: true,
    contract: "cadence-fallback-parent-readiness-v1",
    siteId: String(site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    sourcePlanId,
    currentPolicyLedgerFingerprint: currentPolicyLedger.ledgerFingerprint,
    parentMicroSeedJobId,
    ...(expectedChildJobId ? { expectedChildJobId } : {}),
    parentMicroSeedReceiptFingerprint: primaryFallbackReceiptFingerprint(
      parent,
      reservation,
    ),
  };
}

export const inspectFallbackParentReadinessInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    sourcePlanId: v.id("jobs"),
    topicPrecheck: cadenceTopicReadinessPrecheckValidator,
    sourcePlanPrecheck: cadenceSourcePlanReadinessPrecheckValidator,
    priorPolicyHistory: cadencePriorPolicyHistoryAggregateValidator,
    currentPolicyLedger: cadenceCurrentPolicyLedgerPrecheckValidator,
    parentMicroSeedJobId: v.id("cadence_micro_seed_jobs"),
    expectedChildJobId: v.optional(v.id("cadence_micro_seed_jobs")),
  },
  handler: async (ctx, args) => cadenceFallbackParentReadinessPrecheck(
    ctx,
    args.siteId,
    Date.now(),
    args.sourcePlanId,
    args.topicPrecheck,
    args.sourcePlanPrecheck,
    args.priorPolicyHistory,
    args.currentPolicyLedger,
    args.parentMicroSeedJobId,
    args.expectedChildJobId,
  ),
});

function fallbackParentPrecheckMatches(args: {
  site: Doc<"sites">;
  sourcePlanId: Id<"jobs">;
  currentPolicyLedger: CadenceCurrentPolicyLedgerPrecheck;
  parentMicroSeedJobId: Id<"cadence_micro_seed_jobs">;
  expectedChildJobId?: Id<"cadence_micro_seed_jobs">;
  precheck?: CadenceFallbackParentPrecheck;
}): args is typeof args & { precheck: CadenceFallbackParentPrecheck } {
  const { site, precheck } = args;
  const canonicalDomain = siteCanonicalDomain(site);
  return Boolean(
    precheck &&
      precheck.contract === "cadence-fallback-parent-readiness-v1" &&
      precheck.siteId === String(site._id) &&
      precheck.canonicalDomain === canonicalDomain &&
      precheck.domainRevision === siteCanonicalDomainRevision(site) &&
      precheck.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0) &&
      precheck.sourcePlanId === args.sourcePlanId &&
      precheck.currentPolicyLedgerFingerprint ===
        args.currentPolicyLedger.ledgerFingerprint &&
      precheck.parentMicroSeedJobId === args.parentMicroSeedJobId &&
      precheck.expectedChildJobId === args.expectedChildJobId &&
      /^[a-f0-9]{64}$/.test(precheck.parentMicroSeedReceiptFingerprint)
  );
}

/**
 * Resolve the immutable no-replay chain independently from
 * both current inventory projections. Historical recovery receipts grow with
 * tenant age; keeping this bounded source ledger in its own transaction makes
 * the admission cost independent of topic and article cardinality.
 */
async function cadenceCurrentPolicyReadinessPrecheck(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  timestamp: number,
  sourcePlanId: Id<"jobs">,
  topicPrecheck: CadenceTopicReadinessPrecheck,
  sourcePlanPrecheck: CadenceSourcePlanReadinessPrecheck,
  priorPolicyHistory: CadencePriorPolicyHistoryAggregate,
  currentPolicyLedger: CadenceCurrentPolicyLedgerPrecheck,
  fallbackParentPrecheck?: CadenceFallbackParentPrecheck,
  currentJobId?: Id<"cadence_micro_seed_jobs">,
): Promise<CadenceCurrentPolicyReadinessResult> {
  const site = await ctx.db.get(siteId);
  if (
    !siteExecutionActive(site) ||
    !site.userId ||
    !(await siteExecutionAuthorized(ctx, site))
  ) return { ready: false, reason: "site_unavailable" };
  if (
    !site.autopilotEnabled ||
    site.expectedClickSchedulingEnabled !== true ||
    !verifiedKeywordPlanningActive(site) ||
    !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe") ||
    (site.cadencePerWeek ?? 0) <= 0
  ) return { ready: false, reason: "rollout_ineligible" };
  const canonicalDomain = siteCanonicalDomain(site);
  if (
    topicPrecheck.contract !== "cadence-topic-readiness-v1" ||
    topicPrecheck.siteId !== String(site._id) ||
    !canonicalDomain ||
    topicPrecheck.canonicalDomain !== canonicalDomain ||
    topicPrecheck.domainRevision !== siteCanonicalDomainRevision(site) ||
    topicPrecheck.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    !/^[a-f0-9]{64}$/.test(topicPrecheck.inventoryFingerprint)
  ) return { ready: false, reason: "topic_inspection_stale" };
  if (
    sourcePlanPrecheck.contract !== "cadence-source-plan-readiness-v1" ||
    sourcePlanPrecheck.siteId !== String(site._id) ||
    !canonicalDomain ||
    sourcePlanPrecheck.canonicalDomain !== canonicalDomain ||
    sourcePlanPrecheck.domainRevision !== siteCanonicalDomainRevision(site) ||
    sourcePlanPrecheck.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    sourcePlanPrecheck.sourcePlanId !== sourcePlanId ||
    !sourcePlanPrecheck.sourcePlanFingerprint
  ) return { ready: false, reason: "source_plan_inspection_stale" };
  if (
    priorPolicyHistory.contract !==
      "cadence-prior-policy-history-aggregate-v1" ||
    priorPolicyHistory.siteId !== String(site._id) ||
    priorPolicyHistory.canonicalDomain !== canonicalDomain ||
    priorPolicyHistory.domainRevision !== siteCanonicalDomainRevision(site) ||
    priorPolicyHistory.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    priorPolicyHistory.sourcePlanId !== sourcePlanId ||
    priorPolicyHistory.policyVersionCount !== CADENCE_MICRO_SEED_VERSION - 1 ||
    !/^[a-f0-9]{64}$/.test(priorPolicyHistory.historyFingerprint)
  ) return { ready: false, reason: "micro_seed_policy_history_stale" };
  if (
    currentPolicyLedger.contract !== "cadence-current-policy-ledger-v1" ||
    currentPolicyLedger.siteId !== String(site._id) ||
    currentPolicyLedger.canonicalDomain !== canonicalDomain ||
    currentPolicyLedger.domainRevision !== siteCanonicalDomainRevision(site) ||
    currentPolicyLedger.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    currentPolicyLedger.currentJobId !==
      (currentJobId ? String(currentJobId) : undefined) ||
    currentPolicyLedger.sourcePlanId !== sourcePlanId ||
    currentPolicyLedger.jobIds.length > 2 ||
    !/^[a-f0-9]{64}$/.test(currentPolicyLedger.ledgerFingerprint)
  ) return { ready: false, reason: "current_policy_ledger_stale" };
  const sourceReservationId = sourcePlanPrecheck.sourcePlanReservationId;
  const sourceFingerprint = sourcePlanPrecheck.sourcePlanFingerprint;
  const sourceJobRows = await Promise.all(
    currentPolicyLedger.jobIds.map((jobId) => ctx.db.get(jobId)),
  );
  if (sourceJobRows.some((job) =>
    !job ||
    job.siteId !== siteId ||
    job.sourcePlanId !== sourcePlanId ||
    job.policyVersion !== CADENCE_MICRO_SEED_VERSION
  )) return { ready: false, reason: "current_policy_ledger_stale" };
  const sourceJobs = sourceJobRows.filter(
    (job): job is Doc<"cadence_micro_seed_jobs"> => Boolean(job),
  );
  if (
    currentPolicyLedger.ledgerFingerprint !==
      currentPolicyLedgerFingerprint(sourceJobs)
  ) return { ready: false, reason: "current_policy_ledger_stale" };
  const previouslyAttemptedPrimarySeeds =
    priorPolicyHistory.attemptedPrimarySeeds;
  const previouslyAttemptedFallbackSeeds =
    priorPolicyHistory.attemptedFallbackSeeds;
  const currentJob = currentJobId
    ? sourceJobs.find((job) => job._id === currentJobId)
    : undefined;
  if (currentJobId && !currentJob) {
    return { ready: false, reason: "micro_seed_execution_receipt_unavailable" };
  }

  const anchors = cadenceMicroSeedRecoveryAnchors(site);
  const primarySeeds = selectCadenceMicroSeedProbeBatch(
    anchors,
    String(sourcePlanId),
    CADENCE_MICRO_SEED_VERSION - 1,
    previouslyAttemptedPrimarySeeds,
    topicPrecheck.coveredKeywords,
  );
  const primarySeed = primarySeeds[0];
  if (!primarySeed) {
    return { ready: false, reason: "tenant_product_seed_unavailable" };
  }
  const locationCode = dataForSeoLocationCode(site.targetCountry);
  const languageCode = dataForSeoLanguageCode(site.language);
  let attemptKind: CadenceMicroSeedAttemptKind = "primary";
  let seed = primarySeed;
  let providerSeeds = primarySeeds;
  let parentMicroSeedJobId: Id<"cadence_micro_seed_jobs"> | undefined;
  let parentMicroSeedReceiptFingerprint: string | undefined;

  if (currentJob) {
    const currentKind = cadenceMicroSeedAttemptKind(currentJob.attemptKind);
    if (!currentKind) {
      return { ready: false, reason: "micro_seed_attempt_kind_incompatible" };
    }
    attemptKind = currentKind;
    if (currentKind === "primary") {
      if (
        sourceJobs.length !== 1 ||
        currentJob.parentMicroSeedJobId ||
        currentJob.parentMicroSeedReceiptFingerprint
      ) {
        return { ready: false, reason: "micro_seed_primary_receipt_incompatible" };
      }
    } else {
      if (sourceJobs.length !== 2 || !currentJob.parentMicroSeedJobId) {
        return { ready: false, reason: "micro_seed_fallback_receipt_incompatible" };
      }
      const parent = sourceJobs.find((job) =>
        job._id === currentJob.parentMicroSeedJobId
      );
      if (
        !parent ||
        parent._id === currentJob._id ||
        !fallbackParentPrecheck ||
        !fallbackParentPrecheckMatches({
          site,
          sourcePlanId,
          currentPolicyLedger,
          parentMicroSeedJobId: parent._id,
          expectedChildJobId: currentJob._id,
          precheck: fallbackParentPrecheck,
        })
      ) {
        return { ready: false, reason: "micro_seed_fallback_parent_ineligible" };
      }
      const parentFingerprint =
        fallbackParentPrecheck.parentMicroSeedReceiptFingerprint;
      const fallbackSeeds = selectCadenceMicroSeedAnchorBatch(
        anchors,
        String(sourcePlanId),
        CADENCE_MICRO_SEED_VERSION - 1,
        previouslyAttemptedFallbackSeeds,
        topicPrecheck.coveredKeywords,
      );
      const fallbackSeed = fallbackSeeds[0];
      if (
        !fallbackSeed ||
        currentJob.parentMicroSeedReceiptFingerprint !== parentFingerprint
      ) {
        return { ready: false, reason: "micro_seed_fallback_parent_drifted" };
      }
      seed = fallbackSeed;
      providerSeeds = fallbackSeeds;
      parentMicroSeedJobId = parent._id;
      parentMicroSeedReceiptFingerprint = parentFingerprint;
    }
  } else if (sourceJobs.length === 1) {
    const parent = sourceJobs[0]!;
    if (
      !fallbackParentPrecheck ||
      !fallbackParentPrecheckMatches({
        site,
        sourcePlanId,
        currentPolicyLedger,
        parentMicroSeedJobId: parent._id,
        precheck: fallbackParentPrecheck,
      })
    ) {
      return { ready: false, reason: "source_plan_already_recovered" };
    }
    const fallbackSeeds = selectCadenceMicroSeedAnchorBatch(
      anchors,
      String(sourcePlanId),
      CADENCE_MICRO_SEED_VERSION - 1,
      previouslyAttemptedFallbackSeeds,
      topicPrecheck.coveredKeywords,
    );
    const fallbackSeed = fallbackSeeds[0];
    if (!fallbackSeed) {
      return { ready: false, reason: "fallback_product_seed_unavailable" };
    }
    attemptKind = "fallback";
    seed = fallbackSeed;
    providerSeeds = fallbackSeeds;
    parentMicroSeedJobId = parent._id;
    parentMicroSeedReceiptFingerprint =
      fallbackParentPrecheck.parentMicroSeedReceiptFingerprint;
  } else if (sourceJobs.length === 2) {
    return { ready: false, reason: "source_plan_fallback_already_attempted" };
  }

  if (currentJob && normalizeCadenceMicroSeedText(currentJob.seed) !== seed) {
    return { ready: false, reason: "micro_seed_anchor_drifted" };
  }
  if (
    currentJob &&
    JSON.stringify(currentJob.providerSeeds ?? [currentJob.seed]) !==
      JSON.stringify(providerSeeds)
  ) {
    return { ready: false, reason: "micro_seed_anchor_batch_drifted" };
  }
  const receipt = {
    contract: "cadence-current-policy-readiness-v1",
    siteId: String(site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    currentJobId: currentJobId ? String(currentJobId) : null,
    topicInventoryFingerprint: topicPrecheck.inventoryFingerprint,
    priorPolicyHistoryFingerprint: priorPolicyHistory.historyFingerprint,
    sourcePlanId: String(sourcePlanId),
    sourcePlanReservationId: String(sourceReservationId),
    sourcePlanFingerprint: sourceFingerprint,
    sourceJobIds: sourceJobs.map((job) => String(job._id)),
    attemptKind,
    parentMicroSeedJobId: parentMicroSeedJobId
      ? String(parentMicroSeedJobId)
      : null,
    parentMicroSeedReceiptFingerprint:
      parentMicroSeedReceiptFingerprint ?? null,
    seed,
    providerSeeds,
    locationCode,
    languageCode,
  };
  return {
    ready: true,
    contract: "cadence-current-policy-readiness-v1",
    siteId: String(site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    ...(currentJobId ? { currentJobId: String(currentJobId) } : {}),
    topicInventoryFingerprint: topicPrecheck.inventoryFingerprint,
    priorPolicyHistoryFingerprint: priorPolicyHistory.historyFingerprint,
    sourcePlanId,
    sourcePlanReservationId: sourceReservationId,
    sourcePlanFingerprint: sourceFingerprint,
    currentPolicyFingerprint: sha256Hex(JSON.stringify(receipt)),
    attemptKind,
    ...(parentMicroSeedJobId ? { parentMicroSeedJobId } : {}),
    ...(parentMicroSeedReceiptFingerprint
      ? { parentMicroSeedReceiptFingerprint }
      : {}),
    seed,
    providerSeeds,
    locationCode,
    languageCode,
  };
}

export const inspectCurrentPolicyReadinessInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    sourcePlanId: v.id("jobs"),
    topicPrecheck: cadenceTopicReadinessPrecheckValidator,
    sourcePlanPrecheck: cadenceSourcePlanReadinessPrecheckValidator,
    priorPolicyHistory: cadencePriorPolicyHistoryAggregateValidator,
    currentPolicyLedger: cadenceCurrentPolicyLedgerPrecheckValidator,
    fallbackParentPrecheck: v.optional(cadenceFallbackParentPrecheckValidator),
    currentJobId: v.optional(v.id("cadence_micro_seed_jobs")),
  },
  handler: async (ctx, args) => cadenceCurrentPolicyReadinessPrecheck(
    ctx,
    args.siteId,
    Date.now(),
    args.sourcePlanId,
    args.topicPrecheck,
    args.sourcePlanPrecheck,
    args.priorPolicyHistory,
    args.currentPolicyLedger,
    args.fallbackParentPrecheck,
    args.currentJobId,
  ),
});

/**
 * Bind the already-projected no-replay and current-policy ledgers to the
 * account entitlement. This final source transaction performs no recovery-job
 * scan, so its cost is independent of both tenant age and provider payload
 * size.
 */
async function cadenceSourceReadinessPrecheck(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  sourcePlanId: Id<"jobs">,
  topicPrecheck: CadenceTopicReadinessPrecheck,
  sourcePlanPrecheck: CadenceSourcePlanReadinessPrecheck,
  priorPolicyHistory: CadencePriorPolicyHistoryAggregate,
  currentPolicyPrecheck: CadenceCurrentPolicyReadinessPrecheck,
  currentJobId?: Id<"cadence_micro_seed_jobs">,
): Promise<CadenceSourceReadinessResult> {
  const site = await ctx.db.get(siteId);
  if (
    !siteExecutionActive(site) ||
    !site.userId ||
    !(await siteExecutionAuthorized(ctx, site))
  ) return { ready: false, reason: "site_unavailable" };
  if (
    !site.autopilotEnabled ||
    site.expectedClickSchedulingEnabled !== true ||
    !verifiedKeywordPlanningActive(site) ||
    !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe") ||
    (site.cadencePerWeek ?? 0) <= 0
  ) return { ready: false, reason: "rollout_ineligible" };
  const canonicalDomain = siteCanonicalDomain(site);
  if (
    !canonicalDomain ||
    topicPrecheck.contract !== "cadence-topic-readiness-v1" ||
    topicPrecheck.siteId !== String(site._id) ||
    topicPrecheck.canonicalDomain !== canonicalDomain ||
    topicPrecheck.domainRevision !== siteCanonicalDomainRevision(site) ||
    topicPrecheck.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    !/^[a-f0-9]{64}$/.test(topicPrecheck.inventoryFingerprint) ||
    sourcePlanPrecheck.contract !== "cadence-source-plan-readiness-v1" ||
    sourcePlanPrecheck.siteId !== String(site._id) ||
    sourcePlanPrecheck.canonicalDomain !== canonicalDomain ||
    sourcePlanPrecheck.domainRevision !== siteCanonicalDomainRevision(site) ||
    sourcePlanPrecheck.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    sourcePlanPrecheck.sourcePlanId !== sourcePlanId ||
    !sourcePlanPrecheck.sourcePlanFingerprint ||
    priorPolicyHistory.contract !==
      "cadence-prior-policy-history-aggregate-v1" ||
    priorPolicyHistory.siteId !== String(site._id) ||
    priorPolicyHistory.canonicalDomain !== canonicalDomain ||
    priorPolicyHistory.domainRevision !== siteCanonicalDomainRevision(site) ||
    priorPolicyHistory.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    priorPolicyHistory.sourcePlanId !== sourcePlanId ||
    priorPolicyHistory.policyVersionCount !== CADENCE_MICRO_SEED_VERSION - 1 ||
    !/^[a-f0-9]{64}$/.test(priorPolicyHistory.historyFingerprint) ||
    currentPolicyPrecheck.contract !==
      "cadence-current-policy-readiness-v1" ||
    currentPolicyPrecheck.siteId !== String(site._id) ||
    currentPolicyPrecheck.canonicalDomain !== canonicalDomain ||
    currentPolicyPrecheck.domainRevision !== siteCanonicalDomainRevision(site) ||
    currentPolicyPrecheck.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    currentPolicyPrecheck.currentJobId !==
      (currentJobId ? String(currentJobId) : undefined) ||
    currentPolicyPrecheck.topicInventoryFingerprint !==
      topicPrecheck.inventoryFingerprint ||
    currentPolicyPrecheck.priorPolicyHistoryFingerprint !==
      priorPolicyHistory.historyFingerprint ||
    currentPolicyPrecheck.sourcePlanId !== sourcePlanId ||
    currentPolicyPrecheck.sourcePlanReservationId !==
      sourcePlanPrecheck.sourcePlanReservationId ||
    currentPolicyPrecheck.sourcePlanFingerprint !==
      sourcePlanPrecheck.sourcePlanFingerprint ||
    !/^[a-f0-9]{64}$/.test(currentPolicyPrecheck.currentPolicyFingerprint)
  ) return { ready: false, reason: "current_policy_inspection_stale" };
  const entitlement = await ctx.db.query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site.userId!))
    .unique();
  const planFeatures = [
    ...(entitlement?.planFeatures ?? site.planFeatures ?? []),
  ].sort();
  const plan = resolvePlanFromFeatures(planFeatures);
  const providerCostCeilingMicroUsd = cadenceMicroSeedProviderCeilingMicroUsd(
    currentPolicyPrecheck.attemptKind,
  );
  const evidenceHeadroomMicroUsd =
    EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD;
  const receipt = {
    contract: "cadence-source-inventory-v1",
    siteId: String(site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    currentJobId: currentJobId ? String(currentJobId) : null,
    topicInventoryFingerprint: topicPrecheck.inventoryFingerprint,
    sourcePlanId: String(sourcePlanId),
    sourcePlanReservationId:
      String(sourcePlanPrecheck.sourcePlanReservationId),
    sourcePlanFingerprint: sourcePlanPrecheck.sourcePlanFingerprint,
    priorPolicyHistoryFingerprint: priorPolicyHistory.historyFingerprint,
    currentPolicyFingerprint: currentPolicyPrecheck.currentPolicyFingerprint,
    attemptKind: currentPolicyPrecheck.attemptKind,
    parentMicroSeedJobId: currentPolicyPrecheck.parentMicroSeedJobId
      ? String(currentPolicyPrecheck.parentMicroSeedJobId)
      : null,
    parentMicroSeedReceiptFingerprint:
      currentPolicyPrecheck.parentMicroSeedReceiptFingerprint ?? null,
    seed: currentPolicyPrecheck.seed,
    providerSeeds: currentPolicyPrecheck.providerSeeds,
    locationCode: currentPolicyPrecheck.locationCode,
    languageCode: currentPolicyPrecheck.languageCode,
    planTier: plan.tier,
    planFeatures,
    providerCostCeilingMicroUsd,
    evidenceHeadroomMicroUsd,
  };
  return {
    ready: true,
    contract: "cadence-source-readiness-v1",
    siteId: String(site._id),
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    ...(currentJobId ? { currentJobId: String(currentJobId) } : {}),
    topicInventoryFingerprint: topicPrecheck.inventoryFingerprint,
    sourceInventoryFingerprint: sha256Hex(JSON.stringify(receipt)),
    sourcePlanId,
    sourcePlanReservationId: sourcePlanPrecheck.sourcePlanReservationId,
    sourcePlanFingerprint: sourcePlanPrecheck.sourcePlanFingerprint,
    attemptKind: currentPolicyPrecheck.attemptKind,
    ...(currentPolicyPrecheck.parentMicroSeedJobId
      ? { parentMicroSeedJobId: currentPolicyPrecheck.parentMicroSeedJobId }
      : {}),
    ...(currentPolicyPrecheck.parentMicroSeedReceiptFingerprint
      ? {
          parentMicroSeedReceiptFingerprint:
            currentPolicyPrecheck.parentMicroSeedReceiptFingerprint,
        }
      : {}),
    seed: currentPolicyPrecheck.seed,
    providerSeeds: currentPolicyPrecheck.providerSeeds,
    locationCode: currentPolicyPrecheck.locationCode,
    languageCode: currentPolicyPrecheck.languageCode,
    planTier: plan.tier,
    planFeatures,
    providerCostCeilingMicroUsd,
    evidenceHeadroomMicroUsd,
  };
}

export const inspectSourceReadinessInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    sourcePlanId: v.id("jobs"),
    topicPrecheck: cadenceTopicReadinessPrecheckValidator,
    sourcePlanPrecheck: cadenceSourcePlanReadinessPrecheckValidator,
    priorPolicyHistory: cadencePriorPolicyHistoryAggregateValidator,
    currentPolicyPrecheck: cadenceCurrentPolicyReadinessPrecheckValidator,
    currentJobId: v.optional(v.id("cadence_micro_seed_jobs")),
  },
  handler: async (ctx, args) => cadenceSourceReadinessPrecheck(
    ctx,
    args.siteId,
    args.sourcePlanId,
    args.topicPrecheck,
    args.sourcePlanPrecheck,
    args.priorPolicyHistory,
    args.currentPolicyPrecheck,
    args.currentJobId,
  ),
});

async function inspectReadiness(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  timestamp: number,
  sourcePlanId: Id<"jobs">,
  topicPrecheck: CadenceTopicReadinessPrecheck,
  operationalPrecheck: CadenceOperationalReadinessPrecheck,
  sourcePrecheck: CadenceSourceReadinessPrecheck,
  currentJobId?: Id<"cadence_micro_seed_jobs">,
  recoveryPrecheck?: {
    completed: true;
    blockReason?: string;
  },
): Promise<ReadinessResult> {
  const site = await ctx.db.get(siteId);
  if (
    !siteExecutionActive(site) ||
    !site.userId ||
    !(await siteExecutionAuthorized(ctx, site))
  ) return { ready: false, reason: "site_unavailable" };
  if (
    !site.autopilotEnabled ||
    site.expectedClickSchedulingEnabled !== true ||
    !verifiedKeywordPlanningActive(site) ||
    !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe") ||
    (site.cadencePerWeek ?? 0) <= 0
  ) return { ready: false, reason: "rollout_ineligible" };

  const authority = tenantAuthorityFromStoredEvidence({
    domain: site.seoAuthorityDomain,
    currentDomain: site.domain,
    domainRank: site.seoAuthorityDomainRank,
    referringDomains: site.seoAuthorityReferringDomains,
    source: site.seoAuthoritySource,
    measuredAt: site.seoAuthorityMeasuredAt,
  });
  if (!measuredAuthorityIsFresh(authority, timestamp)) {
    return { ready: false, reason: "tenant_authority_unavailable" };
  }

  const canonicalDomain = siteCanonicalDomain(site);
  if (
    topicPrecheck.contract !== "cadence-topic-readiness-v1" ||
    topicPrecheck.siteId !== String(site._id) ||
    !canonicalDomain ||
    topicPrecheck.canonicalDomain !== canonicalDomain ||
    topicPrecheck.domainRevision !== siteCanonicalDomainRevision(site) ||
    topicPrecheck.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    !/^[a-f0-9]{64}$/.test(topicPrecheck.inventoryFingerprint)
  ) return { ready: false, reason: "topic_inspection_stale" };
  if (
    operationalPrecheck.contract !== "cadence-operational-readiness-v1" ||
    operationalPrecheck.siteId !== String(site._id) ||
    !canonicalDomain ||
    operationalPrecheck.canonicalDomain !== canonicalDomain ||
    operationalPrecheck.domainRevision !== siteCanonicalDomainRevision(site) ||
    operationalPrecheck.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    operationalPrecheck.currentJobId !==
      (currentJobId ? String(currentJobId) : undefined) ||
    !/^[a-f0-9]{64}$/.test(operationalPrecheck.operationalFingerprint)
  ) return { ready: false, reason: "operational_inspection_stale" };
  if (
    sourcePrecheck.contract !== "cadence-source-readiness-v1" ||
    sourcePrecheck.siteId !== String(site._id) ||
    !canonicalDomain ||
    sourcePrecheck.canonicalDomain !== canonicalDomain ||
    sourcePrecheck.domainRevision !== siteCanonicalDomainRevision(site) ||
    sourcePrecheck.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
    sourcePrecheck.currentJobId !==
      (currentJobId ? String(currentJobId) : undefined) ||
    sourcePrecheck.topicInventoryFingerprint !==
      topicPrecheck.inventoryFingerprint ||
    sourcePrecheck.sourcePlanId !== sourcePlanId ||
    !/^[a-f0-9]{64}$/.test(sourcePrecheck.sourceInventoryFingerprint)
  ) return { ready: false, reason: "source_inspection_stale" };

  const businessSignals = tenantTopicBusinessSignals(site);
  if (topicPrecheck.schedulerTopicAvailable) {
    return { ready: false, reason: "scheduler_topic_available" };
  }

  // Existing non-overlapping planned inventory gets the cheaper exact
  // demand/evidence bridge before discovery is allowed to spend. This also
  // prevents the guarded one-topic evidence apply from selecting a different
  // row after the micro topic is materialized.
  if (!recoveryPrecheck) {
    return { ready: false, reason: "recovery_precheck_required" };
  }
  const recoveryBlockReason = recoveryPrecheck.blockReason ?? null;
  if (recoveryBlockReason) return { ready: false, reason: recoveryBlockReason };

  const descriptor = {
    contract: "cadence-micro-seed-inspection-v2",
    siteId: String(site._id),
    userId: site.userId,
    reservationDay: utcDay(timestamp),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    planTier: sourcePrecheck.planTier,
    planFeatures: sourcePrecheck.planFeatures,
    remainingArticles: operationalPrecheck.remainingArticles,
    authority,
    businessSignals,
    topicInventoryFingerprint: topicPrecheck.inventoryFingerprint,
    operationalInventoryFingerprint:
      operationalPrecheck.operationalFingerprint,
    sourceInventoryFingerprint: sourcePrecheck.sourceInventoryFingerprint,
    sourcePlanId: String(sourcePrecheck.sourcePlanId),
    sourcePlanReservationId: String(sourcePrecheck.sourcePlanReservationId),
    sourcePlanFingerprint: sourcePrecheck.sourcePlanFingerprint,
    attemptKind: sourcePrecheck.attemptKind,
    parentMicroSeedJobId: sourcePrecheck.parentMicroSeedJobId
      ? String(sourcePrecheck.parentMicroSeedJobId)
      : null,
    parentMicroSeedReceiptFingerprint:
      sourcePrecheck.parentMicroSeedReceiptFingerprint ?? null,
    seed: sourcePrecheck.seed,
    providerSeeds: sourcePrecheck.providerSeeds,
    locationCode: sourcePrecheck.locationCode,
    languageCode: sourcePrecheck.languageCode,
    nextCadenceDueAt: operationalPrecheck.nextCadenceDueAt,
    bufferCount: 0,
    schedulerTopicCount: 0,
    activeContentCount: 0,
    activeEvidenceCount: 0,
    providerCostCeilingMicroUsd: sourcePrecheck.providerCostCeilingMicroUsd,
    evidenceHeadroomMicroUsd: sourcePrecheck.evidenceHeadroomMicroUsd,
    terminalNoMetricDemandReceiptFingerprint:
      operationalPrecheck.terminalNoMetricDemandReceiptFingerprint ?? null,
  };
  return {
    ready: true,
    inspectionKey: sha256Hex(JSON.stringify(descriptor)),
    reservationDay: descriptor.reservationDay,
    rolloutEpoch: descriptor.rolloutEpoch,
    sourcePlanId: sourcePrecheck.sourcePlanId,
    sourcePlanReservationId: sourcePrecheck.sourcePlanReservationId,
    sourcePlanFingerprint: sourcePrecheck.sourcePlanFingerprint,
    attemptKind: sourcePrecheck.attemptKind,
    ...(sourcePrecheck.parentMicroSeedJobId
      ? { parentMicroSeedJobId: sourcePrecheck.parentMicroSeedJobId }
      : {}),
    ...(sourcePrecheck.parentMicroSeedReceiptFingerprint
      ? {
          parentMicroSeedReceiptFingerprint:
            sourcePrecheck.parentMicroSeedReceiptFingerprint,
        }
      : {}),
    seed: sourcePrecheck.seed,
    providerSeeds: sourcePrecheck.providerSeeds,
    locationCode: sourcePrecheck.locationCode,
    languageCode: sourcePrecheck.languageCode,
    planTier: sourcePrecheck.planTier,
    nextCadenceDueAt: operationalPrecheck.nextCadenceDueAt,
    providerCostCeilingMicroUsd: sourcePrecheck.providerCostCeilingMicroUsd,
    evidenceHeadroomMicroUsd: sourcePrecheck.evidenceHeadroomMicroUsd,
  };
}

export const inspectInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    sourcePlanId: v.id("jobs"),
    topicPrecheck: cadenceTopicReadinessPrecheckValidator,
    operationalPrecheck: cadenceOperationalReadinessPrecheckValidator,
    sourcePrecheck: cadenceSourceReadinessPrecheckValidator,
    recoveryPrechecked: v.optional(v.boolean()),
    recoveryBlockReason: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      siteId,
      sourcePlanId,
      topicPrecheck,
      operationalPrecheck,
      sourcePrecheck,
      recoveryPrechecked,
      recoveryBlockReason,
    },
  ) => inspectReadiness(
    ctx,
    siteId,
    Date.now(),
    sourcePlanId,
    topicPrecheck,
    operationalPrecheck,
    sourcePrecheck,
    undefined,
    recoveryPrechecked === true
      ? {
          completed: true,
          ...(recoveryBlockReason ? { blockReason: recoveryBlockReason } : {}),
        }
      : undefined,
  ),
});

/** Resolve one exact exhausted source plan in small pages. Mature tenants can
 * retain substantial immutable plan history, so readiness must never walk all
 * candidate plans inside the one-second eligibility transaction. */
export const findSourcePlanPageInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    cursor: v.optional(v.string()),
    examined: v.number(),
  },
  handler: async (ctx, { siteId, cursor, examined }) => {
    const site = await ctx.db.get(siteId);
    if (
      !siteExecutionActive(site) ||
      !site.userId ||
      !(await siteExecutionAuthorized(ctx, site))
    ) {
      return {
        sourcePlanId: undefined,
        isDone: true,
        continueCursor: undefined,
        examined,
      };
    }
    if (!Number.isInteger(examined) || examined < 0 || examined > 50) {
      throw new Error("Cadence micro-seed source-plan cursor is incompatible");
    }
    if (examined === 50) {
      return {
        sourcePlanId: undefined,
        isDone: true,
        continueCursor: undefined,
        examined,
      };
    }
    const timestamp = Date.now();
    const page = await ctx.db.query("jobs")
      .withIndex("by_site_type_created", (q) =>
        q.eq("siteId", siteId).eq("type", "plan").gte(
          "createdAt",
          timestamp - CADENCE_MICRO_SEED_MAX_SOURCE_PLAN_AGE_MS,
        )
      )
      .order("desc")
      .paginate({ cursor: cursor ?? null, numItems: Math.min(4, 50 - examined) });
    const receipts = await Promise.all(page.page.map(async (job) => {
      const [reservation, checkpoints] = await Promise.all([
        job.providerSpendReservationId
          ? ctx.db.get(job.providerSpendReservationId)
          : Promise.resolve(null),
        ctx.db.query("plan_candidate_checkpoints")
          .withIndex("by_plan_job", (q) => q.eq("planJobId", job._id))
          .order("desc")
          .take(2),
      ]);
      return validExhaustedSourcePlan({
        site,
        job,
        reservation,
        checkpoints,
        timestamp,
      }) ? job._id : undefined;
    }));
    const nextExamined = examined + page.page.length;
    return {
      sourcePlanId: receipts.find((id) => id !== undefined),
      isDone: page.isDone || nextExamined >= 50,
      continueCursor: page.isDone ? undefined : page.continueCursor,
      examined: nextExamined,
    };
  },
});

/**
 * Find a bounded set of unpublished legacy micro-seed topics whose persisted
 * immutable job seed is no longer one of the tenant's exact current anchors,
 * or whose provider selection no longer satisfies that seed. The action layer
 * settles these before fresh readiness so stale sealed inventory cannot
 * reserve the corrected intent.
 */
export const listLegacyAnchorMismatchRepairsInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (
      !siteExecutionActive(site) ||
      !(await siteExecutionAuthorized(ctx, site))
    ) return { topicIds: [] as Id<"topic_clusters">[] };
    const [topics, articles, activeJobs] = await Promise.all([
      takeCurrentDomainTopics(ctx, site, CADENCE_MICRO_SEED_READ_LIMIT + 1),
      takeCurrentDomainArticles(ctx, site, CADENCE_MICRO_SEED_READ_LIMIT + 1),
      Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
        ctx.db.query("jobs").withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
      )),
    ]);
    if (
      topics.length > CADENCE_MICRO_SEED_READ_LIMIT ||
      articles.length > CADENCE_MICRO_SEED_READ_LIMIT ||
      activeJobs.some((rows) => rows.length > CADENCE_MICRO_SEED_READ_LIMIT)
    ) return { topicIds: [] as Id<"topic_clusters">[], reason: "read_limit" };

    const currentAnchors = cadenceMicroSeedAnchors(site);
    const linkedByTopic = new Map<string, typeof articles>();
    for (const article of articles) {
      if (!article.topicId) continue;
      const key = String(article.topicId);
      const linked = linkedByTopic.get(key) ?? [];
      linked.push(article);
      linkedByTopic.set(key, linked);
    }
    const liveJobs = activeJobs.flat();
    const topicIds: Id<"topic_clusters">[] = [];
    for (const topic of topics) {
      if (topicIds.length >= 5) break;
      if (
        !topic.cadenceMicroSeedJobId ||
        !Number.isInteger(topic.cadenceMicroSeedVersion) ||
        (topic.cadenceMicroSeedVersion ?? 0) >= CADENCE_MICRO_SEED_VERSION ||
        topic.cadenceMicroSeedAnchorEligible === false
      ) continue;
      const linked = linkedByTopic.get(String(topic._id)) ?? [];
      if (linked.length === 0 || linked.some((article) =>
        article.status === "published"
      )) continue;
      const linkedIds = new Set(linked.map((article) => String(article._id)));
      const hasActiveJob = liveJobs.some((job) => {
        if (job.type !== "article") return false;
        const payload = job.payload && typeof job.payload === "object"
          ? job.payload as Record<string, unknown>
          : {};
        return payload.topicId === topic._id ||
          (job.articleId && linkedIds.has(String(job.articleId))) ||
          (payload.articleId && linkedIds.has(String(payload.articleId)));
      });
      if (hasActiveJob) continue;
      const sourceJob = await ctx.db.get(topic.cadenceMicroSeedJobId);
      if (
        !sourceJob ||
        sourceJob.siteId !== siteId ||
        sourceJob.topicId !== topic._id ||
        sourceJob.policyVersion !== topic.cadenceMicroSeedVersion ||
        cadenceMicroSeedLegacyAnchorReceiptEligible({
          currentAnchors,
          jobSeed:
            sourceJob.selectedCandidate?.sourceSeed ??
            topic.cadenceMicroSeedAnchorSeed ??
            sourceJob.seed,
          selectedKeyword: sourceJob.selectedCandidate?.keyword,
          topicKeyword: topic.primaryKeyword,
        })
      ) continue;
      topicIds.push(topic._id);
    }
    return { topicIds };
  },
});

export const reserveAndQueue = internalMutation({
  args: {
    siteId: v.id("sites"),
    topicPrecheck: cadenceTopicReadinessPrecheckValidator,
    operationalPrecheck: cadenceOperationalReadinessPrecheckValidator,
    sourcePrecheck: cadenceSourceReadinessPrecheckValidator,
    inspectionKey: v.string(),
    reservationDay: v.string(),
    rolloutEpoch: v.number(),
    sourcePlanId: v.id("jobs"),
    sourcePlanFingerprint: v.string(),
    attemptKind: v.union(v.literal("primary"), v.literal("fallback")),
    parentMicroSeedJobId: v.optional(v.id("cadence_micro_seed_jobs")),
    parentMicroSeedReceiptFingerprint: v.optional(v.string()),
    providerCostCeilingMicroUsd: v.number(),
    providerBalancePreflightAt: v.number(),
    providerBalanceRequiredMicroUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const inspected = await inspectReadiness(
      ctx,
      args.siteId,
      Date.now(),
      args.sourcePlanId,
      args.topicPrecheck,
      args.operationalPrecheck,
      args.sourcePrecheck,
      undefined,
      { completed: true },
    );
    if (
      !inspected.ready ||
      inspected.inspectionKey !== args.inspectionKey ||
      inspected.reservationDay !== args.reservationDay ||
      inspected.rolloutEpoch !== args.rolloutEpoch ||
      inspected.sourcePlanId !== args.sourcePlanId ||
      inspected.sourcePlanFingerprint !== args.sourcePlanFingerprint ||
      inspected.attemptKind !== args.attemptKind ||
      inspected.parentMicroSeedJobId !== args.parentMicroSeedJobId ||
      inspected.parentMicroSeedReceiptFingerprint !==
        args.parentMicroSeedReceiptFingerprint ||
      inspected.providerCostCeilingMicroUsd !==
        args.providerCostCeilingMicroUsd
    ) {
      return {
        queued: false as const,
        reason: inspected.ready
          ? "micro_seed_inspection_stale" as const
          : inspected.reason,
      };
    }
    const site = await ctx.db.get(args.siteId);
    if (!siteExecutionActive(site) || !site.userId) {
      return { queued: false as const, reason: "site_unavailable" as const };
    }
    const timestamp = Date.now();
    const requiredProviderBalanceMicroUsd =
      inspected.providerCostCeilingMicroUsd +
      inspected.evidenceHeadroomMicroUsd *
        CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES;
    if (
      !Number.isSafeInteger(args.providerBalancePreflightAt) ||
      args.providerBalancePreflightAt > timestamp ||
      timestamp - args.providerBalancePreflightAt >
        CADENCE_MICRO_SEED_BALANCE_RECEIPT_MAX_AGE_MS ||
      args.providerBalanceRequiredMicroUsd !== requiredProviderBalanceMicroUsd
    ) {
      return {
        queued: false as const,
        reason: "provider_balance_receipt_incompatible" as const,
      };
    }
    const reservation = await reserveSharedProviderBudget(ctx, {
      siteId: args.siteId,
      userId: site.userId,
      purpose: cadenceMicroSeedProviderPurpose(inspected.attemptKind),
      trigger: cadenceMicroSeedProviderTrigger(inspected.attemptKind),
      reservedMicroUsd: inspected.providerCostCeilingMicroUsd,
      timestamp,
    });
    if (!reservation.ok) {
      return { queued: false as const, reason: reservation.reason };
    }
    const jobId = await ctx.db.insert("cadence_micro_seed_jobs", {
      siteId: args.siteId,
      userId: site.userId,
      status: "pending",
      policyVersion: CADENCE_MICRO_SEED_VERSION,
      rolloutEpoch: inspected.rolloutEpoch,
      reservationDay: inspected.reservationDay,
      inspectionKey: inspected.inspectionKey,
      sourcePlanId: inspected.sourcePlanId,
      sourcePlanFingerprint: inspected.sourcePlanFingerprint,
      sourcePlanReservationId: inspected.sourcePlanReservationId,
      attemptKind: inspected.attemptKind,
      ...(inspected.parentMicroSeedJobId
        ? { parentMicroSeedJobId: inspected.parentMicroSeedJobId }
        : {}),
      ...(inspected.parentMicroSeedReceiptFingerprint
        ? {
            parentMicroSeedReceiptFingerprint:
              inspected.parentMicroSeedReceiptFingerprint,
          }
        : {}),
      seed: inspected.seed,
      providerSeeds: inspected.providerSeeds,
      locationCode: inspected.locationCode,
      languageCode: inspected.languageCode,
      providerEndpoint: cadenceMicroSeedDiscoveryEndpoint(
        inspected.attemptKind,
      ),
      providerResultLimit: CADENCE_MICRO_SEED_RESULT_LIMIT,
      includeSerpInfo: false,
      includeClickstreamData: false,
      providerCostCeilingMicroUsd: inspected.providerCostCeilingMicroUsd,
      providerCostReservedMicroUsd: inspected.providerCostCeilingMicroUsd,
      providerSpendReservationId: reservation.reservationId,
      providerBalancePreflightAt: args.providerBalancePreflightAt,
      providerBalanceRequiredMicroUsd:
        args.providerBalanceRequiredMicroUsd,
      providerCallAttempted: false,
      providerCallCompleted: false,
      candidateReceipts: [],
      finalizeAttempts: 0,
      cadenceScheduleAttempts: 0,
      workerAttempts: 0,
      watchdogRecoveries: 0,
      watchdogScheduledAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.cadenceMicroSeed.processCadenceMicroSeed,
      { siteId: args.siteId, jobId, policyVersion: CADENCE_MICRO_SEED_VERSION },
    );
    await ctx.scheduler.runAfter(
      CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
      internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
      { siteId: args.siteId, jobId },
    );
    return {
      queued: true as const,
      jobId,
      seed: inspected.seed,
      providerSeeds: inspected.providerSeeds,
      sourcePlanId: inspected.sourcePlanId,
      attemptKind: inspected.attemptKind,
      parentMicroSeedJobId: inspected.parentMicroSeedJobId,
      parentMicroSeedReceiptFingerprint:
        inspected.parentMicroSeedReceiptFingerprint,
      providerCostCeilingMicroUsd: inspected.providerCostCeilingMicroUsd,
      evidenceHeadroomObservedMicroUsd: inspected.evidenceHeadroomMicroUsd,
    };
  },
});

export const getJobInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
  },
  handler: async (ctx, args) => {
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    if (
      !siteExecutionActive(site) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !job ||
      job.siteId !== args.siteId
    ) return null;
    return job;
  },
});

export const claimWorker = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    workerToken: v.string(),
    policyVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    const timestamp = Date.now();
    if (
      !siteExecutionActive(site) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !job ||
      job.siteId !== args.siteId ||
      job.policyVersion !== CADENCE_MICRO_SEED_VERSION ||
      args.policyVersion !== CADENCE_MICRO_SEED_VERSION ||
      job.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
      job.reservationDay !== utcDay(timestamp) ||
      !["pending", "running"].includes(job.status) ||
      (job.status === "running" && (job.leaseExpiresAt ?? 0) > timestamp)
    ) return null;
    if (job.providerCallAttempted && !job.providerCallCompleted) {
      await ctx.db.patch(job._id, {
        status: "provider_response_unverified",
        errorCode: "provider_attempt_ambiguous",
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return null;
    }
    await ctx.db.patch(job._id, {
      status: "running",
      workerToken: args.workerToken,
      leaseExpiresAt: timestamp + CADENCE_MICRO_SEED_LEASE_MS,
      workerAttempts: job.workerAttempts + 1,
      startedAt: job.startedAt ?? timestamp,
      updatedAt: timestamp,
    });
    return {
      ...job,
      status: "running",
      workerToken: args.workerToken,
      leaseExpiresAt: timestamp + CADENCE_MICRO_SEED_LEASE_MS,
      workerAttempts: job.workerAttempts + 1,
    };
  },
});

async function requireWorker(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    jobId: Id<"cadence_micro_seed_jobs">;
    workerToken: string;
  },
) {
  const [site, job] = await Promise.all([
    ctx.db.get(args.siteId),
    ctx.db.get(args.jobId),
  ]);
  if (
    !siteExecutionActive(site) ||
    !(await siteExecutionAuthorized(ctx, site)) ||
    !job ||
    job.siteId !== args.siteId ||
    job.status !== "running" ||
    job.workerToken !== args.workerToken ||
    (job.leaseExpiresAt ?? 0) <= Date.now() ||
    job.policyVersion !== CADENCE_MICRO_SEED_VERSION ||
    job.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0)
  ) throw new Error("Cadence micro-seed worker lease is invalid");
  return { site, job };
}

export const beginProviderAttempt = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    workerToken: v.string(),
    topicPrecheck: cadenceTopicReadinessPrecheckValidator,
    operationalPrecheck: cadenceOperationalReadinessPrecheckValidator,
    sourcePrecheck: cadenceSourceReadinessPrecheckValidator,
  },
  handler: async (ctx, args) => {
    const { site, job } = await requireWorker(ctx, args);
    const jobKind = cadenceMicroSeedAttemptKind(job.attemptKind);
    if (!jobKind) {
      return { allowed: false as const, reason: "attempt_kind_incompatible" as const };
    }
    if (job.providerCallAttempted) {
      return {
        allowed: false as const,
        reason: job.providerCallCompleted
          ? "receipt_recorded" as const
          : "provider_attempt_ambiguous" as const,
      };
    }
    const inspected = await inspectReadiness(
      ctx,
      args.siteId,
      Date.now(),
      job.sourcePlanId,
      args.topicPrecheck,
      args.operationalPrecheck,
      args.sourcePrecheck,
      job._id,
      { completed: true },
    );
    if (
      !inspected.ready ||
      inspected.sourcePlanId !== job.sourcePlanId ||
      inspected.sourcePlanFingerprint !== job.sourcePlanFingerprint ||
      inspected.attemptKind !== jobKind ||
      inspected.parentMicroSeedJobId !== job.parentMicroSeedJobId ||
      inspected.parentMicroSeedReceiptFingerprint !==
        job.parentMicroSeedReceiptFingerprint ||
      inspected.seed !== job.seed ||
      JSON.stringify(inspected.providerSeeds) !==
        JSON.stringify(job.providerSeeds ?? [job.seed]) ||
      inspected.locationCode !== job.locationCode ||
      inspected.languageCode !== job.languageCode
    ) {
      return { allowed: false as const, reason: "execution_fence_changed" as const };
    }
    const [reservation, sourceReservation, sourcePlan, sourceCheckpoints] =
      await Promise.all([
      ctx.db.get(job.providerSpendReservationId),
      ctx.db.get(job.sourcePlanReservationId),
      ctx.db.get(job.sourcePlanId),
      ctx.db.query("plan_candidate_checkpoints")
        .withIndex("by_plan_job", (q) => q.eq("planJobId", job.sourcePlanId))
        .order("desc")
        .take(2),
    ]);
    const timestamp = Date.now();
    const providerCostCeilingMicroUsd =
      cadenceMicroSeedProviderCeilingMicroUsd(jobKind);
    if (
      !reservation ||
      reservation.siteId !== site._id ||
      reservation.userId !== site.userId ||
      reservation.purpose !== cadenceMicroSeedProviderPurpose(jobKind) ||
      reservation.trigger !== cadenceMicroSeedProviderTrigger(jobKind) ||
      reservation.reservedMicroUsd !== providerCostCeilingMicroUsd ||
      reservation.reservationDay !== job.reservationDay ||
      reservation.createdAt !== job.createdAt ||
      reservation.releasedAt !== undefined ||
      job.providerCostCeilingMicroUsd !== providerCostCeilingMicroUsd ||
      job.providerCostReservedMicroUsd !== providerCostCeilingMicroUsd ||
      !sourcePlan ||
      !validExhaustedSourcePlan({
        site,
        job: sourcePlan,
        reservation: sourceReservation,
        checkpoints: sourceCheckpoints,
        timestamp,
      }) ||
      !sourceReservation ||
      sourcePlanFingerprintForPolicy(
        sourcePlan,
        sourceReservation,
        sourceCheckpoints,
        job.policyVersion,
      ) !==
        job.sourcePlanFingerprint
    ) throw new Error("Cadence micro-seed reservation is stale");
    const providerRequestTag = jobKind === "fallback"
      ? `cadence-micro-seed-fallback-v${CADENCE_MICRO_SEED_VERSION}-${String(job._id)}`
      : `cadence-micro-seed-v${CADENCE_MICRO_SEED_VERSION}-${String(job._id)}`;
    await ctx.db.patch(job._id, {
      providerCallAttempted: true,
      providerAttemptedAt: timestamp,
      providerRequestTag,
      leaseExpiresAt: timestamp + CADENCE_MICRO_SEED_LEASE_MS,
      updatedAt: timestamp,
    });
    return {
      allowed: true as const,
      attemptKind: jobKind,
      seed: job.seed,
      providerSeeds: job.providerSeeds ?? [job.seed],
      locationCode: job.locationCode,
      languageCode: job.languageCode,
      endpoint: job.providerEndpoint,
      resultLimit: job.providerResultLimit,
      includeSerpInfo: job.includeSerpInfo,
      includeClickstreamData: job.includeClickstreamData,
      providerRequestTag,
    };
  },
});

const candidateValidator = v.object({
  keyword: v.string(),
  searchVolume: v.number(),
  difficulty: v.number(),
  difficultyMeasured: v.literal(true),
  cpc: v.optional(v.number()),
  competition: v.optional(v.number()),
  intent: v.string(),
  trend: v.array(v.number()),
});

type SelectedCandidateReceipt = NonNullable<
  Doc<"cadence_micro_seed_jobs">["selectedCandidate"]
>;

function selectedCandidateReceipt(args: {
  site: Doc<"sites">;
  candidate: CadenceMicroSeedMetric;
  sourceSeed: string;
  measuredAt: number;
}): SelectedCandidateReceipt {
  const fit = evaluateTopicBusinessFit({
    keyword: args.candidate.keyword,
    label: args.candidate.keyword,
    ...tenantTopicBusinessSignals(args.site),
  });
  if (!fit.eligible) {
    throw new Error("Cadence micro-seed business fit drifted");
  }
  return {
    sourceSeed: normalizeCadenceMicroSeedText(args.sourceSeed),
    keyword: normalizeCadenceMicroSeedText(args.candidate.keyword),
    label: args.candidate.keyword,
    searchVolume: args.candidate.searchVolume,
    difficulty: args.candidate.difficulty,
    ...(args.candidate.cpc === undefined ? {} : { cpc: args.candidate.cpc }),
    intent: args.candidate.intent,
    trend: args.candidate.trend,
    businessFitScore: fit.score,
    businessFitVersion: fit.version,
    businessFitReasons: fit.reasons,
    measuredAt: args.measuredAt,
  };
}

async function insertCadenceMicroSeedTopic(args: {
  ctx: MutationCtx;
  site: Doc<"sites">;
  job: Doc<"cadence_micro_seed_jobs">;
  selected: SelectedCandidateReceipt;
  timestamp: number;
}): Promise<{
  topicId: Id<"topic_clusters">;
  topicFingerprint: string;
  plannedEvidenceFingerprint: string;
}> {
  const fingerprint = topicFingerprint({
    jobId: args.job._id,
    sourcePlanFingerprint: args.job.sourcePlanFingerprint,
    site: args.site,
    keyword: args.selected.keyword,
    measuredAt: args.selected.measuredAt,
  });
  const topicId = await args.ctx.db.insert("topic_clusters", {
    siteId: args.site._id,
    planningCanonicalDomain: siteCanonicalDomain(args.site)!,
    planningDomainRevision: siteCanonicalDomainRevision(args.site),
    label: args.selected.label,
    primaryKeyword: normalizeCadenceMicroSeedText(args.selected.keyword),
    secondaryKeywords: [],
    intent: args.selected.intent,
    priority: Math.max(1, Math.min(5,
      Math.ceil((100 - args.selected.difficulty) / 20),
    )),
    status: "planned",
    notes: "Bounded cadence micro-seed; article generation remains blocked until strict expected-click evidence passes.",
    searchVolume: args.selected.searchVolume,
    keywordDifficulty: args.selected.difficulty,
    keywordDifficultyMeasured: true,
    ...(args.selected.cpc === undefined ? {} : { cpc: args.selected.cpc }),
    serpIntent: args.selected.intent,
    volumeTrend: args.selected.trend,
    searchDemandSource: DATAFORSEO_DEMAND_SOURCE,
    searchDemandMeasuredAt: args.selected.measuredAt,
    searchDemandLocationCode: args.job.locationCode,
    searchDemandLanguageCode: args.job.languageCode,
    businessFitEligible: true,
    businessFitScore: args.selected.businessFitScore,
    businessFitVersion: args.selected.businessFitVersion,
    businessFitReasons: args.selected.businessFitReasons,
    businessFitCheckedAt: args.timestamp,
    cadenceMicroSeedVersion: args.job.policyVersion,
    cadenceMicroSeedJobId: args.job._id,
    cadenceMicroSeedFingerprint: fingerprint,
    cadenceMicroSeedAnchorSeed:
      args.selected.sourceSeed ?? args.job.seed,
    cadenceMicroSeedAnchorAuditVersion:
      CADENCE_MICRO_SEED_ANCHOR_AUDIT_VERSION,
    cadenceMicroSeedAnchorEligible: true,
    createdAt: args.timestamp,
    updatedAt: args.timestamp,
  });
  const insertedTopic = await args.ctx.db.get(topicId);
  if (!insertedTopic) {
    throw new Error("Cadence micro-seed topic receipt is unavailable");
  }
  return {
    topicId,
    topicFingerprint: fingerprint,
    plannedEvidenceFingerprint: plannedTopicRecoveryFingerprint({
      phase: "evidence",
      site: args.site,
      topic: insertedTopic,
    }),
  };
}

/**
 * One-release migration for a v14 semantic miss that already paid for and
 * admitted more than one candidate before the shortlist receipt existed.
 * Re-evaluate the immutable provider rows against current tenant coverage,
 * exclude the already-attempted exact keyword, and continue at most once.
 */
export const resumeLegacySemanticCandidateInternal = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (
      !siteExecutionActive(site) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      site.expectedClickSchedulingEnabled !== true ||
      !verifiedKeywordPlanningActive(site)
    ) return { advanced: false as const, reason: "site_unavailable" as const };
    const timestamp = Date.now();
    const missedJobs = await ctx.db.query("cadence_micro_seed_jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "missed")
      )
      .order("desc")
      .take(10);
    const candidates = missedJobs.filter((job) =>
      job.policyVersion === CADENCE_MICRO_SEED_VERSION - 1 &&
      job.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0) &&
      job.reservationDay === utcDay(timestamp) &&
      job.providerCallCompleted === true &&
      (job.candidateAudit?.accepted ?? 0) > 1 &&
      job.candidateShortlist === undefined &&
      job.candidateAttemptCount === undefined &&
      job.errorCode === "semantic_failure" &&
      job.selectedCandidate !== undefined &&
      job.topicId !== undefined &&
      job.topicFingerprint !== undefined &&
      job.plannedEvidenceFingerprint !== undefined &&
      job.evidenceJobId !== undefined &&
      Number.isFinite(job.completedAt) &&
      timestamp - (job.completedAt ?? 0) <= CADENCE_MICRO_SEED_MAX_JOB_AGE_MS
    );
    if (candidates.length !== 1) {
      return {
        advanced: false as const,
        reason: candidates.length > 1
          ? "legacy_semantic_receipt_ambiguous" as const
          : "legacy_semantic_candidate_unavailable" as const,
      };
    }
    const job = candidates[0]!;
    const [topic, evidence, articleInventory, activeGroups] = await Promise.all([
      ctx.db.get(job.topicId!),
      ctx.db.get(job.evidenceJobId!),
      cadenceMicroSeedArticleInventory(ctx, site),
      Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
        ctx.db.query("jobs").withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
      )),
    ]);
    const articles = articleInventory.articles;
    const topicInventory = await cadenceMicroSeedTopicInventory(
      ctx,
      site,
      articles,
    );
    const topics = topic
      ? Array.from(new Map(
        [...topicInventory.topics, topic].map((row) => [String(row._id), row]),
      ).values())
      : topicInventory.topics;
    const failure = evidence?.serpFailures.find((receipt) =>
      receipt.topicId === job.topicId
    );
    if (
      !topic ||
      topic.siteId !== siteId ||
      topic.cadenceMicroSeedJobId !== job._id ||
      topic.cadenceMicroSeedFingerprint !== job.topicFingerprint ||
      !["disqualified", "cannibalizing"].includes(topic.status ?? "") ||
      normalizeCadenceMicroSeedText(topic.primaryKeyword) !==
        normalizeCadenceMicroSeedText(job.selectedCandidate!.keyword) ||
      !evidence ||
      evidence.siteId !== siteId ||
      evidence.status !== "completed" ||
      !failure ||
      topicInventory.exhausted ||
      articleInventory.exhausted ||
      activeGroups.some((rows) => rows.length > CADENCE_MICRO_SEED_READ_LIMIT)
    ) return { advanced: false as const, reason: "legacy_receipt_changed" as const };
    const linkedArticle = articles.find((article) => article.topicId === topic._id);
    const active = activeGroups.flat().some((candidate) => {
      if (candidate.type !== "article") return false;
      const payload = candidate.payload && typeof candidate.payload === "object"
        ? candidate.payload as Record<string, unknown>
        : {};
      return payload.topicId === topic._id ||
        candidate.articleId === linkedArticle?._id ||
        payload.articleId === linkedArticle?._id;
    });
    if (linkedArticle || active) {
      return { advanced: false as const, reason: "legacy_topic_in_use" as const };
    }
    const authority = tenantAuthorityFromStoredEvidence({
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    });
    if (!measuredAuthorityIsFresh(authority, timestamp)) {
      return { advanced: false as const, reason: "tenant_authority_unavailable" as const };
    }
    const exactKeywords = new Set(topics.map((row) =>
      normalizeCadenceMicroSeedText(row.primaryKeyword)
    ));
    const reservedCoverage = coveredIntentTopics(
      topics.map((row) => ({
        _id: String(row._id),
        status: row.status ?? "planned",
        primaryKeyword: row.primaryKeyword,
        serpTopUrls: row.serpTopUrls,
      })),
      articles.map((article) => ({
        topicId: article.topicId ? String(article.topicId) : undefined,
        slug: article.slug,
        status: article.status,
        publicationGateStatus: article.publicationGateStatus,
        publicationAuditVersion: article.publicationAuditVersion,
        auditedContentHash: article.auditedContentHash,
      })),
    );
    const activeInventoryCoverage = topics
      .filter((row) => !["used", "cannibalizing", "disqualified"].includes(
        row.status ?? "planned",
      ))
      .map((row) => ({
        primaryKeyword: row.primaryKeyword,
        serpTopUrls: row.serpTopUrls,
      }));
    const failedContentCoverage = topics
      .filter((row) => terminalContentFeasibility(row.contentFeasibilityStatus))
      .map((row) => ({
        primaryKeyword: row.primaryKeyword,
        serpTopUrls: row.serpTopUrls,
      }));
    const metrics: CadenceMicroSeedMetric[] = job.candidateReceipts.flatMap(
      (candidate) => candidate.difficultyMeasured === true
        ? [{ ...candidate, difficultyMeasured: true as const }]
        : [],
    );
    const selection = selectCadenceMicroSeedCandidate({
      metrics,
      seed: job.seed,
      seeds: job.providerSeeds ?? [job.seed],
      maximumDifficulty: cadenceMicroSeedPreSerpDifficultyCeiling(
        authority.domainRank,
      ),
      existingExactKeywords: exactKeywords,
      coveredTopics: [
        ...reservedCoverage,
        ...activeInventoryCoverage,
        ...failedContentCoverage,
      ],
      siteName: site.siteName,
      competitors: site.competitors,
      businessFitEligible: (candidate) => evaluateTopicBusinessFit({
        keyword: candidate.keyword,
        label: candidate.keyword,
        ...tenantTopicBusinessSignals(site),
      }).eligible,
    });
    const remaining = selection.acceptedCandidates
      .filter((candidate) =>
        normalizeCadenceMicroSeedText(candidate.keyword) !==
          normalizeCadenceMicroSeedText(job.selectedCandidate!.keyword)
      )
      .slice(0, CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES - 1)
      .map((candidate) => selectedCandidateReceipt({
        site,
        candidate,
        sourceSeed: cadenceMicroSeedMatchingAnchor(
          job.providerSeeds ?? [job.seed],
          candidate.keyword,
        )!,
        measuredAt: job.selectedCandidate!.measuredAt,
      }));
    const nextCandidate = remaining[0];
    if (!nextCandidate) {
      return { advanced: false as const, reason: "no_remaining_strict_candidate" as const };
    }
    const next = await insertCadenceMicroSeedTopic({
      ctx,
      site,
      job,
      selected: nextCandidate,
      timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.cadenceMicroSeed.resumeCadenceEvidenceHandoff,
      { siteId, jobId: job._id },
    );
    await ctx.scheduler.runAfter(
      CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
      internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
      { siteId, jobId: job._id },
    );
    await ctx.db.patch(job._id, {
      status: "awaiting_evidence",
      candidateShortlist: [job.selectedCandidate!, ...remaining],
      candidateAttemptCount: 2,
      priorCandidateAttempts: [{
        keyword: job.selectedCandidate!.keyword,
        topicId: topic._id,
        topicFingerprint: job.topicFingerprint!,
        plannedEvidenceFingerprint: job.plannedEvidenceFingerprint!,
        evidenceJobId: evidence._id,
        outcome: "semantic_failure",
        reason: failure.code.slice(0, 120),
        completedAt: job.completedAt!,
      }],
      selectedCandidate: nextCandidate,
      topicId: next.topicId,
      topicFingerprint: next.topicFingerprint,
      plannedEvidenceFingerprint: next.plannedEvidenceFingerprint,
      evidenceJobId: undefined,
      evidenceQueueReason: undefined,
      evidenceFinalizerScheduledAt: undefined,
      watchdogScheduledAt: timestamp,
      cadenceScheduleRequestedAt: undefined,
      cadenceScheduleAttempts: 0,
      cadenceScheduleMode: undefined,
      cadenceScheduleScheduled: undefined,
      cadenceScheduleReceiptAt: undefined,
      finalizeAttempts: 0,
      errorCode: undefined,
      completedAt: undefined,
      updatedAt: timestamp,
    });
    return {
      advanced: true as const,
      jobId: job._id,
      topicId: next.topicId,
      keyword: nextCandidate.keyword,
      priorFailure: failure.code,
    };
  },
});

/**
 * Reuse another independently eligible candidate from the same immutable paid
 * discovery receipt after the previous candidate produced a sealed article.
 * A one-candidate recovery cannot fill the universal two-article launch
 * buffer when the source plan is otherwise exhausted. This continuation makes
 * no discovery call, re-runs current tenant-fit and coverage gates, and still
 * requires a fresh measured SERP/authority evidence job before generation.
 */
export const continueSuccessfulCandidateInternal = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    const timestamp = Date.now();
    if (
      !siteExecutionActive(site) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      site.expectedClickSchedulingEnabled !== true ||
      !verifiedKeywordPlanningActive(site) ||
      !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe") ||
      (site.cadencePerWeek ?? 0) <= 0
    ) return { advanced: false as const, reason: "site_unavailable" as const };

    const [articleInventory, activeGroups, activeEvidence, completedJobs] =
      await Promise.all([
        cadenceMicroSeedArticleInventory(ctx, site),
        Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
          ctx.db.query("jobs").withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", status)
          ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
        )),
        activeEvidenceRows(ctx, siteId),
        ctx.db.query("cadence_micro_seed_jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", "completed")
          )
          .order("desc")
          .take(10),
      ]);
    const articles = articleInventory.articles;
    const topicInventory = await cadenceMicroSeedTopicInventory(
      ctx,
      site,
      articles,
    );
    const topics = topicInventory.topics;
    if (
      articleInventory.exhausted ||
      topicInventory.exhausted ||
      activeGroups.some((rows) =>
        rows.length > CADENCE_MICRO_SEED_READ_LIMIT
      ) ||
      activeGroups.flat().some((job) =>
        job.type === "article" || job.type === "plan"
      ) ||
      activeEvidence > 0
    ) return { advanced: false as const, reason: "work_in_progress" as const };
    if (
      articles.filter(isSealedReady).length >=
        approvedBufferPolicy(site.cadencePerWeek ?? 4).minimum
    ) return { advanced: false as const, reason: "buffer_minimum_met" as const };

    const candidates = completedJobs.filter((job) =>
      job.policyVersion === CADENCE_MICRO_SEED_VERSION &&
      job.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0) &&
      job.reservationDay === utcDay(timestamp) &&
      timestamp - (job.completedAt ?? 0) <=
        CADENCE_MICRO_SEED_MAX_JOB_AGE_MS &&
      job.providerCallCompleted === true &&
      cadenceMicroSeedAttemptExhaustsCurrentEnvelope(job) &&
      job.selectedCandidate !== undefined &&
      job.topicId !== undefined &&
      job.topicFingerprint !== undefined &&
      job.plannedEvidenceFingerprint !== undefined &&
      job.evidenceJobId !== undefined &&
      job.cadenceScheduleReceiptAt !== undefined &&
      (job.candidateAttemptCount ?? 0) <
        CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES &&
      (job.candidateReceipts?.length ?? 0) > 1
    );
    if (candidates.length === 0) {
      return {
        advanced: false as const,
        reason: "successful_candidate_unavailable" as const,
      };
    }
    const job = candidates[0]!;
    const [topic, evidence, linkedArticle] = await Promise.all([
      ctx.db.get(job.topicId!),
      ctx.db.get(job.evidenceJobId!),
      ctx.db.query("articles").withIndex("by_topic", (q) =>
        q.eq("topicId", job.topicId!)
      ).first(),
    ]);
    const sealedSuccess = Boolean(linkedArticle && isSealedReady(linkedArticle));
    const liveSuccess = Boolean(
      linkedArticle && verifiedAuthorityTarget({
        site,
        article: linkedArticle,
        now: timestamp,
      }),
    );
    if (
      !topic ||
      topic.siteId !== siteId ||
      topic.cadenceMicroSeedJobId !== job._id ||
      topic.cadenceMicroSeedFingerprint !== job.topicFingerprint ||
      !evidence ||
      evidence.siteId !== siteId ||
      evidence.status !== "completed" ||
      evidence.persistedTopics !== 1 ||
      topic.expectedClickBackfillJobId !== evidence._id ||
      !linkedArticle ||
      linkedArticle.siteId !== siteId ||
      linkedArticle.topicId !== topic._id ||
      (!sealedSuccess && !liveSuccess)
    ) {
      return {
        advanced: false as const,
        reason: "successful_candidate_receipt_changed" as const,
      };
    }

    const authority = tenantAuthorityFromStoredEvidence({
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    });
    if (!measuredAuthorityIsFresh(authority, timestamp)) {
      return {
        advanced: false as const,
        reason: "tenant_authority_unavailable" as const,
      };
    }
    const nextCandidate = selectCurrentCadenceContinuationCandidate({
      site,
      job,
      topics,
      articles,
      domainRank: authority.domainRank,
    });
    if (!nextCandidate) {
      return {
        advanced: false as const,
        reason: "no_remaining_nonoverlapping_candidate" as const,
      };
    }
    const next = await insertCadenceMicroSeedTopic({
      ctx,
      site,
      job,
      selected: nextCandidate,
      timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.cadenceMicroSeed.resumeCadenceEvidenceHandoff,
      { siteId, jobId: job._id },
    );
    await ctx.scheduler.runAfter(
      CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
      internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
      { siteId, jobId: job._id },
    );
    const candidateAttemptCount = job.candidateAttemptCount ?? 1;
    await ctx.db.patch(job._id, {
      status: "awaiting_evidence",
      selectedCandidate: nextCandidate,
      candidateAttemptCount: candidateAttemptCount + 1,
      priorCandidateAttempts: [
        ...(job.priorCandidateAttempts ?? []),
        {
          keyword: job.selectedCandidate!.keyword,
          topicId: topic._id,
          topicFingerprint: job.topicFingerprint!,
          plannedEvidenceFingerprint: job.plannedEvidenceFingerprint!,
          evidenceJobId: evidence._id,
          outcome: "eligible_materialized" as const,
          reason: sealedSuccess ? "sealed_ready" : "verified_published",
          completedAt: job.completedAt!,
        },
      ],
      topicId: next.topicId,
      topicFingerprint: next.topicFingerprint,
      plannedEvidenceFingerprint: next.plannedEvidenceFingerprint,
      evidenceJobId: undefined,
      evidenceQueueReason: undefined,
      evidenceFinalizerScheduledAt: undefined,
      watchdogScheduledAt: timestamp,
      cadenceScheduleRequestedAt: undefined,
      cadenceScheduleAttempts: 0,
      cadenceScheduleMode: undefined,
      cadenceScheduleScheduled: undefined,
      cadenceScheduleReceiptAt: undefined,
      finalizeAttempts: 0,
      errorCode: undefined,
      completedAt: undefined,
      updatedAt: timestamp,
    });
    return {
      advanced: true as const,
      jobId: job._id,
      topicId: next.topicId,
      keyword: nextCandidate.keyword,
      candidateAttemptCount: candidateAttemptCount + 1,
    };
  },
});

/**
 * Re-run the complete pre-SERP admission contract immediately before every
 * continuation. The paid receipt's shortlist is only a historical ordering:
 * another candidate may since have produced a sealed article, or the tenant
 * profile/coverage may have changed. Exact attempted keywords remain excluded
 * even if a later cleanup removes their topic rows.
 */
function selectCurrentCadenceContinuationCandidate(args: {
  site: Doc<"sites">;
  job: Doc<"cadence_micro_seed_jobs">;
  topics: Doc<"topic_clusters">[];
  articles: PlannedRecoveryArticle[];
  domainRank: number;
  excludedActiveTopicIds?: ReadonlySet<string>;
}): SelectedCandidateReceipt | null {
  const exactKeywords = new Set(args.topics.map((row) =>
    normalizeCadenceMicroSeedText(row.primaryKeyword)
  ));
  const reservedCoverage = coveredIntentTopics(
    args.topics.map((row) => ({
      _id: String(row._id),
      status: row.status ?? "planned",
      primaryKeyword: row.primaryKeyword,
      serpTopUrls: row.serpTopUrls,
    })),
    args.articles.map((article) => ({
      topicId: article.topicId ? String(article.topicId) : undefined,
      slug: article.slug,
      status: article.status,
      publicationGateStatus: article.publicationGateStatus,
      publicationAuditVersion: article.publicationAuditVersion,
      auditedContentHash: article.auditedContentHash,
    })),
  );
  const activeInventoryCoverage = args.topics
    .filter((row) =>
      !args.excludedActiveTopicIds?.has(String(row._id)) &&
      !["used", "cannibalizing", "disqualified"].includes(
        row.status ?? "planned",
      )
    )
    .map((row) => ({
      primaryKeyword: row.primaryKeyword,
      serpTopUrls: row.serpTopUrls,
    }));
  const failedContentCoverage = args.topics
    .filter((row) => terminalContentFeasibility(row.contentFeasibilityStatus))
    .map((row) => ({
      primaryKeyword: row.primaryKeyword,
      serpTopUrls: row.serpTopUrls,
    }));
  const attemptedKeywords = new Set([
    normalizeCadenceMicroSeedText(args.job.selectedCandidate!.keyword),
    ...(args.job.priorCandidateAttempts ?? []).map((attempt) =>
      normalizeCadenceMicroSeedText(attempt.keyword)
    ),
  ]);
  const metrics: CadenceMicroSeedMetric[] = args.job.candidateReceipts.flatMap(
    (candidate) => candidate.difficultyMeasured === true
      ? [{ ...candidate, difficultyMeasured: true as const }]
      : [],
  );
  const selection = selectCadenceMicroSeedCandidate({
    metrics,
    seed: args.job.seed,
    seeds: args.job.providerSeeds ?? [args.job.seed],
    maximumDifficulty: cadenceMicroSeedPreSerpDifficultyCeiling(
      args.domainRank,
    ),
    existingExactKeywords: exactKeywords,
    coveredTopics: [
      ...reservedCoverage,
      ...activeInventoryCoverage,
      ...failedContentCoverage,
    ],
    siteName: args.site.siteName,
    competitors: args.site.competitors,
    businessFitEligible: (candidate) => evaluateTopicBusinessFit({
      keyword: candidate.keyword,
      label: candidate.keyword,
      ...tenantTopicBusinessSignals(args.site),
    }).eligible,
  });
  const nextMetric = selection.acceptedCandidates.find((candidate) =>
    !attemptedKeywords.has(
      normalizeCadenceMicroSeedText(candidate.keyword),
    )
  );
  const matchingAnchor = nextMetric
    ? cadenceMicroSeedMatchingAnchor(
      args.job.providerSeeds ?? [args.job.seed],
      nextMetric.keyword,
    )
    : undefined;
  return nextMetric && matchingAnchor
    ? selectedCandidateReceipt({
      site: args.site,
      candidate: nextMetric,
      sourceSeed: matchingAnchor,
      measuredAt: args.job.selectedCandidate!.measuredAt,
    })
    : null;
}

export const recordProviderReceiptAndMaterialize = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    workerToken: v.string(),
    endpoint: v.string(),
    seed: v.string(),
    seeds: v.array(v.string()),
    requestTag: v.string(),
    resultLimit: v.number(),
    locationCode: v.number(),
    languageCode: v.string(),
    providerTaskCostUsd: v.number(),
    providerRowsReceived: v.number(),
    providerRowsRejected: v.number(),
    measuredAt: v.number(),
    candidates: v.array(candidateValidator),
  },
  handler: async (ctx, args) => {
    const { site, job } = await requireWorker(ctx, args);
    if (
      !job.providerCallAttempted ||
      job.providerCallCompleted ||
      !job.providerAttemptedAt ||
      args.measuredAt < job.providerAttemptedAt ||
      args.measuredAt > Date.now() + 5 * 60 * 1000 ||
      args.requestTag !== job.providerRequestTag ||
      args.endpoint !== job.providerEndpoint ||
      args.resultLimit !== job.providerResultLimit ||
      args.locationCode !== job.locationCode ||
      args.languageCode.trim().toLowerCase() !==
        job.languageCode.trim().toLowerCase() ||
      JSON.stringify(args.seeds) !==
        JSON.stringify(job.providerSeeds ?? [job.seed]) ||
      job.includeSerpInfo !== false ||
      job.includeClickstreamData !== false ||
      !cadenceMicroSeedProviderReceiptValid({
        endpoint: args.endpoint,
        requestedSeed: job.seed,
        returnedSeed: args.seed,
        resultLimit: args.resultLimit,
        providerTaskCostUsd: args.providerTaskCostUsd,
        candidateCount: args.providerRowsReceived,
      }) ||
      !Number.isInteger(args.providerRowsRejected) ||
      args.providerRowsRejected < 0 ||
      args.providerRowsRejected > args.providerRowsReceived ||
      args.providerRowsReceived !==
        args.candidates.length + args.providerRowsRejected
    ) throw new Error("Cadence micro-seed receipt is incompatible");
    const seenReceiptKeywords = new Set<string>();
    for (const candidate of args.candidates) {
      const keyword = normalizeCadenceMicroSeedText(candidate.keyword);
      if (
        !keyword ||
        seenReceiptKeywords.has(keyword) ||
        !Number.isFinite(candidate.searchVolume) ||
        candidate.searchVolume < 10 ||
        candidate.difficultyMeasured !== true ||
        !Number.isFinite(candidate.difficulty) ||
        candidate.difficulty < 0 ||
        candidate.difficulty > 100 ||
        (candidate.cpc !== undefined &&
          (!Number.isFinite(candidate.cpc) || candidate.cpc < 0)) ||
        (candidate.competition !== undefined &&
          (!Number.isFinite(candidate.competition) ||
            candidate.competition < 0 || candidate.competition > 1)) ||
        !["informational", "commercial", "transactional", "navigational"]
          .includes(candidate.intent.trim().toLowerCase()) ||
        candidate.trend.length > 12 ||
        candidate.trend.some((value) => !Number.isFinite(value) || value < 0)
      ) throw new Error("Cadence micro-seed candidate receipt is incompatible");
      seenReceiptKeywords.add(keyword);
    }
    const jobKind = cadenceMicroSeedAttemptKind(job.attemptKind);
    const timestamp = Date.now();
    const [jobReservation, sourceReservation, sourcePlan, sourceCheckpoints] =
      await Promise.all([
        ctx.db.get(job.providerSpendReservationId),
        ctx.db.get(job.sourcePlanReservationId),
        ctx.db.get(job.sourcePlanId),
        ctx.db.query("plan_candidate_checkpoints")
          .withIndex("by_plan_job", (q) => q.eq("planJobId", job.sourcePlanId))
          .order("desc")
          .take(2),
      ]);
    const providerCostCeilingMicroUsd = jobKind
      ? cadenceMicroSeedProviderCeilingMicroUsd(jobKind)
      : null;
    const currentAnchors = new Set(cadenceMicroSeedRecoveryAnchors(site));
    const jobSeeds = job.providerSeeds ?? [job.seed];
    const siteGate = await plannedTopicSiteGate(ctx, site, timestamp);
    if (
      !site.userId ||
      !site.autopilotEnabled ||
      site.expectedClickSchedulingEnabled !== true ||
      !verifiedKeywordPlanningActive(site) ||
      !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe") ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      !siteGate.allowed ||
      !jobKind ||
      providerCostCeilingMicroUsd === null ||
      job.locationCode !== dataForSeoLocationCode(site.targetCountry) ||
      job.languageCode.trim().toLowerCase() !==
        dataForSeoLanguageCode(site.language).trim().toLowerCase() ||
      jobSeeds.some((seed) =>
        !currentAnchors.has(normalizeCadenceMicroSeedText(seed))
      ) ||
      !jobReservation ||
      jobReservation.siteId !== site._id ||
      jobReservation.userId !== site.userId ||
      jobReservation.purpose !== cadenceMicroSeedProviderPurpose(jobKind) ||
      jobReservation.trigger !== cadenceMicroSeedProviderTrigger(jobKind) ||
      jobReservation.reservedMicroUsd !== providerCostCeilingMicroUsd ||
      jobReservation.reservationDay !== job.reservationDay ||
      jobReservation.createdAt !== job.createdAt ||
      jobReservation.releasedAt !== undefined ||
      job.providerCostCeilingMicroUsd !== providerCostCeilingMicroUsd ||
      job.providerCostReservedMicroUsd !== providerCostCeilingMicroUsd ||
      !sourcePlan ||
      !validExhaustedSourcePlan({
        site,
        job: sourcePlan,
        reservation: sourceReservation,
        checkpoints: sourceCheckpoints,
        timestamp,
      }) ||
      !sourceReservation ||
      sourcePlanFingerprintForPolicy(
        sourcePlan,
        sourceReservation,
        sourceCheckpoints,
        job.policyVersion,
      ) !== job.sourcePlanFingerprint ||
      Math.ceil(args.providerTaskCostUsd * 1_000_000) >
        providerCostCeilingMicroUsd
    ) throw new Error("Cadence micro-seed materialization fence changed");
    await settleSharedProviderReservation(ctx, {
      reservationId: job.providerSpendReservationId,
      siteId: args.siteId,
      purpose: cadenceMicroSeedProviderPurpose(jobKind),
      actualMicroUsd: Math.ceil(args.providerTaskCostUsd * 1_000_000),
      reason: "verified_provider_receipt_actual_cost",
      timestamp,
    });

    const articleInventory = await cadenceMicroSeedArticleInventory(ctx, site);
    const articles = articleInventory.articles;
    const topicInventory = await cadenceMicroSeedTopicInventory(
      ctx,
      site,
      articles,
    );
    const topics = topicInventory.topics;
    if (
      topicInventory.exhausted ||
      articleInventory.exhausted
    ) throw new Error("Cadence micro-seed materialization read limit exhausted");
    const exactKeywords = new Set(topics.map((topic) =>
      normalizeCadenceMicroSeedText(topic.primaryKeyword)
    ));
    const reservedCoverage = coveredIntentTopics(
      topics.map((topic) => ({
        _id: String(topic._id),
        status: topic.status ?? "planned",
        primaryKeyword: topic.primaryKeyword,
        serpTopUrls: topic.serpTopUrls,
      })),
      articles.map((article) => ({
        topicId: article.topicId ? String(article.topicId) : undefined,
        slug: article.slug,
        status: article.status,
        publicationGateStatus: article.publicationGateStatus,
        publicationAuditVersion: article.publicationAuditVersion,
        auditedContentHash: article.auditedContentHash,
      })),
    );
    const activeInventoryCoverage = topics
      .filter((topic) =>
        !["used", "cannibalizing", "disqualified"].includes(
          topic.status ?? "planned",
        )
      )
      .map((topic) => ({
        primaryKeyword: topic.primaryKeyword,
        serpTopUrls: topic.serpTopUrls,
      }));
    // A terminal quality miss is feedback to choose a materially different
    // intent, not permission to buy a near-duplicate keyword and repeat the
    // same failed article shape. Preserve its exact SERP fingerprint when
    // available so the normal lexical/SERP overlap gate steers recovery
    // upstream without treating the failed draft as published coverage.
    const failedContentCoverage = topics
      .filter((topic) =>
        terminalContentFeasibility(topic.contentFeasibilityStatus)
      )
      .map((topic) => ({
        primaryKeyword: topic.primaryKeyword,
        serpTopUrls: topic.serpTopUrls,
      }));
    const businessSignals = tenantTopicBusinessSignals(site);
    const authority = tenantAuthorityFromStoredEvidence({
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    });
    if (!measuredAuthorityIsFresh(authority, timestamp)) {
      throw new Error("Cadence micro-seed tenant authority expired");
    }
    const selection = selectCadenceMicroSeedCandidate({
      metrics: args.candidates as CadenceMicroSeedMetric[],
      seed: job.seed,
      seeds: job.providerSeeds ?? [job.seed],
      // This only decides which bounded query is worth live SERP evidence.
      // Expected-click evidence remains the strict generation boundary.
      maximumDifficulty: cadenceMicroSeedPreSerpDifficultyCeiling(
        authority.domainRank,
      ),
      existingExactKeywords: exactKeywords,
      coveredTopics: [
        ...reservedCoverage,
        ...activeInventoryCoverage,
        ...failedContentCoverage,
      ],
      siteName: site.siteName,
      competitors: site.competitors,
      businessFitEligible: (candidate) => evaluateTopicBusinessFit({
        keyword: candidate.keyword,
        label: candidate.keyword,
        ...businessSignals,
      }).eligible,
    });
    const candidateAudit = {
      received: args.providerRowsReceived,
      accepted: selection.accepted,
      ...selection.rejected,
      invalidMetric:
        selection.rejected.invalidMetric + args.providerRowsRejected,
    };
    if (!selection.selected) {
      await ctx.db.patch(job._id, {
        status: "missed",
        providerCallCompleted: true,
        providerCompletedAt: timestamp,
        providerTaskCostUsd: args.providerTaskCostUsd,
        candidateReceipts: args.candidates,
        candidateAudit,
        errorCode: "no_strict_candidate",
        workerToken: undefined,
        leaseExpiresAt: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return { materialized: false as const, reason: "no_strict_candidate" as const };
    }
    // Bind every pre-SERP survivor before live evidence begins. We still test
    // one at a time, but a semantic miss can advance through this immutable
    // paid-receipt shortlist instead of silently losing the other survivors.
    const candidateShortlist = selection.acceptedCandidates
      .slice(0, CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES)
      .map((candidate) => selectedCandidateReceipt({
        site,
        candidate,
        sourceSeed: cadenceMicroSeedMatchingAnchor(
          job.providerSeeds ?? [job.seed],
          candidate.keyword,
        )!,
        measuredAt: args.measuredAt,
      }));
    const selected = candidateShortlist[0];
    if (!selected) {
      throw new Error("Cadence micro-seed shortlist is unavailable");
    }
    const materialized = await insertCadenceMicroSeedTopic({
      ctx,
      site,
      job,
      selected,
      timestamp,
    });
    await ctx.db.patch(job._id, {
      status: "awaiting_evidence",
      providerCallCompleted: true,
      providerCompletedAt: timestamp,
      providerTaskCostUsd: args.providerTaskCostUsd,
      candidateReceipts: args.candidates,
      candidateAudit,
      candidateShortlist,
      candidateAttemptCount: 1,
      priorCandidateAttempts: [],
      selectedCandidate: selected,
      topicId: materialized.topicId,
      topicFingerprint: materialized.topicFingerprint,
      plannedEvidenceFingerprint: materialized.plannedEvidenceFingerprint,
      workerToken: undefined,
      leaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
    return {
      materialized: true as const,
      topicId: materialized.topicId,
      topicFingerprint: materialized.topicFingerprint,
      keyword: selected.keyword,
      searchVolume: selected.searchVolume,
      keywordDifficulty: selected.difficulty,
      providerTaskCostUsd: args.providerTaskCostUsd,
    };
  },
});

/**
 * Additive reconciliation for exact receipts written before actual-cost
 * settlement existed. It is tenant-scoped and bounded; ambiguous attempts,
 * released reservations, mismatched ownership, and incomplete receipts remain
 * fully reserved. The normal recovery action invokes this before admission so
 * every tenant benefits without an operator-only bypass.
 */
export const reconcileVerifiedProviderCosts = internalMutation({
  args: { siteId: v.id("sites"), cursor: v.optional(v.string()) },
  handler: async (ctx, { siteId, cursor }) => {
    const site = await ctx.db.get(siteId);
    if (
      !siteExecutionActive(site) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.userId
    ) {
      return {
        examined: 0,
        settled: 0,
        reclaimedMicroUsd: 0,
        isDone: true,
        continueCursor: undefined,
      };
    }
    const monthStart = utcMonthStart(Date.now());
    const page = await ctx.db
      .query("cadence_micro_seed_jobs")
      .withIndex("by_site_created", (q) =>
        q.eq("siteId", siteId).gte("createdAt", monthStart)
      )
      .order("desc")
      .paginate({ cursor: cursor ?? null, numItems: 16 });
    const jobs = page.page;
    let settled = 0;
    let reclaimedMicroUsd = 0;
    for (const job of jobs) {
      const jobKind = cadenceMicroSeedAttemptKind(job.attemptKind);
      const actualMicroUsd = typeof job.providerTaskCostUsd === "number"
        ? Math.ceil(job.providerTaskCostUsd * 1_000_000)
        : null;
      if (
        !jobKind ||
        job.userId !== site.userId ||
        job.providerCallCompleted !== true ||
        job.providerAttemptedAt === undefined ||
        job.providerCompletedAt === undefined ||
        job.providerCompletedAt < job.providerAttemptedAt ||
        actualMicroUsd === null ||
        !Number.isSafeInteger(actualMicroUsd) ||
        actualMicroUsd < 0 ||
        actualMicroUsd > job.providerCostCeilingMicroUsd ||
        job.providerCostReservedMicroUsd !== job.providerCostCeilingMicroUsd
      ) continue;
      const reservation = await ctx.db.get(job.providerSpendReservationId);
      const expectedPurpose = cadenceMicroSeedProviderPurpose(jobKind);
      if (
        !reservation ||
        reservation.siteId !== siteId ||
        reservation.userId !== site.userId ||
        reservation.purpose !== expectedPurpose ||
        reservation.trigger !== `${expectedPurpose}_v${job.policyVersion}` ||
        reservation.reservedMicroUsd !== job.providerCostCeilingMicroUsd ||
        reservation.reservationDay !== job.reservationDay ||
        reservation.createdAt !== job.createdAt ||
        reservation.releasedAt !== undefined ||
        reservation.settledMicroUsd !== undefined
      ) continue;
      const result = await settleSharedProviderReservation(ctx, {
        reservationId: reservation._id,
        siteId,
        purpose: expectedPurpose,
        actualMicroUsd,
        reason: "verified_provider_receipt_actual_cost",
        timestamp: Date.now(),
      });
      if (result.settled) {
        settled += 1;
        reclaimedMicroUsd += reservation.reservedMicroUsd - actualMicroUsd;
      }
    }
    return {
      examined: jobs.length,
      settled,
      reclaimedMicroUsd,
      isDone: page.isDone,
      continueCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});

export const abortForProviderBalance = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    workerToken: v.string(),
    releaseReason: v.union(
      v.literal("provider_balance_insufficient"),
      v.literal("provider_balance_preflight_unavailable"),
    ),
  },
  handler: async (ctx, args) => {
    const { site, job } = await requireWorker(ctx, args);
    const jobKind = cadenceMicroSeedAttemptKind(job.attemptKind);
    if (!jobKind) {
      throw new Error("Micro-seed attempt kind is incompatible");
    }
    if (job.providerCallAttempted) {
      throw new Error("Micro-seed reservation cannot release after paid work");
    }
    const timestamp = Date.now();
    const reservation = await ctx.db.get(job.providerSpendReservationId);
    const providerCostCeilingMicroUsd =
      cadenceMicroSeedProviderCeilingMicroUsd(jobKind);
    if (
      !site.userId ||
      !reservation ||
      reservation.siteId !== site._id ||
      reservation.userId !== site.userId ||
      reservation.purpose !== cadenceMicroSeedProviderPurpose(jobKind) ||
      reservation.trigger !== cadenceMicroSeedProviderTrigger(jobKind) ||
      reservation.reservedMicroUsd !== providerCostCeilingMicroUsd ||
      reservation.reservationDay !== job.reservationDay ||
      reservation.createdAt !== job.createdAt ||
      reservation.releasedAt !== undefined ||
      job.providerCostCeilingMicroUsd !== providerCostCeilingMicroUsd ||
      job.providerCostReservedMicroUsd !== providerCostCeilingMicroUsd
    ) throw new Error("Micro-seed reservation cannot be released");
    const released = await releaseSharedProviderReservation(ctx, {
      reservationId: job.providerSpendReservationId,
      siteId: args.siteId,
      purpose: cadenceMicroSeedProviderPurpose(jobKind),
      reason: args.releaseReason,
      timestamp,
    });
    await ctx.db.patch(job._id, {
      status: "provider_balance_unavailable",
      errorCode: args.releaseReason,
      workerToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    return { aborted: true, released: released.released };
  },
});

export const markProviderResponseUnverified = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    workerToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const { job } = await requireWorker(ctx, args);
    const timestamp = Date.now();
    await ctx.db.patch(job._id, {
      status: job.providerCallAttempted && !job.providerCallCompleted
        ? "provider_response_unverified"
        : "missed",
      errorCode: args.errorCode.slice(0, 80),
      workerToken: undefined,
      leaseExpiresAt: undefined,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      terminal: true,
      providerAttemptAmbiguous:
        job.providerCallAttempted && !job.providerCallCompleted,
    };
  },
});

/**
 * Durable no-replay watchdog. Every branch either schedules work that has not
 * crossed a paid-attempt boundary, resumes from an exact receipt, or
 * terminalizes an expired ambiguous provider attempt. It never clears the
 * immutable one-shot source-plan marker and never reopens either reservation.
 */
export const reconcileWatchdog = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
  },
  handler: async (ctx, args) => {
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    if (
      !job ||
      !site ||
      job.siteId !== args.siteId ||
      job.userId !== site.userId ||
      job.policyVersion !== CADENCE_MICRO_SEED_VERSION
    ) return { reconciled: false as const, reason: "job_unavailable" as const };
    if (
      [
        "completed",
        "missed",
        "provider_balance_unavailable",
        "provider_response_unverified",
      ].includes(job.status)
    ) return { reconciled: false as const, reason: "terminal" as const };

    const timestamp = Date.now();
    const executionFenceActive = siteExecutionActive(site) &&
      (await siteExecutionAuthorized(ctx, site)) &&
      job.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0) &&
      job.reservationDay === utcDay(timestamp) &&
      site.expectedClickSchedulingEnabled === true &&
      verifiedKeywordPlanningActive(site);
    if (!executionFenceActive) {
      const topic = job.topicId ? await ctx.db.get(job.topicId) : null;
      const linkedArticle = job.topicId
        ? await ctx.db.query("articles").withIndex("by_topic", (q) =>
            q.eq("topicId", job.topicId!)
          ).first()
        : null;
      const activeGroups = await Promise.all(ACTIVE_CONTENT_STATUSES.map(
        (status) => ctx.db.query("jobs").withIndex("by_site_status", (q) =>
          q.eq("siteId", args.siteId).eq("status", status)
        ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1),
      ));
      const activeTopicJob = activeGroups.flat().some((candidate) => {
        if (candidate.type !== "article") return false;
        const payload = candidate.payload && typeof candidate.payload === "object"
          ? candidate.payload as Record<string, unknown>
          : {};
        return payload.topicId === job.topicId ||
          candidate.articleId === linkedArticle?._id;
      });
      if (
        topic &&
        topic.siteId === args.siteId &&
        topic.cadenceMicroSeedJobId === job._id &&
        topic.cadenceMicroSeedFingerprint === job.topicFingerprint &&
        topic.status === "planned" &&
        !linkedArticle &&
        !activeTopicJob &&
        !activeGroups.some((rows) => rows.length > CADENCE_MICRO_SEED_READ_LIMIT)
      ) {
        await ctx.db.patch(topic._id, {
          status: "disqualified",
          disqualifiedReason: "cadence_micro_seed_execution_fence_changed",
          updatedAt: timestamp,
        });
      }
      await ctx.db.patch(job._id, {
        status: "missed",
        errorCode: "execution_fence_changed",
        workerToken: undefined,
        leaseExpiresAt: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        reconciled: true as const,
        action: "terminal_execution_fence_changed" as const,
      };
    }
    const nextWatchdogRecovery = (job.watchdogRecoveries ?? 0) + 1;
    const patchWatchdog = {
      watchdogRecoveries: nextWatchdogRecovery,
      watchdogScheduledAt: timestamp,
      updatedAt: timestamp,
    };
    if (job.status === "running" && (job.leaseExpiresAt ?? 0) > timestamp) {
      await ctx.scheduler.runAfter(
        Math.max(1_000, (job.leaseExpiresAt ?? timestamp) - timestamp + 1_000),
        internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
        args,
      );
      await ctx.db.patch(job._id, {
        watchdogScheduledAt: timestamp,
        updatedAt: timestamp,
      });
      return { reconciled: true as const, action: "wait_for_lease" as const };
    }
    if (
      nextWatchdogRecovery > CADENCE_MICRO_SEED_MAX_WATCHDOG_RECOVERIES ||
      timestamp - job.createdAt > CADENCE_MICRO_SEED_MAX_JOB_AGE_MS
    ) {
      const ambiguousProviderAttempt = job.providerCallAttempted &&
        !job.providerCallCompleted;
      await ctx.db.patch(job._id, {
        ...patchWatchdog,
        status: ambiguousProviderAttempt
          ? "provider_response_unverified"
          : "missed",
        errorCode: ambiguousProviderAttempt
          ? "provider_attempt_ambiguous"
          : "watchdog_recovery_exhausted",
        workerToken: undefined,
        leaseExpiresAt: undefined,
        completedAt: timestamp,
      });
      return {
        reconciled: true as const,
        action: "terminal_watchdog_exhausted" as const,
      };
    }
    if (
      job.status === "running" &&
      job.providerCallAttempted &&
      !job.providerCallCompleted
    ) {
      await ctx.db.patch(job._id, {
        ...patchWatchdog,
        status: "provider_response_unverified",
        errorCode: "provider_attempt_ambiguous",
        workerToken: undefined,
        leaseExpiresAt: undefined,
        completedAt: timestamp,
      });
      return {
        reconciled: true as const,
        action: "terminal_provider_ambiguity" as const,
      };
    }
    if (
      (job.status === "pending" || job.status === "running") &&
      !job.providerCallAttempted &&
      !job.providerCallCompleted
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.cadenceMicroSeed.processCadenceMicroSeed,
        {
          siteId: args.siteId,
          jobId: args.jobId,
          policyVersion: CADENCE_MICRO_SEED_VERSION,
        },
      );
      await ctx.scheduler.runAfter(
        CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
        internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
        args,
      );
      await ctx.db.patch(job._id, patchWatchdog);
      return { reconciled: true as const, action: "resume_pre_call" as const };
    }
    if (job.status === "awaiting_evidence" && job.topicId) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.cadenceMicroSeed.resumeCadenceEvidenceHandoff,
        { siteId: args.siteId, jobId: args.jobId },
      );
      await ctx.scheduler.runAfter(
        CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
        internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
        args,
      );
      await ctx.db.patch(job._id, patchWatchdog);
      return { reconciled: true as const, action: "resume_evidence" as const };
    }
    if (job.status === "evidence_running" && job.evidenceJobId) {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.cadenceMicroSeed.finalizeCadenceMicroSeed,
        args,
      );
      await ctx.scheduler.runAfter(
        CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
        internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
        args,
      );
      await ctx.db.patch(job._id, patchWatchdog);
      return { reconciled: true as const, action: "resume_finalizer" as const };
    }
    if (job.status === "cadence_scheduling") {
      await ctx.scheduler.runAfter(
        0,
        internal.actions.cadenceMicroSeed.scheduleCadenceForMicroSeed,
        args,
      );
      await ctx.scheduler.runAfter(
        CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
        internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
        args,
      );
      await ctx.db.patch(job._id, patchWatchdog);
      return { reconciled: true as const, action: "resume_cadence" as const };
    }
    await ctx.db.patch(job._id, {
      ...patchWatchdog,
      status: "provider_response_unverified",
      errorCode: "durable_state_incompatible",
      completedAt: timestamp,
    });
    return {
      reconciled: true as const,
      action: "terminal_incompatible_state" as const,
    };
  },
});

export const recordEvidenceQueued = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    topicId: v.id("topic_clusters"),
    evidenceJobId: v.id("expected_click_evidence_jobs"),
  },
  handler: async (ctx, args) => {
    const [site, job, topic, evidence] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
      ctx.db.get(args.topicId),
      ctx.db.get(args.evidenceJobId),
    ]);
    const evidenceReservation = evidence
      ? await ctx.db.get(evidence.providerSpendReservationId)
      : null;
    const selected = evidence?.selectedTopics[0];
    const alreadyBound = Boolean(
      job &&
      job.evidenceJobId === args.evidenceJobId &&
      ["evidence_running", "cadence_scheduling", "completed", "missed"]
        .includes(job.status),
    );
    const releasedForPreCallBalance = Boolean(
      evidence &&
      evidenceReservation &&
      evidence.status === "provider_balance_unavailable" &&
      evidence.providerCallsAttempted === 0 &&
      evidence.providerCallsCompleted === 0 &&
      evidenceReservation.releasedAt !== undefined &&
      [
        "provider_balance_insufficient",
        "provider_balance_preflight_unavailable",
      ].includes(evidenceReservation.releaseReason ?? "") &&
      evidence.errorCode === evidenceReservation.releaseReason,
    );
    if (
      !siteExecutionActive(site) ||
      site.expectedClickSchedulingEnabled !== true ||
      !verifiedKeywordPlanningActive(site) ||
      !job ||
      job.siteId !== args.siteId ||
      job.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
      (job.status !== "awaiting_evidence" && !alreadyBound) ||
      job.topicId !== args.topicId ||
      !job.plannedEvidenceFingerprint ||
      !topic ||
      topic.siteId !== args.siteId ||
      topic.cadenceMicroSeedJobId !== job._id ||
      topic.cadenceMicroSeedFingerprint !== job.topicFingerprint ||
      !evidence ||
      evidence.siteId !== args.siteId ||
      evidence.userId !== site.userId ||
      evidence.policyVersion !== EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION ||
      evidence.origin !== "operator_canary" ||
      evidence.rolloutEpoch !== job.rolloutEpoch ||
      evidence.reservationDay !== job.reservationDay ||
      ![
        "pending",
        "running",
        "partial",
        "completed",
        "provider_balance_unavailable",
      ].includes(evidence.status) ||
      evidence.selectionScope !== "planned_unmaterialized" ||
      evidence.selectedTopics.length !== 1 ||
      selected?.topicId !== args.topicId ||
      selected?.targetKind !== "planned_topic" ||
      selected?.articleId !== undefined ||
      selected?.plannedTopicFingerprint !== job.plannedEvidenceFingerprint ||
      evidence.providerCostCeilingMicroUsd !==
        EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD ||
      evidence.providerCostReservedMicroUsd !==
        EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD ||
      !evidenceReservation ||
      evidenceReservation.siteId !== args.siteId ||
      evidenceReservation.userId !== site.userId ||
      evidenceReservation.purpose !== "expected_click_evidence_backfill" ||
      evidenceReservation.trigger !==
        `expected_click_evidence_operator_canary_v${EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION}` ||
      evidenceReservation.reservedMicroUsd !==
        EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD ||
      evidenceReservation.reservationDay !== job.reservationDay ||
      (evidenceReservation.releasedAt !== undefined &&
        !releasedForPreCallBalance) ||
      (evidence.status === "completed" &&
        evidence.persistedTopics === 1 &&
        topic.expectedClickBackfillJobId !== evidence._id)
    ) throw new Error("Micro-seed evidence queue crossed its exact scope");
    if (alreadyBound) {
      return { recorded: false as const, alreadyBound: true as const };
    }
    const timestamp = Date.now();
    await ctx.scheduler.runAfter(
      CADENCE_MICRO_SEED_FINALIZE_DELAY_MS,
      internal.actions.cadenceMicroSeed.finalizeCadenceMicroSeed,
      { siteId: args.siteId, jobId: args.jobId },
    );
    await ctx.scheduler.runAfter(
      CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
      internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
      { siteId: args.siteId, jobId: args.jobId },
    );
    await ctx.db.patch(job._id, {
      status: "evidence_running",
      evidenceJobId: args.evidenceJobId,
      evidenceQueueReason: "queued",
      evidenceFinalizerScheduledAt: timestamp,
      watchdogScheduledAt: timestamp,
      updatedAt: timestamp,
    });
    return { recorded: true as const, alreadyBound: false as const };
  },
});

export const findExactEvidenceJobInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    topicId: v.id("topic_clusters"),
  },
  handler: async (ctx, args) => {
    const [job, topic] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.topicId),
    ]);
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.topicId !== args.topicId ||
      !topic ||
      topic.siteId !== args.siteId ||
      topic.cadenceMicroSeedJobId !== job._id ||
      topic.cadenceMicroSeedFingerprint !== job.topicFingerprint ||
      !job.plannedEvidenceFingerprint
    ) return null;
    const rows = await ctx.db.query("expected_click_evidence_jobs")
      .withIndex("by_site_day", (q) =>
        q.eq("siteId", args.siteId).eq("reservationDay", job.reservationDay)
      )
      .collect();
    const matches = rows.filter((evidence) =>
      evidence.policyVersion === EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION &&
      evidence.origin === "operator_canary" &&
      evidence.rolloutEpoch === job.rolloutEpoch &&
      evidence.selectionScope === "planned_unmaterialized" &&
      evidence.selectedTopics.length === 1 &&
      evidence.selectedTopics[0]?.topicId === args.topicId &&
      evidence.selectedTopics[0]?.targetKind === "planned_topic" &&
      evidence.selectedTopics[0]?.articleId === undefined &&
      evidence.selectedTopics[0]?.plannedTopicFingerprint ===
        job.plannedEvidenceFingerprint
    );
    if (matches.length > 1) {
      return { conflict: true as const, count: matches.length };
    }
    if (matches.length !== 1) return null;
    return {
      conflict: false as const,
      evidenceJobId: matches[0]._id,
      status: matches[0].status,
      providerCallsAttempted: matches[0].providerCallsAttempted,
    };
  },
});

export const recordEvidenceBlocked = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    topicId: v.id("topic_clusters"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const [job, topic] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.topicId),
    ]);
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.status !== "awaiting_evidence" ||
      job.evidenceJobId !== undefined ||
      job.topicId !== args.topicId ||
      !topic ||
      topic.siteId !== args.siteId ||
      topic.cadenceMicroSeedJobId !== job._id ||
      topic.cadenceMicroSeedFingerprint !== job.topicFingerprint
    ) throw new Error("Micro-seed evidence block crossed its exact scope");
    const evidenceRows = await ctx.db.query("expected_click_evidence_jobs")
      .withIndex("by_site_day", (q) =>
        q.eq("siteId", args.siteId).eq("reservationDay", job.reservationDay)
      )
      .collect();
    const exactEvidenceExists = evidenceRows.some((evidence) =>
      evidence.policyVersion === EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION &&
      evidence.origin === "operator_canary" &&
      evidence.rolloutEpoch === job.rolloutEpoch &&
      evidence.selectionScope === "planned_unmaterialized" &&
      evidence.selectedTopics.length === 1 &&
      evidence.selectedTopics[0]?.topicId === args.topicId &&
      evidence.selectedTopics[0]?.targetKind === "planned_topic"
    );
    if (exactEvidenceExists) {
      throw new Error("Micro-seed evidence job exists; block classification denied");
    }
    const timestamp = Date.now();
    await ctx.db.patch(job._id, {
      status: "missed",
      evidenceQueueReason: args.reason.slice(0, 80),
      errorCode: "evidence_preflight_or_budget_blocked",
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    // A budget/preflight race says nothing about the keyword's SEO merit. The
    // strict scheduler cannot use this topic without expected-click proof, so
    // leave it planned and report the cadence miss rather than falsely
    // disqualifying it.
    return { recorded: true, topicDisqualified: false };
  },
});

export const recordEvidenceHandoffUnverified = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    topicId: v.id("topic_clusters"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const [job, topic, linkedArticle, activeGroups] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.topicId),
      ctx.db.query("articles").withIndex("by_topic", (q) =>
        q.eq("topicId", args.topicId)
      ).first(),
      Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
        ctx.db.query("jobs").withIndex("by_site_status", (q) =>
          q.eq("siteId", args.siteId).eq("status", status)
        ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
      )),
    ]);
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.status !== "awaiting_evidence" ||
      job.evidenceJobId !== undefined ||
      job.topicId !== args.topicId ||
      !topic ||
      topic.siteId !== args.siteId ||
      topic.cadenceMicroSeedJobId !== job._id ||
      topic.cadenceMicroSeedFingerprint !== job.topicFingerprint ||
      activeGroups.some((rows) => rows.length > CADENCE_MICRO_SEED_READ_LIMIT)
    ) throw new Error("Micro-seed unverified handoff crossed its exact scope");
    const activeArticleJob = activeGroups.flat().some((candidate) => {
      if (candidate.type !== "article") return false;
      const payload = candidate.payload && typeof candidate.payload === "object"
        ? candidate.payload as Record<string, unknown>
        : {};
      return payload.topicId === topic._id || candidate.articleId === linkedArticle?._id;
    });
    const topicInUse = Boolean(linkedArticle) || activeArticleJob ||
      topic.status === "queued" || topic.status === "used";
    const timestamp = Date.now();
    if (!topicInUse) {
      await ctx.db.patch(topic._id, {
        status: "disqualified",
        disqualifiedReason:
          `cadence_micro_seed_evidence_handoff_unverified:${args.reason}`
            .slice(0, 240),
        updatedAt: timestamp,
      });
    }
    await ctx.db.patch(job._id, {
      status: "missed",
      evidenceQueueReason: args.reason.slice(0, 80),
      errorCode: "evidence_handoff_unverified",
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      recorded: true as const,
      topicDisqualified: !topicInUse,
      topicInUse,
    };
  },
});

export const getFinalizationStateInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.siteId !== args.siteId || !job.topicId) return null;
    const [site, topic, evidence, linkedArticle, activeArticleJobs] =
      await Promise.all([
        ctx.db.get(args.siteId),
        ctx.db.get(job.topicId),
        job.evidenceJobId ? ctx.db.get(job.evidenceJobId) : Promise.resolve(null),
        ctx.db.query("articles").withIndex("by_topic", (q) =>
          q.eq("topicId", job.topicId!)
        ).first(),
        Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
          ctx.db.query("jobs").withIndex("by_site_status", (q) =>
            q.eq("siteId", args.siteId).eq("status", status)
          ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
        )),
      ]);
    return {
      site,
      job,
      topic,
      evidence,
      linkedArticleId: linkedArticle?._id,
      activeArticleJob: activeArticleJobs.flat().some((candidate) => {
        if (candidate.type !== "article") return false;
        const payload = candidate.payload && typeof candidate.payload === "object"
          ? candidate.payload as Record<string, unknown>
          : {};
        return payload.topicId === job.topicId || candidate.articleId === linkedArticle?._id;
      }),
    };
  },
});

export const finalizeEvidence = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    outcome: v.union(
      v.literal("eligible"),
      v.literal("semantic_failure"),
      v.literal("evidence_unverified"),
      v.literal("precall_blocked"),
      v.literal("unresolved"),
      v.literal("already_consumed"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.siteId !== args.siteId || !job.topicId) {
      return { finalized: false as const, reason: "job_unavailable" as const };
    }
    const timestamp = Date.now();
    const [site, topic, evidence, linkedArticle, activeJobs] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(job.topicId),
      job.evidenceJobId ? ctx.db.get(job.evidenceJobId) : Promise.resolve(null),
      ctx.db.query("articles").withIndex("by_topic", (q) =>
        q.eq("topicId", job.topicId!)
      ).first(),
      Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
        ctx.db.query("jobs").withIndex("by_site_status", (q) =>
          q.eq("siteId", args.siteId).eq("status", status)
        ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
      )),
    ]);
    const executionAuthorized = siteExecutionActive(site) &&
      (await siteExecutionAuthorized(ctx, site));
    const exactScope = Boolean(
      executionAuthorized &&
      site!.expectedClickSchedulingEnabled === true &&
      verifiedKeywordPlanningActive(site!) &&
      job.status === "evidence_running" &&
      job.rolloutEpoch === (site!.autopilotRolloutEpoch ?? 0) &&
      job.reservationDay === utcDay(timestamp) &&
      job.evidenceJobId &&
      evidence &&
      evidence._id === job.evidenceJobId &&
      evidence.siteId === args.siteId &&
      evidence.userId === job.userId &&
      evidence.policyVersion === EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION &&
      evidence.origin === "operator_canary" &&
      evidence.reservationDay === job.reservationDay &&
      evidence.rolloutEpoch === job.rolloutEpoch &&
      evidence.selectionScope === "planned_unmaterialized" &&
      evidence.selectedTopics.length === 1 &&
      evidence.selectedTopics[0]?.topicId === job.topicId &&
      evidence.selectedTopics[0]?.targetKind === "planned_topic" &&
      evidence.selectedTopics[0]?.plannedTopicFingerprint ===
        job.plannedEvidenceFingerprint &&
      topic &&
      topic.siteId === args.siteId &&
      cadenceMicroSeedContinuationVersion(
        job.policyVersion,
        topic.cadenceMicroSeedVersion,
      ) &&
      topic.cadenceMicroSeedJobId === job._id &&
      topic.cadenceMicroSeedFingerprint === job.topicFingerprint &&
      job.sourcePlanFingerprint &&
      job.selectedCandidate &&
      normalizeCadenceMicroSeedText(topic.primaryKeyword) ===
        normalizeCadenceMicroSeedText(job.selectedCandidate.keyword) &&
      !activeJobs.some((rows) => rows.length > CADENCE_MICRO_SEED_READ_LIMIT),
    );
    if (!exactScope || !topic) {
      return { finalized: false as const, reason: "topic_scope_changed" as const };
    }
    const hasActiveTopicJob = activeJobs.flat().some((candidate) => {
      if (candidate.type !== "article") return false;
      const payload = candidate.payload && typeof candidate.payload === "object"
        ? candidate.payload as Record<string, unknown>
        : {};
      return payload.topicId === topic._id || candidate.articleId === linkedArticle?._id;
    });
    const currentTopicFit = evaluateTopicBusinessFit({
      keyword: topic.primaryKeyword,
      label: topic.label,
      ...tenantTopicBusinessSignals(site!),
    });
    if (
      !currentTopicFit.eligible ||
      currentTopicFit.version !== TOPIC_BUSINESS_FIT_VERSION
    ) {
      // Expected-click evidence proves search opportunity, not tenant product
      // relevance. Re-evaluate immediately before cadence handoff so a policy
      // correction or profile change cannot turn a previously accepted seed
      // into paid generation. At this point the topic must still be unused;
      // in-use work belongs to the worker/publisher's independent fences.
      if (linkedArticle || hasActiveTopicJob || topic.status !== "planned") {
        return { finalized: false as const, reason: "topic_in_use" as const };
      }
      await ctx.db.patch(topic._id, {
        status: "disqualified",
        businessFitEligible: false,
        businessFitScore: currentTopicFit.score,
        businessFitVersion: currentTopicFit.version,
        businessFitReasons: currentTopicFit.reasons,
        businessFitCheckedAt: timestamp,
        disqualifiedReason:
          `cadence_micro_seed_business_fit_drifted:${currentTopicFit.reasons.join("; ")}`
            .slice(0, 240),
        updatedAt: timestamp,
      });
      await ctx.db.patch(job._id, {
        status: "missed",
        finalizeAttempts: job.finalizeAttempts + 1,
        errorCode: "business_fit_drifted",
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        finalized: true as const,
        topicDisqualified: true as const,
        reason: "business_fit_drifted" as const,
      };
    }
    if (
      topic.businessFitEligible !== true ||
      topic.businessFitVersion !== TOPIC_BUSINESS_FIT_VERSION ||
      topic.businessFitScore !== currentTopicFit.score ||
      JSON.stringify(topic.businessFitReasons ?? []) !==
        JSON.stringify(currentTopicFit.reasons)
    ) {
      await ctx.db.patch(topic._id, {
        businessFitEligible: true,
        businessFitScore: currentTopicFit.score,
        businessFitVersion: currentTopicFit.version,
        businessFitReasons: currentTopicFit.reasons,
        businessFitCheckedAt: timestamp,
        updatedAt: timestamp,
      });
    }
    const currentPortfolio = evaluateStoredExpectedClickPortfolio({
      topics: [{
        topicId: String(topic._id),
        keyword: topic.primaryKeyword,
        searchVolume: topic.searchVolume,
        searchDemandSource: topic.searchDemandSource,
        searchDemandMeasuredAt: topic.searchDemandMeasuredAt,
        searchDemandLocationCode: topic.searchDemandLocationCode,
        searchDemandLanguageCode: topic.searchDemandLanguageCode,
        serpTopUrls: topic.serpTopUrls,
        serpObservedAt: topic.serpObservedAt,
        serpLocationCode: topic.serpLocationCode,
        serpLanguageCode: topic.serpLanguageCode,
        serpAuthorityCompetitors: topic.serpAuthorityCompetitors,
      }],
      tenantAuthority: {
        domain: site!.seoAuthorityDomain,
        currentDomain: site!.domain,
        domainRank: site!.seoAuthorityDomainRank,
        referringDomains: site!.seoAuthorityReferringDomains,
        source: site!.seoAuthoritySource,
        measuredAt: site!.seoAuthorityMeasuredAt,
      },
      monthlyOrganicClickGoal: 100,
      currentLocationCode: dataForSeoLocationCode(site!.targetCountry),
      currentLanguageCode: dataForSeoLanguageCode(site!.language),
      now: timestamp,
    });
    const portfolioTopic = currentPortfolio.topics.find((candidate) =>
      candidate.topicId === String(topic._id)
    );
    const eligible = evidence!.status === "completed" &&
      evidence!.persistedTopics === 1 &&
      topic.expectedClickBackfillVersion ===
        EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION &&
      topic.expectedClickBackfillJobId === evidence!._id &&
      topic.expectedClickAuditVersion === EXPECTED_CLICK_PORTFOLIO_VERSION &&
      topic.expectedClickStatus === "eligible" &&
      portfolioTopic?.status === "eligible" &&
      Number.isFinite(topic.expectedClicksMonthly) &&
      (topic.expectedClicksMonthly ?? 0) > 0;
    const semanticReason = evidence!.serpFailures[0]?.code ??
      ((evidence!.insufficientTopics ?? 0) > 0
        ? "insufficient_expected_click_evidence"
        : "evidence_not_persisted");
    const semanticFailure = evidence!.status === "completed" && !eligible;
    const preCallBlocked = evidence!.providerCallsAttempted === 0 &&
      ["provider_balance_unavailable", "partial"].includes(evidence!.status);
    const terminalPaidFailure = evidence!.status === "partial" &&
      evidence!.providerCallsAttempted > 0;
    const ambiguous = evidence!.providerCallsAttempted >
        evidence!.providerCallsCompleted ||
      terminalPaidFailure ||
      (evidence!.authorityDomains !== undefined &&
        evidence!.authoritySnapshotComplete !== true);
    const unresolved = !eligible && !semanticFailure && !preCallBlocked &&
      !ambiguous &&
      job.finalizeAttempts >= CADENCE_MICRO_SEED_MAX_FINALIZE_ATTEMPTS;

    if (args.outcome === "eligible") {
      if (!eligible) {
        return { finalized: false as const, reason: "evidence_state_changed" as const };
      }
      await ctx.scheduler.runAfter(
        0,
        internal.actions.cadenceMicroSeed.scheduleCadenceForMicroSeed,
        { siteId: args.siteId, jobId: args.jobId },
      );
      await ctx.scheduler.runAfter(
        CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
        internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
        { siteId: args.siteId, jobId: args.jobId },
      );
      await ctx.db.patch(job._id, {
        status: "cadence_scheduling",
        finalizeAttempts: job.finalizeAttempts + 1,
        cadenceScheduleRequestedAt: timestamp,
        cadenceScheduleAttempts: job.cadenceScheduleAttempts ?? 0,
        watchdogScheduledAt: timestamp,
        errorCode: undefined,
        updatedAt: timestamp,
      });
      return { finalized: true as const, scheduleCadenceQueued: true as const };
    }
    if (args.outcome === "already_consumed") {
      if (!linkedArticle && !hasActiveTopicJob && topic.status !== "queued" && topic.status !== "used") {
        return { finalized: false as const, reason: "not_consumed" as const };
      }
      const alerts = await ctx.db.query("autopilot_alerts")
        .withIndex("by_site_kind_status", (q) => q
          .eq("siteId", args.siteId)
          .eq("kind", "cadence_micro_seed_missed")
          .eq("status", "active"))
        .take(20);
      for (const alert of alerts) {
        await ctx.db.patch(alert._id, {
          status: "resolved",
          resolvedAt: timestamp,
          updatedAt: timestamp,
        });
      }
      await ctx.db.patch(job._id, {
        status: "completed",
        finalizeAttempts: job.finalizeAttempts + 1,
        cadenceScheduleAttempts: (job.cadenceScheduleAttempts ?? 0) + 1,
        cadenceScheduleMode: "already_consumed",
        cadenceScheduleScheduled: 1,
        cadenceScheduleReceiptAt: timestamp,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return { finalized: true as const, exactTopicScheduled: true as const };
    }
    if (args.outcome === "precall_blocked" || args.outcome === "unresolved") {
      if (
        (args.outcome === "precall_blocked" && !preCallBlocked) ||
        (args.outcome === "unresolved" && !unresolved)
      ) {
        return { finalized: false as const, reason: "evidence_state_changed" as const };
      }
      // These are operational failures, not negative search evidence.
      await ctx.db.patch(job._id, {
        status: "missed",
        finalizeAttempts: job.finalizeAttempts + 1,
        errorCode: args.outcome,
        evidenceQueueReason: args.reason.slice(0, 80),
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return { finalized: true as const, topicDisqualified: false };
    }
    if (
      (args.outcome === "semantic_failure" && !semanticFailure) ||
      (args.outcome === "evidence_unverified" && !ambiguous) ||
      linkedArticle ||
      hasActiveTopicJob ||
      topic.status !== "planned"
    ) {
      return { finalized: false as const, reason: "topic_in_use" as const };
    }
    const verifiedReason = args.outcome === "semantic_failure"
      ? semanticReason
      : "provider_attempt_ambiguous";
    const cannibalizing = verifiedReason.includes("cannibalization");
    let nextCandidate: SelectedCandidateReceipt | null = null;
    const candidateAttemptCount = job.candidateAttemptCount ?? 1;
    if (
      args.outcome === "semantic_failure" &&
      candidateAttemptCount < CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES
    ) {
      const currentArticleInventory = await cadenceMicroSeedArticleInventory(
        ctx,
        site!,
      );
      const currentArticles = currentArticleInventory.articles;
      const currentTopicInventory = await cadenceMicroSeedTopicInventory(
        ctx,
        site!,
        currentArticles,
      );
      const currentTopics = Array.from(new Map(
        [...currentTopicInventory.topics, topic].map((row) => [
          String(row._id),
          row,
        ]),
      ).values());
      if (
        !currentTopicInventory.exhausted &&
        !currentArticleInventory.exhausted
      ) {
        const authority = tenantAuthorityFromStoredEvidence({
          domain: site!.seoAuthorityDomain,
          currentDomain: site!.domain,
          domainRank: site!.seoAuthorityDomainRank,
          referringDomains: site!.seoAuthorityReferringDomains,
          source: site!.seoAuthoritySource,
          measuredAt: site!.seoAuthorityMeasuredAt,
        });
        if (measuredAuthorityIsFresh(authority, timestamp)) {
          nextCandidate = selectCurrentCadenceContinuationCandidate({
            site: site!,
            job,
            topics: currentTopics,
            articles: currentArticles,
            domainRank: authority.domainRank,
            // This topic just failed live evidence and is about to become
            // terminal. It must not reserve intent as active inventory while
            // the replacement is selected, but its exact keyword remains in
            // the duplicate fence.
            excludedActiveTopicIds: new Set([String(topic._id)]),
          });
        }
      }
    }
    await ctx.db.patch(topic._id, {
      status: cannibalizing ? "cannibalizing" : "disqualified",
      disqualifiedReason: `cadence_micro_seed_${args.outcome}:${verifiedReason}`
        .slice(0, 240),
      updatedAt: timestamp,
    });
    if (nextCandidate) {
      const next = await insertCadenceMicroSeedTopic({
        ctx,
        site: site!,
        job,
        selected: nextCandidate,
        timestamp,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.actions.cadenceMicroSeed.resumeCadenceEvidenceHandoff,
        { siteId: args.siteId, jobId: args.jobId },
      );
      await ctx.scheduler.runAfter(
        CADENCE_MICRO_SEED_WATCHDOG_DELAY_MS,
        internal.actions.cadenceMicroSeed.reconcileCadenceMicroSeed,
        { siteId: args.siteId, jobId: args.jobId },
      );
      await ctx.db.patch(job._id, {
        status: "awaiting_evidence",
        selectedCandidate: nextCandidate,
        candidateAttemptCount: candidateAttemptCount + 1,
        priorCandidateAttempts: [
          ...(job.priorCandidateAttempts ?? []),
          {
            keyword: job.selectedCandidate!.keyword,
            topicId: topic._id,
            topicFingerprint: job.topicFingerprint!,
            plannedEvidenceFingerprint: job.plannedEvidenceFingerprint!,
            evidenceJobId: evidence!._id,
            outcome: "semantic_failure" as const,
            reason: verifiedReason.slice(0, 120),
            completedAt: timestamp,
          },
        ],
        topicId: next.topicId,
        topicFingerprint: next.topicFingerprint,
        plannedEvidenceFingerprint: next.plannedEvidenceFingerprint,
        evidenceJobId: undefined,
        evidenceQueueReason: undefined,
        evidenceFinalizerScheduledAt: undefined,
        watchdogScheduledAt: timestamp,
        cadenceScheduleRequestedAt: undefined,
        cadenceScheduleAttempts: 0,
        cadenceScheduleMode: undefined,
        cadenceScheduleScheduled: undefined,
        cadenceScheduleReceiptAt: undefined,
        // Each candidate owns a fresh bounded finalization envelope. Candidate
        // cardinality is bounded separately by candidateAttemptCount.
        finalizeAttempts: 0,
        errorCode: undefined,
        completedAt: undefined,
        updatedAt: timestamp,
      });
      return {
        finalized: true as const,
        topicDisqualified: true,
        cannibalizing,
        retryQueued: true as const,
        candidateAttemptCount: candidateAttemptCount + 1,
        topicId: next.topicId,
        keyword: nextCandidate.keyword,
      };
    }
    await ctx.db.patch(job._id, {
      status: "missed",
      finalizeAttempts: job.finalizeAttempts + 1,
      errorCode: args.outcome,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    return { finalized: true as const, topicDisqualified: true, cannibalizing };
  },
});

/** Record only a database-proven handoff of this exact topic. The scheduler's
 * return payload is diagnostic; it is never authority to resolve the miss. */
export const recordCadenceScheduleResult = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    scheduled: v.number(),
    mode: v.string(),
  },
  handler: async (ctx, args) => {
    if (
      !Number.isInteger(args.scheduled) ||
      args.scheduled < 0 ||
      args.scheduled > 10 ||
      !args.mode.trim() ||
      args.mode.length > 80
    ) throw new Error("Invalid cadence scheduling result receipt");
    const job = await ctx.db.get(args.jobId);
    if (
      job?.siteId === args.siteId &&
      job.status === "completed" &&
      job.cadenceScheduleReceiptAt !== undefined
    ) {
      return { recorded: false as const, alreadyVerified: true as const };
    }
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.status !== "cadence_scheduling" ||
      !job.topicId ||
      !job.topicFingerprint ||
      !job.evidenceJobId
    ) return { recorded: false as const, reason: "job_state_changed" as const };
    const [site, topic, linkedArticle, activeGroups] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(job.topicId),
      ctx.db.query("articles").withIndex("by_topic", (q) =>
        q.eq("topicId", job.topicId!)
      ).first(),
      Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
        ctx.db.query("jobs").withIndex("by_site_status", (q) =>
          q.eq("siteId", args.siteId).eq("status", status)
        ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
      )),
    ]);
    if (
      !siteExecutionActive(site) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      site.expectedClickSchedulingEnabled !== true ||
      !verifiedKeywordPlanningActive(site) ||
      job.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
      job.reservationDay !== utcDay(Date.now()) ||
      !topic ||
      topic.siteId !== args.siteId ||
      !cadenceMicroSeedContinuationVersion(
        job.policyVersion,
        topic.cadenceMicroSeedVersion,
      ) ||
      topic.cadenceMicroSeedJobId !== job._id ||
      topic.cadenceMicroSeedFingerprint !== job.topicFingerprint ||
      activeGroups.some((rows) => rows.length > CADENCE_MICRO_SEED_READ_LIMIT)
    ) return { recorded: false as const, reason: "topic_scope_changed" as const };
    const exactActiveArticleJob = activeGroups.flat().some((candidate) => {
      if (candidate.type !== "article") return false;
      const payload = candidate.payload && typeof candidate.payload === "object"
        ? candidate.payload as Record<string, unknown>
        : {};
      return payload.topicId === topic._id || candidate.articleId === linkedArticle?._id;
    });
    const currentTopicFit = evaluateTopicBusinessFit({
      keyword: topic.primaryKeyword,
      label: topic.label,
      ...tenantTopicBusinessSignals(site!),
    });
    if (
      !currentTopicFit.eligible ||
      currentTopicFit.version !== TOPIC_BUSINESS_FIT_VERSION
    ) {
      const timestamp = Date.now();
      if (!["used", "cannibalizing", "plan_checkpoint"].includes(topic.status ?? "")) {
        await ctx.db.patch(topic._id, {
          status: "disqualified",
          businessFitEligible: false,
          businessFitScore: currentTopicFit.score,
          businessFitVersion: currentTopicFit.version,
          businessFitReasons: currentTopicFit.reasons,
          businessFitCheckedAt: timestamp,
          disqualifiedReason:
            `cadence_micro_seed_business_fit_drifted:${currentTopicFit.reasons.join("; ")}`
              .slice(0, 240),
          updatedAt: timestamp,
        });
      }
      await ctx.db.patch(job._id, {
        status: "missed",
        cadenceScheduleAttempts: (job.cadenceScheduleAttempts ?? 0) + 1,
        cadenceScheduleMode: "business_fit_drifted",
        cadenceScheduleScheduled: 0,
        errorCode: "business_fit_drifted",
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        recorded: true as const,
        exactTopicScheduled: false as const,
        topicDisqualified: true as const,
        reason: "business_fit_drifted" as const,
      };
    }
    const exactTopicScheduled = topic.status === "queued" ||
      topic.status === "used" || Boolean(linkedArticle) || exactActiveArticleJob;
    const timestamp = Date.now();
    const attempts = (job.cadenceScheduleAttempts ?? 0) + 1;
    if (exactTopicScheduled) {
      const alerts = await ctx.db.query("autopilot_alerts")
        .withIndex("by_site_kind_status", (q) => q
          .eq("siteId", args.siteId)
          .eq("kind", "cadence_micro_seed_missed")
          .eq("status", "active"))
        .take(20);
      for (const alert of alerts) {
        await ctx.db.patch(alert._id, {
          status: "resolved",
          resolvedAt: timestamp,
          updatedAt: timestamp,
        });
      }
      await ctx.db.patch(job._id, {
        status: "completed",
        cadenceScheduleAttempts: attempts,
        cadenceScheduleMode: args.mode.slice(0, 80),
        cadenceScheduleScheduled: args.scheduled,
        cadenceScheduleReceiptAt: timestamp,
        errorCode: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      return {
        recorded: true as const,
        exactTopicScheduled: true as const,
        topicId: topic._id,
      };
    }
    if (attempts < CADENCE_MICRO_SEED_MAX_SCHEDULE_ATTEMPTS) {
      await ctx.scheduler.runAfter(
        CADENCE_MICRO_SEED_FINALIZE_DELAY_MS,
        internal.actions.cadenceMicroSeed.scheduleCadenceForMicroSeed,
        { siteId: args.siteId, jobId: args.jobId },
      );
      await ctx.db.patch(job._id, {
        cadenceScheduleAttempts: attempts,
        cadenceScheduleMode: args.mode.slice(0, 80),
        cadenceScheduleScheduled: args.scheduled,
        updatedAt: timestamp,
      });
      return {
        recorded: true as const,
        exactTopicScheduled: false as const,
        retryScheduled: true as const,
      };
    }
    await ctx.db.patch(job._id, {
      status: "missed",
      cadenceScheduleAttempts: attempts,
      cadenceScheduleMode: args.mode.slice(0, 80),
      cadenceScheduleScheduled: args.scheduled,
      errorCode: "cadence_schedule_unverified",
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    return {
      recorded: true as const,
      exactTopicScheduled: false as const,
      exhausted: true as const,
    };
  },
});

export const incrementFinalizeAttempt = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.siteId !== args.siteId || job.status !== "evidence_running") {
      return { incremented: false as const };
    }
    if (job.finalizeAttempts >= CADENCE_MICRO_SEED_MAX_FINALIZE_ATTEMPTS) {
      return { incremented: false as const, exhausted: true as const };
    }
    await ctx.db.patch(job._id, {
      finalizeAttempts: job.finalizeAttempts + 1,
      updatedAt: Date.now(),
    });
    return {
      incremented: true as const,
      attempts: job.finalizeAttempts + 1,
      exhausted:
        job.finalizeAttempts + 1 >= CADENCE_MICRO_SEED_MAX_FINALIZE_ATTEMPTS,
    };
  },
});

export const getStatusInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const job = await ctx.db.query("cadence_micro_seed_jobs")
      .withIndex("by_site_created", (q) => q.eq("siteId", siteId))
      .order("desc")
      .first();
    if (!job) return null;
    return {
      jobId: job._id,
      status: job.status,
      sourcePlanId: job.sourcePlanId,
      attemptKind: job.attemptKind ?? "primary",
      parentMicroSeedJobId: job.parentMicroSeedJobId,
      parentMicroSeedReceiptFingerprint:
        job.parentMicroSeedReceiptFingerprint,
      reservationDay: job.reservationDay,
      seed: job.seed,
      providerSeeds: job.providerSeeds ?? [job.seed],
      providerCostCeilingMicroUsd: job.providerCostCeilingMicroUsd,
      providerSpendReservationId: job.providerSpendReservationId,
      providerCallAttempted: job.providerCallAttempted,
      providerCallCompleted: job.providerCallCompleted,
      providerTaskCostUsd: job.providerTaskCostUsd,
      candidatesReceived: job.candidateAudit?.received ?? 0,
      candidatesAccepted: job.candidateAudit?.accepted ?? 0,
      candidateAudit: job.candidateAudit,
      selectedKeyword: job.selectedCandidate?.keyword,
      selectedSourceSeed: job.selectedCandidate?.sourceSeed ?? job.seed,
      selectedSearchVolume: job.selectedCandidate?.searchVolume,
      selectedKeywordDifficulty: job.selectedCandidate?.difficulty,
      topicId: job.topicId,
      evidenceJobId: job.evidenceJobId,
      evidenceQueueReason: job.evidenceQueueReason,
      finalizeAttempts: job.finalizeAttempts,
      watchdogRecoveries: job.watchdogRecoveries ?? 0,
      cadenceScheduleAttempts: job.cadenceScheduleAttempts ?? 0,
      cadenceScheduleMode: job.cadenceScheduleMode,
      cadenceScheduleScheduled: job.cadenceScheduleScheduled,
      cadenceScheduleReceiptAt: job.cadenceScheduleReceiptAt,
      errorCode: job.errorCode,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    };
  },
});
