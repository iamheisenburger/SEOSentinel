import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import {
  TOPIC_BUSINESS_FIT_VERSION,
  coveredIntentTopics,
  evaluateTopicBusinessFit,
  filterNonCannibalizingIntentTopics,
  keywordDifficultyCeiling,
  tenantTopicBusinessSignals,
} from "./lib/autopilotBuffer";
import { computeAuthorityKeywordDifficultyCeiling } from
  "./lib/authorityDifficulty";
import {
  DATAFORSEO_AUTHORITY_SOURCE,
  DATAFORSEO_DEMAND_SOURCE,
  EXPECTED_CLICK_PORTFOLIO_VERSION,
  estimateTopicExpectedClicks,
  measuredAuthorityIsFresh,
  tenantAuthorityFromStoredEvidence,
} from "./lib/expectedClickPortfolio";
import {
  EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
  hasCurrentExpectedClickDemand,
} from "./lib/expectedClickEvidenceBackfill";
import { jobAuthorizedForExecution } from "./lib/jobRollout";
import {
  PLAN_CANDIDATE_CHECKPOINT_LIMIT,
  PLAN_CANDIDATE_CHECKPOINT_STATUS,
  PLAN_CANDIDATE_CHECKPOINT_VERSION,
  inlinePlanSerpReceiptValid,
  planCheckpointCandidateFingerprint,
  planSeedBatchManifestHash,
  planSerpResultFingerprint,
  terminalCheckpointCandidateDecision,
  type PlanCheckpointCandidate,
} from "./lib/planCandidateCheckpoint";
import {
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  automaticSingleExecutionCheckpointTargetFromPayload,
} from "./lib/planProviderBudget";
import { siteExecutionAuthorized } from "./lib/planSiteAllowance";
import {
  evaluateSerpAttainability,
  evaluateSerpBusinessIntent,
} from "./lib/serpAttainability";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "./lib/dataForSeoLocale";
import { normalizeTopicIntentKeyword } from "./lib/topicLifecycle";

const INVENTORY_READ_LIMIT = 2_000;
const PLAN_LEASE_MS = 30 * 60 * 1000;

/** Rebuild the immutable candidate payload from the persisted topic and bind
 * it back to the exact checkpoint slot. Every path that treats checkpoint
 * inventory as accepted coverage shares this predicate so field or ordinal
 * drift can neither be activated nor poison a later execution's coverage. */
function exactCheckpointTopicBinding(args: {
  topic: Doc<"topic_clusters">;
  checkpoint: Doc<"plan_candidate_checkpoints">;
}): {
  candidate: PlanCheckpointCandidate;
  candidateFingerprint: string;
  index: number;
} | null {
  const { topic, checkpoint } = args;
  const index = checkpoint.candidateTopicIds.findIndex((topicId) =>
    topicId === topic._id
  );
  const storedCandidate = checkpointCandidateFromTopic(topic);
  const candidate = storedCandidate
    ? {
        ...storedCandidate,
        articleType: topic.planCheckpointCandidateArticleType,
      }
    : null;
  const ordinal = topic.planCheckpointCandidateOrdinal;
  const candidateFingerprint = candidate && Number.isInteger(ordinal)
    ? planCheckpointCandidateFingerprint({
        siteId: String(checkpoint.siteId),
        planJobId: String(checkpoint.planJobId),
        workerExecution: checkpoint.workerExecution,
        seedManifestHash: checkpoint.seedManifestHash,
        ordinal: ordinal!,
        candidate,
      })
    : null;
  if (
    index < 0 ||
    checkpoint.candidateTopicIds.length !==
      checkpoint.candidateFingerprints.length ||
    !candidate || !candidateFingerprint ||
    topic.siteId !== checkpoint.siteId ||
    topic.planCheckpointVersion !== PLAN_CANDIDATE_CHECKPOINT_VERSION ||
    topic.planCheckpointId !== checkpoint._id ||
    topic.planCheckpointJobId !== checkpoint.planJobId ||
    topic.planCheckpointWorkerExecution !== checkpoint.workerExecution ||
    topic.planCheckpointSeedManifestHash !== checkpoint.seedManifestHash ||
    topic.planCheckpointCandidateFingerprint !== candidateFingerprint ||
    checkpoint.candidateFingerprints[index] !== candidateFingerprint
  ) return null;
  return { candidate, candidateFingerprint, index };
}

function checkpointManifestMatchesJob(
  checkpoint: Doc<"plan_candidate_checkpoints">,
  site: Doc<"sites">,
  job: Doc<"jobs">,
  requiredVerifiedYield: number,
): boolean {
  return automaticSingleExecutionCheckpointTargetFromPayload(job.payload) !==
      null &&
    checkpoint.siteId === site._id &&
    checkpoint.userId === site.userId &&
    checkpoint.planJobId === job._id &&
    checkpoint.workerExecution === 1 &&
    checkpoint.policyVersion === PLAN_CANDIDATE_CHECKPOINT_VERSION &&
    checkpoint.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0) &&
    checkpoint.providerSpendReservationId === job.providerSpendReservationId &&
    checkpoint.providerCostCeilingMicroUsd === job.providerCostCeilingMicroUsd &&
    checkpoint.providerCostReservedMicroUsd ===
      job.providerCostReservedMicroUsd &&
    checkpoint.reservationDay === job.providerCostReservationDay &&
    checkpoint.requiredVerifiedYield === requiredVerifiedYield &&
    checkpoint.candidateTopicIds.length ===
      checkpoint.candidateFingerprints.length &&
    checkpoint.seedManifestHash === planSeedBatchManifestHash({
      siteId: String(checkpoint.siteId),
      planJobId: String(checkpoint.planJobId),
      workerExecution: checkpoint.workerExecution,
      replenishmentSequence: checkpoint.replenishmentSequence,
      locationCode: checkpoint.locationCode,
      languageCode: checkpoint.languageCode,
      candidateCapacity: checkpoint.candidateCapacity,
      seedBatches: checkpoint.seedBatches,
    });
}

function exactCheckpointTopicCoverage(args: {
  topic: Doc<"topic_clusters">;
  checkpoint: Doc<"plan_candidate_checkpoints">;
  timestamp: number;
}): { primaryKeyword: string; serpTopUrls?: string[] } | null {
  const { topic, checkpoint, timestamp } = args;
  const binding = exactCheckpointTopicBinding({ topic, checkpoint });
  if (
    !binding ||
    topic.planCheckpointTerminalFailureCode
  ) return null;
  const receiptValid = inlinePlanSerpReceiptValid({
    receipt: topic.planCheckpointSerpReceipt,
    candidateFingerprint: binding.candidateFingerprint,
    seedManifestHash: checkpoint.seedManifestHash,
    workerExecution: checkpoint.workerExecution,
    locationCode: checkpoint.locationCode,
    languageCode: checkpoint.languageCode,
    attemptedAt: topic.planCheckpointSerpAttemptedAt,
    now: timestamp,
  });
  const recordedAccepted = (checkpoint.inlineCompletedTopicIds ?? []).some(
    (topicId) => topicId === topic._id,
  ) || (checkpoint.activatedTopicIds ?? []).some((topicId) =>
    topicId === topic._id
  );
  if (!receiptValid && !recordedAccepted) return null;
  return {
    primaryKeyword: topic.primaryKeyword,
    serpTopUrls: receiptValid
      ? topic.planCheckpointSerpReceipt!.results.map((result) => result.url)
      : undefined,
  };
}

const candidateValidator = v.object({
  label: v.string(),
  primaryKeyword: v.string(),
  secondaryKeywords: v.array(v.string()),
  intent: v.optional(v.string()),
  priority: v.optional(v.number()),
  articleType: v.optional(v.string()),
  notes: v.optional(v.string()),
  searchVolume: v.number(),
  keywordDifficulty: v.number(),
  keywordDifficultyMeasured: v.literal(true),
  cpc: v.optional(v.number()),
  serpIntent: v.optional(v.string()),
  volumeTrend: v.optional(v.array(v.number())),
  searchDemandSource: v.string(),
  searchDemandMeasuredAt: v.number(),
  searchDemandLocationCode: v.number(),
  searchDemandLanguageCode: v.string(),
  businessFitEligible: v.literal(true),
  businessFitScore: v.number(),
  businessFitVersion: v.number(),
  businessFitReasons: v.array(v.string()),
});

function currentWorker(
  job: Doc<"jobs"> | null,
  siteId: Id<"sites">,
  workerToken: string,
  workerExecution: number,
  timestamp: number,
): job is Doc<"jobs"> {
  return Boolean(
    job &&
    job.siteId === siteId &&
    job.type === "plan" &&
    job.status === "running" &&
    job.workerToken === workerToken &&
    (job.leaseExpiresAt ?? 0) > timestamp &&
    (job.workerAttempts ?? 0) + 1 === workerExecution,
  );
}

