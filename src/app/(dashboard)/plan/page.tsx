"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { ArticleProgress } from "@/components/ui/article-progress";
import { PlanProgress } from "@/components/ui/plan-progress";
import {
  Target,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Clock,
  Play,
  Trash2,
  Calendar,
  TrendingUp,
  BarChart3,
  Search,
  Zap,
  Shield,
  Brain,
  ArrowUpRight,
  Info,
} from "lucide-react";
import Link from "next/link";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";

/** Format search volume with K/M suffixes */
function formatVolume(vol: number): string {
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return `${vol}`;
}

/** Get difficulty label */
function getDifficultyLabel(diff: number): string {
  if (diff <= 29) return "Easy";
  if (diff <= 49) return "Medium";
  if (diff <= 69) return "Hard";
  return "Very Hard";
}

/** Get difficulty color based on score */
function getDifficultyColor(diff: number): string {
  if (diff <= 29) return "text-[#22C55E]";
  if (diff <= 49) return "text-[#F59E0B]";
  if (diff <= 69) return "text-[#F97316]";
  return "text-[#EF4444]";
}

function getDifficultyBg(diff: number): string {
  if (diff <= 29) return "bg-[#22C55E]/[0.08]";
  if (diff <= 49) return "bg-[#F59E0B]/[0.08]";
  if (diff <= 69) return "bg-[#F97316]/[0.08]";
  return "bg-[#EF4444]/[0.08]";
}

/** Get opportunity score color */
function getOpportunityColor(score: number): string {
  if (score >= 60) return "text-[#22C55E]";
  if (score >= 40) return "text-[#0EA5E9]";
  if (score >= 25) return "text-[#F59E0B]";
  return "text-[#8B8FA3]";
}

function getOpportunityBg(score: number): string {
  if (score >= 60) return "bg-[#22C55E]";
  if (score >= 40) return "bg-[#0EA5E9]";
  if (score >= 25) return "bg-[#F59E0B]";
  return "bg-[#565A6E]";
}

function getOpportunityLabel(score: number): string {
  if (score >= 60) return "High Opportunity";
  if (score >= 40) return "Good Opportunity";
  if (score >= 25) return "Moderate";
  return "Niche";
}

/** Compute opportunity score from topic metrics (logarithmic volume scaling) */
function computeOpportunity(topic: any): number {
  const vol = topic.searchVolume ?? 0;
  const kd = topic.keywordDifficulty ?? 50;
  const cpc = topic.cpc ?? 0;
  const volumeScore = vol > 0 ? Math.min(Math.log10(vol) * 13, 40) : 0; // log10: 100→26, 500→35, 1K→39
  const difficultyBonus = Math.max(0, (100 - kd) * 0.4); // KD 0→40, KD 50→20
  const cpcSignal = Math.min(cpc * 4, 20); // CPC $1→4, $5→20
  return Math.round(volumeScore + difficultyBonus + cpcSignal);
}

/** Get article type display info */
function getArticleTypeInfo(type: string): { label: string; color: string; bg: string } {
  const types: Record<string, { label: string; color: string; bg: string }> = {
    "listicle": { label: "Listicle", color: "text-[#22D3EE]", bg: "bg-[#22D3EE]/[0.08]" },
    "how-to": { label: "How-To", color: "text-[#22D3EE]", bg: "bg-[#22D3EE]/[0.08]" },
    "checklist": { label: "Checklist", color: "text-[#A78BFA]", bg: "bg-[#A78BFA]/[0.08]" },
    "comparison": { label: "Comparison", color: "text-[#F59E0B]", bg: "bg-[#F59E0B]/[0.08]" },
    "roundup": { label: "Roundup", color: "text-[#F97316]", bg: "bg-[#F97316]/[0.08]" },
    "ultimate-guide": { label: "Ultimate Guide", color: "text-[#EC4899]", bg: "bg-[#EC4899]/[0.08]" },
    "standard": { label: "Deep Dive", color: "text-[#8B8FA3]", bg: "bg-white/[0.04]" },
  };
  return types[type] ?? types["standard"];
}

