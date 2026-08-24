"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getLimitsFromFeatures } from "../planLimits";
import { describeAutopilotBlockers } from "../lib/autopilotReadiness";
import {
  evaluateSerpAttainability,
  evaluateSerpBusinessIntent,
} from "../lib/serpAttainability";
import {
  MAX_CLICK_GOAL_REPLENISHMENTS_PER_DAY,
  type ExpectedClickPortfolioEvaluation,
} from "../lib/expectedClickPortfolio";
import {
  hasRecoverableQualityWork,
  MAX_QUALITY_REVISIONS,
  needsDeterministicMechanicalRepair,
} from "../lib/autopilotCadence";
import {
  TARGET_APPROVED_BUFFER,
  MIN_APPROVED_BUFFER,
  MIN_VERIFIED_TOPIC_HORIZON,
  autopilotCandidateBudget,
  autopilotCandidateWindowStart,
  cadenceIntervalMs,
  contentWorkBlocksQualityRecovery,
  effectivePublishedAt,
  evaluateTopicBusinessFit,
  exactCadenceWakeupAt,
  coveredIntentTopics,
  filterNonCannibalizingIntentTopics,
  hasTerminalTopicFitFailure,
  isUnderfilledPlanContinuationPayload,
  isSealedReady,
  tenantTopicBusinessSignals,
  topicReplenishmentBudget,
} from "../lib/autopilotBuffer";
const DAY_MS = 24 * 60 * 60 * 1000;

type ArticleSummary = {
  _id: Id<"articles">;
  topicId?: Id<"topic_clusters">;
  status: string;
  title: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  publishedAt?: number;
  publicationGateStatus?: string;
  publicationGateIssues?: string[];
  publicationAuditVersion?: number;
  auditedContentHash?: string;
  publicUrl?: string;
  publicUrlStatus?: "pending" | "verified" | "failed";
  publicUrlCheckError?: string;
  qualityRevisionCount?: number;
  metaKeywords?: string[];
};

type TopicBusinessFitAudit = {
  topicId: Id<"topic_clusters">;
  keyword: string;
  eligible: boolean;
  score: number;
  reasons: string[];
  version: number;
};

type TopicBusinessFitAuditReport = {
  totalTopics: number;
  audited: number;
  eligible: number;
  ineligible: number;
  disqualified: number;
  requalified: number;
  updated: number;
  topics: Array<Omit<TopicBusinessFitAudit, "version">>;
};

function hasTerminalTargetAlignmentFailure(article: ArticleSummary): boolean {
  return hasTerminalTopicFitFailure(article.publicationGateIssues);
}

// Operator-safe inventory audit. It changes only topic eligibility metadata
// and status for one explicit tenant; it cannot queue generation or delivery.
export const auditTopicBusinessFit = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (
    ctx: ActionCtx,
    { siteId },
  ): Promise<TopicBusinessFitAuditReport> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
    const topics: Doc<"topic_clusters">[] = await ctx.runQuery(
      internal.topics.listBySiteInternal,
      { siteId },
    );
    const {
      coreBusinessSignals,
      productAnchorSignals,
      businessModelSignals,
    } = tenantTopicBusinessSignals(site);
    const audits: TopicBusinessFitAudit[] = topics
      .filter((topic: Doc<"topic_clusters">) =>
        !["used", "queued", "cannibalizing"].includes(topic.status ?? "")
      )
      .map((topic: Doc<"topic_clusters">) => {
        const fit = evaluateTopicBusinessFit({
          keyword: topic.primaryKeyword,
          label: topic.label,
          coreBusinessSignals,
          productAnchorSignals,
          businessModelSignals,
        });
        const serpIntent = (topic.serpTopUrls?.length ?? 0) >= 5
          ? evaluateSerpBusinessIntent({
              results: topic.serpTopUrls!.map((url: string) => ({ url })),
              businessModelSignals,
            })
          : { aligned: true, reasons: [] as string[] };
        return {
          topicId: topic._id,
          keyword: topic.primaryKeyword,
          ...fit,
          eligible: fit.eligible && serpIntent.aligned,
          reasons: [...fit.reasons, ...serpIntent.reasons],
        };
      });
    const result: {
      disqualified: number;
      requalified: number;
      updated: number;
    } = await ctx.runMutation(
      internal.topics.recordBusinessFitAuditsInternal,
      {
        siteId,
        audits: audits.map(
          ({ topicId, eligible, score, version, reasons }) => ({
            topicId,
            eligible,
            score,
            version,
            reasons,
          }),
        ),
      },
    );
    return {
      totalTopics: topics.length,
      audited: audits.length,
      eligible: audits.filter((audit) => audit.eligible).length,
      ineligible: audits.filter((audit) => !audit.eligible).length,
      ...result,
      topics: audits.map((audit) => ({
        topicId: audit.topicId,
        keyword: audit.keyword,
        eligible: audit.eligible,
        score: audit.score,
        reasons: audit.reasons,
      })),
    };
  },
});

