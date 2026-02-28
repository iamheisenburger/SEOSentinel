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
          <div className="mb-2 h-8 w-32 animate-pulse rounded-lg bg-[#1E293B]" />
          <div className="h-4 w-48 animate-pulse rounded-lg bg-[#1E293B]" />
        </div>
        <div className="rounded-2xl border border-[#1E293B] bg-[#111827] divide-y divide-[#1E293B]">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <div className="h-9 w-9 animate-pulse rounded-lg bg-[#1E293B]" />
              <div className="flex-1">
                <div className="mb-1.5 h-4 w-40 animate-pulse rounded bg-[#1E293B]" />
              </div>
              <div className="h-5 w-16 animate-pulse rounded-full bg-[#1E293B]" />
              <div className="h-3 w-20 animate-pulse rounded bg-[#1E293B]" />
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
        <div className="rounded-2xl border border-[#1E293B] bg-[#111827] divide-y divide-[#1E293B]">
          {filtered.map((job) => {
            const duration =
              job.status === "done" || job.status === "failed"
                ? getDuration(job.createdAt, job.updatedAt)
                : null;

            return (
              <div
                key={job._id}
                className="flex items-start gap-4 px-5 py-4"
              >
                {/* Icon */}
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1E293B] text-[#64748B]">
                  <JobIcon type={job.type} />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-[#F1F5F9]">
                      {jobLabel(job.type)}
                    </p>
                    <StatusBadge status={job.status} />
                  </div>

                  {/* Error */}
                  {job.error && (
                    <div className="mt-2 flex items-start gap-2 rounded-lg bg-[#EF4444]/5 px-3 py-2">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#EF4444]" />
                      <p className="text-xs text-[#F87171] break-all">
                        {job.error}
                      </p>
                    </div>
                  )}

                  {/* Meta */}
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-[#475569]">
                    <span>
                      {formatDistanceToNow(job.createdAt, { addSuffix: true })}
                    </span>
                    {duration && (
                      <>
                        <span>·</span>
                        <span>{duration}</span>
                      </>
                    )}
                    {job.retries != null && job.retries > 0 && (
                      <>
                        <span>·</span>
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
        <div className="rounded-2xl border border-[#1E293B] bg-[#111827] p-10 text-center">
          <Activity className="mx-auto h-10 w-10 text-[#1E293B]" />
          <p className="mt-4 text-sm text-[#64748B]">
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
      return <Globe className="h-4 w-4" />;
    case "plan":
      return <Map className="h-4 w-4" />;
    case "article":
      return <FileText className="h-4 w-4" />;
    case "links":
      return <Link2 className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
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
