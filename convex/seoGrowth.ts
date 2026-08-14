import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { addSearchConsoleDays } from "./lib/searchPerformance";
import {
  DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
  growthActionFingerprint,
} from "./lib/seoGrowth";
import {
  keywordMatchesBusinessModel,
  keywordMatchesBusinessSignals,
} from "./lib/autopilotBuffer";

const ACTIVE_ACTION_STATUSES = ["open", "monitoring"] as const;
const RETRYABLE_SUPPORT_AUTOMATION = new Set([
  "no_safe_candidate",
  "queued_growth_plan",
  "bounded_wait",
  "support_failed",
]);

async function requireSiteOwner(ctx: QueryCtx, siteId: Id<"sites">) {
  const [site, identity] = await Promise.all([
    ctx.db.get(siteId),
    ctx.auth.getUserIdentity(),
  ]);
  if (!site?.userId || !identity || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site's SEO growth data");
  }
  return site;
}

export const getSiteInputs = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    const latest = await ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", siteId).eq("syncVersion", 2),
      )
      .order("desc")
      .first();
    const cutoff = latest ? addSearchConsoleDays(latest.date, -89) : undefined;
    const [rows, articles, goal] = await Promise.all([
      cutoff
        ? ctx.db
          .query("search_page_daily")
          .withIndex("by_site_date", (q) =>
            q.eq("siteId", siteId).gte("date", cutoff),
          )
          .collect()
        : Promise.resolve([]),
      ctx.db
        .query("article_summaries")
        .withIndex("by_site_status_published", (q) =>
          q
            .eq("siteId", siteId)
            .eq("status", "published")
            .gte("publishedAt", Date.now() - 90 * 24 * 60 * 60 * 1000),
        )
        .order("desc")
        .take(100),
      ctx.db
        .query("seo_growth_goals")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .unique(),
    ]);
    return {
      site: {
        siteId,
        domain: site.domain,
        urlStructure: site.urlStructure,
      },
      dataThrough: latest?.date,
      rows,
      articles: articles.map((article) => ({
        articleId: article.articleId,
        topicId: article.topicId,
        title: article.title,
        slug: article.slug,
        publishedAt: article.publishedAt ?? article.articleCreatedAt,
        gscIndexVerdict: article.gscIndexVerdict,
        gscCoverageState: article.gscCoverageState,
        gscPageFetchState: article.gscPageFetchState,
        gscRobotsTxtState: article.gscRobotsTxtState,
        gscInspectionError: article.gscInspectionError,
      })),
      monthlyOrganicClicksGoal:
        goal?.monthlyOrganicClicksGoal ?? DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
    };
  },
});

const evidenceValidator = v.object({
  dataThrough: v.optional(v.string()),
  windowDays: v.optional(v.number()),
  clicks: v.number(),
  impressions: v.number(),
  ctr: v.number(),
  position: v.union(v.number(), v.null()),
  nonBrandedClicks: v.number(),
  nonBrandedImpressions: v.number(),
  nonBrandedCtr: v.number(),
  nonBrandedPosition: v.union(v.number(), v.null()),
  indexVerdict: v.optional(v.string()),
  coverageState: v.optional(v.string()),
  pageFetchState: v.optional(v.string()),
  robotsTxtState: v.optional(v.string()),
});

const classificationValidator = v.object({
  articleId: v.id("articles"),
  stage: v.string(),
  actionKind: v.string(),
  priority: v.number(),
  reason: v.string(),
  indexState: v.string(),
  nextReviewDate: v.optional(v.string()),
  evidence: evidenceValidator,
});

type GrowthAutomationResult = {
  status: string;
  detail: string;
  growthSeed?: string;
};

function isVerifiedUnusedTopic(topic: {
  status?: string;
  searchVolume?: number;
  keywordDifficulty?: number;
  serpTopUrls?: string[];
  serpIntent?: string;
}): boolean {
  return (
    (topic.status === "planned" || topic.status === "pending") &&
    (topic.searchVolume ?? 0) > 0 &&
    topic.keywordDifficulty !== undefined &&
    (topic.serpTopUrls?.length ?? 0) >= 5 &&
    Boolean(topic.serpIntent)
  );
}