async function exactReservation(
  ctx: MutationCtx,
  site: Doc<"sites">,
  job: Doc<"jobs">,
) {
  const reservation = job.providerSpendReservationId
    ? await ctx.db.get(job.providerSpendReservationId)
    : null;
  return Boolean(
    reservation &&
    reservation.siteId === site._id &&
    reservation.userId === site.userId &&
    reservation.purpose === "topic_plan" &&
    reservation.trigger === "topic_plan" &&
    reservation.reservedMicroUsd ===
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
    reservation.reservationDay === job.providerCostReservationDay &&
    reservation.createdAt === job.createdAt &&
    reservation.releasedAt === undefined &&
    job.providerCostCeilingMicroUsd ===
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
    job.providerCostReservedMicroUsd ===
      AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
    job.providerReservationReleasedAt === undefined
  );
}

function authorityForSite(site: Doc<"sites">, timestamp: number) {
  const authority = tenantAuthorityFromStoredEvidence({
    domain: site.seoAuthorityDomain,
    currentDomain: site.domain,
    domainRank: site.seoAuthorityDomainRank,
    referringDomains: site.seoAuthorityReferringDomains,
    source: site.seoAuthoritySource,
    measuredAt: site.seoAuthorityMeasuredAt,
  });
  return measuredAuthorityIsFresh(authority, timestamp) ? authority : null;
}

