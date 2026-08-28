import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { addSearchConsoleDays } from "./lib/searchPerformance";
import {
  DEFAULT_MONTHLY_ORGANIC_CLICKS_GOAL,
  growthActionFingerprint,
  isSeoGrowthActuationEligible,
} from "./lib/seoGrowth";
import {
  keywordMatchesBusinessModel,
  keywordMatchesBusinessSignals,
} from "./lib/autopilotBuffer";
import { takeCurrentGscPageRows } from "./lib/currentGscRows";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import {
  growthSupportDeliveryReceiptsMatch,
  isTerminalPublishedRevisionStatus,
  legacyExecutedSupportRevisionAdmission,
  MAX_LEGACY_SUPPORT_ARTICLES_PER_TOPIC,
  MAX_LEGACY_SUPPORT_TOPICS_PER_ACTION,
  selectLegacySupportDeliveryAdoptionCandidate,
  SUPPORT_DELIVERY_VERIFIED_STATUS,
  verifiedGrowthSupportDelivery,
  verifiedGrowthSupportDeliveryCandidate,
  verifiedGrowthSupportDeliveryEvidence,
  type GrowthSupportDeliveryEvidence,
  type GrowthSupportDeliveryReceipt,
} from "./lib/growthSupportDelivery";
import {
  LEGACY_GITHUB_PUBLICATION_AUDIT_VERSION,
  MAX_PUBLISHED_REVISIONS_PER_TENANT_24H,
} from "./lib/publishedRevision";
import {
  PUBLICATION_AUDIT_VERSION,
  publicationAdapterConfigHash,
  publicationArtifactHashForAuditVersion,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
  publicationDeliveryKey,
} from "./lib/publicationArtifact";
import {
  PUBLICATION_ADAPTER_VERSION,
  validatePublicationReceipt,
} from "./lib/publicationReceipts";
import {
  articleMatchesCurrentDomain,
  collectCurrentDomainPublishedSummariesSince,
  gscConnectionMatchesCurrentDomain,
  gscInspectionMatchesCurrentConnection,
  normalizeCanonicalDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteGscConnectionRevision,
  takeCurrentDomainTopics,
  topicMatchesCurrentDomain,
} from "./lib/siteDomainBinding";

const ACTIVE_ACTION_STATUSES = ["open", "monitoring"] as const;
const RETRYABLE_SUPPORT_AUTOMATION = new Set([
  "no_safe_candidate",
  "queued_growth_plan",
  "bounded_wait",
  "support_failed",
  "discovery_repair_verified",
  "measurement_only",
]);
const RETRYABLE_REVISION_AUTOMATION = new Set([
  "no_safe_candidate",
  "bounded_wait",
  "measurement_only",
  "awaiting_published_revision",
  "revision_prepared",
  "revision_unverified",
]);

const MEASUREMENT_ONLY_AUTOMATION: GrowthAutomationResult = {
  status: "measurement_only",
  detail:
    "Pentra recorded this measured opportunity without changing topics or contacting an external service because SEO growth automation is not enabled for this tenant rollout.",
};

const GROWTH_REVIEW_RECOVERY_DELAY_MS = 24 * 60 * 60 * 1000;
const GROWTH_REVIEW_RECOVERY_READ_LIMIT = 500;
const GROWTH_REVIEW_RECOVERY_SITE_LIMIT = 50;

function growthMeasurementMatchesCurrentSite(
  site: Doc<"sites">,
  action: Doc<"seo_growth_actions">,
  measurementKey?: string,
): boolean {
  return (
    (!measurementKey || action.measurementKey === measurementKey) &&
    gscConnectionMatchesCurrentDomain(site) &&
    action.measurementCanonicalDomain === siteCanonicalDomain(site) &&
    action.measurementDomainRevision === siteCanonicalDomainRevision(site) &&
    action.measurementGscConnectionRevision ===
      siteGscConnectionRevision(site) &&
    action.measurementGscProperty === site.gscProperty &&
    action.measurementGscSyncEpoch === site.gscSyncEpoch &&
    action.measurementGscDataThrough === site.gscDataThrough
  );
}

export const getActionAttemptEligibilityInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    fingerprint: v.string(),
    measurementKey: v.string(),
  },
  handler: async (ctx, { siteId, fingerprint, measurementKey }) => {
    const [site, action] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
        .unique(),
    ]);
    return Boolean(
      site &&
      action &&
      action.siteId === siteId &&
      action.status === "open" &&
      isSeoGrowthActuationEligible(site) &&
      growthMeasurementMatchesCurrentSite(site, action, measurementKey),
    );
  },
});

/** Bounded natural recovery for exact growth-action deadlines. Daily GSC
 * classification remains the primary lane; this projection only returns
 * tenants whose durable nextReviewAt has actually elapsed. */
export const listDueGrowthSitesInternal = internalQuery({
  args: { timestamp: v.number() },
  handler: async (ctx, { timestamp }) => {
    if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
      throw new Error("Growth recovery timestamp is invalid");
    }
    const due = await ctx.db.query("seo_growth_actions")
      .withIndex("by_next_review", (q) => q.lte("nextReviewAt", timestamp))
      .take(GROWTH_REVIEW_RECOVERY_READ_LIMIT + 1);
    const siteIds: Id<"sites">[] = [];
    const seen = new Set<string>();
    for (const action of due.slice(0, GROWTH_REVIEW_RECOVERY_READ_LIMIT)) {
      if (
        !ACTIVE_ACTION_STATUSES.includes(
          action.status as typeof ACTIVE_ACTION_STATUSES[number],
        ) || seen.has(String(action.siteId))
      ) continue;
      const site = await ctx.db.get(action.siteId);
      if (
        !site || !site.gscProperty || !site.gscDataThrough ||
        !await siteExecutionAuthorized(ctx, site) ||
        !growthMeasurementMatchesCurrentSite(site, action)
      ) continue;
      seen.add(String(action.siteId));
      siteIds.push(action.siteId);
      if (siteIds.length >= GROWTH_REVIEW_RECOVERY_SITE_LIMIT) break;
    }
    return {
      siteIds,
      readComplete: due.length <= GROWTH_REVIEW_RECOVERY_READ_LIMIT,
    };
  },
});

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

