"use node";

import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { discoverKeywords, getDomainAuthority, getExactKeywordDemandFromDataForSEO, getExactKeywordDifficultyFromDataForSEO,
  meterDataForSeoCost, type DomainAuthorityEvidence, type KeywordDiscoveryDiagnostics } from "./seoData";
import { dataForSeoLocationCode } from "../lib/dataForSeoLocale";
import { contentIntentConflicts, sharesBusinessSubject } from "../lib/autopilotBuffer";
import { structuredToolChoice } from "../lib/toolChoice";
import { BUYER_FIT_CEILING_MICRO_USD, BUYER_FIT_MAX_KEYWORDS, BUYER_FIT_MAX_TOKENS, BUYER_FIT_MODEL, BUYER_FIT_TOOL, buyerFitCostMicroUsd,
  buyerFitRequest, normalizeFitKeyword, parseBuyerFit, type BuyerFitBusiness, type BuyerFitVerdict } from "../lib/topicFit";
import { asksForFree, brandTerms, isBrandedKeyword, localSeeds, namesPlace, parseSearchSeeds, profileSeedRequest, SEARCH_SEEDS_MAX_TOKENS,
  SEARCH_SEEDS_TOOL, type SeedRead } from "../lib/missedSearches";
import { TOPIC_RESEARCH_METHOD } from "../lib/researchSeeds";

type ResearchContext = { domain: string; language: string; targetCountry: string | null; seeds: string[]; known: string[];
  coverage: string[]; dropped: string[]; signals: { coreBusinessSignals: string[]; productAnchorSignals: string[]; businessModelSignals: string[] };
  searchConsole: Array<{ keyword: string; impressions: number; position: number }>; tenantAuthority: number | null;
  canonicalDomain: string; domainRevision: number; business: BuyerFitBusiness; maximumDifficulty?: number };

/** P171: the free check's seed call (convex/lib/missedSearches.ts), read from
 * the business profile the owner confirmed. Throws when no usable answer came
 * back; the caller then counts the call's ceiling. */
async function proposeProfileSeeds(business: BuyerFitBusiness, brands: string[], covered: string[]) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.TOPIC_FIT_MODEL ?? BUYER_FIT_MODEL;
  const request = profileSeedRequest(business, covered);
  const response = await new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000, fetch }).messages.create({
    model, max_tokens: SEARCH_SEEDS_MAX_TOKENS, system: request.system,
    messages: [{ role: "user", content: request.userMessage }],
    tools: [{ name: SEARCH_SEEDS_TOOL, description: "Record the searches and the business summary.", input_schema: request.inputSchema, strict: true }],
    tool_choice: structuredToolChoice(model, SEARCH_SEEDS_TOOL),
  });
  const tool = response.content.find(block => block.type === "tool_use" && block.name === SEARCH_SEEDS_TOOL);
  return { read: parseSearchSeeds(tool && tool.type === "tool_use" ? tool.input : null, brands), costMicroUsd: buyerFitCostMicroUsd(response.usage) };
}

/** One buyer-fit call for a batch of keywords (convex/lib/topicFit.ts). It
 * throws when no verdict came back; the caller then counts the call's ceiling.
 * The free checker (convex/actions/freeCheck.ts) judges its searches with it too. */
export async function judgeBuyerFit(business: BuyerFitBusiness, keywords: string[]): Promise<{ verdicts: Map<string, BuyerFitVerdict>; costMicroUsd: number }> {
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
 * simply adds no topics and the site retries after the replenish interval.
 *
 * P171 (Oct 24 2026): research works the way the free check does. The
 * business's searches are read from its confirmed profile (one small model
 * call), phrase-match suggestions and Google's related searches are asked for
 * them within the site's reach, and the buyer-fit model decides; only a loose
 * relevance floor stands in front of it. Google Ads (the earlier first source)
 * is asked only when that finds almost nothing. pentra.dev's last run under
 * the earlier method found 353 searches and kept 5: word matching dropped 292
 * before the model judged any, and its seeds were its own drifted topics. */
