import {
  addSearchConsoleDays,
  summarizeSearchPagePerformance,
  type SearchPagePerformanceRow,
} from "./searchPerformance.ts";

type ScorecardMetric = {
  absolute: number;
  percent: number | null;
};

export type GrowthScorecardWindow = {
  days: 7 | 28 | 56;
  startDate: string;
  endDate: string;
  observedDays: number;
  comparisonObservedDays: number;
  comparisonStatus: "complete" | "partial" | "unavailable";
  current: {
    clicks: number;
    impressions: number;
    ctr: number;
    averagePosition: number;
  };
  change: {
    clicks: ScorecardMetric;
    impressions: ScorecardMetric;
    ctr: ScorecardMetric;
    averagePosition: ScorecardMetric;
  };
};

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function metricChange(current: number, previous: number): ScorecardMetric {
  const absolute = round(current - previous);
  if (previous === 0) {
    return { absolute, percent: current === 0 ? 0 : null };
  }
  return {
    absolute,
    percent: round(((current - previous) / Math.abs(previous)) * 100, 1),
  };
}

function datesInRange(
  dates: readonly string[],
  startDate: string,
  endDate: string,
): number {
  return new Set(dates.filter((date) => date >= startDate && date <= endDate)).size;
}

function rowsInRange(
  rows: readonly SearchPagePerformanceRow[],
  startDate: string,
  endDate: string,
): SearchPagePerformanceRow[] {
  return rows.filter((row) => row.date >= startDate && row.date <= endDate);
}

export function buildGrowthScorecard(args: {
  dataThrough?: string;
  receiptDates: readonly string[];
  rows: readonly SearchPagePerformanceRow[];
}): Record<"7" | "28" | "56", GrowthScorecardWindow> | null {
  if (!args.dataThrough || !/^\d{4}-\d{2}-\d{2}$/.test(args.dataThrough)) {
    return null;
  }
  const build = (days: 7 | 28 | 56): GrowthScorecardWindow => {
    const endDate = args.dataThrough!;
    const startDate = addSearchConsoleDays(endDate, 1 - days);
    const previousEndDate = addSearchConsoleDays(startDate, -1);
    const previousStartDate = addSearchConsoleDays(previousEndDate, 1 - days);
    const current = summarizeSearchPagePerformance(
      rowsInRange(args.rows, startDate, endDate),
    );
    const previous = summarizeSearchPagePerformance(
      rowsInRange(args.rows, previousStartDate, previousEndDate),
    );
    const observedDays = datesInRange(args.receiptDates, startDate, endDate);
    const comparisonObservedDays = datesInRange(
      args.receiptDates,
      previousStartDate,
      previousEndDate,
    );
    const comparisonStatus = comparisonObservedDays >= days && observedDays >= days
      ? "complete" as const
      : comparisonObservedDays > 0
        ? "partial" as const
        : "unavailable" as const;
    return {
      days,
      startDate,
      endDate,
      observedDays,
      comparisonObservedDays,
      comparisonStatus,
      current: {
        clicks: current.totalClicks,
        impressions: current.totalImpressions,
        ctr: current.avgCtr,
        averagePosition: current.avgPosition,
      },
      change: {
        clicks: metricChange(current.totalClicks, previous.totalClicks),
        impressions: metricChange(
          current.totalImpressions,
          previous.totalImpressions,
        ),
        ctr: metricChange(current.avgCtr, previous.avgCtr),
        averagePosition: metricChange(
          current.avgPosition,
          previous.avgPosition,
        ),
      },
    };
  };
  return { "7": build(7), "28": build(28), "56": build(56) };
}
