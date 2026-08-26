import { internal } from "./_generated/api";
import { sanitizeSkipReceiptForOperator } from "./lib/expectedClickSkipReceipt";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { PUBLICATION_AUDIT_VERSION } from "./lib/publicationArtifact";
import {
  MIN_APPROVED_BUFFER,
  TARGET_APPROVED_BUFFER,
  autopilotHealthStatus,
  cadenceIntervalMs,
  currentHealthOutcome,
  effectivePublishedAt,
  isSealedReady,
} from "./lib/autopilotBuffer";
import {
  describeAutopilotBlockers,
  liveAutopilotReadiness,
  requiredMonthlyArticlesForCadence,
  warmAutopilotReadiness,
} from "./lib/autopilotReadiness";
import { getLimitsFromFeatures } from "./planLimits";
import {
  autopilotAlertRequiresAttention,
  isRecoveredByHealthyAutopilotReceipt,
} from "./lib/autopilotAlerts";
import {
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import { oneSetupPromotionBlockers } from "./lib/oneSetupRuntime.ts";
import { jobAuthorizedForExecution } from "./lib/jobRollout";
import {
  countsTowardTopicPlanRecentLimit,
  PLAN_CHECKPOINT_SINGLE_EXECUTION_VERSION,
  topicPlanCooldownReceiptState,
  topicPlanCooldownTerminalWriteAllowed,
  topicPlanCooldownWatchdogDecision,
  topicPlanCooldownWakeAt,
  topicPlanProviderReservationTriggerFromPayload,
  topicPlanSettlementDecision,
  TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS,
  TOPIC_PLAN_COOLDOWN_MAX_CONTINUATION_ATTEMPTS,
  TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT,
  TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
  TOPIC_PLAN_SETTLEMENT_POLL_MS,
} from "./lib/planProviderBudget";
import { classifyAutopilotRunOutcome } from
  "./lib/autopilotRunOutcome.ts";
import {
  OPERATOR_PLAN_CHECKPOINT_READ_LIMIT,
  OPERATOR_PLAN_RECEIPT_LIMIT,
  latestTerminalPlanJobs,
  operatorContinuationRunReceipt,
  operatorActiveJobReceipt,
  operatorArticleReceipt,
  operatorHealthReceipt,
  operatorTerminalPlanReceipt,
} from "./lib/operatorSnapshot.ts";
import {
  articleMatchesCurrentDomain,
  normalizeCanonicalDomain,
  pageMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
  latestCurrentDomainPublishedSummaries,
  takeCurrentDomainArticleSummariesByStatus,
  takeCurrentDomainArticles,
} from "./lib/siteDomainBinding";

const SITE_STAGGER_MS = 5_000;
const LEGACY_PUBLISHER_PREFLIGHT_RETRY_MS = 24 * 60 * 60 * 1000;
const NATURAL_RUN_STALE_MS = 4 * 60 * 60 * 1000;
const PUBLICATION_INTEGRITY_MIGRATION_KEY = "publication-integrity-v4";
const PUBLIC_URL_VERIFIED_TRIGGER = "public_url_verified";
const PUBLIC_URL_VERIFIED_RECOVERY_PREFIX =
  "operator_recovery_of_public_url_verified:";
const PUBLIC_URL_VERIFIED_RECOVERY_HEADROOM_MS = 60_000;
const TOPIC_PLAN_COOLDOWN_ACTIVE_JOB_READ_LIMIT = 50;

async function publicationCommitBlocksRolloutTransition(
  ctx: MutationCtx,
  site: Doc<"sites">,
): Promise<boolean> {
  if (site.publicationLeaseOwner) return true;
  for (const status of ["leased", "attempted"] as const) {
    const unresolved = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", site._id).eq("status", status)
      )
      .first();
    if (unresolved) return true;
  }
  const ambiguous = await ctx.db
    .query("published_article_revisions")
    .withIndex("by_site_status", (q) =>
      q.eq("siteId", site._id).eq("status", "unverified")
    )
    .filter((q) => q.eq(q.field("receipt"), undefined))
    .first();
  return Boolean(ambiguous);
}

async function hasCurrentDomainPage(
  ctx: MutationCtx | QueryCtx,
  site: Doc<"sites">,
): Promise<boolean> {
  const canonicalDomain = siteCanonicalDomain(site);
  const domainRevision = siteCanonicalDomainRevision(site);
  if (!canonicalDomain) return false;
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("pages")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .collect();
    return legacyEpoch.some((page) => pageMatchesCurrentDomain(site, page));
  }
  const stamped = await ctx.db
    .query("pages")
    .withIndex("by_site_domain_revision", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", domainRevision)
    )
    .first();
  return Boolean(stamped);
}

async function upsertHealth(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  patch: Partial<
    Omit<Doc<"autopilot_health">, "_id" | "_creationTime" | "siteId">
  >,
) {
  const existing = await ctx.db
    .query("autopilot_health")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .first();
  const fields = { ...patch, updatedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, fields);
  else {
    await ctx.db.insert("autopilot_health", {
      siteId,
      heartbeatAt: Date.now(),
      status: "recovering",
      ...fields,
    });
  }
  if (patch.status === "healthy") {
    await resolveAlertsRecoveredByHealthyReceipt(ctx, siteId, fields.updatedAt);
  }
}

async function resolveAlertsRecoveredByHealthyReceipt(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  receiptAt: number,
) {
  const active = await ctx.db
    .query("autopilot_alerts")
    .withIndex("by_site_status", (q) =>
      q.eq("siteId", siteId).eq("status", "active"),
    )
    .take(100);
  for (const alert of active) {
    if (
      alert.updatedAt <= receiptAt &&
      isRecoveredByHealthyAutopilotReceipt(alert.kind)
    ) {
      await ctx.db.patch(alert._id, {
        status: "resolved",
        resolvedAt: receiptAt,
        updatedAt: receiptAt,
      });
    }
  }
}

async function setAlert(
  ctx: MutationCtx,
  args: {
    siteId: Id<"sites">;
    runId?: Id<"autopilot_runs">;
    kind: string;
    message: string;
    details?: unknown;
  },
) {
  const existing = await ctx.db
    .query("autopilot_alerts")
    .withIndex("by_site_kind_status", (q) =>
      q.eq("siteId", args.siteId).eq("kind", args.kind).eq("status", "active"),
    )
    .first();
  const fields = {
    runId: args.runId,
    message: args.message,
    details: args.details,
    updatedAt: Date.now(),
  };
  if (existing) await ctx.db.patch(existing._id, fields);
  else {
    await ctx.db.insert("autopilot_alerts", {
      siteId: args.siteId,
      kind: args.kind,
      status: "active",
      createdAt: Date.now(),
      ...fields,
    });
  }
}

