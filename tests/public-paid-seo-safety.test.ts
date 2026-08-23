import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");

function exportedActionBlock(name: string, nextMarker: string): string {
  const start = pipeline.indexOf(`export const ${name} = action(`);
  const end = pipeline.indexOf(nextMarker, start);
  assert.ok(start >= 0, `${name} action must exist`);
  assert.ok(end > start, `${name} action must have a stable end marker`);
  return pipeline.slice(start, end);
}

function exportedInternalActionBlock(name: string, nextMarker: string): string {
  const start = pipeline.indexOf(`export const ${name} = internalAction(`);
  const end = pipeline.indexOf(nextMarker, start);
  assert.ok(start >= 0, `${name} internal action must exist`);
  assert.ok(end > start, `${name} internal action must have a stable end marker`);
  return pipeline.slice(start, end);
}

test("legacy public keyword-gap analysis authenticates and fails before paid providers", () => {
  const block = exportedActionBlock(
    "analyzeKeywordGaps",
    "// ── Content Decay Detection ──",
  );
  const authAt = block.indexOf("await requireOwnedSite(ctx, siteId)");
  const disabledAt = block.indexOf("bypasses the tenant provider budget");
  assert.ok(authAt >= 0 && disabledAt > authAt);
  assert.match(block, /reserved planning workflow/);
  assert.doesNotMatch(block, /findKeywordGaps|seoData|openaiClient|callClaude/);
});

test("legacy public topic-metrics backfill authenticates and fails before paid providers", () => {
  const block = exportedActionBlock("backfillTopicMetrics", "\n});");
  const authAt = block.indexOf("await requireOwnedSite(ctx, siteId)");
  const disabledAt = block.indexOf("bypasses the tenant provider budget");
  assert.ok(authAt >= 0 && disabledAt > authAt);
  assert.match(block, /reserved planning workflow/);
  assert.doesNotMatch(block, /getKeywordMetrics|analyzeSERP|seoData|openaiClient|callClaude/);
});

test("the supported public planning path still enters the durable reservation ledger", () => {
  const block = exportedActionBlock(
    "generatePlan",
    "export const generateArticle = action(",
  );
  assert.match(block, /internal\.jobs\.queuePlanIfAbsent/);
  assert.match(block, /reason: "owner_requested_plan"/);
  assert.match(block, /manual: true/);
});

test("legacy internal SERP fingerprint migration fails before paid providers", () => {
  const block = exportedInternalActionBlock(
    "backfillTopicSerpFingerprints",
    "// ── Backfill SEO Metrics for Existing Topics ──",
  );
  const siteAt = block.indexOf("internal.sites.getFull");
  const disabledAt = block.indexOf("bypasses the shared provider reservation");
  assert.ok(siteAt >= 0 && disabledAt > siteAt);
  assert.match(block, /metered expected-click evidence backfill workflow/);
  assert.doesNotMatch(
    block,
    /analyzeSERP|seoData|runAfter|updateSEOMetrics|callClaude|openaiClient/,
  );
});

for (const legacy of [
  {
    name: "generateProgrammaticTemplate",
    next: "// News generator",
    message: /bypasses article quota and provider budgets/,
    replacement: /metered article workflow/,
  },
  {
    name: "generateNewsArticle",
    next: "// Backlink suggestions",
    message: /bypasses article quota and provider budgets/,
    replacement: /metered article workflow/,
  },
  {
    name: "suggestBacklinks",
    next: "// Autopilot tick:",
    message: /model-invented prospects are not verified authority evidence/,
    replacement: /metered Backlinks approval workflow/,
  },
] as const) {
  test(`${legacy.name} authenticates and fails before any provider call`, () => {
    const block = exportedActionBlock(legacy.name, legacy.next);
    const authAt = block.indexOf("await requireOwnedSite(ctx, siteId)");
    const disabledAt = block.indexOf("throw new Error(");
    assert.ok(authAt >= 0 && disabledAt > authAt);
    assert.match(block, legacy.message);
    assert.match(block, legacy.replacement);
    assert.doesNotMatch(
      block,
      /callClaude|openaiClient|getKeywordMetrics|getDomainAuthorit|seoData/,
    );
  });
}
