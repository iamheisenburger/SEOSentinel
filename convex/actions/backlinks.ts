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

import { action, internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createHash } from "node:crypto";
import {
  safeFetchPublicText,
  validatePublicHttpsUrl,
} from "../lib/safeOutbound";

// ── Types ──

async function requireOwnedSite(ctx: ActionCtx, siteId: Id<"sites">) {
  const site = await ctx.runQuery(internal.sites.getFull, { siteId });
  const identity = await ctx.auth.getUserIdentity();
  if (!site?.userId || !identity || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site's backlink tools");
  }
  return site;
}

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
  evidenceHash: string;
  verifiedAt: number;
}

export interface BrokenLinkOpportunity {
  sourceDomain: string;
  sourceUrl: string;
  brokenUrl: string;
  anchorText: string;
  domainRank: number;
  suggestedReplacement: string; // our article URL that could replace it
  evidenceHash: string;
  verifiedAt: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function plainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptAround(text: string, needles: string[]): string {
  const lower = text.toLowerCase();
  const indexes = needles
    .map((needle) => lower.indexOf(needle.toLowerCase()))
    .filter((index) => index >= 0);
  const index = indexes.length > 0 ? Math.min(...indexes) : 0;
  return text.slice(Math.max(0, index - 120), index + 280).trim();
}

type DataForSeoItem = {
  domain?: string;
  backlinks?: number;
  referring_domains?: number;
  rank?: number;
  anchor?: string;
  url_from?: string;
  url_to?: string;
};

type DataForSeoResponse = {
  tasks?: Array<{
    result?: Array<DataForSeoItem & { items?: DataForSeoItem[] }>;
  }>;
};

// ── DataForSEO API helpers ──

function getCredentials(): { login: string; password: string } | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

async function dataForSEORequest(
  endpoint: string,
  body: Array<Record<string, unknown>>,
): Promise<DataForSeoResponse> {
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

  return await response.json() as DataForSeoResponse;
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
      tools: [{ type: "web_search_preview" }],
      input: searchPrompt,
    });

    const text = typeof res.output_text === "string" ? res.output_text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      for (const item of parsed.slice(0, 15)) {
        if (!item.sourceUrl) continue;
        try {
          const candidate = await validatePublicHttpsUrl(item.sourceUrl);
          const sourceDomain = candidate.hostname.toLowerCase().replace(/^www\./, "");
          if (linkingDomains.has(sourceDomain)) continue;
          const fetched = await safeFetchPublicText(candidate.href, {
            maxBytes: 400_000,
            timeoutMs: 8_000,
          });
          const text = plainText(fetched.text);
          const mentionsBrand = [brandName, cleanDomain].some((needle) =>
            text.toLowerCase().includes(needle.toLowerCase())
          );
          const escapedDomain = cleanDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const alreadyLinks = new RegExp(
            `href=["'][^"']*${escapedDomain}`,
            "i",
          ).test(fetched.text);
          if (!mentionsBrand || alreadyLinks) continue;
          const verifiedAt = Date.now();
          mentions.push({
            sourceDomain,
            sourceUrl: fetched.url,
            mentionText: excerptAround(text, [brandName, cleanDomain]),
            // An AI estimate is not authority evidence. Unknown stays zero.
            domainRank: 0,
            suggestedOutreach: `The public page was verified to mention ${brandName} without a link to ${cleanDomain}.`,
            evidenceHash: sha256(fetched.text),
            verifiedAt,
          });
        } catch {
          // Search suggestions are candidates, not evidence. Unreachable,
          // private, or mismatched pages are discarded without persistence.
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
            try {
              const source = await validatePublicHttpsUrl(item.url_from);
              const fetched = await safeFetchPublicText(source.href, {
                maxBytes: 400_000,
                timeoutMs: 8_000,
              });
              if (
                !fetched.text.includes(brokenUrl) &&
                !(item.anchor && plainText(fetched.text).includes(item.anchor))
              ) {
                continue;
              }
              opportunities.push({
                sourceDomain: source.hostname.toLowerCase().replace(/^www\./, ""),
                sourceUrl: fetched.url,
                brokenUrl,
                anchorText: item.anchor || "",
                domainRank: item.rank || 0,
                suggestedReplacement: `/${bestMatch.slug.replace(/^\/+/, "")}`,
                evidenceHash: sha256(fetched.text),
                verifiedAt: Date.now(),
              });
            } catch {
              // Data-provider candidates must also survive an exact public-page
              // fetch before Pentra can call them verified opportunities.
            }
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
    const site = await requireOwnedSite(ctx, siteId);

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
        const articles = await ctx.runQuery(internal.articles.listBySiteInternal, { siteId });
        const published = articles
          .filter((article) => article.status === "published" || article.status === "ready")
          .map((article) => ({
            title: article.title,
            slug: article.slug,
            metaKeywords: article.metaKeywords,
          }));

        if (published.length > 0) {
          brokenLinks = await findBrokenLinkOpportunities(site.competitors, published);
          console.log(`Found ${brokenLinks.length} broken link opportunities.`);
        }
      } catch (err) {
        console.error("Broken link scan failed:", err);
      }
    }

    const origin = new URL(
      /^https?:\/\//i.test(site.domain) ? site.domain : `https://${site.domain}`,
    ).origin;
    const verified = [
      ...mentions.map((mention) => ({
        fingerprint: sha256(`${siteId}:unlinked_mention:${mention.sourceUrl}:${origin}`),
        type: "unlinked_mention",
        sourceDomain: mention.sourceDomain,
        sourceUrl: mention.sourceUrl,
        targetUrl: origin,
        context: mention.mentionText,
        domainRank: mention.domainRank,
        evidenceHash: mention.evidenceHash,
        verifiedAt: mention.verifiedAt,
      })),
      ...brokenLinks.map((opportunity) => ({
        fingerprint: sha256(`${siteId}:broken_link:${opportunity.sourceUrl}:${opportunity.suggestedReplacement}`),
        type: "broken_link",
        sourceDomain: opportunity.sourceDomain,
        sourceUrl: opportunity.sourceUrl,
        targetUrl: new URL(opportunity.suggestedReplacement, origin).href,
        context: opportunity.brokenUrl,
        domainRank: opportunity.domainRank,
        evidenceHash: opportunity.evidenceHash,
        verifiedAt: opportunity.verifiedAt,
      })),
    ];
    if (verified.length > 0) {
      await ctx.runMutation(internal.seoAuthority.upsertVerifiedBatch, {
        siteId,
        opportunities: verified,
      });
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
    const site = await requireOwnedSite(ctx, siteId);

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const brandName = site.siteName || site.domain.split(".")[0];

    const emails: { to: string; subject: string; body: string }[] = [];

    for (const opp of opportunities.slice(0, 5)) {
      const verified = await ctx.runQuery(
        internal.seoAuthority.getVerifiedBySource,
        { siteId, sourceUrl: opp.sourceUrl },
      );
      if (!verified) continue;
      const prompt = verified.type === "unlinked_mention"
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

        const text = res.content
          .map((block) => block.type === "text" ? block.text : "")
          .join("");
        const subjectMatch = text.match(/SUBJECT:\s*(.+)/);
        const bodyMatch = text.match(/BODY:\s*([\s\S]+)/);

        if (subjectMatch && bodyMatch) {
          emails.push({
            to: opp.sourceDomain,
            subject: subjectMatch[1].trim(),
            body: bodyMatch[1].trim(),
          });
          await ctx.runMutation(internal.seoAuthority.markOutreachPrepared, {
            siteId,
            opportunityId: verified._id,
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
export const quickBacklinkScan = internalAction({
  args: { siteId: v.id("sites"), articleId: v.id("articles") },
  handler: async (ctx, { siteId, articleId }): Promise<{ suggestions: { site: string; reason: string; anchor: string; targetUrl: string }[] }> => {
    const article = await ctx.runQuery(internal.articles.getInternal, { articleId });
    if (!article || article.siteId !== siteId) throw new Error("Article not found for site");
    // Kept as a compatibility no-op for already queued jobs. Inventing target
    // sites or URLs is not backlink automation and must never create evidence.
    return { suggestions: [] };
  },
});
