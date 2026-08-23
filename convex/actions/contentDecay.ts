"use node";

import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

// ── Content Decay Detection (GSC-powered) ──
// Analyzes position history from GSC to detect articles losing rankings.
// Runs daily after GSC sync (cron at 3am UTC, GSC sync at 2am UTC).

interface DecaySignal {
  articleId: string;
  title: string;
  slug: string;
  severity: "warning" | "declining";
  positionDrop: number; // how much position worsened
  clicksDrop: number; // % click decrease
  currentPosition: number;
  previousPosition: number;
  currentClicks: number;
  previousClicks: number;
  reason: string;
  positionHistory: { date: string; position: number; clicks: number; impressions: number }[];
}

// Scan all published articles for a site and detect decay using GSC data
export const scanForDecay = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{ scanned: number; flagged: number; signals: DecaySignal[] }> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");

    const articles = await ctx.runQuery(internal.articles.listBySiteInternal, { siteId });
    const published = articles.filter((a: any) => a.status === "published" || a.status === "ready");

    if (published.length === 0) {
      console.log(`No published articles for ${site.domain} — skipping decay scan.`);
      return { scanned: 0, flagged: 0, signals: [] };
    }

    // Get all GSC history data
    const gscHistory = await ctx.runQuery(internal.searchPerformance.getHistory, { siteId });

    if (gscHistory.length === 0) {
      console.log(`No GSC data for ${site.domain} — falling back to heuristic decay detection.`);
      return heuristicDecayScan(ctx, published, siteId);
    }

    // Group GSC data by date for comparison
    const dateGroups = new Map<string, typeof gscHistory>();
    for (const row of gscHistory) {
      const existing = dateGroups.get(row.date) || [];
      existing.push(row);
      dateGroups.set(row.date, existing);
    }

    const sortedDates = Array.from(dateGroups.keys()).sort();
    if (sortedDates.length < 2) {
      console.log(`Only ${sortedDates.length} sync date(s) for ${site.domain} — need at least 2 for trend detection.`);
      return heuristicDecayScan(ctx, published, siteId);
    }

    const signals: DecaySignal[] = [];
    const domainClean = site.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();

    for (const article of published) {
      // Match article to GSC pages by slug/URL
      const articleSlug = article.slug.toLowerCase();
      const articleUrl = `${domainClean}/${articleSlug}`.toLowerCase();

      // Collect position data across all dates for this article's page
      const posHistory: { date: string; position: number; clicks: number; impressions: number }[] = [];

      for (const date of sortedDates) {
        const rows = dateGroups.get(date) || [];
        // Find rows matching this article's URL
        const matching = rows.filter((r: any) => {
          if (!r.page) return false;
          const pageClean = r.page.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "").toLowerCase();
          return pageClean.includes(articleSlug) || articleUrl.includes(pageClean);
        });

        if (matching.length > 0) {
          // Aggregate all queries for this page on this date
          const totalClicks = matching.reduce((s: number, r: any) => s + r.clicks, 0);
          const totalImpressions = matching.reduce((s: number, r: any) => s + r.impressions, 0);
          const avgPosition = matching.reduce((s: number, r: any) => s + r.position, 0) / matching.length;
          posHistory.push({ date, position: Math.round(avgPosition * 10) / 10, clicks: totalClicks, impressions: totalImpressions });
        }
      }

      if (posHistory.length < 2) continue; // Need at least 2 data points

      // Compare recent vs earlier performance
      const recent = posHistory[posHistory.length - 1];
      const earlier = posHistory[0];

      const positionDrop = recent.position - earlier.position; // positive = worsened
      const clicksDropPct = earlier.clicks > 0
        ? Math.round(((earlier.clicks - recent.clicks) / earlier.clicks) * 100)
        : 0;

      // Decay signals:
      // WARNING: position dropped 3+ places OR clicks dropped 30%+
      // DECLINING: position dropped 5+ places OR clicks dropped 50%+
      let severity: "warning" | "declining" | null = null;
      const reasons: string[] = [];

      if (positionDrop >= 5) {
        severity = "declining";
        reasons.push(`Position dropped ${positionDrop.toFixed(1)} places (${earlier.position.toFixed(1)} → ${recent.position.toFixed(1)})`);
      } else if (positionDrop >= 3) {
        severity = "warning";
        reasons.push(`Position dropped ${positionDrop.toFixed(1)} places (${earlier.position.toFixed(1)} → ${recent.position.toFixed(1)})`);
      }

      if (clicksDropPct >= 50 && earlier.clicks >= 5) {
        severity = "declining";
        reasons.push(`Clicks dropped ${clicksDropPct}% (${earlier.clicks} → ${recent.clicks})`);
      } else if (clicksDropPct >= 30 && earlier.clicks >= 3) {
        if (!severity) severity = "warning";
        reasons.push(`Clicks dropped ${clicksDropPct}% (${earlier.clicks} → ${recent.clicks})`);
      }

      // Also check for articles that fell off page 1 (position > 10)
      if (earlier.position <= 10 && recent.position > 10) {
        severity = "declining";
        reasons.push(`Fell off page 1 (position ${earlier.position.toFixed(1)} → ${recent.position.toFixed(1)})`);
      }

      if (severity && reasons.length > 0) {
        signals.push({
          articleId: article._id,
          title: article.title,
          slug: article.slug,
          severity,
          positionDrop: Math.round(positionDrop * 10) / 10,
          clicksDrop: clicksDropPct,
          currentPosition: recent.position,
          previousPosition: earlier.position,
          currentClicks: recent.clicks,
          previousClicks: earlier.clicks,
          reason: reasons.join("; "),
          positionHistory: posHistory,
        });
      }
    }

    // Update article decay statuses in DB
    for (const signal of signals) {
      await ctx.runMutation(internal.articles.updateDecayStatus, {
        articleId: signal.articleId as any,
        decayStatus: signal.severity,
        decayReason: signal.reason,
        decayDetectedAt: Date.now(),
        positionHistory: signal.positionHistory,
      });
    }

    // Clear decay status for healthy articles (had decay before but recovered)
    const flaggedIds = new Set(signals.map((s) => s.articleId));
    for (const article of published) {
      if (!flaggedIds.has(article._id) && (article as any).decayStatus && (article as any).decayStatus !== "healthy" && (article as any).decayStatus !== "refreshed") {
        await ctx.runMutation(internal.articles.updateDecayStatus, {
          articleId: article._id,
          decayStatus: "healthy",
          decayReason: "Rankings recovered — no longer flagged for decay",
        });
      }
    }

    // Sort by severity (declining first), then by position drop
    signals.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "declining" ? -1 : 1;
      return b.positionDrop - a.positionDrop;
    });

    console.log(`Decay scan for ${site.domain}: ${signals.length}/${published.length} articles flagged (${signals.filter((s) => s.severity === "declining").length} declining, ${signals.filter((s) => s.severity === "warning").length} warning)`);
    return { scanned: published.length, flagged: signals.length, signals };
  },
});

