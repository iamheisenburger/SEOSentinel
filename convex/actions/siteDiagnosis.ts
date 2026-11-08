"use node";
/** Site diagnosis, the weekly run (Nov 2026). Reads everything the diagnosis needs, for any site, scores it with
 * convex/lib/siteDiagnosis.ts, repairs what it safely can, and records the result:
 *   - the site's pages as crawled: every published article, every address Search Console shows and every address the
 *     sitemap lists, each redirect recorded (status and destination), never followed blindly, and each redirect's
 *     destination read for its title; the links between pages; the sitemap itself;
 *   - Search Console's last 28 days (when connected), and Google's index verdict per article (already inspected daily);
 *   - paid, under a spend hold: who the top searches' readers are (one cheap model call) and how strong page one is for
 *     the site's main searches (live results and every ranking site's authority, from DataForSEO).
 * Repairs: duplicate articles (shown for the same searches) merge into the stronger page with a permanent redirect,
 * delivered where the site's pages are served and then checked by fetching the old address.
 * A part that can't run (no Search Console, no budget, a provider error) is recorded as unknown, never guessed.
 */
import Anthropic from "@anthropic-ai/sdk";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { getDomainAuthorities, lighthouseMobile, meterDataForSeoCost, pageOneDomains } from "./seoData";
import { linkCompetitors } from "../lib/linkOpportunities";
import { aiCitedPages, type ListingPage } from "../lib/linkOutreach";
import { findListingPages } from "./linkOutreach";
import { dataForSeoLocationCode } from "../lib/dataForSeoLocale";
import { crawlPages, pageSpeedCheck, parsePageSpeed, readSitemap } from "../lib/pageCrawl";
import { diagnoseSite, normalize, type CrawledPage, type GscRow, type PageOneCheck, type QueryIntent, type SpeedCheck } from "../lib/siteDiagnosis";
import { foldQuestionsFor, planUnshownMerges, slugKey, type Merge } from "../lib/duplicatePages";
import { topicChoiceRollout } from "../lib/topicVerdict";
import { AI_ASSISTANT_ENDPOINTS, AI_ASSISTANTS, AI_MIN_ANSWERS, AI_QUESTIONS_MAX_TOKENS, AI_QUESTIONS_MODEL, AI_QUESTIONS_TOOL, aiAnswerTotals, aiQuestionsRequest,
  citedHosts, countryCode, judgeAnswer, parseAiQuestions, parseAssistantAnswer, rivalMatchers, rivalsNamed, type AiAnswerCheck, type AiAssistant, type Business,
  type RivalMatcher } from "../lib/aiAnswers";
import { parseSearchIntents, searchIntentRequest, SEARCH_INTENT_MAX_TOKENS, SEARCH_INTENT_MODEL, SEARCH_INTENT_TOOL } from "../lib/searchIntent";
import { buyerFitCostMicroUsd } from "../lib/topicFit";
import { structuredToolChoice } from "../lib/toolChoice";
import { isBrandedSearchQuery } from "../lib/searchPerformance";
import { safePublicRedirectStatus, safeRequestPublicHttps, validatePublicHttpsUrl } from "../lib/safeOutbound";
import { createHmac } from "node:crypto";
import { redirectOnCms, type CmsRequest, type CmsSite } from "../lib/cmsPublishers";
import { wordpressRedirectKey, wordpressRedirects } from "../lib/wordpressConditional";
import { editNetlifyToml, editRedirectsFile, pageForwardsTo, webhookRedirectEvent } from "../lib/platformRedirects";
import { HOSTED_BLOG_DOMAINS } from "../lib/blogListing";
import { checkSnippet, snippetCandidates, snippetRequest, snippetUrlKey, snippetVerdict, SNIPPET_MAX_TOKENS, SNIPPET_MODEL, SNIPPET_TESTS_PER_RUN, SNIPPET_TOOL,
  type Snippet, type SnippetMeasure } from "../lib/searchSnippet";
import { publishedArticleInternalHref } from "../lib/internalLinks";
import { editVercelRedirects, type RedirectEntry } from "../lib/vercelRedirects";

const MAX_PAGES = 200, PAGE_ONE_QUERIES = 5, INTENT_MIN_IMPRESSIONS = 5;
/** Each AI-assistant question's price bound on treg, about three times its price (ChatGPT $0.0032, Gemini and Google AI Mode
 * $0.0024); a call whose answer was lost is charged at it. 30 calls at the bound fit the run's $0.50 hold. */
const AI_CALL_MAX_MICRO_USD = 10_000;
/** The AI-answer questions' time inside the run: started beside the crawl, they never take the run near an action's limit. */
const AI_TIME_LIMIT_MS = 4 * 60_000, AI_CALL_TIMEOUT_MS = 150_000;
/** Vercel builds a commit in a minute or two; the redirects are checked after this, and once more later if not live yet. */
const VERIFY_AFTER_MS = 6 * 60_000, VERIFY_RETRY_MS = 30 * 60_000;

type Context = NonNullable<FunctionReturnType<typeof internal.siteDiagnosis.context>>;
type Recorded = Array<{ id: Id<"site_redirects">; fromSlug: string; toSlug: string }>;
type RunResult = { skipped: string } | { siteType: string; factors: Record<string, string>; findings: number; merges: Recorded;
  costMicroUsd: number; notes: string[] };
const loadContext = (ctx: ActionCtx, siteId: Id<"sites">): Promise<Context | null> => ctx.runQuery(internal.siteDiagnosis.context, { siteId });

export const runInternal = internalAction({ args: { siteId: v.id("sites"), force: v.optional(v.boolean()) },
  handler: async (ctx, { siteId, force }): Promise<RunResult> => runDiagnosis(ctx, siteId, Boolean(force)) });

/** Phase 3 (Nov 2026): the repairs alone (duplicate merges, unshown articles folded, every redirect delivered and checked),
 * from Search Console and the crawl, which cost nothing: no paid check runs and no diagnosis is recorded (the weekly one
 * stays on the dashboard). Rollout sites only, like the weekly run. */
export const runRepairs = internalAction({ args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<RunResult> => runDiagnosis(ctx, siteId, true, { repairsOnly: true }) });

