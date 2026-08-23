"use node";

import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import {
  addSearchConsoleDays,
  GSC_INSPECTION_COOLDOWN_MS,
  isBrandedSearchQuery,
  publishedArticlePageUrl,
  searchConsoleDate,
} from "../lib/searchPerformance";
import {
  buildGscPageTotalRollups,
  fetchCompleteDailySearchAnalytics,
  type GscSearchAnalyticsDataset,
  type GscSearchAnalyticsRow,
} from "../lib/gscSearchAnalytics";
import { isSeoGrowthActuationEligible } from "../lib/seoGrowth";

const GSC_HTTP_TIMEOUT_MS = 20_000;

// ── Token Refresh ──

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number } | null> {
  const clientId = process.env.GSC_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(GSC_HTTP_TIMEOUT_MS),
  });

  if (!res.ok) {
    console.error(`GSC token refresh failed with HTTP ${res.status}`);
    return null;
  }

  const data = await res.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

// ── GSC Search Analytics API ──

interface GSCIndexStatusResult {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
}

type GscSyncResult = {
  mode: "recent" | "backfill";
  rows: number;
  pageRows: number;
  saved: number;
  requests: number;
  historyDays: number;
  completeWindows: number[];
  backfillScheduled: boolean;
  inspections: {
    checked: number;
    failed: number;
  };
};

type SitemapSubmissionResult = {
  sitemapUrl: string;
  verifiedAt: number;
  lastSubmitted?: string;
  isPending?: boolean;
  errors?: number;
  warnings?: number;
};

async function assertGscExecutionAuthorized(
  ctx: ActionCtx,
  siteId: Doc<"sites">["_id"],
): Promise<void> {
  const authorized = await ctx.runQuery(
    internal.executionAuthorization.isSiteExecutionAuthorized,
    { siteId },
  );
  if (!authorized) {
    throw new Error("Search Console sync is paused for this site");
  }
}

function sitemapUrlForDomain(domain: string): string {
  const origin = new URL(
    /^https?:\/\//i.test(domain) ? domain : `https://${domain}`,
  ).origin;
  return new URL("/sitemap.xml", origin).href;
}

async function submitAndVerifySitemap(
  accessToken: string,
  property: string,
  sitemapUrl: string,
  assertStillAuthorized: () => Promise<void>,
): Promise<SitemapSubmissionResult> {
  const endpoint =
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}` +
    `/sitemaps/${encodeURIComponent(sitemapUrl)}`;
  await assertStillAuthorized();
  const submitted = await fetch(endpoint, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GSC_HTTP_TIMEOUT_MS),
  });
  if (!submitted.ok) {
    throw new Error(
      `GSC sitemap submission failed with HTTP ${submitted.status}`,
    );
  }
  await assertStillAuthorized();
  const verified = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(GSC_HTTP_TIMEOUT_MS),
  });
  if (!verified.ok) {
    throw new Error(
      `GSC sitemap verification failed with HTTP ${verified.status}`,
    );
  }
  const data = await verified.json() as {
    path?: string;
    lastSubmitted?: string;
    isPending?: boolean;
    errors?: string | number;
    warnings?: string | number;
  };
  if (data.path !== sitemapUrl) {
    throw new Error("GSC returned a different sitemap path than Pentra submitted");
  }
  return {
    sitemapUrl,
    verifiedAt: Date.now(),
    lastSubmitted: data.lastSubmitted,
    isPending: data.isPending,
    errors: Number(data.errors ?? 0),
    warnings: Number(data.warnings ?? 0),
  };
}

async function fetchSearchAnalyticsPage(
  accessToken: string,
  property: string,
  dataset: GscSearchAnalyticsDataset,
  date: string,
  startRow: number,
  rowLimit: number,
  timeoutMs: number,
): Promise<GscSearchAnalyticsRow[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: date,
        endDate: date,
        dimensions: dataset === "query_detail"
          ? ["date", "query", "page"]
          : ["date", "page"],
        startRow,
        rowLimit,
        dataState: "final",
        type: "web",
        aggregationType: "byPage",
      }),
      signal: AbortSignal.timeout(
        Math.max(1, Math.min(GSC_HTTP_TIMEOUT_MS, timeoutMs)),
      ),
    },
  );

  if (!res.ok) {
    throw new Error(`GSC API request failed with HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.rows || [];
}

async function fetchUrlInspection(
  accessToken: string,
  property: string,
  inspectionUrl: string,
): Promise<GSCIndexStatusResult> {
  const res = await fetch(
    "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inspectionUrl,
        siteUrl: property,
        languageCode: "en-US",
      }),
      signal: AbortSignal.timeout(GSC_HTTP_TIMEOUT_MS),
    },
  );
  if (!res.ok) {
    throw new Error(
      `GSC URL Inspection request failed with HTTP ${res.status}`,
    );
  }
  const data = await res.json();
  return data.inspectionResult?.indexStatusResult ?? {};
}

