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
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { createHash } from "node:crypto";
import {
  safeFetchPublicText,
  validatePublicHttpsUrl,
} from "../lib/safeOutbound";
import { bestReplacementArticle } from "../lib/linkRelevance";
import { fetchLiveAuthorityTarget } from "../lib/outreachTargetLive";
import {
  authorityEvidenceReceipt,
  hasExactAnchorHref,
  hasExactUnlinkedMention,
} from "../lib/linkReceipts";
import { isSameOrganisationHost } from "../lib/outreachContacts";
import {
  isUsableMentionContext,
  sharesBrandName,
} from "../lib/outreachDrafting";
import {
  consumeAuthorityCandidate,
  consumeAuthorityOpenAiCall,
  consumeAuthorityPageFetch,
  consumeAuthorityProviderCall,
  createAuthorityDiscoveryRuntime,
  isAuthorityDiscoveryBudgetError,
  type AuthorityDiscoveryPolicy,
  type AuthorityDiscoveryRuntime,
  type AuthorityDiscoveryTrigger,
} from "../lib/authorityDiscoveryBudget";
import {
  assertDataForSeoAccountBalance,
  isDataForSeoBalancePreflightError,
  type DataForSeoBalancePreflightError,
} from "../lib/dataForSeoAccountBalance";
import {
  articleMatchesCurrentDomain,
  siteCanonicalDomain,
  siteCanonicalDomainRevision,
} from "../lib/siteDomainBinding";

// ── Types ──

