import assert from "node:assert/strict";
import test from "node:test";

import {
  addSearchConsoleDays,
  isBrandedSearchQuery,
  isSameSearchConsolePage,
  normalizeSearchConsolePage,
  publishedArticlePageUrl,
  searchConsoleDate,
  summarizeSearchPagePerformance,
} from "../convex/lib/searchPerformance.ts";

test("recognizes spaced brand searches for compact domain names", () => {
  assert.equal(isBrandedSearchQuery("lead pilot", "leadpilot.chat"), true);
  assert.equal(isBrandedSearchQuery("+lead +pilot", "leadpilot.chat"), true);
  assert.equal(isBrandedSearchQuery("ai lead capture", "leadpilot.chat"), false);
});

test("normalizes protocol, www, query strings, and trailing slashes", () => {
  assert.equal(
    normalizeSearchConsolePage("https://www.LeadPilot.chat/blog/example/?utm_source=test"),
    "leadpilot.chat/blog/example",
  );
});

test("matches canonical variants of the same article", () => {
  assert.equal(
    isSameSearchConsolePage(
      "https://leadpilot.chat/blog/example/",
      "leadpilot.chat/blog/example",
    ),
    true,
  );
});

test("does not treat the homepage as every article", () => {
  assert.equal(
    isSameSearchConsolePage(
      "https://leadpilot.chat/",
      "https://leadpilot.chat/blog/example",
    ),
    false,
  );
});

test("builds the measured page from each tenant's configured publication path", () => {
  assert.equal(
    publishedArticlePageUrl(
      "leadpilot.chat",
      "/blog/[slug]",
      "/ai-chatbot-for-sales-effectiveness",
    ),
    "https://leadpilot.chat/blog/ai-chatbot-for-sales-effectiveness",
  );
  assert.equal(
    publishedArticlePageUrl(
      "https://www.estiflow.com.au/",
      "/resources/[slug]",
      "estimate-guide",
    ),
    "https://www.estiflow.com.au/resources/estimate-guide",
  );
});

test("uses Search Console Pacific dates for evening publications", () => {
  const publishedAt = Date.parse("2026-07-28T00:10:17.546Z");
  assert.equal(searchConsoleDate(publishedAt), "2026-07-27");
  assert.equal(addSearchConsoleDays("2026-07-27", 6), "2026-08-02");
  assert.equal(addSearchConsoleDays("2026-07-27", 55), "2026-09-20");
});

test("page totals report unattributed query coverage without losing traffic", () => {
  const summary = summarizeSearchPagePerformance([
    {
      date: "2026-08-01",
      clicks: 3,
      impressions: 100,
      weightedPosition: 800,
      nonBrandedClicks: 1,
      nonBrandedImpressions: 40,
      unattributedClicks: 2,
      unattributedImpressions: 60,
      queryCoverageComplete: false,
      syncedAt: 1,
    },
  ]);
  assert.equal(summary.totalClicks, 3);
  assert.equal(summary.totalImpressions, 100);
  assert.equal(summary.nonBrandedImpressions, 40);
  assert.equal(summary.unattributedImpressions, 60);
  assert.equal(summary.queryCoverageComplete, false);
  assert.equal(summary.avgPosition, 8);
});
