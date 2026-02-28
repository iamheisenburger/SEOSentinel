"use client";

import { useAction, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { FileText, PenTool, ExternalLink } from "lucide-react";
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
      <div className="flex flex-col gap-6">
        <div>
          <div className="mb-2 h-8 w-32 animate-pulse rounded-lg bg-[#1E293B]" />
          <div className="h-4 w-64 animate-pulse rounded-lg bg-[#1E293B]" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="rounded-xl border border-[#1E293B] bg-[#111827] p-5">
              <div className="mb-3 h-5 w-16 animate-pulse rounded-full bg-[#1E293B]" />
              <div className="mb-2 h-4 w-full animate-pulse rounded bg-[#1E293B]" />
              <div className="mb-1.5 h-4 w-2/3 animate-pulse rounded bg-[#1E293B]" />
              <div className="h-3 w-24 animate-pulse rounded bg-[#1E293B]" />
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Articles"
        subtitle="Browse, generate, and manage your content"
        actions={
          <div className="flex items-center gap-3">
            <select
              className="rounded-lg border border-[#1E293B] bg-[#0B1120] px-3 py-2 text-sm text-[#F1F5F9] outline-none transition focus:border-[#0EA5E9]"
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
              onClick={handleGenerate}
              disabled={!site}
              icon={<PenTool className="h-4 w-4" />}
            >
              Generate
            </Button>
          </div>
        }
      />

      {status && (
        <div className="rounded-lg bg-[#0EA5E9]/10 px-4 py-2.5 text-sm text-[#38BDF8]">
          {status}
        </div>
      )}

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Article Cards */}
      {filtered.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((article) => (
            <Link
              key={article._id}
              href={`/articles/${article._id}`}
              className="group rounded-xl border border-[#1E293B] bg-[#111827] p-5 transition-all duration-150 hover:border-[#0EA5E9]/20 hover:shadow-lg hover:shadow-[#0EA5E9]/5"
            >
              <div className="flex items-start justify-between gap-2">
                <StatusBadge status={article.status} />
                <ExternalLink className="h-3.5 w-3.5 text-[#475569] opacity-0 transition group-hover:opacity-100" />
              </div>
              <h3 className="mt-3 text-sm font-semibold leading-snug text-[#F1F5F9] line-clamp-2">
                {article.title}
              </h3>
              <p className="mt-1.5 text-xs text-[#64748B]">
                /{article.slug}
              </p>
              <div className="mt-3 flex items-center gap-3 text-[11px] text-[#475569]">
                <span>
                  {Math.round(article.markdown.split(/\s+/).length)} words
                </span>
                <span>·</span>
                <span>
                  {formatDistanceToNow(article.createdAt, {
                    addSuffix: true,
                  })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-[#1E293B] bg-[#111827] p-10 text-center">
          <FileText className="mx-auto h-10 w-10 text-[#1E293B]" />
          <p className="mt-4 text-sm text-[#64748B]">
            {articles === undefined
              ? "Loading articles..."
              : "No articles yet. Generate one from a topic to get started."}
          </p>
        </div>
      )}
    </div>
  );
}
