export interface GscSearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type GscSearchAnalyticsDataset = "query_detail" | "page_total";

export type GscSearchAnalyticsPageRequest = {
  dataset: GscSearchAnalyticsDataset;
  date: string;
  startRow: number;
  rowLimit: number;
  timeoutMs: number;
};

export type CompleteGscSearchAnalytics = {
  queryDetailRows: GscSearchAnalyticsRow[];
  pageTotalRows: GscSearchAnalyticsRow[];
  dates: string[];
  requests: number;
};

export type GscDateEpochReceipt = {
  date: string;
  syncEpoch: string;
};

export type GscHistoryMergeResult = {
  receipts: GscDateEpochReceipt[];
  dataWindowStart: string;
  historyDays: number;
  completeWindows: number[];
  epochsToPrune: string[];
};

export type GscPageTotalRollup = {
  date: string;
  page: string;
  clicks: number;
  impressions: number;
  weightedPosition: number;
  queryClicks: number;
  queryImpressions: number;
  nonBrandedClicks: number;
  nonBrandedImpressions: number;
  nonBrandedWeightedPosition: number;
  unattributedClicks: number;
  unattributedImpressions: number;
  queryCoverageComplete: boolean;
};

export const GSC_SEARCH_ANALYTICS_PAGE_SIZE = 25_000;
export const GSC_SEARCH_ANALYTICS_MAX_ROWS_PER_DAY = 50_000;
export const GSC_SEARCH_ANALYTICS_MAX_DAYS = 28;
export const GSC_SEARCH_ANALYTICS_HISTORY_DAYS = 56;
export const GSC_SEARCH_ANALYTICS_COMPLETE_WINDOWS = [7, 14, 28, 56] as const;

// Each dataset can need at most two requests. A full second page reaches
// Google's accessible 50,000-row ceiling and is therefore not provably
// complete; the extraction fails closed instead of probing beyond the cap.
export const GSC_SEARCH_ANALYTICS_MAX_REQUESTS =
  GSC_SEARCH_ANALYTICS_MAX_DAYS * 2 * 2;

// Leave the tenant action enough time for URL inspection and persistence.
// Slow Google responses fail this sync before any performance rows are saved.
export const GSC_SEARCH_ANALYTICS_DEADLINE_MS = 120_000;

export class GscSearchAnalyticsIncompleteError extends Error {
  readonly code = "GSC_SEARCH_ANALYTICS_INCOMPLETE";

  constructor(message: string) {
    super(message);
    this.name = "GscSearchAnalyticsIncompleteError";
  }
}

function parseDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("GSC Search Analytics dates must use YYYY-MM-DD");
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("GSC Search Analytics date is invalid");
  }
  return timestamp;
}

export function addGscDateDays(value: string, days: number): string {
  const timestamp = parseDate(value);
  if (!Number.isSafeInteger(days)) {
    throw new Error("GSC date offset must be an integer");
  }
  return new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10);
}

export function inclusiveSearchAnalyticsDates(
  startDate: string,
  endDate: string,
): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (end < start) {
    throw new Error("GSC Search Analytics end date precedes its start date");
  }
  const dates: string[] = [];
  for (let timestamp = start; timestamp <= end; timestamp += 86_400_000) {
    dates.push(new Date(timestamp).toISOString().slice(0, 10));
  }
  return dates;
}

function receiptMap(
  receipts: GscDateEpochReceipt[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const receipt of receipts) {
    parseDate(receipt.date);
    if (!receipt.syncEpoch) {
      throw new GscSearchAnalyticsIncompleteError(
        "GSC history contains an empty sync epoch",
      );
    }
    if (result.has(receipt.date)) {
      throw new GscSearchAnalyticsIncompleteError(
        "GSC history contains duplicate daily receipts",
      );
    }
    result.set(receipt.date, receipt.syncEpoch);
  }
  return result;
}

export function isCompleteGscDateRange(
  receipts: GscDateEpochReceipt[],
  startDate: string,
  endDate: string,
): boolean {
  const byDate = receiptMap(receipts);
  return inclusiveSearchAnalyticsDates(startDate, endDate).every((date) =>
    byDate.has(date)
  );
}

