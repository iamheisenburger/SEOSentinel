"use node";
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { contentToolRequest } from "../lib/contentToolRequest";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { sha256Hex } from "../lib/publicationArtifact";
import { isProviderCreditRefusal, validProviderRequestId } from "../lib/contentProviderRefusal";
import { auditResultHash, contradictoryContentAudit, semanticAuditPrompt, SEMANTIC_AUDIT_SUFFIX } from "../lib/contentAudit";
import { classifyEvidenceSource } from "../lib/sourceQuality";
import { safeFetchPublicText } from "../lib/safeOutbound";

type Scope = { ctx: ActionCtx; job: Doc<"jobs">; workerToken: string; phase: string };
const scope = new AsyncLocalStorage<Scope>();
export const contentProviderActive = () => Boolean(scope.getStore());
// Rebuilding an exact interrupted request must keep its original prompt date.
// Admission/expiry/leases still use the real clock, never this prompt-only time.
export const contentProviderPromptTime = () => scope.getStore()?.job.createdAt ?? Date.now();
export function withContentProvider<T>(value: Scope, run: () => Promise<T>) { return scope.run(value, run); }

/** No SDK retry, model fallback, repair ladder or optional paid service. The
 * same durable job owns every bounded call and its ambiguous-response receipt.
 * Deployment pricing must be reviewed before activation; there is no default. */
export async function contentStructuredCall(args: { system: string; userMessage: string; toolName: string;
  toolDescription: string; inputSchema: Anthropic.Tool.InputSchema; maxTokens?: number }, clarifyAudit?: { originalResult: unknown }) {
  const s = scope.getStore();
  if (!s?.job.contentWork) throw new Error("Missing content provider scope");
  if (!["submit_article", "review_article", "remediate_final_article", "audit_final_article"].includes(args.toolName)) throw new Error(`Unpriced content tool: ${args.toolName}`);
  const cw = s.job.contentWork, p = cw.pricing;
  const baseKey = `${cw.replacements}:${cw.revisions}:${s.phase}:${args.toolName}`;
  const logicalKey = baseKey + (clarifyAudit ? SEMANTIC_AUDIT_SUFFIX : "");
  let current = cw, semanticClarificationOf;
  if (clarifyAudit) {
    if (args.toolName !== "audit_final_article" || !contradictoryContentAudit(clarifyAudit.originalResult)) throw new Error("content_audit_clarification_not_applicable");
    const latest = await s.ctx.runQuery(internal.jobs.getInternal, { jobId: s.job._id });
    if (!latest?.contentWork) throw new Error("content_audit_original_checkpoint_missing");
    current = latest.contentWork;
    const original = current.providerCalls.find(c => (c.logicalKey ?? c.key) === baseKey && c.state === "completed");
    if (!original?.requestHash || auditResultHash(original.result) !== auditResultHash(clarifyAudit.originalResult)) throw new Error("content_audit_original_checkpoint_changed");
    semanticClarificationOf = { key: original.key, requestHash: original.requestHash, resultHash: auditResultHash(original.result) };
  }
  const previous = current.providerCalls.find(c => (c.logicalKey ?? c.key) === logicalKey);
  const request = contentToolRequest({ ...args, model: p.model,
    ...(clarifyAudit ? { userMessage: semanticAuditPrompt(args.userMessage, clarifyAudit.originalResult) } : {}) }, previous?.requestHash);
  // UTF-8 bytes upper-bound text tokens; explicit overhead covers tool/chat
  // framing. No images, cached/premium tool use, web search or thinking enabled.
  const inputBound = Buffer.byteLength(JSON.stringify(request), "utf8") + 8192;
  if (inputBound > 200_000) throw new Error("Content request exceeds priced input bound");
  const ceilingMicroUsd = inputBound * p.inputMicroUsdPerToken + request.max_tokens * p.outputMicroUsdPerToken;
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
      if (creditUnavailable || (error.status === 429 && code === "rate_limit_error") || ([503, 529].includes(error.status ?? 0) && code === "overloaded_error")) {
        await s.ctx.runMutation(internal.contentWork.recordProviderRejection, { jobId: s.job._id, workerToken: s.workerToken, key,
          status: error.status!, code: creditUnavailable ? "provider_credit_unavailable" : code!,
          ...(creditUnavailable ? { requestId: requestId! } : {}) });
      }
    }
    if (clarifyAudit) throw new Error("content_audit_clarification_provider_failed", { cause: error });
    throw error;
  }
  const input = response.usage.input_tokens, output = response.usage.output_tokens;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0 || input > inputBound || output > request.max_tokens) throw new Error("Provider usage receipt missing or over bound");
  const result = response.content.find(block => block.type === "tool_use" && block.name === args.toolName);
  await s.ctx.runMutation(internal.contentWork.completeProviderCall, { jobId: s.job._id, workerToken: s.workerToken, key,
    actualMicroUsd: input * p.inputMicroUsdPerToken + output * p.outputMicroUsdPerToken,
    ...(result?.type === "tool_use" ? { result: result.input } : {}) });
  if (!result || result.type !== "tool_use") throw new Error(args.toolName === "audit_final_article"
    ? clarifyAudit ? "content_audit_clarification_invalid" : "content_audit_response_invalid"
    : "content_model_response_invalid");
  return result.input;
}

