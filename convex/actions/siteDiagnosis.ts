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
import { analyzeSERPFromDataForSEO, getDomainAuthorities, meterDataForSeoCost } from "./seoData";
import { dataForSeoLocationCode } from "../lib/dataForSeoLocale";
import { crawlPages, pageSpeedCheck, readSitemap } from "../lib/pageCrawl";
import { diagnoseSite, normalize, type CrawledPage, type GscRow, type PageOneCheck, type QueryIntent, type SpeedCheck } from "../lib/siteDiagnosis";
import { foldQuestionsFor, slugKey, type Merge } from "../lib/duplicatePages";
import { AI_ASSISTANT_ENDPOINTS, AI_ASSISTANTS, AI_QUESTIONS_MAX_TOKENS, AI_QUESTIONS_MODEL, AI_QUESTIONS_TOOL, aiAnswerTotals, aiQuestionsRequest,
  judgeAnswer, parseAiQuestions, parseAssistantAnswer, type AiAnswerCheck, type AiAssistant, type Business } from "../lib/aiAnswers";
import { parseSearchIntents, searchIntentRequest, SEARCH_INTENT_MAX_TOKENS, SEARCH_INTENT_MODEL, SEARCH_INTENT_TOOL } from "../lib/searchIntent";
import { buyerFitCostMicroUsd } from "../lib/topicFit";
import { structuredToolChoice } from "../lib/toolChoice";
import { isBrandedSearchQuery } from "../lib/searchPerformance";
import { safePublicRedirectStatus } from "../lib/safeOutbound";
import { HOSTED_BLOG_DOMAINS } from "../lib/blogListing";
import { publishedArticleInternalHref } from "../lib/internalLinks";
import { editVercelRedirects, type RedirectEntry } from "../lib/vercelRedirects";

const MAX_PAGES = 200, PAGE_ONE_QUERIES = 5, INTENT_MIN_IMPRESSIONS = 5;
/** Each AI-assistant question's price bound on treg, about three times its price (ChatGPT $0.0032, Gemini $0.0024, Google
 * AI Mode $0.00015); a call whose answer was lost is charged at it. 15 calls at the bound fit the run's $0.25 hold. */
const AI_CALL_MAX_MICRO_USD = 10_000;
/** Vercel builds a commit in a minute or two; the redirects are checked after this, and once more later if not live yet. */
const VERIFY_AFTER_MS = 6 * 60_000, VERIFY_RETRY_MS = 30 * 60_000;

type Context = NonNullable<FunctionReturnType<typeof internal.siteDiagnosis.context>>;
type Recorded = Array<{ id: Id<"site_redirects">; fromSlug: string; toSlug: string }>;
type RunResult = { skipped: string } | { siteType: string; factors: Record<string, string>; findings: number; merges: Recorded;
  costMicroUsd: number; notes: string[] };
const loadContext = (ctx: ActionCtx, siteId: Id<"sites">): Promise<Context | null> => ctx.runQuery(internal.siteDiagnosis.context, { siteId });

export const runInternal = internalAction({ args: { siteId: v.id("sites"), force: v.optional(v.boolean()) },
  handler: async (ctx, { siteId, force }): Promise<RunResult> => runDiagnosis(ctx, siteId, Boolean(force)) });

