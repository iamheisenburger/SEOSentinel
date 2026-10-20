"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { fetchPage } from "../lib/fetchPage";
import { safePublicRedirectStatus } from "../lib/safeOutbound";
import { extractBusinessPrefill } from "../lib/sitePrefill";
import { accessFindings, analyzePageHealth, discoveryFindings, robotsTxtFindings, sitemapIndexChildren, sitemapUrls } from "../lib/siteHealth";
import { dataForSeoLocationCode } from "../lib/dataForSeoLocale";
import { BUYER_FIT_CEILING_MICRO_USD, BUYER_FIT_MAX_KEYWORDS, normalizeFitKeyword, type BuyerFitVerdict } from "../lib/topicFit";
import { brandTerms, checkBusiness, checkSeeds, excludedFromMissed, FREE_CHECK_MAX_DIFFICULTY, freeCheckLocale, healthSummary, htmlLang,
  isBrandedKeyword, selectAlmostThere, selectMissedSearches, siteCoverage, type RankedKeyword } from "../lib/missedSearches";
import { discoverKeywords, getRankedKeywords, meterDataForSeoCost } from "./seoData";
import { judgeBuyerFit } from "./growthTopics";

const SITEMAP_PAGES = 1_000;
type Outcome =
  | { kind: "done"; businessName: string; countryName: string; missed: ReturnType<typeof selectMissedSearches>;
    almost: ReturnType<typeof selectAlmostThere>; health: ReturnType<typeof healthSummary>; keywordsUnavailable: boolean }
  | { kind: "failed"; error: string };

/** The page addresses the site's sitemap lists (bounded), and whether it has one. */
async function sitemapPages(home: string, host: string, declared: string[]): Promise<{ found: boolean; urls: string[] }> {
  for (const candidate of [`${home}sitemap.xml`, ...declared]) {
    const root = await fetchPage(candidate);
    if (root.status !== 200) continue;
    const children = sitemapIndexChildren(root.html, host, 5);
    const documents = children.length
      ? (await Promise.all(children.map(child => fetchPage(child)))).filter(page => page.status === 200).map(page => page.html)
      : [root.html];
    const urls = [...new Set(documents.flatMap(xml => sitemapUrls(xml, host, SITEMAP_PAGES)))].slice(0, SITEMAP_PAGES);
    if (urls.length || children.length) return { found: true, urls };
  }
  return { found: false, urls: [] };
}

/** One free check (convex/freeCheck.ts started it and holds its worst-case
 * cost). Public fetches only through the DNS-pinned fetcher; paid calls are
 * DataForSEO (metered at its own reported cost) and one buyer-fit call. */
