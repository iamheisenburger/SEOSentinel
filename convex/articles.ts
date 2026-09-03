import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  PUBLICATION_AUDIT_VERSION,
  assertSupportedPublicationAdapterVersion,
  assertSupportedPublicationRendererVersion,
  publicationAdapterConfigHashForVersion,
  publicationArtifactHash,
  publicationArtifactHashForAuditVersion,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
  publicationDeliveryDestinationHash,
  publicationDeliveryEnvelopeHash,
  publicationDeliveryKey,
} from "./lib/publicationArtifact";
import { validatePublicationReceipt } from "./lib/publicationReceipts";
import {
  acquirePublicationLease,
  ownsPublicationLease,
  PUBLICATION_LEASE_MS,
  reviewedAmbiguityDispositionAllowed,
} from "./lib/publicationLease";
import {
  DETERMINISTIC_INTERNAL_LINK_REPAIR_VERSION,
  effectivePublishedAt,
  evaluateTopicBusinessFit,
  migrationBlocksAutopilot,
  needsDeterministicInternalLinkRepair,
  needsPublicationAuditRefresh,
  tenantTopicBusinessSignals,
  terminalTopicFitSettlement,
} from "./lib/autopilotBuffer";
import {
  PUBLICATION_ADAPTER_VERSION,
  PUBLISHER_RENDERER_VERSION,
} from "./lib/publicationReceipts";
import {
  clampMetaDescription,
  evaluatePublicationQuality,
  repairDanglingStructuredIntroductions,
} from "./lib/articleQuality";
import {
  MAX_QUALITY_REVISIONS,
  needsDeterministicMechanicalRepair,
} from "./lib/autopilotCadence";
import {
  publishedArticlePublicUrl,
  selectVerifiedAuthorityTargets,
} from "./lib/publicationLive";
import { reconcileTopicLifecycle } from "./lib/topicLifecycleDb";
import {
  recoveredTopicQualitySettlement,
  terminalTopicQualitySettlement,
} from "./lib/topicLifecycle";
import { jobAuthorizedForExecution } from "./lib/jobRollout";
import {
  executionLeasePredatesPlanTransition,
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import {
  growthSupportDeliveryReceiptsMatch,
  SUPPORT_DELIVERY_VERIFIED_STATUS,
} from "./lib/growthSupportDelivery";
import {
  articleMatchesCurrentDomain,
  pageMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteUsesLegacyDomainReceipts,
  takeCurrentDomainArticles,
  takeCurrentDomainArticleSummariesByStatus,
  topicMatchesCurrentDomain,
} from "./lib/siteDomainBinding";
import { PUBLISHED_REVISION_LEASE_MS } from "./lib/publishedRevision";
import {
  appendRelatedInternalLinks,
  publishedArticleInternalHref,
  selectRelatedInternalLinks,
  validateInternalLinkSuggestions,
} from "./lib/internalLinks";

const now = () => Date.now();
const PUBLICATION_INTEGRITY_MIGRATION_KEY = "publication-integrity-v4";
const REVIEWED_AMBIGUITY_CONFIRMATION =
  "ABANDON UNVERIFIED DELIVERY AND RETAIN AUDIT";
type ArticleSummaryFields = Omit<Doc<"article_summaries">, "_id" | "_creationTime">;

function summaryFields(article: Doc<"articles">): ArticleSummaryFields {
  return {
    articleId: article._id,
    siteId: article.siteId,
    canonicalDomain: article.canonicalDomain,
    domainRevision: article.domainRevision,
    topicId: article.topicId,
    articleType: article.articleType,
    status: article.status,
    title: article.title,
    slug: article.slug,
    metaTitle: article.metaTitle,
    metaDescription: article.metaDescription,
    metaKeywords: article.metaKeywords,
    language: article.language,
    featuredImage: article.featuredImage,
    readingTime: article.readingTime,
    wordCount: article.wordCount,
    factCheckScore: article.factCheckScore,
    contentScore: article.contentScore,
    editorialQualityScore: article.editorialQualityScore,
    editorialQualityNotes: article.editorialQualityNotes,
    mediaQualityStatus: article.mediaQualityStatus,
    mediaQualityNotes: article.mediaQualityNotes,
    productEvidenceStatus: article.productEvidenceStatus,
    claimEvidenceStatus: article.claimEvidenceStatus,
    publicationGateStatus: article.publicationGateStatus,
    publicationGateIssues: article.publicationGateIssues,
    publicationGateWarnings: article.publicationGateWarnings,
    publicationCheckedAt: article.publicationCheckedAt,
    publicationAuditVersion: article.publicationAuditVersion,
    publicationConfigHash: article.publicationConfigHash,
    auditedContentHash: article.auditedContentHash,
    auditedAt: article.auditedAt,
    publishedContentHash: article.publishedContentHash,
    publishedAt: article.publishedAt,
    publicUrl: article.publicUrl,
    publicUrlStatus: article.publicUrlStatus,
    publicUrlLastCheckedAt: article.publicUrlLastCheckedAt,
    publicUrlVerifiedAt: article.publicUrlVerifiedAt,
    publicUrlCheckAttempts: article.publicUrlCheckAttempts,
    publicUrlCheckError: article.publicUrlCheckError,
    gscIndexVerdict: article.gscIndexVerdict,
    gscCoverageState: article.gscCoverageState,
    gscPageFetchState: article.gscPageFetchState,
    gscRobotsTxtState: article.gscRobotsTxtState,
    gscLastCrawlTime: article.gscLastCrawlTime,
    gscInspectedAt: article.gscInspectedAt,
    gscInspectionError: article.gscInspectionError,
    gscInspectionConnectionRevision:
      article.gscInspectionConnectionRevision,
    gscInspectionProperty: article.gscInspectionProperty,
    publicationAttemptedAt: article.publicationAttemptedAt,
    publicationOutcomeUnverifiedAt: article.publicationOutcomeUnverifiedAt,
    publicationAmbiguityDispositionAt:
      article.publicationAmbiguityDispositionAt,
    publicationAmbiguityDispositionDetail:
      article.publicationAmbiguityDispositionDetail,
    qualityRevisionCount: article.qualityRevisionCount,
    qualityRecoveryVersion: article.qualityRecoveryVersion,
    qualityRecoveryAttemptVersion: article.qualityRecoveryAttemptVersion,
    deterministicInternalLinkRepairVersion:
      article.deterministicInternalLinkRepairVersion,
    entityCoverage: article.entityCoverage,
    topicCompleteness: article.topicCompleteness,
    serpDifficulty: article.serpDifficulty,
    decayStatus: article.decayStatus,
    decayDetectedAt: article.decayDetectedAt,
    decayReason: article.decayReason,
    lastRefreshedAt: article.lastRefreshedAt,
    refreshCount: article.refreshCount,
    articleCreatedAt: article.createdAt,
    articleUpdatedAt: article.updatedAt,
  };
}

function assertNotPublishing(article: Doc<"articles">) {
  if (
    article.publicationLeaseOwner ||
    article.publicationLeaseHash ||
    article.publicationAmbiguityDispositionAt
  ) {
    throw new Error(
      "Article publication is in progress or retains a reviewed external ambiguity; content, workflow, and deletion are locked",
    );
  }
}

async function settleRecoveredTopicQuality(
  ctx: MutationCtx,
  article: Doc<"articles">,
): Promise<boolean> {
  if (article.topicId) {
    const topic = await ctx.db.get(article.topicId);
    const recovery = recoveredTopicQualitySettlement({
      article: {
        siteId: String(article.siteId),
        topicId: String(article.topicId),
        publicationGateStatus: article.publicationGateStatus,
        publicationAuditVersion: article.publicationAuditVersion,
        auditedContentHash: article.auditedContentHash,
      },
      topic: topic
        ? {
            _id: String(topic._id),
            siteId: String(topic.siteId),
            status: topic.status,
            businessFitEligible: topic.businessFitEligible,
            contentFeasibilityStatus: topic.contentFeasibilityStatus,
            contentFeasibilityVersion: topic.contentFeasibilityVersion,
            disqualifiedReason: topic.disqualifiedReason,
            planCheckpointTerminalFailureCode:
              topic.planCheckpointTerminalFailureCode,
          }
        : null,
      recoveredAt: now(),
    });
    if (recovery && topic) {
      await ctx.db.patch(topic._id, recovery.topicPatch);
      return true;
    }
  }
  return false;
}

async function syncSummary(ctx: MutationCtx, articleId: Doc<"articles">["_id"]) {
  const article = await ctx.db.get(articleId);
  if (!article) return;

  await settleRecoveredTopicQuality(ctx, article);

  const existing = await ctx.db
    .query("article_summaries")
    .withIndex("by_article", (q) => q.eq("articleId", articleId))
    .first();
  const fields = summaryFields(article);

  if (existing) {
    await ctx.db.patch(existing._id, fields);
  } else {
    await ctx.db.insert("article_summaries", fields);
  }
  if (article.topicId) {
    await reconcileTopicLifecycle(ctx, {
      siteId: article.siteId,
      topicId: article.topicId,
    });
  }
}

/**
 * Provider-free natural-cadence migration for artifacts sealed before the
 * recovered-topic settlement existed. New seals repair atomically through
 * syncSummary; this bounded scan converges historical current-domain rows for
 * every tenant without inspecting or modifying another tenant.
 */
export const settleRecoveredTopicQualityForSiteInternal = internalMutation({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.db.get(siteId);
    if (!site) return { inspected: 0, settled: 0 };
    const [ready, published] = await Promise.all([
      takeCurrentDomainArticleSummariesByStatus(ctx, site, "ready", 25),
      takeCurrentDomainArticleSummariesByStatus(ctx, site, "published", 25),
    ]);
    let inspected = 0;
    let settled = 0;
    for (const summary of [...ready, ...published]) {
      const article = await ctx.db.get(summary.articleId);
      if (
        !article ||
        article.siteId !== siteId ||
        !articleMatchesCurrentDomain(site, article)
      ) continue;
      inspected += 1;
      if (await settleRecoveredTopicQuality(ctx, article)) {
        settled += 1;
        if (article.topicId) {
          await reconcileTopicLifecycle(ctx, {
            siteId,
            topicId: article.topicId,
          });
        }
      }
    }
    return { inspected, settled };
  },
});

async function requireArticleOwner(
  ctx: MutationCtx | QueryCtx,
  article: Doc<"articles">,
) {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(article.siteId);
  if (!identity || !site?.userId || identity.subject !== site.userId) {
    throw new Error("Not authorized to modify this article");
  }
}

async function requireSiteOwner(
  ctx: MutationCtx | QueryCtx,
  siteId: Doc<"sites">["_id"],
) {
  const identity = await ctx.auth.getUserIdentity();
  const site = await ctx.db.get(siteId);
  if (!identity || !site?.userId || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site");
  }
  return site;
}

function summaryListItem(summary: ArticleSummaryFields) {
  return {
    _id: summary.articleId,
    _creationTime: summary.articleCreatedAt,
    siteId: summary.siteId,
    canonicalDomain: summary.canonicalDomain,
    domainRevision: summary.domainRevision,
    topicId: summary.topicId,
    articleType: summary.articleType,
    status: summary.status,
    title: summary.title,
    slug: summary.slug,
    // Compatibility field for older clients. List views must use wordCount;
    // full markdown is available only through articles.get.
    markdown: "",
    metaTitle: summary.metaTitle,
    metaDescription: summary.metaDescription,
    metaKeywords: summary.metaKeywords,
    language: summary.language,
    featuredImage: summary.featuredImage,
    readingTime: summary.readingTime,
    wordCount: summary.wordCount,
    factCheckScore: summary.factCheckScore,
    contentScore: summary.contentScore,
    editorialQualityScore: summary.editorialQualityScore,
    editorialQualityNotes: summary.editorialQualityNotes,
    mediaQualityStatus: summary.mediaQualityStatus,
    mediaQualityNotes: summary.mediaQualityNotes,
    productEvidenceStatus: summary.productEvidenceStatus,
    claimEvidenceStatus: summary.claimEvidenceStatus,
    publicationGateStatus: summary.publicationGateStatus,
    publicationGateIssues: summary.publicationGateIssues,
    publicationGateWarnings: summary.publicationGateWarnings,
    publicationCheckedAt: summary.publicationCheckedAt,
    publicationAuditVersion: summary.publicationAuditVersion,
    publicationConfigHash: summary.publicationConfigHash,
    auditedContentHash: summary.auditedContentHash,
    auditedAt: summary.auditedAt,
    publishedContentHash: summary.publishedContentHash,
    publishedAt: summary.publishedAt,
    publicUrl: summary.publicUrl,
    publicUrlStatus: summary.publicUrlStatus,
    publicUrlLastCheckedAt: summary.publicUrlLastCheckedAt,
    publicUrlVerifiedAt: summary.publicUrlVerifiedAt,
    publicUrlCheckAttempts: summary.publicUrlCheckAttempts,
    publicUrlCheckError: summary.publicUrlCheckError,
    publicationAttemptedAt: summary.publicationAttemptedAt,
    publicationOutcomeUnverifiedAt: summary.publicationOutcomeUnverifiedAt,
    publicationAmbiguityDispositionAt:
      summary.publicationAmbiguityDispositionAt,
    publicationAmbiguityDispositionDetail:
      summary.publicationAmbiguityDispositionDetail,
    qualityRevisionCount: summary.qualityRevisionCount,
    qualityRecoveryVersion: summary.qualityRecoveryVersion,
    qualityRecoveryAttemptVersion: summary.qualityRecoveryAttemptVersion,
    entityCoverage: summary.entityCoverage,
    topicCompleteness: summary.topicCompleteness,
    serpDifficulty: summary.serpDifficulty,
    decayStatus: summary.decayStatus,
    decayDetectedAt: summary.decayDetectedAt,
    decayReason: summary.decayReason,
    lastRefreshedAt: summary.lastRefreshedAt,
    refreshCount: summary.refreshCount,
    createdAt: summary.articleCreatedAt,
    updatedAt: summary.articleUpdatedAt,
  };
}