/** Autopilot live web research is on unless the deployment turns it off. */
export const contentWebResearchEnabled = () => process.env.PENTRA_CONTENT_WEB_RESEARCH !== "off";
/** Anthropic's published server web search fee: $10 per 1,000 searches. */
export const WEB_SEARCH_MICRO_USD_PER_REQUEST = 10_000;
/** Generous per-search allowance for result content counted as input tokens. */
const WEB_SEARCH_INPUT_TOKENS_BOUND = 40_000;

export type ContentResearchResult = {
  summary: string;
  sources: { url: string; title: string; excerpts: string[]; excerpt?: string }[];
  searches: number;
};

/** One bounded live web research call for Autopilot content, inside the same
 * durable job, reservation and receipt as every other content call. The result
 * keeps only what the API attributes to a page (URL, title, cited text), so the
 * evidence is replayed from the receipt on retry instead of being refetched. */
export async function contentResearchCall(args: { system: string; userMessage: string; maxUses: number; maxTokens?: number }): Promise<ContentResearchResult> {
  const s = scope.getStore();
  if (!s?.job.contentWork) throw new Error("Missing content provider scope");
  const cw = s.job.contentWork, p = cw.pricing;
  const maxUses = Math.max(1, Math.min(5, Math.floor(args.maxUses)));
  // Revisions of the same draft reuse its research receipt (same request, cached);
  // a replacement topic researches afresh.
  const logicalKey = `${cw.replacements}:${s.phase}:web_research`;
  const request = { model: p.model, max_tokens: Math.min(args.maxTokens ?? 4000, 8000), system: args.system,
    messages: [{ role: "user" as const, content: args.userMessage }],
    tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: maxUses }] };
  const inputBound = Buffer.byteLength(JSON.stringify(request), "utf8") + 8192 + maxUses * WEB_SEARCH_INPUT_TOKENS_BOUND;
  if (inputBound > 250_000) throw new Error("Content request exceeds priced input bound");
  const ceilingMicroUsd = inputBound * p.inputMicroUsdPerToken + request.max_tokens * p.outputMicroUsdPerToken + maxUses * WEB_SEARCH_MICRO_USD_PER_REQUEST;
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
  if (![input, output, searches].every(n => Number.isSafeInteger(n) && n >= 0) || input > inputBound || output > request.max_tokens || searches > maxUses) {
    throw new Error("Provider usage receipt missing or over bound");
  }
  const result = await withPreservedExcerpts(researchFromResponse(response.content as unknown[], searches));
  await s.ctx.runMutation(internal.contentWork.completeProviderCall, { jobId: s.job._id, workerToken: s.workerToken, key,
    actualMicroUsd: input * p.inputMicroUsdPerToken + output * p.outputMicroUsdPerToken + searches * WEB_SEARCH_MICRO_USD_PER_REQUEST, result });
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
  fetchText: (url: string) => Promise<{ url: string; text: string }> = url => safeFetchPublicText(url, { sameHostRedirects: true })): Promise<ContentResearchResult> {
  const sources = [];
  for (const source of result.sources) {
    let excerpt = source.excerpts.join(" … ");
    if (classifyEvidenceSource(source.url).strictEligible && sources.filter(s => s.excerpt !== s.excerpts.join(" … ")).length < 6) {
      try {
        const page = plainPageText((await fetchText(source.url)).text);
        const windows: string[] = [];
        for (const quote of source.excerpts) {
          const probe = quote.slice(0, 60).toLowerCase(), at = page.toLowerCase().indexOf(probe);
          if (at >= 0) windows.push(page.slice(Math.max(0, at - 300), Math.min(page.length, at + quote.length + 300)).trim());
        }
        excerpt = (windows.length ? windows.join(" … ") : excerpt).slice(0, 2500);
      } catch { /* Unreachable page: keep only the API-attributed quotes. */ }
    }
    sources.push({ ...source, excerpt: excerpt.slice(0, 2500) });
  }
  return { ...result, sources };
}