function isTopicallyRelated(
  source: {
    primaryKeyword: string;
    secondaryKeywords: string[];
    label: string;
  },
  candidate: {
    primaryKeyword: string;
    secondaryKeywords: string[];
    label: string;
  },
): boolean {
  const sourceSignals = [
    source.primaryKeyword,
    ...source.secondaryKeywords,
    source.label,
  ];
  const candidateSignals = [
    candidate.primaryKeyword,
    ...candidate.secondaryKeywords,
    candidate.label,
  ];
  return (
    keywordMatchesBusinessSignals(candidate.primaryKeyword, sourceSignals) &&
    keywordMatchesBusinessSignals(source.primaryKeyword, candidateSignals)
  );
}

async function prioritizeVerifiedSupportingTopic(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  articleId: Id<"articles">,
  actionFingerprint: string,
): Promise<GrowthAutomationResult> {
  const [article, site] = await Promise.all([
    ctx.db.get(articleId),
    ctx.db.get(siteId),
  ]);
  if (!site || !article || article.siteId !== siteId || !article.topicId) {
    return { status: "no_safe_candidate", detail: "The article has no source topic." };
  }
  const sourceTopic = await ctx.db.get(article.topicId);
  if (!sourceTopic || sourceTopic.siteId !== siteId) {
    return { status: "no_safe_candidate", detail: "The source topic is unavailable." };
  }
  const topics = await ctx.db
    .query("topic_clusters")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
  const candidates = topics
    .filter((topic) =>
      topic._id !== sourceTopic._id &&
      isVerifiedUnusedTopic(topic) &&
      keywordMatchesBusinessModel(topic.primaryKeyword, [
        site.siteType ?? "",
        site.niche ?? "",
        site.siteSummary ?? "",
      ]) &&
      (
        topic.growthParentArticleId === articleId ||
        (!topic.growthParentArticleId && isTopicallyRelated(sourceTopic, topic))
      )
    )
    .sort((a, b) =>
      Number(b.growthParentArticleId === articleId) -
        Number(a.growthParentArticleId === articleId) ||
      (b.priority ?? 0) - (a.priority ?? 0) ||
      (b.searchVolume ?? 0) - (a.searchVolume ?? 0)
    );
  const candidate = candidates[0];
  if (!candidate) {
    return {
      status: "no_safe_candidate",
      detail: "No unused, measured, topically related topic passed the live SERP evidence gate.",
      growthSeed: sourceTopic.primaryKeyword,
    };
  }
  await ctx.db.patch(candidate._id, {
    priority: Math.min(100, Math.max(candidate.priority ?? 0, 90)),
    growthParentArticleId: articleId,
    growthActionFingerprint: actionFingerprint,
    updatedAt: Date.now(),
  });
  return {
    status: "support_topic_prioritized",
    detail: `Prioritized verified supporting topic ${candidate._id}.`,
  };
}

async function deprioritizeFailedOpportunityCluster(
  ctx: MutationCtx,
  siteId: Id<"sites">,
  articleId: Id<"articles">,
) {
  const article = await ctx.db.get(articleId);
  if (!article || article.siteId !== siteId || !article.topicId) {
    return { status: "no_safe_candidate", detail: "The article has no source topic." };
  }
  const sourceTopic = await ctx.db.get(article.topicId);
  if (!sourceTopic || sourceTopic.siteId !== siteId) {
    return { status: "no_safe_candidate", detail: "The source topic is unavailable." };
  }
  const topics = await ctx.db
    .query("topic_clusters")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .collect();
  const candidates = topics.filter((topic) =>
    topic._id !== sourceTopic._id &&
    (
      topic.growthParentArticleId === articleId ||
      (!topic.growthParentArticleId && isTopicallyRelated(sourceTopic, topic))
    ) &&
    (topic.status === "planned" || topic.status === "pending")
  );
  for (const candidate of candidates) {
    await ctx.db.patch(candidate._id, {
      priority: Math.max(0, (candidate.priority ?? 50) - 20),
      updatedAt: Date.now(),
    });
  }
  return candidates.length > 0
    ? {
        status: "executed",
        detail: `Deprioritized ${candidates.length} unused related topic(s) pending new evidence.`,
      }
    : {
        status: "no_safe_candidate",
        detail: "No unused related topics remained to deprioritize.",
      };
}

