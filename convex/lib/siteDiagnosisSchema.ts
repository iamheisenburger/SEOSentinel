/** The stored shape of one site diagnosis (convex/lib/siteDiagnosis.ts), shared by the schema and the recording mutation. */
import { v } from "convex/values";

export const siteDiagnosisRecord = {
  siteType: v.union(v.literal("new"), v.literal("struggling"), v.literal("strong")),
  window: v.optional(v.object({ from: v.string(), to: v.string() })),
  totals: v.object({ impressions: v.number(), clicks: v.number(), brandedClicks: v.number(), pageOneImpressions: v.number(),
    pageOneClicks: v.number(), expectedPageOneClicks: v.number(), beyondPageTwoShare: v.number(), nonBuyerPageOneShare: v.union(v.number(), v.null()) }),
  factors: v.object({ searches: v.string(), pages: v.string(), authority: v.string(), clicks: v.string(), ai: v.string() }),
  findings: v.array(v.object({ factor: v.string(), severity: v.string(), problem: v.string(), evidence: v.string(), action: v.string(),
    items: v.optional(v.array(v.string())) })),
  pageActions: v.array(v.object({ url: v.string(), actions: v.array(v.string()) })),
  summary: v.string(),
  inputs: v.object({ searchConsole: v.boolean(), crawledPages: v.number(), intents: v.number(), pageOneChecked: v.number(), authorityMeasured: v.boolean() }),
  costMicroUsd: v.number(),
  notes: v.optional(v.array(v.string())),
  /** Page one for the site's main searches, as measured: each ranking site and its authority (null when unmeasured). */
  pageOne: v.optional(v.array(v.object({ query: v.string(), medianRank: v.union(v.number(), v.null()), reachable: v.optional(v.number()),
    results: v.optional(v.number()), domains: v.optional(v.array(v.object({ domain: v.string(), rank: v.union(v.number(), v.null()) }))) }))),
  /** The buyer questions put to the AI assistants (kept and reused, so weeks compare) and each answer's verdict. */
  aiAnswers: v.optional(v.object({ questions: v.array(v.string()), checks: v.array(v.object({ question: v.string(),
    assistant: v.union(v.literal("chatgpt"), v.literal("gemini"), v.literal("google_ai_mode")), answered: v.boolean(), named: v.boolean(), cited: v.boolean(),
    sources: v.optional(v.array(v.string())), error: v.optional(v.string()) })) })),
  /** Phase 3 (Nov 2026): who types the top searches (convex/lib/searchIntent.ts labels), for choosing the pages to improve. */
  intents: v.optional(v.array(v.object({ query: v.string(), label: v.string() }))),
  /** Google's mobile speed test for a few pages. */
  speed: v.optional(v.array(v.object({ url: v.string(), score: v.union(v.number(), v.null()), lcpMs: v.union(v.number(), v.null()) }))),
};
