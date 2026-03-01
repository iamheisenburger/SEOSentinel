"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Search,
  Youtube,
  Camera,
  ImageIcon,
  Globe,
  FileText,
  ShieldCheck,
  ImagePlus,
  Link2,
  CheckCircle2,
} from "lucide-react";

const STEPS = [
  { label: "Web research", icon: Search },
  { label: "YouTube videos", icon: Youtube },
  { label: "Site screenshot", icon: Camera },
  { label: "Image search", icon: ImageIcon },
  { label: "Site data crawl", icon: Globe },
  { label: "Article writing", icon: FileText },
  { label: "Fact checking", icon: ShieldCheck },
  { label: "Featured image", icon: ImagePlus },
  { label: "Internal links", icon: Link2 },
];

export function ArticleProgress({ siteId }: { siteId: Id<"sites"> }) {
  const runningJob = useQuery(api.jobs.getRunningBySite, { siteId });

  if (!runningJob || !runningJob.stepProgress) return null;

  const { current, total } = runningJob.stepProgress;

  return (
    <div className="rounded-xl border border-[#0EA5E9]/[0.15] bg-[#0EA5E9]/[0.03] p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0EA5E9] opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0EA5E9]" />
        </span>
        <p className="text-[13px] font-medium text-[#38BDF8]">
          Generating article...
        </p>
        <span className="ml-auto text-[11px] text-[#565A6E] tabular-nums">
          {current}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-1 w-full rounded-full bg-white/[0.04]">
        <div
          className="h-1 rounded-full bg-[#0EA5E9] transition-all duration-700 ease-out"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>

      {/* Steps list */}
      <div className="flex flex-col gap-1">
        {STEPS.slice(0, total).map((step, i) => {
          const stepNum = i + 1;
          const isCompleted = stepNum < current;
          const isActive = stepNum === current;
          const Icon = step.icon;

          return (
            <div
              key={step.label}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${
                isActive
                  ? "bg-[#0EA5E9]/[0.06]"
                  : ""
              } ${
                !isCompleted && !isActive ? "opacity-35" : ""
              }`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                  isCompleted
                    ? "bg-[#22C55E]/[0.1]"
                    : isActive
                      ? "bg-[#0EA5E9]/[0.15]"
                      : "bg-white/[0.03]"
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-3 w-3 text-[#22C55E]" />
                ) : (
                  <Icon
                    className={`h-3 w-3 ${
                      isActive ? "text-[#0EA5E9]" : "text-[#565A6E]"
                    }`}
                  />
                )}
              </div>
              <span
                className={`text-[12px] ${
                  isCompleted
                    ? "text-[#22C55E]/80"
                    : isActive
                      ? "text-[#38BDF8] font-medium"
                      : "text-[#565A6E]"
                }`}
              >
                {isActive
                  ? runningJob.stepProgress!.stepLabel
                  : step.label}
              </span>
              {isActive && (
                <span className="h-1.5 w-1.5 rounded-full bg-[#0EA5E9] animate-pulse" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