export const reconcileSite = internalMutation({
  args: {
    siteId: v.id("sites"),
    classifications: v.array(classificationValidator),
    health: v.object({
      dataThrough: v.optional(v.string()),
      windowStart: v.optional(v.string()),
      windowDays: v.number(),
      dataDays: v.number(),
      organicClicks: v.number(),
      organicImpressions: v.number(),
      nonBrandedClicks: v.number(),
      nonBrandedImpressions: v.number(),
      averagePosition: v.number(),
      monthlyOrganicClicksGoal: v.number(),
    }),
  },
  handler: async (ctx, { siteId, classifications, health }) => {
    const now = Date.now();
    let openActions = 0;
    const replenishmentRequests: Array<{
      articleId: Id<"articles">;
      fingerprint: string;
      growthSeed: string;
      priority: number;
    }> = [];
    for (const classification of classifications) {
      const article = await ctx.db.get(classification.articleId);
      if (!article || article.siteId !== siteId || article.status !== "published") {
        throw new Error("Growth classification crossed a tenant or publication boundary");
      }
      const fingerprint = growthActionFingerprint(siteId, classification);
      const desiredStatus = classification.actionKind === "observe"
        ? "monitoring"
        : "open";
      if (desiredStatus === "open") openActions++;

      for (const status of ACTIVE_ACTION_STATUSES) {
        const active = await ctx.db
          .query("seo_growth_actions")
          .withIndex("by_article_status", (q) =>
            q.eq("articleId", classification.articleId).eq("status", status),
          )
          .collect();
        for (const prior of active) {
          if (prior.fingerprint !== fingerprint) {
            await ctx.db.patch(prior._id, {
              status: "resolved",
              resolvedAt: now,
              resolution: `Superseded by measured stage ${classification.stage}.`,
              updatedAt: now,
            });
          }
        }
      }

      const existing = await ctx.db
        .query("seo_growth_actions")
        .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
        .unique();
      const nextReviewAt = classification.nextReviewDate
        ? Date.parse(`${classification.nextReviewDate}T12:00:00.000Z`)
        : undefined;
      if (existing) {
        let automation: GrowthAutomationResult | undefined;
        if (
          desiredStatus === "open" &&
          (classification.actionKind === "repair_discovery" ||
            classification.actionKind === "strengthen_cluster") &&
          RETRYABLE_SUPPORT_AUTOMATION.has(
            existing.automationStatus ?? "no_safe_candidate",
          )
        ) {
          automation = await prioritizeVerifiedSupportingTopic(
            ctx,
            siteId,
            classification.articleId,
            fingerprint,
          );
          if (automation.status === "no_safe_candidate" && automation.growthSeed) {
            replenishmentRequests.push({
              articleId: classification.articleId,
              fingerprint,
              growthSeed: automation.growthSeed,
              priority: classification.priority,
            });
          }
        }
        await ctx.db.patch(existing._id, {
          status: desiredStatus,
          priority: classification.priority,
          reason: classification.reason,
          indexState: classification.indexState,
          evidence: classification.evidence,
          lastObservedAt: now,
          nextReviewAt,
          resolvedAt: undefined,
          resolution: undefined,
          ...(automation ? {
            automationStatus: automation.status,
            automationDetail: automation.detail,
            automatedAt: automation.status === "executed" ? now : undefined,
          } : {}),
          updatedAt: now,
        });
      } else {
        let automation: GrowthAutomationResult = {
          status: "not_applicable",
          detail: "This measured stage has no safe automatic mutation.",
        };
        if (
          classification.actionKind === "repair_discovery" ||
          classification.actionKind === "strengthen_cluster"
        ) {
          automation = await prioritizeVerifiedSupportingTopic(
            ctx,
            siteId,
            classification.articleId,
            fingerprint,
          );
        } else if (classification.actionKind === "reassess_opportunity") {
          automation = await deprioritizeFailedOpportunityCluster(
            ctx,
            siteId,
            classification.articleId,
          );
        }
        if (automation.status === "no_safe_candidate" && automation.growthSeed) {
          replenishmentRequests.push({
            articleId: classification.articleId,
            fingerprint,
            growthSeed: automation.growthSeed,
            priority: classification.priority,
          });
        }
        await ctx.db.insert("seo_growth_actions", {
          siteId,
          articleId: classification.articleId,
          fingerprint,
          stage: classification.stage,
          actionKind: classification.actionKind,
          status: desiredStatus,
          priority: classification.priority,
          reason: classification.reason,
          indexState: classification.indexState,
          evidence: classification.evidence,
          automationStatus: automation.status,
          automationDetail: automation.detail,
          automatedAt: automation.status === "executed" ? now : undefined,
          firstObservedAt: now,
          lastObservedAt: now,
          nextReviewAt,
          updatedAt: now,
        });
      }
    }

    const activeArticleIds = new Set(
      classifications.map((classification) => String(classification.articleId)),
    );
    for (const status of ACTIVE_ACTION_STATUSES) {
      const stale = await ctx.db
        .query("seo_growth_actions")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", status),
        )
        .collect();
      for (const action of stale) {
        if (!activeArticleIds.has(String(action.articleId))) {
          await ctx.db.patch(action._id, {
            status: "resolved",
            resolvedAt: now,
            resolution: "Article left the bounded growth cohort.",
            updatedAt: now,
          });
        }
      }
    }

    const count = (stage: string) =>
      classifications.filter((classification) => classification.stage === stage).length;
    const stageCounts = {
      awaitingData: count("awaiting_data"),
      indexingPending: count("indexing_pending"),
      indexingStalled: count("indexing_stalled"),
      noVisibility: count("no_visibility"),
      lowVisibility: count("low_visibility"),
      strikingDistance: count("striking_distance"),
      lowCtr: count("low_ctr"),
      performing: count("performing"),
    };
    const goalProgress = health.monthlyOrganicClicksGoal > 0
      ? health.organicClicks / health.monthlyOrganicClicksGoal
      : 0;
    const healthPatch = {
      siteId,
      ...health,
      goalProgress,
      outcomeStatus: health.dataDays === 0
        ? "awaiting_data"
        : goalProgress >= 1
          ? "goal_met"
          : "below_goal",
      articlesEvaluated: classifications.length,
      indexedArticles: classifications.filter(
        (classification) => classification.indexState === "indexed",
      ).length,
      stageCounts,
      openActions,
      lastEvaluatedAt: now,
      updatedAt: now,
    };
    const existingHealth = await ctx.db
      .query("seo_growth_health")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .unique();
    if (existingHealth) {
      await ctx.db.patch(existingHealth._id, healthPatch);
    } else {
      await ctx.db.insert("seo_growth_health", healthPatch);
    }
    return {
      articlesEvaluated: classifications.length,
      openActions,
      stageCounts,
      replenishmentRequests,
    };
  },
});

