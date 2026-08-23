import assert from "node:assert/strict";
import test from "node:test";

import {
  GSC_INSPECTION_COHORT_DAYS,
  GSC_INSPECTION_COOLDOWN_MS,
  isOpenIndexingIncident,
  selectGscInspectionQueue,
  type GscInspectionQueueCandidate,
} from "../convex/lib/searchPerformance.ts";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);

function candidate(
  articleId: string,
  ageDays: number,
  overrides: Partial<GscInspectionQueueCandidate> = {},
): GscInspectionQueueCandidate {
  return {
    articleId,
    siteId: "site-a",
    publishedAt: NOW - ageDays * DAY,
    ...overrides,
  };
}

test("the full 7/14/28/56-day cohort is eligible instead of the newest 20", () => {
  const newest = Array.from({ length: 24 }, (_, index) =>
    candidate(`new-${index}`, (index + 1) / 10)
  );
  const checkpoints = [7, 14, 28, 56].map((days) =>
    candidate(`day-${days}`, days)
  );

  const selected = selectGscInspectionQueue(
    [...newest, ...checkpoints],
    { siteId: "site-a", now: NOW, limit: 20 },
  );

  assert.deepEqual(
    selected.slice(0, 4).map((article) => article.articleId),
    ["day-56", "day-28", "day-14", "day-7"],
  );
  for (const checkpoint of checkpoints) {
    assert.ok(
      selected.some((article) => article.articleId === checkpoint.articleId),
    );
  }
});

test("never-inspected URLs lead and least-recently-inspected URLs rotate", () => {
  const candidates = [
    candidate("inspected-oldest", 28, {
      gscInspectedAt: NOW - 96 * HOUR,
    }),
    candidate("inspected-newer", 14, {
      gscInspectedAt: NOW - 48 * HOUR,
    }),
    candidate("never", 7),
    candidate("cooldown", 56, {
      gscInspectedAt: NOW - GSC_INSPECTION_COOLDOWN_MS + 1,
    }),
  ];

  const selected = selectGscInspectionQueue(candidates, {
    siteId: "site-a",
    now: NOW,
    limit: 20,
  });

  assert.deepEqual(
    selected.map((article) => article.articleId),
    ["never", "inspected-oldest", "inspected-newer"],
  );
});

test("a bounded run advances to the next least-recently-inspected batch", () => {
  const candidates = Array.from({ length: 30 }, (_, index) =>
    candidate(`article-${index}`, 28, {
      gscInspectedAt: NOW - (100 - index) * HOUR,
    })
  );
  const first = selectGscInspectionQueue(candidates, {
    siteId: "site-a",
    now: NOW,
    limit: 20,
  });
  const firstIds = new Set(first.map((article) => article.articleId));
  const afterFirstRun = candidates.map((article) =>
    firstIds.has(article.articleId)
      ? { ...article, gscInspectedAt: NOW }
      : article
  );
  const second = selectGscInspectionQueue(afterFirstRun, {
    siteId: "site-a",
    now: NOW,
    limit: 20,
  });

  assert.equal(first.length, 20);
  assert.equal(second.length, 10);
  assert.ok(second.every((article) => !firstIds.has(article.articleId)));
});

test("an open indexing incident outranks an older ordinary inspection", () => {
  const selected = selectGscInspectionQueue([
    candidate("ordinary", 28, {
      gscInspectedAt: NOW - 10 * DAY,
    }),
    candidate("incident", 14, {
      gscInspectedAt: NOW - 21 * HOUR,
      openIndexingIncidentPriority: 100,
    }),
  ], {
    siteId: "site-a",
    now: NOW,
    limit: 1,
  });

  assert.equal(selected[0]?.articleId, "incident");
});

test("inspection selection and incident priority remain tenant isolated", () => {
  const selected = selectGscInspectionQueue([
    candidate("tenant-a", 28, {
      gscInspectedAt: NOW - 48 * HOUR,
    }),
    candidate("tenant-b", 56, {
      siteId: "site-b",
      openIndexingIncidentPriority: 100,
    }),
  ], {
    siteId: "site-a",
    now: NOW,
    limit: 20,
  });

  assert.deepEqual(selected.map((article) => article.articleId), ["tenant-a"]);
  assert.equal(isOpenIndexingIncident({
    siteId: "site-a",
    status: "open",
    stage: "indexing_stalled",
    actionKind: "repair_discovery",
    indexState: "not_indexed",
  }, "site-a"), true);
  assert.equal(isOpenIndexingIncident({
    siteId: "site-b",
    status: "open",
    stage: "indexing_stalled",
    actionKind: "repair_discovery",
    indexState: "not_indexed",
  }, "site-a"), false);
});

test("the cohort and daily cooldown boundaries are deterministic", () => {
  const selected = selectGscInspectionQueue([
    candidate("day-56", GSC_INSPECTION_COHORT_DAYS, {
      gscInspectedAt: NOW - GSC_INSPECTION_COOLDOWN_MS,
    }),
    candidate("too-old", GSC_INSPECTION_COHORT_DAYS, {
      publishedAt: NOW - GSC_INSPECTION_COHORT_DAYS * DAY - 1,
    }),
    candidate("future", 0, { publishedAt: NOW + 1 }),
  ], {
    siteId: "site-a",
    now: NOW,
    limit: 20,
  });

  assert.deepEqual(selected.map((article) => article.articleId), ["day-56"]);
});
