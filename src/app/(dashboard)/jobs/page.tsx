"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";
import {
  Zap,
  Globe,
  Map,
  FileText,
  Search,
  ShieldCheck,
  GitBranch,
  Clock,
  Activity,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { formatDistanceToNow, formatDuration, intervalToDuration } from "date-fns";

export default function JobsPage() {
  const jobs = useQuery(api.jobs.listAll);
  const [activeTab, setActiveTab] = useState("all");

  const filtered = useMemo(() => {
    if (!jobs) return [];
    if (activeTab === "all") return jobs;
    return jobs.filter((j) => j.status === activeTab);
  }, [jobs, activeTab]);

  const runningCount = jobs?.filter((j) => j.status === "running").length ?? 0;
  const failedCount = jobs?.filter((j) => j.status === "failed").length ?? 0;

  const tabs = [
    { id: "all", label: "All", count: jobs?.length ?? 0 },
    {
      id: "running",
      label: "Running",
      count: runningCount,
    },
    {
      id: "done",
      label: "Done",
      count: jobs?.filter((j) => j.status === "done").length ?? 0,
    },
    {
      id: "failed",
      label: "Failed",
      count: failedCount,
    },
  ];

  if (jobs === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="h-6 w-28 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-4 w-48 animate-pulse rounded bg-white/[0.03]" />
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117]">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.04] last:border-0">
              <div className="h-8 w-8 animate-pulse rounded-lg bg-white/[0.04]" />
              <div className="flex-1">
                <div className="h-3.5 w-32 animate-pulse rounded bg-white/[0.04]" />
              </div>
              <div className="h-3 w-16 animate-pulse rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Pipeline"
        subtitle={
          runningCount > 0
            ? `${runningCount} job${runningCount > 1 ? "s" : ""} running`
            : failedCount > 0
              ? `${failedCount} failed`
              : "Auto-refreshes via Convex"
        }
      />

      {/* Status indicator */}
      {runningCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-[#0EA5E9]/[0.06] border border-[#0EA5E9]/[0.1] px-4 py-2.5">
          <span className="flex h-2 w-2">
            <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-[#0EA5E9] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0EA5E9]" />
          </span>
          <span className="text-[13px] text-[#38BDF8]">
            Pipeline is actively processing
          </span>
        </div>
      )}

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Job Timeline */}
      {filtered.length > 0 ? (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-[19px] top-6 bottom-6 w-px bg-white/[0.04] hidden sm:block" />

          <div className="flex flex-col gap-0">
            {filtered.map((job, i) => {
              const duration =
                job.status === "done" || job.status === "failed"
                  ? getDuration(job.createdAt, job.updatedAt)
                  : null;

              return (
                <div
                  key={job._id}
                  className="flex items-start gap-3 sm:gap-4 px-0 sm:pl-1 py-3"
                >
                  {/* Timeline dot */}
                  <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    job.status === "done"
                      ? "bg-[#22C55E]/[0.08]"
                      : job.status === "running"
                        ? "bg-[#0EA5E9]/[0.1] ring-1 ring-[#0EA5E9]/20"
                        : job.status === "failed"
                          ? "bg-[#EF4444]/[0.08]"
                          : "bg-white/[0.04]"
                  }`}>
                    <JobIcon
                      type={job.type}
                      className={`h-3.5 w-3.5 ${
                        job.status === "done"
                          ? "text-[#22C55E]"
                          : job.status === "running"
                            ? "text-[#0EA5E9]"
                            : job.status === "failed"
                              ? "text-[#EF4444]"
                              : "text-[#565A6E]"
                      }`}
                    />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[13px] font-medium text-[#EDEEF1]">
                        {jobLabel(job.type)}
                      </p>
                      {job.status === "done" && (
                        <CheckCircle2 className="h-3 w-3 text-[#22C55E]" />
                      )}
                      {job.status === "running" && (
                        <span className="flex items-center gap-1 text-[10px] text-[#0EA5E9]">
                          <span className="h-1 w-1 rounded-full bg-[#0EA5E9] animate-pulse" />
                          running
                        </span>
                      )}
                      {job.status === "failed" && (
                        <span className="text-[10px] text-[#EF4444]">failed</span>
                      )}
                    </div>

                    {/* Error */}
                    {job.error && (
                      <div className="mt-1.5 flex items-start gap-1.5 rounded bg-[#EF4444]/[0.04] px-2.5 py-1.5">
                        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-[#EF4444]" />
                        <p className="text-[11px] text-[#F87171] break-all leading-relaxed">
                          {job.error}
                        </p>
                      </div>
                    )}

                    <div className="mt-1 flex items-center gap-2 text-[11px] text-[#565A6E]">
                      <span>
                        {formatDistanceToNow(job.createdAt, { addSuffix: true })}
                      </span>
                      {duration && (
                        <>
                          <span className="text-white/[0.08]">·</span>
                          <span>{duration}</span>
                        </>
                      )}
                      {job.retries != null && job.retries > 0 && (
                        <>
                          <span className="text-white/[0.08]">·</span>
                          <span className="text-[#F59E0B]">
                            attempt {job.retries + 1}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-12 text-center">
          <Zap className="mx-auto h-10 w-10 text-[#565A6E]/30" />
          <p className="mt-3 text-[13px] text-[#565A6E]">
            {activeTab !== "all"
              ? "No jobs match this filter."
              : "No pipeline activity yet."}
          </p>
        </div>
      )}
    </div>
  );
}

function JobIcon({ type, className }: { type: string; className?: string }) {
  const cn = className ?? "h-3.5 w-3.5";
  switch (type) {
    case "onboarding":
      return <Globe className={cn} />;
    case "plan":
      return <Map className={cn} />;
    case "article":
      return <FileText className={cn} />;
    case "links":
      return <Search className={cn} />;
    case "factcheck":
      return <ShieldCheck className={cn} />;
    case "publish":
      return <GitBranch className={cn} />;
    default:
      return <Activity className={cn} />;
  }
}

function jobLabel(type: string): string {
  switch (type) {
    case "onboarding":
      return "Site crawl";
    case "plan":
      return "Topic generation";
    case "article":
      return "Article generation";
    case "links":
      return "Internal linking";
    case "scheduler":
      return "Scheduler";
    case "publish":
      return "Publishing";
    case "factcheck":
      return "Fact check";
    default:
      return type;
  }
}

function getDuration(start: number, end: number): string {
  const duration = intervalToDuration({ start, end });
  return formatDuration(duration, { format: ["minutes", "seconds"] }) || "< 1s";
}
