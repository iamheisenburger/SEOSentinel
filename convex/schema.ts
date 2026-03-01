import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sites: defineTable({
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
    anchorKeywords: v.optional(v.array(v.string())), // priority backlink keywords
    externalLinking: v.optional(v.boolean()),
    sourceCitations: v.optional(v.boolean()),
    youtubeEmbeds: v.optional(v.boolean()),
    urlStructure: v.optional(v.string()), // e.g. /blog/[slug]

    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_domain", ["domain"]),

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
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_site", ["siteId"]),

  articles: defineTable({
    siteId: v.id("sites"),
    topicId: v.optional(v.id("topic_clusters")),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_site", ["siteId"])
    .index("by_status", ["status"]),
});