export function filterRowsForGscReceipts<
  Row extends { date: string; syncEpoch?: string },
>(rows: Row[], receipts: GscDateEpochReceipt[]): Row[] {
  const byDate = receiptMap(receipts);
  return rows.filter(
    (row) => !!row.syncEpoch && byDate.get(row.date) === row.syncEpoch,
  );
}

export function mergeGscDateEpochReceipts(args: {
  current: GscDateEpochReceipt[];
  syncEpoch: string;
  windowStart: string;
  windowEnd: string;
  syncedDates: string[];
  dataThrough: string;
  retentionDays?: number;
}): GscHistoryMergeResult {
  if (!args.syncEpoch) {
    throw new GscSearchAnalyticsIncompleteError(
      "GSC history merge requires a sync epoch",
    );
  }
  const retentionDays =
    args.retentionDays ?? GSC_SEARCH_ANALYTICS_HISTORY_DAYS;
  if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) {
    throw new Error("GSC history retention must be a positive integer");
  }
  const expectedDates = inclusiveSearchAnalyticsDates(
    args.windowStart,
    args.windowEnd,
  );
  if (
    args.syncedDates.length !== expectedDates.length ||
    args.syncedDates.some((date, index) => date !== expectedDates[index])
  ) {
    throw new GscSearchAnalyticsIncompleteError(
      "GSC history cannot commit a partial or non-contiguous daily window",
    );
  }
  const retentionStart = addGscDateDays(
    args.dataThrough,
    -(retentionDays - 1),
  );
  if (
    args.windowStart < retentionStart ||
    args.windowEnd > args.dataThrough
  ) {
    throw new GscSearchAnalyticsIncompleteError(
      "GSC history window falls outside the bounded retention range",
    );
  }

  const previous = receiptMap(args.current);
  const merged = new Map<string, string>();
  for (const [date, syncEpoch] of previous) {
    if (date >= retentionStart && date <= args.dataThrough) {
      merged.set(date, syncEpoch);
    }
  }
  for (const date of expectedDates) merged.set(date, args.syncEpoch);

  let historyDays = 0;
  let cursor = args.dataThrough;
  while (historyDays < retentionDays && merged.has(cursor)) {
    historyDays++;
    cursor = addGscDateDays(cursor, -1);
  }
  if (historyDays === 0) {
    throw new GscSearchAnalyticsIncompleteError(
      "GSC history does not cover its declared data-through date",
    );
  }
  const dataWindowStart = addGscDateDays(
    args.dataThrough,
    -(historyDays - 1),
  );
  const receipts = [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, syncEpoch]) => ({ date, syncEpoch }));
  const epochsToPrune = new Set<string>();
  for (const [date, syncEpoch] of previous) {
    if (merged.get(date) !== syncEpoch) epochsToPrune.add(syncEpoch);
  }
  return {
    receipts,
    dataWindowStart,
    historyDays,
    completeWindows: GSC_SEARCH_ANALYTICS_COMPLETE_WINDOWS.filter(
      (days) => historyDays >= days,
    ),
    epochsToPrune: [...epochsToPrune],
  };
}

function expectedKeyCount(dataset: GscSearchAnalyticsDataset): number {
  return dataset === "query_detail" ? 3 : 2;
}

function validateRow(
  row: GscSearchAnalyticsRow,
  dataset: GscSearchAnalyticsDataset,
  date: string,
): void {
  if (
    row.keys.length !== expectedKeyCount(dataset) ||
    row.keys[0] !== date ||
    row.keys.slice(1).some((key) => !key)
  ) {
    throw new GscSearchAnalyticsIncompleteError(
      `GSC ${dataset} returned dimensions outside its requested daily window`,
    );
  }
  if (
    !Number.isFinite(row.clicks) ||
    !Number.isFinite(row.impressions) ||
    !Number.isFinite(row.ctr) ||
    !Number.isFinite(row.position) ||
    row.clicks < 0 ||
    row.impressions < 0
  ) {
    throw new GscSearchAnalyticsIncompleteError(
      `GSC ${dataset} returned invalid metrics`,
    );
  }
}

