"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { FileText, PenTool, ArrowRight } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Id } from "../../../../convex/_generated/dataModel";

export default function ArticlesPage() {
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
  const generateArticle = useAction(api.actions.pipeline.generateArticle);

  const [status, setStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [selectedTopic, setSelectedTopic] = useState<
    Id<"topic_clusters"> | undefined
  >(undefined);

  const availableTopics = useMemo(
    () =>
      (topics ?? []).filter(
        (t) => t.status !== "used" && t.status !== "queued",
      ),
    [topics],
  );

  const filtered = useMemo(() => {
    if (!articles) return [];
    if (activeTab === "all") return articles;
    return articles.filter((a) => a.status === activeTab);
  }, [articles, activeTab]);

  const reviewCount =
    articles?.filter((a) => a.status === "review").length ?? 0;

  const tabs = [
    { id: "all", label: "All", count: articles?.length ?? 0 },
    {
      id: "published",
      label: "Published",
      count: articles?.filter((a) => a.status === "published").length ?? 0,
    },
    ...(reviewCount > 0
      ? [{ id: "review", label: "Review", count: reviewCount }]
      : []),
    {
      id: "draft",
      label: "Drafts",
      count: articles?.filter((a) => a.status === "draft").length ?? 0,
    },
  ];

  if (sites === undefined) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="h-6 w-28 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-4 w-56 animate-pulse rounded bg-white/[0.03]" />
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117]">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5 border-b border-white/[0.04] last:border-0">
              <div className="h-4 w-16 animate-pulse rounded-full bg-white/[0.04]" />
              <div className="h-4 w-60 animate-pulse rounded bg-white/[0.04]" />
              <div className="ml-auto h-3 w-20 animate-pulse rounded bg-white/[0.04]" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const handleGenerate = async () => {
    if (!site?._id) return;
    setStatus("Generating article...");
    try {
      await generateArticle({ siteId: site._id, topicId: selectedTopic });
      setStatus("Article created.");
    } catch (err: unknown) {
      setStatus(
        err instanceof Error ? err.message : "Failed to generate article",
      );
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Articles"
        subtitle={`${articles?.length ?? 0} articles total`}
        actions={
          <div className="flex items-center gap-2">
            <select
              className="rounded-lg border border-white/[0.06] bg-[#0F1117] px-2.5 py-1.5 text-[12px] text-[#EDEEF1] outline-none transition focus:border-[#0EA5E9]/50"
              value={selectedTopic ?? ""}
              onChange={(e) =>
                setSelectedTopic(
                  e.target.value
                    ? (e.target.value as Id<"topic_clusters">)
                    : undefined,
                )
              }
            >
              <option value="">Any topic</option>
              {availableTopics.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={handleGenerate}
              disabled={!site}
              icon={<PenTool className="h-3.5 w-3.5" />}
            >
              Generate
            </Button>
          </div>
        }
      />

      {status && (
        <div className="rounded-lg bg-[#0EA5E9]/[0.08] px-4 py-2 text-[13px] text-[#38BDF8]">
          {status}
        </div>
      )}

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Article List */}
      {filtered.length > 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
          {/* Table header */}
          <div className="hidden sm:grid sm:grid-cols-[1fr_100px_80px_100px] gap-4 px-5 py-2.5 border-b border-white/[0.04] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#565A6E]">
            <span>Title</span>
            <span>Status</span>
            <span>Words</span>
            <span className="text-right">Created</span>
          </div>

          {filtered.map((article) => {
            const wc = article.wordCount ?? Math.round(article.markdown.split(/\s+/).length);
            return (
              <Link
                key={article._id}
                href={`/articles/${article._id}`}
                className="group flex flex-col sm:grid sm:grid-cols-[1fr_100px_80px_100px] gap-1 sm:gap-4 sm:items-center px-5 py-3.5 border-b border-white/[0.04] last:border-0 transition hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {article.featuredImage && (
                    <img
                      src={article.featuredImage}
                      alt=""
                      className="hidden sm:block h-9 w-14 rounded object-cover shrink-0 border border-white/[0.06]"
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-[#EDEEF1] leading-snug truncate group-hover:text-white transition">
                      {article.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#565A6E] font-mono truncate sm:hidden">
                      /{article.slug}
                    </p>
                  </div>
                </div>
                <StatusBadge status={article.status} />
                <span className="text-[12px] text-[#8B8FA3] tabular-nums hidden sm:block">
                  {wc.toLocaleString()}
                </span>
                <span className="text-[11px] text-[#565A6E] sm:text-right flex items-center gap-1 sm:justify-end">
                  {formatDistanceToNow(article.createdAt, { addSuffix: true })}
                  <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition" />
                </span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-12 text-center">
          <FileText className="mx-auto h-10 w-10 text-[#565A6E]/30" />
          <p className="mt-3 text-[13px] text-[#565A6E]">
            {articles === undefined
              ? "Loading..."
              : activeTab !== "all"
                ? "No articles match this filter."
                : "No articles yet. Generate one to get started."}
          </p>
        </div>
      )}
    </div>
  );
}
