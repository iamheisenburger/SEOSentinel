"use node";
/** Pentra Answers (Nov 2026): the provider calls. Questions are written once (one model call); every run asks each active
 * question of each assistant through treg, a leased batch at a time, storing each answer the moment it arrives. Spend is
 * held before anything is sent and settled at the providers' reported cost. */
import Anthropic from "@anthropic-ai/sdk";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  ANSWER_CALL_ESTIMATE_MICRO_USD, ANSWER_CALL_MAX_MICRO_USD, assistantRequest, excerptAround, isAnswerAssistant, judgeAnswer, parseAssistantReply,
  type AnswerAssistant, type Brand,
} from "../lib/answerEngine";
import { parseQuestions, QUESTION_HOLD_MICRO_USD, QUESTION_MAX_TOKENS, QUESTION_MODEL, QUESTION_TOOL, questionsRequest } from "../lib/answerQuestions";
import { writerCostMicroUsd } from "../lib/answerPages";
import { structuredToolChoice } from "../lib/toolChoice";

const CALL_TIMEOUT_MS = 120_000;
const CONCURRENCY = 10;
const QUESTIONS_FOR_SNAPSHOT = 30;

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 180_000, fetch });

/** The first hour: questions (if the site has too few), then the snapshot run. */
export const prepareSnapshot = internalAction({ args: { siteId: v.id("sites") }, handler: async (ctx, { siteId }) => {
  const context = await ctx.runQuery(internal.answers.questionContext, { siteId });
  if (!context) return;
  if (context.active < 20) {
    const written = await writeQuestions(ctx, siteId, QUESTIONS_FOR_SNAPSHOT - context.active);
    if (!written.ok) { await ctx.runMutation(internal.answers.noteSetupError, { siteId, error: written.error }); return; }
  }
  await ctx.runMutation(internal.answers.startRunInternal, { siteId, kind: "snapshot" });
} });

/** A few new questions for the weekly loop (the plan only). */
export const addWeeklyQuestions = internalAction({ args: { siteId: v.id("sites"), count: v.number() }, handler: async (ctx, { siteId, count }) => {
  return await writeQuestions(ctx, siteId, Math.max(1, Math.min(5, Math.floor(count))));
} });

async function writeQuestions(ctx: ActionCtx, siteId: Id<"sites">, count: number): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const context = await ctx.runQuery(internal.answers.questionContext, { siteId });
  if (!context) return { ok: false, error: "This site doesn't run Pentra Answers." };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "The question writer isn't configured." };
  const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId, purpose: "questions", microUsd: QUESTION_HOLD_MICRO_USD });
  if (!hold.ok) return { ok: false, error: spendRefusal(hold.reason) };
  const request = questionsRequest({ ...context.business, competitors: context.business.competitors }, count + 6, context.existing);
  let cost = 0, sent = false;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      sent = true;
      const response = await anthropic().messages.create({ model: QUESTION_MODEL, max_tokens: QUESTION_MAX_TOKENS, system: request.system,
        messages: [{ role: "user", content: request.userMessage }],
        tools: [{ name: QUESTION_TOOL, description: "Record the buyer questions.", input_schema: request.inputSchema }],
        tool_choice: structuredToolChoice(QUESTION_MODEL, QUESTION_TOOL) });
      cost += writerCostMicroUsd(response.usage);
      const tool = response.content.find((b) => b.type === "tool_use" && b.name === QUESTION_TOOL);
      const questions = parseQuestions(tool && tool.type === "tool_use" ? tool.input : null, context.business, context.existing, count);
      if (questions.length >= Math.min(count, 10)) {
        const added = await ctx.runMutation(internal.answers.addQuestionsInternal, { siteId, source: "generated", questions });
        return { ok: true, added: added.added };
      }
    }
    return { ok: false, error: "The assistant questions couldn't be written. Pentra will try again." };
  } catch (error) {
    return { ok: false, error: `The assistant questions couldn't be written (${String(error).slice(0, 120)}).` };
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
}

export function spendRefusal(reason: string): string {
  if (reason === "free_snapshot_budget") return "Your free snapshot is used. The Pentra plan keeps asking the assistants every week.";
  if (reason === "site_monthly_cap") return "This site reached this month's limit for asking the assistants. It resumes on the 1st.";
  if (reason === "fleet_daily_cap") return "Pentra is pausing new runs for a few hours to stay within its daily limit. Your run resumes automatically.";
  return "Pentra couldn't start this run right now.";
}

type Job = { index: number; questionId: Id<"answer_questions">; assistant: string; question: string };

/** One leased slice of a run: every job asked (ten at a time), each answer stored as it arrives, then the next slice or
 * the run's finish. */