async function listCurrentArticleSummaries(
  ctx: QueryCtx,
  site: Doc<"sites">,
) {
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_created", (q) => q.eq("siteId", site._id))
      .order("desc")
      .collect();
    return legacyEpoch.filter((article) =>
      articleMatchesCurrentDomain(site, article)
    );
  }
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return [];
  return ctx.db
    .query("article_summaries")
    .withIndex("by_site_domain_revision_created", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", siteCanonicalDomainRevision(site))
    )
    .order("desc")
    .collect();
}

async function listCurrentArticles(
  ctx: QueryCtx,
  site: Doc<"sites">,
) {
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .order("desc")
      .collect();
    return legacyEpoch.filter((article) =>
      articleMatchesCurrentDomain(site, article)
    );
  }
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return [];
  return ctx.db
    .query("articles")
    .withIndex("by_site_domain_revision", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", siteCanonicalDomainRevision(site))
    )
    .order("desc")
    .collect();
}

async function takeCurrentSummariesByStatus(
  ctx: QueryCtx,
  site: Doc<"sites">,
  status: string,
  limit: number,
) {
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", site._id).eq("status", status)
      )
      .order("desc")
      .take(limit);
    return legacyEpoch.filter((article) =>
      articleMatchesCurrentDomain(site, article)
    );
  }
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return [];
  return ctx.db
    .query("article_summaries")
    .withIndex("by_site_domain_revision_status", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", siteCanonicalDomainRevision(site))
        .eq("status", status)
    )
    .order("desc")
    .take(limit);
}

async function takeCurrentRecentSummaries(
  ctx: QueryCtx,
  site: Doc<"sites">,
  since: number,
  limit: number,
) {
  if (siteUsesLegacyDomainReceipts(site)) {
    const legacyEpoch = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_created", (q) =>
        q.eq("siteId", site._id).gte("articleCreatedAt", since)
      )
      .take(limit);
    return legacyEpoch.filter((article) =>
      articleMatchesCurrentDomain(site, article)
    );
  }
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return [];
  return ctx.db
    .query("article_summaries")
    .withIndex("by_site_domain_revision_created", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", siteCanonicalDomainRevision(site))
        .gte("articleCreatedAt", since)
    )
    .take(limit);
}

async function latestCurrentModernPublishedSummary(
  ctx: QueryCtx,
  site: Doc<"sites">,
) {
  if (siteUsesLegacyDomainReceipts(site)) {
    const candidate = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_status_audit_published", (q) =>
        q
          .eq("siteId", site._id)
          .eq("status", "published")
          .eq("publicationAuditVersion", PUBLICATION_AUDIT_VERSION)
      )
      .order("desc")
      .first();
    return candidate && articleMatchesCurrentDomain(site, candidate)
      ? candidate
      : null;
  }
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return null;
  return ctx.db
    .query("article_summaries")
    .withIndex("by_site_domain_revision_status_audit_published", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", siteCanonicalDomainRevision(site))
        .eq("status", "published")
        .eq("publicationAuditVersion", PUBLICATION_AUDIT_VERSION)
    )
    .order("desc")
    .first();
}

async function latestCurrentPublishedByCreationSummary(
  ctx: QueryCtx,
  site: Doc<"sites">,
) {
  if (siteUsesLegacyDomainReceipts(site)) {
    const candidate = await ctx.db
      .query("article_summaries")
      .withIndex("by_site_status_created", (q) =>
        q.eq("siteId", site._id).eq("status", "published")
      )
      .order("desc")
      .first();
    return candidate && articleMatchesCurrentDomain(site, candidate)
      ? candidate
      : null;
  }
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain) return null;
  return ctx.db
    .query("article_summaries")
    .withIndex("by_site_domain_revision_status_created", (q) =>
      q
        .eq("siteId", site._id)
        .eq("canonicalDomain", canonicalDomain)
        .eq("domainRevision", siteCanonicalDomainRevision(site))
        .eq("status", "published")
    )
    .order("desc")
    .first();
}

async function listBySiteHandler(
  ctx: QueryCtx,
  siteId: Doc<"sites">["_id"],
) {
    const site = await ctx.db.get(siteId);
    if (!site) return [];
    const migrationState = await ctx.db
      .query("maintenance_state")
      .withIndex("by_key", (q) =>
        q.eq("key", PUBLICATION_INTEGRITY_MIGRATION_KEY),
      )
      .first();
    const summaries = migrationState?.status === "completed"
      ? await listCurrentArticleSummaries(ctx, site)
      : [];

    if (summaries.length > 0) {
      return summaries.map(summaryListItem);
    }

    // Safe migration fallback until the one-time production backfill runs.
    const articles = await listCurrentArticles(ctx, site);
    return articles.map((article) => summaryListItem(summaryFields(article)));
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

/**
 * Minimal, receipt-verified replacement inventory for authority discovery.
 * This deliberately reloads the full article rows because compact summaries
 * do not contain the external publication receipt. A `ready` article can
 * never enter this inventory, even for an owner-triggered scan.
 */
export const listVerifiedAuthorityTargetsInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    focusArticleId: v.optional(v.id("articles")),
  },
  handler: async (ctx, { siteId, focusArticleId }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return [];
    const listed = await listBySiteHandler(ctx, siteId);
    const published = listed.filter(
      (article) =>
        article.status === "published" &&
        (!focusArticleId || article._id === focusArticleId),
    );
    const fullArticles = (
      await Promise.all(published.map((article) => ctx.db.get(article._id)))
    ).filter((article): article is Doc<"articles"> =>
      Boolean(article && article.siteId === siteId)
    );
    return selectVerifiedAuthorityTargets({
      site,
      articles: fullArticles,
      now: Date.now(),
      focusArticleId,
    });
  },
});

export const getAutopilotState = internalQuery({
  args: { siteId: v.id("sites"), since: v.number() },
  handler: async (ctx, { siteId, since }) => {
    const site = await ctx.db.get(siteId);
    if (!site) throw new Error("Site not found");
    const [
      latestModernPublished,
      latestPublishedByCreation,
      ready,
      review,
      recent,
      published,
      migrationState,
    ] =
      await Promise.all([
        latestCurrentModernPublishedSummary(ctx, site),
        latestCurrentPublishedByCreationSummary(ctx, site),
        // The highest supported cadence targets twelve sealed articles. Keep
        // this scheduler projection above that ceiling so a genuinely full
        // buffer is never undercounted and needlessly regenerated.
        takeCurrentSummariesByStatus(ctx, site, "ready", 25),
        takeCurrentSummariesByStatus(ctx, site, "review", 25),
        takeCurrentRecentSummaries(ctx, site, since, 10),
        takeCurrentSummariesByStatus(ctx, site, "published", 50),
        ctx.db
          .query("maintenance_state")
          .withIndex("by_key", (q) =>
            q.eq("key", PUBLICATION_INTEGRITY_MIGRATION_KEY),
          )
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
    // The explicit completion marker is the authority. Seeing one summary is
    // not enough: a crashed partial backfill may have many unsummarized legacy
    // rows, and cron must fail closed until the resumable migration completes.
    const hasAnyArticle = migrationState?.status !== "completed"
      ? (await takeCurrentDomainArticles(ctx, site, 1)).length > 0
      : false;
    return {
      latestPublished: latestPublished
        ? summaryListItem(latestPublished)
        : null,
      ready: ready.map(summaryListItem),
      review: review.map(summaryListItem),
      recent: recent.map(summaryListItem),
      published: published.map(summaryListItem),
      migrationPending: migrationBlocksAutopilot(
        migrationState?.status,
        hasAnyArticle,
      ),
      migrationStatus: migrationState?.status ?? "not_started",
    };
  },
});

export const get = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) return null;
    await requireArticleOwner(ctx, article);
    return article;
  },
});

function ambiguityReviewAt(args: {
  attemptedAt: number;
  workflowLeaseOwner?: string;
  workflowLeaseStartedAt?: number;
  siteLeaseOwner?: string;
  siteLeaseExpiresAt?: number;
  leaseMs: number;
}): number | undefined {
  const attemptedReviewAt = args.attemptedAt + args.leaseMs;
  if (!args.workflowLeaseOwner) {
    return args.siteLeaseOwner ? undefined : attemptedReviewAt;
  }
  if (
    args.siteLeaseOwner !== args.workflowLeaseOwner ||
    !args.workflowLeaseStartedAt ||
    args.siteLeaseExpiresAt === undefined
  ) return undefined;
  return Math.max(
    attemptedReviewAt,
    args.workflowLeaseStartedAt + args.leaseMs,
    args.siteLeaseExpiresAt,
  );
}

/** Minimal owner-only review projection for external publication outcomes that
 * Pentra cannot prove. It deliberately exposes no credentials or provider
 * response bodies. Both the article and every revision candidate are fenced
 * to the exact current tenant/domain before a terminal control is shown. */
export const getPublicationAmbiguityReview = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) return null;
    await requireArticleOwner(ctx, article);
    const site = await ctx.db.get(article.siteId);
    if (
      !site ||
      site.deletionStatus ||
      site.accountDeletionRequestedAt ||
      !articleMatchesCurrentDomain(site, article)
    ) return null;

    const initial = article.publicationAttemptedAt &&
        !article.publicationReceipt &&
        !article.publicationAmbiguityDispositionAt
      ? {
          kind: "initial" as const,
          attemptedAt: article.publicationAttemptedAt,
          unverifiedAt: article.publicationOutcomeUnverifiedAt,
          detail: article.publicationOutcomeDetail,
          method: article.publicationConfigSnapshot?.method,
          deliveryKey: article.publicationDeliveryHash
            ? publicationDeliveryKey(article.publicationDeliveryHash)
            : undefined,
          reviewAt: ambiguityReviewAt({
            attemptedAt: article.publicationAttemptedAt,
            workflowLeaseOwner: article.publicationLeaseOwner,
            workflowLeaseStartedAt: article.publicationLeaseStartedAt,
            siteLeaseOwner: site.publicationLeaseOwner,
            siteLeaseExpiresAt: site.publicationLeaseExpiresAt,
            leaseMs: PUBLICATION_LEASE_MS,
          }),
        }
      : null;

    const revisionCandidates = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_article_created", (q) => q.eq("articleId", articleId))
      .order("desc")
      .take(20);
    const revision = revisionCandidates.find((candidate) =>
      candidate.siteId === site._id &&
      Boolean(candidate.attemptedAt) &&
      !candidate.receipt &&
      !candidate.ambiguityDispositionAt &&
      ["leased", "attempted", "unverified"].includes(candidate.status)
    );
    const revisionReview = revision?.attemptedAt
      ? {
          kind: "revision" as const,
          revisionId: revision._id,
          revisionKind: revision.kind,
          status: revision.status,
          attemptedAt: revision.attemptedAt,
          detail: revision.failureDetail,
          failureCode: revision.failureCode,
          method: revision.baseReceipt.method,
          revisionKey: revision.revisionKey,
          attempts: revision.attempts,
          reviewAt: ambiguityReviewAt({
            attemptedAt: revision.attemptedAt,
            workflowLeaseOwner: revision.leaseOwner,
            workflowLeaseStartedAt: revision.leaseStartedAt,
            siteLeaseOwner: site.publicationLeaseOwner,
            siteLeaseExpiresAt: site.publicationLeaseExpiresAt,
            leaseMs: PUBLISHED_REVISION_LEASE_MS,
          }),
        }
      : null;

    return initial || revisionReview
      ? { initial, revision: revisionReview }
      : null;
  },
});

export const getInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => ctx.db.get(articleId),
});

