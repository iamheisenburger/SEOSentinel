"use node";
/** Pentra Answers (Nov 2026): writing answer pages. Each page is written from the business's confirmed facts and the
 * sources the assistants cite for its question (read live), checked objectively, revised once when a check fails, and
 * only then saved as a draft; a page that still fails is "not written", never published. */
import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { fetchReadable, sitemapLinks } from "../lib/tregFetch";
import { firstPartyProductEvidence } from "../lib/productEvidence";
import { keyLinks, relevantLinks } from "../lib/siteLinks";
import { mergeLinks } from "../lib/pageText";
import { hostOf } from "../lib/answerEngine";
import {
  ANSWER_PAGE_HOLD_MICRO_USD, ANSWER_PAGE_TOOL, ANSWER_WRITER_MAX_TOKENS, ANSWER_WRITER_MODEL, answerPageRequest, checkDraftPage, citedPassage, editedDraft,
  finalizeDraftPage, OWN_FACTS_TOOL, ownFactsIssue, ownFactsRequest, PAGE_CHECK_MAX_TOKENS, PAGE_CHECK_MODEL, pageCheckCostMicroUsd, pageSentences, pageSource,
  parseDraftPage, parseOwnFacts, parseSourceKinds, repeatedContent, repeatedIssues, SOURCE_KINDS_TOOL, sourceKindsRequest, writerCostMicroUsd,
  type DraftPage, type OwnFactsProblem, type SourceCandidate,
} from "../lib/answerPages";
import { structuredToolChoice } from "../lib/toolChoice";
import { spendRefusal } from "./answers";

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 300_000, fetch });
const checker = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 120_000, fetch });
const SOURCES_PER_PAGE = 5;
/** A page's work stops starting new model calls after this long (Convex actions end at 10 minutes). */
const PAGE_TIME_BUDGET_MS = 7 * 60_000;

/** After a snapshot: the top questions each get a page, written in parallel. */
export const draftTop = internalAction({ args: { siteId: v.id("sites"), count: v.number() }, handler: async (ctx, { siteId, count }) => {
  const targets = await ctx.runQuery(internal.answerPages.pickDraftTargets, { siteId, count });
  let started = 0;
  for (const target of targets) {
    const pageId = await ctx.runMutation(internal.answerPages.startPage, { siteId, questionId: target.questionId });
    if (!pageId) continue;
    await ctx.scheduler.runAfter(started * 2_000, internal.actions.answerPages.writePage, { pageId });
    started++;
  }
  return { started };
} });

