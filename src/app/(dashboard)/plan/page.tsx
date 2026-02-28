"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { Target, RefreshCw, Star, ArrowUpRight } from "lucide-react";
import Link from "next/link";

export default function PlanPage() {
  const sites = useQuery(api.sites.list);
  const site = sites?.[0];
  const topics = useQuery(
    api.topics.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const generatePlan = useAction(api.actions.pipeline.generatePlan);
  const [status, setStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");

  const sorted = useMemo(() => {
    if (!topics) return [];
    return [...topics].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }, [topics]);

  const filtered = useMemo(() => {
    if (activeTab === "all") return sorted;
    return sorted.filter((t) => {
      if (activeTab === "available")
        return t.status !== "used" && t.status !== "queued";
      return t.status === activeTab;
    });
  }, [sorted, activeTab]);

  const availableCount = sorted.filter(
    (t) => t.status !== "used" && t.status !== "queued",
  ).length;
  const usedCount = sorted.filter((t) => t.status === "used").length;

  const tabs = [
    { id: "all", label: "All", count: sorted.length },
    { id: "available", label: "Available", count: availableCount },
    { id: "used", label: "Used", count: usedCount },
  ];

  const handleGenerate = async () => {
    if (!site?._id) return;
    setStatus("Generating...");
    try {
      await generatePlan({ siteId: site._id });
      setStatus("New plan generated.");
    } catch (err: unknown) {
      setStatus(
        err instanceof Error ? err.message : "Failed to generate plan",
      );
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
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={!site}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Generate Topics
          </Button>
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

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Topic List */}
      {filtered.length > 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
          {filtered.map((topic) => {
            const isUsed = topic.status === "used";
            return (
              <div
                key={topic._id}
                className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-5 py-3.5 border-b border-white/[0.04] last:border-0 ${
                  isUsed ? "opacity-50" : ""
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

                {/* Status */}
                <span className={`shrink-0 text-[11px] font-medium ${
                  isUsed ? "text-[#565A6E]" : "text-[#8B8FA3]"
                }`}>
                  {isUsed ? "Used" : "Available"}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-12 text-center">
          <Target className="mx-auto h-10 w-10 text-[#565A6E]/30" />
          <p className="mt-3 text-[13px] text-[#565A6E]">
            {topics === undefined
              ? "Loading..."
              : "No topics yet. Generate a plan to see keyword clusters."}
          </p>
        </div>
      )}
    </div>
  );
}
