import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("convex/actions/seoData.ts", "utf8");

test("SEO model diagnostics have a bounded no-retry provider contract", () => {
  assert.match(
    source,
    /export const SEO_DIAGNOSTIC_OPENAI_TIMEOUT_MS = 45_000;/,
  );
  assert.match(
    source,
    /timeout: SEO_DIAGNOSTIC_OPENAI_TIMEOUT_MS,[\s\S]*maxRetries: 0/,
  );
  assert.doesNotMatch(source, /new OpenAI\(\{ apiKey \}\)/);
  assert.equal(
    source.match(/createBoundedSeoDiagnosticOpenAI\(apiKey\)/g)?.length,
    4,
  );
});
