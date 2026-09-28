"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { discoverKeywords, meterDataForSeoCost } from "./seoData";
import { dataForSeoLocationCode } from "../lib/dataForSeoLocale";
import { contentIntentConflicts, evaluateTopicBusinessFit } from "../lib/autopilotBuffer";

type ResearchContext = { domain: string; language: string; targetCountry: string | null; seeds: string[]; known: string[];
  coverage: string[]; signals: { coreBusinessSignals: string[]; productAnchorSignals: string[]; businessModelSignals: string[] } };

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
    const metered = await meterDataForSeoCost(async () => {
      try {
        return await discoverKeywords(context.seeds, dataForSeoLocationCode(context.targetCountry ?? undefined), context.language, 80,
          { targetDomain: context.domain, minimumResults: 10, maxLabsSeeds: 5, maxRelatedSeeds: 3, maximumDifficulty: 45,
            excludeKeyword: exclusion });
      } catch { return []; }
    });
    found = metered.result;
    // Settle at DataForSEO's reported cost. An uncertain total (a request that
    // failed after it was sent) keeps the whole reservation, as before.
    if (!metered.uncertain) {
      await ctx.runMutation(internal.contentWork.closeTopicResearchReservation, { siteId, reservationId, sent: true,
        actualMicroUsd: Math.ceil(metered.usd * 1_000_000) });
    }
    const keywords = found.slice(0, 60).map(k => ({ keyword: k.keyword, searchVolume: Math.max(0, Math.round(k.searchVolume || 0)),
      difficulty: Math.max(0, Math.min(100, Math.round(k.difficulty || 0))), difficultyMeasured: Boolean(k.difficultyMeasured) }));
    // Always report back (even empty) so a waiting Autopilot slot continues.
    const result: { added: number } = await ctx.runMutation(internal.contentWork.addResearchedTopics, { siteId, keywords });
    return result;
  } });
