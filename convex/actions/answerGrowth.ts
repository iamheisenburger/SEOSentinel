"use node";
/** Get named (P397): preparing the work. 1) Lists who each recent answer names when that wasn't recorded (answers before
 * P396 were listed only when they named the business), so "who wins instead" covers every answer. 2) Looks for pages to
 * pitch (convex/actions/linkOutreach.ts, fed by the same answers since P396). 3) Drafts one reply for each cited thread
 * not drafted yet. Spend is held first and settled at the providers' reported usage. */
import Anthropic from "@anthropic-ai/sdk";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { NAMED_MODEL, NAMED_TOOL, namedBusinessesRequest, namedCostMicroUsd, parseNamedBusinesses } from "../lib/answerEngine";
import { forumThreadText, parsePostDraft, POST_HOLD_MICRO_USD, POST_MODEL, POST_TOOL, postCostMicroUsd, postDraftRequest, REDDIT_THREAD_ENDPOINT, REDDIT_THREAD_MAX_MICRO_USD,
  scrapedRedditThreadText, THREAD_PAGE_MAX_MICRO_USD } from "../lib/answerGrowth";
import { parseThreadResults, THREAD_SEARCH_ENDPOINT, THREAD_SEARCH_MAX_MICRO_USD, THREAD_SEARCH_QUESTIONS, threadSearchRequest } from "../lib/growthKit";
import { challengeText, htmlToText, looksLikeMarkup, markdownToText } from "../lib/pageText";
import { safeFetchPublicText } from "../lib/safeOutbound";
import { tregPageText } from "../lib/tregFetch";
import { structuredToolChoice } from "../lib/toolChoice";

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000, fetch });
/** Listing one answer's businesses: ~500 tokens in, ~40 out of Haiku. */
const LIST_HOLD_MICRO_USD = 200;
/** P407: the preparation starts no new thread after this long (an action has ten minutes; a thread is read and written
 * in about twenty seconds, and up to eighteen are due since P406); the rest wait for the next preparation. */
const PREPARE_TIME_MS = 6 * 60_000;

/** One treg call (GET with a query, or POST with a body): the reply and its reported charge. A call whose answer was lost
 * is charged at its bound. Never throws. */
async function tregRead(endpoint: string, init: { query?: Record<string, string>; body?: unknown }, maxMicroUsd: number, siteId: string): Promise<{ json: unknown; costMicroUsd: number }> {
  const token = process.env.TREG_TOKEN;
  if (!token) return { json: null, costMicroUsd: 0 };
  const post = init.body !== undefined;
  try {
    const response = await fetch(`https://treg.to/call/${endpoint}${init.query ? `?${new URLSearchParams(init.query)}` : ""}`, { method: post ? "POST" : "GET",
      signal: AbortSignal.timeout(60_000), headers: { "X-Treg-Token": token, "X-Treg-Route-Max-Cost": String(maxMicroUsd / 1e6),
        "X-Treg-Meta": `site=${siteId}, feature=pentra-get-named-thread`, ...(post ? { "Content-Type": "application/json" } : {}) },
      ...(post ? { body: JSON.stringify(init.body) } : {}) });
    const charged = Number(response.headers.get("X-Treg-Cost-Micro"));
    const costMicroUsd = response.headers.has("X-Treg-Cost-Micro") && Number.isSafeInteger(charged) && charged >= 0 ? charged : response.ok ? maxMicroUsd : 0;
    return { json: response.ok ? await response.json().catch(() => null) : null, costMicroUsd };
  } catch { return { json: null, costMicroUsd: maxMicroUsd }; }
}

/** P406: the thread's own words, and what reading them cost. Reddit refuses Pentra's servers (403), so a Reddit thread
 * is read through treg; a Quora or forum page directly when the site allows it, else through treg's page reader. Only a
 * page that is the thread counts (never a sign-in wall or a bot check). */
