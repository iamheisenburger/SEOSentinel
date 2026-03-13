"use node";

import { action } from "../_generated/server";
import { api } from "../_generated/api";
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
export const scanForDecay = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{ scanned: number; flagged: number; signals: DecaySignal[] }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    const articles = await ctx.runQuery(api.articles.listBySite, { siteId });
    const published = articles.filter((a: any) => a.status === "published" || a.status === "ready");

    if (published.length === 0) {
      console.log(`No published articles for ${site.domain} — skipping decay scan.`);
      return { scanned: 0, flagged: 0, signals: [] };
    }

    // Get all GSC history data
    const gscHistory = await ctx.runQuery(api.searchPerformance.getHistory, { siteId });

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
      await ctx.runMutation(api.articles.updateDecayStatus, {
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
        await ctx.runMutation(api.articles.updateDecayStatus, {
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

      await ctx.runMutation(api.articles.updateDecayStatus, {
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

export const scanAllSites = action({
  handler: async (ctx) => {
    const sites = await ctx.runQuery(api.sites.listAllForAutopilot);
    let totalFlagged = 0;

    for (const site of sites) {
      try {
        const result = await ctx.runAction(api.actions.contentDecay.scanForDecay, { siteId: site._id });
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
  handler: async (ctx, { articleId }) => {
    const article = await ctx.runQuery(api.articles.get, { articleId });
    if (!article) throw new Error("Article not found");

    const site = await ctx.runQuery(api.sites.get, { siteId: article.siteId });
    if (!site) throw new Error("Site not found");

    console.log(`Refreshing article: "${article.title}" (${article.slug})`);

    // Mark as refreshing (saves previous version)
    await ctx.runMutation(api.articles.markRefreshing, { articleId });

    try {
      // Get the topic for context
      let topicKeyword = "";
      let topicLabel = "";
      if (article.topicId) {
        const topics = await ctx.runQuery(api.topics.listBySite, { siteId: article.siteId });
        const topic = topics.find((t: any) => t._id === article.topicId);
        if (topic) {
          topicKeyword = topic.primaryKeyword;
          topicLabel = topic.label;
        }
      }
      // Fallback: extract keyword from meta or title
      if (!topicKeyword) {
        topicKeyword = article.metaKeywords?.[0] || article.title;
      }

      // Step 1: Fresh web research
      console.log(`[Refresh] Step 1: Web research for "${topicKeyword}"`);
      let researchContext = "";
      let sources: { url: string; title?: string }[] = [];

      try {
        const { OpenAI } = await import("openai");
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

        const researchPrompt = `Research the latest information, statistics, and developments about: "${topicKeyword}".
Focus on:
- Updated statistics and data (2025-2026)
- New developments or changes in this space
- Current best practices
- Recent expert opinions or studies
Provide comprehensive, up-to-date information with source URLs.`;

        const researchRes = await openai.responses.create({
          model: "o4-mini-deep-research-2025-06-26",
          input: researchPrompt,
          tools: [{ type: "web_search_preview" as any }],
        });

        researchContext = typeof researchRes.output_text === "string"
          ? researchRes.output_text
          : "";

        // Extract sources from citations
        const urlRegex = /https?:\/\/[^\s\])"<>]+/g;
        const foundUrls = researchContext.match(urlRegex) || [];
        sources = [...new Set(foundUrls)]
          .filter((u) => !u.includes("openai.com") && !u.includes("google.com/search"))
          .slice(0, 10)
          .map((url) => ({ url, title: url.split("/").pop()?.replace(/-/g, " ") || url }));

        console.log(`[Refresh] Research complete: ${researchContext.length} chars, ${sources.length} sources`);
      } catch (err) {
        console.error("[Refresh] Research failed, continuing with existing content:", err);
        researchContext = "No updated research available. Refresh the article with improved structure and updated phrasing.";
      }

      // Step 2: Rewrite the article with Claude
      console.log(`[Refresh] Step 2: Rewriting article with Claude`);
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const articleType = article.articleType || "standard";
      const refreshPrompt = buildRefreshPrompt(article, site, topicKeyword, topicLabel, researchContext, sources, articleType);

      const writeRes = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 8000,
        messages: [{ role: "user", content: refreshPrompt }],
      });

      let newMarkdown = "";
      for (const block of writeRes.content) {
        if (block.type === "text") newMarkdown += block.text;
      }

      // Clean up markdown
      newMarkdown = newMarkdown
        .replace(/^```(?:markdown|md)?\n?/i, "")
        .replace(/\n?```\s*$/i, "")
        .trim();

      if (newMarkdown.length < 500) {
        throw new Error("Refreshed article too short — AI output may have been truncated");
      }

      const newWordCount = newMarkdown.split(/\s+/).length;
      const newReadingTime = Math.ceil(newWordCount / 250);

      console.log(`[Refresh] New article: ${newWordCount} words (was ${article.wordCount || "unknown"})`);

      // Step 3: Fact-check the refreshed content
      console.log(`[Refresh] Step 3: Fact-checking`);
      let factCheckScore = 75;
      let factCheckNotes = "Auto-refreshed content";

      try {
        const factRes = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: `You are a fact-checker. Review this article and rate its factual accuracy from 0-100. Consider: are claims supported by the sources? Are statistics current? Are there unsupported claims?

Article title: ${article.title}
Sources provided: ${sources.map((s) => s.url).join(", ")}

Article:
${newMarkdown.slice(0, 4000)}

Respond in this exact format:
SCORE: [number 0-100]
NOTES: [brief assessment]`,
          }],
        });

        const factText = factRes.content.map((b: any) => b.type === "text" ? b.text : "").join("");
        const scoreMatch = factText.match(/SCORE:\s*(\d+)/);
        const notesMatch = factText.match(/NOTES:\s*(.+)/s);
        if (scoreMatch) factCheckScore = parseInt(scoreMatch[1], 10);
        if (notesMatch) factCheckNotes = notesMatch[1].trim().slice(0, 500);
      } catch (err) {
        console.error("[Refresh] Fact-check failed:", err);
      }

      // Step 4: Save the refreshed article
      await ctx.runMutation(api.articles.completeRefresh, {
        articleId,
        markdown: newMarkdown,
        wordCount: newWordCount,
        readingTime: newReadingTime,
        sources,
        factCheckScore,
        factCheckNotes,
      });

      console.log(`[Refresh] Article "${article.title}" refreshed successfully.`);
      return { success: true, wordCount: newWordCount, factCheckScore };

    } catch (err: any) {
      // On failure, revert decay status but keep the flag
      console.error(`[Refresh] Failed for "${article.title}":`, err);
      await ctx.runMutation(api.articles.updateDecayStatus, {
        articleId,
        decayStatus: "declining",
        decayReason: `Refresh failed: ${err.message}. ${article.decayReason || ""}`.trim(),
      });
      return { success: false, error: err.message };
    }
  },
});

// Build the refresh prompt for Claude
function buildRefreshPrompt(
  article: any,
  site: any,
  keyword: string,
  topicLabel: string,
  research: string,
  sources: { url: string; title?: string }[],
  articleType: string,
): string {
  return `You are an expert SEO content writer. You're REFRESHING an existing published article that has been losing search rankings.

CRITICAL RULES:
- Keep the same topic, angle, and target keyword
- Update all statistics and claims with the latest data from the research below
- Improve the structure, depth, and comprehensiveness
- Add new sections if the research reveals gaps
- Keep the same general tone: ${site.tone || "professional"}
- Target keyword: "${keyword}"
- Article type: ${articleType}
- Site: ${site.siteName || site.domain} (${site.niche || "general"})
${site.ctaText ? `- CTA: ${site.ctaText}${site.ctaUrl ? ` (${site.ctaUrl})` : ""}` : ""}
${topicLabel ? `- Topic cluster: ${topicLabel}` : ""}

ORIGINAL ARTICLE TITLE: ${article.title}

ORIGINAL ARTICLE (for reference — improve upon this, don't just copy):
${article.markdown.slice(0, 3000)}
${article.markdown.length > 3000 ? "\n... [truncated] ..." : ""}

FRESH RESEARCH (use this to update the article):
${research.slice(0, 4000)}

SOURCES TO CITE:
${sources.map((s, i) => `[${i + 1}] ${s.url}`).join("\n")}

REQUIREMENTS:
1. Start with the same H1 title (or a slightly improved version)
2. Write a compelling TL;DR (2-3 sentences)
3. Include a Table of Contents
4. Update ALL statistics with 2025-2026 data where available
5. Add inline citations like [Source Title](url)
6. Include a FAQ section with 3-5 questions
7. End with a Sources section listing all references
8. Minimum 2000 words
9. Use proper markdown formatting (## for H2, ### for H3, etc.)
10. If the original had a CTA section, keep it

Output ONLY the markdown content. No explanations or meta-commentary.`;
}

// ── Auto-Refresh: Process the most critical declining article ──
// Called by cron after decay scan. Refreshes 1 article per site per day max.

export const autoRefreshTop = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    // Only auto-refresh if autopilot is enabled
    if (!site.autopilotEnabled) {
      console.log(`Autopilot disabled for ${site.domain} — skipping auto-refresh.`);
      return { refreshed: false, reason: "autopilot_disabled" };
    }

    const articles = await ctx.runQuery(api.articles.listBySite, { siteId });
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
    console.log(`Auto-refreshing "${target.title}" for ${site.domain}`);

    try {
      const result = await ctx.runAction(api.actions.contentDecay.refreshArticle, { articleId: target._id });
      return { refreshed: result.success, articleId: target._id, title: target.title };
    } catch (err: any) {
      console.error(`Auto-refresh failed for "${target.title}":`, err);
      return { refreshed: false, reason: err.message };
    }
  },
});