export const recordAutomationResult = internalMutation({
  args: {
    siteId: v.id("sites"),
    fingerprint: v.string(),
    status: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, { siteId, fingerprint, status, detail }) => {
    const action = await ctx.db
      .query("seo_growth_actions")
      .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
      .unique();
    if (!action || action.siteId !== siteId || action.status !== "open") {
      throw new Error("Growth automation result does not match an open tenant action");
    }
    await ctx.db.patch(action._id, {
      automationStatus: status,
      automationDetail: detail,
      automatedAt: status === "executed" ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});

export const recordSupportArticleOutcome = internalMutation({
  args: {
    articleId: v.id("articles"),
    status: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, { articleId, status, detail }) => {
    const allowed = new Set([
      "support_quarantined",
      "support_failed",
      "support_ready",
      "executed",
    ]);
    if (!allowed.has(status)) throw new Error("Invalid growth support outcome");
    const article = await ctx.db.get(articleId);
    if (!article?.topicId) return { updated: false, reason: "not_growth_support" };
    const topic = await ctx.db.get(article.topicId);
    if (
      !topic ||
      topic.siteId !== article.siteId ||
      !topic.growthActionFingerprint ||
      topic.growthParentArticleId === undefined
    ) {
      return { updated: false, reason: "not_growth_support" };
    }
    const action = await ctx.db
      .query("seo_growth_actions")
      .withIndex("by_fingerprint", (q) =>
        q.eq("fingerprint", topic.growthActionFingerprint!)
      )
      .unique();
    if (
      !action ||
      action.siteId !== article.siteId ||
      action.articleId !== topic.growthParentArticleId ||
      action.status !== "open"
    ) {
      return { updated: false, reason: "action_not_open" };
    }
    const timestamp = Date.now();
    await ctx.db.patch(action._id, {
      automationStatus: status,
      automationDetail: detail,
      automatedAt: status === "executed" ? timestamp : undefined,
      updatedAt: timestamp,
    });
    return { updated: true };
  },
});

export const getSummary = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    const [health, goal, open, monitoring] = await Promise.all([
      ctx.db
        .query("seo_growth_health")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .unique(),
      ctx.db
        .query("seo_growth_goals")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .unique(),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_site_priority", (q) =>
          q.eq("siteId", siteId).eq("status", "open"),
        )
        .order("desc")
        .take(50),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_site_priority", (q) =>
          q.eq("siteId", siteId).eq("status", "monitoring"),
        )
        .order("desc")
        .take(50),
    ]);
    return {
      health,
      goal: goal ?? {
        siteId,
        monthlyOrganicClicksGoal: DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
      },
      actions: [...open, ...monitoring],
    };
  },
});