async function syncPublishedInspections(
  ctx: ActionCtx,
  site: Doc<"sites">,
  accessToken: string,
  gscProperty: string,
): Promise<{ checked: number; failed: number }> {
  const now = Date.now();
  const recent = await ctx.runQuery(
    internal.searchPerformance.listPublishedForInspection,
    {
      siteId: site._id,
      now,
      limit: 20,
    },
  );
  let checked = 0;
  let failed = 0;
  for (const article of recent) {
    // Once daily is sufficient for index-state progression and avoids spending
    // inspection quota on unchanged URLs.
    if (
      article.gscInspectedAt &&
      article.gscInspectedAt > now - GSC_INSPECTION_COOLDOWN_MS
    ) {
      continue;
    }
    const inspectionUrl = publishedArticlePageUrl(
      site.domain,
      site.urlStructure,
      article.slug,
    );
    try {
      await assertGscExecutionAuthorized(ctx, site._id);
      const result = await fetchUrlInspection(
        accessToken,
        gscProperty,
        inspectionUrl,
      );
      await ctx.runMutation(
        internal.searchPerformance.recordUrlInspection,
        {
          articleId: article.articleId,
          verdict: result.verdict,
          coverageState: result.coverageState,
          pageFetchState: result.pageFetchState,
          robotsTxtState: result.robotsTxtState,
          lastCrawlTime: result.lastCrawlTime,
          inspectedAt: now,
        },
      );
      checked++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(
        internal.searchPerformance.recordUrlInspection,
        {
          articleId: article.articleId,
          inspectedAt: now,
          error: message.slice(0, 500),
        },
      );
      failed++;
    }
  }
  return { checked, failed };
}

// ── Sync Action: Pull GSC data for all connected sites ──

export const syncAllSites = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<{
    scheduled: number;
    skipped: number;
    failed: number;
    scheduledNext: boolean;
  }> => {
    const page = await ctx.runQuery(internal.sites.listGrowthPage, {
      cursor,
    });
    let scheduled = 0;
    let skipped = 0;
    let failed = 0;

    for (const [index, summary] of page.page.entries()) {
      if (!summary.gscConnected) {
        skipped++;
        continue;
      }
      try {
        // Every tenant gets its own bounded action. A slow or failing Google
        // request for one site cannot consume the fleet dispatcher or prevent
        // later tenants from being scheduled.
        await ctx.scheduler.runAfter(
          index * 250,
          internal.actions.gscSync.syncSiteInternal,
          { siteId: summary.siteId },
        );
        scheduled++;
      } catch {
        failed++;
        console.error("Failed to schedule one tenant-scoped GSC sync");
      }
    }

    let scheduledNext = false;
    if (!page.isDone) {
      try {
        await ctx.scheduler.runAfter(
          Math.max(1_000, page.page.length * 250),
          internal.actions.gscSync.syncAllSites,
          { cursor: page.continueCursor },
        );
        scheduledNext = true;
      } catch {
        failed++;
        console.error("Failed to schedule the next GSC fleet page");
      }
    }

    console.log(
      `GSC fleet page dispatched: ${scheduled} scheduled, ${skipped} skipped, ${failed} failed, next=${scheduledNext}.`,
    );
    return { scheduled, skipped, failed, scheduledNext };
  },
});

// ── Sync Action: Pull GSC data for a specific site ──

export const syncSite = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<GscSyncResult> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
    const identity = await ctx.auth.getUserIdentity();
    if (!site.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to sync this site");
    }
    if (!site.gscAccessToken || !site.gscProperty) throw new Error("GSC not connected for this site");

    return syncSiteGSC(ctx, site);
  },
});

// Credential-free, operator-only entry point for one explicitly selected
// tenant. This keeps scheduled and incident-response syncs bounded instead of
// reading or mutating every connected tenant.
export const syncSiteInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<GscSyncResult> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
    if (!site.gscAccessToken || !site.gscProperty) {
      throw new Error("GSC not connected for this site");
    }
    return syncSiteGSC(ctx, site);
  },
});

