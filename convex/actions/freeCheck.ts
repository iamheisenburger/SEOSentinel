"use node";

import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { fetchPage } from "../lib/fetchPage";
import { safePublicRedirectStatus } from "../lib/safeOutbound";
import { extractBusinessPrefill, homepageDigest } from "../lib/sitePrefill";
import { accessFindings, analyzePageHealth, discoveryFindings, robotsTxtFindings, sitemapIndexChildren, sitemapUrls } from "../lib/siteHealth";
import { dataForSeoLocationCode } from "../lib/dataForSeoLocale";
import { BUYER_FIT_CEILING_MICRO_USD, BUYER_FIT_MAX_KEYWORDS, BUYER_FIT_MODEL, buyerFitCostMicroUsd, normalizeFitKeyword,
  type BuyerFitVerdict } from "../lib/topicFit";
import { structuredToolChoice } from "../lib/toolChoice";
import { asksForFree, blockedHomepage, botWall, brandTerms, checkBusiness, checkSeeds, classifySearches, localHeadSeeds, FREE_CHECK_COVERAGE_SEARCHES, FREE_CHECK_HOME_MAX_BYTES,
  FREE_CHECK_VERIFIED_MISSED, verifyClaims, type LivePosition,
  FREE_CHECK_MAX_DIFFICULTY, FREE_CHECK_SITEMAP_MAX_BYTES, freeCheckLocale, healthSummary, htmlLang, isBrandedKeyword, linkedPages, localSeeds,
  namesPlace, notACandidate, PAGE_COVERAGE_MAX_TOKENS, PAGE_COVERAGE_TOOL, pageCoverageRequest, parsePageCoverage, parseSearchSeeds,
  pathsForCoverage, SEARCH_SEEDS_MAX_TOKENS, SEARCH_SEEDS_TOOL, searchSeedRequest, selectAlmostThere, selectWins, siteCoverage, siteSections, unreadableHomepage,
  parsePlaces, placeCandidateSections, PLACES_MAX_TOKENS, PLACES_TOOL, placesRequest,
  type PageAnswer, type RankedKeyword, type SeedRead } from "../lib/missedSearches";
import { discoverKeywords, getRankedKeywords, meterDataForSeoCost, siteSerpPositions } from "./seoData";
import { judgeBuyerFit } from "./growthTopics";

/** Page addresses read from the sitemap, and sitemap files read from an index. */
const SITEMAP_PAGES = 5_000;
const SITEMAP_ROOTS = 16;
const SITEMAP_CHILDREN = 32;
/** The site's own Google rankings read up front: its top-20 positions, most searched first. */
const RANKED_TOP = 300;
type Classified = ReturnType<typeof classifySearches>;
type Outcome =
  | { kind: "done"; businessName: string; countryName: string; summary: string; places: string[]; missed: Classified["missed"];
    almost: ReturnType<typeof selectAlmostThere>; wins: ReturnType<typeof selectWins>; unranked: Classified["unranked"];
    health: ReturnType<typeof healthSummary>; keywordsUnavailable: boolean }
  // refund: nothing paid ran and the reason is the website's, not the visitor's daily allowance.
  | { kind: "failed"; error: string; refund?: boolean };

type Diagnostics = { seedSource: "model" | "homepage"; seeds: string[]; topics?: string[]; discovered: number; ranked: number; judged: number;
  kept: number; sample?: Array<{ keyword: string; keep: boolean; reason: string }>; places?: string[]; freePlan?: string;
  coverage?: "model" | "words"; pagesRead?: number; rankCheck?: "verified" | "partial"; homeTitle?: string; country?: string;
  verified?: { asked: number; answered: number; absent: number }; seedError?: string; coverageError?: string; placesFrom?: "sections" };

/** A failed model call as the check's diagnostics record it (P199): the API's
 * status and message, clipped; never a key or the request. */
