import { internalMutation, internalQuery, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  addSearchConsoleDays,
  aggregateSearchQueries,
  GSC_INSPECTION_COHORT_DAYS,
  isBrandedSearchQuery,
  isOpenIndexingIncident,
  isSameSearchConsolePage,
  publishedArticlePageUrl,
  searchConsoleDate,
  selectGscInspectionQueue,
  summarizeSearchPagePerformance,
  summarizeSearchPerformance,
} from "./lib/searchPerformance";
import { effectivePublishedAt } from "./lib/autopilotBuffer";
import {
  isCompleteGscDateRange,
  mergeGscDateEpochReceipts,
} from "./lib/gscSearchAnalytics";
import {
  siteExecutionActive,
  siteExecutionAuthorized,
} from "./lib/planSiteAllowance";
import { v } from "convex/values";
import {
  articleMatchesCurrentDomain,
  collectCurrentDomainPublishedSummariesSince,
  gscConnectionMatchesCurrentDomain,
  gscInspectionMatchesCurrentConnection,
  normalizeCanonicalDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteGscConnectionRevision,
  siteUsesLegacyGscRows,
} from "./lib/siteDomainBinding";
import {
  takeCurrentGscPageRows,
  takeCurrentGscQueryRows,
} from "./lib/currentGscRows";

const DAILY_SYNC_VERSION = 2;
const SEO_WINDOWS_DAYS = [7, 14, 28, 56] as const;
const DISCOVERY_GSC_READ_LIMIT = 5_000;
const OWNER_GSC_READ_LIMIT = 5_000;

function completeCurrentGscRows<Row>(
  result: { rows: Row[]; exhausted: boolean },
  label: string,
): Row[] {
  if (result.exhausted) {
    throw new Error(`Current Search Console ${label} read limit exceeded`);
  }
  return result.rows;
}

function assertCurrentGscDomainBinding(
  site: Doc<"sites">,
  expectedCanonicalDomain: string,
  expectedDomainRevision: number,
  expectedConnectionRevision: number,
  expectedProperty: string,
) {
  if (
    !gscConnectionMatchesCurrentDomain(site) ||
    normalizeCanonicalDomain(expectedCanonicalDomain) !==
      siteCanonicalDomain(site) ||
    expectedDomainRevision !== siteCanonicalDomainRevision(site) ||
    expectedConnectionRevision !== siteGscConnectionRevision(site) ||
    expectedProperty !== site.gscProperty
  ) {
    throw new Error("Search Console connection belongs to an earlier site domain");
  }
}

async function requireSiteOwner(ctx: QueryCtx, siteId: Id<"sites">) {
  const site = await ctx.db.get(siteId);
  const identity = await ctx.auth.getUserIdentity();
  if (
    !site?.userId ||
    site.deletionStatus ||
    !identity ||
    identity.subject !== site.userId
  ) {
    throw new Error("Not authorized to access this site's search performance");
  }
  return site;
}

/**
 * Return compact, non-branded demand signals for verified topic discovery.
 * These are queries Google has already associated with this tenant, so they
 * are safer and more specific seeds than generic industry vocabulary. The
 * query is internal-only and returns no OAuth credentials or raw site config.
 */
export const getDiscoverySignalsInternal = internalQuery({
  args: {
    siteId: v.id("sites"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { siteId, limit }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) throw new Error("Site not found");
    if (!gscConnectionMatchesCurrentDomain(site)) return [];
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const receipts = site.gscDateEpochs ?? [];
    if (!siteUsesLegacyGscRows(site) && receipts.length === 0) {
      return [];
    }
    const currentRows = receipts.length > 0
      ? await takeCurrentGscQueryRows(
        ctx,
        site,
        DISCOVERY_GSC_READ_LIMIT,
        { startDate: cutoff },
      )
      : undefined;
    if (currentRows?.exhausted) return [];
    const rows = currentRows?.rows ?? await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .gte("date", cutoff),
        )
        .collect();
    const byQuery = new Map<string, {
      query: string;
      clicks: number;
      impressions: number;
      weightedPosition: number;
    }>();
    for (const row of rows) {
      const query = row.query.trim().toLowerCase().replace(/\s+/g, " ");
      const wordCount = query.split(" ").filter(Boolean).length;
      if (
        !query ||
        row.impressions <= 0 ||
        wordCount < 2 ||
        wordCount > 8 ||
        isBrandedSearchQuery(query, site.domain)
      ) continue;
      const aggregate = byQuery.get(query) ?? {
        query,
        clicks: 0,
        impressions: 0,
        weightedPosition: 0,
      };
      aggregate.clicks += row.clicks;
      aggregate.impressions += row.impressions;
      aggregate.weightedPosition += row.position * row.impressions;
      byQuery.set(query, aggregate);
    }
    return [...byQuery.values()]
      .sort((left, right) =>
        right.clicks - left.clicks ||
        right.impressions - left.impressions ||
        left.weightedPosition / left.impressions -
          right.weightedPosition / right.impressions
      )
      .slice(0, Math.max(1, Math.min(limit ?? 12, 30)))
      .map((signal) => ({
        query: signal.query,
        clicks: signal.clicks,
        impressions: signal.impressions,
        position: Math.round(
          (signal.weightedPosition / signal.impressions) * 10,
        ) / 10,
      }));
  },
});

