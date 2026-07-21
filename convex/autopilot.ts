import { internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { PUBLICATION_AUDIT_VERSION } from "./lib/publicationArtifact";
import {
  MIN_APPROVED_BUFFER,
  TARGET_APPROVED_BUFFER,
  autopilotHealthStatus,
  effectivePublishedAt,
  isSealedReady,
} from "./lib/autopilotBuffer";

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
  },
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const now = args.scheduledAt ?? Date.now();
    const trigger = args.trigger ?? "natural";
    const warmSites = await ctx.db
      .query("sites")
      .withIndex("by_rollout", (q) =>
        q.eq("autopilotRolloutMode", "warm").eq("autopilotEnabled", true),
      )
      .take(2);
    const liveSites = await ctx.db
      .query("sites")
      .withIndex("by_rollout", (q) =>
        q.eq("autopilotRolloutMode", "live").eq("autopilotEnabled", true),
      )
      .take(2);
    const activeSites = [...warmSites, ...liveSites];

    // A default-off, single-tenant canary prevents fleet fan-out while the
    // shared account is constrained. Configuration must be repaired before a
    // second active tenant can do any work.
    if (activeSites.length > 1) {
      for (const site of activeSites) {
        await setAlert(ctx, {
          siteId: site._id,
          kind: "rollout_conflict",
          message:
            "Multiple tenants are marked active in a single-tenant rollout; dispatch was blocked.",
        });
        await upsertHealth(ctx, site._id, {
          heartbeatAt: now,
          status: "rollout_conflict",
          detail: "Fail-closed: more than one rollout tenant is active.",
        });
      }
      return { scheduled: 0 };
    }

    for (const [index, site] of activeSites.entries()) {
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
      "quality_quarantined",
    ]);
    const waitingOutcomes = new Set([
      "work_in_progress",
      "buffer_delivery_pending",
      "approval_waiting",
      "manual_delivery_waiting",
      "retry_scheduled",
    ]);
    await upsertHealth(ctx, run.siteId, {
      lastRunId: args.runId,
      heartbeatAt: now,
      status: blockedOutcomes.has(args.outcome)
        ? args.outcome
        : waitingOutcomes.has(args.outcome)
          ? "recovering"
          : "healthy",
      detail: args.detail ?? args.outcome,
      ...(run.trigger === "natural" ? { lastNaturalCompletedAt: now } : {}),
    });
    if (
      run.trigger === "natural" &&
      !blockedOutcomes.has(args.outcome)
    ) {
      await resolveAlert(ctx, run.siteId, "natural_run_failed");
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
      const cadence = Math.max(1, site.cadencePerWeek ?? 4);
      const cadenceMs = Math.floor((7 * 24) / cadence) * 60 * 60 * 1000;
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
