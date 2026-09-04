import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getLimitsFromFeatures } from "./planLimits";
import { PUBLICATION_AUDIT_VERSION } from "./lib/publicationArtifact";
import {
  DETERMINISTIC_QUALITY_REPAIR_VERSION,
  hasAttemptedVersionedQualityRecovery,
  MAX_QUALITY_REVISIONS,
  qualityRecoveryAttemptVersionFromJob,
  qualityRecoveryTargetVersion,
  WORKER_LENGTH_RECOVERY_VERSION,
} from "./lib/autopilotCadence";
import {
  MAX_PUBLICATION_ATTEMPTS,
  nextPublicationRetry,
} from "./lib/publicationLease";
import {
  autonomousRolloutActive,
  jobAuthorizedForExecution,
} from "./lib/jobRollout";
import {
  reconcileJobTopicLifecycle,
  reconcileTopicLifecycle,
} from "./lib/topicLifecycleDb";
import {
  recoverableWorkerQualityFailure,
  topicMatchesLegacyWorkerFailureSettlement,
} from "./lib/topicLifecycle";
import {
  AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES,
  AUTOMATIC_PLAN_TOPIC_CAPACITY,
  AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD,
  EXPECTED_CLICK_PLAN_MIGRATION_VERSION,
  UNDERFILLED_PLAN_CONTINUATION_RECOVERY_VERSION,
  automaticPlanYieldTarget,
  automaticSingleExecutionCheckpointTargetFromPayload,
  PLAN_CHECKPOINT_SINGLE_EXECUTION_VERSION,
  type AutomaticPlanYieldTarget,
  countsTowardTopicPlanRecentLimit,
  evaluateBoundedRecentPlanWindow,
  evaluateAutomaticPlanContinuation,
  planRetryUsesCurrentReservationDay,
  topicPlanCooldownClaimNonce,
  topicPlanCooldownWakeAt,
  TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT,
  TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
  topicPlanProviderReservationTriggerFromPayload,
} from "./lib/planProviderBudget";
import { reservePlanProviderBudget } from "./lib/planProviderReservation";
import {
  EXPECTED_CLICK_PLAN_MIGRATION_RECOVERY_VERSION,
  isExpectedClickZeroInsertTerminalError,
} from "./lib/expectedClickMigrationRecovery";
import {
  releaseSharedProviderReservation,
  type ProviderReservationReleaseReason,
} from "./lib/providerSpendReservation";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import {
  ARTICLE_PROVIDER_ACCOUNT_CONCURRENCY,
  ARTICLE_PROVIDER_ATTEMPT_LEASE_MS,
  ARTICLE_PROVIDER_FLEET_CONCURRENCY,
  articleGenerationAttemptAllowance,
  articleGenerationAttemptKey,
  articleGenerationAttemptMonth,
  decideArticleProviderAdmission,
  type ArticleProviderAttemptStatus,
} from "./lib/articleGenerationAttempt";
import {
  MIN_VERIFIED_TOPIC_HORIZON,
  TARGET_APPROVED_BUFFER,
  approvedBufferPolicy,
  coveredIntentTopics,
  evaluateTopicBusinessFit,
  filterNonCannibalizingIntentTopics,
  isUnderfilledPlanContinuationPayload,
  isSealedReady,
  tenantTopicBusinessSignals,
} from "./lib/autopilotBuffer";
import { DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL } from "./lib/seoGrowth";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "./lib/dataForSeoLocale";
import { planCheckpointTopicExecutionLocked } from
  "./lib/planCandidateCheckpoint";
import { evaluateSchedulerReadyTopicInventory } from
  "./lib/schedulerTopicReadiness";
import {
  activateTerminalPlanCheckpoints,
  terminallyClosePlanCheckpoints,
} from "./planCandidateCheckpoints";
import {
  CADENCE_BALANCE_RECHECK_MS,
  CADENCE_PROVIDER_RECHECK_MS,
  classifyCadenceFailure,
  deriveCadenceRecoveryStrategy,
  nextUtcMonthAt,
} from "./lib/cadenceLiveness";
import {
  articleMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
  takeCurrentDomainArticleSummaries,
  takeCurrentDomainArticleSummariesByStatus,
  takeCurrentDomainTopics,
  topicMatchesCurrentDomain,
} from "./lib/siteDomainBinding";
import { ONBOARDING_WORKFLOW } from "./lib/onboardingClaim";
import {
  ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
  oneSetupDomainRevisionReceiptMatches,
  oneSetupInitialPlanContextFingerprint,
  oneSetupInitialPlanJobBindingMatches,
  oneSetupInitialPlanReceiptDecision,
  oneSetupPaidBoundaryLifecycleAllowed,
} from "./lib/oneSetupInitialPlan";
import { oneSetupInitialPlanCurrency } from
  "./lib/oneSetupInitialPlanDb";
import { oneSetupQueueDenialDisposition } from
  "./lib/oneSetupExecution.ts";
import { accountDeletionKey } from "./lib/accountDeletion.ts";
import { ONE_SETUP_CONTRACT_VERSION } from "./lib/oneSetup.ts";
import {
  CADENCE_MICRO_SEED_MAX_CADENCE_HORIZON_MS,
  CADENCE_MICRO_SEED_SCHEDULE_HANDOFF_VERSION,
  CADENCE_MICRO_SEED_VERSION,
  cadenceMicroSeedScheduleHandoffAllowed,
  normalizeCadenceMicroSeedText,
} from "./lib/cadenceMicroSeed.ts";
import { EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION } from
  "./lib/expectedClickEvidenceBackfill.ts";
import { verifiedKeywordPlanningActive } from
  "./lib/plannedTopicEvidenceRecovery.ts";

const now = () => Date.now();
export const JOB_LEASE_MS = 30 * 60 * 1000;
const MAX_JOB_ATTEMPTS = 3;
const AUTOMATIC_PLAN_CONTINUATION_DELAY_MS = 1_000;

function onboardingClaimOwnsLifecycle(job: Doc<"jobs">): boolean {
  if (job.type !== "onboarding") return false;
  const payload = job.payload && typeof job.payload === "object"
    ? job.payload as Record<string, unknown>
    : {};
  return payload.workflow === ONBOARDING_WORKFLOW;
}

function activeRollout(site: Doc<"sites"> | null): boolean {
  return autonomousRolloutActive(site);
}

function rolloutFields(site: Doc<"sites">, manual = false) {
  if (site.deletionStatus || site.planParkedAt) {
    throw new Error("This site is not active under the current plan");
  }
  if (!manual && !activeRollout(site)) {
    throw new Error(
      "Automation is in fail-closed observe mode for this site",
    );
  }
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) throw new Error("This site domain is invalid");
  return {
    rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
  };
}

async function currentSitePlanAllowance(
  ctx: MutationCtx,
  site: Doc<"sites"> | null,
): Promise<
  | { ok: true; limits: ReturnType<typeof getLimitsFromFeatures> }
  | { ok: false; reason: string }
> {
  if (
    !siteExecutionActive(site) ||
    !site.userId ||
    !(await siteExecutionAuthorized(ctx, site))
  ) {
    return {
      ok: false,
      reason: "This site is not active under the current plan",
    };
  }
  const entitlement = await ctx.db
    .query("account_plan_entitlements")
    .withIndex("by_user", (q) => q.eq("userId", site.userId!))
    .unique();
  const limits = getLimitsFromFeatures(
    entitlement?.planFeatures ?? site.planFeatures ?? [],
  );
  if (limits.maxSites >= 9999) return { ok: true, limits };
  const activeSites = await ctx.db
    .query("sites")
    .withIndex("by_user", (q) => q.eq("userId", site.userId!))
    .filter((q) =>
      q.and(
        q.eq(q.field("deletionStatus"), undefined),
        q.eq(q.field("planParkedAt"), undefined),
      )
    )
    .take(limits.maxSites + 1);
  if (
    activeSites.length > limits.maxSites ||
    !activeSites.some((activeSite) => activeSite._id === site._id)
  ) {
    return {
      ok: false,
      reason: "This site is outside the current plan allowance",
    };
  }
  return { ok: true, limits };
}

async function accountHasArticleHeadroom(
  ctx: MutationCtx,
  userId: string,
  maximumArticles: number,
  timestamp: number,
): Promise<boolean> {
  const date = new Date(timestamp);
  const monthStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    1,
  );
  const logs = await ctx.db
    .query("usage_log")
    .withIndex("by_user_type_created", (q) =>
      q
        .eq("userId", userId)
        .eq("type", "article_generated")
        .gte("createdAt", monthStart)
    )
    .collect();
  const activeUsage = logs.filter(
    (log) =>
      log.state !== "reserved" ||
      (log.expiresAt ?? Infinity) > timestamp,
  );
  // Preserve the proven legacy continuation/recovery admission semantics.
  // Outstanding queued article demand is frozen only into a new checkpoint
  // target by accountArticleHeadroom below; it must not silently change the
  // marker-absent two-execution contract.
  return activeUsage.length < maximumArticles;
}

async function accountArticleHeadroom(
  ctx: MutationCtx,
  userId: string,
  maximumArticles: number,
  timestamp: number,
): Promise<number> {
  const date = new Date(timestamp);
  const monthStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    1,
  );
  const logs = await ctx.db
    .query("usage_log")
    .withIndex("by_user_type_created", (q) =>
      q
        .eq("userId", userId)
        .eq("type", "article_generated")
        .gte("createdAt", monthStart)
    )
    .collect();
  const activeUsage = logs.filter(
    (log) =>
      log.state !== "reserved" ||
      (log.expiresAt ?? Infinity) > timestamp,
  );
  const activeUsageJobIds = new Set(activeUsage.flatMap((log) =>
    log.jobId ? [String(log.jobId)] : []
  ));
  // An article job is queued before its worker reserves usage. Freeze that
  // outstanding account-wide demand too, otherwise the plan queued behind an
  // immediate cadence article can overstate monthly generation headroom by
  // one (or more). Bounded reads fail closed rather than widening the target.
  const ACCOUNT_HEADROOM_SITE_READ_LIMIT = 250;
  const ACCOUNT_HEADROOM_JOB_READ_LIMIT = 250;
  const sites = await ctx.db.query("sites")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(ACCOUNT_HEADROOM_SITE_READ_LIMIT + 1);
  if (sites.length > ACCOUNT_HEADROOM_SITE_READ_LIMIT) return 0;
  // Count jobs on every account-owned site. A concurrent park/deletion flow
  // may be about to fence one, but ignoring its still-active article job here
  // would optimistically widen a newly frozen plan target.
  const jobGroups = await Promise.all(sites.flatMap((site) =>
    ["pending", "running"].map((status) =>
      ctx.db.query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", site._id).eq("status", status))
        .take(ACCOUNT_HEADROOM_JOB_READ_LIMIT + 1)
    )
  ));
  if (jobGroups.some((jobs) => jobs.length > ACCOUNT_HEADROOM_JOB_READ_LIMIT)) {
    return 0;
  }
  const outstandingArticleJobs = jobGroups.flat().filter((job) => {
    if (
      job.type !== "article" ||
      job.articleId ||
      activeUsageJobIds.has(String(job._id))
    ) return false;
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    return payload.articleId === undefined;
  }).length;
  return Math.max(
    0,
    maximumArticles - activeUsage.length - outstandingArticleJobs,
  );
}

const PLAN_TARGET_INVENTORY_READ_LIMIT = 2_000;

/** Queue-time source of truth for cadence planning. This uses the same sealed
 * artifact, portfolio, fit, attainability and coverage helpers as the
 * scheduler, then freezes the result on the job before any reservation is
 * created. */
async function currentAutomaticPlanYieldTarget(
  ctx: MutationCtx,
  site: Doc<"sites">,
  limits: ReturnType<typeof getLimitsFromFeatures>,
  timestamp: number,
) {
  const [topics, summaries, growthGoal, articleQuotaHeadroom] =
    await Promise.all([
      takeCurrentDomainTopics(
        ctx,
        site,
        PLAN_TARGET_INVENTORY_READ_LIMIT + 1,
      ),
      takeCurrentDomainArticleSummaries(
        ctx,
        site,
        PLAN_TARGET_INVENTORY_READ_LIMIT + 1,
      ),
      ctx.db.query("seo_growth_goals")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .unique(),
      accountArticleHeadroom(ctx, site.userId!, limits.maxArticles, timestamp),
    ]);
  if (
    topics.length > PLAN_TARGET_INVENTORY_READ_LIMIT ||
    summaries.length > PLAN_TARGET_INVENTORY_READ_LIMIT
  ) return { ready: false as const, reason: "planning_snapshot_read_limit" as const };
  const sealedBufferCount = summaries.filter(isSealedReady).length;
  const bufferTarget = approvedBufferPolicy(site.cadencePerWeek ?? 4).target;
  const schedulerReadiness = evaluateSchedulerReadyTopicInventory({
    topics,
    site,
    monthlyOrganicClickGoal:
      growthGoal?.monthlyOrganicClicksGoal ??
      DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
    currentLocationCode: dataForSeoLocationCode(site.targetCountry),
    currentLanguageCode: dataForSeoLanguageCode(site.language),
  });
  const schedulerReadyTopicIds = new Set(
    schedulerReadiness.schedulerReadyTopicIds,
  );
  const evidenceReady = topics.filter((topic) =>
    schedulerReadyTopicIds.has(String(topic._id))
  );
  const coverage = coveredIntentTopics(
    topics.map((topic) => ({
      _id: String(topic._id),
      status: topic.status ?? "planned",
      primaryKeyword: topic.primaryKeyword,
      serpTopUrls: topic.serpTopUrls,
    })),
    summaries.map((article) => ({
      topicId: article.topicId ? String(article.topicId) : undefined,
      slug: article.slug,
      status: article.status,
      publicationGateStatus: article.publicationGateStatus,
      publicationAuditVersion: article.publicationAuditVersion,
      auditedContentHash: article.auditedContentHash,
    })),
  );
  const verifiedHorizon = filterNonCannibalizingIntentTopics(
    evidenceReady,
    coverage,
  ).length;
  return {
    ready: true as const,
    target: automaticPlanYieldTarget({
      targetBufferShortfall: Math.max(
        0,
        bufferTarget - sealedBufferCount,
      ),
      verifiedHorizonShortfall: Math.max(
        0,
        MIN_VERIFIED_TOPIC_HORIZON - verifiedHorizon,
      ),
      articleQuotaHeadroom,
    }),
    sealedBufferCount,
    verifiedHorizon,
  };
}

function ownsJob(job: Doc<"jobs">, workerToken: string): boolean {
  return job.status === "running" && job.workerToken === workerToken;
}

function stableOneSetupInitialPlanRequestId(
  job: Doc<"jobs">,
): string | null {
  const payload = job.payload && typeof job.payload === "object"
    ? job.payload as Record<string, unknown>
    : {};
  if (
    job.type !== "plan" ||
    payload.manual !== true ||
    payload.reason !== "one_setup_initial_plan" ||
    typeof payload.oneSetupRequestId !== "string" ||
    payload.oneSetupInitialPlanReceiptVersion !==
      ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION ||
    !Number.isSafeInteger(payload.oneSetupInitialPlanGeneration) ||
    (payload.oneSetupInitialPlanGeneration as number) <= 0
  ) return null;
  return payload.oneSetupRequestId;
}

async function wakeCurrentOneSetupExecutionForTerminalPlan(
  ctx: MutationCtx,
  job: Doc<"jobs">,
): Promise<void> {
  const rawRequestId = stableOneSetupInitialPlanRequestId(job);
  const requestId = rawRequestId
    ? ctx.db.normalizeId("managed_provisioning_requests", rawRequestId)
    : null;
  if (!requestId) return;
  await ctx.scheduler.runAfter(
    0,
    internal.oneSetupExecutions.reconcileCurrentPlanJob,
    { requestId, planJobId: job._id },
  );
}

type PlanPersistenceCommit = {
  version: 1;
  commitNonce: string;
  workerExecution: number;
  expectedClickSchedulingEnabled: boolean;
  acceptedTopicCount: number;
  cumulativeTopicCount: number;
  inserted: number;
  revived: number;
  skipped: number;
  acceptedKeywordKeys: string[];
  committedAt: number;
};

function exactPlanPersistenceCommit(
  job: Doc<"jobs">,
  commitNonce: string,
): PlanPersistenceCommit | null {
  const result = job.result && typeof job.result === "object"
    ? job.result as Record<string, unknown>
    : {};
  const value = result.planPersistenceCommit;
  if (!value || typeof value !== "object") return null;
  const commit = value as Record<string, unknown>;
  const acceptedKeywordKeys = commit.acceptedKeywordKeys;
  if (
    commit.version !== 1 ||
    commit.commitNonce !== commitNonce ||
    !Number.isInteger(commit.workerExecution) ||
    (commit.workerExecution as number) < 1 ||
    typeof commit.expectedClickSchedulingEnabled !== "boolean" ||
    !Number.isInteger(commit.acceptedTopicCount) ||
    (commit.acceptedTopicCount as number) < 0 ||
    !Number.isInteger(commit.cumulativeTopicCount) ||
    (commit.cumulativeTopicCount as number) <
      (commit.acceptedTopicCount as number) ||
    (commit.cumulativeTopicCount as number) > AUTOMATIC_PLAN_TOPIC_CAPACITY ||
    !Number.isInteger(commit.inserted) ||
    (commit.inserted as number) < 0 ||
    !Number.isInteger(commit.revived) ||
    (commit.revived as number) < 0 ||
    (commit.inserted as number) + (commit.revived as number) !==
      commit.acceptedTopicCount ||
    !Number.isInteger(commit.skipped) ||
    (commit.skipped as number) < 0 ||
    !Array.isArray(acceptedKeywordKeys) ||
    acceptedKeywordKeys.length !== commit.acceptedTopicCount ||
    acceptedKeywordKeys.some((key) => typeof key !== "string" || !key) ||
    new Set(acceptedKeywordKeys).size !== acceptedKeywordKeys.length ||
    !Number.isFinite(commit.committedAt)
  ) return null;
  return commit as PlanPersistenceCommit;
}

async function articleProviderAttemptForJob(
  ctx: MutationCtx,
  job: Doc<"jobs">,
) {
  return await ctx.db
    .query("article_generation_attempts")
    .withIndex("by_attempt_key", (q) =>
      q.eq(
        "attemptKey",
        articleGenerationAttemptKey(
          String(job._id),
          job.workerAttempts ?? 0,
        ),
      )
    )
    .unique();
}

async function renewArticleProviderAttempt(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  currentTime: number,
) {
  const attempt = await articleProviderAttemptForJob(ctx, job);
  if (attempt?.status !== "reserved") return false;
  await ctx.db.patch(attempt._id, {
    expiresAt: currentTime + ARTICLE_PROVIDER_ATTEMPT_LEASE_MS,
    updatedAt: currentTime,
  });
  return true;
}

async function settleArticleProviderAttempt(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  status: Exclude<
    ArticleProviderAttemptStatus,
    "reserved" | "funding_paused"
  >,
  currentTime: number,
) {
  const attempt = await articleProviderAttemptForJob(ctx, job);
  if (attempt?.status !== "reserved") return false;
  await ctx.db.patch(attempt._id, {
    status,
    expiresAt: undefined,
    settledAt: currentTime,
    articleKey: job.articleId ? String(job.articleId) : undefined,
    updatedAt: currentTime,
  });
  return true;
}

async function pauseArticleProviderAttemptForFunding(
  ctx: MutationCtx,
  job: Doc<"jobs">,
  currentTime: number,
) {
  const attempt = await articleProviderAttemptForJob(ctx, job);
  if (attempt?.status !== "reserved") return false;
  await ctx.db.patch(attempt._id, {
    status: "funding_paused",
    expiresAt: undefined,
    updatedAt: currentTime,
  });
  return true;
}

async function releaseReservedUsage(
  ctx: MutationCtx,
  job: Doc<"jobs">,
): Promise<boolean> {
  if (!job.reservationId || job.articleId) return false;
  const reservation = await ctx.db.get(job.reservationId);
  if (
    reservation?.jobId === job._id &&
    reservation.type === "article_generated" &&
    reservation.state === "reserved"
  ) {
    await ctx.db.delete(reservation._id);
    return true;
  }
  return false;
}