function normalizedEvidenceHost(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function candidateValid(
  site: Doc<"sites">,
  candidate: PlanCheckpointCandidate,
  maxKd: number,
  timestamp: number,
): boolean {
  const fit = evaluateTopicBusinessFit({
    keyword: candidate.primaryKeyword,
    label: candidate.label,
    ...tenantTopicBusinessSignals(site),
  });
  return Boolean(
    normalizeTopicIntentKeyword(candidate.primaryKeyword) &&
    candidate.keywordDifficultyMeasured === true &&
    Number.isFinite(candidate.keywordDifficulty) &&
    candidate.keywordDifficulty >= 0 &&
    candidate.keywordDifficulty <=
      keywordDifficultyCeiling(maxKd, candidate.searchVolume) &&
    Number.isFinite(candidate.searchVolume) &&
    candidate.searchVolume > 0 &&
    hasCurrentExpectedClickDemand({
      evidence: candidate,
      locationCode: dataForSeoLocationCode(site.targetCountry),
      languageCode: dataForSeoLanguageCode(site.language),
      now: timestamp,
    }) &&
    candidate.searchDemandSource === DATAFORSEO_DEMAND_SOURCE &&
    fit.eligible &&
    fit.version === TOPIC_BUSINESS_FIT_VERSION &&
    candidate.businessFitEligible === true &&
    candidate.businessFitVersion === fit.version &&
    candidate.businessFitScore === fit.score &&
    JSON.stringify(candidate.businessFitReasons) === JSON.stringify(fit.reasons)
  );
}

function checkpointCandidateFromTopic(
  topic: Doc<"topic_clusters">,
): PlanCheckpointCandidate | null {
  if (
    !Number.isFinite(topic.searchVolume) ||
    !Number.isFinite(topic.keywordDifficulty) ||
    topic.keywordDifficultyMeasured !== true ||
    !topic.searchDemandSource ||
    !Number.isFinite(topic.searchDemandMeasuredAt) ||
    !Number.isInteger(topic.searchDemandLocationCode) ||
    !topic.searchDemandLanguageCode ||
    topic.businessFitEligible !== true ||
    !Number.isFinite(topic.businessFitScore) ||
    !Number.isFinite(topic.businessFitVersion)
  ) return null;
  return {
    label: topic.label,
    primaryKeyword: topic.primaryKeyword,
    secondaryKeywords: topic.secondaryKeywords ?? [],
    intent: topic.intent,
    priority: topic.priority,
    articleType: topic.articleType,
    notes: topic.notes,
    searchVolume: topic.searchVolume!,
    keywordDifficulty: topic.keywordDifficulty!,
    keywordDifficultyMeasured: true,
    cpc: topic.cpc,
    serpIntent: topic.serpIntent,
    volumeTrend: topic.volumeTrend,
    searchDemandSource: topic.searchDemandSource,
    searchDemandMeasuredAt: topic.searchDemandMeasuredAt!,
    searchDemandLocationCode: topic.searchDemandLocationCode!,
    searchDemandLanguageCode: topic.searchDemandLanguageCode,
    businessFitEligible: true,
    businessFitScore: topic.businessFitScore!,
    businessFitVersion: topic.businessFitVersion!,
    businessFitReasons: topic.businessFitReasons ?? [],
  };
}

export const stage = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    workerExecution: v.number(),
    replenishmentSequence: v.number(),
    locationCode: v.number(),
    languageCode: v.string(),
    candidateCapacity: v.number(),
    seedBatches: v.array(v.array(v.string())),
    seedManifestHash: v.string(),
    candidates: v.array(candidateValidator),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const [site, job, existingCheckpoint, jobCheckpoints] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
      ctx.db.query("plan_candidate_checkpoints")
        .withIndex("by_plan_execution", (q) =>
          q.eq("planJobId", args.jobId)
            .eq("workerExecution", args.workerExecution))
        .unique(),
      ctx.db.query("plan_candidate_checkpoints")
        .withIndex("by_plan_job", (q) => q.eq("planJobId", args.jobId))
        .collect(),
    ]);
    if (
      !site?.userId ||
      site.deletionStatus ||
      site.expectedClickSchedulingEnabled !== true ||
      args.workerExecution !== 1 ||
      (job?.workerAttempts ?? -1) !== 0 ||
      !currentWorker(
        job,
        args.siteId,
        args.workerToken,
        args.workerExecution,
        timestamp,
      ) ||
      !jobAuthorizedForExecution(site, job) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !(await exactReservation(ctx, site, job))
    ) throw new Error("Plan checkpoint tenant, lease, or spend fence changed");
    const target = automaticSingleExecutionCheckpointTargetFromPayload(
      job.payload,
    );
    if (!target) throw new Error("Plan checkpoint target is unavailable");
    if (
      jobCheckpoints.some((candidate) =>
        !existingCheckpoint || candidate._id !== existingCheckpoint._id)
    ) {
      throw new Error("Single-execution plan already has a checkpoint");
    }
    if (
      !Number.isInteger(args.candidateCapacity) ||
      args.candidateCapacity < 1 ||
      args.candidateCapacity > target.requiredVerifiedYield ||
      args.candidates.length > args.candidateCapacity ||
      args.candidates.length > PLAN_CANDIDATE_CHECKPOINT_LIMIT ||
      args.locationCode !== dataForSeoLocationCode(site.targetCountry) ||
      args.languageCode.trim().toLowerCase() !==
        dataForSeoLanguageCode(site.language).trim().toLowerCase()
    ) throw new Error("Plan checkpoint candidate envelope is invalid");
    const expectedManifestHash = planSeedBatchManifestHash({
      siteId: String(args.siteId),
      planJobId: String(args.jobId),
      workerExecution: args.workerExecution,
      replenishmentSequence: args.replenishmentSequence,
      locationCode: args.locationCode,
      languageCode: args.languageCode,
      candidateCapacity: args.candidateCapacity,
      seedBatches: args.seedBatches,
    });
    if (args.seedManifestHash !== expectedManifestHash) {
      throw new Error("Plan checkpoint seed manifest is incompatible");
    }
    if (existingCheckpoint) {
      const exactReplay = existingCheckpoint.siteId === args.siteId &&
        existingCheckpoint.userId === site.userId &&
        existingCheckpoint.planJobId === args.jobId &&
        existingCheckpoint.workerExecution === args.workerExecution &&
        existingCheckpoint.status === "active" &&
        existingCheckpoint.policyVersion ===
          PLAN_CANDIDATE_CHECKPOINT_VERSION &&
        existingCheckpoint.rolloutEpoch === (site.autopilotRolloutEpoch ?? 0) &&
        existingCheckpoint.providerSpendReservationId ===
          job.providerSpendReservationId &&
        existingCheckpoint.providerCostCeilingMicroUsd ===
          job.providerCostCeilingMicroUsd &&
        existingCheckpoint.providerCostReservedMicroUsd ===
          job.providerCostReservedMicroUsd &&
        existingCheckpoint.reservationDay === job.providerCostReservationDay &&
        existingCheckpoint.requiredVerifiedYield ===
          target.requiredVerifiedYield &&
        existingCheckpoint.replenishmentSequence ===
          args.replenishmentSequence &&
        existingCheckpoint.locationCode === args.locationCode &&
        existingCheckpoint.languageCode === args.languageCode &&
        existingCheckpoint.seedManifestHash === args.seedManifestHash &&
        existingCheckpoint.candidateCapacity === args.candidateCapacity &&
        JSON.stringify(existingCheckpoint.seedBatches) ===
          JSON.stringify(args.seedBatches);
      if (
        !exactReplay ||
        existingCheckpoint.candidateTopicIds.length !==
          existingCheckpoint.candidateFingerprints.length
      ) throw new Error("Plan checkpoint execution replay drifted");
      const replayTopics = await Promise.all(
        existingCheckpoint.candidateTopicIds.map((topicId) =>
          ctx.db.get(topicId)),
      );
      for (let index = 0; index < replayTopics.length; index++) {
        const topic = replayTopics[index];
        const ordinal = topic?.planCheckpointCandidateOrdinal;
        const candidate = Number.isInteger(ordinal)
          ? args.candidates[ordinal as number]
          : undefined;
        const expectedFingerprint = candidate
          ? planCheckpointCandidateFingerprint({
              siteId: String(args.siteId),
              planJobId: String(args.jobId),
              workerExecution: args.workerExecution,
              seedManifestHash: args.seedManifestHash,
              ordinal: ordinal as number,
              candidate,
            })
          : null;
        if (
          !topic ||
          topic.siteId !== args.siteId ||
          topic.planCheckpointId !== existingCheckpoint._id ||
          expectedFingerprint !== existingCheckpoint.candidateFingerprints[index] ||
          topic.planCheckpointCandidateFingerprint !== expectedFingerprint
        ) throw new Error("Plan checkpoint candidate replay drifted");
      }
      return {
        checkpointId: existingCheckpoint._id,
        staged: existingCheckpoint.candidateTopicIds.map((topicId, index) => ({
          topicId,
          candidateFingerprint:
            existingCheckpoint.candidateFingerprints[index],
          candidateOrdinal:
            replayTopics[index]?.planCheckpointCandidateOrdinal ?? index,
        })),
        active: true,
        replay: true,
      };
    }
    const remainingVerifiedYield = target.requiredVerifiedYield;
    if (args.candidateCapacity > remainingVerifiedYield) {
      throw new Error("Plan checkpoint cumulative target is exhausted");
    }
    const authority = authorityForSite(site, timestamp);
    if (!authority) throw new Error("Plan checkpoint tenant authority is stale");
    const maxKd = computeAuthorityKeywordDifficultyCeiling({
      domainRank: authority.domainRank,
      referringDomains: authority.referringDomains ?? 0,
    });
    const existingTopics = await ctx.db.query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .take(INVENTORY_READ_LIMIT + 1);
    if (existingTopics.length > INVENTORY_READ_LIMIT) {
      throw new Error("Plan checkpoint topic read limit exhausted");
    }
    const exactExisting = new Set(existingTopics.map((topic) =>
      normalizeTopicIntentKeyword(topic.primaryKeyword)));
    const seen = new Set<string>();
    const accepted = args.candidates.flatMap((candidate, ordinal) => {
      const keyword = normalizeTopicIntentKeyword(candidate.primaryKeyword);
      if (
        seen.has(keyword) ||
        exactExisting.has(keyword) ||
        !candidateValid(site, candidate, maxKd, timestamp)
      ) return [];
      seen.add(keyword);
      return [{ candidate, ordinal }];
    });
    const checkpointId = await ctx.db.insert("plan_candidate_checkpoints", {
      siteId: args.siteId,
      userId: site.userId,
      planJobId: args.jobId,
      workerExecution: args.workerExecution,
      status: accepted.length > 0 ? "active" : "empty",
      policyVersion: PLAN_CANDIDATE_CHECKPOINT_VERSION,
      rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
      providerSpendReservationId: job.providerSpendReservationId!,
      providerCostCeilingMicroUsd: job.providerCostCeilingMicroUsd!,
      providerCostReservedMicroUsd: job.providerCostReservedMicroUsd!,
      reservationDay: job.providerCostReservationDay!,
      requiredVerifiedYield: target.requiredVerifiedYield,
      replenishmentSequence: args.replenishmentSequence,
      locationCode: args.locationCode,
      languageCode: args.languageCode,
      candidateCapacity: args.candidateCapacity,
      seedBatches: args.seedBatches,
      seedManifestHash: args.seedManifestHash,
      candidateTopicIds: [],
      candidateFingerprints: [],
      ...(accepted.length === 0 ? { completedAt: timestamp } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const staged: Array<{
      topicId: Id<"topic_clusters">;
      candidateFingerprint: string;
      candidateOrdinal: number;
    }> = [];
    for (const { candidate, ordinal } of accepted) {
      const candidateFingerprint = planCheckpointCandidateFingerprint({
        siteId: String(args.siteId),
        planJobId: String(args.jobId),
        workerExecution: args.workerExecution,
        seedManifestHash: args.seedManifestHash,
        ordinal,
        candidate,
      });
      const topicId = await ctx.db.insert("topic_clusters", {
        siteId: args.siteId,
        label: candidate.label,
        primaryKeyword: candidate.primaryKeyword,
        secondaryKeywords: candidate.secondaryKeywords,
        intent: candidate.intent,
        priority: candidate.priority,
        articleType: candidate.articleType,
        status: PLAN_CANDIDATE_CHECKPOINT_STATUS,
        notes: candidate.notes,
        searchVolume: candidate.searchVolume,
        keywordDifficulty: candidate.keywordDifficulty,
        keywordDifficultyMeasured: true,
        cpc: candidate.cpc,
        serpIntent: candidate.serpIntent,
        volumeTrend: candidate.volumeTrend,
        searchDemandSource: candidate.searchDemandSource,
        searchDemandMeasuredAt: candidate.searchDemandMeasuredAt,
        searchDemandLocationCode: candidate.searchDemandLocationCode,
        searchDemandLanguageCode: candidate.searchDemandLanguageCode,
        businessFitEligible: true,
        businessFitScore: candidate.businessFitScore,
        businessFitVersion: candidate.businessFitVersion,
        businessFitReasons: candidate.businessFitReasons,
        businessFitCheckedAt: timestamp,
        planCheckpointVersion: PLAN_CANDIDATE_CHECKPOINT_VERSION,
        planCheckpointId: checkpointId,
        planCheckpointJobId: args.jobId,
        planCheckpointWorkerExecution: args.workerExecution,
        planCheckpointSeedManifestHash: args.seedManifestHash,
        planCheckpointCandidateFingerprint: candidateFingerprint,
        planCheckpointCandidateOrdinal: ordinal,
        ...(candidate.articleType !== undefined
          ? { planCheckpointCandidateArticleType: candidate.articleType }
          : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      staged.push({ topicId, candidateFingerprint, candidateOrdinal: ordinal });
    }
    await ctx.db.patch(checkpointId, {
      candidateTopicIds: staged.map((item) => item.topicId),
      candidateFingerprints: staged.map((item) =>
        item.candidateFingerprint),
      updatedAt: timestamp,
    });
    await ctx.db.patch(args.jobId, {
      heartbeatAt: timestamp,
      leaseExpiresAt: timestamp + PLAN_LEASE_MS,
      updatedAt: timestamp,
    });
    return {
      checkpointId,
      staged,
      active: staged.length > 0,
      replay: false,
    };
  },
});

/** Authorize the narrowed checkpoint rollout before any provider boundary.
 * Legacy canary-off plans retain their existing retry/continuation contract;
 * checkpoint-mode plans deliberately admit only execution one until a unified
 * multi-execution settlement reducer is separately rolled out. */
export const authorizeSingleExecution = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    workerExecution: v.number(),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    if (
      !site?.userId || site.deletionStatus ||
      !currentWorker(
        job,
        args.siteId,
        args.workerToken,
        args.workerExecution,
        timestamp,
      ) ||
      !jobAuthorizedForExecution(site, job) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !(await exactReservation(ctx, site, job))
    ) throw new Error("Plan checkpoint resume fence changed");
    const target = automaticSingleExecutionCheckpointTargetFromPayload(
      job.payload,
    );
    if (!target) throw new Error("Plan checkpoint target is unavailable");
    if (site.expectedClickSchedulingEnabled !== true) {
      throw new Error("Plan checkpoint canary authorization changed");
    }
    if (args.workerExecution !== 1 || (job.workerAttempts ?? 0) !== 0) {
      throw new Error(
        "Checkpoint planning is limited to one paid execution; refusing " +
        "retry or continuation provider work.",
      );
    }
    return {
      checkpointEnabled: true as const,
      workerExecution: 1 as const,
    };
  },
});

