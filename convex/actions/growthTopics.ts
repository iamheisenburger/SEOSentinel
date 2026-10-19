"use node";

import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { discoverKeywords, getDomainAuthority, meterDataForSeoCost, type DomainAuthorityEvidence } from "./seoData";
import { dataForSeoLocationCode } from "../lib/dataForSeoLocale";
import { contentIntentConflicts, evaluateTopicBusinessFit } from "../lib/autopilotBuffer";
import { structuredToolChoice } from "../lib/toolChoice";
import { BUYER_FIT_CEILING_MICRO_USD, BUYER_FIT_MAX_TOKENS, BUYER_FIT_MODEL, BUYER_FIT_TOOL, buyerFitCostMicroUsd,
  buyerFitRequest, normalizeFitKeyword, parseBuyerFit, type BuyerFitBusiness, type BuyerFitVerdict } from "../lib/topicFit";

type ResearchContext = { domain: string; language: string; targetCountry: string | null; seeds: string[]; known: string[];
  coverage: string[]; signals: { coreBusinessSignals: string[]; productAnchorSignals: string[]; businessModelSignals: string[] };
  searchConsole: Array<{ keyword: string; impressions: number; position: number }>; tenantAuthority: number | null;
  canonicalDomain: string; domainRevision: number; business: BuyerFitBusiness; maximumDifficulty?: number };

/** One buyer-fit call for a batch of keywords (convex/lib/topicFit.ts). It
 * throws when no verdict came back; the caller then counts the call's ceiling. */
async function judgeBuyerFit(business: BuyerFitBusiness, keywords: string[]): Promise<{ verdicts: Map<string, BuyerFitVerdict>; costMicroUsd: number }> {
  const request = buyerFitRequest(business, keywords);
  if (request.keywords.length === 0) return { verdicts: new Map(), costMicroUsd: 0 };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.TOPIC_FIT_MODEL ?? BUYER_FIT_MODEL;
  const response = await new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000, fetch }).messages.create({
    model, max_tokens: BUYER_FIT_MAX_TOKENS, system: request.system,
    messages: [{ role: "user", content: request.userMessage }],
    tools: [{ name: BUYER_FIT_TOOL, description: "Record a keep or drop verdict for every search.", input_schema: request.inputSchema, strict: true }],
    tool_choice: structuredToolChoice(model, BUYER_FIT_TOOL),
  });
  const tool = response.content.find((block) => block.type === "tool_use" && block.name === BUYER_FIT_TOOL);
  return { verdicts: parseBuyerFit(request.keywords, tool && tool.type === "tool_use" ? tool.input : null),
    costMicroUsd: buyerFitCostMicroUsd(response.usage) };
}

/** Keyword research for an Autopilot site whose topics ran out. The spend is
 * reserved (and bounded) by contentWork.advance before this runs; any failure
 * simply adds no topics and the site retries after the replenish interval. */
