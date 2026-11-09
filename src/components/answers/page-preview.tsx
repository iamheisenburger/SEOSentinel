"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpRight } from "lucide-react";
import { SourceGlyph } from "@/components/ui/evidence-card";
import { hostOf, shortDate, sourceQuote } from "@/lib/answers/format";
import type { PageFact, PageSource } from "@/lib/answers/types";
import { cx } from "@/lib/cx";

/** `[n]` markers in a page become links to its numbered sources (links like `[text](url)` are left alone). */
export function linkSourceMarkers(markdown: string, sourceCount: number): string {
  return markdown.replace(/\[(\d{1,2})\](?!\()/g, (whole, n: string) => (Number(n) >= 1 && Number(n) <= sourceCount ? `[${n}](#source-${n})` : whole));
}

function markdownComponents(sources: PageSource[], idPrefix: string): Components {
  return {
    h1: ({ children }) => <h2 className="mt-8 text-[20px] font-semibold leading-7 tracking-[-0.01em] text-text first:mt-0">{children}</h2>,
    h2: ({ children }) => <h2 className="mt-8 text-[18px] font-semibold leading-7 tracking-[-0.01em] text-text first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-6 text-[16px] font-semibold leading-6 text-text">{children}</h3>,
    p: ({ children }) => <p className="mt-4 text-[15px] leading-[26px] text-text-2 first:mt-0">{children}</p>,
    ul: ({ children }) => <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-[26px] text-text-2 marker:text-text-4">{children}</ul>,
    ol: ({ children }) => <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-[26px] text-text-2 marker:text-text-4">{children}</ol>,
    li: ({ children }) => <li className="pl-1">{children}</li>,
    strong: ({ children }) => <strong className="font-semibold text-text">{children}</strong>,
    blockquote: ({ children }) => <blockquote className="mt-4 border-l-2 border-border-strong pl-4 text-text-3">{children}</blockquote>,
    table: ({ children }) => <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-[14px]">{children}</table></div>,
    th: ({ children }) => <th className="border-b border-border py-2 pr-4 font-medium text-text">{children}</th>,
    td: ({ children }) => <td className="border-b border-border py-2 pr-4 text-text-2">{children}</td>,
    a: ({ href, children }) => {
      const marker = href?.match(/^#source-(\d+)$/);
      if (marker) {
        const n = Number(marker[1]);
        const source = sources.find((s) => s.n === n);
        return (
          <a
            href={`#${idPrefix}source-${n}`}
            title={source ? `${source.title ?? hostOf(source.url)} · ${hostOf(source.url)}` : undefined}
            className="ml-0.5 inline-flex h-[18px] min-w-[18px] -translate-y-[1px] items-center justify-center rounded-[4px] bg-surface-3 px-1 align-middle font-mono text-[10px] font-medium leading-none text-text-2 no-underline transition-colors duration-[var(--d-instant)] hover:bg-border-strong hover:text-text"
          >
            {n}
            <span className="sr-only"> (source {n}: {source?.title ?? source?.url})</span>
          </a>
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-text underline decoration-border-strong underline-offset-2 hover:decoration-text-3">
          {children}
        </a>
      );
    },
  };
}

/** The page as readers will see it: headings, lists and numbered source markers. */
export function PagePreview({ title, markdown, sources, idPrefix = "", className }: { title: string; markdown: string; sources: PageSource[]; idPrefix?: string; className?: string }) {
  return (
    <article className={cx("min-w-0", className)}>
      <h1 className="text-[26px] font-semibold leading-[34px] tracking-[-0.02em] text-text [text-wrap:balance] sm:text-[30px] sm:leading-[38px]">{title}</h1>
      <div className="mt-6">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents(sources, idPrefix)}>
          {linkSourceMarkers(markdown, sources.length)}
        </ReactMarkdown>
      </div>
    </article>
  );
}

/** Each fact the page states, and where it came from: the business's own confirmed facts, or a cited source. */
export function FactsRail({ facts, sources }: { facts: PageFact[]; sources: PageSource[] }) {
  if (!facts.length) return <p className="text-[13px] leading-5 text-text-3">No facts recorded for this page yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border">
      {facts.map((fact, i) => {
        const source = fact.url ? sources.find((s) => s.url === fact.url) : undefined;
        return (
          <li key={`${fact.text}-${i}`} className="py-3 first:pt-0 last:pb-0">
            <p className="text-[13px] leading-5 text-text">{fact.text}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-4 text-text-3">
              {fact.source === "business" ? (
                <>
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-you" />
                  <span>Your business facts</span>
                </>
              ) : fact.url ? (
                <>
                  <a href={fact.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-text-2 underline decoration-border-strong underline-offset-2 hover:text-text">
                    {hostOf(fact.url)}
                  </a>
                  {source && <span>· source {source.n} · retrieved {shortDate(source.retrievedAt)}</span>}
                </>
              ) : (
                <span>From a cited source</span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** The numbered sources, each with the passage Pentra relied on and when it was read. */
export function SourcesList({ sources, idPrefix = "" }: { sources: PageSource[]; idPrefix?: string }) {
  if (!sources.length) return <p className="text-[13px] leading-5 text-text-3">This page cites no outside sources.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {sources.map((source) => (
        <li key={source.n} id={`${idPrefix}source-${source.n}`} className="scroll-mt-24 rounded-control target:bg-you-tint target:ring-1 target:ring-you/40">
          <a href={source.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2.5 rounded-control p-1.5 transition-colors duration-[var(--d-instant)] hover:bg-surface-2">
            <span className="mt-px inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] bg-surface-3 px-1 font-mono text-[10px] font-medium text-text-2">{source.n}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[13px] leading-5 text-text">
                <SourceGlyph domain={hostOf(source.url)} />
                <span className="truncate">{source.title ?? hostOf(source.url)}</span>
                <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-4 group-hover:text-text-2" strokeWidth={1.5} />
              </span>
              <span className="mt-0.5 block text-[12px] leading-4 text-text-3">{hostOf(source.url)} · retrieved {shortDate(source.retrievedAt)}</span>
              {source.excerpt && sourceQuote(source.excerpt) && (
                <span className="mt-1.5 block min-w-0 border-l-2 border-border-strong pl-2.5 text-[12px] leading-[18px] text-text-2 [overflow-wrap:anywhere]">&ldquo;{sourceQuote(source.excerpt)}&rdquo;</span>
              )}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}