/** One page: sources read, written, checked, revised once if a check failed, saved. */
export const writePage = internalAction({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const context = await ctx.runQuery(internal.answerPages.writeContext, { pageId });
  if (!context) return;
  if (!process.env.ANTHROPIC_API_KEY) { await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: "The page writer isn't configured.", costMicroUsd: 0 }); return; }
  const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId: context.page.siteId, pageId, purpose: "draft", microUsd: ANSWER_PAGE_HOLD_MICRO_USD });
  if (!hold.ok) { await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: spendRefusal(hold.reason), costMicroUsd: 0 }); return; }
  let cost = 0, sent = false;
  const started = Date.now();
  try {
    const business = context.business;
    // Competitors' own sites are never a page's sources (a page on the business's site never sends buyers to them).
    const avoid = context.competitors.map((c) => c.domain).filter((d): d is string => Boolean(d)).map(hostOf);
    const [candidates, productEvidence] = await Promise.all([readCandidates(context.sources, [...avoid, hostOf(business.domain)]),
      businessEvidence(business, context.page.question)]);
    // Only references are sources: never a business that sells what this one sells, never a listing of them (test 2: a
    // competing Boise practice's page, its phone number in the quote).
    const sorted = await referenceSources(candidates, { businessName: business.name, sells: business.summary, market: business.market });
    cost += sorted.cost;
    const sources = sorted.keep.slice(0, SOURCES_PER_PAGE).map((c, i) => pageSource(i + 1, c.url, c.title, c.text, Date.now()));
    const base = { question: context.page.question, businessName: business.name, productEvidence, market: business.market,
      language: business.language, landscape: context.landscape, sources, competitorNames: context.competitors.map((c) => c.name),
      otherQuestions: context.siblings.map((s) => s.question) };
    const checkArgs = { businessName: business.name, businessDomain: business.domain, sources, productEvidence, competitors: context.competitors };
    let draft: DraftPage | null = null, checked = { blocking: ["The writer didn't return a page."], notes: [] as string[] };
    let own: OwnFactsProblem[] = [];
    let copied: string[] = [];
    // The site's other pages as they are now (the first five are written side by side: a page finished meanwhile counts).
    const otherPages = async () => (await ctx.runQuery(internal.answerPages.siblingPages, { pageId })) ?? context.siblings;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0 && Date.now() - started > PAGE_TIME_BUDGET_MS) break;
      const issues = [...checked.blocking, ...own.map((p) => ownFactsIssue(business.name, p)), ...copied];
      const request = answerPageRequest(attempt === 0 || !draft ? base : { ...base, revision: { markdown: draft.markdown, issues } });
      sent = true;
      const response = await anthropic().messages.create({ model: ANSWER_WRITER_MODEL, max_tokens: ANSWER_WRITER_MAX_TOKENS, system: request.system,
        messages: [{ role: "user", content: request.userMessage }],
        tools: [{ name: ANSWER_PAGE_TOOL, description: "Submit the finished answer page.", input_schema: request.inputSchema }],
        tool_choice: structuredToolChoice(ANSWER_WRITER_MODEL, ANSWER_PAGE_TOOL) });
      cost += writerCostMicroUsd(response.usage);
      const tool = response.content.find((b) => b.type === "tool_use" && b.name === ANSWER_PAGE_TOOL);
      const parsed = parseDraftPage(tool && tool.type === "tool_use" ? tool.input : null, sources);
      if (!parsed) continue;
      draft = parsed;
      checked = checkDraftPage(parsed, checkArgs);
      if (parsed.fit === "none") break;
      const factCheck = Date.now() - started < PAGE_TIME_BUDGET_MS ? await ownFactsProblems(business.name, productEvidence, parsed.markdown) : { problems: [], cost: 0 };
      cost += factCheck.cost;
      own = factCheck.problems;
      // Blocks copied from the business's other pages are revised too (a heading, or three sentences or more); a stray
      // shared sentence is simply taken out after.
      const repeated = repeatedContent(parsed.markdown, await otherPages());
      copied = repeated.headings.length || repeated.sentences.length >= 3 ? repeatedIssues(repeated) : [];
      if (!checked.blocking.length && !own.length && !copied.length) break;
    }
    if (!draft) { await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: "The page couldn't be written. Pentra will try again next week.", costMicroUsd: cost }); return; }
    // The business's own pages don't show it offers this: no page that sends buyers elsewhere; the next question instead.
    if (draft.fit === "none") {
      await ctx.runMutation(internal.answerPages.abandonPage, { pageId, costMicroUsd: cost, replace: true,
        reason: `${business.name}'s own pages don't show it offers this${draft.fitReason ? ` (${draft.fitReason})` : ""}, so Pentra skipped it rather than write a page that sends buyers elsewhere.` });
      return;
    }
    // The edit pass (rule 2a): what is still wrong about the business after the revision is taken out, never published.
    draft = editedDraft(draft, { businessName: business.name, businessDomain: business.domain, productEvidence, ownProblems: own, otherPages: await otherPages() });
    checked = checkDraftPage(draft, checkArgs);
    const final = finalizeDraftPage(draft, sources);
    const quotes = final.sources.map((s) => citedPassage(s.excerpt, pageSentences(final.page.markdown).filter((line) => line.includes(`[${s.n}]`))));
    const saved = await ctx.runMutation(internal.answerPages.saveDraft, { pageId, title: final.page.title, metaDescription: final.page.metaDescription,
      markdown: final.page.markdown, facts: final.page.facts, sources: final.sources.map((s, i) => ({ n: s.n, url: s.url, ...(s.title ? { title: s.title } : {}),
        excerpt: quotes[i] || s.excerpt.slice(0, 360), contentHash: s.contentHash, retrievedAt: s.retrievedAt })),
      issues: checked.blocking.length ? checked.blocking : checked.notes, writerModel: ANSWER_WRITER_MODEL, costMicroUsd: cost, blocked: checked.blocking.length > 0 });
    if (saved?.status === "draft" && context.autopublish) await ctx.scheduler.runAfter(0, internal.actions.answerPublish.publishPage, { pageId });
  } catch (error) {
    await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: `The page couldn't be written (${String(error).slice(0, 120)}). Pentra will try again.`, costMicroUsd: cost });
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
} });

/** The pages the assistants cite for this question, read as text (rendered when needed); never a competitor's site or the
 * business's own. A page whose title is only a generic label is titled by its site. */
async function readCandidates(candidates: ReadonlyArray<{ url: string; title?: string }>, avoidHosts: readonly string[]): Promise<SourceCandidate[]> {
  const allowed = candidates.filter((c) => { const h = hostOf(c.url); return !avoidHosts.some((a) => h === a || h.endsWith(`.${a}`)); })
    .map((c) => ({ ...c, title: c.title && !/^\s*(?:[\w\s-]{0,40}\b)?(website|site|homepage|home page|page)\s*$/i.test(c.title) ? c.title : hostOf(c.url) }));
  const read = await Promise.all(allowed.slice(0, SOURCES_PER_PAGE + 3).map(async (c) => {
    try {
      const page = await Promise.race([fetchReadable(c.url, 800), new Promise<null>((r) => setTimeout(() => r(null), 50_000))]);
      return page && page.text.length >= 600 ? { url: c.url, title: c.title, text: page.text } : null;
    } catch { return null; }
  }));
  return read.filter((r): r is { url: string; title: string; text: string } => r !== null).map((r, i) => ({ n: i + 1, ...r }));
}

/** The candidates that are references (one Sonnet call, tried twice). When the sorting can't be done, no outside page is
 * used: the page is written from the business's own pages with general guidance, the same in every country (no list of
 * sites or address endings guessed at). */