async function threadText(thread: { url: string; title: string | null }, siteId: string): Promise<{ text: string | null; costMicroUsd: number }> {
  if (/reddit\.com\/r\/[^/]+\/comments\//i.test(thread.url)) {
    const read = await tregRead(REDDIT_THREAD_ENDPOINT, { query: { url: thread.url } }, REDDIT_THREAD_MAX_MICRO_USD, siteId);
    return { text: scrapedRedditThreadText(read.json), costMicroUsd: read.costMicroUsd };
  }
  try {
    const page = await safeFetchPublicText(thread.url, { sameHostRedirects: true, timeoutMs: 12_000 });
    if (!challengeText(page.text)) {
      const text = forumThreadText(thread.title, looksLikeMarkup(page.text) ? htmlToText(page.text) : markdownToText(page.text));
      if (text) return { text, costMicroUsd: 0 };
    }
  } catch { /* blocked or unreachable: the reader below */ }
  const read = await tregRead("treg.web.extract", { body: { url: thread.url } }, THREAD_PAGE_MAX_MICRO_USD, siteId);
  const markdown = read.json ? tregPageText(read.json) : "";
  return { text: markdown && !challengeText(markdown) ? forumThreadText(thread.title, markdownToText(markdown)) : null, costMicroUsd: read.costMicroUsd };
}

