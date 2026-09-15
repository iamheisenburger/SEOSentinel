import assert from "node:assert/strict";
import test from "node:test";
import { contentToolRequest } from "../convex/lib/contentToolRequest.ts";
import { sha256Hex } from "../convex/lib/publicationArtifact.ts";

const args = { model: "synthetic-model", system: "Synthetic system", userMessage: "Synthetic question",
  toolName: "submit_article", toolDescription: "Synthetic draft", maxTokens: 16384,
  inputSchema: { type: "object" as const, additionalProperties: false,
    properties: { title: { type: "string", maxLength: 60 }, keywords: { type: "array", items: { type: "string" }, minItems: 1 } },
    required: ["title", "keywords"] } };
const legacy = { model: args.model, max_tokens: args.maxTokens, system: args.system,
  messages: [{ role: "user", content: args.userMessage }],
  tools: [{ name: args.toolName, description: args.toolDescription, input_schema: args.inputSchema }],
  tool_choice: { type: "tool", name: args.toolName, disable_parallel_tool_use: true } };

test("new content calls enforce required tool fields with an API-compatible schema and unchanged source constraints", () => {
  const before = JSON.stringify(args);
  const request = contentToolRequest(args), tool = request.tools[0];
  assert.equal("strict" in tool && tool.strict, true);
  assert.deepEqual(tool.input_schema.required, ["title", "keywords"]);
  const title = (tool.input_schema.properties as Record<string, unknown>).title as Record<string, unknown>;
  assert.equal(title.maxLength, undefined);
  assert.match(String(title.description), /60/);
  assert.equal(JSON.stringify(args), before);
  assert.equal(request.max_tokens, 16384);
});

test("exact legacy and strict checkpoint hashes keep stable serialized requests across worker restarts", () => {
  const oldHash = sha256Hex(JSON.stringify(legacy));
  assert.equal(JSON.stringify(contentToolRequest(args, oldHash)), JSON.stringify(legacy));
  const strict = contentToolRequest(args), hash = sha256Hex(JSON.stringify(strict));
  assert.equal(JSON.stringify(contentToolRequest(args, hash)), JSON.stringify(strict));
  assert.notEqual(hash, oldHash);
});

test("changing content cannot reuse a retained request hash or opt out of strict tool schema", () => {
  const oldHash = sha256Hex(JSON.stringify(legacy));
  const changed = contentToolRequest({ ...args, userMessage: "Changed question" }, oldHash);
  assert.notEqual(sha256Hex(JSON.stringify(changed)), oldHash);
  assert.equal("strict" in changed.tools[0] && changed.tools[0].strict, true);
});
