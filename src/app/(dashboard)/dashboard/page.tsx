"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Activity,
  Map,
  Clock,
  Zap,
  Globe,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

export default function DashboardPage() {
  const sites = useQuery(api.sites.list);
  const site = sites?.[0];
  const topics = useQuery(
    api.topics.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const articles = useQuery(
    api.articles.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const jobs = useQuery(api.jobs.listAll);
  const generateNow = useAction(api.actions.pipeline.generateNow);
  const [genBusy, setGenBusy] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);

  const publishedCount =
    articles?.filter((a) => a.status === "published").length ?? 0;
  const reviewCount =
    articles?.filter((a) => a.status === "review").length ?? 0;
  const availableTopics =
    topics?.filter(
      (t) => t.status !== "used" && t.status !== "queued",
    ).length ?? 0;
  const runningJobs =
    jobs?.filter((j) => j.status === "running" || j.status === "pending")
      .length ?? 0;
  const recentJobs = jobs?.slice(0, 10) ?? [];

  const loading = sites === undefined;

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <div className="mb-1.5 h-6 w-40 animate-pulse rounded bg-white/[0.04]" />
          <div className="h-4 w-56 animate-pulse rounded bg-white/[0.03]" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 animate-pulse rounded-lg bg-white/[0.04]" />
                <div>
                  <div className="mb-1.5 h-3 w-14 animate-pulse rounded bg-white/[0.04]" />
                  <div className="h-5 w-10 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] divide-y divide-white/[0.04]">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="h-7 w-7 animate-pulse rounded-lg bg-white/[0.04]" />
              <div className="flex-1">
                <div className="h-3.5 w-36 animate-pulse rounded bg-white/[0.04]" />
              </div>
              <div className="h-4 w-14 animate-pulse rounded-full bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const handleGenerateNow = async () => {
    if (!site?._id) return;
    setGenBusy(true);
    setGenMessage("Generating article...");
    try {
      await generateNow({ siteId: site._id });
      setGenMessage("Article generated successfully.");
    } catch (err: unknown) {
      setGenMessage(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        subtitle={
          site
            ? `Monitoring ${site.domain}`
            : "Set up a site to get started"
        }
        actions={
          site && (
            <Button
              size="sm"
              onClick={handleGenerateNow}
              loading={genBusy}
              disabled={!site || availableTopics === 0}
              icon={<Zap className="h-3.5 w-3.5" />}
            >
              Generate Now
            </Button>
          )
        }
      />

      {genMessage && (
        <div
          className={`rounded-lg px-4 py-2 text-[13px] ${
            genMessage.includes("failed") || genMessage.includes("No available")
              ? "bg-[#EF4444]/[0.08] text-[#F87171]"
              : genMessage.includes("...")
                ? "bg-[#0EA5E9]/[0.08] text-[#38BDF8]"
                : "bg-[#22C55E]/[0.08] text-[#4ADE80]"
          }`}
        >
          {genMessage}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<FileText className="h-4 w-4" />}
          label="Published"
          value={publishedCount}
          subtitle={`${articles?.length ?? 0} total articles`}
        />
        <StatCard
          icon={<Activity className="h-4 w-4" />}
          label="Pipeline"
          value={runningJobs > 0 ? "Active" : "Idle"}
          subtitle={`${runningJobs} job${runningJobs !== 1 ? "s" : ""} in progress`}
        />
        <StatCard
          icon={<Map className="h-4 w-4" />}
          label="Topics"
          value={availableTopics}
          subtitle="Available to write"
        />
        <StatCard
          icon={<Clock className="h-4 w-4" />}
          label={reviewCount > 0 ? "Awaiting Review" : "Cadence"}
          value={
            reviewCount > 0
              ? reviewCount
              : `${site?.cadencePerWeek ?? 4}/wk`
          }
          subtitle={
            reviewCount > 0
              ? "Articles need your approval"
              : "Target articles per week"
          }
        />
      </div>

      {/* Activity Feed */}
      <div>
        <h2 className="mb-3 text-[13px] font-medium text-[#8B8FA3]">
          Recent Activity
        </h2>
        {recentJobs.length > 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] divide-y divide-white/[0.04]">
            {recentJobs.map((job) => (
              <div
                key={job._id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] text-[#565A6E]">
                  <JobIcon type={job.type} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[#EDEEF1]">
                    {jobLabel(job.type)}
                  </p>
                  {job.error && (
                    <p className="mt-0.5 truncate text-[11px] text-[#EF4444]">
                      {job.error}
                    </p>
                  )}
                </div>
                <StatusBadge status={job.status} />
                <span className="shrink-0 text-[11px] text-[#565A6E]">
                  {formatDistanceToNow(job.updatedAt, { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-8 text-center">
            <Activity className="mx-auto h-8 w-8 text-[#565A6E]/40" />
            <p className="mt-3 text-[13px] text-[#565A6E]">
              No activity yet. Start by adding a site and running onboarding.
            </p>
          </div>
        )}
      </div>
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
      return <Activity className="h-3.5 w-3.5" />;
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
