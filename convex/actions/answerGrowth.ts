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
import { parsePostDraft, POST_HOLD_MICRO_USD, POST_MODEL, POST_TOOL, postCostMicroUsd, postDraftRequest, redditThreadText } from "../lib/answerGrowth";
import { safeFetchPublicText } from "../lib/safeOutbound";
import { structuredToolChoice } from "../lib/toolChoice";

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000, fetch });
/** Listing one answer's businesses: ~500 tokens in, ~40 out of Haiku. */
const LIST_HOLD_MICRO_USD = 200;

async function threadText(url: string): Promise<string | null> {
  if (!/reddit\.com\/r\/[^/]+\/comments\//i.test(url)) return null;
  try {
    const u = new URL(url);
    const fetched = await safeFetchPublicText(`https://www.reddit.com${u.pathname.replace(/\/+$/, "")}.json?limit=8`, { timeoutMs: 12_000, maxBytes: 600_000,
      allowedContentTypes: [/^application\/json(?:;|$)/i] });
    return redditThreadText(JSON.parse(fetched.text));
  } catch { return null; }
}

export const prepare = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }): Promise<{ listed: number; drafted: number }> => {
  const context = await ctx.runQuery(internal.answerGrowth.prepareContext, { siteId });
  if (!context || !process.env.ANTHROPIC_API_KEY) return { listed: 0, drafted: 0 };
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

  // 3) One reply per cited thread.
  let drafted = 0;
  for (const thread of context.threads) {
    const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId, purpose: "growth_post", microUsd: POST_HOLD_MICRO_USD });
    if (!hold.ok) break;
    let cost = 0, sent = false;
    try {
      const text = await threadText(thread.url);
      const req = postDraftRequest({ url: thread.url, title: thread.title, text, questions: thread.questions }, context.business);
      sent = true;
      const res = await client.messages.create({ model: POST_MODEL, max_tokens: 1_500, system: req.system, messages: [{ role: "user", content: req.userMessage }],
        tools: [{ name: POST_TOOL, description: "Record the reply to post.", input_schema: req.inputSchema }], tool_choice: structuredToolChoice(POST_MODEL, POST_TOOL) });
      cost = postCostMicroUsd(res.usage);
      const tool = res.content.find((b) => b.type === "tool_use" && b.name === POST_TOOL);
      const draft = parsePostDraft(tool && tool.type === "tool_use" ? tool.input : null);
      if (draft) {
        await ctx.runMutation(internal.answerGrowth.savePost, { siteId, url: thread.url, ...(thread.title ? { title: thread.title.slice(0, 300) } : {}),
          questions: thread.questions, answers: thread.answers, draft: draft.reply, fits: draft.fits, threadRead: text !== null, costMicroUsd: cost });
        drafted++;
      }
    } catch { /* drafted next time */ }
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
  return { listed, drafted };
} });