async function runDiagnosis(ctx: ActionCtx, siteId: Id<"sites">, force: boolean): Promise<RunResult> {
  const site = await loadContext(ctx, siteId);
  if (!site) return { skipped: "site not active" };
  if (!force && site.lastRunAt && Date.now() - site.lastRunAt < 6 * 24 * 3600 * 1000) return { skipped: "diagnosed this week" };
  const notes: string[] = [];

  // Search Console: the last 28 days, when connected.
  let gsc: GscRow[] = [];
  if (site.searchConsole) {
    const read = await ctx.runQuery(internal.siteDiagnosis.gscRows, { siteId });
    gsc = read.rows;
    if (read.capped) notes.push(`Search Console read capped at ${gsc.length} rows`);
  }

  // The pages: every published article, every address Search Console shows (old addresses included), every address the
  // sitemap lists, then where each redirect lands (for its title).
  const sitemap = await readSitemap(site.domain).catch(() => null);
  const shown = new Map<string, number>();
  for (const r of gsc) if (r.page) shown.set(r.page, (shown.get(r.page) ?? 0) + r.impressions);
  const seeds = [...new Set([...site.published.map((p) => p.url), ...[...shown].sort((a, b) => b[1] - a[1]).map(([url]) => url), ...(sitemap?.urls ?? [])])]
    .slice(0, MAX_PAGES);
  // Google's mobile speed test, beside the crawl: the home page and the two articles Google shows most (all articles
  // share their template).
  const articleUrls = new Set(site.published.map((p) => normalize(p.url)));
  const speedPages = [`https://${site.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}/`,
    ...[...shown].filter(([url]) => articleUrls.has(normalize(url))).sort((a, b) => b[1] - a[1]).map(([url]) => url), ...site.published.map((p) => p.url)]
    .filter((url, i, all) => all.findIndex((u) => normalize(u) === normalize(url)) === i).slice(0, 3);
  const [crawled, speedChecks] = await Promise.all([crawlPages(seeds),
    Promise.all(speedPages.map((url) => pageSpeedCheck(url))).then((checks) => checks.filter((c): c is SpeedCheck => c !== null))]);
  const targets = [...crawled.values()].flatMap((p) => (p.location && !crawled.has(normalize(p.location)) ? [p.location] : []));
  for (const [key, page] of await crawlPages([...new Set(targets)].slice(0, 40))) crawled.set(key, page);
  const byUrl = new Map(site.published.map((p) => [normalize(p.url), p]));
  const removed = new Set(site.removed.map(normalize));
  let pages: CrawledPage[] = [...crawled.values()].map((p) => {
    const article = byUrl.get(normalize(p.url));
    if (removed.has(normalize(p.url))) return { ...p, removed: true };
    return article ? { ...p, article: true, indexVerdict: article.indexVerdict, coverageState: article.coverageState, publishedAt: article.publishedAt } : p;
  });
  const crawlComplete = site.published.length < 300 && site.published.every((p) => crawled.has(normalize(p.url)));

  // Paid checks, under one hold: who the readers are, and how strong page one is.
  const totals = new Map<string, number>();
  for (const r of gsc) if (!isBrandedSearchQuery(r.query, site.domain)) totals.set(r.query, (totals.get(r.query) ?? 0) + r.impressions);
  const topQueries = [...totals].filter(([, n]) => n >= INTENT_MIN_IMPRESSIONS).sort((a, b) => b[1] - a[1]).map(([q]) => q);
  let intents: QueryIntent[] = [], pageOne: PageOneCheck[] = [], authority = site.authority ? { domainRank: site.authority.domainRank,
    referringDomains: site.authority.referringDomains } : null;
  let costMicroUsd = 0;
  const staleAuthority = !site.authority || !site.authority.measuredAt || Date.now() - site.authority.measuredAt > 30 * 24 * 3600 * 1000;
  let aiQuestions: string[] = [], aiChecks: AiAnswerCheck[] = [];
  const business: Business = { name: site.business.name, domain: site.domain, summary: site.business.summary ?? undefined,
    audience: site.business.audience ?? undefined, features: site.business.features ?? undefined, problems: site.business.problems ?? undefined,
    country: site.targetCountry };
  if (topQueries.length || staleAuthority || process.env.TREG_TOKEN) {
    const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
    const hold = await ctx.runMutation(internal.siteDiagnosis.reserve, { siteId, trigger: `site_diagnosis:${week}${force ? `:forced:${Date.now()}` : ""}` });
    if (!hold.ok) notes.push(`Paid checks skipped: provider budget (${hold.reason})`);
    else {
      let modelMicroUsd = 0, providerUsd = 0, uncertain = false;
      // Who types the top searches, judged against what the business sells.
      if (topQueries.length && process.env.ANTHROPIC_API_KEY) {
        try {
          const request = searchIntentRequest(site.business, topQueries);
          const response = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000, fetch }).messages.create({
            model: SEARCH_INTENT_MODEL, max_tokens: SEARCH_INTENT_MAX_TOKENS, system: request.system, messages: [{ role: "user", content: request.userMessage }],
            tools: [{ name: SEARCH_INTENT_TOOL, description: "Record who types each search.", input_schema: request.inputSchema, strict: true }],
            tool_choice: structuredToolChoice(SEARCH_INTENT_MODEL, SEARCH_INTENT_TOOL) });
          modelMicroUsd += buyerFitCostMicroUsd(response.usage);
          const tool = response.content.find((b) => b.type === "tool_use" && b.name === SEARCH_INTENT_TOOL);
          intents = parseSearchIntents(request.queries, tool && tool.type === "tool_use" ? tool.input : null);
        } catch (error) { notes.push(`Readers not judged: ${String(error).slice(0, 120)}`); }
      }
      // Page one for the main searches: the live results, then every ranking site's authority (and the site's own, when stale).
      try {
        const metered = await meterDataForSeoCost(async () => {
          const location = dataForSeoLocationCode(site.targetCountry ?? undefined);
          const serps: { query: string; domains: string[] }[] = [];
          for (const query of topQueries.slice(0, PAGE_ONE_QUERIES)) {
            try {
              const serp = await analyzeSERPFromDataForSEO(query, location);
              const domains = serp.results.filter((r) => r.type === undefined || r.type === "organic").slice(0, 10)
                .map((r) => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } })
                .filter((d) => d && !d.endsWith(site.domain.replace(/^www\./, "")));
              serps.push({ query, domains });
            } catch { /* that search stays unmeasured */ }
          }
          const wanted = [...new Set([...serps.flatMap((s) => s.domains), ...(staleAuthority ? [site.domain] : [])])].slice(0, 50);
          const ranks = wanted.length ? await getDomainAuthorities(wanted, { maxDomains: 50 }) : [];
          return { serps, ranks };
        });
        providerUsd = metered.usd; uncertain = metered.uncertain;
        const rankOf = new Map(metered.result.ranks.map((r) => [r.domain.replace(/^www\./, ""), r.domainRank]));
        const own = rankOf.get(site.domain.replace(/^www\./, ""));
        if (staleAuthority && typeof own === "number") {
          const evidence = metered.result.ranks.find((r) => r.domain.replace(/^www\./, "") === site.domain.replace(/^www\./, ""));
          authority = { domainRank: own, referringDomains: evidence?.referringDomains };
        }
        const siteRank = authority?.domainRank ?? null;
        pageOne = metered.result.serps.map((s) => {
          const known = s.domains.map((d) => rankOf.get(d)).filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
          return { query: s.query, medianRank: known.length ? known[Math.floor(known.length / 2)] : null, results: s.domains.length,
            reachable: siteRank === null ? undefined : known.filter((n) => n <= siteRank + 10).length,
            domains: s.domains.map((domain) => ({ domain, rank: rankOf.get(domain) ?? null })) };
        });
      } catch (error) { notes.push(`Page one not measured: ${String(error).slice(0, 120)}`); }
      // AI answers: the buyer questions (written once, then the same every week) put to ChatGPT, Gemini and Google AI Mode.
      let tregMicroUsd = 0;
      if (process.env.TREG_TOKEN) {
        try {
          aiQuestions = site.aiQuestions;
          if (!aiQuestions.length && process.env.ANTHROPIC_API_KEY) {
            const buyers = intents.filter((i) => i.label === "buyer").map((i) => i.query);
            const request = aiQuestionsRequest(business, buyers.length ? buyers : topQueries.slice(0, 10));
            const response = await new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000, fetch }).messages.create({
              model: AI_QUESTIONS_MODEL, max_tokens: AI_QUESTIONS_MAX_TOKENS, system: request.system, messages: [{ role: "user", content: request.userMessage }],
              tools: [{ name: AI_QUESTIONS_TOOL, description: "Record the buyer questions.", input_schema: request.inputSchema, strict: true }],
              tool_choice: structuredToolChoice(AI_QUESTIONS_MODEL, AI_QUESTIONS_TOOL) });
            modelMicroUsd += buyerFitCostMicroUsd(response.usage);
            const tool = response.content.find((b) => b.type === "tool_use" && b.name === AI_QUESTIONS_TOOL);
            aiQuestions = parseAiQuestions(tool && tool.type === "tool_use" ? tool.input : null, business);
          }
          const asked = await askAssistants(siteId, aiQuestions, business);
          aiChecks = asked.checks; tregMicroUsd = asked.costMicroUsd;
          if (aiQuestions.length && !aiChecks.some((c) => c.answered)) notes.push("AI answers not measured: no assistant answered");
        } catch (error) { notes.push(`AI answers not measured: ${String(error).slice(0, 120)}`); }
      }
      costMicroUsd = Math.ceil(providerUsd * 1e6) + modelMicroUsd + tregMicroUsd;
      if (!uncertain) await ctx.runMutation(internal.siteDiagnosis.close, { siteId, reservationId: hold.reservationId, sent: costMicroUsd > 0, actualMicroUsd: costMicroUsd });
      else notes.push("A provider charge is uncertain: the hold is kept");
    }
  }

  const inputs = { domain: site.domain, gsc, authority, pageOne, crawlComplete, sitemap, intents, speed: speedChecks, now: Date.now(),
    aiAnswers: aiChecks.some((c) => c.answered) ? aiAnswerTotals(aiChecks) : null };
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

  await ctx.runMutation(internal.siteDiagnosis.record, { siteId, diagnosis: {
    siteType: d.siteType, ...(d.window ? { window: d.window } : {}), totals: d.totals, factors: d.factors,
    findings: d.findings.map((f) => ({ ...f, ...(f.items ? { items: f.items.slice(0, 8) } : {}) })), pageActions: d.pageActions.slice(0, 150),
    summary: d.summary, inputs: { searchConsole: gsc.length > 0, crawledPages: pages.length, intents: intents.length, pageOneChecked: pageOne.length,
      authorityMeasured: Boolean(authority) }, costMicroUsd, ...(notes.length ? { notes: notes.map((n) => n.slice(0, 500)) } : {}),
    ...(pageOne.length ? { pageOne: pageOne.map((c) => ({ ...c, domains: c.domains?.slice(0, 10) })) } : {}),
    ...(speedChecks.length ? { speed: speedChecks } : {}),
    ...(aiQuestions.length ? { aiAnswers: { questions: aiQuestions, checks: aiChecks } } : {}) } });
  return { siteType: d.siteType, factors: d.factors, findings: d.findings.length, merges: merged, costMicroUsd, notes };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Every buyer question to every assistant through treg, a few at a time. Charged at treg's reported cost; a call whose
 * answer was lost is charged at its price bound (never assumed free), and a refused one costs nothing. */