// Upsert a search performance record (avoids duplicates for same site+date+query)
export const upsert = internalMutation({
  args: {
    siteId: v.id("sites"),
    date: v.string(),
    query: v.string(),
    page: v.optional(v.string()),
    clicks: v.number(),
    impressions: v.number(),
    ctr: v.number(),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    const existing = await ctx.db
      .query("search_performance")
      .withIndex("by_site_date_query", (q) =>
        q.eq("siteId", args.siteId).eq("date", args.date).eq("query", args.query),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        clicks: args.clicks,
        impressions: args.impressions,
        ctr: args.ctr,
        position: args.position,
        page: args.page,
      });
      return existing._id;
    }

    // Insert new record
    return await ctx.db.insert("search_performance", {
      siteId: args.siteId,
      date: args.date,
      query: args.query,
      page: args.page,
      clicks: args.clicks,
      impressions: args.impressions,
      ctr: args.ctr,
      position: args.position,
      createdAt: Date.now(),
    });
  },
});

// Save one daily GSC response in a single Convex mutation. Version 2 keeps
// actual date+query+page rows separate from the legacy rolling-window
// snapshots so article-level trends remain attributable.
export const upsertBatch = internalMutation({
  args: {
    siteId: v.id("sites"),
    syncEpoch: v.string(),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedConnectionRevision: v.number(),
    expectedProperty: v.string(),
    rows: v.array(v.object({
      date: v.string(),
      query: v.string(),
      page: v.optional(v.string()),
      clicks: v.number(),
      impressions: v.number(),
      ctr: v.number(),
      position: v.number(),
    })),
  },
  handler: async (
    ctx,
    {
      siteId,
      syncEpoch,
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionRevision,
      expectedProperty,
      rows,
    },
  ) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    assertCurrentGscDomainBinding(
      site,
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionRevision,
      expectedProperty,
    );
    if (site.gscPendingSyncEpoch !== syncEpoch) {
      throw new Error("GSC sync epoch was superseded before query persistence");
    }
    const syncedAt = Date.now();
    for (const row of rows) {
      await ctx.db.insert("search_performance", {
        siteId,
        ...row,
        syncVersion: DAILY_SYNC_VERSION,
        syncEpoch,
        syncedAt,
        createdAt: syncedAt,
      });
    }
    return { inserted: rows.length, updated: 0, saved: rows.length };
  },
});

export const upsertPageBatch = internalMutation({
  args: {
    siteId: v.id("sites"),
    syncEpoch: v.string(),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedConnectionRevision: v.number(),
    expectedProperty: v.string(),
    rows: v.array(v.object({
      date: v.string(),
      page: v.string(),
      clicks: v.number(),
      impressions: v.number(),
      weightedPosition: v.number(),
      nonBrandedClicks: v.number(),
      nonBrandedImpressions: v.number(),
      nonBrandedWeightedPosition: v.number(),
      queryClicks: v.number(),
      queryImpressions: v.number(),
      unattributedClicks: v.number(),
      unattributedImpressions: v.number(),
      queryCoverageComplete: v.boolean(),
    })),
  },
  handler: async (
    ctx,
    {
      siteId,
      syncEpoch,
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionRevision,
      expectedProperty,
      rows,
    },
  ) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    assertCurrentGscDomainBinding(
      site,
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionRevision,
      expectedProperty,
    );
    if (site.gscPendingSyncEpoch !== syncEpoch) {
      throw new Error("GSC sync epoch was superseded before page persistence");
    }
    const syncedAt = Date.now();
    for (const row of rows) {
      await ctx.db.insert("search_page_daily", {
        siteId,
        ...row,
        syncEpoch,
        syncedAt,
        createdAt: syncedAt,
      });
    }
    return { inserted: rows.length, updated: 0, saved: rows.length };
  },
});

