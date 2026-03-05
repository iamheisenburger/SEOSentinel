"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui/status-badge";
import { FileText, PenTool, ArrowRight, CheckCircle2, XCircle, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { Id } from "../../../../convex/_generated/dataModel";
import { ArticleProgress } from "@/components/ui/article-progress";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import { useActiveSite } from "@/contexts/site-context";
import { Zap } from "lucide-react";

export default function ArticlesPage() {
  const { activeSite: site, sites } = useActiveSite();
  const topics = useQuery(
    api.topics.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const articles = useQuery(
    api.articles.listBySite,
    site?._id ? { siteId: site._id } : "skip",
  );
  const queueArticle = useMutation(api.jobs.queueArticleNow);
  const approveArticle = useMutation(api.articles.approve);
  const rejectArticle = useMutation(api.articles.reject);
  const deleteArticle = useMutation(api.articles.deleteArticle);

  const [status, setStatus] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");
  const [selectedTopic, setSelectedTopic] = useState<
    Id<"topic_clusters"> | undefined
  >(undefined);
  const { maxArticles } = usePlanLimits();

  // Articles generated this calendar month
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const articlesThisMonth =
    articles?.filter((a) => a.createdAt >= monthStart.getTime()).length ?? 0;
  const atArticleLimit = articlesThisMonth >= maxArticles;

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

  const draftCount = articles?.filter((a) => a.status === "draft").length ?? 0;
  const readyCount = articles?.filter((a) => a.status === "ready").length ?? 0;
  const publishedCount = articles?.filter((a) => a.status === "published").length ?? 0;
  const rejectedCount = articles?.filter((a) => a.status === "rejected").length ?? 0;

  const tabs = [
    { id: "all", label: "All", count: articles?.length ?? 0 },
    { id: "published", label: "Published", count: publishedCount },
    ...(readyCount > 0 ? [{ id: "ready", label: "Approved", count: readyCount }] : []),
    ...(reviewCount > 0 ? [{ id: "review", label: "Review", count: reviewCount }] : []),
    { id: "draft", label: "Drafts", count: draftCount },
    ...(rejectedCount > 0 ? [{ id: "rejected", label: "Rejected", count: rejectedCount }] : []),
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
    setStatus("Queued — generation will start shortly...");
    try {
      await queueArticle({ siteId: site._id, topicId: selectedTopic });
      setStatus("Article queued.");
    } catch (err: unknown) {
      setStatus(
        err instanceof Error ? err.message : "Failed to queue article",
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
              disabled={!site || atArticleLimit}
              icon={atArticleLimit ? <Zap className="h-3.5 w-3.5" /> : <PenTool className="h-3.5 w-3.5" />}
            >
              {atArticleLimit ? "Limit Reached" : "Generate"}
            </Button>
          </div>
        }
      />

      {status && (
        <div className="rounded-lg bg-[#0EA5E9]/[0.08] px-4 py-2 text-[13px] text-[#38BDF8]">
          {status}
        </div>
      )}

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

      {site && <ArticleProgress siteId={site._id} />}

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {/* Article List */}
      {filtered.length > 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
          {/* Table header */}
          <div className="hidden sm:grid sm:grid-cols-[1fr_100px_80px_140px_100px] gap-4 px-5 py-2.5 border-b border-white/[0.04] text-[10px] font-semibold uppercase tracking-[0.1em] text-[#565A6E]">
            <span>Title</span>
            <span>Status</span>
            <span>Words</span>
            <span>Actions</span>
            <span className="text-right">Created</span>
          </div>

          {filtered.map((article) => {
            const wc = article.wordCount ?? Math.round(article.markdown.split(/\s+/).length);
            const canApprove = article.status === "draft" || article.status === "review";
            const canDelete = article.status !== "published";
            return (
              <div
                key={article._id}
                className="group flex flex-col sm:grid sm:grid-cols-[1fr_100px_80px_140px_100px] gap-1 sm:gap-4 sm:items-center px-5 py-3.5 border-b border-white/[0.04] last:border-0 transition hover:bg-white/[0.02]"
              >
                <Link href={`/articles/${article._id}`} className="flex items-center gap-3 min-w-0">
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
                </Link>
                <StatusBadge status={article.status} />
                <span className="text-[12px] text-[#8B8FA3] tabular-nums hidden sm:block">
                  {wc.toLocaleString()}
                </span>
                <div className="flex items-center gap-1.5">
                  {canApprove && (
                    <>
                      <button
                        onClick={() => approveArticle({ articleId: article._id })}
                        className="inline-flex items-center gap-1 rounded-md bg-[#22C55E]/[0.08] px-2 py-1 text-[10px] font-medium text-[#4ADE80] hover:bg-[#22C55E]/[0.15] transition"
                        title="Approve"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Approve
                      </button>
                      <button
                        onClick={() => rejectArticle({ articleId: article._id })}
                        className="inline-flex items-center gap-1 rounded-md bg-[#EF4444]/[0.08] px-2 py-1 text-[10px] font-medium text-[#F87171] hover:bg-[#EF4444]/[0.15] transition"
                        title="Reject"
                      >
                        <XCircle className="h-3 w-3" />
                        Reject
                      </button>
                    </>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => {
                        if (confirm("Delete this article permanently?")) {
                          deleteArticle({ articleId: article._id });
                        }
                      }}
                      className="inline-flex items-center rounded-md p-1 text-[#565A6E] hover:bg-[#EF4444]/[0.08] hover:text-[#F87171] transition"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <Link href={`/articles/${article._id}`} className="text-[11px] text-[#565A6E] sm:text-right flex items-center gap-1 sm:justify-end">
                  {formatDistanceToNow(article.createdAt, { addSuffix: true })}
                  <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition" />
                </Link>
              </div>
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