async function requireOwnedSite(ctx: ActionCtx, siteId: Id<"sites">) {
  const site = await ctx.runQuery(internal.sites.getFull, { siteId });
  const identity = await ctx.auth.getUserIdentity();
  if (!site?.userId || !identity || identity.subject !== site.userId) {
    throw new Error("Not authorized to access this site's backlink tools");
  }
  return { site, ownerUserId: identity.subject };
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
  articleId: Id<"articles">;
  sourceDomain: string;
  sourceUrl: string;
  brokenUrl: string;
  anchorText: string;
  domainRank: number;
  suggestedReplacement: string; // our article URL that could replace it
  // Why this article was offered, so an irrelevant suggestion is auditable
  // rather than an unexplained mismatch.
  relevanceScore: number;
  relevanceTerms: string[];
  evidenceHash: string;
  verifiedAt: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function providerBalanceReleaseReason(
  error: DataForSeoBalancePreflightError,
): "provider_balance_insufficient" |
  "provider_balance_preflight_unavailable" {
  return error.code === "insufficient_balance"
    ? "provider_balance_insufficient"
    : "provider_balance_preflight_unavailable";
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
    status_code?: number;
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
  runtime: AuthorityDiscoveryRuntime,
): Promise<DataForSeoResponse> {
  const creds = getCredentials();
  if (!creds) throw new Error("DataForSEO credentials not configured");

  const auth = Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
  const timeoutMs = consumeAuthorityProviderCall(runtime);
  const response = await fetch(`https://api.dataforseo.com/v3/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    // Third-party response bodies can contain account-specific diagnostics.
    // Keep persisted/logged failures credential-free and stable.
    throw new Error(`DataForSEO API error (HTTP ${response.status})`);
  }

  const payload = await response.json() as DataForSeoResponse;
  const failedTask = payload.tasks?.find(
    (task) =>
      typeof task.status_code === "number" && task.status_code !== 20_000,
  );
  if (failedTask) {
    throw new Error(`DataForSEO task error (${failedTask.status_code})`);
  }
  return payload;
}

// ── 1. Backlink Profile Analysis ──

async function getBacklinkProfile(
  domain: string,
  runtime: AuthorityDiscoveryRuntime,
): Promise<BacklinkProfile> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");

  // Get summary stats
  const summaryData = await dataForSEORequest("backlinks/summary/live", [{
    target: cleanDomain,
    internal_list_limit: 0,
    backlinks_filters: ["dofollow", "=", "true"],
  }], runtime);

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
  }], runtime);

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
  }], runtime);

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

async function findUnlinkedMentions(
  domain: string,
  brandName: string,
  runtime: AuthorityDiscoveryRuntime,
  knownLinkingDomains: string[],
): Promise<UnlinkedMention[]> {
  const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");

  // Reuse the already-paid profile referrer result instead of making a second
  // identical live request. The fetched candidate page is still checked for a
  // tenant link, so a bounded top-referrer list cannot create false evidence.
  const linkingDomains = new Set(
    knownLinkingDomains.map((domainName) => domainName.toLowerCase()),
  );

  // Now use web search to find brand mentions that are NOT from linking domains
  // This is a hybrid approach: DataForSEO tells us who already links, web search finds mentions
  const mentions: UnlinkedMention[] = [];
  // Keep half of the shared candidate/fetch envelope available for exact
  // broken-link evidence. Without a stage partition, a full web-search result
  // set consumes every fetch before replacement discovery even starts.
  const mentionCandidateLimit = Math.max(
    1,
    Math.floor(runtime.policy.candidateLimit / 2),
  );
  const mentionPageFetchLimit = Math.max(
    1,
    Math.floor(runtime.policy.pageFetchLimit / 2),
  );
  const candidatesAtStart = runtime.candidatesConsidered;
  const pageFetchesAtStart = runtime.pageFetchesAttempted;

  try {
    const OpenAI = (await import("openai")).default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const searchPrompt = `Find websites and blog posts that mention "${brandName}" or "${cleanDomain}" but may not link to the site. Search for reviews, mentions, listicles, and comparisons that reference this brand. Focus on high-authority sites.

Return a JSON array of up to ${mentionCandidateLimit} results:
[{
  "sourceDomain": "example.com",
  "sourceUrl": "https://example.com/page",
  "mentionText": "brief context of how the brand was mentioned",
  "domainRank": estimated 0-100 authority score
}]

Only include sites that are NOT: ${Array.from(linkingDomains).slice(0, 20).join(", ")}

Return ONLY valid JSON array, no other text.`;

    const openAiTimeoutMs = consumeAuthorityOpenAiCall(runtime);
    const res = await openai.responses.create({
      model: "gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
      input: searchPrompt,
    }, { timeout: openAiTimeoutMs });

    const text = typeof res.output_text === "string" ? res.output_text : "";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed: unknown = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) {
        throw new Error("Unlinked mention discovery returned a non-array result");
      }
      for (const item of parsed.slice(0, mentionCandidateLimit)) {
        if (
          runtime.candidatesConsidered - candidatesAtStart >=
            mentionCandidateLimit ||
          runtime.pageFetchesAttempted - pageFetchesAtStart >=
            mentionPageFetchLimit
        ) {
          break;
        }
        if (!item || typeof item !== "object") continue;
        const candidateItem = item as Record<string, unknown>;
        if (typeof candidateItem.sourceUrl !== "string") continue;
        try {
          consumeAuthorityCandidate(runtime);
          const candidate = await validatePublicHttpsUrl(candidateItem.sourceUrl);
          const sourceDomain = candidate.hostname.toLowerCase().replace(/^www\./, "");
          if (linkingDomains.has(sourceDomain)) continue;
          const fetchTimeoutMs = consumeAuthorityPageFetch(runtime);
          const fetched = await safeFetchPublicText(candidate.href, {
            maxBytes: 400_000,
            timeoutMs: fetchTimeoutMs,
          });
          const finalUrl = await validatePublicHttpsUrl(fetched.url);
          if (!isSameOrganisationHost(candidate.hostname, finalUrl.hostname)) {
            continue;
          }
          const finalSourceDomain = finalUrl.hostname
            .toLowerCase()
            .replace(/^www\./, "");
          const text = plainText(fetched.text);
          const mentionsBrand = [brandName, cleanDomain].some((needle) =>
            text.toLowerCase().includes(needle.toLowerCase())
          );
          if (!mentionsBrand) continue;
          // A same-name business on another TLD is not evidence that this page
          // mentioned the tenant. Navigation chrome and scraped menus are not
          // prose worth contacting anyone about either. Reject both before an
          // opportunity or contact record can be created.
          if (sharesBrandName(finalSourceDomain, brandName)) continue;
          const mentionText = excerptAround(text, [brandName, cleanDomain]);
          if (
            !isUsableMentionContext(mentionText) ||
            !hasExactUnlinkedMention({
              html: fetched.text,
              sourceUrl: finalUrl.href,
              targetUrl: `https://${cleanDomain}`,
              context: mentionText,
            })
          ) {
            continue;
          }
          const verifiedAt = Date.now();
          mentions.push({
            sourceDomain: finalSourceDomain,
            sourceUrl: finalUrl.href,
            mentionText,
            // An AI estimate is not authority evidence. Unknown stays zero.
            domainRank: 0,
            suggestedOutreach: `The public page was verified to mention ${brandName} without a link to ${cleanDomain}.`,
            evidenceHash: sha256(fetched.text),
            verifiedAt,
          });
        } catch (error) {
          if (isAuthorityDiscoveryBudgetError(error)) throw error;
          // Search suggestions are candidates, not evidence. Unreachable,
          // private, or mismatched pages are discarded without persistence.
        }
      }
    }
  } catch {
    // An empty, completed search and a provider failure are different pieces
    // of evidence. Propagate a credential-free error so callers cannot retire
    // existing opportunities after a transient discovery outage.
    throw new Error("Unlinked mention discovery was unavailable");
  }

  // Sort by domain rank (higher authority = more valuable)
  mentions.sort((a, b) => b.domainRank - a.domainRank);
  return mentions.slice(0, 10);
}