export const beginSyncEpoch = internalMutation({
  args: {
    siteId: v.id("sites"),
    syncEpoch: v.string(),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedConnectionRevision: v.number(),
    expectedProperty: v.string(),
    mode: v.union(v.literal("recent"), v.literal("backfill")),
    windowStart: v.string(),
    windowEnd: v.string(),
  },
  handler: async (
    ctx,
    {
      siteId,
      syncEpoch,
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionRevision,
      expectedProperty,
      mode,
      windowStart,
      windowEnd,
    },
  ) => {
    const site = await ctx.db.get(siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    assertCurrentGscDomainBinding(
      site,
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionRevision,
      expectedProperty,
    );
    if (!syncEpoch) throw new Error("GSC sync epoch is required");
    if (addSearchConsoleDays(windowStart, 27) !== windowEnd) {
      throw new Error("A GSC sync phase must cover exactly 28 days");
    }
    if (mode === "recent" && site.gscDataThrough && windowEnd < site.gscDataThrough) {
      throw new Error("A recent GSC sync cannot move data coverage backward");
    }
    if (mode === "backfill") {
      if (
        !site.gscDataThrough ||
        windowStart !== addSearchConsoleDays(site.gscDataThrough, -55) ||
        windowEnd !== addSearchConsoleDays(site.gscDataThrough, -28)
      ) {
        throw new Error("A GSC backfill must cover the missing older 28-day window");
      }
    }
    const previousPendingEpoch = site.gscPendingSyncEpoch;
    const startedAt = Date.now();
    await ctx.db.patch(site._id, {
      gscPendingSyncEpoch: syncEpoch,
      gscPendingSyncMode: mode,
      gscPendingWindowStart: windowStart,
      gscPendingDataThrough: windowEnd,
      gscPendingStartedAt: startedAt,
      updatedAt: startedAt,
    });
    return {
      previousPendingEpoch:
        previousPendingEpoch &&
        previousPendingEpoch !== syncEpoch
          ? previousPendingEpoch
          : undefined,
    };
  },
});

export const completeSyncEpoch = internalMutation({
  args: {
    siteId: v.id("sites"),
    syncEpoch: v.string(),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedConnectionRevision: v.number(),
    expectedProperty: v.string(),
    mode: v.union(v.literal("recent"), v.literal("backfill")),
    windowStart: v.string(),
    windowEnd: v.string(),
    syncedDates: v.array(v.string()),
    queryRows: v.number(),
    pageRows: v.number(),
    requests: v.number(),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    assertCurrentGscDomainBinding(
      site,
      args.expectedCanonicalDomain,
      args.expectedDomainRevision,
      args.expectedConnectionRevision,
      args.expectedProperty,
    );
    if (site.gscPendingSyncEpoch !== args.syncEpoch) {
      throw new Error("GSC sync epoch was superseded before completion");
    }
    if (
      site.gscPendingSyncMode !== args.mode ||
      site.gscPendingWindowStart !== args.windowStart ||
      site.gscPendingDataThrough !== args.windowEnd
    ) {
      throw new Error("GSC sync phase no longer matches its staged receipt");
    }
    if (addSearchConsoleDays(args.windowStart, 27) !== args.windowEnd) {
      throw new Error("A complete GSC epoch must cover exactly 28 days");
    }
    if (
      !args.syncEpoch ||
      args.queryRows < 0 ||
      args.pageRows < 0 ||
      args.requests <= 0
    ) {
      throw new Error("A complete GSC epoch requires bounded extraction evidence");
    }
    const dataThrough = args.mode === "recent"
      ? args.windowEnd
      : site.gscDataThrough;
    if (!dataThrough) {
      throw new Error("A GSC backfill requires a completed recent window");
    }
    if (
      args.mode === "recent" &&
      site.gscDataThrough &&
      dataThrough < site.gscDataThrough
    ) {
      throw new Error("A recent GSC sync cannot regress finalized coverage");
    }
    if (
      args.mode === "backfill" &&
      (
        args.windowStart !== addSearchConsoleDays(dataThrough, -55) ||
        args.windowEnd !== addSearchConsoleDays(dataThrough, -28)
      )
    ) {
      throw new Error("A completed GSC backfill no longer matches the active window");
    }
    const history = mergeGscDateEpochReceipts({
      current: site.gscDateEpochs ?? [],
      syncEpoch: args.syncEpoch,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      syncedDates: args.syncedDates,
      dataThrough,
    });
    const previousEpoch = site.gscSyncEpoch;
    const completedAt = Date.now();
    await ctx.db.patch(site._id, {
      gscSyncEpoch: args.mode === "recent" ? args.syncEpoch : previousEpoch,
      gscPendingSyncEpoch: undefined,
      gscPendingSyncMode: undefined,
      gscPendingWindowStart: undefined,
      gscPendingDataThrough: undefined,
      gscPendingStartedAt: undefined,
      gscDateEpochs: history.receipts,
      gscDataWindowStart: history.dataWindowStart,
      gscDataThrough: dataThrough,
      gscHistoryDays: history.historyDays,
      gscCompleteWindows: history.completeWindows,
      gscDataSyncedAt: completedAt,
      ...(args.mode === "recent" ? {
        gscQueryRows: args.queryRows,
        gscPageRows: args.pageRows,
      } : {}),
      gscAnalyticsRequests: args.requests,
      updatedAt: completedAt,
    });
    const epochsToPrune = new Set(history.epochsToPrune);
    if (
      args.mode === "recent" &&
      previousEpoch &&
      previousEpoch !== args.syncEpoch
    ) {
      epochsToPrune.add(previousEpoch);
    }
    return {
      dataThrough,
      dataWindowStart: history.dataWindowStart,
      historyDays: history.historyDays,
      completeWindows: history.completeWindows,
      epochsToPrune: [...epochsToPrune],
      backfillNeeded: history.historyDays < 56,
      backfillStart: addSearchConsoleDays(dataThrough, -55),
      backfillEnd: addSearchConsoleDays(dataThrough, -28),
    };
  },
});

const EPOCH_PRUNE_BATCH = 250;

export const pruneSyncEpoch = internalMutation({
  args: {
    siteId: v.id("sites"),
    syncEpoch: v.string(),
    table: v.union(v.literal("query"), v.literal("page")),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const site = await ctx.db.get(args.siteId);
    // Retired measurement rows are storage cleanup, not tenant execution.
    // Parking must not strand old-domain/old-connection epochs that can later
    // consume read limits when the tenant is reactivated.
    if (!site) return { deleted: 0, scheduled: false };
    const activeEpochByDate = new Map(
      (site.gscDateEpochs ?? []).map((receipt) => [
        receipt.date,
        receipt.syncEpoch,
      ]),
    );
    const result = args.table === "query"
      ? await ctx.db
        .query("search_performance")
        .withIndex("by_site_epoch_date", (q) =>
          q.eq("siteId", args.siteId).eq("syncEpoch", args.syncEpoch),
        )
        .paginate({ cursor: args.cursor ?? null, numItems: EPOCH_PRUNE_BATCH })
      : await ctx.db
        .query("search_page_daily")
        .withIndex("by_site_epoch_date", (q) =>
          q.eq("siteId", args.siteId).eq("syncEpoch", args.syncEpoch),
        )
        .paginate({ cursor: args.cursor ?? null, numItems: EPOCH_PRUNE_BATCH });
    let deleted = 0;
    for (const row of result.page) {
      if (activeEpochByDate.get(row.date) !== args.syncEpoch) {
        await ctx.db.delete(row._id);
        deleted++;
      }
    }
    const scheduled = !result.isDone;
    if (scheduled) {
      await ctx.scheduler.runAfter(0, internal.searchPerformance.pruneSyncEpoch, {
        ...args,
        cursor: result.continueCursor,
      });
    }
    return { deleted, scheduled };
  },
});

// Get top queries over the same honest 28-day window as the summary.
export const getTopQueries = query({
  args: { siteId: v.id("sites"), limit: v.optional(v.number()) },
  handler: async (ctx, { siteId, limit }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const receipts = site.gscDateEpochs ?? [];
    if (receipts.length > 0 && site.gscDataThrough) {
      const dataThrough = site.gscDataThrough;
      const windowStart = addSearchConsoleDays(dataThrough, -27);
      const recent = completeCurrentGscRows(
        await takeCurrentGscQueryRows(ctx, site, OWNER_GSC_READ_LIMIT, {
          startDate: windowStart,
          endDate: dataThrough,
        }),
        "top-query",
      );
      return aggregateSearchQueries(recent).slice(0, limit ?? 20);
    }
    if (!siteUsesLegacyGscRows(site)) return [];
    const latestDaily = await ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", siteId).eq("syncVersion", DAILY_SYNC_VERSION),
      )
      .order("desc")
      .first();
    const latest = latestDaily ?? await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) => q.eq("siteId", siteId))
      .order("desc")
      .first();
    if (!latest) return [];

    const windowStart = addSearchConsoleDays(latest.date, -27);
    const recent = latestDaily
      ? await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .gte("date", windowStart)
            .lte("date", latest.date),
        )
        .collect()
      : await ctx.db
        .query("search_performance")
        .withIndex("by_site_date", (q) =>
          q.eq("siteId", siteId).eq("date", latest.date),
        )
        .collect();

    return latestDaily
      ? aggregateSearchQueries(recent).slice(0, limit ?? 20)
      : recent
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .slice(0, limit ?? 20);
  },
});

