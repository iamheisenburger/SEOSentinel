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
  CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT,
  CADENCE_MICRO_SEED_ANCHOR_AUDIT_VERSION,
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
  cadenceMicroSeedPreSerpDifficultyCeiling,
  cadenceMicroSeedAnchors,
  cadenceMicroSeedLegacyAnchorReceiptEligible,
  cadenceMicroSeedAttemptKind,
  cadenceMicroSeedProviderCeilingMicroUsd,
  cadenceMicroSeedProviderPurpose,
  cadenceMicroSeedProviderReceiptValid,
  cadenceMicroSeedProviderTrigger,
  cadenceMicroSeedCheckpointSourcePlanExhaustionKind,
  cadenceMicroSeedSourcePlanExecutionExhausted,
  cadenceMicroSeedSourcePlanFresh,
  cadenceMicroSeedTerminalMissReceiptValid,
  normalizeCadenceMicroSeedText,
  selectCadenceMicroSeedAnchor,
  selectCadenceMicroSeedCandidate,
  selectCadenceMicroSeedFallbackAnchor,
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
  measuredAuthorityIsFresh,
  tenantAuthorityFromStoredEvidence,
} from "./lib/expectedClickPortfolio";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD,
  EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
} from "./lib/expectedClickEvidenceBackfill";
import {
  expectedClickDemandFleetReadiness,
  terminalNoMetricDemandReceiptFingerprint,
} from "./expectedClickDemandBackfill";
import {
  expectedClickEvidenceFleetReadiness,
} from "./expectedClickEvidenceBackfill";
import { evaluateSerpAttainability } from "./lib/serpAttainability";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "./lib/dataForSeoLocale";
import {
  evaluateProviderAccountCapacity,
  evaluateSharedProviderCapacity,
  providerAccountMonthlyCeilingMicroUsd,
  releaseSharedProviderReservation,
  reserveSharedProviderBudget,
  summarizeProviderReservationLedger,
} from "./lib/providerSpendReservation";
import {
  cadenceMicroSeedRecoveryBlockReason,
  plannedTopicRecoveryFingerprint,
  plannedTopicSiteGate,
  verifiedKeywordPlanningActive,
} from "./lib/plannedTopicEvidenceRecovery";
import {
  resolvePlanFromFeatures,
} from "./planLimits";
import { terminalContentFeasibility } from "./lib/topicLifecycle";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import {
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  takeCurrentDomainArticles,
  takeCurrentDomainTopics,
} from "./lib/siteDomainBinding";

const ACTIVE_CONTENT_STATUSES = ["pending", "running"] as const;
const ACTIVE_EVIDENCE_STATUSES = ["pending", "running", "partial"] as const;

function utcDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

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
  return JSON.stringify({
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
}

function validPrimaryFallbackReceipt(args: {
  site: Doc<"sites">;
  job: Doc<"cadence_micro_seed_jobs">;
  reservation: Doc<"provider_spend_reservations"> | null;
  sourcePlanId: Id<"jobs">;
  sourcePlanReservationId: Id<"provider_spend_reservations">;
  sourcePlanFingerprint: string;
  primarySeed: string;
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

async function activeDemandRows(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
): Promise<number> {
  let total = 0;
  for (const status of ACTIVE_EVIDENCE_STATUSES) {
    const rows = await ctx.db
      .query("expected_click_demand_jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", status)
      )
      .take(2);
    total += rows.length;
  }
  return total;
}

async function inspectReadiness(
  ctx: QueryCtx | MutationCtx,
  siteId: Id<"sites">,
  timestamp: number,
  currentJobId?: Id<"cadence_micro_seed_jobs">,
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

  const [articles, topics, activeContentGroups, activeEvidence, activeDemand] =
    await Promise.all([
      takeCurrentDomainArticles(
        ctx,
        site,
        CADENCE_MICRO_SEED_READ_LIMIT + 1,
      ),
      takeCurrentDomainTopics(
        ctx,
        site,
        CADENCE_MICRO_SEED_READ_LIMIT + 1,
      ),
      Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
        ctx.db.query("jobs").withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
      )),
      activeEvidenceRows(ctx, siteId),
      activeDemandRows(ctx, siteId),
    ]);
  if (
    articles.length > CADENCE_MICRO_SEED_READ_LIMIT ||
    topics.length > CADENCE_MICRO_SEED_READ_LIMIT ||
    activeContentGroups.some((rows) =>
      rows.length > CADENCE_MICRO_SEED_READ_LIMIT
    )
  ) return { ready: false, reason: "read_limit_exhausted" };
  const activeContent = activeContentGroups.flat().filter((job) =>
    job.type === "article" || job.type === "plan"
  );
  if (activeContent.length > 0 || activeEvidence > 0 || activeDemand > 0) {
    return { ready: false, reason: "work_in_progress" };
  }

  const liveMicroJobs = await Promise.all([
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
  ));
  if (liveMicroJobs.flat().some((job) => job._id !== currentJobId)) {
    return { ready: false, reason: "micro_seed_in_progress" };
  }

  const sealedBuffer = articles.filter(isSealedReady);
  if (
    sealedBuffer.length >=
      approvedBufferPolicy(site.cadencePerWeek ?? 4).minimum
  ) {
    return { ready: false, reason: "buffer_minimum_met" };
  }
  const published = articles.filter((article) => article.status === "published");
  const latestPublished = published.slice().sort((left, right) =>
    effectivePublishedAt(right) - effectivePublishedAt(left)
  )[0];
  const nextCadenceDueAt = latestPublished
    ? effectivePublishedAt(latestPublished) +
      cadenceIntervalMs(site.cadencePerWeek!)
    : timestamp;
  if (nextCadenceDueAt - timestamp > CADENCE_MICRO_SEED_MAX_CADENCE_HORIZON_MS) {
    return { ready: false, reason: "cadence_not_imminent" };
  }
  const candidateWindowStart = autopilotCandidateWindowStart({
    now: timestamp,
    rolloutMode: site.autopilotRolloutMode ?? "observe",
    rolloutStartedAt: site.autopilotRolloutStartedAt ?? site.updatedAt,
  });
  const reviewRecovery = hasRecoverableQualityWork(
    articles
      .filter((article) => article.status === "review")
      .slice(0, CADENCE_QUALITY_RECOVERY_READ_LIMIT),
    candidateWindowStart,
  );
  if (reviewRecovery) {
    return { ready: false, reason: "quality_recovery_available" };
  }

  const locationCode = dataForSeoLocationCode(site.targetCountry);
  const languageCode = dataForSeoLanguageCode(site.language);
  const portfolio = evaluateStoredExpectedClickPortfolio({
    topics: topics.filter((topic) =>
      topic.status !== "plan_checkpoint" &&
      !topic.planCheckpointTerminalFailureCode
    ).map((topic) => ({
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
    })),
    tenantAuthority: {
      domain: site.seoAuthorityDomain,
      currentDomain: site.domain,
      domainRank: site.seoAuthorityDomainRank,
      referringDomains: site.seoAuthorityReferringDomains,
      source: site.seoAuthoritySource,
      measuredAt: site.seoAuthorityMeasuredAt,
    },
    monthlyOrganicClickGoal: 100,
    currentLocationCode: locationCode,
    currentLanguageCode: languageCode,
    now: timestamp,
  });
  const expectedEligible = new Set(portfolio.topics.filter((topic) =>
    topic.status === "eligible"
  ).map((topic) => topic.topicId));
  const businessSignals = tenantTopicBusinessSignals(site);
  const schedulerCandidates = topics.filter((topic) => {
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
    ].includes(
      topic.status ?? "planned",
    ) && !topic.planCheckpointTerminalFailureCode &&
      fit.eligible && topic.businessFitEligible === true &&
      topic.cadenceMicroSeedAnchorEligible !== false &&
      Number.isFinite(topic.searchVolume) &&
      Number.isFinite(topic.keywordDifficulty) &&
      topic.keywordDifficultyMeasured === true &&
      Boolean(topic.serpIntent?.trim()) &&
      expectedEligible.has(String(topic._id)) &&
      evaluateSerpAttainability({
        serpTopUrls: topic.serpTopUrls,
        siteHost: site.domain,
      }).attainable;
  });
  const coverage = coveredIntentTopics(
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
  if (
    filterNonCannibalizingIntentTopics(
      schedulerCandidates,
      coverage,
      0.4,
      0.35,
      1,
    ).length > 0
  ) return { ready: false, reason: "scheduler_topic_available" };

  // Existing non-overlapping planned inventory gets the cheaper exact
  // demand/evidence bridge before discovery is allowed to spend. This also
  // prevents the guarded one-topic evidence apply from selecting a different
  // row after the micro topic is materialized.
  const recoverySnapshot = {
    site,
    topics,
    articles,
    activeArticleTopicIds: new Set<string>(),
    activeJobsExhausted: false,
    plannedGate: siteGate,
    plannedAuthorityFresh: true,
  };
  const [demandReadiness, evidenceReadiness, terminalDemandJobs] =
    await Promise.all([
    expectedClickDemandFleetReadiness(
      ctx,
      siteId,
      timestamp,
      recoverySnapshot,
    ),
    expectedClickEvidenceFleetReadiness(
      ctx,
      siteId,
      timestamp,
      recoverySnapshot,
    ),
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
  const terminalDemandJob = terminalDemandJobs[0];
  const terminalDemandNoMetricFingerprint = terminalDemandJob
    ? await terminalNoMetricDemandReceiptFingerprint(
      ctx,
      site,
      terminalDemandJob,
      timestamp,
    )
    : null;
  const recoveryBlockReason = cadenceMicroSeedRecoveryBlockReason(
    demandReadiness,
    evidenceReadiness,
    Boolean(terminalDemandNoMetricFingerprint),
  );
  if (recoveryBlockReason) return { ready: false, reason: recoveryBlockReason };

  const sourcePlans = await ctx.db.query("jobs")
    .withIndex("by_site_type_created", (q) =>
      q.eq("siteId", siteId).eq("type", "plan").gte(
        "createdAt",
        timestamp - CADENCE_MICRO_SEED_MAX_SOURCE_PLAN_AGE_MS,
      )
    )
    .order("desc")
    .take(50);
  let source:
    | {
        job: Doc<"jobs">;
        reservation: Doc<"provider_spend_reservations">;
        checkpoints: Doc<"plan_candidate_checkpoints">[];
      }
    | undefined;
  for (const job of sourcePlans) {
    const [reservation, checkpoints] = await Promise.all([
      job.providerSpendReservationId
        ? ctx.db.get(job.providerSpendReservationId)
        : Promise.resolve(null),
      ctx.db.query("plan_candidate_checkpoints")
        .withIndex("by_plan_job", (q) => q.eq("planJobId", job._id))
        .order("desc")
        .take(2),
    ]);
    if (validExhaustedSourcePlan({
      site,
      job,
      reservation,
      checkpoints,
      timestamp,
    })) {
      if (!reservation) continue;
      source = { job, reservation, checkpoints };
      break;
    }
  }
  if (!source) return { ready: false, reason: "source_plan_not_exhausted" };
  const sourceFingerprint = sourcePlanFingerprint(
    source.job,
    source.reservation,
    source.checkpoints,
  );
  // Query the exact current policy through a composite index. Historical
  // no-replay receipts remain immutable but cannot make a new policy's own
  // insertion cross an unrelated fixed read limit and invalidate its fence.
  const sourceJobs = await ctx.db.query("cadence_micro_seed_jobs")
    .withIndex("by_site_source_policy_created", (q) =>
      q.eq("siteId", siteId)
        .eq("sourcePlanId", source!.job._id)
        .eq("policyVersion", CADENCE_MICRO_SEED_VERSION)
    )
    .order("asc")
    .take(3);
  if (sourceJobs.length > 2) {
    return { ready: false, reason: "micro_seed_source_history_exhausted" };
  }
  const currentJob = currentJobId
    ? sourceJobs.find((job) => job._id === currentJobId)
    : undefined;
  if (currentJobId && !currentJob) {
    return { ready: false, reason: "micro_seed_execution_receipt_unavailable" };
  }

  const anchors = cadenceMicroSeedAnchors(site);
  const primarySeed = selectCadenceMicroSeedAnchor(
    anchors,
    String(source.job._id),
    CADENCE_MICRO_SEED_VERSION - 1,
  );
  if (!primarySeed) {
    return { ready: false, reason: "tenant_product_seed_unavailable" };
  }
  let attemptKind: CadenceMicroSeedAttemptKind = "primary";
  let seed = primarySeed;
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
      const parentReservation = parent
        ? await ctx.db.get(parent.providerSpendReservationId)
        : null;
      const parentChildren = parent
        ? await ctx.db.query("cadence_micro_seed_jobs")
          .withIndex("by_site_parent", (q) =>
            q.eq("siteId", siteId).eq("parentMicroSeedJobId", parent._id)
          )
          .take(2)
        : [];
      if (
        !parent ||
        parent._id === currentJob._id ||
        parentChildren.length !== 1 ||
        parentChildren[0]?._id !== currentJob._id ||
        !validPrimaryFallbackReceipt({
          site,
          job: parent,
          reservation: parentReservation,
          sourcePlanId: source.job._id,
          sourcePlanReservationId: source.reservation._id,
          sourcePlanFingerprint: sourceFingerprint,
          primarySeed,
          locationCode,
          languageCode,
          timestamp,
        })
      ) {
        return { ready: false, reason: "micro_seed_fallback_parent_ineligible" };
      }
      if (!parentReservation) {
        return { ready: false, reason: "micro_seed_fallback_parent_ineligible" };
      }
      const parentFingerprint = primaryFallbackReceiptFingerprint(
        parent,
        parentReservation,
      );
      const fallbackSeed = selectCadenceMicroSeedFallbackAnchor(
        anchors,
        String(source.job._id),
        parent.seed,
        CADENCE_MICRO_SEED_VERSION - 1,
      );
      if (
        !fallbackSeed ||
        currentJob.parentMicroSeedReceiptFingerprint !== parentFingerprint
      ) {
        return { ready: false, reason: "micro_seed_fallback_parent_drifted" };
      }
      seed = fallbackSeed;
      parentMicroSeedJobId = parent._id;
      parentMicroSeedReceiptFingerprint = parentFingerprint;
    }
  } else if (sourceJobs.length === 1) {
    const parent = sourceJobs[0]!;
    const [parentReservation, parentChildren] = await Promise.all([
      ctx.db.get(parent.providerSpendReservationId),
      ctx.db.query("cadence_micro_seed_jobs")
        .withIndex("by_site_parent", (q) =>
          q.eq("siteId", siteId).eq("parentMicroSeedJobId", parent._id)
        )
        .take(1),
    ]);
    if (parentChildren.length > 0 || !validPrimaryFallbackReceipt({
      site,
      job: parent,
      reservation: parentReservation,
      sourcePlanId: source.job._id,
      sourcePlanReservationId: source.reservation._id,
      sourcePlanFingerprint: sourceFingerprint,
      primarySeed,
      locationCode,
      languageCode,
      timestamp,
    })) {
      return { ready: false, reason: "source_plan_already_recovered" };
    }
    if (!parentReservation) {
      return { ready: false, reason: "source_plan_already_recovered" };
    }
    const fallbackSeed = selectCadenceMicroSeedFallbackAnchor(
      anchors,
      String(source.job._id),
      parent.seed,
      CADENCE_MICRO_SEED_VERSION - 1,
    );
    if (!fallbackSeed) {
      return { ready: false, reason: "fallback_product_seed_unavailable" };
    }
    attemptKind = "fallback";
    seed = fallbackSeed;
    parentMicroSeedJobId = parent._id;
    parentMicroSeedReceiptFingerprint = primaryFallbackReceiptFingerprint(
      parent,
      parentReservation,
    );
  } else if (sourceJobs.length === 2) {
    // A child row is a permanent one-shot marker even if its free balance
    // preflight released the separate fallback reservation.
    return { ready: false, reason: "source_plan_fallback_already_attempted" };
  }

  if (currentJob && normalizeCadenceMicroSeedText(currentJob.seed) !== seed) {
    return { ready: false, reason: "micro_seed_anchor_drifted" };
  }
  const entitlement = await ctx.db.query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site.userId!))
    .unique();
  const plan = resolvePlanFromFeatures(
    entitlement?.planFeatures ?? site.planFeatures ?? [],
  );
  const ledgerRows = await ctx.db.query("provider_spend_reservations")
    .withIndex("by_created", (q) => q.gte("createdAt", utcMonthStart(timestamp)))
    .collect();
  const ledger = summarizeProviderReservationLedger(
    ledgerRows,
    site.userId,
    timestamp,
  );
  const providerCostCeilingMicroUsd =
    cadenceMicroSeedProviderCeilingMicroUsd(attemptKind);
  const evidenceHeadroomMicroUsd =
    EXPECTED_CLICK_EVIDENCE_BACKFILL_PROVIDER_CEILING_MICRO_USD;
  // Inspect the complete bounded continuation headroom. Discovery can retain
  // up to three strict candidates and each candidate owns a separate exact
  // live-SERP evidence receipt. Admission must therefore prove room for every
  // possible evidence attempt, rather than admitting a job that can be
  // deterministically stranded after its first semantic rejection. This
  // observes rather than locks evidence capacity, so a later cross-tenant race
  // remains an honest budget miss and never a fabricated SEO rejection.
  const combinedHeadroom =
    (currentJobId ? 0 : providerCostCeilingMicroUsd) +
    evidenceHeadroomMicroUsd * CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES;
  const accountCapacity = evaluateProviderAccountCapacity({
    accountReservedTodayMicroUsd: ledger.accountReservedTodayMicroUsd,
    accountReservedThisMonthMicroUsd: ledger.accountReservedThisMonthMicroUsd,
    requestedMicroUsd: combinedHeadroom,
    monthlyCeilingMicroUsd: providerAccountMonthlyCeilingMicroUsd(plan.tier),
  });
  if (!accountCapacity.allowed) return { ready: false, reason: accountCapacity.reason };
  const fleetCapacity = evaluateSharedProviderCapacity({
    fleetReservedTodayMicroUsd: ledger.fleetReservedTodayMicroUsd,
    fleetReservedThisMonthMicroUsd: ledger.fleetReservedThisMonthMicroUsd,
    requestedMicroUsd: combinedHeadroom,
  });
  if (!fleetCapacity.allowed) return { ready: false, reason: fleetCapacity.reason };

  const descriptor = {
    contract: "cadence-micro-seed-inspection-v2",
    siteId: String(site._id),
    userId: site.userId,
    reservationDay: utcDay(timestamp),
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    planTier: plan.tier,
    planFeatures: [...(entitlement?.planFeatures ?? site.planFeatures ?? [])].sort(),
    remainingArticles: siteGate.remainingArticles,
    authority,
    businessSignals,
    sourcePlanId: String(source.job._id),
    sourcePlanReservationId: String(source.reservation._id),
    sourcePlanFingerprint: sourceFingerprint,
    attemptKind,
    parentMicroSeedJobId: parentMicroSeedJobId
      ? String(parentMicroSeedJobId)
      : null,
    parentMicroSeedReceiptFingerprint:
      parentMicroSeedReceiptFingerprint ?? null,
    seed,
    locationCode,
    languageCode,
    nextCadenceDueAt,
    bufferCount: 0,
    schedulerTopicCount: 0,
    activeContentCount: 0,
    activeEvidenceCount: 0,
    providerCostCeilingMicroUsd,
    evidenceHeadroomMicroUsd,
    terminalNoMetricDemandReceiptFingerprint:
      terminalDemandNoMetricFingerprint ?? null,
  };
  return {
    ready: true,
    inspectionKey: JSON.stringify(descriptor),
    reservationDay: descriptor.reservationDay,
    rolloutEpoch: descriptor.rolloutEpoch,
    sourcePlanId: source.job._id,
    sourcePlanReservationId: source.reservation._id,
    sourcePlanFingerprint: sourceFingerprint,
    attemptKind,
    ...(parentMicroSeedJobId ? { parentMicroSeedJobId } : {}),
    ...(parentMicroSeedReceiptFingerprint
      ? { parentMicroSeedReceiptFingerprint }
      : {}),
    seed,
    locationCode,
    languageCode,
    planTier: plan.tier,
    nextCadenceDueAt,
    providerCostCeilingMicroUsd,
    evidenceHeadroomMicroUsd,
  };
}

