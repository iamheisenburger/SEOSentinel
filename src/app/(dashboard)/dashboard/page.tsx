"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { SetupWizard } from "@/components/onboarding/setup-wizard";
import {
  FileText,
  Activity,
  Target,
  Clock,
  Zap,
  Globe,
  Map,
  ArrowRight,
  GitBranch,
  Search,
  ShieldCheck,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArticleProgress } from "@/components/ui/article-progress";

export default function DashboardPage() {
  const forceSetup = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("setup") === "new";
  // Latch: once the wizard is shown, keep it visible until user finishes (page reload).
  // Without this, Convex reactive updates (upsert saving siteSummary mid-wizard)
  // would flip needsOnboarding false and yank the wizard away.
  const wizardLatch = useRef(false);
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
  const totalArticles = articles?.length ?? 0;
  const totalTopics = topics?.length ?? 0;
  const availableTopics =
    topics?.filter(
      (t) => t.status !== "used" && t.status !== "queued",
    ).length ?? 0;
  const runningJobs =
    jobs?.filter((j) => j.status === "running" || j.status === "pending")
      .length ?? 0;
  const recentJobs = jobs?.slice(0, 8) ?? [];
  const recentArticles = articles?.slice(0, 5) ?? [];

  const loading = sites === undefined;

  const handleGenerateNow = async () => {
    if (!site?._id) return;
    setGenBusy(true);
    setGenMessage("Starting pipeline...");
    try {
      await generateNow({ siteId: site._id });
      setGenMessage("Article generated successfully.");
    } catch (err: unknown) {
      setGenMessage(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenBusy(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  // Show wizard if: no site, not analyzed, or explicit ?setup=new
  if (!site || !site.siteSummary || forceSetup) {
    wizardLatch.current = true;
  }
  // Once latched, stay on wizard until page reload (wizard "done" step calls reload)
  if (wizardLatch.current || !site) {
    return <SetupWizard />;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ─── Header ───────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#EDEEF1]">
            Dashboard
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[13px] text-[#565A6E]">
              {site.domain}
            </span>
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${
              runningJobs > 0 ? "text-[#0EA5E9]" : "text-[#22C55E]"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                runningJobs > 0 ? "bg-[#0EA5E9] animate-pulse" : "bg-[#22C55E]"
              }`} />
              {runningJobs > 0 ? "Pipeline active" : "Idle"}
            </span>
          </div>
        </div>
        <Button
          onClick={handleGenerateNow}
          loading={genBusy}
          disabled={availableTopics === 0}
          icon={<Zap className="h-3.5 w-3.5" />}
        >
          Generate Now
        </Button>
      </div>

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

      {/* ─── Article Progress (live) ────────────── */}
      {site && <ArticleProgress siteId={site._id} />}

      {/* ─── Stats Row ────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {/* Published */}
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E]">
              Published
            </p>
            <FileText className="h-3.5 w-3.5 text-[#565A6E]" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[#EDEEF1]">
            {publishedCount}
          </p>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-[#565A6E] mb-1">
              <span>{publishedCount} of {totalArticles}</span>
              <span>{totalArticles > 0 ? Math.round((publishedCount / totalArticles) * 100) : 0}%</span>
            </div>
            <div className="h-1 w-full rounded-full bg-white/[0.04]">
              <div
                className="h-1 rounded-full bg-[#22C55E]"
                style={{ width: `${totalArticles > 0 ? (publishedCount / totalArticles) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Topics Remaining */}
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E]">
              Topics
            </p>
            <Target className="h-3.5 w-3.5 text-[#565A6E]" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[#EDEEF1]">
            {availableTopics}
          </p>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-[#565A6E] mb-1">
              <span>{availableTopics} available</span>
              <span>{totalTopics - availableTopics} used</span>
            </div>
            <div className="h-1 w-full rounded-full bg-white/[0.04]">
              <div
                className="h-1 rounded-full bg-[#0EA5E9]"
                style={{ width: `${totalTopics > 0 ? (availableTopics / totalTopics) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Cadence */}
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E]">
              Cadence
            </p>
            <Clock className="h-3.5 w-3.5 text-[#565A6E]" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-[#EDEEF1]">
            {site.cadencePerWeek ?? 4}<span className="text-sm font-normal text-[#565A6E]">/wk</span>
          </p>
          <p className="mt-2 text-[10px] text-[#565A6E]">
            {site.approvalRequired ? "Approval required" : "Auto-publish"}
          </p>
        </div>

        {/* Review Queue */}
        <div className={`rounded-xl border p-4 ${
          reviewCount > 0
            ? "border-[#F59E0B]/[0.2] bg-[#F59E0B]/[0.03]"
            : "border-white/[0.06] bg-[#0F1117]"
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E]">
              {reviewCount > 0 ? "Needs Review" : "Queue"}
            </p>
            <CheckCircle2 className={`h-3.5 w-3.5 ${reviewCount > 0 ? "text-[#F59E0B]" : "text-[#565A6E]"}`} />
          </div>
          <p className={`mt-2 text-2xl font-bold tracking-tight ${
            reviewCount > 0 ? "text-[#FBBF24]" : "text-[#EDEEF1]"
          }`}>
            {reviewCount}
          </p>
          {reviewCount > 0 ? (
            <Link href="/articles" className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-[#F59E0B] hover:text-[#FBBF24] transition">
              Review articles <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          ) : (
            <p className="mt-2 text-[10px] text-[#565A6E]">All clear</p>
          )}
        </div>
      </div>

      {/* ─── Quick Nav ────────────────────────────── */}
      <div className="grid gap-3 grid-cols-3">
        <Link href="/plan" className="group rounded-xl border border-white/[0.06] bg-[#0F1117] p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1]">
          <Target className="h-4 w-4 text-[#0EA5E9] mb-2" />
          <p className="text-[13px] font-medium text-[#EDEEF1]">Topics</p>
          <p className="text-[11px] text-[#565A6E]">{availableTopics} available · {totalTopics - availableTopics} used</p>
        </Link>
        <Link href="/articles" className="group rounded-xl border border-white/[0.06] bg-[#0F1117] p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1]">
          <FileText className="h-4 w-4 text-[#22C55E] mb-2" />
          <p className="text-[13px] font-medium text-[#EDEEF1]">Articles</p>
          <p className="text-[11px] text-[#565A6E]">{publishedCount} published · {totalArticles - publishedCount} drafts</p>
        </Link>
        <Link href="/jobs" className="group rounded-xl border border-white/[0.06] bg-[#0F1117] p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1]">
          <Activity className="h-4 w-4 text-[#F59E0B] mb-2" />
          <p className="text-[13px] font-medium text-[#EDEEF1]">Activity</p>
          <p className="text-[11px] text-[#565A6E]">{runningJobs > 0 ? `${runningJobs} running` : "All clear"}</p>
        </Link>
      </div>

      {/* ─── Recent Articles ─────────────────────── */}
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold text-[#EDEEF1]">
              Latest Articles
            </h2>
            <Link
              href="/articles"
              className="text-[11px] text-[#565A6E] hover:text-[#8B8FA3] transition"
            >
              View all
            </Link>
          </div>

          {recentArticles.length > 0 ? (
            <div className="flex flex-col divide-y divide-white/[0.04]">
              {recentArticles.map((article) => (
                <Link
                  key={article._id}
                  href={`/articles/${article._id}`}
                  className="group flex items-start gap-3 py-3 first:pt-0 last:pb-0 transition hover:bg-white/[0.02] -mx-2 px-2 rounded-lg"
                >
                  <div className="mt-0.5 shrink-0">
                    <StatusBadge status={article.status} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[#EDEEF1] leading-snug line-clamp-1 group-hover:text-white transition">
                      {article.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-[#565A6E]">
                      <span>{Math.round(article.markdown.split(/\s+/).length).toLocaleString()} words</span>
                      <span className="text-white/[0.08]">·</span>
                      <span>{formatDistanceToNow(article.createdAt, { addSuffix: true })}</span>
                    </div>
                  </div>
                  <ExternalLink className="h-3 w-3 mt-1 text-[#565A6E] opacity-0 group-hover:opacity-100 transition shrink-0" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="h-8 w-8 text-[#565A6E]/30" />
              <p className="mt-2 text-[12px] text-[#565A6E]">
                No articles yet. Click &ldquo;Generate Now&rdquo; to create your first.
              </p>
            </div>
          )}
        </div>

      {/* ─── Activity Timeline ────────────────────── */}
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[13px] font-semibold text-[#EDEEF1]">
            Activity
          </h2>
          <Link
            href="/jobs"
            className="text-[11px] text-[#565A6E] hover:text-[#8B8FA3] transition"
          >
            View all
          </Link>
        </div>

        {recentJobs.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {recentJobs.map((job) => (
              <div
                key={job._id}
                className="flex items-center gap-2.5 rounded-lg bg-white/[0.02] px-3 py-2.5 border border-white/[0.03]"
              >
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                  job.status === "done"
                    ? "bg-[#22C55E]/[0.08]"
                    : job.status === "running"
                      ? "bg-[#0EA5E9]/[0.08]"
                      : job.status === "failed"
                        ? "bg-[#EF4444]/[0.08]"
                        : "bg-white/[0.04]"
                }`}>
                  <JobIcon
                    type={job.type}
                    className={`h-3 w-3 ${
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
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-[#EDEEF1] truncate">
                    {jobLabel(job.type)}
                  </p>
                  <p className="text-[10px] text-[#565A6E]">
                    {formatDistanceToNow(job.updatedAt, { addSuffix: true })}
                  </p>
                </div>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  job.status === "done"
                    ? "bg-[#22C55E]"
                    : job.status === "running"
                      ? "bg-[#0EA5E9] animate-pulse"
                      : job.status === "failed"
                        ? "bg-[#EF4444]"
                        : "bg-[#565A6E]"
                }`} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center py-6 text-[12px] text-[#565A6E]">
            No pipeline activity yet.
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Skeleton ──────────────────────────────────── */

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="h-6 w-32 animate-pulse rounded bg-white/[0.04]" />
        <div className="mt-2 h-4 w-48 animate-pulse rounded bg-white/[0.03]" />
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
            <div className="h-3 w-16 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-3 h-7 w-12 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-3 h-1 w-full animate-pulse rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
            <div className="h-4 w-4 animate-pulse rounded bg-white/[0.04] mb-2" />
            <div className="h-3.5 w-20 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-1 h-3 w-28 animate-pulse rounded bg-white/[0.03]" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-3 border-b border-white/[0.03] last:border-0">
            <div className="h-4 w-14 animate-pulse rounded-full bg-white/[0.04]" />
            <div className="h-3.5 w-40 animate-pulse rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Helpers ───────────────────────────────────── */

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