// Get performance summary for a site
export const getSummary = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const receipts = site.gscDateEpochs ?? [];
    if (receipts.length > 0 && site.gscDataThrough) {
      const dataThrough = site.gscDataThrough;
      const windowStart = addSearchConsoleDays(dataThrough, -27);
      const [pageResult, queryResult] = await Promise.all([
        takeCurrentGscPageRows(ctx, site, OWNER_GSC_READ_LIMIT, {
          startDate: windowStart,
          endDate: dataThrough,
        }),
        takeCurrentGscQueryRows(ctx, site, OWNER_GSC_READ_LIMIT, {
          startDate: windowStart,
          endDate: dataThrough,
        }),
      ]);
      const pageRows = completeCurrentGscRows(pageResult, "page-summary");
      const queryRows = completeCurrentGscRows(queryResult, "query-summary");
      const pageSummary = summarizeSearchPagePerformance(pageRows);
      const querySummary = summarizeSearchPerformance(queryRows, site.domain);
      return {
        ...pageSummary,
        brandedClicks: querySummary.brandedClicks,
        brandedImpressions: querySummary.brandedImpressions,
        queryCount: querySummary.queryCount,
        dataDays: 28,
        observedDataDays: pageSummary.dataDays,
        syncedAt: site.gscDataSyncedAt,
        lastSync: dataThrough,
        dataThrough,
        windowStart,
        windowDays: 28,
        historyWindowStart: site.gscDataWindowStart,
        historyDays: site.gscHistoryDays ?? receipts.length,
        completeWindows: site.gscCompleteWindows ?? [],
        syncVersion: 3,
      };
    }
    if (!siteUsesLegacyGscRows(site)) return null;
    const latestDaily = await ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", siteId).eq("syncVersion", DAILY_SYNC_VERSION),
      )
      .order("desc")
      .first();
    const latest = latestDaily ?? await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) => q.eq("siteId", siteId))
      .order("desc")
      .first();
    if (!latest) return null;

    const windowStart = addSearchConsoleDays(latest.date, -27);
    const recent = latestDaily
      ? await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .gte("date", windowStart)
            .lte("date", latest.date),
        )
        .collect()
      : await ctx.db
        .query("search_performance")
        .withIndex("by_site_date", (q) =>
          q.eq("siteId", siteId).eq("date", latest.date),
        )
        .collect();

    const summary = summarizeSearchPerformance(recent, site.domain);

    return {
      ...summary,
      lastSync: latest.date,
      dataThrough: latest.date,
      windowStart: latestDaily ? windowStart : undefined,
      windowDays: latestDaily ? 28 : undefined,
      syncVersion: latestDaily?.syncVersion ?? 1,
    };
  },
});

