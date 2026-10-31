"use node";
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { contentToolRequest } from "../lib/contentToolRequest";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { sha256Hex } from "../lib/publicationArtifact";
import { isProviderCreditRefusal, isProviderRequestRefusal, validProviderRequestId } from "../lib/contentProviderRefusal";
import { auditResultHash, clarifiableContentAudit, contradictoryContentAudit, semanticAuditPrompt, SEMANTIC_AUDIT_SUFFIX } from "../lib/contentAudit";
import { classifyEvidenceSource, firstPartyProductPage, reputableSecondarySource } from "../lib/sourceQuality";
import { excerptLimit, pageExcerpt } from "../lib/evidenceExcerpt";
import { safeFetchPublicText } from "../lib/safeOutbound";
import { promptRates } from "../lib/promptRates";

type Scope = { ctx: ActionCtx; job: Doc<"jobs">; workerToken: string; phase: string };
const scope = new AsyncLocalStorage<Scope>();
export const contentProviderActive = () => Boolean(scope.getStore());
// Rebuilding an exact interrupted request must keep its original prompt date.
// Admission/expiry/leases still use the real clock, never this prompt-only time.
export const contentProviderPromptTime = () => scope.getStore()?.job.createdAt ?? Date.now();
export function withContentProvider<T>(value: Scope, run: () => Promise<T>) { return scope.run(value, run); }
/** Pentra may repair (prune) only text it wrote itself: a new Autopilot or
 * owner-requested article. An owner's edit, an improvement of an existing page,
 * a correction or a rollback carries customer text that is never rewritten. */
export const contentProviderMayRepairDraft = () => {
  const cw = scope.getStore()?.job.contentWork;
  return !!cw && cw.intent === "create" && !cw.ownerRequest?.sourceArticleId && !cw.operation && !cw.editTarget;
};

/** Pentra-written automatic work (not an owner request, edit, improvement,
 * correction or rollback): the only work the rule-2a Autopilot editor policy
 * (convex/lib/autopilotEditor.ts) covers. */
export const contentProviderAutopilotDraft = () => {
  const cw = scope.getStore()?.job.contentWork;
  return !!cw && cw.intent === "create" && !cw.ownerRequest && !cw.operation && !cw.editTarget;
};

/** Tools that write article prose (first draft and rewrites). */
const WRITER_TOOLS = new Set(["submit_article", "remediate_final_article"]);

/** No SDK retry, model fallback, repair ladder or optional paid service. The
 * same durable job owns every bounded call and its ambiguous-response receipt.
 * Deployment pricing must be reviewed before activation; there is no default. */