async function resolveAlert(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  kind: string,
) {
  const active = await ctx.db
    .query("autopilot_alerts")
    .withIndex("by_site_kind_status", (q) =>
      q.eq("siteId", siteId).eq("kind", kind).eq("status", "active"),
    )
    .collect();
  for (const alert of active) {
    await ctx.db.patch(alert._id, {
      status: "resolved",
      resolvedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

export const dispatchActiveSites = internalMutation({
  args: {
    trigger: v.optional(v.string()),
    cronSlotUTC: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const now = args.scheduledAt ?? Date.now();
    const trigger = args.trigger ?? "natural";
    const page = await ctx.db
      .query("sites")
      .withIndex("by_autopilot", (q) => q.eq("autopilotEnabled", true))
      .filter((q) =>
        q.and(
          q.eq(q.field("deletionStatus"), undefined),
          q.eq(q.field("planParkedAt"), undefined),
        )
      )
      .paginate({ cursor: args.cursor ?? null, numItems: 25 });
    const activeSites: typeof page.page = [];
    for (const site of page.page) {
      // The index excludes parked sites, but a trusted billing receipt pauses
      // the whole account while its bounded site reconciliation is in flight.
      if (!(await siteExecutionAuthorized(ctx, site))) continue;
      if ((site.cadencePerWeek ?? 0) <= 0) {
        await setAlert(ctx, {
          siteId: site._id,
          kind: "cadence_paused",
          message:
            "Publishing is paused because this site has no current account-wide article allocation.",
        });
        await upsertHealth(ctx, site._id, {
          heartbeatAt: now,
          status: "cadence_paused",
          detail:
            "No generation or publication is scheduled while the effective cadence is paused.",
        });
        continue;
      }
      await resolveAlert(ctx, site._id, "cadence_paused");
      const currentMode = site.autopilotRolloutMode ?? "observe";
      if (["warm", "live"].includes(currentMode)) {
        // Expected-click planning is part of every advertised plan. Preserve
        // an explicit false emergency stop, but enroll legacy warm/live sites
        // whose compatibility flag predates the general tenant rollout.
        if (
          site.expectedClickSchedulingEnabled === undefined ||
          site.verifiedKeywordDataRequired !== true
        ) {
          const enrolledAt = Date.now();
          const expectedClickSchedulingEnabled =
            site.expectedClickSchedulingEnabled ?? true;
          await ctx.db.patch(site._id, {
            expectedClickSchedulingEnabled,
            verifiedKeywordDataRequired: true,
            updatedAt: enrolledAt,
          });
          activeSites.push({
            ...site,
            expectedClickSchedulingEnabled,
            verifiedKeywordDataRequired: true,
            updatedAt: enrolledAt,
          });
        } else {
          activeSites.push(site);
        }
        continue;
      }
      const hasCrawledPage = await hasCurrentDomainPage(ctx, site);
      const baseReadiness = warmAutopilotReadiness(site, hasCrawledPage);
      const setupBlockers = await oneSetupPromotionBlockers(ctx, site);
      const readiness = {
        ready: baseReadiness.ready && setupBlockers.length === 0,
        blockers: [...baseReadiness.blockers, ...setupBlockers],
      };
      if (!readiness.ready) {
        const canNaturallyVerifyLegacyPublisher =
          readiness.blockers.length === 1 &&
          readiness.blockers[0] === "publication_adapter_unverified" &&
          site.approvalRequired !== true &&
          ["wordpress", "webhook"].includes(site.publishMethod ?? "") &&
          now - (site.publicationAdapterVerificationAttemptedAt ?? 0) >=
            LEGACY_PUBLISHER_PREFLIGHT_RETRY_MS;
        if (canNaturallyVerifyLegacyPublisher) {
          await ctx.db.patch(site._id, {
            publicationAdapterVerificationAttemptedAt: now,
            publicationAdapterVerificationFailedAt: undefined,
            publicationAdapterVerificationFailureCode: undefined,
            updatedAt: now,
          });
          await ctx.scheduler.runAfter(
            0,
            internal.publisher.verifyLegacyPublicationDestinationInternal,
            { siteId: site._id, attemptedAt: now },
          );
        }
        const blockerDetail = describeAutopilotBlockers(readiness.blockers);
        await setAlert(ctx, {
          siteId: site._id,
          kind: "autopilot_readiness_blocked",
          message: `Autopilot setup is incomplete: ${blockerDetail}.`,
          details: { blockers: readiness.blockers },
        });
        await upsertHealth(ctx, site._id, {
          heartbeatAt: now,
          status: "readiness_blocked",
          detail: `Autopilot setup is incomplete: ${blockerDetail}.`,
        });
        continue;
      }
      if (await publicationCommitBlocksRolloutTransition(ctx, site)) {
        await setAlert(ctx, {
          siteId: site._id,
          kind: "rollout_conflict",
          message:
            "Autopilot rollout is frozen until the exact external publication outcome is reconciled.",
          details: { blocker: "publication_commit_unresolved" },
        });
        continue;
      }
      const promotedAt = Date.now();
      await ctx.db.patch(site._id, {
        autopilotRolloutMode: "warm",
        autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
        autopilotRolloutStartedAt: promotedAt,
        expectedClickSchedulingEnabled: true,
        verifiedKeywordDataRequired: true,
        updatedAt: promotedAt,
      });
      await resolveAlert(ctx, site._id, "autopilot_readiness_blocked");
      activeSites.push({
        ...site,
        autopilotRolloutMode: "warm",
        autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
        autopilotRolloutStartedAt: promotedAt,
        expectedClickSchedulingEnabled: true,
        verifiedKeywordDataRequired: true,
        updatedAt: promotedAt,
      });
    }

    for (const [index, site] of activeSites.entries()) {
      await resolveAlert(ctx, site._id, "rollout_conflict");
      const runId = await ctx.db.insert("autopilot_runs", {
        siteId: site._id,
        trigger,
        cronSlotUTC: args.cronSlotUTC,
        scheduledAt: now,
        heartbeatAt: now,
        status: "scheduled",
      });
      await upsertHealth(ctx, site._id, {
        lastRunId: runId,
        heartbeatAt: now,
        status: "recovering",
        detail: `Autopilot ${trigger} run scheduled.`,
        ...(trigger === "natural" ? { lastNaturalScheduledAt: now } : {}),
      });
      await ctx.scheduler.runAfter(
        index * SITE_STAGGER_MS,
        internal.actions.pipeline.autopilotTick,
        { siteId: site._id, runId, trigger },
      );
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        Math.max(1, activeSites.length) * SITE_STAGGER_MS,
        internal.autopilot.dispatchActiveSites,
        {
          trigger,
          cronSlotUTC: args.cronSlotUTC,
          scheduledAt: now,
          cursor: page.continueCursor,
        },
      );
    }

    return { scheduled: activeSites.length };
  },
});

export const dispatchSiteFollowup = internalMutation({
  args: {
    siteId: v.id("sites"),
    trigger: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { siteId, trigger, reason }) => {
    const site = await ctx.db.get(siteId);
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.autopilotEnabled ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe")
    ) {
      return { scheduled: false, reason: "autopilot_disabled" };
    }
    const scheduledAt = Date.now();
    const runId = await ctx.db.insert("autopilot_runs", {
      siteId,
      trigger,
      scheduledAt,
      heartbeatAt: scheduledAt,
      status: "scheduled",
      detail: reason,
    });
    await upsertHealth(ctx, siteId, {
      lastRunId: runId,
      heartbeatAt: scheduledAt,
      status: "recovering",
      detail: `Scheduled ${trigger} follow-up (${reason}).`,
    });
    await ctx.scheduler.runAfter(0, internal.actions.pipeline.autopilotTick, {
      siteId,
      runId,
      trigger,
    });
    return { scheduled: true, runId };
  },
});

// Operator-only recovery for the narrow case where the live URL was already
// verified but its immediate scheduler follow-up failed. The failed run stays
// immutable evidence. A recovery run carries a dedicated immutable receipt
// keyed to that exact failure, so concurrent or repeated invocations schedule
// at most one replacement tick even after normal run completion rewrites its
// operator-facing detail.
export const recoverFailedPublicUrlVerifiedFollowup = internalMutation({
  args: {
    siteId: v.id("sites"),
    failedRunId: v.id("autopilot_runs"),
  },
  handler: async (ctx, { siteId, failedRunId }) => {
    const failedRun = await ctx.db.get(failedRunId);
    if (!failedRun || failedRun.siteId !== siteId) {
      throw new Error("Public URL follow-up recovery run/tenant mismatch");
    }
    if (
      failedRun.trigger !== PUBLIC_URL_VERIFIED_TRIGGER ||
      failedRun.status !== "failed"
    ) {
      throw new Error(
        "Only a failed public_url_verified run can be recovered",
      );
    }

    const recoveryDetail =
      `${PUBLIC_URL_VERIFIED_RECOVERY_PREFIX}${failedRunId}`;
    const existingRecovery = await ctx.db
      .query("autopilot_runs")
      .withIndex("by_site_recovery_source", (q) =>
        q.eq("siteId", siteId).eq("recoveryOfRunId", failedRunId),
      )
      .unique();
    if (existingRecovery) {
      return {
        scheduled: false,
        reason: "already_replayed",
        runId: existingRecovery._id,
      };
    }

    const site = await ctx.db.get(siteId);
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.autopilotEnabled ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe")
    ) {
      throw new Error("Site is not eligible for autopilot follow-up recovery");
    }
    const [
      health,
      [latestModernPublished, latestPublishedByCreation],
      pendingJob,
      runningJob,
    ] = await Promise.all([
      ctx.db
        .query("autopilot_health")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .first(),
      latestCurrentDomainPublishedSummaries(
        ctx,
        site,
        PUBLICATION_AUDIT_VERSION,
      ),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "pending"),
        )
        .first(),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "running"),
        )
        .first(),
    ]);
    // The failed run must still be the unrecovered health receipt. Any newer
    // run means another worker or operator has already superseded this repair.
    if (!health || health.lastRunId !== failedRunId) {
      throw new Error(
        "Public URL follow-up recovery was superseded by a later run",
      );
    }
    if (pendingJob || runningJob) {
      throw new Error(
        "Public URL follow-up recovery refused while tenant work is active",
      );
    }

    const latestPublished = [
      latestModernPublished,
      latestPublishedByCreation,
    ]
      .filter(
        (article): article is Doc<"article_summaries"> => Boolean(article),
      )
      .sort(
        (a, b) =>
          effectivePublishedAt({
            createdAt: b.articleCreatedAt,
            publishedAt: b.publishedAt,
            publicationAuditVersion: b.publicationAuditVersion,
            auditedContentHash: b.auditedContentHash,
          }) -
          effectivePublishedAt({
            createdAt: a.articleCreatedAt,
            publishedAt: a.publishedAt,
            publicationAuditVersion: a.publicationAuditVersion,
            auditedContentHash: a.auditedContentHash,
          }),
      )[0];
    if (!latestPublished || latestPublished.publicUrlStatus !== "verified") {
      throw new Error(
        "Latest delivered article is not verified at its public URL",
      );
    }
    if (
      !latestPublished.publicUrlVerifiedAt ||
      failedRun.scheduledAt < latestPublished.publicUrlVerifiedAt
    ) {
      throw new Error(
        "Failed follow-up does not belong to the latest verified publication",
      );
    }

    const lastPublishedAt = effectivePublishedAt({
      createdAt: latestPublished.articleCreatedAt,
      publishedAt: latestPublished.publishedAt,
      publicationAuditVersion: latestPublished.publicationAuditVersion,
      auditedContentHash: latestPublished.auditedContentHash,
    });
    const nextPublicationDueAt =
      lastPublishedAt + cadenceIntervalMs(site.cadencePerWeek ?? 4);
    const scheduledAt = Date.now();
    if (
      scheduledAt + PUBLIC_URL_VERIFIED_RECOVERY_HEADROOM_MS >=
      nextPublicationDueAt
    ) {
      throw new Error(
        "Cadence deadline has arrived; refusing a post-verification recovery that could publish",
      );
    }
    if (
      health.lastPublishedAt !== lastPublishedAt ||
      health.nextPublicationDueAt !== nextPublicationDueAt
    ) {
      throw new Error(
        "Cadence health does not match the latest verified publication",
      );
    }

    const runId = await ctx.db.insert("autopilot_runs", {
      siteId,
      trigger: PUBLIC_URL_VERIFIED_TRIGGER,
      recoveryOfRunId: failedRunId,
      scheduledAt,
      heartbeatAt: scheduledAt,
      status: "scheduled",
      detail: recoveryDetail,
    });
    await upsertHealth(ctx, siteId, {
      lastRunId: runId,
      heartbeatAt: scheduledAt,
      status: "recovering",
      detail:
        "Replaying the failed post-verification scheduler follow-up exactly once.",
    });
    await ctx.scheduler.runAfter(0, internal.actions.pipeline.autopilotTick, {
      siteId,
      runId,
      trigger: PUBLIC_URL_VERIFIED_TRIGGER,
    });
    return {
      scheduled: true,
      runId,
      articleId: latestPublished.articleId,
      lastPublishedAt,
      nextPublicationDueAt,
    };
  },
});

// One-shot receipt migration for a recovery that completed before
// `recoveryOfRunId` existed. It only binds two exact historical runs; it does
// not change health, resolve alerts, schedule work, or touch publication state.
export const backfillPublicUrlVerifiedRecoveryReceipt = internalMutation({
  args: {
    siteId: v.id("sites"),
    failedRunId: v.id("autopilot_runs"),
    recoveryRunId: v.id("autopilot_runs"),
    backfillVersion: v.literal(1),
  },
  handler: async (
    ctx,
    { siteId, failedRunId, recoveryRunId },
  ) => {
    if (failedRunId === recoveryRunId) {
      throw new Error("Recovery receipt cannot point to itself");
    }
    const [site, failedRun, recoveryRun, conflictingReceipt] =
      await Promise.all([
        ctx.db.get(siteId),
        ctx.db.get(failedRunId),
        ctx.db.get(recoveryRunId),
        ctx.db
          .query("autopilot_runs")
          .withIndex("by_site_recovery_source", (q) =>
            q.eq("siteId", siteId).eq("recoveryOfRunId", failedRunId),
          )
          .unique(),
      ]);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Recovery receipt backfill site is not executable");
    }
    if (
      !failedRun ||
      !recoveryRun ||
      failedRun.siteId !== siteId ||
      recoveryRun.siteId !== siteId
    ) {
      throw new Error("Recovery receipt backfill run/tenant mismatch");
    }
    if (
      failedRun.trigger !== PUBLIC_URL_VERIFIED_TRIGGER ||
      recoveryRun.trigger !== PUBLIC_URL_VERIFIED_TRIGGER ||
      failedRun.status !== "failed" ||
      failedRun.outcome !== "failed" ||
      recoveryRun.status !== "completed" ||
      recoveryRun.outcome === "failed"
    ) {
      throw new Error("Recovery receipt backfill run state mismatch");
    }
    if (
      failedRun.completedAt === undefined ||
      recoveryRun.startedAt === undefined ||
      recoveryRun.completedAt === undefined ||
      recoveryRun._creationTime <= failedRun._creationTime ||
      recoveryRun.scheduledAt < failedRun.completedAt ||
      recoveryRun.startedAt < recoveryRun.scheduledAt ||
      recoveryRun.completedAt < recoveryRun.startedAt ||
      recoveryRun.scheduledAt - failedRun.completedAt > 24 * 60 * 60 * 1000
    ) {
      throw new Error("Recovery receipt backfill timestamp/order mismatch");
    }
    if (conflictingReceipt) {
      if (conflictingReceipt._id === recoveryRunId) {
        return {
          bound: false,
          reason: "already_bound",
          recoveryRunId,
        };
      }
      throw new Error("Failed run already has a conflicting recovery receipt");
    }
    if (recoveryRun.recoveryOfRunId !== undefined) {
      if (recoveryRun.recoveryOfRunId === failedRunId) {
        return {
          bound: false,
          reason: "already_bound",
          recoveryRunId,
        };
      }
      throw new Error("Recovery run is already bound to another failed run");
    }

    await ctx.db.patch(recoveryRunId, { recoveryOfRunId: failedRunId });
    return {
      bound: true,
      failedRunId,
      recoveryRunId,
      backfillVersion: 1,
    };
  },
});