export const createDraft = internalMutation({
  args: {
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
    articleType: v.optional(v.string()),
    title: v.string(),
    slug: v.string(),
    markdown: v.string(),
    metaTitle: v.optional(v.string()),
    metaDescription: v.optional(v.string()),
    metaKeywords: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    sources: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.optional(v.string()),
          excerpt: v.optional(v.string()),
          contentHash: v.optional(v.string()),
          capturedAt: v.optional(v.number()),
        }),
      ),
    ),
    researchEvidenceSummary: v.optional(v.string()),
    productEvidenceSnapshot: v.optional(v.string()),
    productEvidenceHash: v.optional(v.string()),
    featuredImage: v.optional(v.string()),
    reviewedMediaUrls: v.optional(v.array(v.string())),
    readingTime: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    factCheckScore: v.optional(v.number()),
    factCheckNotes: v.optional(v.string()),
    editorialQualityScore: v.optional(v.number()),
    editorialQualityNotes: v.optional(v.array(v.string())),
    mediaQualityStatus: v.optional(v.string()),
    mediaQualityNotes: v.optional(v.array(v.string())),
    productEvidenceStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [site, topic] = await Promise.all([
      ctx.db.get(args.siteId),
      args.topicId ? ctx.db.get(args.topicId) : Promise.resolve(null),
    ]);
    if (!site || !await siteExecutionAuthorized(ctx, site)) {
      throw new Error("This site is not active under the current plan");
    }
    if (
      args.topicId &&
      (!topic ||
        topic.siteId !== args.siteId ||
        !topicMatchesCurrentDomain(site, topic))
    ) {
      throw new Error("Topic belongs to an earlier site domain");
    }
    const canonicalDomain = siteCanonicalDomain(site);
    if (!canonicalDomain) throw new Error("This site domain is invalid");
    // Deduplicate slug — prevent multiple articles with the same URL path
    let slug = args.slug;
    const existing = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", args.siteId))
      .collect();
    const existingSlugs = new Set(existing.map((a) => a.slug));

    if (existingSlugs.has(slug)) {
      let suffix = 2;
      while (existingSlugs.has(`${slug}-${suffix}`)) {
        suffix++;
      }
      slug = `${slug}-${suffix}`;
      console.log(`Duplicate slug detected, using: ${slug}`);
    }

    const articleId = await ctx.db.insert("articles", {
      siteId: args.siteId,
      canonicalDomain,
      domainRevision: siteCanonicalDomainRevision(site),
      topicId: args.topicId,
      articleType: args.articleType,
      status: "draft",
      title: args.title,
      slug,
      markdown: args.markdown,
      metaTitle: args.metaTitle,
      metaDescription: args.metaDescription,
      metaKeywords: args.metaKeywords,
      language: args.language,
      sources: args.sources,
      researchEvidenceSummary: args.researchEvidenceSummary,
      productEvidenceSnapshot: args.productEvidenceSnapshot,
      productEvidenceHash: args.productEvidenceHash,
      featuredImage: args.featuredImage,
      reviewedMediaUrls: args.reviewedMediaUrls,
      readingTime: args.readingTime,
      wordCount: args.wordCount,
      factCheckScore: args.factCheckScore,
      factCheckNotes: args.factCheckNotes,
      editorialQualityScore: args.editorialQualityScore,
      editorialQualityNotes: args.editorialQualityNotes,
      mediaQualityStatus: args.mediaQualityStatus,
      mediaQualityNotes: args.mediaQualityNotes,
      productEvidenceStatus: args.productEvidenceStatus,
      qualityRevisionCount: 0,
      internalLinks: [],
      createdAt: now(),
      updatedAt: now(),
    });
    await syncSummary(ctx, articleId);
    return articleId;
  },
});

// Persist the generated draft, usage settlement, and job checkpoint in one
// serializable mutation. If a worker is reset, its old token
// cannot insert a late duplicate; a replacement worker resumes from articleId.
export const createDraftForJob = internalMutation({
  args: {
    jobId: v.id("jobs"),
    workerToken: v.string(),
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
    articleType: v.optional(v.string()),
    title: v.string(),
    slug: v.string(),
    markdown: v.string(),
    metaTitle: v.optional(v.string()),
    metaDescription: v.optional(v.string()),
    metaKeywords: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    sources: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.optional(v.string()),
          excerpt: v.optional(v.string()),
          contentHash: v.optional(v.string()),
          capturedAt: v.optional(v.number()),
        }),
      ),
    ),
    researchEvidenceSummary: v.optional(v.string()),
    productEvidenceSnapshot: v.optional(v.string()),
    productEvidenceHash: v.optional(v.string()),
    featuredImage: v.optional(v.string()),
    reviewedMediaUrls: v.optional(v.array(v.string())),
    readingTime: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    factCheckScore: v.optional(v.number()),
    factCheckNotes: v.optional(v.string()),
    editorialQualityScore: v.optional(v.number()),
    editorialQualityNotes: v.optional(v.array(v.string())),
    mediaQualityStatus: v.optional(v.string()),
    mediaQualityNotes: v.optional(v.array(v.string())),
    productEvidenceStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [job, site, topic] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.siteId),
      args.topicId ? ctx.db.get(args.topicId) : Promise.resolve(null),
    ]);
    const payload = job?.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    const jobTopicId = payload.topicId === undefined
      ? undefined
      : String(payload.topicId);
    const executionAuthorized = await siteExecutionAuthorized(ctx, site);
    if (
      !job ||
      !site ||
      job.siteId !== args.siteId ||
      job.status !== "running" ||
      job.workerToken !== args.workerToken ||
      !executionAuthorized ||
      !jobAuthorizedForExecution(site, job) ||
      jobTopicId !== (args.topicId ? String(args.topicId) : undefined) ||
      (args.topicId !== undefined &&
        (!topic ||
          topic.siteId !== args.siteId ||
          !topicMatchesCurrentDomain(site, topic)))
    ) {
      throw new Error("Worker lease lost before generated draft checkpoint");
    }
    if (job.articleId) return job.articleId;
    const canonicalDomain = siteCanonicalDomain(site);
    if (!canonicalDomain) throw new Error("This site domain is invalid");

    let slug = args.slug;
    let suffix = 2;
    while (
      await ctx.db
        .query("articles")
        .withIndex("by_site_slug", (q) =>
          q.eq("siteId", args.siteId).eq("slug", slug),
        )
        .first()
    ) {
      slug = `${args.slug}-${suffix}`;
      suffix += 1;
    }

    const timestamp = now();
    const articleId = await ctx.db.insert("articles", {
      siteId: args.siteId,
      canonicalDomain,
      domainRevision: siteCanonicalDomainRevision(site),
      topicId: args.topicId,
      articleType: args.articleType,
      status: "draft",
      title: args.title,
      slug,
      markdown: args.markdown,
      metaTitle: args.metaTitle,
      metaDescription: args.metaDescription,
      metaKeywords: args.metaKeywords,
      language: args.language,
      sources: args.sources,
      researchEvidenceSummary: args.researchEvidenceSummary,
      productEvidenceSnapshot: args.productEvidenceSnapshot,
      productEvidenceHash: args.productEvidenceHash,
      featuredImage: args.featuredImage,
      reviewedMediaUrls: args.reviewedMediaUrls,
      readingTime: args.readingTime,
      wordCount: args.wordCount,
      factCheckScore: args.factCheckScore,
      factCheckNotes: args.factCheckNotes,
      editorialQualityScore: args.editorialQualityScore,
      editorialQualityNotes: args.editorialQualityNotes,
      mediaQualityStatus: args.mediaQualityStatus,
      mediaQualityNotes: args.mediaQualityNotes,
      productEvidenceStatus: args.productEvidenceStatus,
      qualityRevisionCount: 0,
      internalLinks: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    if (job.reservationId) {
      const reservation = await ctx.db.get(job.reservationId);
      if (
        !reservation ||
        reservation.jobId !== job._id ||
        reservation.siteId !== args.siteId ||
        reservation.state !== "reserved"
      ) {
        throw new Error("Generation reservation is missing or not owned by this job");
      }
      await ctx.db.patch(reservation._id, {
        state: "settled",
        articleId,
        expiresAt: undefined,
        settledAt: timestamp,
      });
    }
    await ctx.db.patch(job._id, {
      articleId,
      payload: { ...payload, articleId },
      heartbeatAt: timestamp,
      updatedAt: timestamp,
    });
    await syncSummary(ctx, articleId);
    return articleId;
  },
});

