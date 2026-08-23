import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  coveredIntentTopics,
  serpFingerprintOverlap,
} from "./lib/autopilotBuffer";
import {
  articleReservesTopicIntent,
  decideTopicUpsert,
  dormantTopicRevivalPatch,
  normalizeTopicIntentKeyword,
} from "./lib/topicLifecycle";
import { reconcileTopicLifecycle } from "./lib/topicLifecycleDb";
import {
  AUTHORITY_POSITIONS_PER_TOPIC,
  DATAFORSEO_AUTHORITY_SOURCE,
  DATAFORSEO_DEMAND_SOURCE,
  EXPECTED_CLICK_PORTFOLIO_VERSION,
  evaluateStoredExpectedClickPortfolio,
} from "./lib/expectedClickPortfolio";
import { DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL } from "./lib/seoGrowth";
import {
  dataForSeoLanguageCode,
  dataForSeoLocationCode,
} from "./lib/dataForSeoLocale";

const now = () => Date.now();

function normalizedEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    url.search = '';
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '') || '/'}`;
  } catch {
    return null;
  }
}

async function requireSiteOwner(
  ctx: QueryCtx | MutationCtx,
  siteId: Doc<"sites">["_id"],
) {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!site?.userId || !identity || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site's topics");
  }
}

async function listBySiteHandler(ctx: QueryCtx, siteId: Doc<"sites">["_id"]) {
  return ctx.db
    .query("topic_clusters")
    .withIndex("by_site", (q) => q.eq("siteId", siteId))
    .order("asc")
    .collect();
}

export const listBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    return listBySiteHandler(ctx, siteId);
  },
});

export const listBySiteInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => listBySiteHandler(ctx, siteId),
});

/** Compact operator evidence for replenishment and cadence verification. */
async function inventoryAuditHandler(
  ctx: QueryCtx,
  siteId: Doc<"sites">["_id"],
  recentLimit?: number,
) {
    const [site, topics, growthGoal] = await Promise.all([
      ctx.db.get(siteId),
      listBySiteHandler(ctx, siteId),
      ctx.db
        .query("seo_growth_goals")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .unique(),
    ]);
    if (!site) throw new Error("Site not found");
    const byStatus: Record<string, number> = {};
    for (const topic of topics) {
      const status = topic.status ?? "planned";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    const portfolioTopics = topics.filter((topic) =>
      !["cannibalizing", "disqualified"].includes(topic.status ?? "planned")
    );
    const expectedClickPortfolio = evaluateStoredExpectedClickPortfolio({
      topics: portfolioTopics.map((topic) => ({
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
      monthlyOrganicClickGoal:
        growthGoal?.monthlyOrganicClicksGoal ??
        DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
      currentLocationCode: dataForSeoLocationCode(site.targetCountry),
      currentLanguageCode: dataForSeoLanguageCode(site.language),
    });
    const expectedClickEligible = new Set(
      expectedClickPortfolio.topics
        .filter((topic) => topic.status === "eligible")
        .map((topic) => topic.topicId),
    );
    const schedulerEvidenceReady = topics.filter((topic) =>
      !["used", "queued", "cannibalizing", "disqualified"].includes(
        topic.status ?? "planned",
      ) &&
      Number.isFinite(topic.searchVolume) &&
      Number.isFinite(topic.keywordDifficulty) &&
      topic.keywordDifficultyMeasured === true &&
      Boolean(topic.serpIntent) &&
      (topic.serpTopUrls?.length ?? 0) >= 5 &&
      expectedClickEligible.has(String(topic._id))
    );
    return {
      total: topics.length,
      byStatus,
      schedulerEvidenceReady: schedulerEvidenceReady.length,
      expectedClickPortfolio,
      recent: topics
        .slice()
        .sort((left, right) => right._creationTime - left._creationTime)
        .slice(0, Math.max(1, Math.min(recentLimit ?? 15, 50)))
        .map((topic) => ({
          topicId: topic._id,
          keyword: topic.primaryKeyword,
          status: topic.status ?? "planned",
          searchVolume: topic.searchVolume,
          keywordDifficulty: topic.keywordDifficulty,
          keywordDifficultyMeasured: topic.keywordDifficultyMeasured,
          businessFitEligible: topic.businessFitEligible,
          serpResults: topic.serpTopUrls?.length ?? 0,
          expectedClicksMonthly: topic.expectedClicksMonthly,
          expectedClickStatus: topic.expectedClickStatus,
          expectedClickAuditedAt: topic.expectedClickAuditedAt,
          growthActionFingerprint: topic.growthActionFingerprint,
          createdAt: topic._creationTime,
        })),
    };
}

export const getInventoryAudit = query({
  args: { siteId: v.id("sites"), recentLimit: v.optional(v.number()) },
  handler: async (ctx, { siteId, recentLimit }) => {
    await requireSiteOwner(ctx, siteId);
    return inventoryAuditHandler(ctx, siteId, recentLimit);
  },
});

export const getInventoryAuditInternal = internalQuery({
  args: { siteId: v.id("sites"), recentLimit: v.optional(v.number()) },
  handler: async (ctx, { siteId, recentLimit }) => {
    return inventoryAuditHandler(ctx, siteId, recentLimit);
  },
});

export const listGrowthSupportInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const topics = await listBySiteHandler(ctx, siteId);
    return topics
      .filter((topic) => Boolean(topic.growthActionFingerprint))
      .map((topic) => ({
        topicId: topic._id,
        primaryKeyword: topic.primaryKeyword,
        status: topic.status,
        priority: topic.priority,
        searchVolume: topic.searchVolume,
        keywordDifficulty: topic.keywordDifficulty,
        serpCount: topic.serpTopUrls?.length ?? 0,
        growthParentArticleId: topic.growthParentArticleId,
        growthActionFingerprint: topic.growthActionFingerprint,
      }));
  },
});

export const get = query({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic) return null;
    await requireSiteOwner(ctx, topic.siteId);
    return topic;
  },
});

export const getInternal = internalQuery({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => ctx.db.get(topicId),
});

export const getSerpFingerprintAudit = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const topics = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    const missing = topics
      .filter((topic) => (topic.serpTopUrls?.length ?? 0) < 5)
      .map((topic) => ({
        topicId: topic._id,
        primaryKeyword: topic.primaryKeyword,
        status: topic.status,
      }));
    return {
      total: topics.length,
      fingerprinted: topics.length - missing.length,
      missing,
    };
  },
});

export const getSerpCorpusAudit = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const topics = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < topics.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < topics.length;
        rightIndex += 1
      ) {
        const left = topics[leftIndex];
        const right = topics[rightIndex];
        const evidence = serpFingerprintOverlap(
          left.serpTopUrls,
          right.serpTopUrls,
        );
        if (evidence.shared < 3 || evidence.coefficient < 0.4) continue;
        overlaps.push({
          leftTopicId: left._id,
          rightTopicId: right._id,
          leftKeyword: left.primaryKeyword,
          rightKeyword: right.primaryKeyword,
          leftStatus: left.status,
          rightStatus: right.status,
          ...evidence,
        });
      }
    }
    return {
      total: topics.length,
      fingerprinted: topics.filter(
        (topic) => (topic.serpTopUrls?.length ?? 0) >= 5,
      ).length,
      overlaps,
    };
  },
});

export const upsertMany = internalMutation({
  args: {
    siteId: v.id("sites"),
    growthParentArticleId: v.optional(v.id("articles")),
    growthActionFingerprint: v.optional(v.string()),
    topics: v.array(
      v.object({
        label: v.string(),
        primaryKeyword: v.string(),
        secondaryKeywords: v.array(v.string()),
        intent: v.optional(v.string()),
        priority: v.optional(v.number()),
        articleType: v.optional(v.string()),
        status: v.optional(v.string()),
        notes: v.optional(v.string()),
        // SEO metrics — saved in one shot so topics never appear without data
        searchVolume: v.optional(v.number()),
        keywordDifficulty: v.optional(v.number()),
        keywordDifficultyMeasured: v.optional(v.boolean()),
        cpc: v.optional(v.number()),
        serpIntent: v.optional(v.string()),
        recommendedArticleType: v.optional(v.string()),
        paaQuestions: v.optional(v.array(v.string())),
        serpTopUrls: v.optional(v.array(v.string())),
        volumeTrend: v.optional(v.array(v.number())),
        searchDemandSource: v.optional(v.string()),
        searchDemandMeasuredAt: v.optional(v.number()),
        searchDemandLocationCode: v.optional(v.number()),
        searchDemandLanguageCode: v.optional(v.string()),
        serpObservedAt: v.optional(v.number()),
        serpLocationCode: v.optional(v.number()),
        serpLanguageCode: v.optional(v.string()),
        serpAuthorityCompetitors: v.optional(v.array(v.object({
          position: v.number(),
          url: v.string(),
          domain: v.string(),
          domainRank: v.number(),
          referringDomains: v.optional(v.number()),
          source: v.string(),
          measuredAt: v.number(),
        }))),
        expectedClicksMonthly: v.optional(v.number()),
        expectedClickProjectedPosition: v.optional(v.number()),
        expectedClickRankProbability: v.optional(v.number()),
        expectedClickStatus: v.optional(v.string()),
        expectedClickReasons: v.optional(v.array(v.string())),
        expectedClickAuditVersion: v.optional(v.number()),
        expectedClickAuditedAt: v.optional(v.number()),
        businessFitEligible: v.optional(v.boolean()),
        businessFitScore: v.optional(v.number()),
        businessFitVersion: v.optional(v.number()),
        businessFitReasons: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (
    ctx,
    { siteId, topics, growthParentArticleId, growthActionFingerprint },
  ) => {
    const site = await ctx.db.get(siteId);
    if (!site || site.deletionStatus) {
      throw new Error("Site not found");
    }
    if (growthParentArticleId) {
      const parent = await ctx.db.get(growthParentArticleId);
      if (
        !parent ||
        parent.siteId !== siteId ||
        parent.status !== "published" ||
        !growthActionFingerprint
      ) {
        throw new Error(
          "Growth support topics require a published same-tenant parent and action fingerprint",
        );
      }
      const action = await ctx.db
        .query("seo_growth_actions")
        .withIndex("by_fingerprint", (q) =>
          q.eq("fingerprint", growthActionFingerprint)
        )
        .unique();
      if (
        !action ||
        action.siteId !== siteId ||
        action.articleId !== growthParentArticleId ||
        action.status !== "open"
      ) {
        throw new Error("Growth support topic does not match its measured action");
      }
    } else if (growthActionFingerprint) {
      throw new Error("Growth action fingerprint requires a parent article");
    }
    // Historical topic rows are planning history, not durable coverage. Load
    // the compact same-tenant article projection first, then inspect the full
    // linked artifacts for every lexically relevant row so a missing legacy
    // projection can never make us rewrite published/sealed-ready coverage.
    const existing = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    const candidateKeywords = topics.map((topic) =>
      normalizeTopicIntentKeyword(topic.primaryKeyword)
    );
    const relevantExisting = existing.filter((topic) => {
      const keyword = normalizeTopicIntentKeyword(topic.primaryKeyword);
      return candidateKeywords.some((candidate) =>
        candidate.includes(keyword) || keyword.includes(candidate)
      );
    });
    const [articleSummaries, linkedArticleGroups] = await Promise.all([
      ctx.db
        .query("article_summaries")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .collect(),
      Promise.all(relevantExisting.map((topic) =>
        ctx.db
          .query("articles")
          .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
          .collect()
      )),
    ]);
    const summaryCoverageKeywords = coveredIntentTopics(
      existing.map((topic) => ({
        _id: String(topic._id),
        status: topic.status ?? "planned",
        primaryKeyword: topic.primaryKeyword,
        serpTopUrls: topic.serpTopUrls,
      })),
      articleSummaries.map((article) => ({
        topicId: article.topicId ? String(article.topicId) : undefined,
        slug: article.slug,
        status: article.status,
        publicationGateStatus: article.publicationGateStatus,
        publicationAuditVersion: article.publicationAuditVersion,
        auditedContentHash: article.auditedContentHash,
      })),
    ).map((topic) => topic.primaryKeyword);
    const reservingTopicIds = new Set<string>();
    for (const article of articleSummaries) {
      if (article.siteId !== siteId || !articleReservesTopicIntent(article)) {
        continue;
      }
      if (article.topicId) reservingTopicIds.add(String(article.topicId));
    }
    for (const articles of linkedArticleGroups) {
      for (const article of articles) {
        if (
          article.siteId === siteId &&
          article.topicId &&
          articleReservesTopicIntent(article)
        ) {
          reservingTopicIds.add(String(article.topicId));
        }
      }
    }

    let inserted = 0;
    let revived = 0;
    let skipped = 0;
    const acceptedKeywordKeys: string[] = [];
    for (const topic of topics) {
      const normalizedKw = normalizeTopicIntentKeyword(topic.primaryKeyword);
      if (!normalizedKw) throw new Error("Topic keyword is required");

      const hasAnyDemandEvidence = [
        topic.searchDemandSource,
        topic.searchDemandMeasuredAt,
        topic.searchDemandLocationCode,
        topic.searchDemandLanguageCode,
      ].some((value) => value !== undefined);
      if (hasAnyDemandEvidence) {
        if (
          topic.searchDemandSource !== DATAFORSEO_DEMAND_SOURCE ||
          !Number.isFinite(topic.searchVolume) ||
          !Number.isFinite(topic.searchDemandMeasuredAt) ||
          (topic.searchDemandMeasuredAt ?? 0) <= 0 ||
          !Number.isInteger(topic.searchDemandLocationCode) ||
          !topic.searchDemandLanguageCode?.trim()
        ) {
          throw new Error("Invalid or incompatible topic demand evidence");
        }
      }
      if (topic.serpAuthorityCompetitors !== undefined) {
        const snapshotUrls = new Set(
          (topic.serpTopUrls ?? [])
            .map(normalizedEvidenceUrl)
            .filter((url): url is string => Boolean(url)),
        );
        if (
          !Number.isFinite(topic.serpObservedAt) ||
          (topic.serpObservedAt ?? 0) <= 0 ||
          !Number.isInteger(topic.serpLocationCode) ||
          !topic.serpLanguageCode?.trim() ||
          topic.serpLocationCode !== topic.searchDemandLocationCode ||
          topic.serpLanguageCode.trim().toLowerCase() !==
            topic.searchDemandLanguageCode?.trim().toLowerCase() ||
          topic.serpAuthorityCompetitors.length > AUTHORITY_POSITIONS_PER_TOPIC ||
          topic.serpAuthorityCompetitors.some((competitor) =>
            competitor.source !== DATAFORSEO_AUTHORITY_SOURCE ||
            competitor.domainRank < 0 ||
            competitor.domainRank > 100 ||
            competitor.position < 1 ||
            competitor.position > 10 ||
            competitor.measuredAt < (topic.serpObservedAt ?? Infinity) ||
            !snapshotUrls.has(normalizedEvidenceUrl(competitor.url) ?? '')
          )
        ) {
          throw new Error("Invalid or incompatible SERP authority evidence");
        }
      }
      if (
        topic.expectedClickAuditVersion !== undefined &&
        topic.expectedClickAuditVersion !== EXPECTED_CLICK_PORTFOLIO_VERSION
      ) {
        throw new Error("Unsupported expected-click audit version");
      }

      const decision = decideTopicUpsert({
        candidateKeyword: topic.primaryKeyword,
        existingTopics: existing.map((existingTopic) => ({
          id: String(existingTopic._id),
          primaryKeyword: existingTopic.primaryKeyword,
          updatedAt: existingTopic.updatedAt,
        })),
        reservingTopicIds,
        additionalReservingKeywords: summaryCoverageKeywords,
        acceptedBatchKeywords: acceptedKeywordKeys,
      });
      if (decision.kind === "blocked") {
        skipped++;
        continue;
      }

      const persistedFields = {
        siteId,
        label: topic.label,
        primaryKeyword: topic.primaryKeyword,
        secondaryKeywords: topic.secondaryKeywords ?? [],
        intent: topic.intent,
        priority: topic.priority,
        articleType: topic.articleType,
        status: topic.status ?? "planned",
        notes: topic.notes,
        // SEO metrics — included at insert time so topics never appear without data
        ...(topic.searchVolume !== undefined ? { searchVolume: topic.searchVolume } : {}),
        ...(topic.keywordDifficulty !== undefined ? { keywordDifficulty: topic.keywordDifficulty } : {}),
        ...(topic.keywordDifficultyMeasured !== undefined
          ? { keywordDifficultyMeasured: topic.keywordDifficultyMeasured }
          : {}),
        ...(topic.cpc !== undefined ? { cpc: topic.cpc } : {}),
        ...(topic.serpIntent ? { serpIntent: topic.serpIntent } : {}),
        ...(topic.recommendedArticleType ? { recommendedArticleType: topic.recommendedArticleType } : {}),
        ...(topic.paaQuestions ? { paaQuestions: topic.paaQuestions } : {}),
        ...(topic.serpTopUrls ? { serpTopUrls: topic.serpTopUrls } : {}),
        ...(topic.volumeTrend ? { volumeTrend: topic.volumeTrend } : {}),
        ...(topic.searchDemandSource
          ? { searchDemandSource: topic.searchDemandSource }
          : {}),
        ...(topic.searchDemandMeasuredAt !== undefined
          ? { searchDemandMeasuredAt: topic.searchDemandMeasuredAt }
          : {}),
        ...(topic.searchDemandLocationCode !== undefined
          ? { searchDemandLocationCode: topic.searchDemandLocationCode }
          : {}),
        ...(topic.searchDemandLanguageCode
          ? { searchDemandLanguageCode: topic.searchDemandLanguageCode }
          : {}),
        ...(topic.serpObservedAt !== undefined
          ? { serpObservedAt: topic.serpObservedAt }
          : {}),
        ...(topic.serpLocationCode !== undefined
          ? { serpLocationCode: topic.serpLocationCode }
          : {}),
        ...(topic.serpLanguageCode
          ? { serpLanguageCode: topic.serpLanguageCode }
          : {}),
        ...(topic.serpAuthorityCompetitors
          ? { serpAuthorityCompetitors: topic.serpAuthorityCompetitors }
          : {}),
        ...(topic.expectedClicksMonthly !== undefined
          ? { expectedClicksMonthly: topic.expectedClicksMonthly }
          : {}),
        ...(topic.expectedClickProjectedPosition !== undefined
          ? { expectedClickProjectedPosition: topic.expectedClickProjectedPosition }
          : {}),
        ...(topic.expectedClickRankProbability !== undefined
          ? { expectedClickRankProbability: topic.expectedClickRankProbability }
          : {}),
        ...(topic.expectedClickStatus
          ? { expectedClickStatus: topic.expectedClickStatus }
          : {}),
        ...(topic.expectedClickReasons
          ? { expectedClickReasons: topic.expectedClickReasons }
          : {}),
        ...(topic.expectedClickAuditVersion !== undefined
          ? { expectedClickAuditVersion: topic.expectedClickAuditVersion }
          : {}),
        ...(topic.expectedClickAuditedAt !== undefined
          ? { expectedClickAuditedAt: topic.expectedClickAuditedAt }
          : {}),
        ...(topic.businessFitEligible !== undefined
          ? {
              businessFitEligible: topic.businessFitEligible,
            }
          : {}),
        ...(topic.businessFitScore !== undefined
          ? { businessFitScore: topic.businessFitScore }
          : {}),
        ...(topic.businessFitVersion !== undefined
          ? { businessFitVersion: topic.businessFitVersion }
          : {}),
        ...(topic.businessFitReasons
          ? { businessFitReasons: topic.businessFitReasons }
          : {}),
        ...(growthParentArticleId ? { growthParentArticleId } : {}),
        ...(growthActionFingerprint ? { growthActionFingerprint } : {}),
      };

      const timestamp = now();
      if (decision.kind === "revive") {
        const existingTopic = existing.find((candidate) =>
          String(candidate._id) === decision.topicId
        );
        if (!existingTopic || existingTopic.siteId !== siteId) {
          throw new Error("Dormant topic revival tenant mismatch");
        }
        const patch = dormantTopicRevivalPatch(
          existingTopic as unknown as Record<string, unknown>,
          {
            ...persistedFields,
            status: "planned",
            // Exact revival replaces obsolete growth routing. Undefined is an
            // intentional Convex field removal for an ordinary plan.
            growthParentArticleId,
            growthActionFingerprint,
          },
          timestamp,
        );
        if (patch.changed) {
          await ctx.db.patch(existingTopic._id, patch.fields);
        }
        // An identical replay is a database no-op but still reuses this exact
        // scheduler-eligible row, so it is an accepted revival to the caller.
        revived++;
      } else {
        await ctx.db.insert("topic_clusters", {
          ...persistedFields,
          ...(topic.businessFitEligible !== undefined
            ? { businessFitCheckedAt: timestamp }
            : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        inserted++;
      }

      // Transaction-local uniqueness only. This must not turn an unpublished
      // row into durable coverage for future plan generations.
      acceptedKeywordKeys.push(normalizedKw);
    }

    if (skipped > 0) {
      console.log(
        `Topics upsert: ${inserted} inserted, ${revived} revived, ` +
        `${skipped} covered/batch duplicates skipped.`,
      );
    }
    return {
      inserted,
      revived,
      skipped,
      acceptedKeywordKeys,
    };
  },
});

export const remove = mutation({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic) return;
    await requireSiteOwner(ctx, topic.siteId);
    await ctx.db.delete(topicId);
  },
});

export const removeInternal = internalMutation({
  args: { topicId: v.id("topic_clusters") },
  handler: async (ctx, { topicId }) => {
    await ctx.db.delete(topicId);
  },
});

export const updateStatus = internalMutation({
  args: {
    topicId: v.id("topic_clusters"),
    status: v.string(),
  },
  handler: async (ctx, { topicId, status }) => {
    const allowed = new Set([
      "pending", "queued", "planned", "used", "cannibalizing", "disqualified",
    ]);
    if (!allowed.has(status)) throw new Error("Invalid topic status");
    await ctx.db.patch(topicId, { status, updatedAt: now() });
  },
});

// Explicit, tenant-scoped lifecycle reconciliation for legacy rows created
// before draft generation and durable intent coverage were separated. This is
// deliberately paginated and does not schedule itself: an operator can first
// run with apply=false, inspect the bounded result, then replay each cursor
// with apply=true. Repeating any page is safe because only status differences
// are patched.
export const reconcileIntentLifecycleInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    cursor: v.optional(v.string()),
    pageSize: v.optional(v.number()),
    apply: v.boolean(),
  },
  handler: async (ctx, { siteId, cursor, pageSize, apply }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    const numItems = Math.max(1, Math.min(Math.floor(pageSize ?? 20), 50));
    const page = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .paginate({ cursor: cursor ?? null, numItems });
    const transitions: Array<{
      topicId: Doc<"topic_clusters">["_id"];
      previousStatus: string;
      nextStatus: string;
      linkedArticles: number;
      reservingArticles: number;
      activeArticleJobs: number;
    }> = [];

    for (const topic of page.page) {
      const result = await reconcileTopicLifecycle(ctx, {
        siteId,
        topicId: topic._id,
        apply,
      });
      if (!result.changed || !result.previousStatus || !result.nextStatus) {
        continue;
      }
      transitions.push({
        topicId: topic._id,
        previousStatus: result.previousStatus,
        nextStatus: result.nextStatus,
        linkedArticles: result.linkedArticles,
        reservingArticles: result.reservingArticles,
        activeArticleJobs: result.activeArticleJobs,
      });
    }

    return {
      siteId,
      apply,
      scanned: page.page.length,
      changed: transitions.length,
      transitions,
      isDone: page.isDone,
      continueCursor: page.isDone ? undefined : page.continueCursor,
    };
  },
});

export const recordBusinessFitAuditsInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    audits: v.array(v.object({
      topicId: v.id("topic_clusters"),
      eligible: v.boolean(),
      score: v.number(),
      version: v.number(),
      reasons: v.array(v.string()),
    })),
  },
  handler: async (ctx, { siteId, audits }) => {
    let disqualified = 0;
    let requalified = 0;
    let updated = 0;
    const checkedAt = now();
    for (const audit of audits) {
      const topic = await ctx.db.get(audit.topicId);
      if (!topic || topic.siteId !== siteId) continue;
      if (["used", "queued", "cannibalizing"].includes(topic.status ?? "")) {
        continue;
      }
      const nextStatus = audit.eligible
        ? topic.status === "disqualified" ? "planned" : topic.status ?? "planned"
        : "disqualified";
      if (!audit.eligible && topic.status !== "disqualified") disqualified += 1;
      if (audit.eligible && topic.status === "disqualified") requalified += 1;
      const reason = audit.reasons.join("; ");
      const changed =
        topic.businessFitEligible !== audit.eligible ||
        topic.businessFitScore !== audit.score ||
        topic.businessFitVersion !== audit.version ||
        JSON.stringify(topic.businessFitReasons ?? []) !==
          JSON.stringify(audit.reasons) ||
        topic.status !== nextStatus;
      if (!changed) continue;
      await ctx.db.patch(audit.topicId, {
        businessFitEligible: audit.eligible,
        businessFitScore: audit.score,
        businessFitVersion: audit.version,
        businessFitReasons: audit.reasons,
        businessFitCheckedAt: checkedAt,
        status: nextStatus,
        disqualifiedReason: audit.eligible ? undefined : reason,
        updatedAt: checkedAt,
      });
      updated += 1;
    }
    return { disqualified, requalified, updated };
  },
});

// A topic can already be queued when a newer product-fit policy is deployed or
// a tenant profile changes. The worker calls this mutation immediately before
// incurring research or model spend, so only that exact queued topic can be
// quarantined while unrelated tenant work remains untouched.
export const disqualifyQueuedTopicInternal = internalMutation({
  args: {
    siteId: v.id("sites"),
    topicId: v.id("topic_clusters"),
    score: v.number(),
    version: v.number(),
    reasons: v.array(v.string()),
  },
  handler: async (ctx, { siteId, topicId, score, version, reasons }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic || topic.siteId !== siteId || topic.status !== "queued") {
      return { updated: false };
    }
    const checkedAt = now();
    await ctx.db.patch(topicId, {
      status: "disqualified",
      businessFitEligible: false,
      businessFitScore: score,
      businessFitVersion: version,
      businessFitReasons: reasons,
      businessFitCheckedAt: checkedAt,
      disqualifiedReason: reasons.join("; "),
      updatedAt: checkedAt,
    });
    return { updated: true };
  },
});

export const updateLabel = internalMutation({
  args: {
    topicId: v.id("topic_clusters"),
    label: v.string(),
  },
  handler: async (ctx, { topicId, label }) => {
    const topic = await ctx.db.get(topicId);
    if (!topic) throw new Error("Topic not found");
    const normalizedLabel = label.trim();
    if (!normalizedLabel) throw new Error("Topic label cannot be empty");
    await ctx.db.patch(topicId, {
      label: normalizedLabel,
      updatedAt: now(),
    });
  },
});

export const removeUsed = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    const all = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    let deleted = 0;
    for (const topic of all) {
      if (topic.status === "used") {
        await ctx.db.delete(topic._id);
        deleted++;
      }
    }
    return { deleted };
  },
});

export const updateSEOMetrics = internalMutation({
  args: {
    topicId: v.id("topic_clusters"),
    searchVolume: v.optional(v.number()),
    keywordDifficulty: v.optional(v.number()),
    keywordDifficultyMeasured: v.optional(v.boolean()),
    cpc: v.optional(v.number()),
    serpIntent: v.optional(v.string()),
    recommendedArticleType: v.optional(v.string()),
    paaQuestions: v.optional(v.array(v.string())),
    serpTopUrls: v.optional(v.array(v.string())),
    volumeTrend: v.optional(v.array(v.number())),
    priority: v.optional(v.number()),
    articleType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { topicId, ...metrics } = args;
    const current = await ctx.db.get(topicId);
    if (!current) throw new Error("Topic not found");
    // Strip undefined values to avoid clearing fields
    const patch: Partial<Doc<"topic_clusters">> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(metrics)) {
      if (val !== undefined) {
        (patch as Record<string, unknown>)[k] = val;
      }
    }
    const demandChanged =
      metrics.searchVolume !== undefined &&
      metrics.searchVolume !== current.searchVolume;
    const serpChanged =
      metrics.serpTopUrls !== undefined &&
      JSON.stringify(metrics.serpTopUrls) !== JSON.stringify(current.serpTopUrls);
    if (demandChanged) {
      patch.searchDemandSource = undefined;
      patch.searchDemandMeasuredAt = undefined;
      patch.searchDemandLocationCode = undefined;
      patch.searchDemandLanguageCode = undefined;
    }
    if (serpChanged) {
      patch.serpObservedAt = undefined;
      patch.serpLocationCode = undefined;
      patch.serpLanguageCode = undefined;
      patch.serpAuthorityCompetitors = undefined;
    }
    if (demandChanged || serpChanged) {
      patch.expectedClicksMonthly = undefined;
      patch.expectedClickProjectedPosition = undefined;
      patch.expectedClickRankProbability = undefined;
      patch.expectedClickStatus = undefined;
      patch.expectedClickReasons = undefined;
      patch.expectedClickAuditVersion = undefined;
      patch.expectedClickAuditedAt = undefined;
    }
    await ctx.db.patch(topicId, patch);
  },
});

export const removeUnused = mutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    const all = await ctx.db
      .query("topic_clusters")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    let deleted = 0;
    for (const topic of all) {
      if (topic.status !== "used") {
        await ctx.db.delete(topic._id);
        deleted++;
      }
    }
    return { deleted };
  },
});
