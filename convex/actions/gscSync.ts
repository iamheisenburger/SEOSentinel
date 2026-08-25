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
import { hardGscOAuthFailure } from "../lib/oneSetupCanonical.ts";
import {
  gscConnectionMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
  siteGscConnectionRevision,
} from "../lib/siteDomainBinding";

const GSC_HTTP_TIMEOUT_MS = 20_000;

type DomainBoundGscSite = Doc<"sites"> & {
  canonicalDomainRevision?: number;
};

class GscAuthorizationError extends Error {}

function canonicalSiteDomain(site: Doc<"sites">): string {
  const value = site.canonicalDomain ?? site.domain;
  return new URL(
    /^https?:\/\//i.test(value) ? value : `https://${value}`,
  ).hostname.toLowerCase().replace(/^www\./, "");
}

function gscReceiptFence(site: Doc<"sites">) {
  return {
    siteId: site._id,
    expectedCanonicalDomain: canonicalSiteDomain(site),
    expectedDomainRevision:
      (site as DomainBoundGscSite).canonicalDomainRevision ?? 0,
    expectedGscProperty: site.gscProperty!,
    expectedReceiptRevision: site.gscReceiptRevision ?? 0,
  };
}

async function revokeCapturedGscReceipt(
  ctx: ActionCtx,
  site: Doc<"sites">,
  reasonCode: "oauth_invalid_grant" | "provider_unauthorized",
): Promise<void> {
  if (!site.gscProperty) return;
  await ctx.runMutation(internal.sites.markGscReceiptRevokedInternal, {
    ...gscReceiptFence(site),
    reasonCode,
    revokedAt: Date.now(),
  });
}

// ── Token Refresh ──

type GscTokenRefresh =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; hardAuthFailure: boolean };