export const run = internalAction({
  args: { checkId: v.id("free_checks"), domain: v.string(), requestedAt: v.number(), day: v.string(), reservedMicroUsd: v.number() },
  handler: async (ctx, args) => {
    const spent = { dataForSeoUsd: 0, uncertain: false, fitMicroUsd: 0 };
    const step = (label: string) => ctx.runMutation(internal.freeCheck.progress, { checkId: args.checkId, requestedAt: args.requestedAt, step: label });
    const check = async (): Promise<Outcome> => {
      const { domain } = args;
      // 1. The homepage, over HTTPS, on this website.
      let page = await fetchPage(`https://${domain}/`);
      if (page.status !== 200) {
        const www = await fetchPage(`https://www.${domain}/`);
        if (www.status === 200) page = www;
      }
      if (page.status !== 200) return { kind: "failed", error: `Pentra couldn't open https://${domain} (${page.status ? `HTTP ${page.status}` : "no response"}). Check the address and try again.` };
      const host = new URL(page.finalUrl).hostname.toLowerCase();
      if (host.replace(/^www\./, "") !== domain) return { kind: "failed", error: `${domain} redirects to ${host.replace(/^www\./, "")}. Check that address instead.` };
      const home = `https://${host}/`;
      const prefill = extractBusinessPrefill(page.html, host);

      // 2. What Google can see: robots.txt, the sitemap, the homepage, discovery.
      await step("Checking what Google can see");
      const alternate = host.startsWith("www.") ? host.slice(4) : `www.${host}`;
      const [robotsPage, missing, alternateHost] = await Promise.all([
        fetchPage(`${home}robots.txt`),
        fetchPage(`${home}pentra-check-${Date.now().toString(36)}-missing`),
        safePublicRedirectStatus(`https://${alternate}/`).catch(() => null),
      ]);
      const robots = robotsPage.status === 200 ? robotsTxtFindings(robotsPage.html) : { blocksAll: false, sitemaps: [] as string[], aiBlocked: [] as string[] };
      const sitemap = await sitemapPages(home, host, robots.sitemaps);
      const homeHealth = analyzePageHealth({ url: home, status: 200, finalUrl: page.finalUrl, html: page.html, robotsHeader: page.robots });
      const health = healthSummary([...accessFindings(robots, sitemap.found), ...homeHealth.issues,
        ...discoveryFindings({ homeUrl: home, homeHtml: page.html, homeStatus: 200, missingPageStatus: missing.status, alternateHost })]);

      // 3. Real searches: where the site already ranks, then the searches its
      // own words lead to, measured where it sells and in its language.
      await step("Finding searches your customers make");
      const locale = freeCheckLocale(host, htmlLang(page.html));
      const locationCode = dataForSeoLocationCode(locale.country);
      const brands = brandTerms(domain, prefill.name);
      const coverage = siteCoverage(sitemap.urls, homeHealth.title);
      const seeds = checkSeeds(prefill, brands);
      let ranked: RankedKeyword[] = [];
      const metered = await meterDataForSeoCost(async () => {
        try { ranked = await getRankedKeywords(domain, locationCode, locale.language, 100); } catch { ranked = []; }
        if (seeds.length === 0) return [];
        try {
          return await discoverKeywords(seeds, locationCode, locale.language, 40, { maxGoogleAdsBatches: 0, maxLabsSeeds: 3,
            maxRelatedSeeds: 0, minimumResults: 30, maximumDifficulty: FREE_CHECK_MAX_DIFFICULTY,
            excludeKeyword: keyword => excludedFromMissed(keyword, { brands, coverage, ranked }) ? "existing_intent" : undefined });
        } catch { return []; }
      });
      spent.dataForSeoUsd = metered.usd; spent.uncertain = metered.uncertain;
      const found = metered.result;

      // 4. Which of them this business's customers make: one buyer-fit call.
      await step("Checking which searches fit your business");
      const candidates = [...new Set([
        ...found.filter(k => k.difficultyMeasured && k.difficulty <= FREE_CHECK_MAX_DIFFICULTY && k.searchVolume >= 10).map(k => normalizeFitKeyword(k.keyword)),
        ...ranked.filter(r => r.position >= 4 && r.position <= 20 && r.searchVolume >= 10 && !isBrandedKeyword(r.keyword, brands))
          .map(r => normalizeFitKeyword(r.keyword)),
      ])].slice(0, BUYER_FIT_MAX_KEYWORDS);
      let verdicts = new Map<string, BuyerFitVerdict>();
      if (candidates.length > 0) {
        try {
          const fit = await judgeBuyerFit(checkBusiness(domain, prefill), candidates);
          verdicts = fit.verdicts; spent.fitMicroUsd = fit.costMicroUsd;
        } catch {
          spent.fitMicroUsd = BUYER_FIT_CEILING_MICRO_USD;
          return { kind: "failed", error: "Pentra couldn't finish checking which searches fit your business. Try again in an hour." };
        }
      }
      return { kind: "done", businessName: (prefill.name || domain).slice(0, 80), countryName: locale.countryName,
        missed: selectMissedSearches(found, verdicts, { brands, coverage, ranked }), almost: selectAlmostThere(ranked, verdicts, brands),
        health, keywordsUnavailable: found.length === 0 && ranked.length === 0 };
    };
    let outcome: Outcome;
    try { outcome = await check(); }
    catch (error) {
      console.warn(`Free check failed for ${args.domain}: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
      outcome = { kind: "failed", error: "Pentra couldn't finish this check. Try again in an hour." };
    }
    await ctx.runMutation(internal.freeCheck.complete, { checkId: args.checkId, requestedAt: args.requestedAt, day: args.day,
      reservedMicroUsd: args.reservedMicroUsd, costMicroUsd: Math.ceil(spent.dataForSeoUsd * 1_000_000) + spent.fitMicroUsd,
      costUncertain: spent.uncertain, outcome });
    return { status: outcome.kind };
  },
});
