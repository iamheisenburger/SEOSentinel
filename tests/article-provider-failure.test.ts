import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  classifyArticleProviderFailure,
} from "../convex/lib/articleProviderFailure.ts";

test("provider funding and credential failures permit one configured fallback without replay", () => {
  const funding = classifyArticleProviderFailure({
    status: 400,
    error: {
      type: "invalid_request_error",
      message: "Your credit balance is too low to access the API.",
    },
  });
  assert.deepEqual(funding, {
    category: "funding",
    code: "article_provider_funding_unavailable",
    retryable: false,
    fallbackEligible: true,
    safeMessage: "The primary article provider has no available funded capacity.",
  });

  assert.equal(
    classifyArticleProviderFailure({ status: 401, message: "invalid x-api-key" })
      .fallbackEligible,
    true,
  );
  assert.equal(
    classifyArticleProviderFailure(new Error("ANTHROPIC_API_KEY not set"))
      .fallbackEligible,
    true,
  );
});

test("only explicit transient provider failures are retryable", () => {
  for (const error of [
    { status: 429, message: "rate limit" },
    { status: 503, message: "service unavailable" },
    new Error("ECONNRESET"),
    new Error("request timed out"),
  ]) {
    const failure = classifyArticleProviderFailure(error);
    assert.equal(failure.category, "transient");
    assert.equal(failure.retryable, true);
    assert.equal(failure.fallbackEligible, false);
  }

  for (const error of [
    { status: 400, message: "invalid JSON schema" },
    new Error("Worker lease lost"),
    new Error("unexpected local invariant"),
  ]) {
    const failure = classifyArticleProviderFailure(error);
    assert.equal(failure.retryable, false);
    assert.equal(failure.fallbackEligible, false);
  }
});

test("pipeline fallback stays in one attempt while funding pauses the exact job", () => {
  const pipeline = fs.readFileSync(
    new URL("../convex/actions/pipeline.ts", import.meta.url),
    "utf8",
  );
  const reserve = pipeline.indexOf(
    'await reserveArticleProviderAttempt("quality_review")',
  );
  const review = pipeline.indexOf(
    "reviewExistingArticleHandler(ctx",
    reserve,
  );
  const fallback = pipeline.indexOf(
    "using the configured structured-output fallback within the same reserved execution",
  );
  assert.ok(reserve >= 0 && review > reserve);
  assert.ok(fallback >= 0);
  assert.doesNotMatch(
    pipeline.slice(
      pipeline.indexOf("async function callClaudeStructured"),
      pipeline.indexOf("async function fetchHtml"),
    ),
    /reserveArticleProviderAttempt/,
  );
  const terminalStart = pipeline.lastIndexOf(
    "error instanceof ArticleProviderExecutionError",
  );
  const terminalBranch = pipeline.slice(
    terminalStart,
    pipeline.indexOf("if (job.type === \"plan\")", terminalStart),
  );
  assert.match(
    terminalBranch,
    /error\.code === "article_provider_funding_unavailable"[\s\S]*internal\.jobs\.deferArticleProviderFunding/,
  );
  assert.match(terminalBranch, /internal\.jobs\.markFailed/);
});
