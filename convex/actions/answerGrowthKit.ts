"use node";
/** Get named, part two (P398): making the work. A comparison page (written like an answer page, checked objectively,
 * revised once), an answer video's parts (script, voice, screenshot; the owner's browser assembles the video), and the
 * business's directory listing. Spend is held before each and settled at the providers' reported cost. */
import Anthropic from "@anthropic-ai/sdk";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { randomBytes } from "node:crypto";
import { fetchReadable } from "../lib/tregFetch";
import { safeFetchPublicText } from "../lib/safeOutbound";
import { FPS, sceneFrames, TRANSITION_FRAMES } from "../../video/types";
import {
  ANSWER_PAGE_HOLD_MICRO_USD, ANSWER_WRITER_MAX_TOKENS, ANSWER_WRITER_MODEL, checkDraftPage, finalizeDraftPage, pageSource, parseDraftPage, writerCostMicroUsd,
  type DraftPage, type PageSource,
} from "../lib/answerPages";
import {
  brandAccent, COMPARISON_TOOL, comparisonRequest, LISTING_HOLD_MICRO_USD, LISTING_MODEL, LISTING_TOOL, listingKitRequest, parseListingKit, parseScreenshot,
  parseTtsAudio, parseVideoScenes, rivalNumberIssues, SCREENSHOT_ENDPOINT, SCREENSHOT_MAX_MICRO_USD, TTS_ENDPOINT, TTS_MAX_MICRO_USD, TTS_MODEL, ttsRequest,
  VIDEO_HOLD_MICRO_USD, VIDEO_MODEL, VIDEO_TOOL, videoScenesRequest, wavDurationMs,
} from "../lib/growthKit";
import { POST_PRICE } from "../lib/answerGrowth";
import { structuredToolChoice } from "../lib/toolChoice";
import { businessEvidence } from "./answerPages";
import { spendRefusal } from "./answers";

const anthropic = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 300_000, fetch });
const sonnetCost = (usage: { input_tokens?: number; output_tokens?: number } | undefined) =>
  Math.ceil(Math.max(0, usage?.input_tokens ?? 0) * POST_PRICE.inputUsdPerMillion + Math.max(0, usage?.output_tokens ?? 0) * POST_PRICE.outputUsdPerMillion);

/** One treg call: the provider's reply and what it cost (its reported charge, else the call's bound; nothing when unsent). */
async function treg(endpoint: string, body: unknown, maxMicroUsd: number, query = ""): Promise<{ ok: boolean; json: unknown; costMicroUsd: number }> {
  const token = process.env.TREG_TOKEN;
  if (!token) return { ok: false, json: null, costMicroUsd: 0 };
  const response = await fetch(`https://treg.to/call/${endpoint}${query}`, { method: "POST", signal: AbortSignal.timeout(120_000),
    headers: { "Content-Type": "application/json", "X-Treg-Token": token, "X-Treg-Route-Max-Cost": String(maxMicroUsd / 1e6), "X-Treg-Meta": "feature=pentra-get-named" },
    body: JSON.stringify(body) });
  const charged = Number(response.headers.get("X-Treg-Cost-Micro"));
  const costMicroUsd = response.headers.has("X-Treg-Cost-Micro") && Number.isSafeInteger(charged) && charged >= 0 ? charged : response.ok ? maxMicroUsd : 0;
  return { ok: response.ok, json: response.ok ? await response.json() : null, costMicroUsd };
}

async function toolCall(model: string, maxTokens: number, request: { system: string; userMessage: string; inputSchema: Record<string, unknown> }, tool: string) {
  const response = await anthropic().messages.create({ model, max_tokens: maxTokens, system: request.system, messages: [{ role: "user", content: request.userMessage }],
    tools: [{ name: tool, description: "Submit the result.", input_schema: request.inputSchema as Anthropic.Tool["input_schema"] }], tool_choice: structuredToolChoice(model, tool) });
  const block = response.content.find((b) => b.type === "tool_use" && b.name === tool);
  return { input: block && block.type === "tool_use" ? block.input : null, usage: response.usage };
}

// ── Comparison pages ──

