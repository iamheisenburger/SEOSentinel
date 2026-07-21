import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sites: defineTable({
    userId: v.optional(v.string()), // Clerk user ID
    domain: v.string(),
    niche: v.optional(v.string()),
    tone: v.optional(v.string()),
    language: v.optional(v.string()),
    cadencePerWeek: v.optional(v.number()),
    autopilotEnabled: v.optional(v.boolean()),
    // Internal release control. Undefined is fail-closed (observe only).
    // Only a single site may be warm/live at a time while the shared account
    // is under constrained rollout.
    autopilotRolloutMode: v.optional(v.string()), // observe | warm | live
    autopilotRolloutEpoch: v.optional(v.number()),
    autopilotRolloutStartedAt: v.optional(v.number()),
    publicationLeaseOwner: v.optional(v.string()),
    publicationLeaseExpiresAt: v.optional(v.number()),
    inferToneNiche: v.optional(v.boolean()),
    approvalRequired: v.optional(v.boolean()),
    repoOwner: v.optional(v.string()),
    repoName: v.optional(v.string()),
    repoDefaultBranch: v.optional(v.string()),
    githubToken: v.optional(v.string()),

    // ── Publishing platform ──
    publishMethod: v.optional(v.string()), // "github" | "wordpress" | "webhook" | "manual"
    wpUrl: v.optional(v.string()),
    wpUsername: v.optional(v.string()),
    wpAppPassword: v.optional(v.string()),
    webhookUrl: v.optional(v.string()),
    webhookSecret: v.optional(v.string()),

    // ── AI-analyzed site profile (populated after crawl) ──
    siteName: v.optional(v.string()),
    siteType: v.optional(v.string()), // SaaS, E-commerce, Blog, Agency, etc.
    siteSummary: v.optional(v.string()),
    blogTheme: v.optional(v.string()), // what the blog should focus on
    keyFeatures: v.optional(v.array(v.string())),
    pricingInfo: v.optional(v.string()), // pricing summary
    founders: v.optional(v.string()),

    // ── Target audience ──
    targetCountry: v.optional(v.string()),
    targetAudienceSummary: v.optional(v.string()),
    painPoints: v.optional(v.array(v.string())),
    productUsage: v.optional(v.string()), // how audience uses the product

    // ── Competitors ──
    competitors: v.optional(v.array(v.string())), // domains to never mention

    // ── Content settings ──
    ctaText: v.optional(v.string()),
    ctaUrl: v.optional(v.string()),
    imageBrandingPrompt: v.optional(v.string()),
    // ── Brand / Visual Identity (populated by programmatic crawl) ──
    brandPrimaryColor: v.optional(v.string()),   // hex, e.g. "#F97316"
    brandAccentColor: v.optional(v.string()),    // hex
    brandFontFamily: v.optional(v.string()),     // e.g. "Inter"
    brandLogoUrl: v.optional(v.string()),        // absolute URL to logo
    anchorKeywords: v.optional(v.array(v.string())), // priority backlink keywords
    externalLinking: v.optional(v.boolean()),
    sourceCitations: v.optional(v.boolean()),
    youtubeEmbeds: v.optional(v.boolean()),
    verifiedKeywordDataRequired: v.optional(v.boolean()),
    urlStructure: v.optional(v.string()), // e.g. /blog/[slug]

    // ── Google Search Console ──
    gscAccessToken: v.optional(v.string()),
    gscRefreshToken: v.optional(v.string()),
    gscProperty: v.optional(v.string()), // e.g. "sc-domain:example.com"
    gscEmail: v.optional(v.string()),
    gscConnectedAt: v.optional(v.number()),

    // ── Content Syndication ──
    mediumToken: v.optional(v.string()),       // Medium integration token
    linkedinAccessToken: v.optional(v.string()), // LinkedIn OAuth access token
    syndicationEnabled: v.optional(v.boolean()), // auto-syndicate on publish

    // ── Plan features (synced from Clerk) ──
    planFeatures: v.optional(v.array(v.string())), // e.g. ["max_sites_3", "max_articles_25"]

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_domain", ["domain"])
    .index("by_user", ["userId"])
    .index("by_autopilot", ["autopilotEnabled"])
    .index("by_rollout", ["autopilotRolloutMode", "autopilotEnabled"]),

  pages: defineTable({
    siteId: v.id("sites"),
    url: v.string(),
    slug: v.string(),
    title: v.optional(v.string()),
    keywords: v.optional(v.array(v.string())),
    summary: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_site", ["siteId"]),

  topic_clusters: defineTable({
    siteId: v.id("sites"),
    label: v.string(),
    primaryKeyword: v.string(),
    secondaryKeywords: v.array(v.string()),
    intent: v.optional(v.string()),
    priority: v.optional(v.number()),
    status: v.optional(v.string()), // pending | queued | planned | used
    articleType: v.optional(v.string()), // standard | listicle | how-to | checklist | comparison | roundup | ultimate-guide
    notes: v.optional(v.string()),

    // ── SEO Metrics (populated by DataForSEO or AI estimation) ──
    searchVolume: v.optional(v.number()), // monthly search volume
    keywordDifficulty: v.optional(v.number()), // 0-100 difficulty score
    cpc: v.optional(v.number()), // cost per click USD
    serpIntent: v.optional(v.string()), // SERP-analyzed intent
    recommendedArticleType: v.optional(v.string()), // SERP-based recommendation
    paaQuestions: v.optional(v.array(v.string())), // People Also Ask questions
    volumeTrend: v.optional(v.array(v.number())), // last 12 months search volume

    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_site", ["siteId"]),

  articles: defineTable({
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
    articleType: v.optional(v.string()), // standard | listicle | how-to | checklist | comparison | roundup | ultimate-guide
    status: v.string(), // draft | review | ready | published
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
    claimEvidence: v.optional(
      v.array(
        v.object({
          claim: v.string(),
          citationNumbers: v.array(v.number()),
          supported: v.boolean(),
          reason: v.string(),
        }),
      ),
    ),
    claimEvidenceStatus: v.optional(v.string()), // passed | failed
    internalLinks: v.optional(
      v.array(
        v.object({
          anchor: v.string(),
          href: v.string(),
        }),
      ),
    ),
    featuredImage: v.optional(v.string()), // URL of AI-generated hero image
    reviewedMediaUrls: v.optional(v.array(v.string())),
    readingTime: v.optional(v.number()), // estimated minutes to read
    wordCount: v.optional(v.number()), // total word count
    factCheckScore: v.optional(v.number()), // 0-100 overall confidence
    factCheckNotes: v.optional(v.string()),
    editorialQualityScore: v.optional(v.number()), // 0-100 people-first editorial review
    editorialQualityNotes: v.optional(v.array(v.string())),
    mediaQualityStatus: v.optional(v.string()), // passed | failed
    mediaQualityNotes: v.optional(v.array(v.string())),
    productEvidenceStatus: v.optional(v.string()), // passed | not_applicable | failed
    publicationGateStatus: v.optional(v.string()), // passed | blocked
    publicationGateIssues: v.optional(v.array(v.string())),
    publicationGateWarnings: v.optional(v.array(v.string())),
    publicationCheckedAt: v.optional(v.number()),
    publicationAuditVersion: v.optional(v.number()),
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
    auditedContentHash: v.optional(v.string()),
    auditedAt: v.optional(v.number()),
    publishedContentHash: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    publicationDate: v.optional(v.number()),
    publicationDeliveryHash: v.optional(v.string()),
    publicationLeaseHash: v.optional(v.string()),
    publicationLeaseOwner: v.optional(v.string()),
    publicationLeaseStartedAt: v.optional(v.number()),
    qualityRevisionCount: v.optional(v.number()),

    // ── Content SEO Score (computed after generation) ──
    contentScore: v.optional(v.number()), // 0-100 overall SEO content score
    entityCoverage: v.optional(v.number()), // 0-100 entity coverage vs SERP
    topicCompleteness: v.optional(v.number()), // 0-100 topic coverage vs SERP
    missingEntities: v.optional(v.array(v.string())), // entities to add
    missingTopics: v.optional(v.array(v.string())), // subtopics to add
    serpDifficulty: v.optional(v.string()), // easy | medium | hard | very_hard

    backlinkSuggestions: v.optional(
      v.array(
        v.object({
          site: v.string(),
          reason: v.string(),
          anchor: v.string(),
          targetUrl: v.string(),
        }),
      ),
    ),

    // ── Content Decay Tracking ──
    decayStatus: v.optional(v.string()), // "healthy" | "warning" | "declining" | "refreshing" | "refreshed"
    decayDetectedAt: v.optional(v.number()),
    decayReason: v.optional(v.string()),
    positionHistory: v.optional(v.array(v.object({
      date: v.string(),
      position: v.number(),
      clicks: v.number(),
      impressions: v.number(),
    }))),
    lastRefreshedAt: v.optional(v.number()),
    refreshCount: v.optional(v.number()),
    previousVersion: v.optional(v.string()), // stores markdown before refresh

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site", ["siteId"])
    .index("by_site_status_created", ["siteId", "status", "createdAt"])
    .index("by_site_slug", ["siteId", "slug"])
    .index("by_topic", ["topicId"]),

  // Compact projection used by list/dashboard/cron flows. Article bodies stay
  // in `articles` and are only read when a single article is opened or edited.
  article_summaries: defineTable({
    articleId: v.id("articles"),
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
    articleType: v.optional(v.string()),
    status: v.string(),
    title: v.string(),
    slug: v.string(),
    metaTitle: v.optional(v.string()),
    metaDescription: v.optional(v.string()),
    metaKeywords: v.optional(v.array(v.string())),
    language: v.optional(v.string()),
    featuredImage: v.optional(v.string()),
    readingTime: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    factCheckScore: v.optional(v.number()),
    contentScore: v.optional(v.number()),
    editorialQualityScore: v.optional(v.number()),
    editorialQualityNotes: v.optional(v.array(v.string())),
    mediaQualityStatus: v.optional(v.string()),
    mediaQualityNotes: v.optional(v.array(v.string())),
    productEvidenceStatus: v.optional(v.string()),
    claimEvidenceStatus: v.optional(v.string()),
    publicationGateStatus: v.optional(v.string()),
    publicationGateIssues: v.optional(v.array(v.string())),
    publicationGateWarnings: v.optional(v.array(v.string())),
    publicationCheckedAt: v.optional(v.number()),
    publicationAuditVersion: v.optional(v.number()),
    publicationConfigHash: v.optional(v.string()),
    auditedContentHash: v.optional(v.string()),
    auditedAt: v.optional(v.number()),
    publishedContentHash: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    qualityRevisionCount: v.optional(v.number()),
    entityCoverage: v.optional(v.number()),
    topicCompleteness: v.optional(v.number()),
    serpDifficulty: v.optional(v.string()),
    decayStatus: v.optional(v.string()),
    decayDetectedAt: v.optional(v.number()),
    decayReason: v.optional(v.string()),
    lastRefreshedAt: v.optional(v.number()),
    refreshCount: v.optional(v.number()),
    articleCreatedAt: v.number(),
    articleUpdatedAt: v.number(),
  })
    .index("by_article", ["articleId"])
    .index("by_site", ["siteId"])
    .index("by_site_created", ["siteId", "articleCreatedAt"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_status_created", ["siteId", "status", "articleCreatedAt"])
    .index("by_site_status_published", ["siteId", "status", "publishedAt"])
    .index("by_site_slug", ["siteId", "slug"]),

  jobs: defineTable({
    siteId: v.optional(v.id("sites")),
    type: v.string(), // onboarding | plan | article | links | scheduler
    status: v.string(), // pending | running | done | failed
    payload: v.optional(v.any()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    retries: v.optional(v.number()), // number of retry attempts
    nextAttemptAt: v.optional(v.number()),
    workerToken: v.optional(v.string()),
    heartbeatAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    reservationId: v.optional(v.id("usage_log")),
    articleId: v.optional(v.id("articles")),
    rolloutEpoch: v.optional(v.number()),
    workerAttempts: v.optional(v.number()),
    publicationAttempts: v.optional(v.number()),
    stepProgress: v.optional(
      v.object({
        current: v.number(),
        total: v.number(),
        stepLabel: v.string(),
        topicLabel: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site", ["siteId"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_status_attempt", ["siteId", "status", "nextAttemptAt"])
    .index("by_site_type_created", ["siteId", "type", "createdAt"])
    .index("by_status", ["status"]),

  autopilot_runs: defineTable({
    siteId: v.id("sites"),
    trigger: v.string(), // natural | manual | recovery
    cronSlotUTC: v.optional(v.string()),
    scheduledAt: v.number(),
    startedAt: v.optional(v.number()),
    heartbeatAt: v.number(),
    completedAt: v.optional(v.number()),
    status: v.string(), // scheduled | running | completed | failed
    outcome: v.optional(v.string()),
    detail: v.optional(v.string()),
    jobId: v.optional(v.id("jobs")),
    articleId: v.optional(v.id("articles")),
  })
    .index("by_site", ["siteId"])
    .index("by_site_scheduled", ["siteId", "scheduledAt"])
    .index("by_status", ["status"]),

  autopilot_health: defineTable({
    siteId: v.id("sites"),
    lastNaturalScheduledAt: v.optional(v.number()),
    lastNaturalStartedAt: v.optional(v.number()),
    lastNaturalCompletedAt: v.optional(v.number()),
    lastRunId: v.optional(v.id("autopilot_runs")),
    heartbeatAt: v.number(),
    lastPublishedAt: v.optional(v.number()),
    nextPublicationDueAt: v.optional(v.number()),
    approvedBufferCount: v.optional(v.number()),
    bufferMinimum: v.optional(v.number()),
    bufferTarget: v.optional(v.number()),
    status: v.string(), // healthy | recovering | missed | scheduler_stale
    detail: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_site", ["siteId"]),

  autopilot_alerts: defineTable({
    siteId: v.id("sites"),
    runId: v.optional(v.id("autopilot_runs")),
    kind: v.string(),
    status: v.string(), // active | resolved
    message: v.string(),
    details: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_site", ["siteId"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_kind_status", ["siteId", "kind", "status"]),

  maintenance_state: defineTable({
    key: v.string(),
    status: v.string(),
    detail: v.optional(v.string()),
    runToken: v.optional(v.string()),
    phase: v.optional(v.string()),
    cursor: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    articlesProcessed: v.optional(v.number()),
    jobsProcessed: v.optional(v.number()),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_key", ["key"]),

  // Google Search Console performance snapshots (daily)
  search_performance: defineTable({
    siteId: v.id("sites"),
    date: v.string(), // ISO date "2026-03-12"
    query: v.string(), // search query
    page: v.optional(v.string()), // URL that appeared
    // Version 1 stored one overlapping 28-day aggregate under the window's
    // midpoint date. Version 2 stores actual daily GSC rows. Keeping the
    // version optional preserves the legacy evidence without mixing it into
    // daily/article-level reporting.
    syncVersion: v.optional(v.number()),
    syncedAt: v.optional(v.number()),
    clicks: v.number(),
    impressions: v.number(),
    ctr: v.number(), // 0-1
    position: v.number(), // average position
    createdAt: v.number(),
  })
    .index("by_site", ["siteId"])
    .index("by_site_date", ["siteId", "date"])
    .index("by_site_query", ["siteId", "query"])
    .index("by_site_date_query", ["siteId", "date", "query"])
    .index("by_site_version_date", ["siteId", "syncVersion", "date"])
    .index("by_site_version_date_query_page", [
      "siteId",
      "syncVersion",
      "date",
      "query",
      "page",
    ]),

  // Immutable usage log — tracks article generations (never deleted)
  usage_log: defineTable({
    userId: v.string(),
    siteId: v.optional(v.id("sites")),
    type: v.string(), // "article_generated" | "site_added"
    jobId: v.optional(v.id("jobs")),
    articleId: v.optional(v.id("articles")),
    state: v.optional(v.string()), // reserved | settled (legacy rows are settled)
    expiresAt: v.optional(v.number()),
    settledAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "type"])
    .index("by_user_type_created", ["userId", "type", "createdAt"])
    .index("by_job", ["jobId"])
    .index("by_state_expires", ["state", "expiresAt"]),
});