// Get performance data for a specific article/page URL
export const getByPage = query({
  args: { siteId: v.id("sites"), pageUrl: v.string() },
  handler: async (ctx, { siteId, pageUrl }) => {
    const site = await requireSiteOwner(ctx, siteId);
    const receipts = site.gscDateEpochs ?? [];
    if (receipts.length === 0 && !siteUsesLegacyGscRows(site)) {
      return [];
    }
    const cutoff = receipts.length > 0 && site.gscDataThrough
      ? addSearchConsoleDays(site.gscDataThrough, -55)
      : new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];
    const hasDailyRows = receipts.length > 0 ? null : await ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", siteId).eq("syncVersion", DAILY_SYNC_VERSION),
      )
      .first();
    const candidates = receipts.length > 0
      ? completeCurrentGscRows(
        await takeCurrentGscQueryRows(ctx, site, OWNER_GSC_READ_LIMIT, {
          startDate: cutoff,
        }),
        "page-query",
      )
      : hasDailyRows
        ? await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .gte("date", cutoff),
        )
        .collect()
        : await ctx.db
          .query("search_performance")
          .withIndex("by_site_date", (q) =>
            q.eq("siteId", siteId).gte("date", cutoff),
          )
          .collect();
    return candidates.filter((r) => {
      if (!r.page) return false;
      return isSameSearchConsolePage(r.page, pageUrl);
    });
  },
});