export async function contentStructuredCall(args: { system: string; userMessage: string; toolName: string;
  toolDescription: string; inputSchema: Anthropic.Tool.InputSchema; maxTokens?: number }, clarifyAudit?: { originalResult: unknown; phantomRepetition?: string[] }) {
  const s = scope.getStore();
  if (!s?.job.contentWork) throw new Error("Missing content provider scope");
  // P260: plan_article is the fixed plan's outline step (checks model).
  // P268: classify_sources (who publishes each research source) and check_claims (the one claims check before the fix).
  if (!["submit_article", "review_article", "remediate_final_article", "audit_final_article", "submit_final_metadata", "plan_article",
    "classify_sources", "check_claims"].includes(args.toolName)) throw new Error(`Unpriced content tool: ${args.toolName}`);
  const cw = s.job.contentWork, p = cw.pricing;
  const baseKey = `${cw.replacements}:${cw.revisions}:${s.phase}:${args.toolName}`;
  const logicalKey = baseKey + (clarifyAudit ? SEMANTIC_AUDIT_SUFFIX : "");
  let current = cw, semanticClarificationOf;
  if (clarifyAudit) {
    if (args.toolName !== "audit_final_article" || !(contradictoryContentAudit(clarifyAudit.originalResult) ||
      ((clarifyAudit.phantomRepetition?.length ?? 0) > 0 && clarifiableContentAudit(clarifyAudit.originalResult)))) throw new Error("content_audit_clarification_not_applicable");
    const latest = await s.ctx.runQuery(internal.jobs.getInternal, { jobId: s.job._id });
    if (!latest?.contentWork) throw new Error("content_audit_original_checkpoint_missing");
    current = latest.contentWork;
    const original = current.providerCalls.find(c => (c.logicalKey ?? c.key) === baseKey && c.state === "completed");
    const originalResult = original ? (await s.ctx.runQuery(internal.contentWork.providerCallResultInternal, { jobId: s.job._id, key: original.key })).result : undefined;
    if (!original?.requestHash || auditResultHash(originalResult) !== auditResultHash(clarifyAudit.originalResult)) throw new Error("content_audit_original_checkpoint_changed");
    semanticClarificationOf = { key: original.key, requestHash: original.requestHash, resultHash: auditResultHash(originalResult) };
  }
  const previous = current.providerCalls.find(c => (c.logicalKey ?? c.key) === logicalKey);
  // Writing and rewriting may use a stronger model; every check keeps the
  // main one. A job keeps the pricing it was created with.
  const price = WRITER_TOOLS.has(args.toolName) && p.writer ? p.writer : p;
  const request = contentToolRequest({ ...args, model: price.model,
    ...(clarifyAudit ? { userMessage: semanticAuditPrompt(args.userMessage, clarifyAudit.originalResult, clarifyAudit.phantomRepetition) } : {}) }, previous?.requestHash);
  // UTF-8 bytes upper-bound text tokens; explicit overhead covers tool/chat
  // framing. No images, cached/premium tool use, web search or thinking enabled.
  const inputBound = Buffer.byteLength(JSON.stringify(request), "utf8") + 8192;
  if (inputBound > 200_000) throw new Error("Content request exceeds priced input bound");
  const boundRates = promptRates(price, inputBound);
  const ceilingMicroUsd = Math.ceil(inputBound * boundRates.input + request.max_tokens * boundRates.output);
  const admission = await s.ctx.runMutation(internal.contentWork.beginProviderCall, { jobId: s.job._id, workerToken: s.workerToken,
    key: logicalKey, requestHash: sha256Hex(JSON.stringify(request)), ceilingMicroUsd,
    ...(semanticClarificationOf ? { semanticClarificationOf } : {}) });
  if (admission.kind === "cached") return admission.result;
  const key = admission.key;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, fetch });
  let response;
  try { response = await client.messages.create(request); }
  catch (error) {
    if (error instanceof Anthropic.APIError) {
      const body = error.error as { error?: { type?: string; message?: string }; type?: string; message?: string; request_id?: string } | undefined;
      const code = body?.error?.type ?? body?.type;
      const message = body?.error?.message ?? body?.message;
      // This authenticated provider refusal is not a lost model response. It
      // identifies the blocker, but is NOT an actual-cost/zero-charge receipt.
      // Other 400s, malformed errors and transport failures remain uncertain.
      const requestId = error.requestID ?? body?.request_id;
      const creditUnavailable = isProviderCreditRefusal(error.status, code, message) && validProviderRequestId(requestId) &&
        (!error.requestID || !body?.request_id || error.requestID === body.request_id);
      // A request the API refused outright (wrong shape for the model, unknown
      // model, key without access) is definitive too when the provider's own
      // request id proves the answer came from the API: no model ran, and the
      // same request would be refused again.
      const requestRefused = !creditUnavailable && isProviderRequestRefusal(error.status, code) && validProviderRequestId(requestId) &&
        (!error.requestID || !body?.request_id || error.requestID === body.request_id);
      if (creditUnavailable || requestRefused || (error.status === 429 && code === "rate_limit_error") || ([503, 529].includes(error.status ?? 0) && code === "overloaded_error")) {
        await s.ctx.runMutation(internal.contentWork.recordProviderRejection, { jobId: s.job._id, workerToken: s.workerToken, key,
          status: error.status!, code: creditUnavailable ? "provider_credit_unavailable" : code!,
          ...(creditUnavailable || requestRefused ? { requestId: requestId! } : {}) });
        if (requestRefused) console.warn(`[content provider] ${request.model} refused ${args.toolName}: ${error.status} ${code}: ${String(message ?? "").slice(0, 300)}`);
      }
    }
    if (clarifyAudit) throw new Error("content_audit_clarification_provider_failed", { cause: error });
    throw error;
  }
  const input = response.usage.input_tokens, output = response.usage.output_tokens;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0 || input > inputBound || output > request.max_tokens) throw new Error("Provider usage receipt missing or over bound");
  const result = response.content.find(block => block.type === "tool_use" && block.name === args.toolName);
  await s.ctx.runMutation(internal.contentWork.completeProviderCall, { jobId: s.job._id, workerToken: s.workerToken, key,
    actualMicroUsd: Math.ceil(input * promptRates(price, input).input + output * promptRates(price, input).output),
    ...(result?.type === "tool_use" ? { result: result.input } : {}) });
  if (!result || result.type !== "tool_use") throw new Error(args.toolName === "audit_final_article"
    ? clarifyAudit ? "content_audit_clarification_invalid" : "content_audit_response_invalid"
    : "content_model_response_invalid");
  return result.input;
}

/** Autopilot live web research is on unless the deployment turns it off. */
/** Live web research is opt-in (PENTRA_CONTENT_WEB_RESEARCH=on). In production its
 * citation-heavy drafts failed the publication gate and left slots empty, so the
 * proven confirmed-facts path is the default until research passes the gate. */
