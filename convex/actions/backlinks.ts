"use node";

/**
 * Backlink Automation Module
 *
 * Uses DataForSEO Backlinks API to:
 * 1. Analyze existing backlink profile
 * 2. Find unlinked brand mentions (sites mentioning you without linking)
 * 3. Find broken link opportunities (broken links on competitor pages we can replace)
 * 4. Generate outreach email templates
 *
 * Falls back to AI-based suggestions when DataForSEO is unavailable.
 */

import { action } from "../_generated/server";
import { api } from "../_generated/api";
import { v } from "convex/values";

// ── Types ──

export interface BacklinkProfile {
  totalBacklinks: number;
  referringDomains: number;
  domainAuthority: number; // rank/reputation score
  topReferrers: { domain: string; backlinks: number; rank: number }[];
  anchorDistribution: { anchor: string; count: number }[];
}

export interface UnlinkedMention {
  sourceDomain: string;
  sourceUrl: string;
  mentionText: string; // the context where brand was mentioned
  domainRank: number;
  suggestedOutreach: string;
}

export interface BrokenLinkOpportunity {
  sourceDomain: string;
  sourceUrl: string;
  brokenUrl: string;
  anchorText: string;
  domainRank: number;
  suggestedReplacement: string; // our article URL that could replace it
}

// ── DataForSEO API helpers ──

function getCredentials(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

async function dataForSEORequest(endpoint: string, body: any[]): Promise<any> {
  const creds = getCredentials();
  if (!creds) throw new Error("DataForSEO credentials not configured");

  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
  const response = await fetch(`https://api.dataforseo.com/v3/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DataForSEO API error (${response.status}): ${text.slice(0, 500)}`);
  }

  return response.json();
}

// ── 1. Backlink Profile Analysis ──

async function getBacklinkProfile(domain: string): Promise<BacklinkProfile> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");

  // Get summary stats
  const summaryData = await dataForSEORequest("backlinks/summary/live", [{
    target: cleanDomain,
    internal_list_limit: 0,
    backlinks_filters: ["dofollow", "=", "true"],
  }]);

  const summary = summaryData.tasks?.[0]?.result?.[0] ?? {};
  const totalBacklinks = summary.backlinks ?? 0;
  const referringDomains = summary.referring_domains ?? 0;
  const domainAuthority = summary.rank ?? 0;

  // Get top referring domains
  const referrersData = await dataForSEORequest("backlinks/referring_domains/live", [{
    target: cleanDomain,
    limit: 20,
    order_by: ["rank,desc"],
    backlinks_filters: ["dofollow", "=", "true"],
  }]);

  const topReferrers: { domain: string; backlinks: number; rank: number }[] = [];
  for (const task of referrersData.tasks ?? []) {
    for (const item of task.result?.[0]?.items ?? []) {
      topReferrers.push({
        domain: item.domain ?? "",
        backlinks: item.backlinks ?? 0,
        rank: item.rank ?? 0,
      });
    }
  }

  // Get anchor text distribution
  const anchorsData = await dataForSEORequest("backlinks/anchors/live", [{
    target: cleanDomain,
    limit: 15,
    order_by: ["backlinks,desc"],
  }]);

  const anchorDistribution: { anchor: string; count: number }[] = [];
  for (const task of anchorsData.tasks ?? []) {
    for (const item of task.result?.[0]?.items ?? []) {
      if (item.anchor) {
        anchorDistribution.push({
          anchor: item.anchor,
          count: item.backlinks ?? 0,
        });
      }
    }
  }

  return { totalBacklinks, referringDomains, domainAuthority, topReferrers, anchorDistribution };
}

// ── 2. Unlinked Brand Mention Detection ──
// Finds pages that mention the brand/domain but don't link to it