// ── 3. Broken Link Opportunities ──
// Find broken outbound links on competitor sites that we could replace

async function findBrokenLinkOpportunities(
  competitorDomains: string[],
  ourArticles: {
    articleId: Id<"articles">;
    title: string;
    slug: string;
    metaKeywords?: string[];
    targetUrl: string;
  }[],
  runtime: AuthorityDiscoveryRuntime,
): Promise<{ opportunities: BrokenLinkOpportunity[]; scanComplete: boolean }> {
  const opportunities: BrokenLinkOpportunity[] = [];
  let scanComplete = true;
  const liveTargetReceipts = new Map<string, Promise<boolean>>();

  const targetIsStillLive = (article: (typeof ourArticles)[number]) => {
    const existing = liveTargetReceipts.get(article.targetUrl);
    if (existing) return existing;
    const verification = (async () => {
      try {
        const timeoutMs = consumeAuthorityPageFetch(runtime);
        await fetchLiveAuthorityTarget({
          targetUrl: article.targetUrl,
          title: article.title,
          timeoutMs,
        });
        return true;
      } catch (error) {
        if (isAuthorityDiscoveryBudgetError(error)) throw error;
        return false;
      }
    })();
    liveTargetReceipts.set(article.targetUrl, verification);
    return verification;
  };

  for (const competitor of competitorDomains.slice(0, runtime.policy.competitorLimit)) {
    const cleanComp = competitor.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");

    try {
      // Get broken backlinks pointing TO the competitor (404s)
      const data = await dataForSEORequest("backlinks/backlinks/live", [{
        target: cleanComp,
        limit: Math.max(1, Math.min(20, runtime.policy.candidateLimit * 2)),
        order_by: ["rank,desc"],
        filters: [
          ["page_from_status_code", "=", 404],
          "or",
          ["is_broken", "=", true],
        ],
      }], runtime);

      for (const task of data.tasks ?? []) {
        for (const item of task.result?.[0]?.items ?? []) {
          if (!item.url_from || !item.url_to) continue;
          if (
            runtime.candidatesConsidered >= runtime.policy.candidateLimit ||
            runtime.pageFetchesAttempted >= runtime.policy.pageFetchLimit
          ) {
            break;
          }

          const brokenUrl = item.url_to;

          // Only offer a page that genuinely covers what the dead link
          // covered. No match means no opportunity: pitching an unrelated
          // article is worse than staying silent.
          const match = bestReplacementArticle({
            anchorText: item.anchor,
            brokenUrl,
            articles: ourArticles.map((article) => ({
              ...article,
              articleId: String(article.articleId),
            })),
          });

          if (match) {
            const bestMatch = ourArticles.find(
              (article) => String(article.articleId) === match.article.articleId,
            );
            if (!bestMatch) continue;
            try {
              // The stored publication receipt is necessary but not enough:
              // prove the exact tenant URL is still a real article before a
              // provider suggestion can become durable outreach evidence.
              if (!(await targetIsStillLive(bestMatch))) continue;
              consumeAuthorityCandidate(runtime);
              const source = await validatePublicHttpsUrl(item.url_from);
              const fetchTimeoutMs = consumeAuthorityPageFetch(runtime);
              const fetched = await safeFetchPublicText(source.href, {
                maxBytes: 400_000,
                timeoutMs: fetchTimeoutMs,
              });
              const finalUrl = await validatePublicHttpsUrl(fetched.url);
              if (
                !isSameOrganisationHost(source.hostname, finalUrl.hostname) ||
                !hasExactAnchorHref({
                  html: fetched.text,
                  sourceUrl: finalUrl.href,
                  targetUrl: brokenUrl,
                  expectedAnchorText: item.anchor || undefined,
                })
              ) {
                continue;
              }
              opportunities.push({
                articleId: bestMatch.articleId,
                sourceDomain: finalUrl.hostname.toLowerCase().replace(/^www\./, ""),
                sourceUrl: finalUrl.href,
                brokenUrl,
                anchorText: item.anchor || "",
                domainRank: item.rank || 0,
                suggestedReplacement: bestMatch.targetUrl,
                relevanceScore: match.score,
                relevanceTerms: match.matchedTerms,
                evidenceHash: sha256(fetched.text),
                verifiedAt: Date.now(),
              });
            } catch (error) {
              if (isAuthorityDiscoveryBudgetError(error)) throw error;
              // Data-provider candidates must also survive an exact public-page
              // fetch before Pentra can call them verified opportunities.
            }
          }
        }
      }
    } catch (error) {
      scanComplete = false;
      console.error(`Broken link scan failed for ${cleanComp}`);
      if (isAuthorityDiscoveryBudgetError(error)) break;
    }
  }

  // Sort by domain rank
  opportunities.sort((a, b) => b.domainRank - a.domainRank);
  return { opportunities: opportunities.slice(0, 15), scanComplete };
}

