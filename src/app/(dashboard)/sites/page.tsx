"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Globe,
  FileText,
  Target,
  Trash2,
  ChevronDown,
  ChevronRight,
  Clock,
  ArrowRight,
  Zap,
  Plus,
} from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import type { Id } from "../../../../convex/_generated/dataModel";

export default function WebsitesPage() {
  const sites = useQuery(api.sites.list);
  const loading = sites === undefined;

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <div className="h-6 w-28 animate-pulse rounded bg-white/[0.04]" />
          <div className="mt-1.5 h-4 w-48 animate-pulse rounded bg-white/[0.03]" />
        </div>
        {[...Array(2)].map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5"
          >
            <div className="h-5 w-40 animate-pulse rounded bg-white/[0.04]" />
            <div className="mt-3 h-10 animate-pulse rounded-lg bg-white/[0.03]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Websites"
        subtitle={`${sites.length} website${sites.length !== 1 ? "s" : ""} configured`}
        actions={
          <Button
            size="sm"
            onClick={() => window.location.assign("/dashboard")}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Add Website
          </Button>
        }
      />

      {sites.length === 0 ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-12 text-center">
          <Globe className="mx-auto h-10 w-10 text-[#565A6E]/30" />
          <p className="mt-3 text-[13px] text-[#565A6E]">
            No websites configured yet. Add one to get started.
          </p>
          <Button
            className="mt-4"
            onClick={() => window.location.assign("/dashboard")}
            icon={<Plus className="h-3.5 w-3.5" />}
          >
            Add Your First Website
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {sites.map((site) => (
            <SiteCard key={site._id} site={site} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Site Card ── */

function SiteCard({ site }: { site: { _id: Id<"sites">; domain: string; siteName?: string; siteType?: string; niche?: string; cadencePerWeek?: number; approvalRequired?: boolean; autopilotEnabled?: boolean; createdAt: number; updatedAt: number } }) {
  const [expanded, setExpanded] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deleteSite = useMutation(api.sites.deleteSite);
  const deleteArticle = useMutation(api.articles.deleteArticle);

  const articles = useQuery(api.articles.listBySite, { siteId: site._id });
  const topics = useQuery(api.topics.listBySite, { siteId: site._id });

  const articleCount = articles?.length ?? 0;
  const topicCount = topics?.length ?? 0;
  const publishedCount = articles?.filter((a) => a.status === "published").length ?? 0;

  const handleDeleteSite = async () => {
    setDeleting(true);
    try {
      await deleteSite({ siteId: site._id });
    } catch {
      // ignore
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0EA5E9]/[0.08]">
          <Globe className="h-4 w-4 text-[#0EA5E9]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-semibold text-[#EDEEF1] truncate">
              {site.siteName || site.domain}
            </p>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#22C55E]/[0.08] px-2 py-0.5 text-[10px] font-medium text-[#4ADE80]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
              Active
            </span>
          </div>
          <p className="text-[11px] text-[#565A6E]">
            {site.domain}
            {site.siteType ? ` · ${site.siteType}` : ""}
            {site.niche ? ` · ${site.niche}` : ""}
          </p>
        </div>

        {/* Quick stats */}
        <div className="hidden sm:flex items-center gap-4 text-[11px] text-[#8B8FA3]">
          <span className="flex items-center gap-1">
            <FileText className="h-3 w-3 text-[#565A6E]" />
            {articleCount} articles
          </span>
          <span className="flex items-center gap-1">
            <Target className="h-3 w-3 text-[#565A6E]" />
            {topicCount} topics
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3 text-[#565A6E]" />
            {site.cadencePerWeek ?? 4}/wk
          </span>
        </div>

        {expanded ? (
          <ChevronDown className="h-4 w-4 text-[#565A6E] shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[#565A6E] shrink-0" />
        )}
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-white/[0.04]">
          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 px-5 py-4">
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 text-center">
              <p className="text-lg font-bold text-[#EDEEF1]">{publishedCount}</p>
              <p className="text-[10px] text-[#565A6E]">Published</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 text-center">
              <p className="text-lg font-bold text-[#EDEEF1]">{articleCount - publishedCount}</p>
              <p className="text-[10px] text-[#565A6E]">Drafts</p>
            </div>
            <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3 text-center">
              <p className="text-lg font-bold text-[#EDEEF1]">{topicCount}</p>
              <p className="text-[10px] text-[#565A6E]">Topics</p>
            </div>
          </div>

          {/* Articles list */}
          {articles && articles.length > 0 && (
            <div className="border-t border-white/[0.04]">
              <div className="px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#565A6E]">
                Articles
              </div>
              {articles.map((article) => (
                <ArticleRow
                  key={article._id}
                  article={article}
                  onDelete={() => deleteArticle({ articleId: article._id })}
                />
              ))}
            </div>
          )}

          {articles && articles.length === 0 && (
            <div className="border-t border-white/[0.04] px-5 py-6 text-center">
              <p className="text-[12px] text-[#565A6E]">
                No articles yet. Go to the dashboard to generate one.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between border-t border-white/[0.04] px-5 py-3">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 text-[12px] text-[#0EA5E9] hover:text-[#38BDF8] transition"
            >
              <Zap className="h-3 w-3" />
              Generate Article
            </Link>

            {showDeleteConfirm ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="text-[11px] text-[#8B8FA3] hover:text-[#EDEEF1] transition"
                >
                  Cancel
                </button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDeleteSite}
                  loading={deleting}
                  icon={<Trash2 className="h-3 w-3" />}
                >
                  Delete Website
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex items-center gap-1 text-[11px] text-[#565A6E] hover:text-[#EF4444] transition"
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Article Row ── */

function ArticleRow({
  article,
  onDelete,
}: {
  article: {
    _id: Id<"articles">;
    title: string;
    status: string;
    slug: string;
    markdown: string;
    wordCount?: number;
    createdAt: number;
  };
  onDelete: () => void;
}) {
  const [showDelete, setShowDelete] = useState(false);
  const wc = article.wordCount ?? Math.round(article.markdown.split(/\s+/).length);

  return (
    <div className="group flex items-center gap-3 px-5 py-2.5 border-b border-white/[0.03] last:border-0 hover:bg-white/[0.02] transition">
      <StatusBadge status={article.status} />
      <Link
        href={`/articles/${article._id}`}
        className="flex-1 min-w-0"
      >
        <p className="text-[12px] font-medium text-[#EDEEF1] truncate group-hover:text-white transition">
          {article.title}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-[#565A6E] mt-0.5">
          <span>{wc.toLocaleString()} words</span>
          <span>·</span>
          <span>{formatDistanceToNow(article.createdAt, { addSuffix: true })}</span>
        </div>
      </Link>

      <div className="flex items-center gap-1.5 shrink-0">
        <Link
          href={`/articles/${article._id}`}
          className="text-[#565A6E] hover:text-[#0EA5E9] transition opacity-0 group-hover:opacity-100"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        {showDelete ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowDelete(false)}
              className="text-[10px] text-[#8B8FA3] hover:text-[#EDEEF1] transition px-1"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onDelete();
                setShowDelete(false);
              }}
              className="text-[10px] text-[#EF4444] hover:text-[#F87171] transition px-1 font-medium"
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowDelete(true)}
            className="text-[#565A6E] hover:text-[#EF4444] transition opacity-0 group-hover:opacity-100"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