export const promoteWarmSiteIfReady = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    if (site.autopilotRolloutMode !== "warm") {
      return { promoted: false, blockers: ["site_not_warm"] };
    }
    if (await publicationCommitBlocksRolloutTransition(ctx, site)) {
      return {
        promoted: false,
        blockers: ["publication_commit_unresolved"],
      };
    }
    const hasCrawledPage = await hasCurrentDomainPage(ctx, site);
    const limits = getLimitsFromFeatures(site.planFeatures ?? []);
    const baseReadiness = liveAutopilotReadiness(
      site,
      hasCrawledPage,
      limits.maxArticles,
    );
    const setupBlockers = await oneSetupPromotionBlockers(ctx, site, "live");
    const readiness = {
      ready: baseReadiness.ready && setupBlockers.length === 0,
      blockers: [...baseReadiness.blockers, ...setupBlockers],
    };
    const ready = await takeCurrentDomainArticleSummariesByStatus(
      ctx,
      site,
      "ready",
      10,
    );
    const sealedCount = ready.filter(isSealedReady).length;
    const blockers = [...readiness.blockers];
    if (sealedCount < MIN_APPROVED_BUFFER) blockers.push("sealed_buffer_incomplete");
    if (blockers.length > 0) {
      const blockerDetail = describeAutopilotBlockers(blockers);
      await setAlert(ctx, {
        siteId,
        kind: "autopilot_readiness_blocked",
        message: `Autonomous publication is blocked: ${blockerDetail}.`,
        details: { blockers, sealedCount },
      });
      return { promoted: false, blockers, sealedCount };
    }

    const promotedAt = Date.now();
    const rolloutEpoch = (site.autopilotRolloutEpoch ?? 0) + 1;
    await ctx.db.patch(siteId, {
      autopilotRolloutMode: "live",
      autopilotRolloutEpoch: rolloutEpoch,
      autopilotRolloutStartedAt: promotedAt,
      expectedClickSchedulingEnabled: true,
      verifiedKeywordDataRequired: true,
      updatedAt: promotedAt,
    });
    await resolveAlert(ctx, siteId, "autopilot_readiness_blocked");
    await resolveAlert(ctx, siteId, "rollout_buffer_ready");
    const runId = await ctx.db.insert("autopilot_runs", {
      siteId,
      trigger: "automatic_live_promotion",
      scheduledAt: promotedAt,
      heartbeatAt: promotedAt,
      status: "scheduled",
      detail: "Readiness and strict-quality buffer verified; live delivery enabled.",
    });
    await upsertHealth(ctx, siteId, {
      lastRunId: runId,
      heartbeatAt: promotedAt,
      status: "recovering",
      detail: "Autopilot promoted to live; scheduling the first due delivery.",
    });
    await ctx.scheduler.runAfter(0, internal.actions.pipeline.autopilotTick, {
      siteId,
      runId,
      trigger: "automatic_live_promotion",
    });
    return { promoted: true, blockers: [], sealedCount, rolloutEpoch };
  },
});

// The fleet cron is intentionally coarse. A sealed article gets a separate,
// idempotent tenant wake-up at its exact cadence deadline so publication does
// not drift until the next three-hour fleet slot.
export const scheduleCadenceDeadline = internalMutation({
  args: {
    siteId: v.id("sites"),
    dueAt: v.number(),
  },
  handler: async (ctx, { siteId, dueAt }) => {
    const site = await ctx.db.get(siteId);
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.autopilotEnabled ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      site.autopilotRolloutMode !== "live" ||
      site.approvalRequired ||
      (site.publishMethod ?? "github") === "manual"
    ) {
      return { scheduled: false, reason: "autonomous_delivery_disabled" };
    }
    const now = Date.now();
    if (!Number.isFinite(dueAt) || dueAt <= now) {
      return { scheduled: false, reason: "deadline_not_future" };
    }

    const existing = await ctx.db
      .query("autopilot_runs")
      .withIndex("by_site_scheduled", (q) =>
        q.eq("siteId", siteId).eq("scheduledAt", dueAt),
      )
      .filter((q) => q.eq(q.field("trigger"), "cadence_deadline"))
      .first();
    if (existing) {
      return { scheduled: false, reason: "already_armed", runId: existing._id };
    }

    const runId = await ctx.db.insert("autopilot_runs", {
      siteId,
      trigger: "cadence_deadline",
      scheduledAt: dueAt,
      heartbeatAt: now,
      status: "scheduled",
      detail: "Exact cadence deadline armed from a sealed publication buffer.",
    });
    await ctx.scheduler.runAt(
      dueAt,
      internal.actions.pipeline.autopilotTick,
      { siteId, runId, trigger: "cadence_deadline" },
    );
    return { scheduled: true, runId };
  },
});

// Quality-window and monthly-quota blockers have deterministic eligibility
// boundaries too. Persist one exact run receipt so natural ticks cannot fan
// out duplicate wakeups while the blocker remains unchanged.
export const scheduleEligibilityDeadline = internalMutation({
  args: {
    siteId: v.id("sites"),
    dueAt: v.number(),
    trigger: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, { siteId, dueAt, trigger, reason }) => {
    if (![
      "quality_budget_deadline",
      "generation_quota_deadline",
    ].includes(trigger)) {
      throw new Error("Unsupported cadence eligibility deadline");
    }
    const site = await ctx.db.get(siteId);
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.autopilotEnabled ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe")
    ) {
      return { scheduled: false, reason: "autopilot_disabled" };
    }
    const timestamp = Date.now();
    if (!Number.isSafeInteger(dueAt) || dueAt <= timestamp) {
      return { scheduled: false, reason: "deadline_not_future" };
    }
    const existing = await ctx.db
      .query("autopilot_runs")
      .withIndex("by_site_scheduled", (q) =>
        q.eq("siteId", siteId).eq("scheduledAt", dueAt)
      )
      .filter((q) => q.eq(q.field("trigger"), trigger))
      .first();
    if (existing) {
      return { scheduled: false, reason: "already_armed", runId: existing._id };
    }
    const runId = await ctx.db.insert("autopilot_runs", {
      siteId,
      trigger,
      scheduledAt: dueAt,
      heartbeatAt: timestamp,
      status: "scheduled",
      detail: reason,
    });
    await ctx.scheduler.runAt(
      dueAt,
      internal.actions.pipeline.autopilotTick,
      { siteId, runId, trigger },
    );
    return { scheduled: true, runId };
  },
});

// Claim the exact rolling-window wake before the action re-enters the ordinary
// scheduler. The scheduler remains the only queue authority: it recomputes
// current inventory, entitlement, article quota, account/fleet provider
// budgets, and active work before it can reserve or call a provider.
export const claimTopicPlanCooldownWake = internalMutation({
  args: {
    siteId: v.id("sites"),
    runId: v.id("autopilot_runs"),
    planJobId: v.id("jobs"),
    rolloutEpoch: v.number(),
    dueAt: v.number(),
    claimNonce: v.string(),
    continuationAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const [site, run, plan, pending, running] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db.get(args.runId),
      ctx.db.get(args.planJobId),
      ctx.db.query("jobs").withIndex("by_site_status", (q) =>
        q.eq("siteId", args.siteId).eq("status", "pending")
      ).take(TOPIC_PLAN_COOLDOWN_ACTIVE_JOB_READ_LIMIT + 1),
      ctx.db.query("jobs").withIndex("by_site_status", (q) =>
        q.eq("siteId", args.siteId).eq("status", "running")
      ).take(TOPIC_PLAN_COOLDOWN_ACTIVE_JOB_READ_LIMIT + 1),
    ]);
    const close = async (reason: string) => {
      if (run?.siteId === args.siteId && run.status === "scheduled") {
        await ctx.db.patch(args.runId, {
          status: "completed",
          completedAt: timestamp,
          heartbeatAt: timestamp,
          outcome: reason,
          detail: `Topic-plan cooldown wake did not run: ${reason}.`,
        });
      }
      return { claimed: false as const, reason };
    };
    const receiptState = topicPlanCooldownReceiptState({
      run: run
        ? {
            siteId: String(run.siteId),
            trigger: run.trigger,
            claimNonce: run.claimNonce,
            scheduledAt: run.scheduledAt,
            status: run.status,
          }
        : null,
      siteId: String(args.siteId),
      planJobId: String(args.planJobId),
      rolloutEpoch: args.rolloutEpoch,
      dueAt: args.dueAt,
      claimNonce: args.claimNonce,
    });
    if (receiptState !== "scheduled" && receiptState !== "claimed") {
      return close("wake_receipt_incompatible");
    }
    if (
      !Number.isInteger(args.rolloutEpoch) ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.autopilotEnabled ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe") ||
      site.expectedClickSchedulingEnabled !== true
    ) return close("autopilot_or_entitlement_ineligible");
    if ((site.autopilotRolloutEpoch ?? 0) !== args.rolloutEpoch) {
      return close("rollout_epoch_changed");
    }
    const expectedDueAt = plan ? topicPlanCooldownWakeAt(plan.createdAt) : null;
    const payload = plan?.payload && typeof plan.payload === "object"
      ? plan.payload as Record<string, unknown>
      : {};
    if (
      !plan ||
      plan.siteId !== args.siteId ||
      plan.type !== "plan" ||
      plan.rolloutEpoch !== args.rolloutEpoch ||
      payload.manual === true ||
      typeof payload.reason !== "string" ||
      !payload.reason.startsWith("topic_") ||
      !countsTowardTopicPlanRecentLimit(plan) ||
      expectedDueAt !== args.dueAt ||
      timestamp < args.dueAt
    ) return close("plan_cooldown_fence_changed");
    const recentPlans = await ctx.db.query("jobs")
      .withIndex("by_site_type_created", (q) =>
        q
          .eq("siteId", args.siteId)
          .eq("type", "plan")
          .gte("createdAt", plan.createdAt)
      )
      .order("desc")
      .take(TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT + 1);
    if (recentPlans.length > TOPIC_PLAN_RECENT_HISTORY_READ_LIMIT) {
      return close("plan_history_overflow");
    }
    const latestCountedTopicPlan = recentPlans.find((job) => {
      const candidatePayload = job.payload && typeof job.payload === "object"
        ? job.payload as Record<string, unknown>
        : {};
      return candidatePayload.manual !== true &&
        typeof candidatePayload.reason === "string" &&
        candidatePayload.reason.startsWith("topic_") &&
        countsTowardTopicPlanRecentLimit(job);
    });
    if (latestCountedTopicPlan?._id !== args.planJobId) {
      return close("newer_topic_plan_exists");
    }
    const activeJob =
      pending.length > TOPIC_PLAN_COOLDOWN_ACTIVE_JOB_READ_LIMIT ||
      running.length > TOPIC_PLAN_COOLDOWN_ACTIVE_JOB_READ_LIMIT ||
      [...pending, ...running].some((job) =>
        jobAuthorizedForExecution(site, job)
      );
    // A continuation may re-enter only under the exact durable generation
    // atomically assigned by the initial claim or its bounded watchdog.
    if (receiptState === "claimed") {
      if (
        !Number.isInteger(args.continuationAttempt) ||
        args.continuationAttempt !== run?.continuationAttempt
      ) {
        return {
          claimed: false as const,
          reason: "continuation_attempt_incompatible",
        };
      }
      await ctx.db.patch(args.runId, { heartbeatAt: timestamp });
      return { claimed: true as const, replayed: true as const, activeJob };
    }
    if (args.continuationAttempt !== undefined) {
      return close("continuation_before_claim");
    }
    if (activeJob) return close("active_job");

    const continuationAttempt = 1;
    await ctx.db.patch(args.runId, {
      status: "running",
      startedAt: timestamp,
      heartbeatAt: timestamp,
      continuationAttempt,
    });
    await upsertHealth(ctx, args.siteId, {
      lastRunId: args.runId,
      heartbeatAt: timestamp,
      status: "recovering",
      detail:
        "The exact topic-plan cooldown expired; Pentra is rechecking ordinary scheduler gates.",
    });
    const continuation = {
      siteId: args.siteId,
      runId: args.runId,
      trigger: TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
      topicPlanCooldown: {
        planJobId: args.planJobId,
        rolloutEpoch: args.rolloutEpoch,
        dueAt: args.dueAt,
        claimNonce: args.claimNonce,
        continuationAttempt,
      },
    };
    const watchdog = {
      siteId: args.siteId,
      runId: args.runId,
      planJobId: args.planJobId,
      rolloutEpoch: args.rolloutEpoch,
      dueAt: args.dueAt,
      claimNonce: args.claimNonce,
      expectedAttempt: continuationAttempt,
    };
    // Both schedules commit atomically with scheduled→running. The continuation
    // action may execute at most once, while the exactly-once mutation watchdog
    // durably replaces it after a crash before scheduler entry.
    await ctx.scheduler.runAfter(
      0,
      internal.actions.pipeline.autopilotTick,
      continuation,
    );
    await ctx.scheduler.runAfter(
      TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS,
      internal.autopilot.recoverTopicPlanCooldownContinuation,
      watchdog,
    );
    return {
      claimed: true as const,
      dispatched: true as const,
      continuationAttempt,
    };
  },
});