// A new tenant first commits the current finalized 28 days, then receives one
// separate tenant-scoped request for the preceding 28 days. A stale scheduled
// backfill exits before token refresh or Search Console traffic.
export const syncHistoryBackfillInternal = internalAction({
  args: {
    siteId: v.id("sites"),
    anchorDataThrough: v.string(),
  },
  handler: async (ctx, { siteId, anchorDataThrough }): Promise<GscSyncResult> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
    if (site.gscDataThrough !== anchorDataThrough) {
      throw new Error("GSC history backfill was superseded by a newer recent window");
    }
    if ((site.gscCompleteWindows ?? []).includes(56)) {
      return {
        mode: "backfill",
        rows: 0,
        pageRows: 0,
        saved: 0,
        requests: 0,
        historyDays: site.gscHistoryDays ?? 56,
        completeWindows: site.gscCompleteWindows ?? [7, 14, 28, 56],
        backfillScheduled: false,
        inspections: { checked: 0, failed: 0 },
      };
    }
    if (!site.gscAccessToken || !site.gscProperty) {
      throw new Error("GSC not connected for this site");
    }
    const accessToken = await refreshedSiteAccessToken(ctx, site);
    const result = await syncAnalyticsWindow(ctx, site, accessToken, {
      mode: "backfill",
      windowStart: addSearchConsoleDays(anchorDataThrough, -55),
      windowEnd: addSearchConsoleDays(anchorDataThrough, -28),
    });
    return {
      ...result,
      backfillScheduled: false,
      inspections: { checked: 0, failed: 0 },
    };
  },
});

// Search Console's Sitemap API is the correct general-purpose discovery path
// for ordinary web pages. It is tenant-scoped, refreshes only that tenant's
// OAuth token, and verifies the exact submitted sitemap before reporting
// success. The restricted Indexing API is intentionally not used here.
export const submitSitemapInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<SitemapSubmissionResult> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
    await assertGscExecutionAuthorized(ctx, siteId);
    if (!isSeoGrowthActuationEligible(site)) {
      throw new Error(
        "SEO growth actuation is not enabled for this tenant rollout",
      );
    }
    if (!site.gscAccessToken || !site.gscProperty) {
      throw new Error("GSC not connected for this site");
    }
    if (
      !site.gscScopes
        ?.split(/\s+/)
        .includes("https://www.googleapis.com/auth/webmasters")
    ) {
      throw new Error(
        "Search Console must be reconnected with sitemap-submission permission",
      );
    }
    let accessToken = site.gscAccessToken;
    if (site.gscRefreshToken) {
      const refreshed = await refreshAccessToken(site.gscRefreshToken);
      if (!refreshed) throw new Error("GSC access-token refresh failed");
      accessToken = refreshed.accessToken;
      await ctx.runMutation(internal.sites.setGscTokenInternal, {
        siteId,
        gscAccessToken: accessToken,
      });
    }
    return submitAndVerifySitemap(
      accessToken,
      site.gscProperty,
      sitemapUrlForDomain(site.domain),
      () => assertGscExecutionAuthorized(ctx, siteId),
    );
  },
});

async function scheduleEpochPruning(
  ctx: ActionCtx,
  siteId: Doc<"sites">["_id"],
  syncEpoch: string,
): Promise<void> {
  try {
    await ctx.scheduler.runAfter(
      0,
      internal.searchPerformance.pruneSyncEpoch,
      { siteId, syncEpoch, table: "query" },
    );
    await ctx.scheduler.runAfter(
      250,
      internal.searchPerformance.pruneSyncEpoch,
      { siteId, syncEpoch, table: "page" },
    );
  } catch {
    console.error("Failed to schedule obsolete GSC epoch pruning");
  }
}

async function refreshedSiteAccessToken(
  ctx: ActionCtx,
  site: Doc<"sites">,
): Promise<string> {
  await assertGscExecutionAuthorized(ctx, site._id);
  if (!site.gscAccessToken) throw new Error("GSC not connected for this site");
  if (!site.gscRefreshToken) return site.gscAccessToken;
  const refreshed = await refreshAccessToken(site.gscRefreshToken);
  if (!refreshed) return site.gscAccessToken;
  await ctx.runMutation(internal.sites.setGscTokenInternal, {
    siteId: site._id,
    gscAccessToken: refreshed.accessToken,
  });
  return refreshed.accessToken;
}

type AnalyticsWindowResult = Omit<GscSyncResult, "inspections" | "backfillScheduled">;