export async function fetchCompleteDailySearchAnalytics(
  fetchPage: (
    request: GscSearchAnalyticsPageRequest,
  ) => Promise<GscSearchAnalyticsRow[]>,
  args: {
    startDate: string;
    endDate: string;
    pageSize?: number;
    maxRowsPerDay?: number;
    maxDays?: number;
    maxRequests?: number;
    deadlineMs?: number;
    requestTimeoutMs?: number;
    now?: () => number;
  },
): Promise<CompleteGscSearchAnalytics> {
  const pageSize = args.pageSize ?? GSC_SEARCH_ANALYTICS_PAGE_SIZE;
  const maxRowsPerDay =
    args.maxRowsPerDay ?? GSC_SEARCH_ANALYTICS_MAX_ROWS_PER_DAY;
  const maxDays = args.maxDays ?? GSC_SEARCH_ANALYTICS_MAX_DAYS;
  const maxRequests =
    args.maxRequests ?? GSC_SEARCH_ANALYTICS_MAX_REQUESTS;
  const deadlineMs =
    args.deadlineMs ?? GSC_SEARCH_ANALYTICS_DEADLINE_MS;
  const requestTimeoutMs = args.requestTimeoutMs ?? 20_000;
  const now = args.now ?? Date.now;

  for (const [name, value] of Object.entries({
    pageSize,
    maxRowsPerDay,
    maxDays,
    maxRequests,
    deadlineMs,
    requestTimeoutMs,
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`GSC Search Analytics ${name} must be a positive integer`);
    }
  }
  if (maxRowsPerDay % pageSize !== 0) {
    throw new Error(
      "GSC Search Analytics daily row ceiling must be divisible by page size",
    );
  }

  const dates = inclusiveSearchAnalyticsDates(args.startDate, args.endDate);
  if (dates.length > maxDays) {
    throw new GscSearchAnalyticsIncompleteError(
      `GSC daily extraction exceeds the bounded ${maxDays}-day window`,
    );
  }

  const startedAt = now();
  let requests = 0;
  const rowsByDataset: Record<
    GscSearchAnalyticsDataset,
    GscSearchAnalyticsRow[]
  > = {
    query_detail: [],
    page_total: [],
  };
  const seenDimensions = new Set<string>();

  for (const date of dates) {
    for (const dataset of ["query_detail", "page_total"] as const) {
      for (let startRow = 0; ; startRow += pageSize) {
        if (startRow >= maxRowsPerDay) {
          throw new GscSearchAnalyticsIncompleteError(
            `GSC ${dataset} reached the ${maxRowsPerDay}-row daily ceiling for ${date}`,
          );
        }
        if (requests >= maxRequests) {
          throw new GscSearchAnalyticsIncompleteError(
            `GSC daily extraction exhausted its ${maxRequests}-request bound`,
          );
        }
        const elapsed = now() - startedAt;
        const remaining = deadlineMs - elapsed;
        if (remaining <= 0) {
          throw new GscSearchAnalyticsIncompleteError(
            `GSC daily extraction exceeded its ${deadlineMs}ms deadline`,
          );
        }

        const page = await fetchPage({
          dataset,
          date,
          startRow,
          rowLimit: pageSize,
          timeoutMs: Math.max(1, Math.min(requestTimeoutMs, remaining)),
        });
        requests++;
        if (now() - startedAt > deadlineMs) {
          throw new GscSearchAnalyticsIncompleteError(
            `GSC daily extraction exceeded its ${deadlineMs}ms deadline`,
          );
        }
        if (!Array.isArray(page) || page.length > pageSize) {
          throw new GscSearchAnalyticsIncompleteError(
            `GSC ${dataset} returned an oversized or invalid page`,
          );
        }

        for (const row of page) {
          validateRow(row, dataset, date);
          const key = `${dataset}\u0000${JSON.stringify(row.keys)}`;
          if (seenDimensions.has(key)) {
            throw new GscSearchAnalyticsIncompleteError(
              `GSC ${dataset} returned duplicate dimensions across pages`,
            );
          }
          seenDimensions.add(key);
          rowsByDataset[dataset].push(row);
        }

        if (startRow + page.length >= maxRowsPerDay) {
          throw new GscSearchAnalyticsIncompleteError(
            `GSC ${dataset} reached the ${maxRowsPerDay}-row daily ceiling for ${date}`,
          );
        }
        if (page.length < pageSize) break;
      }
    }
  }

  return {
    queryDetailRows: rowsByDataset.query_detail,
    pageTotalRows: rowsByDataset.page_total,
    dates,
    requests,
  };
}

