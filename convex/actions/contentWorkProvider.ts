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