type ActionRevisionHistory = {
  anyRevisionExists: boolean;
  boundRevisionMissing: boolean;
  revisionBindingInvalid: boolean;
  latestStatus?: string;
  terminalRevisionStatus?: string;
};

async function actionRevisionHistory(
  ctx: QueryCtx | MutationCtx,
  action: Doc<"seo_growth_actions">,
): Promise<ActionRevisionHistory> {
  const [linked, bound] = await Promise.all([
    ctx.db
      .query("published_article_revisions")
      .withIndex("by_action", (q) => q.eq("growthActionId", action._id))
      .order("desc")
      .collect(),
    action.publishedRevisionId
      ? ctx.db.get(action.publishedRevisionId)
      : Promise.resolve(null),
  ]);
  const boundMatchesAction = Boolean(
    bound &&
    bound.siteId === action.siteId &&
    bound.articleId === action.articleId &&
    bound.growthActionId === action._id,
  );
  const boundRevisionMissing = Boolean(action.publishedRevisionId && !bound);
  const revisionBindingInvalid = Boolean(
    (action.publishedRevisionId && !boundMatchesAction) ||
    (!action.publishedRevisionId && linked.length > 0),
  );
  const revisions = [...linked];
  if (
    boundMatchesAction &&
    !revisions.some((revision) => revision._id === bound!._id)
  ) {
    revisions.push(bound!);
  }
  revisions.sort((left, right) => right.createdAt - left.createdAt);
  const terminal = revisions.find((revision) =>
    isTerminalPublishedRevisionStatus(revision.status)
  );
  return {
    anyRevisionExists: revisions.length > 0,
    boundRevisionMissing,
    revisionBindingInvalid,
    latestStatus: revisions[0]?.status,
    terminalRevisionStatus: terminal?.status,
  };
}

async function actionHasUnresolvedRevisionDelivery(
  ctx: QueryCtx | MutationCtx,
  action: Doc<"seo_growth_actions">,
): Promise<boolean> {
  if (!action.publishedRevisionId) return false;
  const revision = await ctx.db.get(action.publishedRevisionId);
  if (
    !revision ||
    revision.siteId !== action.siteId ||
    revision.articleId !== action.articleId ||
    revision.growthActionId !== action._id
  ) {
    return false;
  }
  return (
    revision.status === "leased" ||
    revision.status === "attempted" ||
    (revision.status === "unverified" && !revision.receipt)
  );
}

async function verifiedSupportDeliveryForAction(
  ctx: QueryCtx | MutationCtx,
  site: Doc<"sites">,
  action: Doc<"seo_growth_actions">,
  timestamp: number,
): Promise<GrowthSupportDeliveryEvidence<Id<"articles">> | null> {
  const validateCandidate = async (
    article: Doc<"articles"> | null,
  ): Promise<GrowthSupportDeliveryEvidence<Id<"articles">> | null> => {
    if (!article?.topicId) return null;
    const topic = await ctx.db.get(article.topicId);
    if (!topic) return null;
    return verifiedGrowthSupportDeliveryEvidence({
      site,
      action,
      topic,
      article,
      now: timestamp,
    });
  };

  if (action.supportDeliveryReceipt) {
    const current = await validateCandidate(
      await ctx.db.get(action.supportDeliveryReceipt.articleId),
    );
    return current &&
      growthSupportDeliveryReceiptsMatch(
        action.supportDeliveryReceipt,
        current.receipt,
      )
      ? current
      : null;
  }

  if (
    action.status !== "open" ||
    action.stage !== "striking_distance" ||
    action.actionKind !== "strengthen_cluster" ||
    (
      action.automationStatus !== "executed" &&
      action.automationStatus !== SUPPORT_DELIVERY_VERIFIED_STATUS
    ) ||
    action.publishedRevisionId
  ) {
    return null;
  }

  const topics = await ctx.db
    .query("topic_clusters")
    .withIndex("by_site_growth_action_parent", (q) =>
      q
        .eq("siteId", action.siteId)
        .eq("growthActionFingerprint", action.fingerprint)
        .eq("growthParentArticleId", action.articleId)
    )
    .take(MAX_LEGACY_SUPPORT_TOPICS_PER_ACTION + 1);
  if (
    topics.length < 1 ||
    topics.length > MAX_LEGACY_SUPPORT_TOPICS_PER_ACTION
  ) {
    return null;
  }
  const articleGroups = await Promise.all(
    topics.map((topic) =>
      ctx.db
        .query("articles")
        .withIndex("by_topic", (q) => q.eq("topicId", topic._id))
        .take(MAX_LEGACY_SUPPORT_ARTICLES_PER_TOPIC + 1)
    ),
  );
  if (
    articleGroups.some(
      (articles) =>
        articles.length > MAX_LEGACY_SUPPORT_ARTICLES_PER_TOPIC,
    )
  ) {
    return null;
  }
  const records = articleGroups.flatMap((articles, topicIndex) =>
    articles.map((article) => {
      const candidate = verifiedGrowthSupportDeliveryCandidate({
        site,
        action,
        topic: topics[topicIndex]!,
        article,
      });
      return {
        article,
        record: {
          articleId: article._id,
          status: article.status,
          publishedAt: article.publishedAt,
          candidate,
        },
      };
    })
  );
  const selected = selectLegacySupportDeliveryAdoptionCandidate({
    action,
    records: records.map((record) => record.record),
  });
  if (!selected) return null;
  const selectedRecord = records.find(
    ({ record }) =>
      record.candidate?.receipt.articleId === selected.receipt.articleId &&
      growthSupportDeliveryReceiptsMatch(
        record.candidate?.receipt,
        selected.receipt,
      ),
  );
  if (!selectedRecord?.article.topicId) return null;
  const selectedTopic = topics.find(
    (topic) => topic._id === selectedRecord.article.topicId,
  );
  if (!selectedTopic || selectedTopic._id !== selected.topicId) return null;
  const liveEvidence = verifiedGrowthSupportDeliveryEvidence({
    site,
    action,
    topic: selectedTopic,
    article: selectedRecord.article,
    now: timestamp,
  });
  return liveEvidence &&
      growthSupportDeliveryReceiptsMatch(
        liveEvidence.receipt,
        selected.receipt,
      )
    ? liveEvidence
    : null;
}