async function runDiagnosis(ctx: ActionCtx, siteId: Id<"sites">, force: boolean, options: { repairsOnly?: boolean } = {}): Promise<RunResult> {
  const repairsOnly = Boolean(options.repairsOnly);
  const site = await loadContext(ctx, siteId);
  if (!site) return { skipped: "site not active" };
  if (repairsOnly && !topicChoiceRollout(site.domain, site.newSystemAt)) return { skipped: "not a rollout site" };
  if (!force && site.lastRunAt && Date.now() - site.lastRunAt < 6 * 24 * 3600 * 1000) return { skipped: "diagnosed this week" };
  const notes: string[] = [];

  // Search Console: the last 28 days, when connected.
  let gsc: GscRow[] = [];
  if (site.searchConsole) {
    const read = await ctx.runQuery(internal.siteDiagnosis.gscRows, { siteId });
    gsc = read.rows;
    if (read.capped) notes.push(`Search Console read capped at ${gsc.length} rows`);
  }

  // What the paid checks and the crawl both need, from Search Console and the published articles.
  const shown = new Map<string, number>();
  for (const r of gsc) if (r.page) shown.set(r.page, (shown.get(r.page) ?? 0) + r.impressions);
  const totals = new Map<string, number>();
  for (const r of gsc) if (!isBrandedSearchQuery(r.query, site.domain)) totals.set(r.query, (totals.get(r.query) ?? 0) + r.impressions);
  const topQueries = [...totals].filter(([, n]) => n >= INTENT_MIN_IMPRESSIONS).sort((a, b) => b[1] - a[1]).map(([q]) => q);
  // Speed is measured on the home page and the two articles Google shows most (all articles share their template).
  // An article that now redirects (consolidated or merged) is not measured: its address isn't a page.
  const articleUrls = new Set(site.published.filter((p) => !p.moved).map((p) => normalize(p.url)));
  const speedPages = [`https://${site.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/`,
    ...[...shown].filter(([url]) => articleUrls.has(normalize(url))).sort((a, b) => b[1] - a[1]).map(([url]) => url),
    ...site.published.filter((p) => !p.moved).map((p) => p.url)]
    .filter((url, i, all) => all.findIndex((u) => normalize(u) === normalize(url)) === i).slice(0, 3);
  const business: Business = { name: site.business.name, domain: site.domain, summary: site.business.summary ?? undefined,
    audience: site.business.audience ?? undefined, features: site.business.features ?? undefined, problems: site.business.problems ?? undefined,
    country: site.targetCountry };
  const staleAuthority = !site.authority || !site.authority.measuredAt || Date.now() - site.authority.measuredAt > 30 * 24 * 3600 * 1000;
  const freeSpeedTest = Boolean(process.env.PAGESPEED_API_KEY) && !repairsOnly;

  // One hold for the run's paid checks, taken before any of them starts.
  const wantsPaid = !repairsOnly && (topQueries.length > 0 || staleAuthority || Boolean(process.env.TREG_TOKEN) || !freeSpeedTest);
  const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  const hold = wantsPaid ? await ctx.runMutation(internal.siteDiagnosis.reserve, { siteId, trigger: `site_diagnosis:${week}${force ? `:forced:${Date.now()}` : ""}` }) : null;
  if (hold && !hold.ok) notes.push(`Paid checks skipped: provider budget (${hold.reason})`);
  const paid = Boolean(hold?.ok);
  const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000, fetch });

  // Three parts at once, so the run stays well inside an action's time: the crawl (free), the paid measurements (who the
  // readers are, page one's strength, speed), and the AI-answer questions (their own time limit).
  const crawlPart = async () => {
    // Every published article, every address Search Console shows (old addresses included), every address the sitemap
    // lists, then where each redirect lands (for its title).
    const sitemap = await readSitemap(site.domain).catch(() => null);
    const seeds = [...new Set([...site.published.map((p) => p.url), ...[...shown].sort((a, b) => b[1] - a[1]).map(([url]) => url), ...(sitemap?.urls ?? [])])]
      .slice(0, MAX_PAGES);
    const [crawled, freeSpeed] = await Promise.all([crawlPages(seeds), freeSpeedTest
      ? Promise.all(speedPages.map((url) => pageSpeedCheck(url))).then((checks) => checks.filter((c): c is SpeedCheck => c !== null))
      : Promise.resolve([] as SpeedCheck[])]);
    const targets = [...crawled.values()].flatMap((p) => (p.location && !crawled.has(normalize(p.location)) ? [p.location] : []));
    for (const [key, page] of await crawlPages([...new Set(targets)].slice(0, 40))) crawled.set(key, page);
    return { sitemap, crawled, freeSpeed };
  };
  const measurePart = async () => {
    const out = { intents: [] as QueryIntent[], pageOne: [] as PageOneCheck[], authority: site.authority ? { domainRank: site.authority.domainRank,
      referringDomains: site.authority.referringDomains } : null as { domainRank: number; referringDomains?: number } | null,
      speed: [] as SpeedCheck[], links: [] as ListingPage[], competitors: [] as string[], snippets: [] as SnippetProposal[], snippetDecisions: [] as SnippetDecision[],
      microUsd: 0, uncertain: false, notes: [] as string[] };
    if (!paid) return out;
    const readers = async () => {
      // Who types the top searches, judged against what the business sells.
      if (!topQueries.length || !process.env.ANTHROPIC_API_KEY) return;
      try {
        const request = searchIntentRequest(site.business, topQueries);
        const response = await anthropic().messages.create({
          model: SEARCH_INTENT_MODEL, max_tokens: SEARCH_INTENT_MAX_TOKENS, system: request.system, messages: [{ role: "user", content: request.userMessage }],
          tools: [{ name: SEARCH_INTENT_TOOL, description: "Record who types each search.", input_schema: request.inputSchema, strict: true }],
          tool_choice: structuredToolChoice(SEARCH_INTENT_MODEL, SEARCH_INTENT_TOOL) });
        out.microUsd += buyerFitCostMicroUsd(response.usage);
        const tool = response.content.find((b) => b.type === "tool_use" && b.name === SEARCH_INTENT_TOOL);
        out.intents = parseSearchIntents(request.queries, tool && tool.type === "tool_use" ? tool.input : null);
      } catch (error) { out.notes.push(`Readers not judged: ${String(error).slice(0, 120)}`); }
    };
    const pageOneAndSpeed = async () => {
      // Page one for the main searches (all at once), every ranking site's authority (and the site's own, when stale), and
      // speed as Google's Lighthouse measures it on a phone when no PageSpeed key makes it free.
      try {
        const metered = await meterDataForSeoCost(async () => {
          const location = dataForSeoLocationCode(site.targetCountry ?? undefined);
          const [serps, speed] = await Promise.all([
            Promise.all(topQueries.slice(0, PAGE_ONE_QUERIES).map(async (query) => {
              try { return { query, domains: (await pageOneDomains(query, location)).filter((d) => !d.endsWith(site.domain.replace(/^www\./, ""))) }; }
              catch { return null; } // that search stays unmeasured
            })).then((all) => all.filter((x): x is { query: string; domains: string[] } => x !== null)),
            freeSpeedTest ? Promise.resolve([] as SpeedCheck[]) : Promise.all(speedPages.map((url) => lighthouseMobile(url)
              .then((answer) => answer ? parsePageSpeed(url, answer) : null).catch(() => null))).then((all) => all.filter((c): c is SpeedCheck => c !== null))]);
          const wanted = [...new Set([...serps.flatMap((s) => s.domains), ...(staleAuthority ? [site.domain] : [])])].slice(0, 50);
          const ranks = wanted.length ? await getDomainAuthorities(wanted, { maxDomains: 50 }) : [];
          return { serps, ranks, speed };
        });
        out.speed = metered.result.speed;
        out.microUsd += Math.ceil(metered.usd * 1e6); out.uncertain = metered.uncertain;
        const rankOf = new Map(metered.result.ranks.map((r) => [r.domain.replace(/^www\./, ""), r.domainRank]));
        const own = rankOf.get(site.domain.replace(/^www\./, ""));
        if (staleAuthority && typeof own === "number") {
          const evidence = metered.result.ranks.find((r) => r.domain.replace(/^www\./, "") === site.domain.replace(/^www\./, ""));
          out.authority = { domainRank: own, referringDomains: evidence?.referringDomains };
        }
        const siteRank = out.authority?.domainRank ?? null;
        out.pageOne = metered.result.serps.map((s) => {
          const known = s.domains.map((d) => rankOf.get(d)).filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
          return { query: s.query, medianRank: known.length ? known[Math.floor(known.length / 2)] : null, results: s.domains.length,
            reachable: siteRank === null ? undefined : known.filter((n) => n <= siteRank + 10).length,
            domains: s.domains.map((domain) => ({ domain, rank: rankOf.get(domain) ?? null })) };
        });
      } catch (error) { out.notes.push(`Page one not measured: ${String(error).slice(0, 120)}`); }
    };
    await Promise.all([readers(), pageOneAndSpeed()]);
    // Phase 3: a new search title for buyer pages Google shows on page one but few click, and the verdicts on earlier ones.
    if (topicChoiceRollout(site.domain, site.newSystemAt) && gsc.length && out.intents.length) {
      try {
        const tested = await titleTests(ctx, site, gsc, out.intents);
        out.snippets = tested.proposals; out.snippetDecisions = tested.decisions; out.microUsd += tested.costMicroUsd; out.notes.push(...tested.notes);
      } catch (error) { out.notes.push(`Search titles not tested: ${String(error).slice(0, 120)}`); }
    }
    // Phase 4: the pages linking to the page-one competitors but not to this site, only when the owner turned it on.
    if (site.linkOutreach && out.pageOne.length) {
      try {
        const competitors = linkCompetitors(out.pageOne, site.domain, undefined, site.profileCompetitors);
        out.competitors = competitors;
        if (competitors.length >= 2) {
          const found = await findListingPages(competitors, site.domain);
          out.microUsd += Math.ceil(found.usd * 1e6); out.uncertain = out.uncertain || found.uncertain;
          out.links = found.pages;
        }
      } catch (error) { out.notes.push(`Link opportunities not found: ${String(error).slice(0, 120)}`); }
    }
    return out;
  };
  const aiPart = async () => {
    // The buyer questions (written once from what the business sells, then the same every week) put to ChatGPT, Gemini
    // and Google AI Mode.
    const out = { questions: [] as string[], checks: [] as AiAnswerCheck[], microUsd: 0, notes: [] as string[] };
    if (!paid || !process.env.TREG_TOKEN) return out;
    try {
      out.questions = site.aiQuestions;
      if (!out.questions.length && process.env.ANTHROPIC_API_KEY) {
        const request = aiQuestionsRequest(business, topQueries.slice(0, 10));
        const response = await anthropic().messages.create({
          model: AI_QUESTIONS_MODEL, max_tokens: AI_QUESTIONS_MAX_TOKENS, system: request.system, messages: [{ role: "user", content: request.userMessage }],
          tools: [{ name: AI_QUESTIONS_TOOL, description: "Record the buyer questions.", input_schema: request.inputSchema, strict: true }],
          tool_choice: structuredToolChoice(AI_QUESTIONS_MODEL, AI_QUESTIONS_TOOL) });
        out.microUsd += buyerFitCostMicroUsd(response.usage);
        const tool = response.content.find((b) => b.type === "tool_use" && b.name === AI_QUESTIONS_TOOL);
        out.questions = parseAiQuestions(tool && tool.type === "tool_use" ? tool.input : null, business);
      }
      const asked = await askAssistants(siteId, out.questions, business, Date.now() + AI_TIME_LIMIT_MS, rivalMatchers(site.rivals, business));
      out.checks = asked.checks; out.microUsd += asked.costMicroUsd;
    } catch (error) { out.notes.push(`AI answers not measured: ${String(error).slice(0, 120)}`); }
    return out;
  };
  const [crawlResult, measured, ai] = await Promise.all([crawlPart(), measurePart(), aiPart()]);
  notes.push(...measured.notes, ...ai.notes);
  const { sitemap, crawled } = crawlResult;
  const intents = measured.intents, pageOne = measured.pageOne, authority = measured.authority;
  const speedChecks = freeSpeedTest ? crawlResult.freeSpeed : measured.speed;
  const aiQuestions = ai.questions, aiChecks = ai.checks;
  const costMicroUsd = measured.microUsd + ai.microUsd;
  if (hold?.ok) {
    if (!measured.uncertain) await ctx.runMutation(internal.siteDiagnosis.close, { siteId, reservationId: hold.reservationId, sent: costMicroUsd > 0, actualMicroUsd: costMicroUsd });
    else notes.push("A provider charge is uncertain: the hold is kept");
  }
  const byUrl = new Map(site.published.map((p) => [normalize(p.url), p]));
  const removed = new Set(site.removed.map(normalize));
  let pages: CrawledPage[] = [...crawled.values()].map((p) => {
    const article = byUrl.get(normalize(p.url));
    if (removed.has(normalize(p.url))) return { ...p, removed: true };
    return article ? { ...p, article: true, indexVerdict: article.indexVerdict, coverageState: article.coverageState, publishedAt: article.publishedAt } : p;
  });
  const crawlComplete = site.published.length < 300 && site.published.every((p) => crawled.has(normalize(p.url)));

  // Phase 4: the pages to approach (those linking to the competitors, and the pages AI assistants cite for the buyer
  // questions), then the week's preparation: each page read, its contact found and its email written (and won links checked).
  const aiPages = site.linkOutreach && measured.competitors.length ? aiCitedPages(aiChecks.flatMap((c) => c.pages ?? []), site.domain, measured.competitors) : [];
  if (measured.links.length || aiPages.length) {
    try { const recorded = await ctx.runMutation(internal.linkOpportunities.record, { siteId, pages: [...measured.links, ...aiPages] });
      notes.push(`Link opportunities: ${measured.links.length} pages link to its page-one competitors but not to it, ${aiPages.length} cited by AI assistants (${recorded.added} new)`); }
    catch (error) { notes.push(`Link opportunities not recorded: ${String(error).slice(0, 120)}`); }
  }
  if (site.linkOutreach && !repairsOnly) await ctx.scheduler.runAfter(0, internal.actions.linkOutreach.prepare, { siteId });
  // Phase 3: the week's verdicts on earlier title tests, then the new tests (Autopilot's repair round places them).
  if (measured.snippetDecisions.length || measured.snippets.length) {
    try {
      if (measured.snippetDecisions.length) {
        const decided = await ctx.runMutation(internal.searchSnippets.decide, { siteId, decisions: measured.snippetDecisions });
        if (decided.restores) notes.push(`Search titles: ${decided.restores} restored after clicks fell`);
      }
      if (measured.snippets.length) {
        const proposed = await ctx.runMutation(internal.searchSnippets.propose, { siteId, proposals: measured.snippets });
        notes.push(`Search titles: ${proposed.added} new ${proposed.added === 1 ? "test" : "tests"} for pages buyers see on page one but rarely click`);
      }
    } catch (error) { notes.push(`Search titles not recorded: ${String(error).slice(0, 120)}`); }
  }
  // Phase 5: the week's buyer questions become topics to check (Phase 2 decides whether each is written).
  if (aiQuestions.length && !repairsOnly) {
    try { await ctx.runMutation(internal.contentWork.addAiQuestionTopics, { siteId, questions: aiQuestions }); }
    catch (error) { notes.push(`AI questions not added as topics: ${String(error).slice(0, 120)}`); }
  }
  const answered = aiChecks.filter((c) => c.answered).length;
  if (aiChecks.length && answered < AI_MIN_ANSWERS) notes.push(`AI answers not judged: ${answered} of ${aiChecks.length} questions were answered`);
  const inputs = { domain: site.domain, gsc, authority, pageOne, crawlComplete, sitemap, intents, speed: speedChecks, now: Date.now(),
    aiAnswers: answered >= AI_MIN_ANSWERS ? aiAnswerTotals(aiChecks) : null,
    aiAttempt: aiChecks.length && answered < AI_MIN_ANSWERS ? { questions: aiChecks.length, answered } : null };
  let d = diagnoseSite({ ...inputs, pages });

  // Repairs: duplicates merge into the stronger page, and every redirect not yet live is delivered and checked.
  if (d.merges.length && site.ownerReview) notes.push(`${d.merges.length} duplicate merges wait: owner review is on`);
  const merged: Recorded = d.merges.length && !site.ownerReview ? await recordMerges(ctx, site, d.merges, gsc) : [];
  if (merged.length) {
    notes.push(`Merged ${merged.length} duplicate ${merged.length === 1 ? "article" : "articles"}: ${merged.map((m) => `${m.fromSlug} → ${m.toSlug}`).join("; ")}`);
    // The record shows the site after this run's repairs: each merged page now redirects to the page it joined.
    const moved = new Map(merged.map((m) => [normalize(addressOf(site, m.fromSlug).url), addressOf(site, m.toSlug).url]));
    pages = pages.map((p) => moved.has(normalize(p.url)) ? { url: p.url, status: 308, location: moved.get(normalize(p.url))! } : p);
    d = diagnoseSite({ ...inputs, pages });
  }
  // Phase 3 (Nov 2026): an article Google showed to nobody in 28 days, live 60+ days, folds into the article on its subject
  // that Google does show (its subject becomes a section there). One without a shown sibling stays for a rewrite.
  const folded = gsc.length && !site.ownerReview ? await recordUnshownMerges(ctx, site, pages, gsc, merged) : [];
  if (folded.length) {
    notes.push(`Folded ${folded.length} ${folded.length === 1 ? "article" : "articles"} Google never showed: ${folded.map((m) => `${m.fromSlug} → ${m.toSlug}`).join("; ")}`);
    const moved = new Map(folded.map((m) => [normalize(addressOf(site, m.fromSlug).url), addressOf(site, m.toSlug).url]));
    pages = pages.map((p) => moved.has(normalize(p.url)) ? { url: p.url, status: 308, location: moved.get(normalize(p.url))! } : p);
    d = diagnoseSite({ ...inputs, pages });
  }
  notes.push(...await deliverRedirects(ctx, site));
  // A merge recorded before folds existed gets its merged page's searches now (Search Console still holds them).
  if (gsc.length) {
    const unfolded: Array<{ id: Id<"site_redirects">; fromSlug: string; toSlug: string; folded: boolean }> =
      await ctx.runQuery(internal.siteRedirects.unfoldedInternal, { siteId });
    for (const row of unfolded) {
      const foldQuestions = foldQuestionsFor(gsc, addressOf(site, row.fromSlug).url, addressOf(site, row.toSlug).url, site.domain);
      await ctx.runMutation(internal.siteRedirects.setFoldQuestions, { siteId, id: row.id, foldQuestions });
    }
  }

  // A repairs-only run records no diagnosis: the weekly one, with its paid measurements, stays the site's record.
  if (repairsOnly) return { siteType: d.siteType, factors: d.factors, findings: d.findings.length, merges: [...merged, ...folded], costMicroUsd: 0, notes };
  await ctx.runMutation(internal.siteDiagnosis.record, { siteId, diagnosis: {
    siteType: d.siteType, ...(d.window ? { window: d.window } : {}), totals: d.totals, factors: d.factors,
    findings: d.findings.map((f) => ({ ...f, ...(f.items ? { items: f.items.slice(0, 8) } : {}) })), pageActions: d.pageActions.slice(0, 150),
    summary: d.summary, inputs: { searchConsole: gsc.length > 0, crawledPages: pages.length, intents: intents.length, pageOneChecked: pageOne.length,
      authorityMeasured: Boolean(authority) }, costMicroUsd, ...(notes.length ? { notes: notes.map((n) => n.slice(0, 500)) } : {}),
    ...(pageOne.length ? { pageOne: pageOne.map((c) => ({ ...c, domains: c.domains?.slice(0, 10) })) } : {}),
    ...(speedChecks.length ? { speed: speedChecks } : {}),
    ...(intents.length ? { intents: intents.slice(0, 80).map((i) => ({ query: i.query.trim().toLowerCase().slice(0, 200), label: i.label })) } : {}),
    ...(aiQuestions.length ? { aiAnswers: { questions: aiQuestions, checks: aiChecks } } : {}) } });
  return { siteType: d.siteType, factors: d.factors, findings: d.findings.length, merges: merged, costMicroUsd, notes };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