// ── Exported Actions ──

type BacklinkAnalysisResult = {
  profile: BacklinkProfile | null;
  mentions: UnlinkedMention[];
  brokenLinks: BrokenLinkOpportunity[];
  hasData: boolean;
  stages: {
    profileComplete: boolean;
    mentionsApplicable: boolean;
    mentionsComplete: boolean;
    brokenLinksApplicable: boolean;
    brokenLinksComplete: boolean;
  };
};

function unavailableBacklinkAnalysis(): BacklinkAnalysisResult {
  return {
    profile: null,
    mentions: [],
    brokenLinks: [],
    hasData: false,
    stages: {
      profileComplete: false,
      mentionsApplicable: true,
      mentionsComplete: false,
      brokenLinksApplicable: false,
      brokenLinksComplete: false,
    },
  };
}

async function analyzeBacklinksHandler(
  ctx: ActionCtx,
  siteId: Id<"sites">,
  site: Doc<"sites">,
  runtime: AuthorityDiscoveryRuntime,
  runId: Id<"seo_authority_runs">,
  focusArticleId?: Id<"articles">,
): Promise<BacklinkAnalysisResult> {
    const hasDataForSEO = !!getCredentials();
    if (!hasDataForSEO) {
      console.log("DataForSEO not configured — authority discovery is unavailable.");
      return {
        profile: null,
        mentions: [],
        brokenLinks: [],
        hasData: false,
        stages: {
          profileComplete: false,
          mentionsApplicable: true,
          mentionsComplete: false,
          brokenLinksApplicable: false,
          brokenLinksComplete: false,
        },
      };
    }

    console.log(`Analyzing backlinks for ${site.domain}...`);

    // Get backlink profile
    let profile: BacklinkProfile | null = null;
    let profileComplete = false;
    try {
      profile = await getBacklinkProfile(site.domain, runtime);
      profileComplete = true;
      console.log(`Backlink profile: ${profile.totalBacklinks} backlinks, ${profile.referringDomains} referring domains, rank ${profile.domainAuthority}`);
    } catch {
      console.error("Backlink profile analysis failed");
    }

    // Find unlinked mentions
    const brandName = site.siteName || site.domain.split(".")[0];
    const mentionsApplicable = true;
    let mentions: UnlinkedMention[] = [];
    let mentionsComplete = false;
    try {
      mentions = await findUnlinkedMentions(
        site.domain,
        brandName,
        runtime,
        profile?.topReferrers.map((referrer) => referrer.domain) ?? [],
      );
      mentionsComplete = true;
      console.log(`Found ${mentions.length} unlinked brand mentions.`);
    } catch {
      console.error("Unlinked mention detection failed");
    }

    // Find broken link opportunities
    let brokenLinks: BrokenLinkOpportunity[] = [];
    let brokenLinksApplicable = false;
    let brokenLinksComplete = false;
    if (site.competitors && site.competitors.length > 0) {
      try {
        const published = await ctx.runQuery(
          internal.articles.listVerifiedAuthorityTargetsInternal,
          { siteId, focusArticleId },
        );

        if (published.length > 0) {
          brokenLinksApplicable = true;
          const brokenLinkScan = await findBrokenLinkOpportunities(
            site.competitors,
            published,
            runtime,
          );
          brokenLinks = brokenLinkScan.opportunities;
          brokenLinksComplete = brokenLinkScan.scanComplete;
          console.log(`Found ${brokenLinks.length} broken link opportunities.`);
        }
      } catch {
        console.error("Broken link scan failed");
      }
    }

    const origin = new URL(
      /^https?:\/\//i.test(site.domain) ? site.domain : `https://${site.domain}`,
    ).origin;
    const verified = [
      ...mentions.map((mention) => ({
        fingerprint: sha256(`${siteId}:${siteCanonicalDomainRevision(site)}:unlinked_mention:${mention.sourceUrl}:${origin}`),
        type: "unlinked_mention",
        sourceDomain: mention.sourceDomain,
        sourceUrl: mention.sourceUrl,
        targetUrl: origin,
        context: mention.mentionText,
        domainRank: mention.domainRank,
        evidenceHash: sha256(authorityEvidenceReceipt({
          type: "unlinked_mention",
          sourceUrl: mention.sourceUrl,
          targetUrl: origin,
          context: mention.mentionText,
        })),
        verifiedAt: mention.verifiedAt,
      })),
      ...brokenLinks.map((opportunity) => ({
        articleId: opportunity.articleId,
        fingerprint: sha256(`${siteId}:${siteCanonicalDomainRevision(site)}:broken_link:${opportunity.sourceUrl}:${opportunity.suggestedReplacement}`),
        type: "broken_link",
        sourceDomain: opportunity.sourceDomain,
        sourceUrl: opportunity.sourceUrl,
        targetUrl: new URL(opportunity.suggestedReplacement, origin).href,
        context: opportunity.brokenUrl,
        anchorText: opportunity.anchorText,
        relevanceTerms: opportunity.relevanceTerms,
        domainRank: opportunity.domainRank,
        evidenceHash: sha256(authorityEvidenceReceipt({
          type: "broken_link",
          sourceUrl: opportunity.sourceUrl,
          targetUrl: new URL(opportunity.suggestedReplacement, origin).href,
          context: opportunity.brokenUrl,
          anchorText: opportunity.anchorText,
        })),
        verifiedAt: opportunity.verifiedAt,
      })),
    ];
    if (verified.length > 0) {
      await ctx.runMutation(internal.seoAuthority.upsertVerifiedBatch, {
        siteId,
        runId,
        opportunities: verified,
      });
    }

    // Search/provider result sets are bounded and non-exhaustive. Absence from
    // a later scan is not affirmative proof that an opportunity disappeared,
    // so this action never mass-rejects previously verified rows. Drafting has
    // its own freshness gate and acquired links have exact page receipts.
    const stages = {
      profileComplete,
      mentionsApplicable,
      mentionsComplete,
      brokenLinksApplicable,
      brokenLinksComplete,
    };
    return {
      profile,
      mentions,
      brokenLinks,
      // A backlink-profile lookup measures the tenant but does not search for
      // an opportunity. Only completed opportunity-discovery stages can make
      // a "no safe candidate" conclusion.
      hasData: mentionsComplete || brokenLinksComplete,
      stages,
    };
}

