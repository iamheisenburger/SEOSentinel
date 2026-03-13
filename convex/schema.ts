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
    inferToneNiche: v.optional(v.boolean()),
    approvalRequired: v.optional(v.boolean()),
    repoOwner: v.optional(v.string()),
    repoName: v.optional(v.string()),
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
    .index("by_user", ["userId"]),

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
        }),
      ),
    ),
    internalLinks: v.optional(
      v.array(
        v.object({
          anchor: v.string(),
          href: v.string(),
        }),
      ),
    ),
    featuredImage: v.optional(v.string()), // URL of AI-generated hero image
    readingTime: v.optional(v.number()), // estimated minutes to read
    wordCount: v.optional(v.number()), // total word count
    factCheckScore: v.optional(v.number()), // 0-100 overall confidence
    factCheckNotes: v.optional(v.string()),

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
    .index("by_topic", ["topicId"]),

  jobs: defineTable({
    siteId: v.optional(v.id("sites")),
    type: v.string(), // onboarding | plan | article | links | scheduler
    status: v.string(), // pending | running | done | failed
    payload: v.optional(v.any()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    retries: v.optional(v.number()), // number of retry attempts
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
    .index("by_status", ["status"]),

  // Google Search Console performance snapshots (daily)
  search_performance: defineTable({
    siteId: v.id("sites"),
    date: v.string(), // ISO date "2026-03-12"
    query: v.string(), // search query
    page: v.optional(v.string()), // URL that appeared
    clicks: v.number(),
    impressions: v.number(),
    ctr: v.number(), // 0-1
    position: v.number(), // average position
    createdAt: v.number(),
  })
    .index("by_site", ["siteId"])
    .index("by_site_date", ["siteId", "date"])
    .index("by_site_query", ["siteId", "query"]),

  // Immutable usage log — tracks article generations (never deleted)
  usage_log: defineTable({
    userId: v.string(),
    siteId: v.optional(v.id("sites")),
    type: v.string(), // "article_generated" | "site_added"
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "type"]),
});