function modelCallError(error: unknown): string {
  if (error instanceof Error && error.message === "ANTHROPIC_API_KEY not set") return "no_key";
  const status = (error as { status?: unknown } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  return `${typeof status === "number" ? `http_${status}: ` : ""}${message}`.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** One small model call: the searches a buyer would type, read from the
 * homepage and the site's sections (convex/lib/missedSearches.ts
 * searchSeedRequest). Throws when no usable answer came back; the caller then
 * counts the call's ceiling. */
export async function proposeSeeds(domain: string, html: string, questions: string[], brands: string[], sections: string[]) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.TOPIC_FIT_MODEL ?? BUYER_FIT_MODEL;
  const request = searchSeedRequest(domain, homepageDigest(html), questions, sections);
  // P199 (Oct 25 2026): no sampling parameter. P187 sent temperature 0 here and on
  // the coverage call; the one check that ran with it (abchomeandcommercial.com,
  // 17:58Z) lost both of those calls while the buyer-fit call without it answered,
  // so the report silently fell back to its homepage's words. A failed call is
  // now recorded in the check's diagnostics.
  const response = await new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000, fetch }).messages.create({
    model, max_tokens: SEARCH_SEEDS_MAX_TOKENS, system: request.system,
    messages: [{ role: "user", content: request.userMessage }],
    tools: [{ name: SEARCH_SEEDS_TOOL, description: "Record the searches and the business summary.", input_schema: request.inputSchema, strict: true }],
    tool_choice: structuredToolChoice(model, SEARCH_SEEDS_TOOL),
  });
  const tool = response.content.find(block => block.type === "tool_use" && block.name === SEARCH_SEEDS_TOOL);
  return { read: parseSearchSeeds(tool && tool.type === "tool_use" ? tool.input : null, brands), costMicroUsd: buyerFitCostMicroUsd(response.usage) };
}

/** P205: one small call naming which of the site's own sections are places it
 * serves (convex/lib/missedSearches.ts placesRequest). Throws when no answer came back. */
async function placesFromSections(domain: string, title: string, sections: string[]) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.TOPIC_FIT_MODEL ?? BUYER_FIT_MODEL;
  const request = placesRequest(domain, title, sections);
  const response = await new Anthropic({ apiKey, maxRetries: 1, timeout: 30_000, fetch }).messages.create({
    model, max_tokens: PLACES_MAX_TOKENS, system: request.system,
    messages: [{ role: "user", content: request.userMessage }],
    tools: [{ name: PLACES_TOOL, description: "Record the sections that name places the business serves.", input_schema: request.inputSchema, strict: true }],
    tool_choice: structuredToolChoice(model, PLACES_TOOL),
  });
  const tool = response.content.find(block => block.type === "tool_use" && block.name === PLACES_TOOL);
  return { places: parsePlaces(tool && tool.type === "tool_use" ? tool.input : null, request.sections), costMicroUsd: buyerFitCostMicroUsd(response.usage) };
}

/** One small model call (v4): which of the site's own pages already answers
 * each search, and the topic each search shares with other wordings. */
async function coverPages(input: Parameters<typeof pageCoverageRequest>[0]) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const model = process.env.TOPIC_FIT_MODEL ?? BUYER_FIT_MODEL;
  const request = pageCoverageRequest(input);
  const response = await new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000, fetch }).messages.create({
    model, max_tokens: PAGE_COVERAGE_MAX_TOKENS, system: request.system,
    messages: [{ role: "user", content: request.userMessage }],
    tools: [{ name: PAGE_COVERAGE_TOOL, description: "Record the page and topic for every search.", input_schema: request.inputSchema, strict: true }],
    tool_choice: structuredToolChoice(model, PAGE_COVERAGE_TOOL),
  });
  const tool = response.content.find(block => block.type === "tool_use" && block.name === PAGE_COVERAGE_TOOL);
  return { pages: parsePageCoverage(tool && tool.type === "tool_use" ? tool.input : null, input.searches, input.paths),
    costMicroUsd: buyerFitCostMicroUsd(response.usage) };
}

