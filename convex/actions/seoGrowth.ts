"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  addSearchConsoleDays,
  isSameSearchConsolePage,
  publishedArticlePageUrl,
  searchConsoleDate,
} from "../lib/searchPerformance";
import {
  classifySeoGrowth,
  type SeoGrowthClassification,
  type SeoWindow,
} from "../lib/seoGrowth";

const COHORT_WINDOWS = [7, 14, 28, 56] as const;

type GrowthInput = {
  site: {
    siteId: Id<"sites">;
    domain: string;
    urlStructure?: string;
  };
  dataThrough?: string;
  rows: Doc<"search_page_daily">[];
  articles: Array<{
    articleId: Id<"articles">;
    topicId?: Id<"topic_clusters">;
    title: string;
    slug: string;
    publishedAt: number;
    gscIndexVerdict?: string;
    gscCoverageState?: string;
    gscPageFetchState?: string;
    gscRobotsTxtState?: string;
    gscInspectionError?: string;
  }>;
  monthlyOrganicClicksGoal: number;
};

type GrowthScanResult = {
  articlesEvaluated: number;
  openActions: number;
  stageCounts: {
    awaitingData: number;
    indexingPending: number;
    indexingStalled: number;
    noVisibility: number;
    lowVisibility: number;
    strikingDistance: number;
    lowCtr: number;
    performing: number;
  };
};

export const scanAllSites = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<{
    scheduled: number;
    scheduledNext: boolean;
  }> => {
    const page = await ctx.runQuery(internal.sites.listGrowthPage, { cursor });
    let scheduled = 0;
    for (const site of page.page) {
      if (!site.gscConnected) continue;
      await ctx.scheduler.runAfter(
        scheduled * 250,
        internal.actions.seoGrowth.scanSite,
        { siteId: site.siteId },
      );
      scheduled++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        Math.max(1_000, scheduled * 250),
        internal.actions.seoGrowth.scanAllSites,
        { cursor: page.continueCursor },
      );
    }
    return { scheduled, scheduledNext: !page.isDone };
  },
});

export const scanSite = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<GrowthScanResult> => {
    const input: GrowthInput = await ctx.runQuery(
      internal.seoGrowth.getSiteInputs,
      { siteId },
    );
    const classifications: SeoGrowthClassification[] = input.articles.map((article) => {
      const startDate = searchConsoleDate(article.publishedAt);
      const pageUrl = publishedArticlePageUrl(
        input.site.domain,
        input.site.urlStructure,
        article.slug,
      );
      const pageRows = input.rows.filter((row) =>
        !!row.page && isSameSearchConsolePage(row.page, pageUrl)
      );
      const rollupReady = input.rows.length > 0;
      const windows: SeoWindow[] = COHORT_WINDOWS.map((days) => {
        const expectedEndDate = addSearchConsoleDays(startDate, days - 1);
        const rows = pageRows.filter(
          (row) => row.date >= startDate && row.date <= expectedEndDate,
        );
        const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
        const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
        const nonBrandedClicks = rows.reduce(
          (sum, row) => sum + row.nonBrandedClicks,
          0,
        );
        const nonBrandedImpressions = rows.reduce(
          (sum, row) => sum + row.nonBrandedImpressions,
          0,
        );
        const position = impressions > 0
          ? rows.reduce((sum, row) => sum + row.weightedPosition, 0) /
            impressions
          : null;
        const nonBrandedPosition = nonBrandedImpressions > 0
          ? rows.reduce(
            (sum, row) => sum + row.nonBrandedWeightedPosition,
            0,
          ) / nonBrandedImpressions
          : null;
        return {
          days,
          complete: Boolean(
            rollupReady &&
            input.dataThrough && input.dataThrough >= expectedEndDate,
          ),
          clicks,
          impressions,
          ctr: impressions > 0 ? clicks / impressions : 0,
          position: position === null ? null : Math.round(position * 10) / 10,
          nonBrandedClicks,
          nonBrandedImpressions,
          nonBrandedCtr: nonBrandedImpressions > 0
            ? nonBrandedClicks / nonBrandedImpressions
            : 0,
          nonBrandedPosition: nonBrandedPosition === null
            ? null
            : Math.round(nonBrandedPosition * 10) / 10,
        };
      });
      return classifySeoGrowth({
        articleId: article.articleId,
        startDate,
        dataThrough: input.dataThrough,
        indexInspection: {
          verdict: article.gscIndexVerdict,
          coverageState: article.gscCoverageState,
          pageFetchState: article.gscPageFetchState,
          robotsTxtState: article.gscRobotsTxtState,
          error: article.gscInspectionError,
        },
        windows,
      });
    });

    const windowStart = input.dataThrough
      ? addSearchConsoleDays(input.dataThrough, -27)
      : undefined;
    const rollingRows = windowStart
      ? input.rows.filter(
        (row) => row.date >= windowStart && row.date <= input.dataThrough!,
      )
      : [];
    const totalClicks = rollingRows.reduce((sum, row) => sum + row.clicks, 0);
    const totalImpressions = rollingRows.reduce(
      (sum, row) => sum + row.impressions,
      0,
    );
    const nonBrandedClicks = rollingRows.reduce(
      (sum, row) => sum + row.nonBrandedClicks,
      0,
    );
    const nonBrandedImpressions = rollingRows.reduce(
      (sum, row) => sum + row.nonBrandedImpressions,
      0,
    );
    const averagePosition = totalImpressions > 0
      ? Math.round((rollingRows.reduce(
        (sum, row) => sum + row.weightedPosition,
        0,
      ) / totalImpressions) * 10) / 10
      : 0;
    return await ctx.runMutation(internal.seoGrowth.reconcileSite, {
      siteId,
      classifications: classifications.map((classification) => ({
        ...classification,
        articleId: classification.articleId as Id<"articles">,
      })),
      health: {
        dataThrough: input.dataThrough,
        windowStart,
        windowDays: 28,
        dataDays: new Set(rollingRows.map((row) => row.date)).size,
        organicClicks: totalClicks,
        organicImpressions: totalImpressions,
        nonBrandedClicks,
        nonBrandedImpressions,
        averagePosition,
        monthlyOrganicClicksGoal: input.monthlyOrganicClicksGoal,
      },
    });
  },
});
