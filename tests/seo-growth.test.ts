import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aggregateSearchQueries,
  isBrandedSearchQuery,
  summarizeSearchPerformance,
} from "../convex/lib/searchPerformance.ts";
import {
  classifySeoGrowth,
  growthActionFingerprint,
  inspectedIndexState,
  type SeoGrowthInput,
  type SeoWindow,
} from "../convex/lib/seoGrowth.ts";

function window(
  days: number,
  overrides: Partial<SeoWindow> = {},
): SeoWindow {
  return {
    days,
    complete: true,
    clicks: 0,
    impressions: 0,
    ctr: 0,
    position: null,
    nonBrandedClicks: 0,
    nonBrandedImpressions: 0,
    nonBrandedCtr: 0,
    nonBrandedPosition: null,
    ...overrides,
  };
}

function input(overrides: Partial<SeoGrowthInput> = {}): SeoGrowthInput {
  return {
    articleId: "article-1",
    startDate: "2026-07-01",
    dataThrough: "2026-07-28",
    indexInspection: { verdict: "PASS", coverageState: "Submitted and indexed" },
    windows: [window(7), window(14), window(28)],
    ...overrides,
  };
}

test("rolling performance reports the full explicit window and branded split", () => {
  const rows = [
    {
      date: "2026-07-27",
      query: "leadpilot login",
      clicks: 1,
      impressions: 4,
      position: 2,
      createdAt: 1,
    },
    {
      date: "2026-07-28",
      query: "website lead qualification",
      clicks: 3,
      impressions: 100,
      position: 8,
      createdAt: 2,
    },
  ];
  const summary = summarizeSearchPerformance(rows, "https://leadpilot.chat");
  assert.equal(summary.totalClicks, 4);
  assert.equal(summary.nonBrandedClicks, 3);
  assert.equal(summary.totalImpressions, 104);
  assert.equal(summary.nonBrandedImpressions, 100);
  assert.equal(summary.dataDays, 2);
  assert.equal(isBrandedSearchQuery("LeadPilot pricing", "leadpilot.chat"), true);
});

test("top query aggregation does not present one daily row as the query total", () => {
  const aggregated = aggregateSearchQueries([
    { date: "2026-07-27", query: "saas seo", clicks: 1, impressions: 10, position: 8, createdAt: 1 },
    { date: "2026-07-28", query: "saas seo", clicks: 2, impressions: 20, position: 6, createdAt: 2 },
    { date: "2026-07-28", query: "other", clicks: 0, impressions: 50, position: 30, createdAt: 2 },
  ]);
  assert.equal(aggregated[0].query, "saas seo");
  assert.equal(aggregated[0].clicks, 3);
  assert.equal(aggregated[0].impressions, 30);
  assert.equal(aggregated[0].position, 6.7);
});