async function findUnlinkedMentions(domain: string, brandName: string): Promise<UnlinkedMention[]> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");

  // Use DataForSEO's content analysis to find mentions
  // We search for the brand name and filter out pages that already link to us
  const data = await dataForSEORequest("backlinks/referring_domains/live", [{
    target: cleanDomain,
    limit: 100,
    order_by: ["rank,desc"],
  }]);

  // Collect domains that already link to us
  const linkingDomains = new Set<string>();
  for (const task of data.tasks ?? []) {
    for (const item of task.result?.[0]?.items ?? []) {
      if (item.domain) linkingDomains.add(item.domain.toLowerCase());
    }
  }

  // Now use web search to find brand mentions that are NOT from linking domains
  // This is a hybrid approach: DataForSEO tells us who already links, web search finds mentions
  const mentions: UnlinkedMention[] = [];

  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const searchPrompt = `Find websites and blog posts that mention "${brandName}" or "${cleanDomain}" but may not link to the site. Search for reviews, mentions, listicles, and comparisons that reference this brand. Focus on high-authority sites.

Return a JSON array of up to 10 results:
[{
  "sourceDomain": "example.com",
  "sourceUrl": "https://example.com/page",
  "mentionText": "brief context of how the brand was mentioned",
  "domainRank": estimated 0-100 authority score
}]

Only include sites that are NOT: ${Array.from(linkingDomains).slice(0, 20).join(", ")}

Return ONLY valid JSON array, no other text.`;

    const res = await openai.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" as any }],
      input: searchPrompt,
    });

    const text = typeof res.output_text === "string" ? res.output_text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      for (const item of parsed) {
        if (item.sourceDomain && !linkingDomains.has(item.sourceDomain.toLowerCase())) {
          mentions.push({
            sourceDomain: item.sourceDomain,
            sourceUrl: item.sourceUrl || `https://${item.sourceDomain}`,
            mentionText: item.mentionText || "Brand mentioned",
            domainRank: item.domainRank || 0,
            suggestedOutreach: `Hi! I noticed you mentioned ${brandName} on ${item.sourceDomain}. Would you consider adding a link to ${cleanDomain}? We'd be happy to share your article with our audience in return.`,
          });
        }
      }
    }
  } catch (err) {
    console.error("Unlinked mention search failed:", err);
  }

  // Sort by domain rank (higher authority = more valuable)
  mentions.sort((a, b) => b.domainRank - a.domainRank);
  return mentions.slice(0, 10);
}

// ── 3. Broken Link Opportunities ──
// Find broken outbound links on competitor sites that we could replace

async function findBrokenLinkOpportunities(
  competitorDomains: string[],
  ourArticles: { title: string; slug: string; metaKeywords?: string[] }[],
): Promise<BrokenLinkOpportunity[]> {
  const opportunities: BrokenLinkOpportunity[] = [];

  for (const competitor of competitorDomains.slice(0, 3)) {
    const cleanComp = competitor.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");

    try {
      // Get broken backlinks pointing TO the competitor (404s)
      const data = await dataForSEORequest("backlinks/backlinks/live", [{
        target: cleanComp,
        limit: 50,
        order_by: ["rank,desc"],
        filters: [
          ["page_from_status_code", "=", 404],
          "or",
          ["is_broken", "=", true],
        ],
      }]);

      for (const task of data.tasks ?? []) {
        for (const item of task.result?.[0]?.items ?? []) {
          if (!item.url_from || !item.url_to) continue;

          // Try to match a broken link to one of our articles
          const anchor = (item.anchor || "").toLowerCase();
          const brokenUrl = item.url_to;

          // Find the best matching article from our catalog
          let bestMatch = ourArticles[0];
          let bestScore = 0;

          for (const article of ourArticles) {
            const keywords = [
              ...(article.metaKeywords || []),
              ...article.title.toLowerCase().split(/\s+/),
            ];
            const matchScore = keywords.filter((k) =>
              anchor.includes(k.toLowerCase()) || brokenUrl.toLowerCase().includes(k.toLowerCase())
            ).length;
            if (matchScore > bestScore) {
              bestScore = matchScore;
              bestMatch = article;
            }
          }

          if (bestScore > 0) {
            opportunities.push({
              sourceDomain: item.domain_from || "",
              sourceUrl: item.url_from,
              brokenUrl,
              anchorText: item.anchor || "",
              domainRank: item.rank || 0,
              suggestedReplacement: `/${bestMatch.slug}`,
            });
          }
        }
      }
    } catch (err) {
      console.error(`Broken link scan failed for ${competitor}:`, err);
    }
  }

  // Sort by domain rank
  opportunities.sort((a, b) => b.domainRank - a.domainRank);
  return opportunities.slice(0, 15);
}