function sourceReceiptMode(
  site: Doc<"sites">,
  article: Doc<"articles"> | null,
):
  | "current_receipt"
  | "legacy_github_adoption_expected"
  | "legacy_github_adoption_configuration_missing"
  | "unavailable" {
  if (!article || article.siteId !== site._id || article.status !== "published") {
    return "unavailable";
  }
  try {
    const configSealed = Boolean(
      article.publicationConfigHash &&
      article.publicationConfigSnapshot &&
      publicationDeliveryConfigHash(publicationDeliveryConfig(site)) ===
        article.publicationConfigHash &&
      publicationDeliveryConfigHash(
        publicationDeliveryConfig(article.publicationConfigSnapshot!),
      ) === article.publicationConfigHash,
    );
    if (article.publicationReceipt) {
      const receipt = validatePublicationReceipt(article.publicationReceipt);
      const auditVersion =
        article.publicationAuditVersion ?? PUBLICATION_AUDIT_VERSION;
      const expectedStatus = {
        github: "committed",
        wordpress: "published",
        webhook: "accepted",
      } as const;
      return configSealed &&
        Boolean(
          article.publicationDate &&
          article.publishedContentHash &&
          article.publicationDeliveryHash &&
          article.auditedContentHash === article.publishedContentHash &&
          receipt.method === (site.publishMethod ?? "github") &&
          receipt.status === expectedStatus[receipt.method] &&
          receipt.contentHash === article.publishedContentHash &&
          receipt.deliveryKey ===
            publicationDeliveryKey(article.publicationDeliveryHash) &&
          publicationArtifactHashForAuditVersion(article, auditVersion) ===
            article.publishedContentHash,
        )
        ? "current_receipt"
        : "unavailable";
    }
    const legacyGitHubCandidate =
      configSealed &&
      (site.publishMethod ?? "github") === "github" &&
      article.publicationAuditVersion ===
        LEGACY_GITHUB_PUBLICATION_AUDIT_VERSION &&
      Boolean(
        article.publishedContentHash &&
        article.auditedContentHash === article.publishedContentHash &&
        article.publicationDeliveryHash &&
        article.publicationDate &&
        publicationArtifactHashForAuditVersion(
          article,
          LEGACY_GITHUB_PUBLICATION_AUDIT_VERSION,
        ) === article.publishedContentHash,
      );
    if (!legacyGitHubCandidate) return "unavailable";
    return site.githubToken &&
      site.repoOwner &&
      site.repoName &&
      site.repoDefaultBranch
      ? "legacy_github_adoption_expected"
      : "legacy_github_adoption_configuration_missing";
  } catch {
    return "unavailable";
  }
}

function revisionAdapterReadiness(site: Doc<"sites">): {
  method: string;
  supported: boolean;
  configured: boolean;
} {
  const method = site.publishMethod ?? "github";
  if (method === "github") {
    return {
      method,
      supported: true,
      configured: Boolean(
        site.githubToken &&
        site.repoOwner &&
        site.repoName &&
        site.repoDefaultBranch,
      ),
    };
  }
  if (method === "webhook") {
    try {
      const expectedConfigHash = publicationAdapterConfigHash(site);
      return {
        method,
        supported: true,
        configured: Boolean(
          expectedConfigHash &&
          site.publicationAdapterVersion === PUBLICATION_ADAPTER_VERSION &&
          site.publicationAdapterConfigHash === expectedConfigHash &&
          (site.publicationAdapterVerifiedAt ?? 0) > 0,
        ),
      };
    } catch {
      return { method, supported: true, configured: false };
    }
  }
  return { method, supported: false, configured: false };
}

