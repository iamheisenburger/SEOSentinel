import { internal } from "./_generated/api";
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { PUBLICATION_AUDIT_VERSION } from "./lib/publicationArtifact";
import {
  MIN_APPROVED_BUFFER,
  TARGET_APPROVED_BUFFER,
  autopilotHealthStatus,
  cadenceIntervalMs,
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

const SITE_STAGGER_MS = 5_000;
const NATURAL_RUN_STALE_MS = 4 * 60 * 60 * 1000;
const PUBLICATION_INTEGRITY_MIGRATION_KEY = "publication-integrity-v4";

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
      .paginate({ cursor: args.cursor ?? null, numItems: 25 });
    const activeSites: typeof page.page = [];
    for (const site of page.page) {
      const currentMode = site.autopilotRolloutMode ?? "observe";
      if (["warm", "live"].includes(currentMode)) {
        activeSites.push(site);
        continue;
      }
      const hasCrawledPage = !!(await ctx.db
        .query("pages")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .first());
      const readiness = warmAutopilotReadiness(site, hasCrawledPage);
      if (!readiness.ready) {
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
      const promotedAt = Date.now();
      await ctx.db.patch(site._id, {
        autopilotRolloutMode: "warm",
        autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
        autopilotRolloutStartedAt: promotedAt,
        updatedAt: promotedAt,
      });
      await resolveAlert(ctx, site._id, "autopilot_readiness_blocked");
      activeSites.push({
        ...site,
        autopilotRolloutMode: "warm",
        autopilotRolloutEpoch: (site.autopilotRolloutEpoch ?? 0) + 1,
        autopilotRolloutStartedAt: promotedAt,
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
      !site?.autopilotEnabled ||
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

export const promoteWarmSiteIfReady = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    if (site.autopilotRolloutMode !== "warm") {
      return { promoted: false, blockers: ["site_not_warm"] };
    }
    const hasCrawledPage = !!(await ctx.db
      .query("pages")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .first());
    const limits = getLimitsFromFeatures(site.planFeatures ?? []);
    const readiness = liveAutopilotReadiness(
      site,
      hasCrawledPage,
      limits.maxArticles,
    );
    const ready = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "ready"),
      )
      .take(10);
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
      !site?.autopilotEnabled ||
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

export const markRunStarted = internalMutation({
  args: { runId: v.id("autopilot_runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    const now = Date.now();
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
  },
});

export const markRunFinished = internalMutation({
  args: {
    runId: v.id("autopilot_runs"),
    outcome: v.string(),
    detail: v.optional(v.string()),
    jobId: v.optional(v.id("jobs")),
    articleId: v.optional(v.id("articles")),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    const now = Date.now();
    await ctx.db.patch(args.runId, {
      status: "completed",
      completedAt: now,
      heartbeatAt: now,
      outcome: args.outcome,
      detail: args.detail,
      jobId: args.jobId,
      articleId: args.articleId,
    });
    const blockedOutcomes = new Set([
      "migration_pending",
      "quality_budget_exhausted",
      "quota_reached",
      "site_limit_reached",
      "topic_replenishment_exhausted",
      "job_failed",
      "publication_failed",
      "public_url_failed",
      "quality_quarantined",
    ]);
    const waitingOutcomes = new Set([
      "work_in_progress",
      "buffer_delivery_pending",
      "approval_waiting",
      "manual_delivery_waiting",
      "retry_scheduled",
      "public_url_pending",
    ]);
    let completionStatus = blockedOutcomes.has(args.outcome)
      ? args.outcome
      : waitingOutcomes.has(args.outcome)
        ? "recovering"
        : "healthy";
    let completionDetail = args.detail ?? args.outcome;
    const currentReady = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", run.siteId).eq("status", "ready"),
      )
      .take(10);
    const approvedBufferCount = currentReady.filter(isSealedReady).length;
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
      if (article?.siteId === run.siteId && site) {
        lastPublishedAt = effectivePublishedAt({
          createdAt: article.createdAt,
          publishedAt: article.publishedAt,
          publicationAuditVersion: article.publicationAuditVersion,
          auditedContentHash: article.auditedContentHash,
        });
        const cadence = site.cadencePerWeek ?? 4;
        const cadenceMs = cadenceIntervalMs(cadence);
        nextPublicationDueAt = lastPublishedAt + cadenceMs;
        if (article.publicUrlStatus === "pending") {
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
  },
});

export const markRunFailed = internalMutation({
  args: { runId: v.id("autopilot_runs"), error: v.string() },
  handler: async (ctx, { runId, error }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
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
      const health = await ctx.db
        .query("autopilot_health")
        .withIndex("by_site", (q) => q.eq("siteId", site._id))
        .first();
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
        const legacyArticle = await ctx.db
          .query("articles")
          .withIndex("by_site", (q) => q.eq("siteId", site._id))
          .first();
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
        await Promise.all([
          ctx.db
            .query("article_summaries")
            .withIndex("by_site_status_audit_published", (q) =>
              q
                .eq("siteId", site._id)
                .eq("status", "published")
                .eq("publicationAuditVersion", PUBLICATION_AUDIT_VERSION),
            )
            .order("desc")
            .first(),
          ctx.db
            .query("article_summaries")
            .withIndex("by_site_status_created", (q) =>
              q.eq("siteId", site._id).eq("status", "published"),
            )
            .order("desc")
            .first(),
        ]);
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
      const readySummaries = await ctx.db
        .query("article_summaries")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", site._id).eq("status", "ready"),
        )
        .take(10);

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
      const status = autopilotHealthStatus({
        schedulerStale,
        publicationMissed,
        bufferCount: effectiveBufferCount,
        lastOutcome: lastRun?.outcome,
      });

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
    const [site, health, latestModernPublished, latestPublishedByCreation, ready] =
      await Promise.all([
        ctx.db.get(siteId),
        ctx.db
          .query("autopilot_health")
          .withIndex("by_site", (q) => q.eq("siteId", siteId))
          .first(),
        ctx.db
          .query("article_summaries")
          .withIndex("by_site_status_audit_published", (q) =>
            q
              .eq("siteId", siteId)
              .eq("status", "published")
              .eq("publicationAuditVersion", PUBLICATION_AUDIT_VERSION),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("article_summaries")
          .withIndex("by_site_status_created", (q) =>
            q.eq("siteId", siteId).eq("status", "published"),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("article_summaries")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", "ready"),
          )
          .take(10),
      ]);
    if (!site) throw new Error("Site not found");
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
    const status =
      lastRun?.status === "running"
        ? "recovering"
        : autopilotHealthStatus({
            schedulerStale,
            publicationMissed: now > nextPublicationDueAt,
            bufferCount: approvedBufferCount,
            lastOutcome: lastRun?.outcome,
          });
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
    const [health, runs, ready, review, pending, running] = await Promise.all([
      ctx.db
        .query("autopilot_health")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .first(),
      ctx.db
        .query("autopilot_runs")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .order("desc")
        .take(8),
      ctx.db
        .query("article_summaries")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "ready"),
        )
        .take(10),
      ctx.db
        .query("article_summaries")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "review"),
        )
        .order("desc")
        .take(8),
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
    ]);
    const articleView = (article: Doc<"article_summaries">) => ({
      articleId: article.articleId,
      title: article.title,
      status: article.status,
      editorialQualityScore: article.editorialQualityScore,
      factCheckScore: article.factCheckScore,
      mediaQualityStatus: article.mediaQualityStatus,
      publicationGateStatus: article.publicationGateStatus,
      publicationAuditVersion: article.publicationAuditVersion,
      sealed: isSealedReady(article),
      qualityRevisionCount: article.qualityRevisionCount,
      createdAt: article.articleCreatedAt,
      updatedAt: article.articleUpdatedAt,
    });
    const jobView = (job: Doc<"jobs">) => ({
      jobId: job._id,
      type: job.type,
      status: job.status,
      retries: job.retries,
      workerAttempts: job.workerAttempts,
      publicationAttempts: job.publicationAttempts,
      stepProgress: job.stepProgress,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
    return {
      site: {
        siteId: site._id,
        domain: site.domain,
        autopilotEnabled: site.autopilotEnabled,
        rolloutMode: site.autopilotRolloutMode ?? "observe",
        rolloutEpoch: site.autopilotRolloutEpoch ?? 0,
        rolloutStartedAt: site.autopilotRolloutStartedAt,
      },
      health,
      runs: runs.map((run) => ({
        runId: run._id,
        trigger: run.trigger,
        status: run.status,
        outcome: run.outcome,
        detail: run.detail,
        jobId: run.jobId,
        articleId: run.articleId,
        scheduledAt: run.scheduledAt,
        startedAt: run.startedAt,
        heartbeatAt: run.heartbeatAt,
        completedAt: run.completedAt,
      })),
      ready: ready.map(articleView),
      review: review.map(articleView),
      activeJobs: [...pending, ...running].map(jobView),
    };
  },
});

export const getFleetReadiness = internalQuery({
  args: {},
  handler: async (ctx) => {
    const sites = await ctx.db
      .query("sites")
      .withIndex("by_autopilot", (q) => q.eq("autopilotEnabled", true))
      .take(50);
    const rows = [];
    for (const site of sites) {
      const [page, health, ready] = await Promise.all([
        ctx.db
          .query("pages")
          .withIndex("by_site", (q) => q.eq("siteId", site._id))
          .first(),
        ctx.db
          .query("autopilot_health")
          .withIndex("by_site", (q) => q.eq("siteId", site._id))
          .first(),
        ctx.db
          .query("article_summaries")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", site._id).eq("status", "ready"),
          )
          .take(10),
      ]);
      const hasCrawledPage = Boolean(page);
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
    const alerts = await ctx.db
      .query("autopilot_alerts")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "active"),
      )
      .collect();
    return { health, alerts };
  },
});