async function askAssistants(siteId: Id<"sites">, questions: readonly string[], business: Business): Promise<{ checks: AiAnswerCheck[]; costMicroUsd: number }> {
  const token = process.env.TREG_TOKEN!;
  const jobs = questions.flatMap((question) => AI_ASSISTANTS.map((assistant) => ({ question, assistant })));
  const checks: AiAnswerCheck[] = [];
  let costMicroUsd = 0, next = 0;
  const ask = async (question: string, assistant: AiAssistant) => {
    const endpoint = AI_ASSISTANT_ENDPOINTS[assistant];
    const headers: Record<string, string> = { "X-Treg-Token": token, "X-Treg-Meta": `site=${siteId}, feature=site-diagnosis`,
      "X-Treg-Route-Max-Cost": String(AI_CALL_MAX_MICRO_USD / 1e6) };
    try {
      const response = assistant === "google_ai_mode"
        ? await fetch(`https://treg.to/call/${endpoint}?${new URLSearchParams({ q: question, deep: "0" })}`, { headers, signal: AbortSignal.timeout(120_000) })
        : await fetch(`https://treg.to/call/${endpoint}`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(assistant === "gemini" ? { prompt: question, country: (business.country ?? "US").slice(0, 2).toUpperCase() } : { prompt: question }),
          signal: AbortSignal.timeout(120_000) });
      const charged = Number(response.headers.get("X-Treg-Cost-Micro") ?? 0);
      costMicroUsd += Number.isSafeInteger(charged) && charged >= 0 ? charged : AI_CALL_MAX_MICRO_USD;
      const answer = response.ok ? parseAssistantAnswer(assistant, await response.json()) : null;
      checks.push(answer ? { question, assistant, answered: true, ...judgeAnswer(answer, business) } : { question, assistant, answered: false, named: false, cited: false });
    } catch {
      costMicroUsd += AI_CALL_MAX_MICRO_USD;
      checks.push({ question, assistant, answered: false, named: false, cited: false });
    }
  };
  await Promise.all(Array.from({ length: 5 }, async () => { while (next < jobs.length) { const job = jobs[next++]; await ask(job.question, job.assistant); } }));
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

