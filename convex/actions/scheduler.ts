"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getLimitsFromFeatures } from "../planLimits";
import { MAX_QUALITY_REVISIONS } from "../lib/autopilotCadence";
import {
  TARGET_APPROVED_BUFFER,
  autopilotCandidateBudget,
  autopilotCandidateWindowStart,
  isSealedReady,
  selectNonCannibalizingTopic,
} from "../lib/autopilotBuffer";
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TOPIC_REPLENISHMENTS_PER_24H = 2;

type ArticleSummary = {
  _id: Id<"articles">;
  status: string;
  title: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  publicationGateStatus?: string;
  publicationAuditVersion?: number;
  auditedContentHash?: string;
  qualityRevisionCount?: number;
  metaKeywords?: string[];
};

export const scheduleCadence = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (
    ctx: ActionCtx,
    { siteId },
  ): Promise<{ scheduled: number; mode?: string; bufferCount?: number }> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");

    const rolloutMode = site.autopilotRolloutMode ?? "observe";
    if (rolloutMode === "observe") {
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: "rollout_observe",
        message:
          "Autopilot is in fail-closed observe mode; no generation or publication is authorized.",
      });
      return { scheduled: 0, mode: "rollout_observe" };
    }

    const now = Date.now();
    const candidateWindowStart = autopilotCandidateWindowStart({
      now,
      rolloutMode,
      rolloutStartedAt:
        site.autopilotRolloutStartedAt ??
        (rolloutMode === "warm" ? site.updatedAt : undefined),
    });
    const state = await ctx.runQuery(internal.articles.getAutopilotState, {
      siteId,
      since: candidateWindowStart,
    });
    if (state.migrationPending) {
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: "article_summary_migration_pending",
        message:
          "Legacy article summaries must be backfilled before cadence work is scheduled.",
      });
      return { scheduled: 0, mode: "migration_pending" };
    }
    const cadence = Math.max(1, site.cadencePerWeek ?? 4);
    const cadenceMs = Math.floor((7 * 24) / cadence) * 60 * 60 * 1000;
    const published = state.published as ArticleSummary[];
    const lastPublishedAt =
      state.latestPublished?.publishedAt ?? state.latestPublished?.updatedAt;
    const publicationDue = !lastPublishedAt || now >= lastPublishedAt + cadenceMs;
    const buffer = (state.ready as ArticleSummary[])
      .filter(isSealedReady)
      .sort(
        (a: ArticleSummary, b: ArticleSummary) => a.createdAt - b.createdAt,
      );
    const autonomousDelivery =
      rolloutMode === "live" &&
      !site.approvalRequired && (site.publishMethod ?? "github") !== "manual";

    if (rolloutMode === "warm" && buffer.length >= TARGET_APPROVED_BUFFER) {
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: "rollout_buffer_ready",
        message:
          "The canary buffer is warm. An explicit rollout transition is required before delivery.",
        details: { bufferCount: buffer.length, target: TARGET_APPROVED_BUFFER },
      });
      return {
        scheduled: 0,
        mode: "rollout_buffer_ready",
        bufferCount: buffer.length,
      };
    }

    // Delivery consumes only an already audited and sealed artifact.  The
    // deadline path never generates or relaxes quality to manufacture a post.
    if (autonomousDelivery && publicationDue && buffer.length > 0) {
      const delivery = await ctx.runMutation(
        internal.jobs.queuePublicationIfAbsent,
        {
          siteId,
          articleId: buffer[0]._id,
        },
      );
      return {
        scheduled: delivery.queued ? 1 : 0,
        mode: delivery.queued ? "buffer_delivery" : "buffer_delivery_pending",
        bufferCount: buffer.length,
      };
    }

    if (autonomousDelivery && publicationDue && buffer.length === 0) {
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: "buffer_empty",
        message:
          "Publication is due but no strict-quality sealed article is buffered.",
      });
    }

    // Replenishment and topic-plan work may be long-running, but they are
    // checked only after the independent due-delivery path above.
    const siteJobs = (await ctx.runQuery(internal.jobs.listActiveBySite, {
      siteId,
    })).filter(
      (job: Doc<"jobs">) =>
        job.siteId === siteId && (job.type === "article" || job.type === "plan"),
    );
    if (siteJobs.length > 0) {
      return {
        scheduled: 0,
        mode: "work_in_progress",
        bufferCount: buffer.length,
      };
    }

    // Approval/manual tenants get one candidate for the actual cadence window,
    // then wait for the owner/delivery step. Three-hour fleet ticks must not
    // manufacture five drafts for the same daily slot.
    if (rolloutMode !== "warm" && !autonomousDelivery) {
      const approvalWaiting = (state.review as ArticleSummary[]).some(
        (article) => article.publicationGateStatus === "passed",
      );
      if (site.approvalRequired && approvalWaiting) {
        return { scheduled: 0, mode: "approval_waiting", bufferCount: buffer.length };
      }
      if ((site.publishMethod ?? "github") === "manual" && buffer.length > 0) {
        return { scheduled: 0, mode: "manual_delivery_waiting", bufferCount: buffer.length };
      }
      if (!publicationDue) {
        return { scheduled: 0, mode: "cadence_not_due", bufferCount: buffer.length };
      }
    }

    // A full buffer deliberately does no generation work.  This is the main
    // protection against both deadline pressure and runaway provider spend.
    if ((autonomousDelivery || rolloutMode === "warm") && buffer.length >= TARGET_APPROVED_BUFFER) {
      return {
        scheduled: 0,
        mode: "buffer_full",
        bufferCount: buffer.length,
      };
    }

    const recentCandidates = state.recent as ArticleSummary[];
    const recoverable = (state.review as ArticleSummary[])
      .filter(
        (article: ArticleSummary) =>
          article.createdAt >= candidateWindowStart &&
          article.status === "review" &&
          article.publicationGateStatus === "blocked" &&
          (article.qualityRevisionCount ?? 0) < MAX_QUALITY_REVISIONS,
      )
      .sort(
        (a: ArticleSummary, b: ArticleSummary) => b.createdAt - a.createdAt,
      )[0];
    if (recoverable) {
      const recovery = await ctx.runMutation(internal.jobs.queueQualityRetryIfAbsent, {
        siteId,
        articleId: recoverable._id,
        bufferFill: autonomousDelivery || rolloutMode === "warm",
      });
      return {
        scheduled: recovery.queued ? 1 : 0,
        mode: recovery.queued ? "quality_revision" : "work_in_progress",
        bufferCount: buffer.length,
      };
    }

    // Warm mode serially builds the initial safety buffer. Live canary mode
    // permits one baseline candidate plus one bounded replacement in 24h.
    const candidateBudget = autopilotCandidateBudget(rolloutMode);
    if (recentCandidates.length >= candidateBudget) {
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: "quality_quarantined",
        message:
          "The bounded daily candidate budget was exhausted without filling the quality buffer.",
        details: {
          recentCandidates: recentCandidates.length,
          candidateBudget,
          bufferCount: buffer.length,
        },
      });
      return {
        scheduled: 0,
        mode: "quality_budget_exhausted",
        bufferCount: buffer.length,
      };
    }

    if (site.userId) {
      const limits = getLimitsFromFeatures((site as any).planFeatures ?? []);
      const articlesThisMonth = await ctx.runQuery(
        internal.articles.countThisMonthInternal,
        { userId: site.userId },
      );
      if (articlesThisMonth >= limits.maxArticles) {
        await ctx.runMutation(internal.autopilot.raiseAlert, {
          siteId,
          kind: "generation_quota_reached",
          message: `Monthly generation quota reached (${articlesThisMonth}/${limits.maxArticles}).`,
        });
        return {
          scheduled: 0,
          mode: "quota_reached",
          bufferCount: buffer.length,
        };
      }
      const userSiteCount = await ctx.runQuery(
        internal.sites.countByUserBounded,
        { userId: site.userId, maximum: limits.maxSites },
      );
      if (userSiteCount > limits.maxSites) {
        await ctx.runMutation(internal.autopilot.raiseAlert, {
          siteId,
          kind: "site_limit_reached",
          message: `Site count exceeds the active plan limit (${limits.maxSites}).`,
        });
        return {
          scheduled: 0,
          mode: "site_limit_reached",
          bufferCount: buffer.length,
        };
      }
    }

    const topics = await ctx.runQuery(internal.topics.listBySiteInternal, { siteId });
    const available = topics.filter((topic: Doc<"topic_clusters">) => {
      if (topic.status === "used" || topic.status === "queued" || topic.status === "cannibalizing") {
        return false;
      }
      if (!site.verifiedKeywordDataRequired) return true;
      return (
        Number.isFinite(topic.searchVolume) &&
        Number.isFinite(topic.keywordDifficulty) &&
        typeof topic.serpIntent === "string" &&
        topic.serpIntent.length > 0
      );
    });
    available.sort(
      (a: Doc<"topic_clusters">, b: Doc<"topic_clusters">) =>
        (b.priority ?? 1) - (a.priority ?? 1),
    );

    const coveredKeywords = [...published, ...buffer].flatMap((article) =>
      article.metaKeywords?.length
        ? article.metaKeywords
        : [article.slug.replace(/^\//, "").replace(/-/g, " ")],
    );
    coveredKeywords.push(
      ...topics
        .filter((topic: Doc<"topic_clusters">) => topic.status === "used")
        .map((topic: Doc<"topic_clusters">) => topic.primaryKeyword),
    );
    const selectedTopic: Doc<"topic_clusters"> | undefined =
      selectNonCannibalizingTopic<Doc<"topic_clusters">>(
      available,
      coveredKeywords,
      );

    if (!selectedTopic) {
      // Do not repeatedly reconsider the same cannibalizing set.  A plan job
      // produces new verified candidates, breaking the old permanent deadlock.
      const replenishment = await ctx.runMutation(
        internal.jobs.queuePlanIfAbsent,
        {
          siteId,
          reason: "topic_overlap_replenishment",
          cannibalizingTopicIds: available.map(
            (topic: Doc<"topic_clusters">) => topic._id,
          ),
          since: now - DAY_MS,
          maximumRecent: MAX_TOPIC_REPLENISHMENTS_PER_24H,
        },
      );
      if (!replenishment.queued && replenishment.reason === "recent_limit") {
        await ctx.runMutation(internal.autopilot.raiseAlert, {
          siteId,
          kind: "topic_replenishment_exhausted",
          message:
            "Bounded topic-plan recovery was exhausted; human keyword review is required before more paid plan generation.",
          details: {
            replenishments: replenishment.recent,
            maximum: MAX_TOPIC_REPLENISHMENTS_PER_24H,
          },
        });
        return {
          scheduled: 0,
          mode: "topic_replenishment_exhausted",
          bufferCount: buffer.length,
        };
      }
      if (!replenishment.queued) {
        return { scheduled: 0, mode: "work_in_progress", bufferCount: buffer.length };
      }
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: "topic_replenishment",
        message:
          "All available topics overlapped existing coverage; a fresh verified plan was queued.",
      });
      return {
        scheduled: 1,
        mode: "topic_replenishment",
        bufferCount: buffer.length,
      };
    }

    const queued = await ctx.runMutation(internal.jobs.queueTopicArticleIfAbsent, {
      siteId,
      topicId: selectedTopic._id,
      bufferFill: autonomousDelivery || rolloutMode === "warm",
    });

    return {
      scheduled: queued.queued ? 1 : 0,
      mode: queued.queued
        ? autonomousDelivery || rolloutMode === "warm" ? "buffer_fill" : "cadence_generation"
        : "work_in_progress",
      bufferCount: buffer.length,
    };
  },
});