export const writeComparison = internalAction({ args: { pageId: v.id("answer_pages") }, handler: async (ctx, { pageId }) => {
  const context = await ctx.runQuery(internal.answerGrowthKit.comparisonContext, { pageId });
  if (!context) return;
  if (!process.env.ANTHROPIC_API_KEY) { await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: "The page writer isn't configured.", costMicroUsd: 0 }); return; }
  const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId: context.siteId, pageId, purpose: "comparison", microUsd: ANSWER_PAGE_HOLD_MICRO_USD });
  if (!hold.ok) { await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: spendRefusal(hold.reason), costMicroUsd: 0 }); return; }
  let cost = 0, sent = false;
  try {
    const { business, rival } = context;
    const productEvidence = await businessEvidence(business, `${rival.name} alternative`);
    // The rival's own pages, read now: its homepage and its pricing page when it has one.
    const read = await Promise.all([`https://${rival.domain}/`, `https://${rival.domain}/pricing`].map((url) =>
      fetchReadable(url, 300, rival.domain).then((p) => (p.text.length >= 300 ? { url: p.url || url, text: p.text } : null)).catch(() => null)));
    const sources: PageSource[] = read.filter((r): r is { url: string; text: string } => r !== null)
      .filter((r, i, all) => all.findIndex((x) => x.url === r.url) === i)
      .map((r, i) => pageSource(i + 1, r.url, `${rival.name}${/pricing/i.test(r.url) ? " pricing" : ""}`, r.text, Date.now()));
    const checkArgs = { businessName: business.name, businessDomain: business.domain, sources, productEvidence, competitors: context.competitors };
    let draft: DraftPage | null = null;
    let issues: string[] = ["The writer didn't return a page."];
    for (let attempt = 0; attempt < 2; attempt++) {
      const request = comparisonRequest({ businessName: business.name, productEvidence, rival, sources, market: business.market, language: business.language,
        ...(attempt > 0 && draft ? { revision: { markdown: draft.markdown, issues } } : {}) });
      sent = true;
      const response = await anthropic().messages.create({ model: ANSWER_WRITER_MODEL, max_tokens: ANSWER_WRITER_MAX_TOKENS, system: request.system,
        messages: [{ role: "user", content: request.userMessage }],
        tools: [{ name: COMPARISON_TOOL, description: "Submit the finished comparison page.", input_schema: request.inputSchema }],
        tool_choice: structuredToolChoice(ANSWER_WRITER_MODEL, COMPARISON_TOOL) });
      cost += writerCostMicroUsd(response.usage);
      const tool = response.content.find((b) => b.type === "tool_use" && b.name === COMPARISON_TOOL);
      const parsed = parseDraftPage(tool && tool.type === "tool_use" ? tool.input : null, sources);
      if (!parsed) continue;
      draft = parsed;
      if (parsed.fit === "none") break;
      issues = [...checkDraftPage(parsed, checkArgs).blocking, ...rivalNumberIssues(parsed.markdown, sources)];
      if (!issues.length) break;
    }
    if (!draft) { await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: "The comparison couldn't be written. Try again.", costMicroUsd: cost }); return; }
    if (draft.fit === "none") {
      await ctx.runMutation(internal.answerPages.abandonPage, { pageId, costMicroUsd: cost,
        reason: `${business.name}'s own pages don't show it does what ${rival.name}'s buyers want${draft.fitReason ? ` (${draft.fitReason})` : ""}, so the comparison wasn't written.` });
      return;
    }
    const final = finalizeDraftPage(draft, sources);
    const blocking = [...checkDraftPage(final.page, { ...checkArgs, sources: final.sources }).blocking, ...rivalNumberIssues(final.page.markdown, final.sources)];
    const saved = await ctx.runMutation(internal.answerPages.saveDraft, { pageId, title: final.page.title, metaDescription: final.page.metaDescription,
      markdown: final.page.markdown, facts: final.page.facts, sources: final.sources.map((s) => ({ n: s.n, url: s.url, ...(s.title ? { title: s.title } : {}),
        excerpt: s.excerpt.slice(0, 360), contentHash: s.contentHash, retrievedAt: s.retrievedAt })),
      issues: blocking, writerModel: ANSWER_WRITER_MODEL, costMicroUsd: cost, blocked: blocking.length > 0 });
    if (saved?.status === "draft" && context.autopublish) await ctx.scheduler.runAfter(0, internal.actions.answerPublish.publishPage, { pageId });
  } catch (error) {
    await ctx.runMutation(internal.answerPages.abandonPage, { pageId, reason: `The comparison couldn't be written (${String(error).slice(0, 120)}). Try again.`, costMicroUsd: cost });
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
} });

// ── Answer videos (P400: animated, rendered by Pentra) ──