export const replenish = internalAction({ args: { siteId: v.id("sites"), reservationId: v.id("provider_spend_reservations") },
  handler: async (ctx, { siteId, reservationId }): Promise<{ added: number }> => {
    const context: ResearchContext | null = await ctx.runQuery(internal.contentWork.growthTopicContext, { siteId });
    if (!context) {
      // Nothing was sent: the reservation is returned instead of held forever.
      await ctx.runMutation(internal.contentWork.closeTopicResearchReservation, { siteId, reservationId, sent: false, actualMicroUsd: 0 });
      return { added: 0 };
    }
    const brands = brandTerms(context.canonicalDomain, context.business.name);
    let read: SeedRead | null = null, seedCostMicroUsd = 0;
    try {
      // The newest searches it already has articles for, so the call reaches beyond them.
      const proposed = await proposeProfileSeeds(context.business, brands, context.known.slice(-30));
      read = proposed.read; seedCostMicroUsd = proposed.costMicroUsd;
    } catch (error) {
      // A call that was sent and lost counts at its ceiling.
      if (!(error instanceof Error && error.message === "ANTHROPIC_API_KEY not set")) seedCostMicroUsd = BUYER_FIT_CEILING_MICRO_USD;
    }
    // A business that serves particular places searches with them ("deli ann arbor").
    const places = read?.places ?? [], local = places.length > 0;
    // The short category topics first: phrase-match suggestions extend them into many searches, and a 4-5 word
    // search into almost none (P172: P171 rotated by run, so long-running sites asked the long searches first and
    // pentra.dev found 44 searches). Later runs reach new searches because covered and dropped ones are excluded.
    const topics = !read ? [] : local ? localSeeds(read.topics.length ? read.topics : read.searches, places) : read.topics;
    const seeds = [...new Set([...topics, ...(read && !local ? read.searches : []), ...context.seeds])];
    // Topics it has and searches the buyer-fit model already dropped for this profile (P172) are not asked again.
    const known = new Set([...context.known, ...context.dropped]);
    const coverage = context.coverage.map(primaryKeyword => ({ primaryKeyword }));
    // Only searches Autopilot could actually write count as found: not one it
    // has, not its own name, sharing a subject word with the business (the
    // buyer-fit model judges the rest), and no repeat of a page it has.
    const exclusion = (raw: string) => {
      const keyword = raw.trim().toLowerCase().replace(/\s+/g, " ");
      if (known.has(keyword)) return "already_known" as const;
      if (keyword.split(" ").length < 2 || keyword.length > 80 || isBrandedKeyword(keyword, brands) ||
        !sharesBusinessSubject(keyword, context.signals)) return "product_fit" as const;
      if (coverage.some(c => contentIntentConflicts({ primaryKeyword: keyword }, c))) return "existing_intent" as const;
      return undefined;
    };
    const discovery = { unique: 0, excluded: { already_known: 0, product_fit: 0, existing_intent: 0 } };
    const seen = (d: KeywordDiscoveryDiagnostics) => {
      discovery.unique += d.unique;
      for (const reason of ["already_known", "product_fit", "existing_intent"] as const) discovery.excluded[reason] += d.excluded[reason];
    };
    // The site's own reach ceiling (siteDifficultyCeiling), at most 45.
    const ceiling = Math.min(45, context.maximumDifficulty ?? 45);
    const location = dataForSeoLocationCode(context.targetCountry ?? undefined);
    // A site without fresh authority evidence is measured once within this
    // research run (one backlinks summary, inside the same reservation), so
    // discovery and topic order keep what it can actually win.
    let tenantAuthority = context.tenantAuthority;
    let measured: DomainAuthorityEvidence | null = null;
    const metered = await meterDataForSeoCost(async () => {
      if (tenantAuthority === null) {
        try { measured = await getDomainAuthority(context.domain); if (measured) tenantAuthority = measured.domainRank; } catch { /* discovery still runs */ }
      }
      const found = new Map<string, Awaited<ReturnType<typeof discoverKeywords>>[number]>();
      const take = async (run: () => ReturnType<typeof discoverKeywords>) => {
        try { for (const k of await run()) { const key = normalizeFitKeyword(k.keyword); if (!found.has(key)) found.set(key, k); } }
        catch { /* the next source still runs */ }
      };
      // Keep what this site can win when discovery truncates (its measured authority, if any).
      const shared = { maximumDifficulty: ceiling, excludeKeyword: exclusion, onDiagnostics: seen,
        ...(tenantAuthority !== null ? { tenantAuthority } : {}) };
      if (seeds.length > 0) {
        // Phrase-match suggestions for the business's topics (then its searches) and Google's related searches for the first two.
        await take(() => discoverKeywords(seeds, location, context.language, 80, { ...shared, maxGoogleAdsBatches: 0, maxLabsSeeds: 8,
          maxRelatedSeeds: 2, useKeywordIdeas: false, minimumResults: 30, expandProductAnchors: true }));
        // Category ideas range wider: asked only when the topics found too few.
        if (found.size < 15) await take(() => discoverKeywords(seeds, location, context.language, 40, { ...shared, maxGoogleAdsBatches: 0,
          maxLabsSeeds: 0, maxRelatedSeeds: 0, useKeywordIdeas: true, minimumResults: 30, expandProductAnchors: true }));
      }
      // The earlier method (Google Ads first) for a market the topic data barely covers.
      if (found.size < 10 && context.seeds.length > 0) await take(() => discoverKeywords(context.seeds, location, context.language, 80,
        { ...shared, targetDomain: context.domain, minimumResults: 10, maxLabsSeeds: 5, maxRelatedSeeds: 3 }));
      return [...found.values()];
    });
    const found = metered.result;
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
    // Researched searches the site can win: measured difficulty within its
    // reach, at least 10 searches a month, naming its places when it serves
    // particular places, and no "free" searches when it has no free plan.
    const offered = (keyword: string) => (!local || namesPlace(keyword, places)) && (read?.freePlan !== "no" || !asksForFree(keyword));
    const researched = found.filter(k => k.difficultyMeasured && k.difficulty <= ceiling && k.searchVolume >= 10 && offered(k.keyword))
      .sort((a, b) => b.searchVolume - a.searchVolume);
    const candidates = [...searchConsole, ...researched.map(k => ({ keyword: k.keyword, searchVolume: Math.max(0, Math.round(k.searchVolume || 0)),
      difficulty: Math.max(0, Math.min(100, Math.round(k.difficulty || 0))), difficultyMeasured: Boolean(k.difficultyMeasured) }))]
      .slice(0, BUYER_FIT_MAX_KEYWORDS);
    // Buyer fit (P105): one cheap call judges every candidate for this
    // business. A candidate it could not judge is still added only if word
    // matching admits it; the daily sweep judges it before Autopilot reaches it.
    let fit = new Map<string, BuyerFitVerdict>(), fitCostMicroUsd = 0;
    if (candidates.length > 0) {
      try { ({ verdicts: fit, costMicroUsd: fitCostMicroUsd } = await judgeBuyerFit(context.business, candidates.map(k => k.keyword))); }
      catch { fitCostMicroUsd = BUYER_FIT_CEILING_MICRO_USD; }
    }
    const keywords = candidates.map(k => {
      const verdict = fit.get(normalizeFitKeyword(k.keyword));
      return verdict ? { ...k, fit: { keep: verdict.keep, reason: verdict.reason } } : k;
    });
    // Settle at DataForSEO's reported cost plus the model calls (their list
    // price, or their ceiling when an answer was lost). An uncertain DataForSEO
    // total (a request that failed after it was sent) keeps the whole reservation.
    if (!metered.uncertain) {
      const modelMicroUsd = seedCostMicroUsd + fitCostMicroUsd;
      await ctx.runMutation(internal.contentWork.closeTopicResearchReservation, { siteId, reservationId,
        sent: metered.usd > 0 || modelMicroUsd > 0, actualMicroUsd: Math.ceil(metered.usd * 1_000_000) + modelMicroUsd });
    }
    // Always report back (even empty) so a waiting Autopilot slot continues.
    // What this run saw is kept with the outcome, so a thin run can be explained.
    const research = { seeds: seeds.slice(0, 15), searchConsole: searchConsole.length, discovered: discovery.unique,
      excludedKnown: discovery.excluded.already_known, excludedFit: discovery.excluded.product_fit, excludedIntent: discovery.excluded.existing_intent,
      seedSource: read ? "model" as const : "site" as const, judged: fit.size, kept: [...fit.values()].filter(verdict => verdict.keep).length,
      method: TOPIC_RESEARCH_METHOD };
    const result: { added: number } = await ctx.runMutation(internal.contentWork.addResearchedTopics, { siteId, keywords, research });
    return result;
  } });