async function raiseJobAlert(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  kind: string,
  message: string,
  details?: unknown,
) {
  const existing = await ctx.db
    .query("autopilot_alerts")
    .withIndex("by_site_kind_status", (q) =>
      q.eq("siteId", siteId).eq("kind", kind).eq("status", "active"),
    )
    .first();
  const updatedAt = now();
  if (existing) {
    await ctx.db.patch(existing._id, { message, details, updatedAt });
  } else {
    await ctx.db.insert("autopilot_alerts", {
      siteId,
      kind,
      status: "active",
      message,
      details,
      createdAt: updatedAt,
      updatedAt,
    });
  }
}

export const listPending = internalQuery({
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    return jobs.filter((job) => !onboardingClaimOwnsLifecycle(job));
  },
});

export const listPendingBySite = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const currentTime = now();
    const [site, jobs] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "pending"),
        )
        .collect(),
    ]);
    return jobs.filter(
      (job) =>
        !onboardingClaimOwnsLifecycle(job) &&
        jobAuthorizedForExecution(site, job) &&
        (job.nextAttemptAt === undefined || job.nextAttemptAt <= currentTime),
    );
  },
});

export const listActiveBySite = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const [site, pending, running] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "pending"),
        )
        .collect(),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "running"),
        )
        .collect(),
    ]);
    return [...pending, ...running].filter((job) =>
      jobAuthorizedForExecution(site, job),
    );
  },
});

// Operator-safe view of growth planning. Never return the worker lease token,
// provider error body, or arbitrary payload fields from a live job.
export const listGrowthPlanStatus = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_site_type_created", (q) =>
        q.eq("siteId", siteId).eq("type", "plan")
      )
      .order("desc")
      .take(20);
    return jobs
      .filter((job) => {
        const payload = job.payload && typeof job.payload === "object"
          ? (job.payload as Record<string, unknown>)
          : {};
        return payload.reason === "seo_growth_support_replenishment";
      })
      .map((job) => ({
        jobId: job._id,
        status: job.status,
        progress: job.stepProgress,
        result: job.status === "done" ? job.result : undefined,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      }));
  },
});

export const countRecentTopicReplenishments = internalQuery({
  args: { siteId: v.id("sites"), since: v.number() },
  handler: async (ctx, { siteId, since }) => {
    const recentPlans = await ctx.db
      .query("jobs")
      .withIndex("by_site_type_created", (q) =>
        q.eq("siteId", siteId).eq("type", "plan").gte("createdAt", since),
      )
      .take(50);
    return recentPlans.filter((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : undefined;
      return payload?.reason === "topic_overlap_replenishment";
    }).length;
  },
});

export const listAll = query({
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const jobs = (
      await Promise.all(
        sites.map((site) =>
          ctx.db
            .query("jobs")
            .withIndex("by_site", (q) => q.eq("siteId", site._id))
            .order("desc")
            .take(50),
        ),
      )
    ).flat();
    return jobs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  },
});

export const listByStatus = internalQuery({
  args: { status: v.string() },
  handler: async (ctx, { status }) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
  },
});

// Reclaim only expired worker leases. Resetting a job invalidates the old token
// before another worker can claim it. Exhausted leases become terminal instead
// of remaining "running" forever and deadlocking the tenant scheduler.
export const resetStuckJobs = internalMutation({
  args: { siteId: v.optional(v.id("sites")) },
  handler: async (ctx, { siteId }) => {
    const currentTime = now();
    const legacyStaleAt = currentTime - JOB_LEASE_MS;
    let reset = 0;
    let terminal = 0;
    let reservationsReleased = 0;

    const runningJobs = siteId
      ? await ctx.db
          .query("jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", "running"),
          )
          .collect()
      : await ctx.db
          .query("jobs")
          .withIndex("by_status", (q) => q.eq("status", "running"))
          .collect();
    
    for (const job of runningJobs) {
      if (onboardingClaimOwnsLifecycle(job)) continue;
      const expired = job.leaseExpiresAt !== undefined
        ? job.leaseExpiresAt <= currentTime
        : job.updatedAt <= legacyStaleAt;
      if (!expired) continue;

      // A crashed lease is an ambiguous paid execution. Keep its immutable
      // attempt receipt before the quota reservation is released or the job
      // ordinal advances; the retry must acquire a fresh bounded receipt.
      await settleArticleProviderAttempt(ctx, job, "ambiguous", currentTime);
      const attempts = (job.workerAttempts ?? 0) + 1;
      if (await releaseReservedUsage(ctx, job)) reservationsReleased += 1;
      const ownershipReset = {
        workerToken: undefined,
        heartbeatAt: undefined,
        leaseExpiresAt: undefined,
        reservationId: job.articleId ? job.reservationId : undefined,
        updatedAt: currentTime,
      };
      if (job.type === "plan") {
        await ctx.db.patch(job._id, {
          ...ownershipReset,
          status: "failed",
          nextAttemptAt: undefined,
          workerAttempts: attempts,
          error:
            "Plan worker lease expired after provider work may have started; paid state is ambiguous and automatic replay is forbidden.",
        });
        await activateTerminalPlanCheckpoints(ctx, job._id, currentTime);
        await wakeCurrentOneSetupExecutionForTerminalPlan(ctx, job);
        terminal += 1;
        if (job.siteId) {
          await raiseJobAlert(
            ctx,
            job.siteId,
            "plan_spend_ambiguous",
            "A topic plan lost its worker lease after paid work may have started; it was stopped without replay.",
            { jobId: job._id, attempts },
          );
          if (isUnderfilledPlanContinuationPayload(job.payload)) {
            await ctx.scheduler.runAfter(
              0,
              internal.autopilot.dispatchSiteFollowup,
              {
                siteId: job.siteId,
                trigger: "underfilled_plan_settled",
                reason:
                  "Continuation lease became ambiguous; using only the verified first-execution inventory.",
              },
            );
          }
        }
        await reconcileJobTopicLifecycle(ctx, job);
        continue;
      }
      if (attempts <= MAX_JOB_ATTEMPTS) {
        await ctx.db.patch(job._id, {
          ...ownershipReset,
          status: "pending",
          nextAttemptAt: currentTime + attempts * 60_000,
          workerAttempts: attempts,
          error: `Worker lease expired; retry ${attempts}/${MAX_JOB_ATTEMPTS} is delayed and eligible to resume.`,
        });
        reset += 1;
      } else {
        await ctx.db.patch(job._id, {
          ...ownershipReset,
          status: "failed",
          nextAttemptAt: undefined,
          workerAttempts: attempts,
          error: `Worker lease exhausted after ${attempts} attempts; terminal failure requires operator review.`,
        });
        terminal += 1;
        if (job.siteId) {
          await raiseJobAlert(
            ctx,
            job.siteId,
            "job_lease_exhausted",
            "A content worker exhausted its lease retries and was moved to terminal failure.",
            { jobId: job._id, attempts, reservationsReleased },
          );
        }
      }
      await reconcileJobTopicLifecycle(ctx, job);
    }

    return { reset, terminal, reservationsReleased };
  },
});

// A manually invoked parent action can hit Convex's request deadline while a
// nested worker is between heartbeats. Recover only the exact observed lease,
// only after it has been stale for five minutes, so an operator cannot reset a
// worker that has since made progress.
export const recoverParentTimeoutJob = internalMutation({
  args: {
    jobId: v.id("jobs"),
    expectedHeartbeatAt: v.number(),
  },
  handler: async (ctx, { jobId, expectedHeartbeatAt }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status !== "running") {
      return { recovered: false, reason: "not_running" as const };
    }
    if (job.heartbeatAt !== expectedHeartbeatAt) {
      return { recovered: false, reason: "lease_changed" as const };
    }
    const currentTime = now();
    if (currentTime - expectedHeartbeatAt < 5 * 60 * 1000) {
      return { recovered: false, reason: "heartbeat_too_fresh" as const };
    }
    await settleArticleProviderAttempt(ctx, job, "ambiguous", currentTime);
    await releaseReservedUsage(ctx, job);
    const attempts = (job.workerAttempts ?? 0) + 1;
    if (job.type === "plan") {
      await ctx.db.patch(jobId, {
        status: "failed",
        workerAttempts: attempts,
        error:
          "Plan parent timed out after provider work may have started; paid state is ambiguous and automatic replay is forbidden.",
        nextAttemptAt: undefined,
        workerToken: undefined,
        heartbeatAt: undefined,
        leaseExpiresAt: undefined,
        updatedAt: currentTime,
      });
      await activateTerminalPlanCheckpoints(ctx, jobId, currentTime);
      await reconcileJobTopicLifecycle(ctx, job);
      if (
        job.siteId &&
        isUnderfilledPlanContinuationPayload(job.payload)
      ) {
        await ctx.scheduler.runAfter(
          0,
          internal.autopilot.dispatchSiteFollowup,
          {
            siteId: job.siteId,
            trigger: "underfilled_plan_settled",
            reason:
              "Continuation parent timed out ambiguously; using only the verified first-execution inventory.",
          },
        );
      }
      return {
        recovered: false,
        reason: "plan_spend_ambiguous" as const,
        attempts,
      };
    }
    await ctx.db.patch(jobId, {
      status: "pending",
      workerAttempts: attempts,
      error:
        "Recovered an abandoned nested worker after its parent action exceeded the request deadline.",
      nextAttemptAt: currentTime,
      reservationId: job.articleId ? job.reservationId : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    return { recovered: true, attempts };
  },
});

export const cleanupExpiredGenerationReservations = internalMutation({
  args: {},
  handler: async (ctx) => {
    const currentTime = now();
    const [expired, expiredProviderAttempts] = await Promise.all([
      ctx.db
      .query("usage_log")
      .withIndex("by_state_expires", (q) =>
        q.eq("state", "reserved").lt("expiresAt", currentTime),
      )
      .take(50),
      ctx.db
        .query("article_generation_attempts")
        .withIndex("by_status_expires", (q) =>
          q.eq("status", "reserved").lt("expiresAt", currentTime)
        )
        .take(50),
    ]);
    let deleted = 0;
    for (const reservation of expired) {
      const job = reservation.jobId ? await ctx.db.get(reservation.jobId) : null;
      if (
        job &&
        job.reservationId === reservation._id &&
        job.status === "running" &&
        (job.leaseExpiresAt ?? 0) > currentTime
      ) {
        await ctx.db.patch(reservation._id, {
          expiresAt: (job.leaseExpiresAt ?? currentTime) + 5 * 60 * 1000,
        });
        continue;
      }
      if (
        !job ||
        job.articleId ||
        job.reservationId !== reservation._id ||
        job.status !== "running" ||
        (job.leaseExpiresAt ?? 0) <= currentTime
      ) {
        await ctx.db.delete(reservation._id);
        if (job?.reservationId === reservation._id && !job.articleId) {
          await ctx.db.patch(job._id, {
            reservationId: undefined,
            updatedAt: currentTime,
          });
        }
        deleted += 1;
      }
    }
    let providerAttemptsSettled = 0;
    for (const attempt of expiredProviderAttempts) {
      const jobId = ctx.db.normalizeId("jobs", attempt.jobKey);
      const job = jobId ? await ctx.db.get(jobId) : null;
      const stillOwned = Boolean(
        job &&
        job.status === "running" &&
        (job.leaseExpiresAt ?? 0) > currentTime &&
        articleGenerationAttemptKey(
          String(job._id),
          job.workerAttempts ?? 0,
        ) === attempt.attemptKey,
      );
      if (stillOwned && job) {
        await ctx.db.patch(attempt._id, {
          expiresAt: currentTime + ARTICLE_PROVIDER_ATTEMPT_LEASE_MS,
          updatedAt: currentTime,
        });
        continue;
      }
      await ctx.db.patch(attempt._id, {
        status: "ambiguous",
        expiresAt: undefined,
        settledAt: currentTime,
        articleKey: job?.articleId ? String(job.articleId) : undefined,
        updatedAt: currentTime,
      });
      providerAttemptsSettled += 1;
    }
    return {
      inspected: expired.length,
      deleted,
      providerAttemptsInspected: expiredProviderAttempts.length,
      providerAttemptsSettled,
    };
  },
});

export const create = internalMutation({
  args: {
    siteId: v.optional(v.id("sites")),
    type: v.string(),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, { siteId, type, payload }) => {
    const allowedTypes = new Set(["onboarding", "plan", "article", "links", "scheduler"]);
    if (!allowedTypes.has(type)) throw new Error("Unsupported job type");
    const site = siteId ? await ctx.db.get(siteId) : null;
    if (siteId && !site) throw new Error("Site not found");
    const record = payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : undefined;
    if (record?.topicId) {
      const topicId = ctx.db.normalizeId("topic_clusters", String(record.topicId));
      const topic = topicId ? await ctx.db.get(topicId) : null;
      if (!topic || !siteId || topic.siteId !== siteId) {
        throw new Error("Topic does not belong to the job site");
      }
      if (!site || !topicMatchesCurrentDomain(site, topic)) {
        throw new Error("Topic belongs to an earlier site domain");
      }
      if (type === "article" && topicUnavailableForArticleQueue(topic)) {
        throw new Error("Plan checkpoint topic is not article inventory");
      }
    }
    if (record?.articleId) {
      const articleId = ctx.db.normalizeId("articles", String(record.articleId));
      const article = articleId ? await ctx.db.get(articleId) : null;
      if (!article || !siteId || article.siteId !== siteId) {
        throw new Error("Article does not belong to the job site");
      }
      if (!site || !articleMatchesCurrentDomain(site, article)) {
        throw new Error("Article belongs to an earlier site domain");
      }
    }
    return await ctx.db.insert("jobs", {
      siteId,
      type,
      status: "pending",
      payload,
      ...(site ? rolloutFields(site, payload?.manual === true) : {}),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });
  },
});

async function activeJobsForSite(ctx: MutationCtx, siteId: Id<"sites">) {
  const [site, pending, running] = await Promise.all([
    ctx.db.get(siteId),
    ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "pending"),
      )
      .collect(),
    ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "running"),
      )
      .collect(),
  ]);
  return [...pending, ...running].filter((job) =>
    jobAuthorizedForExecution(site, job),
  );
}

function topicUnavailableForArticleQueue(topic: Doc<"topic_clusters">): boolean {
  return planCheckpointTopicExecutionLocked(topic);
}

async function jobArtifactsMatchCurrentDomain(
  ctx: MutationCtx,
  site: Doc<"sites"> | null,
  job: Doc<"jobs"> | null,
): Promise<boolean> {
  if (!site || !job) return false;
  const payload = job.payload && typeof job.payload === "object"
    ? job.payload as Record<string, unknown>
    : {};
  if (job.type === "article" && payload.topicId) {
    const topicId = ctx.db.normalizeId(
      "topic_clusters",
      String(payload.topicId),
    );
    const topic = topicId ? await ctx.db.get(topicId) : null;
    if (
      !topic ||
      topic.siteId !== site._id ||
      !topicMatchesCurrentDomain(site, topic)
    ) return false;
  }
  const rawArticleIds = job.type === "article"
    ? [payload.articleId, job.articleId]
    : job.type === "plan"
    ? [payload.growthParentArticleId]
    : [];
  const normalizedArticleIds = rawArticleIds
    .filter((value): value is string => typeof value === "string");
  for (const rawArticleId of normalizedArticleIds) {
    const articleId = ctx.db.normalizeId("articles", String(rawArticleId));
    const article = articleId ? await ctx.db.get(articleId) : null;
    if (
      !article ||
      article.siteId !== site._id ||
      !articleMatchesCurrentDomain(site, article)
    ) return false;
  }
  return true;
}

