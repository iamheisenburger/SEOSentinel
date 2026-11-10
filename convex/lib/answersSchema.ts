/** Pentra Answers (Nov 2026): the tables. Every count Pentra shows is computed from stored answers (answer_checks, with the
 * full text in answer_texts), so every number opens to its evidence. */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const answersSiteSettings = v.object({
  enabled: v.boolean(),
  enabledAt: v.number(),
  /** "signup" (a new account), "owner" (Pentra's own sites), "switch" (an existing customer who asked). */
  source: v.string(),
  /** The competitors the owner confirmed: named in answers instead of the business. */
  competitors: v.optional(v.array(v.object({ name: v.string(), domain: v.optional(v.string()) }))),
  /** ISO 3166-1 alpha-2: where the assistants are asked from. */
  country: v.optional(v.string()),
  /** When the owner confirmed what Pentra read (business, competitors). Asking waits for it. */
  confirmedAt: v.optional(v.number()),
  publishing: v.optional(v.object({
    target: v.string(), // "site" (the site's own connection) | "hosted" (answers.yourdomain.com)
    hostedDomain: v.optional(v.string()),
    hostedStatus: v.optional(v.string()), // pending_dns | live | error
    hostedCheckedAt: v.optional(v.number()),
    hostedError: v.optional(v.string()),
  })),
  indexNowKey: v.optional(v.string()),
  /** Hosts where Pentra placed the IndexNow key file (the hosted address always; a GitHub-published site once committed). */
  indexNowHosts: v.optional(v.array(v.string())),
  autopublish: v.optional(v.boolean()),
  weeklyEmail: v.optional(v.boolean()),
  lastSnapshotRunId: v.optional(v.id("answer_runs")),
  lastFullRunAt: v.optional(v.number()),
  lastRecheckAt: v.optional(v.number()),
  lastWeeklyEmailAt: v.optional(v.number()),
  /** When the "your first hour is ready" email went out (once per site). */
  snapshotEmailAt: v.optional(v.number()),
  freeSnapshotAt: v.optional(v.number()),
  snapshotRequestedAt: v.optional(v.number()),
  /** Reading the site for the owner to confirm: when it finished, or why it couldn't. */
  readAt: v.optional(v.number()),
  readError: v.optional(v.string()),
  local: v.optional(v.boolean()),
  /** Pentra's own sites: which version of their code-made settings they carry (convex/answersDispatch.ts OWNER_SETTINGS_VERSION). */
  ownerVersion: v.optional(v.number()),
  location: v.optional(v.string()),
  setupError: v.optional(v.string()),
  setupErrorAt: v.optional(v.number()),
  /** Get named (P397): when the owner last asked Pentra to prepare the work (lists, pitches, community drafts). */
  growthPreparedAt: v.optional(v.number()),
});

const latestForQuestion = v.object({
  runId: v.id("answer_runs"), at: v.number(), answered: v.number(), named: v.number(), cited: v.number(),
  assistantsNamed: v.array(v.string()),
  competitorsNamed: v.array(v.object({ name: v.string(), answers: v.number() })),
});