/** The page addresses the site's sitemaps list (bounded), and whether it has
 * one. Every sitemap robots.txt declares is read, not only the first: a site
 * organised by city declares one per city (abchomeandcommercial.com has 15,
 * and its /austin/hvac-repair page is only in the Austin one). */
async function sitemapPages(home: string, host: string, declared: string[]): Promise<{ found: boolean; urls: string[] }> {
  const urls = new Set<string>(), children: string[] = [];
  let found = false;
  // A batch at a time, keeping only the addresses, so large files never pile up.
  const take = async (files: string[], index: boolean) => {
    for (let i = 0; i < files.length && urls.size < SITEMAP_PAGES; i += 8) {
      for (const page of await Promise.all(files.slice(i, i + 8).map(url => fetchPage(url, { maxBytes: FREE_CHECK_SITEMAP_MAX_BYTES })))) {
        if (page.status !== 200) continue;
        found = true;
        if (index) for (const child of sitemapIndexChildren(page.html, host, SITEMAP_CHILDREN)) if (!children.includes(child)) children.push(child);
        for (const url of sitemapUrls(page.html, host, SITEMAP_PAGES)) urls.add(url);
      }
    }
  };
  await take([...new Set([`${home}sitemap.xml`, ...declared])].slice(0, SITEMAP_ROOTS), true);
  await take(children.slice(0, SITEMAP_CHILDREN), false);
  return { found, urls: [...urls].slice(0, SITEMAP_PAGES) };
}

/** One free check (convex/freeCheck.ts started it and holds its worst-case
 * cost). Public fetches only through the DNS-pinned fetcher; paid calls are
 * DataForSEO (metered at its own reported cost) and three small model calls
 * (seeds, buyer fit, page coverage). */