// The topic transition and job insert share one serializable mutation. Two
// overlapping cadence ticks therefore cannot enqueue the same topic twice.
export const queueTopicArticleIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    topicId: v.id("topic_clusters"),
    bufferFill: v.boolean(),
    manual: v.optional(v.boolean()),
    options: v.optional(v.any()),
    cadenceMicroSeedJobId: v.optional(v.id("cadence_micro_seed_jobs")),
  },
  handler: async (
    ctx,
    {
      siteId,
      topicId,
      bufferFill,
      manual,
      options,
      cadenceMicroSeedJobId,
    },
  ) => {
    const timestamp = now();
    const [site, topic, cadenceMicroSeedJob] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db.get(topicId),
      cadenceMicroSeedJobId
        ? ctx.db.get(cadenceMicroSeedJobId)
        : Promise.resolve(null),
    ]);
    if (!site || !topic || topic.siteId !== siteId) {
      throw new Error("Topic does not belong to the site");
    }
    if (manual && cadenceMicroSeedJobId) {
      return { queued: false, reason: "manual_micro_seed_handoff_forbidden" as const };
    }
    if (!topicMatchesCurrentDomain(site, topic)) {
      return { queued: false, reason: "topic_domain_stale" as const };
    }
    if (topicUnavailableForArticleQueue(topic)) {
      return { queued: false, reason: "topic_checkpoint_locked" as const };
    }

    // A micro-seed has already spent its bounded discovery/evidence budget.
    // Its exact topic is therefore a continuation of the same cadence attempt,
    // not a fresh candidate. Validate that immutable boundary here, in the
    // same transaction that queues the article, so only the generic daily
    // candidate-attempt budget is bypassed. Every authority, quota, evidence,
    // overlap, buffer and rollout fence below remains fail closed.
    if (cadenceMicroSeedJobId) {
      if (
        !cadenceMicroSeedJob ||
        cadenceMicroSeedJob.siteId !== siteId ||
        cadenceMicroSeedJob.topicId !== topicId ||
        !cadenceMicroSeedScheduleHandoffAllowed({
          status: cadenceMicroSeedJob.status,
          errorCode: cadenceMicroSeedJob.errorCode,
          policyVersion: cadenceMicroSeedJob.policyVersion,
          handoffVersion:
            cadenceMicroSeedJob.cadenceScheduleHandoffVersion,
        }) ||
        cadenceMicroSeedJob.createdAt > timestamp + 60_000 ||
        timestamp - cadenceMicroSeedJob.createdAt >
          CADENCE_MICRO_SEED_MAX_CADENCE_HORIZON_MS ||
        cadenceMicroSeedJob.rolloutEpoch !==
          (site.autopilotRolloutEpoch ?? 0) ||
        cadenceMicroSeedJob.policyVersion !== CADENCE_MICRO_SEED_VERSION ||
        topic.cadenceMicroSeedVersion !== CADENCE_MICRO_SEED_VERSION ||
        topic.cadenceMicroSeedJobId !== cadenceMicroSeedJob._id ||
        topic.cadenceMicroSeedFingerprint !==
          cadenceMicroSeedJob.topicFingerprint ||
        !cadenceMicroSeedJob.selectedCandidate ||
        normalizeCadenceMicroSeedText(topic.primaryKeyword) !==
          normalizeCadenceMicroSeedText(
            cadenceMicroSeedJob.selectedCandidate.keyword,
          ) ||
        site.autopilotEnabled !== true ||
        (site.cadencePerWeek ?? 0) <= 0 ||
        !["warm", "live"].includes(site.autopilotRolloutMode ?? "") ||
        site.expectedClickSchedulingEnabled !== true ||
        !verifiedKeywordPlanningActive(site)
      ) {
        return { queued: false, reason: "micro_seed_handoff_scope_changed" as const };
      }
      const evidence = cadenceMicroSeedJob.evidenceJobId
        ? await ctx.db.get(cadenceMicroSeedJob.evidenceJobId)
        : null;
      const selectedEvidence = evidence?.selectedTopics[0];
      if (
        !evidence ||
        evidence.siteId !== siteId ||
        evidence.userId !== cadenceMicroSeedJob.userId ||
        evidence.policyVersion !== EXPECTED_CLICK_EVIDENCE_BACKFILL_VERSION ||
        evidence.origin !== "operator_canary" ||
        evidence.reservationDay !== cadenceMicroSeedJob.reservationDay ||
        evidence.rolloutEpoch !== cadenceMicroSeedJob.rolloutEpoch ||
        evidence.selectionScope !== "planned_unmaterialized" ||
        evidence.status !== "completed" ||
        evidence.persistedTopics !== 1 ||
        evidence.providerCallsAttempted <= 0 ||
        evidence.providerCallsAttempted !== evidence.providerCallsCompleted ||
        evidence.selectedTopics.length !== 1 ||
        selectedEvidence?.topicId !== topicId ||
        selectedEvidence.targetKind !== "planned_topic" ||
        selectedEvidence.plannedTopicFingerprint !==
          cadenceMicroSeedJob.plannedEvidenceFingerprint
      ) {
        return { queued: false, reason: "micro_seed_evidence_changed" as const };
      }
    }
    const active = await activeJobsForSite(ctx, siteId);
    const duplicate = active.find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return job.type === "article" && payload.topicId === topicId;
    });
    if (duplicate) {
      if (cadenceMicroSeedJob) {
        const alerts = await ctx.db.query("autopilot_alerts")
          .withIndex("by_site_kind_status", (q) => q
            .eq("siteId", siteId)
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
        await ctx.db.patch(cadenceMicroSeedJob._id, {
          status: "completed",
          cadenceScheduleAttempts:
            (cadenceMicroSeedJob.cadenceScheduleAttempts ?? 0) + 1,
          cadenceScheduleMode:
            `exact_micro_seed_handoff_v${CADENCE_MICRO_SEED_SCHEDULE_HANDOFF_VERSION}`,
          cadenceScheduleScheduled: 1,
          cadenceScheduleReceiptAt: timestamp,
          cadenceScheduleHandoffVersion:
            CADENCE_MICRO_SEED_SCHEDULE_HANDOFF_VERSION,
          errorCode: undefined,
          completedAt: timestamp,
          updatedAt: timestamp,
        });
      }
      return { queued: false, jobId: duplicate._id, alreadyQueued: true as const };
    }
    if (
      cadenceMicroSeedJob &&
      active.some((job) => job.type === "article" || job.type === "plan")
    ) {
      return { queued: false, reason: "content_work_in_progress" as const };
    }
    if (topic.status === "disqualified") {
      return { queued: false, reason: "topic_business_fit_failed" as const };
    }
    if (
      !manual &&
      ["used", "queued", "cannibalizing"].includes(topic.status ?? "")
    ) {
      return { queued: false, reason: "topic_not_available" as const };
    }

    if (cadenceMicroSeedJob) {
      const allowance = await currentSitePlanAllowance(ctx, site);
      if (!allowance.ok) {
        return { queued: false, reason: "site_plan_allowance_inactive" as const };
      }
      if (
        !await accountHasArticleHeadroom(
          ctx,
          site.userId!,
          allowance.limits.maxArticles,
          timestamp,
        )
      ) {
        return { queued: false, reason: "article_quota_reached" as const };
      }
      const [readySummaries, publishedSummaries, growthGoal] = await Promise.all([
        takeCurrentDomainArticleSummariesByStatus(
          ctx,
          site,
          "ready",
          PLAN_TARGET_INVENTORY_READ_LIMIT + 1,
        ),
        takeCurrentDomainArticleSummariesByStatus(
          ctx,
          site,
          "published",
          PLAN_TARGET_INVENTORY_READ_LIMIT + 1,
        ),
        ctx.db.query("seo_growth_goals")
          .withIndex("by_site", (q) => q.eq("siteId", siteId))
          .unique(),
      ]);
      if (
        readySummaries.length > PLAN_TARGET_INVENTORY_READ_LIMIT ||
        publishedSummaries.length > PLAN_TARGET_INVENTORY_READ_LIMIT
      ) {
        return { queued: false, reason: "micro_seed_handoff_read_limit" as const };
      }
      const readiness = evaluateSchedulerReadyTopicInventory({
        topics: [topic],
        site,
        monthlyOrganicClickGoal:
          growthGoal?.monthlyOrganicClicksGoal ??
          DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
        currentLocationCode: dataForSeoLocationCode(site.targetCountry),
        currentLanguageCode: dataForSeoLanguageCode(site.language),
      });
      if (!readiness.schedulerReadyTopicIds.includes(String(topicId))) {
        return { queued: false, reason: "micro_seed_topic_not_scheduler_ready" as const };
      }
      const summaries = [...readySummaries, ...publishedSummaries];
      const coveredTopicIds = [...new Set(summaries.flatMap((article) =>
        article.topicId ? [String(article.topicId)] : []
      ))];
      const coveredTopicRows = await Promise.all(coveredTopicIds.map(
        (rawTopicId) => {
          const coveredTopicId = ctx.db.normalizeId(
            "topic_clusters",
            rawTopicId,
          );
          return coveredTopicId ? ctx.db.get(coveredTopicId) : null;
        },
      ));
      const covered = coveredIntentTopics(
        [topic, ...coveredTopicRows.filter(
          (candidate): candidate is Doc<"topic_clusters"> =>
            Boolean(candidate && candidate.siteId === siteId),
        )].map((candidate) => ({
            _id: String(candidate._id),
            status: candidate.status ?? "planned",
            primaryKeyword: candidate.primaryKeyword,
            serpTopUrls: candidate.serpTopUrls,
          })),
        summaries.map((article) => ({
          topicId: article.topicId ? String(article.topicId) : undefined,
          slug: article.slug,
          status: article.status,
          publicationGateStatus: article.publicationGateStatus,
          publicationAuditVersion: article.publicationAuditVersion,
          auditedContentHash: article.auditedContentHash,
        })),
      );
      if (
        !filterNonCannibalizingIntentTopics([topic], covered).some(
          (candidate) => candidate._id === topicId,
        )
      ) {
        return { queued: false, reason: "micro_seed_topic_overlap" as const };
      }
      const sealedBufferCount = readySummaries.filter(isSealedReady).length;
      if (
        sealedBufferCount >=
          approvedBufferPolicy(site.cadencePerWeek ?? 4).target
      ) {
        return { queued: false, reason: "buffer_full" as const };
      }
    }

    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: {
        topicId,
        bufferFill,
        manual: manual === true,
        options,
        ...(cadenceMicroSeedJobId ? { cadenceMicroSeedJobId } : {}),
      },
      ...rolloutFields(site, manual === true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.patch(topicId, { status: "queued", updatedAt: timestamp });
    if (cadenceMicroSeedJob) {
      const alerts = await ctx.db.query("autopilot_alerts")
        .withIndex("by_site_kind_status", (q) => q
          .eq("siteId", siteId)
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
      await ctx.db.patch(cadenceMicroSeedJob._id, {
        status: "completed",
        cadenceScheduleAttempts:
          (cadenceMicroSeedJob.cadenceScheduleAttempts ?? 0) + 1,
        cadenceScheduleMode:
          `exact_micro_seed_handoff_v${CADENCE_MICRO_SEED_SCHEDULE_HANDOFF_VERSION}`,
        cadenceScheduleScheduled: 1,
        cadenceScheduleReceiptAt: timestamp,
        cadenceScheduleHandoffVersion:
          CADENCE_MICRO_SEED_SCHEDULE_HANDOFF_VERSION,
        errorCode: undefined,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      // Enter through the ordinary durable run lifecycle instead of invoking
      // the worker directly. A direct worker without a runId can complete or
      // quarantine this candidate, but it does not own the scheduler
      // continuation that queues a bounded quality revision, delivery, or
      // buffer refill. The shared follow-up path records the run, claims this
      // exact already-queued job, and continues every terminal quality state.
      await ctx.scheduler.runAfter(
        0,
        internal.autopilot.dispatchSiteFollowup,
        {
          siteId,
          trigger: "cadence_micro_seed_handoff",
          reason: `exact_micro_seed_article_job_${jobId}`,
        },
      );
    }
    return { queued: true, jobId };
  },
});

export const queueManualArticleIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    options: v.optional(v.any()),
  },
  handler: async (ctx, { siteId, options }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    const active = await activeJobsForSite(ctx, siteId);
    const duplicate = active.find((job) => {
      if (job.type !== "article") return false;
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return payload.manual === true && !payload.topicId;
    });
    if (duplicate) return { queued: false, jobId: duplicate._id };
    const timestamp = now();
    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: { manual: true, options },
      ...rolloutFields(site, true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return { queued: true, jobId };
  },
});

export const queueQualityRetryIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    bufferFill: v.boolean(),
    metadataOnlyRepair: v.optional(v.boolean()),
    deterministicRepair: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    {
      siteId,
      articleId,
      bufferFill,
      metadataOnlyRepair,
      deterministicRepair,
    },
  ) => {
    const [article, site] = await Promise.all([
      ctx.db.get(articleId),
      ctx.db.get(siteId),
    ]);
    if (!site) throw new Error("Site not found");
    if (
      !article ||
      article.siteId !== siteId ||
      !articleMatchesCurrentDomain(site, article) ||
      article.status === "published"
    ) {
      throw new Error("Article is not eligible for quality recovery");
    }
    const markVersionedRecoveryAttempt = async (version: number) => {
      await ctx.db.patch(articleId, {
        qualityRecoveryAttemptVersion: version,
      });
      const summary = await ctx.db
        .query("article_summaries")
        .withIndex("by_article", (q) => q.eq("articleId", articleId))
        .first();
      if (summary) {
        await ctx.db.patch(summary._id, {
          qualityRecoveryAttemptVersion: version,
        });
      }
    };
    const markDeterministicRepairAttempt = async () => {
      await ctx.db.patch(articleId, {
        deterministicQualityRepairAttemptVersion:
          DETERMINISTIC_QUALITY_REPAIR_VERSION,
      });
      const summary = await ctx.db
        .query("article_summaries")
        .withIndex("by_article", (q) => q.eq("articleId", articleId))
        .first();
      if (summary) {
        await ctx.db.patch(summary._id, {
          deterministicQualityRepairAttemptVersion:
            DETERMINISTIC_QUALITY_REPAIR_VERSION,
        });
      }
    };
    if (
      article.auditedContentHash &&
      article.publicationAuditVersion === PUBLICATION_AUDIT_VERSION
    ) {
      return { queued: false, reason: "already_audited" as const };
    }
    const versionedQualityRecoveryVersion = qualityRecoveryTargetVersion(
      article,
    );
    const versionedQualityRecovery =
      versionedQualityRecoveryVersion !== undefined;
    if (
      (article.qualityRevisionCount ?? 0) >= MAX_QUALITY_REVISIONS &&
      !versionedQualityRecovery
    ) {
      return { queued: false, reason: "revision_limit" as const };
    }
    const active = await activeJobsForSite(ctx, siteId);
    const duplicate = active.find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return payload.qualityRetry === true && payload.articleId === articleId;
    });
    if (duplicate) return { queued: false, jobId: duplicate._id };
    if (metadataOnlyRepair || deterministicRepair || versionedQualityRecovery) {
      const priorAttempts = await ctx.db
        .query("jobs")
        .withIndex("by_article_created", (q) =>
          q.eq("articleId", articleId),
        )
        .order("desc")
        .collect();
      const alreadyAttemptedMechanicalRepair = priorAttempts.some((job) => {
        const payload = job.payload && typeof job.payload === "object"
          ? (job.payload as Record<string, unknown>)
          : {};
        return (
          (payload.metadataOnlyRepair === true ||
            payload.deterministicRepair === true) &&
          payload.articleId === articleId
        );
      });
      const alreadyAttemptedVersionedRecovery = versionedQualityRecovery &&
        hasAttemptedVersionedQualityRecovery(
          priorAttempts,
          String(articleId),
          versionedQualityRecoveryVersion,
        );
      if (alreadyAttemptedMechanicalRepair || alreadyAttemptedVersionedRecovery) {
        if (alreadyAttemptedMechanicalRepair) {
          await markDeterministicRepairAttempt();
        }
        if (alreadyAttemptedVersionedRecovery) {
          await markVersionedRecoveryAttempt(versionedQualityRecoveryVersion);
        }
        return { queued: false, reason: "already_attempted" as const };
      }
    }
    const timestamp = now();
    if (metadataOnlyRepair || deterministicRepair) {
      await markDeterministicRepairAttempt();
    }
    if (versionedQualityRecovery) {
      await markVersionedRecoveryAttempt(versionedQualityRecoveryVersion);
    }
    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: {
        articleId,
        qualityRetry: true,
        bufferFill,
        ...(metadataOnlyRepair ? { metadataOnlyRepair: true } : {}),
        ...(deterministicRepair ? { deterministicRepair: true } : {}),
        ...(versionedQualityRecovery
          ? { qualityRecoveryVersion: versionedQualityRecoveryVersion }
          : {}),
      },
      articleId,
      ...rolloutFields(site),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (article.topicId) {
      await reconcileTopicLifecycle(ctx, {
        siteId,
        topicId: article.topicId,
      });
    }
    return { queued: true, jobId };
  },
});