async function exactCandidate(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    jobId: Id<"jobs">;
    workerToken: string;
    workerExecution: number;
    checkpointId: Id<"plan_candidate_checkpoints">;
    topicId: Id<"topic_clusters">;
    candidateFingerprint: string;
  },
) {
  const timestamp = Date.now();
  const [site, job, checkpoint, topic] = await Promise.all([
    ctx.db.get(args.siteId),
    ctx.db.get(args.jobId),
    ctx.db.get(args.checkpointId),
    ctx.db.get(args.topicId),
  ]);
  const binding = topic && checkpoint
    ? exactCheckpointTopicBinding({ topic, checkpoint })
    : null;
  const target = job
    ? automaticSingleExecutionCheckpointTargetFromPayload(job.payload)
    : null;
  if (
    !site?.userId || site.deletionStatus ||
    site.expectedClickSchedulingEnabled !== true ||
    !job || !checkpoint || !topic || !target ||
    !binding || binding.candidateFingerprint !== args.candidateFingerprint ||
    checkpoint.status !== "active" ||
    checkpoint.siteId !== args.siteId ||
    checkpoint.userId !== site.userId ||
    checkpoint.planJobId !== args.jobId ||
    args.workerExecution !== 1 || checkpoint.workerExecution !== 1 ||
    !checkpointManifestMatchesJob(
      checkpoint,
      site,
      job,
      target.requiredVerifiedYield,
    ) ||
    topic.siteId !== args.siteId ||
    topic.planCheckpointId !== args.checkpointId ||
    topic.planCheckpointJobId !== args.jobId ||
    topic.planCheckpointWorkerExecution !== args.workerExecution ||
    topic.planCheckpointCandidateFingerprint !== args.candidateFingerprint ||
    topic.planCheckpointSeedManifestHash !== checkpoint.seedManifestHash ||
    !currentWorker(
      job,
      args.siteId,
      args.workerToken,
      args.workerExecution,
      timestamp,
    ) ||
    !jobAuthorizedForExecution(site, job) ||
    !(await siteExecutionAuthorized(ctx, site)) ||
    !(await exactReservation(ctx, site, job))
  ) throw new Error("Plan checkpoint candidate fence changed");
  return { site, job, checkpoint, topic, timestamp };
}

export const beginInlineSerp = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    workerExecution: v.number(),
    checkpointId: v.id("plan_candidate_checkpoints"),
    topicId: v.id("topic_clusters"),
    candidateFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const current = await exactCandidate(ctx, args);
    if (
      current.topic.status !== PLAN_CANDIDATE_CHECKPOINT_STATUS ||
      current.topic.planCheckpointSerpAttemptedAt !== undefined ||
      current.topic.planCheckpointSerpReceipt !== undefined ||
      current.topic.planCheckpointTerminalFailureCode !== undefined
    ) return { allowed: false as const, reason: "already_attempted" as const };
    await Promise.all([
      ctx.db.patch(args.topicId, {
        planCheckpointSerpAttemptedAt: current.timestamp,
        updatedAt: current.timestamp,
      }),
      ctx.db.patch(args.jobId, {
        heartbeatAt: current.timestamp,
        leaseExpiresAt: current.timestamp + PLAN_LEASE_MS,
        updatedAt: current.timestamp,
      }),
    ]);
    return { allowed: true as const, attemptedAt: current.timestamp };
  },
});

async function terminallyExcludeCandidate(
  ctx: MutationCtx,
  topic: Doc<"topic_clusters">,
  code: string,
  timestamp: number,
) {
  await ctx.db.patch(topic._id, {
    status: "disqualified",
    disqualifiedReason: code,
    planCheckpointTerminalFailureCode: code,
    updatedAt: timestamp,
  });
}

export const recordInlineSerpFailure = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    workerExecution: v.number(),
    checkpointId: v.id("plan_candidate_checkpoints"),
    topicId: v.id("topic_clusters"),
    candidateFingerprint: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args) => {
    const current = await exactCandidate(ctx, args);
    if (!current.topic.planCheckpointSerpAttemptedAt) {
      throw new Error("Plan checkpoint SERP failure has no begun attempt");
    }
    if (
      current.topic.planCheckpointSerpReceipt ||
      current.topic.planCheckpointTerminalFailureCode
    ) return { recorded: false };
    await terminallyExcludeCandidate(
      ctx,
      current.topic,
      `plan_checkpoint_serp_${args.code}`,
      current.timestamp,
    );
    return { recorded: true };
  },
});

export const recordInlineSerp = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    workerExecution: v.number(),
    checkpointId: v.id("plan_candidate_checkpoints"),
    topicId: v.id("topic_clusters"),
    candidateFingerprint: v.string(),
    observedAt: v.number(),
    locationCode: v.number(),
    languageCode: v.string(),
    results: v.array(v.object({ position: v.number(), url: v.string() })),
    intentResults: v.array(v.object({
      position: v.number(),
      url: v.string(),
      title: v.string(),
      description: v.string(),
    })),
    recommendedArticleType: v.string(),
    paaQuestions: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const current = await exactCandidate(ctx, args);
    const attemptedAt = current.topic.planCheckpointSerpAttemptedAt;
    if (!attemptedAt) {
      throw new Error("Plan checkpoint SERP receipt has no begun attempt");
    }
    if (current.topic.planCheckpointSerpReceipt) return { recorded: false };
    if (current.topic.planCheckpointTerminalFailureCode) {
      return { recorded: false, rejected: true };
    }
    const results = args.results.slice().sort((a, b) => a.position - b.position);
    const normalizedUrlFingerprint = planSerpResultFingerprint(results);
    const exactIntentReceipt = JSON.stringify(
      args.intentResults.map(({ position, url }) => ({ position, url })),
    ) === JSON.stringify(results);
    const authority = authorityForSite(current.site, current.timestamp);
    const fit = evaluateTopicBusinessFit({
      keyword: current.topic.primaryKeyword,
      label: current.topic.label,
      ...tenantTopicBusinessSignals(current.site),
    });
    const intent = exactIntentReceipt
      ? evaluateSerpBusinessIntent({
          results: args.intentResults,
          businessModelSignals:
            tenantTopicBusinessSignals(current.site).businessModelSignals,
        })
      : { aligned: false, reasons: ["serp_intent_receipt_mismatch"] };
    const attainable = evaluateSerpAttainability({
      serpTopUrls: results.map((result) => result.url),
      siteHost: current.site.domain,
    });
    const [topics, articles, planCheckpoints] = await Promise.all([
      ctx.db.query("topic_clusters")
        .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
        .take(INVENTORY_READ_LIMIT + 1),
      ctx.db.query("articles")
        .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
        .take(INVENTORY_READ_LIMIT + 1),
      ctx.db.query("plan_candidate_checkpoints")
        .withIndex("by_plan_job", (q) => q.eq("planJobId", args.jobId))
        .collect(),
    ]);
    if (
      topics.length > INVENTORY_READ_LIMIT ||
      articles.length > INVENTORY_READ_LIMIT
    ) throw new Error("Plan checkpoint SERP coverage read limit exhausted");
    const covered = coveredIntentTopics(
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
    const target = automaticSingleExecutionCheckpointTargetFromPayload(
      current.job.payload,
    );
    if (!target) throw new Error("Plan checkpoint target is unavailable");
    const checkpointById = new Map(planCheckpoints
      .filter((checkpoint) => checkpointManifestMatchesJob(
        checkpoint,
        current.site,
        current.job,
        target.requiredVerifiedYield,
      ))
      .map((checkpoint) => [String(checkpoint._id), checkpoint]));
    const priorCheckpointCoverage = topics.flatMap((topic) => {
      if (topic._id === args.topicId || !topic.planCheckpointId) return [];
      const checkpoint = checkpointById.get(String(topic.planCheckpointId));
      const coverage = checkpoint
        ? exactCheckpointTopicCoverage({
            topic,
            checkpoint,
            timestamp: current.timestamp,
          })
        : null;
      return coverage ? [coverage] : [];
    });
    const cannibalizationClear = filterNonCannibalizingIntentTopics(
      [{
        primaryKeyword: current.topic.primaryKeyword,
        serpTopUrls: results.map((result) => result.url),
      }],
      [...covered, ...priorCheckpointCoverage],
      0.4,
      0.35,
      1,
    ).length === 1;
    const maxKd = authority
      ? computeAuthorityKeywordDifficultyCeiling({
          domainRank: authority.domainRank,
          referringDomains: authority.referringDomains ?? 0,
        })
      : -1;
    const semanticFailure = !authority
      ? "tenant_authority_stale"
      : args.locationCode !== dataForSeoLocationCode(current.site.targetCountry) ||
          args.languageCode.trim().toLowerCase() !==
            dataForSeoLanguageCode(current.site.language).trim().toLowerCase()
        ? "locale_mismatch"
        : !Number.isFinite(args.observedAt) || args.observedAt < attemptedAt ||
            args.observedAt > current.timestamp + 5 * 60 * 1000 ||
            results.length < 5 || !normalizedUrlFingerprint
          ? "receipt_invalid"
          : !fit.eligible || fit.version !== TOPIC_BUSINESS_FIT_VERSION ||
              current.topic.businessFitVersion !== fit.version ||
              current.topic.businessFitScore !== fit.score ||
              JSON.stringify(current.topic.businessFitReasons ?? []) !==
                JSON.stringify(fit.reasons)
            ? "business_fit_drifted"
            : (current.topic.keywordDifficulty ?? Infinity) >
                keywordDifficultyCeiling(
                  maxKd,
                  current.topic.searchVolume ?? 0,
                )
              ? "authority_ceiling_drifted"
              : !intent.aligned
                ? "business_intent_mismatch"
                : !attainable.attainable
                  ? "unattainable"
                  : !cannibalizationClear
                    ? "cannibalization_conflict"
                    : null;
    if (semanticFailure) {
      await terminallyExcludeCandidate(
        ctx,
        current.topic,
        `plan_checkpoint_serp_${semanticFailure}`,
        current.timestamp,
      );
      return { recorded: false, rejected: true, reason: semanticFailure };
    }
    const receipt = {
      version: PLAN_CANDIDATE_CHECKPOINT_VERSION,
      candidateFingerprint: args.candidateFingerprint,
      seedManifestHash: current.checkpoint.seedManifestHash,
      workerExecution: args.workerExecution,
      normalizedUrlFingerprint: normalizedUrlFingerprint!,
      observedAt: args.observedAt,
      locationCode: args.locationCode,
      languageCode: args.languageCode,
      results,
      businessIntentAligned: true as const,
      attainable: true as const,
      cannibalizationClear: true as const,
    };
    if (!inlinePlanSerpReceiptValid({
      receipt,
      candidateFingerprint: args.candidateFingerprint,
      seedManifestHash: current.checkpoint.seedManifestHash,
      workerExecution: args.workerExecution,
      locationCode: args.locationCode,
      languageCode: args.languageCode,
      attemptedAt,
      now: current.timestamp,
    })) throw new Error("Plan checkpoint SERP receipt failed exact validation");
    await ctx.db.patch(args.topicId, {
      recommendedArticleType: args.recommendedArticleType,
      paaQuestions: args.paaQuestions.length > 0
        ? args.paaQuestions.slice(0, 20)
        : undefined,
      serpTopUrls: results.map((result) => result.url),
      serpObservedAt: args.observedAt,
      serpLocationCode: args.locationCode,
      serpLanguageCode: args.languageCode,
      planCheckpointSerpReceipt: receipt,
      updatedAt: current.timestamp,
    });
    await ctx.db.patch(args.jobId, {
      heartbeatAt: current.timestamp,
      leaseExpiresAt: current.timestamp + PLAN_LEASE_MS,
      updatedAt: current.timestamp,
    });
    return { recorded: true };
  },
});

