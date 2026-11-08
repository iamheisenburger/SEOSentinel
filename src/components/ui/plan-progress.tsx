"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Globe,
  Brain,
  Filter,
  BarChart3,
  Search,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

const PLAN_STEPS = [
  { label: "Analyzing site profile", icon: Globe, description: "Reviewing your site, niche, audience, and existing content" },
  { label: "AI strategy session", icon: Brain, description: "Generating targeted topic ideas based on your product and audience" },
  { label: "Deduplication", icon: Filter, description: "Removing overlapping topics and ensuring keyword diversity" },
  { label: "Keyword intelligence", icon: BarChart3, description: "Fetching search volume, difficulty, and CPC for every topic" },
  { label: "SERP analysis", icon: Search, description: "Analyzing top Google results to pick the optimal article format" },
  { label: "Strategy ready", icon: Sparkles, description: "Your optimized content plan is ready" },
];

export function PlanProgress({ siteId }: { siteId: Id<"sites"> }) {
  const runningJob = useQuery(api.jobs.getRunningBySite, { siteId });

  if (!runningJob || !runningJob.stepProgress || runningJob.type !== "plan") return null;

  const { current, total } = runningJob.stepProgress;

  return (
    <div className="rounded-xl border border-border bg-surface-2/50 p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-you opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-you" />
        </span>
        <p className="text-[13px] font-medium text-text-2">
          Building your content strategy...
        </p>
        <span className="ml-auto text-[11px] text-text-3 tabular-nums">
          {current}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-1 w-full rounded-full bg-white/[0.04]">
        <div
          className="h-1 rounded-full bg-you transition-[width] duration-700 ease-out"
          style={{ width: `${(current / total) * 100}%` }}
        />
      </div>

      {/* Steps list */}
      <div className="flex flex-col gap-1">
        {PLAN_STEPS.slice(0, total).map((step, i) => {
          const stepNum = i + 1;
          const isCompleted = stepNum < current;
          const isActive = stepNum === current;
          const Icon = step.icon;

          return (
            <div
              key={step.label}
              className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${
                isActive ? "bg-surface-2/50" : ""
              } ${!isCompleted && !isActive ? "opacity-35" : ""}`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${
                  isCompleted
                    ? "bg-named/[0.1]"
                    : isActive
                      ? "bg-surface-2"
                      : "bg-white/[0.03]"
                }`}
              >
                {isCompleted ? (
                  <CheckCircle2 className="h-3 w-3 text-named" />
                ) : (
                  <Icon
                    className={`h-3 w-3 ${
                      isActive ? "text-text-2" : "text-text-3"
                    }`}
                  />
                )}
              </div>
              <div className="flex flex-col min-w-0">
                <span
                  className={`text-[12px] ${
                    isCompleted
                      ? "text-named/80"
                      : isActive
                        ? "text-text-2 font-medium"
                        : "text-text-3"
                  }`}
                >
                  {isActive ? runningJob.stepProgress!.stepLabel : step.label}
                </span>
                {(isActive || isCompleted) && (
                  <span className="text-[10px] text-text-3">{step.description}</span>
                )}
              </div>
              {isActive && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-you animate-pulse" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
