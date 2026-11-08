"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { AnswerPageDetail } from "@/components/answers/page-detail";
import { AnswerLog, AssistantPanel, CountHeadline, RivalsPanel, WinnableQuestions, useRunLog } from "@/components/answers/snapshot";
import { LiveDot, Notice, Panel } from "@/components/answers/ui";
import { useAnswersQuery, useAppHref } from "@/lib/answers/backend";
import { winnable } from "@/lib/answers/derive";
import { countryName, pageStatus, plural, shortStamp } from "@/lib/answers/format";
import type { SetupPage, SetupState } from "@/lib/answers/types";
import { PENTRA_PLAN, formatUsd } from "@/lib/pricing";
import { cx } from "@/lib/cx";

/**
 * The snapshot, then the five drafts: the count sentence, each assistant, who's named instead, the questions the
 * business can win now, and every answer. Free accounts see the drafts as "Draft · not published" and a quiet bar
 * offering the plan; Pentra's own sites and paying accounts go straight to the dashboard.
 */
export function SnapshotResults({ state, view, pageId }: { state: SetupState; view: "snapshot" | "drafts"; pageId: string | null }) {
  const run = state.run!;
  const overview = useAnswersQuery("overview", { siteId: state.siteId });
  const log = useRunLog(run.runId);
  const router = useRouter();
  const href = useAppHref();
  const name = state.name ?? state.domain;
  const base = `/start?site=${encodeURIComponent(state.siteId)}`;
  const free = state.access === "free";
  const drafts = state.pages.filter((p) => p.status === "draft" || p.status === "writing" || p.status === "publish_failed");

  if (pageId) {
    return (
      <div className={cx("mx-auto max-w-[1180px] px-[var(--gutter)] py-10 sm:py-12", free && "pb-32")}>
        <AnswerPageDetail pageId={pageId} access={state.access} destination={null} back={{ href: `${base}&view=drafts`, label: "All draft pages" }} />
        {free && <UpgradeBar count={drafts.length} />}
      </div>
    );
  }

  return (
    <section aria-labelledby="results-title" className={cx("mx-auto max-w-[1080px] px-[var(--gutter)] py-12 sm:py-16", free && "pb-36")}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-text-3">Free snapshot · step 5 of 5</p>
          <h1 id="results-title" className="type-h1 mt-3 text-text [overflow-wrap:anywhere]">What AI assistants say about {name}</h1>
          <p className="mono-label mt-3 text-text-3">
            Asked {shortStamp(run.createdAt)} · from {countryName(run.country)} · fresh sessions with web search
          </p>
        </div>
        {!free && <ButtonLink href={href("/dashboard")} iconRight={<ArrowRight className="h-4 w-4" strokeWidth={1.5} />}>Open the dashboard</ButtonLink>}
      </div>

      <Tabs
        className="mt-8"
        label="Snapshot sections"
        idPrefix="snapshot"
        active={view}
        onChange={(id) => router.replace(href(id === "drafts" ? `${base}&view=drafts` : base), { scroll: false })}
        tabs={[{ id: "snapshot", label: "Snapshot" }, { id: "drafts", label: "Draft pages", count: state.pages.length }]}
      />

      <div id={`snapshot-panel-${view}`} role="tabpanel" aria-labelledby={`snapshot-tab-${view}`} className="mt-8">
        {view === "snapshot" ? (
          <div className="flex flex-col gap-6">
            <CountHeadline run={run} businessName={name} />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <AssistantPanel run={run} log={log} />
              <RivalsPanel run={run} businessName={name} />
            </div>
            <Panel title="Questions you can win now" description="Where no answer names you yet and the sources assistants use are thin or small. Each opens its answers.">
              {overview === undefined ? <Skeleton className="h-24 w-full" /> : <WinnableQuestions questions={overview ? winnable(overview.questions) : []} />}
            </Panel>
            <Panel title="Every answer" description={`All ${plural(run.done, "answer")} from this run, exactly as recorded.`}>
              <AnswerLog runId={run.runId} log={log} />
            </Panel>
          </div>
        ) : (
          <DraftList pages={state.pages} base={base} free={free} />
        )}
      </div>
      {free && <UpgradeBar count={drafts.length} />}
    </section>
  );
}