export const updateStatus = mutation({
  args: {
    articleId: v.id("articles"),
    status: v.union(
      v.literal("draft"),
      v.literal("review"),
      v.literal("ready"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, { articleId, status }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    await requireArticleOwner(ctx, article);
    if (article.status === "published") {
      throw new Error("Published artifacts are immutable; create a new revision");
    }
    await ctx.db.patch(articleId, { status, updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

export const setWorkflowStatusInternal = internalMutation({
  args: {
    articleId: v.id("articles"),
    status: v.union(
      v.literal("draft"),
      v.literal("review"),
      v.literal("ready"),
      v.literal("rejected"),
    ),
  },
  handler: async (ctx, { articleId, status }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published articles must use the refresh workflow");
    }
    await ctx.db.patch(articleId, { status, updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

export const recordPublicationCheck = internalMutation({
  args: {
    articleId: v.id("articles"),
    status: v.string(),
    issues: v.array(v.string()),
    warnings: v.array(v.string()),
  },
  handler: async (ctx, { articleId, status, issues, warnings }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    const checkedAt = now();
    await ctx.db.patch(articleId, {
      publicationGateStatus: status,
      publicationGateIssues: issues,
      publicationGateWarnings: warnings,
      publicationCheckedAt: checkedAt,
      updatedAt: checkedAt,
    });

    // A terminal product-fit rejection condemns the measured intent, not the
    // prose. The generated-title gate can only fail after paid model work, so
    // unless the linked topic is quarantined in this same transaction the next
    // cadence pass re-selects it and pays to generate it again.
    const [site, topic] = await Promise.all([
      ctx.db.get(article.siteId),
      article.topicId ? ctx.db.get(article.topicId) : Promise.resolve(null),
    ]);
    if (site) {
      const settlement = terminalTopicFitSettlement({
        gateStatus: status,
        issues,
        article: {
          siteId: String(article.siteId),
          title: article.title,
          status: article.status,
          topicId: article.topicId ? String(article.topicId) : null,
        },
        topic: topic
          ? {
            _id: String(topic._id),
            siteId: String(topic.siteId),
            primaryKeyword: topic.primaryKeyword,
            label: topic.label,
            status: topic.status,
            businessFitEligible: topic.businessFitEligible,
            planCheckpointTerminalFailureCode:
              topic.planCheckpointTerminalFailureCode,
          }
          : null,
        siteSignals: tenantTopicBusinessSignals(site),
        checkedAt,
      });
      if (settlement && topic) {
        await ctx.db.patch(topic._id, settlement.topicPatch);
      }
      const qualitySettlement = terminalTopicQualitySettlement({
        gateStatus: status,
        issues,
        qualityRevisionCount: article.qualityRevisionCount ?? 0,
        maximumRevisions: MAX_QUALITY_REVISIONS,
        article: {
          siteId: String(article.siteId),
          status: article.status,
          topicId: article.topicId ? String(article.topicId) : null,
        },
        topic: topic
          ? {
            _id: String(topic._id),
            siteId: String(topic.siteId),
            status: topic.status,
            contentFeasibilityStatus: topic.contentFeasibilityStatus,
            planCheckpointTerminalFailureCode:
              topic.planCheckpointTerminalFailureCode,
          }
          : null,
        checkedAt,
      });
      if (qualitySettlement && topic) {
        await ctx.db.patch(topic._id, qualitySettlement.topicPatch);
      }
    }

    await syncSummary(ctx, articleId);
  },
});

export const quarantineLinkSealFailure = internalMutation({
  args: {
    articleId: v.id("articles"),
    issues: v.array(v.string()),
  },
  handler: async (ctx, { articleId, issues }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published articles require an audited revision");
    }
    const checkedAt = now();
    await ctx.db.patch(articleId, {
      status: "review",
      publicationGateStatus: "blocked",
      publicationGateIssues: issues,
      publicationGateWarnings: [],
      publicationCheckedAt: checkedAt,
      publicationAuditVersion: undefined,
      publicationConfigHash: undefined,
      publicationConfigSnapshot: undefined,
      auditedContentHash: undefined,
      auditedAt: undefined,
      updatedAt: checkedAt,
    });
    await syncSummary(ctx, articleId);
    return { quarantined: true };
  },
});

// Operator-safe migration path for artifacts created before the deterministic
// business/title target-alignment gate existed. This invalidates every seal in
// the same atomic write. Topic lifecycle reconciliation then returns an
// unreserved failed draft to the normal tenant-specific validation gates.
export const quarantineTargetMismatch = internalMutation({
  args: {
    articleId: v.id("articles"),
    issue: v.string(),
  },
  handler: async (ctx, { articleId, issue }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published articles must use the refresh workflow");
    }
    const currentTime = now();
    await ctx.db.patch(articleId, {
      status: "review",
      publicationGateStatus: "blocked",
      publicationGateIssues: [issue],
      publicationGateWarnings: [],
      publicationCheckedAt: currentTime,
      publicationAuditVersion: undefined,
      publicationConfigHash: undefined,
      publicationConfigSnapshot: undefined,
      auditedContentHash: undefined,
      auditedAt: undefined,
      updatedAt: currentTime,
    });
    await syncSummary(ctx, articleId);
    return { quarantined: true, topicId: article.topicId };
  },
});

async function assertNoUnresolvedPublishedRevision(
  ctx: MutationCtx,
  siteId: Id<"sites">,
): Promise<void> {
  for (const status of ["leased", "attempted"] as const) {
    const unresolved = await ctx.db
      .query("published_article_revisions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", status)
      )
      .first();
    if (unresolved) {
      throw new Error("A published revision delivery is already unresolved");
    }
  }
  const ambiguous = await ctx.db
    .query("published_article_revisions")
    .withIndex("by_site_status", (q) =>
      q.eq("siteId", siteId).eq("status", "unverified")
    )
    .filter((q) => q.eq(q.field("receipt"), undefined))
    .first();
  if (ambiguous) {
    throw new Error("A published revision delivery has an unverified outcome");
  }
}

function sealedPublicationConfig(article: Doc<"articles">) {
  if (!article.publicationConfigSnapshot || !article.publicationConfigHash) {
    throw new Error("Publication destination was not sealed by the quality audit");
  }
  const config = publicationDeliveryConfig(article.publicationConfigSnapshot);
  if (publicationDeliveryConfigHash(config) !== article.publicationConfigHash) {
    throw new Error("Publication destination seal is internally inconsistent");
  }
  return config;
}

function recoveryDestinationStillCurrent(
  site: Doc<"sites">,
  article: Doc<"articles">,
): boolean {
  try {
    return publicationDeliveryDestinationHash(publicationDeliveryConfig(site)) ===
      publicationDeliveryDestinationHash(sealedPublicationConfig(article));
  } catch {
    return false;
  }
}

function attemptedAdapterContract(
  site: Doc<"sites">,
  article: Doc<"articles">,
): {
  adapterVersion?: string;
  adapterConfigHash?: string;
  rendererVersion?: string;
} | null {
  const method = article.publicationConfigSnapshot?.method;
  if (method !== "wordpress" && method !== "webhook") return {};
  // Additive compatibility: rows attempted before these explicit fields were
  // introduced may infer them only from the still-exact live verification and
  // immutable renderer snapshot. The inferred values are persisted when the
  // recovery lease is claimed, before any provider access.
  const adapterVersion = article.publicationAdapterVersionAtAttempt ??
    site.publicationAdapterVersion;
  const adapterConfigHash = article.publicationAdapterConfigHashAtAttempt ??
    site.publicationAdapterConfigHash;
  const rendererVersion = article.publicationRendererVersionAtAttempt ??
    article.publicationConfigSnapshot?.rendererVersion;
  if (!adapterVersion || !adapterConfigHash || !rendererVersion) return null;
  try {
    assertSupportedPublicationAdapterVersion(adapterVersion);
    assertSupportedPublicationRendererVersion(rendererVersion);
  } catch {
    return null;
  }
  return rendererVersion === article.publicationConfigSnapshot?.rendererVersion &&
    site.publicationAdapterVersion === adapterVersion &&
    site.publicationAdapterConfigHash === adapterConfigHash &&
    publicationAdapterConfigHashForVersion(site, adapterVersion) ===
      adapterConfigHash
    ? { adapterVersion, adapterConfigHash, rendererVersion }
    : null;
}

/** Final serializable authorization fence immediately before the first
 * provider mutation. Receipt-only recovery never calls this helper. */
async function assertInitialPublicationMutationAuthorized(
  ctx: MutationCtx,
  site: Doc<"sites">,
  article: Doc<"articles">,
) {
  const replayingAttemptedEnvelope = Boolean(article.publicationAttemptedAt);
  if (
    !article.topicId ||
    !["review", "ready", "published"].includes(article.status) ||
    (site.approvalRequired &&
      article.status !== "ready" &&
      article.status !== "published")
  ) {
    throw new Error("Current owner policy no longer authorizes publication");
  }
  const topic = await ctx.db.get(article.topicId);
  if (
    !topic ||
    topic.siteId !== site._id ||
    !topicMatchesCurrentDomain(site, topic) ||
    !evaluateTopicBusinessFit({
      keyword: topic.primaryKeyword,
      label: article.title,
      ...tenantTopicBusinessSignals(site),
    }).eligible
  ) {
    throw new Error("Current tenant topic policy no longer authorizes publication");
  }
  const auditVersion = replayingAttemptedEnvelope
    ? article.publicationAuditVersion
    : PUBLICATION_AUDIT_VERSION;
  if (!Number.isInteger(auditVersion)) {
    throw new Error("Publication attempt lost its sealed audit version");
  }
  if (!replayingAttemptedEnvelope) {
    const quality = evaluatePublicationQuality(article, "strict");
    if (!quality.passed || article.publicationAuditVersion !== PUBLICATION_AUDIT_VERSION) {
      throw new Error("Current publication audit no longer authorizes a new write");
    }
  }
  if (
    article.publicationGateStatus !== "passed" ||
    !article.auditedContentHash ||
    publicationArtifactHashForAuditVersion(article, auditVersion!) !==
      article.auditedContentHash
  ) {
    throw new Error("Sealed publication artifact no longer authorizes a write");
  }
  const currentConfig = publicationDeliveryConfig(site);
  const sealedConfig = sealedPublicationConfig(article);
  const exactCurrentConfig = publicationDeliveryConfigHash(currentConfig) ===
    article.publicationConfigHash;
  if ((!replayingAttemptedEnvelope && !exactCurrentConfig) ||
      (replayingAttemptedEnvelope &&
        publicationDeliveryDestinationHash(currentConfig) !==
          publicationDeliveryDestinationHash(sealedConfig))) {
    throw new Error("Current publication destination no longer matches its seal");
  }
  if (
    replayingAttemptedEnvelope &&
    (sealedConfig.method === "wordpress" || sealedConfig.method === "webhook")
  ) {
    if (!attemptedAdapterContract(site, article)) {
      throw new Error("Attempted publication lost its sealed adapter contract");
    }
  } else if (
    currentConfig.method === "wordpress" || currentConfig.method === "webhook"
  ) {
    const adapterHash = publicationAdapterConfigHashForVersion(
      site,
      PUBLICATION_ADAPTER_VERSION,
    );
    if (
      currentConfig.rendererVersion !== PUBLISHER_RENDERER_VERSION ||
      site.publicationAdapterVersion !== PUBLICATION_ADAPTER_VERSION ||
      !adapterHash ||
      site.publicationAdapterConfigHash !== adapterHash ||
      !(site.publicationAdapterVerifiedAt && site.publicationAdapterVerifiedAt > 0)
    ) {
      throw new Error("Current publication adapter is not verified for a new write");
    }
  }
  return replayingAttemptedEnvelope ? sealedConfig : currentConfig;
}

export const getPublicationRecoveryAuthorization = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    const site = article ? await ctx.db.get(article.siteId) : null;
    if (
      !article ||
      !site ||
      !article.publicationAttemptedAt ||
      !article.publicationLeaseOwner ||
      !article.publicationLeaseStartedAt ||
      !articleMatchesCurrentDomain(site, article) ||
      site.deletionStatus ||
      site.accountDeletionRequestedAt
    ) {
      return { receiptOnlyPlanTransition: false };
    }
    return {
      receiptOnlyPlanTransition: await executionLeasePredatesPlanTransition(
        ctx,
        site,
        article.publicationAttemptedAt,
      ),
    };
  },
});

export const beginPublication = internalMutation({
  args: {
    articleId: v.id("articles"),
    expectedContentHash: v.string(),
    expectedConfigHash: v.string(),
    expectedRolloutEpoch: v.number(),
    leaseOwner: v.string(),
  },
  handler: async (
    ctx,
    {
      articleId,
      expectedContentHash,
      expectedConfigHash,
      expectedRolloutEpoch,
      leaseOwner,
    },
  ) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    if (article.publicationAmbiguityDispositionAt) {
      throw new Error(
        "This article's unresolved external delivery was reviewed and abandoned; create a new immutable publication instead of replaying it",
      );
    }
    const site = await ctx.db.get(article.siteId);
    const deliveryPreviouslyAttempted = Boolean(
      article.publicationAttemptedAt || article.publicationOutcomeUnverifiedAt,
    );
    const executionAuthorized = await siteExecutionAuthorized(ctx, site);
    const receiptOnlyTransition = deliveryPreviouslyAttempted &&
      await executionLeasePredatesPlanTransition(
        ctx,
        site,
        article.publicationAttemptedAt,
      );
    if (
      !site ||
      !articleMatchesCurrentDomain(site, article) ||
      (!executionAuthorized && !receiptOnlyTransition) ||
      (!receiptOnlyTransition &&
        (!site.autopilotEnabled ||
          site.autopilotRolloutMode !== "live" ||
          (site.autopilotRolloutEpoch ?? 0) !== expectedRolloutEpoch))
    ) {
      throw new Error("Publication blocked by the current rollout epoch");
    }
    if (!deliveryPreviouslyAttempted && article.topicId) {
      const topic = await ctx.db.get(article.topicId);
      if (
        !topic ||
        topic.siteId !== site._id ||
        !topicMatchesCurrentDomain(site, topic)
      ) {
        throw new Error("Publication blocked by an earlier-domain topic");
      }
    }
    // Initial articles and immutable revisions share one external destination.
    // Neither workflow may start while the other has an unresolved write.
    await assertNoUnresolvedPublishedRevision(ctx, site._id);
    const currentConfigHash = publicationDeliveryConfigHash(
      publicationDeliveryConfig(site),
    );
    const recoveryDestinationMatches = deliveryPreviouslyAttempted &&
      recoveryDestinationStillCurrent(site, article);
    const recoveryAdapter = deliveryPreviouslyAttempted
      ? attemptedAdapterContract(site, article)
      : {};
    if (
      (currentConfigHash !== expectedConfigHash && !recoveryDestinationMatches) ||
      article.publicationConfigHash !== expectedConfigHash ||
      (deliveryPreviouslyAttempted && !recoveryAdapter)
    ) {
      throw new Error("Publication destination changed after quality audit");
    }
    if (site.publicationLeaseOwner) {
      const sameRecoverableArticle =
        article.publicationLeaseOwner === site.publicationLeaseOwner &&
        article.publicationLeaseHash === expectedContentHash;
      if (
        (site.publicationLeaseExpiresAt ?? 0) > Date.now() ||
        !sameRecoverableArticle
      ) {
        throw new Error("Another publication is already in progress for this site");
      }
    }
    const lease = acquirePublicationLease(article, {
      expectedContentHash,
      leaseOwner,
      now: Date.now(),
    });
    if (lease.alreadyPublished) {
      return {
        alreadyPublished: true,
        publicationDate: article.publicationDate,
        publicationDeliveryHash: article.publicationDeliveryHash,
      };
    }
    let publicationDate: number;
    let publicationDeliveryHash: string;
    let publicationRolloutEpoch: number;
    if (deliveryPreviouslyAttempted) {
      if (
        !article.publicationDate ||
        !article.publicationDeliveryHash ||
        !Number.isSafeInteger(article.publicationRolloutEpoch) ||
        article.publicationRolloutEpoch !== expectedRolloutEpoch
      ) {
        throw new Error(
          "Unverified publication lost its immutable delivery envelope",
        );
      }
      const expectedPersistedEnvelope = publicationDeliveryEnvelopeHash({
        contentHash: expectedContentHash,
        configHash: expectedConfigHash,
        publicationDate: article.publicationDate,
        rolloutEpoch: article.publicationRolloutEpoch,
      });
      if (expectedPersistedEnvelope !== article.publicationDeliveryHash) {
        throw new Error(
          "Unverified publication delivery envelope no longer matches its sealed inputs",
        );
      }
      publicationDate = article.publicationDate;
      publicationDeliveryHash = article.publicationDeliveryHash;
      publicationRolloutEpoch = article.publicationRolloutEpoch;
    } else {
      publicationDate = Date.now();
      publicationRolloutEpoch = expectedRolloutEpoch;
      publicationDeliveryHash = publicationDeliveryEnvelopeHash({
        contentHash: expectedContentHash,
        configHash: expectedConfigHash,
        publicationDate,
        rolloutEpoch: publicationRolloutEpoch,
      });
    }
    await ctx.db.patch(articleId, {
      ...lease.patch,
      publicationDate,
      publicationDeliveryHash,
      publicationRolloutEpoch,
      ...(deliveryPreviouslyAttempted && recoveryAdapter
        ? {
            publicationAdapterVersionAtAttempt:
              recoveryAdapter.adapterVersion,
            publicationAdapterConfigHashAtAttempt:
              recoveryAdapter.adapterConfigHash,
            publicationRendererVersionAtAttempt:
              recoveryAdapter.rendererVersion,
          }
        : {}),
      updatedAt: now(),
    });
    await ctx.db.patch(site._id, {
      publicationLeaseOwner: leaseOwner,
      publicationLeaseExpiresAt: Date.now() + 15 * 60 * 1000,
      updatedAt: now(),
    });
    // Arm recovery in the same transaction as the first immutable delivery
    // lease. A direct owner-triggered action has no durable job whose worker
    // reset could revisit a crash after this mutation. The watchdog is bound
    // to this exact generation: a pristine expired lease is released without
    // provider access, while a marked attempt gets one read-only receipt
    // reconciliation and can never replay the external write.
    if (!deliveryPreviouslyAttempted) {
      await ctx.scheduler.runAfter(
        PUBLICATION_LEASE_MS + 1_000,
        internal.publisher.recoverInitialPublicationLeaseInternal,
        {
          siteId: site._id,
          articleId,
          expectedContentHash,
          expectedLeaseOwner: leaseOwner,
        },
      );
    }
    await syncSummary(ctx, articleId);
    return {
      alreadyPublished: false,
      publicationDate,
      publicationDeliveryHash,
      publicationRolloutEpoch,
      deliveryPreviouslyAttempted,
    };
  },
});

export const recordPublicationAttempted = internalMutation({
  args: {
    articleId: v.id("articles"),
    expectedContentHash: v.string(),
    leaseOwner: v.string(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (
      !article ||
      !ownsPublicationLease(article, {
        expectedContentHash: args.expectedContentHash,
        leaseOwner: args.leaseOwner,
      })
    ) {
      throw new Error("Publication attempt lost its immutable article lease");
    }
    const site = await ctx.db.get(article.siteId);
    if (
      !site ||
      site.publicationLeaseOwner !== args.leaseOwner ||
      !articleMatchesCurrentDomain(site, article) ||
      !(await siteExecutionAuthorized(ctx, site)) ||
      !site.autopilotEnabled ||
      site.autopilotRolloutMode !== "live" ||
      (site.autopilotRolloutEpoch ?? 0) !==
        article.publicationRolloutEpoch
    ) {
      throw new Error("Publication attempt lost its immutable site lease");
    }
    if (
      !article.publicationDate ||
      !article.publicationDeliveryHash ||
      !Number.isSafeInteger(article.publicationRolloutEpoch)
    ) {
      throw new Error("Publication attempt lost its immutable delivery envelope");
    }
    const currentConfig = await assertInitialPublicationMutationAuthorized(
      ctx,
      site,
      article,
    );
    const recoveredAdapter = article.publicationAttemptedAt
      ? attemptedAdapterContract(site, article)
      : null;
    const adapterVersion = currentConfig.method === "wordpress" ||
        currentConfig.method === "webhook"
      ? recoveredAdapter?.adapterVersion ?? PUBLICATION_ADAPTER_VERSION
      : undefined;
    const adapterConfigHash = adapterVersion
      ? recoveredAdapter?.adapterConfigHash ??
        publicationAdapterConfigHashForVersion(site, adapterVersion)
      : undefined;
    const rendererVersion = currentConfig.method === "wordpress" ||
        currentConfig.method === "webhook"
      ? recoveredAdapter?.rendererVersion ?? currentConfig.rendererVersion
      : undefined;
    if (
      article.publicationAttemptedAt &&
      ((article.publicationAdapterVersionAtAttempt !== undefined &&
        article.publicationAdapterVersionAtAttempt !== adapterVersion) ||
        (article.publicationAdapterConfigHashAtAttempt !== undefined &&
          article.publicationAdapterConfigHashAtAttempt !== adapterConfigHash) ||
        (article.publicationRendererVersionAtAttempt !== undefined &&
          article.publicationRendererVersionAtAttempt !== rendererVersion))
    ) {
      throw new Error("Publication attempt changed its sealed adapter contract");
    }
    const attemptedAt = article.publicationAttemptedAt ?? now();
    await ctx.db.patch(article._id, {
      publicationAttemptedAt: attemptedAt,
      publicationAdapterVersionAtAttempt: adapterVersion,
      publicationAdapterConfigHashAtAttempt: adapterConfigHash,
      publicationRendererVersionAtAttempt: rendererVersion,
      updatedAt: attemptedAt,
    });
    await syncSummary(ctx, article._id);
    return { attemptedAt };
  },
});

export const recordPublicationOutcomeUnverified = internalMutation({
  args: {
    articleId: v.id("articles"),
    expectedContentHash: v.string(),
    leaseOwner: v.string(),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (
      !article ||
      !ownsPublicationLease(article, {
        expectedContentHash: args.expectedContentHash,
        leaseOwner: args.leaseOwner,
      }) ||
      !article.publicationAttemptedAt
    ) {
      return { recorded: false };
    }
    const site = await ctx.db.get(article.siteId);
    if (site?.publicationLeaseOwner !== args.leaseOwner) {
      return { recorded: false };
    }
    const timestamp = now();
    await ctx.db.patch(article._id, {
      publicationOutcomeUnverifiedAt: timestamp,
      publicationOutcomeDetail: args.detail.slice(0, 500),
      updatedAt: timestamp,
    });
    await syncSummary(ctx, article._id);
    return { recorded: true };
  },
});

/** Owner-reviewed terminal disposition for a provider outcome that cannot be
 * proven by an exact destination receipt. This never asserts success and
 * never authorizes a replay. The sealed envelope and attempt metadata remain
 * immutable audit evidence while the site-level delivery lock is released. */
export const abandonUnverifiedPublication = mutation({
  args: {
    articleId: v.id("articles"),
    confirmation: v.string(),
  },
  handler: async (ctx, { articleId, confirmation }) => {
    if (confirmation !== REVIEWED_AMBIGUITY_CONFIRMATION) {
      throw new Error(
        `Exact confirmation required: ${REVIEWED_AMBIGUITY_CONFIRMATION}`,
      );
    }
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    await requireArticleOwner(ctx, article);
    const site = await ctx.db.get(article.siteId);
    const identity = await ctx.auth.getUserIdentity();
    const timestamp = now();
    if (
      !site ||
      !identity ||
      site.deletionStatus ||
      site.accountDeletionRequestedAt ||
      !articleMatchesCurrentDomain(site, article) ||
      article.status === "published" ||
      article.publicationReceipt ||
      !reviewedAmbiguityDispositionAllowed({
        attemptedAt: article.publicationAttemptedAt,
        receiptPresent: Boolean(article.publicationReceipt),
        dispositionAt: article.publicationAmbiguityDispositionAt,
        workflowLeaseOwner: article.publicationLeaseOwner,
        workflowLeaseStartedAt: article.publicationLeaseStartedAt,
        siteLeaseOwner: site.publicationLeaseOwner,
        siteLeaseExpiresAt: site.publicationLeaseExpiresAt,
        now: timestamp,
        leaseMs: PUBLICATION_LEASE_MS,
      })
    ) {
      throw new Error(
        "This article does not have an expired, receipt-free publication ambiguity",
      );
    }
    const leaseOwner = article.publicationLeaseOwner;
    const detail =
      "The owner reviewed an unresolved provider outcome, abandoned this immutable delivery without asserting success, and accepted responsibility for reconciling any external artifact before future destination changes.";
    await ctx.db.patch(article._id, {
      status: "rejected",
      publicationGateStatus: "blocked",
      publicationGateIssues: ["owner_reviewed_delivery_ambiguity"],
      publicationLeaseHash: undefined,
      publicationLeaseOwner: undefined,
      publicationLeaseStartedAt: undefined,
      publicationAmbiguityDispositionAt: timestamp,
      publicationAmbiguityDispositionBy: identity.subject,
      publicationAmbiguityDispositionDetail: detail,
      publicationOutcomeDetail: detail,
      updatedAt: timestamp,
    });
    if (leaseOwner && site.publicationLeaseOwner === leaseOwner) {
      await ctx.db.patch(site._id, {
        publicationLeaseOwner: undefined,
        publicationLeaseExpiresAt: undefined,
        updatedAt: timestamp,
      });
    }
    await syncSummary(ctx, article._id);
    return {
      abandoned: true,
      disposition: "owner_reviewed_unverified_delivery",
      attemptedAt: article.publicationAttemptedAt,
    };
  },
});

export const completePublication = internalMutation({
  args: {
    articleId: v.id("articles"),
    publishedContentHash: v.string(),
    expectedDeliveryHash: v.string(),
    expectedConfigHash: v.string(),
    expectedRolloutEpoch: v.number(),
    leaseOwner: v.string(),
    receipt: v.object({
      method: v.union(v.literal("github"), v.literal("wordpress"), v.literal("webhook")),
      deliveryKey: v.string(),
      contentHash: v.string(),
      externalId: v.string(),
      url: v.string(),
      status: v.string(),
      receivedAt: v.number(),
    }),
  },
  handler: async (
    ctx,
    {
      articleId,
      publishedContentHash,
      expectedDeliveryHash,
      expectedConfigHash,
      expectedRolloutEpoch,
      leaseOwner,
      receipt,
    },
  ) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    const auditVersion = article.publicationAuditVersion;
    const attemptedContract = Boolean(article.publicationAttemptedAt);
    const persistedHash = Number.isInteger(auditVersion)
      ? publicationArtifactHashForAuditVersion(article, auditVersion!)
      : undefined;
    if (
      article.auditedContentHash !== publishedContentHash ||
      (!attemptedContract && auditVersion !== PUBLICATION_AUDIT_VERSION) ||
      article.publicationGateStatus !== "passed" ||
      persistedHash !== publishedContentHash ||
      article.publicationDeliveryHash !== expectedDeliveryHash ||
      article.publicationRolloutEpoch !== expectedRolloutEpoch ||
      !ownsPublicationLease(article, {
        expectedContentHash: publishedContentHash,
        leaseOwner,
      })
    ) {
      throw new Error("Refusing to complete publication for an unsealed artifact");
    }
    const site = await ctx.db.get(article.siteId);
    const completedAt = now();
    validatePublicationReceipt(receipt);
    if (!site || !articleMatchesCurrentDomain(site, article)) {
      throw new Error("Refusing to complete publication after site lease loss");
    }
    const currentConfigHash = publicationDeliveryConfigHash(
      publicationDeliveryConfig(site),
    );
    const sealedConfig = sealedPublicationConfig(article);
    const recoveryDestinationMatches = attemptedContract &&
      recoveryDestinationStillCurrent(site, article) &&
      Boolean(attemptedAdapterContract(site, article));
    const expectedEnvelope = article.publicationDate
      ? publicationDeliveryEnvelopeHash({
          contentHash: publishedContentHash,
          configHash: expectedConfigHash,
          publicationDate: article.publicationDate,
          rolloutEpoch: expectedRolloutEpoch,
        })
      : undefined;
    const normalSettlementAuthorized =
      await siteExecutionAuthorized(ctx, site) &&
      Boolean(site.autopilotEnabled) &&
      site.autopilotRolloutMode === "live" &&
      (site.autopilotRolloutEpoch ?? 0) === expectedRolloutEpoch;
    const receiptOnlyPlanTransition =
      await executionLeasePredatesPlanTransition(
        ctx,
        site,
        article.publicationAttemptedAt,
      );
    if (
      (!normalSettlementAuthorized && !receiptOnlyPlanTransition) ||
      (currentConfigHash !== expectedConfigHash && !recoveryDestinationMatches) ||
      article.publicationConfigHash !== expectedConfigHash ||
      expectedEnvelope !== expectedDeliveryHash ||
      receipt.method !== sealedConfig.method ||
      receipt.deliveryKey !== publicationDeliveryKey(expectedDeliveryHash) ||
      receipt.contentHash !== publishedContentHash ||
      receipt.receivedAt < (article.publicationLeaseStartedAt ?? 0) ||
      receipt.receivedAt > completedAt + 60_000 ||
      site.publicationLeaseOwner !== leaseOwner ||
      (site.publicationLeaseExpiresAt ?? 0) <= completedAt ||
      !article.publicationLeaseStartedAt ||
      completedAt - article.publicationLeaseStartedAt >= PUBLICATION_LEASE_MS
    ) {
      throw new Error("Refusing to complete publication after site lease loss");
    }
    const publicUrl = publishedArticlePublicUrl({
      domain: site.domain,
      urlStructure: site.urlStructure,
      slug: article.slug,
    });
    await ctx.db.patch(articleId, {
      status: "published",
      publishedContentHash,
      publishedAt: completedAt,
      publicUrl,
      publicUrlStatus: "pending",
      publicUrlLastCheckedAt: undefined,
      publicUrlVerifiedAt: undefined,
      publicUrlCheckAttempts: 0,
      publicUrlCheckError: undefined,
      publicationReceipt: receipt,
      publicationLeaseHash: undefined,
      publicationLeaseOwner: undefined,
      publicationLeaseStartedAt: undefined,
      publicationAttemptedAt: undefined,
      publicationAdapterVersionAtAttempt: undefined,
      publicationAdapterConfigHashAtAttempt: undefined,
      publicationRendererVersionAtAttempt: undefined,
      publicationOutcomeUnverifiedAt: undefined,
      publicationOutcomeDetail: undefined,
      updatedAt: completedAt,
    });
    await ctx.db.patch(site._id, {
      publicationLeaseOwner: undefined,
      publicationLeaseExpiresAt: undefined,
      updatedAt: completedAt,
    });
    if (article.topicId) {
      const topic = await ctx.db.get(article.topicId);
      if (
        topic?.siteId === article.siteId &&
        topic.growthActionFingerprint &&
        topic.growthParentArticleId
      ) {
        const growthAction = await ctx.db
          .query("seo_growth_actions")
          .withIndex("by_fingerprint", (q) =>
            q.eq("fingerprint", topic.growthActionFingerprint!)
          )
          .unique();
        if (
          growthAction?.siteId === article.siteId &&
          growthAction.articleId === topic.growthParentArticleId &&
          growthAction.status === "open"
        ) {
          const existingRevision = await ctx.db
            .query("published_article_revisions")
            .withIndex("by_action", (q) =>
              q.eq("growthActionId", growthAction._id)
            )
            .first();
          const supportDeliveryReceipt = {
            articleId,
            method: receipt.method,
            deliveryKey: receipt.deliveryKey,
            contentHash: receipt.contentHash,
            externalId: receipt.externalId,
            status: receipt.status,
            receivedAt: receipt.receivedAt,
          };
          const supportDeliveryReceiptConflict = Boolean(
            growthAction.supportDeliveryReceipt &&
            !growthSupportDeliveryReceiptsMatch(
              growthAction.supportDeliveryReceipt,
              supportDeliveryReceipt,
            ),
          );
          const revisionSupportPhase =
            growthAction.stage === "striking_distance" &&
            growthAction.actionKind === "strengthen_cluster" &&
            !growthAction.publishedRevisionId &&
            !existingRevision &&
            !supportDeliveryReceiptConflict;
          await ctx.db.patch(growthAction._id, {
            ...(!growthAction.supportDeliveryReceipt
              ? {
                  supportDeliveryReceipt,
                  supportDeliveryRecordedAt: completedAt,
                }
              : {}),
            ...(growthAction.publishedRevisionId ||
              existingRevision ||
              supportDeliveryReceiptConflict
              ? {}
              : {
                  automationStatus: revisionSupportPhase
                    ? SUPPORT_DELIVERY_VERIFIED_STATUS
                    : "executed",
                  automationDetail: revisionSupportPhase
                    ? "The support article has an exact external publication receipt; the still-open striking-distance page is eligible for one immutable revision assessment."
                    : "The verified support article was delivered and confirmed by an exact external publication receipt.",
                  automatedAt: revisionSupportPhase ? undefined : completedAt,
                }),
            updatedAt: completedAt,
          });
        }
      }
    }
    await syncSummary(ctx, articleId);
    await ctx.scheduler.runAfter(
      0,
      internal.publisher.verifyPublicPublicationInternal,
      {
        siteId: article.siteId,
        articleId,
        expectedContentHash: publishedContentHash,
        attempt: 0,
      },
    );
  },
});

export const recordPublicPublicationCheck = internalMutation({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    expectedContentHash: v.string(),
    publicUrl: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("failed"),
    ),
    attempts: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (
    ctx,
    {
      siteId,
      articleId,
      expectedContentHash,
      publicUrl,
      status,
      attempts,
      error,
    },
  ) => {
    const [site, article] = await Promise.all([
      ctx.db.get(siteId),
      ctx.db.get(articleId),
    ]);
    if (
      !siteExecutionActive(site) ||
      !article ||
      article.siteId !== siteId ||
      !articleMatchesCurrentDomain(site, article)
    ) {
      throw new Error("Public publication check tenant mismatch");
    }
    if (
      article.status !== "published" ||
      article.publishedContentHash !== expectedContentHash
    ) {
      throw new Error("Public publication check artifact mismatch");
    }
    const expectedPublicUrl = publishedArticlePublicUrl({
      domain: site.domain,
      urlStructure: site.urlStructure,
      slug: article.slug,
    });
    if (publicUrl !== expectedPublicUrl) {
      throw new Error("Public publication check URL mismatch");
    }
    if (article.publicUrlStatus === "verified") {
      return { recorded: false, reason: "already_verified" };
    }
    if (
      status !== "verified" &&
      attempts <= (article.publicUrlCheckAttempts ?? 0)
    ) {
      return { recorded: false, reason: "stale_attempt" };
    }
    const checkedAt = now();
    await ctx.db.patch(articleId, {
      publicUrl,
      publicUrlStatus: status,
      publicUrlLastCheckedAt: checkedAt,
      publicUrlVerifiedAt: status === "verified" ? checkedAt : undefined,
      publicUrlCheckAttempts: Math.max(1, Math.floor(attempts)),
      publicUrlCheckError: status === "verified" ? undefined : error?.slice(0, 500),
      updatedAt: checkedAt,
    });
    await syncSummary(ctx, articleId);
    return { recorded: true };
  },
});

export const releasePublication = internalMutation({
  args: {
    articleId: v.id("articles"),
    expectedContentHash: v.string(),
    leaseOwner: v.string(),
  },
  handler: async (ctx, { articleId, expectedContentHash, leaseOwner }) => {
    const article = await ctx.db.get(articleId);
    if (
      !article ||
      !ownsPublicationLease(article, { expectedContentHash, leaseOwner })
    ) return;
    if (
      article.publicationAttemptedAt ||
      article.publicationOutcomeUnverifiedAt
    ) {
      throw new Error(
        "Cannot release an initial publication with an unresolved external outcome",
      );
    }
    await ctx.db.patch(articleId, {
      publicationDate: undefined,
      publicationDeliveryHash: undefined,
      publicationRolloutEpoch: undefined,
      publicationLeaseHash: undefined,
      publicationLeaseOwner: undefined,
      publicationLeaseStartedAt: undefined,
      publicationAttemptedAt: undefined,
      publicationAdapterVersionAtAttempt: undefined,
      publicationAdapterConfigHashAtAttempt: undefined,
      publicationRendererVersionAtAttempt: undefined,
      publicationOutcomeUnverifiedAt: undefined,
      publicationOutcomeDetail: undefined,
      updatedAt: now(),
    });
    const site = await ctx.db.get(article.siteId);
    if (site?.publicationLeaseOwner === leaseOwner) {
      await ctx.db.patch(site._id, {
        publicationLeaseOwner: undefined,
        publicationLeaseExpiresAt: undefined,
        updatedAt: now(),
      });
    }
    await syncSummary(ctx, articleId);
  },
});

/** A worker can die after acquiring the database lease but before reaching the
 * first provider mutation. Once that pristine lease expires, clearing it is
 * conclusive: the provider boundary marker never committed, and any delayed
 * worker still carries the old owner token and therefore cannot mark/send. */
export const releaseExpiredPristinePublication = internalMutation({
  args: {
    articleId: v.id("articles"),
    expectedContentHash: v.string(),
    expectedLeaseOwner: v.string(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (
      !article ||
      !ownsPublicationLease(article, {
        expectedContentHash: args.expectedContentHash,
        leaseOwner: args.expectedLeaseOwner,
      }) ||
      article.publicationAttemptedAt ||
      article.publicationOutcomeUnverifiedAt ||
      !article.publicationLeaseStartedAt ||
      article.publicationLeaseStartedAt + PUBLICATION_LEASE_MS > now()
    ) {
      return { released: false };
    }
    const site = await ctx.db.get(article.siteId);
    if (
      !site ||
      site.publicationLeaseOwner !== args.expectedLeaseOwner ||
      (site.publicationLeaseExpiresAt ?? Number.POSITIVE_INFINITY) > now()
    ) {
      return { released: false };
    }
    const timestamp = now();
    await ctx.db.patch(article._id, {
      publicationDate: undefined,
      publicationDeliveryHash: undefined,
      publicationRolloutEpoch: undefined,
      publicationLeaseHash: undefined,
      publicationLeaseOwner: undefined,
      publicationLeaseStartedAt: undefined,
      publicationAdapterVersionAtAttempt: undefined,
      publicationAdapterConfigHashAtAttempt: undefined,
      publicationRendererVersionAtAttempt: undefined,
      publicationOutcomeDetail: undefined,
      updatedAt: timestamp,
    });
    await ctx.db.patch(site._id, {
      publicationLeaseOwner: undefined,
      publicationLeaseExpiresAt: undefined,
      updatedAt: timestamp,
    });
    await syncSummary(ctx, article._id);
    return { released: true };
  },
});

export const updateMarkdown = internalMutation({
  args: { articleId: v.id("articles"), markdown: v.string() },
  handler: async (ctx, { articleId, markdown }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published artifacts are immutable; create and audit a revision instead");
    }
    await ctx.db.patch(articleId, {
      markdown,
      auditedContentHash: undefined,
      auditedAt: undefined,
      publicationAuditVersion: undefined,
      publicationConfigHash: undefined,
      publicationConfigSnapshot: undefined,
      publicationGateStatus: undefined,
      publicationGateIssues: undefined,
      publicationGateWarnings: undefined,
      publicationCheckedAt: undefined,
      updatedAt: now(),
    });
    await syncSummary(ctx, articleId);
  },
});

export const updateMetadata = internalMutation({
  args: {
    articleId: v.id("articles"),
    metaTitle: v.optional(v.string()),
    metaDescription: v.optional(v.string()),
  },
  handler: async (ctx, { articleId, metaTitle, metaDescription }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published artifacts are immutable; create and audit a revision instead");
    }
    const patch: Record<string, string | number | undefined> = {
      auditedContentHash: undefined,
      auditedAt: undefined,
      publicationAuditVersion: undefined,
      publicationConfigHash: undefined,
      publicationConfigSnapshot: undefined,
      publicationGateStatus: undefined,
      publicationGateIssues: undefined,
      publicationGateWarnings: undefined,
      publicationCheckedAt: undefined,
      updatedAt: now(),
    };
    if (metaTitle !== undefined) patch.metaTitle = metaTitle;
    if (metaDescription !== undefined) patch.metaDescription = metaDescription;
    await ctx.db.patch(articleId, patch);
    await syncSummary(ctx, articleId);
  },
});

export const applyQualityReview = internalMutation({
  args: {
    articleId: v.id("articles"),
    title: v.string(),
    markdown: v.string(),
    metaTitle: v.optional(v.string()),
    metaDescription: v.optional(v.string()),
    wordCount: v.number(),
    readingTime: v.number(),
    factCheckScore: v.number(),
    factCheckNotes: v.string(),
    editorialQualityScore: v.number(),
    editorialQualityNotes: v.array(v.string()),
    featuredImage: v.optional(v.string()),
    reviewedMediaUrls: v.array(v.string()),
    mediaQualityStatus: v.string(),
    mediaQualityNotes: v.array(v.string()),
    productEvidenceStatus: v.string(),
    productEvidenceSnapshot: v.optional(v.string()),
    productEvidenceHash: v.optional(v.string()),
    claimEvidence: v.array(
      v.object({
        claim: v.string(),
        citationNumbers: v.array(v.number()),
        supported: v.boolean(),
        reason: v.string(),
      }),
    ),
    claimEvidenceStatus: v.string(),
    contentHash: v.optional(v.string()),
    auditVersion: v.optional(v.number()),
    publicationConfigHash: v.optional(v.string()),
    publicationConfigSnapshot: v.optional(
      v.object({
        method: v.string(),
        domain: v.string(),
        urlStructure: v.string(),
        repoOwner: v.optional(v.string()),
        repoName: v.optional(v.string()),
        repoDefaultBranch: v.optional(v.string()),
        contentDir: v.optional(v.string()),
        wpUrl: v.optional(v.string()),
        webhookUrl: v.optional(v.string()),
        brandPrimaryColor: v.optional(v.string()),
        brandAccentColor: v.optional(v.string()),
        brandFontFamily: v.optional(v.string()),
        rendererVersion: v.optional(v.string()),
      }),
    ),
    qualityRevisionCount: v.number(),
    qualityRecoveryVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published articles must use the refresh workflow");
    }

    await ctx.db.patch(args.articleId, {
      title: args.title,
      markdown: args.markdown,
      metaTitle: args.metaTitle,
      metaDescription: args.metaDescription,
      wordCount: args.wordCount,
      readingTime: args.readingTime,
      factCheckScore: args.factCheckScore,
      factCheckNotes: args.factCheckNotes,
      editorialQualityScore: args.editorialQualityScore,
      editorialQualityNotes: args.editorialQualityNotes,
      featuredImage: args.featuredImage,
      reviewedMediaUrls: args.reviewedMediaUrls,
      mediaQualityStatus: args.mediaQualityStatus,
      mediaQualityNotes: args.mediaQualityNotes,
      productEvidenceStatus: args.productEvidenceStatus,
      productEvidenceSnapshot: args.productEvidenceSnapshot,
      productEvidenceHash: args.productEvidenceHash,
      claimEvidence: args.claimEvidence,
      claimEvidenceStatus: args.claimEvidenceStatus,
      qualityRevisionCount: args.qualityRevisionCount,
      qualityRecoveryVersion: Math.max(
        article.qualityRecoveryVersion ?? 0,
        args.qualityRecoveryVersion,
      ),
      qualityRecoveryAttemptVersion: Math.max(
        article.qualityRecoveryAttemptVersion ?? 0,
        args.qualityRecoveryVersion,
      ),
      status: "review",
      publicationGateStatus: undefined,
      publicationGateIssues: undefined,
      publicationGateWarnings: undefined,
      publicationCheckedAt: undefined,
      publicationAuditVersion: args.auditVersion,
      publicationConfigHash: args.contentHash
        ? args.publicationConfigHash
        : undefined,
      publicationConfigSnapshot: args.contentHash
        ? args.publicationConfigSnapshot
        : undefined,
      auditedContentHash: args.contentHash,
      auditedAt: args.contentHash ? now() : undefined,
      updatedAt: now(),
    });
    await syncSummary(ctx, args.articleId);
  },
});

async function deterministicInternalLinkRepair(
  ctx: MutationCtx,
  site: Doc<"sites">,
  article: Doc<"articles">,
): Promise<{
  markdown: string;
  internalLinks: { anchor: string; href: string }[];
  inserted: number;
}> {
  const [sitePages, siteArticles] = await Promise.all([
    ctx.db
      .query("pages")
      .withIndex("by_site", (q) => q.eq("siteId", site._id))
      .take(100),
    takeCurrentDomainArticles(ctx, site, 100),
  ]);
  const destinations = [
    ...sitePages
      .filter((page) => pageMatchesCurrentDomain(site, page))
      .map((page) => ({
        href: page.slug,
        title: page.title ?? "",
        summary: page.summary ?? "",
        keywords: page.keywords ?? [],
      })),
    ...siteArticles
      .filter((candidate) =>
        candidate._id !== article._id &&
        candidate.status === "published" &&
        Boolean(candidate.slug)
      )
      .map((candidate) => ({
        href: publishedArticleInternalHref(
          site.urlStructure,
          candidate.slug,
        ),
        title: candidate.title,
        summary: candidate.metaDescription ?? "",
        keywords: candidate.metaKeywords ?? [],
      })),
  ].filter(
    (destination, index, all) =>
      all.findIndex((candidate) => candidate.href === destination.href) ===
        index,
  );
  const selfHref = publishedArticleInternalHref(
    site.urlStructure,
    article.slug,
  );
  const selected = selectRelatedInternalLinks({
    currentTitle: article.title,
    currentKeywords: article.metaKeywords,
    destinations,
    limit: 1,
  });
  const links = validateInternalLinkSuggestions(
    selected,
    destinations.map((destination) => destination.href),
    selfHref,
  );
  const appended = appendRelatedInternalLinks(article.markdown, links);
  return {
    markdown: appended.markdown,
    internalLinks: [
      ...(article.internalLinks ?? []),
      ...appended.inserted,
    ],
    inserted: appended.inserted.length,
  };
}

/**
 * Reclaim ready inventory stranded by an audit-version increment.
 *
 * Re-evaluates strict publication quality against the tenant's current
 * delivery configuration. This is deterministic and spends nothing with any
 * provider, so it is safe on the natural cadence path. An article that still
 * passes is re-sealed at the current version; one that no longer passes is
 * demoted to review with its exact issues rather than being left as a
 * plausible-looking artifact that can never publish.
 */
export const refreshPublicationAudit = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    // Re-checked here on the authoritative document: the scheduler selects
    // from summaries, which do not carry the delivery-lease fields.
    assertNotPublishing(article);
    const stranded = needsPublicationAuditRefresh(article);
    const orphanRepair = needsDeterministicInternalLinkRepair(article);
    if (!stranded && !orphanRepair) {
      return { refreshed: false as const, reason: "not_stranded" as const };
    }
    const site = await ctx.db.get(article.siteId);
    if (!site) throw new Error("Site not found");
    if (!articleMatchesCurrentDomain(site, article)) {
      return { refreshed: false as const, reason: "domain_changed" as const };
    }

    const deliveryConfig = publicationDeliveryConfig(site);
    const deliveryConfigHash = publicationDeliveryConfigHash(deliveryConfig);
    let candidate = { ...article, publicationConfigHash: deliveryConfigHash };
    let quality = evaluatePublicationQuality(candidate, "strict");
    const shouldRepairOrphan = !quality.passed &&
      needsDeterministicInternalLinkRepair({
        ...article,
        status: "review",
        publicationGateStatus: "blocked",
        publicationGateIssues: quality.issues,
      });
    let internalLinkRepairAttempted = false;
    let internalLinkRepairInserted = 0;
    if (shouldRepairOrphan) {
      internalLinkRepairAttempted = true;
      const repaired = await deterministicInternalLinkRepair(ctx, site, article);
      internalLinkRepairInserted = repaired.inserted;
      if (repaired.inserted > 0) {
        candidate = {
          ...candidate,
          markdown: repaired.markdown,
          internalLinks: repaired.internalLinks,
        };
        quality = evaluatePublicationQuality(candidate, "strict");
      }
    }
    const checkedAt = now();

    if (!quality.passed) {
      await ctx.db.patch(articleId, {
        status: "review",
        publicationGateStatus: "blocked",
        publicationGateIssues: quality.issues,
        publicationGateWarnings: quality.warnings,
        publicationCheckedAt: checkedAt,
        publicationAuditVersion: undefined,
        publicationConfigHash: undefined,
        publicationConfigSnapshot: undefined,
        auditedContentHash: undefined,
        auditedAt: undefined,
        ...(internalLinkRepairAttempted
          ? {
              deterministicInternalLinkRepairVersion:
                DETERMINISTIC_INTERNAL_LINK_REPAIR_VERSION,
            }
          : {}),
        updatedAt: checkedAt,
      });
      await syncSummary(ctx, articleId);
      return { refreshed: false as const, reason: "quality_failed" as const };
    }

    await ctx.db.patch(articleId, {
      ...(internalLinkRepairInserted > 0
        ? {
            markdown: candidate.markdown,
            internalLinks: candidate.internalLinks,
            deterministicInternalLinkRepairVersion:
              DETERMINISTIC_INTERNAL_LINK_REPAIR_VERSION,
          }
        : {}),
      publicationGateStatus: "passed",
      publicationGateIssues: quality.issues,
      publicationGateWarnings: quality.warnings,
      publicationCheckedAt: checkedAt,
      publicationAuditVersion: PUBLICATION_AUDIT_VERSION,
      publicationConfigHash: deliveryConfigHash,
      publicationConfigSnapshot: deliveryConfig,
      auditedContentHash: publicationArtifactHash(candidate),
      auditedAt: checkedAt,
      updatedAt: checkedAt,
    });
    await syncSummary(ctx, articleId);
    return {
      refreshed: true as const,
      reason: internalLinkRepairInserted > 0
        ? "internal_link_repaired" as const
        : "resealed" as const,
    };
  },
});

