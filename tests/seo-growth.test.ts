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
  isSeoGrowthActuationEligible,
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
    unattributedClicks: 0,
    unattributedImpressions: 0,
    queryCoverageComplete: true,
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

test("page impressions without query coverage cannot be classified as no visibility", () => {
  const classification = classifySeoGrowth(input({
    windows: [window(28, {
      impressions: 40,
      position: 9,
      nonBrandedImpressions: 0,
      unattributedImpressions: 40,
      queryCoverageComplete: false,
    })],
  }));
  assert.notEqual(classification.stage, "no_visibility");
  assert.notEqual(classification.stage, "striking_distance");
  assert.equal(classification.stage, "awaiting_data");
  assert.equal(classification.actionKind, "observe");
  assert.equal(classification.evidence.impressions, 40);
  assert.equal(classification.evidence.unattributedImpressions, 40);
  assert.equal(classification.evidence.queryCoverageComplete, false);
  assert.match(classification.reason, /reporting only/i);
});

test("hidden-query clicks and overall position cannot create a non-brand growth action", () => {
  const classification = classifySeoGrowth(input({
    windows: [window(28, {
      clicks: 10,
      impressions: 100,
      ctr: 0.1,
      position: 7,
      nonBrandedClicks: 0,
      nonBrandedImpressions: 0,
      unattributedClicks: 10,
      unattributedImpressions: 100,
      queryCoverageComplete: false,
    })],
  }));
  assert.equal(classification.stage, "awaiting_data");
  assert.equal(classification.actionKind, "observe");
  assert.notEqual(classification.stage, "performing");
  assert.notEqual(classification.stage, "striking_distance");
});