// ── Exported Actions ──

// Full backlink analysis for a site
export const analyzeBacklinks = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<{ profile: BacklinkProfile | null; mentions: UnlinkedMention[]; brokenLinks: BrokenLinkOpportunity[]; hasData: boolean }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    const hasDataForSEO = !!getCredentials();
    if (!hasDataForSEO) {
      console.log("DataForSEO not configured — using AI-only backlink suggestions.");
      return { profile: null, mentions: [], brokenLinks: [], hasData: false };
    }

    console.log(`Analyzing backlinks for ${site.domain}...`);

    // Get backlink profile
    let profile: BacklinkProfile | null = null;
    try {
      profile = await getBacklinkProfile(site.domain);
      console.log(`Backlink profile: ${profile.totalBacklinks} backlinks, ${profile.referringDomains} referring domains, rank ${profile.domainAuthority}`);
    } catch (err) {
      console.error("Backlink profile analysis failed:", err);
    }

    // Find unlinked mentions
    const brandName = site.siteName || site.domain.split(".")[0];
    let mentions: UnlinkedMention[] = [];
    try {
      mentions = await findUnlinkedMentions(site.domain, brandName);
      console.log(`Found ${mentions.length} unlinked brand mentions.`);
    } catch (err) {
      console.error("Unlinked mention detection failed:", err);
    }

    // Find broken link opportunities
    let brokenLinks: BrokenLinkOpportunity[] = [];
    if (site.competitors && site.competitors.length > 0) {
      try {
        const articles = await ctx.runQuery(api.articles.listBySite, { siteId });
        const published = articles
          .filter((a: any) => a.status === "published" || a.status === "ready")
          .map((a: any) => ({ title: a.title, slug: a.slug, metaKeywords: a.metaKeywords }));

        if (published.length > 0) {
          brokenLinks = await findBrokenLinkOpportunities(site.competitors, published);
          console.log(`Found ${brokenLinks.length} broken link opportunities.`);
        }
      } catch (err) {
        console.error("Broken link scan failed:", err);
      }
    }

    return { profile, mentions, brokenLinks, hasData: true };
  },
});