// Read-only exact receipt reinspection for the narrow case where the action
// cannot tell whether its claim mutation committed before the response failed.
export const inspectTopicPlanCooldownWakeClaim = internalQuery({
  args: {
    siteId: v.id("sites"),
    runId: v.id("autopilot_runs"),
    planJobId: v.id("jobs"),
    rolloutEpoch: v.number(),
    dueAt: v.number(),
    claimNonce: v.string(),
    continuationAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const state = topicPlanCooldownReceiptState({
      run: run
        ? {
            siteId: String(run.siteId),
            trigger: run.trigger,
            claimNonce: run.claimNonce,
            scheduledAt: run.scheduledAt,
            status: run.status,
          }
        : null,
      siteId: String(args.siteId),
      planJobId: String(args.planJobId),
      rolloutEpoch: args.rolloutEpoch,
      dueAt: args.dueAt,
      claimNonce: args.claimNonce,
    });
    if (
      state === "claimed" &&
      args.continuationAttempt !== undefined &&
      run?.continuationAttempt !== args.continuationAttempt
    ) return { state: "missing" as const };
    return { state: state === "scheduled" ? "unclaimed" as const : state };
  },
});

// Bind the cooldown run to the one new checkpoint plan returned by the
// ordinary scheduler. The binding, worker dispatch, and terminal observer are
// one transaction: action death after this mutation cannot lose either the
// worker or its settlement watcher, while an ambiguous response cannot queue
// a second worker because `run.jobId` is immutable for this fenced run.
export const armTopicPlanCooldownJobSettlement = internalMutation({
  args: {
    siteId: v.id("sites"),
    runId: v.id("autopilot_runs"),
    sourcePlanJobId: v.id("jobs"),
    jobId: v.id("jobs"),
    rolloutEpoch: v.number(),
    dueAt: v.number(),
    claimNonce: v.string(),
    continuationAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const [run, site, job] = await Promise.all([
      ctx.db.get(args.runId),
      ctx.db.get(args.siteId),
      ctx.db.get(args.jobId),
    ]);
    const receiptState = topicPlanCooldownReceiptState({
      run: run
        ? {
            siteId: String(run.siteId),
            trigger: run.trigger,
            claimNonce: run.claimNonce,
            scheduledAt: run.scheduledAt,
            status: run.status,
          }
        : null,
      siteId: String(args.siteId),
      planJobId: String(args.sourcePlanJobId),
      rolloutEpoch: args.rolloutEpoch,
      dueAt: args.dueAt,
      claimNonce: args.claimNonce,
    });
    if (receiptState === "settled") {
      return { bound: false as const, reason: "run_already_settled" };
    }
    const payload = job?.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    const executionAuthorized = site
      ? await siteExecutionAuthorized(ctx, site)
      : false;
    const exactTarget = Boolean(
      receiptState === "claimed" &&
      run &&
      run.siteId === args.siteId &&
      run.continuationAttempt === args.continuationAttempt &&
      site &&
      executionAuthorized &&
      site.autopilotEnabled === true &&
      (site.cadencePerWeek ?? 0) > 0 &&
      ["warm", "live"].includes(site.autopilotRolloutMode ?? "observe") &&
      site.expectedClickSchedulingEnabled === true &&
      (site.autopilotRolloutEpoch ?? 0) === args.rolloutEpoch &&
      job &&
      job.siteId === args.siteId &&
      job.type === "plan" &&
      ["pending", "running", "done", "failed"].includes(job.status) &&
      job.rolloutEpoch === args.rolloutEpoch &&
      job.createdAt >= args.dueAt &&
      job.createdAt >= (run.startedAt ?? args.dueAt) &&
      payload.manual !== true &&
      typeof payload.reason === "string" &&
      payload.reason.startsWith("topic_") &&
      payload.growthParentArticleId === undefined &&
      payload.planCheckpointModeVersion ===
        PLAN_CHECKPOINT_SINGLE_EXECUTION_VERSION &&
      countsTowardTopicPlanRecentLimit(job) &&
      job.providerSpendReservationId !== undefined &&
      job.providerReservationReleasedAt === undefined &&
      (job.status === "done" || job.status === "failed" ||
        (job.workerAttempts ?? 0) === 0)
    );
    if (!exactTarget) {
      return { bound: false as const, reason: "job_binding_incompatible" };
    }
    if (run!.jobId !== undefined) {
      return run!.jobId === args.jobId
        ? {
            bound: true as const,
            alreadyBound: true as const,
            jobStatus: job!.status,
          }
        : { bound: false as const, reason: "different_job_already_bound" };
    }
    if (run!.topicPlanSettlementAttempt !== undefined) {
      return {
        bound: false as const,
        reason: "settlement_generation_without_binding",
      };
    }

    const settlementAttempt = 1;
    await ctx.db.patch(args.runId, {
      jobId: args.jobId,
      topicPlanSettlementAttempt: settlementAttempt,
      heartbeatAt: timestamp,
      detail:
        `Waiting for exact automatic plan ${args.jobId} to reach a durable terminal receipt.`,
    });
    if (job!.status === "pending") {
      const workerArgs = {
        siteId: args.siteId,
        jobId: args.jobId,
        runId: args.runId,
        runClaimNonce: args.claimNonce,
        runContinuationAttempt: args.continuationAttempt,
      };
      if ((job!.nextAttemptAt ?? 0) > timestamp) {
        await ctx.scheduler.runAt(
          job!.nextAttemptAt!,
          internal.actions.pipeline.processNextJob,
          workerArgs,
        );
      } else {
        await ctx.scheduler.runAfter(
          0,
          internal.actions.pipeline.processNextJob,
          workerArgs,
        );
      }
    }
    await ctx.scheduler.runAfter(
      job!.status === "done" || job!.status === "failed"
        ? 0
        : TOPIC_PLAN_SETTLEMENT_POLL_MS,
      internal.autopilot.settleTopicPlanCooldownJob,
      {
        ...args,
        expectedSettlementAttempt: settlementAttempt,
      },
    );
    return {
      bound: true as const,
      armed: true as const,
      workerDispatched: job!.status === "pending",
      jobStatus: job!.status,
      settlementAttempt,
    };
  },
});

// Readback for an action that cannot distinguish a rejected arm from a
// committed arm whose response was lost. It is deliberately receipt-only and
// cannot dispatch or settle anything.
export const inspectTopicPlanCooldownJobSettlement = internalQuery({
  args: {
    siteId: v.id("sites"),
    runId: v.id("autopilot_runs"),
    sourcePlanJobId: v.id("jobs"),
    jobId: v.id("jobs"),
    rolloutEpoch: v.number(),
    dueAt: v.number(),
    claimNonce: v.string(),
    continuationAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    const receiptState = topicPlanCooldownReceiptState({
      run: run
        ? {
            siteId: String(run.siteId),
            trigger: run.trigger,
            claimNonce: run.claimNonce,
            scheduledAt: run.scheduledAt,
            status: run.status,
          }
        : null,
      siteId: String(args.siteId),
      planJobId: String(args.sourcePlanJobId),
      rolloutEpoch: args.rolloutEpoch,
      dueAt: args.dueAt,
      claimNonce: args.claimNonce,
    });
    if (receiptState === "settled") return { state: "settled" as const };
    if (
      receiptState !== "claimed" ||
      run?.continuationAttempt !== args.continuationAttempt
    ) return { state: "missing" as const };
    if (run.jobId === undefined) return { state: "unbound" as const };
    return run.jobId === args.jobId &&
        Number.isSafeInteger(run.topicPlanSettlementAttempt)
      ? { state: "bound" as const, jobId: run.jobId }
      : { state: "missing" as const };
  },
});