export const applyDeterministicQualityRepair = internalMutation({
  args: {
    articleId: v.id("articles"),
  },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published articles must use the refresh workflow");
    }
    if (!needsDeterministicMechanicalRepair({
      createdAt: article.createdAt,
      status: article.status,
      publicationGateStatus: article.publicationGateStatus,
      publicationGateIssues: article.publicationGateIssues,
      qualityRevisionCount: article.qualityRevisionCount,
    })) {
      throw new Error(
        "Article is not eligible for deterministic mechanical repair",
      );
    }
    const site = await ctx.db.get(article.siteId);
    if (!site) throw new Error("Site not found");
    const deliveryConfig = publicationDeliveryConfig(site);
    const deliveryConfigHash = publicationDeliveryConfigHash(deliveryConfig);
    const metaDescription = clampMetaDescription(article.metaDescription);
    const markdown = repairDanglingStructuredIntroductions(article.markdown);
    const candidate = {
      ...article,
      markdown,
      metaDescription,
      publicationConfigHash: deliveryConfigHash,
    };
    const quality = evaluatePublicationQuality(candidate, "strict");
    const readyForPublication = quality.passed;
    const contentHash = readyForPublication
      ? publicationArtifactHash(candidate)
      : undefined;
    const checkedAt = now();

    await ctx.db.patch(articleId, {
      markdown,
      metaDescription,
      publicationGateStatus: readyForPublication ? "passed" : "blocked",
      publicationGateIssues: quality.issues,
      publicationGateWarnings: quality.warnings,
      publicationCheckedAt: checkedAt,
      publicationAuditVersion: readyForPublication
        ? PUBLICATION_AUDIT_VERSION
        : undefined,
      publicationConfigHash: readyForPublication
        ? deliveryConfigHash
        : undefined,
      publicationConfigSnapshot: readyForPublication
        ? deliveryConfig
        : undefined,
      auditedContentHash: contentHash,
      auditedAt: readyForPublication ? checkedAt : undefined,
      updatedAt: checkedAt,
    });
    await syncSummary(ctx, articleId);

    return {
      articleId,
      factCheckScore: article.factCheckScore ?? 0,
      editorialQualityScore: article.editorialQualityScore ?? 0,
      readyForPublication,
      contentHash,
      qualityRevisionCount: article.qualityRevisionCount ?? 0,
      issues: quality.issues,
    };
  },
});

