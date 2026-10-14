import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  anthropicResponseText,
  plainTextMaxTokens,
  PLAIN_TEXT_MIN_MAX_TOKENS,
} from "../convex/lib/anthropicText.ts";

test("text after an adaptive thinking block is the answer", () => {
  assert.equal(
    anthropicResponseText({
      content: [
        { type: "thinking", text: undefined },
        { type: "text", text: '{"niche":"saas"' },
        { type: "text", text: ',"tone":"plain"}' },
      ],
      stop_reason: "end_turn",
    }),
    '{"niche":"saas","tone":"plain"}',
  );
});

test("a response with only thinking fails loudly and names the output limit", () => {
  assert.throws(
    () => anthropicResponseText({ content: [{ type: "thinking" }], stop_reason: "max_tokens" }),
    /output limit before writing any text/,
  );
  assert.throws(
    () => anthropicResponseText({ content: [{ type: "text", text: "  " }], stop_reason: "end_turn" }),
    /no text/,
  );
});

test("small plain-text budgets get room for thinking; large ones are unchanged", () => {
  assert.equal(plainTextMaxTokens(512), PLAIN_TEXT_MIN_MAX_TOKENS);
  assert.equal(plainTextMaxTokens(1024), PLAIN_TEXT_MIN_MAX_TOKENS);
  assert.equal(plainTextMaxTokens(16384), 16384);
});

test("no Convex code reads a Claude answer by block position", () => {
  const files = ["convex/actions", "convex/lib", "convex"].flatMap((dir) =>
    readdirSync(dir).filter((name) => name.endsWith(".ts")).map((name) => `${dir}/${name}`),
  );
  const offenders = files.filter((file) => /response\.content\[0\]/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("no Convex code pins the retiring Claude Haiku 4.5", () => {
  const files = ["convex/actions", "convex/lib", "convex"].flatMap((dir) =>
    readdirSync(dir).filter((name) => name.endsWith(".ts")).map((name) => `${dir}/${name}`),
  );
  const offenders = files.filter((file) => readFileSync(file, "utf8").includes("claude-haiku-4-5"));
  assert.deepEqual(offenders, []);
});