// Provider-free exact-job observer. Terminal jobs are handed to the existing
// run finalizers; a confirmation generation is pre-armed in the same
// transaction, so an ambiguous finalizer response is safely reinspected.
// Pending/running jobs are never reset or requeued here.
export const settleTopicPlanCooldownJob = internalMutation({
  args: {
    siteId: v.id("sites"),
    runId: v.id("autopilot_runs"),
    sourcePlanJobId: v.id("jobs"),
    jobId: v.id("jobs"),
    rolloutEpoch: v.number(),
    dueAt: v.number(),
    claimNonce: v.string(),
    continuationAttempt: v.number(),
    expectedSettlementAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const [run, job] = await Promise.all([
      ctx.db.get(args.runId),
      ctx.db.get(args.jobId),
    ]);
    const receiptState = topicPlanCooldownReceiptState({
      run: run
        ? {
            siteId: String(run.siteId),
            trigger: run.trigger,
            claimNonce: run.claimNonce,
            scheduledAt: run.scheduledAt,
            status: run.status,
          }
        : null,
      siteId: String(args.siteId),
      planJobId: String(args.sourcePlanJobId),
      rolloutEpoch: args.rolloutEpoch,
      dueAt: args.dueAt,
      claimNonce: args.claimNonce,
    });
    if (
      !run ||
      run.jobId !== args.jobId ||
      run.continuationAttempt !== args.continuationAttempt ||
      !job ||
      job.siteId !== args.siteId ||
      job.type !== "plan" ||
      job.rolloutEpoch !== args.rolloutEpoch
    ) return { settled: false as const, reason: "settlement_fence_changed" };
    const decision = topicPlanSettlementDecision({
      receiptState,
      currentSettlementAttempt: run.topicPlanSettlementAttempt,
      expectedSettlementAttempt: args.expectedSettlementAttempt,
      jobStatus: job.status,
      leaseExpiresAt: job.leaseExpiresAt,
      now: timestamp,
    });
    if (decision.decision === "already_settled") {
      return { settled: true as const, reason: "already_settled" };
    }
    if (decision.decision === "fence_changed") {
      return { settled: false as const, reason: "settlement_fence_changed" };
    }

    const nextSettlementAttempt = args.expectedSettlementAttempt + 1;
    if (decision.decision === "wait") {
      await ctx.db.patch(args.runId, {
        topicPlanSettlementAttempt: decision.settlementAttempt,
        heartbeatAt: timestamp,
        detail:
          `Waiting for exact automatic plan ${args.jobId} (${job.status}); no provider work was replayed.`,
      });
      await ctx.scheduler.runAfter(
        TOPIC_PLAN_SETTLEMENT_POLL_MS,
        internal.autopilot.settleTopicPlanCooldownJob,
        {
          ...args,
          expectedSettlementAttempt: decision.settlementAttempt,
        },
      );
      return {
        settled: false as const,
        reason: "job_still_active",
        settlementAttempt: decision.settlementAttempt,
      };
    }

    // Advance the observer generation before scheduling either finalizer. A
    // duplicate/stale poll therefore cannot fan out a second terminal write.
    await ctx.db.patch(args.runId, {
      topicPlanSettlementAttempt: nextSettlementAttempt,
      heartbeatAt: timestamp,
    });
    if (decision.decision === "ambiguous") {
      const ambiguityDetail =
        `Exact automatic plan settlement became ambiguous (${decision.reason}); ` +
        "the job and its consumed provider reservation were not replayed.";
      // This mutation already owns the exact run/job/continuation/settlement
      // CAS. Settle the ambiguity here rather than routing through the generic
      // action-failure writer, which intentionally defers every bound job to
      // this observer.
      await ctx.db.patch(args.runId, {
        status: "failed",
        completedAt: timestamp,
        heartbeatAt: timestamp,
        outcome: "failed",
        detail: ambiguityDetail,
        topicPlanSettlementAttempt: nextSettlementAttempt,
      });
      await upsertHealth(ctx, args.siteId, {
        lastRunId: args.runId,
        heartbeatAt: timestamp,
        status: "run_failed",
        detail: ambiguityDetail,
      });
      await setAlert(ctx, {
        siteId: args.siteId,
        runId: args.runId,
        kind: `${TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER}_run_failed`,
        message: ambiguityDetail,
      });
      // Atomically pre-arm one no-op confirmation. A committed response loss
      // observes `settled`; a rolled-back mutation also rolls this schedule
      // back, so no stale generation can fan out.
      await ctx.scheduler.runAfter(
        TOPIC_PLAN_SETTLEMENT_POLL_MS,
        internal.autopilot.settleTopicPlanCooldownJob,
        {
          ...args,
          expectedSettlementAttempt: nextSettlementAttempt,
        },
      );
      return {
        settled: true as const,
        reason: decision.reason,
        replayed: false as const,
      };
    }
    if (decision.decision === "terminal_done" ||
        decision.decision === "terminal_failed") {
      const result = job.result && typeof job.result === "object"
        ? job.result as Record<string, unknown>
        : {};
      const count = Number.isInteger(result.count) ? result.count as number : 0;
      await ctx.scheduler.runAfter(0, internal.autopilot.markRunFinished, {
        runId: args.runId,
        claimNonce: args.claimNonce,
        continuationAttempt: args.continuationAttempt,
        outcome: decision.decision === "terminal_failed"
          ? "job_failed"
          : "job_processed",
        detail: decision.decision === "terminal_failed"
          ? (job.error ?? "The exact automatic topic plan failed.")
          : `The exact automatic topic plan completed with ${count} verified topic(s).`,
        jobId: args.jobId,
      });
    }
    // If the terminal finalizer's response/dispatch is lost, this exact next
    // generation safely tries the same receipt again. Once the run settles,
    // receipt classification makes the confirmation a no-op.
    await ctx.scheduler.runAfter(
      TOPIC_PLAN_SETTLEMENT_POLL_MS,
      internal.autopilot.settleTopicPlanCooldownJob,
      {
        ...args,
        expectedSettlementAttempt: nextSettlementAttempt,
      },
    );
    return {
      settled: false as const,
      reason: decision.decision,
      finalizerScheduled: true as const,
    };
  },
});