export default function PlanPage() {
  const { activeSite: site, sites } = useActiveSite();
  const topics = useQuery(
    api.topics.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const runningJob = useQuery(
    api.jobs.getRunningBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const articles = useQuery(
    api.articles.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const { maxArticles } = usePlanLimits();

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const articlesThisMonth =
    articles?.filter((a) => a.createdAt >= monthStart.getTime()).length ?? 0;
  const atArticleLimit = articlesThisMonth >= maxArticles;

  const queuePlan = useMutation(api.jobs.queuePlanGeneration);
  const runQueuedTopic = useMutation(api.jobs.runQueuedTopic);
  const queueArticle = useMutation(api.jobs.queueArticleNow);
  const removeTopic = useMutation(api.topics.remove);
  const removeUnused = useMutation(api.topics.removeUnused);
  const removeUsed = useMutation(api.topics.removeUsed);
  const [status, setStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [generatingTopicId, setGeneratingTopicId] = useState<string | null>(null);
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);

  const activeTopicLabel = runningJob?.stepProgress?.topicLabel ?? null;
  const isPlanGenerating = runningJob?.type === "plan";

  const sorted = useMemo(() => {
    if (!topics) return [];
    return [...topics].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }, [topics]);

  const filtered = useMemo(() => {
    if (activeTab === "all") return sorted;
    return sorted.filter((t) => {
      if (activeTab === "available")
        return t.status !== "used" && t.status !== "queued";
      if (activeTab === "generating")
        return t.label === activeTopicLabel || t.status === "queued";
      return t.status === activeTab;
    });
  }, [sorted, activeTab, activeTopicLabel]);

  const available = useMemo(
    () => sorted.filter((t) => t.status !== "used" && t.status !== "queued"),
    [sorted],
  );
  const availableCount = available.length;
  const usedCount = sorted.filter((t) => t.status === "used").length;
  const generatingCount = activeTopicLabel ? 1 : 0;

  // Compute aggregate SEO stats
  const seoStats = useMemo(() => {
    const withMetrics = sorted.filter((t: any) => t.searchVolume !== undefined);
    if (withMetrics.length === 0) return null;
    const totalVolume = withMetrics.reduce((sum: number, t: any) => sum + (t.searchVolume ?? 0), 0);
    const avgKD = Math.round(withMetrics.reduce((sum: number, t: any) => sum + (t.keywordDifficulty ?? 0), 0) / withMetrics.length);
    const avgOpportunity = Math.round(withMetrics.reduce((sum: number, t: any) => sum + computeOpportunity(t), 0) / withMetrics.length);
    const highOpp = withMetrics.filter((t: any) => computeOpportunity(t) >= 40).length;
    return { totalVolume, avgKD, avgOpportunity, highOpp, analyzed: withMetrics.length };
  }, [sorted]);

  // Schedule weeks
  const scheduleWeeks = useMemo(() => {
    const cadence = site?.cadencePerWeek ?? 4;
    const msPerArticle = ((7 * 24) / cadence) * 60 * 60 * 1000;
    const now = Date.now();

    type ScheduledTopic = typeof available[number] & { projectedDate: Date };
    const scheduled: ScheduledTopic[] = available.map((topic, i) => ({
      ...topic,
      projectedDate: new Date(now + msPerArticle * i),
    }));

    const weeks: { label: string; startDate: Date; topics: ScheduledTopic[] }[] = [];
    for (const topic of scheduled) {
      const d = topic.projectedDate;
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      monday.setHours(0, 0, 0, 0);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const weekKey = monday.toISOString().slice(0, 10);
      let week = weeks.find((w) => w.startDate.toISOString().slice(0, 10) === weekKey);
      if (!week) {
        const isThisWeek = new Date().getTime() >= monday.getTime() && new Date().getTime() <= sunday.getTime() + 86400000;
        const isNextWeek = !isThisWeek && monday.getTime() - new Date().getTime() < 14 * 86400000 && monday.getTime() > new Date().getTime();
        const label = isThisWeek
          ? "This Week"
          : isNextWeek
            ? "Next Week"
            : `Week of ${monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
        week = { label, startDate: monday, topics: [] };
        weeks.push(week);
      }
      week.topics.push(topic);
    }
    return weeks;
  }, [available, site?.cadencePerWeek]);

  const tabs = [
    { id: "all", label: "All", count: sorted.length },
    { id: "available", label: "Available", count: availableCount },
    { id: "schedule", label: "Schedule", count: availableCount },
    ...(generatingCount > 0
      ? [{ id: "generating", label: "In Progress", count: generatingCount }]
      : []),
    { id: "used", label: "Used", count: usedCount },
  ];

  const handleGenerate = async () => {
    if (!site?._id) return;
    setStatus(null);
    try {
      await queuePlan({ siteId: site._id });
    } catch (err: unknown) {
      setStatus(
        err instanceof Error ? err.message : "Failed to generate plan",
      );
    }
  };

  const handleGenerateArticle = async (topicId: Id<"topic_clusters">) => {
    if (!site?._id) return;
    setGeneratingTopicId(topicId);
    try {
      await queueArticle({ siteId: site._id, topicId });
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGeneratingTopicId(null);
    }
  };

  if (sites === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="h-6 w-28 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-4 w-48 animate-pulse rounded bg-white/[0.03]" />
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117]">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3 border-b border-white/[0.04] last:border-0">
              <div className="h-3.5 w-40 animate-pulse rounded bg-white/[0.04]" />
              <div className="ml-auto h-3 w-24 animate-pulse rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Content Strategy"
        subtitle={`${availableCount} topics ready · ${usedCount} published`}
        actions={
          <div className="flex items-center gap-2">
            {availableCount > 0 && (
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  if (!site?._id) return;
                  if (!confirm(`Delete all ${availableCount} unused topics? Used topics will be kept.`)) return;
                  await removeUnused({ siteId: site._id });
                  setStatus("Unused topics cleared.");
                }}
                icon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Clear Unused
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={!site || isPlanGenerating}
              icon={isPlanGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            >
              {isPlanGenerating ? "Generating..." : "Generate Topics"}
            </Button>
          </div>
        }
      />

      {status && (
        <div className="rounded-lg bg-[#0EA5E9]/[0.08] px-4 py-2 text-[13px] text-[#38BDF8]">
          {status}
        </div>
      )}

      {!site && (
        <div className="rounded-xl border border-[#F59E0B]/[0.15] bg-[#F59E0B]/[0.04] p-4 text-[13px] text-[#FBBF24]">
          Add a site first on{" "}
          <Link href="/sites" className="underline underline-offset-2">
            Settings
          </Link>{" "}
          before generating topics.
        </div>
      )}

      {/* Plan generation progress (step-by-step like article generation) */}
      {site && <PlanProgress siteId={site._id} />}

      {/* Article generation progress */}
      {site && <ArticleProgress siteId={site._id} />}

      {/* SEO Intelligence Summary — shows after topics have metrics */}
      {seoStats && !isPlanGenerating && (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-[#0EA5E9]" />
            <span className="text-[12px] font-semibold text-[#EDEEF1]">SEO Intelligence Summary</span>
            <span className="text-[10px] text-[#565A6E]">{seoStats.analyzed} topics analyzed</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg bg-white/[0.02] p-3">
              <p className="text-[10px] text-[#565A6E] uppercase tracking-wider">Total Search Volume</p>
              <p className="mt-1 text-[18px] font-semibold text-[#EDEEF1]">{formatVolume(seoStats.totalVolume)}<span className="text-[11px] text-[#565A6E] font-normal">/mo</span></p>
            </div>
            <div className="rounded-lg bg-white/[0.02] p-3">
              <p className="text-[10px] text-[#565A6E] uppercase tracking-wider">Avg Difficulty</p>
              <p className={`mt-1 text-[18px] font-semibold ${getDifficultyColor(seoStats.avgKD)}`}>{seoStats.avgKD}<span className="text-[11px] font-normal"> /100</span></p>
            </div>
            <div className="rounded-lg bg-white/[0.02] p-3">
              <p className="text-[10px] text-[#565A6E] uppercase tracking-wider">Avg Opportunity</p>
              <p className={`mt-1 text-[18px] font-semibold ${getOpportunityColor(seoStats.avgOpportunity)}`}>{seoStats.avgOpportunity}<span className="text-[11px] font-normal"> /100</span></p>
            </div>
            <div className="rounded-lg bg-white/[0.02] p-3">
              <p className="text-[10px] text-[#565A6E] uppercase tracking-wider">High Opportunity</p>
              <p className="mt-1 text-[18px] font-semibold text-[#22C55E]">{seoStats.highOpp}<span className="text-[11px] text-[#565A6E] font-normal"> topics</span></p>
            </div>
          </div>
          <p className="mt-3 text-[10px] text-[#565A6E] leading-relaxed">
            Each topic was evaluated against real search data. Low-potential keywords (zero volume + high difficulty) were automatically filtered out.
            Article formats were selected by analyzing what&apos;s currently ranking on Google for each keyword. Topics are ordered by opportunity score.
          </p>
        </div>
      )}

      {/* Topic health bar */}
      {sorted.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-white/[0.04] overflow-hidden flex">
            <div
              className="h-full bg-[#0EA5E9] rounded-l-full"
              style={{ width: `${(availableCount / sorted.length) * 100}%` }}
            />
            <div
              className="h-full bg-[#565A6E]"
              style={{ width: `${(usedCount / sorted.length) * 100}%` }}
            />
          </div>
          <span className="text-[11px] text-[#565A6E] shrink-0">
            {availableCount}/{sorted.length}
          </span>
        </div>
      )}

      {/* Cadence info */}
      {site?.cadencePerWeek && sorted.length > 0 && (
        <div className="flex items-center gap-2 text-[11px] text-[#565A6E]">
          <Clock className="h-3 w-3" />
          <span>
            {site.cadencePerWeek} articles/week · ~{Math.ceil(availableCount / site.cadencePerWeek)} weeks of content remaining
          </span>
        </div>
      )}

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Schedule View */}
      {activeTab === "schedule" && (
        <div className="flex flex-col gap-4">
          {site?.cadencePerWeek && (
            <div className="flex items-center gap-2 text-[11px] text-[#8B8FA3]">
              <Calendar className="h-3 w-3 text-[#0EA5E9]" />
              <span>
                Publishing ~{site.cadencePerWeek} articles/week · {availableCount} topics queued
              </span>
            </div>
          )}
          {scheduleWeeks.length > 0 ? (
            scheduleWeeks.map((week) => (
              <div key={week.startDate.toISOString()}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[12px] font-semibold ${
                    week.label === "This Week" ? "text-[#0EA5E9]" : "text-[#EDEEF1]"
                  }`}>
                    {week.label}
                  </span>
                  <span className="text-[10px] text-[#565A6E]">
                    {week.topics.length} article{week.topics.length !== 1 ? "s" : ""}
                  </span>
                  <div className="flex-1 h-px bg-white/[0.04]" />
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
                  {week.topics.map((topic) => (
                    <div
                      key={topic._id}
                      className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-3 border-b border-white/[0.04] last:border-0"
                    >
                      <div className="shrink-0 w-20 text-center">
                        <p className="text-[11px] font-medium text-[#EDEEF1]">
                          {topic.projectedDate.toLocaleDateString("en-US", { weekday: "short" })}
                        </p>
                        <p className="text-[10px] text-[#565A6E]">
                          {topic.projectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[#EDEEF1] leading-snug">
                          {topic.label}
                        </p>
                        <span className="text-[11px] text-[#0EA5E9]">
                          {topic.primaryKeyword}
                        </span>
                      </div>
                      {topic.intent && (
                        <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                          topic.intent === "commercial"
                            ? "bg-[#F59E0B]/[0.08] text-[#FBBF24]"
                            : topic.intent === "transactional"
                              ? "bg-[#22C55E]/[0.08] text-[#4ADE80]"
                              : "bg-white/[0.04] text-[#8B8FA3]"
                        }`}>
                          {topic.intent}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-12 text-center">
              <Calendar className="mx-auto h-10 w-10 text-[#565A6E]/30" />
              <p className="mt-3 text-[13px] text-[#565A6E]">
                No available topics to schedule. Generate topics first.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Topic List */}
      {activeTab !== "schedule" && filtered.length > 0 ? (
        <div className="flex flex-col gap-2">
          {filtered.map((topic) => {
            const isUsed = topic.status === "used";
            const isGenerating = activeTopicLabel === topic.label;
            const isQueued = topic.status === "queued";
            const isManuallyGenerating = generatingTopicId === topic._id;
            const isExpanded = expandedTopicId === topic._id;
            const opportunity = computeOpportunity(topic);
            const hasMetrics = (topic as any).searchVolume !== undefined;
            const articleTypeInfo = getArticleTypeInfo(topic.articleType ?? "standard");

            return (
              <div
                key={topic._id}
                className={`rounded-xl border overflow-hidden transition-all ${
                  isGenerating
                    ? "border-[#0EA5E9]/[0.2] bg-[#0EA5E9]/[0.03]"
                    : isUsed
                      ? "border-white/[0.04] bg-[#0F1117] opacity-50"
                      : "border-white/[0.06] bg-[#0F1117] hover:border-white/[0.1]"
                }`}
              >
                {/* Main row */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-3.5">
                  {/* Opportunity score bar */}
                  {hasMetrics ? (
                    <div className="shrink-0 w-14 flex flex-col items-center gap-1" title={`Opportunity: ${opportunity}/100 — ${getOpportunityLabel(opportunity)}`}>
                      <span className={`text-[14px] font-bold tabular-nums ${getOpportunityColor(opportunity)}`}>
                        {opportunity}
                      </span>
                      <div className="w-full h-1 rounded-full bg-white/[0.06]">
                        <div
                          className={`h-1 rounded-full transition-all ${getOpportunityBg(opportunity)}`}
                          style={{ width: `${Math.min(opportunity, 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="shrink-0 w-14" />
                  )}

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[#EDEEF1] leading-snug">
                      {topic.label}
                    </p>
                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-medium text-[#0EA5E9]">
                        {topic.primaryKeyword}
                      </span>

                      {(topic as any).searchVolume != null && (topic as any).searchVolume > 0 && (
                        <span className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#8B8FA3]" title="Monthly search volume">
                          <Search className="h-2.5 w-2.5" />
                          {formatVolume((topic as any).searchVolume)}/mo
                        </span>
                      )}
                      {(topic as any).keywordDifficulty != null && (
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${getDifficultyBg((topic as any).keywordDifficulty)} ${getDifficultyColor((topic as any).keywordDifficulty)}`} title={`Keyword difficulty: ${(topic as any).keywordDifficulty}/100 — ${getDifficultyLabel((topic as any).keywordDifficulty)}`}>
                          <BarChart3 className="h-2.5 w-2.5" />
                          KD {(topic as any).keywordDifficulty}
                        </span>
                      )}
                      {(topic as any).cpc != null && (topic as any).cpc > 0 && (
                        <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#8B8FA3]" title="Cost per click (advertiser demand signal)">
                          ${(topic as any).cpc.toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Article Type */}
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${articleTypeInfo.bg} ${articleTypeInfo.color}`}>
                    {articleTypeInfo.label}
                  </span>

                  {/* Intent */}
                  {topic.intent && (
                    <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                      topic.intent === "commercial"
                        ? "bg-[#F59E0B]/[0.08] text-[#FBBF24]"
                        : topic.intent === "transactional"
                          ? "bg-[#22C55E]/[0.08] text-[#4ADE80]"
                          : "bg-white/[0.04] text-[#8B8FA3]"
                    }`}>
                      {topic.intent}
                    </span>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {hasMetrics && !isUsed && (
                      <button
                        onClick={() => setExpandedTopicId(isExpanded ? null : topic._id)}
                        className="inline-flex items-center rounded-md p-1 text-[#565A6E] hover:bg-white/[0.04] hover:text-[#8B8FA3] transition"
                        title="View SEO rationale"
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    )}
                    {isGenerating ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#0EA5E9]/[0.1] px-2.5 py-1 text-[11px] font-medium text-[#38BDF8]">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Generating
                      </span>
                    ) : isQueued ? (
                      <div className="flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F59E0B]/[0.1] px-2.5 py-1 text-[11px] font-medium text-[#FBBF24]">
                          <Clock className="h-3 w-3" />
                          Queued
                        </span>
                        {!runningJob && (
                          <button
                            onClick={async () => {
                              if (!site?._id) return;
                              try {
                                await runQueuedTopic({ topicId: topic._id });
                              } catch (err) {
                                setStatus(err instanceof Error ? err.message : "Failed to start");
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-md bg-[#22C55E]/[0.08] px-2 py-1 text-[10px] font-medium text-[#4ADE80] hover:bg-[#22C55E]/[0.15] transition"
                          >
                            <Play className="h-2.5 w-2.5" />
                            Run Now
                          </button>
                        )}
                      </div>
                    ) : isUsed ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-[#565A6E]">
                        <CheckCircle2 className="h-3 w-3" />
                        Used
                      </span>
                    ) : (
                      <button
                        onClick={() => handleGenerateArticle(topic._id)}
                        disabled={!!runningJob || isManuallyGenerating || atArticleLimit}
                        className="inline-flex items-center gap-1 rounded-md bg-[#0EA5E9]/[0.08] px-2.5 py-1 text-[10px] font-medium text-[#38BDF8] hover:bg-[#0EA5E9]/[0.15] transition disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {isManuallyGenerating ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <Play className="h-2.5 w-2.5" />
                        )}
                        Generate
                      </button>
                    )}
                    {!isGenerating && !isQueued && (
                      <button
                        onClick={() => removeTopic({ topicId: topic._id })}
                        className="inline-flex items-center rounded-md p-1 text-[#565A6E] hover:bg-[#EF4444]/[0.08] hover:text-[#F87171] transition"
                        title="Delete topic"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded SEO Rationale */}
                {isExpanded && hasMetrics && (
                  <div className="border-t border-white/[0.04] px-5 py-3 bg-white/[0.01]">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
                      <div>
                        <p className="text-[#565A6E] uppercase tracking-wider text-[9px] mb-1">Why this topic</p>
                        <p className="text-[#8B8FA3] leading-relaxed">
                          {(topic as any).searchVolume > 0
                            ? `${formatVolume((topic as any).searchVolume)} monthly searches`
                            : "Niche keyword"
                          }
                          {(topic as any).keywordDifficulty != null && (
                            <> with {getDifficultyLabel((topic as any).keywordDifficulty).toLowerCase()} competition (KD {(topic as any).keywordDifficulty})</>
                          )}
                          {(topic as any).cpc > 0 && (
                            <>. Advertisers pay ${(topic as any).cpc.toFixed(2)}/click — indicates commercial value</>
                          )}
                          .
                        </p>
                      </div>
                      <div>
                        <p className="text-[#565A6E] uppercase tracking-wider text-[9px] mb-1">Format selected</p>
                        <p className="text-[#8B8FA3] leading-relaxed">
                          {(topic as any).recommendedArticleType
                            ? `SERP analysis shows top Google results for "${topic.primaryKeyword}" are ${(topic as any).recommendedArticleType} format articles. We matched this format for the best ranking odds.`
                            : `${articleTypeInfo.label} format selected based on keyword intent and topic structure.`
                          }
                        </p>
                      </div>
                      <div>
                        <p className="text-[#565A6E] uppercase tracking-wider text-[9px] mb-1">Opportunity breakdown</p>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center justify-between">
                            <span className="text-[#8B8FA3]">Volume signal</span>
                            <span className="text-[#EDEEF1] tabular-nums">{Math.round((topic as any).searchVolume > 0 ? Math.min(Math.log10((topic as any).searchVolume) * 13, 40) : 0)}/40</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[#8B8FA3]">Difficulty bonus</span>
                            <span className="text-[#EDEEF1] tabular-nums">{Math.round(Math.max(0, (100 - ((topic as any).keywordDifficulty ?? 50)) * 0.4))}/40</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-[#8B8FA3]">Commercial value</span>
                            <span className="text-[#EDEEF1] tabular-nums">{Math.round(Math.min(((topic as any).cpc ?? 0) * 4, 20))}/20</span>
                          </div>
                          <div className="flex items-center justify-between border-t border-white/[0.04] pt-1 mt-0.5">
                            <span className={`font-medium ${getOpportunityColor(opportunity)}`}>Total Score</span>
                            <span className={`font-bold tabular-nums ${getOpportunityColor(opportunity)}`}>{opportunity}/100</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* PAA Questions */}
                    {(topic as any).paaQuestions?.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-white/[0.04]">
                        <p className="text-[#565A6E] uppercase tracking-wider text-[9px] mb-1.5">People Also Ask (from Google)</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(topic as any).paaQuestions.slice(0, 5).map((q: string, i: number) => (
                            <span key={i} className="rounded bg-white/[0.04] px-2 py-0.5 text-[10px] text-[#8B8FA3]">
                              {q}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* Secondary keywords */}
                    {topic.secondaryKeywords.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-white/[0.04]">
                        <p className="text-[#565A6E] uppercase tracking-wider text-[9px] mb-1.5">Supporting keywords</p>
                        <div className="flex flex-wrap gap-1.5">
                          {topic.secondaryKeywords.map((kw, i) => (
                            <span key={i} className="rounded bg-white/[0.04] px-2 py-0.5 text-[10px] text-[#8B8FA3]">
                              {kw}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : activeTab !== "schedule" ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-12 text-center">
          <Target className="mx-auto h-10 w-10 text-[#565A6E]/30" />
          <p className="mt-3 text-[13px] text-[#565A6E]">
            {topics === undefined
              ? "Loading..."
              : "No topics yet. Generate a content strategy to get started."}
          </p>
          {topics?.length === 0 && site && (
            <p className="mt-2 text-[11px] text-[#565A6E]/70">
              Our AI will analyze your site, research keywords, evaluate search volume and competition,
              and build an optimized content plan designed to maximize your organic traffic.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
