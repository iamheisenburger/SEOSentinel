"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  ArrowLeft,
  Link2,
  Upload,
  ExternalLink,
  CheckCircle2,
  XCircle,
  ShieldCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import type { Components } from "react-markdown";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useState } from "react";
import Link from "next/link";

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-10 mb-4 text-2xl font-bold tracking-tight text-[#EDEEF1]">
      {children}
    </h1>
  ),
  h2: ({ children, id }) => (
    <h2
      id={id}
      className="mt-8 mb-3 text-xl font-bold tracking-tight text-[#EDEEF1]"
    >
      {children}
    </h2>
  ),
  h3: ({ children, id }) => (
    <h3
      id={id}
      className="mt-6 mb-2 text-lg font-semibold text-[#EDEEF1]"
    >
      {children}
    </h3>
  ),
  p: ({ children }) => (
    <p className="mb-4 text-[#8B8FA3] leading-relaxed text-[14px]">{children}</p>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-[#0EA5E9] underline decoration-[#0EA5E9]/30 underline-offset-2 transition hover:text-[#38BDF8]"
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 list-disc space-y-1.5 pl-6 text-[14px] text-[#8B8FA3]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 list-decimal space-y-1.5 pl-6 text-[14px] text-[#8B8FA3]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-5 border-l-2 border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.04] py-3 pl-4 pr-4 text-[14px] text-[#8B8FA3] italic">
      {children}
    </blockquote>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#EDEEF1]">{children}</strong>
  ),
  table: ({ children }) => (
    <div className="my-5 overflow-x-auto rounded-lg border border-white/[0.06]">
      <table className="w-full text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-white/[0.06] bg-white/[0.02]">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="px-4 py-2 text-left font-semibold text-[#EDEEF1]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-t border-white/[0.04] px-4 py-2 text-[#8B8FA3]">
      {children}
    </td>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code className="block overflow-x-auto rounded-lg bg-[#08090E] px-4 py-3 text-[13px] text-[#8B8FA3] font-mono border border-white/[0.06]">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-[13px] font-mono text-[#EDEEF1]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-5">{children}</pre>,
  hr: () => <hr className="my-8 border-white/[0.06]" />,
};

export default function ArticleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const articleId = params.id as Id<"articles">;
  const article = useQuery(api.articles.get, { articleId });
  const sites = useQuery(api.sites.list);
  const site = sites?.[0];
  const suggestLinks = useAction(api.actions.pipeline.suggestInternalLinks);
  const publishApproved = useAction(api.actions.pipeline.publishApproved);
  const approveArticle = useMutation(api.articles.approve);
  const rejectArticle = useMutation(api.articles.reject);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  if (article === undefined) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0EA5E9] border-t-transparent" />
      </div>
    );
  }

  if (article === null) {
    return (
      <div className="py-20 text-center">
        <p className="text-[#565A6E] text-[13px]">Article not found.</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => router.push("/articles")}
          className="mt-4"
        >
          Back to Articles
        </Button>
      </div>
    );
  }

  const wordCount = article.markdown.split(/\s+/).length;

  const handleLinks = async () => {
    if (!site?._id) return;
    setLinkStatus("Generating internal links...");
    try {
      await suggestLinks({ siteId: site._id, articleId });
      setLinkStatus("Internal links generated.");
    } catch (err: unknown) {
      setLinkStatus(
        err instanceof Error ? err.message : "Failed to suggest links",
      );
    }
  };

  const handleApprove = async () => {
    setActionBusy(true);
    try {
      await approveArticle({ articleId });
      setLinkStatus("Article approved. Ready to publish.");
    } catch (err: unknown) {
      setLinkStatus(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setActionBusy(false);
    }
  };

  const handleReject = async () => {
    setActionBusy(true);
    try {
      await rejectArticle({ articleId });
      setLinkStatus("Article rejected. Moved back to draft.");
    } catch (err: unknown) {
      setLinkStatus(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setActionBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!site?._id) return;
    setActionBusy(true);
    setLinkStatus("Publishing to GitHub...");
    try {
      await publishApproved({ siteId: site._id, articleId });
      setLinkStatus("Article published successfully.");
    } catch (err: unknown) {
      setLinkStatus(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Back + Header */}
      <div>
        <Link
          href="/articles"
          className="mb-3 inline-flex items-center gap-1.5 text-[12px] text-[#565A6E] transition hover:text-[#EDEEF1]"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Articles
        </Link>
        <PageHeader
          title={article.title}
          actions={
            <div className="flex flex-wrap gap-2">
              {article.status === "review" && (
                <>
                  <Button
                    size="sm"
                    onClick={handleApprove}
                    loading={actionBusy}
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleReject}
                    loading={actionBusy}
                    icon={<XCircle className="h-3.5 w-3.5" />}
                  >
                    Reject
                  </Button>
                </>
              )}
              {article.status === "ready" && (
                <Button
                  size="sm"
                  onClick={handlePublish}
                  loading={actionBusy}
                  icon={<Upload className="h-3.5 w-3.5" />}
                >
                  Publish Now
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleLinks}
                disabled={!site}
                icon={<Link2 className="h-3.5 w-3.5" />}
              >
                Internal Links
              </Button>
            </div>
          }
        />
      </div>

      {linkStatus && (
        <div className="rounded-lg bg-[#0EA5E9]/[0.08] px-4 py-2 text-[13px] text-[#38BDF8]">
          {linkStatus}
        </div>
      )}

      {/* Meta bar */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={article.status} />
        <span className="text-[11px] text-[#565A6E]">{wordCount} words</span>
        <span className="text-[11px] text-white/[0.1]">·</span>
        <span className="text-[11px] text-[#565A6E]">
          {formatDistanceToNow(article.createdAt, { addSuffix: true })}
        </span>
        <span className="text-[11px] text-white/[0.1]">·</span>
        <span className="text-[11px] text-[#565A6E] font-mono">
          /{article.slug}
        </span>
        {article.factCheckScore != null && (
          <>
            <span className="text-[11px] text-white/[0.1]">·</span>
            <span className={`text-[11px] font-medium ${
              article.factCheckScore >= 90
                ? "text-[#22C55E]"
                : article.factCheckScore >= 70
                  ? "text-[#F59E0B]"
                  : "text-[#EF4444]"
            }`}>
              {article.factCheckScore}% fact-check
            </span>
          </>
        )}
      </div>

      {/* Fact-check notes */}
      {article.factCheckNotes && (
        <div className="rounded-lg border border-white/[0.06] bg-[#0F1117] px-4 py-3">
          <div className="flex items-center gap-2 mb-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-[#0EA5E9]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#565A6E]">
              Fact-Check Notes
            </span>
            {article.factCheckScore != null && (
              <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium ${
                article.factCheckScore >= 90
                  ? "bg-[#22C55E]/[0.08] text-[#22C55E]"
                  : article.factCheckScore >= 70
                    ? "bg-[#F59E0B]/[0.08] text-[#F59E0B]"
                    : "bg-[#EF4444]/[0.08] text-[#EF4444]"
              }`}>
                {article.factCheckScore}% confidence
              </span>
            )}
          </div>
          <p className="text-[13px] text-[#8B8FA3] leading-relaxed">
            {article.factCheckNotes}
          </p>
        </div>
      )}

      {/* Article Content */}
      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6 sm:p-8">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug]}
          components={markdownComponents}
        >
          {article.markdown}
        </ReactMarkdown>
      </div>

      {/* Sources */}
      {article.sources && article.sources.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#565A6E]">
            Sources
          </h3>
          <ul className="space-y-1.5">
            {article.sources.map((source, i) => (
              <li key={i}>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] text-[#0EA5E9] underline decoration-[#0EA5E9]/30 underline-offset-2 hover:text-[#38BDF8]"
                >
                  <ExternalLink className="h-3 w-3" />
                  {source.title || source.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Internal Links */}
      {article.internalLinks && article.internalLinks.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-5">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-[#565A6E]">
            Internal Links
          </h3>
          <ul className="space-y-1.5">
            {article.internalLinks.map((link, i) => (
              <li key={i} className="flex items-center gap-2 text-[13px]">
                <Link2 className="h-3 w-3 text-[#565A6E]" />
                <span className="text-[#EDEEF1]">{link.anchor}</span>
                <span className="text-[#565A6E]">→</span>
                <span className="font-mono text-[#0EA5E9]">{link.href}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