function DraftList({ pages, base, free }: { pages: SetupPage[]; base: string; free: boolean }) {
  const href = useAppHref();
  if (!pages.length) {
    return (
      <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
        <p className="flex items-center justify-center gap-2 text-[14px] font-medium text-text"><LiveDot />Writing your first pages</p>
        <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-[22px] text-text-3">Pentra writes pages for the questions you can win now, from your facts and the sources assistants cite. They appear here as they&apos;re written.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] leading-[22px] text-text-2">
        {free ? "Drafts · not published. Read them, edit them, and publish them on the plan." : "Your first pages. Publish them from the dashboard once a destination is connected."}
      </p>
      <ul className="overflow-hidden rounded-card border border-border">
        {pages.map((page) => {
          const status = pageStatus(page.status);
          const open = page.status !== "writing";
          const content = (
            <>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill kind={status.pill}>{page.status === "writing" ? "Writing" : free && page.status === "draft" ? "Draft · not published" : status.label}</StatusPill>
                </div>
                <p className="mt-2 text-[15px] font-medium leading-[22px] text-text">{page.status === "writing" ? page.question : page.title}</p>
                {page.status !== "writing" && page.title !== page.question && <p className="mt-0.5 truncate text-[13px] leading-5 text-text-3">Answers: {page.question}</p>}
              </div>
              <div className="flex items-center gap-4 sm:justify-end">
                {page.status === "writing" ? (
                  <span className="mono-label text-text-3">Writing…</span>
                ) : page.status === "not_written" ? (
                  <span className="text-[13px] text-text-3">Not kept · retried next run</span>
                ) : (
                  <span className="mono-label text-text-3">{plural(page.words, "word")} · {plural(page.sources, "source")} · {plural(page.facts, "fact")}</span>
                )}
                {open && <ChevronRight aria-hidden="true" className="h-4 w-4 text-text-4" strokeWidth={1.5} />}
              </div>
            </>
          );
          const row = "grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6";
          return (
            <li key={page.pageId} className="border-b border-border last:border-b-0">
              {open ? (
                <Link href={href(`${base}&page=${encodeURIComponent(page.pageId)}`)} className={cx(row, "transition-colors duration-[var(--d-instant)] hover:bg-surface-2")}>{content}</Link>
              ) : (
                <div className={row} aria-busy="true">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const DISMISS_KEY = "pentra_upgrade_bar_dismissed";
const noSubscribe = () => () => {};
const readDismissed = () => { try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } };

/** A quiet bar on the snapshot and drafts: what the plan does next, its price, and one button. */
export function UpgradeBar({ count }: { count: number }) {
  const href = useAppHref();
  const stored = useSyncExternalStore(noSubscribe, readDismissed, () => false);
  const [dismissed, setDismissed] = useState(false);
  if (stored || dismissed) return null;
  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* Optional. */ }
  };
  const pages = count > 0 ? `these ${count === 1 ? "page" : `${count} pages`}` : "your answer pages";
  return (
    <div role="region" aria-label="Upgrade" className="fixed inset-x-0 bottom-0 z-40 border-t border-border-strong bg-[rgba(15,16,17,0.92)] backdrop-blur-[20px]">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-3 px-[var(--gutter)] py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px] leading-[22px] text-text">
          Publish {pages} and keep tracking.{" "}
          <span className="text-text-2">{formatUsd(PENTRA_PLAN.monthly)}/mo, cancel anytime.</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={dismiss} className="h-10 rounded-control px-3 text-[14px] font-medium text-text-3 transition-colors duration-[var(--d-instant)] hover:bg-surface-2 hover:text-text">
            Keep my free snapshot
          </button>
          <ButtonLink href={href("/upgrade")}>Publish with Pentra</ButtonLink>
        </div>
      </div>
    </div>
  );
}

export function ResultsNotice({ children }: { children: React.ReactNode }) {
  return <Notice>{children}</Notice>;
}