export const prepare = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }): Promise<{ listed: number; drafted: number; redrafted: number }> => {
  const deadline = Date.now() + PREPARE_TIME_MS;
  const context = await ctx.runQuery(internal.answerGrowth.prepareContext, { siteId });
  if (!context || !process.env.ANTHROPIC_API_KEY) return { listed: 0, drafted: 0, redrafted: 0 };
  const client = anthropic();

  // 1) Who each answer names.
  let listed = 0;
  if (context.unlisted.length) {
    const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId, purpose: "growth_list", microUsd: context.unlisted.length * LIST_HOLD_MICRO_USD });
    if (hold.ok) {
      let spent = 0, sent = false;
      for (let i = 0; i < context.unlisted.length; i += 8) {
        await Promise.all(context.unlisted.slice(i, i + 8).map(async ({ checkId, question }) => {
          const text = await ctx.runQuery(internal.answerGrowth.checkText, { checkId });
          if (!text) return;
          try {
            sent = true;
            const req = namedBusinessesRequest(question, text);
            const res = await client.messages.create({ model: NAMED_MODEL, max_tokens: 1_200, system: req.system, messages: [{ role: "user", content: req.userMessage }],
              tools: [{ name: NAMED_TOOL, description: "Record the businesses the answer names, in order.", input_schema: req.inputSchema }],
              tool_choice: structuredToolChoice(NAMED_MODEL, NAMED_TOOL) });
            spent += namedCostMicroUsd(res.usage);
            const tool = res.content.find((b) => b.type === "tool_use" && b.name === NAMED_TOOL);
            const names = parseNamedBusinesses(tool && tool.type === "tool_use" ? tool.input : null);
            if (names) { await ctx.runMutation(internal.answerGrowth.saveBusinesses, { checkId, names }); listed++; }
          } catch { /* listed next time */ }
        }));
      }
      await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: spent, sent });
    }
  }

  // 2) Pages to pitch, with the rivals the answers now show.
  if (context.linkOn) await ctx.scheduler.runAfter(0, internal.actions.linkOutreach.findNow, { siteId });

  // 3) Threads asking the questions, found by search (P398): the answers cite only a few threads, and every thread a buyer
  // reads is a place to be named. Searched for the questions in order, once each preparation.
  const found: Array<{ url: string; title: string | null; questions: string[]; answers: number }> = [];
  const known = new Set([...context.drafted, ...context.threads.map((t) => t.url)]);
  const searchHold = await ctx.runMutation(internal.answers.holdSpend, { siteId, purpose: "growth_search", microUsd: THREAD_SEARCH_QUESTIONS * THREAD_SEARCH_MAX_MICRO_USD });
  if (searchHold.ok && process.env.TREG_TOKEN) {
    let spent = 0, sent = false;
    await Promise.all(context.questions.slice(0, THREAD_SEARCH_QUESTIONS).map(async (question) => {
      try {
        sent = true;
        const response = await fetch(`https://treg.to/call/${THREAD_SEARCH_ENDPOINT}`, { method: "POST", signal: AbortSignal.timeout(60_000),
          headers: { "Content-Type": "application/json", "X-Treg-Token": process.env.TREG_TOKEN!, "X-Treg-Route-Max-Cost": String(THREAD_SEARCH_MAX_MICRO_USD / 1e6),
            "X-Treg-Meta": `site=${siteId}, feature=pentra-get-named` }, body: JSON.stringify(threadSearchRequest(question, context.country)) });
        const charged = Number(response.headers.get("X-Treg-Cost-Micro"));
        spent += response.headers.has("X-Treg-Cost-Micro") && Number.isSafeInteger(charged) && charged >= 0 ? charged : response.ok ? THREAD_SEARCH_MAX_MICRO_USD : 0;
        if (!response.ok) return;
        for (const t of parseThreadResults(await response.json()).slice(0, 3)) {
          if (known.has(t.url)) continue;
          known.add(t.url);
          found.push({ url: t.url, title: t.title, questions: [question], answers: 0 });
        }
      } catch { /* searched next time */ }
    }));
    await ctx.runMutation(internal.answers.settleSpend, { spendId: searchHold.spendId, actualMicroUsd: spent, sent });
  } else if (searchHold.ok) await ctx.runMutation(internal.answers.settleSpend, { spendId: searchHold.spendId, actualMicroUsd: 0, sent: false });

  // 4) One reply per thread: the cited ones first, then the ones found by search (at most twelve a preparation); then
  // (P406) the waiting replies written from the title alone, written again when their thread can now be read.
  let drafted = 0, redrafted = 0;
  const toDraft = [...context.threads.map((t) => ({ ...t, foundBy: "cited" as const, postId: null })), ...found.map((t) => ({ ...t, foundBy: "search" as const, postId: null }))]
    .slice(0, 12);
  const work = [...toDraft, ...context.redraft.map((p) => ({ ...p, foundBy: "cited" as const }))];
  for (const thread of work) {
    if (Date.now() > deadline) break;
    const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId, purpose: "growth_post", microUsd: POST_HOLD_MICRO_USD });
    if (!hold.ok) break;
    let cost = 0, sent = false;
    try {
      const read = await threadText(thread, siteId);
      cost += read.costMicroUsd;
      sent = read.costMicroUsd > 0;
      // A waiting reply is written again only from its thread; when the thread still can't be read, its draft stays.
      if (!thread.postId || read.text) {
        const req = postDraftRequest({ url: thread.url, title: thread.title, text: read.text, questions: thread.questions }, context.business);
        sent = true;
        const res = await client.messages.create({ model: POST_MODEL, max_tokens: 1_500, system: req.system, messages: [{ role: "user", content: req.userMessage }],
          tools: [{ name: POST_TOOL, description: "Record the reply to post.", input_schema: req.inputSchema }], tool_choice: structuredToolChoice(POST_MODEL, POST_TOOL) });
        cost += postCostMicroUsd(res.usage);
        const tool = res.content.find((b) => b.type === "tool_use" && b.name === POST_TOOL);
        const draft = parsePostDraft(tool && tool.type === "tool_use" ? tool.input : null);
        if (draft && thread.postId) {
          await ctx.runMutation(internal.answerGrowth.saveRedraft, { postId: thread.postId, draft: draft.reply, fits: draft.fits, costMicroUsd: cost });
          redrafted++;
        } else if (draft) {
          await ctx.runMutation(internal.answerGrowth.savePost, { siteId, url: thread.url, ...(thread.title ? { title: thread.title.slice(0, 300) } : {}),
            questions: thread.questions, answers: thread.answers, draft: draft.reply, fits: draft.fits, threadRead: read.text !== null, costMicroUsd: cost, found: thread.foundBy });
          drafted++;
        }
      }
    } catch { /* drafted next time */ }
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
  return { listed, drafted, redrafted };
} });