/** Where an article lives: its published address when known, else built from the site's URL structure. */
function addressOf(site: Context, slug: string): { url: string; path: string } {
  const path = publishedArticleInternalHref(site.urlStructure, slug);
  const known = site.published.find((p) => slugKey(p.slug) === slug)?.url;
  return { url: known ?? `https://${host(site.domain)}${path}`, path };
}

/** Whether an old address now answers with a permanent redirect to the page it was merged into. A site that moves every
 * address to its www (or bare) host first is followed one step on that host change only. */
async function redirectsTo(from: string, toPath: string): Promise<boolean> {
  try {
    let at = from;
    for (let hop = 0; hop < 2; hop++) {
      const answer = await safePublicRedirectStatus(at);
      if (answer.status < 300 || answer.status >= 400 || !answer.location) return false;
      const next = new URL(answer.location, at), here = new URL(at);
      if (next.pathname === here.pathname && host(next.host) === host(here.host) && next.host !== here.host) { at = next.toString(); continue; }
      return (answer.status === 301 || answer.status === 308) && next.pathname.replace(/\/+$/, "") === toPath.replace(/\/+$/, "");
    }
    return false;
  } catch { return false; }
}

/** Every redirect still waiting to reach readers goes out where the site's pages are served:
 *   - a blog Pentra renders itself: its route serves the redirect as soon as it's recorded (the stored listing and
 *     sitemap are refreshed so the merged page leaves them at once);
 *   - a site that renders its own pages from GitHub on Vercel: one commit of its vercel.json, checked after the build;
 *   - anything else: recorded as an action for the owner until Pentra can deliver there.
 * Pentra's own repository is never written: its blog is served by its own route. */
