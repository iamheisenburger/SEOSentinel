"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import Link from "next/link";
import { LandingNav } from "@/components/layout/landing-nav";
import { Clock, ArrowLeft, Calendar, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { useState, useEffect } from "react";

function useDomain() {
  const [domain, setDomain] = useState("");
  useEffect(() => {
    setDomain(window.location.hostname.replace(/^www\./, ""));
  }, []);
  return domain;
}

function MarkdownRenderer({ markdown, brand }: { markdown: string; brand: { primary: string; accent: string; font: string } }) {
  // Parse markdown to HTML with brand styling (mirrors server-side markdownToHtml)
  let html = markdown;

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="article-img">');

  // Headings
  html = html.replace(/^######\s+(.+)$/gm, '<h6 class="article-h">$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5 class="article-h">$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4 class="article-h">$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3 class="article-h3">$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2 class="article-h2">$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1 class="article-h1">$1</h1>');

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="article-link">$1</a>');

  // Blockquotes
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote class="article-bq">$1</blockquote>');

  // Inline code
  html = html.replace(/\`([^\`]+)\`/g, '<code class="article-code">$1</code>');

  // HR
  html = html.replace(/^---$/gm, '<hr class="article-hr">');

  // Unordered lists
  html = html.replace(
    /(?:^[-*]\s+.+\n?)+/gm,
    (block) => {
      const items = block.trim().split("\n")
        .map((line) => `<li>${line.replace(/^[-*]\s+/, "")}</li>`)
        .join("\n");
      return `<ul class="article-ul">\n${items}\n</ul>\n`;
    },
  );

  // Ordered lists
  html = html.replace(
    /(?:^\d+\.\s+.+\n?)+/gm,
    (block) => {
      const items = block.trim().split("\n")
        .map((line) => `<li>${line.replace(/^\d+\.\s+/, "")}</li>`)
        .join("\n");
      return `<ol class="article-ol">\n${items}\n</ol>\n`;
    },
  );

  // Paragraphs
  html = html
    .split("\n\n")
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      if (/^<[a-z]/.test(trimmed)) return trimmed;
      return `<p class="article-p">${trimmed.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n\n");

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        .article-content .article-h1 { font-size: 1.8em; color: ${brand.primary}; font-weight: 700; margin: 0 0 0.8em; font-family: ${brand.font}; }
        .article-content .article-h2 { font-size: 1.4em; color: ${brand.primary}; font-weight: 600; margin: 1.8em 0 0.6em; padding-bottom: 0.3em; border-bottom: 2px solid ${brand.primary}20; font-family: ${brand.font}; }
        .article-content .article-h3 { font-size: 1.15em; font-weight: 600; margin: 1.5em 0 0.5em; font-family: ${brand.font}; }
        .article-content .article-h { font-weight: 600; margin: 1em 0 0.5em; color: ${brand.primary}; font-family: ${brand.font}; }
        .article-content .article-p { line-height: 1.8; margin: 1em 0; color: #c9cdd8; }
        .article-content .article-link { color: ${brand.accent}; text-decoration: underline; text-underline-offset: 2px; }
        .article-content .article-link:hover { opacity: 0.8; }
        .article-content .article-bq { border-left: 4px solid ${brand.primary}; padding: 0.5em 1em; margin: 1.5em 0; color: #8B8FA3; background: rgba(255,255,255,0.02); border-radius: 0 8px 8px 0; }
        .article-content .article-code { background: rgba(255,255,255,0.06); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
        .article-content .article-hr { border: none; border-top: 2px solid ${brand.primary}20; margin: 2em 0; }
        .article-content .article-img { max-width: 100%; height: auto; border-radius: 12px; margin: 1.5em 0; border: 1px solid rgba(255,255,255,0.06); }
        .article-content .article-ul, .article-content .article-ol { padding-left: 1.5em; margin: 1em 0; color: #c9cdd8; line-height: 1.8; }
        .article-content li { margin: 0.3em 0; }
        .article-content strong { color: #EDEEF1; }
      ` }} />
      <div
        className="article-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}

export default function BlogPost() {
  const domain = useDomain();
  const { slug } = useParams<{ slug: string }>();
  const article = useQuery(api.articles.getPublishedBySlug, domain ? {
    domain,
    slug: slug ?? "",
  } : "skip");

  const brand = {
    primary: article?.brandPrimaryColor || "#0EA5E9",
    accent: article?.brandAccentColor || "#22D3EE",
    font: article?.brandFontFamily || "system-ui, -apple-system, sans-serif",
  };

  if (article === undefined) {
    return (
      <div className="min-h-screen bg-[#08090E]">
        <LandingNav />
        <main className="mx-auto max-w-3xl px-6 pt-32 pb-20">
          <div className="animate-pulse">
            <div className="h-8 w-3/4 rounded bg-white/[0.04]" />
            <div className="mt-4 h-4 w-1/3 rounded bg-white/[0.03]" />
            <div className="mt-8 space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-3 rounded bg-white/[0.03]" style={{ width: `${70 + Math.random() * 30}%` }} />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (article === null) {
    return (
      <div className="min-h-screen bg-[#08090E]">
        <LandingNav />
        <main className="mx-auto max-w-3xl px-6 pt-32 pb-20 text-center">
          <h1 className="text-2xl font-bold text-[#EDEEF1]">Article not found</h1>
          <p className="mt-3 text-[15px] text-[#565A6E]">
            This article doesn&apos;t exist or hasn&apos;t been published yet.
          </p>
          <Link
            href="/blog"
            className="mt-6 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#0EA5E9] hover:text-[#38BDF8] transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to blog
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#08090E]">
      <LandingNav />

      <main className="mx-auto max-w-3xl px-6 pt-32 pb-20">
        {/* Back link */}
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#565A6E] hover:text-[#0EA5E9] transition mb-8"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to blog
        </Link>

        {/* Hero image */}
        {article.featuredImage && (
          <div className="overflow-hidden rounded-xl border border-white/[0.06] mb-8">
            <img
              src={article.featuredImage}
              alt={article.title}
              className="w-full h-auto"
            />
          </div>
        )}

        {/* Title + meta */}
        <h1 className="text-3xl font-bold text-[#EDEEF1] tracking-tight leading-tight">
          {article.title}
        </h1>

        <div className="mt-4 flex items-center gap-4 text-[13px] text-[#565A6E]">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            {format(new Date(article.createdAt), "MMMM d, yyyy")}
          </span>
          {article.readingTime && (
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {article.readingTime} min read
            </span>
          )}
          {article.factCheckScore && article.factCheckScore > 80 && (
            <span className="flex items-center gap-1 text-[#22C55E]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Fact-checked
            </span>
          )}
        </div>

        {/* Article content */}
        <div className="mt-10">
          <MarkdownRenderer markdown={article.markdown} brand={brand} />
        </div>

        {/* Sources */}
        {article.sources && article.sources.length > 0 && (
          <div className="mt-12 pt-8 border-t border-white/[0.06]">
            <h3 className="text-[14px] font-semibold text-[#EDEEF1] mb-4">Sources</h3>
            <ul className="flex flex-col gap-2">
              {article.sources.map((s, i) => (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-[#0EA5E9] hover:text-[#38BDF8] underline underline-offset-2 transition"
                  >
                    {s.title || s.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