export const inspectInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => inspectReadiness(ctx, siteId, Date.now()),
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
          jobSeed: sourceJob.seed,
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
    inspectionKey: v.string(),
    reservationDay: v.string(),
    rolloutEpoch: v.number(),
    sourcePlanId: v.id("jobs"),
    sourcePlanFingerprint: v.string(),
    attemptKind: v.union(v.literal("primary"), v.literal("fallback")),
    parentMicroSeedJobId: v.optional(v.id("cadence_micro_seed_jobs")),
    parentMicroSeedReceiptFingerprint: v.optional(v.string()),
    providerCostCeilingMicroUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const inspected = await inspectReadiness(ctx, args.siteId, Date.now());
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
      locationCode: inspected.locationCode,
      languageCode: inspected.languageCode,
      providerEndpoint: CADENCE_MICRO_SEED_DISCOVERY_ENDPOINT,
      providerResultLimit: CADENCE_MICRO_SEED_RESULT_LIMIT,
      includeSerpInfo: false,
      includeClickstreamData: false,
      providerCostCeilingMicroUsd: inspected.providerCostCeilingMicroUsd,
      providerCostReservedMicroUsd: inspected.providerCostCeilingMicroUsd,
      providerSpendReservationId: reservation.reservationId,
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
      job._id,
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
      sourcePlanFingerprint(
        sourcePlan,
        sourceReservation,
        sourceCheckpoints,
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
      seed: job.seed,
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
    const [topic, evidence, topics, articles, activeGroups] = await Promise.all([
      ctx.db.get(job.topicId!),
      ctx.db.get(job.evidenceJobId!),
      takeCurrentDomainTopics(ctx, site, CADENCE_MICRO_SEED_READ_LIMIT + 1),
      takeCurrentDomainArticles(ctx, site, CADENCE_MICRO_SEED_READ_LIMIT + 1),
      Promise.all(ACTIVE_CONTENT_STATUSES.map((status) =>
        ctx.db.query("jobs").withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status)
        ).take(CADENCE_MICRO_SEED_READ_LIMIT + 1)
      )),
    ]);
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
      topics.length > CADENCE_MICRO_SEED_READ_LIMIT ||
      articles.length > CADENCE_MICRO_SEED_READ_LIMIT ||
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