const completionValidator = v.object({
  topicId: v.id("topic_clusters"),
  candidateFingerprint: v.string(),
  serpAuthorityCompetitors: v.array(v.object({
    position: v.number(),
    url: v.string(),
    domain: v.string(),
    domainRank: v.number(),
    referringDomains: v.optional(v.number()),
    source: v.string(),
    measuredAt: v.number(),
  })),
  expectedClicksMonthly: v.number(),
  expectedClickProjectedPosition: v.optional(v.number()),
  expectedClickRankProbability: v.number(),
  expectedClickReasons: v.array(v.string()),
});

export const completeInline = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    workerExecution: v.number(),
    checkpointId: v.id("plan_candidate_checkpoints"),
    eligible: v.array(completionValidator),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const [
      site,
      job,
      checkpoint,
      jobCheckpoints,
      currentTopics,
      currentArticles,
    ] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
      ctx.db.get(args.checkpointId),
      ctx.db.query("plan_candidate_checkpoints")
        .withIndex("by_plan_job", (q) => q.eq("planJobId", args.jobId))
        .collect(),
      ctx.db.query("topic_clusters")
        .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
        .take(INVENTORY_READ_LIMIT + 1),
      ctx.db.query("articles")
        .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
        .take(INVENTORY_READ_LIMIT + 1),
    ]);
    const target = job
      ? automaticSingleExecutionCheckpointTargetFromPayload(job.payload)
      : null;
    if (
      !site?.userId || site.deletionStatus ||
      site.expectedClickSchedulingEnabled !== true ||
      !job || !checkpoint || !target ||
      jobCheckpoints.length !== 1 ||
      jobCheckpoints[0]?._id !== checkpoint._id ||
      checkpoint.status !== "active" ||
      args.workerExecution !== 1 || checkpoint.workerExecution !== 1 ||
      !checkpointManifestMatchesJob(
        checkpoint,
        site,
        job,
        target.requiredVerifiedYield,
      ) ||
      !currentWorker(
        job,
        args.siteId,
        args.workerToken,
        args.workerExecution,
        timestamp,
      ) ||
      !jobAuthorizedForExecution(site, job) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !(await exactReservation(ctx, site, job))
    ) throw new Error("Plan checkpoint inline completion fence changed");
    if (
      currentTopics.length > INVENTORY_READ_LIMIT ||
      currentArticles.length > INVENTORY_READ_LIMIT
    ) throw new Error("Plan checkpoint completion coverage read limit exhausted");
    const remainingVerifiedYield = target.requiredVerifiedYield;
    const checkpointIds = new Set(checkpoint.candidateTopicIds.map(String));
    const eligibleIds = args.eligible.map((item) => String(item.topicId));
    if (
      args.eligible.length > checkpoint.candidateCapacity ||
      args.eligible.length > remainingVerifiedYield ||
      new Set(eligibleIds).size !== eligibleIds.length ||
      eligibleIds.some((topicId) => !checkpointIds.has(topicId))
    ) throw new Error("Plan checkpoint inline result envelope drifted");
    const authority = authorityForSite(site, timestamp);
    if (!authority) throw new Error("Plan checkpoint authority expired");
    const maxKd = computeAuthorityKeywordDifficultyCeiling({
      domainRank: authority.domainRank,
      referringDomains: authority.referringDomains ?? 0,
    });
    const completionCoverage = [
      ...currentTopics.flatMap((topic) => {
        if (topic.planCheckpointId) return [];
        return !["cannibalizing", "disqualified", PLAN_CANDIDATE_CHECKPOINT_STATUS]
            .includes(topic.status ?? "planned")
          ? [{
              primaryKeyword: topic.primaryKeyword,
              serpTopUrls: topic.serpTopUrls,
            }]
          : [];
      }),
      ...coveredIntentTopics(
        currentTopics.map((topic) => ({
          _id: String(topic._id),
          status: topic.status ?? "planned",
          primaryKeyword: topic.primaryKeyword,
          serpTopUrls: topic.serpTopUrls,
        })),
        currentArticles.map((article) => ({
          topicId: article.topicId ? String(article.topicId) : undefined,
          slug: article.slug,
          status: article.status,
          publicationGateStatus: article.publicationGateStatus,
          publicationAuditVersion: article.publicationAuditVersion,
          auditedContentHash: article.auditedContentHash,
        })),
      ),
    ];
    const eligibleById = new Map(args.eligible.map((item) =>
      [String(item.topicId), item]));
    const completed: Id<"topic_clusters">[] = [];
    const excluded: Id<"topic_clusters">[] = [];
    for (let index = 0; index < checkpoint.candidateTopicIds.length; index++) {
      const topicId = checkpoint.candidateTopicIds[index];
      const topic = await ctx.db.get(topicId);
      const item = eligibleById.get(String(topicId));
      const binding = topic
        ? exactCheckpointTopicBinding({ topic, checkpoint })
        : null;
      const receiptValid = Boolean(topic && binding && inlinePlanSerpReceiptValid({
        receipt: topic.planCheckpointSerpReceipt,
        candidateFingerprint: binding.candidateFingerprint,
        seedManifestHash: checkpoint.seedManifestHash,
        workerExecution: checkpoint.workerExecution,
        locationCode: checkpoint.locationCode,
        languageCode: checkpoint.languageCode,
        attemptedAt: topic.planCheckpointSerpAttemptedAt,
        now: timestamp,
      }));
      const candidate = binding?.candidate ?? null;
      const candidateEligible = Boolean(
        candidate && candidateValid(site, candidate, maxKd, timestamp),
      );
      const candidateCoverage = topic && receiptValid
        ? {
            primaryKeyword: topic.primaryKeyword,
            serpTopUrls: topic.planCheckpointSerpReceipt!.results.map(
              (result) => result.url,
            ),
          }
        : null;
      const cannibalizationClear = Boolean(
        candidateCoverage && filterNonCannibalizingIntentTopics(
          [candidateCoverage],
          completionCoverage,
          0.4,
          0.35,
          1,
        ).length === 1,
      );
      const estimate = topic && item
        ? estimateTopicExpectedClicks({
            topic: {
              topicId: String(topic._id),
              keyword: topic.primaryKeyword,
              demand: topic.searchVolume !== undefined &&
                  topic.searchDemandSource &&
                  topic.searchDemandMeasuredAt
                ? {
                    monthlySearches: topic.searchVolume,
                    source: topic.searchDemandSource,
                    measuredAt: topic.searchDemandMeasuredAt,
                  }
                : undefined,
              serpCompetitors: item.serpAuthorityCompetitors,
            },
            tenantAuthority: authority,
            now: timestamp,
          })
        : null;
      const competitorPositions = new Set(
        item?.serpAuthorityCompetitors.map((competitor) =>
          competitor.position) ?? [],
      );
      const competitorUrls = new Set(
        item?.serpAuthorityCompetitors.map((competitor) => competitor.url) ?? [],
      );
      if (
        topic && item && binding && binding.index === index &&
        topic.status === PLAN_CANDIDATE_CHECKPOINT_STATUS &&
        item.candidateFingerprint === binding.candidateFingerprint &&
        receiptValid &&
        candidateEligible &&
        cannibalizationClear &&
        item.serpAuthorityCompetitors.length === 5 &&
        Number.isFinite(item.expectedClicksMonthly) &&
        item.expectedClicksMonthly >= 0 &&
        Number.isFinite(item.expectedClickRankProbability) &&
        item.expectedClickRankProbability >= 0 &&
        item.expectedClickRankProbability <= 1 &&
        competitorPositions.size === 5 &&
        competitorUrls.size === 5 &&
        item.serpAuthorityCompetitors.every((competitor) =>
          competitor.source === DATAFORSEO_AUTHORITY_SOURCE &&
          normalizedEvidenceHost(competitor.url) ===
            competitor.domain.toLowerCase().replace(/^www\./, "") &&
          competitor.domainRank >= 0 && competitor.domainRank <= 100 &&
          competitor.measuredAt >=
            (topic.planCheckpointSerpReceipt?.observedAt ?? Infinity) &&
          competitor.measuredAt <= timestamp + 5 * 60 * 1000 &&
          topic.planCheckpointSerpReceipt?.results.some((result) =>
            result.position === competitor.position &&
            result.url === competitor.url)) &&
        estimate?.status === "eligible" &&
        estimate.expectedClicksMonthly === item.expectedClicksMonthly &&
        (estimate.projectedPosition ?? undefined) ===
          item.expectedClickProjectedPosition &&
        estimate.rankProbability === item.expectedClickRankProbability &&
        JSON.stringify(estimate.reasons) ===
          JSON.stringify(item.expectedClickReasons)
      ) {
        await ctx.db.patch(topicId, {
          // Seal the verified result while the row remains non-consumable.
          // Promotion is fused with the owning job's terminal success in
          // commitInlineSuccess so a rollout/config cancellation can never
          // strand old-contract inventory between two mutations.
          serpAuthorityCompetitors: item.serpAuthorityCompetitors,
          expectedClicksMonthly: item.expectedClicksMonthly,
          expectedClickProjectedPosition:
            item.expectedClickProjectedPosition,
          expectedClickRankProbability: item.expectedClickRankProbability,
          expectedClickStatus: "eligible",
          expectedClickReasons: item.expectedClickReasons,
          expectedClickAuditVersion: EXPECTED_CLICK_PORTFOLIO_VERSION,
          expectedClickAuditedAt: timestamp,
          updatedAt: timestamp,
        });
        completed.push(topicId);
        completionCoverage.push(candidateCoverage!);
      } else if (topic?.siteId === args.siteId) {
        if (topic.status === PLAN_CANDIDATE_CHECKPOINT_STATUS) {
          await terminallyExcludeCandidate(
            ctx,
            topic,
            "plan_checkpoint_inline_not_eligible",
            timestamp,
          );
        }
        excluded.push(topicId);
      }
    }
    await ctx.db.patch(checkpoint._id, {
      status: "inline_sealed",
      inlineCompletedTopicIds: completed,
      terminallyExcludedTopicIds: excluded,
      updatedAt: timestamp,
    });
    return {
      completed: completed.length,
      excluded: excluded.length,
      acceptedTopicIds: completed,
    };
  },
});

