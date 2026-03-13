"use node";

import { action } from "../_generated/server";
import { api } from "../_generated/api";
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
  keys: string[]; // [query, page]
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
        dimensions: ["query", "page"],
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
  handler: async (ctx) => {
    const sites = await ctx.runQuery(api.sites.listAllForAutopilot);
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
  handler: async (ctx, { siteId }) => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");
    if (!site.gscAccessToken || !site.gscProperty) throw new Error("GSC not connected for this site");

    return syncSiteGSC(ctx, site);
  },
});

async function syncSiteGSC(ctx: any, site: any) {
  let accessToken = site.gscAccessToken;

  // Try to refresh token if we have a refresh token
  if (site.gscRefreshToken) {
    const refreshed = await refreshAccessToken(site.gscRefreshToken);
    if (refreshed) {
      accessToken = refreshed.accessToken;
      // Update the access token in DB
      await ctx.runMutation(api.sites.setGscToken, {
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

  const rows = await fetchSearchAnalytics(accessToken, site.gscProperty, startStr, endStr, 500);
  console.log(`GSC returned ${rows.length} rows for ${site.domain}`);

  if (rows.length === 0) return { rows: 0, saved: 0 };

  // Aggregate by query (sum clicks/impressions, avg position)
  const queryMap = new Map<string, { clicks: number; impressions: number; ctr: number; position: number; page: string }>();
  for (const row of rows) {
    const query = row.keys[0];
    const page = row.keys[1] || "";
    const existing = queryMap.get(query);
    if (existing) {
      existing.clicks += row.clicks;
      existing.impressions += row.impressions;
      existing.position = (existing.position + row.position) / 2; // rolling avg
      // Keep the page with more clicks
      if (row.clicks > 0) existing.page = page;
    } else {
      queryMap.set(query, {
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
        page,
      });
    }
  }

  // Save to search_performance table (upsert by date range midpoint)
  const midDate = new Date((startDate.getTime() + endDate.getTime()) / 2).toISOString().split("T")[0];
  let saved = 0;

  for (const [query, data] of queryMap) {
    await ctx.runMutation(api.searchPerformance.upsert, {
      siteId: site._id,
      date: midDate,
      query,
      page: data.page || undefined,
      clicks: data.clicks,
      impressions: data.impressions,
      ctr: data.ctr,
      position: Math.round(data.position * 10) / 10,
    });
    saved++;
  }

  console.log(`Saved ${saved} query records for ${site.domain}`);
  return { rows: rows.length, saved };
}