export const recordProviderReceiptAndMaterialize = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("cadence_micro_seed_jobs"),
    workerToken: v.string(),
    endpoint: v.string(),
    seed: v.string(),
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
    const inspected = await inspectReadiness(
      ctx,
      args.siteId,
      Date.now(),
      job._id,
    );
    if (
      !inspected.ready ||
      inspected.sourcePlanFingerprint !== job.sourcePlanFingerprint ||
      inspected.attemptKind !== cadenceMicroSeedAttemptKind(job.attemptKind) ||
      inspected.parentMicroSeedJobId !== job.parentMicroSeedJobId ||
      inspected.parentMicroSeedReceiptFingerprint !==
        job.parentMicroSeedReceiptFingerprint ||
      inspected.seed !== job.seed ||
      inspected.locationCode !== job.locationCode ||
      inspected.languageCode.trim().toLowerCase() !==
        job.languageCode.trim().toLowerCase()
    ) throw new Error("Cadence micro-seed materialization fence changed");
    const jobKind = cadenceMicroSeedAttemptKind(job.attemptKind);
    const jobReservation = await ctx.db.get(job.providerSpendReservationId);
    const providerCostCeilingMicroUsd = jobKind
      ? cadenceMicroSeedProviderCeilingMicroUsd(jobKind)
      : null;
    if (
      !site.userId ||
      !jobKind ||
      providerCostCeilingMicroUsd === null ||
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
      Math.ceil(args.providerTaskCostUsd * 1_000_000) >
        providerCostCeilingMicroUsd
    ) throw new Error("Cadence micro-seed paid reservation changed");

    const [topics, articles] = await Promise.all([
      takeCurrentDomainTopics(
        ctx,
        site,
        CADENCE_MICRO_SEED_READ_LIMIT + 1,
      ),
      takeCurrentDomainArticles(
        ctx,
        site,
        CADENCE_MICRO_SEED_READ_LIMIT + 1,
      ),
    ]);
    if (
      topics.length > CADENCE_MICRO_SEED_READ_LIMIT ||
      articles.length > CADENCE_MICRO_SEED_READ_LIMIT
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
    if (!measuredAuthorityIsFresh(authority, Date.now())) {
      throw new Error("Cadence micro-seed tenant authority expired");
    }
    const selection = selectCadenceMicroSeedCandidate({
      metrics: args.candidates as CadenceMicroSeedMetric[],
      seed: job.seed,
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
    const timestamp = Date.now();
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
    await ctx.db.patch(topic._id, {
      status: cannibalizing ? "cannibalizing" : "disqualified",
      disqualifiedReason: `cadence_micro_seed_${args.outcome}:${verifiedReason}`
        .slice(0, 240),
      updatedAt: timestamp,
    });
    const attemptedKeywords = new Set([
      normalizeCadenceMicroSeedText(job.selectedCandidate!.keyword),
      ...(job.priorCandidateAttempts ?? []).map((attempt) =>
        normalizeCadenceMicroSeedText(attempt.keyword)
      ),
    ]);
    const candidateAttemptCount = job.candidateAttemptCount ?? 1;
    const nextCandidate = args.outcome === "semantic_failure" &&
        candidateAttemptCount < CADENCE_MICRO_SEED_MAX_SERP_CANDIDATES
      ? (job.candidateShortlist ?? []).find((candidate) =>
          !attemptedKeywords.has(
            normalizeCadenceMicroSeedText(candidate.keyword),
          )
        )
      : undefined;
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
      providerCostCeilingMicroUsd: job.providerCostCeilingMicroUsd,
      providerSpendReservationId: job.providerSpendReservationId,
      providerCallAttempted: job.providerCallAttempted,
      providerCallCompleted: job.providerCallCompleted,
      providerTaskCostUsd: job.providerTaskCostUsd,
      candidatesReceived: job.candidateAudit?.received ?? 0,
      candidatesAccepted: job.candidateAudit?.accepted ?? 0,
      candidateAudit: job.candidateAudit,
      selectedKeyword: job.selectedCandidate?.keyword,
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