/**
 * Atomically publish one sealed checkpoint and terminally complete its plan.
 *
 * `completeInline` deliberately leaves accepted rows in `plan_checkpoint`.
 * This mutation rechecks the current tenant/config/epoch/lease/reservation
 * contract and then promotes those rows in the same database transaction that
 * marks the owning job done. A concurrent cancellation therefore wins before
 * this mutation (and nothing is promoted) or loses after a valid terminal
 * success (and no running job remains for it to cancel).
 */
export const commitInlineSuccess = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    workerExecution: v.number(),
    completionNonce: v.string(),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const [site, job, checkpoints, currentTopics, currentArticles] =
      await Promise.all([
        ctx.db.get(args.siteId),
        ctx.db.get(args.jobId),
        ctx.db.query("plan_candidate_checkpoints")
          .withIndex("by_plan_job", (q) => q.eq("planJobId", args.jobId))
          .collect(),
        ctx.db.query("topic_clusters")
          .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
          .take(INVENTORY_READ_LIMIT + 1),
        ctx.db.query("articles")
          .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
          .take(INVENTORY_READ_LIMIT + 1),
      ]);
    const checkpoint = checkpoints[0];
    const target = job
      ? automaticSingleExecutionCheckpointTargetFromPayload(job.payload)
      : null;
    if (
      !site?.userId || site.deletionStatus ||
      site.expectedClickSchedulingEnabled !== true ||
      !job || !checkpoint || checkpoints.length !== 1 || !target ||
      checkpoint.status !== "inline_sealed" ||
      args.workerExecution !== 1 || checkpoint.workerExecution !== 1 ||
      !checkpointManifestMatchesJob(
        checkpoint,
        site,
        job,
        target.requiredVerifiedYield,
      ) ||
      !currentWorker(
        job,
        args.siteId,
        args.workerToken,
        args.workerExecution,
        timestamp,
      ) ||
      !jobAuthorizedForExecution(site, job) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !(await exactReservation(ctx, site, job))
    ) throw new Error("Plan checkpoint atomic success fence changed");
    if (
      currentTopics.length > INVENTORY_READ_LIMIT ||
      currentArticles.length > INVENTORY_READ_LIMIT
    ) throw new Error("Plan checkpoint success coverage read limit exhausted");

    const acceptedIds = checkpoint.inlineCompletedTopicIds ?? [];
    const acceptedKeys = acceptedIds.map(String);
    const resultRecord = args.result && typeof args.result === "object"
      ? args.result as Record<string, unknown>
      : null;
    if (
      acceptedIds.length > checkpoint.candidateCapacity ||
      acceptedIds.length > target.requiredVerifiedYield ||
      new Set(acceptedKeys).size !== acceptedKeys.length ||
      acceptedKeys.some((topicId) =>
        !checkpoint.candidateTopicIds.some((candidateId) =>
          String(candidateId) === topicId)) ||
      resultRecord?.count !== acceptedIds.length
    ) throw new Error("Plan checkpoint sealed success envelope drifted");

    const authority = authorityForSite(site, timestamp);
    if (!authority) throw new Error("Plan checkpoint success authority expired");
    const maxKd = computeAuthorityKeywordDifficultyCeiling({
      domainRank: authority.domainRank,
      referringDomains: authority.referringDomains ?? 0,
    });
    const ordinaryTopics = currentTopics.filter((topic) =>
      !topic.planCheckpointId &&
      !["cannibalizing", "disqualified", PLAN_CANDIDATE_CHECKPOINT_STATUS]
        .includes(topic.status ?? "planned") &&
      !topic.planCheckpointTerminalFailureCode
    );
    const completionCoverage = [
      ...ordinaryTopics.map((topic) => ({
        primaryKeyword: topic.primaryKeyword,
        serpTopUrls: topic.serpTopUrls,
      })),
      ...coveredIntentTopics(
        ordinaryTopics.map((topic) => ({
          _id: String(topic._id),
          status: topic.status ?? "planned",
          primaryKeyword: topic.primaryKeyword,
          serpTopUrls: topic.serpTopUrls,
        })),
        currentArticles.map((article) => ({
          topicId: article.topicId ? String(article.topicId) : undefined,
          slug: article.slug,
          status: article.status,
          publicationGateStatus: article.publicationGateStatus,
          publicationAuditVersion: article.publicationAuditVersion,
          auditedContentHash: article.auditedContentHash,
        })),
      ),
    ];

    for (const topicId of acceptedIds) {
      const topic = await ctx.db.get(topicId);
      const binding = topic
        ? exactCheckpointTopicBinding({ topic, checkpoint })
        : null;
      const receiptValid = Boolean(topic && binding && inlinePlanSerpReceiptValid({
        receipt: topic.planCheckpointSerpReceipt,
        candidateFingerprint: binding.candidateFingerprint,
        seedManifestHash: checkpoint.seedManifestHash,
        workerExecution: checkpoint.workerExecution,
        locationCode: checkpoint.locationCode,
        languageCode: checkpoint.languageCode,
        attemptedAt: topic.planCheckpointSerpAttemptedAt,
        now: timestamp,
      }));
      const candidate = binding?.candidate ?? null;
      const candidateCoverage = topic && receiptValid
        ? {
            primaryKeyword: topic.primaryKeyword,
            serpTopUrls: topic.planCheckpointSerpReceipt!.results.map(
              (result) => result.url,
            ),
          }
        : null;
      const competitors = topic?.serpAuthorityCompetitors ?? [];
      const estimate = topic
        ? estimateTopicExpectedClicks({
            topic: {
              topicId: String(topic._id),
              keyword: topic.primaryKeyword,
              demand: topic.searchVolume !== undefined &&
                  topic.searchDemandSource &&
                  topic.searchDemandMeasuredAt
                ? {
                    monthlySearches: topic.searchVolume,
                    source: topic.searchDemandSource,
                    measuredAt: topic.searchDemandMeasuredAt,
                  }
                : undefined,
              serpCompetitors: competitors,
            },
            tenantAuthority: authority,
            now: timestamp,
          })
        : null;
      const competitorPositions = new Set(
        competitors.map((competitor) => competitor.position),
      );
      const competitorUrls = new Set(
        competitors.map((competitor) => competitor.url),
      );
      const cannibalizationClear = Boolean(
        candidateCoverage && filterNonCannibalizingIntentTopics(
          [candidateCoverage],
          completionCoverage,
          0.4,
          0.35,
          1,
        ).length === 1,
      );
      if (
        !topic || !binding ||
        topic.siteId !== args.siteId ||
        topic.status !== PLAN_CANDIDATE_CHECKPOINT_STATUS ||
        topic.planCheckpointTerminalFailureCode ||
        !receiptValid ||
        !candidate || !candidateValid(site, candidate, maxKd, timestamp) ||
        !cannibalizationClear ||
        competitors.length !== 5 ||
        competitorPositions.size !== 5 || competitorUrls.size !== 5 ||
        competitors.some((competitor) =>
          competitor.source !== DATAFORSEO_AUTHORITY_SOURCE ||
          normalizedEvidenceHost(competitor.url) !==
            competitor.domain.toLowerCase().replace(/^www\./, "") ||
          competitor.domainRank < 0 || competitor.domainRank > 100 ||
          competitor.measuredAt <
            (topic.planCheckpointSerpReceipt?.observedAt ?? Infinity) ||
          competitor.measuredAt > timestamp + 5 * 60 * 1000 ||
          !topic.planCheckpointSerpReceipt?.results.some((result) =>
            result.position === competitor.position &&
            result.url === competitor.url)) ||
        topic.expectedClickStatus !== "eligible" ||
        topic.expectedClickAuditVersion !== EXPECTED_CLICK_PORTFOLIO_VERSION ||
        !Number.isFinite(topic.expectedClicksMonthly) ||
        !Number.isFinite(topic.expectedClickRankProbability) ||
        estimate?.status !== "eligible" ||
        estimate.expectedClicksMonthly !== topic.expectedClicksMonthly ||
        (estimate.projectedPosition ?? undefined) !==
          topic.expectedClickProjectedPosition ||
        estimate.rankProbability !== topic.expectedClickRankProbability ||
        JSON.stringify(estimate.reasons) !==
          JSON.stringify(topic.expectedClickReasons ?? [])
      ) throw new Error("Plan checkpoint sealed candidate changed");

      await ctx.db.patch(topicId, {
        status: "planned",
        ...(topic.recommendedArticleType
          ? { articleType: topic.recommendedArticleType }
          : {}),
        planCheckpointActivatedAt: timestamp,
        updatedAt: timestamp,
      });
      completionCoverage.push(candidateCoverage!);
    }

    await ctx.db.patch(checkpoint._id, {
      status: "inline_completed",
      inlineSuccessCommitNonce: args.completionNonce,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    const result = args.result && typeof args.result === "object"
      ? args.result as Record<string, unknown>
      : {};
    await ctx.db.patch(job._id, {
      status: "done",
      result: {
        ...result,
        planCheckpointCommit: {
          version: 1,
          completionNonce: args.completionNonce,
          checkpointId: checkpoint._id,
          workerExecution: args.workerExecution,
          acceptedTopicIds: acceptedIds,
          committedAt: timestamp,
        },
      },
      error: undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: timestamp,
    });
    return {
      updated: true,
      completed: acceptedIds.length,
      checkpointId: checkpoint._id,
    };
  },
});