async function articleSeoScorecard(
  ctx: QueryCtx,
  articleId: Id<"articles">,
) {
  const article = await ctx.db.get(articleId);
  if (!article) throw new Error("Article not found");
  if (article.status !== "published") {
    throw new Error("SEO scorecards require a published article");
  }
  const site = await ctx.db.get(article.siteId);
  if (!site) throw new Error("Site not found");
  if (!articleMatchesCurrentDomain(site, article)) {
    throw new Error("Article belongs to an earlier site domain");
  }

  const publicationTime = effectivePublishedAt(article);
  const startDate = searchConsoleDate(publicationTime);
  const maximumEndDate = addSearchConsoleDays(startDate, 55);
  const receipts = site.gscDateEpochs ?? [];
  const usesReceiptHistory = receipts.length > 0;
  const mayUseLegacyRows = siteUsesLegacyGscRows(site);
  const [latest, rows, authoritativeRows] = usesReceiptHistory
    ? await Promise.all([
        Promise.resolve(null),
        takeCurrentGscQueryRows(ctx, site, OWNER_GSC_READ_LIMIT, {
          startDate,
          endDate: maximumEndDate,
        }).then((result) => completeCurrentGscRows(result, "scorecard-query")),
        takeCurrentGscPageRows(ctx, site, OWNER_GSC_READ_LIMIT, {
          startDate,
          endDate: maximumEndDate,
        }).then((result) => completeCurrentGscRows(result, "scorecard-page")),
      ])
    : mayUseLegacyRows
      ? await Promise.all([
        ctx.db
          .query("search_performance")
          .withIndex("by_site_version_date", (q) =>
            q
              .eq("siteId", article.siteId)
              .eq("syncVersion", DAILY_SYNC_VERSION),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("search_performance")
          .withIndex("by_site_version_date", (q) =>
            q
              .eq("siteId", article.siteId)
              .eq("syncVersion", DAILY_SYNC_VERSION)
              .gte("date", startDate)
              .lte("date", maximumEndDate),
          )
          .collect(),
        Promise.resolve([]),
      ])
      : [null, [], []];

  const pageUrl = publishedArticlePageUrl(
    site.domain,
    site.urlStructure,
    article.slug,
  );
  const queryPageRows = rows.filter(
    (row) => !!row.page && isSameSearchConsolePage(row.page, pageUrl),
  );
  const pageTotalRows = authoritativeRows.filter(
    (row) => isSameSearchConsolePage(row.page, pageUrl),
  );
  const dataThrough = site.gscDataThrough ?? latest?.date;
  const dataWindowStart = usesReceiptHistory
    ? site.gscDataWindowStart
    : undefined;

  const windows = SEO_WINDOWS_DAYS.map((days) => {
    const expectedEndDate = addSearchConsoleDays(startDate, days - 1);
    const availableQueries = queryPageRows.filter(
      (row) => row.date <= expectedEndDate,
    );
    const availableTotals = pageTotalRows.filter(
      (row) => row.date <= expectedEndDate,
    );
    const clicks = usesReceiptHistory
      ? availableTotals.reduce((sum, row) => sum + row.clicks, 0)
      : availableQueries.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = usesReceiptHistory
      ? availableTotals.reduce((sum, row) => sum + row.impressions, 0)
      : availableQueries.reduce((sum, row) => sum + row.impressions, 0);
    const nonBranded = availableQueries.filter(
      (row) => !isBrandedSearchQuery(row.query, site.domain),
    );
    const nonBrandedClicks = usesReceiptHistory
      ? availableTotals.reduce((sum, row) => sum + row.nonBrandedClicks, 0)
      : nonBranded.reduce((sum, row) => sum + row.clicks, 0);
    const nonBrandedImpressions = usesReceiptHistory
      ? availableTotals.reduce(
          (sum, row) => sum + row.nonBrandedImpressions,
          0,
        )
      : nonBranded.reduce((sum, row) => sum + row.impressions, 0);
    const position = impressions > 0
      ? (
          usesReceiptHistory
            ? availableTotals.reduce(
                (sum, row) => sum + row.weightedPosition,
                0,
              )
            : availableQueries.reduce(
                (sum, row) => sum + row.position * row.impressions,
                0,
              )
        ) / impressions
      : null;
    const nonBrandedPosition = nonBrandedImpressions > 0
      ? nonBranded.reduce(
        (sum, row) => sum + row.position * row.impressions,
        0,
      ) / nonBrandedImpressions
      : null;
    const topQueries = [...availableQueries]
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
      .slice(0, 10)
      .map((row) => ({
        query: row.query,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        branded: isBrandedSearchQuery(row.query, site.domain),
      }));
    const unattributedClicks = usesReceiptHistory
      ? availableTotals.reduce(
          (sum, row) => sum + (row.unattributedClicks ?? 0),
          0,
        )
      : 0;
    const unattributedImpressions = usesReceiptHistory
      ? availableTotals.reduce(
          (sum, row) => sum + (row.unattributedImpressions ?? 0),
          0,
        )
      : 0;
    const queryCoverageComplete = usesReceiptHistory
      ? impressions === 0 || (
          availableTotals.length > 0 &&
          availableTotals.every((row) => row.queryCoverageComplete === true)
        )
      : false;
    const complete = usesReceiptHistory
      ? isCompleteGscDateRange(receipts, startDate, expectedEndDate)
      : Boolean(dataThrough && dataThrough >= expectedEndDate);
    const historyCoversStart = usesReceiptHistory
      ? receipts.some((receipt) => receipt.date === startDate)
      : Boolean(dataThrough && dataThrough >= startDate);
    return {
      days,
      expectedEndDate,
      complete,
      status: !historyCoversStart || !dataThrough
        ? "awaiting_data"
        : dataThrough < expectedEndDate
          ? "collecting"
          : impressions > 0
            ? "measured"
            : "no_search_visibility",
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
      unattributedClicks,
      unattributedImpressions,
      queryCoverageComplete,
      queryCount: new Set(availableQueries.map((row) => row.query)).size,
      topQueries,
    };
  });

  const currentInspection = gscInspectionMatchesCurrentConnection(site, article)
    ? article
    : undefined;
  return {
    articleId,
    title: article.title,
    pageUrl,
    publishedAt: publicationTime,
    recordedPublishedAt: article.publishedAt,
    startDate,
    dataWindowStart,
    dataThrough,
    historyDays: usesReceiptHistory ? site.gscHistoryDays : undefined,
    completeWindows: usesReceiptHistory ? site.gscCompleteWindows : undefined,
    syncVersion: usesReceiptHistory ? 3 : DAILY_SYNC_VERSION,
    indexInspection: {
      verdict: currentInspection?.gscIndexVerdict,
      coverageState: currentInspection?.gscCoverageState,
      pageFetchState: currentInspection?.gscPageFetchState,
      robotsTxtState: currentInspection?.gscRobotsTxtState,
      lastCrawlTime: currentInspection?.gscLastCrawlTime,
      inspectedAt: currentInspection?.gscInspectedAt,
      error: currentInspection?.gscInspectionError,
    },
    windows,
  };
}

// Traffic is the outcome metric. These fixed post-publication windows prevent
// a young article from being compared with an older article's longer exposure.
export const getArticleSeoScorecard = query({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => {
    const article = await ctx.db.get(articleId);
    if (!article) throw new Error("Article not found");
    await requireSiteOwner(ctx, article.siteId);
    return articleSeoScorecard(ctx, articleId);
  },
});

export const getArticleSeoScorecardInternal = internalQuery({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }) => articleSeoScorecard(ctx, articleId),
});

