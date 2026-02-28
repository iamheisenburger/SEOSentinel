"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { Map, RefreshCw, Star } from "lucide-react";
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

  const tabs = [
    { id: "all", label: "All", count: sorted.length },
    {
      id: "available",
      label: "Available",
      count: sorted.filter(
        (t) => t.status !== "used" && t.status !== "queued",
      ).length,
    },
    {
      id: "used",
      label: "Used",
      count: sorted.filter((t) => t.status === "used").length,
    },
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
      <div className="flex flex-col gap-6">
        <div>
          <div className="mb-1.5 h-6 w-40 animate-pulse rounded bg-white/[0.04]" />
          <div className="h-4 w-56 animate-pulse rounded bg-white/[0.03]" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
              <div className="mb-3 h-4 w-3/4 animate-pulse rounded bg-white/[0.04]" />
              <div className="mb-2 h-3 w-1/2 animate-pulse rounded bg-white/[0.04]" />
              <div className="flex gap-1.5">
                <div className="h-4 w-14 animate-pulse rounded-md bg-white/[0.04]" />
                <div className="h-4 w-18 animate-pulse rounded-md bg-white/[0.04]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Content Plan"
        subtitle="Topic clusters and keywords to target"
        actions={
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={!site}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            Generate Plan
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
            Sites
          </Link>{" "}
          before generating a plan.
        </div>
      )}

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Topic Cards */}
      {filtered.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((topic) => (
            <div
              key={topic._id}
              className="group rounded-xl border border-white/[0.06] bg-[#0F1117] p-4 transition-all duration-150 hover:border-white/[0.1] hover:bg-[#111319]"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-[#EDEEF1] leading-snug">
                  {topic.label}
                </h3>
                <StatusBadge status={topic.status ?? "planned"} />
              </div>

              <p className="mt-2 text-[12px] text-[#0EA5E9] font-medium">
                {topic.primaryKeyword}
              </p>

              {topic.secondaryKeywords.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {topic.secondaryKeywords.slice(0, 3).map((kw, i) => (
                    <span
                      key={i}
                      className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-[#8B8FA3]"
                    >
                      {kw}
                    </span>
                  ))}
                  {topic.secondaryKeywords.length > 3 && (
                    <span className="text-[11px] text-[#565A6E]">
                      +{topic.secondaryKeywords.length - 3}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                {topic.intent && (
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E]">
                    {topic.intent}
                  </span>
                )}
                {topic.priority != null && (
                  <div className="flex items-center gap-0.5 ml-auto">
                    {Array.from({ length: Math.min(topic.priority, 5) }).map(
                      (_, i) => (
                        <Star
                          key={i}
                          className="h-3 w-3 fill-[#F59E0B] text-[#F59E0B]"
                        />
                      ),
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-10 text-center">
          <Map className="mx-auto h-8 w-8 text-[#565A6E]/40" />
          <p className="mt-3 text-[13px] text-[#565A6E]">
            {topics === undefined
              ? "Loading topics..."
              : "No topics yet. Generate a plan to see keyword clusters."}
          </p>
        </div>
      )}
    </div>
  );
}