// Generate outreach emails for backlink opportunities
export const generateOutreach = action({
  args: {
    siteId: v.id("sites"),
    opportunities: v.array(v.object({
      type: v.string(), // "mention" | "broken_link"
      sourceDomain: v.string(),
      sourceUrl: v.string(),
      context: v.string(), // mention text or broken link URL
    })),
  },
  handler: async (ctx, { siteId, opportunities }): Promise<{ emails: { to: string; subject: string; body: string }[] }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const brandName = site.siteName || site.domain.split(".")[0];

    const emails: { to: string; subject: string; body: string }[] = [];

    for (const opp of opportunities.slice(0, 5)) {
      const prompt = opp.type === "mention"
        ? `Write a short, professional outreach email to the webmaster of ${opp.sourceDomain}.

Context: They mentioned "${brandName}" on their page (${opp.sourceUrl}) but didn't include a link. The mention context: "${opp.context}"

Goal: Politely ask them to add a link to https://${site.domain} where they mentioned us.

Rules:
- Keep it under 100 words
- Be genuine and personalized (reference their specific content)
- Offer value in return (share their article, cross-promote, etc.)
- Don't be pushy or spammy
- Use a warm, professional tone

Output format:
SUBJECT: [email subject line]
BODY: [email body]`
        : `Write a short, professional outreach email to the webmaster of ${opp.sourceDomain}.

Context: Their page (${opp.sourceUrl}) has a broken link pointing to: ${opp.context}. We have a relevant article at https://${site.domain} that could replace it.

Goal: Let them know about the broken link and suggest our article as a replacement.

Rules:
- Keep it under 100 words
- Lead with helping them (their broken link hurts their SEO)
- Naturally suggest our content as a replacement
- Don't be pushy
- Professional, helpful tone

Output format:
SUBJECT: [email subject line]
BODY: [email body]`;

      try {
        const res = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          messages: [{ role: "user", content: prompt }],
        });

        const text = res.content.map((b: any) => b.type === "text" ? b.text : "").join("");
        const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
        const bodyMatch = text.match(/BODY:\s*([\s\S]+)/);

        if (subjectMatch && bodyMatch) {
          emails.push({
            to: opp.sourceDomain,
            subject: subjectMatch[1].trim(),
            body: bodyMatch[1].trim(),
          });
        }
      } catch (err) {
        console.error(`Outreach generation failed for ${opp.sourceDomain}:`, err);
      }
    }

    return { emails };
  },
});

// Quick backlink scan — lighter version that just gets profile + suggestions
// Used in the article pipeline for backlink suggestions per article
export const quickBacklinkScan = action({
  args: { siteId: v.id("sites"), articleId: v.id("articles") },
  handler: async (ctx, { siteId, articleId }): Promise<{ suggestions: { site: string; reason: string; anchor: string; targetUrl: string }[] }> => {
    const site = await ctx.runQuery(api.sites.get, { siteId });
    if (!site) throw new Error("Site not found");

    const article = await ctx.runQuery(api.articles.get, { articleId });
    if (!article) throw new Error("Article not found");

    const hasDataForSEO = !!getCredentials();

    // Get referring domains for competitive analysis
    let referringDomains: string[] = [];
    if (hasDataForSEO) {
      try {
        const profile = await getBacklinkProfile(site.domain);
        referringDomains = profile.topReferrers.map((r) => r.domain);
      } catch (err) {
        console.error("Quick backlink profile failed:", err);
      }
    }

    // Use AI to generate targeted backlink suggestions for this specific article
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: `You are a backlink strategist. Given this article, suggest 5-10 high-quality websites that would be good backlink targets.

Article Title: ${article.title}
Article Keywords: ${(article.metaKeywords || []).join(", ")}
Site Domain: ${site.domain}
Site Niche: ${site.niche || "general"}
${referringDomains.length > 0 ? `Already linking to us: ${referringDomains.slice(0, 10).join(", ")}` : ""}

For each suggestion, provide:
1. The target site domain
2. Why they'd link to this content (be specific)
3. A suggested anchor text
4. The target URL on their site where our link fits

Output as a JSON array:
[{"site":"domain.com","reason":"specific reason","anchor":"anchor text","targetUrl":"https://domain.com/relevant-page"}]

Focus on:
- Resource pages that curate links on this topic
- Blog posts that reference similar content
- Industry directories or roundup posts
- Competitor comparison pages
- Educational .edu or .org pages on this topic

Return ONLY valid JSON array.`,
      }],
    });

    const text = res.content.map((b: any) => b.type === "text" ? b.text : "").join("");
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    let suggestions: { site: string; reason: string; anchor: string; targetUrl: string }[] = [];

    if (jsonMatch) {
      try {
        suggestions = JSON.parse(jsonMatch[0]);
      } catch {
        console.error("Failed to parse backlink suggestions JSON");
      }
    }

    // Save to article
    if (suggestions.length > 0) {
      await ctx.runMutation(api.articles.updateBacklinks, {
        articleId,
        backlinkSuggestions: suggestions.slice(0, 10),
      });
    }

    return { suggestions: suggestions.slice(0, 10) };
  },
});