export const getSiteInputs = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    if (!gscConnectionMatchesCurrentDomain(site) || !site.gscProperty) {
      throw new Error("Search Console connection is not current for this site");
    }
    const cutoff = site.gscDataThrough
      ? addSearchConsoleDays(site.gscDataThrough, -89)
      : undefined;
    const receipts = site.gscDateEpochs ?? [];
    const [currentRows, articles, goal] = await Promise.all([
      cutoff && receipts.length > 0
        ? takeCurrentGscPageRows(ctx, site, 5_000, { startDate: cutoff })
        : Promise.resolve({ rows: [], exhausted: false }),
      collectCurrentDomainPublishedSummariesSince(
        ctx,
        site,
        Date.now() - 90 * 24 * 60 * 60 * 1000,
      ),
      ctx.db
        .query("seo_growth_goals")
        .withIndex("by_site", (q) => q.eq("siteId", siteId))
        .unique(),
    ]);
    if (currentRows.exhausted) {
      throw new Error("Current Search Console growth receipt read limit exceeded");
    }
    const rows = currentRows.rows;
    return {
      site: {
        siteId,
        domain: site.domain,
        urlStructure: site.urlStructure,
        canonicalDomain: siteCanonicalDomain(site)!,
        domainRevision: siteCanonicalDomainRevision(site),
        gscConnectionRevision: siteGscConnectionRevision(site),
        gscProperty: site.gscProperty!,
        gscSyncEpoch: site.gscSyncEpoch,
      },
      dataWindowStart: site.gscDataWindowStart,
      dataThrough: site.gscDataThrough,
      dateEpochs: receipts,
      rows,
      articles: articles
        .slice(0, 100)
        // Legacy rows predate public-page verification. New deliveries are not
        // eligible for GSC growth diagnosis until the exact tenant URL is live.
        .filter(
          (article) =>
            article.publicUrlStatus === undefined ||
            article.publicUrlStatus === "verified",
        )
        .map((article) => {
          const inspectionCurrent = gscInspectionMatchesCurrentConnection(
            site,
            article,
          );
          return {
            articleId: article.articleId,
            topicId: article.topicId,
            title: article.title,
            slug: article.slug,
            publishedAt: article.publishedAt ?? article.articleCreatedAt,
            gscIndexVerdict: inspectionCurrent
              ? article.gscIndexVerdict
              : undefined,
            gscCoverageState: inspectionCurrent
              ? article.gscCoverageState
              : undefined,
            gscPageFetchState: inspectionCurrent
              ? article.gscPageFetchState
              : undefined,
            gscRobotsTxtState: inspectionCurrent
              ? article.gscRobotsTxtState
              : undefined,
            gscInspectionError: inspectionCurrent
              ? article.gscInspectionError
              : undefined,
          };
        }),
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
  unattributedClicks: v.number(),
  unattributedImpressions: v.number(),
  queryCoverageComplete: v.boolean(),
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
  if (
    !site ||
    !article ||
    article.siteId !== siteId ||
    !articleMatchesCurrentDomain(site, article) ||
    !article.topicId
  ) {
    return { status: "no_safe_candidate", detail: "The article has no source topic." };
  }
  const sourceTopic = await ctx.db.get(article.topicId);
  if (
    !sourceTopic ||
    sourceTopic.siteId !== siteId ||
    !topicMatchesCurrentDomain(site, sourceTopic)
  ) {
    return { status: "no_safe_candidate", detail: "The source topic is unavailable." };
  }
  const topics = await takeCurrentDomainTopics(ctx, site, 2_000);
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
  const [site, article] = await Promise.all([
    ctx.db.get(siteId),
    ctx.db.get(articleId),
  ]);
  if (
    !site ||
    !article ||
    article.siteId !== siteId ||
    !articleMatchesCurrentDomain(site, article) ||
    !article.topicId
  ) {
    return { status: "no_safe_candidate", detail: "The article has no source topic." };
  }
  const sourceTopic = await ctx.db.get(article.topicId);
  if (
    !sourceTopic ||
    sourceTopic.siteId !== siteId ||
    !topicMatchesCurrentDomain(site, sourceTopic)
  ) {
    return { status: "no_safe_candidate", detail: "The source topic is unavailable." };
  }
  const topics = await takeCurrentDomainTopics(ctx, site, 2_000);
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
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedGscConnectionRevision: v.number(),
    expectedGscProperty: v.string(),
    expectedGscSyncEpoch: v.optional(v.string()),
    expectedGscDataThrough: v.optional(v.string()),
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
  handler: async (ctx, {
    siteId,
    expectedCanonicalDomain,
    expectedDomainRevision,
    expectedGscConnectionRevision,
    expectedGscProperty,
    expectedGscSyncEpoch,
    expectedGscDataThrough,
    classifications,
    health,
  }) => {
    const currentSite = await ctx.db.get(siteId);
    if (!currentSite || !(await siteExecutionAuthorized(ctx, currentSite))) {
      throw new Error("Site not found");
    }
    if (
      !gscConnectionMatchesCurrentDomain(currentSite) ||
      normalizeCanonicalDomain(expectedCanonicalDomain) !==
        siteCanonicalDomain(currentSite) ||
      expectedDomainRevision !== siteCanonicalDomainRevision(currentSite) ||
      expectedGscConnectionRevision !==
        siteGscConnectionRevision(currentSite) ||
      expectedGscProperty !== currentSite.gscProperty ||
      expectedGscSyncEpoch !== currentSite.gscSyncEpoch ||
      expectedGscDataThrough !== currentSite.gscDataThrough
    ) {
      throw new Error("Growth scan belongs to an earlier measurement epoch");
    }
    const actuationEligible = isSeoGrowthActuationEligible(currentSite);
    const now = Date.now();
    const measurementKey = [
      siteCanonicalDomain(currentSite),
      siteCanonicalDomainRevision(currentSite),
      siteGscConnectionRevision(currentSite),
      currentSite.gscProperty,
      currentSite.gscSyncEpoch ?? "",
      currentSite.gscDataThrough ?? "",
      now,
    ].join(":");
    let openActions = 0;
    const replenishmentRequests: Array<{
      articleId: Id<"articles">;
      fingerprint: string;
      measurementKey: string;
      growthSeed: string;
      priority: number;
    }> = [];
    const discoveryRepairRequests: Array<{
      fingerprint: string;
      measurementKey: string;
      priority: number;
    }> = [];
    const authorityRequests: Array<{
      articleId: Id<"articles">;
      fingerprint: string;
      measurementKey: string;
      priority: number;
    }> = [];
    const revisionRequests: Array<{
      articleId: Id<"articles">;
      fingerprint: string;
      measurementKey: string;
      actionKind: "improve_snippet" | "strengthen_cluster";
      priority: number;
    }> = [];
    for (const classification of classifications) {
      const article = await ctx.db.get(classification.articleId);
      if (
        !article ||
        article.siteId !== siteId ||
        !articleMatchesCurrentDomain(currentSite, article) ||
        article.status !== "published"
      ) {
        throw new Error("Growth classification crossed a tenant or publication boundary");
      }
      const fingerprint = growthActionFingerprint(
        siteId,
        classification,
        `${siteCanonicalDomainRevision(currentSite)}:${siteGscConnectionRevision(currentSite)}`,
      );
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
          if (
            prior.fingerprint !== fingerprint &&
            !(await actionHasUnresolvedRevisionDelivery(ctx, prior))
          ) {
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
      const parsedNextReviewAt = classification.nextReviewDate
        ? Date.parse(`${classification.nextReviewDate}T12:00:00.000Z`)
        : undefined;
      // A provider observation window can lag its calendar cohort. Once the
      // nominal date has elapsed, persist the next bounded daily recovery
      // wake instead of leaving a permanently overdue action that is retried
      // by every fleet pass.
      const nextReviewAt = parsedNextReviewAt === undefined
        ? undefined
        : parsedNextReviewAt > now
          ? parsedNextReviewAt
          : now + GROWTH_REVIEW_RECOVERY_DELAY_MS;
      if (existing) {
        // A newer measurement may inform future work, but it cannot rewrite
        // the immutable authorization attempt while an external revision CAS
        // might already have landed. Recovery settles that exact revision and
        // classifies superseded measurement without counting execution.
        if (await actionHasUnresolvedRevisionDelivery(ctx, existing)) {
          continue;
        }
        let automation: GrowthAutomationResult | undefined;
        let supportDeliveryPatch:
          | {
              supportDeliveryReceipt: GrowthSupportDeliveryReceipt<
                Id<"articles">
              >;
              supportDeliveryRecordedAt: number;
            }
          | undefined;
        if (
          actuationEligible &&
          desiredStatus === "open" &&
          (classification.actionKind === "improve_snippet" ||
            classification.actionKind === "strengthen_cluster")
        ) {
          const revisionHistory = await actionRevisionHistory(ctx, existing);
          let revisionEligible =
            !revisionHistory.terminalRevisionStatus &&
            !revisionHistory.revisionBindingInvalid &&
            RETRYABLE_REVISION_AUTOMATION.has(
              existing.automationStatus ?? "no_safe_candidate",
            );
          if (
            existing.automationStatus === "executed" ||
            existing.automationStatus === SUPPORT_DELIVERY_VERIFIED_STATUS
          ) {
            const supportDelivery = await verifiedSupportDeliveryForAction(
              ctx,
              currentSite,
              existing,
              now,
            );
            const admission = legacyExecutedSupportRevisionAdmission({
              action: existing,
              verifiedSupportDelivery: Boolean(supportDelivery),
              terminalRevisionStatus:
                revisionHistory.terminalRevisionStatus,
              anyRevisionExists:
                revisionHistory.anyRevisionExists ||
                revisionHistory.revisionBindingInvalid,
            });
            revisionEligible = admission.allowed;
            if (
              admission.allowed &&
              supportDelivery &&
              !existing.supportDeliveryReceipt
            ) {
              supportDeliveryPatch = {
                supportDeliveryReceipt: supportDelivery.receipt,
                supportDeliveryRecordedAt: now,
              };
            }
          }
          if (revisionEligible) {
            revisionRequests.push({
              articleId: classification.articleId,
              fingerprint,
              measurementKey,
              actionKind: classification.actionKind,
              priority: classification.priority,
            });
            automation = {
              status: "awaiting_published_revision",
              detail:
                "Pentra will attempt one deterministic immutable revision, then require exact external CAS and live URL receipts.",
            };
          }
        }
        if (
          actuationEligible &&
          desiredStatus === "open" &&
          classification.actionKind === "repair_discovery" &&
          !existing.discoveryRepairVerifiedAt
        ) {
          discoveryRepairRequests.push({
            fingerprint,
            measurementKey,
            priority: classification.priority,
          });
        }
        if (
          actuationEligible &&
          desiredStatus === "open" &&
          classification.actionKind === "build_authority" &&
          (
            !existing.authorityDiscoveryAttemptedAt ||
            existing.authorityDiscoveryAttemptedAt <= now - 7 * 24 * 60 * 60 * 1000
          )
        ) {
          authorityRequests.push({
            articleId: classification.articleId,
            fingerprint,
            measurementKey,
            priority: classification.priority,
          });
        }
        if (
          actuationEligible &&
          desiredStatus === "open" &&
          classification.actionKind === "repair_discovery" &&
          existing.discoveryRepairVerifiedAt !== undefined &&
          existing.discoveryRepairVerifiedAt <= now - 7 * 24 * 60 * 60 * 1000 &&
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
              measurementKey,
              growthSeed: automation.growthSeed,
              priority: classification.priority,
            });
          }
        }
        if (
          actuationEligible &&
          desiredStatus === "open" &&
          classification.actionKind === "reassess_opportunity" &&
          RETRYABLE_SUPPORT_AUTOMATION.has(
            existing.automationStatus ?? "no_safe_candidate",
          )
        ) {
          automation = await deprioritizeFailedOpportunityCluster(
            ctx,
            siteId,
            classification.articleId,
          );
        }
        await ctx.db.patch(existing._id, {
          measurementKey,
          measurementCanonicalDomain: siteCanonicalDomain(currentSite)!,
          measurementDomainRevision: siteCanonicalDomainRevision(currentSite),
          measurementGscConnectionRevision:
            siteGscConnectionRevision(currentSite),
          measurementGscProperty: currentSite.gscProperty!,
          measurementGscSyncEpoch: currentSite.gscSyncEpoch,
          measurementGscDataThrough: currentSite.gscDataThrough,
          status: desiredStatus,
          priority: classification.priority,
          reason: classification.reason,
          indexState: classification.indexState,
          evidence: classification.evidence,
          lastObservedAt: now,
          nextReviewAt,
          resolvedAt: undefined,
          resolution: undefined,
          ...(supportDeliveryPatch ?? {}),
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
        if (!actuationEligible && desiredStatus === "open") {
          automation = MEASUREMENT_ONLY_AUTOMATION;
        } else if (classification.actionKind === "repair_discovery") {
          automation = {
            status: "awaiting_discovery_repair",
            detail:
              "Pentra will resubmit and verify the tenant sitemap in Search Console before producing more support content.",
          };
          discoveryRepairRequests.push({
            fingerprint,
            measurementKey,
            priority: classification.priority,
          });
        } else if (classification.actionKind === "build_authority") {
          automation = {
            status: "awaiting_authority_discovery",
            detail:
              "Pentra will inspect evidence-backed authority opportunities for this exact page before preparing any outreach.",
          };
          authorityRequests.push({
            articleId: classification.articleId,
            fingerprint,
            measurementKey,
            priority: classification.priority,
          });
        } else if (
          classification.actionKind === "strengthen_cluster" ||
          classification.actionKind === "improve_snippet"
        ) {
          automation = {
            status: "awaiting_published_revision",
            detail:
              "Pentra will attempt one deterministic immutable revision, then require exact external CAS and live URL receipts.",
          };
          revisionRequests.push({
            articleId: classification.articleId,
            fingerprint,
            measurementKey,
            actionKind: classification.actionKind,
            priority: classification.priority,
          });
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
            measurementKey,
            growthSeed: automation.growthSeed,
            priority: classification.priority,
          });
        }
        await ctx.db.insert("seo_growth_actions", {
          siteId,
          articleId: classification.articleId,
          fingerprint,
          measurementKey,
          measurementCanonicalDomain: siteCanonicalDomain(currentSite)!,
          measurementDomainRevision: siteCanonicalDomainRevision(currentSite),
          measurementGscConnectionRevision:
            siteGscConnectionRevision(currentSite),
          measurementGscProperty: currentSite.gscProperty!,
          measurementGscSyncEpoch: currentSite.gscSyncEpoch,
          measurementGscDataThrough: currentSite.gscDataThrough,
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
        if (
          !activeArticleIds.has(String(action.articleId)) &&
          !(await actionHasUnresolvedRevisionDelivery(ctx, action))
        ) {
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
      discoveryRepairRequests,
      authorityRequests,
      revisionRequests,
    };
  },
});

export const recordAuthorityDiscovery = internalMutation({
  args: {
    siteId: v.id("sites"),
    fingerprint: v.string(),
    measurementKey: v.string(),
    status: v.string(),
    detail: v.string(),
    attemptedAt: v.number(),
    verifiedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const [site, action] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
        .unique(),
    ]);
    if (
      !site ||
      !action ||
      action.siteId !== args.siteId ||
      action.status !== "open" ||
      action.actionKind !== "build_authority" ||
      !growthMeasurementMatchesCurrentSite(site, action, args.measurementKey)
    ) {
      throw new Error("Authority discovery does not match an open tenant action");
    }
    await ctx.db.patch(action._id, {
      authorityDiscoveryAttemptedAt: args.attemptedAt,
      authorityDiscoveryVerifiedAt: args.verifiedAt,
      authorityDiscoveryDetail: args.detail,
      automationStatus: args.status,
      automationDetail: args.detail,
      automatedAt: args.status === "authority_outreach_prepared" ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});

export const recordDiscoveryRepair = internalMutation({
  args: {
    siteId: v.id("sites"),
    fingerprint: v.string(),
    measurementKey: v.string(),
    status: v.string(),
    detail: v.string(),
    attemptedAt: v.number(),
    verifiedAt: v.optional(v.number()),
    sitemapUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [site, action] = await Promise.all([
      ctx.db.get(args.siteId),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_fingerprint", (q) => q.eq("fingerprint", args.fingerprint))
        .unique(),
    ]);
    if (
      !site ||
      !action ||
      action.siteId !== args.siteId ||
      action.status !== "open" ||
      action.actionKind !== "repair_discovery" ||
      !growthMeasurementMatchesCurrentSite(site, action, args.measurementKey)
    ) {
      throw new Error("Discovery repair does not match an open tenant action");
    }
    const preserveCompletedSupport = action.automationStatus === "executed";
    await ctx.db.patch(action._id, {
      discoveryRepairAttemptedAt: args.attemptedAt,
      discoveryRepairVerifiedAt: args.verifiedAt,
      discoveryRepairSitemapUrl: args.sitemapUrl,
      discoveryRepairDetail: args.detail,
      ...(preserveCompletedSupport
        ? {}
        : {
            automationStatus: args.status,
            automationDetail: args.detail,
          }),
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});

export const recordAutomationResult = internalMutation({
  args: {
    siteId: v.id("sites"),
    fingerprint: v.string(),
    measurementKey: v.string(),
    status: v.string(),
    detail: v.string(),
  },
  handler: async (
    ctx,
    { siteId, fingerprint, measurementKey, status, detail },
  ) => {
    const [site, action] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
        .unique(),
    ]);
    if (
      !site ||
      !action ||
      action.siteId !== siteId ||
      action.status !== "open" ||
      !growthMeasurementMatchesCurrentSite(site, action, measurementKey)
    ) {
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
    const revisionHistory = await actionRevisionHistory(ctx, action);
    let supportDeliveryPatch:
      | {
          supportDeliveryReceipt: GrowthSupportDeliveryReceipt<
            Id<"articles">
          >;
          supportDeliveryRecordedAt: number;
        }
      | undefined;
    let effectiveStatus = status;
    const preserveRevisionLifecycle =
      Boolean(action.publishedRevisionId) ||
      revisionHistory.anyRevisionExists ||
      revisionHistory.revisionBindingInvalid;
    if (status === "executed") {
      const site = await ctx.db.get(article.siteId);
      const supportDelivery = site
        ? verifiedGrowthSupportDelivery({ site, action, topic, article })
        : null;
      if (!supportDelivery) {
        return { updated: false, reason: "support_delivery_unverified" };
      }
      if (
        action.supportDeliveryReceipt &&
        !growthSupportDeliveryReceiptsMatch(
          action.supportDeliveryReceipt,
          supportDelivery,
        )
      ) {
        return { updated: false, reason: "support_delivery_receipt_conflict" };
      }
      if (!action.supportDeliveryReceipt) {
        supportDeliveryPatch = {
          supportDeliveryReceipt: supportDelivery,
          supportDeliveryRecordedAt: timestamp,
        };
      }
      if (
        !preserveRevisionLifecycle &&
        action.stage === "striking_distance" &&
        action.actionKind === "strengthen_cluster"
      ) {
        effectiveStatus = SUPPORT_DELIVERY_VERIFIED_STATUS;
      }
    }
    await ctx.db.patch(action._id, {
      ...(supportDeliveryPatch ?? {}),
      ...(preserveRevisionLifecycle
        ? {}
        : {
            automationStatus: effectiveStatus,
            automationDetail: effectiveStatus ===
                SUPPORT_DELIVERY_VERIFIED_STATUS
              ? "The support article has an exact external publication receipt; the still-open striking-distance page is eligible for one immutable revision assessment."
              : detail,
            automatedAt: effectiveStatus === "executed" ? timestamp : undefined,
          }),
      updatedAt: timestamp,
    });
    return { updated: true };
  },
});

/**
 * Credential-free operator projection for the immutable revision actuator.
 * It exposes phase/cap/fence outcomes only; publication credentials, receipt
 * hashes, external ids, article bodies, and destination configuration stay in
 * their tenant rows.
 */
export const getPublishedRevisionReadinessInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    articleId: v.optional(v.id("articles")),
  },
  handler: async (ctx, { siteId, articleId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return null;
    const timestamp = Date.now();
    const [executionAuthorized, actions, recentRevisions] = await Promise.all([
      siteExecutionAuthorized(ctx, site),
      ctx.db
        .query("seo_growth_actions")
        .withIndex("by_site_status", (q) =>
          q.eq("siteId", siteId).eq("status", "open")
        )
        .take(100),
      ctx.db
        .query("published_article_revisions")
        .withIndex("by_site_created", (q) =>
          q.eq("siteId", siteId).gte("createdAt", timestamp - 24 * 60 * 60 * 1000)
        )
        .order("asc")
        .take(MAX_PUBLISHED_REVISIONS_PER_TENANT_24H + 1),
    ]);
    const tenantCapActive =
      recentRevisions.length >= MAX_PUBLISHED_REVISIONS_PER_TENANT_24H;
    const tenantCapNextEligibleAt = tenantCapActive
      ? recentRevisions[0]!.createdAt + 24 * 60 * 60 * 1000
      : undefined;
    const revisionAdapter = revisionAdapterReadiness(site);
    const candidates = actions.filter((action) =>
      growthMeasurementMatchesCurrentSite(site, action) &&
      (!articleId || action.articleId === articleId) &&
      (action.actionKind === "strengthen_cluster" ||
        action.actionKind === "improve_snippet")
    );
    const rows = [];
    for (const action of candidates) {
      const [supportDelivery, revisionHistory, sourceArticle] =
        await Promise.all([
          action.actionKind === "strengthen_cluster"
            ? verifiedSupportDeliveryForAction(ctx, site, action, timestamp)
            : Promise.resolve(null),
          actionRevisionHistory(ctx, action),
          ctx.db.get(action.articleId),
        ]);
      const legacySupportAdmission = legacyExecutedSupportRevisionAdmission({
        action,
        verifiedSupportDelivery: Boolean(supportDelivery),
        terminalRevisionStatus: revisionHistory.terminalRevisionStatus,
        anyRevisionExists:
          revisionHistory.anyRevisionExists ||
          revisionHistory.revisionBindingInvalid,
      });
      const supportPhase =
        action.automationStatus === "executed" ||
        action.automationStatus === SUPPORT_DELIVERY_VERIFIED_STATUS;
      const ordinaryRetry = RETRYABLE_REVISION_AUTOMATION.has(
        action.automationStatus ?? "no_safe_candidate",
      );
      const capBlocksNewRevision =
        tenantCapActive && !revisionHistory.anyRevisionExists;
      const receiptMode = sourceReceiptMode(site, sourceArticle);
      const sourceReceiptUnavailable =
        !revisionHistory.anyRevisionExists &&
        receiptMode !== "current_receipt" &&
        receiptMode !== "legacy_github_adoption_expected";
      let reason = "automation_phase_not_retryable";
      if (!executionAuthorized) reason = "execution_unauthorized";
      else if (!isSeoGrowthActuationEligible(site)) reason = "rollout_ineligible";
      else if (!revisionAdapter.supported) reason = "revision_adapter_unsupported";
      else if (!revisionAdapter.configured) {
        reason = "revision_adapter_configuration_missing";
      }
      else if (revisionHistory.revisionBindingInvalid) {
        reason = "revision_binding_invalid";
      } else if (revisionHistory.terminalRevisionStatus) {
        reason = "terminal_revision_exists";
      } else if (capBlocksNewRevision) reason = "tenant_revision_cap";
      else if (sourceReceiptUnavailable) {
        reason = receiptMode === "legacy_github_adoption_configuration_missing"
          ? "legacy_adoption_configuration_missing"
          : "source_receipt_unavailable";
      } else if (supportPhase) reason = legacySupportAdmission.reason;
      else if (ordinaryRetry) reason = "revision_phase_ready";
      const ready =
        executionAuthorized &&
        isSeoGrowthActuationEligible(site) &&
        revisionAdapter.supported &&
        revisionAdapter.configured &&
        !revisionHistory.revisionBindingInvalid &&
        !revisionHistory.terminalRevisionStatus &&
        !capBlocksNewRevision &&
        !sourceReceiptUnavailable &&
        (supportPhase ? legacySupportAdmission.allowed : ordinaryRetry);
      rows.push({
        articleId: action.articleId,
        fingerprint: action.fingerprint,
        stage: action.stage,
        actionKind: action.actionKind,
        automationStatus: action.automationStatus,
        ready,
        reason: ready ? "eligible" : reason,
        supportDelivery: {
          recorded: Boolean(action.supportDeliveryReceipt),
          verified: Boolean(supportDelivery),
          recordedAt: action.supportDeliveryRecordedAt,
          legacyExecutedPhase: action.automationStatus === "executed",
          sourceArticleId: supportDelivery?.receipt.articleId,
          sourceTopicId: supportDelivery?.topicId,
          currentPublicUrl: supportDelivery?.targetUrl,
          publicUrlVerifiedAt: supportDelivery?.publicUrlVerifiedAt,
          adoptionMode: action.supportDeliveryReceipt
            ? "recorded_receipt"
            : supportDelivery
              ? "bounded_first_receipt_adoption"
              : undefined,
        },
        revision: {
          bound: Boolean(action.publishedRevisionId),
          boundMissing: revisionHistory.boundRevisionMissing,
          bindingValid: !revisionHistory.revisionBindingInvalid,
          anyExists: revisionHistory.anyRevisionExists,
          latestStatus: revisionHistory.latestStatus,
          terminalStatus: revisionHistory.terminalRevisionStatus,
        },
        sourceReceiptMode: receiptMode,
      });
    }
    return {
      siteId,
      rolloutMode: site.autopilotRolloutMode ?? "observe",
      executionAuthorized,
      revisionAdapter,
      tenantRevisionCap: {
        active: tenantCapActive,
        recentCount: recentRevisions.length,
        nextEligibleAt: tenantCapNextEligibleAt,
      },
      candidates: rows,
    };
  },
});

export const getSummary = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
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
      actions: [...open, ...monitoring].filter((action) =>
        growthMeasurementMatchesCurrentSite(site, action)
      ),
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
    // Keep the legacy site mirror synchronized during the migration. The
    // canonical source read by growth health and portfolio audits remains the
    // seo_growth_goals row.
    await ctx.db.patch(args.siteId, {
      organicClickGoalMonthly: monthlyOrganicClicksGoal,
      updatedAt: timestamp,
    });
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
      actions: [
        ...open.filter((action) =>
          growthMeasurementMatchesCurrentSite(site, action)
        ),
        ...monitoring.filter((action) =>
          growthMeasurementMatchesCurrentSite(site, action)
        ),
        ...resolved,
      ].map((action) => ({
        articleId: action.articleId,
        stage: action.stage,
        actionKind: action.actionKind,
        status: action.status,
        priority: action.priority,
        reason: action.reason,
        automationStatus: action.automationStatus,
        automationDetail: action.automationDetail,
        discoveryRepairAttemptedAt: action.discoveryRepairAttemptedAt,
        discoveryRepairVerifiedAt: action.discoveryRepairVerifiedAt,
        discoveryRepairSitemapUrl: action.discoveryRepairSitemapUrl,
        discoveryRepairDetail: action.discoveryRepairDetail,
        evidence: action.evidence,
        firstObservedAt: action.firstObservedAt,
        lastObservedAt: action.lastObservedAt,
        resolvedAt: action.resolvedAt,
      })),
    };
  },
});