export const run = internalAction({
  args: { checkId: v.id("free_checks"), domain: v.string(), requestedAt: v.number(), day: v.string(), reservedMicroUsd: v.number(),
    visitor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const spent = { dataForSeoUsd: 0, uncertain: false, fitMicroUsd: 0 };
    let diagnostics: Diagnostics | undefined;
    const step = (label: string) => ctx.runMutation(internal.freeCheck.progress, { checkId: args.checkId, requestedAt: args.requestedAt, step: label });
    const check = async (): Promise<Outcome> => {
      const { domain } = args;
      // 1. The homepage, over HTTPS, on this website.
      let page = await fetchPage(`https://${domain}/`, { maxBytes: FREE_CHECK_HOME_MAX_BYTES });
      if (page.status !== 200) {
        const www = await fetchPage(`https://www.${domain}/`, { maxBytes: FREE_CHECK_HOME_MAX_BYTES });
        if (www.status === 200 || page.status === 0) page = www;
      }
      if (page.status !== 200) return { kind: "failed", error: unreadableHomepage(domain, page.status), refund: true };
      if (botWall(page.html)) {
        const www = await fetchPage(`https://www.${domain}/`, { maxBytes: FREE_CHECK_HOME_MAX_BYTES });
        if (www.status === 200 && !botWall(www.html)) page = www;
        else return { kind: "failed", error: blockedHomepage(domain), refund: true };
      }
      const host = new URL(page.finalUrl).hostname.toLowerCase();
      if (host.replace(/^www\./, "") !== domain) {
        return { kind: "failed", error: `${domain} redirects to ${host.replace(/^www\./, "")}. Check that address instead.`, refund: true };
      }
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
      // own words lead to, measured where it sells and in its language. A local
      // business gets searches that name the places it serves.
      await step("Finding searches your customers make");
      const brands = brandTerms(domain, prefill.name);
      const sitePages = [...new Set([...sitemap.urls, ...linkedPages(page.html, host)])];
      const coverage = siteCoverage(sitePages, homeHealth.title);
      let read: SeedRead | null = null, seedError: string | undefined;
      const sections = siteSections([...sitePages, ...robots.sitemaps]);
      try {
        const proposed = await proposeSeeds(domain, page.html, prefill.questions, brands, sections);
        read = proposed.read; spent.fitMicroUsd += proposed.costMicroUsd;
        if (!read) seedError = "unusable_answer";
      } catch (error) { spent.fitMicroUsd += BUYER_FIT_CEILING_MICRO_USD; seedError = modelCallError(error); }
      // P205: a site organised by place (two or more of its own sections name places) is local even when the seed call named none.
      let placesFrom: "sections" | undefined;
      const placeSections = placeCandidateSections(sections);
      if (read && read.places.length === 0 && placeSections.length >= 2) {
        try {
          const found = await placesFromSections(domain, homeHealth.title ?? prefill.name ?? domain, placeSections);
          spent.fitMicroUsd += found.costMicroUsd;
          if (found.places.length >= 2) { read = { ...read, places: found.places }; placesFrom = "sections"; }
        } catch (error) {
          if (!(error instanceof Error && error.message === "ANTHROPIC_API_KEY not set")) spent.fitMicroUsd += BUYER_FIT_CEILING_MICRO_USD;
        }
      }
      const locale = freeCheckLocale(host, htmlLang(page.html), read?.country);
      const locationCode = dataForSeoLocationCode(locale.country);
      const places = read?.places ?? [];
      const local = places.length > 0;
      const offered = (keyword: string) => (!local || namesPlace(keyword, places)) && (read?.freePlan !== "no" || !asksForFree(keyword));
      const seeds = read ? (local ? localSeeds(read.topics.length ? read.topics : read.searches, places) : [...read.topics, ...read.searches])
        : checkSeeds(prefill, brands);
      diagnostics = { seedSource: read ? "model" : "homepage", seeds, ...(read ? { topics: read.topics, freePlan: read.freePlan } : {}),
        ...(seedError ? { seedError } : {}), ...(placesFrom ? { placesFrom } : {}),
        homeTitle: (homeHealth.title ?? "").slice(0, 120), country: locale.country,
        ...(local ? { places } : {}), discovered: 0, ranked: 0, judged: 0, kept: 0, pagesRead: sitePages.length };
      let ranked: RankedKeyword[] = [];
      const exclude = (keyword: string) => notACandidate(keyword, { brands, ranked }) ? "existing_intent" as const : undefined;
      const metered = await meterDataForSeoCost(async () => {
        try { ranked = await getRankedKeywords(domain, locationCode, locale.language, RANKED_TOP, { maxPosition: 20 }); } catch { ranked = []; }
        if (seeds.length === 0) return [];
        // Phrase-match suggestions for every short topic (a local business:
        // every service with its place), and Google's related searches for the
        // first. Category ideas range wider and never name a place, so they are
        // asked only for a business that sells country-wide, when the topics
        // found too few.
        let found: Awaited<ReturnType<typeof discoverKeywords>> = [];
        try {
          found = await discoverKeywords(local || !read?.topics.length ? seeds : read.topics, locationCode, locale.language, 50, { maxGoogleAdsBatches: 0,
            maxLabsSeeds: local ? 6 : 4, maxRelatedSeeds: 1, useKeywordIdeas: false, minimumResults: 30, maximumDifficulty: FREE_CHECK_MAX_DIFFICULTY,
            expandProductAnchors: true, excludeKeyword: exclude });
        } catch { found = []; }
        if (local && found.length < 10 && read) {
          try {
            const known = new Set(found.map(k => normalizeFitKeyword(k.keyword)));
            const heads = await discoverKeywords(localHeadSeeds(read.topics, places), locationCode, locale.language, 50, { maxGoogleAdsBatches: 0,
              maxLabsSeeds: 6, maxRelatedSeeds: 0, useKeywordIdeas: false, minimumResults: 30, maximumDifficulty: FREE_CHECK_MAX_DIFFICULTY,
              expandProductAnchors: true, excludeKeyword: exclude });
            found = [...found, ...heads.filter(k => !known.has(normalizeFitKeyword(k.keyword)))];
          } catch { /* keep what the services found */ }
        }
        if (!local && found.length < 15) {
          try {
            const known = new Set(found.map(k => normalizeFitKeyword(k.keyword)));
            const ideas = await discoverKeywords(seeds, locationCode, locale.language, 40, { maxGoogleAdsBatches: 0, maxLabsSeeds: 0,
              maxRelatedSeeds: 0, useKeywordIdeas: true, minimumResults: 30, maximumDifficulty: FREE_CHECK_MAX_DIFFICULTY,
              expandProductAnchors: true, excludeKeyword: exclude });
            found = [...found, ...ideas.filter(k => !known.has(normalizeFitKeyword(k.keyword)))];
          } catch { /* keep what the topics found */ }
        }
        return found;
      });
      spent.dataForSeoUsd = metered.usd; spent.uncertain = metered.uncertain;
      const found = metered.result;
      diagnostics = { ...diagnostics, discovered: found.length, ranked: ranked.length };

      // 4. Which of them this business's customers make: one buyer-fit call.
      await step("Checking which searches fit your business");
      const winnable = found.filter(k => k.difficultyMeasured && k.difficulty <= FREE_CHECK_MAX_DIFFICULTY && k.searchVolume >= 10 && offered(k.keyword));
      const rankedWithin = (low: number, high: number) => ranked.filter(r => r.position >= low && r.position <= high && r.searchVolume >= 10 &&
        !isBrandedKeyword(r.keyword, brands) && (!local || namesPlace(r.keyword, places))).map(r => normalizeFitKeyword(r.keyword));
      // P206: the searches it already wins (top 3) are judged too, last, so they never take the room of a search to report.
      const candidates = [...new Set([...winnable.map(k => normalizeFitKeyword(k.keyword)), ...rankedWithin(4, 20), ...rankedWithin(1, 3)])]
        .slice(0, BUYER_FIT_MAX_KEYWORDS);
      let verdicts = new Map<string, BuyerFitVerdict>();
      if (candidates.length > 0) {
        try {
          const fit = await judgeBuyerFit(checkBusiness(domain, prefill, read ?? undefined), candidates);
          verdicts = fit.verdicts; spent.fitMicroUsd += fit.costMicroUsd;
          diagnostics = { ...diagnostics, judged: verdicts.size, kept: [...verdicts.values()].filter(verdict => verdict.keep).length,
            sample: [...verdicts.values()].slice(0, 60).map(verdict => ({ keyword: verdict.keyword, keep: verdict.keep, reason: verdict.reason.slice(0, 120) })) };
        } catch {
          spent.fitMicroUsd += BUYER_FIT_CEILING_MICRO_USD;
          return { kind: "failed", error: "Pentra couldn't finish checking which searches fit your business. Try again in an hour." };
        }
      }

      // 5. The searches it could show, most searched first: is the site
      // already on Google's first two pages for them (the up-front list holds
      // only its most searched rankings), and which of its pages answer them.
      await step("Checking the pages you already have");
      const kept = [...new Set(winnable.filter(k => verdicts.get(normalizeFitKeyword(k.keyword))?.keep === true && !notACandidate(k.keyword, { brands, ranked }))
        .sort((a, b) => b.searchVolume - a.searchVolume).map(k => normalizeFitKeyword(k.keyword)))].slice(0, FREE_CHECK_COVERAGE_SEARCHES);
      let rankCheck: "verified" | "partial" = "partial";
      if (kept.length > 0) {
        const verified = await meterDataForSeoCost(async () => {
          try { return await getRankedKeywords(domain, locationCode, locale.language, 100, { maxPosition: 20, keywords: kept }); } catch { return null; }
        });
        spent.dataForSeoUsd += verified.usd; spent.uncertain ||= verified.uncertain;
        if (verified.result) {
          rankCheck = "verified";
          const known = new Set(ranked.map(r => `${normalizeFitKeyword(r.keyword)} ${r.url}`));
          ranked = [...ranked, ...verified.result.filter(r => !known.has(`${normalizeFitKeyword(r.keyword)} ${r.url}`))];
        }
      }
      let pages: Map<string, PageAnswer> | null = null, coverageError: string | undefined;
      if (kept.length > 0) {
        const paths = pathsForCoverage([...sitePages, ...ranked.map(r => r.url)], kept);
        const path = (url: string) => { try { return decodeURI(new URL(url).pathname).replace(/\/+$/, "") || "/"; } catch { return url; } };
        try {
          const covered = await coverPages({ domain, sells: read?.sells ?? prefill.summary, searches: kept, paths,
            ranked: ranked.slice(0, 60).map(r => ({ keyword: r.keyword, path: path(r.url), position: r.position })) });
          pages = covered.pages; spent.fitMicroUsd += covered.costMicroUsd;
          if (!pages) coverageError = "unusable_answer";
        } catch (error) { spent.fitMicroUsd += BUYER_FIT_CEILING_MICRO_USD; coverageError = modelCallError(error); }
      }
      diagnostics = { ...diagnostics, coverage: pages ? "model" : "words", rankCheck, ...(coverageError ? { coverageError } : {}) };
      // With the coverage call's answer, only the searches it judged are shown.
      const shown = pages ? found.filter(k => kept.includes(normalizeFitKeyword(k.keyword))) : found;
      const classified = classifySearches(shown, verdicts, { brands, coverage, ranked, pages, places, freePlan: read?.freePlan });

      // 6. Google itself, live, before any claim (P184): a missed or not-shown
      // search is reported only when the site is absent from its top 20; one the
      // site already ranks 4-20 for becomes close to page one.
      await step("Checking Google for each search");
      const claims = [...classified.missed.slice(0, FREE_CHECK_VERIFIED_MISSED), ...classified.unranked].map(row => row.keyword);
      let live = new Map<string, LivePosition>();
      if (claims.length > 0) {
        const checked = await meterDataForSeoCost(() => siteSerpPositions(domain, claims, locationCode, locale.language));
        spent.dataForSeoUsd += checked.usd; spent.uncertain ||= checked.uncertain;
        live = checked.result;
      }
      const verified = verifyClaims(classified, selectAlmostThere(ranked, verdicts, brands, places), live, selectWins(ranked, verdicts, brands, places));
      diagnostics = { ...diagnostics, verified: { asked: claims.length, answered: live.size, absent: [...live.values()].filter(seen => seen === null).length } };
      return { kind: "done", businessName: (prefill.name || domain).slice(0, 80), countryName: locale.countryName,
        summary: (read?.sells || prefill.summary || "").slice(0, 400), places, missed: verified.missed, unranked: verified.unranked,
        almost: verified.almost, wins: verified.wins, health, keywordsUnavailable: found.length === 0 && ranked.length === 0 };
    };
    let outcome: Outcome;
    try { outcome = await check(); }
    catch (error) {
      console.warn(`Free check failed for ${args.domain}: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`);
      outcome = { kind: "failed", error: "Pentra couldn't finish this check. Try again in an hour." };
    }
    await ctx.runMutation(internal.freeCheck.complete, { checkId: args.checkId, requestedAt: args.requestedAt, day: args.day,
      reservedMicroUsd: args.reservedMicroUsd, costMicroUsd: Math.ceil(spent.dataForSeoUsd * 1_000_000) + spent.fitMicroUsd,
      costUncertain: spent.uncertain, outcome, ...(diagnostics ? { diagnostics } : {}), ...(args.visitor ? { visitor: args.visitor } : {}) });
    return { status: outcome.kind };
  },
});