async function deliverRedirects(ctx: ActionCtx, site: Context): Promise<string[]> {
  const pending: Array<{ id: Id<"site_redirects">; fromSlug: string; toSlug: string }> =
    await ctx.runQuery(internal.siteRedirects.pendingDelivery, { siteId: site.siteId });
  if (!pending.length) {
    // Nothing new: any redirect delivered earlier but not yet seen live is checked again now.
    const unchecked = (await ctx.runQuery(internal.siteRedirects.activeInternal, { siteId: site.siteId }))
      .filter((r) => (r.delivery === "repository" || r.delivery === "pentra_blog") && !r.verifiedAt);
    if (unchecked.length) await ctx.scheduler.runAfter(0, internal.actions.siteDiagnosis.verifyRedirects, { siteId: site.siteId, attempt: 2 });
    return unchecked.length ? [`${unchecked.length} delivered redirects not yet seen live: checked again`] : [];
  }
  const siteId = site.siteId;
  const from = (slug: string) => addressOf(site, slug);
  if (HOSTED_BLOG_DOMAINS.includes(host(site.domain))) {
    await ctx.runMutation(internal.blog.refreshHostedBlogListings, { domains: [site.domain] });
    const rows = [];
    for (const r of pending) rows.push({ id: r.id, delivery: "pentra_blog" as const, verified: await redirectsTo(from(r.fromSlug).url, from(r.toSlug).path) });
    await ctx.runMutation(internal.siteRedirects.markDelivery, { siteId, rows });
    const live = rows.filter((r) => r.verified).length;
    return [`${live} of ${rows.length} redirects checked live on Pentra's blog`];
  }
  if (site.publishMethod === "github" && site.repository) {
    const probe = await safePublicRedirectStatus(from(pending[0].fromSlug).url).catch(() => null);
    if (!probe) return ["Redirects wait: the site didn't answer; retried next week"];
    if (!probe.vercel) {
      await ctx.runMutation(internal.siteRedirects.markDelivery, { siteId, rows: pending.map((r) => ({ id: r.id, delivery: "not_delivered" as const,
        note: `This site isn't served by Vercel: add a permanent redirect from ${from(r.fromSlug).path} to ${from(r.toSlug).path}` })) });
      return [`${pending.length} redirects need the owner: the site isn't served by Vercel`];
    }
    const entries: RedirectEntry[] = pending.map((r) => ({ source: from(r.fromSlug).path, destination: from(r.toSlug).path }));
    const commit = await commitVercelRedirects(ctx, siteId, entries);
    if (!commit.ok) {
      await ctx.runMutation(internal.siteRedirects.markDelivery, { siteId, rows: pending.map((r) => ({ id: r.id, delivery: "not_delivered" as const,
        note: `${commit.reason}: add a permanent redirect from ${from(r.fromSlug).path} to ${from(r.toSlug).path}` })) });
      return [`Redirects not delivered: ${commit.reason}`];
    }
    await ctx.runMutation(internal.siteRedirects.markDelivery, { siteId, rows: pending.map((r) => ({ id: r.id, delivery: "repository" as const,
      ...(commit.sha ? { commitSha: commit.sha } : {}) })) });
    await ctx.scheduler.runAfter(VERIFY_AFTER_MS, internal.actions.siteDiagnosis.verifyRedirects, { siteId, attempt: 1 });
    return [commit.sha ? `Committed ${entries.length} redirects to the site's vercel.json (${commit.sha.slice(0, 7)}); checked after the build`
      : `${entries.length} redirects were already in the site's vercel.json`];
  }
  await ctx.runMutation(internal.siteRedirects.markDelivery, { siteId, rows: pending.map((r) => ({ id: r.id, delivery: "not_delivered" as const,
    note: `Add a permanent redirect from ${from(r.fromSlug).path} to ${from(r.toSlug).path} on your platform` })) });
  return [`${pending.length} redirects need the owner on this platform`];
}

