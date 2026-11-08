"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ChipScroller, Notice, PanelSkeleton, ScreenHeader } from "@/components/answers/ui";
import { CitationCard } from "@/components/answers/dashboard/overview";
import { useAnswersQuery, useAppHref } from "@/lib/answers/backend";
import { citationsMeta } from "@/lib/answers/derive";
import { assistantLabel, plural, utcStamp } from "@/lib/answers/format";
import type { Overview } from "@/lib/answers/types";
import { ASSISTANTS } from "@/lib/product-facts";
import { cx } from "@/lib/cx";

export function AnswersCitations({ siteId }: { siteId: string }) {
  const overview = useAnswersQuery("overview", { siteId });
  if (overview === undefined) return <><ScreenHeader title="Citations" /><PanelSkeleton lines={8} /></>;
  if (overview === null) return <Notice>This site&apos;s citations aren&apos;t available.</Notice>;
  return <CitationsBody overview={overview} />;
}

const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

/** The proof wall: every answer that cited one of the business's pages, newest first, each in full. */
function CitationsBody({ overview }: { overview: Overview }) {
  const href = useAppHref();
  const [assistant, setAssistant] = useState("all");
  const [pageId, setPageId] = useState("all");
  const titles = useMemo(() => new Map(overview.pages.map((p) => [p.pageId, p.title])), [overview.pages]);
  const cited = overview.citations;
  const rows = cited.filter((c) => (assistant === "all" || c.assistant === assistant) && (pageId === "all" || c.pageId === pageId));
  const pagesCited = [...new Set(cited.map((c) => c.pageId).filter((id): id is string => Boolean(id)))];
  const live = overview.pages.filter((p) => p.status === "published").length;

  const exportCsv = () => {
    const lines = [["Recorded (UTC)", "Assistant", "Page", "URL", "First citation of the page"].map(csvCell).join(",")];
    for (const c of rows) lines.push([utcStamp(c.at), assistantLabel(c.assistant), c.pageId ? titles.get(c.pageId) ?? "" : "", c.url, c.first ? "yes" : "no"].map(csvCell).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pentra-citations-${overview.site.domain}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!cited.length) {
    return (
      <>
        <ScreenHeader title="Citations" meta={`${live} ${live === 1 ? "page" : "pages"} live`} />
        <div className="rounded-card border border-dashed border-border-strong px-6 py-14 text-center">
          <p className="text-[15px] font-medium text-text">No citations yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-[22px] text-text-3">
            {live > 0
              ? `Pages usually need to be found by search engines first; ${plural(live, "page")} ${live === 1 ? "is" : "are"} live so far. Every citation Pentra records appears here with the exact answer.`
              : "Citations you win will appear here, each with the exact answer. They come from published pages."}
          </p>
          <div className="mt-5 flex justify-center">
            <ButtonLink href={href(overview.access === "free" ? "/dashboard/billing" : "/dashboard/pages")} variant="secondary" size="sm">
              {overview.access === "free" ? "Publish with Pentra" : "See your pages"}
            </ButtonLink>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Citations"
        meta={citationsMeta(cited)}
        actions={<Button variant="secondary" size="sm" onClick={exportCsv} icon={<Download className="h-3.5 w-3.5" strokeWidth={1.5} />}>Export CSV</Button>} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <ChipScroller label="Assistant">
          {[{ id: "all", label: "All" }, ...ASSISTANTS.map((a) => ({ id: a.id as string, label: a.short }))].map((chip) => {
            const count = cited.filter((c) => (chip.id === "all" || c.assistant === chip.id) && (pageId === "all" || c.pageId === pageId)).length;
            if (chip.id !== "all" && count === 0) return null;
            return (
              <button key={chip.id} type="button" role="radio" aria-checked={assistant === chip.id} onClick={() => setAssistant(chip.id)}
                className={cx("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-[var(--d-instant)]",
                  assistant === chip.id ? "border-border-strong bg-surface-3 text-text" : "border-border text-text-3 hover:bg-surface-2 hover:text-text")}>
                {chip.label}<span className="tabular-nums text-text-4">{count}</span>
              </button>
            );
          })}
        </ChipScroller>
        <div>
          <label htmlFor="citation-page" className="sr-only">Page</label>
          <select id="citation-page" value={pageId} onChange={(e) => setPageId(e.target.value)}
            className="select-field h-8 w-full max-w-[320px] rounded-control border border-border bg-surface-1 px-2 text-[13px] text-text outline-none hover:border-border-strong focus:border-[var(--border-focus)]">
            <option value="all">All pages</option>
            {pagesCited.map((id) => <option key={id} value={id}>{titles.get(id) ?? id}</option>)}
          </select>
        </div>
      </div>
      {rows.length ? (
        <ol className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {rows.map((c) => (
            <li key={c.citationId}>
              <CitationCard citation={c} pageTitle={c.pageId ? titles.get(c.pageId) ?? null : null} business={{ name: overview.site.name, domain: overview.site.domain }} variant="default" />
            </li>
          ))}
        </ol>
      ) : (
        <p className="rounded-card border border-dashed border-border-strong px-5 py-10 text-center text-[14px] text-text-3">No citations match these filters.</p>
      )}
    </>
  );
}
