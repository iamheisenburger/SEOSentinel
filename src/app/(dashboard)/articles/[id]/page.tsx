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
  Copy,
  Code2,
  Download,
  Clock,
  FileText,
  Image as ImageIcon,
  Trash2,
  Eye,
  Code,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeRaw from "rehype-raw";
import type { Components } from "react-markdown";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useMemo, useState } from "react";
import Link from "next/link";

function simpleMarkdownToHtml(md: string): string {
  let html = md;
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  html = html.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/^---$/gm, "<hr>");
  html = html.split("\n\n").map((block) => {
    const t = block.trim();
    if (!t) return "";
    if (/^<[a-z]/.test(t)) return t;
    return `<p>${t.replace(/\n/g, "<br>")}</p>`;
  }).join("\n\n");
  return html;
}

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
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || ""}
      className="my-5 w-full max-w-full rounded-lg border border-white/[0.06]"
      style={{ maxWidth: "100%", height: "auto" }}
      loading="lazy"
    />
  ),
};

// ── Client-side schema markup generation (mirrors publisher.ts logic) ──
function generateSchemaMarkup(
  article: { title: string; markdown: string; metaDescription?: string; featuredImage?: string; createdAt: number },
  domain: string,
): Record<string, unknown>[] {
  const schemas: Record<string, unknown>[] = [];
  const slug = "blog/" + (article.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));

  schemas.push({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.metaDescription ?? "",
    url: `https://${domain}/${slug}`,
    datePublished: new Date(article.createdAt).toISOString(),
    ...(article.featuredImage ? { image: article.featuredImage } : {}),
    publisher: { "@type": "Organization", name: domain, url: `https://${domain}` },
  });

  // FAQ schema — extract H2/H3 headings that end with ?
  const faqRegex = /#{2,3}\s+(.+\?)\s*\n+([\s\S]*?)(?=\n#{2,3}\s|\n*$)/g;
  const faqs: { question: string; answer: string }[] = [];
  let match;
  while ((match = faqRegex.exec(article.markdown)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim().slice(0, 500);
    if (question && answer) faqs.push({ question, answer });
  }
  if (faqs.length >= 3) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }

  // HowTo schema
  if (/how\s+to/i.test(article.title)) {
    const stepRegex = /#{2,3}\s+(?:Step\s+\d+[:.]\s*)?(.+)\n+([\s\S]*?)(?=\n#{2,3}\s|\n*$)/g;
    const steps: { name: string; text: string }[] = [];
    let stepMatch;
    while ((stepMatch = stepRegex.exec(article.markdown)) !== null) {
      const name = stepMatch[1].trim();
      const text = stepMatch[2].trim().slice(0, 300);
      if (name && text && !/FAQ|Frequently/i.test(name)) steps.push({ name, text });
    }
    if (steps.length >= 3) {
      schemas.push({
        "@context": "https://schema.org",
        "@type": "HowTo",
        name: article.title,
        step: steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: s.text })),
      });
    }
  }

  return schemas;
}

