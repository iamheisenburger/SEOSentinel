"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Tabs } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Activity,
  Globe,
  Map,
  FileText,
  Link2,
  Clock,
  AlertCircle,
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

  const tabs = [
    { id: "all", label: "All", count: jobs?.length ?? 0 },
    {
      id: "running",
      label: "Running",
      count: jobs?.filter((j) => j.status === "running").length ?? 0,
    },
    {
      id: "done",
      label: "Completed",
      count: jobs?.filter((j) => j.status === "done").length ?? 0,
    },
    {
      id: "failed",
      label: "Failed",
      count: jobs?.filter((j) => j.status === "failed").length ?? 0,
    },
  ];

  if (jobs === undefined) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <div className="mb-1.5 h-6 w-24 animate-pulse rounded bg-white/[0.04]" />
          <div className="h-4 w-48 animate-pulse rounded bg-white/[0.03]" />
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] divide-y divide-white/[0.04]">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-7 w-7 animate-pulse rounded-lg bg-white/[0.04]" />
              <div className="flex-1">
                <div className="h-3.5 w-32 animate-pulse rounded bg-white/[0.04]" />
              </div>
              <div className="h-4 w-14 animate-pulse rounded-full bg-white/[0.04]" />
              <div className="h-3 w-16 animate-pulse rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Jobs"
        subtitle="Pipeline job history — auto-refreshes via Convex"
      />

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {filtered.length > 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] divide-y divide-white/[0.04]">
          {filtered.map((job) => {
            const duration =
              job.status === "done" || job.status === "failed"
                ? getDuration(job.createdAt, job.updatedAt)
                : null;

            return (
              <div
                key={job._id}
                className="flex items-start gap-3 px-4 py-3.5"
              >
                {/* Icon */}
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[#565A6E]">
                  <JobIcon type={job.type} />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-medium text-[#EDEEF1]">
                      {jobLabel(job.type)}
                    </p>
                    <StatusBadge status={job.status} />
                  </div>

                  {/* Error */}
                  {job.error && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg bg-[#EF4444]/[0.04] px-3 py-2">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-[#EF4444]" />
                      <p className="text-[11px] text-[#F87171] break-all">
                        {job.error}
                      </p>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-[#565A6E]">
                    <span>
                      {formatDistanceToNow(job.createdAt, { addSuffix: true })}
                    </span>
                    {duration && (
                      <>
                        <span className="text-white/[0.1]">·</span>
                        <span>{duration}</span>
                      </>
                    )}
                    {job.retries != null && job.retries > 0 && (
                      <>
                        <span className="text-white/[0.1]">·</span>
                        <span className="text-[#F59E0B]">
                          Attempt {job.retries + 1}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-10 text-center">
          <Activity className="mx-auto h-8 w-8 text-[#565A6E]/40" />
          <p className="mt-3 text-[13px] text-[#565A6E]">
            {jobs === undefined
              ? "Loading jobs..."
              : "No jobs yet. They appear here when the pipeline runs."}
          </p>
        </div>
      )}
    </div>
  );
}

function JobIcon({ type }: { type: string }) {
  switch (type) {
    case "onboarding":
      return <Globe className="h-3.5 w-3.5" />;
    case "plan":
      return <Map className="h-3.5 w-3.5" />;
    case "article":
      return <FileText className="h-3.5 w-3.5" />;
    case "links":
      return <Link2 className="h-3.5 w-3.5" />;
    default:
      return <Clock className="h-3.5 w-3.5" />;
  }
}

function jobLabel(type: string): string {
  switch (type) {
    case "onboarding":
      return "Site onboarding crawl";
    case "plan":
      return "Content plan generation";
    case "article":
      return "Article generation";
    case "links":
      return "Internal link suggestion";
    case "scheduler":
      return "Autopilot scheduler";
    case "publish":
      return "Article publishing";
    case "factcheck":
      return "Fact checking";
    default:
      return type;
  }
}

function getDuration(start: number, end: number): string {
  const duration = intervalToDuration({ start, end });
  return formatDuration(duration, { format: ["minutes", "seconds"] }) || "< 1s";
}