/** Where Pentra's app (and its render route) is served. */
const APP_URL = () => (process.env.PENTRA_APP_URL ?? "https://pentra.dev").replace(/\/+$/, "");

/** The brand's colour from its homepage and up to three of its stylesheets (null when none is a strong colour). */
async function siteAccent(domain: string): Promise<string | null> {
  try {
    const home = await safeFetchPublicText(`https://${domain}/`, { timeoutMs: 12_000, maxBytes: 800_000, allowedContentTypes: [/^text\/html/i] });
    const sheets = [...home.text.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)].flatMap((m) => {
      const href = /href=["']([^"']+)["']/i.exec(m[0])?.[1];
      try { return href ? [new URL(href, home.url).toString()] : []; } catch { return []; }
    }).filter((u) => { try { return new URL(u).hostname.endsWith(domain); } catch { return false; } }).slice(0, 3);
    const css = await Promise.all(sheets.map((u) => safeFetchPublicText(u, { timeoutMs: 10_000, maxBytes: 1_500_000, allowedContentTypes: [/^text\/css/i] })
      .then((r) => r.text).catch(() => "")));
    return brandAccent([home.text, ...css]);
  } catch { return null; }
}

/** One render on Pentra's render route (it claims the ticket, renders in a Vercel Sandbox and uploads the MP4). */
async function renderOn(ctx: ActionCtx, videoId: Id<"answer_videos">, format: "landscape" | "vertical"): Promise<{ ok: boolean; error?: string }> {
  const ticket = randomBytes(24).toString("hex");
  const renderId = await ctx.runMutation(internal.answerVideoRender.createRender, { videoId, ticket, format });
  if (!renderId) return { ok: false, error: "This video has no scenes to render." };
  try {
    const response = await fetch(`${APP_URL()}/api/video-render`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }), signal: AbortSignal.timeout(298_000) });
    const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
    const state = await ctx.runQuery(internal.answerVideoRender.renderState, { ticket });
    if (state?.status === "done") return { ok: true };
    return { ok: false, error: state?.error ?? body?.error ?? `The render didn't finish (HTTP ${response.status}).` };
  } catch (error) {
    return { ok: false, error: `The render didn't finish (${String(error).slice(0, 120)}).` };
  }
}

export const makeVideoKit = internalAction({ args: { videoId: v.id("answer_videos") }, handler: async (ctx, { videoId }) => {
  const context = await ctx.runQuery(internal.answerGrowthKit.videoContext, { videoId });
  if (!context) return;
  const fail = (error: string, costMicroUsd: number) => ctx.runMutation(internal.answerGrowthKit.failVideo, { videoId, error, costMicroUsd });
  if (!process.env.ANTHROPIC_API_KEY || !process.env.TREG_TOKEN) { await fail("Video making isn't configured.", 0); return; }
  const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId: context.siteId, purpose: "video", microUsd: VIDEO_HOLD_MICRO_USD });
  if (!hold.ok) { await fail(spendRefusal(hold.reason), 0); return; }
  let cost = 0, sent = false, saved = false;
  try {
    const { business } = context;
    const productEvidence = await businessEvidence(business, context.question);
    sent = true;
    const scripted = await toolCall(VIDEO_MODEL, 6_000, videoScenesRequest({ question: context.question, businessName: business.name, domain: business.domain, productEvidence }), VIDEO_TOOL);
    cost += sonnetCost(scripted.usage);
    const script = parseVideoScenes(scripted.input);
    if (!script) { await fail("The script couldn't be written. Try again.", cost); return; }
    // Each scene's own voice, so every scene lasts exactly as long as it is spoken.
    const voices = await Promise.all(script.scenes.map(async (scene) => {
      const voice = await treg(TTS_ENDPOINT, ttsRequest(scene.narration), TTS_MAX_MICRO_USD, `?model=${encodeURIComponent(TTS_MODEL)}`);
      cost += voice.costMicroUsd;
      const audio = voice.ok ? parseTtsAudio(voice.json) : null;
      if (!audio) return null;
      const bytes = new Uint8Array(Buffer.from(audio.base64, "base64"));
      const audioMs = wavDurationMs(bytes);
      if (!audioMs || audioMs < 800) return null;
      return { audioId: await ctx.storage.store(new Blob([bytes], { type: "audio/wav" })), audioMs };
    }));
    if (voices.some((x) => x === null)) { await fail("The voice couldn't be made for every scene. Try again.", cost); return; }
    // The business's homepage as it looks today, for the scene that shows it, and the brand's colour.
    let screenshotId: Id<"_storage"> | undefined;
    const [shot, accent] = await Promise.all([treg(SCREENSHOT_ENDPOINT, { url: `https://${business.domain}/`, viewportWidth: 1280 }, SCREENSHOT_MAX_MICRO_USD).catch(() => null),
      siteAccent(business.domain)]);
    if (shot) {
      cost += shot.costMicroUsd;
      const image = shot.ok ? parseScreenshot(shot.json) : null;
      if (image) {
        try {
          const response = await fetch(image, { signal: AbortSignal.timeout(30_000) });
          const type = response.headers.get("content-type") ?? "";
          const data = response.ok && /^image\//.test(type) ? new Uint8Array(await response.arrayBuffer()) : null;
          if (data && data.length > 2_000 && data.length < 15_000_000) screenshotId = await ctx.storage.store(new Blob([data], { type }));
        } catch { /* the product scene shows its points without the page */ }
      }
    }
    const scenes = script.scenes.map((s, i) => ({ ...s, audioId: voices[i]!.audioId, audioMs: voices[i]!.audioMs }));
    // YouTube chapters from where each scene starts.
    let at = 0;
    const marks = scenes.map((s, i) => { const start = at; at += sceneFrames(s) - (i < scenes.length - 1 ? TRANSITION_FRAMES : 0); return { start, heading: s.heading }; });
    const chapterLines = marks.map((m) => { const sec = Math.floor(m.start / FPS); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} ${m.heading}`; }).join("\n");
    await ctx.runMutation(internal.answerGrowthKit.saveVideoScenes, { videoId, title: script.title, description: `${script.description}\n\nChapters:\n${chapterLines}`,
      tags: script.tags, scenes, ...(screenshotId ? { screenshotId } : {}), accent: accent ?? undefined, costMicroUsd: cost });
    saved = true;
  } catch (error) {
    await fail(`The video couldn't be made (${String(error).slice(0, 120)}). Try again.`, cost);
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
  if (saved) await ctx.runAction(internal.actions.answerGrowthKit.renderFormat, { videoId, format: "landscape" });
} });