export const scheduleCadence = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (
    ctx: ActionCtx,
    { siteId },
  ): Promise<{
    scheduled: number;
    mode?: string;
    bufferCount?: number;
    blockers?: string[];
  }> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
    if (!site.autopilotEnabled) {
      return { scheduled: 0, mode: "autopilot_disabled" };
    }

    if ((site.cadencePerWeek ?? 0) <= 0) {
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: "cadence_paused",
        message:
          "Publishing is paused because this site has no current account-wide article allocation.",
      });
      return { scheduled: 0, mode: "cadence_paused" };
    }

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

    if (rolloutMode === "live") {
      const readiness = await ctx.runMutation(
        internal.sites.enforceLiveReadiness,
        { siteId },
      );
      if (!readiness.ready) {
        await ctx.runMutation(internal.autopilot.raiseAlert, {
          siteId,
          kind: "autopilot_readiness_regressed",
          message:
            `Live delivery was stopped because readiness regressed: ${describeAutopilotBlockers(readiness.blockers)}.`,
          details: {
            blockers: readiness.blockers,
            demotedTo: readiness.mode,
          },
        });
        return {
          scheduled: 0,
          mode: "readiness_regressed",
          blockers: readiness.blockers,
        };
      }
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
    const cadence = site.cadencePerWeek ?? 4;
    const cadenceMs = cadenceIntervalMs(cadence);
    const published = state.published as ArticleSummary[];
    const lastPublishedAt = state.latestPublished
      ? effectivePublishedAt(state.latestPublished)
      : undefined;
    const publicationDue = !lastPublishedAt || now >= lastPublishedAt + cadenceMs;
    const buffer = (state.ready as ArticleSummary[])
      .filter(isSealedReady)
      .sort(
        (a: ArticleSummary, b: ArticleSummary) => a.createdAt - b.createdAt,
      );
    const autonomousDelivery =
      rolloutMode === "live" &&
      !site.approvalRequired && (site.publishMethod ?? "github") !== "manual";

    const latestPublicStatus = state.latestPublished?.publicUrlStatus as
      | "pending"
      | "verified"
      | "failed"
      | undefined;
    if (
      autonomousDelivery &&
      latestPublicStatus !== undefined &&
      latestPublicStatus !== "verified"
    ) {
      const failed = latestPublicStatus === "failed";
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: "public_publication_unverified",
        message: failed
          ? "Autonomous content work is paused because the latest delivered article did not become live at its exact public URL."
          : "Autonomous content work is waiting for the latest delivered article to become live at its exact public URL.",
        details: {
          articleId: state.latestPublished?._id,
          publicUrl: state.latestPublished?.publicUrl,
          status: latestPublicStatus,
          error: state.latestPublished?.publicUrlCheckError,
        },
      });
      return {
        scheduled: 0,
        mode: failed ? "public_url_failed" : "public_url_pending",
        bufferCount: buffer.length,
      };
    }
    await ctx.runMutation(internal.autopilot.resolveAlertKind, {
      siteId,
      kind: "public_publication_unverified",
    });

    const exactWakeupAt = exactCadenceWakeupAt({
      autonomousDelivery,
      sealedBufferCount: buffer.length,
      lastPublishedAt,
      cadenceMs,
      now,
    });
    if (exactWakeupAt !== undefined) {
      await ctx.runMutation(internal.autopilot.scheduleCadenceDeadline, {
        siteId,
        dueAt: exactWakeupAt,
      });
    }

    // Two sealed artifacts are the launch safety minimum. The scheduler still
    // replenishes toward three, but a strict-gate rejection must not make a
    // three-article free plan permanently incapable of going live.
    if (rolloutMode === "warm" && buffer.length >= MIN_APPROVED_BUFFER) {
      const promotion = await ctx.runMutation(
        internal.autopilot.promoteWarmSiteIfReady,
        { siteId },
      );
      if (promotion.promoted) {
        return {
          scheduled: 1,
          mode: "automatic_live_promotion",
          bufferCount: buffer.length,
        };
      }
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: "rollout_buffer_ready",
        message:
          `The strict-quality buffer is warm, but live publication is blocked: ${describeAutopilotBlockers(promotion.blockers)}.`,
        details: {
          bufferCount: buffer.length,
          target: TARGET_APPROVED_BUFFER,
          blockers: promotion.blockers,
        },
      });
      return {
        scheduled: 0,
        mode: "rollout_buffer_ready",
        bufferCount: buffer.length,
        blockers: promotion.blockers,
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

    // Growth inventory must never delay an already-due sealed publication.
    // Audit it only after the independent delivery path above has had priority.
    const inventoryAudit: {
      expectedClickPortfolio: ExpectedClickPortfolioEvaluation;
    } = await ctx.runQuery(internal.topics.getInventoryAuditInternal, {
      siteId,
      recentLimit: 10,
    });
    const portfolio = inventoryAudit.expectedClickPortfolio;
    const strictExpectedClickScheduling =
      site.expectedClickSchedulingEnabled === true;
    await ctx.runMutation(internal.autopilot.recordTopicPortfolioAudit, {
      siteId,
      status: portfolio.status,
      decision: portfolio.decision,
      supportsGoal: portfolio.supportsGoal,
      expectedClicksMonthly: portfolio.expectedClicksMonthly,
      ...(portfolio.monthlyOrganicClickGoal === null
        ? {}
        : { monthlyOrganicClickGoal: portfolio.monthlyOrganicClickGoal }),
      ...(portfolio.clickDeficit === null
        ? {}
        : { clickDeficit: portfolio.clickDeficit }),
      evidenceMissing: portfolio.insufficientEvidenceTopicIds.length,
      evaluatedAt: now,
      version: portfolio.version,
    });
    const portfolioAlertKind = portfolio.status === "below_goal"
      ? "topic_portfolio_below_goal"
      : "topic_portfolio_evidence_missing";
    if (strictExpectedClickScheduling && portfolio.supportsGoal) {
      await Promise.all([
        ctx.runMutation(internal.autopilot.resolveAlertKind, {
          siteId,
          kind: "topic_portfolio_below_goal",
        }),
        ctx.runMutation(internal.autopilot.resolveAlertKind, {
          siteId,
          kind: "topic_portfolio_evidence_missing",
        }),
      ]);
    } else if (strictExpectedClickScheduling) {
      await ctx.runMutation(internal.autopilot.resolveAlertKind, {
        siteId,
        kind: portfolioAlertKind === "topic_portfolio_below_goal"
          ? "topic_portfolio_evidence_missing"
          : "topic_portfolio_below_goal",
      });
      await ctx.runMutation(internal.autopilot.raiseAlert, {
        siteId,
        kind: portfolioAlertKind,
        message: portfolio.status === "below_goal"
          ? `Measured topic inventory is ${portfolio.clickDeficit ?? 0} expected clicks/month below the configured goal.`
          : "Topic inventory cannot prove its click goal because fresh demand, locale-bound SERP, or authority evidence is missing.",
        details: {
          status: portfolio.status,
          decision: portfolio.decision,
          expectedClicksMonthly: portfolio.expectedClicksMonthly,
          monthlyOrganicClickGoal: portfolio.monthlyOrganicClickGoal,
          clickDeficit: portfolio.clickDeficit,
          evidenceMissing: portfolio.insufficientEvidenceTopicIds.length,
          version: portfolio.version,
        },
      });
    } else {
      // Compatibility tenants are measured but never forced into the new
      // gate or its paid replenishment loop until explicitly canaried.
      await Promise.all([
        ctx.runMutation(internal.autopilot.resolveAlertKind, {
          siteId,
          kind: "topic_portfolio_below_goal",
        }),
        ctx.runMutation(internal.autopilot.resolveAlertKind, {
          siteId,
          kind: "topic_portfolio_evidence_missing",
        }),
      ]);
    }
    const portfolioReplenishmentReason = portfolio.status === "below_goal"
      ? "topic_portfolio_goal_replenishment"
      : "topic_portfolio_evidence_replenishment";
    const queuePortfolioPlan = async () => ctx.runMutation(
      internal.jobs.queuePlanIfAbsent,
      {
        siteId,
        reason: portfolioReplenishmentReason,
        since: now - DAY_MS,
        maximumRecent: Math.min(
          topicReplenishmentBudget(site.cadencePerWeek ?? 1),
          MAX_CLICK_GOAL_REPLENISHMENTS_PER_DAY,
        ),
      },
    );

    // Replenishment and topic-plan work may be long-running, but they are
    // checked only after the independent due-delivery path above.
    const siteJobs = (await ctx.runQuery(internal.jobs.listActiveBySite, {
      siteId,
    })).filter(
      (job: Doc<"jobs">) =>
        job.siteId === siteId && (job.type === "article" || job.type === "plan"),
    );
    const pendingUnderfilledPlan = siteJobs.find(
      (job: Doc<"jobs">) =>
        job.type === "plan" &&
        job.status === "pending" &&
        (job.workerAttempts ?? 0) === 1 &&
        isUnderfilledPlanContinuationPayload(job.payload),
    );
    // Execution two is already budgeted and cannot disappear, but it must sit
    // behind every usable topic proved by execution one. Excluding only this
    // exact pending marker lets overdue delivery and strict buffer fill queue
    // article work first; all other plan/article jobs keep the normal lock.
    const contentBlockingJobs = pendingUnderfilledPlan
      ? siteJobs.filter((job: Doc<"jobs">) =>
          job._id !== pendingUnderfilledPlan._id
        )
      : siteJobs;
    const qualityRecoveryAvailable = hasRecoverableQualityWork(
      state.review as ArticleSummary[],
      candidateWindowStart,
    );
    if (
      contentWorkBlocksQualityRecovery(
        contentBlockingJobs,
        qualityRecoveryAvailable,
      )
    ) {
      const pendingPlanReady = siteJobs.every(
        (job: Doc<"jobs">) => job.type === "plan" && job.status === "pending",
      );
      if (pendingPlanReady) {
        return {
          scheduled: 1,
          mode: "pending_plan",
          bufferCount: buffer.length,
        };
      }
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
      if (pendingUnderfilledPlan) {
        return {
          scheduled: 1,
          mode: "pending_plan",
          bufferCount: buffer.length,
        };
      }
      if (strictExpectedClickScheduling && !portfolio.supportsGoal) {
        const replenishment = await queuePortfolioPlan();
        if (replenishment.queued) {
          return {
            scheduled: 1,
            mode: portfolioReplenishmentReason,
            bufferCount: buffer.length,
          };
        }
      }
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
          !hasTerminalTargetAlignmentFailure(article) &&
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

    // A candidate that cleared prose, evidence, and media can still be blocked
    // by a mechanically incomplete search snippet or list introduction. Give
    // that exact draft one guarded deterministic repair without spending
    // another prose revision. The job mutation remembers the attempt so the
    // scheduler cannot create an infinite loop.
    const mechanicallyRecoverable = (state.review as ArticleSummary[])
      .filter(needsDeterministicMechanicalRepair)
      .sort(
        (a: ArticleSummary, b: ArticleSummary) => b.createdAt - a.createdAt,
      )[0];
    if (mechanicallyRecoverable) {
      const recovery = await ctx.runMutation(
        internal.jobs.queueQualityRetryIfAbsent,
        {
          siteId,
          articleId: mechanicallyRecoverable._id,
          bufferFill: autonomousDelivery || rolloutMode === "warm",
          deterministicRepair: true,
        },
      );
      if (recovery.queued) {
        return {
          scheduled: 1,
          mode: "deterministic_repair",
          bufferCount: buffer.length,
        };
      }
    }

    // Warm mode serially builds the initial safety buffer. Live canary mode
    // permits one baseline candidate plus one bounded replacement in 24h.
    const candidateBudget = autopilotCandidateBudget(
      rolloutMode,
      site.cadencePerWeek,
    );
    if (recentCandidates.length >= candidateBudget) {
      if (pendingUnderfilledPlan) {
        return {
          scheduled: 1,
          mode: "pending_plan",
          bufferCount: buffer.length,
        };
      }
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
      const limits = getLimitsFromFeatures(site.planFeatures ?? []);
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
      const userSiteCount = limits.maxSites >= 9999
        ? 0
        : await ctx.runQuery(
          internal.sites.countByUserBounded,
          { userId: site.userId, maximum: limits.maxSites },
        );
      if (limits.maxSites < 9999 && userSiteCount > limits.maxSites) {
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
    const {
      coreBusinessSignals,
      productAnchorSignals,
      businessModelSignals,
    } = tenantTopicBusinessSignals(site);
    const revalidatable = topics.filter((topic: Doc<"topic_clusters">) =>
      !["used", "queued", "cannibalizing", "plan_checkpoint"].includes(
        topic.status ?? "",
      ) && !topic.planCheckpointTerminalFailureCode
    );
    const businessFitAudits: TopicBusinessFitAudit[] = revalidatable.map(
      (topic: Doc<"topic_clusters">) => {
        const fit = evaluateTopicBusinessFit({
          keyword: topic.primaryKeyword,
          label: topic.label,
          coreBusinessSignals,
          productAnchorSignals,
          businessModelSignals,
        });
        const serpIntent = (topic.serpTopUrls?.length ?? 0) >= 5
          ? evaluateSerpBusinessIntent({
              results: topic.serpTopUrls!.map((url: string) => ({ url })),
              businessModelSignals,
            })
          : { aligned: true, reasons: [] as string[] };
        return {
          topicId: topic._id,
          keyword: topic.primaryKeyword,
          ...fit,
          eligible: fit.eligible && serpIntent.aligned,
          reasons: [...fit.reasons, ...serpIntent.reasons],
        };
      },
    );
    const businessFitResult = await ctx.runMutation(
      internal.topics.recordBusinessFitAuditsInternal,
      {
        siteId,
        // `keyword` is operator evidence used only by the local scheduler
        // report/map. Keep the mutation contract narrow so a display field
        // can never become persisted business-fit authority.
        audits: businessFitAudits.map(
          ({ topicId, eligible, score, version, reasons }) => ({
            topicId,
            eligible,
            score,
            version,
            reasons,
          }),
        ),
      },
    );
    if (businessFitResult.disqualified > 0 || businessFitResult.requalified > 0) {
      console.log(
        `Topic business-fit audit: ${businessFitResult.disqualified} disqualified, ${businessFitResult.requalified} requalified.`,
      );
    }
    const fitByTopic = new Map<string, TopicBusinessFitAudit>(
      businessFitAudits.map((audit: TopicBusinessFitAudit) => [String(audit.topicId), audit]),
    );
    const expectedClickByTopic = new Map(
      portfolio.topics.map((audit) => [audit.topicId, audit]),
    );
    const fitEligible = revalidatable.filter(
      (topic: Doc<"topic_clusters">) =>
        fitByTopic.get(String(topic._id))?.eligible === true,
    );
    const available = fitEligible.filter((topic: Doc<"topic_clusters">) => {
      if (!strictExpectedClickScheduling) {
        if (!site.verifiedKeywordDataRequired) return true;
        return (
          Number.isFinite(topic.searchVolume) &&
          Number.isFinite(topic.keywordDifficulty) &&
          typeof topic.serpIntent === "string" &&
          topic.serpIntent.length > 0
        );
      }
      return (
        Number.isFinite(topic.searchVolume) &&
        Number.isFinite(topic.keywordDifficulty) &&
        topic.keywordDifficultyMeasured === true &&
        typeof topic.serpIntent === "string" &&
        topic.serpIntent.length > 0 &&
        expectedClickByTopic.get(String(topic._id))?.status === "eligible"
      );
    });
    // Reject keywords whose live SERP is owned by entrenched publishers. A
    // difficulty score that was never measured has repeatedly authorised
    // page-one competition against mega-vendors, which no amount of article
    // quality displaces from a standing start. Observed SERP evidence is the
    // stronger signal, so it gates selection.
    const selectionHost = String(site.domain ?? "")
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0];
    const attainableTopics = strictExpectedClickScheduling
      ? available.filter((topic: Doc<"topic_clusters">) =>
          evaluateSerpAttainability({
            serpTopUrls: topic.serpTopUrls,
            siteHost: selectionHost,
          }).attainable
        )
      : available;
    const entrenchedSkipped = strictExpectedClickScheduling
      ? available.length - attainableTopics.length
      : 0;
    if (entrenchedSkipped > 0) {
      console.log(
        `SERP attainability: ${entrenchedSkipped} topic(s) deprioritised because entrenched publishers own their page one.`,
      );
    }
    // A cadence deadline cannot turn an unwinnable keyword into a useful
    // article. When no observed SERP is attainable, replenish the measured
    // inventory instead of publishing output that is predictably invisible.
    const selectable = attainableTopics;
    // Rank only from the live portfolio audit. Persisted estimates are display
    // evidence; the audit recomputes freshness, locale, SERP binding and
    // authority compatibility on every scheduler pass.
    selectable.sort((a: Doc<"topic_clusters">, b: Doc<"topic_clusters">) => {
      if (strictExpectedClickScheduling) {
        const delta =
          (expectedClickByTopic.get(String(b._id))?.expectedClicksMonthly ?? 0) -
          (expectedClickByTopic.get(String(a._id))?.expectedClicksMonthly ?? 0);
        if (delta !== 0) return delta;
      }
      return (b.priority ?? 1) - (a.priority ?? 1);
    });
    available.length = 0;
    available.push(...selectable);

    const coveredTopics = coveredIntentTopics(
      topics.map((topic: Doc<"topic_clusters">) => ({
        _id: String(topic._id),
        status: topic.status ?? "planned",
        primaryKeyword: topic.primaryKeyword,
        serpTopUrls: topic.serpTopUrls,
      })),
      [...published, ...buffer].map((article) => ({
        topicId: article.topicId ? String(article.topicId) : undefined,
        slug: article.slug,
        status: article.status,
        publicationGateStatus: article.publicationGateStatus,
        publicationAuditVersion: article.publicationAuditVersion,
        auditedContentHash: article.auditedContentHash,
      })),
    );
    const schedulableTopics = filterNonCannibalizingIntentTopics<
      Doc<"topic_clusters">
    >(
      available,
      coveredTopics,
    );
    const selectedTopic: Doc<"topic_clusters"> | undefined =
      schedulableTopics[0];

    if (!selectedTopic) {
      if (pendingUnderfilledPlan) {
        return {
          scheduled: 1,
          mode: "pending_plan",
          bufferCount: buffer.length,
        };
      }
      const replenishmentReason = strictExpectedClickScheduling && !portfolio.supportsGoal
        ? portfolioReplenishmentReason
        : fitEligible.length === 0
        ? "topic_business_fit_replenishment"
        : available.length === 0
          ? "topic_evidence_replenishment"
          : "topic_overlap_replenishment";
      const maximumTopicReplenishments = replenishmentReason.startsWith("topic_portfolio_")
        ? Math.min(
            topicReplenishmentBudget(site.cadencePerWeek ?? 1),
            MAX_CLICK_GOAL_REPLENISHMENTS_PER_DAY,
          )
        : topicReplenishmentBudget(site.cadencePerWeek ?? 1);
      // Do not repeatedly reconsider the same rejected set. A new plan must
      // pass current product-fit, keyword-evidence, and intent-overlap gates.
      const replenishment = await ctx.runMutation(
        internal.jobs.queuePlanIfAbsent,
        {
          siteId,
          reason: replenishmentReason,
          ...(replenishmentReason === "topic_overlap_replenishment"
            ? {
                cannibalizingTopicIds: available.map(
                  (topic: Doc<"topic_clusters">) => topic._id,
                ),
              }
            : {}),
          since: now - DAY_MS,
          maximumRecent: maximumTopicReplenishments,
        },
      );
      if (!replenishment.queued && replenishment.reason === "recent_limit") {
        await ctx.runMutation(internal.autopilot.raiseAlert, {
          siteId,
          kind: "topic_replenishment_exhausted",
          message:
            "Bounded topic-plan recovery is cooling down; the scheduler will retry automatically when the 24-hour request window resets.",
          details: {
            replenishments: replenishment.recent,
            maximum: maximumTopicReplenishments,
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
        message: replenishmentReason === "topic_portfolio_goal_replenishment"
          ? "Measured topic demand is below the configured organic-click goal; a bounded evidence-backed plan was queued."
          : replenishmentReason === "topic_portfolio_evidence_replenishment"
            ? "Topic click potential cannot be proven from fresh evidence; a bounded measurement plan was queued."
          : replenishmentReason === "topic_business_fit_replenishment"
          ? "No available topic still matched the tenant's product and audience; a fresh verified plan was queued."
          : replenishmentReason === "topic_evidence_replenishment"
            ? "No product-aligned topic retained complete keyword evidence; a fresh verified plan was queued."
            : "All available topics overlapped existing coverage; a fresh verified plan was queued.",
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

    // Replenish before the final topic is consumed. The queued article has a
    // higher worker priority, so horizon planning cannot delay the immediate
    // quality-buffer fill, and the one-per-day bound prevents paid loops.
    const remainingTopicHorizon = Math.max(0, schedulableTopics.length - 1);
    if (
      queued.queued &&
      strictExpectedClickScheduling &&
      !portfolio.supportsGoal
    ) {
      const replenishment = await queuePortfolioPlan();
      if (replenishment.queued) {
        console.log(
          `Queued ${portfolioReplenishmentReason} behind the selected article; ` +
          `portfolio=${portfolio.expectedClicksMonthly}/${portfolio.monthlyOrganicClickGoal ?? "unconfigured"}.`,
        );
      }
    } else if (queued.queued && remainingTopicHorizon < MIN_VERIFIED_TOPIC_HORIZON) {
      const maximumTopicReplenishments = topicReplenishmentBudget(
        site.cadencePerWeek ?? 1,
      );
      const horizon = await ctx.runMutation(internal.jobs.queuePlanIfAbsent, {
        siteId,
        reason: "topic_horizon_replenishment",
        since: now - DAY_MS,
        maximumRecent: maximumTopicReplenishments,
      });
      if (horizon.queued) {
        await ctx.runMutation(internal.autopilot.raiseAlert, {
          siteId,
          kind: "topic_horizon_replenishment",
          message:
            "The verified topic horizon fell below one week; a rotated non-overlapping plan was queued behind the current article.",
          details: {
            remainingTopicHorizon,
            target: MIN_VERIFIED_TOPIC_HORIZON,
          },
        });
      }
    }

    return {
      scheduled: queued.queued ? 1 : 0,
      mode: queued.queued
        ? autonomousDelivery || rolloutMode === "warm" ? "buffer_fill" : "cadence_generation"
        : "work_in_progress",
      bufferCount: buffer.length,
    };
  },
});