export const listPublishedForInspection = internalQuery({
  args: {
    siteId: v.id("sites"),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { siteId, now, limit }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) return [];
    const publishedAfter = now -
      GSC_INSPECTION_COHORT_DAYS * 24 * 60 * 60 * 1000;
    const articles = await collectCurrentDomainPublishedSummariesSince(
      ctx,
      site,
      publishedAfter,
    );
    const openActions = await ctx.db
      .query("seo_growth_actions")
      .withIndex("by_site_status", (q) =>
        q.eq("siteId", siteId).eq("status", "open")
      )
      .collect();
    const indexingIncidentPriority = new Map<string, number>();
    for (const action of openActions) {
      if (!isOpenIndexingIncident(action, siteId)) continue;
      const articleKey = String(action.articleId);
      indexingIncidentPriority.set(
        articleKey,
        Math.max(
          indexingIncidentPriority.get(articleKey) ?? 0,
          action.priority,
        ),
      );
    }
    const queue = selectGscInspectionQueue(
      articles.map((article) => ({
        articleId: article.articleId,
        siteId: article.siteId,
        slug: article.slug,
        publishedAt: article.publishedAt ?? article.articleCreatedAt,
        gscInspectedAt: gscInspectionMatchesCurrentConnection(site, article)
          ? article.gscInspectedAt
          : undefined,
        openIndexingIncidentPriority: indexingIncidentPriority.get(
          String(article.articleId),
        ),
      })),
      { siteId, now, limit },
    );
    return queue.map((article) => ({
      articleId: article.articleId,
      slug: article.slug,
      publishedAt: article.publishedAt,
      gscInspectedAt: article.gscInspectedAt,
    }));
  },
});