// Exactly-once watchdog for an at-most-once action continuation. It never
// queues paid work itself. Each bounded retry must re-enter the complete claim
// fence and ordinary scheduler before any reservation or provider call.
export const recoverTopicPlanCooldownContinuation = internalMutation({
  args: {
    siteId: v.id("sites"),
    runId: v.id("autopilot_runs"),
    planJobId: v.id("jobs"),
    rolloutEpoch: v.number(),
    dueAt: v.number(),
    claimNonce: v.string(),
    expectedAttempt: v.number(),
  },
  handler: async (ctx, args) => {
    const timestamp = Date.now();
    const [run, site, plan] = await Promise.all([
      ctx.db.get(args.runId),
      ctx.db.get(args.siteId),
      ctx.db.get(args.planJobId),
    ]);
    const receiptState = topicPlanCooldownReceiptState({
      run: run
        ? {
            siteId: String(run.siteId),
            trigger: run.trigger,
            claimNonce: run.claimNonce,
            scheduledAt: run.scheduledAt,
            status: run.status,
          }
        : null,
      siteId: String(args.siteId),
      planJobId: String(args.planJobId),
      rolloutEpoch: args.rolloutEpoch,
      dueAt: args.dueAt,
      claimNonce: args.claimNonce,
    });
    if (
      receiptState !== "claimed" ||
      !run ||
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.autopilotEnabled ||
      (site.cadencePerWeek ?? 0) <= 0 ||
      !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe") ||
      site.expectedClickSchedulingEnabled !== true ||
      (site.autopilotRolloutEpoch ?? 0) !== args.rolloutEpoch ||
      !plan ||
      plan.siteId !== args.siteId ||
      plan.rolloutEpoch !== args.rolloutEpoch ||
      topicPlanCooldownWakeAt(plan.createdAt) !== args.dueAt
    ) return { recovered: false as const, reason: "watchdog_fence_changed" };

    // Once the exact new plan is transactionally bound, its worker dispatch
    // and provider-free settlement observer own liveness. Advancing the run
    // generation while that worker is alive would make its eventual terminal
    // receipt stale—the production race this fence prevents.
    if (run.jobId !== undefined) {
      return {
        recovered: false as const,
        reason: "bound_job_settlement_owned",
        jobId: run.jobId,
      };
    }

    const decision = topicPlanCooldownWatchdogDecision({
      receiptState,
      currentAttempt: run.continuationAttempt,
      expectedAttempt: args.expectedAttempt,
      heartbeatAt: run.heartbeatAt,
      now: timestamp,
    });
    if (decision.decision === "fence_changed") {
      return { recovered: false as const, reason: "watchdog_fence_changed" };
    }
    if (decision.decision === "lease_live") {
      await ctx.scheduler.runAt(
        decision.retryAt,
        internal.autopilot.recoverTopicPlanCooldownContinuation,
        args,
      );
      return { recovered: false as const, reason: "continuation_lease_live" };
    }
    if (decision.decision === "exhausted") {
      await ctx.db.patch(args.runId, {
        heartbeatAt: timestamp,
        detail:
          "Bounded exact-wake continuation recovery exhausted; the ordinary fleet dispatcher remains the fail-closed fallback.",
      });
      return { recovered: false as const, reason: "recovery_exhausted" };
    }

    const continuationAttempt = decision.continuationAttempt;
    await ctx.db.patch(args.runId, {
      continuationAttempt,
      heartbeatAt: timestamp,
      detail:
        `Recovering exact topic-plan cooldown continuation ${continuationAttempt}/${TOPIC_PLAN_COOLDOWN_MAX_CONTINUATION_ATTEMPTS}.`,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.actions.pipeline.autopilotTick,
      {
        siteId: args.siteId,
        runId: args.runId,
        trigger: TOPIC_PLAN_COOLDOWN_WAKE_TRIGGER,
        topicPlanCooldown: {
          planJobId: args.planJobId,
          rolloutEpoch: args.rolloutEpoch,
          dueAt: args.dueAt,
          claimNonce: args.claimNonce,
          continuationAttempt,
        },
      },
    );
    await ctx.scheduler.runAfter(
      TOPIC_PLAN_COOLDOWN_CONTINUATION_LEASE_MS,
      internal.autopilot.recoverTopicPlanCooldownContinuation,
      { ...args, expectedAttempt: continuationAttempt },
    );
    return { recovered: true as const, continuationAttempt };
  },
});

export const markRunStarted = internalMutation({
  args: { runId: v.id("autopilot_runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return { started: false as const, reason: "run_missing" };
    if (run.claimNonce) {
      return { started: false as const, reason: "fenced_run" };
    }
    if (run.status !== "scheduled") {
      return { started: false as const, reason: "run_not_scheduled" };
    }
    const site = await ctx.db.get(run.siteId);
    const now = Date.now();
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      await ctx.db.patch(runId, {
        status: "failed",
        completedAt: now,
        heartbeatAt: now,
        outcome: "site_parked",
        detail: "The site is not active under the current plan.",
      });
      return { started: false as const, reason: "site_parked" };
    }
    await ctx.db.patch(runId, {
      status: "running",
      startedAt: now,
      heartbeatAt: now,
    });
    await upsertHealth(ctx, run.siteId, {
      lastRunId: runId,
      heartbeatAt: now,
      status: "recovering",
      detail: "Autopilot tick is running.",
      ...(run.trigger === "natural" ? { lastNaturalStartedAt: now } : {}),
    });
    return { started: true as const };
  },
});

export const recordTopicPortfolioAudit = internalMutation({
  args: {
    siteId: v.id("sites"),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    status: v.string(),
    decision: v.string(),
    supportsGoal: v.boolean(),
    expectedClicksMonthly: v.number(),
    monthlyOrganicClickGoal: v.optional(v.number()),
    clickDeficit: v.optional(v.number()),
    evidenceMissing: v.number(),
    evaluatedAt: v.number(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (
      !site ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      siteCanonicalDomain(site) !==
        normalizeCanonicalDomain(args.expectedCanonicalDomain) ||
      siteCanonicalDomainRevision(site) !== args.expectedDomainRevision
    ) {
      throw new Error("Site not found");
    }
    await upsertHealth(ctx, args.siteId, {
      portfolioStatus: args.status,
      portfolioDecision: args.decision,
      portfolioSupportsGoal: args.supportsGoal,
      portfolioExpectedClicksMonthly: args.expectedClicksMonthly,
      portfolioGoalMonthly: args.monthlyOrganicClickGoal,
      portfolioClickDeficit: args.clickDeficit,
      portfolioEvidenceMissing: args.evidenceMissing,
      portfolioEvaluatedAt: args.evaluatedAt,
      portfolioVersion: args.version,
    });
    return { recorded: true };
  },
});

export const markRunFinished = internalMutation({
  args: {
    runId: v.id("autopilot_runs"),
    claimNonce: v.optional(v.string()),
    continuationAttempt: v.optional(v.number()),
    outcome: v.string(),
    detail: v.optional(v.string()),
    jobId: v.optional(v.id("jobs")),
    articleId: v.optional(v.id("articles")),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    if (run.status !== "running") {
      return { updated: false as const, reason: "run_not_active" };
    }
    if (!topicPlanCooldownTerminalWriteAllowed({
      runClaimNonce: run.claimNonce,
      runContinuationAttempt: run.continuationAttempt,
      runStatus: run.status,
      claimNonce: args.claimNonce,
      continuationAttempt: args.continuationAttempt,
    })) {
      return { updated: false as const, reason: "stale_continuation" };
    }
    if (run.claimNonce && run.jobId) {
      const boundJob = await ctx.db.get(run.jobId);
      if (
        boundJob?.siteId !== run.siteId ||
        boundJob.type !== "plan" ||
        args.jobId !== run.jobId ||
        !["done", "failed"].includes(boundJob.status)
      ) {
        // A duplicate scheduled worker can legitimately lose the atomic job
        // claim while the exact winner remains alive. `claim_lost` (or any
        // other non-terminal response) must leave the run to its bound job
        // observer instead of reporting false completion.
        return {
          updated: false as const,
          reason: "bound_job_settlement_owned",
        };
      }
    }
    const runSite = await ctx.db.get(run.siteId);
    const now = Date.now();
    if (!runSite || !(await siteExecutionAuthorized(ctx, runSite))) {
      const detail = "The site is not active under the current plan.";
      await ctx.db.patch(args.runId, {
        status: "failed",
        completedAt: now,
        heartbeatAt: now,
        outcome: "site_parked",
        detail,
      });
      await upsertHealth(ctx, run.siteId, {
        lastRunId: args.runId,
        heartbeatAt: now,
        status: "run_failed",
        detail,
        ...(run.trigger === "natural" ? { lastNaturalCompletedAt: now } : {}),
      });
      await setAlert(ctx, {
        siteId: run.siteId,
        runId: args.runId,
        kind: run.trigger === "natural"
          ? "natural_run_failed"
          : `${run.trigger}_run_failed`,
        message: `${run.trigger} autopilot run failed: ${detail}`,
      });
      return { updated: true as const, reason: "site_parked" };
    }
    await ctx.db.patch(args.runId, {
      status: "completed",
      completedAt: now,
      heartbeatAt: now,
      outcome: args.outcome,
      detail: args.detail,
      jobId: args.jobId,
      articleId: args.articleId,
    });
    const currentReady = await takeCurrentDomainArticleSummariesByStatus(
      ctx,
      runSite,
      "ready",
      10,
    );
    const approvedBufferCount = currentReady.filter(isSealedReady).length;
    const runClassification = classifyAutopilotRunOutcome({
      outcome: args.outcome,
      approvedBufferCount,
    });
    let completionStatus = runClassification.status;
    let completionDetail =
      args.detail ?? runClassification.detail ?? args.outcome;
    if (!runClassification.recognized) {
      await setAlert(ctx, {
        siteId: run.siteId,
        runId: args.runId,
        kind: "run_outcome_unclassified",
        message:
          `Autopilot returned an unclassified outcome and was failed closed: ${args.outcome}.`,
      });
    } else {
      await resolveAlert(ctx, run.siteId, "run_outcome_unclassified");
    }
    let lastPublishedAt: number | undefined;
    let nextPublicationDueAt: number | undefined;
    if (args.outcome === "rollout_buffer_ready") {
      completionStatus = "readiness_blocked";
      completionDetail =
        args.detail ??
        "The quality buffer is ready, but live publication prerequisites are incomplete.";
    }
    if (args.outcome === "publication_succeeded" && args.articleId) {
      const [article, site] = await Promise.all([
        ctx.db.get(args.articleId),
        ctx.db.get(run.siteId),
      ]);
      if (
        article?.siteId === run.siteId &&
        site &&
        articleMatchesCurrentDomain(site, article)
      ) {
        lastPublishedAt = effectivePublishedAt({
          createdAt: article.createdAt,
          publishedAt: article.publishedAt,
          publicationAuditVersion: article.publicationAuditVersion,
          auditedContentHash: article.auditedContentHash,
        });
        const cadence = site.cadencePerWeek ?? 4;
        if (cadence > 0) {
          const cadenceMs = cadenceIntervalMs(cadence);
          nextPublicationDueAt = lastPublishedAt + cadenceMs;
        } else {
          completionStatus = "cadence_paused";
          completionDetail =
            "The external publication receipt was preserved, but no further work is scheduled while cadence is paused.";
        }
        if (cadence <= 0) {
          // The delivery began before the account allocation changed. Keep
          // the exact external receipt, but do not arm another deadline.
        } else if (article.publicUrlStatus === "pending") {
          completionStatus = "public_url_pending";
          completionDetail =
            "The article reached its configured destination and is awaiting exact public URL verification.";
        } else {
          completionStatus =
            approvedBufferCount === 0
              ? "buffer_empty"
              : approvedBufferCount < MIN_APPROVED_BUFFER
                ? "buffer_low"
                : "healthy";
          completionDetail =
            approvedBufferCount === 0
              ? "Publication succeeded; replenishing the strict-quality future buffer."
              : approvedBufferCount < MIN_APPROVED_BUFFER
                ? "Publication succeeded; the strict-quality future buffer is being replenished."
                : "Publication succeeded and the strict-quality future buffer is healthy.";
        }
      }
    }
    if (args.outcome === "quality_budget_exhausted") {
      const currentHealth = await ctx.db
        .query("autopilot_health")
        .withIndex("by_site", (q) => q.eq("siteId", run.siteId))
        .first();
      completionStatus = autopilotHealthStatus({
        schedulerStale:
          run.trigger === "natural"
            ? false
            : !!currentHealth?.lastNaturalScheduledAt &&
              now - currentHealth.lastNaturalScheduledAt > NATURAL_RUN_STALE_MS,
        publicationMissed:
          !!currentHealth?.nextPublicationDueAt &&
          now > currentHealth.nextPublicationDueAt,
        bufferCount: approvedBufferCount,
        lastOutcome: args.outcome,
      });
      if (completionStatus === "healthy") {
        completionDetail =
          "Scheduler, cadence, and strict-quality publication buffer are healthy.";
      }
    }
    const currentPortfolioHealth = await ctx.db
      .query("autopilot_health")
      .withIndex("by_site", (q) => q.eq("siteId", run.siteId))
      .first();
    if (
      completionStatus === "healthy" &&
      runSite?.expectedClickSchedulingEnabled === true &&
      currentPortfolioHealth?.portfolioSupportsGoal === false
    ) {
      completionStatus = currentPortfolioHealth.portfolioStatus === "below_goal"
        ? "topic_portfolio_below_goal"
        : "topic_portfolio_evidence_missing";
      completionDetail =
        `Cadence is operational, but the measured topic portfolio does not yet support ` +
        `${currentPortfolioHealth.portfolioGoalMonthly ?? "the configured"} organic clicks/month.`;
    }
    await upsertHealth(ctx, run.siteId, {
      lastRunId: args.runId,
      heartbeatAt: now,
      status: completionStatus,
      detail: completionDetail,
      approvedBufferCount,
      ...(lastPublishedAt === undefined
        ? {}
        : { lastPublishedAt, nextPublicationDueAt }),
      ...(run.trigger === "natural" ? { lastNaturalCompletedAt: now } : {}),
    });
    // Completing the run proves the trigger itself worked. Blocked content
    // outcomes have their own alerts and must not leave stale run errors.
    await resolveAlert(
      ctx,
      run.siteId,
      run.trigger === "natural"
        ? "natural_run_failed"
        : `${run.trigger}_run_failed`,
    );
    if (args.outcome !== "topic_replenishment_exhausted") {
      await resolveAlert(ctx, run.siteId, "topic_replenishment_exhausted");
    }
    if (args.outcome === "quality_quarantined") {
      await setAlert(ctx, {
        siteId: run.siteId,
        runId: args.runId,
        kind: "quality_quarantined",
        message: args.detail ?? "A candidate failed the strict publication gate.",
      });
    } else if (args.outcome === "publication_failed") {
      await setAlert(ctx, {
        siteId: run.siteId,
        runId: args.runId,
        kind: "publication_failed",
        message: args.detail ?? "External publication failed.",
      });
    } else if (args.outcome === "job_failed") {
      await setAlert(ctx, {
        siteId: run.siteId,
        runId: args.runId,
        kind: "job_failed",
        message: args.detail ?? "Autopilot content work failed.",
      });
    }

    if (
      args.outcome === "quality_recovered" ||
      args.outcome === "buffer_ready" ||
      args.outcome === "publication_succeeded"
    ) {
      await resolveAlert(ctx, run.siteId, "quality_quarantined");
    }
    if (args.outcome === "publication_succeeded") {
      await resolveAlert(ctx, run.siteId, "publication_failed");
      await resolveAlert(ctx, run.siteId, "missed_publication_sla");
    }
    if (args.outcome === "job_processed") {
      await resolveAlert(ctx, run.siteId, "job_failed");
    }
    return { updated: true as const };
  },
});

export const markRunFailed = internalMutation({
  args: {
    runId: v.id("autopilot_runs"),
    error: v.string(),
    claimNonce: v.optional(v.string()),
    continuationAttempt: v.optional(v.number()),
  },
  handler: async (ctx, { runId, error, claimNonce, continuationAttempt }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    if (run.status !== "running" && run.status !== "scheduled") {
      return { updated: false as const, reason: "run_not_active" };
    }
    if (!topicPlanCooldownTerminalWriteAllowed({
      runClaimNonce: run.claimNonce,
      runContinuationAttempt: run.continuationAttempt,
      runStatus: run.status,
      claimNonce,
      continuationAttempt,
    })) {
      return { updated: false as const, reason: "stale_continuation" };
    }
    if (run.claimNonce && run.jobId) {
      const boundJob = await ctx.db.get(run.jobId);
      if (
        boundJob?.siteId === run.siteId &&
        boundJob.type === "plan" &&
        ["pending", "running", "done", "failed"].includes(boundJob.status)
      ) {
        // An action/scheduler response failure must not overwrite an active or
        // terminal exact-plan receipt with a generic failure. The atomically
        // armed observer will wait for terminal state (or the ambiguity bound)
        // and then settle the run without replay.
        return {
          updated: false as const,
          reason: "bound_job_terminal_settlement_owned",
        };
      }
    }
    const now = Date.now();
    await ctx.db.patch(runId, {
      status: "failed",
      completedAt: now,
      heartbeatAt: now,
      outcome: "failed",
      detail: error,
    });
    await upsertHealth(ctx, run.siteId, {
      lastRunId: runId,
      heartbeatAt: now,
      status: "run_failed",
      detail: error,
      ...(run.trigger === "natural" ? { lastNaturalCompletedAt: now } : {}),
    });
    await setAlert(ctx, {
      siteId: run.siteId,
      runId,
      kind: run.trigger === "natural" ? "natural_run_failed" : `${run.trigger}_run_failed`,
      message: `${run.trigger} autopilot run failed: ${error}`,
    });
    return { updated: true as const };
  },
});

export const raiseAlert = internalMutation({
  args: {
    siteId: v.id("sites"),
    runId: v.optional(v.id("autopilot_runs")),
    kind: v.string(),
    message: v.string(),
    details: v.optional(v.any()),
  },
  handler: setAlert,
});

export const resolveAlertKind = internalMutation({
  args: {
    siteId: v.id("sites"),
    kind: v.string(),
  },
  handler: async (ctx, { siteId, kind }) => {
    await resolveAlert(ctx, siteId, kind);
  },
});

export const auditSla = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_autopilot", (q) => q.eq("autopilotEnabled", true))
      .filter((q) =>
        q.and(
          q.eq(q.field("deletionStatus"), undefined),
          q.eq(q.field("planParkedAt"), undefined),
        )
      )
      .take(50);
    const migrationState = await ctx.db
      .query("maintenance_state")
      .withIndex("by_key", (q) =>
        q.eq("key", PUBLICATION_INTEGRITY_MIGRATION_KEY),
      )
      .first();
    const migrationComplete = migrationState?.status === "completed";
    let missed = 0;
    let stale = 0;
    let bufferLow = 0;
    let migrationPending = 0;

    for (const site of sites) {
      if (!(await siteExecutionAuthorized(ctx, site))) continue;
      const health = await ctx.db
        .query("autopilot_health")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .first();
      if ((site.cadencePerWeek ?? 0) <= 0) {
        await setAlert(ctx, {
          siteId: site._id,
          kind: "cadence_paused",
          message:
            "Publishing is paused because this site has no current account-wide article allocation.",
        });
        await upsertHealth(ctx, site._id, {
          heartbeatAt: health?.heartbeatAt ?? now,
          status: "cadence_paused",
          detail:
            "Cadence is intentionally paused; SEO measurement remains available.",
        });
        continue;
      }
      await resolveAlert(ctx, site._id, "cadence_paused");
      if ((site.autopilotRolloutMode ?? "observe") === "observe") {
        await setAlert(ctx, {
          siteId: site._id,
          kind: "rollout_observe",
          message:
            "Autopilot is in fail-closed observe mode; no generation or publication is authorized.",
        });
        await upsertHealth(ctx, site._id, {
          heartbeatAt: health?.heartbeatAt ?? now,
          status: "rollout_observe",
          detail: "Observe mode: automation is intentionally blocked.",
        });
        continue;
      }
      await resolveAlert(ctx, site._id, "rollout_observe");
      if (!migrationComplete) {
        // One bounded existence read distinguishes a new empty site from any
        // site whose explicit global backfill marker is not complete. A
        // partial set of summaries must never authorize cron to proceed.
        const legacyArticle = (await takeCurrentDomainArticles(
          ctx,
          site,
          1,
        ))[0];
        if (legacyArticle) {
          migrationPending++;
          await setAlert(ctx, {
            siteId: site._id,
            kind: "article_summary_migration_pending",
            message:
              "Legacy article summaries must be backfilled before cadence automation is evaluated.",
          });
          await upsertHealth(ctx, site._id, {
            heartbeatAt: health?.heartbeatAt ?? now,
            status: "migration_pending",
            detail: "Waiting for the resumable legacy article migration.",
          });
          continue;
        }
      }
      await resolveAlert(ctx, site._id, "article_summary_migration_pending");

      const [latestModernPublished, latestPublishedByCreation] =
        await latestCurrentDomainPublishedSummaries(
          ctx,
          site,
          PUBLICATION_AUDIT_VERSION,
        );
      const latestPublished = [
        latestModernPublished,
        latestPublishedByCreation,
      ]
        .filter((article): article is Doc<"article_summaries"> => !!article)
        .sort(
          (a, b) =>
            effectivePublishedAt({
              createdAt: b.articleCreatedAt,
              publishedAt: b.publishedAt,
              publicationAuditVersion: b.publicationAuditVersion,
              auditedContentHash: b.auditedContentHash,
            }) -
            effectivePublishedAt({
              createdAt: a.articleCreatedAt,
              publishedAt: a.publishedAt,
              publicationAuditVersion: a.publicationAuditVersion,
              auditedContentHash: a.auditedContentHash,
            }),
        )[0];
      const readySummaries = await takeCurrentDomainArticleSummariesByStatus(
        ctx,
        site,
        "ready",
        10,
      );

      const approvedBufferCount = readySummaries.filter(isSealedReady).length;
      const autonomousDelivery =
        !site.approvalRequired && (site.publishMethod ?? "github") !== "manual";
      const cadence = site.cadencePerWeek ?? 4;
      const cadenceMs = cadenceIntervalMs(cadence);
      const lastPublishedAt = latestPublished
        ? effectivePublishedAt({
            createdAt: latestPublished.articleCreatedAt,
            publishedAt: latestPublished.publishedAt,
            publicationAuditVersion: latestPublished.publicationAuditVersion,
            auditedContentHash: latestPublished.auditedContentHash,
          })
        : undefined;
      const nextPublicationDueAt =
        (lastPublishedAt ?? site.createdAt) + cadenceMs;
      const schedulerStale = health
        ? health.lastNaturalScheduledAt
          ? now - health.lastNaturalScheduledAt > NATURAL_RUN_STALE_MS
          : now - health.heartbeatAt > NATURAL_RUN_STALE_MS
        : false;
      const publicationMissed = now > nextPublicationDueAt;
      const lastRun = health?.lastRunId
        ? await ctx.db.get(health.lastRunId)
        : null;
      const latestSealedAt = readySummaries
        .filter(isSealedReady)
        .reduce(
          (latest, article) => Math.max(latest, article.articleUpdatedAt),
          0,
        );
      const lastOutcome = currentHealthOutcome({
        lastOutcome: lastRun?.outcome,
        lastOutcomeAt:
          lastRun?.completedAt ?? lastRun?.startedAt ?? lastRun?.scheduledAt,
        latestSealedAt,
      });

      if (schedulerStale) {
        stale++;
        await setAlert(ctx, {
          siteId: site._id,
          kind: "scheduler_stale",
          message: "No natural autopilot dispatch was recorded within four hours.",
          details: { lastNaturalScheduledAt: health?.lastNaturalScheduledAt },
        });
      } else await resolveAlert(ctx, site._id, "scheduler_stale");

      if (publicationMissed) {
        missed++;
        await setAlert(ctx, {
          siteId: site._id,
          kind: "missed_publication_sla",
          message: "No quality-gated article was published by the cadence deadline.",
          details: { lastPublishedAt, nextPublicationDueAt, checkedAt: now },
        });
      } else await resolveAlert(ctx, site._id, "missed_publication_sla");

      if (autonomousDelivery && approvedBufferCount === 0) {
        bufferLow++;
        await setAlert(ctx, {
          siteId: site._id,
          kind: "buffer_empty",
          message: "No strict-quality sealed future article is buffered.",
          details: {
            approvedBufferCount,
            minimum: MIN_APPROVED_BUFFER,
            target: TARGET_APPROVED_BUFFER,
          },
        });
      } else {
        await resolveAlert(ctx, site._id, "buffer_empty");
      }
      if (
        autonomousDelivery &&
        approvedBufferCount > 0 &&
        approvedBufferCount < MIN_APPROVED_BUFFER
      ) {
        bufferLow++;
        await setAlert(ctx, {
          siteId: site._id,
          kind: "buffer_low",
          message: `Approved future-article buffer is below minimum (${approvedBufferCount}/${MIN_APPROVED_BUFFER}).`,
          details: {
            approvedBufferCount,
            minimum: MIN_APPROVED_BUFFER,
            target: TARGET_APPROVED_BUFFER,
          },
        });
      } else {
        await resolveAlert(ctx, site._id, "buffer_low");
      }

      const effectiveBufferCount = autonomousDelivery
        ? approvedBufferCount
        : MIN_APPROVED_BUFFER;
      let status = autopilotHealthStatus({
        schedulerStale,
        publicationMissed,
        bufferCount: effectiveBufferCount,
        lastOutcome,
      });
      if (
        status === "healthy" &&
        site.expectedClickSchedulingEnabled === true &&
        health?.portfolioSupportsGoal === false
      ) {
        status = health.portfolioStatus === "below_goal"
          ? "topic_portfolio_below_goal"
          : "topic_portfolio_evidence_missing";
      }

      await upsertHealth(ctx, site._id, {
        heartbeatAt: health?.heartbeatAt ?? now,
        lastPublishedAt,
        nextPublicationDueAt,
        approvedBufferCount,
        bufferMinimum: MIN_APPROVED_BUFFER,
        bufferTarget: TARGET_APPROVED_BUFFER,
        status,
        detail:
          status === "scheduler_stale"
            ? "Natural dispatcher heartbeat is stale."
            : status === "missed"
              ? "Publication cadence deadline missed."
              : status === "buffer_empty"
                ? "No strict-quality sealed article is buffered."
                : status === "buffer_low"
                  ? "Strict-quality future buffer is below minimum."
                  : status === "quality_quarantined"
                    ? "The latest candidate was quarantined by the strict quality gate."
                    : status === "publication_failed"
                      ? "The latest external publication attempt failed."
                      : status === "job_failed"
                        ? "The latest content or plan worker failed."
                        : status === "topic_portfolio_below_goal"
                          ? "Cadence is healthy, but measured topic demand is below the organic-click goal."
                          : status === "topic_portfolio_evidence_missing"
                            ? "Cadence is healthy, but the topic portfolio lacks fresh outcome evidence."
                      : "Scheduler, quality buffer, and cadence are healthy.",
      });
    }

    return {
      checked: sites.length,
      missed,
      stale,
      bufferLow,
      migrationPending,
    };
  },
});

