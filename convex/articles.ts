import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  PUBLICATION_AUDIT_VERSION,
  publicationArtifactHash,
  publicationDeliveryConfig,
  publicationDeliveryConfigHash,
  publicationDeliveryEnvelopeHash,
} from "./lib/publicationArtifact";
import {
  acquirePublicationLease,
  ownsPublicationLease,
  PUBLICATION_LEASE_MS,
} from "./lib/publicationLease";
import { migrationBlocksAutopilot } from "./lib/autopilotBuffer";

const now = () => Date.now();
const PUBLICATION_INTEGRITY_MIGRATION_KEY = "publication-integrity-v4";
type ArticleSummaryFields = Omit<Doc<"article_summaries">, "_id" | "_creationTime">;

function summaryFields(article: Doc<"articles">): ArticleSummaryFields {
  return {
    articleId: article._id,
    siteId: article.siteId,
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
    qualityRevisionCount: article.qualityRevisionCount,
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
  if (article.publicationLeaseOwner || article.publicationLeaseHash) {
    throw new Error(
      "Article publication is in progress; content, workflow, and deletion are locked",
    );
  }
}

async function syncSummary(ctx: MutationCtx, articleId: Doc<"articles">["_id"]) {
  const article = await ctx.db.get(articleId);
  if (!article) return;

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
}

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
    qualityRevisionCount: summary.qualityRevisionCount,
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

async function listBySiteHandler(
  ctx: QueryCtx,
  siteId: Doc<"sites">["_id"],
) {
    const migrationState = await ctx.db
      .query("maintenance_state")
      .withIndex("by_key", (q) =>
        q.eq("key", PUBLICATION_INTEGRITY_MIGRATION_KEY),
      )
      .first();
    const summaries = migrationState?.status === "completed"
      ? await ctx.db
          .query("article_summaries")
          .withIndex("by_site_created", (q) => q.eq("siteId", siteId))
          .order("desc")
          .collect()
      : [];

    if (summaries.length > 0) {
      return summaries.map(summaryListItem);
    }

    // Safe migration fallback until the one-time production backfill runs.
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_site", (q) => q.eq("siteId", siteId))
      .order("desc")
      .collect();
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

export const getAutopilotState = internalQuery({
  args: { siteId: v.id("sites"), since: v.number() },
  handler: async (ctx, { siteId, since }) => {
    const [latestPublished, ready, review, recent, published, migrationState] =
      await Promise.all([
        ctx.db
          .query("article_summaries")
          .withIndex("by_site_status_published", (q) =>
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
        ctx.db
          .query("article_summaries")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", "review"),
          )
          .order("desc")
          .take(25),
        ctx.db
          .query("article_summaries")
          .withIndex("by_site_created", (q) =>
            q.eq("siteId", siteId).gte("articleCreatedAt", since),
          )
          .take(10),
        ctx.db
          .query("article_summaries")
          .withIndex("by_site_status", (q) =>
            q.eq("siteId", siteId).eq("status", "published"),
          )
          .order("desc")
          .take(50),
        ctx.db
          .query("maintenance_state")
          .withIndex("by_key", (q) =>
            q.eq("key", PUBLICATION_INTEGRITY_MIGRATION_KEY),
          )
          .first(),
      ]);
    // The explicit completion marker is the authority. Seeing one summary is
    // not enough: a crashed partial backfill may have many unsummarized legacy
    // rows, and cron must fail closed until the resumable migration completes.
    const hasAnyArticle = migrationState?.status !== "completed"
      ? !!(await ctx.db
          .query("articles")
          .withIndex("by_site", (q) => q.eq("siteId", siteId))
          .first())
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

// Persist the generated draft, usage settlement, topic transition, and job
// checkpoint in one serializable mutation. If a worker is reset, its old token
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
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.siteId !== args.siteId ||
      job.status !== "running" ||
      job.workerToken !== args.workerToken
    ) {
      throw new Error("Worker lease lost before generated draft checkpoint");
    }
    if (job.articleId) return job.articleId;

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
    const payload = job.payload && typeof job.payload === "object"
      ? (job.payload as Record<string, unknown>)
      : {};
    await ctx.db.patch(job._id, {
      articleId,
      payload: { ...payload, articleId },
      heartbeatAt: timestamp,
      updatedAt: timestamp,
    });
    if (args.topicId) {
      const topic = await ctx.db.get(args.topicId);
      if (topic?.siteId === args.siteId) {
        await ctx.db.patch(args.topicId, { status: "used", updatedAt: timestamp });
      }
    }
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
    await ctx.db.patch(articleId, {
      publicationGateStatus: status,
      publicationGateIssues: issues,
      publicationGateWarnings: warnings,
      publicationCheckedAt: now(),
      updatedAt: now(),
    });
    await syncSummary(ctx, articleId);
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
    const site = await ctx.db.get(article.siteId);
    if (
      !site ||
      !site.autopilotEnabled ||
      site.autopilotRolloutMode !== "live" ||
      (site.autopilotRolloutEpoch ?? 0) !== expectedRolloutEpoch
    ) {
      throw new Error("Publication blocked by the current rollout epoch");
    }
    const currentConfigHash = publicationDeliveryConfigHash(
      publicationDeliveryConfig(site),
    );
    if (
      currentConfigHash !== expectedConfigHash ||
      article.publicationConfigHash !== expectedConfigHash
    ) {
      throw new Error("Publication destination changed after quality audit");
    }
    if (
      site.publicationLeaseOwner &&
      (site.publicationLeaseExpiresAt ?? 0) > Date.now()
    ) {
      throw new Error("Another publication is already in progress for this site");
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
    const publicationDate = article.publicationDate ?? Date.now();
    const publicationDeliveryHash = publicationDeliveryEnvelopeHash({
      contentHash: expectedContentHash,
      configHash: expectedConfigHash,
      publicationDate,
      rolloutEpoch: expectedRolloutEpoch,
    });
    await ctx.db.patch(articleId, {
      ...lease.patch,
      publicationDate,
      publicationDeliveryHash,
      updatedAt: now(),
    });
    await ctx.db.patch(site._id, {
      publicationLeaseOwner: leaseOwner,
      publicationLeaseExpiresAt: Date.now() + 15 * 60 * 1000,
      updatedAt: now(),
    });
    await syncSummary(ctx, articleId);
    return { alreadyPublished: false, publicationDate, publicationDeliveryHash };
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
    },
  ) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    const persistedHash = publicationArtifactHash(article);
    if (
      article.auditedContentHash !== publishedContentHash ||
      article.publicationAuditVersion !== PUBLICATION_AUDIT_VERSION ||
      article.publicationGateStatus !== "passed" ||
      persistedHash !== publishedContentHash ||
      article.publicationDeliveryHash !== expectedDeliveryHash ||
      !ownsPublicationLease(article, {
        expectedContentHash: publishedContentHash,
        leaseOwner,
      })
    ) {
      throw new Error("Refusing to complete publication for an unsealed artifact");
    }
    const site = await ctx.db.get(article.siteId);
    const completedAt = now();
    const currentConfigHash = site
      ? publicationDeliveryConfigHash(publicationDeliveryConfig(site))
      : undefined;
    const expectedEnvelope = article.publicationDate
      ? publicationDeliveryEnvelopeHash({
          contentHash: publishedContentHash,
          configHash: expectedConfigHash,
          publicationDate: article.publicationDate,
          rolloutEpoch: expectedRolloutEpoch,
        })
      : undefined;
    if (
      !site ||
      !site.autopilotEnabled ||
      site.autopilotRolloutMode !== "live" ||
      (site.autopilotRolloutEpoch ?? 0) !== expectedRolloutEpoch ||
      currentConfigHash !== expectedConfigHash ||
      article.publicationConfigHash !== expectedConfigHash ||
      expectedEnvelope !== expectedDeliveryHash ||
      site.publicationLeaseOwner !== leaseOwner ||
      (site.publicationLeaseExpiresAt ?? 0) <= completedAt ||
      !article.publicationLeaseStartedAt ||
      completedAt - article.publicationLeaseStartedAt >= PUBLICATION_LEASE_MS
    ) {
      throw new Error("Refusing to complete publication after site lease loss");
    }
    await ctx.db.patch(articleId, {
      status: "published",
      publishedContentHash,
      publishedAt: completedAt,
      publicationLeaseHash: undefined,
      publicationLeaseOwner: undefined,
      publicationLeaseStartedAt: undefined,
      updatedAt: completedAt,
    });
    await ctx.db.patch(site._id, {
      publicationLeaseOwner: undefined,
      publicationLeaseExpiresAt: undefined,
      updatedAt: completedAt,
    });
    await syncSummary(ctx, articleId);
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
    await ctx.db.patch(articleId, {
      publicationLeaseHash: undefined,
      publicationLeaseOwner: undefined,
      publicationLeaseStartedAt: undefined,
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
    mediaQualityStatus: v.string(),
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
      }),
    ),
    qualityRevisionCount: v.number(),
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
      mediaQualityStatus: args.mediaQualityStatus,
      productEvidenceStatus: args.productEvidenceStatus,
      productEvidenceSnapshot: args.productEvidenceSnapshot,
      productEvidenceHash: args.productEvidenceHash,
      claimEvidence: args.claimEvidence,
      claimEvidenceStatus: args.claimEvidenceStatus,
      qualityRevisionCount: args.qualityRevisionCount,
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
    const patch: Record<string, any> = {
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
    for (const [k, val] of Object.entries(scores)) {
      if (val !== undefined) patch[k] = val;
    }
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
    const patch: Record<string, any> = { decayStatus, updatedAt: Date.now() };
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
    const patch: Record<string, any> = {
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
// rows use updatedAt as the documented publication-time proxy and summaries
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
          await ctx.db.patch(article._id, { publishedAt: article.updatedAt });
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
