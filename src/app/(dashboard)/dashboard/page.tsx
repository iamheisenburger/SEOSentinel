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
      <div className="flex flex-col gap-8">
        <div>
          <div className="mb-2 h-8 w-48 animate-pulse rounded-lg bg-[#1E293B]" />
          <div className="h-4 w-72 animate-pulse rounded-lg bg-[#1E293B]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-2xl border border-[#1E293B] bg-[#111827] p-5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 animate-pulse rounded-xl bg-[#1E293B]" />
                <div>
                  <div className="mb-2 h-3 w-16 animate-pulse rounded bg-[#1E293B]" />
                  <div className="h-6 w-12 animate-pulse rounded bg-[#1E293B]" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl border border-[#1E293B] bg-[#111827] divide-y divide-[#1E293B]">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5">
              <div className="h-8 w-8 animate-pulse rounded-lg bg-[#1E293B]" />
              <div className="flex-1">
                <div className="mb-1.5 h-4 w-48 animate-pulse rounded bg-[#1E293B]" />
              </div>
              <div className="h-5 w-16 animate-pulse rounded-full bg-[#1E293B]" />
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
    <div className="flex flex-col gap-8">
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
          className={`rounded-lg px-4 py-2.5 text-sm ${
            genMessage.includes("failed") || genMessage.includes("No available")
              ? "bg-[#EF4444]/10 text-[#F87171]"
              : genMessage.includes("...")
                ? "bg-[#0EA5E9]/10 text-[#38BDF8]"
                : "bg-[#22C55E]/10 text-[#4ADE80]"
          }`}
        >
          {genMessage}
        </div>
      )}

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<FileText className="h-5 w-5" />}
          label="Published"
          value={loading ? "—" : publishedCount}
          subtitle={`${articles?.length ?? 0} total articles`}
        />
        <StatCard
          icon={<Activity className="h-5 w-5" />}
          label="Pipeline"
          value={loading ? "—" : runningJobs > 0 ? "Active" : "Idle"}
          subtitle={`${runningJobs} job${runningJobs !== 1 ? "s" : ""} in progress`}
        />
        <StatCard
          icon={<Map className="h-5 w-5" />}
          label="Topics"
          value={loading ? "—" : availableTopics}
          subtitle="Available to write"
        />
        <StatCard
          icon={<Clock className="h-5 w-5" />}
          label={reviewCount > 0 ? "Awaiting Review" : "Cadence"}
          value={
            loading
              ? "—"
              : reviewCount > 0
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
        <h2 className="mb-4 text-base font-semibold text-[#F1F5F9]">
          Recent Activity
        </h2>
        {recentJobs.length > 0 ? (
          <div className="rounded-2xl border border-[#1E293B] bg-[#111827] divide-y divide-[#1E293B]">
            {recentJobs.map((job) => (
              <div
                key={job._id}
                className="flex items-center gap-4 px-5 py-3.5"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#1E293B] text-[#64748B]">
                  <JobIcon type={job.type} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[#F1F5F9]">
                    {jobLabel(job.type)}
                  </p>
                  {job.error && (
                    <p className="mt-0.5 truncate text-xs text-[#EF4444]">
                      {job.error}
                    </p>
                  )}
                </div>
                <StatusBadge status={job.status} />
                <span className="shrink-0 text-xs text-[#475569]">
                  {formatDistanceToNow(job.updatedAt, { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-[#1E293B] bg-[#111827] p-8 text-center">
            <Activity className="mx-auto h-8 w-8 text-[#1E293B]" />
            <p className="mt-3 text-sm text-[#64748B]">
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
      return <Globe className="h-4 w-4" />;
    case "plan":
      return <Map className="h-4 w-4" />;
    case "article":
      return <FileText className="h-4 w-4" />;
    case "links":
      return <Activity className="h-4 w-4" />;
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

// Re-import for JobIcon (avoid adding to the top-level imports list for cleanliness)
import { Globe } from "lucide-react";
