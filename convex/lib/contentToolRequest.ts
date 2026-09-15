import type Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { sha256Hex } from "./publicationArtifact.ts";

export function contentToolRequest(args: { model: string; system: string; userMessage: string;
  toolName: string; toolDescription: string; inputSchema: Anthropic.Tool.InputSchema; maxTokens?: number }, savedRequestHash?: string) {
  const legacy = { model: args.model, max_tokens: Math.min(args.maxTokens ?? 8192, 16384), system: args.system,
    messages: [{ role: "user" as const, content: args.userMessage }],
    tools: [{ name: args.toolName, description: args.toolDescription, input_schema: args.inputSchema }],
    tool_choice: { type: "tool" as const, name: args.toolName, disable_parallel_tool_use: true } };
  // The exact old hash alone selects old bytes. A changed prompt/schema still
  // fails the existing admission hash check; this is not permission to replay.
  if (savedRequestHash === sha256Hex(JSON.stringify(legacy))) return legacy;
  return { ...legacy, tools: [{ ...legacy.tools[0], strict: true,
    // SDK transformation preserves constraint descriptions and removes fields
    // rejected by strict sampling. Original parsing/quality gates still apply.
    input_schema: jsonSchemaOutputFormat(args.inputSchema as Parameters<typeof jsonSchemaOutputFormat>[0]).schema as Anthropic.Tool.InputSchema }],
  };
}