export const refreshSiteCadenceHealth = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      return { siteId, status: "site_parked" };
    }
    const [health, published, ready] = await Promise.all([
      ctx.db
        .query("autopilot_health")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .first(),
      latestCurrentDomainPublishedSummaries(
        ctx,
        site,
        PUBLICATION_AUDIT_VERSION,
      ),
      takeCurrentDomainArticleSummariesByStatus(ctx, site, "ready", 10),
    ]);
    const [latestModernPublished, latestPublishedByCreation] = published;
    if ((site.cadencePerWeek ?? 0) <= 0) {
      const pausedAt = Date.now();
      await upsertHealth(ctx, siteId, {
        heartbeatAt: health?.heartbeatAt ?? pausedAt,
        status: "cadence_paused",
        detail:
          "Cadence is intentionally paused; no generation or publication is due.",
      });
      return { siteId, status: "cadence_paused" };
    }
    const latestPublished = [
      latestModernPublished,
      latestPublishedByCreation,
    ]
      .filter((article): article is Doc<"article_summaries"> => !!article)
      .sort(
        (a, b) =>
          effectivePublishedAt({
            createdAt: b.articleCreatedAt,
            publishedAt: b.publishedAt,
            publicationAuditVersion: b.publicationAuditVersion,
            auditedContentHash: b.auditedContentHash,
          }) -
          effectivePublishedAt({
            createdAt: a.articleCreatedAt,
            publishedAt: a.publishedAt,
            publicationAuditVersion: a.publicationAuditVersion,
            auditedContentHash: a.auditedContentHash,
          }),
      )[0];
    const lastPublishedAt = latestPublished
      ? effectivePublishedAt({
          createdAt: latestPublished.articleCreatedAt,
          publishedAt: latestPublished.publishedAt,
          publicationAuditVersion: latestPublished.publicationAuditVersion,
          auditedContentHash: latestPublished.auditedContentHash,
        })
      : undefined;
    const cadence = site.cadencePerWeek ?? 4;
    const cadenceMs = cadenceIntervalMs(cadence);
    const nextPublicationDueAt =
      (lastPublishedAt ?? site.createdAt) + cadenceMs;
    const approvedBufferCount = ready.filter(isSealedReady).length;
    const now = Date.now();
    const schedulerStale = health
      ? health.lastNaturalScheduledAt
        ? now - health.lastNaturalScheduledAt > NATURAL_RUN_STALE_MS
        : now - health.heartbeatAt > NATURAL_RUN_STALE_MS
      : false;
    const lastRun = health?.lastRunId
      ? await ctx.db.get(health.lastRunId)
      : null;
    const latestSealedAt = ready
      .filter(isSealedReady)
      .reduce(
        (latest, article) => Math.max(latest, article.articleUpdatedAt),
        0,
      );
    const lastOutcome = currentHealthOutcome({
      lastOutcome: lastRun?.outcome,
      lastOutcomeAt:
        lastRun?.completedAt ?? lastRun?.startedAt ?? lastRun?.scheduledAt,
      latestSealedAt,
    });
    let status =
      lastRun?.status === "running"
        ? "recovering"
        : autopilotHealthStatus({
            schedulerStale,
            publicationMissed: now > nextPublicationDueAt,
            bufferCount: approvedBufferCount,
            lastOutcome,
          });
    if (
      status === "healthy" &&
      site.expectedClickSchedulingEnabled === true &&
      health?.portfolioSupportsGoal === false
    ) {
      status = health.portfolioStatus === "below_goal"
        ? "topic_portfolio_below_goal"
        : "topic_portfolio_evidence_missing";
    }
    const detail =
      status === "recovering"
        ? "Autopilot is actively replenishing the strict-quality buffer."
        : status === "buffer_empty"
          ? "No strict-quality sealed article is buffered."
          : status === "buffer_low"
            ? "Strict-quality future buffer is below minimum."
            : status === "missed"
              ? "Publication cadence deadline missed."
            : status === "scheduler_stale"
              ? "Natural dispatcher heartbeat is stale."
              : status === "job_failed"
                ? "The latest content or plan worker failed."
                : status === "topic_portfolio_below_goal"
                  ? "Cadence is healthy, but measured topic demand is below the organic-click goal."
                  : status === "topic_portfolio_evidence_missing"
                    ? "Cadence is healthy, but the topic portfolio lacks fresh outcome evidence."
                : "Scheduler, quality buffer, and cadence are healthy.";
    await upsertHealth(ctx, siteId, {
      lastPublishedAt,
      nextPublicationDueAt,
      approvedBufferCount,
      bufferMinimum: MIN_APPROVED_BUFFER,
      bufferTarget: TARGET_APPROVED_BUFFER,
      status,
      detail,
    });
    return {
      siteId,
      lastPublishedAt,
      nextPublicationDueAt,
      approvedBufferCount,
      status,
    };
  },
});

