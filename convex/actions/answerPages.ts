"use node";
/** Pentra Answers (Nov 2026): writing answer pages. Each page is written from the business's confirmed facts and the
 * sources the assistants cite for its question (read live), checked objectively, revised once when a check fails, and
 * only then saved as a draft; a page that still fails is "not written", never published. */
import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { fetchPublicTextRendered } from "../lib/tregFetch";
import { firstPartyProductEvidence } from "../lib/productEvidence";
import {
  ANSWER_PAGE_HOLD_MICRO_USD, ANSWER_PAGE_TOOL, ANSWER_WRITER_MAX_TOKENS, ANSWER_WRITER_MODEL, answerPageRequest, checkDraftPage, pageSource,
  parseDraftPage, writerCostMicroUsd, type DraftPage, type PageSource,
} from "../lib/answerPages";
import { structuredToolChoice } from "../lib/toolChoice";
import { spendRefusal } from "./answers";

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 300_000, fetch });
const SOURCES_PER_PAGE = 5;

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
  try {
    const [sources, productEvidence] = await Promise.all([readSources(context.sources), businessEvidence(context.business)]);
    const base = { question: context.page.question, businessName: context.business.name, productEvidence, market: context.business.market,
      language: context.business.language, landscape: context.landscape, sources, mayName: context.mayName };
    let draft: DraftPage | null = null, checked = { blocking: ["The writer didn't return a page."], notes: [] as string[] };
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = answerPageRequest(attempt === 0 || !draft ? base : { ...base, revision: { markdown: draft.markdown, issues: checked.blocking } });
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
      checked = checkDraftPage(parsed, { businessName: context.business.name, businessDomain: context.business.domain, sources, productEvidence });
      if (!checked.blocking.length) break;
    }
    if (!draft) { await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: "The page couldn't be written. Pentra will try again next week.", costMicroUsd: cost }); return; }
    const saved = await ctx.runMutation(internal.answerPages.saveDraft, { pageId, title: draft.title, metaDescription: draft.metaDescription, markdown: draft.markdown,
      facts: draft.facts, sources: sources.map((s) => ({ n: s.n, url: s.url, ...(s.title ? { title: s.title } : {}), excerpt: s.excerpt.slice(0, 1200),
        contentHash: s.contentHash, retrievedAt: s.retrievedAt })),
      issues: checked.blocking.length ? checked.blocking : checked.notes, writerModel: ANSWER_WRITER_MODEL, costMicroUsd: cost, blocked: checked.blocking.length > 0 });
    if (saved?.status === "draft" && context.autopublish) await ctx.scheduler.runAfter(0, internal.actions.answerPublish.publishPage, { pageId });
  } catch (error) {
    await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: `The page couldn't be written (${String(error).slice(0, 120)}). Pentra will try again.`, costMicroUsd: cost });
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
} });

/** The sources the assistants cite for this question, read live (rendered when needed), numbered in order. */
async function readSources(candidates: ReadonlyArray<{ url: string; title?: string }>): Promise<PageSource[]> {
  const read = await Promise.all(candidates.slice(0, SOURCES_PER_PAGE + 3).map(async (c) => {
    try {
      const page = await Promise.race([fetchPublicTextRendered(c.url, 800), new Promise<null>((r) => setTimeout(() => r(null), 50_000))]);
      return page && page.text.length >= 600 ? { url: c.url, title: c.title, text: page.text } : null;
    } catch { return null; }
  }));
  const now = Date.now();
  return read.filter((r): r is { url: string; title: string | undefined; text: string } => r !== null).slice(0, SOURCES_PER_PAGE)
    .map((r, i) => pageSource(i + 1, r.url, r.title, r.text, now));
}

/** What the page may say about the business: the confirmed profile plus its homepage and pricing page, read now. */
async function businessEvidence(business: { name: string; domain: string; summary: string; features: string[]; pricing: string; ctaText: string; ctaUrl: string }) {
  const origin = `https://${business.domain}`;
  const [homepage, pricing] = await Promise.all([
    fetchPublicTextRendered(origin, 400).then((p) => p.text).catch(() => ""),
    fetchPublicTextRendered(`${origin}/pricing`, 300).then((p) => p.text).catch(() => ""),
  ]);
  return firstPartyProductEvidence({ productName: business.name,
    site: { domain: business.domain, siteSummary: business.summary, keyFeatures: business.features, pricingInfo: business.pricing,
      ...(business.ctaText ? { ctaText: business.ctaText } : {}), ...(business.ctaUrl ? { ctaUrl: business.ctaUrl } : {}) },
    crawled: { homepage, pricing } });
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