export function buildGscPageTotalRollups(args: {
  queryDetailRows: GscSearchAnalyticsRow[];
  pageTotalRows: GscSearchAnalyticsRow[];
  isBrandedQuery: (query: string) => boolean;
}): GscPageTotalRollup[] {
  type Detail = {
    clicks: number;
    impressions: number;
    nonBrandedClicks: number;
    nonBrandedImpressions: number;
    nonBrandedWeightedPosition: number;
  };
  const detailByPage = new Map<string, Detail>();
  for (const row of args.queryDetailRows) {
    const [date, query, page] = row.keys;
    if (!date || !query || !page) {
      throw new GscSearchAnalyticsIncompleteError(
        "GSC query detail is missing date, query, or page dimensions",
      );
    }
    const key = `${date}\u0000${page}`;
    const detail = detailByPage.get(key) ?? {
      clicks: 0,
      impressions: 0,
      nonBrandedClicks: 0,
      nonBrandedImpressions: 0,
      nonBrandedWeightedPosition: 0,
    };
    detail.clicks += row.clicks;
    detail.impressions += row.impressions;
    if (!args.isBrandedQuery(query)) {
      detail.nonBrandedClicks += row.clicks;
      detail.nonBrandedImpressions += row.impressions;
      detail.nonBrandedWeightedPosition += row.position * row.impressions;
    }
    detailByPage.set(key, detail);
  }

  const totalKeys = new Set<string>();
  const rollups = args.pageTotalRows.map((row) => {
    const [date, page] = row.keys;
    if (!date || !page) {
      throw new GscSearchAnalyticsIncompleteError(
        "GSC page total is missing date or page dimensions",
      );
    }
    const key = `${date}\u0000${page}`;
    if (totalKeys.has(key)) {
      throw new GscSearchAnalyticsIncompleteError(
        "GSC page totals contain duplicate daily pages",
      );
    }
    totalKeys.add(key);
    const detail = detailByPage.get(key) ?? {
      clicks: 0,
      impressions: 0,
      nonBrandedClicks: 0,
      nonBrandedImpressions: 0,
      nonBrandedWeightedPosition: 0,
    };
    if (
      detail.clicks > row.clicks ||
      detail.impressions > row.impressions
    ) {
      throw new GscSearchAnalyticsIncompleteError(
        "GSC query detail exceeds its authoritative daily page total",
      );
    }
    const unattributedClicks = row.clicks - detail.clicks;
    const unattributedImpressions = row.impressions - detail.impressions;
    return {
      date,
      page,
      clicks: row.clicks,
      impressions: row.impressions,
      weightedPosition: row.position * row.impressions,
      queryClicks: detail.clicks,
      queryImpressions: detail.impressions,
      nonBrandedClicks: detail.nonBrandedClicks,
      nonBrandedImpressions: detail.nonBrandedImpressions,
      nonBrandedWeightedPosition: detail.nonBrandedWeightedPosition,
      unattributedClicks,
      unattributedImpressions,
      queryCoverageComplete:
        unattributedClicks === 0 && unattributedImpressions === 0,
    };
  });

  for (const key of detailByPage.keys()) {
    if (!totalKeys.has(key)) {
      throw new GscSearchAnalyticsIncompleteError(
        "GSC query detail has no authoritative daily page total",
      );
    }
  }
  return rollups;
}