export const queuePlanIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    reason: v.optional(v.string()),
    cannibalizingTopicIds: v.optional(v.array(v.id("topic_clusters"))),
    since: v.optional(v.number()),
    maximumRecent: v.optional(v.number()),
    manual: v.optional(v.boolean()),
    growthParentArticleId: v.optional(v.id("articles")),
    growthSeed: v.optional(v.string()),
    growthActionFingerprint: v.optional(v.string()),
    growthMeasurementKey: v.optional(v.string()),
    oneSetupExecutionId: v.optional(v.id("one_setup_executions")),
    oneSetupClaimNonce: v.optional(v.string()),
    oneSetupConfigurationRevision: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site) throw new Error("Site not found");
    const setupBindingValues = [
      args.oneSetupExecutionId,
      args.oneSetupClaimNonce,
      args.oneSetupConfigurationRevision,
    ];
    const setupBindingCount = setupBindingValues.filter((value) =>
      value !== undefined
    ).length;
    if (setupBindingCount !== 0 && setupBindingCount !== setupBindingValues.length) {
      throw new Error("Incomplete one-setup plan binding");
    }
    const exactOneSetupBinding =
      setupBindingCount === setupBindingValues.length;
    // A parked site may still adopt and settle an already-paid exact setup
    // receipt. All ordinary queue paths and every new setup reservation remain
    // subject to the active/authorized gates below.
    if (!exactOneSetupBinding && !siteExecutionActive(site)) {
      throw new Error("Site not found");
    }
    let setupExecution: Doc<"one_setup_executions"> | null = null;
    let setupRequest: Doc<"managed_provisioning_requests"> | null = null;
    let setupInitialPlanGeneration: number | undefined;
    if (
      args.oneSetupExecutionId &&
      args.oneSetupClaimNonce &&
      args.oneSetupConfigurationRevision !== undefined
    ) {
      if (
        args.manual !== true ||
        args.reason !== "one_setup_initial_plan" ||
        args.growthParentArticleId ||
        args.growthSeed ||
        args.growthActionFingerprint ||
        (args.cannibalizingTopicIds?.length ?? 0) > 0
      ) {
        throw new Error("One-setup execution may queue only its initial manual plan");
      }
      setupExecution = await ctx.db.get(args.oneSetupExecutionId);
      const timestamp = now();
      setupRequest = setupExecution
        ? await ctx.db.get(setupExecution.requestId)
        : null;
      const currentCanonicalDomainRevision =
        siteCanonicalDomainRevision(site);
      const legacyUnstampedAllowed = siteUsesLegacyDomainReceipts(site);
      const deletionReceipt = site.userId
        ? await ctx.db
            .query("account_deletion_receipts")
            .withIndex("by_account_key", (q) =>
              q.eq("accountKey", accountDeletionKey(site.userId!))
            )
            .unique()
        : null;
      if (
        !setupExecution ||
        !setupRequest ||
        setupRequest.siteId !== args.siteId ||
        (setupRequest.configurationRevision ?? 0) !==
          args.oneSetupConfigurationRevision ||
        setupExecution.siteId !== args.siteId ||
        setupExecution.configurationRevision !==
          args.oneSetupConfigurationRevision ||
        setupExecution.claimNonce !== args.oneSetupClaimNonce ||
        (setupExecution.leaseExpiresAt ?? 0) <= timestamp ||
        !["running", "plan_queued"].includes(setupExecution.status) ||
        Boolean(site.deletionStatus) ||
        site.accountDeletionRequestedAt !== undefined ||
        Boolean(deletionReceipt) ||
        setupExecution.ownerAccountKey !== setupRequest.ownerAccountKey ||
        setupExecution.domainSnapshot !== setupRequest.domainSnapshot ||
        setupRequest.domainSnapshot !== siteCanonicalDomain(site) ||
        !site.userId ||
        setupRequest.ownerAccountKey !== accountDeletionKey(site.userId) ||
        setupRequest.contractVersion !== ONE_SETUP_CONTRACT_VERSION ||
        !oneSetupDomainRevisionReceiptMatches({
          currentCanonicalDomainRevision,
          receiptDomainRevision: setupRequest.domainRevisionSnapshot,
          legacyUnstampedAllowed,
        }) ||
        !oneSetupDomainRevisionReceiptMatches({
          currentCanonicalDomainRevision,
          receiptDomainRevision: setupExecution.domainRevisionSnapshot,
          legacyUnstampedAllowed,
        }) ||
        setupExecution.domainRevisionSnapshot !==
          setupRequest.domainRevisionSnapshot
      ) {
        throw new Error("One-setup execution claim is not current");
      }
      if (setupRequest.initialPlanQuarantineCode) {
        return {
          queued: false,
          reason: setupRequest.initialPlanQuarantineCode,
        };
      }
      if (setupExecution.planJobId) {
        const boundJob = await ctx.db.get(setupExecution.planJobId);
        const boundPayload = boundJob?.payload &&
            typeof boundJob.payload === "object"
          ? boundJob.payload as Record<string, unknown>
          : {};
        const stableRequestBinding = oneSetupInitialPlanJobBindingMatches({
          requestId: String(setupRequest._id),
          requestPlanJobId: setupRequest.initialPlanJobId
            ? String(setupRequest.initialPlanJobId)
            : undefined,
          requestReceiptVersion: setupRequest.initialPlanReceiptVersion,
          requestGeneration: setupRequest.initialPlanGeneration,
          jobId: String(boundJob?._id ?? ""),
          payloadRequestId: boundPayload.oneSetupRequestId,
          payloadReceiptVersion:
            boundPayload.oneSetupInitialPlanReceiptVersion,
          payloadGeneration: boundPayload.oneSetupInitialPlanGeneration,
          requestDomainRevisionSnapshot:
            setupRequest.domainRevisionSnapshot,
          payloadCanonicalDomainRevision:
            boundPayload.oneSetupCanonicalDomainRevision,
          currentCanonicalDomainRevision,
          legacyUnstampedAllowed,
        });
        if (
          !boundJob ||
          boundJob.siteId !== args.siteId ||
          boundJob.type !== "plan" ||
          boundPayload.manual !== true ||
          boundPayload.reason !== "one_setup_initial_plan" ||
          !stableRequestBinding
        ) {
          throw new Error("One-setup execution has an invalid plan binding");
        }
        await ctx.scheduler.runAfter(
          0,
          internal.oneSetupExecutions.reconcileCurrentPlanJob,
          { requestId: setupRequest._id, planJobId: boundJob._id },
        );
        return {
          queued: false,
          jobId: boundJob._id,
          reason: "setup_receipt" as const,
          jobStatus: boundJob.status,
        };
      }

      const initialPlanContextFingerprint =
        oneSetupInitialPlanContextFingerprint(site);
      const initialPlanReceipt = oneSetupInitialPlanReceiptDecision({
        storedVersion: setupRequest.initialPlanReceiptVersion,
        storedGeneration: setupRequest.initialPlanGeneration,
        storedContextFingerprint:
          setupRequest.initialPlanContextFingerprint,
        storedJobId: setupRequest.initialPlanJobId
          ? String(setupRequest.initialPlanJobId)
          : undefined,
        currentContextFingerprint: initialPlanContextFingerprint,
        hardReset: false,
      });
      setupInitialPlanGeneration = initialPlanReceipt.generation;
      if (initialPlanReceipt.reset) {
        await ctx.db.patch(setupRequest._id, {
          initialPlanReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
          initialPlanGeneration: initialPlanReceipt.generation,
          initialPlanContextFingerprint,
          initialPlanJobId: undefined,
          initialPlanBoundAt: undefined,
          initialPlanQuarantineCode: undefined,
          initialPlanQuarantinedAt: undefined,
          initialPlanRecoveryCount: 0,
        });
      } else if (initialPlanReceipt.adoptBoundJob) {
        const stableJob = await ctx.db.get(setupRequest.initialPlanJobId!);
        const stablePayload = stableJob?.payload &&
            typeof stableJob.payload === "object"
          ? stableJob.payload as Record<string, unknown>
          : {};
        if (
          !stableJob ||
          stableJob.siteId !== args.siteId ||
          stableJob.type !== "plan" ||
          stablePayload.manual !== true ||
          stablePayload.reason !== "one_setup_initial_plan" ||
          !oneSetupInitialPlanJobBindingMatches({
            requestId: String(setupRequest._id),
            requestPlanJobId: String(setupRequest.initialPlanJobId),
            requestReceiptVersion: setupRequest.initialPlanReceiptVersion,
            requestGeneration: setupRequest.initialPlanGeneration,
            jobId: String(stableJob?._id ?? ""),
            payloadRequestId: stablePayload.oneSetupRequestId,
            payloadReceiptVersion:
              stablePayload.oneSetupInitialPlanReceiptVersion,
            payloadGeneration: stablePayload.oneSetupInitialPlanGeneration,
            requestDomainRevisionSnapshot:
              setupRequest.domainRevisionSnapshot,
            payloadCanonicalDomainRevision:
              stablePayload.oneSetupCanonicalDomainRevision,
            currentCanonicalDomainRevision,
            legacyUnstampedAllowed,
          })
        ) {
          throw new Error("Stable one-setup initial-plan receipt is invalid");
        }
        await ctx.db.patch(setupExecution._id, {
          status: "plan_queued",
          planJobId: stableJob._id,
          blockerCode: undefined,
          updatedAt: timestamp,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.oneSetupExecutions.reconcileCurrentPlanJob,
          { requestId: setupRequest._id, planJobId: stableJob._id },
        );
        return {
          queued: false,
          jobId: stableJob._id,
          reason: "setup_receipt" as const,
          jobStatus: stableJob.status,
        };
      }
      // The action claim may have preceded a plan park, entitlement downgrade,
      // or deletion fence. Re-read the database-backed authorization inside
      // this reservation transaction after all stable-receipt adoption exits.
      // This read conflicts with a concurrent transition, so no new J or
      // provider reservation can commit against stale claim-time authority.
      if (!(await siteExecutionAuthorized(ctx, site))) {
        const denial = oneSetupQueueDenialDisposition({
          reason: "setup_execution_not_authorized",
          now: timestamp,
        });
        return {
          queued: false,
          reason: "setup_execution_not_authorized" as const,
          eligibleAt: denial.kind === "retry"
            ? denial.eligibleAt
            : undefined,
          terminalBlocker: denial.kind === "blocked" ? true : undefined,
        };
      }
    }
    const normalizedGrowthSeed = args.growthSeed?.trim();
    if (args.growthParentArticleId) {
      const parent = await ctx.db.get(args.growthParentArticleId);
      if (
        !parent ||
        parent.siteId !== args.siteId ||
        !articleMatchesCurrentDomain(site, parent) ||
        parent.status !== "published" ||
        !normalizedGrowthSeed ||
        normalizedGrowthSeed.length > 200 ||
        !args.growthActionFingerprint ||
        !args.growthMeasurementKey
      ) {
        throw new Error(
          "Growth planning requires a published same-tenant parent, seed, and action fingerprint",
        );
      }
      const action = await ctx.db
        .query("seo_growth_actions")
        .withIndex("by_fingerprint", (q) =>
          q.eq("fingerprint", args.growthActionFingerprint!)
        )
        .unique();
      if (
        !action ||
        action.siteId !== args.siteId ||
        action.articleId !== args.growthParentArticleId ||
        action.status !== "open" ||
        action.measurementKey !== args.growthMeasurementKey
      ) {
        throw new Error("Growth plan does not match an open measured action");
      }
      if (
        !site.autopilotEnabled ||
        !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe")
      ) {
        return { queued: false, reason: "autopilot_disabled" as const };
      }
    } else if (
      args.growthSeed ||
      args.growthActionFingerprint ||
      args.growthMeasurementKey
    ) {
      throw new Error("Incomplete growth planning context");
    }
    const active = await activeJobsForSite(ctx, args.siteId);
    const duplicate = active.find((job) => job.type === "plan");
    if (duplicate) return { queued: false, jobId: duplicate._id, reason: "active" as const };

    const timestamp = now();
    const automaticPlan = args.manual !== true;
    const automaticTopicPlan = automaticPlan &&
      args.reason?.startsWith("topic_") === true &&
      args.growthParentArticleId === undefined;
    let planYieldTarget: AutomaticPlanYieldTarget | undefined;
    let recentTopicPlans: Doc<"jobs">[] = [];

    if (automaticPlan) {
      if (
        !site.autopilotEnabled ||
        !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe")
      ) {
        return { queued: false, reason: "autopilot_disabled" as const };
      }
    }
    if (
      automaticTopicPlan &&
      site.expectedClickSchedulingEnabled === true
    ) {
      const allowance = await currentSitePlanAllowance(ctx, site);
      if (!allowance.ok) {
        return { queued: false, reason: "plan_entitlement_missing" as const };
      }
      const snapshot = await currentAutomaticPlanYieldTarget(
        ctx,
        site,
        allowance.limits,
        timestamp,
      );
      if (!snapshot.ready) {
        return { queued: false, reason: snapshot.reason };
      }
      if (snapshot.target.requiredVerifiedYield <= 0) {
        return {
          queued: false,
          reason: "verified_inventory_sufficient" as const,
          sealedBufferCount: snapshot.sealedBufferCount,
          verifiedHorizon: snapshot.verifiedHorizon,
        };
      }
      planYieldTarget = snapshot.target;
    }

    let recentCount = 0;
    if (args.reason && args.since !== undefined && args.maximumRecent !== undefined) {
      const recentRows = await ctx.db
        .query("jobs")
        .withIndex("by_site_type_created", (q) =>
          q.eq("siteId", args.siteId).eq("type", "plan").gte("createdAt", args.since!),
        )
        .order("desc")
        .take(TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT + 1);
      recentTopicPlans = recentRows.slice(0, 12);
      const recentWindow = evaluateBoundedRecentPlanWindow({
        rows: recentRows,
        maximumRecent: args.maximumRecent,
        isCounted: (job) => {
          if (!countsTowardTopicPlanRecentLimit(job)) return false;
          const payload = job.payload && typeof job.payload === "object"
            ? (job.payload as Record<string, unknown>)
            : {};
          const payloadReason = typeof payload.reason === "string"
            ? payload.reason
            : "";
          // All automatic topic-plan reasons share one tenant budget. Counting
          // only the exact reason allowed business-fit, evidence, overlap, and
          // horizon requests to bypass one another's paid recovery limit, while
          // also giving each reason an artificially tiny independent window.
          return args.reason?.startsWith("topic_") === true
            ? payloadReason.startsWith("topic_")
            : payloadReason === args.reason;
        },
      });
      if (recentWindow.decision === "invalid_limit") {
        return { queued: false, reason: "invalid_recent_limit" as const };
      }
      const countedRecent = recentWindow.counted;
      recentCount = countedRecent.length;
      // Payload reason and zero-spend release state are not indexed. Never
      // infer unused capacity from a truncated window: a counted plan hidden
      // behind non-counting rows could otherwise authorize another paid plan.
      if (recentWindow.decision === "overflow") {
        return {
          queued: false,
          reason: "recent_history_overflow" as const,
          recentLowerBound: recentCount,
          readLimit: TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT,
        };
      }
      if (recentWindow.decision === "limited") {
        const latestPlan: Doc<"jobs"> | undefined = countedRecent[0];
        let cooldownWake:
          | { scheduled: boolean; runId: Id<"autopilot_runs">; dueAt: number }
          | undefined;
        const dueAt = latestPlan
          ? topicPlanCooldownWakeAt(latestPlan.createdAt)
          : null;
        const rolloutEpoch = site.autopilotRolloutEpoch ?? 0;
        const claimNonce = latestPlan && dueAt !== null
          ? topicPlanCooldownClaimNonce({
              planJobId: String(latestPlan._id),
              rolloutEpoch,
              dueAt,
            })
          : null;
        if (
          automaticTopicPlan &&
          site.expectedClickSchedulingEnabled === true &&
          latestPlan?.siteId === args.siteId &&
          dueAt !== null &&
          claimNonce !== null &&
          dueAt > timestamp
        ) {
          const existingWake = await ctx.db
            .query("autopilot_runs")
            .withIndex("by_site_scheduled", (q) =>
              q.eq("siteId", args.siteId).eq("scheduledAt", dueAt)
            )
            .filter((q) =>
              q.eq(q.field("trigger"), TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER)
            )
            .first();
          if (existingWake) {
            if (existingWake.claimNonce === claimNonce) {
              cooldownWake = {
                scheduled: false,
                runId: existingWake._id,
                dueAt,
              };
            }
          } else {
            const runId = await ctx.db.insert("autopilot_runs", {
              siteId: args.siteId,
              trigger: TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
              claimNonce,
              scheduledAt: dueAt,
              heartbeatAt: timestamp,
              status: "scheduled",
              detail:
                "Exact topic-plan cooldown wake armed from the latest counted plan receipt.",
            });
            await ctx.scheduler.runAt(
              dueAt,
              internal.autopilot.claimTopicPlanCooldownWake,
              {
                siteId: args.siteId,
                runId,
                planJobId: latestPlan._id,
                rolloutEpoch,
                dueAt,
                claimNonce,
              },
            );
            cooldownWake = { scheduled: true, runId, dueAt };
          }
        }
        return {
          queued: false,
          reason: "recent_limit" as const,
          recent: recentCount,
          ...(latestPlan ? { cooldownPlanJobId: latestPlan._id } : {}),
          ...(cooldownWake
            ? {
                cooldownExpiresAt: cooldownWake.dueAt,
                cooldownWakeScheduled: cooldownWake.scheduled,
                cooldownWakeRunId: cooldownWake.runId,
              }
            : {}),
        };
      }
    }

    // The paid-window query above intentionally forgets rows after 24 hours;
    // adaptation must not. Read only the newest twelve durable plan receipts
    // so a semantic miss can rotate its next eligible discovery plan even
    // after the exact cooldown boundary has passed.
    if (automaticTopicPlan) {
      recentTopicPlans = await ctx.db
        .query("jobs")
        .withIndex("by_site_type_created", (q) =>
          q.eq("siteId", args.siteId).eq("type", "plan")
        )
        .order("desc")
        .take(12);
    }

    // A provider/budget failure with an exact future eligibility receipt must
    // not be turned into a tight release/requeue loop by the scheduler. The
    // mutation that recorded the failure also armed this exact deadline.
    const latestCadenceFailure = recentTopicPlans.find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? job.payload as Record<string, unknown>
        : {};
      return payload.manual !== true &&
        typeof payload.reason === "string" &&
        payload.reason.startsWith("topic_") &&
        payload.growthParentArticleId === undefined;
    })?.cadenceFailure;
    if (
      automaticTopicPlan &&
      latestCadenceFailure?.eligibleAt !== undefined &&
      latestCadenceFailure.eligibleAt > timestamp
    ) {
      return {
        queued: false,
        reason: "cadence_failure_cooldown" as const,
        failureCode: latestCadenceFailure.code,
        eligibleAt: latestCadenceFailure.eligibleAt,
      };
    }

    // Customer clicks, fleet planning, internal repairs, and authority-driven
    // replenishment all reserve from the same shared provider ledger.
    // "manual" controls rollout authorization only; it is never a spending
    // bypass. Reserve only after every no-provider gate so a rejected queue
    // request cannot consume capacity.
    const reservation = await reservePlanProviderBudget(ctx, site, timestamp);
    if (!reservation.ok) {
      const denial = setupExecution
        ? oneSetupQueueDenialDisposition({
          reason: reservation.reason,
          now: timestamp,
          retryAfterMs: reservation.retryAfterMs,
        })
        : null;
      return {
        queued: false,
        ...reservation,
        eligibleAt: denial?.kind === "retry"
          ? denial.eligibleAt
          : undefined,
        terminalBlocker: denial?.kind === "blocked" ? true : undefined,
      };
    }
    const {
      providerCostCeilingMicroUsd,
      providerCostReservedMicroUsd,
      providerCostReservationDay,
      providerSpendReservationId,
    } = reservation;

    for (const topicId of args.cannibalizingTopicIds ?? []) {
      const topic = await ctx.db.get(topicId);
      if (topic?.siteId === args.siteId && topic.status !== "used") {
        await ctx.db.patch(topicId, { status: "cannibalizing", updatedAt: now() });
      }
    }
    const cadenceRecoveryStrategy = automaticTopicPlan
      ? deriveCadenceRecoveryStrategy({
          recentPlans: recentTopicPlans,
          targetBufferShortfall:
            planYieldTarget?.targetBufferShortfall ?? TARGET_APPROVED_BUFFER,
          requiredVerifiedYield:
            planYieldTarget?.requiredVerifiedYield ??
              AUTOMATIC_PLAN_TOPIC_CAPACITY,
        })
      : undefined;
    const payload = args.reason || args.manual || args.growthParentArticleId
      ? {
          ...(args.reason ? {
            reason: args.reason,
            replenishmentSequence: recentCount + 1,
          } : {}),
          ...(args.manual === true ? { manual: true } : {}),
          ...(args.growthParentArticleId ? {
            growthParentArticleId: args.growthParentArticleId,
            growthSeed: normalizedGrowthSeed!,
            growthActionFingerprint: args.growthActionFingerprint!,
            growthMeasurementKey: args.growthMeasurementKey!,
          } : {}),
          ...(planYieldTarget ? { planYieldTarget } : {}),
          ...(cadenceRecoveryStrategy ? { cadenceRecoveryStrategy } : {}),
          ...(planYieldTarget &&
              site.expectedClickSchedulingEnabled === true
            ? {
                planCheckpointModeVersion:
                  PLAN_CHECKPOINT_SINGLE_EXECUTION_VERSION,
              }
            : {}),
          ...(setupExecution
            ? {
                oneSetupExecutionId: setupExecution._id,
                oneSetupConfigurationRevision:
                  setupExecution.configurationRevision,
                oneSetupRequestId: setupRequest!._id,
                oneSetupInitialPlanReceiptVersion:
                  ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
                oneSetupInitialPlanGeneration:
                  setupInitialPlanGeneration!,
                oneSetupCanonicalDomainRevision:
                  siteCanonicalDomainRevision(site),
              }
            : {}),
        }
      : undefined;
    const jobId = await ctx.db.insert("jobs", {
      siteId: args.siteId,
      type: "plan",
      status: "pending",
      payload,
      providerCostCeilingMicroUsd,
      providerCostReservedMicroUsd,
      providerCostReservationDay,
      providerSpendReservationId,
      ...rolloutFields(site, args.manual === true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (setupExecution) {
      await ctx.db.patch(setupRequest!._id, {
        initialPlanReceiptVersion: ONE_SETUP_INITIAL_PLAN_RECEIPT_VERSION,
        initialPlanGeneration: setupInitialPlanGeneration!,
        initialPlanContextFingerprint:
          oneSetupInitialPlanContextFingerprint(site),
        domainRevisionSnapshot: siteCanonicalDomainRevision(site),
        initialPlanJobId: jobId,
        initialPlanBoundAt: timestamp,
      });
      await ctx.db.patch(setupExecution._id, {
        status: "plan_queued",
        planJobId: jobId,
        domainRevisionSnapshot: siteCanonicalDomainRevision(site),
        blockerCode: undefined,
        updatedAt: timestamp,
      });
    }
    return { queued: true, jobId, recent: recentCount };
  },
});

/**
 * One explicitly operator-triggered bridge for a legacy tenant that has just
 * entered the expected-click rollout. Old plan rows are retained for audit and
 * continue to block every ordinary queue path. This mutation may discount only
 * rows that never carried the modern provider reservation contract, and may do
 * so once for the reviewed migration version.
 */
export const queueExpectedClickPlanMigrationAfterPreflight = internalMutation({
  args: {
    siteId: v.id("sites"),
    migrationVersion: v.number(),
  },
  handler: async (ctx, { siteId, migrationVersion }) => {
    if (migrationVersion !== EXPECTED_CLICK_PLAN_MIGRATION_VERSION) {
      throw new Error("Unsupported expected-click plan migration version");
    }
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) throw new Error("Site not found");
    if (site.expectedClickSchedulingEnabled !== true) {
      return {
        queued: false,
        reason: "expected_click_rollout_disabled" as const,
      };
    }
    if (!activeRollout(site)) {
      return { queued: false, reason: "autopilot_disabled" as const };
    }
    if (
      (site.expectedClickPlanMigrationVersion ?? 0) >= migrationVersion
    ) {
      return {
        queued: false,
        reason: "already_applied" as const,
        jobId: site.expectedClickPlanMigrationJobId,
        migrationVersion: site.expectedClickPlanMigrationVersion,
      };
    }

    const health = await ctx.db
      .query("autopilot_health")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .unique();
    if (health?.portfolioSupportsGoal !== false) {
      return {
        queued: false,
        reason: health?.portfolioSupportsGoal === true
          ? "portfolio_goal_supported" as const
          : "portfolio_not_evaluated" as const,
      };
    }

    const active = await activeJobsForSite(ctx, siteId);
    const duplicate = active.find((job) => job.type === "plan");
    if (duplicate) {
      return {
        queued: false,
        reason: "active" as const,
        jobId: duplicate._id,
      };
    }

    const timestamp = now();
    const reservation = await reservePlanProviderBudget(
      ctx,
      site,
      timestamp,
      { expectedClickMigrationVersion: migrationVersion },
    );
    if (!reservation.ok) {
      return { queued: false, ...reservation };
    }

    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "plan",
      status: "pending",
      payload: {
        manual: true,
        reason: `expected_click_plan_migration_v${migrationVersion}`,
        expectedClickPlanMigrationVersion: migrationVersion,
      },
      providerCostCeilingMicroUsd:
        reservation.providerCostCeilingMicroUsd,
      providerCostReservedMicroUsd:
        reservation.providerCostReservedMicroUsd,
      providerCostReservationDay: reservation.providerCostReservationDay,
      providerSpendReservationId: reservation.providerSpendReservationId,
      ...rolloutFields(site),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.db.patch(siteId, {
      expectedClickPlanMigrationVersion: migrationVersion,
      expectedClickPlanMigrationJobId: jobId,
      expectedClickPlanMigrationReservedAt: timestamp,
      updatedAt: timestamp,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.pipeline.processNextJob,
      { siteId, jobId },
    );
    return {
      queued: true,
      jobId,
      migrationVersion,
      providerCostReservedMicroUsd:
        reservation.providerCostReservedMicroUsd,
    };
  },
});

/**
 * Re-open only the reviewed expected-click migration zero-insert incident.
 *
 * The original immutable reservation contains exactly two $1 execution
 * allowances. A terminal first execution normally cannot be replayed. This
 * versioned bridge consumes the remaining allowance by moving workerAttempts
 * from 0 to 1, but only while every original tenant, marker, day, receipt, and
 * error invariant still matches. It never inserts or reserves anything new.
 */