export const pruneLifecycle = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 45 * 24 * 60 * 60 * 1000;
    const sites = await ctx.db.query("sites").collect();
    let deletedRuns = 0;
    let deletedAlerts = 0;
    for (const site of sites) {
      const runs = await ctx.db
        .query("autopilot_runs")
        .withIndex("by_site_scheduled", (q) =>
          q.eq("siteId", site._id).lt("scheduledAt", cutoff),
        )
        .take(100);
      for (const run of runs) {
        if (run.status === "completed" || run.status === "failed") {
          await ctx.db.delete(run._id);
          deletedRuns += 1;
        }
      }
      const alerts = await ctx.db
        .query("autopilot_alerts")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .filter((q) =>
          q.and(
            q.eq(q.field("status"), "resolved"),
            q.lt(q.field("updatedAt"), cutoff),
          ),
        )
        .take(100);
      for (const alert of alerts) {
        await ctx.db.delete(alert._id);
        deletedAlerts += 1;
      }
    }
    return { deletedRuns, deletedAlerts };
  },
});

// Bounded, credential-free operations view for scheduled audits and incident
// response. This avoids reading complete article bodies, source snapshots, or
// tenant publishing configuration merely to verify rollout health.
export const getOperatorSnapshot = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    const [
      health,
      runs,
      ready,
      review,
      pending,
      running,
      donePlanJobs,
      failedPlanJobs,
    ] =
      await Promise.all([
      ctx.db
        .query("autopilot_health")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .first(),
      ctx.db
        .query("autopilot_runs")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .order("desc")
        .take(8),
      takeCurrentDomainArticleSummariesByStatus(ctx, site, "ready", 10),
      takeCurrentDomainArticleSummariesByStatus(ctx, site, "review", 8),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "pending"),
        )
        .take(10),
      ctx.db
        .query("jobs")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "running"),
        )
        .take(10),
      ctx.db
        .query("jobs")
        .withIndex("by_site_type_status_created", (q) =>
          q.eq("siteId", siteId).eq("type", "plan").eq("status", "done")
        )
        .order("desc")
        .take(OPERATOR_PLAN_RECEIPT_LIMIT),
      ctx.db
        .query("jobs")
        .withIndex("by_site_type_status_created", (q) =>
          q.eq("siteId", siteId).eq("type", "plan").eq("status", "failed")
        )
        .order("desc")
        .take(OPERATOR_PLAN_RECEIPT_LIMIT),
    ]);
    const planJobs = latestTerminalPlanJobs(donePlanJobs, failedPlanJobs);
    const planReceipts = await Promise.all(planJobs.map(async (job) => {
      const [checkpointRows, reservation] = await Promise.all([
        ctx.db
          .query("plan_candidate_checkpoints")
          .withIndex("by_plan_job", (q) => q.eq("planJobId", job._id))
          .order("desc")
          .take(OPERATOR_PLAN_CHECKPOINT_READ_LIMIT),
        job.providerSpendReservationId
          ? ctx.db.get(job.providerSpendReservationId)
          : null,
      ]);
      const currentDomain = siteCanonicalDomain(site);
      const hasDomainBinding = job.canonicalDomain !== undefined ||
        job.domainRevision !== undefined;
      const domainBinding = hasDomainBinding
        ? normalizeCanonicalDomain(job.canonicalDomain ?? "") ===
              currentDomain &&
            job.domainRevision === siteCanonicalDomainRevision(site)
          ? "current" as const
          : "stale" as const
        : siteUsesLegacyDomainReceipts(site)
          ? "legacy_current" as const
          : "stale" as const;
      const expectedTrigger = topicPlanProviderReservationTriggerFromPayload(
        job.payload,
      );
      return operatorTerminalPlanReceipt({
        siteId,
        siteUserId: site.userId,
        job,
        domainBinding,
        expectedReservationTrigger: expectedTrigger,
        checkpoints: checkpointRows,
        reservation,
      });
    }));
    return {
      site: {
        siteId: site._id,
        autopilotEnabled: site.autopilotEnabled,
        rolloutMode: ["observe", "warm", "live"].includes(
            site.autopilotRolloutMode ?? "observe",
          )
          ? site.autopilotRolloutMode ?? "observe"
          : "unclassified",
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        rolloutStartedAt: site.autopilotRolloutStartedAt,
      },
      health: operatorHealthReceipt(health),
      runs: runs.map(operatorContinuationRunReceipt),
      planReceipts,
      ready: ready.map((article) =>
        operatorArticleReceipt(article, isSealedReady(article))
      ),
      review: review.map((article) =>
        operatorArticleReceipt(article, isSealedReady(article))
      ),
      activeJobs: [...pending, ...running].map(operatorActiveJobReceipt),
      // Why the natural backfill dispatchers last did or did not reserve work.
      // Demand and evidence are separate diagnoses so one stage can never
      // erase the other's reason.
      backfillReservation: {
        demand: sanitizeSkipReceiptForOperator(
          await ctx.db
            .query("expected_click_backfill_skip_receipts")
            .withIndex("by_site_kind", (q) =>
              q.eq("siteId", site._id).eq("kind", "demand")
            )
            .unique(),
        ),
        evidence: sanitizeSkipReceiptForOperator(
          await ctx.db
            .query("expected_click_backfill_skip_receipts")
            .withIndex("by_site_kind", (q) =>
              q.eq("siteId", site._id).eq("kind", "evidence")
            )
            .unique(),
        ),
      },
    };
  },
});

export const getFleetReadiness = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_autopilot", (q) => q.eq("autopilotEnabled", true))
      .filter((q) =>
        q.and(
          q.eq(q.field("deletionStatus"), undefined),
          q.eq(q.field("planParkedAt"), undefined),
        )
      )
      .take(50);
    const rows = [];
    for (const site of sites) {
      const [hasCrawledPage, health, ready] = await Promise.all([
        hasCurrentDomainPage(ctx, site),
        ctx.db
          .query("autopilot_health")
          .withIndex("by_site", (q) => q.eq("siteId", site._id))
          .first(),
        takeCurrentDomainArticleSummariesByStatus(ctx, site, "ready", 10),
      ]);
      const warm = warmAutopilotReadiness(site, hasCrawledPage);
      const limits = getLimitsFromFeatures(site.planFeatures ?? []);
      const requiredMonthlyArticles = requiredMonthlyArticlesForCadence(
        site.cadencePerWeek ?? 4,
      );
      const live = liveAutopilotReadiness(
        site,
        hasCrawledPage,
        limits.maxArticles,
      );
      rows.push({
        siteId: site._id,
        domain: site.domain,
        cadencePerWeek: site.cadencePerWeek ?? 4,
        maxArticlesPerMonth: limits.maxArticles,
        requiredMonthlyArticles,
        rolloutMode: site.autopilotRolloutMode ?? "observe",
        publishMethod: site.publishMethod ?? "github",
        hasCrawledPage,
        gscConnected: Boolean(site.gscAccessToken && site.gscProperty),
        warmReady: warm.ready,
        warmBlockers: warm.blockers,
        liveReady: live.ready,
        liveBlockers: live.blockers,
        sealedBufferCount: ready.filter(isSealedReady).length,
        health: health
          ? {
              status: health.status,
              detail: health.detail,
              heartbeatAt: health.heartbeatAt,
              lastPublishedAt: health.lastPublishedAt,
              nextPublicationDueAt: health.nextPublicationDueAt,
              portfolioStatus: health.portfolioStatus,
              portfolioDecision: health.portfolioDecision,
              portfolioSupportsGoal: health.portfolioSupportsGoal,
              portfolioExpectedClicksMonthly: health.portfolioExpectedClicksMonthly,
              portfolioGoalMonthly: health.portfolioGoalMonthly,
              portfolioClickDeficit: health.portfolioClickDeficit,
              portfolioEvidenceMissing: health.portfolioEvidenceMissing,
              portfolioEvaluatedAt: health.portfolioEvaluatedAt,
              portfolioVersion: health.portfolioVersion,
            }
          : undefined,
      });
    }
    return rows;
  },
});

export const getHealthForSite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    const identity = await ctx.auth.getUserIdentity();
    if (!site?.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to view this site's autopilot health");
    }
    const health = await ctx.db
      .query("autopilot_health")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .first();
    const activeAlerts = await ctx.db
      .query("autopilot_alerts")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "active"),
      )
      .take(100);
    const alerts = activeAlerts.filter((alert) =>
      autopilotAlertRequiresAttention(alert, health),
    );
    return {
      health,
      alerts,
      nonBlockingAlerts: activeAlerts.filter(
        (alert) => !autopilotAlertRequiresAttention(alert, health),
      ),
    };
  },
});
