import assert from "node:assert/strict";
import test from "node:test";

import {
  addGscDateDays,
  filterRowsForGscReceipts,
  inclusiveSearchAnalyticsDates,
  isCompleteGscDateRange,
  mergeGscDateEpochReceipts,
} from "../convex/lib/gscSearchAnalytics.ts";

const DATA_THROUGH = "2026-08-20";

function windowDates(start: string, end: string): string[] {
  return inclusiveSearchAnalyticsDates(start, end);
}

function initialRecentHistory() {
  const windowStart = addGscDateDays(DATA_THROUGH, -27);
  return mergeGscDateEpochReceipts({
    current: [],
    syncEpoch: "recent-v1",
    windowStart,
    windowEnd: DATA_THROUGH,
    syncedDates: windowDates(windowStart, DATA_THROUGH),
    dataThrough: DATA_THROUGH,
  });
}

function completeHistory() {
  const recent = initialRecentHistory();
  const windowStart = addGscDateDays(DATA_THROUGH, -55);
  const windowEnd = addGscDateDays(DATA_THROUGH, -28);
  return mergeGscDateEpochReceipts({
    current: recent.receipts,
    syncEpoch: "backfill-v1",
    windowStart,
    windowEnd,
    syncedDates: windowDates(windowStart, windowEnd),
    dataThrough: DATA_THROUGH,
  });
}

test("initial recent phase exposes 28 days until the older backfill commits", () => {
  const recent = initialRecentHistory();
  assert.equal(recent.historyDays, 28);
  assert.equal(recent.receipts.length, 28);
  assert.equal(recent.dataWindowStart, addGscDateDays(DATA_THROUGH, -27));
  assert.deepEqual(recent.completeWindows, [7, 14, 28]);

  const backfilled = completeHistory();
  assert.equal(backfilled.historyDays, 56);
  assert.equal(backfilled.receipts.length, 56);
  assert.equal(backfilled.dataWindowStart, addGscDateDays(DATA_THROUGH, -55));
  assert.deepEqual(backfilled.completeWindows, [7, 14, 28, 56]);
});

test("incremental recent refresh retains the older history without fetching 56 days", () => {
  const current = completeHistory();
  const nextDataThrough = addGscDateDays(DATA_THROUGH, 1);
  const windowStart = addGscDateDays(nextDataThrough, -27);
  const next = mergeGscDateEpochReceipts({
    current: current.receipts,
    syncEpoch: "recent-v2",
    windowStart,
    windowEnd: nextDataThrough,
    syncedDates: windowDates(windowStart, nextDataThrough),
    dataThrough: nextDataThrough,
  });

  assert.equal(next.receipts.length, 56);
  assert.equal(next.historyDays, 56);
  assert.equal(next.dataWindowStart, addGscDateDays(nextDataThrough, -55));
  assert.deepEqual(next.completeWindows, [7, 14, 28, 56]);
  assert.ok(next.epochsToPrune.includes("recent-v1"));
  assert.ok(next.epochsToPrune.includes("backfill-v1"));
  assert.equal(
    next.receipts.find((receipt) => receipt.date === windowStart)?.syncEpoch,
    "recent-v2",
  );
});

test("a full retained ledger proves exact 7, 14, 28, and 56-day cohorts", () => {
  const history = completeHistory();
  for (const days of [7, 14, 28, 56]) {
    assert.equal(
      isCompleteGscDateRange(
        history.receipts,
        addGscDateDays(DATA_THROUGH, -(days - 1)),
        DATA_THROUGH,
      ),
      true,
    );
  }
  assert.equal(
    isCompleteGscDateRange(
      history.receipts,
      addGscDateDays(DATA_THROUGH, -56),
      DATA_THROUGH,
    ),
    false,
  );
});

test("partial or non-contiguous backfill evidence cannot alter active history", () => {
  const recent = initialRecentHistory();
  const windowStart = addGscDateDays(DATA_THROUGH, -55);
  const windowEnd = addGscDateDays(DATA_THROUGH, -28);
  const incompleteDates = windowDates(windowStart, windowEnd).slice(0, -1);

  assert.throws(
    () => mergeGscDateEpochReceipts({
      current: recent.receipts,
      syncEpoch: "partial-backfill",
      windowStart,
      windowEnd,
      syncedDates: incompleteDates,
      dataThrough: DATA_THROUGH,
    }),
    /partial or non-contiguous/,
  );
  assert.equal(recent.historyDays, 28);
  assert.deepEqual(recent.completeWindows, [7, 14, 28]);
});

test("receipt filtering hides superseded and older-than-56-day rows", () => {
  const history = completeHistory();
  const activeDate = addGscDateDays(DATA_THROUGH, -40);
  const activeEpoch = history.receipts.find(
    (receipt) => receipt.date === activeDate,
  )!.syncEpoch;
  const rows = [
    { date: activeDate, syncEpoch: activeEpoch, value: "active" },
    { date: activeDate, syncEpoch: "superseded", value: "stale" },
    {
      date: addGscDateDays(DATA_THROUGH, -56),
      syncEpoch: "backfill-v1",
      value: "expired",
    },
  ];

  assert.deepEqual(filterRowsForGscReceipts(rows, history.receipts), [rows[0]]);
});