export const setGoal = mutation({
  args: {
    siteId: v.id("sites"),
    monthlyOrganicClicksGoal: v.number(),
    qualifiedActionsGoal: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSiteOwner(ctx, args.siteId);
    const monthlyOrganicClicksGoal = Math.max(
      1,
      Math.min(1_000_000, Math.floor(args.monthlyOrganicClicksGoal)),
    );
    const qualifiedActionsGoal = args.qualifiedActionsGoal === undefined
      ? undefined
      : Math.max(0, Math.min(1_000_000, Math.floor(args.qualifiedActionsGoal)));
    const timestamp = Date.now();
    const existing = await ctx.db
      .query("seo_growth_goals")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        monthlyOrganicClicksGoal,
        qualifiedActionsGoal,
        updatedAt: timestamp,
      });
      return existing._id;
    }
    return ctx.db.insert("seo_growth_goals", {
      siteId: args.siteId,
      monthlyOrganicClicksGoal,
      qualifiedActionsGoal,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
});

export const getOperatorSnapshot = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const [site, health, goal, open, monitoring, resolved] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("seo_growth_health")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .unique(),
      ctx.db
        .query("seo_growth_goals")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .unique(),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_site_priority", (q) =>
          q.eq("siteId", siteId).eq("status", "open"),
        )
        .order("desc")
        .take(100),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_site_priority", (q) =>
          q.eq("siteId", siteId).eq("status", "monitoring"),
        )
        .order("desc")
        .take(100),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "resolved"),
        )
        .order("desc")
        .take(100),
    ]);
    if (!site) throw new Error("Site not found");
    return {
      site: { siteId, domain: site.domain },
      goal: goal?.monthlyOrganicClicksGoal ?? DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
      health,
      actions: [...open, ...monitoring, ...resolved].map((action) => ({
        articleId: action.articleId,
        stage: action.stage,
        actionKind: action.actionKind,
        status: action.status,
        priority: action.priority,
        reason: action.reason,
        automationStatus: action.automationStatus,
        automationDetail: action.automationDetail,
        evidence: action.evidence,
        firstObservedAt: action.firstObservedAt,
        lastObservedAt: action.lastObservedAt,
        resolvedAt: action.resolvedAt,
      })),
    };
  },
});