export const recoverExpectedClickPlanMigrationAfterPreflight = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    migrationVersion: v.number(),
    recoveryVersion: v.number(),
  },
  handler: async (
    ctx,
    { siteId, jobId, migrationVersion, recoveryVersion },
  ) => {
    if (migrationVersion !== EXPECTED_CLICK_PLAN_MIGRATION_VERSION) {
      throw new Error("Unsupported expected-click plan migration version");
    }
    if (
      recoveryVersion !== EXPECTED_CLICK_PLAN_MIGRATION_RECOVERY_VERSION
    ) {
      throw new Error("Unsupported expected-click plan recovery version");
    }

    const [site, job] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db.get(jobId),
    ]);
    if (!siteExecutionActive(site)) throw new Error("Site not found");
    if (
      site.autopilotEnabled !== true ||
      site.autopilotRolloutMode !== "live" ||
      site.expectedClickSchedulingEnabled !== true
    ) {
      throw new Error(
        "Expected-click migration recovery requires a live tenant",
      );
    }
    if (!job || job.siteId !== siteId) {
      throw new Error("Expected-click migration recovery job was not found");
    }
    if (
      site.expectedClickPlanMigrationVersion !== migrationVersion ||
      site.expectedClickPlanMigrationJobId !== jobId ||
      site.expectedClickPlanMigrationReservedAt !== job.createdAt
    ) {
      throw new Error(
        "Expected-click migration recovery is not bound to the site marker",
      );
    }

    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    if (
      payload.expectedClickPlanMigrationVersion !== migrationVersion ||
      payload.reason !== `expected_click_plan_migration_v${migrationVersion}` ||
      payload.manual !== true
    ) {
      throw new Error(
        "Expected-click migration recovery job payload is not authorized",
      );
    }
    if (
      payload.expectedClickPlanMigrationRecoveryVersion === recoveryVersion
    ) {
      return {
        recovered: false,
        reason: "already_applied" as const,
        jobId,
        migrationVersion,
        recoveryVersion,
      };
    }
    if (
      payload.expectedClickPlanMigrationRecoveryVersion !== undefined
    ) {
      throw new Error(
        "Expected-click migration recovery marker conflicts with this version",
      );
    }

    if (
      job.type !== "plan" ||
      job.status !== "failed" ||
      (job.workerAttempts ?? 0) !== 0
    ) {
      throw new Error(
        "Expected-click migration recovery requires the untouched terminal job",
      );
    }
    if (
      job.rolloutEpoch !== (site.autopilotRolloutEpoch ?? 0) ||
      !isExpectedClickZeroInsertTerminalError(job.error)
    ) {
      throw new Error(
        "Expected-click migration recovery terminal signature is not recognized",
      );
    }

    const reservationDay = new Date(now()).toISOString().slice(0, 10);
    if (
      job.providerCostCeilingMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      job.providerCostReservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      job.providerCostReservationDay !== reservationDay ||
      job.providerReservationReleasedAt !== undefined ||
      job.providerReservationReleaseReason !== undefined ||
      !job.providerSpendReservationId
    ) {
      throw new Error(
        "Expected-click migration recovery reservation is missing or stale",
      );
    }
    const reservation = await ctx.db.get(job.providerSpendReservationId);
    if (
      !reservation ||
      reservation.siteId !== siteId ||
      reservation.userId !== site.userId ||
      reservation.purpose !== "topic_plan" ||
      reservation.trigger !==
        `expected_click_plan_migration_v${migrationVersion}` ||
      reservation.reservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      reservation.reservationDay !== reservationDay ||
      reservation.createdAt !== job.createdAt ||
      reservation.releasedAt !== undefined
    ) {
      throw new Error(
        "Expected-click migration recovery reservation receipt is not bound",
      );
    }

    const [pendingPlans, runningPlans, contemporaryPlans] = await Promise.all([
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "pending")
        )
        .collect(),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "running")
        )
        .collect(),
      ctx.db
        .query("jobs")
        .withIndex("by_site_type_created", (q) =>
          q
            .eq("siteId", siteId)
            .eq("type", "plan")
            .gte("createdAt", job.createdAt)
        )
        .collect(),
    ]);
    const newerPlan = contemporaryPlans.find((candidate) =>
      candidate._id !== jobId &&
      (
        candidate.createdAt > job.createdAt ||
        candidate._creationTime > job._creationTime
      )
    );
    if (
      [...pendingPlans, ...runningPlans].some((candidate) =>
        candidate.type === "plan" && candidate._id !== jobId
      ) || newerPlan
    ) {
      throw new Error(
        "Expected-click migration recovery is superseded by another plan",
      );
    }

    const recoveredAt = now();
    await ctx.db.patch(jobId, {
      status: "pending",
      payload: {
        ...payload,
        expectedClickPlanMigrationRecoveryVersion: recoveryVersion,
        expectedClickPlanMigrationRecoveredAt: recoveredAt,
      },
      // Consume the sole remaining execution allowance before scheduling.
      // processNextJob reports this as execution 2 and cannot schedule a third.
      workerAttempts: 1,
      error: undefined,
      cadenceFailure: undefined,
      result: undefined,
      stepProgress: undefined,
      nextAttemptAt: undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: recoveredAt,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.pipeline.processNextJob,
      { siteId, jobId },
    );
    return {
      recovered: true,
      jobId,
      migrationVersion,
      recoveryVersion,
      workerExecution: 2,
    };
  },
});

/**
 * Abort a plan whose free pre-provider fence failed before paid work.
 * Only a first execution can release capacity and roll back the migration
 * marker: after a prior worker failure, provider spend is ambiguous and the
 * original reservation remains consumed for audit safety.
 */
export const abortPlanForProviderBalance = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    releaseReason: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.type !== "plan" ||
      !ownsJob(job, args.workerToken)
    ) {
      return { updated: false, released: false, migrationRolledBack: false };
    }
    const releaseReason = args.releaseReason as ProviderReservationReleaseReason;
    if (
      releaseReason !== "provider_balance_insufficient" &&
      releaseReason !== "provider_balance_preflight_unavailable" &&
      releaseReason !== "plan_reservation_day_expired_before_execution" &&
      releaseReason !==
        "one_setup_planning_context_superseded_before_execution"
    ) {
      throw new Error("Unknown provider reservation release reason");
    }
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as { expectedClickPlanMigrationVersion?: number }
      : undefined;
    const firstExecution = (job.workerAttempts ?? 0) === 0;
    const timestamp = now();
    let released = false;
    if (firstExecution && job.providerSpendReservationId) {
      const [site, reservation] = await Promise.all([
        ctx.db.get(args.siteId),
        ctx.db.get(job.providerSpendReservationId),
      ]);
      const exactUntouchedReservation = Boolean(
        site?.userId && reservation &&
        reservation.siteId === args.siteId &&
        reservation.userId === site.userId &&
        reservation.purpose === "topic_plan" &&
        reservation.trigger ===
          topicPlanProviderReservationTriggerFromPayload(payload) &&
        reservation.createdAt === job.createdAt &&
        reservation.reservationDay === job.providerCostReservationDay &&
        reservation.reservedMicroUsd ===
          AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
        job.providerCostReservedMicroUsd ===
          AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
        job.providerCostCeilingMicroUsd ===
          AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD &&
        reservation.releasedAt === undefined
      );
      if (exactUntouchedReservation) {
        released = (await releaseSharedProviderReservation(ctx, {
          reservationId: job.providerSpendReservationId,
          siteId: args.siteId,
          purpose: "topic_plan",
          reason: releaseReason,
          timestamp,
        })).released;
      }
    }

    let migrationRolledBack = false;
    if (released && payload?.expectedClickPlanMigrationVersion !== undefined) {
      const site = await ctx.db.get(args.siteId);
      if (
        site?.expectedClickPlanMigrationJobId === args.jobId &&
        site.expectedClickPlanMigrationVersion ===
          payload.expectedClickPlanMigrationVersion &&
        site.expectedClickPlanMigrationReservedAt === job.createdAt
      ) {
        await ctx.db.patch(args.siteId, {
          expectedClickPlanMigrationVersion: undefined,
          expectedClickPlanMigrationJobId: undefined,
          expectedClickPlanMigrationReservedAt: undefined,
          updatedAt: timestamp,
        });
        migrationRolledBack = true;
      }
    }

    const failureMessage = releaseReason ===
        "plan_reservation_day_expired_before_execution"
      ? "The plan reservation expired before its first paid execution."
      : releaseReason ===
          "one_setup_planning_context_superseded_before_execution"
        ? "The saved setup planning context changed before paid topic planning."
        : "Provider account funding preflight blocked paid topic planning.";
    const cadenceFailure = classifyCadenceFailure({
      message: releaseReason,
      now: timestamp,
      // A raw legacy worker can lose its pre-provider currency race to the
      // first v1 save that atomically enriches that same J. Persist an
      // eligibility receipt so the migrated current binding may recover it;
      // failedPlanRecoveryDecision separately proves that the saved request
      // still owns this exact J/generation before permitting any successor.
      retryAt: releaseReason ===
          "one_setup_planning_context_superseded_before_execution"
        ? timestamp + CADENCE_PROVIDER_RECHECK_MS
        : undefined,
      explicitCode: releaseReason,
    });
    await ctx.db.patch(args.jobId, {
      status: "failed",
      error: failureMessage,
      cadenceFailure,
      providerReservationReleasedAt: released ? timestamp : undefined,
      providerReservationReleaseReason: released ? releaseReason : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: timestamp,
    });
    if (cadenceFailure.eligibleAt && cadenceFailure.eligibleAt > timestamp) {
      const existingWake = await ctx.db
        .query("autopilot_runs")
        .withIndex("by_site_scheduled", (q) =>
          q.eq("siteId", args.siteId).eq(
            "scheduledAt",
            cadenceFailure.eligibleAt!,
          )
        )
        .filter((q) =>
          q.eq(q.field("trigger"), "cadence_failure_deadline")
        )
        .first();
      if (!existingWake) {
        const runId = await ctx.db.insert("autopilot_runs", {
          siteId: args.siteId,
          trigger: "cadence_failure_deadline",
          scheduledAt: cadenceFailure.eligibleAt,
          heartbeatAt: timestamp,
          status: "scheduled",
          detail: `Exact cadence blocker deadline: ${cadenceFailure.code}.`,
        });
        await ctx.scheduler.runAt(
          cadenceFailure.eligibleAt,
          internal.actions.pipeline.autopilotTick,
          {
            siteId: args.siteId,
            runId,
            trigger: "cadence_failure_deadline",
          },
        );
      }
    }
    // Execution two may arrive here with an active execution-one checkpoint.
    // Its reservation is intentionally retained, so settle that durable paid
    // state through the operational terminal path instead of orphaning rows.
    const checkpointSettlement = firstExecution
      ? await terminallyClosePlanCheckpoints(
          ctx,
          args.jobId,
          timestamp,
          "plan_checkpoint_provider_preflight_blocked",
        )
      : await activateTerminalPlanCheckpoints(ctx, args.jobId, timestamp);
    await wakeCurrentOneSetupExecutionForTerminalPlan(ctx, job);
    return {
      updated: true,
      released,
      migrationRolledBack,
      checkpointSettlement,
    };
  },
});

export const queuePublicationIfAbsent = internalMutation({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
  },
  handler: async (ctx, { siteId, articleId }) => {
    const [article, site] = await Promise.all([
      ctx.db.get(articleId),
      ctx.db.get(siteId),
    ]);
    if (!site) throw new Error("Site not found");
    if (
      !article ||
      article.siteId !== siteId ||
      !articleMatchesCurrentDomain(site, article) ||
      article.status !== "ready" ||
      article.publicationGateStatus !== "passed" ||
      article.publicationAuditVersion !== PUBLICATION_AUDIT_VERSION ||
      !article.auditedContentHash
    ) {
      throw new Error("Only a strict-quality sealed ready article can enter the delivery queue");
    }
    const [pending, running] = await Promise.all([
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "pending"),
        )
        .collect(),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "running"),
        )
        .collect(),
    ]);
    const duplicate = [...pending, ...running].find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : undefined;
      return payload?.publishOnly === true;
    });
    if (duplicate) return { queued: false, jobId: duplicate._id };
    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: {
        articleId,
        publishOnly: true,
        bufferDelivery: true,
      },
      ...rolloutFields(site),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });
    if (!article.publicationDate) {
      await ctx.db.patch(articleId, { publicationDate: now(), updatedAt: now() });
    }
    return { queued: true, jobId };
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job?.siteId) return null;
    const site = await ctx.db.get(job.siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to access this job");
    }
    return job;
  },
});

export const getInternal = internalQuery({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => ctx.db.get(jobId),
});

export const markRunning = internalMutation({
  args: {
    jobId: v.id("jobs"),
    siteId: v.id("sites"),
    workerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const currentTime = now();
    const site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    const executionAuthorized = await siteExecutionAuthorized(ctx, site);
    const topicCurrent = await jobArtifactsMatchCurrentDomain(ctx, site, job);
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.status !== "pending" ||
      !executionAuthorized ||
      !topicCurrent ||
      !jobAuthorizedForExecution(site, job) ||
      (job.nextAttemptAt !== undefined && job.nextAttemptAt > currentTime)
    ) return null;
    await ctx.db.patch(args.jobId, {
      status: "running",
      workerToken: args.workerToken,
      heartbeatAt: currentTime,
      leaseExpiresAt: currentTime + JOB_LEASE_MS,
      nextAttemptAt: undefined,
      updatedAt: currentTime,
    });
    return { ...job, status: "running", workerToken: args.workerToken };
  },
});

// Atomically transition one exact pending job to running. Convex mutations are
// serializable, so overlapping natural/follow-up ticks cannot both claim the
// same generation job and consume duplicate provider/quota work.
export const claimPending = internalMutation({
  args: {
    jobId: v.id("jobs"),
    siteId: v.id("sites"),
    workerToken: v.string(),
  },
  handler: async (ctx, { jobId, siteId, workerToken }) => {
    const job = await ctx.db.get(jobId);
    const updatedAt = now();
    const site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    const executionAuthorized = await siteExecutionAuthorized(ctx, site);
    const topicCurrent = await jobArtifactsMatchCurrentDomain(ctx, site, job);
    const runningJobs = job
      ? await ctx.db
          .query("jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", "running"),
          )
          .collect()
      : [];
    const otherRunning = runningJobs.find(
      (candidate) =>
        candidate._id !== jobId &&
        jobAuthorizedForExecution(site, candidate),
    );
    if (
      !job ||
      job.siteId !== siteId ||
      job.status !== "pending" ||
      !executionAuthorized ||
      !topicCurrent ||
      !jobAuthorizedForExecution(site, job) ||
      otherRunning !== undefined ||
      (job.nextAttemptAt !== undefined && job.nextAttemptAt > updatedAt)
    ) {
      return null;
    }
    const leaseExpiresAt = updatedAt + JOB_LEASE_MS;
    await ctx.db.patch(jobId, {
      status: "running",
      workerToken,
      heartbeatAt: updatedAt,
      leaseExpiresAt,
      nextAttemptAt: undefined,
      updatedAt,
    });
    return {
      ...job,
      status: "running",
      workerToken,
      heartbeatAt: updatedAt,
      leaseExpiresAt,
      nextAttemptAt: undefined,
      updatedAt,
    };
  },
});

export const heartbeatWorker = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string() },
  handler: async (ctx, { jobId, workerToken }) => {
    const job = await ctx.db.get(jobId);
    const site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    const executionAuthorized = await siteExecutionAuthorized(ctx, site);
    const topicCurrent = await jobArtifactsMatchCurrentDomain(ctx, site, job);
    if (
      !job ||
      !ownsJob(job, workerToken) ||
      !executionAuthorized ||
      !topicCurrent ||
      !jobAuthorizedForExecution(site, job)
    ) return { owned: false };
    const currentTime = now();
    if (job.reservationId) {
      const reservation = await ctx.db.get(job.reservationId);
      if (reservation?.state === "reserved" && reservation.jobId === jobId) {
        await ctx.db.patch(reservation._id, {
          expiresAt: currentTime + JOB_LEASE_MS + 5 * 60 * 1000,
        });
      }
    }
    await renewArticleProviderAttempt(ctx, job, currentTime);
    await ctx.db.patch(jobId, {
      heartbeatAt: currentTime,
      leaseExpiresAt: currentTime + JOB_LEASE_MS,
      updatedAt: currentTime,
    });
    return { owned: true, leaseExpiresAt: currentTime + JOB_LEASE_MS };
  },
});

/**
 * Hand a completed draft checkpoint to a fresh action before the current
 * action reaches Convex's hard runtime ceiling. The generated article, quota
 * reservation, and provider-attempt receipt already belong to this exact job;
 * only the ephemeral worker lease changes. Scheduling the continuation in the
 * same transaction means an action response loss cannot leave a valid draft
 * waiting for the lease watchdog or the next fleet cadence.
 */
export const yieldGeneratedArticleForReview = internalMutation({
  args: {
    jobId: v.id("jobs"),
    siteId: v.id("sites"),
    workerToken: v.string(),
    articleId: v.id("articles"),
    runId: v.optional(v.id("autopilot_runs")),
    runClaimNonce: v.optional(v.string()),
    runContinuationAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const [job, site, article] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.siteId),
      ctx.db.get(args.articleId),
    ]);
    const payload = job?.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    if (
      !job ||
      !site ||
      !article ||
      job.siteId !== args.siteId ||
      job.type !== "article" ||
      !ownsJob(job, args.workerToken) ||
      job.articleId !== args.articleId ||
      payload.articleId !== args.articleId ||
      article.siteId !== args.siteId ||
      !articleMatchesCurrentDomain(site, article) ||
      !jobAuthorizedForExecution(site, job)
    ) {
      return { scheduled: false as const, reason: "checkpoint_fence_changed" as const };
    }
    const currentTime = now();
    const reviewCheckpointVersion = 1;
    await renewArticleProviderAttempt(ctx, job, currentTime);
    await ctx.db.patch(job._id, {
      status: "pending",
      payload: {
        ...payload,
        articleId: args.articleId,
        reviewCheckpointVersion,
        reviewCheckpointScheduledAt: currentTime,
      },
      error: undefined,
      cadenceFailure: undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: currentTime,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.pipeline.processNextJob,
      {
        siteId: args.siteId,
        jobId: args.jobId,
        ...(args.runId ? { runId: args.runId } : {}),
        ...(args.runClaimNonce
          ? { runClaimNonce: args.runClaimNonce }
          : {}),
        ...(args.runContinuationAttempt !== undefined
          ? { runContinuationAttempt: args.runContinuationAttempt }
          : {}),
      },
    );
    return {
      scheduled: true as const,
      reviewCheckpointVersion,
      scheduledAt: currentTime,
    };
  },
});

/**
 * Last database fence before a plan action may cross its paid provider
 * boundary. Ordinary plans are unchanged; every one-setup plan must carry the
 * request's current, migrated stable planning generation.
 */
export const authorizeOneSetupInitialPlanWorker = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    if (
      !site ||
      !job ||
      job.siteId !== args.siteId ||
      job.type !== "plan" ||
      !ownsJob(job, args.workerToken)
    ) {
      return {
        authorized: false as const,
        reason: "worker_lease_invalid" as const,
      };
    }
    const executionAuthorized = await siteExecutionAuthorized(ctx, site);
    if (!oneSetupPaidBoundaryLifecycleAllowed({
      siteExecutionAuthorized: executionAuthorized,
      accountDeletionRequestedAt: site.accountDeletionRequestedAt,
    })) {
      return {
        authorized: false as const,
        reason: "site_execution_not_authorized" as const,
      };
    }
    const currency = await oneSetupInitialPlanCurrency(ctx, { site, job });
    if (currency.kind === "stale") {
      return {
        authorized: false as const,
        reason: currency.reason,
      };
    }
    return { authorized: true as const, kind: currency.kind };
  },
});