// Fallback: heuristic-based decay detection when no GSC data is available
async function heuristicDecayScan(ctx: any, published: any[], siteId: any) {
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const signals: DecaySignal[] = [];

  for (const article of published) {
    const ageDays = Math.floor((now - article.createdAt) / DAY_MS);
    const score = article.contentScore ?? null;
    const reasons: string[] = [];

    if (ageDays > 120) {
      reasons.push(`Published ${ageDays} days ago — likely outdated`);
    }
    if (score !== null && score < 50) {
      reasons.push(`Content score ${score}/100 — below competitive threshold`);
    }
    if (article.wordCount && article.wordCount < 1200) {
      reasons.push(`Only ${article.wordCount} words — thin content risk`);
    }

    if (reasons.length > 0) {
      const severity = ageDays > 180 || (score !== null && score < 40) ? "declining" : "warning";
      signals.push({
        articleId: article._id,
        title: article.title,
        slug: article.slug,
        severity,
        positionDrop: 0,
        clicksDrop: 0,
        currentPosition: 0,
        previousPosition: 0,
        currentClicks: 0,
        previousClicks: 0,
        reason: reasons.join("; "),
        positionHistory: [],
      });

      await ctx.runMutation(internal.articles.updateDecayStatus, {
        articleId: article._id,
        decayStatus: severity,
        decayReason: reasons.join("; "),
        decayDetectedAt: Date.now(),
      });
    }
  }

  return { scanned: published.length, flagged: signals.length, signals };
}

// ── Scan all sites (cron entry point) ──

