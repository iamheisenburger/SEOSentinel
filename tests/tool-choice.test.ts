import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { contentToolRequest } from "../convex/lib/contentToolRequest.ts";
import { forcedToolChoiceSupported, structuredToolChoice } from "../convex/lib/toolChoice.ts";
import { isProviderRequestRefusal } from "../convex/lib/contentProviderRefusal.ts";
import { sha256Hex } from "../convex/lib/publicationArtifact.ts";

const args = { system: "Synthetic system", userMessage: "Synthetic question", toolName: "submit_article", toolDescription: "Synthetic draft",
  maxTokens: 16384, inputSchema: { type: "object" as const, additionalProperties: false,
    properties: { title: { type: "string" } }, required: ["title"] } };

test("Haiku and Claude 3/4 models are forced to the tool; Sonnet/Opus 5 and later are not", () => {
  for (const model of ["claude-haiku-5-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8",
    "claude-sonnet-4-5-20250929", "claude-opus-4-1-20250805", "claude-3-5-sonnet-20241022", "mocked-content-model"]) {
    assert.equal(forcedToolChoiceSupported(model), true, model);
    assert.deepEqual(structuredToolChoice(model, "x"), { type: "tool", name: "x", disable_parallel_tool_use: true });
  }
  for (const model of ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "claude-opus-5"]) {
    assert.equal(forcedToolChoiceSupported(model), false, model);
    assert.deepEqual(structuredToolChoice(model, "x"), { type: "auto", disable_parallel_tool_use: true });
  }
});

test("a forced model's request bytes are unchanged, so in-flight checkpoints keep their hashes", () => {
  const haiku = contentToolRequest({ ...args, model: "claude-haiku-5-5" });
  assert.deepEqual(haiku.tool_choice, { type: "tool", name: "submit_article", disable_parallel_tool_use: true });
  assert.equal(haiku.system, args.system);
  assert.deepEqual(Object.keys(haiku), ["model", "max_tokens", "system", "messages", "tools", "tool_choice"]);
});

test("an unforced model gets auto, the strict tool and an instruction to answer through it; hashes are stable", () => {
  const sonnet = contentToolRequest({ ...args, model: "claude-sonnet-5-5" });
  assert.deepEqual(sonnet.tool_choice, { type: "auto", disable_parallel_tool_use: true });
  assert.equal(sonnet.tools.length, 1); assert.equal("strict" in sonnet.tools[0] && sonnet.tools[0].strict, true);
  assert.match(sonnet.system, /^Synthetic system\n\nAnswer only by calling the submit_article tool once/);
  const hash = sha256Hex(JSON.stringify(sonnet));
  assert.equal(sha256Hex(JSON.stringify(contentToolRequest({ ...args, model: "claude-sonnet-5-5" }, hash))), hash);
});

test("only refusals of the request itself are definitive", () => {
  for (const [status, type] of [[400, "invalid_request_error"], [401, "authentication_error"], [403, "permission_error"],
    [404, "not_found_error"], [413, "request_too_large"]] as const) assert.equal(isProviderRequestRefusal(status, type), true, `${status}`);
  for (const [status, type] of [[429, "rate_limit_error"], [529, "overloaded_error"], [500, "api_error"], [400, "not_found_error"],
    [undefined, "invalid_request_error"], [400, undefined]] as const) assert.equal(isProviderRequestRefusal(status, type), false, `${status} ${type}`);
});

test("no Convex code forces a tool outside the model-aware helper", () => {
  const files = ["convex/actions", "convex/lib", "convex"].flatMap((dir) =>
    readdirSync(dir).filter((name) => name.endsWith(".ts")).map((name) => `${dir}/${name}`));
  const offenders = files.filter((file) => file !== "convex/lib/contentToolRequest.ts" && file !== "convex/lib/toolChoice.ts" &&
    /tool_choice:\s*\{\s*type:\s*"(tool|any)"/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});