export const recoverLegacyDeterministicSeal = internalMutation({
  args: {
    articleId: v.id("articles"),
  },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    const site = await ctx.db.get(article.siteId);
    if (!site) throw new Error("Site not found");
    const deliveryConfig = publicationDeliveryConfig(site);
    const deliveryConfigHash = publicationDeliveryConfigHash(deliveryConfig);
    const legacyContentHash = publicationArtifactHash({
      ...article,
      publicationConfigHash: undefined,
    });
    if (
      article.status !== "ready" ||
      article.publicationGateStatus !== "passed" ||
      article.publicationAuditVersion !== PUBLICATION_AUDIT_VERSION ||
      article.publicationConfigHash !== deliveryConfigHash ||
      !article.auditedContentHash ||
      article.auditedContentHash !== legacyContentHash
    ) {
      throw new Error(
        "Article does not match the legacy deterministic-seal defect",
      );
    }
    const quality = evaluatePublicationQuality(article, "strict");
    if (!quality.passed) {
      throw new Error(
        `Legacy deterministic seal recovery failed strict quality: ${quality.issues.join(" ")}`,
      );
    }
    const contentHash = publicationArtifactHash(article);
    const checkedAt = now();
    await ctx.db.patch(articleId, {
      publicationGateIssues: quality.issues,
      publicationGateWarnings: quality.warnings,
      publicationCheckedAt: checkedAt,
      auditedContentHash: contentHash,
      auditedAt: checkedAt,
      updatedAt: checkedAt,
    });
    await syncSummary(ctx, articleId);
    return { articleId, contentHash, recovered: true };
  },
});

