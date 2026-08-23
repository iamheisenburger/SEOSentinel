import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("paid SEO provider failures expose stable status codes, never response messages", () => {
  const seoData = readFileSync("convex/actions/seoData.ts", "utf8");

  assert.match(seoData, /signal: AbortSignal\.timeout\(20_000\)/);
  assert.doesNotMatch(seoData, /status_message/);
  assert.doesNotMatch(seoData, /await\s+response\.text\(\)/);
  assert.match(seoData, /DataForSEO task failed with status code/);
});