/** Exact read-only recovery for a lost response from commitInlineSuccess. */
export const inspectCommittedInlineSuccess = internalQuery({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerExecution: v.number(),
    completionNonce: v.string(),
  },
  handler: async (ctx, args) => {
    const [site, job, checkpoints] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
      ctx.db.query("plan_candidate_checkpoints")
        .withIndex("by_plan_job", (q) => q.eq("planJobId", args.jobId))
        .collect(),
    ]);
    const checkpoint = checkpoints[0];
    const result = job?.result && typeof job.result === "object"
      ? job.result as Record<string, unknown>
      : {};
    const value = result.planCheckpointCommit;
    const commit = value && typeof value === "object"
      ? value as Record<string, unknown>
      : null;
    const acceptedTopicIds = checkpoint?.inlineCompletedTopicIds ?? [];
    const acceptedKeys = acceptedTopicIds.map(String);
    const committedKeys = Array.isArray(commit?.acceptedTopicIds)
      ? commit.acceptedTopicIds.map(String)
      : [];
    if (
      !site?.userId || site._id !== args.siteId ||
      !job || job.siteId !== args.siteId || job.type !== "plan" ||
      job.status !== "done" || checkpoints.length !== 1 || !checkpoint ||
      checkpoint.siteId !== args.siteId ||
      checkpoint.userId !== site.userId ||
      checkpoint.planJobId !== args.jobId ||
      checkpoint.status !== "inline_completed" ||
      checkpoint.workerExecution !== args.workerExecution ||
      checkpoint.inlineSuccessCommitNonce !== args.completionNonce ||
      !Number.isFinite(checkpoint.completedAt) ||
      !commit || commit.version !== 1 ||
      commit.completionNonce !== args.completionNonce ||
      String(commit.checkpointId) !== String(checkpoint._id) ||
      commit.workerExecution !== args.workerExecution ||
      commit.committedAt !== checkpoint.completedAt ||
      JSON.stringify(committedKeys) !== JSON.stringify(acceptedKeys) ||
      result.count !== acceptedTopicIds.length
    ) return { committed: false as const };
    const topics = await Promise.all(
      acceptedTopicIds.map((topicId) => ctx.db.get(topicId)),
    );
    if (topics.some((topic, index) =>
      !topic || topic.siteId !== args.siteId ||
      topic.planCheckpointId !== checkpoint._id ||
      topic.planCheckpointJobId !== args.jobId ||
      topic.planCheckpointCandidateOrdinal !==
        checkpoint.candidateTopicIds.findIndex((id) =>
          String(id) === acceptedKeys[index]) ||
      topic.planCheckpointTerminalFailureCode !== undefined ||
      topic.planCheckpointActivatedAt !== checkpoint.completedAt
    )) return { committed: false as const };
    return {
      committed: true as const,
      updated: true as const,
      completed: acceptedTopicIds.length,
      checkpointId: checkpoint._id,
    };
  },
});

/** A deterministic planner outcome may never promote checkpoint inventory. */
export async function terminallyClosePlanCheckpoints(
  ctx: MutationCtx,
  jobId: Id<"jobs">,
  timestamp: number,
  code = "plan_checkpoint_semantic_plan_failure",
) {
  const job = await ctx.db.get(jobId);
  if (!job?.siteId || job.type !== "plan" || job.status !== "failed") {
    return { closed: 0 };
  }
  const site = await ctx.db.get(job.siteId);
  if (!site?.userId) return { closed: 0 };
  const checkpoints = await ctx.db.query("plan_candidate_checkpoints")
    .withIndex("by_plan_job", (q) => q.eq("planJobId", jobId))
    .collect();
  let closed = 0;
  for (const checkpoint of checkpoints) {
    if (
      checkpoint.siteId !== job.siteId ||
      checkpoint.userId !== site.userId ||
      checkpoint.planJobId !== jobId
    ) continue;
    if (!["active", "inline_sealed"].includes(checkpoint.status)) continue;
    const excluded: Id<"topic_clusters">[] = [];
    for (const topicId of checkpoint.candidateTopicIds) {
      const topic = await ctx.db.get(topicId);
      const binding = topic
        ? exactCheckpointTopicBinding({ topic, checkpoint })
        : null;
      if (
        topic?.siteId === job.siteId &&
        topic.planCheckpointId === checkpoint._id &&
        topic.planCheckpointJobId === jobId &&
        binding &&
        topic.status === PLAN_CANDIDATE_CHECKPOINT_STATUS
      ) {
        await terminallyExcludeCandidate(ctx, topic, code, timestamp);
        excluded.push(topicId);
      }
    }
    await ctx.db.patch(checkpoint._id, {
      status: "terminal_blocked",
      terminallyExcludedTopicIds: excluded,
      completedAt: timestamp,
      updatedAt: timestamp,
    });
    closed += 1;
  }
  return { closed };
}