export const updateLinks = internalMutation({
  args: {
    articleId: v.id("articles"),
    internalLinks: v.array(
      v.object({
        anchor: v.string(),
        href: v.string(),
      }),
    ),
  },
  handler: async (ctx, { articleId, internalLinks }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published artifacts are immutable; create and audit a revision instead");
    }
    await ctx.db.patch(articleId, {
      internalLinks,
      auditedContentHash: undefined,
      auditedAt: undefined,
      publicationAuditVersion: undefined,
      publicationConfigHash: undefined,
      publicationConfigSnapshot: undefined,
      publicationGateStatus: undefined,
      publicationGateIssues: undefined,
      publicationGateWarnings: undefined,
      publicationCheckedAt: undefined,
      updatedAt: now(),
    });
    await syncSummary(ctx, articleId);
  },
});

// Internal links are injected after the generative review so that the exact
// Markdown which reaches the destination contains the links Pentra recorded.
// The mutation is atomic and only accepts a currently sealed artifact: a stale
// worker cannot modify or reseal a newer review.
export const applyInternalLinksToSealedArtifact = internalMutation({
  args: {
    articleId: v.id("articles"),
    expectedContentHash: v.string(),
    markdown: v.string(),
    internalLinks: v.array(
      v.object({
        anchor: v.string(),
        href: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published artifacts require an audited revision");
    }
    if (
      article.auditedContentHash !== args.expectedContentHash ||
      article.publicationAuditVersion !== PUBLICATION_AUDIT_VERSION ||
      article.publicationGateStatus !== "passed" ||
      publicationArtifactHash(article) !== args.expectedContentHash
    ) {
      throw new Error("Internal links can only be applied to the exact sealed review");
    }

    const site = await ctx.db.get(article.siteId);
    if (!site) throw new Error("Site not found");
    const deliveryConfig = publicationDeliveryConfig(site);
    const deliveryConfigHash = publicationDeliveryConfigHash(deliveryConfig);
    if (article.publicationConfigHash !== deliveryConfigHash) {
      throw new Error("Publication destination changed after the article review");
    }

    const candidate = {
      ...article,
      markdown: args.markdown,
      internalLinks: args.internalLinks,
      publicationConfigHash: deliveryConfigHash,
    };
    const quality = evaluatePublicationQuality(candidate, "strict");
    const readyForPublication = quality.passed;
    const contentHash = readyForPublication
      ? publicationArtifactHash(candidate)
      : undefined;
    const checkedAt = now();

    await ctx.db.patch(args.articleId, {
      markdown: args.markdown,
      internalLinks: args.internalLinks,
      publicationGateStatus: readyForPublication ? "passed" : "blocked",
      publicationGateIssues: quality.issues,
      publicationGateWarnings: quality.warnings,
      publicationCheckedAt: checkedAt,
      publicationAuditVersion: readyForPublication
        ? PUBLICATION_AUDIT_VERSION
        : undefined,
      publicationConfigHash: readyForPublication
        ? deliveryConfigHash
        : undefined,
      publicationConfigSnapshot: readyForPublication
        ? deliveryConfig
        : undefined,
      auditedContentHash: contentHash,
      auditedAt: readyForPublication ? checkedAt : undefined,
      updatedAt: checkedAt,
    });
    await syncSummary(ctx, args.articleId);

    return {
      count: args.internalLinks.length,
      readyForPublication,
      contentHash,
      issues: quality.issues,
    };
  },
});

export const updateFeaturedImage = internalMutation({
  args: { articleId: v.id("articles"), featuredImage: v.string() },
  handler: async (ctx, { articleId, featuredImage }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published artifacts are immutable; create and audit a revision instead");
    }
    await ctx.db.patch(articleId, {
      featuredImage,
      auditedContentHash: undefined,
      auditedAt: undefined,
      publicationAuditVersion: undefined,
      publicationConfigHash: undefined,
      publicationConfigSnapshot: undefined,
      publicationGateStatus: undefined,
      publicationGateIssues: undefined,
      publicationGateWarnings: undefined,
      publicationCheckedAt: undefined,
      updatedAt: now(),
    });
    await syncSummary(ctx, articleId);
  },
});

export const approve = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    await requireArticleOwner(ctx, article);
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Article is already published");
    }
    await ctx.db.patch(articleId, { status: "ready", updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

export const reject = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    await requireArticleOwner(ctx, article);
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Cannot reject a published article");
    }
    await ctx.db.patch(articleId, { status: "rejected", updatedAt: now() });
    await syncSummary(ctx, articleId);
  },
});