type SnippetProposal = { pageId: Id<"pages">; url: string; query: string; before: Snippet; after: Snippet; baseline: SnippetMeasure; costMicroUsd: number };
type SnippetDecision = { id: Id<"search_snippets">; outcome: "keep" | "restore" | "failed" | "restored_live"; liveAt?: number; after?: SnippetMeasure;
  ratioBefore?: number; ratioAfter?: number };
/** A title call whose answer was lost is charged at this bound (a Haiku call with a short page opening costs about $0.001). */
const SNIPPET_CALL_MAX_MICRO_USD = 5_000;

/** Phase 3 (Nov 2026): the week's search title work for one site, from its Search Console rows and the readers' labels.
 * Tests placed earlier are judged by their clicks (or set aside when they never went live); then up to
 * SNIPPET_TESTS_PER_RUN pages Google shows on page one to buyers who rarely click get a new title and description,
 * written by one cheap model call each and used only when it passes the objective checks (checkSnippet). */
async function titleTests(ctx: ActionCtx, site: Context, gsc: readonly GscRow[], intents: readonly QueryIntent[]) {
  const out = { proposals: [] as SnippetProposal[], decisions: [] as SnippetDecision[], costMicroUsd: 0, notes: [] as string[] };
  const tests = await ctx.runQuery(internal.searchSnippets.context, { siteId: site.siteId });
  if (!tests) return out;
  const labels = new Map(intents.map((i) => [i.query.trim().toLowerCase(), String(i.label)]));
  const now = Date.now();
  for (const t of tests.placed) {
    if (t.failed) { out.decisions.push({ id: t.id, outcome: "failed" }); continue; }
    if (t.liveAt === null) continue;
    if (t.restore) { out.decisions.push({ id: t.id, outcome: "restored_live", liveAt: t.liveAt }); continue; }
    const verdict = snippetVerdict(gsc, { url: t.url, liveAt: t.liveAt, baseline: t.baseline }, { domain: site.domain, labels, now });
    if (verdict.outcome === "wait") continue;
    out.decisions.push({ id: t.id, outcome: verdict.outcome, liveAt: t.liveAt, after: verdict.after, ratioBefore: verdict.ratioBefore, ratioAfter: verdict.ratioAfter });
  }
  const pageIdOf = new Map(tests.eligible.map((p) => [snippetUrlKey(p.url), p.pageId]));
  const candidates = snippetCandidates(gsc, { domain: site.domain, labels, eligible: new Set(pageIdOf.keys()) }).slice(0, SNIPPET_TESTS_PER_RUN);
  if (!candidates.length || !process.env.ANTHROPIC_API_KEY) return out;
  const details = await ctx.runQuery(internal.searchSnippets.pageDetails, { siteId: site.siteId,
    pageIds: candidates.flatMap((c) => pageIdOf.get(snippetUrlKey(c.url)) ?? []) });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000, fetch });
  for (const c of candidates) {
    const page = details.find((d) => snippetUrlKey(d.url) === snippetUrlKey(c.url));
    if (!page) continue;
    const request = snippetRequest({ business: { name: site.business.name, domain: site.domain }, query: c.query, queries: c.queries,
      title: page.title, metaTitle: page.metaTitle, description: page.description, opening: page.markdown.slice(0, 1800), position: c.position });
    let input: unknown = null, cost = SNIPPET_CALL_MAX_MICRO_USD;
    try {
      const response = await anthropic.messages.create({ model: SNIPPET_MODEL, max_tokens: SNIPPET_MAX_TOKENS, system: request.system,
        messages: [{ role: "user", content: request.userMessage }],
        tools: [{ name: SNIPPET_TOOL, description: "Record the page's new search title and description.", input_schema: request.inputSchema, strict: true }],
        tool_choice: structuredToolChoice(SNIPPET_MODEL, SNIPPET_TOOL) });
      cost = buyerFitCostMicroUsd(response.usage);
      const tool = response.content.find((b) => b.type === "tool_use" && b.name === SNIPPET_TOOL);
      input = tool && tool.type === "tool_use" ? tool.input : null;
    } catch (error) { out.notes.push(`Search title for ${c.url} not written: ${String(error).slice(0, 100)}`); }
    out.costMicroUsd += cost;
    if (input === null) continue;
    const checked = checkSnippet(input, page, c.query);
    if (!checked.ok) { out.notes.push(`Search title for ${c.url} not used: ${checked.reason}`); continue; }
    out.proposals.push({ pageId: page.pageId, url: page.url, query: c.query, before: { metaTitle: page.metaTitle, description: page.description },
      after: checked.snippet, baseline: { clicks: c.clicks, impressions: c.impressions, expectedClicks: c.expectedClicks, position: c.position, days: c.days },
      costMicroUsd: cost });
  }
  return out;
}