// ── Branded preview components (light theme, matching user's website) ──
function buildBrandedComponents(primaryColor: string, accentColor: string): Components {
  return {
    h1: ({ children }) => (
      <h1 className="mt-8 mb-4 text-2xl font-bold tracking-tight" style={{ color: "#1a1a1a" }}>{children}</h1>
    ),
    h2: ({ children, id }) => (
      <h2 id={id} className="mt-8 mb-3 text-xl font-bold tracking-tight" style={{ color: primaryColor }}>{children}</h2>
    ),
    h3: ({ children, id }) => (
      <h3 id={id} className="mt-6 mb-2 text-lg font-semibold" style={{ color: "#1a1a1a" }}>{children}</h3>
    ),
    p: ({ children }) => (
      <p className="mb-4 text-gray-600 leading-relaxed text-[14px]">{children}</p>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        className="underline underline-offset-2 transition"
        style={{ color: primaryColor }}
        target={href?.startsWith("http") ? "_blank" : undefined}
        rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      >{children}</a>
    ),
    ul: ({ children }) => (
      <ul className="mb-4 list-disc space-y-1.5 pl-6 text-[14px] text-gray-600">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-4 list-decimal space-y-1.5 pl-6 text-[14px] text-gray-600">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
    blockquote: ({ children }) => (
      <blockquote
        className="my-5 py-3 pl-4 pr-4 text-[14px] text-gray-500 italic rounded-r-lg"
        style={{ borderLeft: `3px solid ${accentColor}`, backgroundColor: `${accentColor}08` }}
      >{children}</blockquote>
    ),
    strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
    table: ({ children }) => (
      <div className="my-5 overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-[13px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => (
      <thead style={{ backgroundColor: `${accentColor}0D` }}>{children}</thead>
    ),
    th: ({ children }) => (
      <th className="px-4 py-2 text-left font-semibold text-gray-700">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border-t border-gray-100 px-4 py-2 text-gray-600">{children}</td>
    ),
    code: ({ className, children }) => {
      const isBlock = className?.includes("language-");
      if (isBlock) {
        return (
          <code className="block overflow-x-auto rounded-lg bg-gray-50 px-4 py-3 text-[13px] text-gray-700 font-mono border border-gray-200">
            {children}
          </code>
        );
      }
      return (
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-[13px] font-mono text-gray-800">{children}</code>
      );
    },
    pre: ({ children }) => <pre className="my-5">{children}</pre>,
    hr: () => <hr className="my-8 border-gray-200" />,
    img: ({ src, alt }) => (
      <img
        src={src}
        alt={alt || ""}
        className="my-5 w-full max-w-full rounded-lg border border-gray-200"
        style={{ maxWidth: "100%", height: "auto" }}
        loading="lazy"
      />
    ),
  };
}

export default function ArticleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const articleId = params.id as Id<"articles">;
  const article = useQuery(api.articles.get, { articleId });
  // Look up the site that owns this article (not just the first site)
  const site = useQuery(
    api.sites.get,
    article?.siteId ? { siteId: article.siteId } : "skip",
  );
  const suggestLinks = useAction(api.actions.pipeline.suggestInternalLinks);
  const publishApproved = useAction(api.actions.pipeline.publishApproved);
  const approveArticle = useMutation(api.articles.approve);
  const rejectArticle = useMutation(api.articles.reject);
  const deleteArticle = useMutation(api.articles.deleteArticle);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [viewMode, setViewMode] = useState<"editor" | "preview">("editor");
  const [schemaOpen, setSchemaOpen] = useState(false);

  // ── Hooks MUST be called before any conditional returns ──
  const primaryColor = site?.brandPrimaryColor ?? "#0EA5E9";
  const accentColor = site?.brandAccentColor ?? primaryColor;
  const brandFont = site?.brandFontFamily;

  const schemas = useMemo(
    () => article ? generateSchemaMarkup(article, site?.domain ?? "example.com") : [],
    [article, site?.domain],
  );

  const brandedComponents = useMemo(
    () => buildBrandedComponents(primaryColor, accentColor),
    [primaryColor, accentColor],
  );

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

  const wc = article.wordCount ?? article.markdown.split(/\s+/).length;
  const rt = article.readingTime ?? Math.max(1, Math.ceil(wc / 238));

  const faqSchema = schemas.find((s) => s["@type"] === "FAQPage");
  const faqCount = faqSchema ? (faqSchema.mainEntity as unknown[] | undefined)?.length ?? 0 : 0;
  const hasHowTo = schemas.some((s) => s["@type"] === "HowTo");

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
      setLinkStatus("Article rejected.");
    } catch (err: unknown) {
      setLinkStatus(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setActionBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this article permanently?")) return;
    setActionBusy(true);
    try {
      await deleteArticle({ articleId });
      router.push("/articles");
    } catch (err: unknown) {
      setLinkStatus(err instanceof Error ? err.message : "Delete failed");
      setActionBusy(false);
    }
  };

  const isManualPublish = site?.publishMethod === "manual";

  const handlePublish = async () => {
    if (!site?._id) return;
    setActionBusy(true);
    setLinkStatus(isManualPublish ? "Marking as published..." : "Publishing...");
    try {
      await publishApproved({ siteId: site._id, articleId });
      setLinkStatus("Article published successfully.");
    } catch (err: unknown) {
      setLinkStatus(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setActionBusy(false);
    }
  };

  const handleCopyMarkdown = async () => {
    await navigator.clipboard.writeText(article.markdown);
    setLinkStatus("Markdown copied to clipboard.");
    setTimeout(() => setLinkStatus(null), 2000);
  };

  const handleCopyHtml = async () => {
    const html = simpleMarkdownToHtml(article.markdown);
    await navigator.clipboard.writeText(html);
    setLinkStatus("HTML copied to clipboard.");
    setTimeout(() => setLinkStatus(null), 2000);
  };

  const handleDownload = () => {
    const frontmatter = [
      "---",
      `title: "${article.title.replace(/"/g, '\\"')}"`,
      article.metaDescription ? `description: "${article.metaDescription.replace(/"/g, '\\"')}"` : null,
      article.featuredImage ? `featuredImage: "${article.featuredImage}"` : null,
      `readingTime: ${rt}`,
      `wordCount: ${wc}`,
      `date: "${new Date(article.createdAt).toISOString()}"`,
      `slug: "${article.slug}"`,
      "---",
    ].filter(Boolean).join("\n");
    const content = `${frontmatter}\n\n${article.markdown}`;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${article.slug.replace(/^\//, "")}.mdx`;
    a.click();
    URL.revokeObjectURL(url);
    setLinkStatus("Article downloaded.");
    setTimeout(() => setLinkStatus(null), 2000);
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
              {(article.status === "draft" || article.status === "review") && (
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
                  {isManualPublish ? "Mark as Published" : "Publish Now"}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyMarkdown}
                icon={<Copy className="h-3.5 w-3.5" />}
              >
                Copy MD
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyHtml}
                icon={<Code2 className="h-3.5 w-3.5" />}
              >
                Copy HTML
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownload}
                icon={<Download className="h-3.5 w-3.5" />}
              >
                Download
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleLinks}
                disabled={!site}
                icon={<Link2 className="h-3.5 w-3.5" />}
              >
                Internal Links
              </Button>
              {article.status !== "published" && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDelete}
                  loading={actionBusy}
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                >
                  Delete
                </Button>
              )}
            </div>
          }
        />
      </div>

      {linkStatus && (
        <div className="rounded-lg bg-[#0EA5E9]/[0.08] px-4 py-2 text-[13px] text-[#38BDF8]">
          {linkStatus}
        </div>
      )}

      {/* Featured Image */}
      {article.featuredImage && (
        <div className="overflow-hidden rounded-xl border border-white/[0.06]">
          <img
            src={article.featuredImage}
            alt={article.title}
            className="w-full h-auto max-h-[400px] object-cover"
          />
        </div>
      )}

      {/* Meta bar */}
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={article.status} />
        <span className="inline-flex items-center gap-1 text-[11px] text-[#565A6E]">
          <FileText className="h-3 w-3" />
          {wc.toLocaleString()} words
        </span>
        <span className="text-[11px] text-white/[0.1]">·</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-[#565A6E]">
          <Clock className="h-3 w-3" />
          {rt} min read
        </span>
        <span className="text-[11px] text-white/[0.1]">·</span>
        <span className="text-[11px] text-[#565A6E]">
          {formatDistanceToNow(article.createdAt, { addSuffix: true })}
        </span>
        <span className="text-[11px] text-white/[0.1]">·</span>
        <span className="text-[11px] text-[#565A6E] font-mono">
          /{article.slug}
        </span>
        {article.featuredImage && (
          <>
            <span className="text-[11px] text-white/[0.1]">·</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#22C55E]">
              <ImageIcon className="h-3 w-3" />
              Hero image
            </span>
          </>
        )}
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
        {(article as any).contentScore != null && (
          <>
            <span className="text-[11px] text-white/[0.1]">·</span>
            <span className={`text-[11px] font-medium ${
              (article as any).contentScore >= 80
                ? "text-[#22C55E]"
                : (article as any).contentScore >= 60
                  ? "text-[#F59E0B]"
                  : "text-[#EF4444]"
            }`}>
              {(article as any).contentScore}/100 SEO score
            </span>
          </>
        )}
        {(article as any).serpDifficulty && (
          <>
            <span className="text-[11px] text-white/[0.1]">·</span>
            <span className={`text-[11px] font-medium ${
              (article as any).serpDifficulty === "easy" ? "text-[#22C55E]"
                : (article as any).serpDifficulty === "medium" ? "text-[#F59E0B]"
                : "text-[#EF4444]"
            }`}>
              {(article as any).serpDifficulty} competition
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

      {/* View mode toggle */}
      <div className="flex items-center gap-1 rounded-lg bg-white/[0.03] p-0.5 w-fit border border-white/[0.06]">
        <button
          onClick={() => setViewMode("editor")}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
            viewMode === "editor"
              ? "bg-white/[0.08] text-[#EDEEF1]"
              : "text-[#565A6E] hover:text-[#8B8FA3]"
          }`}
        >
          <Code className="h-3 w-3" />
          Editor
        </button>
        <button
          onClick={() => setViewMode("preview")}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
            viewMode === "preview"
              ? "bg-white/[0.08] text-[#EDEEF1]"
              : "text-[#565A6E] hover:text-[#8B8FA3]"
          }`}
        >
          <Eye className="h-3 w-3" />
          Brand Preview
        </button>
      </div>

      {/* Article Content */}
      {viewMode === "editor" ? (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] p-6 sm:p-8">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug, rehypeRaw]}
            components={markdownComponents}
          >
            {article.markdown}
          </ReactMarkdown>
        </div>
      ) : (
        <div
          className="rounded-xl border border-gray-200 overflow-hidden"
          style={{ fontFamily: brandFont ? `"${brandFont}", system-ui, sans-serif` : "system-ui, sans-serif" }}
        >
          {/* Branded header */}
          <div className="h-14 bg-gradient-to-r from-gray-50 to-gray-100 flex items-center px-6 border-b border-gray-200">
            {site?.brandLogoUrl ? (
              <img src={site.brandLogoUrl} alt="Logo" className="h-6 object-contain" />
            ) : (
              <span className="text-[13px] font-semibold text-gray-700">{site?.siteName ?? site?.domain ?? "Blog"}</span>
            )}
            <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wider">Article Preview</span>
          </div>
          {/* Article on white bg */}
          <div className="bg-white p-6 sm:p-10 max-w-3xl mx-auto">
            {article.featuredImage && (
              <img
                src={article.featuredImage}
                alt={article.title}
                className="w-full h-auto max-h-[350px] object-cover rounded-lg mb-6"
              />
            )}
            <h1 className="text-[26px] font-bold leading-tight mb-3" style={{ color: "#1a1a1a" }}>
              {article.title}
            </h1>
            <div className="flex items-center gap-3 mb-6 text-[11px] text-gray-400">
              <span>{rt} min read</span>
              <span>&middot;</span>
              <span>{wc.toLocaleString()} words</span>
              <span>&middot;</span>
              <span>{new Date(article.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
            </div>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug, rehypeRaw]}
              components={brandedComponents}
            >
              {article.markdown}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* Schema Markup Preview */}
      {schemas.length > 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-[#0F1117]">
          <button
            onClick={() => setSchemaOpen(!schemaOpen)}
            className="flex items-center gap-2 w-full px-5 py-3.5 text-left hover:bg-white/[0.02] transition"
          >
            {schemaOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-[#565A6E]" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-[#565A6E]" />
            )}
            <Code2 className="h-3.5 w-3.5 text-[#0EA5E9]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#565A6E]">
              Schema Markup
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="rounded bg-[#0EA5E9]/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-[#38BDF8]">
                Article
              </span>
              {faqCount > 0 && (
                <span className="rounded bg-[#22C55E]/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-[#4ADE80]">
                  FAQ ({faqCount})
                </span>
              )}
              {hasHowTo && (
                <span className="rounded bg-[#F59E0B]/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-[#FBBF24]">
                  HowTo
                </span>
              )}
            </div>
          </button>
          {schemaOpen && (
            <div className="border-t border-white/[0.04] px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] text-[#565A6E]">
                  JSON-LD schema markup generated for this article. Included automatically when published.
                </p>
                <button
                  onClick={async () => {
                    const schemaHtml = schemas
                      .map((s) => `<script type="application/ld+json">\n${JSON.stringify(s, null, 2)}\n</script>`)
                      .join("\n\n");
                    await navigator.clipboard.writeText(schemaHtml);
                    setLinkStatus("Schema markup copied.");
                    setTimeout(() => setLinkStatus(null), 2000);
                  }}
                  className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-1 text-[10px] text-[#8B8FA3] hover:bg-white/[0.08] transition"
                >
                  <Copy className="h-2.5 w-2.5" />
                  Copy
                </button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-[#08090E] border border-white/[0.06] p-4 text-[12px] text-[#8B8FA3] font-mono leading-relaxed max-h-[400px] overflow-y-auto">
                {schemas.map((s) => JSON.stringify(s, null, 2)).join("\n\n")}
              </pre>
            </div>
          )}
        </div>
      )}

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