// Count article generations this calendar month (immutable — deletions don't reduce count)
export const countThisMonth = query({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.subject !== userId) {
      throw new Error("Not authorized to read this usage");
    }
    return countThisMonthHandler(ctx, userId);
  },
});

async function countThisMonthHandler(ctx: QueryCtx, userId: string) {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).getTime();

    const logs = await ctx.db
      .query("usage_log")
      .withIndex("by_user_type_created", (q) =>
        q
          .eq("userId", userId)
          .eq("type", "article_generated")
          .gte("createdAt", monthStart),
      )
      .collect();
    const currentTime = Date.now();
    return logs.filter(
      (log) =>
        log.state !== "reserved" || (log.expiresAt ?? Infinity) > currentTime,
    ).length;
}

export const countThisMonthInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => countThisMonthHandler(ctx, userId),
});

export const deleteArticle = mutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    await requireArticleOwner(ctx, article);
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published audit evidence is immutable and cannot be deleted");
    }
    const summary = await ctx.db
      .query("article_summaries")
      .withIndex("by_article", (q) => q.eq("articleId", articleId))
      .first();
    if (summary) await ctx.db.delete(summary._id);
    await ctx.db.delete(articleId);
    if (article.topicId) {
      await reconcileTopicLifecycle(ctx, {
        siteId: article.siteId,
        topicId: article.topicId,
      });
    }
  },
});

export const updateContentScore = internalMutation({
  args: {
    articleId: v.id("articles"),
    contentScore: v.optional(v.number()),
    entityCoverage: v.optional(v.number()),
    topicCompleteness: v.optional(v.number()),
    missingEntities: v.optional(v.array(v.string())),
    missingTopics: v.optional(v.array(v.string())),
    serpDifficulty: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { articleId, ...scores } = args;
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published artifacts are immutable; score a new revision instead");
    }
    const patch: Partial<Doc<"articles">> = {
      auditedContentHash: undefined,
      auditedAt: undefined,
      publicationAuditVersion: undefined,
      publicationConfigHash: undefined,
      publicationConfigSnapshot: undefined,
      publicationGateStatus: undefined,
      publicationGateIssues: undefined,
      publicationGateWarnings: undefined,
      publicationCheckedAt: undefined,
      ...(scores.contentScore !== undefined
        ? { contentScore: scores.contentScore }
        : {}),
      ...(scores.entityCoverage !== undefined
        ? { entityCoverage: scores.entityCoverage }
        : {}),
      ...(scores.topicCompleteness !== undefined
        ? { topicCompleteness: scores.topicCompleteness }
        : {}),
      ...(scores.missingEntities !== undefined
        ? { missingEntities: scores.missingEntities }
        : {}),
      ...(scores.missingTopics !== undefined
        ? { missingTopics: scores.missingTopics }
        : {}),
      ...(scores.serpDifficulty !== undefined
        ? { serpDifficulty: scores.serpDifficulty }
        : {}),
      updatedAt: Date.now(),
    };
    await ctx.db.patch(articleId, patch);
    await syncSummary(ctx, articleId);
  },
});

export const updateBacklinks = internalMutation({
  args: {
    articleId: v.id("articles"),
    backlinkSuggestions: v.array(
      v.object({
        site: v.string(),
        reason: v.string(),
        anchor: v.string(),
        targetUrl: v.string(),
      }),
    ),
  },
  handler: async (ctx, { articleId, backlinkSuggestions }) => {
    await ctx.db.patch(articleId, { backlinkSuggestions, updatedAt: Date.now() });
    await syncSummary(ctx, articleId);
  },
});

// ── Content Decay Tracking ──

export const updateDecayStatus = internalMutation({
  args: {
    articleId: v.id("articles"),
    decayStatus: v.string(),
    decayReason: v.optional(v.string()),
    decayDetectedAt: v.optional(v.number()),
    positionHistory: v.optional(v.array(v.object({
      date: v.string(),
      position: v.number(),
      clicks: v.number(),
      impressions: v.number(),
    }))),
  },
  handler: async (ctx, { articleId, decayStatus, decayReason, decayDetectedAt, positionHistory }) => {
    const patch: Partial<Doc<"articles">> = {
      decayStatus,
      updatedAt: Date.now(),
    };
    if (decayReason !== undefined) patch.decayReason = decayReason;
    if (decayDetectedAt !== undefined) patch.decayDetectedAt = decayDetectedAt;
    if (positionHistory !== undefined) patch.positionHistory = positionHistory;
    await ctx.db.patch(articleId, patch);
    await syncSummary(ctx, articleId);
  },
});

export const markRefreshing = internalMutation({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published artifacts are immutable; autonomous refresh is disabled");
    }
    await ctx.db.patch(articleId, {
      decayStatus: "refreshing",
      previousVersion: article.markdown,
      updatedAt: Date.now(),
    });
    await syncSummary(ctx, articleId);
  },
});

export const completeRefresh = internalMutation({
  args: {
    articleId: v.id("articles"),
    markdown: v.string(),
    wordCount: v.optional(v.number()),
    readingTime: v.optional(v.number()),
    sources: v.optional(v.array(v.object({ url: v.string(), title: v.optional(v.string()) }))),
    factCheckScore: v.optional(v.number()),
    factCheckNotes: v.optional(v.string()),
  },
  handler: async (ctx, { articleId, markdown, wordCount, readingTime, sources, factCheckScore, factCheckNotes }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    assertNotPublishing(article);
    if (article.status === "published") {
      throw new Error("Published artifacts are immutable; autonomous refresh is disabled");
    }
    const patch: Partial<Doc<"articles">> = {
      markdown,
      decayStatus: "refreshed",
      lastRefreshedAt: Date.now(),
      refreshCount: (article.refreshCount ?? 0) + 1,
      auditedContentHash: undefined,
      auditedAt: undefined,
      publicationAuditVersion: undefined,
      publicationConfigHash: undefined,
      publicationConfigSnapshot: undefined,
      publicationGateStatus: undefined,
      publicationGateIssues: undefined,
      publicationGateWarnings: undefined,
      publicationCheckedAt: undefined,
      updatedAt: Date.now(),
    };
    if (wordCount !== undefined) patch.wordCount = wordCount;
    if (readingTime !== undefined) patch.readingTime = readingTime;
    if (sources !== undefined) patch.sources = sources;
    if (factCheckScore !== undefined) patch.factCheckScore = factCheckScore;
    if (factCheckNotes !== undefined) patch.factCheckNotes = factCheckNotes;
    await ctx.db.patch(articleId, patch);
    await syncSummary(ctx, articleId);
  },
});

// Get articles flagged for decay (for dashboard display)
export const listDecaying = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    await requireSiteOwner(ctx, siteId);
    return listDecayingHandler(ctx, siteId);
  },
});

async function listDecayingHandler(
  ctx: QueryCtx,
  siteId: Doc<"sites">["_id"],
) {
    const summaries = await ctx.db
      .query("article_summaries")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .collect();
    return summaries
      .filter((summary) =>
        summary.decayStatus === "warning" || summary.decayStatus === "declining"
      )
      .map(summaryListItem);
}

export const listDecayingInternal = internalQuery({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => listDecayingHandler(ctx, siteId),
});

// Admin: reset usage log for a user (temporary — remove after use)
export const resetUsageLog = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const logs = await ctx.db
      .query("usage_log")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const log of logs) {
      await ctx.db.delete(log._id);
    }
    return { deleted: logs.length };
  },
});

// Resumable, explicitly invoked compatibility migration. Published legacy
// rows use immutable createdAt as the conservative publication-time proxy and summaries
// are created in small pages. It never changes a job status: old delivery
// failures require an explicit operator decision and cannot resurrect during
// a deployment.
export const migrateLegacyArticles = internalMutation({
  args: {
    phase: v.optional(v.union(v.literal("articles"), v.literal("jobs"))),
    cursor: v.optional(v.string()),
    runToken: v.optional(v.string()),
    articlesProcessed: v.optional(v.number()),
    jobsProcessed: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    completed: boolean;
    phase: "articles" | "jobs";
    migrated: number;
    inProgress?: boolean;
    superseded?: boolean;
  }> => {
    const nowAt = Date.now();
    const migrationLeaseMs = 15 * 60 * 1000;
    let phase: "articles" | "jobs" = "articles";
    let cursor = args.cursor;
    let articlesProcessed = args.articlesProcessed ?? 0;
    let jobsProcessed = args.jobsProcessed ?? 0;
    let runToken = args.runToken;
    let state = await ctx.db
      .query("maintenance_state")
      .withIndex("by_key", (q) =>
        q.eq("key", PUBLICATION_INTEGRITY_MIGRATION_KEY),
      )
      .first();

    if (!runToken && state?.status === "completed") {
      return { completed: true, phase, migrated: 0 };
    }

    if (!runToken) {
      if (
        state?.status === "running" &&
        nowAt - (state.heartbeatAt ?? state.updatedAt) < migrationLeaseMs
      ) {
        return { completed: false, phase, migrated: 0, inProgress: true };
      }

      // Starting over after a stale lease is safe: both summary upserts and
      // legacy-job rewrites are idempotent. A run token prevents duplicate
      // scheduled page chains from racing each other.
      runToken = `${nowAt}:${state?._id ?? "initial"}`;
      phase = "articles";
      cursor = undefined;
      articlesProcessed = 0;
      jobsProcessed = 0;
      const runningFields = {
        status: "running",
        detail: "Backfilling compact article summaries (jobs remain untouched).",
        runToken,
        phase,
        cursor: undefined,
        startedAt: nowAt,
        heartbeatAt: nowAt,
        articlesProcessed,
        jobsProcessed,
        completedAt: undefined,
        updatedAt: nowAt,
      };
      if (state) {
        await ctx.db.patch(state._id, runningFields);
      } else {
        const stateId = await ctx.db.insert("maintenance_state", {
          key: PUBLICATION_INTEGRITY_MIGRATION_KEY,
          ...runningFields,
        });
        state = await ctx.db.get(stateId);
      }
    } else if (
      !state ||
      state.status !== "running" ||
      state.runToken !== runToken
    ) {
      return {
        completed: state?.status === "completed",
        phase,
        migrated: 0,
        superseded: true,
      };
    }

    if (!state || !runToken) {
      throw new Error("Failed to establish the publication-integrity migration lease");
    }

    if (phase === "articles") {
      const page = await ctx.db.query("articles").paginate({
        cursor: cursor ?? null,
        numItems: 10,
      });
      let migrated = 0;
      for (const article of page.page) {
        if (article.status === "published" && !article.publishedAt) {
          // Legacy rows have no sealed delivery receipt. Their mutable
          // updatedAt may reflect this migration or an audit, not delivery.
          await ctx.db.patch(article._id, { publishedAt: article.createdAt });
        }
        await syncSummary(ctx, article._id);
        migrated += 1;
      }
      articlesProcessed += migrated;
      if (!page.isDone) {
        await ctx.db.patch(state._id, {
          status: "running",
          phase: "articles",
          cursor: page.continueCursor,
          heartbeatAt: Date.now(),
          articlesProcessed,
          jobsProcessed,
          updatedAt: Date.now(),
        });
        await ctx.scheduler.runAfter(100, internal.articles.migrateLegacyArticles, {
          phase: "articles",
          cursor: page.continueCursor,
          runToken,
          articlesProcessed,
          jobsProcessed,
        });
      } else {
        const completedAt = Date.now();
        await ctx.db.patch(state._id, {
          status: "completed",
          detail: `Legacy migration completed: ${articlesProcessed} article rows checked; jobs were not modified.`,
          runToken: undefined,
          phase: "articles",
          cursor: undefined,
          heartbeatAt: completedAt,
          articlesProcessed,
          jobsProcessed: 0,
          updatedAt: completedAt,
          completedAt,
        });
        return { completed: true, phase: "articles", migrated };
      }
      return { completed: false, phase, migrated };
    }

    // Legacy callers that persisted a jobs phase are redirected to a fresh,
    // article-only run; this branch must never touch the jobs table.
    await ctx.db.patch(state._id, {
      phase: "articles",
      cursor: undefined,
      heartbeatAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.articles.migrateLegacyArticles, {
      phase: "articles",
      runToken,
      articlesProcessed,
      jobsProcessed: 0,
    });
    return { completed: false, phase: "articles", migrated: 0 };
  },
});