export const reserveGenerationSlot = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    siteId: v.id("sites"),
  },
  handler: async (ctx, args) => {
    const [job, site] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.siteId),
    ]);
    if (
      !job || job.siteId !== args.siteId ||
      !ownsJob(job, args.workerToken) ||
      !site?.userId || site.deletionStatus || site.planParkedAt ||
      !jobAuthorizedForExecution(site, job)
    ) {
      return { ok: false, reason: "Worker lease lost" };
    }
    const allowance = await currentSitePlanAllowance(ctx, site);
    if (!allowance.ok) return allowance;
    const { limits } = allowance;
    if (job.articleId) {
      return { ok: true, reason: "Article checkpoint already exists", articleId: job.articleId };
    }
    const existingReservation = job.reservationId
      ? await ctx.db.get(job.reservationId)
      : null;
    const ownsExistingReservation = Boolean(
      existingReservation?.state === "reserved" &&
      existingReservation.jobId === job._id &&
      existingReservation.siteId === site._id &&
      existingReservation.userId === site.userId,
    );
    const currentTime = now();
    const date = new Date(currentTime);
    const monthStart = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1),
    ).getTime();
    const logs = await ctx.db
      .query("usage_log")
      .withIndex("by_user_type_created", (q) =>
        q
          .eq("userId", site.userId!)
          .eq("type", "article_generated")
          .gte("createdAt", monthStart),
      )
      .collect();
    const count = logs.filter(
      (log) => log.state !== "reserved" || (log.expiresAt ?? Infinity) > currentTime,
    ).length;
    if (
      ownsExistingReservation
        ? count > limits.maxArticles
        : count >= limits.maxArticles
    ) {
      return { ok: false, reason: `Limit reached (${count}/${limits.maxArticles})` };
    }
    if (ownsExistingReservation && existingReservation) {
        await ctx.db.patch(existingReservation._id, {
          expiresAt: currentTime + JOB_LEASE_MS + 5 * 60 * 1000,
        });
        return {
          ok: true,
          reason: "Existing reservation",
          reservationId: existingReservation._id,
        };
    }
    const reservationId = await ctx.db.insert("usage_log", {
      userId: site.userId,
      siteId: args.siteId,
      jobId: args.jobId,
      type: "article_generated",
      state: "reserved",
      expiresAt: currentTime + JOB_LEASE_MS + 5 * 60 * 1000,
      createdAt: currentTime,
    });
    await ctx.db.patch(args.jobId, { reservationId, updatedAt: currentTime });
    return { ok: true, reason: "", reservationId };
  },
});

/**
 * Reserve one exact provider-bearing worker execution. This is intentionally
 * separate from the successful article usage slot: failures and ambiguous
 * leases remain in this account-level ledger and cannot be erased by deleting
 * a site or releasing a pre-draft quota reservation.
 */
export const reserveArticleProviderAttempt = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    siteId: v.id("sites"),
    providerWorkKind: v.union(
      v.literal("generation"),
      v.literal("quality_review"),
      v.literal("internal_links"),
    ),
  },
  handler: async (ctx, args) => {
    const currentTime = now();
    const [job, site] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.siteId),
    ]);
    if (
      !job ||
      job.siteId !== args.siteId ||
      !ownsJob(job, args.workerToken) ||
      !job.leaseExpiresAt ||
      job.leaseExpiresAt <= currentTime ||
      !site?.userId ||
      !jobAuthorizedForExecution(site, job)
    ) {
      return { ok: false as const, reason: "worker_lease_lost" as const };
    }
    const allowance = await currentSitePlanAllowance(ctx, site);
    if (!allowance.ok) {
      return { ok: false as const, reason: "site_not_authorized" as const };
    }

    const workerAttempt = job.workerAttempts ?? 0;
    const attemptKey = articleGenerationAttemptKey(
      String(job._id),
      workerAttempt,
    );
    const existing = await ctx.db
      .query("article_generation_attempts")
      .withIndex("by_attempt_key", (q) => q.eq("attemptKey", attemptKey))
      .unique();
    const monthKey = articleGenerationAttemptMonth(currentTime);
    const attemptAllowance = articleGenerationAttemptAllowance(
      allowance.limits.maxArticles,
    );
    const accountAttempts = await ctx.db
      .query("article_generation_attempts")
      .withIndex("by_user_month", (q) =>
        q.eq("userId", site.userId!).eq("monthKey", monthKey)
      )
      .collect();
    // Concurrency spans the UTC month boundary. Monthly usage and active
    // leases are separate questions; a lease started at 23:59 must still
    // occupy the account slot after midnight.
    const activeAccountAttempts = await ctx.db
      .query("article_generation_attempts")
      .withIndex("by_user_status_expires", (q) =>
        q
          .eq("userId", site.userId!)
          .eq("status", "reserved")
          .gt("expiresAt", currentTime)
      )
      .take(ARTICLE_PROVIDER_ACCOUNT_CONCURRENCY);
    const activeFleetAttempts = await ctx.db
      .query("article_generation_attempts")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", "reserved").gt("expiresAt", currentTime)
      )
      .take(ARTICLE_PROVIDER_FLEET_CONCURRENCY);
    const decision = decideArticleProviderAdmission({
      existingStatus: existing?.status as
        | ArticleProviderAttemptStatus
        | undefined,
      existingOwnedByAccount: existing?.userId === site.userId,
      attemptsUsed: accountAttempts.length,
      attemptAllowance,
      activeAccountAttempts: activeAccountAttempts.length,
      activeFleetAttempts: activeFleetAttempts.length,
    });
    if (decision.status === "reuse" && existing) {
      await ctx.db.patch(existing._id, {
        status: "reserved",
        expiresAt: currentTime + ARTICLE_PROVIDER_ATTEMPT_LEASE_MS,
        updatedAt: currentTime,
      });
      return {
        ok: true as const,
        reused: true,
        attemptId: existing._id,
        attemptsUsed: undefined,
        attemptAllowance: existing.attemptAllowance,
      };
    }
    if (decision.status === "reject") {
      if (
        decision.reason === "account_concurrency" ||
        decision.reason === "fleet_concurrency"
      ) {
        return {
          ok: false as const,
          reason: decision.reason,
          retryAfterMs: 2 * 60 * 1000,
        };
      }
      return {
        ok: false as const,
        reason: decision.reason,
        attemptsUsed: accountAttempts.length,
        attemptAllowance,
      };
    }

    const attemptId = await ctx.db.insert("article_generation_attempts", {
      userId: site.userId,
      jobKey: String(job._id),
      workerAttempt,
      attemptKey,
      monthKey,
      providerWorkKind: args.providerWorkKind,
      maxArticles: allowance.limits.maxArticles,
      attemptAllowance,
      status: "reserved",
      expiresAt: currentTime + ARTICLE_PROVIDER_ATTEMPT_LEASE_MS,
      createdAt: currentTime,
      updatedAt: currentTime,
    });
    return {
      ok: true as const,
      reused: false,
      attemptId,
      attemptsUsed: accountAttempts.length + 1,
      attemptAllowance,
    };
  },
});

/** Concurrency is a transient fleet condition, not a paid failure. Return the
 * exact job to pending without consuming a worker retry or attempt receipt. */
export const deferArticleProviderAdmission = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    reason: v.union(
      v.literal("account_concurrency"),
      v.literal("fleet_concurrency"),
    ),
    retryAfterMs: v.number(),
  },
  handler: async (ctx, { jobId, workerToken, reason, retryAfterMs }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, workerToken)) {
      return { deferred: false, nextAttemptAt: undefined };
    }
    if (await releaseReservedUsage(ctx, job)) job.reservationId = undefined;
    const currentTime = now();
    const nextAttemptAt = currentTime + Math.max(30_000, retryAfterMs);
    await ctx.db.patch(jobId, {
      status: "pending",
      error: `Provider capacity is temporarily busy (${reason}); the paid attempt has not started.`,
      nextAttemptAt,
      reservationId: job.articleId ? job.reservationId : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    return { deferred: true, nextAttemptAt };
  },
});

/**
 * A definitive provider-funding rejection is an operational pause, not an
 * editorial failure. Preserve the exact article job and its immutable
 * provider-attempt receipt in a non-concurrent paused state, then atomically
 * arm the next fleet wake. Repeated unfunded probes therefore cannot consume
 * the tenant's monthly recovery allowance or create a new paid attempt.
 *
 * This deliberately does not weaken, reset, or bypass any article quality
 * state. When funding returns, the same generation/review path must still
 * satisfy the full publication contract before it can seal or publish.
 */
export const deferArticleProviderFunding = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { jobId, workerToken, error }) => {
    const job = await ctx.db.get(jobId);
    if (
      !job ||
      job.type !== "article" ||
      !job.siteId ||
      !ownsJob(job, workerToken)
    ) {
      return { deferred: false, nextAttemptAt: undefined };
    }
    const currentTime = now();
    const nextAttemptAt = currentTime + CADENCE_BALANCE_RECHECK_MS;
    const cadenceFailure = classifyCadenceFailure({
      message: error,
      now: currentTime,
      retryAt: nextAttemptAt,
      explicitCode: "article_provider_funding_unavailable",
    });
    if (cadenceFailure.category !== "provider_funding") {
      throw new Error("Funding deferral requires a provider-funding failure");
    }
    const providerAttemptPaused = await pauseArticleProviderAttemptForFunding(
      ctx,
      job,
      currentTime,
    );
    if (!providerAttemptPaused) {
      throw new Error(
        "Funding deferral lost its exact provider-attempt reservation",
      );
    }
    if (!job.articleId && await releaseReservedUsage(ctx, job)) {
      job.reservationId = undefined;
    }
    const workerAttempts = job.workerAttempts ?? 0;
    await ctx.db.patch(jobId, {
      status: "pending",
      workerAttempts,
      error:
        "Article provider funding is unavailable; the exact job is preserved " +
        "and scheduled for an automatic funding recheck.",
      cadenceFailure: {
        ...cadenceFailure,
        retryable: true,
        terminal: false,
        eligibleAt: nextAttemptAt,
      },
      nextAttemptAt,
      reservationId: job.articleId ? job.reservationId : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    await raiseJobAlert(
      ctx,
      job.siteId,
      "article_provider_funding_unavailable",
      "Article production is paused because neither configured article provider has funded capacity.",
      { jobId, articleId: job.articleId, nextAttemptAt, workerAttempts },
    );
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.autopilot.dispatchSiteFollowup,
      {
        siteId: job.siteId,
        trigger: "article_provider_funding_recheck",
        reason:
          "Exact funding-recovery boundary for the preserved article job.",
      },
    );
    return { deferred: true, nextAttemptAt, workerAttempts };
  },
});

/** No provider request started when the account-month allowance rejected the
 * execution. Keep the exact job pending and arm the first instant of the next
 * UTC allowance window instead of turning the cadence into a terminal miss. */
export const deferArticleProviderMonthlyAllowance = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
  },
  handler: async (ctx, { jobId, workerToken }) => {
    const job = await ctx.db.get(jobId);
    if (
      !job ||
      job.type !== "article" ||
      !job.siteId ||
      !ownsJob(job, workerToken)
    ) {
      return { deferred: false, nextAttemptAt: undefined };
    }
    const currentTime = now();
    const nextAttemptAt = nextUtcMonthAt(currentTime);
    if (nextAttemptAt === undefined) {
      throw new Error("Unable to derive the next article allowance window");
    }
    if (!job.articleId && await releaseReservedUsage(ctx, job)) {
      job.reservationId = undefined;
    }
    const cadenceFailure = classifyCadenceFailure({
      message: "monthly generation quota reached",
      now: currentTime,
      retryAt: nextAttemptAt,
      explicitCode: "article_provider_monthly_attempt_limit",
    });
    await ctx.db.patch(jobId, {
      status: "pending",
      error:
        "The bounded article-provider attempt allowance is exhausted; the " +
        "exact job is preserved for the next UTC month.",
      cadenceFailure: {
        ...cadenceFailure,
        retryable: true,
        terminal: false,
        eligibleAt: nextAttemptAt,
      },
      nextAttemptAt,
      reservationId: job.articleId ? job.reservationId : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    await ctx.scheduler.runAt(
      nextAttemptAt,
      internal.autopilot.dispatchSiteFollowup,
      {
        siteId: job.siteId,
        trigger: "article_provider_allowance_recheck",
        reason:
          "First eligible instant of the next UTC article-provider allowance window.",
      },
    );
    return { deferred: true, nextAttemptAt };
  },
});

/**
 * Operator recovery after provider funding is restored. It also migrates the
 * narrow legacy state created before funding failures became durable pauses:
 * an exact terminal article job whose stable error proves no provider output
 * was available. Repeated calls are idempotent and cannot replay a running or
 * already-eligible job.
 */
export const resumeArticleProviderFundingJobInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
  },
  handler: async (ctx, { siteId, jobId }) => {
    const [site, job] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db.get(jobId),
    ]);
    if (
      !site ||
      !job ||
      job.siteId !== siteId ||
      job.type !== "article" ||
      !jobAuthorizedForExecution(site, job) ||
      !(await jobArtifactsMatchCurrentDomain(ctx, site, job)) ||
      !["pending", "failed"].includes(job.status)
    ) {
      throw new Error("Article funding recovery job is not eligible");
    }
    const exactFundingFailure =
      job.cadenceFailure?.code === "article_provider_funding_unavailable" ||
      /article_provider_funding_unavailable|no available funded capacity/i.test(
        job.error ?? "",
      );
    if (!exactFundingFailure) {
      throw new Error("Article job does not carry the funding-failure receipt");
    }
    const currentTime = now();
    if (
      job.status === "pending" &&
      (job.nextAttemptAt === undefined || job.nextAttemptAt <= currentTime)
    ) {
      return {
        resumed: false,
        reason: "already_eligible" as const,
        jobId,
      };
    }
    const workerAttempts = job.status === "failed"
      ? (job.workerAttempts ?? 0) + 1
      : job.workerAttempts ?? 0;
    await ctx.db.patch(jobId, {
      status: "pending",
      workerAttempts,
      error:
        "Provider funding recovery was acknowledged; the preserved article " +
        "job is eligible for its next bounded attempt.",
      cadenceFailure: {
        version: 1,
        category: "provider_funding",
        code: "article_provider_funding_unavailable",
        retryable: true,
        terminal: false,
        eligibleAt: currentTime,
        recordedAt: currentTime,
      },
      nextAttemptAt: currentTime,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    // A legacy terminal funding failure may already have released the topic's
    // temporary `queued` lock. Reconcile after restoring the job so the topic
    // and its exact pending execution become authoritative together. Without
    // this, a newer product-fit policy can reject the job while the stale
    // `planned` topic remains eligible to be selected again.
    await reconcileJobTopicLifecycle(ctx, job);
    await ctx.scheduler.runAfter(
      0,
      internal.autopilot.dispatchSiteFollowup,
      {
        siteId,
        trigger: "article_provider_funding_restored",
        reason:
          "Operator acknowledged restored funding for the exact preserved article job.",
      },
    );
    return { resumed: true, jobId, workerAttempts };
  },
});

export const releaseGenerationReservation = internalMutation({
  args: { jobId: v.id("jobs"), workerToken: v.string() },
  handler: async (ctx, { jobId, workerToken }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, workerToken) || job.articleId) {
      return { released: false };
    }
    const released = await releaseReservedUsage(ctx, job);
    if (released) {
      await ctx.db.patch(jobId, { reservationId: undefined, updatedAt: now() });
    }
    return { released };
  },
});

/**
 * Reuse execution two of one already-reserved automatic topic plan when its
 * first verified execution succeeded but could not fill the protected topic
 * horizon. This does not insert a plan or reserve another dollar. Moving the
 * worker ordinal before scheduling makes the allowance consumed even if the
 * continuation later fails, loses its lease, or cannot pass preflight.
 */
export const continueSuccessfulUnderfilledPlan = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
    commitNonce: v.string(),
    savedTopicCount: v.number(),
    firstResult: v.any(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const persistenceCommit = job
      ? exactPlanPersistenceCommit(job, args.commitNonce)
      : null;
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.type !== "plan" ||
      job.status !== "done" ||
      !persistenceCommit ||
      persistenceCommit.workerExecution !== 1 ||
      persistenceCommit.acceptedTopicCount !== args.savedTopicCount
    ) {
      return { queued: false, reason: "worker_lease_lost" as const };
    }
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    const continuation = payload.underfilledPlanContinuation;
    const reason = typeof payload.reason === "string" ? payload.reason : "";
    const automaticTopicPlan =
      payload.manual !== true &&
      reason.startsWith("topic_") &&
      payload.growthParentArticleId === undefined &&
      payload.growthSeed === undefined &&
      payload.growthActionFingerprint === undefined &&
      payload.expectedClickPlanMigrationVersion === undefined;
    if (automaticSingleExecutionCheckpointTargetFromPayload(job.payload)) {
      return {
        queued: false,
        reason: "checkpoint_single_execution" as const,
      };
    }
    const scheduledAt = now() + AUTOMATIC_PLAN_CONTINUATION_DELAY_MS;
    const decision = evaluateAutomaticPlanContinuation({
      automaticTopicPlan,
      savedTopicCount: args.savedTopicCount,
      workerAttempts: job.workerAttempts ?? 0,
      continuationAlreadyQueued: continuation !== undefined,
      reservationDay: job.providerCostReservationDay,
      executionAt: scheduledAt,
    });
    if (!decision.allowed) {
      return { queued: false, reason: decision.reason };
    }
    const firstResult = args.firstResult && typeof args.firstResult === "object"
      ? args.firstResult as Record<string, unknown>
      : {};
    if (firstResult.count !== args.savedTopicCount) {
      return { queued: false, reason: "successful_result_mismatch" as const };
    }

    const [site, reservation, pendingPlans, runningPlans, contemporaryPlans] =
      await Promise.all([
        ctx.db.get(args.siteId),
        job.providerSpendReservationId
          ? ctx.db.get(job.providerSpendReservationId)
          : Promise.resolve(null),
        ctx.db
          .query("jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", args.siteId).eq("status", "pending")
          )
          .collect(),
        ctx.db
          .query("jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", args.siteId).eq("status", "running")
          )
          .collect(),
        ctx.db
          .query("jobs")
          .withIndex("by_site_type_created", (q) =>
            q
              .eq("siteId", args.siteId)
              .eq("type", "plan")
              .gte("createdAt", job.createdAt)
          )
          .collect(),
      ]);
    const allowance = await currentSitePlanAllowance(ctx, site);
    const articleHeadroom =
      allowance.ok && site?.userId
        ? await accountHasArticleHeadroom(
            ctx,
            site.userId,
            allowance.limits.maxArticles,
            scheduledAt,
          )
        : false;
    if (
      !site ||
      !allowance.ok ||
      !articleHeadroom ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      site.expectedClickSchedulingEnabled !==
        persistenceCommit.expectedClickSchedulingEnabled ||
      !jobAuthorizedForExecution(site, job) ||
      job.providerCostCeilingMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      job.providerCostReservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      job.providerReservationReleasedAt !== undefined ||
      !reservation ||
      reservation.siteId !== args.siteId ||
      reservation.userId !== site.userId ||
      reservation.purpose !== "topic_plan" ||
      reservation.trigger !== "topic_plan" ||
      reservation.reservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      reservation.reservationDay !== job.providerCostReservationDay ||
      reservation.createdAt !== job.createdAt ||
      reservation.releasedAt !== undefined
    ) {
      return { queued: false, reason: "reservation_or_entitlement_invalid" as const };
    }
    const activePlan = [...pendingPlans, ...runningPlans].find((candidate) =>
      candidate._id !== args.jobId &&
      candidate.type === "plan" &&
      jobAuthorizedForExecution(site, candidate)
    );
    if (activePlan) {
      return { queued: false, reason: "active_plan" as const };
    }
    const newerPlan = contemporaryPlans.find((candidate) =>
      candidate._id !== args.jobId &&
      (
        candidate.createdAt > job.createdAt ||
        candidate._creationTime > job._creationTime
      )
    );
    if (newerPlan) {
      return { queued: false, reason: "newer_plan" as const };
    }

    await ctx.db.patch(args.jobId, {
      status: "pending",
      payload: {
        ...payload,
        underfilledPlanContinuation: {
          version: 1,
          firstExecutionCount: args.savedTopicCount,
          remainingTopicCapacity: decision.remainingTopicCapacity,
          queuedAt: scheduledAt,
        },
      },
      // Execution two is consumed before its durable wake-up. A provider
      // failure, ambiguous lease, or preflight result can never grant a third.
      workerAttempts: 1,
      result: {
        ...firstResult,
        count: args.savedTopicCount,
        // Preserve the database-issued receipt rather than the action's
        // compact return projection while this completed execution is opened
        // for its legacy reserved continuation.
        planPersistenceCommit: persistenceCommit,
        providerBudget: {
          reservedMicroUsd: job.providerCostReservedMicroUsd,
          ceilingMicroUsd: job.providerCostCeilingMicroUsd,
          reservationDay: job.providerCostReservationDay,
          workerExecution: 1,
        },
        continuationStatus: "queued",
        continuationWorkerExecution: decision.workerExecution,
        remainingTopicCapacity: decision.remainingTopicCapacity,
      },
      error: undefined,
      stepProgress: undefined,
      nextAttemptAt: scheduledAt,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now(),
    });
    await ctx.scheduler.runAt(
      scheduledAt,
      internal.autopilot.dispatchSiteFollowup,
      {
        siteId: args.siteId,
        trigger: "underfilled_plan_continuation",
        reason:
          `Verified plan yielded ${args.savedTopicCount} topic(s); ` +
          "using its already-reserved second execution to refill the horizon.",
      },
    );
    return {
      queued: true,
      workerExecution: decision.workerExecution,
      remainingTopicCapacity: decision.remainingTopicCapacity,
      scheduledAt,
    };
  },
});