export const askBatch = internalAction({ args: { runId: v.id("answer_runs") }, handler: async (ctx, { runId }) => {
  const batch = await ctx.runMutation(internal.answers.claimBatch, { runId });
  if (!batch) return;
  if (!batch.jobs.length) { await ctx.runMutation(internal.answers.finishRun, { runId }); return; }
  const estimate = Math.ceil(batch.jobs.reduce((sum, j) => sum + (isAnswerAssistant(j.assistant) ? ANSWER_CALL_ESTIMATE_MICRO_USD[j.assistant] : ANSWER_CALL_MAX_MICRO_USD), 0) * 1.3);
  const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId: batch.run.siteId, runId, purpose: "ask", microUsd: estimate });
  if (!hold.ok) {
    if (hold.reason === "fleet_daily_cap") { await ctx.runMutation(internal.answers.deferBatch, { runId, untilMs: 2 * 3_600_000 }); return; }
    await ctx.runMutation(internal.answers.failRun, { runId, error: spendRefusal(hold.reason) });
    return;
  }
  let spent = 0, sent = false, next = 0;
  const jobs = batch.jobs as Job[];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (!isAnswerAssistant(job.assistant)) continue;
      const asked = await askOne(job.assistant, job.question, batch.run.country, batch.run.siteId, batch.business, batch.business.competitors);
      spent += asked.check.costMicroUsd;
      sent = sent || asked.sent;
      await ctx.runMutation(internal.answers.recordCheck, { runId, check: { questionId: job.questionId, question: job.question, ...asked.check },
        ...(asked.text ? { text: asked.text } : {}) });
    }
  }));
  await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: spent, sent });
  const after = await ctx.runMutation(internal.answers.releaseBatch, { runId });
  if (after && after.remaining > 0) await ctx.scheduler.runAfter(0, internal.actions.answers.askBatch, { runId });
  else if (after) await ctx.runMutation(internal.answers.finishRun, { runId });
} });

type AskedCheck = { assistant: string; status: string; error?: string; excerpt: string; textChars: number; named: boolean; cited: boolean;
  position?: number; brandsNamed: number; competitorsNamed: string[]; sources: Array<{ url: string; title?: string; domain: string; own: boolean }>;
  citedPageUrls: string[]; endpoint: string; costMicroUsd: number };

/** One question to one assistant: its answer judged, or why there was none. A call that failed fast (or was rate
 * limited) is tried once more; a timeout is not (the slow answer would hold the batch). A call whose cost is unknown is
 * charged at its price bound, never assumed free. */
export async function askOne(assistant: AnswerAssistant, question: string, country: string, siteId: Id<"sites">,
  business: Brand & { domain: string; extraHosts?: string[] }, competitors: readonly Brand[]): Promise<{ check: AskedCheck; text?: string; sent: boolean }> {
  const { endpoint, body } = assistantRequest(assistant, question, country);
  const token = process.env.TREG_TOKEN;
  const empty = (status: string, error: string, cost: number, sent: boolean) => ({ sent, check: { assistant, status, error, excerpt: "", textChars: 0,
    named: false, cited: false, brandsNamed: 0, competitorsNamed: [], sources: [], citedPageUrls: [], endpoint, costMicroUsd: cost } });
  if (!token) return empty("error", "The assistant provider isn't configured.", 0, false);
  let cost = 0, sent = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now();
    try {
      sent = true;
      const response = await fetch(`https://treg.to/call/${endpoint}`, { method: "POST", signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        headers: { "X-Treg-Token": token, "X-Treg-Meta": `site=${siteId}, feature=pentra-answers`, "X-Treg-Route-Max-Cost": String(ANSWER_CALL_MAX_MICRO_USD / 1e6),
          "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const charged = Number(response.headers.get("X-Treg-Cost-Micro"));
      cost += response.headers.has("X-Treg-Cost-Micro") && Number.isSafeInteger(charged) && charged >= 0 ? charged : response.ok ? ANSWER_CALL_MAX_MICRO_USD : 0;
      if (!response.ok) {
        if (attempt === 0 && (response.status === 429 || response.status >= 500) && Date.now() - started < 30_000) {
          await new Promise((r) => setTimeout(r, response.status === 429 ? 2_500 : 1_000));
          continue;
        }
        return empty("error", `The assistant didn't answer (HTTP ${response.status}).`, cost, sent);
      }
      const parsed = parseAssistantReply(assistant, await response.json());
      if (!parsed) {
        if (attempt === 0 && Date.now() - started < 30_000) continue;
        return empty("error", "The assistant's reply couldn't be read.", cost, sent);
      }
      if (parsed.kind === "none") return empty("no_answer", parsed.reason, cost, sent);
      const judged = judgeAnswer(parsed, business, competitors);
      return { sent, text: parsed.text, check: { assistant, status: "answered", excerpt: judged.excerpt || excerptAround(parsed.text, 0),
        textChars: parsed.text.length, named: judged.named, cited: judged.cited, ...(judged.position !== null ? { position: judged.position } : {}),
        brandsNamed: judged.brandsNamed, competitorsNamed: judged.competitorsNamed, sources: judged.sources, citedPageUrls: judged.citedPageUrls,
        endpoint, costMicroUsd: cost } };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      if (timedOut) cost += ANSWER_CALL_MAX_MICRO_USD;
      if (!timedOut && attempt === 0 && Date.now() - started < 30_000) continue;
      return empty("error", timedOut ? "The assistant took longer than two minutes." : "The assistant couldn't be reached.", cost, sent);
    }
  }
  return empty("error", "The assistant didn't answer.", cost, sent);
}
