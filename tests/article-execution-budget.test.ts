import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  ARTICLE_EXECUTION_PROVIDER_BUDGET_MS, ARTICLE_PROVIDER_REQUEST_TIMEOUT_MS,
  articleProviderTransportOptions, boundedArticleProviderFetch,
  withArticleExecutionBudget,
} from "../convex/lib/articleExecutionBudget.ts";
import { classifyArticleProviderFailure } from "../convex/lib/articleProviderFailure.ts";

test("provider requests have a no-retry limit below the action checkpoint budget", () => {
  const options = articleProviderTransportOptions();
  assert.equal(options.maxRetries, 0);
  assert.equal(options.timeout, ARTICLE_PROVIDER_REQUEST_TIMEOUT_MS);
  assert.ok(options.timeout < ARTICLE_EXECUTION_PROVIDER_BUDGET_MS);
  assert.ok(ARTICLE_EXECUTION_PROVIDER_BUDGET_MS < 10 * 60_000);
  assert.equal(options.fetch, boundedArticleProviderFetch);
});

test("expired and nested budgets never issue paid requests; concurrent tenants remain independent", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("ok"); });
  await Promise.all([
    withArticleExecutionBudget(async () => {
      await delay(35);
      await assert.rejects(
        withArticleExecutionBudget(() => boundedArticleProviderFetch("https://example.invalid"), 1000),
        /request timed out/,
      );
    }, 20),
    withArticleExecutionBudget(async () => {
      await delay(40);
      assert.equal(await (await boundedArticleProviderFetch("https://example.invalid")).text(), "ok");
    }, 1000),
  ]);
  assert.equal(calls, 1);
  // No leaked deadline after the worker's async scope ends.
  await boundedArticleProviderFetch("https://example.invalid");
  assert.equal(calls, 2);
});

test("execution deadline aborts stalled response bodies, not just the header request", async (t) => {
  let transportAborted = false;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    return new Response(new ReadableStream({ start(controller) {
      init.signal!.addEventListener("abort", () => {
        transportAborted = true;
        controller.error(init.signal!.reason);
      }, { once: true });
    } }));
  });
  await Promise.all([
    withArticleExecutionBudget(async () => {
      const response = await boundedArticleProviderFetch("https://example.invalid");
      await assert.rejects(response.text(), (error: Error) => {
        assert.equal(error.name, "TimeoutError");
        const failure = classifyArticleProviderFailure(new Error("Connection error.", { cause: error }));
        assert.equal(failure.retryable, true);
        assert.equal(failure.fallbackEligible, false);
        return true;
      });
    }, 20),
    delay(40),
  ]);
  assert.equal(transportAborted, true);
});

test("caller cancellation survives the provider deadline and is not treated as a timeout", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    assert.equal(init.signal!.aborted, true);
    throw init.signal!.reason;
  });
  controller.abort(new Error("Worker lease lost"));
  await assert.rejects(withArticleExecutionBudget(() => boundedArticleProviderFetch(
    new Request("https://example.invalid", { signal: controller.signal }),
  )), /Worker lease lost/);
  assert.equal(classifyArticleProviderFailure(controller.signal.reason).retryable, false);
});

test("both real SDK transports abort within the shared budget without hidden retries or fallback", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      if (init.signal!.aborted) reject(init.signal!.reason);
      else init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    });
  });
  const options = { apiKey: "test-not-a-credential", ...articleProviderTransportOptions() };
  const anthropic = new Anthropic(options);
  const openai = new OpenAI(options);
  const requests = [
    () => anthropic.messages.create({ model: "test-model", max_tokens: 1, messages: [{ role: "user", content: "test" }] }),
    () => openai.responses.create({ model: "test-model", input: "test" }),
  ];
  for (const request of requests) {
    const before = calls;
    await Promise.all([
      assert.rejects(withArticleExecutionBudget(async () => await request(), 150), error => {
        const failure = classifyArticleProviderFailure(error);
        assert.equal(failure.retryable, true);
        assert.equal(failure.fallbackEligible, false);
        return true;
      }),
      delay(175),
    ]);
    assert.equal(calls, before + 1);
  }
});

test("the actual generation path checkpoints before factual review and fences the final update", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const generation = pipeline.slice(pipeline.indexOf("async function handleArticle("), pipeline.indexOf("async function handleLinks("));
  assert.ok(generation.indexOf("internal.articles.createDraftForJob") < generation.indexOf("await factCheckArticle("));
  assert.match(generation, /expectedCheckpointHash: publicationArtifactHash\(generatedCheckpoint\)/);
  assert.match(pipeline, /budgetCandidate\?\.type === "article"\s*\? await withArticleExecutionBudget\(execute\)/);
  assert.equal(pipeline.match(/\.\.\.articleProviderTransportOptions\(\)/g)?.length, 2);
});