export const scanAllSites = internalAction({
  handler: async (ctx): Promise<{ totalFlagged: number }> => {
    const sites = await ctx.runQuery(internal.sites.listAllForAutopilot);
    let totalFlagged = 0;

    for (const site of sites) {
      try {
        const result = await ctx.runAction(internal.actions.contentDecay.scanForDecay, { siteId: site._id });
        totalFlagged += result.flagged;
      } catch (err) {
        console.error(`Decay scan failed for ${site.domain}:`, err);
      }
    }

    console.log(`Decay scan complete across all sites: ${totalFlagged} articles flagged.`);
    return { totalFlagged };
  },
});

// ── Content Refresh Action ──
// Takes a declining article, re-researches the topic, and regenerates the content.
// Preserves the article ID, slug, and URL so existing rankings aren't lost.

export const refreshArticle = action({
  args: { articleId: v.id("articles") },
  handler: async (ctx, { articleId }): Promise<{ success: boolean; wordCount?: number; factCheckScore?: number; error?: string }> => {
    const article = await ctx.runQuery(internal.articles.getInternal, { articleId });
    if (!article) throw new Error("Article not found");

    const site = await ctx.runQuery(internal.sites.getFull, { siteId: article.siteId });
    if (!site) throw new Error("Site not found");
    const identity = await ctx.auth.getUserIdentity();
    if (!site.userId || !identity || identity.subject !== site.userId) {
      throw new Error("Not authorized to refresh this article");
    }
    throw new Error(
      "Direct refresh is disabled because it bypasses article quota and provider budgets. Use Pentra's audited recovery and revision workflow instead.",
    );

  },
});

// ── Auto-Refresh: Process the most critical declining article ──
// Called by cron after decay scan. Refreshes 1 article per site per day max.

export const autoRefreshTop = internalAction({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{ refreshed: boolean; reason?: string; articleId?: string; title?: string }> => {
    const site = await ctx.runQuery(internal.sites.getFull, { siteId });
    if (!site) throw new Error("Site not found");

    // Only auto-refresh if autopilot is enabled
    if (!site.autopilotEnabled) {
      console.log(`Autopilot disabled for ${site.domain} — skipping auto-refresh.`);
      return { refreshed: false, reason: "autopilot_disabled" };
    }

    const articles = await ctx.runQuery(internal.articles.listBySiteInternal, { siteId });
    const declining = articles
      .filter((a: any) => a.decayStatus === "declining" && a.status === "published")
      .sort((a: any, b: any) => (a.decayDetectedAt || 0) - (b.decayDetectedAt || 0)); // oldest decay first

    if (declining.length === 0) {
      console.log(`No declining articles for ${site.domain} — nothing to auto-refresh.`);
      return { refreshed: false, reason: "no_declining_articles" };
    }

    // Skip if already refreshed recently (within 7 days)
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const recentlyRefreshed = articles.filter(
      (a: any) => a.lastRefreshedAt && (Date.now() - a.lastRefreshedAt) < WEEK_MS
    );
    if (recentlyRefreshed.length > 0) {
      console.log(`${site.domain}: Already refreshed ${recentlyRefreshed.length} article(s) this week — waiting.`);
      return { refreshed: false, reason: "weekly_limit" };
    }

    const target = declining[0];
    console.log(`Refresh deferred for sealed article "${target.title}".`);
    return {
      refreshed: false,
      reason: "published_revision_workflow_required",
      articleId: target._id,
      title: target.title,
    };
  },
});

// ── Auto-refresh all sites (cron entry point) ──
// Runs after decay scan. Refreshes the most critical declining article per site.

export const autoRefreshAllSites = internalAction({
  handler: async (ctx): Promise<{ refreshed: number }> => {
    const sites = await ctx.runQuery(internal.sites.listAllForAutopilot);
    let refreshed = 0;

    for (const site of sites) {
      if (!site.autopilotEnabled) continue;
      try {
        const result = await ctx.runAction(internal.actions.contentDecay.autoRefreshTop, { siteId: site._id });
        if (result.refreshed) {
          refreshed++;
          console.log(`Auto-refreshed "${result.title}" for ${site.domain}`);
        }
      } catch (err) {
        console.error(`Auto-refresh failed for ${site.domain}:`, err);
      }
    }

    console.log(`Auto-refresh complete: ${refreshed} articles refreshed across all sites.`);
    return { refreshed };
  },
});
