"use node";

import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import {
  isBrandedSearchQuery,
  publishedArticlePageUrl,
} from "../lib/searchPerformance";

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
  });

  if (!res.ok) {
    console.error("GSC token refresh failed:", await res.text());
    return null;
  }

  const data = await res.json();
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

// ── GSC Search Analytics API ──

interface GSCRow {
  keys: string[]; // [date, query, page]
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GSCIndexStatusResult {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
}

type GscSyncResult = {
  rows: number;
  saved: number;
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
): Promise<SitemapSubmissionResult> {
  const endpoint =
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}` +
    `/sitemaps/${encodeURIComponent(sitemapUrl)}`;
  const submitted = await fetch(endpoint, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!submitted.ok) {
    const text = await submitted.text();
    throw new Error(
      `GSC sitemap submission failed (${submitted.status}): ${text.slice(0, 300)}`,
    );
  }
  const verified = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!verified.ok) {
    const text = await verified.text();
    throw new Error(
      `GSC sitemap verification failed (${verified.status}): ${text.slice(0, 300)}`,
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

async function fetchSearchAnalytics(
  accessToken: string,
  property: string,
  startDate: string,
  endDate: string,
  rowLimit: number = 500,
): Promise<GSCRow[]> {
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ["date", "query", "page"],
        rowLimit,
        dataState: "final",
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC API error (${res.status}): ${text.slice(0, 300)}`);
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
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GSC URL Inspection error (${res.status}): ${text.slice(0, 300)}`,
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
      publishedAfter: now - 56 * 24 * 60 * 60 * 1000,
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
      article.gscInspectedAt >= now - 20 * 60 * 60 * 1000
    ) {
      continue;
    }
    const inspectionUrl = publishedArticlePageUrl(
      site.domain,
      site.urlStructure,
      article.slug,
    );
    try {
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
    synced: number;
    failed: number;
    scheduledNext: boolean;
  }> => {
    const page = await ctx.runQuery(internal.sites.listGrowthPage, {
      cursor,
    });
    let synced = 0;
    let failed = 0;

    for (const summary of page.page) {
      if (!summary.gscConnected) continue;
      const site = await ctx.runQuery(internal.sites.getFull, {
        siteId: summary.siteId,
      });
      if (!site?.gscAccessToken || !site.gscProperty) continue;

      try {
        await syncSiteGSC(ctx, site);
        synced++;
      } catch (err) {
        failed++;
        console.error(`GSC sync failed for ${site.domain}:`, err);
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        1_000,
        internal.actions.gscSync.syncAllSites,
        { cursor: page.continueCursor },
      );
    }

    console.log(
      `GSC page sync complete: ${synced} synced, ${failed} failed, next=${!page.isDone}.`,
    );
    return { synced, failed, scheduledNext: !page.isDone };
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

// Search Console's Sitemap API is the correct general-purpose discovery path
// for ordinary web pages. It is tenant-scoped, refreshes only that tenant's
// OAuth token, and verifies the exact submitted sitemap before reporting
// success. The restricted Indexing API is intentionally not used here.
export const submitSitemapInternal = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<SitemapSubmissionResult> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
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
    );
  },
});

async function syncSiteGSC(
  ctx: ActionCtx,
  site: Doc<"sites">,
): Promise<GscSyncResult> {
  if (!site.gscAccessToken || !site.gscProperty) {
    throw new Error("GSC not connected for this site");
  }
  let accessToken = site.gscAccessToken;
  const gscProperty = site.gscProperty;

  // Try to refresh token if we have a refresh token
  if (site.gscRefreshToken) {
    const refreshed = await refreshAccessToken(site.gscRefreshToken);
    if (refreshed) {
      accessToken = refreshed.accessToken;
      // Update the access token in DB
      await ctx.runMutation(internal.sites.setGscTokenInternal, {
        siteId: site._id,
        gscAccessToken: accessToken,
      });
    }
  }

  // Fetch last 28 days of data (GSC standard window)
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - 3); // GSC data has 3-day lag
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 28);

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  console.log(`Fetching GSC data for ${site.domain}: ${startStr} → ${endStr}`);

  const rows = await fetchSearchAnalytics(accessToken, gscProperty, startStr, endStr, 25_000);
  console.log(`GSC returned ${rows.length} rows for ${site.domain}`);

  const inspections = await syncPublishedInspections(
    ctx,
    site,
    accessToken,
    gscProperty,
  );
  if (rows.length === 0) {
    return { rows: 0, saved: 0, inspections };
  }

  // GSC returns actual daily rows. Preserve date+query+page so a new article's
  // impressions can be attributed without double-counting overlapping
  // rolling windows.
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

  // Save the response in bounded indexed batches. Legacy aggregate rows remain
  // intact but versioned daily reporting ignores them.
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
  const pageMap = new Map<string, {
    date: string;
    page: string;
    clicks: number;
    impressions: number;
    weightedPosition: number;
    nonBrandedClicks: number;
    nonBrandedImpressions: number;
    nonBrandedWeightedPosition: number;
  }>();
  for (const row of rows) {
    const date = row.keys[0];
    const query = row.keys[1];
    const page = row.keys[2];
    if (!date || !query || !page) continue;
    const key = `${date}\u0000${page}`;
    const aggregate = pageMap.get(key) ?? {
      date,
      page,
      clicks: 0,
      impressions: 0,
      weightedPosition: 0,
      nonBrandedClicks: 0,
      nonBrandedImpressions: 0,
      nonBrandedWeightedPosition: 0,
    };
    aggregate.clicks += row.clicks;
    aggregate.impressions += row.impressions;
    aggregate.weightedPosition += row.position * row.impressions;
    if (!isBrandedSearchQuery(query, site.domain)) {
      aggregate.nonBrandedClicks += row.clicks;
      aggregate.nonBrandedImpressions += row.impressions;
      aggregate.nonBrandedWeightedPosition += row.position * row.impressions;
    }
    pageMap.set(key, aggregate);
  }
  let saved = 0;
  for (let index = 0; index < records.length; index += 500) {
    const batch = records.slice(index, index + 500);
    const result = await ctx.runMutation(internal.searchPerformance.upsertBatch, {
      siteId: site._id,
      rows: batch,
    });
    saved += result.saved;
  }
  const pageRecords = [...pageMap.values()];
  for (let index = 0; index < pageRecords.length; index += 500) {
    await ctx.runMutation(internal.searchPerformance.upsertPageBatch, {
      siteId: site._id,
      rows: pageRecords.slice(index, index + 500),
    });
  }

  console.log(
    `Saved ${saved} daily query rows and ${pageRecords.length} page rollups for ${site.domain}`,
  );
  return { rows: rows.length, saved, inspections };
}