export const replenish = internalAction({ args: { siteId: v.id("sites"), reservationId: v.id("provider_spend_reservations") },
  handler: async (ctx, { siteId, reservationId }): Promise<{ added: number }> => {
    const context: ResearchContext | null = await ctx.runQuery(internal.contentWork.growthTopicContext, { siteId });
    if (!context || context.seeds.length === 0) {
      // Nothing was sent: the reservation is returned instead of held forever.
      await ctx.runMutation(internal.contentWork.closeTopicResearchReservation, { siteId, reservationId, sent: false, actualMicroUsd: 0 });
      return { added: 0 };
    }
    const known = new Set(context.known);
    const coverage = context.coverage.map(primaryKeyword => ({ primaryKeyword }));
    // Only keywords Autopilot could actually write count as found, so discovery
    // keeps going to its next source when the first returns covered or
    // off-business keywords (the same checks the topic is added with).
    const exclusion = (raw: string) => {
      const keyword = raw.trim().toLowerCase().replace(/\s+/g, " ");
      if (known.has(keyword)) return "already_known" as const;
      if (keyword.split(" ").length < 2 || keyword.length > 80 ||
        !evaluateTopicBusinessFit({ keyword, label: keyword.replace(/^./, c => c.toUpperCase()), ...context.signals }).eligible) return "product_fit" as const;
      if (coverage.some(c => contentIntentConflicts({ primaryKeyword: keyword }, c))) return "existing_intent" as const;
      return undefined;
    };
    let found: Awaited<ReturnType<typeof discoverKeywords>> = [];
    type DiscoverySeen = { unique: number; excluded: { already_known: number; product_fit: number; existing_intent: number } };
    let discovery = null as DiscoverySeen | null;
    // A site without fresh authority evidence is measured once within this
    // research run (one backlinks summary, inside the same reservation), so
    // discovery and topic order keep what it can actually win.
    let tenantAuthority = context.tenantAuthority;
    let measured: DomainAuthorityEvidence | null = null;
    const metered = await meterDataForSeoCost(async () => {
      try {
        if (tenantAuthority === null) {
          measured = await getDomainAuthority(context.domain);
          if (measured) tenantAuthority = measured.domainRank;
        }
        return await discoverKeywords(context.seeds, dataForSeoLocationCode(context.targetCountry ?? undefined), context.language, 80,
          { targetDomain: context.domain, minimumResults: 10, maxLabsSeeds: 5, maxRelatedSeeds: 3,
            // The site's own reach ceiling (siteDifficultyCeiling), at most 45.
            maximumDifficulty: Math.min(45, context.maximumDifficulty ?? 45),
            // Keep what this site can win when discovery truncates (its measured authority, if any).
            ...(tenantAuthority !== null ? { tenantAuthority } : {}),
            excludeKeyword: exclusion, onDiagnostics: d => { discovery = d; } });
      } catch { return []; }
    });
    found = metered.result;
    const evidence = measured as DomainAuthorityEvidence | null;
    if (evidence) {
      try {
        await ctx.runMutation(internal.sites.recordSeoAuthorityEvidenceInternal, { siteId,
          expectedCanonicalDomain: context.canonicalDomain, expectedDomainRevision: context.domainRevision,
          domain: evidence.domain, domainRank: evidence.domainRank, referringDomains: evidence.referringDomains,
          source: evidence.source, measuredAt: evidence.measuredAt });
      } catch { /* the domain changed meanwhile: keep nothing */ }
    }
    // Searches the site already appears for in Google (no article of its own yet), then the researched ones.
    const searchConsole = context.searchConsole.filter(q => exclusion(q.keyword) === undefined).map(q => ({ keyword: q.keyword,
      searchVolume: Math.max(1, Math.round(q.impressions)), difficulty: 0, difficultyMeasured: false,
      source: "search_console" as const, position: q.position }));
    const candidates = [...searchConsole, ...found.slice(0, 60).map(k => ({ keyword: k.keyword, searchVolume: Math.max(0, Math.round(k.searchVolume || 0)),
      difficulty: Math.max(0, Math.min(100, Math.round(k.difficulty || 0))), difficultyMeasured: Boolean(k.difficultyMeasured) }))];
    // Buyer fit (P105): one cheap call judges every candidate for this
    // business. A candidate it could not judge is still added; the daily
    // sweep judges it before Autopilot is likely to reach it.
    let fit = new Map<string, BuyerFitVerdict>(), fitCostMicroUsd = 0;
    if (candidates.length > 0) {
      try { ({ verdicts: fit, costMicroUsd: fitCostMicroUsd } = await judgeBuyerFit(context.business, candidates.map(k => k.keyword))); }
      catch { fitCostMicroUsd = BUYER_FIT_CEILING_MICRO_USD; }
    }
    const keywords = candidates.map(k => {
      const verdict = fit.get(normalizeFitKeyword(k.keyword));
      return verdict ? { ...k, fit: { keep: verdict.keep, reason: verdict.reason } } : k;
    });
    // Settle at DataForSEO's reported cost plus the fit call (its list price,
    // or its ceiling when its answer was lost). An uncertain DataForSEO total
    // (a request that failed after it was sent) keeps the whole reservation.
    if (!metered.uncertain) {
      await ctx.runMutation(internal.contentWork.closeTopicResearchReservation, { siteId, reservationId, sent: true,
        actualMicroUsd: Math.ceil(metered.usd * 1_000_000) + fitCostMicroUsd });
    }
    // Always report back (even empty) so a waiting Autopilot slot continues.
    // What this run saw is kept with the outcome, so a thin run can be explained.
    const seen = discovery;
    const research = { seeds: context.seeds.slice(0, 15), searchConsole: searchConsole.length,
      ...(seen ? { discovered: seen.unique, excludedKnown: seen.excluded.already_known, excludedFit: seen.excluded.product_fit,
        excludedIntent: seen.excluded.existing_intent } : {}) };
    const result: { added: number } = await ctx.runMutation(internal.contentWork.addResearchedTopics, { siteId, keywords, research });
    return result;
  } });