test("known non-brand query evidence remains actionable when unrelated query rows are hidden", () => {
  const classification = classifySeoGrowth(input({
    windows: [window(28, {
      impressions: 80,
      position: 4,
      nonBrandedImpressions: 30,
      nonBrandedPosition: 12,
      unattributedImpressions: 50,
      queryCoverageComplete: false,
    })],
  }));
  assert.equal(classification.stage, "striking_distance");
  assert.equal(classification.actionKind, "strengthen_cluster");
  assert.equal(classification.evidence.nonBrandedPosition, 12);
  assert.equal(classification.evidence.position, 4);
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

test("SEO growth actuation is disabled/off and observe-only, but enabled for warm/live", () => {
  assert.equal(isSeoGrowthActuationEligible({
    autopilotEnabled: false,
    autopilotRolloutMode: "live",
  }), false);
  assert.equal(isSeoGrowthActuationEligible({
    autopilotEnabled: true,
    autopilotRolloutMode: "observe",
  }), false);
  assert.equal(isSeoGrowthActuationEligible({
    autopilotEnabled: true,
    autopilotRolloutMode: "warm",
  }), true);
  assert.equal(isSeoGrowthActuationEligible({
    autopilotEnabled: true,
    autopilotRolloutMode: "live",
  }), true);
});

test("fleet growth reconciliation keeps tenant boundaries and rollout-gates every actuator", () => {
  const controller = readFileSync("convex/seoGrowth.ts", "utf8");
  const runner = readFileSync("convex/actions/seoGrowth.ts", "utf8");
  assert.match(
    controller,
    /const actuationEligible = isSeoGrowthActuationEligible\(currentSite\)/,
  );
  assert.match(
    controller,
    /!article \|\| article\.siteId !== siteId \|\| article\.status !== "published"/,
  );
  assert.match(controller, /if \(!actuationEligible && desiredStatus === "open"\)/);
  for (const actuator of [
    "discoveryRepairRequests.push",
    "authorityRequests.push",
    "prioritizeVerifiedSupportingTopic",
    "deprioritizeFailedOpportunityCluster",
  ]) {
    const firstActuator = controller.indexOf(actuator, controller.indexOf("export const reconcileSite"));
    assert.ok(firstActuator >= 0, `missing ${actuator}`);
    assert.ok(
      controller.lastIndexOf("actuationEligible", firstActuator) >=
        controller.indexOf("export const reconcileSite"),
      `${actuator} is not preceded by the tenant rollout gate`,
    );
  }
  assert.match(runner, /async function growthActuationStillEligible/);
  assert.match(runner, /isSeoGrowthActuationEligible\(site\)/);
  assert.ok(
    (runner.match(/await growthActuationStillEligible\(ctx, siteId\)/g) ?? [])
      .length >= 4,
    "every post-reconciliation external actuator must recheck the current rollout",
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
  assert.match(articles, /quarantineLinkSealFailure/);
  assert.match(articles, /publicationAuditVersion: undefined/);
});

test("growth allocation learns from measured clusters without inventing new evidence", () => {
  const controller = readFileSync("convex/seoGrowth.ts", "utf8");
  assert.match(controller, /prioritizeVerifiedSupportingTopic/);
  assert.match(controller, /deprioritizeFailedOpportunityCluster/);
  assert.match(controller, /serpTopUrls\?\.length/);
  assert.match(controller, /searchVolume/);
  assert.match(controller, /keywordDifficulty/);
  assert.doesNotMatch(controller, /topic\.label === sourceTopic\.label/);
  assert.match(controller, /growthParentArticleId: articleId/);
  assert.match(controller, /recordSupportArticleOutcome/);
  assert.match(controller, /support_failed/);

  const runner = readFileSync("convex/actions/seoGrowth.ts", "utf8");
  assert.match(runner, /seo_growth_support_replenishment/);
  assert.match(runner, /maximumRecent: 1/);
  assert.match(runner, /24 \* 60 \* 60 \* 1000/);

  const pipeline = readFileSync("convex/actions/pipeline.ts", "utf8");
  assert.match(
    pipeline,
    /growthContext \? 3 : AUTOMATIC_PLAN_TOPIC_CAPACITY/,
  );
  assert.match(pipeline, /const planLimit = planTopicLimit/);
  assert.match(pipeline, /preferredGrowthTarget/);
  assert.match(pipeline, /Measured growth support article did not contain/);
  assert.match(pipeline, /support_ready/);

  const articles = readFileSync("convex/articles.ts", "utf8");
  assert.match(articles, /exact external publication receipt/);
  assert.match(articles, /automationStatus: "executed"/);
});

test("an uninitialized page rollup cannot be mistaken for zero visibility", () => {
  const controller = readFileSync("convex/actions/seoGrowth.ts", "utf8");
  const inputs = readFileSync("convex/seoGrowth.ts", "utf8");
  assert.match(
    controller,
    /complete: isCompleteGscDateRange\(/,
  );
  assert.match(
    controller,
    /input\.dateEpochs,[\s\S]{0,100}startDate,[\s\S]{0,100}expectedEndDate/,
  );
  assert.match(inputs, /dateEpochs: receipts/);
  assert.match(inputs, /filterRowsForGscReceipts\(rowCandidates, receipts\)/);
  assert.match(inputs, /dataWindowStart: site\.gscDataWindowStart/);
  assert.match(inputs, /dataThrough: site\.gscDataThrough/);

  const scorecard = readFileSync("convex/searchPerformance.ts", "utf8");
  assert.match(
    scorecard,
    /isCompleteGscDateRange\(receipts, startDate, expectedEndDate\)/,
  );
});

test("article scorecards separate page totals from incomplete query attribution", () => {
  const scorecard = readFileSync(
    "src/app/(dashboard)/articles/[id]/page.tsx",
    "utf8",
  );
  for (const label of [
    "Total page imp.",
    "Known non-brand imp.",
    "Hidden-query imp.",
    "Total avg position",
    "Known non-brand pos.",
  ]) {
    assert.match(scorecard, new RegExp(label.replace(".", "\\.")));
  }
  assert.match(scorecard, /window\.queryCoverageComplete/);
  assert.match(scorecard, /Query detail partial/);
  assert.match(scorecard, /impressions hidden or anonymized/);
  assert.match(scorecard, /evidenceWindow\.impressions > 0/);
  assert.match(scorecard, /will not use the overall position for an autonomous ranking action/);
  assert.doesNotMatch(
    scorecard,
    /No article-level Search Console impressions have been recorded yet/,
  );
});

test("authority opportunities require a fetched public page before outreach drafting", () => {
  const backlinks = readFileSync("convex/actions/backlinks.ts", "utf8");
  const outreach = readFileSync("convex/actions/outreach.ts", "utf8");
  assert.match(backlinks, /safeFetchPublicText/);
  assert.match(backlinks, /upsertVerifiedBatch/);
  assert.match(backlinks, /listVerifiedAuthorityTargetsInternal/);
  assert.match(backlinks, /await targetIsStillLive\(bestMatch\)/);
  assert.match(outreach, /internal\.seoAuthority\.listVerifiedInternal/);
  assert.match(outreach, /OUTREACH_OPPORTUNITY_MAX_AGE_MS/);
  assert.match(outreach, /discoverContact/);
  assert.doesNotMatch(backlinks, /suggestedReplacement:\s*`\/\$\{/);
  assert.match(backlinks, /compatibility no-op/);
  assert.doesNotMatch(
    backlinks.slice(backlinks.indexOf("export const quickBacklinkScan")),
    /You are a backlink strategist/,
  );
});

test("mature ranking pages execute bounded evidence-first authority discovery", () => {
  const controller = readFileSync("convex/seoGrowth.ts", "utf8");
  const runner = readFileSync("convex/actions/seoGrowth.ts", "utf8");
  assert.match(controller, /classification\.actionKind === "build_authority"/);
  assert.match(controller, /authorityDiscoveryAttemptedAt <= now - 7/);
  assert.match(controller, /recordAuthorityDiscovery/);
  assert.match(runner, /analyzeBacklinksInternal/);
  assert.match(runner, /prepareOutreachInternal/);
  assert.match(runner, /authority_outreach_prepared/);
  assert.match(runner, /sort\(\(a, b\) => b\.priority - a\.priority\)\[0\]/);
  assert.doesNotMatch(runner, /sendApprovedOutreachInternal/);
});

test("profile-only or partial authority scans cannot suppress discovery retries", () => {
  const backlinks = readFileSync("convex/actions/backlinks.ts", "utf8");
  const runner = readFileSync("convex/actions/seoGrowth.ts", "utf8");

  assert.match(backlinks, /hasData: mentionsComplete \|\| brokenLinksComplete/);
  assert.doesNotMatch(backlinks, /hasData: Object\.values\(stages\)\.some/);
  assert.match(runner, /const fullDiscovery =/);
  assert.match(runner, /const partialDiscovery =/);
  assert.match(runner, /authority_discovery_partial/);
  assert.match(
    runner,
    /verifiedAt: verified > 0 \|\| fullDiscovery \? Date\.now\(\) : undefined/,
  );
});

test("index discovery repair uses the tenant sitemap before support escalation", () => {
  const growth = readFileSync("convex/seoGrowth.ts", "utf8");
  const action = readFileSync("convex/actions/seoGrowth.ts", "utf8");
  const gsc = readFileSync("convex/actions/gscSync.ts", "utf8");
  assert.match(growth, /awaiting_discovery_repair/);
  assert.match(growth, /discoveryRepairVerifiedAt <= now - 7/);
  assert.match(action, /submitSitemapInternal/);
  assert.match(action, /discovery_repair_verified/);
  assert.match(gsc, /method: "PUT"/);
  assert.match(gsc, /GSC returned a different sitemap path/);
  assert.match(gsc, /!isSeoGrowthActuationEligible\(site\)/);
  assert.doesNotMatch(gsc, /indexing\/v3\/urlNotifications/);
});