async function refreshAccessToken(refreshToken: string): Promise<GscTokenRefresh> {
  const clientId = process.env.GSC_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET;
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, hardAuthFailure: false };
  }

  let res: Response;
  try {
    res = await fetch("https://oauth2.googleapis.com/token", {
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
  } catch {
    return { ok: false, hardAuthFailure: false };
  }

  if (!res.ok) {
    console.error(`GSC token refresh failed with HTTP ${res.status}`);
    let code = "";
    try {
      const data = await res.json() as { error?: unknown };
      code = typeof data.error === "string" ? data.error : "";
    } catch {
      code = "";
    }
    return {
      ok: false,
      hardAuthFailure: hardGscOAuthFailure({
        status: res.status,
        errorCode: code,
      }),
    };
  }

  const data = await res.json() as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  return typeof data.access_token === "string"
    ? {
        ok: true,
        accessToken: data.access_token,
        expiresIn: Number(data.expires_in ?? 0),
      }
    : { ok: false, hardAuthFailure: false };
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

function currentGscBinding(site: Doc<"sites">): {
  canonicalDomain: string;
  domainRevision: number;
  connectionRevision: number;
  property: string;
} {
  const canonicalDomain = siteCanonicalDomain(site);
  if (!canonicalDomain || !gscConnectionMatchesCurrentDomain(site)) {
    throw new Error("GSC connection belongs to an earlier site domain");
  }
  return {
    canonicalDomain,
    domainRevision: siteCanonicalDomainRevision(site),
    connectionRevision: siteGscConnectionRevision(site),
    property: site.gscProperty!,
  };
}

async function assertCurrentGscConnection(
  ctx: ActionCtx,
  expected: Doc<"sites">,
): Promise<void> {
  await assertGscExecutionAuthorized(ctx, expected._id);
  const current = await ctx.runQuery(internal.sites.getFull, {
    siteId: expected._id,
  });
  const expectedBinding = currentGscBinding(expected);
  if (!current) throw new Error("GSC connection changed during tenant sync");
  const currentBinding = currentGscBinding(current);
  if (
    currentBinding.canonicalDomain !== expectedBinding.canonicalDomain ||
    currentBinding.domainRevision !== expectedBinding.domainRevision ||
    currentBinding.connectionRevision !== expectedBinding.connectionRevision ||
    current.gscProperty !== expected.gscProperty ||
    (current.gscReceiptRevision ?? 0) !==
      (expected.gscReceiptRevision ?? 0)
  ) {
    throw new Error("GSC connection changed during tenant sync");
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
    if (submitted.status === 401 || submitted.status === 403) {
      throw new GscAuthorizationError("GSC sitemap authorization was rejected");
    }
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
    if (verified.status === 401 || verified.status === 403) {
      throw new GscAuthorizationError("GSC sitemap authorization was rejected");
    }
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
    if (res.status === 401 || res.status === 403) {
      throw new GscAuthorizationError("GSC analytics authorization was rejected");
    }
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
    if (res.status === 401 || res.status === 403) {
      throw new GscAuthorizationError("GSC inspection authorization was rejected");
    }
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
  const binding = currentGscBinding(site);
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
      await assertCurrentGscConnection(ctx, site);
      const result = await fetchUrlInspection(
        accessToken,
        gscProperty,
        inspectionUrl,
      );
      await ctx.runMutation(
        internal.searchPerformance.recordUrlInspection,
        {
          articleId: article.articleId,
          expectedCanonicalDomain: binding.canonicalDomain,
          expectedDomainRevision: binding.domainRevision,
          expectedConnectionRevision: binding.connectionRevision,
          expectedProperty: binding.property,
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
      if (error instanceof GscAuthorizationError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(
        internal.searchPerformance.recordUrlInspection,
        {
          articleId: article.articleId,
          expectedCanonicalDomain: binding.canonicalDomain,
          expectedDomainRevision: binding.domainRevision,
          expectedConnectionRevision: binding.connectionRevision,
          expectedProperty: binding.property,
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
    currentGscBinding(site);

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
    currentGscBinding(site);
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
    currentGscBinding(site);
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
  args: {
    siteId: v.id("sites"),
    expectedCanonicalDomain: v.string(),
    expectedDomainRevision: v.number(),
    expectedConnectionRevision: v.number(),
    expectedProperty: v.string(),
  },
  handler: async (
    ctx,
    {
      siteId,
      expectedCanonicalDomain,
      expectedDomainRevision,
      expectedConnectionRevision,
      expectedProperty,
    },
  ): Promise<SitemapSubmissionResult> => {
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
    const binding = currentGscBinding(site);
    if (
      binding.canonicalDomain !== expectedCanonicalDomain ||
      binding.domainRevision !== expectedDomainRevision ||
      binding.connectionRevision !== expectedConnectionRevision ||
      binding.property !== expectedProperty
    ) {
      throw new Error("Sitemap repair belongs to an earlier GSC connection");
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
      await assertCurrentGscConnection(ctx, site);
      const refreshed = await refreshAccessToken(site.gscRefreshToken);
      if (!refreshed.ok) {
        if (refreshed.hardAuthFailure) {
          await revokeCapturedGscReceipt(ctx, site, "oauth_invalid_grant");
          throw new GscAuthorizationError("GSC authorization was revoked");
        }
        throw new Error("GSC access-token refresh failed");
      }
      accessToken = refreshed.accessToken;
      await ctx.runMutation(internal.sites.setGscTokenInternal, {
        siteId,
        expectedCanonicalDomain: binding.canonicalDomain,
        expectedDomainRevision: binding.domainRevision,
        expectedConnectionRevision: binding.connectionRevision,
        gscAccessToken: accessToken,
        expectedReceiptRevision: site.gscReceiptRevision ?? 0,
      });
    }
    try {
      return await submitAndVerifySitemap(
        accessToken,
        site.gscProperty,
        sitemapUrlForDomain(site.domain),
        () => assertCurrentGscConnection(ctx, site),
      );
    } catch (error) {
      if (error instanceof GscAuthorizationError) {
        await revokeCapturedGscReceipt(ctx, site, "provider_unauthorized");
      }
      throw error;
    }
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
  await assertCurrentGscConnection(ctx, site);
  if (!site.gscAccessToken) throw new Error("GSC not connected for this site");
  const binding = currentGscBinding(site);
  if (!site.gscRefreshToken) return site.gscAccessToken;
  const refreshed = await refreshAccessToken(site.gscRefreshToken);
  if (!refreshed.ok) {
    if (refreshed.hardAuthFailure) {
      await revokeCapturedGscReceipt(ctx, site, "oauth_invalid_grant");
      throw new GscAuthorizationError("GSC authorization was revoked");
    }
    throw new Error("GSC access-token refresh was temporarily unavailable");
  }
  await ctx.runMutation(internal.sites.setGscTokenInternal, {
    siteId: site._id,
    expectedCanonicalDomain: binding.canonicalDomain,
    expectedDomainRevision: binding.domainRevision,
    expectedConnectionRevision: binding.connectionRevision,
    gscAccessToken: refreshed.accessToken,
    expectedReceiptRevision: site.gscReceiptRevision ?? 0,
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
  const binding = currentGscBinding(site);
  const syncEpoch = crypto.randomUUID();
  const started = await ctx.runMutation(
    internal.searchPerformance.beginSyncEpoch,
    {
      siteId: site._id,
      syncEpoch,
      expectedCanonicalDomain: binding.canonicalDomain,
      expectedDomainRevision: binding.domainRevision,
      expectedConnectionRevision: binding.connectionRevision,
      expectedProperty: binding.property,
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
  let analytics: Awaited<
    ReturnType<typeof fetchCompleteDailySearchAnalytics>
  >;
  try {
    analytics = await fetchCompleteDailySearchAnalytics(
      async ({ dataset, date, startRow, rowLimit, timeoutMs }) => {
        await assertGscExecutionAuthorized(ctx, site._id);
        await assertCurrentGscConnection(ctx, site);
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
  } catch (error) {
    if (error instanceof GscAuthorizationError) {
      await revokeCapturedGscReceipt(ctx, site, "provider_unauthorized");
    }
    throw error;
  }
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
      expectedCanonicalDomain: binding.canonicalDomain,
      expectedDomainRevision: binding.domainRevision,
      expectedConnectionRevision: binding.connectionRevision,
      expectedProperty: binding.property,
      rows: records.slice(index, index + 500),
    });
    saved += result.saved;
  }
  for (let index = 0; index < pageRecords.length; index += 500) {
    await ctx.runMutation(internal.searchPerformance.upsertPageBatch, {
      siteId: site._id,
      syncEpoch,
      expectedCanonicalDomain: binding.canonicalDomain,
      expectedDomainRevision: binding.domainRevision,
      expectedConnectionRevision: binding.connectionRevision,
      expectedProperty: binding.property,
      rows: pageRecords.slice(index, index + 500),
    });
  }
  const completed = await ctx.runMutation(
    internal.searchPerformance.completeSyncEpoch,
    {
      siteId: site._id,
      syncEpoch,
      expectedCanonicalDomain: binding.canonicalDomain,
      expectedDomainRevision: binding.domainRevision,
      expectedConnectionRevision: binding.connectionRevision,
      expectedProperty: binding.property,
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
  currentGscBinding(site);
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

  let inspections: { checked: number; failed: number };
  try {
    inspections = await syncPublishedInspections(
      ctx,
      site,
      accessToken,
      gscProperty,
    );
  } catch (error) {
    if (error instanceof GscAuthorizationError) {
      await revokeCapturedGscReceipt(ctx, site, "provider_unauthorized");
    }
    throw error;
  }
  const receipt = await ctx.runMutation(
    internal.sites.markGscReceiptVerifiedInternal,
    {
      ...gscReceiptFence(site),
      verifiedAt: Date.now(),
    },
  );
  if (!receipt.updated) {
    throw new Error("GSC receipt binding changed during synchronization");
  }

  return {
    ...recent,
    backfillScheduled,
    inspections,
  };
}
