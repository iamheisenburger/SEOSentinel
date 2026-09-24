"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { discoverKeywords } from "./seoData";
import { dataForSeoLocationCode } from "../lib/dataForSeoLocale";

/** Keyword research for an Autopilot site whose topics ran out. The spend is
 * reserved (and bounded) by contentWork.advance before this runs; any failure
 * simply adds no topics and the site retries after the replenish interval. */
export const replenish = internalAction({ args: { siteId: v.id("sites"), reservationId: v.id("provider_spend_reservations") },
  handler: async (ctx, { siteId }): Promise<{ added: number }> => {
    const context: { domain: string; language: string; targetCountry: string | null; seeds: string[] } | null =
      await ctx.runQuery(internal.contentWork.growthTopicContext, { siteId });
    if (!context || context.seeds.length === 0) return { added: 0 };
    let found: Awaited<ReturnType<typeof discoverKeywords>> = [];
    try {
      found = await discoverKeywords(context.seeds, dataForSeoLocationCode(context.targetCountry ?? undefined), context.language, 80,
        { targetDomain: context.domain, minimumResults: 10, maxLabsSeeds: 3, maxRelatedSeeds: 2, maximumDifficulty: 45 });
    } catch { found = []; }
    const keywords = found.slice(0, 60).map(k => ({ keyword: k.keyword, searchVolume: Math.max(0, Math.round(k.searchVolume || 0)),
      difficulty: Math.max(0, Math.min(100, Math.round(k.difficulty || 0))), difficultyMeasured: Boolean(k.difficultyMeasured) }));
    if (keywords.length === 0) return { added: 0 };
    const result: { added: number } = await ctx.runMutation(internal.contentWork.addResearchedTopics, { siteId, keywords });
    return result;
  } });