async function referenceSources(candidates: readonly SourceCandidate[], business: { businessName: string; sells: string; market: string }) {
  if (!candidates.length) return { keep: [] as SourceCandidate[], cost: 0 };
  const request = sourceKindsRequest({ ...business, candidates });
  let cost = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await checker().messages.create({ model: PAGE_CHECK_MODEL, max_tokens: PAGE_CHECK_MAX_TOKENS, system: request.system,
        messages: [{ role: "user", content: request.userMessage }],
        tools: [{ name: SOURCE_KINDS_TOOL, description: "Record each page's kind.", input_schema: request.inputSchema }],
        tool_choice: structuredToolChoice(PAGE_CHECK_MODEL, SOURCE_KINDS_TOOL) });
      cost += pageCheckCostMicroUsd(response.usage);
      const tool = response.content.find((b) => b.type === "tool_use" && b.name === SOURCE_KINDS_TOOL);
      const keep = parseSourceKinds(tool && tool.type === "tool_use" ? tool.input : null, candidates);
      if (keep) return { keep: candidates.filter((c) => keep.includes(c.n)), cost };
    } catch { /* tried once more */ }
  }
  return { keep: [] as SourceCandidate[], cost };
}

/** What the page says about the business that its own pages contradict or don't support (one Sonnet call; none on failure). */
async function ownFactsProblems(businessName: string, productEvidence: string, markdown: string): Promise<{ problems: OwnFactsProblem[]; cost: number }> {
  try {
    const request = ownFactsRequest({ businessName, productEvidence, markdown });
    const response = await checker().messages.create({ model: PAGE_CHECK_MODEL, max_tokens: PAGE_CHECK_MAX_TOKENS, system: request.system,
      messages: [{ role: "user", content: request.userMessage }],
      tools: [{ name: OWN_FACTS_TOOL, description: "Record the sentences about the business its own pages don't support.", input_schema: request.inputSchema }],
      tool_choice: structuredToolChoice(PAGE_CHECK_MODEL, OWN_FACTS_TOOL) });
    const tool = response.content.find((b) => b.type === "tool_use" && b.name === OWN_FACTS_TOOL);
    return { problems: parseOwnFacts(tool && tool.type === "tool_use" ? tool.input : null) ?? [], cost: pageCheckCostMicroUsd(response.usage) };
  } catch { return { problems: [], cost: 0 }; }
}

/** What the page may say about the business: the confirmed profile, its homepage, its key pages (what it offers, prices,
 * about, questions) and its pages about the question's subject (a dentist's "Sleep Apnea" page for a sleep apnea
 * question), found from its links and its sitemap and read now as text. */
async function businessEvidence(business: { name: string; domain: string; summary: string; features: string[]; pricing: string; ctaText: string; ctaUrl: string },
  question: string) {
  const origin = `https://${business.domain}`;
  const [home, mapped] = await Promise.all([fetchReadable(`${origin}/`, 400, business.domain).catch(() => null), sitemapLinks(business.domain).catch(() => [])]);
  const links = mergeLinks(home?.links ?? [], mapped);
  const chosen = mergeLinks(relevantLinks(links, question, 3), keyLinks(links, 4)).filter((l) => l.url !== origin).slice(0, 6);
  const pages = (await Promise.all(chosen.map((link) => fetchReadable(link.url, 300, business.domain).then((p) => ({ url: link.url, text: p.text })).catch(() => null))))
    .filter((p): p is { url: string; text: string } => p !== null && p.text.length >= 200);
  return firstPartyProductEvidence({ productName: business.name,
    site: { domain: business.domain, siteSummary: business.summary, keyFeatures: business.features, pricingInfo: business.pricing,
      ...(business.ctaText ? { ctaText: business.ctaText } : {}), ...(business.ctaUrl ? { ctaUrl: business.ctaUrl } : {}) },
    crawled: { homepage: home?.text ?? "", pages } });
}

/** The plan's weekly loop, after each weekly run: a few new questions, rewrites of pages no assistant cites after three
 * weeks, and pages for the newly winnable questions (published automatically unless the owner turned that off). */
export const weeklyLoop = internalAction({ args: { siteId: v.id("sites"), runId: v.id("answer_runs") }, handler: async (ctx, { siteId }) => {
  await ctx.runAction(internal.actions.answers.addWeeklyQuestions, { siteId, count: 3 });
  const uncited = await ctx.runQuery(internal.answerPages.uncitedPages, { siteId });
  let delay = 0;
  for (const page of uncited) {
    const pageId = await ctx.runMutation(internal.answerPages.startPage, { siteId, questionId: page.questionId, rewriteOf: page.pageId,
      rewriteReason: "No assistant cited it in three weeks" });
    if (pageId) { await ctx.scheduler.runAfter(delay, internal.actions.answerPages.writePage, { pageId }); delay += 2_000; }
  }
  await ctx.runAction(internal.actions.answerPages.draftTop, { siteId, count: 3 });
  await ctx.scheduler.runAfter(30 * 60_000, internal.actions.answerEmail.sendWeekly, { siteId });
} });

