"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { ArticleProgress } from "@/components/ui/article-progress";
import {
  Target,
  RefreshCw,
  Star,
  Loader2,
  CheckCircle2,
  Clock,
  Play,
  Trash2,
  Calendar,
} from "lucide-react";
import Link from "next/link";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";
import { Zap } from "lucide-react";

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

  // Articles generated this calendar month
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const articlesThisMonth =
    articles?.filter((a) => a.createdAt >= monthStart.getTime()).length ?? 0;
  const atArticleLimit = articlesThisMonth >= maxArticles;

  const generatePlan = useAction(api.actions.pipeline.generatePlan);
  const runQueuedTopic = useMutation(api.jobs.runQueuedTopic);
  const queueArticle = useMutation(api.jobs.queueArticleNow);
  const removeTopic = useMutation(api.topics.remove);
  const removeUnused = useMutation(api.topics.removeUnused);
  const removeUsed = useMutation(api.topics.removeUsed);
  const [status, setStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [generatingTopicId, setGeneratingTopicId] = useState<string | null>(null);

  // Which topic is currently being generated (from the running job)
  const activeTopicLabel = runningJob?.stepProgress?.topicLabel ?? null;

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

  // Schedule: project publish dates and group by week
  const scheduleWeeks = useMemo(() => {
    const cadence = site?.cadencePerWeek ?? 4;
    const msPerArticle = ((7 * 24) / cadence) * 60 * 60 * 1000;
    const now = Date.now();

    type ScheduledTopic = typeof available[number] & { projectedDate: Date };
    const scheduled: ScheduledTopic[] = available.map((topic, i) => ({
      ...topic,
      projectedDate: new Date(now + msPerArticle * i),
    }));

    // Group by week (Mon-Sun)
    const weeks: { label: string; startDate: Date; topics: ScheduledTopic[] }[] = [];
    for (const topic of scheduled) {
      const d = topic.projectedDate;
      // Get Monday of this week
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
    setStatus("Generating...");
    try {
      await generatePlan({ siteId: site._id });
      setStatus("New topics generated.");
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
      // Create job + schedule immediate processing — never awaits the long action directly
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
        title="Topics"
        subtitle={`${availableCount} available · ${usedCount} used`}
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
            {usedCount > 0 && (
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  if (!site?._id) return;
                  if (!confirm(`Delete all ${usedCount} used topics?`)) return;
                  await removeUsed({ siteId: site._id });
                  setStatus("Used topics cleared.");
                }}
                icon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Clear Used
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={!site}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            >
              Generate Topics
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

      {/* Live article generation progress */}
      {site && <ArticleProgress siteId={site._id} />}

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
                      {/* Projected date */}
                      <div className="shrink-0 w-20 text-center">
                        <p className="text-[11px] font-medium text-[#EDEEF1]">
                          {topic.projectedDate.toLocaleDateString("en-US", { weekday: "short" })}
                        </p>
                        <p className="text-[10px] text-[#565A6E]">
                          {topic.projectedDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </p>
                      </div>
                      {/* Priority */}
                      <div className="flex items-center gap-0.5 shrink-0 w-14">
                        {topic.priority != null &&
                          Array.from({ length: Math.min(topic.priority, 5) }).map((_, i) => (
                            <Star key={i} className="h-2.5 w-2.5 fill-[#F59E0B] text-[#F59E0B]" />
                          ))}
                      </div>
                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-[#EDEEF1] leading-snug">
                          {topic.label}
                        </p>
                        <span className="text-[11px] text-[#0EA5E9]">
                          {topic.primaryKeyword}
                        </span>
                      </div>
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
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
          {filtered.map((topic) => {
            const isUsed = topic.status === "used";
            const isGenerating = activeTopicLabel === topic.label;
            const isQueued = topic.status === "queued";
            const isManuallyGenerating = generatingTopicId === topic._id;

            return (
              <div
                key={topic._id}
                className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-3.5 border-b border-white/[0.04] last:border-0 transition-colors ${
                  isGenerating
                    ? "bg-[#0EA5E9]/[0.04] border-l-2 border-l-[#0EA5E9]"
                    : isUsed
                      ? "opacity-50"
                      : ""
                }`}
              >
                {/* Priority */}
                <div className="flex items-center gap-0.5 shrink-0 w-16">
                  {topic.priority != null &&
                    Array.from({ length: Math.min(topic.priority, 5) }).map(
                      (_, i) => (
                        <Star
                          key={i}
                          className="h-2.5 w-2.5 fill-[#F59E0B] text-[#F59E0B]"
                        />
                      ),
                    )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-[#EDEEF1] leading-snug">
                    {topic.label}
                  </p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-medium text-[#0EA5E9]">
                      {topic.primaryKeyword}
                    </span>
                    {topic.secondaryKeywords.slice(0, 2).map((kw, i) => (
                      <span
                        key={i}
                        className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#8B8FA3]"
                      >
                        {kw}
                      </span>
                    ))}
                    {topic.secondaryKeywords.length > 2 && (
                      <span className="text-[10px] text-[#565A6E]">
                        +{topic.secondaryKeywords.length - 2}
                      </span>
                    )}
                  </div>
                </div>

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

                {/* Status + Action */}
                <div className="flex items-center gap-2 shrink-0">
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
                          title="Start processing this queued article now"
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
                    <>
                      <button
                        onClick={() => handleGenerateArticle(topic._id)}
                        disabled={!!runningJob || isManuallyGenerating || atArticleLimit}
                        className="inline-flex items-center gap-1 rounded-md bg-[#0EA5E9]/[0.08] px-2 py-1 text-[10px] font-medium text-[#38BDF8] hover:bg-[#0EA5E9]/[0.15] transition disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {isManuallyGenerating ? (
                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        ) : (
                          <Play className="h-2.5 w-2.5" />
                        )}
                        Generate
                      </button>
                    </>
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
            );
          })}
        </div>
      ) : activeTab !== "schedule" ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-12 text-center">
          <Target className="mx-auto h-10 w-10 text-[#565A6E]/30" />
          <p className="mt-3 text-[13px] text-[#565A6E]">
            {topics === undefined
              ? "Loading..."
              : "No topics yet. Generate a plan to see keyword clusters."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