/** Every buyer question to every assistant through treg, six at a time, inside a time limit for the whole set (a question
 * still waiting at the limit is recorded as unasked, never guessed). Charged at treg's reported cost; a call whose answer
 * was lost is charged at its price bound (never assumed free), and a refused one costs nothing. A call that failed fast is
 * tried once more; one that timed out is not (ChatGPT's slow answers would take the run past its time). */
async function askAssistants(siteId: Id<"sites">, questions: readonly string[], business: Business, deadline: number, rivals: readonly RivalMatcher[] = []):
  Promise<{ checks: AiAnswerCheck[]; costMicroUsd: number }> {
  const token = process.env.TREG_TOKEN!;
  const jobs = questions.flatMap((question) => AI_ASSISTANTS.map((assistant) => ({ question, assistant })));
  const checks: AiAnswerCheck[] = [];
  let costMicroUsd = 0, next = 0;
  const market = countryCode(business.country);
  /** One call: its answer, or why there was none. */
  const call = async (question: string, assistant: AiAssistant): Promise<{ answer: { text: string; sources: string[] } | null; error?: string }> => {
    const endpoint = AI_ASSISTANT_ENDPOINTS[assistant];
    const body = assistant === "google_ai_mode" ? { prompt: question, gl: market } : { prompt: question, country: market };
    try {
      const response = await fetch(`https://treg.to/call/${endpoint}`, { method: "POST", signal: AbortSignal.timeout(Math.max(10_000, Math.min(AI_CALL_TIMEOUT_MS, deadline + 60_000 - Date.now()))),
        headers: { "X-Treg-Token": token, "X-Treg-Meta": `site=${siteId}, feature=site-diagnosis`, "X-Treg-Route-Max-Cost": String(AI_CALL_MAX_MICRO_USD / 1e6),
          "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const charged = Number(response.headers.get("X-Treg-Cost-Micro") ?? 0);
      costMicroUsd += Number.isSafeInteger(charged) && charged >= 0 ? charged : AI_CALL_MAX_MICRO_USD;
      if (!response.ok) return { answer: null, error: `HTTP ${response.status}` };
      const answer = parseAssistantAnswer(assistant, await response.json());
      return answer ? { answer } : { answer: null, error: "no answer" };
    } catch (error) {
      costMicroUsd += AI_CALL_MAX_MICRO_USD;
      return { answer: null, error: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "no response" };
    }
  };
  const ask = async (question: string, assistant: AiAssistant) => {
    let got = await call(question, assistant);
    if (!got.answer && got.error !== "timeout" && Date.now() < deadline) got = await call(question, assistant);
    checks.push(got.answer ? { question, assistant, answered: true, ...judgeAnswer(got.answer, business), sources: citedHosts(got.answer.sources, business),
      pages: got.answer.sources.filter((u) => /^https:\/\//i.test(u)).slice(0, 8).map((u) => u.slice(0, 500)), rivals: rivalsNamed(got.answer.text, rivals) }
      : { question, assistant, answered: false, named: false, cited: false, error: got.error ?? "no answer" });
  };
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (Date.now() >= deadline) { checks.push({ question: job.question, assistant: job.assistant, answered: false, named: false, cited: false, error: "not asked (time limit)" }); continue; }
      await ask(job.question, job.assistant);
    }
  }));
  return { checks, costMicroUsd };
}
const host = (domain: string) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

async function recordMerges(ctx: ActionCtx, site: Context, merges: readonly Merge[], gsc: readonly GscRow[]): Promise<Recorded> {
  const slugOf = new Map(site.published.map((p) => [normalize(p.url), slugKey(p.slug)]));
  const plan = merges.flatMap((m) => {
    const fromSlug = slugOf.get(normalize(m.from)), toSlug = slugOf.get(normalize(m.to));
    return fromSlug && toSlug ? [{ fromSlug, toSlug, evidence: `Google showed both for the same searches (${Math.round(Math.min(1, m.overlap) * 100)}% overlap, ` +
      `e.g. "${m.searches[0]}"); the kept page ranks at ${r1(m.toPosition)} there, the merged one at ${r1(m.fromPosition)}`,
      foldQuestions: foldQuestionsFor(gsc, m.from, m.to, site.domain) }] : [];
  });
  return plan.length ? await ctx.runMutation(internal.siteRedirects.recordMerges, { siteId: site.siteId, merges: plan }) : [];
}

/** Phase 3: the unshown articles to fold (convex/lib/duplicatePages.ts planUnshownMerges), recorded like any merge (its
 * own reason; the merged article's title is the section the kept article adds). Only Pentra's own live, indexable
 * articles; nothing already merged this run, and no chain (recordMerges checks both again). */
async function recordUnshownMerges(ctx: ActionCtx, site: Context, pages: readonly CrawledPage[], gsc: readonly GscRow[], merged: Recorded): Promise<Recorded> {
  const crawledAt = new Map(pages.map((p) => [normalize(p.url), p]));
  const mayFold = (url: string) => { const p = crawledAt.get(normalize(url)); return Boolean(p?.article && p.status === 200 && !p.noindex); };
  const taken = new Set(merged.flatMap((m) => [addressOf(site, m.fromSlug).url, addressOf(site, m.toSlug).url]));
  const plan = planUnshownMerges({ articles: site.published.filter((p) => !p.moved && !p.retired).map((p) => ({ url: p.url, title: p.title, publishedAt: p.publishedAt,
    winnable: p.winnable })), gsc, now: Date.now(), mayMerge: mayFold, taken });
  const slugOf = new Map(site.published.map((p) => [normalize(p.url), slugKey(p.slug)]));
  const rows = plan.flatMap((m) => {
    const fromSlug = slugOf.get(normalize(m.from)), toSlug = slugOf.get(normalize(m.to));
    return fromSlug && toSlug ? [{ fromSlug, toSlug, reason: "merged_unshown" as const, foldQuestions: [m.fromTitle.slice(0, 120)],
      evidence: m.toWinnable
        ? `Google showed it to nobody in 28 days (live ${m.ageDays} days); "${m.toTitle.slice(0, 120)}" on the same subject was written for a search the site can win`
        : `Google showed it to nobody in 28 days (live ${m.ageDays} days); "${m.toTitle.slice(0, 120)}" on the same subject was shown ${m.toImpressions} times` }] : [];
  });
  return rows.length ? await ctx.runMutation(internal.siteRedirects.recordMerges, { siteId: site.siteId, merges: rows }) : [];
}

/** Where an article lives: its published address when known, else built from the site's URL structure. `livePath` is the
 * published address's own path: WordPress and the hosted platforms decide their addresses themselves. */
function addressOf(site: Context, slug: string): { url: string; path: string; livePath: string } {
  const path = publishedArticleInternalHref(site.urlStructure, slug);
  const known = site.published.find((p) => slugKey(p.slug) === slug)?.url;
  let livePath = path;
  if (known) { try { livePath = new URL(known).pathname; } catch { /* the built path */ } }
  return { url: known ?? `https://${host(site.domain)}${path}`, path, livePath };
}

const bare = (path: string) => path.replace(/\/+$/, "") || "/";

/** Loads an address the way a reader would, following only the site's own tidying of it (its www or bare host, a
 * trailing slash): the answer there, with where it redirects and the page. */
async function reach(from: string): Promise<{ status: number; location: URL | null; text: string } | null> {
  let at = from;
  for (let hop = 0; hop < 3; hop++) {
    const answer = await safePublicRedirectStatus(at);
    if (answer.status < 300 || answer.status >= 400 || !answer.location) return { status: answer.status, location: null, text: answer.text };
    const next = new URL(answer.location, at), here = new URL(at);
    if (bare(next.pathname) === bare(here.pathname) && host(next.host) === host(here.host) && next.href !== here.href) { at = next.toString(); continue; }
    return { status: answer.status, location: next, text: "" };
  }
  return null;
}

/** Whether an old address now answers with a permanent redirect to the page it was merged into. */
async function redirectsTo(from: string, toPath: string): Promise<boolean> {
  try {
    const answer = await reach(from);
    return Boolean(answer?.location && (answer.status === 301 || answer.status === 308) && bare(answer.location.pathname) === bare(toPath));
  } catch { return false; }
}

/** Whether a redirect reaches readers, as it was delivered: a permanent redirect, or a page that forwards on load to the
 * kept article and names it as canonical (Ghost). */
async function forwards(site: Context, row: { fromSlug: string; toSlug: string; mechanism?: string | null }): Promise<boolean> {
  const from = addressOf(site, row.fromSlug), to = addressOf(site, row.toSlug);
  if (row.mechanism !== "page_refresh") return redirectsTo(from.url, to.livePath);
  try {
    const answer = await reach(from.url);
    return Boolean(answer && answer.status === 200 && pageForwardsTo(answer.text, to.url));
  } catch { return false; }
}

type Row = { id: Id<"site_redirects">; fromSlug: string; toSlug: string; delivery?: string };
type Mark = { id: Id<"site_redirects">; delivery: "pentra_blog" | "repository" | "platform" | "owner" | "not_delivered"; note?: string;
  mechanism?: "redirect" | "page_refresh"; commitSha?: string; verified?: boolean };
/** Delivered by Pentra and checked by loading the old address. */
const DELIVERED = new Set(["pentra_blog", "repository", "platform"]);

/** Every redirect still waiting to reach readers goes out where the site's pages are served:
 *   - a blog Pentra renders itself: its route serves the redirect as soon as it's recorded (the stored listing and
 *     sitemap are refreshed so the merged page leaves them at once); Pentra's own repository is never written;
 *   - a GitHub site: the redirect file its host reads (vercel.json, netlify.toml, Cloudflare Pages' _redirects);
 *   - WordPress (Pentra's plugin), Shopify, Webflow, Ghost and webhook sites: through that connection;
 *   - anything Pentra can't deliver: one exact step for the owner, tried again every week, and recorded as the owner's
 *     once the old address forwards.
 * Each delivery is checked by loading the old address after the site has had time to take it. */
async function deliverRedirects(ctx: ActionCtx, site: Context): Promise<string[]> {
  const siteId = site.siteId;
  const pending: Row[] = await ctx.runQuery(internal.siteRedirects.pendingDelivery, { siteId });
  if (!pending.length) {
    // Nothing new: any redirect delivered earlier but not yet seen live is checked again now.
    const unchecked = (await ctx.runQuery(internal.siteRedirects.activeInternal, { siteId })).filter((r) => DELIVERED.has(r.delivery) && !r.verifiedAt);
    if (unchecked.length) await ctx.scheduler.runAfter(0, internal.actions.siteDiagnosis.verifyRedirects, { siteId, attempt: 2 });
    return unchecked.length ? [`${unchecked.length} delivered redirects not yet seen live: checked again`] : [];
  }
  const from = (slug: string) => addressOf(site, slug);
  if (HOSTED_BLOG_DOMAINS.includes(host(site.domain))) {
    await ctx.runMutation(internal.blog.refreshHostedBlogListings, { domains: [site.domain] });
    const rows = [];
    for (const r of pending) rows.push({ id: r.id, delivery: "pentra_blog" as const, mechanism: "redirect" as const, verified: await redirectsTo(from(r.fromSlug).url, from(r.toSlug).path) });
    await ctx.runMutation(internal.siteRedirects.markDelivery, { siteId, rows });
    const live = rows.filter((r) => r.verified).length;
    return [`${live} of ${rows.length} redirects checked live on Pentra's blog`];
  }
  const marks: Mark[] = [], todo: Row[] = [];
  // One Pentra couldn't deliver before may have been added by the owner since: recorded as theirs, never written again.
  for (const r of pending) {
    if (r.delivery === "not_delivered" && await redirectsTo(from(r.fromSlug).url, from(r.toSlug).livePath)) marks.push({ id: r.id, delivery: "owner", mechanism: "redirect", verified: true });
    else todo.push(r);
  }
  if (todo.length) {
    try { marks.push(...await deliverToSite(ctx, site, todo)); }
    catch (error) {
      // No clear answer (the platform down, a lost response): nothing is assumed; the next run reads the site first.
      const reason = error instanceof Error ? error.message.slice(0, 120) : "no answer";
      marks.push(...todo.map((r) => ({ id: r.id, delivery: "not_delivered" as const, note: `Pentra couldn't reach the site's platform (${reason}); it tries again next week` })));
    }
  }
  await ctx.runMutation(internal.siteRedirects.markDelivery, { siteId, rows: marks });
  const sent = marks.filter((m) => m.delivery === "repository" || m.delivery === "platform").length;
  // Checked once the site has taken them (a build, a cache); earlier ones not yet seen live are checked with them.
  const unchecked = (await ctx.runQuery(internal.siteRedirects.activeInternal, { siteId })).filter((r) => DELIVERED.has(r.delivery) && !r.verifiedAt).length;
  if (unchecked) await ctx.scheduler.runAfter(sent ? VERIFY_AFTER_MS : 0, internal.actions.siteDiagnosis.verifyRedirects, { siteId, attempt: sent ? 1 : 2 });
  const owner = marks.filter((m) => m.delivery === "owner").length, waiting = marks.filter((m) => m.delivery === "not_delivered");
  return [`${sent} of ${marks.length} redirects delivered (${site.publishMethod ?? "no platform"})${owner ? `, ${owner} added by the owner` : ""}` +
    `${waiting.length ? `, ${waiting.length} need the owner: ${waiting[0].note}` : ""}`];
}

/** Hosted-platform requests: the pinned public-HTTPS client, no redirects, JSON only (as publishing uses). */
const cmsRequest: CmsRequest = async (url, init) => {
  const target = new URL(url);
  const response = await safeRequestPublicHttps(target.href, { method: init.method, expectedHost: target.hostname, headers: init.headers,
    body: init.body, maxBytes: 2_000_000, allowedContentTypes: [/^application\/json(?:;|$)/i] });
  return { status: response.status, text: response.text };
};

async function deliverToSite(ctx: ActionCtx, site: Context, rows: Row[]): Promise<Mark[]> {
  const from = (slug: string) => addressOf(site, slug);
  const byHand = (r: Row, why: string): Mark => ({ id: r.id, delivery: "not_delivered",
    note: `${why}: add a permanent redirect from ${from(r.fromSlug).livePath} to ${from(r.toSlug).livePath}` });
  const method = site.publishMethod;
  if (method === "github") return site.repository ? deliverToRepository(ctx, site, rows) : rows.map((r) => byHand(r, "GitHub isn't connected"));
  if (method !== "wordpress" && method !== "shopify" && method !== "webflow" && method !== "ghost" && method !== "webhook") {
    return rows.map((r) => byHand(r, "Pentra doesn't publish to this site directly"));
  }
  const full = await ctx.runQuery(internal.sites.getFull, { siteId: site.siteId });
  if (!full) return rows.map((r) => byHand(r, "The site's connection isn't active"));
  if (method === "wordpress") {
    const answer = await wordpressRedirects(full, rows.map((r) => ({ from: from(r.fromSlug).livePath, to: from(r.toSlug).livePath })));
    if (!answer.ok) return rows.map((r) => ({ id: r.id, delivery: "not_delivered" as const, note: answer.reason }));
    return rows.map((r) => answer.added.has(wordpressRedirectKey(from(r.fromSlug).livePath))
      ? { id: r.id, delivery: "platform" as const, mechanism: "redirect" as const }
      : byHand(r, "WordPress turned the redirect away (the old article isn't one Pentra published there, or the kept one isn't published)"));
  }
  if (method === "webhook") {
    if (!full.webhookUrl || !full.webhookSecret) return rows.map((r) => byHand(r, "The webhook isn't set up"));
    const secret = full.webhookSecret;
    const event = webhookRedirectEvent(rows.map((r) => ({ source: from(r.fromSlug).livePath, destination: from(r.toSlug).livePath })), host(site.domain),
      Math.floor(Date.now() / 1000), (input) => createHmac("sha256", secret).update(input).digest("hex"));
    const endpoint = await validatePublicHttpsUrl(full.webhookUrl);
    const response = await safeRequestPublicHttps(endpoint.href, { method: "POST", expectedHost: endpoint.hostname, headers: event.headers, body: event.body,
      allowedContentTypes: [/^application\/json(?:;|$)/i, /^text\/plain(?:;|$)/i, /^$/] });
    if (response.status < 200 || response.status >= 300) return rows.map((r) => byHand(r, `Your webhook answered HTTP ${response.status} to the redirect event (pentra.redirect.create.v1)`));
    return rows.map((r) => ({ id: r.id, delivery: "platform" as const, mechanism: "redirect" as const }));
  }
  const active: Array<{ fromSlug: string }> = await ctx.runQuery(internal.siteRedirects.activeInternal, { siteId: site.siteId });
  const mergedPaths = new Set(active.map((r) => bare(from(r.fromSlug).livePath)));
  const outcomes = await redirectOnCms(full as unknown as CmsSite, rows.map((r) => ({ source: from(r.fromSlug).livePath, destination: from(r.toSlug).livePath,
    destinationUrl: from(r.toSlug).url })), mergedPaths, cmsRequest);
  return rows.map((r) => {
    const outcome = outcomes.find((o) => o.source === from(r.fromSlug).livePath);
    if (!outcome) return byHand(r, "The platform gave no answer for this address");
    return outcome.ok ? { id: r.id, delivery: "platform" as const, mechanism: outcome.mechanism, ...(outcome.note ? { note: outcome.note } : {}) }
      : { id: r.id, delivery: "not_delivered" as const, note: outcome.reason };
  });
}

/** A GitHub site: the redirects go in the file its host reads, found by loading the site: vercel.json on Vercel,
 * netlify.toml on Netlify (forced, so it wins over the old article's page), _redirects in the static folder on Cloudflare
 * Pages (its rules apply even where a page exists). GitHub Pages can't send redirects at all. */
async function deliverToRepository(ctx: ActionCtx, site: Context, rows: Row[]): Promise<Mark[]> {
  const from = (slug: string) => addressOf(site, slug);
  const byHand = (r: Row, why: string): Mark => ({ id: r.id, delivery: "not_delivered",
    note: `${why}: add a permanent redirect from ${from(r.fromSlug).path} to ${from(r.toSlug).path}` });
  const probe = await safePublicRedirectStatus(from(rows[0].fromSlug).url).catch(() => null);
  if (!probe) return rows.map((r) => ({ id: r.id, delivery: "not_delivered" as const, note: "The site didn't answer; Pentra tries again next week" }));
  const entries: RedirectEntry[] = rows.map((r) => ({ source: from(r.fromSlug).path, destination: from(r.toSlug).path }));
  const file = probe.host === "vercel" ? { candidates: ["vercel.json"], edit: (current: string | null) => editVercelRedirects(current, entries) }
    : probe.host === "netlify" ? { candidates: ["netlify.toml"], edit: (current: string | null) => ({ ok: true as const, ...editNetlifyToml(current, entries) }) }
    : probe.host === "cloudflare" ? { candidates: ["public/_redirects", "static/_redirects", "_redirects"], staticFolder: true,
      edit: (current: string | null) => ({ ok: true as const, ...editRedirectsFile(current, entries) }) }
    : null;
  if (!file) return rows.map((r) => byHand(r, probe.host === "github_pages" ? "GitHub Pages can't send permanent redirects; add it where your domain is served"
    : "The site's host isn't one whose redirect file Pentra writes (Vercel, Netlify, Cloudflare Pages)"));
  const commit = await commitRedirectFile(ctx, site.siteId, file, entries);
  if (!commit.ok) return rows.map((r) => byHand(r, commit.reason));
  return rows.map((r) => ({ id: r.id, delivery: "repository" as const, mechanism: "redirect" as const, ...(commit.sha ? { commitSha: commit.sha } : {}) }));
}

type FileEditResult = { ok: false; reason: string } | { ok: true; changed: boolean; text?: string; skipped: string[] };

/** One commit of the redirect file with Pentra's entries added (convex/lib/vercelRedirects.ts, platformRedirects.ts). The
 * file is read at the branch head and written with its sha, so a change made meanwhile is never overwritten; a write whose
 * outcome is unknown is reconciled next time by reading the file again (entries already there are not written twice). A
 * new _redirects file goes in the site's static folder (public/ or static/), which every build copies to the output. */
async function commitRedirectFile(ctx: ActionCtx, siteId: Id<"sites">, file: { candidates: string[]; staticFolder?: boolean;
  edit: (current: string | null) => FileEditResult }, entries: RedirectEntry[]): Promise<{ ok: true; sha: string | null; path: string } | { ok: false; reason: string }> {
  const site = await ctx.runQuery(internal.sites.getFull, { siteId });
  if (!site?.githubToken || !site.repoOwner || !site.repoName) return { ok: false, reason: "GitHub isn't connected" };
  const branch = site.repoDefaultBranch || "main";
  const api = `https://api.github.com/repos/${encodeURIComponent(site.repoOwner)}/${encodeURIComponent(site.repoName)}/contents/`;
  const headers = { Authorization: `Bearer ${site.githubToken}`, Accept: "application/vnd.github+json", "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28" };
  const read = (path: string) => fetch(`${api}${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, { headers });
  let path = file.candidates[file.candidates.length - 1], current: string | null = null, sha: string | undefined;
  for (const candidate of file.candidates) {
    const response = await read(candidate);
    if (response.status === 404) continue;
    if (response.status !== 200) return { ok: false, reason: `GitHub answered HTTP ${response.status} reading ${candidate}` };
    const found = await response.json() as { type?: string; content?: string; sha?: string };
    if (found.type !== "file" || typeof found.content !== "string" || typeof found.sha !== "string") return { ok: false, reason: `${candidate} isn't a file Pentra can read` };
    path = candidate; current = Buffer.from(found.content, "base64").toString("utf8"); sha = found.sha;
    break;
  }
  if (current === null && file.staticFolder) {
    for (const folder of ["public", "static"]) {
      const listing = await read(folder);
      if (listing.status === 200 && Array.isArray(await listing.json())) { path = `${folder}/_redirects`; break; }
    }
  }
  const edit = file.edit(current);
  if (!edit.ok) return { ok: false, reason: edit.reason };
  if (!edit.changed || edit.text === undefined) return { ok: true, sha: null, path };
  const message = `Pentra: permanent redirects for merged duplicate articles\n\n${entries.map((e) => `${e.source} -> ${e.destination}`).join("\n")}\n`;
  const write = await fetch(`${api}${path.split("/").map(encodeURIComponent).join("/")}`, { method: "PUT", headers,
    body: JSON.stringify({ message, content: Buffer.from(edit.text, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }) });
  if (!write.ok) return { ok: false, reason: `GitHub refused the ${path} commit (HTTP ${write.status})` };
  const written = await write.json() as { commit?: { sha?: string } };
  return { ok: true, sha: written.commit?.sha ?? null, path };
}

/** After the site has taken them: each delivered redirect not yet seen live is checked by loading the old address. One
 * retry later if a build was slow; one still not live is recorded, and the weekly run checks it again. */
export const verifyRedirects = internalAction({ args: { siteId: v.id("sites"), attempt: v.number() },
  handler: async (ctx, { siteId, attempt }): Promise<{ checked: number; live: number }> => {
  const site = await loadContext(ctx, siteId);
  if (!site) return { checked: 0, live: 0 };
  const active: Array<{ id: Id<"site_redirects">; fromSlug: string; toSlug: string; delivery: string; mechanism: string | null; verifiedAt: number | null }> =
    await ctx.runQuery(internal.siteRedirects.activeInternal, { siteId });
  const rows = active.filter((r) => DELIVERED.has(r.delivery) && !r.verifiedAt);
  const marks = [];
  for (const r of rows) marks.push({ id: r.id, delivery: r.delivery as "repository" | "pentra_blog" | "platform", verified: await forwards(site, r) });
  if (marks.length) await ctx.runMutation(internal.siteRedirects.markDelivery, { siteId, rows: marks });
  if (marks.some((m) => !m.verified) && attempt < 2) await ctx.scheduler.runAfter(VERIFY_RETRY_MS, internal.actions.siteDiagnosis.verifyRedirects, { siteId, attempt: attempt + 1 });
  return { checked: marks.length, live: marks.filter((m) => m.verified).length };
} });

/** Read-only check for the operator: loads each redirect's old address now and says whether it forwards as delivered.
 * Nothing is written. */
export const recheckRedirects = internalAction({ args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }): Promise<Array<{ from: string; to: string; delivery: string; forwards: boolean }>> => {
  const site = await loadContext(ctx, siteId);
  if (!site) return [];
  const active: Array<{ fromSlug: string; toSlug: string; delivery: string; mechanism: string | null }> =
    await ctx.runQuery(internal.siteRedirects.activeInternal, { siteId });
  const checks = [];
  for (const r of active.slice(0, 20)) checks.push({ from: addressOf(site, r.fromSlug).url, to: addressOf(site, r.toSlug).livePath, delivery: r.delivery, forwards: await forwards(site, r) });
  return checks;
} });
