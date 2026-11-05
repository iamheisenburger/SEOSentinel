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
};