async function runReservedBacklinkAnalysis(
  ctx: ActionCtx,
  args: {
    siteId: Id<"sites">;
    site: Doc<"sites">;
    trigger: AuthorityDiscoveryTrigger;
    ownerUserId?: string;
    focusArticleId?: Id<"articles">;
    growthActionFingerprint?: string;
    growthMeasurementKey?: string;
    throwOnDenied: boolean;
  },
): Promise<BacklinkAnalysisResult> {
  const reservation = await ctx.runMutation(
    internal.seoAuthority.reserveDiscoveryRun,
    {
      siteId: args.siteId,
      articleId: args.focusArticleId,
      trigger: args.trigger,
      ownerUserId: args.ownerUserId,
      growthActionFingerprint: args.growthActionFingerprint,
      growthMeasurementKey: args.growthMeasurementKey,
    },
  );
  if (!reservation.allowed) {
    if (args.throwOnDenied) {
      throw new Error(
        `Authority discovery is currently unavailable (${reservation.reason}).`,
      );
    }
    return unavailableBacklinkAnalysis();
  }

  try {
    await assertDataForSeoAccountBalance(
      reservation.policy.providerCostCeilingMicroUsd,
    );
  } catch (error) {
    if (!isDataForSeoBalancePreflightError(error)) throw error;
    await ctx.runMutation(
      internal.seoAuthority.abortDiscoveryRunForProviderBalance,
      {
        siteId: args.siteId,
        runId: reservation.runId,
        releaseReason: providerBalanceReleaseReason(error),
      },
    );
    if (args.throwOnDenied) throw error;
    return unavailableBacklinkAnalysis();
  }

  const runtime = createAuthorityDiscoveryRuntime(
    reservation.policy as AuthorityDiscoveryPolicy,
  );
  let result = unavailableBacklinkAnalysis();
  let failure: unknown;
  try {
    const currentSite = await ctx.runQuery(internal.sites.getFull, {
      siteId: args.siteId,
    });
    if (
      !currentSite ||
      siteCanonicalDomain(currentSite) !== reservation.canonicalDomain ||
      siteCanonicalDomainRevision(currentSite) !== reservation.domainRevision
    ) {
      throw new Error("Authority discovery reservation belongs to an earlier site domain");
    }
    result = await analyzeBacklinksHandler(
      ctx,
      args.siteId,
      currentSite,
      runtime,
      reservation.runId,
      args.focusArticleId,
    );
  } catch (error) {
    failure = error;
  } finally {
    const applicableStages = [
      result.stages.mentionsApplicable
        ? result.stages.mentionsComplete
        : undefined,
      result.stages.brokenLinksApplicable
        ? result.stages.brokenLinksComplete
        : undefined,
    ].filter((value): value is boolean => value !== undefined);
    const completed =
      applicableStages.length > 0 && applicableStages.every(Boolean);
    const partial = applicableStages.some(Boolean) && !completed;
    const outcome = failure
      ? runtime.deadlineExhausted
        ? "deadline_exhausted"
        : "execution_failed"
      : completed
        ? "completed"
        : partial
          ? "partial"
          : runtime.deadlineExhausted
            ? "deadline_exhausted"
            : getCredentials()
              ? "provider_failed"
              : "provider_unavailable";
    const errorCategory = failure
      ? isAuthorityDiscoveryBudgetError(failure)
        ? failure.code
        : "execution_failure"
      : runtime.deadlineExhausted
        ? "deadline_exhausted"
        : undefined;
    await ctx.runMutation(internal.seoAuthority.settleDiscoveryRun, {
      siteId: args.siteId,
      runId: reservation.runId,
      outcome,
      errorCategory,
      providerCallsAttempted: runtime.providerCallsAttempted,
      openAiCallsAttempted: runtime.openAiCallsAttempted,
      candidatesConsidered: runtime.candidatesConsidered,
      pageFetchesAttempted: runtime.pageFetchesAttempted,
      profileComplete: result.stages.profileComplete,
      mentionsApplicable: result.stages.mentionsApplicable,
      mentionsComplete: result.stages.mentionsComplete,
      brokenLinksApplicable: result.stages.brokenLinksApplicable,
      brokenLinksComplete: result.stages.brokenLinksComplete,
      verifiedOpportunities: result.mentions.length + result.brokenLinks.length,
    });
  }
  if (failure) throw failure;
  return result;
}

