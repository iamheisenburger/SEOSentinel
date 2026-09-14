"use node";
import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import type { ActionCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";

type Scope = { ctx: ActionCtx; job: Doc<"jobs">; workerToken: string; phase: string };
const scope = new AsyncLocalStorage<Scope>();
export const contentProviderActive = () => Boolean(scope.getStore());
export function withContentProvider<T>(value: Scope, run: () => Promise<T>) { return scope.run(value, run); }

/** No SDK retry, model fallback, repair ladder or optional paid service. The
 * same durable job owns every bounded call and its ambiguous-response receipt.
 * Deployment pricing must be reviewed before activation; there is no default. */
export async function contentStructuredCall(args: { system: string; userMessage: string; toolName: string;
  toolDescription: string; inputSchema: Anthropic.Tool.InputSchema; maxTokens?: number }) {
  const s = scope.getStore();
  if (!s?.job.contentWork) throw new Error("Missing content provider scope");
  if (!["submit_article", "review_article", "remediate_final_article", "audit_final_article"].includes(args.toolName)) throw new Error(`Unpriced content tool: ${args.toolName}`);
  const cw = s.job.contentWork, p = cw.pricing;
  const request = { model: p.model, max_tokens: Math.min(args.maxTokens ?? 8192, 16384), system: args.system,
    messages: [{ role: "user" as const, content: args.userMessage }],
    tools: [{ name: args.toolName, description: args.toolDescription, input_schema: args.inputSchema }],
    tool_choice: { type: "tool" as const, name: args.toolName, disable_parallel_tool_use: true } };
  // UTF-8 bytes upper-bound text tokens; explicit overhead covers tool/chat
  // framing. No images, cached/premium tool use, web search or thinking enabled.
  const inputBound = Buffer.byteLength(JSON.stringify(request), "utf8") + 8192;
  if (inputBound > 200_000) throw new Error("Content request exceeds priced input bound");
  const ceilingMicroUsd = inputBound * p.inputMicroUsdPerToken + request.max_tokens * p.outputMicroUsdPerToken;
  const key = `${cw.replacements}:${cw.revisions}:${s.phase}:${args.toolName}`;
  await s.ctx.runMutation(internal.contentWork.beginProviderCall, { jobId: s.job._id, workerToken: s.workerToken, key, ceilingMicroUsd });
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, fetch });
  const response = await client.messages.create(request);
  const input = response.usage.input_tokens, output = response.usage.output_tokens;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0 || input > inputBound || output > request.max_tokens) throw new Error("Provider usage receipt missing or over bound");
  await s.ctx.runMutation(internal.contentWork.completeProviderCall, { jobId: s.job._id, workerToken: s.workerToken, key,
    actualMicroUsd: input * p.inputMicroUsdPerToken + output * p.outputMicroUsdPerToken });
  const result = response.content.find(block => block.type === "tool_use" && block.name === args.toolName);
  if (!result || result.type !== "tool_use") throw new Error("Content model response is invalid; no paid schema replay");
  return result.input;
}