/** Recover the exact output of a plan mutation whose response was lost after
 * Convex committed its topic rows and terminal job receipt. */
export const inspectCommittedPlanPersistence = internalQuery({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    commitNonce: v.string(),
    workerExecution: v.number(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const persistenceCommit = job
      ? exactPlanPersistenceCommit(job, args.commitNonce)
      : null;
    const storedResult = job?.result && typeof job.result === "object"
      ? job.result as Record<string, unknown>
      : {};
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.type !== "plan" ||
      job.status !== "done" ||
      !persistenceCommit ||
      persistenceCommit.workerExecution !== args.workerExecution ||
      storedResult.count !== persistenceCommit.cumulativeTopicCount
    ) {
      return { committed: false as const };
    }
    return {
      committed: true as const,
      inserted: persistenceCommit.inserted,
      revived: persistenceCommit.revived,
      skipped: persistenceCommit.skipped,
      acceptedTopicCount: persistenceCommit.acceptedTopicCount,
      cumulativeTopicCount: persistenceCommit.cumulativeTopicCount,
      acceptedKeywordKeys: persistenceCommit.acceptedKeywordKeys,
    };
  },
});

/** Enrich the result of an already-atomic ordinary plan commit. This mutation
 * cannot publish topics or change job state; the nonce only permits metadata
 * from the exact execution that committed those rows. */
export const finalizeCommittedPlanResult = internalMutation({
  args: {
    jobId: v.id("jobs"),
    commitNonce: v.string(),
    workerExecution: v.number(),
    result: v.any(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const persistenceCommit = job
      ? exactPlanPersistenceCommit(job, args.commitNonce)
      : null;
    if (
      !job ||
      job.type !== "plan" ||
      job.status !== "done" ||
      !persistenceCommit ||
      persistenceCommit.workerExecution !== args.workerExecution
    ) {
      return { updated: false };
    }
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    const continuation = payload.underfilledPlanContinuation &&
        typeof payload.underfilledPlanContinuation === "object"
      ? payload.underfilledPlanContinuation as Record<string, unknown>
      : null;
    const firstExecutionCount = continuation &&
        Number.isInteger(continuation.firstExecutionCount)
      ? continuation.firstExecutionCount as number
      : 0;
    const expectedCount = firstExecutionCount +
      persistenceCommit.acceptedTopicCount;
    const result = args.result && typeof args.result === "object"
      ? args.result as Record<string, unknown>
      : {};
    if (
      expectedCount !== persistenceCommit.cumulativeTopicCount ||
      result.count !== expectedCount
    ) {
      throw new Error(
        "Committed plan result count does not match its atomic persistence receipt",
      );
    }
    await ctx.db.patch(job._id, {
      result: {
        ...result,
        planPersistenceCommit: persistenceCommit,
      },
      updatedAt: now(),
    });
    return { updated: true };
  },
});

/**
 * Re-authorize the already-consumed second plan execution immediately before
 * its paid provider boundary. Execution-one inventory deliberately runs first
 * when it can protect cadence, so account article headroom may have changed
 * since the continuation was queued. A denied check is terminal: it does not
 * restore worker ordinal two or create another reservation.
 */
export const authorizeUnderfilledPlanContinuationExecution = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    workerToken: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.type !== "plan" ||
      !ownsJob(job, args.workerToken) ||
      (job.workerAttempts ?? 0) !== 1 ||
      !isUnderfilledPlanContinuationPayload(job.payload)
    ) {
      return { authorized: false, reason: "continuation_lease_invalid" as const };
    }
    const payload = job.payload as Record<string, unknown>;
    const marker = payload.underfilledPlanContinuation as Record<
      string,
      unknown
    >;
    const storedResult = job.result && typeof job.result === "object"
      ? job.result as Record<string, unknown>
      : {};
    const providerBudget = storedResult.providerBudget &&
        typeof storedResult.providerBudget === "object"
      ? storedResult.providerBudget as Record<string, unknown>
      : {};
    if (
      storedResult.count !== marker.firstExecutionCount ||
      providerBudget.workerExecution !== 1 ||
      providerBudget.reservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      providerBudget.ceilingMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      providerBudget.reservationDay !== job.providerCostReservationDay
    ) {
      return { authorized: false, reason: "first_execution_receipt_invalid" as const };
    }

    const executionAt = now();
    const [site, reservation] = await Promise.all([
      ctx.db.get(args.siteId),
      job.providerSpendReservationId
        ? ctx.db.get(job.providerSpendReservationId)
        : Promise.resolve(null),
    ]);
    const allowance = await currentSitePlanAllowance(ctx, site);
    const articleHeadroom =
      allowance.ok && site?.userId
        ? await accountHasArticleHeadroom(
            ctx,
            site.userId,
            allowance.limits.maxArticles,
            executionAt,
          )
        : false;
    if (!articleHeadroom) {
      return { authorized: false, reason: "article_quota_no_headroom" as const };
    }
    if (
      !site ||
      !allowance.ok ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      !jobAuthorizedForExecution(site, job) ||
      !planRetryUsesCurrentReservationDay(
        job.providerCostReservationDay,
        executionAt,
      ) ||
      job.providerCostCeilingMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      job.providerCostReservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      job.providerReservationReleasedAt !== undefined ||
      !reservation ||
      reservation.siteId !== args.siteId ||
      reservation.userId !== site.userId ||
      reservation.purpose !== "topic_plan" ||
      reservation.trigger !== "topic_plan" ||
      reservation.reservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      reservation.reservationDay !== job.providerCostReservationDay ||
      reservation.createdAt !== job.createdAt ||
      reservation.releasedAt !== undefined
    ) {
      return { authorized: false, reason: "reservation_or_entitlement_invalid" as const };
    }
    return { authorized: true as const };
  },
});

/**
 * Versioned operator bridge for a plan that completed before automatic
 * underfill continuation existed. Inspect with apply=false first. Applying
 * reopens only that same successful job at execution two; it cannot create a
 * provider reservation, coexist with newer/active tenant work, or replay.
 */
export const recoverCompletedUnderfilledPlanContinuation = internalMutation({
  args: {
    siteId: v.id("sites"),
    jobId: v.id("jobs"),
    recoveryVersion: v.number(),
    apply: v.boolean(),
  },
  handler: async (ctx, args) => {
    if (
      args.recoveryVersion !==
        UNDERFILLED_PLAN_CONTINUATION_RECOVERY_VERSION
    ) {
      throw new Error("Unsupported underfilled-plan recovery version");
    }
    const [site, job] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    if (!siteExecutionActive(site) || !job || job.siteId !== args.siteId) {
      throw new Error("Underfilled-plan recovery target was not found");
    }
    if (automaticSingleExecutionCheckpointTargetFromPayload(job.payload)) {
      return {
        eligible: false,
        applied: false,
        reason: "checkpoint_single_execution" as const,
        jobId: args.jobId,
      };
    }
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    const existingContinuation = payload.underfilledPlanContinuation;
    if (existingContinuation !== undefined) {
      if (existingContinuation && typeof existingContinuation === "object") {
        const marker = existingContinuation as Record<string, unknown>;
        if (
          marker.version === 1 &&
          marker.recoveryVersion === args.recoveryVersion
        ) {
          return {
            eligible: false,
            applied: false,
            reason: "already_applied" as const,
            jobId: args.jobId,
            workerExecution: job.workerAttempts ?? 0,
          };
        }
      }
      throw new Error("Underfilled-plan continuation marker conflicts");
    }
    const reason = typeof payload.reason === "string" ? payload.reason : "";
    const automaticTopicPlan =
      payload.manual !== true &&
      reason.startsWith("topic_") &&
      payload.growthParentArticleId === undefined &&
      payload.growthSeed === undefined &&
      payload.growthActionFingerprint === undefined &&
      payload.expectedClickPlanMigrationVersion === undefined;
    const storedResult = job.result && typeof job.result === "object"
      ? job.result as Record<string, unknown>
      : {};
    const providerBudget = storedResult.providerBudget &&
        typeof storedResult.providerBudget === "object"
      ? storedResult.providerBudget as Record<string, unknown>
      : {};
    const savedTopicCount =
      typeof storedResult.count === "number"
        ? storedResult.count
        : Number.NaN;
    const scheduledAt = now() + AUTOMATIC_PLAN_CONTINUATION_DELAY_MS;
    const decision = evaluateAutomaticPlanContinuation({
      automaticTopicPlan,
      savedTopicCount,
      workerAttempts: job.workerAttempts ?? 0,
      continuationAlreadyQueued: false,
      reservationDay: job.providerCostReservationDay,
      executionAt: scheduledAt,
    });
    if (!decision.allowed) {
      return {
        eligible: false,
        applied: false,
        reason: decision.reason,
        jobId: args.jobId,
      };
    }
    if (
      job.status !== "done" ||
      job.error !== undefined ||
      providerBudget.workerExecution !== 1 ||
      providerBudget.reservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      providerBudget.ceilingMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      providerBudget.reservationDay !== job.providerCostReservationDay
    ) {
      return {
        eligible: false,
        applied: false,
        reason: "successful_execution_receipt_missing" as const,
        jobId: args.jobId,
      };
    }

    const [allowance, reservation, pending, running, contemporaryPlans] =
      await Promise.all([
        currentSitePlanAllowance(ctx, site),
        job.providerSpendReservationId
          ? ctx.db.get(job.providerSpendReservationId)
          : Promise.resolve(null),
        ctx.db
          .query("jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", args.siteId).eq("status", "pending")
          )
          .collect(),
        ctx.db
          .query("jobs")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", args.siteId).eq("status", "running")
          )
          .collect(),
        ctx.db
          .query("jobs")
          .withIndex("by_site_type_created", (q) =>
            q
              .eq("siteId", args.siteId)
              .eq("type", "plan")
              .gte("createdAt", job.createdAt)
          )
          .collect(),
      ]);
    const articleHeadroom =
      allowance.ok && site.userId
        ? await accountHasArticleHeadroom(
            ctx,
            site.userId,
            allowance.limits.maxArticles,
            scheduledAt,
          )
        : false;
    if (
      !allowance.ok ||
      !articleHeadroom ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      !jobAuthorizedForExecution(site, job) ||
      job.providerCostCeilingMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      job.providerCostReservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      job.providerReservationReleasedAt !== undefined ||
      !reservation ||
      reservation.siteId !== args.siteId ||
      reservation.userId !== site.userId ||
      reservation.purpose !== "topic_plan" ||
      reservation.trigger !== "topic_plan" ||
      reservation.reservedMicroUsd !==
        AUTOMATIC_PLAN_PROVIDER_COST_CEILING_MICRO_USD ||
      reservation.reservationDay !== job.providerCostReservationDay ||
      reservation.createdAt !== job.createdAt ||
      reservation.releasedAt !== undefined
    ) {
      return {
        eligible: false,
        applied: false,
        reason: "reservation_or_entitlement_invalid" as const,
        jobId: args.jobId,
      };
    }
    const activeJob = [...pending, ...running].find((candidate) =>
      candidate._id !== args.jobId &&
      jobAuthorizedForExecution(site, candidate)
    );
    if (activeJob) {
      return {
        eligible: false,
        applied: false,
        reason: "active_job" as const,
        jobId: args.jobId,
      };
    }
    const newerPlan = contemporaryPlans.find((candidate) =>
      candidate._id !== args.jobId &&
      (
        candidate.createdAt > job.createdAt ||
        candidate._creationTime > job._creationTime
      )
    );
    if (newerPlan) {
      return {
        eligible: false,
        applied: false,
        reason: "newer_plan" as const,
        jobId: args.jobId,
      };
    }
    if (!args.apply) {
      return {
        eligible: true,
        applied: false,
        reason: "ready" as const,
        jobId: args.jobId,
        savedTopicCount,
        remainingTopicCapacity: decision.remainingTopicCapacity,
        workerExecution: decision.workerExecution,
        scheduledAt,
      };
    }

    await ctx.db.patch(args.jobId, {
      status: "pending",
      payload: {
        ...payload,
        underfilledPlanContinuation: {
          version: 1,
          recoveryVersion: args.recoveryVersion,
          firstExecutionCount: savedTopicCount,
          remainingTopicCapacity: decision.remainingTopicCapacity,
          queuedAt: scheduledAt,
        },
      },
      // This is the same immutable second provider execution as the live path.
      workerAttempts: 1,
      result: {
        ...storedResult,
        continuationStatus: "queued",
        continuationRecoveryVersion: args.recoveryVersion,
        continuationWorkerExecution: decision.workerExecution,
        remainingTopicCapacity: decision.remainingTopicCapacity,
      },
      error: undefined,
      stepProgress: undefined,
      nextAttemptAt: scheduledAt,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: now(),
    });
    await ctx.scheduler.runAt(
      scheduledAt,
      internal.autopilot.dispatchSiteFollowup,
      {
        siteId: args.siteId,
        trigger: "underfilled_plan_recovery",
        reason:
          `Recovered completed plan ${args.jobId} at reserved execution two ` +
          `after a verified ${savedTopicCount}-topic yield.`,
      },
    );
    return {
      eligible: true,
      applied: true,
      reason: "applied" as const,
      jobId: args.jobId,
      savedTopicCount,
      remainingTopicCapacity: decision.remainingTopicCapacity,
      workerExecution: decision.workerExecution,
      scheduledAt,
    };
  },
});

export const markDone = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    result: v.optional(v.any()),
  },
  handler: async (ctx, { jobId, workerToken, result }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, workerToken)) return { updated: false };
    if (job.type === "plan") {
      if (automaticSingleExecutionCheckpointTargetFromPayload(job.payload)) {
        throw new Error(
          "Checkpoint plans must atomically publish inventory and complete " +
          "through commitInlineSuccess",
        );
      }
      const unsettledCheckpoint = (await ctx.db
        .query("plan_candidate_checkpoints")
        .withIndex("by_plan_job", (q) => q.eq("planJobId", jobId))
        .collect()).find((checkpoint) =>
          ["active", "inline_sealed"].includes(checkpoint.status));
      if (unsettledCheckpoint) {
        throw new Error(
          "A successful plan cannot retain an unsettled candidate checkpoint",
        );
      }
    }
    const currentTime = now();
    await settleArticleProviderAttempt(ctx, job, "completed", currentTime);
    await ctx.db.patch(jobId, {
      status: "done",
      result,
      // A successful retry must not keep surfacing the previous transient
      // failure as if the completed job were still unhealthy.
      error: undefined,
      cadenceFailure: undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: currentTime,
    });
    await reconcileJobTopicLifecycle(ctx, job);
    await wakeCurrentOneSetupExecutionForTerminalPlan(ctx, job);
    return { updated: true };
  },
});

export const markFailed = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { jobId, workerToken, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, workerToken)) return { updated: false };
    const currentTime = now();
    const classifiedCadenceFailure = job.type === "plan"
      ? classifyCadenceFailure({ message: error, now: currentTime })
      : undefined;
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    const semanticPlanEligibleAt = classifiedCadenceFailure?.category ===
        "semantic_zero_yield" &&
        payload.manual !== true &&
        typeof payload.reason === "string" &&
        payload.reason.startsWith("topic_") &&
        automaticSingleExecutionCheckpointTargetFromPayload(job.payload)
      ? topicPlanCooldownWakeAt(job.createdAt) ?? undefined
      : undefined;
    const cadenceFailure = classifiedCadenceFailure
      ? {
          ...classifiedCadenceFailure,
          ...(semanticPlanEligibleAt !== undefined
            ? { eligibleAt: semanticPlanEligibleAt }
            : {}),
        }
      : undefined;
    await settleArticleProviderAttempt(ctx, job, "failed", currentTime);
    await releaseReservedUsage(ctx, job);
    await ctx.db.patch(jobId, {
      status: "failed",
      error,
      // Plan jobs may retain a classified cadence receipt. Article failures
      // reaching this terminal path must clear any older funding pause so a
      // failed job can never remain simultaneously marked retryable.
      cadenceFailure,
      reservationId: job.articleId ? job.reservationId : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      nextAttemptAt: undefined,
      updatedAt: currentTime,
    });
    if (job.type === "plan") {
      await terminallyClosePlanCheckpoints(ctx, jobId, currentTime);
      await wakeCurrentOneSetupExecutionForTerminalPlan(ctx, job);
    }
    // A strict zero-yield checkpoint is terminal for this paid job. Arm the
    // next strategy only at the original 24-hour window boundary; the exact
    // failed reservation remains consumed and no retry/replay is scheduled.
    if (
      semanticPlanEligibleAt !== undefined &&
      semanticPlanEligibleAt > currentTime &&
      job.siteId &&
      job.rolloutEpoch !== undefined
    ) {
      const claimNonce = topicPlanCooldownClaimNonce({
        planJobId: String(jobId),
        rolloutEpoch: job.rolloutEpoch,
        dueAt: semanticPlanEligibleAt,
      });
      const existingWake = await ctx.db
        .query("autopilot_runs")
        .withIndex("by_site_scheduled", (q) =>
          q.eq("siteId", job.siteId!).eq("scheduledAt", semanticPlanEligibleAt)
        )
        .filter((q) =>
          q.eq(q.field("trigger"), TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER)
        )
        .first();
      if (!existingWake && claimNonce) {
        const runId = await ctx.db.insert("autopilot_runs", {
          siteId: job.siteId,
          trigger: TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
          claimNonce,
          scheduledAt: semanticPlanEligibleAt,
          heartbeatAt: currentTime,
          status: "scheduled",
          detail:
            "Exact semantic zero-yield boundary; the next bounded discovery strategy may be considered without replaying this plan.",
        });
        await ctx.scheduler.runAt(
          semanticPlanEligibleAt,
          internal.autopilot.claimTopicPlanCooldownWake,
          {
            siteId: job.siteId,
            runId,
            planJobId: jobId,
            rolloutEpoch: job.rolloutEpoch,
            dueAt: semanticPlanEligibleAt,
            claimNonce,
          },
        );
      }
    }
    await reconcileJobTopicLifecycle(ctx, job);
    return { updated: true };
  },
});