export const answersTables = {
  answer_questions: defineTable({
    siteId: v.id("sites"),
    question: v.string(),
    key: v.string(),
    intent: v.string(),
    source: v.string(), // generated | owner | followup
    status: v.string(), // active | paused | removed
    createdAt: v.number(),
    latest: v.optional(latestForQuestion),
    opportunity: v.optional(v.object({ score: v.number(), status: v.string(), reasons: v.array(v.string()), at: v.number() })),
    pageId: v.optional(v.id("answer_pages")),
  })
    .index("by_site", ["siteId"])
    .index("by_site_key", ["siteId", "key"])
    .index("by_site_status", ["siteId", "status"]),

  answer_runs: defineTable({
    siteId: v.id("sites"),
    kind: v.string(), // snapshot | weekly | recheck
    status: v.string(), // asking | done | failed
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    country: v.string(),
    assistants: v.array(v.string()),
    jobs: v.array(v.object({ questionId: v.id("answer_questions"), assistant: v.string() })),
    nextJob: v.number(),
    done: v.number(),
    answered: v.number(),
    named: v.number(),
    cited: v.number(),
    failed: v.number(),
    noAnswer: v.number(),
    byAssistant: v.optional(v.array(v.object({ assistant: v.string(), asked: v.number(), answered: v.number(), named: v.number(), cited: v.number() }))),
    competitors: v.optional(v.array(v.object({ name: v.string(), named: v.number() }))),
    /** Who the assistants named, confirmed competitor or not, with the number of answers naming each (P396). */
    recommended: v.optional(v.array(v.object({ name: v.string(), answers: v.number() }))),
    topSources: v.optional(v.array(v.object({ domain: v.string(), answers: v.number() }))),
    costMicroUsd: v.number(),
    /** Live counts per assistant while the run asks (the first hour's progress bars). */
    progress: v.optional(v.array(v.object({ assistant: v.string(), done: v.number(), answered: v.number(), named: v.number() }))),
    leaseUntil: v.optional(v.number()),
    error: v.optional(v.string()),
    /** What follows the asking: drafting the first pages (a snapshot), rewriting uncited pages (weekly). */
    followUp: v.optional(v.string()),
  })
    .index("by_site_created", ["siteId", "createdAt"])
    .index("by_status", ["status"]),

  answer_checks: defineTable({
    siteId: v.id("sites"),
    runId: v.id("answer_runs"),
    questionId: v.id("answer_questions"),
    question: v.string(),
    assistant: v.string(),
    askedAt: v.number(),
    country: v.string(),
    status: v.string(), // answered | no_answer | error
    error: v.optional(v.string()),
    excerpt: v.string(),
    textChars: v.number(),
    named: v.boolean(),
    cited: v.boolean(),
    position: v.optional(v.number()),
    brandsNamed: v.number(),
    /** The businesses counted in "Nth of M", in the answer's order (Nov 9 2026; answers naming the business only). */
    businessesNamed: v.optional(v.array(v.string())),
    competitorsNamed: v.array(v.string()),
    sources: v.array(v.object({ url: v.string(), title: v.optional(v.string()), domain: v.string(), own: v.boolean() })),
    citedPageUrls: v.array(v.string()),
    endpoint: v.string(),
    costMicroUsd: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_site_asked", ["siteId", "askedAt"])
    .index("by_question_asked", ["questionId", "askedAt"])
    .index("by_site_cited", ["siteId", "cited", "askedAt"]),

  /** Get named (P397): one reply drafted for a community thread the assistants cite; a person posts it. */
  answer_posts: defineTable({
    siteId: v.id("sites"),
    url: v.string(),
    platform: v.string(),
    title: v.optional(v.string()),
    questions: v.array(v.string()),
    answers: v.number(),
    draft: v.string(),
    fits: v.boolean(),
    threadRead: v.boolean(),
    /** "cited" (the answers cite the thread) or "search" (found by searching the question, P398). */
    found: v.optional(v.string()),
    status: v.string(), // todo | posted | skipped
    postedUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    costMicroUsd: v.number(),
  })
    .index("by_site", ["siteId"])
    .index("by_site_url", ["siteId", "url"]),

  /** Get named (P398): one short answer video. Pentra writes the script and makes the voice and a screenshot; the owner's
   * browser assembles the video and the owner uploads it to YouTube. */
  answer_videos: defineTable({
    siteId: v.id("sites"),
    question: v.string(),
    status: v.string(), // writing | ready | uploaded | skipped | failed
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    segments: v.optional(v.array(v.object({ heading: v.string(), lines: v.array(v.string()), narration: v.string() }))),
    productSegment: v.optional(v.number()),
    audioId: v.optional(v.id("_storage")),
    screenshotId: v.optional(v.id("_storage")),
    durationMs: v.optional(v.number()),
    youtubeUrl: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    costMicroUsd: v.number(),
    /** P400: an animated video rendered by Pentra (2); the first videos (1) were assembled in the owner's browser. */
    version: v.optional(v.number()),
    /** P400: the scenes, each with its own voice. */
    scenes: v.optional(v.array(v.object({ kind: v.string(), heading: v.string(), items: v.array(v.string()), emphasis: v.array(v.string()),
      narration: v.string(), audioId: v.id("_storage"), audioMs: v.number() }))),
    accent: v.optional(v.string()),
    /** P405: the business's look read from its own site (background, text, accent, font), so the video is in its colours. */
    theme: v.optional(v.object({ mode: v.string(), background: v.string(), text: v.string(), muted: v.string(), surface: v.string(), line: v.string(),
      accent: v.string(), accentInk: v.string(), emphasis: v.string(), font: v.string() })),
    /** P400: the rendered MP4s: 16:9 for YouTube, 9:16 for Shorts. */
    landscapeId: v.optional(v.id("_storage")),
    verticalId: v.optional(v.id("_storage")),
  }).index("by_site", ["siteId"]),

  /** P400: one render of a video on Pentra's render route, claimed once with its ticket. */
  answer_video_renders: defineTable({
    siteId: v.id("sites"),
    videoId: v.id("answer_videos"),
    ticket: v.string(),
    format: v.string(), // landscape | vertical
    status: v.string(), // queued | rendering | done | failed
    storageId: v.optional(v.id("_storage")),
    error: v.optional(v.string()),
    createdAt: v.number(),
    claimedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  }).index("by_ticket", ["ticket"]).index("by_video", ["videoId"]),

  /** Get named (P398): the business's directory listing, written once from its own facts. */
  answer_listing_kits: defineTable({
    siteId: v.id("sites"),
    status: v.string(), // writing | ready | failed
    kind: v.optional(v.string()),
    tagline: v.optional(v.string()),
    shortDescription: v.optional(v.string()),
    longDescription: v.optional(v.string()),
    categories: v.optional(v.array(v.string())),
    features: v.optional(v.array(v.string())),
    useCases: v.optional(v.array(v.string())),
    pricing: v.optional(v.string()),
    audience: v.optional(v.string()),
    faqs: v.optional(v.array(v.object({ q: v.string(), a: v.string() }))),
    error: v.optional(v.string()),
    createdAt: v.number(),
    costMicroUsd: v.number(),
  }).index("by_site", ["siteId"]),

  /** Get named (P398): where the owner has listed the business, directory by directory. */
  answer_listings: defineTable({
    siteId: v.id("sites"),
    domain: v.string(),
    name: v.string(),
    status: v.string(), // todo | submitted | live | skipped
    liveUrl: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_site", ["siteId"]).index("by_site_domain", ["siteId", "domain"]),

  answer_texts: defineTable({
    siteId: v.id("sites"),
    checkId: v.id("answer_checks"),
    text: v.string(),
  }).index("by_check", ["checkId"]),

  answer_pages: defineTable({
    siteId: v.id("sites"),
    questionId: v.id("answer_questions"),
    question: v.string(),
    status: v.string(), // writing | draft | not_written | publishing | published | publish_failed | retired
    title: v.string(),
    slug: v.string(),
    metaDescription: v.string(),
    markdown: v.string(),
    facts: v.array(v.object({ text: v.string(), source: v.string(), url: v.optional(v.string()) })),
    sources: v.array(v.object({ n: v.number(), url: v.string(), title: v.optional(v.string()), excerpt: v.optional(v.string()),
      contentHash: v.optional(v.string()), retrievedAt: v.number() })),
    issues: v.array(v.string()),
    version: v.number(),
    contentHash: v.string(),
    writerModel: v.string(),
    costMicroUsd: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    publishedUrl: v.optional(v.string()),
    publishedAt: v.optional(v.number()),
    publishTarget: v.optional(v.string()),
    publishError: v.optional(v.string()),
    publishReceipt: v.optional(v.string()),
    indexNow: v.optional(v.object({ at: v.number(), status: v.string() })),
    /** When Pentra first loaded the published page at its address and found it live. */
    liveAt: v.optional(v.number()),
    googleSitemapAt: v.optional(v.number()),
    citations: v.number(),
    lastCitedAt: v.optional(v.number()),
    rewriteOf: v.optional(v.id("answer_pages")),
    rewriteReason: v.optional(v.string()),
    notWrittenReason: v.optional(v.string()),
    /** A comparison page (P398): the business beside this rival, which the answers name. Its question is never asked. */
    comparisonWith: v.optional(v.object({ name: v.string(), domain: v.string() })),
  })
    .index("by_site_status", ["siteId", "status"])
    .index("by_question", ["questionId"])
    .index("by_site_slug", ["siteId", "slug"]),

  answer_citations: defineTable({
    siteId: v.id("sites"),
    questionId: v.id("answer_questions"),
    pageId: v.optional(v.id("answer_pages")),
    checkId: v.id("answer_checks"),
    assistant: v.string(),
    kind: v.string(), // page_cited (a Pentra page) | site_cited (another page of the site)
    url: v.string(),
    at: v.number(),
    first: v.boolean(),
  })
    .index("by_site_at", ["siteId", "at"])
    .index("by_page", ["pageId"]),

  /** Which site a hosted answers address (answers.yourdomain.com) belongs to: one site per address. */
  answer_host_index: defineTable({
    host: v.string(),
    siteId: v.id("sites"),
    createdAt: v.number(),
  })
    .index("by_host", ["host"])
    .index("by_site", ["siteId"]),

  /** The service's spend per UTC day (held plus settled), kept as one running total so the daily circuit breaker reads one
   * row, not every hold of the day. */
  answer_spend_days: defineTable({
    day: v.string(),
    microUsd: v.number(),
    updatedAt: v.number(),
  }).index("by_day", ["day"]),

  /** Every provider call Pentra Answers pays for: held before it is sent, settled at the provider's reported cost. */
  answer_spend: defineTable({
    siteId: v.id("sites"),
    userId: v.optional(v.string()),
    runId: v.optional(v.id("answer_runs")),
    pageId: v.optional(v.id("answer_pages")),
    purpose: v.string(), // ask | questions | draft | facts
    free: v.boolean(),
    month: v.string(),
    reservedMicroUsd: v.number(),
    actualMicroUsd: v.optional(v.number()),
    state: v.string(), // held | settled | released
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
  })
    .index("by_site_month", ["siteId", "month"])
    .index("by_user_month", ["userId", "month"])
    .index("by_created", ["createdAt"]),
};
