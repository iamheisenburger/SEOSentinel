import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("paid SEO provider failures expose stable status codes, never response messages", () => {
  const seoData = readFileSync("convex/actions/seoData.ts", "utf8");

  assert.match(seoData, /timeoutMs = 20_000/);
  assert.match(seoData, /signal: AbortSignal\.timeout\(timeoutMs\)/);
  assert.match(
    seoData,
    /"serp\/google\/organic\/live\/regular"[\s\S]*?depth: 10,[\s\S]*?45_000/,
  );
  assert.equal(
    (seoData.match(/\n\s{4}45_000,\n/g) ?? []).length,
    1,
    "only the one-shot live organic SERP request overrides the DataForSEO timeout",
  );
  assert.doesNotMatch(seoData, /status_message/);
  assert.doesNotMatch(seoData, /await\s+response\.text\(\)/);
  assert.match(seoData, /DataForSEO task failed with status code/);
});