/** Judge the planned topics of one Autopilot site that have no buyer-fit
 * verdict for its current business profile (topics from before P105, or a
 * research batch whose fit call failed). Bounded: one call, at most
 * BUYER_FIT_MAX_KEYWORDS topics, its spend reserved before the call. */
export const sweepBuyerFit = internalAction({ args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{ judged: number; rejected: number }> => {
    const context: { business: BuyerFitBusiness; topics: Array<{ topicId: Id<"topic_clusters">; keyword: string }> } | null =
      await ctx.runQuery(internal.contentWork.buyerFitSweepContext, { siteId });
    if (!context || context.topics.length === 0) return { judged: 0, rejected: 0 };
    const reservationId: Id<"provider_spend_reservations"> | null = await ctx.runMutation(internal.contentWork.reserveBuyerFitSweep, { siteId });
    if (!reservationId) return { judged: 0, rejected: 0 };
    let verdicts = new Map<string, BuyerFitVerdict>(), costMicroUsd = BUYER_FIT_CEILING_MICRO_USD;
    try { ({ verdicts, costMicroUsd } = await judgeBuyerFit(context.business, context.topics.map(t => t.keyword))); }
    catch { /* the call's ceiling is settled; the topics are judged on the next sweep */ }
    const judged = context.topics.flatMap(t => {
      const verdict = verdicts.get(normalizeFitKeyword(t.keyword));
      return verdict ? [{ topicId: t.topicId, eligible: verdict.keep, reason: verdict.reason }] : [];
    });
    await ctx.runMutation(internal.contentWork.recordBuyerFit, { siteId, reservationId, actualMicroUsd: costMicroUsd, verdicts: judged });
    return { judged: judged.length, rejected: judged.filter(j => !j.eligible).length };
  } });

/** Daily: every Autopilot site's unjudged planned topics get a verdict. */
export const sweepBuyerFitFleet = internalAction({ args: {},
  handler: async (ctx): Promise<{ sites: number; judged: number; rejected: number }> => {
    let cursor: string | null = null, sites = 0, judged = 0, rejected = 0;
    for (let page = 0; page < 100; page++) {
      const batch: { siteIds: Id<"sites">[]; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.contentWork.buyerFitSweepSites, { cursor });
      for (const siteId of batch.siteIds) {
        try {
          const result = await ctx.runAction(internal.actions.growthTopics.sweepBuyerFit, { siteId });
          sites++; judged += result.judged; rejected += result.rejected;
        } catch (error) { console.warn(`Buyer-fit sweep skipped ${siteId}: ${error instanceof Error ? error.message : "unknown"}`); }
      }
      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }
    return { sites, judged, rejected };
  } });