/** C4 (P158): measure a search the owner added: its monthly searches and
 * difficulty (DataForSEO, measured values only) and the buyer-fit verdict for
 * the business. They are notes for the owner; Autopilot writes the search
 * either way. The spend was reserved when the search was added. */
export const measureOwnerSearch = internalAction({ args: { siteId: v.id("sites"), topicId: v.id("topic_clusters"),
  reservationId: v.id("provider_spend_reservations") },
  handler: async (ctx, { siteId, topicId, reservationId }): Promise<{ measured: boolean }> => {
    const context = await ctx.runQuery(internal.contentWork.ownerSearchContext, { siteId, topicId });
    if (!context) {
      await ctx.runMutation(internal.contentWork.recordOwnerSearchMeasurement, { siteId, topicId, reservationId,
        sent: false, settle: false, actualMicroUsd: 0, measured: false });
      return { measured: false };
    }
    const location = dataForSeoLocationCode(context.targetCountry ?? undefined);
    const metered = await meterDataForSeoCost(async () => {
      let searchVolume: number | undefined, keywordDifficulty: number | undefined;
      // No row for the search means Google Ads reports no measurable demand.
      try { searchVolume = Math.round((await getExactKeywordDemandFromDataForSEO([context.keyword], location, context.language))[0]?.searchVolume ?? 0); }
      catch { /* not measured */ }
      try { keywordDifficulty = (await getExactKeywordDifficultyFromDataForSEO([context.keyword], location, context.language)).get(context.keyword); }
      catch { /* not measured */ }
      return { searchVolume, keywordDifficulty };
    });
    let fit: BuyerFitVerdict | undefined, fitCostMicroUsd = 0, fitSent = false;
    try {
      const judged = await judgeBuyerFit(context.business, [context.keyword]);
      fitSent = true; fitCostMicroUsd = judged.costMicroUsd; fit = judged.verdicts.get(normalizeFitKeyword(context.keyword));
    } catch (error) {
      // A call that was sent and lost counts at its ceiling.
      if (!(error instanceof Error && error.message === "ANTHROPIC_API_KEY not set")) { fitSent = true; fitCostMicroUsd = BUYER_FIT_CEILING_MICRO_USD; }
    }
    const { searchVolume, keywordDifficulty } = metered.result;
    await ctx.runMutation(internal.contentWork.recordOwnerSearchMeasurement, { siteId, topicId, reservationId,
      sent: metered.usd > 0 || metered.uncertain || fitSent, settle: !metered.uncertain,
      actualMicroUsd: Math.ceil(metered.usd * 1_000_000) + fitCostMicroUsd, measured: searchVolume !== undefined,
      ...(searchVolume !== undefined ? { searchVolume } : {}), ...(keywordDifficulty !== undefined ? { keywordDifficulty } : {}),
      ...(fit ? { fit: { keep: fit.keep, reason: fit.reason } } : {}) });
    return { measured: searchVolume !== undefined };
  } });

/** Judge the planned topics of one Autopilot site that have no buyer-fit
 * verdict for its current business profile (topics from before P105, or a
 * research batch whose fit call failed). Bounded: one call, at most
 * BUYER_FIT_MAX_KEYWORDS topics, its spend reserved before the call. */
export const sweepBuyerFit = internalAction({ args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{ judged: number; rejected: number }> => {
    // Stale "queued" locks go back to the plan first, so this sweep judges them too;
    // waiting articles that repeat a live page are replaced before their slot.
    await ctx.runMutation(internal.contentWork.releaseStaleTopicLocks, { siteId });
    await ctx.runMutation(internal.contentWork.retireDuplicateReadyWork, { siteId });
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
