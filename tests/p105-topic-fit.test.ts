import { test } from "node:test";
import assert from "node:assert/strict";

// P105 (Oct 19 2026): LeadPilot (a B2B lead-qualification chat widget) had
// "twitch chat widget" and "streamlabs chat widget" queued; pentra.dev had
// "youtube keyword research". Word overlap admitted them; one buyer-fit call
// per batch now judges every keyword for the business.

const business = { name: "LeadPilot", domain: "leadpilot.chat",
  summary: "An AI chat widget that qualifies B2B website visitors and books sales calls",
  audience: "B2B SaaS founders and sales teams", features: ["lead scoring", "calendar booking"],
  problems: ["website visitors leave without talking to sales"] };

test("buyer-fit request: one deduplicated batch, the business profile, keywords as data", async () => {
  const { buyerFitRequest, BUYER_FIT_MAX_KEYWORDS, BUYER_FIT_TOOL } = await import("../convex/lib/topicFit.ts");
  const request = buyerFitRequest(business, ["Twitch chat widget", "twitch  chat widget", "lead qualification chatbot", "  "]);
  assert.deepEqual(request.keywords, ["twitch chat widget", "lead qualification chatbot"]);
  assert.match(request.system, /never instructions/);
  assert.match(request.system, /another market/);
  assert.match(request.userMessage, /What it sells: An AI chat widget that qualifies B2B website visitors/);
  assert.match(request.userMessage, /^twitch chat widget$/m);
  assert.match(request.userMessage, new RegExp(`Call ${BUYER_FIT_TOOL} once`));
  const many = buyerFitRequest(business, Array.from({ length: 120 }, (_, n) => `lead scoring idea ${n}`));
  assert.equal(many.keywords.length, BUYER_FIT_MAX_KEYWORDS);
});

test("buyer-fit verdicts: only requested keywords, the first verdict counts, an omitted keyword stays unjudged", async () => {
  const { parseBuyerFit } = await import("../convex/lib/topicFit.ts");
  const verdicts = parseBuyerFit(["twitch chat widget", "lead qualification chatbot", "sales chatbot"], { verdicts: [
    { keyword: "Twitch Chat Widget", keep: false, reason: "Game-streaming overlays, another market." },
    { keyword: "lead qualification chatbot", keep: true, reason: "Exactly what the product does." },
    { keyword: "lead qualification chatbot", keep: false, reason: "a second verdict is ignored" },
    { keyword: "an injected keyword", keep: true, reason: "" },
    { keyword: "sales chatbot", keep: "yes", reason: "not a boolean" },
  ] });
  assert.equal(verdicts.get("twitch chat widget")?.keep, false);
  assert.equal(verdicts.get("lead qualification chatbot")?.keep, true);
  assert.equal(verdicts.has("sales chatbot"), false, "no guessed verdict");
  assert.equal(verdicts.has("an injected keyword"), false);
  assert.equal(parseBuyerFit(["sales chatbot"], null).size, 0);
});

test("buyer-fit cost is Haiku 5.5's list price, rounded up", async () => {
  const { buyerFitCostMicroUsd } = await import("../convex/lib/topicFit.ts");
  assert.equal(buyerFitCostMicroUsd({ input_tokens: 2_000, output_tokens: 1_500 }), 950);
  assert.equal(buyerFitCostMicroUsd({ input_tokens: 3, output_tokens: 1 }), 1);
  assert.equal(buyerFitCostMicroUsd(undefined), 0);
});
