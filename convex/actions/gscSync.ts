"use node";

import { action } from "../_generated/server";
import { api, internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { v } from "convex/values";

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

// ── Sync Action: Pull GSC data for all connected sites ──

export const syncAllSites = action({
  handler: async (ctx): Promise<{ synced: number }> => {
    const sites = await ctx.runQuery(internal.sites.listAllForAutopilot);
    let synced = 0;

    for (const site of sites) {
      if (!site.gscAccessToken || !site.gscProperty) continue;

      try {
        await syncSiteGSC(ctx, site);
        synced++;
      } catch (err) {
        console.error(`GSC sync failed for ${site.domain}:`, err);
      }
    }

    console.log(`GSC sync complete: ${synced} sites synced.`);
    return { synced };
  },
});

// ── Sync Action: Pull GSC data for a specific site ──

export const syncSite = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{ rows: number; saved: number }> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");
    if (!site.gscAccessToken || !site.gscProperty) throw new Error("GSC not connected for this site");

    return syncSiteGSC(ctx, site);
  },
});

async function syncSiteGSC(ctx: ActionCtx, site: Doc<"sites">) {
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

  if (rows.length === 0) return { rows: 0, saved: 0 };

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
  let saved = 0;
  for (let index = 0; index < records.length; index += 500) {
    const batch = records.slice(index, index + 500);
    const result = await ctx.runMutation(api.searchPerformance.upsertBatch, {
      siteId: site._id,
      rows: batch,
    });
    saved += result.saved;
  }

  console.log(`Saved ${saved} daily query/page records for ${site.domain}`);
  return { rows: rows.length, saved };
}
