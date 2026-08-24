import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sites: defineTable({
    userId: v.optional(v.string()), // Clerk user ID
    domain: v.string(),
    // Canonical hostname used for tenant ownership/collision checks. Legacy
    // rows are backfilled before this becomes the sole lookup key.
    canonicalDomain: v.optional(v.string()),
    domainOwnershipConflictAt: v.optional(v.number()),
    niche: v.optional(v.string()),
    tone: v.optional(v.string()),
    language: v.optional(v.string()),
    cadencePerWeek: v.optional(v.number()),
    // Customer intent is preserved separately from the effective account-wide
    // allocation so an upgrade can restore a cadence reduced by a downgrade.
    cadenceRequestedPerWeek: v.optional(v.number()),
    autopilotEnabled: v.optional(v.boolean()),
    // Per-tenant lifecycle. Undefined is fail-closed (observe only); ready
    // tenants advance observe -> warm -> live without a shared fleet canary.
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
    publicationAdapterVerifiedAt: v.optional(v.number()),
    publicationAdapterVersion: v.optional(v.string()),
    publicationAdapterConfigHash: v.optional(v.string()),

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
    // Compatibility-safe rollout for the measured expected-click scheduler.
    // Undefined/false preserves the established tenant cadence until a fresh
    // evidence inventory has been verified for that exact site.
    expectedClickSchedulingEnabled: v.optional(v.boolean()),
    // Durable one-shot operator marker for legacy tenants whose pre-reservation
    // plan history would otherwise block the first measured portfolio refresh.
    // The job and reservation remain independently auditable in their ledgers.
    expectedClickPlanMigrationVersion: v.optional(v.number()),
    expectedClickPlanMigrationJobId: v.optional(v.id("jobs")),
    expectedClickPlanMigrationReservedAt: v.optional(v.number()),
    // Synchronized migration mirror only. seo_growth_goals is the canonical
    // tenant outcome contract read by portfolio and growth health.
    organicClickGoalMonthly: v.optional(v.number()),
    // Fresh tenant authority measured on the same DataForSEO one-hundred
    // scale as every page-one competitor used by the expected-click audit.
    seoAuthorityDomainRank: v.optional(v.number()),
    seoAuthorityReferringDomains: v.optional(v.number()),
    seoAuthorityDomain: v.optional(v.string()),
    seoAuthoritySource: v.optional(v.string()),
    seoAuthorityMeasuredAt: v.optional(v.number()),
    // Tenant deletion is resumable because GSC/outcome histories can exceed a
    // single Convex transaction. Credentials are scrubbed immediately, then
    // every site-scoped table is drained in bounded batches.
    deletionStatus: v.optional(v.string()), // requested | running
    deletionRequestedAt: v.optional(v.number()),
    deletionRequestedBy: v.optional(v.string()),
    deletionStage: v.optional(v.number()),
    accountDeletionRequestedAt: v.optional(v.number()),
    // Set when this site falls outside the account's current canonical site
    // allowance. Parking preserves tenant data and credentials but every
    // execution path treats the site as inactive until a trusted plan sync
    // deterministically brings it back inside the allowance.
    planParkedAt: v.optional(v.number()),
    planAllowanceChangedAt: v.optional(v.number()),
    urlStructure: v.optional(v.string()), // e.g. /blog/[slug]

    // ── Google Search Console ──
    gscAccessToken: v.optional(v.string()),
    gscRefreshToken: v.optional(v.string()),
    gscProperty: v.optional(v.string()), // e.g. "sc-domain:example.com"
    gscEmail: v.optional(v.string()),
    gscScopes: v.optional(v.string()),
    gscConnectedAt: v.optional(v.number()),
    // Pointer to the latest recent phase plus a bounded per-date receipt
    // ledger. Staged rows from failed recent/backfill actions are invisible
    // until their exact dates are atomically advanced below.
    gscSyncEpoch: v.optional(v.string()),
    gscPendingSyncEpoch: v.optional(v.string()),
    gscPendingSyncMode: v.optional(v.string()),
    gscPendingWindowStart: v.optional(v.string()),
    gscPendingDataThrough: v.optional(v.string()),
    gscPendingStartedAt: v.optional(v.number()),
    // At most 56 finalized daily receipts. A row is visible only when its
    // date and epoch match this atomically advanced tenant-scoped ledger.
    gscDateEpochs: v.optional(v.array(v.object({
      date: v.string(),
      syncEpoch: v.string(),
    }))),
    gscDataWindowStart: v.optional(v.string()),
    gscDataThrough: v.optional(v.string()),
    gscHistoryDays: v.optional(v.number()),
    gscCompleteWindows: v.optional(v.array(v.number())),
    gscDataSyncedAt: v.optional(v.number()),
    gscQueryRows: v.optional(v.number()),
    gscPageRows: v.optional(v.number()),
    gscAnalyticsRequests: v.optional(v.number()),

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
    .index("by_canonical_domain", ["canonicalDomain"])
    .index("by_user", ["userId"])
    .index("by_autopilot", ["autopilotEnabled"])
    .index("by_rollout", ["autopilotRolloutMode", "autopilotEnabled"]),

  // Canonical account-level billing receipt. Site reconciliation is paged so
  // even an Enterprise account cannot make one mutation unbounded. While a
  // new receipt is reconciling, paid/write execution fails closed; the prior
  // tenant data remains readable and untouched.
  account_plan_entitlements: defineTable({
    userId: v.string(),
    planFeatures: v.array(v.string()),
    maxSites: v.number(),
    maxArticles: v.number(),
    syncVersion: v.number(),
    syncStartedAt: v.number(),
    authoritativeVerifiedAt: v.optional(v.number()),
    status: v.string(), // reconciling | completed | deleting
    cursor: v.optional(v.string()),
    remainingAllowance: v.number(),
    remainingArticleAllowance: v.optional(v.number()),
    allocatedMonthlyArticles: v.optional(v.number()),
    cadenceAllocationVersion: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status_updated", ["status", "updatedAt"]),

  // Durable, PII-minimized lifecycle for a verified Clerk user deletion.
  // Raw userId exists only while bounded revocation/purge work is unfinished;
  // completion clears it and retains only a one-way account key receipt.
  account_deletion_receipts: defineTable({
    accountKey: v.string(),
    userId: v.optional(v.string()),
    sourceEventKey: v.optional(v.string()),
    status: v.string(), // revoking | purging | scrubbing_receipts | completed
    siteCursor: v.optional(v.string()),
    receiptStage: v.optional(v.number()),
    sitesRevoked: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_account_key", ["accountKey"])
    .index("by_status_updated", ["status", "updatedAt"]),

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
    keywordDifficultyMeasured: v.optional(v.boolean()),
    cpc: v.optional(v.number()), // cost per click USD
    serpIntent: v.optional(v.string()), // SERP-analyzed intent
    recommendedArticleType: v.optional(v.string()), // SERP-based recommendation
    paaQuestions: v.optional(v.array(v.string())), // People Also Ask questions
    serpTopUrls: v.optional(v.array(v.string())), // normalized by the overlap gate
    volumeTrend: v.optional(v.array(v.number())), // last 12 months search volume
    searchDemandSource: v.optional(v.string()),
    searchDemandMeasuredAt: v.optional(v.number()),
    searchDemandLocationCode: v.optional(v.number()),
    searchDemandLanguageCode: v.optional(v.string()),
    // Lock a paid exact-keyword request before HTTP. The current
    // version/keyword marker prevents a lost response from being repurchased
    // by a later daily batch.
    searchDemandBackfillAttemptVersion: v.optional(v.number()),
    searchDemandBackfillAttemptJobId: v.optional(
      v.id("expected_click_demand_jobs"),
    ),
    searchDemandBackfillAttemptKeyword: v.optional(v.string()),
    searchDemandBackfillAttemptedAt: v.optional(v.number()),
    searchDemandBackfillVersion: v.optional(v.number()),
    searchDemandBackfillJobId: v.optional(
      v.id("expected_click_demand_jobs"),
    ),
    searchDemandBackfilledAt: v.optional(v.number()),
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
    expectedClickStatus: v.optional(v.string()), // eligible | insufficient_evidence
    expectedClickReasons: v.optional(v.array(v.string())),
    expectedClickAuditVersion: v.optional(v.number()),
    expectedClickAuditedAt: v.optional(v.number()),
    // Lock a live SERP purchase to one exact topic version before HTTP. A
    // failed or ambiguous version-1 attempt cannot be repurchased tomorrow.
    expectedClickEvidenceAttemptVersion: v.optional(v.number()),
    expectedClickEvidenceAttemptJobId: v.optional(
      v.id("expected_click_evidence_jobs"),
    ),
    expectedClickEvidenceAttemptKeyword: v.optional(v.string()),
    expectedClickEvidenceAttemptTopicUpdatedAt: v.optional(v.number()),
    expectedClickEvidenceAttemptedAt: v.optional(v.number()),
    // Evidence-only compatibility receipt for a legacy topic that still maps
    // to a published/current sealed artifact. The referenced job contains the
    // exact live SERP and authority snapshots used for this topic audit.
    expectedClickBackfillVersion: v.optional(v.number()),
    expectedClickBackfillJobId: v.optional(
      v.id("expected_click_evidence_jobs"),
    ),
    expectedClickBackfilledAt: v.optional(v.number()),

    // Deterministic, tenant-specific product-fit audit. The scheduler
    // revalidates legacy inventory before any article job can be queued.
    businessFitEligible: v.optional(v.boolean()),
    businessFitScore: v.optional(v.number()),
    businessFitVersion: v.optional(v.number()),
    businessFitReasons: v.optional(v.array(v.string())),
    businessFitCheckedAt: v.optional(v.number()),
    disqualifiedReason: v.optional(v.string()),

    // A one-shot, evidence-backed rescue for an empty cadence buffer. The
    // source job remains the audit authority; these fields only bind the exact
    // staged topic so a finalizer cannot touch ordinary tenant inventory.
    cadenceMicroSeedVersion: v.optional(v.number()),
    cadenceMicroSeedJobId: v.optional(v.id("cadence_micro_seed_jobs")),
    cadenceMicroSeedFingerprint: v.optional(v.string()),

    // Automatic planners durably stage exact measured candidates before the
    // first live SERP call. `plan_checkpoint` is intentionally outside the
    // scheduler/planned-recovery lifecycle until the owning plan is terminal.
    planCheckpointVersion: v.optional(v.number()),
    planCheckpointId: v.optional(v.id("plan_candidate_checkpoints")),
    planCheckpointJobId: v.optional(v.id("jobs")),
    planCheckpointWorkerExecution: v.optional(v.number()),
    planCheckpointSeedManifestHash: v.optional(v.string()),
    planCheckpointCandidateFingerprint: v.optional(v.string()),
    planCheckpointCandidateOrdinal: v.optional(v.number()),
    // Preserve the staged value used by the immutable fingerprint. Live SERP
    // analysis may later recommend and apply a different article type without
    // changing the paid candidate's identity.
    planCheckpointCandidateArticleType: v.optional(v.string()),
    planCheckpointSerpAttemptedAt: v.optional(v.number()),
    planCheckpointSerpReceipt: v.optional(v.object({
      version: v.number(),
      candidateFingerprint: v.string(),
      seedManifestHash: v.string(),
      workerExecution: v.number(),
      normalizedUrlFingerprint: v.string(),
      observedAt: v.number(),
      locationCode: v.number(),
      languageCode: v.string(),
      results: v.array(v.object({ position: v.number(), url: v.string() })),
      businessIntentAligned: v.literal(true),
      attainable: v.literal(true),
      cannibalizationClear: v.literal(true),
    })),
    planCheckpointTerminalFailureCode: v.optional(v.string()),
    planCheckpointActivatedAt: v.optional(v.number()),

    // A measured growth action may commission a support topic for one exact
    // published page. These fields are tenant-scoped routing metadata, not an
    // inferred cluster label. They let article generation and final linking
    // carry the recovery intent all the way to the published artifact.
    growthParentArticleId: v.optional(v.id("articles")),
    growthActionFingerprint: v.optional(v.string()),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site", ["siteId"])
    .index("by_site_growth_action_parent", [
      "siteId",
      "growthActionFingerprint",
      "growthParentArticleId",
    ]),

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
        rendererVersion: v.optional(v.string()),
        brandPrimaryColor: v.optional(v.string()),
        brandAccentColor: v.optional(v.string()),
        brandFontFamily: v.optional(v.string()),
      }),
    ),
    auditedContentHash: v.optional(v.string()),
    auditedAt: v.optional(v.number()),
    publishedContentHash: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    publicUrl: v.optional(v.string()),
    publicUrlStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("failed"),
    )),
    publicUrlLastCheckedAt: v.optional(v.number()),
    publicUrlVerifiedAt: v.optional(v.number()),
    publicUrlCheckAttempts: v.optional(v.number()),
    publicUrlCheckError: v.optional(v.string()),
    publicationReceipt: v.optional(
      v.object({
        method: v.union(v.literal("github"), v.literal("wordpress"), v.literal("webhook")),
        deliveryKey: v.string(),
        contentHash: v.string(),
        externalId: v.string(),
        url: v.string(),
        status: v.string(),
        receivedAt: v.number(),
      }),
    ),
    publicationDate: v.optional(v.number()),
    gscIndexVerdict: v.optional(v.string()),
    gscCoverageState: v.optional(v.string()),
    gscPageFetchState: v.optional(v.string()),
    gscRobotsTxtState: v.optional(v.string()),
    gscLastCrawlTime: v.optional(v.string()),
    gscInspectedAt: v.optional(v.number()),
    gscInspectionError: v.optional(v.string()),
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
    .index("by_site_delivery_hash", ["siteId", "publicationDeliveryHash"])
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
    publicUrl: v.optional(v.string()),
    publicUrlStatus: v.optional(v.union(
      v.literal("pending"),
      v.literal("verified"),
      v.literal("failed"),
    )),
    publicUrlLastCheckedAt: v.optional(v.number()),
    publicUrlVerifiedAt: v.optional(v.number()),
    publicUrlCheckAttempts: v.optional(v.number()),
    publicUrlCheckError: v.optional(v.string()),
    gscIndexVerdict: v.optional(v.string()),
    gscCoverageState: v.optional(v.string()),
    gscPageFetchState: v.optional(v.string()),
    gscRobotsTxtState: v.optional(v.string()),
    gscLastCrawlTime: v.optional(v.string()),
    gscInspectedAt: v.optional(v.number()),
    gscInspectionError: v.optional(v.string()),
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
    .index("by_site_status_audit_published", [
      "siteId",
      "status",
      "publicationAuditVersion",
      "publishedAt",
    ])
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
    // Budgeted topic plans (fleet or customer-triggered) reserve their complete
    // provider envelope before queueing. These immutable per-job values are
    // separate from article generation reservations and let tenant/day spend
    // gates include every replenishment reason and repeated UI click.
    providerCostCeilingMicroUsd: v.optional(v.number()),
    providerCostReservedMicroUsd: v.optional(v.number()),
    providerCostReservationDay: v.optional(v.string()),
    providerSpendReservationId: v.optional(
      v.id("provider_spend_reservations"),
    ),
    // Set only when the free provider-account preflight failed before the
    // first paid request. The immutable reservation receipt remains linked,
    // but released jobs do not consume plan/fleet headroom and may be retried
    // by the operator after funding is restored.
    providerReservationReleasedAt: v.optional(v.number()),
    providerReservationReleaseReason: v.optional(v.string()),
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

  // One immutable pre-SERP manifest per automatic plan execution. Candidate
  // rows live in topic_clusters so inline success and terminal recovery update
  // the same IDs; this row binds their order to the paid seed window.
  plan_candidate_checkpoints: defineTable({
    siteId: v.id("sites"),
    userId: v.string(),
    planJobId: v.id("jobs"),
    workerExecution: v.number(),
    // inline_sealed is verified but deliberately non-consumable until the
    // owning plan is marked done in the same mutation that promotes its rows.
    status: v.string(), // active | inline_sealed | inline_completed | activated | empty | terminal_blocked
    policyVersion: v.number(),
    rolloutEpoch: v.number(),
    providerSpendReservationId: v.id("provider_spend_reservations"),
    providerCostCeilingMicroUsd: v.number(),
    providerCostReservedMicroUsd: v.number(),
    reservationDay: v.string(),
    requiredVerifiedYield: v.number(),
    replenishmentSequence: v.number(),
    locationCode: v.number(),
    languageCode: v.string(),
    candidateCapacity: v.number(),
    seedBatches: v.array(v.array(v.string())),
    seedManifestHash: v.string(),
    candidateTopicIds: v.array(v.id("topic_clusters")),
    candidateFingerprints: v.array(v.string()),
    inlineCompletedTopicIds: v.optional(v.array(v.id("topic_clusters"))),
    terminallyExcludedTopicIds: v.optional(v.array(v.id("topic_clusters"))),
    activatedTopicIds: v.optional(v.array(v.id("topic_clusters"))),
    // Exact action-response recovery receipt for the mutation that promoted
    // sealed rows and completed the owning plan in one transaction.
    inlineSuccessCommitNonce: v.optional(v.string()),
    activationScheduledAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    activatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_plan_execution", ["planJobId", "workerExecution"])
    .index("by_plan_job", ["planJobId"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_created", ["siteId", "createdAt"]),

  // Immutable paid-execution receipts for article generation and quality/link
  // recovery. Rows are account-scoped rather than site-scoped on purpose: a
  // tenant cannot reset failed-attempt allowance by changing a domain or
  // deleting/recreating a site. Successful article quota remains exclusively
  // enforced by usage_log and is not changed by this ledger.
  article_generation_attempts: defineTable({
    userId: v.string(),
    jobKey: v.string(),
    workerAttempt: v.number(),
    attemptKey: v.string(),
    monthKey: v.string(),
    providerWorkKind: v.string(), // generation | quality_review | internal_links
    maxArticles: v.number(),
    attemptAllowance: v.number(),
    status: v.string(), // reserved | completed | failed | ambiguous
    expiresAt: v.optional(v.number()),
    settledAt: v.optional(v.number()),
    articleKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_attempt_key", ["attemptKey"])
    .index("by_user", ["userId"])
    .index("by_user_month", ["userId", "monthKey"])
    .index("by_user_status_expires", ["userId", "status", "expiresAt"])
    .index("by_status_expires", ["status", "expiresAt"]),

  autopilot_runs: defineTable({
    siteId: v.id("sites"),
    trigger: v.string(), // natural | manual | recovery
    // Immutable execution fence for exact scheduled recovery wakes. This is
    // not a credential; it binds one run to its plan, epoch, and due time.
    claimNonce: v.optional(v.string()),
    // Bounded durable continuation generation for exact scheduled wakes.
    continuationAttempt: v.optional(v.number()),
    // Immutable idempotency receipt for an operator recovery of one exact
    // failed run. Unlike `detail`, this field is never rewritten when a run
    // starts or finishes.
    recoveryOfRunId: v.optional(v.id("autopilot_runs")),
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
    .index("by_site_recovery_source", ["siteId", "recoveryOfRunId"])
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
    portfolioStatus: v.optional(v.string()),
    portfolioDecision: v.optional(v.string()),
    portfolioSupportsGoal: v.optional(v.boolean()),
    portfolioExpectedClicksMonthly: v.optional(v.number()),
    portfolioGoalMonthly: v.optional(v.number()),
    portfolioClickDeficit: v.optional(v.number()),
    portfolioEvidenceMissing: v.optional(v.number()),
    portfolioEvaluatedAt: v.optional(v.number()),
    portfolioVersion: v.optional(v.number()),
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

  // Search growth is a separate lifecycle from content generation. Each page
  // has at most one current measured action, with old actions retained as an
  // auditable history instead of being overwritten by the next cron run.
  seo_growth_actions: defineTable({
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    fingerprint: v.string(),
    stage: v.string(),
    actionKind: v.string(),
    status: v.string(), // monitoring | open | resolved | dismissed
    priority: v.number(),
    reason: v.string(),
    indexState: v.string(),
    evidence: v.object({
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
      unattributedClicks: v.optional(v.number()),
      unattributedImpressions: v.optional(v.number()),
      queryCoverageComplete: v.optional(v.boolean()),
      indexVerdict: v.optional(v.string()),
      coverageState: v.optional(v.string()),
      pageFetchState: v.optional(v.string()),
      robotsTxtState: v.optional(v.string()),
    }),
    automationStatus: v.optional(v.string()), // support lifecycle + executed/no_safe_candidate/bounded_wait/not_applicable
    automationDetail: v.optional(v.string()),
    automatedAt: v.optional(v.number()),
    discoveryRepairAttemptedAt: v.optional(v.number()),
    discoveryRepairVerifiedAt: v.optional(v.number()),
    discoveryRepairSitemapUrl: v.optional(v.string()),
    discoveryRepairDetail: v.optional(v.string()),
    authorityDiscoveryAttemptedAt: v.optional(v.number()),
    authorityDiscoveryVerifiedAt: v.optional(v.number()),
    authorityDiscoveryDetail: v.optional(v.string()),
    // Support delivery and immutable published revisions are separate phases.
    // This exact child-publication receipt lets a legacy `executed` support
    // action enter the revision lifecycle once without making `executed`
    // globally retryable or overwriting a terminal revision outcome.
    supportDeliveryReceipt: v.optional(v.object({
      articleId: v.id("articles"),
      method: v.union(
        v.literal("github"),
        v.literal("wordpress"),
        v.literal("webhook"),
      ),
      deliveryKey: v.string(),
      contentHash: v.string(),
      externalId: v.string(),
      status: v.string(),
      receivedAt: v.number(),
    })),
    supportDeliveryRecordedAt: v.optional(v.number()),
    publishedRevisionId: v.optional(v.id("published_article_revisions")),
    publishedRevisionAttemptedAt: v.optional(v.number()),
    publishedRevisionVerifiedAt: v.optional(v.number()),
    firstObservedAt: v.number(),
    lastObservedAt: v.number(),
    nextReviewAt: v.optional(v.number()),
    resolvedAt: v.optional(v.number()),
    resolution: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_fingerprint", ["fingerprint"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_priority", ["siteId", "status", "priority"])
    .index("by_article_status", ["articleId", "status"]),

  // Published article rows are immutable. Every post-publication growth edit
  // is instead an additive, receipt-verified revision chained to the exact
  // external artifact it observed. Base/next snapshots preserve rollback and
  // forensic evidence without mutating publication history.
  published_article_revisions: defineTable({
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    growthActionId: v.optional(v.id("seo_growth_actions")),
    actionFingerprint: v.string(),
    kind: v.union(
      v.literal("improve_snippet"),
      v.literal("strengthen_cluster"),
      v.literal("rollback"),
    ),
    revisionKey: v.string(),
    status: v.union(
      v.literal("prepared"),
      v.literal("leased"),
      v.literal("attempted"),
      v.literal("verification_pending"),
      v.literal("verified"),
      v.literal("failed"),
      v.literal("unverified"),
      v.literal("rolled_back"),
    ),
    rolloutEpoch: v.number(),
    publicationConfigHash: v.string(),
    publicationDate: v.number(),
    expectedPublicUrl: v.string(),
    baseAuditVersion: v.optional(v.number()),
    baseArtifactHash: v.string(),
    baseArtifact: v.any(),
    baseReceipt: v.object({
      method: v.union(v.literal("github"), v.literal("wordpress"), v.literal("webhook")),
      deliveryKey: v.string(),
      contentHash: v.string(),
      externalId: v.string(),
      url: v.string(),
      status: v.string(),
      receivedAt: v.number(),
    }),
    nextArtifactHash: v.string(),
    nextAuditVersion: v.optional(v.number()),
    nextArtifact: v.any(),
    targetArticleId: v.optional(v.id("articles")),
    targetUrl: v.optional(v.string()),
    targetLiveVerifiedAt: v.optional(v.number()),
    leaseOwner: v.optional(v.string()),
    leaseStartedAt: v.optional(v.number()),
    attempts: v.number(),
    attemptedAt: v.optional(v.number()),
    receipt: v.optional(v.object({
      method: v.union(v.literal("github"), v.literal("wordpress"), v.literal("webhook")),
      revisionKey: v.string(),
      deliveryKey: v.string(),
      baseContentHash: v.string(),
      baseExternalId: v.string(),
      contentHash: v.string(),
      externalId: v.string(),
      url: v.string(),
      status: v.string(),
      receivedAt: v.number(),
    })),
    deliveryVerifiedAt: v.optional(v.number()),
    liveVerificationAttempts: v.number(),
    liveVerificationLastCheckedAt: v.optional(v.number()),
    liveVerificationNextAt: v.optional(v.number()),
    liveVerificationLeaseOwner: v.optional(v.string()),
    liveVerificationLeaseExpiresAt: v.optional(v.number()),
    liveVerifiedAt: v.optional(v.number()),
    failureCode: v.optional(v.string()),
    failureDetail: v.optional(v.string()),
    rollbackOfRevisionId: v.optional(v.id("published_article_revisions")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["revisionKey"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_created", ["siteId", "createdAt"])
    .index("by_article_created", ["articleId", "createdAt"])
    .index("by_article_status_created", ["articleId", "status", "createdAt"])
    .index("by_status_next_verification", ["status", "liveVerificationNextAt"])
    .index("by_action", ["growthActionId"]),

  // Read-only proof that a legacy Pentra GitHub publication still matches its
  // immutable v4 semantic artifact, exact configured branch/path, embedded
  // delivery key, and live canonical URL. Failed attempts remain auditable;
  // no row in this ledger authorizes an external write.
  legacy_publication_receipt_adoptions: defineTable({
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    adoptionKey: v.string(),
    status: v.union(
      v.literal("leased"),
      v.literal("verified"),
      v.literal("failed"),
    ),
    rolloutEpoch: v.number(),
    publicationConfigHash: v.string(),
    publicationDate: v.number(),
    auditVersion: v.number(),
    artifactHash: v.string(),
    deliveryHash: v.string(),
    deliveryKey: v.string(),
    expectedPublicUrl: v.string(),
    leaseOwner: v.optional(v.string()),
    leaseStartedAt: v.optional(v.number()),
    attempts: v.number(),
    lastAttemptAt: v.number(),
    expectedExternalContentHash: v.optional(v.string()),
    externalBranchHead: v.optional(v.string()),
    externalFileSha: v.optional(v.string()),
    externalContentHash: v.optional(v.string()),
    receipt: v.optional(v.object({
      method: v.literal("github"),
      deliveryKey: v.string(),
      contentHash: v.string(),
      externalId: v.string(),
      url: v.string(),
      status: v.string(),
      receivedAt: v.number(),
    })),
    publicUrlVerifiedAt: v.optional(v.number()),
    failureCode: v.optional(v.string()),
    failureDetail: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["adoptionKey"])
    .index("by_article", ["articleId"])
    .index("by_site_created", ["siteId", "createdAt"])
    .index("by_site_updated", ["siteId", "lastAttemptAt"])
    .index("by_site_status", ["siteId", "status"]),

  seo_growth_health: defineTable({
    siteId: v.id("sites"),
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
    goalProgress: v.number(),
    outcomeStatus: v.string(), // awaiting_data | below_goal | goal_met
    articlesEvaluated: v.number(),
    indexedArticles: v.number(),
    stageCounts: v.object({
      awaitingData: v.number(),
      indexingPending: v.number(),
      indexingStalled: v.number(),
      noVisibility: v.number(),
      lowVisibility: v.number(),
      strikingDistance: v.number(),
      lowCtr: v.number(),
      performing: v.number(),
    }),
    openActions: v.number(),
    lastEvaluatedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_site", ["siteId"]),

  seo_growth_goals: defineTable({
    siteId: v.id("sites"),
    monthlyOrganicClicksGoal: v.number(),
    qualifiedActionsGoal: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_site", ["siteId"]),

  // Authority work is evidence-bearing and tenant-authorized. Pentra may
  // discover and verify a public opportunity autonomously; delivery requires
  // either one-message owner approval or the exact current account-autopilot
  // consent, and a link is acquired only with an exact live receipt.
  seo_authority_opportunities: defineTable({
    siteId: v.id("sites"),
    articleId: v.optional(v.id("articles")),
    fingerprint: v.string(),
    type: v.string(), // unlinked_mention | broken_link
    sourceDomain: v.string(),
    sourceUrl: v.string(),
    targetUrl: v.string(),
    context: v.string(),
    anchorText: v.optional(v.string()),
    relevanceTerms: v.optional(v.array(v.string())),
    domainRank: v.optional(v.number()),
    status: v.string(), // verified | outreach_prepared | contacted | acquired | rejected
    evidenceHash: v.string(),
    verifiedAt: v.number(),
    lastCheckedAt: v.number(),
    outreachPreparedAt: v.optional(v.number()),
    contactedAt: v.optional(v.number()),
    acquiredAt: v.optional(v.number()),
    acquiredLinkUrl: v.optional(v.string()),
    rejectedAt: v.optional(v.number()),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_fingerprint", ["fingerprint"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_article_status", ["articleId", "status"]),

  // Every provider-backed discovery attempt reserves its complete bounded
  // envelope before execution. Settled rows remain in the ledger so repeated
  // owner clicks and autonomous scans share the same per-site/fleet limits.
  seo_authority_runs: defineTable({
    siteId: v.id("sites"),
    userId: v.string(),
    articleId: v.optional(v.id("articles")),
    trigger: v.string(), // owner | growth
    mode: v.string(), // entitled | manual_canary (bounded included Free policy)
    policyVersion: v.number(),
    status: v.string(), // running | settled
    providerCostCeilingMicroUsd: v.number(),
    providerCostReservedMicroUsd: v.number(),
    providerSpendReservationId: v.id("provider_spend_reservations"),
    providerCallLimit: v.number(),
    openAiCallLimit: v.number(),
    candidateLimit: v.number(),
    pageFetchLimit: v.number(),
    totalDeadlineMs: v.number(),
    providerCallsAttempted: v.optional(v.number()),
    openAiCallsAttempted: v.optional(v.number()),
    candidatesConsidered: v.optional(v.number()),
    pageFetchesAttempted: v.optional(v.number()),
    profileComplete: v.optional(v.boolean()),
    mentionsApplicable: v.optional(v.boolean()),
    mentionsComplete: v.optional(v.boolean()),
    brokenLinksApplicable: v.optional(v.boolean()),
    brokenLinksComplete: v.optional(v.boolean()),
    verifiedOpportunities: v.optional(v.number()),
    outcome: v.optional(v.string()),
    errorCategory: v.optional(v.string()),
    expiresAt: v.number(),
    settledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_created", ["siteId", "createdAt"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_status_expires", ["status", "expiresAt"])
    .index("by_created", ["createdAt"]),

  // Durable cross-feature reservations for provider-backed work. This is a
  // fleet circuit breaker, while each source job/run retains its tenant policy
  // and result ledger. Tenant deletion scrubs the optional site reference but
  // retains the billing-window row so delete/recreate cannot reset allowance.
  provider_spend_reservations: defineTable({
    siteId: v.optional(v.id("sites")),
    userId: v.string(),
    purpose: v.string(), // topic_plan | authority_discovery | onboarding_analysis | expected_click_evidence_backfill | expected_click_demand_backfill | cadence_micro_seed | cadence_micro_seed_fallback
    trigger: v.string(),
    reservedMicroUsd: v.number(),
    reservationDay: v.string(),
    reservationMonth: v.string(),
    // Release is permitted only when the free account-balance preflight failed
    // before any paid provider call. Retaining this row keeps the decision
    // auditable without treating unspent capacity as consumed forever.
    releasedAt: v.optional(v.number()),
    releaseReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_user", ["userId"])
    .index("by_released", ["releasedAt"])
    .index("by_user_purpose_created", ["userId", "purpose", "createdAt"])
    .index("by_site_created", ["siteId", "createdAt"]),

  // Global, credential-free cursor receipts for the autonomous expected-click
  // fleet. A page is checkpointed before its continuation is scheduled, so a
  // transient scheduler failure or action crash can be resumed by the hourly
  // recovery sweep without creating provider work or losing later tenants.
  expected_click_fleet_dispatch_runs: defineTable({
    kind: v.string(), // daily | recovery
    dispatchKey: v.string(), // UTC day for daily; UTC hour for recovery
    status: v.string(), // running | completed
    cursor: v.optional(v.string()),
    pageCount: v.number(),
    scheduledSites: v.number(),
    failedSites: v.number(),
    continuationScheduleFailures: v.number(),
    resumeSchedules: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_kind_key", ["kind", "dispatchKey"])
    .index("by_status_updated", ["status", "updatedAt"]),

  // Resumable evidence-only measurement for legacy covered topics. Each job
  // owns one immutable shared-provider reservation and at most ten topics.
  // SERP snapshots are committed after each call, so an operator retry never
  // has to replay a successfully recorded topic request.
  expected_click_evidence_jobs: defineTable({
    siteId: v.id("sites"),
    userId: v.string(),
    status: v.string(), // pending | running | partial | completed | provider_balance_unavailable
    policyVersion: v.number(),
    origin: v.optional(v.string()), // operator_canary | autonomous_fleet
    rolloutEpoch: v.number(),
    reservationDay: v.string(),
    providerCostCeilingMicroUsd: v.number(),
    providerCostReservedMicroUsd: v.number(),
    providerSpendReservationId: v.id("provider_spend_reservations"),
    // New fleet jobs bind their paid evidence phase to the exact completed
    // demand phase, or to an atomic proof that no demand migration remained.
    // Optional only for compatibility with pre-fleet operator rows.
    demandPrerequisiteMode: v.optional(v.string()),
    demandPrerequisiteJobId: v.optional(
      v.id("expected_click_demand_jobs"),
    ),
    selectionScope: v.optional(v.union(
      v.literal("all_eligible"),
      v.literal("planned_unmaterialized"),
    )),
    plannedRecoveryInspectionKey: v.optional(v.string()),
    selectedTopics: v.array(v.object({
      topicId: v.id("topic_clusters"),
      // Missing kind is the legacy artifact representation. Planned inventory
      // uses its own exact fingerprint and deliberately has no article fields.
      targetKind: v.optional(v.union(
        v.literal("artifact"),
        v.literal("planned_topic"),
      )),
      articleId: v.optional(v.id("articles")),
      articleStatus: v.optional(v.string()),
      artifactHash: v.optional(v.string()),
      plannedTopicFingerprint: v.optional(v.string()),
      keyword: v.string(),
      label: v.string(),
      searchVolume: v.number(),
      priority: v.optional(v.number()),
      gscClicks: v.number(),
      gscImpressions: v.number(),
      gscPosition: v.optional(v.number()),
      selectionScore: v.number(),
      topicCreatedAt: v.number(),
      topicUpdatedAt: v.number(),
    })),
    candidateCounts: v.object({
      covered: v.number(),
      alreadyAudited: v.number(),
      alreadyAttempted: v.optional(v.number()),
      demandUnavailable: v.number(),
      businessFitBlocked: v.number(),
      eligible: v.number(),
      artifactEligible: v.optional(v.number()),
      plannedUnmaterialized: v.optional(v.number()),
      plannedGateBlocked: v.optional(v.number()),
    }),
    serpSnapshots: v.array(v.object({
      topicId: v.id("topic_clusters"),
      observedAt: v.number(),
      locationCode: v.optional(v.number()),
      languageCode: v.optional(v.string()),
      results: v.array(v.object({
        position: v.number(),
        url: v.string(),
      })),
      plannedValidationVersion: v.optional(v.number()),
      plannedBusinessIntentAligned: v.optional(v.boolean()),
      plannedAttainable: v.optional(v.boolean()),
      plannedCannibalizationClear: v.optional(v.boolean()),
    })),
    serpFailures: v.array(v.object({
      topicId: v.id("topic_clusters"),
      code: v.string(),
      recordedAt: v.number(),
    })),
    serpAttemptedTopicIds: v.array(v.id("topic_clusters")),
    authorityDomains: v.optional(v.array(v.string())),
    authorityEvidence: v.optional(v.array(v.object({
      domain: v.string(),
      domainRank: v.number(),
      referringDomains: v.optional(v.number()),
      source: v.string(),
      measuredAt: v.number(),
    }))),
    authoritySnapshotComplete: v.optional(v.boolean()),
    providerCallsAttempted: v.number(),
    providerCallsCompleted: v.number(),
    persistedTopics: v.optional(v.number()),
    insufficientTopics: v.optional(v.number()),
    skippedTopics: v.optional(v.number()),
    workerAttempts: v.number(),
    workerToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_day", ["siteId", "reservationDay"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_origin_status", ["siteId", "origin", "status"])
    .index("by_site_created", ["siteId", "createdAt"]),

  // One exact DataForSEO search-volume task for at most ten existing covered
  // keywords. Keyword attempts are durable before HTTP so ambiguous paid
  // responses are never silently replayed.
  expected_click_demand_jobs: defineTable({
    siteId: v.id("sites"),
    userId: v.string(),
    status: v.string(), // pending | running | partial | completed | provider_balance_unavailable | provider_response_unverified
    policyVersion: v.number(),
    origin: v.optional(v.string()), // operator_canary | autonomous_fleet
    rolloutEpoch: v.number(),
    reservationDay: v.string(),
    locationCode: v.number(),
    languageCode: v.string(),
    providerCostCeilingMicroUsd: v.number(),
    providerCostReservedMicroUsd: v.number(),
    providerSpendReservationId: v.id("provider_spend_reservations"),
    providerEndpoint: v.string(),
    selectionScope: v.optional(v.union(
      v.literal("all_eligible"),
      v.literal("planned_unmaterialized"),
    )),
    plannedRecoveryInspectionKey: v.optional(v.string()),
    selectedTopics: v.array(v.object({
      topicId: v.id("topic_clusters"),
      targetKind: v.optional(v.union(
        v.literal("artifact"),
        v.literal("planned_topic"),
      )),
      articleId: v.optional(v.id("articles")),
      articleStatus: v.optional(v.string()),
      artifactHash: v.optional(v.string()),
      plannedTopicFingerprint: v.optional(v.string()),
      keyword: v.string(),
      label: v.string(),
      legacySearchVolume: v.number(),
      priority: v.optional(v.number()),
      gscClicks: v.number(),
      gscImpressions: v.number(),
      gscPosition: v.optional(v.number()),
      selectionScore: v.number(),
      topicCreatedAt: v.number(),
      topicUpdatedAt: v.number(),
    })),
    candidateCounts: v.object({
      covered: v.number(),
      currentDemand: v.number(),
      alreadyAttempted: v.number(),
      businessFitBlocked: v.number(),
      eligible: v.number(),
      artifactEligible: v.optional(v.number()),
      plannedUnmaterialized: v.optional(v.number()),
      plannedGateBlocked: v.optional(v.number()),
    }),
    keywordAttempts: v.array(v.object({
      topicId: v.id("topic_clusters"),
      keyword: v.string(),
      attemptedAt: v.number(),
      topicUpdatedAt: v.number(),
    })),
    metricReceipts: v.array(v.object({
      topicId: v.id("topic_clusters"),
      requestedKeyword: v.string(),
      returnedKeyword: v.string(),
      searchVolume: v.number(),
      cpc: v.optional(v.number()),
      competition: v.optional(v.number()),
      trend: v.array(v.number()),
      source: v.string(),
      measuredAt: v.number(),
      locationCode: v.number(),
      languageCode: v.string(),
    })),
    metricFailures: v.array(v.object({
      topicId: v.id("topic_clusters"),
      keyword: v.string(),
      code: v.string(),
      recordedAt: v.number(),
    })),
    providerCallAttempted: v.boolean(),
    providerCallCompleted: v.boolean(),
    providerAttemptedAt: v.optional(v.number()),
    providerCallsAttempted: v.number(),
    providerCallsCompleted: v.number(),
    persistedTopics: v.optional(v.number()),
    missingTopics: v.optional(v.number()),
    skippedTopics: v.optional(v.number()),
    workerAttempts: v.number(),
    workerToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_day", ["siteId", "reservationDay"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_origin_status", ["siteId", "origin", "status"])
    .index("by_site_created", ["siteId", "createdAt"]),

  // One-call-per-job Labs recovery for an imminent empty-buffer cadence gap
  // after an automatic plan consumed its second and final execution. A sole
  // zero-row primary may authorize one separately receipted fallback child.
  // Provider candidates remain inside their job; at most one strictly admitted
  // topic is materialized, and strict scheduling still requires separate live
  // SERP and authority evidence before any article can be queued.
  cadence_micro_seed_jobs: defineTable({
    siteId: v.id("sites"),
    userId: v.string(),
    status: v.string(), // pending | running | awaiting_evidence | evidence_running | cadence_scheduling | completed | missed | provider_balance_unavailable | provider_response_unverified
    policyVersion: v.number(),
    rolloutEpoch: v.number(),
    reservationDay: v.string(),
    inspectionKey: v.string(),
    sourcePlanId: v.id("jobs"),
    sourcePlanFingerprint: v.string(),
    sourcePlanReservationId: v.id("provider_spend_reservations"),
    attemptKind: v.optional(v.union(
      v.literal("primary"),
      v.literal("fallback"),
    )), // missing/primary | fallback
    parentMicroSeedJobId: v.optional(v.id("cadence_micro_seed_jobs")),
    parentMicroSeedReceiptFingerprint: v.optional(v.string()),
    seed: v.string(),
    locationCode: v.number(),
    languageCode: v.string(),
    providerEndpoint: v.string(),
    providerResultLimit: v.number(),
    includeSerpInfo: v.boolean(),
    includeClickstreamData: v.boolean(),
    providerCostCeilingMicroUsd: v.number(),
    providerCostReservedMicroUsd: v.number(),
    providerSpendReservationId: v.id("provider_spend_reservations"),
    providerCallAttempted: v.boolean(),
    providerCallCompleted: v.boolean(),
    providerAttemptedAt: v.optional(v.number()),
    providerCompletedAt: v.optional(v.number()),
    providerRequestTag: v.optional(v.string()),
    providerTaskCostUsd: v.optional(v.number()),
    candidateReceipts: v.array(v.object({
      keyword: v.string(),
      searchVolume: v.number(),
      difficulty: v.number(),
      difficultyMeasured: v.boolean(),
      cpc: v.optional(v.number()),
      competition: v.optional(v.number()),
      intent: v.string(),
      trend: v.array(v.number()),
    })),
    candidateAudit: v.optional(v.object({
      received: v.number(),
      accepted: v.number(),
      invalidMetric: v.number(),
      intentUnavailable: v.number(),
      difficulty: v.number(),
      brand: v.number(),
      businessFit: v.number(),
      duplicate: v.number(),
      overlap: v.number(),
    })),
    selectedCandidate: v.optional(v.object({
      keyword: v.string(),
      label: v.string(),
      searchVolume: v.number(),
      difficulty: v.number(),
      cpc: v.optional(v.number()),
      intent: v.string(),
      trend: v.array(v.number()),
      businessFitScore: v.number(),
      businessFitVersion: v.number(),
      businessFitReasons: v.array(v.string()),
      measuredAt: v.number(),
    })),
    topicId: v.optional(v.id("topic_clusters")),
    topicFingerprint: v.optional(v.string()),
    plannedEvidenceFingerprint: v.optional(v.string()),
    evidenceJobId: v.optional(v.id("expected_click_evidence_jobs")),
    evidenceQueueReason: v.optional(v.string()),
    evidenceFinalizerScheduledAt: v.optional(v.number()),
    watchdogScheduledAt: v.optional(v.number()),
    watchdogRecoveries: v.optional(v.number()),
    cadenceScheduleRequestedAt: v.optional(v.number()),
    cadenceScheduleAttempts: v.optional(v.number()),
    cadenceScheduleMode: v.optional(v.string()),
    cadenceScheduleScheduled: v.optional(v.number()),
    cadenceScheduleReceiptAt: v.optional(v.number()),
    finalizeAttempts: v.number(),
    workerAttempts: v.number(),
    workerToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_created", ["siteId", "createdAt"])
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_source_plan", ["siteId", "sourcePlanId"])
    .index("by_site_parent", ["siteId", "parentMicroSeedJobId"]),

  // One sending identity per tenant. Credentials live here rather than on the
  // site record so outreach can be revoked without touching publishing, and so
  // no query that returns a site can ever leak a mailbox token.
  outreach_inboxes: defineTable({
    siteId: v.id("sites"),
    provider: v.string(), // gmail | smtp | resend
    fromEmail: v.string(),
    fromName: v.optional(v.string()),
    replyToEmail: v.optional(v.string()),
    physicalMailingAddress: v.optional(v.string()),
    complianceConfirmedAt: v.optional(v.number()),
    // disconnected | connected | warming | active | suspended
    status: v.string(),
    // approval holds every message for one-message owner release. live is
    // valid only with the matching tenant-scoped autonomy consent receipt.
    mode: v.string(),
    autonomyConsentVersion: v.optional(v.number()),
    autonomyConsentPolicyHash: v.optional(v.string()),
    autonomyConsentAcceptedAt: v.optional(v.number()),
    autonomyConsentAcceptedBy: v.optional(v.string()),
    autonomyConsentInboxConfigurationVersion: v.optional(v.number()),
    autonomyLastEnabledAt: v.optional(v.number()),
    autonomyDisabledAt: v.optional(v.number()),
    // Consent activation reconciles the entire pre-existing approval queue in
    // bounded pages. Claims remain closed until the exact generation finishes.
    autonomyReconciliationStatus: v.optional(v.string()), // pending | complete | paused
    autonomyReconciliationStage: v.optional(v.string()), // approved | draft
    autonomyReconciliationCursor: v.optional(v.string()),
    autonomyReconciliationGeneration: v.optional(v.number()),
    dailySendCap: v.optional(v.number()),
    warmupStartedAt: v.optional(v.number()),
    sentToday: v.optional(v.number()),
    sentTodayDay: v.optional(v.string()), // UTC YYYY-MM-DD the counter belongs to
    lastSentAt: v.optional(v.number()),
    // Credentials. Never returned by any public query.
    oauthAccessToken: v.optional(v.string()),
    oauthRefreshToken: v.optional(v.string()),
    oauthExpiresAt: v.optional(v.number()),
    oauthScopes: v.optional(v.string()),
    // Non-reversible owner binding. A site ownership change can never inherit
    // the prior owner's Gmail refresh token.
    credentialOwnerAccountKey: v.optional(v.string()),
    senderDomain: v.optional(v.string()),
    dkimSelector: v.optional(v.string()),
    dnsCheckedAt: v.optional(v.number()),
    spfVerifiedAt: v.optional(v.number()),
    dkimVerifiedAt: v.optional(v.number()),
    dmarcVerifiedAt: v.optional(v.number()),
    // Incremented whenever the authenticated sender or compliance profile
    // changes. Draft approvals bind to this exact version.
    configurationVersion: v.optional(v.number()),
    smtpHost: v.optional(v.string()),
    smtpPort: v.optional(v.number()),
    smtpUsername: v.optional(v.string()),
    smtpPassword: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    verifiedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    // Inbound monitoring is a separate least-privilege Gmail read lane. The
    // cursor is advanced only after a complete bounded page sequence; a lease
    // prevents owner and fleet syncs from processing the same provider page.
    inboundLastScannedAt: v.optional(v.number()),
    inboundLastCompletedAt: v.optional(v.number()),
    inboundSyncWindowStartedAt: v.optional(v.number()),
    inboundSyncPageToken: v.optional(v.string()),
    inboundSyncLeaseId: v.optional(v.string()),
    inboundSyncLeaseExpiresAt: v.optional(v.number()),
    inboundLastError: v.optional(v.string()),
    // A send-only Gmail inbox may release outreach only after a real hard-DSN
    // canary traverses the current Workspace routing rule and signed adapter.
    // Every mutable fence is sealed so reconnects, plan epochs, sender-domain
    // changes and relay-secret/config rotations invalidate the proof.
    inboundRelayDsnRoutingVerifiedAt: v.optional(v.number()),
    inboundRelayDsnRoutingConfigurationVersion: v.optional(v.number()),
    inboundRelayDsnRoutingRolloutEpoch: v.optional(v.number()),
    inboundRelayDsnRoutingSenderDomain: v.optional(v.string()),
    inboundRelayDsnRoutingRelayConfigurationHash: v.optional(v.string()),
    inboundRelayDsnRoutingEvidenceHash: v.optional(v.string()),
    inboundRelayDsnRoutingAdapterVersion: v.optional(v.string()),
    inboundRelayDsnRoutingRetentionPolicyHash: v.optional(v.string()),
    // The owner-visible dsn-* address is derived on demand from a server-only
    // HMAC key. Only its digest/version survives a successful signed canary.
    inboundRelayDsnRoutingTargetHash: v.optional(v.string()),
    inboundRelayDsnRoutingTargetVersion: v.optional(v.number()),
    inboundRelayDsnRoutingTargetGeneration: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site", ["siteId"])
    // Outbound mailbox and domain reputation are tenant-scoped resources.
    // These indexes let every connect, opt-in and send claim fail closed if
    // another active tenant is already using either identity.
    .index("by_from_email", ["fromEmail"])
    .index("by_sender_domain", ["senderDomain"]),

  // Every outbound message, including ones that were never sent. A blocked or
  // skipped draft is evidence too: it is how a tenant sees why outreach did
  // not go out, instead of silence.
  outreach_messages: defineTable({
    siteId: v.id("sites"),
    inboxId: v.optional(v.id("outreach_inboxes")),
    opportunityId: v.id("seo_authority_opportunities"),
    toEmail: v.string(),
    toDomain: v.string(),
    subject: v.string(),
    body: v.string(),
    // draft | blocked | approved | sending | delivery_unverified |
    // delivery_reviewed_sent | sent | failed | replied | bounced | skipped
    status: v.string(),
    sequenceStep: v.number(), // 0 = initial contact
    threadKey: v.string(), // stable per site+domain so follow-ups group
    complianceIssues: v.optional(v.array(v.string())),
    blockedReason: v.optional(v.string()),
    pacingReason: v.optional(v.string()),
    pacingVersion: v.optional(v.number()),
    // Sender binding captured at draft and approval time. A reconnect or
    // profile change makes the approval unusable without human review.
    inboxConfigurationVersion: v.optional(v.number()),
    opportunityEvidenceHash: v.optional(v.string()),
    opportunitySourceUrl: v.optional(v.string()),
    opportunityTargetUrl: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    approvedInboxId: v.optional(v.id("outreach_inboxes")),
    approvedInboxConfigurationVersion: v.optional(v.number()),
    // owner_message is a one-message approval. account_autopilot is bound to
    // the exact one-time tenant consent receipt and may be fleet-delivered.
    approvalKind: v.optional(v.string()),
    approvalConsentVersion: v.optional(v.number()),
    approvalConsentPolicyHash: v.optional(v.string()),
    approvalConsentAcceptedAt: v.optional(v.number()),
    // The mutation that sets `sending` is the only delivery claim. Gmail
    // outcomes are accepted only for the exact attempt while its lease lives.
    deliveryAttemptId: v.optional(v.string()),
    deliveryClaimedAt: v.optional(v.number()),
    deliveryLeaseExpiresAt: v.optional(v.number()),
    deliveryLeaseExpiredAt: v.optional(v.number()),
    deliveryReviewedAt: v.optional(v.number()),
    deliveryReviewResolution: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    repliedAt: v.optional(v.number()),
    bouncedAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    providerMessageId: v.optional(v.string()),
    providerThreadId: v.optional(v.string()),
    // Pentra stores the classification and a deterministic evidence digest,
    // never the inbound email body itself.
    inboundCheckedAt: v.optional(v.number()),
    inboundReceiptProviderMessageId: v.optional(v.string()),
    inboundReceiptHash: v.optional(v.string()),
    inboundReceiptKind: v.optional(v.string()), // reply | unsubscribe | bounce
    inboundReceiptAt: v.optional(v.number()),
    inboundReceiptFrom: v.optional(v.string()),
    // Receiving-only relay binding. The random alias itself is never stored;
    // only its digest and immutable delivery fences survive the send.
    inboundRelayAliasHash: v.optional(v.string()),
    inboundRelayAliasDomain: v.optional(v.string()),
    // The custom outbound Message-ID uses a separate random token. Persist
    // only its digest, so neither it nor the receiving alias is reconstructible.
    inboundRelayOutboundMessageIdHash: v.optional(v.string()),
    inboundRelayRolloutEpoch: v.optional(v.number()),
    inboundRelayInboxConfigurationVersion: v.optional(v.number()),
    inboundRelaySenderDomain: v.optional(v.string()),
    inboundRelayDsnRoutingTargetHash: v.optional(v.string()),
    inboundRelayDsnRoutingTargetVersion: v.optional(v.number()),
    inboundRelayDsnRoutingTargetGeneration: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_status", ["siteId", "status"])
    .index("by_site_status_autonomy_consent_scheduled", [
      "siteId",
      "status",
      "approvalKind",
      "approvalConsentVersion",
      "approvalConsentPolicyHash",
      "approvalConsentAcceptedAt",
      "scheduledAt",
    ])
    .index("by_site_status_approval_kind_sequence_scheduled", [
      "siteId",
      "status",
      "approvalKind",
      "sequenceStep",
      "scheduledAt",
    ])
    .index("by_site_status_autonomy_consent_sequence_scheduled", [
      "siteId",
      "status",
      "approvalKind",
      "approvalConsentVersion",
      "approvalConsentPolicyHash",
      "approvalConsentAcceptedAt",
      "sequenceStep",
      "scheduledAt",
    ])
    .index("by_opportunity", ["opportunityId"])
    .index("by_site_domain", ["siteId", "toDomain"])
    .index("by_site_domain_status_sent", [
      "siteId",
      "toDomain",
      "status",
      "sentAt",
    ])
    .index("by_site_email", ["siteId", "toEmail"])
    .index("by_site_provider_thread", ["siteId", "providerThreadId"])
    .index("by_relay_alias_hash", ["inboundRelayAliasHash"])
    .index("by_inbox_relay_status_sent", [
      "inboxId",
      "inboundRelayAliasHash",
      "status",
      "sentAt",
    ])
    .index("by_inbox_relay_status_claimed", [
      "inboxId",
      "inboundRelayAliasHash",
      "status",
      "deliveryClaimedAt",
    ])
    .index("by_inbox_relay_thread_status_sent", [
      "inboxId",
      "inboundRelayAliasHash",
      "providerThreadId",
      "status",
      "sentAt",
    ])
    .index("by_thread", ["threadKey"]),

  // A challenge is prepared without sending mail. It can seal an inbox only
  // when the receiving-only adapter later submits an exact signed, structured
  // hard-DSN receipt. No alias, test address, MIME, subject or body is stored.
  outreach_inbound_relay_canaries: defineTable({
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    aliasHash: v.string(),
    outboundMessageIdHash: v.string(),
    testRecipientHash: v.string(),
    relayDomain: v.string(),
    senderDomain: v.string(),
    rolloutEpoch: v.number(),
    inboxConfigurationVersion: v.number(),
    relayConfigurationHash: v.string(),
    adapterVersion: v.string(),
    retentionPolicyHash: v.string(),
    // Optional only for additive rollout across expired legacy challenges.
    // Every newly issued challenge requires both values before it can seal.
    dsnRoutingTargetHash: v.optional(v.string()),
    dsnRoutingTargetVersion: v.optional(v.number()),
    dsnRoutingTargetGeneration: v.optional(v.number()),
    issuedAt: v.number(),
    expiresAt: v.number(),
    deliveryStatus: v.string(), // claimed | accepted | unverified | failed | dsn_verified
    deliveryAttemptId: v.string(),
    deliveryClaimedAt: v.number(),
    deliveryLeaseExpiresAt: v.optional(v.number()),
    providerMessageIdHash: v.optional(v.string()),
    deliveryFinalizedAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    eventKey: v.optional(v.string()),
    payloadHash: v.optional(v.string()),
    evidenceHash: v.optional(v.string()),
  })
    .index("by_alias_hash", ["aliasHash"])
    .index("by_inbox", ["inboxId"])
    .index("by_site", ["siteId"]),

  // One bodyless, replay-safe receipt per signed receiving-relay event. Raw
  // subjects and message bodies are parsed only inside the HTTP action and
  // never become mutation arguments or database fields.
  outreach_inbound_relay_receipts: defineTable({
    siteId: v.id("sites"),
    inboxId: v.id("outreach_inboxes"),
    messageId: v.id("outreach_messages"),
    eventKey: v.string(),
    payloadHash: v.string(),
    evidenceHash: v.string(),
    aliasHash: v.string(),
    inboundMessageId: v.string(),
    outboundMessageIdHash: v.string(),
    kind: v.string(), // reply | unsubscribe | bounce | ignored
    reason: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    receivedAt: v.number(),
    rolloutEpoch: v.number(),
    inboxConfigurationVersion: v.number(),
    senderDomain: v.string(),
    dsnRoutingTargetHash: v.optional(v.string()),
    dsnRoutingTargetVersion: v.optional(v.number()),
    dsnRoutingTargetGeneration: v.optional(v.number()),
    processedAt: v.number(),
  })
    .index("by_event_key", ["eventKey"])
    .index("by_site", ["siteId"])
    .index("by_site_message", ["siteId", "messageId"])
    .index("by_message_inbound_id", ["messageId", "inboundMessageId"]),

  // Unsubscribes, bounces and complaints. Checked before every send and never
  // expires: an opt-out is permanent.
  outreach_suppressions: defineTable({
    siteId: v.id("sites"),
    kind: v.string(), // domain | email
    value: v.string(), // normalized lowercase
    reason: v.string(), // unsubscribe | bounce | complaint | manual
    createdAt: v.number(),
  })
    .index("by_site_value", ["siteId", "value"])
    .index("by_site", ["siteId"]),

  // PII-minimized STOP/bounce/manual suppression receipts scoped to the
  // account-wide tenant scope. There is intentionally no siteId or mutable
  // domain: deletion, recreation, and domain edits must not erase an opt-out.
  outreach_sender_suppression_tombstones: defineTable({
    accountKey: v.string(),
    tenantDomainKey: v.string(),
    kind: v.string(), // domain | email
    valueKey: v.string(),
    reason: v.string(),
    createdAt: v.number(),
  })
    .index("by_account_tenant_value", [
      "accountKey",
      "tenantDomainKey",
      "kind",
      "valueKey",
    ])
    .index("by_account_tenant", ["accountKey", "tenantDomainKey"])
    .index("by_account", ["accountKey"]),

  // PII-minimized account-tenant recipient-domain cooldown receipt. This row
  // has no siteId, so deletion/domain changes cannot reset the 90-day fence.
  outreach_tenant_contact_receipts: defineTable({
    accountKey: v.string(),
    tenantDomainKey: v.string(),
    recipientDomainKey: v.string(),
    lastContactedAt: v.optional(v.number()),
    reservationAttemptId: v.optional(v.string()),
    reservationExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account_tenant_recipient", [
      "accountKey",
      "tenantDomainKey",
      "recipientDomainKey",
    ])
    .index("by_account_tenant", ["accountKey", "tenantDomainKey"])
    .index("by_account", ["accountKey"])
    .index("by_updated", ["updatedAt"]),

  // Aggregate sending-domain reputation survives ordinary site deletion.
  // The mailbox digest gates address-specific warm-up; daily count and spacing
  // remain domain-scoped so changing aliases cannot reset either fence.
  outreach_sender_pacing_receipts: defineTable({
    accountKey: v.optional(v.string()),
    tenantDomainKey: v.optional(v.string()),
    senderDomainKey: v.string(),
    mailboxKey: v.string(),
    warmupStartedAt: v.number(),
    sentToday: v.number(),
    sentTodayDay: v.string(),
    lastSentAt: v.optional(v.number()),
    retainUntil: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sender", ["senderDomainKey"])
    .index("by_account_tenant_sender", [
      "accountKey",
      "tenantDomainKey",
      "senderDomainKey",
    ])
    .index("by_account_tenant", ["accountKey", "tenantDomainKey"])
    .index("by_account", ["accountKey"])
    .index("by_retain_until", ["retainUntil"]),

  // Additive rollout checkpoint. Automatic claims remain closed until every
  // legacy site row in the account has been materialized into the durable
  // suppression/contact/pacing ledgers in bounded resumable pages.
  outreach_durability_migrations: defineTable({
    accountKey: v.string(),
    userId: v.string(),
    version: v.number(),
    status: v.string(), // pending | complete
    siteCursor: v.optional(v.string()),
    nextSiteCursor: v.optional(v.string()),
    sitesDoneAfterActive: v.optional(v.boolean()),
    activeSiteId: v.optional(v.id("sites")),
    rowStage: v.optional(v.string()), // suppressions | messages
    rowCursor: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_account", ["accountKey"])
    .index("by_status_updated", ["status", "updatedAt"]),

  // A contact address is only usable when it was observed on a real public
  // page. discoveredFromUrl is the receipt; a contact without one is not
  // sendable, which is what keeps discovery from degenerating into guessing
  // info@ addresses.
  outreach_contacts: defineTable({
    siteId: v.id("sites"),
    domain: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    discoveredFromUrl: v.string(),
    discoveryMethod: v.string(), // page_scan | mailto | author_byline
    verifiedAt: v.number(),
    lastContactedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_domain", ["siteId", "domain"])
    .index("by_site_email", ["siteId", "email"]),

  // Private server-to-server outcome ingestion. The raw credential is shown
  // once when rotated and is never persisted; only its tenant-bound digest is
  // stored. One credential row per site keeps rotation and revocation atomic.
  outcome_ingest_credentials: defineTable({
    siteId: v.id("sites"),
    tokenHash: v.optional(v.string()),
    status: v.string(), // active | revoked
    version: v.number(),
    qualifiedActionGoalKey: v.string(),
    createdAt: v.number(),
    rotatedAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    // UTC-day request reservations live on the credential so rotation cannot
    // bypass a tenant's public-ingest ceiling and tenant deletion does not
    // need to discover another site-scoped table.
    usageUtcDate: v.optional(v.string()),
    acceptedToday: v.optional(v.number()),
    rejectedToday: v.optional(v.number()),
    tokenFailuresToday: v.optional(v.number()),
    tokenFailureBlockedUntil: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_site", ["siteId"]),

  // Immutable event receipts. The compound index is the idempotency boundary:
  // two tenants may use the same provider event id, while one tenant can never
  // count that event twice or mutate it into a different outcome.
  outcome_receipts: defineTable({
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    // The sealed public key is preserved so a conversion can finish its
    // original landing cohort after the article receives a newer revision.
    // Legacy article-id connectors predate this field.
    publicationDeliveryKey: v.optional(v.string()),
    eventId: v.string(),
    eventType: v.union(
      v.literal("landing_session"),
      v.literal("qualified_action"),
      v.literal("organic_landing"),
      v.literal("signup"),
      v.literal("activation"),
      v.literal("paid_conversion"),
    ),
    articleUrl: v.string(),
    sessionId: v.string(),
    goalKey: v.string(),
    occurredAt: v.number(),
    receivedAt: v.number(),
  })
    .index("by_site_event", ["siteId", "eventId"])
    .index("by_site_session", ["siteId", "sessionId"])
    .index("by_site_occurred", ["siteId", "occurredAt"])
    .index("by_article_occurred", ["articleId", "occurredAt"]),

  // Transactional daily rollups keep outcome reporting bounded as customer
  // event volume grows. They are incremented only after a new immutable
  // receipt passes the tenant, credential, article, URL, goal and time gates.
  outcome_daily_rollups: defineTable({
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    date: v.string(),
    goalKey: v.string(),
    landingSessions: v.number(),
    qualifiedActions: v.number(),
    // Optional while v1 rollup rows coexist. Every new or touched row writes
    // the complete v2 funnel, and readers conservatively interpret absence as
    // zero rather than inventing organic attribution from legacy landings.
    organicLandingSessions: v.optional(v.number()),
    signups: v.optional(v.number()),
    activations: v.optional(v.number()),
    paidConversions: v.optional(v.number()),
    firstOccurredAt: v.number(),
    lastOccurredAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site_article_goal_date", [
      "siteId",
      "articleId",
      "goalKey",
      "date",
    ])
    .index("by_site_date", ["siteId", "date"])
    .index("by_article_date", ["articleId", "date"]),

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
    syncEpoch: v.optional(v.string()),
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
    .index("by_site_epoch_date", ["siteId", "syncEpoch", "date"])
    .index("by_site_version_date_query_page", [
      "siteId",
      "syncVersion",
      "date",
      "query",
      "page",
    ]),

  // Bounded page-level rollup used by the autonomous growth controller. GSC
  // can return tens of thousands of query rows; growth decisions should not
  // reread that entire corpus once per article.
  search_page_daily: defineTable({
    siteId: v.id("sites"),
    date: v.string(),
    page: v.string(),
    syncEpoch: v.optional(v.string()),
    clicks: v.number(),
    impressions: v.number(),
    weightedPosition: v.number(),
    nonBrandedClicks: v.number(),
    nonBrandedImpressions: v.number(),
    nonBrandedWeightedPosition: v.number(),
    queryClicks: v.optional(v.number()),
    queryImpressions: v.optional(v.number()),
    unattributedClicks: v.optional(v.number()),
    unattributedImpressions: v.optional(v.number()),
    queryCoverageComplete: v.optional(v.boolean()),
    syncedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_site_date", ["siteId", "date"])
    .index("by_site_epoch_date", ["siteId", "syncEpoch", "date"])
    .index("by_site_date_page", ["siteId", "date", "page"]),

  // Immutable user-level quota audit. Tenant deletion scrubs content/site
  // references but deliberately retains billing-period consumption so a
  // delete-and-recreate cycle cannot restore paid generation headroom.
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
    .index("by_site", ["siteId"])
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "type"])
    .index("by_user_type_created", ["userId", "type", "createdAt"])
    .index("by_job", ["jobId"])
    .index("by_state_expires", ["state", "expiresAt"]),
});