async function syncAnalyticsWindow(
  ctx: ActionCtx,
  site: Doc<"sites">,
  accessToken: string,
  window: {
    mode: "recent" | "backfill";
    windowStart: string;
    windowEnd: string;
  },
): Promise<AnalyticsWindowResult> {
  if (!site.gscProperty) throw new Error("GSC not connected for this site");
  const syncEpoch = crypto.randomUUID();
  const started = await ctx.runMutation(
    internal.searchPerformance.beginSyncEpoch,
    {
      siteId: site._id,
      syncEpoch,
      mode: window.mode,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
    },
  );
  if (started.previousPendingEpoch) {
    await scheduleEpochPruning(ctx, site._id, started.previousPendingEpoch);
  }

  console.log(
    `Fetching ${window.mode} GSC data for ${site.domain}: ${window.windowStart} → ${window.windowEnd}`,
  );
  const analytics = await fetchCompleteDailySearchAnalytics(
    async ({ dataset, date, startRow, rowLimit, timeoutMs }) => {
      await assertGscExecutionAuthorized(ctx, site._id);
      return fetchSearchAnalyticsPage(
        accessToken,
        site.gscProperty!,
        dataset,
        date,
        startRow,
        rowLimit,
        timeoutMs,
      );
    },
    { startDate: window.windowStart, endDate: window.windowEnd },
  );
  const rows = analytics.queryDetailRows;
  const pageRecords = buildGscPageTotalRollups({
    queryDetailRows: rows,
    pageTotalRows: analytics.pageTotalRows,
    isBrandedQuery: (query) => isBrandedSearchQuery(query, site.domain),
  });

  const dailyMap = new Map<string, {
    date: string;
    query: string;
    page: string;
    clicks: number;
    impressions: number;
    weightedPosition: number;
  }>();
  for (const row of rows) {
    const date = row.keys[0];
    const query = row.keys[1];
    const page = row.keys[2] || "";
    if (!date || !query) continue;
    const key = `${date}\u0000${query}\u0000${page}`;
    const existing = dailyMap.get(key);
    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      existing.weightedPosition += row.position * row.impressions;
    } else {
      dailyMap.set(key, {
        date,
        query,
        page,
        clicks: row.clicks,
        impressions: row.impressions,
        weightedPosition: row.position * row.impressions,
      });
    }
  }
  const records = Array.from(dailyMap.values(), (data) => ({
    date: data.date,
    query: data.query,
    page: data.page || undefined,
    clicks: data.clicks,
    impressions: data.impressions,
    ctr: data.impressions > 0 ? data.clicks / data.impressions : 0,
    position: data.impressions > 0
      ? Math.round((data.weightedPosition / data.impressions) * 10) / 10
      : 0,
  }));

  let saved = 0;
  for (let index = 0; index < records.length; index += 500) {
    const result = await ctx.runMutation(internal.searchPerformance.upsertBatch, {
      siteId: site._id,
      syncEpoch,
      rows: records.slice(index, index + 500),
    });
    saved += result.saved;
  }
  for (let index = 0; index < pageRecords.length; index += 500) {
    await ctx.runMutation(internal.searchPerformance.upsertPageBatch, {
      siteId: site._id,
      syncEpoch,
      rows: pageRecords.slice(index, index + 500),
    });
  }
  const completed = await ctx.runMutation(
    internal.searchPerformance.completeSyncEpoch,
    {
      siteId: site._id,
      syncEpoch,
      mode: window.mode,
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      syncedDates: analytics.dates,
      queryRows: records.length,
      pageRows: pageRecords.length,
      requests: analytics.requests,
    },
  );
  for (const obsoleteEpoch of completed.epochsToPrune) {
    await scheduleEpochPruning(ctx, site._id, obsoleteEpoch);
  }
  console.log(
    `Saved ${saved} daily query rows and ${pageRecords.length} page rollups for ${site.domain}`,
  );
  return {
    mode: window.mode,
    rows: rows.length,
    pageRows: pageRecords.length,
    saved,
    requests: analytics.requests,
    historyDays: completed.historyDays,
    completeWindows: completed.completeWindows,
  };
}

async function syncSiteGSC(
  ctx: ActionCtx,
  site: Doc<"sites">,
): Promise<GscSyncResult> {
  await assertGscExecutionAuthorized(ctx, site._id);
  if (!site.gscAccessToken || !site.gscProperty) {
    throw new Error("GSC not connected for this site");
  }
  const accessToken = await refreshedSiteAccessToken(ctx, site);
  const gscProperty = site.gscProperty;

  // Search Console dates are Pacific dates. The inclusive start is 27 days
  // before the finalized end date, producing exactly 28 one-day queries.
  const endStr = addSearchConsoleDays(searchConsoleDate(Date.now()), -3);
  const startStr = addSearchConsoleDays(endStr, -27);

  const recent = await syncAnalyticsWindow(ctx, site, accessToken, {
    mode: "recent",
    windowStart: startStr,
    windowEnd: endStr,
  });
  let backfillScheduled = false;
  if (!recent.completeWindows.includes(56)) {
    try {
      await ctx.scheduler.runAfter(
        1_000,
        internal.actions.gscSync.syncHistoryBackfillInternal,
        { siteId: site._id, anchorDataThrough: endStr },
      );
      backfillScheduled = true;
    } catch {
      console.error("Failed to schedule tenant-scoped GSC history backfill");
    }
  }

  const inspections = await syncPublishedInspections(
    ctx,
    site,
    accessToken,
    gscProperty,
  );

  return {
    ...recent,
    backfillScheduled,
    inspections,
  };
}