// Full owner-triggered backlink analysis for a site.
export const analyzeBacklinks = action({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<BacklinkAnalysisResult> => {
    const { site, ownerUserId } = await requireOwnedSite(ctx, siteId);
    return runReservedBacklinkAnalysis(ctx, {
      siteId,
      site,
      trigger: "owner",
      ownerUserId,
      throwOnDenied: true,
    });
  },
});

// The measured growth controller may discover and verify opportunities for
// one exact underperforming page. This remains read-only outside Pentra: it
// does not send email, exchange links, or claim that a backlink was acquired.
export const analyzeBacklinksInternal = internalAction({
  args: {
    siteId: v.id("sites"),
    articleId: v.id("articles"),
    growthActionFingerprint: v.string(),
    growthMeasurementKey: v.string(),
  },
  handler: async (
    ctx,
    { siteId, articleId, growthActionFingerprint, growthMeasurementKey },
  ): Promise<BacklinkAnalysisResult> => {
    const [site, article] = await Promise.all([
      ctx.runQuery(internal.sites.getFull, { siteId }),
      ctx.runQuery(internal.articles.getInternal, { articleId }),
    ]);
    if (
      !site ||
      !article ||
      article.siteId !== siteId ||
      !articleMatchesCurrentDomain(site, article) ||
      article.status !== "published"
    ) {
      throw new Error("Authority scan crossed a tenant or publication boundary");
    }
    if (
      !site.autopilotEnabled ||
      !["warm", "live"].includes(site.autopilotRolloutMode ?? "observe")
    ) {
      return {
        profile: null,
        mentions: [],
        brokenLinks: [],
        hasData: false,
        stages: {
          profileComplete: false,
          mentionsApplicable: true,
          mentionsComplete: false,
          brokenLinksApplicable: false,
          brokenLinksComplete: false,
        },
      };
    }
    return runReservedBacklinkAnalysis(ctx, {
      siteId,
      site,
      trigger: "growth",
      focusArticleId: articleId,
      growthActionFingerprint,
      growthMeasurementKey,
      throwOnDenied: false,
    });
  },
});

// Legacy compatibility endpoint. The original implementation accepted
// client-supplied opportunity text, spent model budget, returned a domain in
// the `to` field, and marked durable evidence prepared without a verified
// recipient. Keep the symbol temporarily for old clients, but fail closed;
// the Backlinks dashboard uses the tenant-scoped durable approval queue.
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
    await requireOwnedSite(ctx, siteId);
    void opportunities;
    throw new Error(
      "Legacy outreach generation is disabled. Use the verified Backlinks approval queue.",
    );
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
