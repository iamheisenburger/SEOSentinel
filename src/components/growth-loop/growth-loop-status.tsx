"use client";

import { useQuery } from "convex/react";
import {
  AlertTriangle,
  Check,
  Clock3,
  LoaderCircle,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const STAGE_LABELS: Record<string, string> = {
  setup: "One Setup",
  planning: "Opportunity",
  buffer: "Quality buffer",
  publication: "Publication",
  measurement: "Measurement",
  improvement: "Improvement",
  outreach: "Authority outreach",
  backlink_verification: "Link verification",
};

const STATE_LABELS: Record<string, string> = {
  waiting_owner: "Needs you",
  waiting_pentra: "Pentra working",
  waiting_provider: "Provider pending",
  warming: "Warming",
  ready: "Ready",
  degraded: "Degraded",
  terminal: "Stopped",
};

function humanize(code: string | undefined): string {
  if (!code) return "Verified";
  return code.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function metricDelta(value: { absolute: number; percent: number | null }): string {
  const absolute = value.absolute > 0 ? `+${value.absolute}` : String(value.absolute);
  if (value.percent === null) return `${absolute} · no prior baseline`;
  const percent = value.percent > 0 ? `+${value.percent}%` : `${value.percent}%`;
  return `${absolute} · ${percent}`;
}

function stageTone(state: string): string {
  if (state === "ready") return "border-[#22C55E]/20 bg-[#22C55E]/[0.05] text-[#4ADE80]";
  if (state === "waiting_owner" || state === "degraded" || state === "terminal") {
    return "border-[#F59E0B]/20 bg-[#F59E0B]/[0.05] text-[#FBBF24]";
  }
  return "border-[#0EA5E9]/20 bg-[#0EA5E9]/[0.05] text-[#38BDF8]";
}

function StageIcon({ state }: { state: string }) {
  if (state === "ready") return <Check className="h-3.5 w-3.5" />;
  if (state === "waiting_owner" || state === "degraded" || state === "terminal") {
    return <AlertTriangle className="h-3.5 w-3.5" />;
  }
  if (state === "warming" || state === "waiting_provider") {
    return <Clock3 className="h-3.5 w-3.5" />;
  }
  return <LoaderCircle className="h-3.5 w-3.5 animate-spin" />;
}

export function GrowthLoopStatus({ siteId }: { siteId: Id<"sites"> }) {
  const status = useQuery(api.growthLoop.getStatus, { siteId });
  if (status === undefined) {
    return <div className="h-40 animate-pulse rounded-xl border border-white/[0.06] bg-[#0F1117]" />;
  }

  return (
    <section className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-[#EDEEF1]">Autonomous growth loop</h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-5 text-[#565A6E]">
            Verified outcomes are separate from work in progress and forecasts. Every unfinished stage names its current owner and blocker.
          </p>
        </div>
        <div className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
          status.ready
            ? "border-[#22C55E]/20 bg-[#22C55E]/[0.06] text-[#4ADE80]"
            : "border-[#0EA5E9]/20 bg-[#0EA5E9]/[0.06] text-[#38BDF8]"
        }`}>
          {status.ready ? "Loop verified" : "In progress"}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {status.stageOrder.map((key) => {
          const stage = status.stages[key];
          return (
            <div key={key} className={`rounded-lg border p-3 ${stageTone(stage.state)}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
                  {STAGE_LABELS[key] ?? key}
                </span>
                <StageIcon state={stage.state} />
              </div>
              <p className="mt-2 text-[12px] font-semibold text-[#EDEEF1]">
                {STATE_LABELS[stage.state] ?? stage.state}
              </p>
              <p className="mt-1 line-clamp-2 min-h-8 text-[10px] leading-4 opacity-75">
                {humanize(stage.blockerCode)}
              </p>
              {stage.nextEligibleAt && (
                <p className="mt-2 text-[9px] opacity-60">
                  Next check {new Date(stage.nextEligibleAt).toLocaleString()}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#565A6E]">Verified external outcomes</p>
          <div className="mt-2 flex gap-4 text-[11px] text-[#8B8FA3]">
            <span><b className="text-[#EDEEF1]">{status.verifiedOutcomes.publishedUrls}</b> live URLs</span>
            <span><b className="text-[#EDEEF1]">{status.verifiedOutcomes.measuredConversions}</b> conversions</span>
            <span><b className="text-[#EDEEF1]">{status.verifiedOutcomes.acquiredBacklinks}</b> links</span>
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#565A6E]">Activity</p>
          <div className="mt-2 flex gap-4 text-[11px] text-[#8B8FA3]">
            <span><b className="text-[#EDEEF1]">{status.activity.topics}</b> topics</span>
            <span><b className="text-[#EDEEF1]">{status.activity.articles}</b> articles</span>
            <span><b className="text-[#EDEEF1]">{status.activity.growthActions}</b> decisions</span>
          </div>
        </div>
        <div className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#565A6E]">Forecast, not outcome</p>
          <div className="mt-2 flex gap-4 text-[11px] text-[#8B8FA3]">
            <span><b className="text-[#EDEEF1]">{status.forecasts.expectedClicksMonthly ?? "—"}</b> expected clicks</span>
            <span><b className="text-[#EDEEF1]">{status.forecasts.goalMonthly ?? "—"}</b> goal</span>
            <span><b className="text-[#EDEEF1]">{status.forecasts.evidenceMissing ?? "—"}</b> missing evidence</span>
          </div>
        </div>
      </div>

      {status.searchPerformance.windows && (
        <div className="mt-4 rounded-lg border border-white/[0.05] bg-white/[0.02] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#565A6E]">
              Verified Search Console outcomes
            </p>
            <p className="text-[9px] text-[#565A6E]">
              Data through {status.searchPerformance.dataThrough ?? "unavailable"}
            </p>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {(["7", "28", "56"] as const).map((key) => {
              const window = status.searchPerformance.windows![key];
              return (
                <div key={key} className="rounded-md border border-white/[0.05] bg-[#0F1117] p-3">
                  <p className="text-[10px] font-semibold text-[#EDEEF1]">{key}-day cohort</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px] text-[#8B8FA3]">
                    <span>Clicks <b className="text-[#EDEEF1]">{window.current.clicks}</b></span>
                    <span>Impressions <b className="text-[#EDEEF1]">{window.current.impressions}</b></span>
                    <span>CTR <b className="text-[#EDEEF1]">{window.current.ctr}%</b></span>
                    <span>Position <b className="text-[#EDEEF1]">{window.current.averagePosition || "—"}</b></span>
                  </div>
                  <p className="mt-2 text-[9px] text-[#565A6E]">
                    Click change: {window.comparisonStatus === "unavailable"
                      ? "comparison unavailable"
                      : metricDelta(window.change.clicks)}
                    {window.comparisonStatus === "partial" ? " · partial baseline" : ""}
                  </p>
                </div>
              );
            })}
          </div>
          {status.latestGrowthAction && (
            <div className="mt-3 rounded-md border border-[#0EA5E9]/15 bg-[#0EA5E9]/[0.04] p-3">
              <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#38BDF8]">
                Latest evidence-backed action
              </p>
              <p className="mt-1 text-[11px] font-semibold text-[#EDEEF1]">
                {humanize(status.latestGrowthAction.actionKind)} · {humanize(status.latestGrowthAction.automationStatus ?? status.latestGrowthAction.status)}
              </p>
              <p className="mt-1 text-[10px] leading-4 text-[#8B8FA3]">
                {status.latestGrowthAction.reason}
              </p>
              {status.latestGrowthAction.nextReviewAt && (
                <p className="mt-1 text-[9px] text-[#565A6E]">
                  Automatic review {new Date(status.latestGrowthAction.nextReviewAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