export const contentWebResearchEnabled = () => process.env.PENTRA_CONTENT_WEB_RESEARCH === "on";
/** P260 (Oct 31 2026): Arshad's fixed article plan (ops/ARTICLE-PLAN-V1.md) writes and checks every new Pentra draft;
 * "off" keeps the previous AI-reviewed pipeline (the integration fixtures that test it set this). */
export const articlePlanEnabled = () => process.env.PENTRA_ARTICLE_PLAN !== "off";
/** Anthropic's published server web search fee: $10 per 1,000 searches. */
export const WEB_SEARCH_MICRO_USD_PER_REQUEST = 10_000;
/** The research prompt's input bound is the model's whole context window:
 * a response the API returned can never exceed it. A per-search allowance
 * refused paid research twice: at 40,000 a search about half of the owner
 * sites' drafts lost their sources (P150), and at 100,000 one of pentra.dev's
 * three drafts on Oct 22 still did (P155). At Claude Haiku 5.5's long-prompt
 * rate the ceiling is about $0.54 of the $2.50 article budget. */
const RESEARCH_INPUT_TOKENS_BOUND = 1_000_000;

export type ContentResearchResult = {
  summary: string;
  sources: { url: string; title: string; excerpts: string[]; excerpt?: string }[];
  searches: number;
};

/** One bounded live web research call for Autopilot content, inside the same
 * durable job, reservation and receipt as every other content call. The result
 * keeps only what the API attributes to a page (URL, title, cited text), so the
 * evidence is replayed from the receipt on retry instead of being refetched. */
export async function contentResearchCall(args: { system: string; userMessage: string; maxUses: number; maxTokens?: number;
  /** Products a comparison search names: their own pages are fetched as evidence too (P160). */
  firstPartyProducts?: string[];
  /** P256: the second, primary-sources-only pass has its own receipt (its key keeps ":web_research:"). */
  pass?: "primary";
  /** P264: reputable secondary pages are evidence too (the fixed plan), so their passages are read as well. */
  reputableSecondary?: boolean }): Promise<ContentResearchResult> {
  const s = scope.getStore();
  if (!s?.job.contentWork) throw new Error("Missing content provider scope");
  const cw = s.job.contentWork, p = cw.pricing;
  const maxUses = Math.max(1, Math.min(5, Math.floor(args.maxUses)));
  // Revisions of the same draft reuse its research receipt (same request, cached);
  // a replacement topic researches afresh.
  const logicalKey = `${cw.replacements}:${s.phase}:web_research${args.pass ? `:${args.pass}` : ""}`;
  const request = { model: p.model, max_tokens: Math.min(args.maxTokens ?? 4000, 8000), system: args.system,
    messages: [{ role: "user" as const, content: args.userMessage }],
    tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: maxUses }] };
  const inputBound = RESEARCH_INPUT_TOKENS_BOUND;
  if (Buffer.byteLength(JSON.stringify(request), "utf8") + 8192 > inputBound) throw new Error("Content request exceeds priced input bound");
  const boundRates = promptRates(p, inputBound);
  // With web search the model writes before and after each search, and the
  // receipt totals every turn, each bounded by max_tokens: LeadPilot's Oct 24
  // draft came back with 4,202 output tokens on a 4,000 max_tokens request
  // (three searches) and its paid research was refused (P164, Oct 22 2026).
  const outputBound = request.max_tokens * (maxUses + 1);
  const ceilingMicroUsd = Math.ceil(inputBound * boundRates.input + outputBound * boundRates.output) + maxUses * WEB_SEARCH_MICRO_USD_PER_REQUEST;
  const admission = await s.ctx.runMutation(internal.contentWork.beginProviderCall, { jobId: s.job._id, workerToken: s.workerToken,
    key: logicalKey, requestHash: sha256Hex(JSON.stringify(request)), ceilingMicroUsd });
  if (admission.kind === "cached") return admission.result as ContentResearchResult;
  const key = admission.key;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, fetch });
  let response;
  try { response = await client.messages.create(request); }
  catch (error) {
    if (error instanceof Anthropic.APIError) {
      const body = error.error as { error?: { type?: string; message?: string }; type?: string; message?: string; request_id?: string } | undefined;
      const code = body?.error?.type ?? body?.type, message = body?.error?.message ?? body?.message;
      const requestId = error.requestID ?? body?.request_id;
      const creditUnavailable = isProviderCreditRefusal(error.status, code, message) && validProviderRequestId(requestId) &&
        (!error.requestID || !body?.request_id || error.requestID === body.request_id);
      if (creditUnavailable || (error.status === 429 && code === "rate_limit_error") || ([503, 529].includes(error.status ?? 0) && code === "overloaded_error") ||
        ([400, 403].includes(error.status ?? 0) && (code === "invalid_request_error" || code === "permission_error"))) {
        await s.ctx.runMutation(internal.contentWork.recordProviderRejection, { jobId: s.job._id, workerToken: s.workerToken, key,
          status: error.status!, code: creditUnavailable ? "provider_credit_unavailable" : code!,
          ...(creditUnavailable ? { requestId: requestId! } : {}) });
      }
    }
    throw error;
  }
  const usage = response.usage as { input_tokens: number; output_tokens: number; server_tool_use?: { web_search_requests?: number } | null };
  const input = usage.input_tokens, output = usage.output_tokens, searches = usage.server_tool_use?.web_search_requests ?? 0;
  if (![input, output, searches].every(n => Number.isSafeInteger(n) && n >= 0) || input > inputBound || output > outputBound || searches > maxUses) {
    // The numbers go on the draft's research note, so a refusal says which bound it hit.
    throw new Error(`Provider usage receipt missing or over bound (input ${input}/${inputBound}, output ${output}/${outputBound}, searches ${searches}/${maxUses})`);
  }
  const result = await withPreservedExcerpts(researchFromResponse(response.content as unknown[], searches), undefined, args.firstPartyProducts,
    args.reputableSecondary);
  await s.ctx.runMutation(internal.contentWork.completeProviderCall, { jobId: s.job._id, workerToken: s.workerToken, key,
    actualMicroUsd: Math.ceil(input * promptRates(p, input).input + output * promptRates(p, input).output) + searches * WEB_SEARCH_MICRO_USD_PER_REQUEST, result });
  return result;
}

