import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGscPageTotalRollups,
  fetchCompleteDailySearchAnalytics,
  GSC_SEARCH_ANALYTICS_PAGE_SIZE,
  type GscSearchAnalyticsDataset,
  type GscSearchAnalyticsRow,
} from "../convex/lib/gscSearchAnalytics.ts";

function row(
  id: number,
  date: string,
  dataset: GscSearchAnalyticsDataset,
): GscSearchAnalyticsRow {
  return {
    keys: dataset === "query_detail"
      ? [date, `query-${id}`, `https://example.com/page-${id}`]
      : [date, `https://example.com/page-${id}`],
    clicks: id,
    impressions: id + 1,
    ctr: 0,
    position: 1,
  };
}

test("a full 25,000-row daily boundary requests the next offset", async () => {
  const requests: Array<{
    dataset: GscSearchAnalyticsDataset;
    date: string;
    startRow: number;
  }> = [];
  const date = "2026-08-01";
  const firstPage = Array.from(
    { length: GSC_SEARCH_ANALYTICS_PAGE_SIZE },
    (_, index) => row(index, date, "query_detail"),
  );

  const result = await fetchCompleteDailySearchAnalytics(
    async (request) => {
      requests.push({
        dataset: request.dataset,
        date: request.date,
        startRow: request.startRow,
      });
      if (request.dataset === "page_total") return [];
      return request.startRow === 0 ? firstPage : [];
    },
    { startDate: date, endDate: date },
  );

  assert.equal(result.queryDetailRows.length, 25_000);
  assert.equal(result.pageTotalRows.length, 0);
  assert.deepEqual(requests, [
    { dataset: "query_detail", date, startRow: 0 },
    { dataset: "query_detail", date, startRow: 25_000 },
    { dataset: "page_total", date, startRow: 0 },
  ]);
});

test("aggregates complete query-detail and page-total pages across days", async () => {
  const calls: string[] = [];
  const dates = ["2026-08-01", "2026-08-02"];

  const result = await fetchCompleteDailySearchAnalytics(
    async (request) => {
      calls.push(`${request.dataset}:${request.date}:${request.startRow}`);
      const base = request.date === dates[0] ? 0 : 10;
      if (request.dataset === "query_detail") {
        return request.startRow === 0
          ? [
              row(base, request.date, request.dataset),
              row(base + 1, request.date, request.dataset),
            ]
          : [row(base + 2, request.date, request.dataset)];
      }
      return [row(base, request.date, request.dataset)];
    },
    {
      startDate: dates[0],
      endDate: dates[1],
      pageSize: 2,
      maxRowsPerDay: 4,
      maxRequests: 12,
    },
  );

  assert.deepEqual(
    result.queryDetailRows.map((item) => item.keys[1]),
    ["query-0", "query-1", "query-2", "query-10", "query-11", "query-12"],
  );
  assert.deepEqual(
    result.pageTotalRows.map((item) => item.keys[1]),
    ["https://example.com/page-0", "https://example.com/page-10"],
  );
  assert.deepEqual(result.dates, dates);
  assert.deepEqual(calls, [
    "query_detail:2026-08-01:0",
    "query_detail:2026-08-01:2",
    "page_total:2026-08-01:0",
    "query_detail:2026-08-02:0",
    "query_detail:2026-08-02:2",
    "page_total:2026-08-02:0",
  ]);
});

test("fails closed as soon as a full page reaches Google's daily row cap", async () => {
  const starts: number[] = [];
  await assert.rejects(
    fetchCompleteDailySearchAnalytics(
      async ({ dataset, date, startRow }) => {
        starts.push(startRow);
        return dataset === "query_detail"
          ? [row(startRow, date, dataset), row(startRow + 1, date, dataset)]
          : [];
      },
      {
        startDate: "2026-08-01",
        endDate: "2026-08-01",
        pageSize: 2,
        maxRowsPerDay: 4,
        maxRequests: 8,
      },
    ),
    /reached the 4-row daily ceiling/,
  );
  assert.deepEqual(starts, [0, 2]);
});

test("fails closed when the overall request bound is exhausted", async () => {
  await assert.rejects(
    fetchCompleteDailySearchAnalytics(async () => [], {
      startDate: "2026-08-01",
      endDate: "2026-08-02",
      maxRequests: 3,
    }),
    /exhausted its 3-request bound/,
  );
});

test("fails closed when the overall deadline expires", async () => {
  let clock = 0;
  await assert.rejects(
    fetchCompleteDailySearchAnalytics(
      async () => {
        clock += 60;
        return [];
      },
      {
        startDate: "2026-08-01",
        endDate: "2026-08-02",
        deadlineMs: 100,
        now: () => clock,
      },
    ),
    /exceeded its 100ms deadline/,
  );
});

test("rejects duplicate or wrong-day dimensions instead of misattributing rows", async () => {
  const date = "2026-08-01";
  await assert.rejects(
    fetchCompleteDailySearchAnalytics(
      async ({ dataset, startRow }) =>
        dataset === "query_detail" && startRow === 0
          ? [row(0, date, dataset), row(0, date, dataset)]
          : [],
      {
        startDate: date,
        endDate: date,
        pageSize: 2,
        maxRowsPerDay: 4,
      },
    ),
    /duplicate dimensions/,
  );

  await assert.rejects(
    fetchCompleteDailySearchAnalytics(
      async ({ dataset }) => [row(0, "2026-08-02", dataset)],
      {
        startDate: date,
        endDate: date,
        pageSize: 2,
        maxRowsPerDay: 4,
      },
    ),
    /outside its requested daily window/,
  );
});

test("authoritative page totals preserve hidden-query traffic and coverage", () => {
  const date = "2026-08-01";
  const page = "https://example.com/article";
  const rollups = buildGscPageTotalRollups({
    queryDetailRows: [{
      keys: [date, "known query", page],
      clicks: 1,
      impressions: 40,
      ctr: 0.025,
      position: 8,
    }],
    pageTotalRows: [{
      keys: [date, page],
      clicks: 3,
      impressions: 100,
      ctr: 0.03,
      position: 10,
    }],
    isBrandedQuery: () => false,
  });

  assert.deepEqual(rollups, [{
    date,
    page,
    clicks: 3,
    impressions: 100,
    weightedPosition: 1_000,
    queryClicks: 1,
    queryImpressions: 40,
    nonBrandedClicks: 1,
    nonBrandedImpressions: 40,
    nonBrandedWeightedPosition: 320,
    unattributedClicks: 2,
    unattributedImpressions: 60,
    queryCoverageComplete: false,
  }]);
});

test("query detail without an authoritative page total fails closed", () => {
  const detail = row(1, "2026-08-01", "query_detail");
  assert.throws(
    () => buildGscPageTotalRollups({
      queryDetailRows: [detail],
      pageTotalRows: [],
      isBrandedQuery: () => false,
    }),
    /no authoritative daily page total/,
  );
});