/** One commit of the site's vercel.json with Pentra's redirects added (convex/lib/vercelRedirects.ts). The file is read
 * at the branch head and written with its sha, so a change made meanwhile is never overwritten; a write whose outcome
 * is unknown is reconciled next time by reading the file again (the entries already there are not written twice). */
async function commitVercelRedirects(ctx: ActionCtx, siteId: Id<"sites">, entries: RedirectEntry[]): Promise<{ ok: true; sha: string | null } | { ok: false; reason: string }> {
  const site = await ctx.runQuery(internal.sites.getFull, { siteId });
  if (!site?.githubToken || !site.repoOwner || !site.repoName) return { ok: false, reason: "GitHub isn't connected" };
  const branch = site.repoDefaultBranch || "main";
  const api = `https://api.github.com/repos/${encodeURIComponent(site.repoOwner)}/${encodeURIComponent(site.repoName)}/contents/vercel.json`;
  const headers = { Authorization: `Bearer ${site.githubToken}`, Accept: "application/vnd.github+json", "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28" };
  const read = await fetch(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
  let current: string | null = null, sha: string | undefined;
  if (read.status === 200) {
    const file = await read.json() as { type?: string; content?: string; sha?: string };
    if (file.type !== "file" || typeof file.content !== "string" || typeof file.sha !== "string") return { ok: false, reason: "vercel.json isn't a file Pentra can read" };
    current = Buffer.from(file.content, "base64").toString("utf8");
    sha = file.sha;
  } else if (read.status !== 404) return { ok: false, reason: `GitHub answered HTTP ${read.status} reading vercel.json` };
  const edit = editVercelRedirects(current, entries);
  if (!edit.ok) return { ok: false, reason: edit.reason };
  if (!edit.changed) return { ok: true, sha: null };
  const message = `Pentra: permanent redirects for merged duplicate articles\n\n${entries.map((e) => `${e.source} -> ${e.destination}`).join("\n")}\n`;
  const write = await fetch(api, { method: "PUT", headers,
    body: JSON.stringify({ message, content: Buffer.from(edit.text, "utf8").toString("base64"), branch, ...(sha ? { sha } : {}) }) });
  if (!write.ok) return { ok: false, reason: `GitHub refused the vercel.json commit (HTTP ${write.status})` };
  const written = await write.json() as { commit?: { sha?: string } };
  return { ok: true, sha: written.commit?.sha ?? null };
}

/** After the site's build: each delivered redirect not yet seen live is checked by fetching the old address. One retry
 * later if the build was slow; a redirect still not live is recorded, and the weekly run checks it again. */
export const verifyRedirects = internalAction({ args: { siteId: v.id("sites"), attempt: v.number() },
  handler: async (ctx, { siteId, attempt }): Promise<{ checked: number; live: number }> => {
  const site = await loadContext(ctx, siteId);
  if (!site) return { checked: 0, live: 0 };
  const active: Array<{ id: Id<"site_redirects">; fromSlug: string; toSlug: string; delivery: string; verifiedAt: number | null }> =
    await ctx.runQuery(internal.siteRedirects.activeInternal, { siteId });
  const rows = active
    .filter((r) => (r.delivery === "repository" || r.delivery === "pentra_blog") && !r.verifiedAt);
  const marks = [];
  for (const r of rows) marks.push({ id: r.id, delivery: r.delivery as "repository" | "pentra_blog",
    verified: await redirectsTo(addressOf(site, r.fromSlug).url, addressOf(site, r.toSlug).path) });
  if (marks.length) await ctx.runMutation(internal.siteRedirects.markDelivery, { siteId, rows: marks });
  if (marks.some((m) => !m.verified) && attempt < 2) await ctx.scheduler.runAfter(VERIFY_RETRY_MS, internal.actions.siteDiagnosis.verifyRedirects, { siteId, attempt: attempt + 1 });
  return { checked: marks.length, live: marks.filter((m) => m.verified).length };
} });