/** Keep only API-attributed evidence: text blocks' web search citations. */
export function researchFromResponse(content: unknown[], searches: number): ContentResearchResult {
  const bySource = new Map<string, { url: string; title: string; excerpts: string[] }>();
  const text: string[] = [];
  // A cited page must be one the search actually returned (never a URL named in prose).
  const returned = new Set<string>();
  for (const block of content as { type?: string; content?: unknown }[]) {
    if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
      for (const item of block.content as { type?: string; url?: string }[]) if (item?.type === "web_search_result" && typeof item.url === "string") returned.add(item.url);
    }
  }
  for (const block of content as { type?: string; text?: string; citations?: { type?: string; url?: string; title?: string; cited_text?: string }[] }[]) {
    if (block?.type !== "text" || typeof block.text !== "string") continue;
    text.push(block.text);
    for (const c of block.citations ?? []) {
      if (c?.type !== "web_search_result_location" || typeof c.url !== "string" || !/^https:\/\//.test(c.url) || typeof c.cited_text !== "string" || !returned.has(c.url)) continue;
      const cited = c.cited_text.replace(/\s+/g, " ").trim();
      if (cited.length < 20) continue;
      const entry = bySource.get(c.url) ?? { url: c.url, title: (c.title ?? "").slice(0, 200), excerpts: [] };
      if (!entry.excerpts.includes(cited) && entry.excerpts.length < 6) entry.excerpts.push(cited.slice(0, 600));
      bySource.set(c.url, entry);
    }
  }
  return { summary: text.join("").replace(/\s+\n/g, "\n").trim().slice(0, 8000), sources: [...bySource.values()].slice(0, 8), searches };
}

const plainPageText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
  .replace(/<nav[\s\S]*?<\/nav>/gi, "").replace(/<footer[\s\S]*?<\/footer>/gi, "").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&rsquo;/g, "'").replace(/\s+/g, " ").trim();

/** Evidence for the claim audit: the page passages around each API-cited quote
 * (fetched once, stored in the receipt so a retry replays identical evidence).
 * Only strict-eligible sources are fetched; others keep just their quotes. */
export async function withPreservedExcerpts(result: ContentResearchResult,
  fetchText: (url: string) => Promise<{ url: string; text: string }> = url => safeFetchPublicText(url, { sameHostRedirects: true }),
  firstPartyProducts: readonly string[] = [], reputableSecondary = false): Promise<ContentResearchResult> {
  const sources = [];
  for (const source of result.sources) {
    let excerpt = source.excerpts.join(" … ");
    // P249: official documentation keeps a wider passage around each cited quote (pageExcerpt).
    const quality = classifyEvidenceSource(source.url), firstParty = firstPartyProductPage(source.url, firstPartyProducts);
    const docs = quality.tier === "official-doc" || firstParty;
    const secondary = reputableSecondary && reputableSecondarySource(source.url);
    if ((quality.strictEligible || firstParty || secondary) && sources.filter(s => s.excerpt !== s.excerpts.join(" … ")).length < (reputableSecondary ? 8 : 6)) {
      try {
        excerpt = pageExcerpt(plainPageText((await fetchText(source.url)).text), source.excerpts, docs) ?? excerpt;
      } catch { /* Unreachable page: keep only the API-attributed quotes. */ }
    }
    sources.push({ ...source, excerpt: excerpt.slice(0, excerptLimit(docs)) });
  }
  return { ...result, sources };
}

