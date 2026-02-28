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
          <div className="mb-2 h-8 w-48 animate-pulse rounded-lg bg-[#1E293B]" />
          <div className="h-4 w-64 animate-pulse rounded-lg bg-[#1E293B]" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl border border-[#1E293B] bg-[#111827] p-4">
              <div className="mb-3 h-4 w-3/4 animate-pulse rounded bg-[#1E293B]" />
              <div className="mb-2 h-3 w-1/2 animate-pulse rounded bg-[#1E293B]" />
              <div className="flex gap-1.5">
                <div className="h-5 w-16 animate-pulse rounded-md bg-[#1E293B]" />
                <div className="h-5 w-20 animate-pulse rounded-md bg-[#1E293B]" />
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
          <div className="flex gap-3">
            <Button
              onClick={handleGenerate}
              disabled={!site}
              icon={<RefreshCw className="h-4 w-4" />}
            >
              Generate Plan
            </Button>
          </div>
        }
      />

      {status && (
        <div className="rounded-lg bg-[#0EA5E9]/10 px-4 py-2.5 text-sm text-[#38BDF8]">
          {status}
        </div>
      )}

      {!site && (
        <div className="rounded-xl border border-[#F59E0B]/20 bg-[#F59E0B]/5 p-4 text-sm text-[#FBBF24]">
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
              className="group rounded-xl border border-[#1E293B] bg-[#111827] p-4 transition-all duration-150 hover:border-[#0EA5E9]/20 hover:shadow-lg hover:shadow-[#0EA5E9]/5"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-semibold text-[#F1F5F9] leading-snug">
                  {topic.label}
                </h3>
                <StatusBadge status={topic.status ?? "planned"} />
              </div>

              <p className="mt-2 text-xs text-[#0EA5E9] font-medium">
                {topic.primaryKeyword}
              </p>

              {topic.secondaryKeywords.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {topic.secondaryKeywords.slice(0, 3).map((kw, i) => (
                    <span
                      key={i}
                      className="rounded-md bg-[#1E293B] px-2 py-0.5 text-[11px] text-[#94A3B8]"
                    >
                      {kw}
                    </span>
                  ))}
                  {topic.secondaryKeywords.length > 3 && (
                    <span className="text-[11px] text-[#475569]">
                      +{topic.secondaryKeywords.length - 3}
                    </span>
                  )}
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                {topic.intent && (
                  <span className="text-[11px] font-medium uppercase tracking-wider text-[#475569]">
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
        <div className="rounded-2xl border border-[#1E293B] bg-[#111827] p-10 text-center">
          <Map className="mx-auto h-10 w-10 text-[#1E293B]" />
          <p className="mt-4 text-sm text-[#64748B]">
            {topics === undefined
              ? "Loading topics..."
              : "No topics yet. Generate a plan to see keyword clusters."}
          </p>
        </div>
      )}
    </div>
  );
}
