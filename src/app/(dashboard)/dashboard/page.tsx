"use client";

import { useAction, useQuery } from "convex/react";
import { useAuth } from "@clerk/nextjs";
import { api } from "../../../../convex/_generated/api";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { SetupWizard } from "@/components/onboarding/setup-wizard";
import { ContentWorkOverview } from "@/components/content-work-overview";
import { ContentStart } from "@/components/onboarding/content-start";
import { ContentWorkService } from "@/components/content-work-service";
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
import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { ArticleProgress } from "@/components/ui/article-progress";
import { GrowthLoopStatus } from "@/components/growth-loop/growth-loop-status";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";
import { cadenceLabel } from "../../../../convex/planLimits";
import { dashboardActivityView } from "@/lib/dashboard-activity";
import {
  autopilotHealthRequiresAttention,
  dashboardAutopilotRequiresAttention,
} from "../../../../convex/lib/autopilotAlerts";
import { useVisibleQuery } from "@/hooks/useVisibleQuery";
import { DashboardSwitch } from "@/components/answers/dashboard/dashboard-route";

function LegacyDashboardPage() {
  const setupMode = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("setup")
    : null;
  const forceSetup = setupMode === "new";
  const finishExistingSetup = setupMode === "existing";
  const wizardLatch = useRef(false);
  const { activeSite: site, sites } = useActiveSite();
  const legacySite = site && site.serviceMode !== "growth_first" && !site.contentSetupRequestedAt ? site : null;
  const { userId } = useAuth();
  const topics = useVisibleQuery(
    api.topics.listBySite,
    legacySite?._id ? { siteId: legacySite._id } : "skip",
  );
  const articles = useQuery(
    api.articles.listBySite,
    legacySite?._id ? { siteId: legacySite._id } : "skip",
  );
  const jobActivity = useQuery(api.jobs.getDashboardActivity,
    legacySite?._id ? { siteId: legacySite._id } : "skip");
  const gscSummary = useQuery(
    api.searchPerformance.getSummary,
    legacySite?._id ? { siteId: legacySite._id } : "skip",
  );
  const topQueries = useQuery(
    api.searchPerformance.getTopQueries,
    legacySite?._id ? { siteId: legacySite._id, limit: 5 } : "skip",
  );
  const decayingArticles = useQuery(
    api.articles.listDecaying,
    legacySite?._id ? { siteId: legacySite._id } : "skip",
  );
  const autopilotHealth = useQuery(
    api.autopilot.getHealthForSite,
    legacySite?._id ? { siteId: legacySite._id } : "skip",
  );
  const generateNow = useAction(api.actions.pipeline.generateNow);
  const crawlAndAnalyze = useAction(api.actions.pipeline.crawlAndAnalyze);
  const [genBusy, setGenBusy] = useState(false);
  const [genMessage, setGenMessage] = useState<string | null>(null);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);
  const { maxSites, maxArticles } = usePlanLimits();
  const usageCount = useQuery(
    api.articles.countThisMonth,
    userId && legacySite ? { userId } : "skip",
  );

  // Account-wide immutable usage remains truthful across sites and deletions.
  const articlesThisMonth = usageCount ?? 0;
  const atArticleLimit = articlesThisMonth >= maxArticles;
  const atSiteLimit = maxSites < 9999 && (sites?.length ?? 0) >= maxSites;

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
  const activity = dashboardActivityView(site?._id, jobActivity);
  const recentJobs = activity.recent?.jobs ?? [];
  const recentArticles = articles?.slice(0, 5) ?? [];
  const decayCount = decayingArticles?.length ?? 0;
  // Until health, decay and articles load, the health card says so instead of "Good".
  const healthLoading = autopilotHealth === undefined || decayingArticles === undefined || articles === undefined;
  const activeAutopilotAlerts = autopilotHealth?.alerts ?? [];
  const autopilotBlocked = dashboardAutopilotRequiresAttention({
    health: autopilotHealth?.health,
    alerts: activeAutopilotAlerts,
  });
  const healthRequiresAttention = autopilotHealthRequiresAttention(
    autopilotHealth?.health?.status,
  );
  const autopilotAttentionMessage = healthRequiresAttention
    ? autopilotHealth?.health?.detail
    : activeAutopilotAlerts[0]?.message;

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

  if (finishExistingSetup && site) {
    return <SetupWizard existingSite={site} />;
  }

  if (!site || forceSetup) {
    wizardLatch.current = true;
  }
  if (wizardLatch.current || !site) {
    return <ContentStart />;
  }

  const hasGSC = !!gscSummary;

  if (site.serviceMode === "growth_first") return <ContentWorkOverview key={site._id} siteId={site._id} />;
  if (site.contentSetupRequestedAt) return <ContentWorkService key={site._id} siteId={site._id} />;

  return (
    <div className="flex flex-col gap-5">
      {/* ─── Header ───────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text">
            Overview
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[13px] text-text-3">
              {site.domain}
            </span>
            <span role="status" title={activity.detail} className={`inline-flex items-center gap-1 text-[11px] font-medium ${
              activity.state === "running" ? "text-text-2" : "text-text-2"
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                activity.state === "running" ? "bg-you animate-pulse" : "bg-text-4"
              }`} />
              {activity.label}
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
            variant="secondary"
            onClick={handleGenerateNow}
            loading={genBusy}
            disabled={availableTopics === 0 || atArticleLimit}
            icon={<Zap className="h-3.5 w-3.5" />}
          >
            {atArticleLimit ? "Limit Reached" : "Generate Now"}
          </Button>
        </div>
      </div>

      {autopilotBlocked && (
        <div className="rounded-lg border border-wrong/[0.25] bg-wrong/[0.06] px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-wrong" />
            <div>
              <p className="text-[13px] font-semibold text-wrong">
                Content automation needs attention
              </p>
              <p className="mt-1 text-[12px] text-wrong">
                {autopilotAttentionMessage ??
                  "Automation is fail-closed."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Plan usage banner */}
      {atArticleLimit && (
        <div className="flex items-center gap-3 rounded-lg border border-rival/[0.2] bg-rival/[0.05] px-4 py-3">
          <Zap className="h-4 w-4 shrink-0 text-rival" />
          <p className="flex-1 text-[13px] text-rival">
            You&apos;ve used all {maxArticles} articles this month.{" "}
            <Link href="/upgrade" className="underline font-medium hover:text-text transition">
              Upgrade your plan
            </Link>{" "}
            to generate more.
          </p>
        </div>
      )}

      {profileIncomplete && (
        <div className="flex items-center gap-3 rounded-lg border border-rival/[0.2] bg-rival/[0.05] px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rival" />
          <p className="flex-1 text-[13px] text-rival">
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
        <div className="flex items-center gap-3 rounded-lg border border-wrong/[0.2] bg-wrong/[0.05] px-4 py-3">
          <TrendingDown className="h-4 w-4 shrink-0 text-wrong" />
          <p className="flex-1 text-[13px] text-wrong">
            {decayCount} article{decayCount > 1 ? "s" : ""} losing rankings.{" "}
            <Link href="/articles" className="underline font-medium hover:text-text transition">
              View declining articles
            </Link>
          </p>
        </div>
      )}

      {genMessage && (
        <div
          className={`rounded-lg px-4 py-2 text-[13px] ${
            genMessage.includes("failed") || genMessage.includes("No available")
              ? "bg-wrong/[0.08] text-wrong"
              : genMessage.includes("...")
                ? "bg-surface-2/50 text-text-2"
                : "bg-named/[0.08] text-named"
          }`}
        >
          {genMessage}
        </div>
      )}

      {/* ─── Article Progress (live) ────────────── */}
      {site && <ArticleProgress siteId={site._id} />}

      {site && <GrowthLoopStatus siteId={site._id} />}

      {/* ─── Search Performance (GSC) ────────────── */}
      {hasGSC && (
        <div className="rounded-xl border border-white/[0.06] bg-surface-1 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-text-2" />
              <h2 className="text-[13px] font-semibold text-text">
                Search Performance
              </h2>
            </div>
            <Link
              href="/analytics"
              className="text-[11px] text-text-3 hover:text-text-2 transition flex items-center gap-1"
            >
              Full analytics <ArrowRight className="h-2.5 w-2.5" />
            </Link>
          </div>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <MousePointerClick className="h-3 w-3 text-text-2" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-text-3">Clicks (28d)</span>
              </div>
              <p className="text-lg font-bold text-text">{gscSummary.totalClicks.toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Eye className="h-3 w-3 text-text-2" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-text-3">Impressions (28d)</span>
              </div>
              <p className="text-lg font-bold text-text">{gscSummary.totalImpressions.toLocaleString()}</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <TrendingUp className="h-3 w-3 text-text-2" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-text-3">CTR</span>
              </div>
              <p className="text-lg font-bold text-text">{gscSummary.avgCtr}%</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Search className="h-3 w-3 text-text-2" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-text-3">Avg Position</span>
              </div>
              <p className="text-lg font-bold text-text">{gscSummary.avgPosition}</p>
            </div>
          </div>

          {/* Top Keywords */}
          {topQueries && topQueries.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-text-3 mb-2">Top Keywords</p>
              <div className="flex flex-col gap-1.5">
                {topQueries.map((q, i) => {
                  const maxClicks = topQueries[0].clicks || 1;
                  return (
                    <div key={i} className="group flex items-center gap-3">
                      <span className="text-[10px] font-mono text-text-3 w-4 text-right shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-[12px] text-text truncate">{q.query}</span>
                          <div className="flex items-center gap-3 shrink-0 text-[10px] text-text-3">
                            <span>{q.clicks} clicks</span>
                            <span>pos {q.position}</span>
                          </div>
                        </div>
                        <div className="h-1 w-full rounded-full bg-white/[0.04]">
                          <div
                            className="h-1 rounded-full bg-surface-3 transition-all"
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
        <div className="rounded-xl border border-white/[0.06] bg-surface-1 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-3">
              Published
            </p>
            <FileText className="h-3.5 w-3.5 text-text-3" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-text">
            {publishedCount}
          </p>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-text-3 mb-1">
              <span>{publishedCount} of {totalArticles}</span>
              <span>{totalArticles > 0 ? Math.round((publishedCount / totalArticles) * 100) : 0}%</span>
            </div>
            <div className="h-1 w-full rounded-full bg-white/[0.04]">
              <div
                className="h-1 rounded-full bg-named"
                style={{ width: `${totalArticles > 0 ? (publishedCount / totalArticles) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Topics Remaining */}
        <div className="rounded-xl border border-white/[0.06] bg-surface-1 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-3">
              Topics
            </p>
            <Target className="h-3.5 w-3.5 text-text-3" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-text">
            {availableTopics}
          </p>
          <div className="mt-2">
            <div className="flex items-center justify-between text-[10px] text-text-3 mb-1">
              <span>{availableTopics} available</span>
              <span>{totalTopics - availableTopics} used</span>
            </div>
            <div className="h-1 w-full rounded-full bg-white/[0.04]">
              <div
                className="h-1 rounded-full bg-text-2"
                style={{ width: `${totalTopics > 0 ? (availableTopics / totalTopics) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Cadence */}
        <div className="rounded-xl border border-white/[0.06] bg-surface-1 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-3">
              Cadence
            </p>
            <Clock className="h-3.5 w-3.5 text-text-3" />
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-text">
            {cadenceLabel(site.cadencePerWeek ?? 4)}
          </p>
          <p className="mt-2 text-[10px] text-text-3">
            {site.approvalRequired ? "Approval required" : "Auto-publish"}
          </p>
        </div>

        {/* Content Health */}
        {healthLoading ? (
          <div className="rounded-xl border border-white/[0.06] bg-surface-1 p-4" aria-busy="true">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-3">Health</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-text-2">…</p>
            <p className="mt-2 text-[10px] text-text-3">Checking your content</p>
          </div>
        ) : (
        <div className={`rounded-xl border p-4 ${
          autopilotBlocked || decayCount > 0
            ? "border-wrong/[0.2] bg-wrong/[0.03]"
            : reviewCount > 0
              ? "border-rival/[0.2] bg-rival/[0.03]"
              : "border-white/[0.06] bg-surface-1"
        }`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-text-3">
              {autopilotBlocked || decayCount > 0 ? "Attention" : reviewCount > 0 ? "Needs Review" : "Health"}
            </p>
            {autopilotBlocked || decayCount > 0 ? (
              <TrendingDown className="h-3.5 w-3.5 text-wrong" />
            ) : reviewCount > 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-rival" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5 text-named" />
            )}
          </div>
          {autopilotBlocked || decayCount > 0 ? (
            <>
              <p className="mt-2 text-2xl font-bold tracking-tight text-wrong">
                {autopilotBlocked ? "Blocked" : decayCount}
              </p>
              <p className="mt-2 text-[10px] text-wrong">
                {autopilotBlocked
                  ? autopilotAttentionMessage ?? "Automation is fail-closed"
                  : "Ranking decline detected"}
              </p>
            </>
          ) : reviewCount > 0 ? (
            <>
              <p className="mt-2 text-2xl font-bold tracking-tight text-rival">
                {reviewCount}
              </p>
              <Link href="/articles" className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-rival hover:text-rival transition">
                Review articles <ArrowRight className="h-2.5 w-2.5" />
              </Link>
            </>
          ) : (
            <>
              <p className="mt-2 text-2xl font-bold tracking-tight text-named">
                Good
              </p>
              <p className="mt-2 text-[10px] text-text-3">All content healthy</p>
            </>
          )}
        </div>
        )}
      </div>

      {/* ─── Quick Nav ────────────────────────────── */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Link href="/plan" className="group rounded-xl border border-white/[0.06] bg-surface-1 p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1]">
          <Target className="h-4 w-4 text-text-2 mb-2" />
          <p className="text-[13px] font-medium text-text">Topics</p>
          <p className="text-[11px] text-text-3">{availableTopics} available · {totalTopics - availableTopics} used</p>
        </Link>
        <Link href="/articles" className="group rounded-xl border border-white/[0.06] bg-surface-1 p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1]">
          <FileText className="h-4 w-4 text-text-2 mb-2" />
          <p className="text-[13px] font-medium text-text">Articles</p>
          <p className="text-[11px] text-text-3">{publishedCount} published · {totalArticles - publishedCount} drafts</p>
        </Link>
        <Link href="/analytics" className="group rounded-xl border border-white/[0.06] bg-surface-1 p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1]">
          <BarChart3 className="h-4 w-4 text-text-2 mb-2" />
          <p className="text-[13px] font-medium text-text">Analytics</p>
          <p className="text-[11px] text-text-3">{hasGSC ? `${gscSummary.queryCount} keywords tracked` : "Connect GSC"}</p>
        </Link>
        <Link href="/backlinks" className="group rounded-xl border border-white/[0.06] bg-surface-1 p-4 transition-all hover:-translate-y-0.5 hover:border-white/[0.1]">
          <Link2 className="h-4 w-4 text-text-2 mb-2" />
          <p className="text-[13px] font-medium text-text">Backlinks</p>
          <p className="text-[11px] text-text-3">Analyze & outreach</p>
        </Link>
      </div>

      {/* ─── Recent Articles ─────────────────────── */}
      <div className="rounded-xl border border-white/[0.06] bg-surface-1 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold text-text">
              Latest Articles
            </h2>
            <Link
              href="/articles"
              className="text-[11px] text-text-3 hover:text-text-2 transition"
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
                    <p className="text-[13px] font-medium text-text leading-snug line-clamp-1 group-hover:text-text transition">
                      {article.title}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-text-3">
                      <span>{(article.wordCount ?? 0).toLocaleString()} words</span>
                      <span className="text-border">·</span>
                      <span>{formatDistanceToNow(article.createdAt, { addSuffix: true })}</span>
                      {(article.decayStatus === "warning" || article.decayStatus === "declining") && (
                        <>
                          <span className="text-border">·</span>
                          <span className={`inline-flex items-center gap-1 ${
                            article.decayStatus === "declining" ? "text-wrong" : "text-rival"
                          }`}>
                            <TrendingDown className="h-2.5 w-2.5" />
                            {article.decayStatus === "declining" ? "Declining" : "Warning"}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <ExternalLink className="h-3 w-3 mt-1 text-text-3 opacity-0 group-hover:opacity-100 transition shrink-0" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="h-8 w-8 text-text-4/30" />
              <p className="mt-2 text-[12px] text-text-3">
                No articles yet. Click &ldquo;Generate Now&rdquo; to create your first.
              </p>
            </div>
          )}
        </div>

      {/* ─── Activity Timeline ────────────────────── */}
      <div className="rounded-xl border border-white/[0.06] bg-surface-1 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[13px] font-semibold text-text">
            Activity
          </h2>
          <Link
            href="/jobs"
            className="text-[11px] text-text-3 hover:text-text-2 transition"
          >
            View all
          </Link>
        </div>

        {activity.state === "loading" ? (
          <p role="status" className="text-center py-6 text-[12px] text-text-3">{activity.detail}</p>
        ) : recentJobs.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {recentJobs.map((job) => (
              <div
                key={job._id}
                className="flex items-center gap-2.5 rounded-lg bg-white/[0.02] px-3 py-2.5 border border-white/[0.03]"
              >
                <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                  job.status === "done"
                    ? "bg-named/[0.08]"
                    : job.status === "running"
                      ? "bg-surface-2/50"
                      : job.status === "failed"
                        ? "bg-wrong/[0.08]"
                        : "bg-white/[0.04]"
                }`}>
                  <JobIcon
                    type={job.type}
                    className={`h-3 w-3 ${
                      job.status === "done"
                        ? "text-named"
                        : job.status === "running"
                          ? "text-text-2"
                          : job.status === "failed"
                            ? "text-wrong"
                            : "text-text-3"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium text-text truncate">
                    {jobLabel(job.type)}
                  </p>
                  <p className="text-[10px] text-text-3">
                    {job.updatedAt === undefined ? "Update time unavailable" : formatDistanceToNow(job.updatedAt, { addSuffix: true })}
                  </p>
                </div>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  job.status === "done"
                    ? "bg-named"
                    : job.status === "running"
                      ? "bg-you animate-pulse"
                      : job.status === "failed"
                        ? "bg-wrong"
                        : "bg-text-4"
                }`} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center py-6 text-[12px] text-text-3">
            No pipeline activity yet.
          </p>
        )}
        {activity.recent?.status === "truncated" && (
          <p className="mt-3 text-[11px] text-text-3">Showing the 8 newest jobs for this site; older activity is not shown.</p>
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
          <div key={i} className="rounded-xl border border-white/[0.06] bg-surface-1 p-4">
            <div className="h-3 w-16 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-3 h-7 w-12 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-3 h-1 w-full animate-pulse rounded bg-white/[0.04]" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-white/[0.06] bg-surface-1 p-4">
            <div className="h-4 w-4 animate-pulse rounded bg-white/[0.04] mb-2" />
            <div className="h-3.5 w-20 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-1 h-3 w-28 animate-pulse rounded bg-white/[0.03]" />
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.06] bg-surface-1 p-5">
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

/**
 * Nov 2026: a site on Pentra Answers gets the Answers overview here; an articles site keeps the dashboard above,
 * untouched, with a card offering the switch. A new account with no site starts at /start.
 */
export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardSwitch legacy={<LegacyDashboardPage />} />
    </Suspense>
  );
}