/** Called only after an operational provider retry is exhausted or a plan
 * lease/parent times out. The owning job must already be terminal failed. */
export async function activateTerminalPlanCheckpoints(
  ctx: MutationCtx,
  jobId: Id<"jobs">,
  timestamp: number,
) {
  const job = await ctx.db.get(jobId);
  if (!job?.siteId || job.type !== "plan" || job.status !== "failed") {
    return { activated: 0, scheduled: false };
  }
  const site = await ctx.db.get(job.siteId);
  const target = automaticSingleExecutionCheckpointTargetFromPayload(
    job.payload,
  );
  const checkpoints = await ctx.db.query("plan_candidate_checkpoints")
    .withIndex("by_plan_job", (q) => q.eq("planJobId", jobId))
    .collect();
  if (!target || checkpoints.length === 0) {
    return { activated: 0, scheduled: false };
  }
  const authority = site ? authorityForSite(site, timestamp) : null;
  const maxKd = authority
    ? computeAuthorityKeywordDifficultyCeiling({
        domainRank: authority.domainRank,
        referringDomains: authority.referringDomains ?? 0,
      })
    : -1;
  let authorization = Boolean(
    site?.userId &&
    !site.deletionStatus &&
    site.expectedClickSchedulingEnabled === true &&
    (site.cadencePerWeek ?? 0) > 0 &&
    authority &&
    jobAuthorizedForExecution(site, job) &&
    await siteExecutionAuthorized(ctx, site) &&
    await exactReservation(ctx, site, job),
  );
  if (checkpoints.length !== 1) authorization = false;
  const [currentTopics, currentArticles] = site
    ? await Promise.all([
        ctx.db.query("topic_clusters")
          .withIndex("by_site", (q) => q.eq("siteId", site._id))
          .take(INVENTORY_READ_LIMIT + 1),
        ctx.db.query("articles")
          .withIndex("by_site", (q) => q.eq("siteId", site._id))
          .take(INVENTORY_READ_LIMIT + 1),
      ])
    : [[], []];
  if (
    currentTopics.length > INVENTORY_READ_LIMIT ||
    currentArticles.length > INVENTORY_READ_LIMIT
  ) authorization = false;
  const activationCoverage = [
    ...currentTopics
      .filter((topic) =>
        !["cannibalizing", "disqualified", PLAN_CANDIDATE_CHECKPOINT_STATUS]
          .includes(topic.status ?? "planned") &&
        !topic.planCheckpointTerminalFailureCode
      )
      .map((topic) => ({
        primaryKeyword: topic.primaryKeyword,
        serpTopUrls: topic.serpTopUrls ??
          topic.planCheckpointSerpReceipt?.results.map((result) => result.url),
      })),
    ...coveredIntentTopics(
      currentTopics.map((topic) => ({
        _id: String(topic._id),
        status: topic.status ?? "planned",
        primaryKeyword: topic.primaryKeyword,
        serpTopUrls: topic.serpTopUrls,
      })),
      currentArticles.map((article) => ({
        topicId: article.topicId ? String(article.topicId) : undefined,
        slug: article.slug,
        status: article.status,
        publicationGateStatus: article.publicationGateStatus,
        publicationAuditVersion: article.publicationAuditVersion,
        auditedContentHash: article.auditedContentHash,
      })),
    ),
  ];
  let remaining = target.requiredVerifiedYield;
  let activated = 0;
  for (const checkpoint of checkpoints.sort((a, b) =>
    a.workerExecution - b.workerExecution)) {
    if (!["active", "inline_sealed"].includes(checkpoint.status)) continue;
    if (
      checkpoint.siteId !== job.siteId ||
      !site?.userId || checkpoint.userId !== site.userId
    ) {
      authorization = false;
      continue;
    }
    const manifestValid = Boolean(
      site && checkpointManifestMatchesJob(
        checkpoint,
        site,
        job,
        target.requiredVerifiedYield,
      ),
    );
    const activatedIds: Id<"topic_clusters">[] = [];
    const excludedIds: Id<"topic_clusters">[] = [];
    for (let index = 0; index < checkpoint.candidateTopicIds.length; index++) {
      const topicId = checkpoint.candidateTopicIds[index];
      const topic = await ctx.db.get(topicId);
      const binding = topic
        ? exactCheckpointTopicBinding({ topic, checkpoint })
        : null;
      const candidate = binding?.candidate ?? null;
      if (
        !topic || topic.siteId !== job.siteId ||
        !binding || binding.index !== index
      ) {
        excludedIds.push(topicId);
        continue;
      }
      const receiptValid = inlinePlanSerpReceiptValid({
        receipt: topic.planCheckpointSerpReceipt,
        candidateFingerprint: checkpoint.candidateFingerprints[index],
        seedManifestHash: checkpoint.seedManifestHash,
        workerExecution: checkpoint.workerExecution,
        locationCode: checkpoint.locationCode,
        languageCode: checkpoint.languageCode,
        attemptedAt: topic.planCheckpointSerpAttemptedAt,
        now: timestamp,
      });
      const decision = terminalCheckpointCandidateDecision({
        status: topic.status,
        attemptedAt: topic.planCheckpointSerpAttemptedAt,
        receiptValid,
        terminalFailureCode: topic.planCheckpointTerminalFailureCode,
      });
      const candidateEligible = Boolean(
        candidate && site && candidateValid(site, candidate, maxKd, timestamp),
      );
      const candidateCoverage = candidate
        ? {
            primaryKeyword: candidate.primaryKeyword,
            serpTopUrls: receiptValid
              ? topic?.planCheckpointSerpReceipt?.results.map(
                  (result) => result.url,
                )
              : undefined,
          }
        : null;
      const cannibalizationClear = Boolean(
        candidateCoverage &&
        filterNonCannibalizingIntentTopics(
          [candidateCoverage],
          activationCoverage,
          0.4,
          0.35,
          1,
        ).length === 1,
      );
      if (
        authorization && manifestValid && candidateEligible &&
        cannibalizationClear && remaining > 0 &&
        decision === "activate_unattempted"
      ) {
        await ctx.db.patch(topicId, {
          status: "planned",
          ...(receiptValid && topic.recommendedArticleType
            ? { articleType: topic.recommendedArticleType }
            : {}),
          planCheckpointActivatedAt: timestamp,
          updatedAt: timestamp,
        });
        activatedIds.push(topicId);
        activated += 1;
        remaining -= 1;
        activationCoverage.push(candidateCoverage!);
      } else {
        if (decision === "disqualify_attempted") {
          await terminallyExcludeCandidate(
            ctx,
            topic,
            receiptValid
              ? "plan_checkpoint_receipt_adoption_not_enabled"
              : "plan_checkpoint_serp_attempt_ambiguous",
            timestamp,
          );
        } else if (topic.status === PLAN_CANDIDATE_CHECKPOINT_STATUS) {
          await terminallyExcludeCandidate(
            ctx,
            topic,
            !authorization || !manifestValid || !candidateEligible ||
                  !cannibalizationClear
                ? "plan_checkpoint_terminal_authorization_changed"
                : "plan_checkpoint_recovery_capacity_exhausted",
            timestamp,
          );
        }
        excludedIds.push(topicId);
      }
    }
    await ctx.db.patch(checkpoint._id, {
      status: authorization && manifestValid ? "activated" : "terminal_blocked",
      activatedTopicIds: activatedIds,
      terminallyExcludedTopicIds: excludedIds,
      activatedAt: timestamp,
      updatedAt: timestamp,
    });
  }
  if (activated > 0 && site) {
    await ctx.scheduler.runAfter(
      0,
      internal.actions.expectedClickEvidenceBackfill
        .queueExpectedClickEvidenceBackfillFleet,
      {
        siteId: site._id,
        policyVersion: EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION,
      },
    );
    for (const checkpoint of checkpoints.filter((candidate) =>
      ["active", "inline_sealed"].includes(candidate.status) &&
      candidate.siteId === job.siteId && candidate.userId === site.userId)) {
      await ctx.db.patch(checkpoint._id, { activationScheduledAt: timestamp });
    }
  }
  return { activated, scheduled: activated > 0 };
}
