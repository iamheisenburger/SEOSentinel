"use node";

import { action, internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { analyzePageHealth, healthScore, robotsTxtFindings, sitemapIndexChildren, sitemapUrls, speedFindings, type PageHealthResult } from "../lib/siteHealth";
import { safeFetchPublicText } from "../lib/safeOutbound";
import { fetchPage } from "../lib/fetchPage";

const MAX_PAGES = 10, MIN_INTERVAL_MS = 10 * 60_000;
const PSI_FIELDS = "lighthouseResult.categories.performance.score,lighthouseResult.audits.largest-contentful-paint.numericValue,lighthouseResult.audits.cumulative-layout-shift.numericValue";

/** Google PageSpeed Insights (mobile) for one URL. Optional API key; any
 * error or quota limit simply skips the speed pass. */
async function pageSpeed(url: string): Promise<unknown> {
  const params = new URLSearchParams({ url, strategy: "mobile", category: "performance", fields: PSI_FIELDS });
  if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);
  try {
    const response = await safeFetchPublicText(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`,
      { expectedHost: "www.googleapis.com", maxRedirects: 0, maxBytes: 200_000, timeoutMs: 60_000, headers: { Accept: "application/json" } });
    return JSON.parse(response.text);
  } catch { return null; }
}

async function runCheck(ctx: ActionCtx, siteId: Id<"sites">, userId?: string) {
  const site = await ctx.runQuery(internal.siteHealth.siteForCheck, { siteId, userId });
  if (!site) throw new ConvexError("Website not found");
  if (site.lastCheckedAt && Date.now() - site.lastCheckedAt < MIN_INTERVAL_MS) return { skipped: true as const };
  const host = site.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const home = `https://${host}/`;
  const urls = [home];
  // Access and indexing pass: robots.txt and the sitemap come first.
  const robotsPage = await fetchPage(`https://${host}/robots.txt`);
  const robots = robotsPage.status === 200 ? robotsTxtFindings(robotsPage.html) : { blocksAll: false, sitemaps: [] as string[] };
  let sitemapFound = false;
  for (const candidate of [`https://${host}/sitemap.xml`, ...robots.sitemaps]) {
    if (sitemapFound) break;
    const sitemap = await fetchPage(candidate);
    if (sitemap.status !== 200) continue;
    const children = sitemapIndexChildren(sitemap.html, host);
    const xml = children.length ? (await fetchPage(children[0])).html : sitemap.html;
    const listed = sitemapUrls(xml, host, MAX_PAGES);
    if (listed.length || children.length) sitemapFound = true;
    for (const url of listed) if (!urls.includes(url)) urls.push(url);
  }
  for (const url of site.knownUrls) if (urls.length < MAX_PAGES && url.startsWith("https://") && !urls.includes(url)) urls.push(url);
  const results: PageHealthResult[] = [];
  for (const url of urls.slice(0, MAX_PAGES)) {
    const page = await fetchPage(url);
    results.push(analyzePageHealth({ url, status: page.status, finalUrl: page.finalUrl, html: page.html, robotsHeader: page.robots }));
  }
  if (results[0] && results[0].status === 200) results[0].issues.push(...speedFindings(await pageSpeed(home)));
  if (results[0] && results[0].status > 0) {
    if (robots.blocksAll) results[0].issues.unshift({ code: "robots_blocks_all", severity: "critical",
      message: "Your robots.txt tells Google not to crawl any page on this site, so nothing can rank." });
    if (!sitemapFound) results[0].issues.push({ code: "sitemap_missing", severity: "warning",
      message: "No sitemap found at /sitemap.xml or in robots.txt. A sitemap helps Google find new articles quickly." });
  }
  const pages = results.map(r => ({ url: r.url, status: r.status, ...(r.title ? { title: r.title.slice(0, 200) } : {}), issues: r.issues }));
  const score = healthScore(results);
  await ctx.runMutation(internal.siteHealth.record, { siteId, score, pages,
    ...(results[0]?.status === 0 ? { error: "Pentra couldn't reach your homepage over HTTPS." } : {}) });
  return { skipped: false as const, score };
}

/** Owner-triggered check (rate limited). */
export const run = action({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Sign in first");
  return runCheck(ctx, siteId, identity.subject);
} });

/** Scheduled check for automatic service. */
export const runInternal = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => runCheck(ctx, siteId) });
