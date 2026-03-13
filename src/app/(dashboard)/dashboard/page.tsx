"use client";

import { useAuth } from "@clerk/nextjs";

import { useAction, useMutation, useQuery } from "convex/react";
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
  AlertTriangle,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  BarChart3,
  MousePointerClick,
  Eye,
  Link2,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArticleProgress } from "@/components/ui/article-progress";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";

export default function DashboardPage() {
  const forceSetup = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("setup") === "new";
  const wizardLatch = useRef(false);
  const { activeSite: site, sites } = useActiveSite();
  const { userId: dashClerkId } = useAuth();
  const fixOrphan = useMutation(api.sites.fixOrphanSites);
  useEffect(() => { if (dashClerkId) fixOrphan({ clerkUserId: dashClerkId }).catch(() => {}); }, [dashClerkId]);
  const topics = useQuery(
    api.topics.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const articles = useQuery(
    api.articles.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const jobs = useQuery(api.jobs.listAll);
  const gscSummary = useQuery(
    api.searchPerformance.getSummary,
    site?._id ? { siteId: site._id } : "skip",
  );
  const topQueries = useQuery(
    api.searchPerformance.getTopQueries,
    site?._id ? { siteId: site._id, limit: 5 } : "skip",
  );
  const decayingArticles = useQuery(
    api.articles.listDecaying,
    site?._id ? { siteId: site._id } : "skip",
  );
  const generateNow = useAction(api.actions.pipeline.generateNow);
  const crawlAndAnalyze = useAction(api.actions.pipeline.crawlAndAnalyze);
  const [genBusy, setGenBusy] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const { maxSites, maxArticles, isFreePlan } = usePlanLimits();

  // Articles generated this calendar month (across all sites)
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const articlesThisMonth =
    articles?.filter((a) => a.createdAt >= monthStart.getTime()).length ?? 0;
  const atArticleLimit = articlesThisMonth >= maxArticles;
  const atSiteLimit = (sites?.length ?? 0) >= maxSites;

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
  const decayCount = decayingArticles?.length ?? 0;

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

  const profileIncomplete = site && !site.siteSummary;

  const handleReanalyze = async () => {
    if (!site?._id) return;
    setAnalyzeBusy(true);
    try {
      await crawlAndAnalyze({ siteId: site._id });
      window.location.reload();
    } catch {
      setAnalyzeBusy(false);
    }
  };

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (!site || forceSetup) {
    wizardLatch.current = true;
  }
  if (wizardLatch.current || !site) {
    return <SetupWizard />;
  }

  const hasGSC = !!gscSummary;

  return (
    <div className="flex flex-col gap-5">
      {/* ─── Header ───────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#EDEEF1]">
            Overview
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
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              if (atSiteLimit) {
                setGenMessage(
                  `Site limit reached (${maxSites}). Upgrade your plan to add more sites.`,
                );
                return;
              }
              window.location.assign("/dashboard?setup=new");
            }}
            icon={<Globe className="h-3.5 w-3.5" />}
          >
            Add Website
          </Button>
          <Button
            onClick={handleGenerateNow}
            loading={genBusy}
            disabled={availableTopics === 0 || atArticleLimit}
            icon={<Zap className="h-3.5 w-3.5" />}
          >
            {atArticleLimit ? "Limit Reached" : "Generate Now"}
          </Button>
        </div>
      </div>

      {/* Plan usage banner */}
      {atArticleLimit && (
        <div className="flex items-center gap-3 rounded-lg border border-[#F59E0B]/[0.2] bg-[#F59E0B]/[0.05] px-4 py-3">
          <Zap className="h-4 w-4 shrink-0 text-[#F59E0B]" />
          <p className="flex-1 text-[13px] text-[#FBBF24]">
            You&apos;ve used all {maxArticles} articles this month.{" "}
            <Link href="/upgrade" className="underline font-medium hover:text-white transition">
              Upgrade your plan
            </Link>{" "}
            to generate more.
          </p>
        </div>
      )}

      {profileIncomplete && (
        <div className="flex items-center gap-3 rounded-lg border border-[#F59E0B]/[0.2] bg-[#F59E0B]/[0.05] px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-[#F59E0B]" />
          <p className="flex-1 text-[13px] text-[#FBBF24]">
            Site profile incomplete — article quality may be affected.
          </p>
          <Button
            variant="secondary"
            onClick={handleReanalyze}
            loading={analyzeBusy}
            icon={<RefreshCw className="h-3 w-3" />}
          >
            Re-analyze
          </Button>
        </div>
      )}

      {/* Decay alert banner */}
      {decayCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-[#EF4444]/[0.2] bg-[#EF4444]/[0.05] px-4 py-3">
          <TrendingDown className="h-4 w-4 shrink-0 text-[#EF4444]" />
          <p className="flex-1 text-[13px] text-[#F87171]">
            {decayCount} article{decayCount > 1 ? "s" : ""} losing rankings.{" "}
            <Link href="/articles" className="underline font-medium hover:text-white transition">
              View declining articles
            </Link>
          </p>
        </div>
      )}

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

      {/* ─── Search Performance (GSC) ────────────── */}
      {hasGSC && (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[#0EA5E9]" />
              <h2 className="text-[13px] font-semibold text-[#EDEEF1]">
                Search Performance
              </h2>
            </div>
            <Link
              href="/analytics"
              className="text-[11px] text-[#565A6E] hover:text-[#8B8FA3] transition flex items-center gap-1"
            >
              Full analytics <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          </div>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <MousePointerClick className="h-3 w-3 text-[#0EA5E9]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Clicks</span>
              </div>
              <p className="text-lg font-bold text-[#EDEEF1]">{gscSummary.totalClicks.toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Eye className="h-3 w-3 text-[#22D3EE]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Impressions</span>
              </div>
              <p className="text-lg font-bold text-[#EDEEF1]">{gscSummary.totalImpressions.toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="h-3 w-3 text-[#22C55E]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">CTR</span>
              </div>
              <p className="text-lg font-bold text-[#EDEEF1]">{gscSummary.avgCtr}%</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Search className="h-3 w-3 text-[#F59E0B]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">Avg Position</span>
              </div>
              <p className="text-lg font-bold text-[#EDEEF1]">{gscSummary.avgPosition}</p>
            </div>
          </div>

          {/* Top Keywords */}
          {topQueries && topQueries.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E] mb-2">Top Keywords</p>
              <div className="flex flex-col gap-1.5">
                {topQueries.map((q, i) => {
                  const maxClicks = topQueries[0].clicks || 1;
                  return (
                    <div key={i} className="group flex items-center gap-3">
                      <span className="text-[10px] font-mono text-[#565A6E] w-4 text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[12px] text-[#EDEEF1] truncate">{q.query}</span>
                          <div className="flex items-center gap-3 shrink-0 text-[10px] text-[#565A6E]">
                            <span>{q.clicks} clicks</span>
                            <span>pos {q.position}</span>
                          </div>
                        </div>
                        <div className="h-1 w-full rounded-full bg-white/[0.04]">
                          <div
                            className="h-1 rounded-full bg-[#0EA5E9]/40 transition-all"
                            style={{ width: `${Math.max((q.clicks / maxClicks) * 100, 2)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

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

        {/* Content Health */}
        <div className={`rounded-xl border p-4 ${
          decayCount > 0
            ? "border-[#EF4444]/[0.2] bg-[#EF4444]/[0.03]"
            : reviewCount > 0
              ? "border-[#F59E0B]/[0.2] bg-[#F59E0B]/[0.03]"
              : "border-white/[0.06] bg-[#0F1117]"
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E]">
              {decayCount > 0 ? "Attention" : reviewCount > 0 ? "Needs Review" : "Health"}
            </p>
            {decayCount > 0 ? (
              <TrendingDown className="h-3.5 w-3.5 text-[#EF4444]" />
            ) : reviewCount > 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[#F59E0B]" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E]" />
            )}
          </div>
          {decayCount > 0 ? (
            <>
              <p className="mt-2 text-2xl font-bold tracking-tight text-[#F87171]">
                {decayCount}
              </p>
              <Link href="/articles" className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-[#EF4444] hover:text-[#F87171] transition">
                Declining articles <ArrowRight className="h-2.5 w-2.5" />
              </Link>
            </>
          ) : reviewCount > 0 ? (
            <>
              <p className="mt-2 text-2xl font-bold tracking-tight text-[#FBBF24]">
                {reviewCount}
              </p>
              <Link href="/articles" className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-[#F59E0B] hover:text-[#FBBF24] transition">
                Review articles <ArrowRight className="h-2.5 w-2.5" />
              </Link>
            </>
          ) : (
            <>
              <p className="mt-2 text-2xl font-bold tracking-tight text-[#22C55E]">
                Good
              </p>
              <p className="mt-2 text-[10px] text-[#565A6E]">All content healthy</p>
            </>
          )}
        </div>
      </div>

      {/* ─── Quick Nav ────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
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
        <Link href="/analytics" className="group rounded-xl border border-white/[0.06] bg-[#0F1117] p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1]">
          <BarChart3 className="h-4 w-4 text-[#22D3EE] mb-2" />
          <p className="text-[13px] font-medium text-[#EDEEF1]">Analytics</p>
          <p className="text-[11px] text-[#565A6E]">{hasGSC ? `${gscSummary.queryCount} keywords tracked` : "Connect GSC"}</p>
        </Link>
        <Link href="/backlinks" className="group rounded-xl border border-white/[0.06] bg-[#0F1117] p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1]">
          <Link2 className="h-4 w-4 text-[#F59E0B] mb-2" />
          <p className="text-[13px] font-medium text-[#EDEEF1]">Backlinks</p>
          <p className="text-[11px] text-[#565A6E]">Analyze & outreach</p>
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
                      {(article.decayStatus === "warning" || article.decayStatus === "declining") && (
                        <>
                          <span className="text-white/[0.08]">·</span>
                          <span className={`inline-flex items-center gap-1 ${
                            article.decayStatus === "declining" ? "text-[#EF4444]" : "text-[#F59E0B]"
                          }`}>
                            <TrendingDown className="h-2.5 w-2.5" />
                            {article.decayStatus === "declining" ? "Declining" : "Warning"}
                          </span>
                        </>
                      )}
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
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
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