export const recordUrlInspection = internalMutation({
  args: {
    articleId: v.id("articles"),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedConnectionRevision: v.number(),
    expectedProperty: v.string(),
    verdict: v.optional(v.string()),
    coverageState: v.optional(v.string()),
    pageFetchState: v.optional(v.string()),
    robotsTxtState: v.optional(v.string()),
    lastCrawlTime: v.optional(v.string()),
    inspectedAt: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const article = await ctx.db.get(args.articleId);
    if (!article) throw new Error("Article not found");
    const site = await ctx.db.get(article.siteId);
    if (!site || !(await siteExecutionAuthorized(ctx, site))) {
      throw new Error("Site not found");
    }
    if (!articleMatchesCurrentDomain(site, article)) {
      throw new Error("Article belongs to an earlier site domain");
    }
    assertCurrentGscDomainBinding(
      site,
      args.expectedCanonicalDomain,
      args.expectedDomainRevision,
      args.expectedConnectionRevision,
      args.expectedProperty,
    );
    const patch = args.error
      ? {
        gscInspectedAt: args.inspectedAt,
        gscInspectionError: args.error,
        gscInspectionConnectionRevision: args.expectedConnectionRevision,
        gscInspectionProperty: args.expectedProperty,
      }
      : {
        gscIndexVerdict: args.verdict,
        gscCoverageState: args.coverageState,
        gscPageFetchState: args.pageFetchState,
        gscRobotsTxtState: args.robotsTxtState,
        gscLastCrawlTime: args.lastCrawlTime,
        gscInspectedAt: args.inspectedAt,
        gscInspectionError: undefined,
        gscInspectionConnectionRevision: args.expectedConnectionRevision,
        gscInspectionProperty: args.expectedProperty,
      };
    await ctx.db.patch(args.articleId, patch);
    const summary = await ctx.db
      .query("article_summaries")
      .withIndex("by_article", (q) => q.eq("articleId", args.articleId))
      .unique();
    if (summary) {
      await ctx.db.patch(summary._id, {
        ...patch,
        articleUpdatedAt: Date.now(),
      });
    }
  },
});

// Get all historical data for trend detection (content decay)
export const getHistory = internalQuery({
  args: { siteId: v.id("sites"), days: v.optional(v.number()) },
  handler: async (ctx, { siteId, days }) => {
    const site = await ctx.db.get(siteId);
    if (!siteExecutionActive(site)) throw new Error("Site not found");
    const boundedDays = Math.max(30, Math.min(days ?? 180, 365));
    const cutoff = new Date(Date.now() - boundedDays * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const receipts = site.gscDateEpochs ?? [];
    if (receipts.length > 0) {
      return completeCurrentGscRows(
        await takeCurrentGscQueryRows(ctx, site, OWNER_GSC_READ_LIMIT, {
          startDate: cutoff,
        }),
        "history",
      );
    }
    if (!siteUsesLegacyGscRows(site)) return [];
    const hasDailyRows = await ctx.db
      .query("search_performance")
      .withIndex("by_site_version_date", (q) =>
        q.eq("siteId", siteId).eq("syncVersion", DAILY_SYNC_VERSION),
      )
      .first();
    if (hasDailyRows) {
      return await ctx.db
        .query("search_performance")
        .withIndex("by_site_version_date", (q) =>
          q
            .eq("siteId", siteId)
            .eq("syncVersion", DAILY_SYNC_VERSION)
            .gte("date", cutoff),
        )
        .collect();
    }
    return await ctx.db
      .query("search_performance")
      .withIndex("by_site_date", (q) =>
        q.eq("siteId", siteId).gte("date", cutoff),
      )
      .collect();
  },
});