/** Renders one format of a made video; a failed 16:9 render marks the video failed (its scenes are kept for a retry). */
export const renderFormat = internalAction({ args: { videoId: v.id("answer_videos"), format: v.union(v.literal("landscape"), v.literal("vertical")) },
  handler: async (ctx, { videoId, format }) => {
    const result = await renderOn(ctx, videoId, format);
    if (!result.ok) await ctx.runMutation(internal.answerGrowthKit.renderFailed, { videoId, format, error: result.error ?? "The render failed." });
  } });

// ── The directory listing ──

export const makeListingKit = internalAction({ args: { kitId: v.id("answer_listing_kits") }, handler: async (ctx, { kitId }) => {
  const context = await ctx.runQuery(internal.answerGrowthKit.listingContext, { kitId });
  if (!context) return;
  const fail = (error: string, costMicroUsd: number) => ctx.runMutation(internal.answerGrowthKit.failListingKit, { kitId, error, costMicroUsd });
  if (!process.env.ANTHROPIC_API_KEY) { await fail("The listing writer isn't configured.", 0); return; }
  const hold = await ctx.runMutation(internal.answers.holdSpend, { siteId: context.siteId, purpose: "listing", microUsd: LISTING_HOLD_MICRO_USD });
  if (!hold.ok) { await fail(spendRefusal(hold.reason), 0); return; }
  let cost = 0, sent = false;
  try {
    const productEvidence = await businessEvidence(context.business, "pricing, features and who it is for");
    sent = true;
    const written = await toolCall(LISTING_MODEL, 4_000, listingKitRequest({ businessName: context.business.name, domain: context.business.domain, productEvidence,
      alternativesTo: context.alternativesTo }), LISTING_TOOL);
    cost += sonnetCost(written.usage);
    const kit = parseListingKit(written.input);
    if (!kit) { await fail("The listing couldn't be written. Try again.", cost); return; }
    await ctx.runMutation(internal.answerGrowthKit.saveListingKit, { kitId, ...kit, costMicroUsd: cost });
  } catch (error) {
    await fail(`The listing couldn't be written (${String(error).slice(0, 120)}). Try again.`, cost);
  } finally {
    await ctx.runMutation(internal.answers.settleSpend, { spendId: hold.spendId, actualMicroUsd: cost, sent });
  }
} });