test("young pages are observed instead of being declared SEO failures", () => {
  const classification = classifySeoGrowth(input({
    dataThrough: "2026-07-05",
    indexInspection: { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" },
    windows: [window(7, { complete: false })],
  }));
  assert.equal(classification.stage, "indexing_pending");
  assert.equal(classification.actionKind, "observe");
});

test("technical indexing blocks outrank every content recommendation", () => {
  assert.equal(
    inspectedIndexState({ robotsTxtState: "DISALLOWED" }),
    "blocked",
  );
  const classification = classifySeoGrowth(input({
    indexInspection: { pageFetchState: "BLOCKED_BY_ROBOTS_TXT" },
  }));
  assert.equal(classification.actionKind, "repair_technical_indexing");
  assert.equal(classification.priority, 100);
});

test("a not-indexed URL becomes a discovery repair only after 14 complete days", () => {
  const classification = classifySeoGrowth(input({
    dataThrough: "2026-07-14",
    indexInspection: { verdict: "NEUTRAL", coverageState: "Discovered - currently not indexed" },
    windows: [window(7), window(14)],
  }));
  assert.equal(classification.stage, "indexing_stalled");
  assert.equal(classification.actionKind, "repair_discovery");
});

test("28 days without non-branded visibility forces opportunity reassessment", () => {
  const classification = classifySeoGrowth(input());
  assert.equal(classification.stage, "no_visibility");
  assert.equal(classification.actionKind, "reassess_opportunity");
});

test("positions 4-20 create a cluster-strengthening action", () => {
  const classification = classifySeoGrowth(input({
    windows: [window(28, {
      impressions: 30,
      position: 12,
      nonBrandedImpressions: 30,
      nonBrandedPosition: 12,
    })],
  }));
  assert.equal(classification.stage, "striking_distance");
  assert.equal(classification.actionKind, "strengthen_cluster");
});

test("a mature striking-distance page escalates to verified authority work", () => {
  const classification = classifySeoGrowth(input({
    dataThrough: "2026-08-25",
    windows: [window(56, {
      impressions: 100,
      position: 14,
      nonBrandedImpressions: 100,
      nonBrandedPosition: 14,
    })],
  }));
  assert.equal(classification.stage, "striking_distance");
  assert.equal(classification.actionKind, "build_authority");
});

test("page-one impressions with weak CTR create a snippet action", () => {
  const classification = classifySeoGrowth(input({
    windows: [window(28, {
      impressions: 100,
      position: 7,
      nonBrandedImpressions: 100,
      nonBrandedPosition: 7,
      nonBrandedCtr: 0.01,
      ctr: 0.01,
    })],
  }));
  assert.equal(classification.stage, "low_ctr");
  assert.equal(classification.actionKind, "improve_snippet");
});

test("measured organic clicks preserve a performing page", () => {
  const classification = classifySeoGrowth(input({
    windows: [window(28, {
      clicks: 3,
      impressions: 50,
      nonBrandedClicks: 3,
      nonBrandedImpressions: 50,
      position: 9,
      nonBrandedPosition: 9,
    })],
  }));
  assert.equal(classification.stage, "performing");
  assert.equal(classification.actionKind, "observe");
});

test("growth action fingerprints are stable and tenant-scoped", () => {
  const classification = classifySeoGrowth(input());
  assert.equal(
    growthActionFingerprint("site-a", classification),
    growthActionFingerprint("site-a", classification),
  );
  assert.notEqual(
    growthActionFingerprint("site-a", classification),
    growthActionFingerprint("site-b", classification),
  );
});

test("the final editor runs before internal-link injection and exact resealing", () => {
  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  const finalReview = pipeline.indexOf("const finalReview = await reviewExistingArticleHandler");
  const sealedLinks = pipeline.indexOf("finalReview.contentHash", finalReview);
  assert.ok(finalReview >= 0 && sealedLinks > finalReview);
  assert.doesNotMatch(pipeline, /internal\.actions\.backlinks\.quickBacklinkScan/);

  const articles = readFileSync("convex/articles.ts", "utf8");
  assert.match(articles, /applyInternalLinksToSealedArtifact/);
  assert.match(articles, /Internal links can only be applied to the exact sealed review/);
});

test("growth allocation learns from measured clusters without inventing new evidence", () => {
  const controller = readFileSync("convex/seoGrowth.ts", "utf8");
  assert.match(controller, /prioritizeVerifiedSupportingTopic/);
  assert.match(controller, /deprioritizeFailedOpportunityCluster/);
  assert.match(controller, /serpTopUrls\?\.length/);
  assert.match(controller, /searchVolume/);
  assert.match(controller, /keywordDifficulty/);
});

test("an uninitialized page rollup cannot be mistaken for zero visibility", () => {
  const controller = readFileSync("convex/actions/seoGrowth.ts", "utf8");
  assert.match(controller, /const rollupReady = input\.rows\.length > 0/);
  assert.match(controller, /rollupReady &&[\s\S]{0,100}input\.dataThrough/);
});

test("authority opportunities require a fetched public page before outreach drafting", () => {
  const backlinks = readFileSync("convex/actions/backlinks.ts", "utf8");
  assert.match(backlinks, /safeFetchPublicText/);
  assert.match(backlinks, /upsertVerifiedBatch/);
  assert.match(backlinks, /getVerifiedBySource/);
  assert.match(backlinks, /compatibility no-op/);
  assert.doesNotMatch(
    backlinks.slice(backlinks.indexOf("export const quickBacklinkScan")),
    /You are a backlink strategist/,
  );
});