export const markRetryableFailure = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    error: v.string(),
  },
  handler: async (ctx, { jobId, workerToken, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job || !ownsJob(job, workerToken)) {
      return { updated: false, willRetry: false, nextAttemptAt: undefined };
    }
    const site = job.siteId ? await ctx.db.get(job.siteId) : null;
    const checkpointSingleExecution = Boolean(
      job.type === "plan" &&
      site?.expectedClickSchedulingEnabled === true &&
      automaticSingleExecutionCheckpointTargetFromPayload(job.payload),
    );
    const attempts = (job.workerAttempts ?? 0) + 1;
    const maximumRetries = checkpointSingleExecution
      ? 0
      : job.type === "plan"
        ? AUTOMATIC_PLAN_MAX_TRANSIENT_RETRIES
        : MAX_JOB_ATTEMPTS;
    const willRetry = attempts <= maximumRetries;
    const currentTime = now();
    await settleArticleProviderAttempt(ctx, job, "failed", currentTime);
    if (!job.articleId && await releaseReservedUsage(ctx, job)) {
      job.reservationId = undefined;
    }
    const nextAttemptAt = willRetry
      ? currentTime + Math.min(15, 2 ** attempts) * 60_000
      : undefined;
    const cadenceFailure = job.type === "plan"
      ? {
          ...classifyCadenceFailure({
            message: error,
            now: currentTime,
            retryAt: nextAttemptAt ?? currentTime + 15 * 60 * 1000,
            explicitCode: "transient_provider_failure",
          }),
          // A checkpoint's single execution may be operationally retryable
          // in principle while replay remains forbidden in this job. Record
          // the actual durable decision, not a hypothetical provider retry.
          retryable: willRetry,
          terminal: !willRetry,
          eligibleAt: nextAttemptAt,
        }
      : undefined;
    await ctx.db.patch(jobId, {
      status: willRetry ? "pending" : "failed",
      workerAttempts: attempts,
      error: willRetry
        ? `Transient worker failure; retry ${attempts}/${maximumRetries}: ${error}`
        : `Worker failure exhausted after ${attempts} attempts: ${error}`,
      cadenceFailure,
      nextAttemptAt,
      reservationId: job.articleId ? job.reservationId : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    if (!willRetry && job.type === "plan") {
      await activateTerminalPlanCheckpoints(ctx, jobId, currentTime);
      await wakeCurrentOneSetupExecutionForTerminalPlan(ctx, job);
    }
    if (!willRetry && job.type === "article" && job.siteId && job.articleId) {
      const article = await ctx.db.get(job.articleId);
      const failure = article?.siteId === job.siteId
        ? recoverableWorkerQualityFailure({
            error,
            attempts,
            maximumAttempts: MAX_JOB_ATTEMPTS + 1,
          })
        : null;
      if (article && failure && article.status === "review") {
        // This error describes the transient candidate returned by the worker,
        // not necessarily the persisted article. Appending it to the article
        // made a later valid-length recovery ingest obsolete failure text and
        // regress again. Keep the exact failure on the job/alert receipt; the
        // article retains only gate issues measured from its stored artifact.
        const publicationGateIssues = article.publicationGateIssues ?? [];
        const qualityRevisionCount = Math.max(
          article.qualityRevisionCount ?? 0,
          MAX_QUALITY_REVISIONS,
        );
        const qualityRecoveryAttemptVersion = Math.max(
          article.qualityRecoveryAttemptVersion ?? 0,
          WORKER_LENGTH_RECOVERY_VERSION,
        );
        await ctx.db.patch(article._id, {
          publicationGateStatus: "blocked",
          publicationGateIssues,
          publicationCheckedAt: currentTime,
          qualityRevisionCount,
          qualityRecoveryAttemptVersion,
        });
        const summary = await ctx.db
          .query("article_summaries")
          .withIndex("by_article", (q) => q.eq("articleId", article._id))
          .first();
        if (summary) {
          await ctx.db.patch(summary._id, {
            publicationGateStatus: "blocked",
            publicationGateIssues,
            publicationCheckedAt: currentTime,
            qualityRevisionCount,
            qualityRecoveryAttemptVersion,
            articleUpdatedAt: article.updatedAt,
          });
        }
        const topic = article.topicId
          ? await ctx.db.get(article.topicId)
          : null;
        if (topic && topicMatchesLegacyWorkerFailureSettlement(topic, failure)) {
          await ctx.db.patch(topic._id, {
            status: "planned",
            contentFeasibilityStatus: undefined,
            contentFeasibilityVersion: undefined,
            contentFeasibilityIssues: undefined,
            contentFeasibilityCheckedAt: undefined,
            disqualifiedReason: undefined,
            updatedAt: currentTime,
          });
        }
      }
    }
    await reconcileJobTopicLifecycle(ctx, job);
    if (!willRetry && job.siteId) {
      await raiseJobAlert(
        ctx,
        job.siteId,
        "job_retry_exhausted",
        "A content job exhausted its bounded retry attempts.",
        { jobId, attempts, articleId: job.articleId, error },
      );
    }
    return { updated: true, willRetry, attempts, nextAttemptAt };
  },
});

/**
 * Natural cadence migration for deterministic article-quality failures that
 * exhausted under an older editing algorithm. This is bounded,
 * tenant-scoped, provider-free, and idempotent. It marks only the exact draft
 * from an exact quality-retry job and reverses a topic disqualification only
 * when every field matches the legacy worker-generated settlement. Queueing
 * remains a separate durable versioned boundary.
 */
export const settleExhaustedArticleQualityFailuresForSiteInternal =
  internalMutation({
    args: { siteId: v.id("sites") },
    handler: async (ctx, { siteId }) => {
      const site = await ctx.db.get(siteId);
      if (!site) return { inspected: 0, settled: 0, revived: 0 };
      // Start from the same bounded current-domain review inventory consumed
      // by the scheduler, then join each candidate to its own failed-job
      // history. A fleet-wide "latest N jobs" window strands an older draft
      // as soon as an active tenant creates enough unrelated work; an
      // article-bound index makes admission independent of tenant volume.
      const reviewArticles = await takeCurrentDomainArticleSummariesByStatus(
        ctx,
        site,
        "review",
        25,
      );
      let inspected = 0;
      let settled = 0;
      let revived = 0;
      for (const summary of reviewArticles) {
        if (
          (summary.qualityRecoveryVersion ?? 0) >=
            WORKER_LENGTH_RECOVERY_VERSION ||
          (summary.qualityRecoveryAttemptVersion ?? 0) >=
            WORKER_LENGTH_RECOVERY_VERSION
        ) continue;
        const failedJobs = await ctx.db.query("jobs")
          .withIndex("by_article_status_created", (q) =>
            q.eq("articleId", summary.articleId).eq("status", "failed")
          )
          .order("desc")
          .collect();
        inspected += failedJobs.length;
        if (
          hasAttemptedVersionedQualityRecovery(
            failedJobs,
            String(summary.articleId),
            WORKER_LENGTH_RECOVERY_VERSION,
          )
        ) continue;
        const failedQualityRecovery = failedJobs
          .map((job) => {
            if (
              job.siteId !== siteId || job.type !== "article" ||
              job.articleId !== summary.articleId || !job.error ||
              (job.workerAttempts ?? 0) < MAX_JOB_ATTEMPTS + 1
            ) return null;
            const payload = job.payload && typeof job.payload === "object"
              ? job.payload as Record<string, unknown>
              : {};
            if (
              payload.qualityRetry !== true ||
              payload.metadataOnlyRepair === true ||
              payload.deterministicRepair === true ||
              String(payload.articleId ?? "") !== String(summary.articleId) ||
              qualityRecoveryAttemptVersionFromJob(job) >=
                WORKER_LENGTH_RECOVERY_VERSION
            ) return null;
            const failure = recoverableWorkerQualityFailure({
              error: job.error,
              attempts: job.workerAttempts ?? 0,
              maximumAttempts: MAX_JOB_ATTEMPTS + 1,
            });
            return failure;
          })
          .find((candidate) => candidate !== null);
        if (!failedQualityRecovery) continue;
        const failure = failedQualityRecovery;
        const article = await ctx.db.get(summary.articleId);
        if (
          !article || article.siteId !== siteId ||
          !articleMatchesCurrentDomain(site, article) ||
          article.status !== "review" ||
          (article.qualityRecoveryVersion ?? 0) >=
            WORKER_LENGTH_RECOVERY_VERSION ||
          (article.qualityRecoveryAttemptVersion ?? 0) >=
            WORKER_LENGTH_RECOVERY_VERSION
        ) continue;
        const migratedAt = Date.now();
        const publicationGateIssues = [
          ...(article.publicationGateIssues ?? []),
          failure.recoveryIssue,
        ].filter((issue, index, issues) => issues.indexOf(issue) === index);
        const qualityRevisionCount = Math.max(
          article.qualityRevisionCount ?? 0,
          MAX_QUALITY_REVISIONS,
        );
        const articleChanged =
          article.publicationGateStatus !== "blocked" ||
          article.publicationGateIssues?.length !==
            publicationGateIssues.length ||
          article.publicationGateIssues?.some(
            (issue, index) => issue !== publicationGateIssues[index],
          ) ||
          article.qualityRevisionCount !== qualityRevisionCount;
        if (articleChanged) {
          await ctx.db.patch(article._id, {
            publicationGateStatus: "blocked",
            publicationGateIssues,
            publicationCheckedAt: migratedAt,
            qualityRevisionCount,
          });
          await ctx.db.patch(summary._id, {
            publicationGateStatus: "blocked",
            publicationGateIssues,
            publicationCheckedAt: migratedAt,
            qualityRevisionCount,
            articleUpdatedAt: migratedAt,
          });
          settled += 1;
        }
        const topic = article.topicId
          ? await ctx.db.get(article.topicId)
          : null;
        if (topic && topicMatchesLegacyWorkerFailureSettlement(topic, failure)) {
          await ctx.db.patch(topic._id, {
            status: "planned",
            contentFeasibilityStatus: undefined,
            contentFeasibilityVersion: undefined,
            contentFeasibilityIssues: undefined,
            contentFeasibilityCheckedAt: undefined,
            disqualifiedReason: undefined,
            updatedAt: migratedAt,
          });
          revived += 1;
        }
      }
      return { inspected, settled, revived };
    },
  });

// Preserve the generated article when only delivery failed. The retry worker
// can publish this exact approved draft instead of generating another article
// for the same topic and consuming a second monthly quota slot.
export const markPublishFailed = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    articleId: v.id("articles"),
    error: v.string(),
  },
  handler: async (ctx, { jobId, workerToken, articleId, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) throw new Error("Job not found");
    if (!ownsJob(job, workerToken)) return { updated: false, willRetry: false, attempts: job.publicationAttempts ?? 0, maxAttempts: MAX_PUBLICATION_ATTEMPTS };
    const article = await ctx.db.get(articleId);
    if (!job.siteId || !article || article.siteId !== job.siteId) {
      throw new Error("Article does not belong to the job site");
    }
    const existingPayload =
      job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
    const { attempts, willRetry, retryDelayMs } = nextPublicationRetry(
      job.publicationAttempts ?? 0,
    );
    const currentTime = now();
    await settleArticleProviderAttempt(ctx, job, "completed", currentTime);
    const [site, topic] = await Promise.all([
      ctx.db.get(job.siteId),
      article.topicId ? ctx.db.get(article.topicId) : Promise.resolve(null),
    ]);
    const topicFit = site && topic && topic.siteId === job.siteId
      ? evaluateTopicBusinessFit({
          keyword: topic.primaryKeyword,
          label: article.title,
          ...tenantTopicBusinessSignals(site),
        })
      : undefined;
    if (topic && topicFit && !topicFit.eligible) {
      await ctx.db.patch(topic._id, {
        status: "disqualified",
        businessFitEligible: false,
        businessFitScore: topicFit.score,
        businessFitVersion: topicFit.version,
        businessFitReasons: topicFit.reasons,
        businessFitCheckedAt: currentTime,
        disqualifiedReason: topicFit.reasons.join("; "),
        updatedAt: currentTime,
      });
      await ctx.db.patch(jobId, {
        status: "failed",
        error:
          `Terminal publication product-fit rejection: ${topicFit.reasons.join("; ")}`,
        publicationAttempts: attempts,
        articleId,
        cadenceFailure: undefined,
        nextAttemptAt: undefined,
        workerToken: undefined,
        heartbeatAt: undefined,
        leaseExpiresAt: undefined,
        updatedAt: currentTime,
      });
      await reconcileJobTopicLifecycle(ctx, job);
      return {
        updated: true,
        willRetry: false,
        terminalTopicFit: true,
        attempts,
        maxAttempts: MAX_PUBLICATION_ATTEMPTS,
      };
    }
    await ctx.db.patch(jobId, {
      status: willRetry ? "pending" : "failed",
      error: willRetry
        ? `Publication attempt ${attempts}/${MAX_PUBLICATION_ATTEMPTS} failed: ${error}`
        : `Publication retry exhausted after ${attempts}/${MAX_PUBLICATION_ATTEMPTS} attempts: ${error}`,
      publicationAttempts: attempts,
      payload: {
        ...existingPayload,
        articleId,
        publishOnly: true,
      },
      articleId,
      cadenceFailure: undefined,
      nextAttemptAt: willRetry ? currentTime + retryDelayMs : undefined,
      workerToken: undefined,
      heartbeatAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: currentTime,
    });
    await reconcileJobTopicLifecycle(ctx, job);
    if (willRetry) {
      await ctx.scheduler.runAfter(
        retryDelayMs,
        internal.autopilot.dispatchSiteFollowup,
        {
          siteId: job.siteId,
          trigger: "publication_retry",
          reason: `publication_retry_${attempts}`,
        },
      );
    }
    return {
      updated: true,
      willRetry,
      terminalTopicFit: false,
      attempts,
      maxAttempts: MAX_PUBLICATION_ATTEMPTS,
    };
  },
});

export const updateProgress = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    current: v.number(),
    total: v.number(),
    stepLabel: v.string(),
    topicLabel: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, workerToken, current, total, stepLabel, topicLabel }) => {
    const job = await ctx.db.get(jobId);
    const site = job?.siteId ? await ctx.db.get(job.siteId) : null;
    if (
      !job ||
      !ownsJob(job, workerToken) ||
      !jobAuthorizedForExecution(site, job)
    ) {
      throw new Error("Worker lease lost");
    }
    const currentTime = now();
    if (job.reservationId) {
      const reservation = await ctx.db.get(job.reservationId);
      if (reservation?.state === "reserved" && reservation.jobId === jobId) {
        await ctx.db.patch(reservation._id, {
          expiresAt: currentTime + JOB_LEASE_MS + 5 * 60 * 1000,
        });
      }
    }
    await renewArticleProviderAttempt(ctx, job, currentTime);
    await ctx.db.patch(jobId, {
      stepProgress: { current, total, stepLabel, topicLabel },
      heartbeatAt: currentTime,
      leaseExpiresAt: currentTime + JOB_LEASE_MS,
      updatedAt: currentTime,
    });
    return { owned: true };
  },
});

export const getRunningBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to access jobs for this site");
    }
    const jobs = await ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "running"),
      )
      .collect();
    return (
      jobs.find((j) => j.status === "running" && (j.type === "article" || j.type === "plan")) ?? null
    );
  },
});

/**
 * Create an article job and immediately schedule autopilotTick to process it.
 * Clients call this instead of invoking generateArticle directly — avoids
 * WebSocket timeout errors on long-running actions.
 */
// Find the pending job for a specific topic
export const getPendingByTopic = query({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic) return null;
    const site = await ctx.db.get(topic.siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to access this topic's jobs");
    }
    const pending = await ctx.db
      .query("jobs")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", topic.siteId).eq("status", "pending"),
      )
      .collect();
    return pending.find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return job.siteId === topic.siteId && payload.topicId === topicId;
    }) ?? null;
  },
});

// Run a specific queued topic NOW — finds its pending job and schedules processing
export const runQueuedTopic = mutation({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    const requestedTopic = await ctx.db.get(topicId);
    if (!requestedTopic) throw new Error("Topic not found.");
    const requestedSite = await ctx.db.get(requestedTopic.siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (
      !requestedSite?.userId ||
      !identity ||
      identity.subject !== requestedSite.userId
    ) {
      throw new Error("Not authorized to run this topic");
    }
    if (requestedSite.deletionStatus || requestedSite.planParkedAt) {
      throw new Error("This site is not active under the current plan");
    }
    if (topicUnavailableForArticleQueue(requestedTopic)) {
      throw new Error("This topic is locked by durable plan recovery");
    }
    if (!topicMatchesCurrentDomain(requestedSite, requestedTopic)) {
      throw new Error("This topic belongs to an earlier site domain");
    }
    const allowance = await currentSitePlanAllowance(ctx, requestedSite);
    if (!allowance.ok) throw new Error(allowance.reason);
    const active = await activeJobsForSite(ctx, requestedTopic.siteId);
    const existing = active.find((job) => {
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return job.type === "article" && payload.topicId === topicId;
    });
    if (existing) {
      if (existing.status === "pending" && (existing.nextAttemptAt ?? 0) <= now()) {
        await ctx.scheduler.runAfter(0, internal.actions.pipeline.processNextJob, {
          siteId: requestedTopic.siteId,
          jobId: existing._id,
        });
      }
      return existing._id;
    }
    if (requestedTopic.status === "used") {
      throw new Error("This topic already has a generated article");
    }
    const siteId = requestedTopic.siteId;

    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: { topicId, manual: true },
      ...rolloutFields(requestedSite, true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });

    await ctx.db.patch(topicId, { status: "queued", updatedAt: now() });

    await ctx.scheduler.runAfter(0, internal.actions.pipeline.processNextJob, {
      siteId,
      jobId,
    });
    return jobId;
  },
});

export const queueArticleNow = mutation({
  args: {
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
  },
  handler: async (ctx, { siteId, topicId }) => {
    // ── Article quota check (uses immutable usage_log — survives deletions) ──
    const site = await ctx.db.get(siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to queue content for this site");
    }
    if (site.deletionStatus || site.planParkedAt) {
      throw new Error("This site is not active under the current plan");
    }
    const allowance = await currentSitePlanAllowance(ctx, site);
    if (!allowance.ok) throw new Error(allowance.reason);
    if (site.userId) {
      const limits = allowance.limits;

      // Count from usage_log (immutable — deletions cannot reduce count)
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const monthStartMs = monthStart.getTime();

      const logs = await ctx.db
        .query("usage_log")
        .withIndex("by_user_type_created", (q) =>
          q
            .eq("userId", site.userId!)
            .eq("type", "article_generated")
            .gte("createdAt", monthStartMs),
        )
        .collect();
      const currentTime = now();
      const articlesThisMonth = logs.filter(
        (log) =>
          log.state !== "reserved" || (log.expiresAt ?? Infinity) > currentTime,
      ).length;

      if (articlesThisMonth >= limits.maxArticles) {
        throw new Error(
          `Article limit reached (${limits.maxArticles}/month). Upgrade your plan for more articles.`,
        );
      }

    }

    const requestedTopic = topicId ? await ctx.db.get(topicId) : null;
    if (topicId && (!requestedTopic || requestedTopic.siteId !== siteId)) {
      throw new Error("Topic does not belong to this site");
    }
    if (requestedTopic && topicUnavailableForArticleQueue(requestedTopic)) {
      throw new Error("This topic is locked by durable plan recovery");
    }
    if (requestedTopic && !topicMatchesCurrentDomain(site, requestedTopic)) {
      throw new Error("This topic belongs to an earlier site domain");
    }

    const active = await activeJobsForSite(ctx, siteId);
    const duplicate = active.find((job) => {
      if (job.type !== "article") return false;
      const payload = job.payload && typeof job.payload === "object"
        ? (job.payload as Record<string, unknown>)
        : {};
      return topicId ? payload.topicId === topicId : payload.manual === true;
    });
    if (duplicate) return duplicate._id;

    if (topicId) {
      if (requestedTopic!.status === "used") {
        throw new Error("This topic already has a generated article");
      }
    }

    const jobId = await ctx.db.insert("jobs", {
      siteId,
      type: "article",
      status: "pending",
      payload: { topicId: topicId ?? undefined, manual: true },
      ...rolloutFields(site, true),
      workerAttempts: 0,
      publicationAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    });

    if (topicId) {
      await ctx.db.patch(topicId, { status: "queued", updatedAt: now() });
    }

    // Schedule the durable worker directly for this exact job. Wrapping it in
    // another action can exhaust the parent request deadline before the child
    // finishes and strand a running lease.
    await ctx.scheduler.runAfter(0, internal.actions.pipeline.processNextJob, {
      siteId,
      jobId,
    });

    return jobId;
  },
});
