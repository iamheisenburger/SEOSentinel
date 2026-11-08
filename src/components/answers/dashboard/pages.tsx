"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ChevronRight, RotateCw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Tabs, useTabParam } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { AnswerPageDetail } from "@/components/answers/page-detail";
import { Notice, PanelSkeleton, ScreenHeader } from "@/components/answers/ui";
import { useDestination } from "@/components/answers/dashboard/destination";
import { useAnswersActions, useAnswersQuery, useAppHref, useNow } from "@/lib/answers/backend";
import { displayUrl, indexingState, pageStatus, plural, timeAgo } from "@/lib/answers/format";
import type { Overview, OverviewPage } from "@/lib/answers/types";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

const TABS = ["published", "drafts", "not-written"] as const;
type PagesTab = (typeof TABS)[number];

const IN_TAB: Record<PagesTab, (p: OverviewPage) => boolean> = {
  published: (p) => p.status === "published",
  drafts: (p) => ["draft", "writing", "publishing", "publish_failed"].includes(p.status),
  "not-written": (p) => p.status === "not_written",
};

export function AnswersPages({ siteId }: { siteId: string }) {
  const overview = useAnswersQuery("overview", { siteId });
  if (overview === undefined) return <><ScreenHeader title="Answer pages" /><PanelSkeleton lines={8} /></>;
  if (overview === null) return <Notice>This site&apos;s pages aren&apos;t available.</Notice>;
  return <PagesBody overview={overview} />;
}

function PagesBody({ overview }: { overview: Overview }) {
  const fallback: PagesTab = overview.pages.some(IN_TAB.published) ? "published" : "drafts";
  const [tab, setTab] = useTabParam<PagesTab>("tab", TABS, fallback);
  const count = (t: PagesTab) => overview.pages.filter(IN_TAB[t]).length;
  const rows = overview.pages.filter(IN_TAB[tab]).sort((a, b) => (b.publishedAt ?? b.updatedAt) - (a.publishedAt ?? a.updatedAt));
  const published = count("published");
  const citations = overview.pages.reduce((sum, p) => sum + p.citations, 0);
  const destination = useDestination(overview.site.siteId, overview.access === "free" ? undefined : overview.site.publishing);
  const href = useAppHref();
  return (
    <>
      <ScreenHeader title="Answer pages"
        meta={`${published} published · ${count("drafts")} in drafts · ${plural(citations, "citation")} won`} />
      {overview.access !== "free" && destination.kind === "none" && count("drafts") > 0 && (
        <Notice tone="you" actions={<ButtonLink href={href("/dashboard/settings#publishing")} size="sm">Choose where pages publish</ButtonLink>}>
          Pages have nowhere to publish yet. Connect your blog, or use answers.{overview.site.domain}.
        </Notice>
      )}
      {overview.access === "free" && count("drafts") > 0 && (
        <Notice actions={<ButtonLink href={href("/dashboard/billing")} size="sm">Publish with Pentra</ButtonLink>}>
          Drafts · not published. On the plan, Pentra publishes them and keeps checking whether assistants cite them.
        </Notice>
      )}
      <div>
        <Tabs label="Answer pages" idPrefix="pages" active={tab} onChange={(id) => setTab(id as PagesTab)}
          tabs={[{ id: "published", label: "Published", count: published }, { id: "drafts", label: "Drafts", count: count("drafts") }, { id: "not-written", label: "Not written", count: count("not-written") }]} />
        <div id={`pages-panel-${tab}`} role="tabpanel" aria-labelledby={`pages-tab-${tab}`} className="mt-5">
          {rows.length ? (
            <ul className="overflow-hidden rounded-card border border-border">
              {rows.map((p) => <PageRow key={p.pageId} page={p} access={overview.access} tab={tab} />)}
            </ul>
          ) : (
            <EmptyTab tab={tab} overview={overview} />
          )}
        </div>
      </div>
    </>
  );
}

function PageRow({ page, access, tab }: { page: OverviewPage; access: Overview["access"]; tab: PagesTab }) {
  const href = useAppHref();
  const now = useNow(60_000);
  const actions = useAnswersActions();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = pageStatus(page.status);
  const indexing = indexingState(page, now);
  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.publishDraft({ pageId: page.pageId });
      toast("Publishing. The row updates when it's live.", "info");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't start publishing this page."));
    } finally {
      setBusy(false);
    }
  };
  const editable = page.status === "draft" || page.status === "publish_failed";
  return (
    <li className="border-b border-border last:border-b-0">
      <div className="grid grid-cols-1 gap-3 px-4 py-3.5 transition-colors duration-[var(--d-instant)] hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-6">
        <Link href={href(`/dashboard/pages/${page.pageId}`)} className="group min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            {tab !== "published" && <StatusPill kind={status.pill}>{access === "free" && page.status === "draft" ? "Draft · not published" : status.label}</StatusPill>}
            {tab === "published" && indexing && <StatusPill kind={indexing.pill}>{indexing.label}</StatusPill>}
            <span className="mono-label text-text-4">updated {timeAgo(page.updatedAt, now)}</span>
          </span>
          <span className="mt-1.5 flex items-center gap-1.5 text-[15px] font-medium leading-[22px] text-text">
            <span className="min-w-0 truncate">{page.status === "writing" || page.status === "not_written" ? page.question : page.title}</span>
            <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-text-4 transition-colors group-hover:text-text-2" strokeWidth={1.5} />
          </span>
          {page.status !== "writing" && page.status !== "not_written" && page.title !== page.question && (
            <span className="mt-0.5 block truncate text-[13px] leading-5 text-text-3">Answers: {page.question}</span>
          )}
          {page.status === "not_written" && <span className="mt-0.5 block text-[13px] leading-5 text-text-3">{page.issues[0] ?? "Open it for the reason."} Pentra writes it again next run.</span>}
        </Link>
        <div className="flex flex-wrap items-center gap-3 md:justify-end">
          {tab === "published" && page.publishedUrl && (
            <a href={page.publishedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[260px] items-center gap-1 truncate font-mono text-[12px] text-text-3 hover:text-text">
              <span className="truncate">{displayUrl(page.publishedUrl)}</span><ArrowUpRight aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            </a>
          )}
          {tab === "published" && (
            <Link href={href(`/dashboard/pages/${page.pageId}`)} className="rounded-[3px] text-[13px] tabular-nums text-text-2 underline decoration-dotted decoration-text-4 underline-offset-[5px] hover:text-text"
              aria-label={`${page.citations} citations for ${page.title}. Open the page.`}>
              {plural(page.citations, "citation")}
            </Link>
          )}
          {tab === "drafts" && page.status !== "writing" && page.status !== "publishing" && (
            <span className="mono-label text-text-3">{plural(page.words, "word")} · {plural(page.sources, "source")} · {plural(page.facts, "fact")}</span>
          )}
          {editable && access !== "free" && (
            <Button size="sm" variant="secondary" onClick={publish} loading={busy} loadingLabel="Publishing…"
              icon={page.status === "publish_failed" ? <RotateCw className="h-3.5 w-3.5" strokeWidth={1.5} /> : undefined}>
              {page.status === "publish_failed" ? "Retry publish" : "Publish"}
            </Button>
          )}
        </div>
      </div>
      {(page.status === "publish_failed" || error) && (
        <p role="alert" className={cx("mx-4 mb-3.5 rounded-control border border-wrong/30 bg-wrong-tint px-3 py-2 text-[13px] leading-5 text-text")}>
          {error ?? page.publishError ?? "The publisher didn't say why."}
        </p>
      )}
    </li>
  );
}

function EmptyTab({ tab, overview }: { tab: PagesTab; overview: Overview }) {
  const href = useAppHref();
  const text = {
    published: overview.access === "free"
      ? { title: "Published pages will appear here", body: "Publishing is part of the plan; your drafts are ready for it." }
      : { title: "Nothing published yet", body: "Pages publish from Drafts, or automatically when Autopublish is on in Settings." },
    drafts: { title: "No drafts right now", body: "Pentra writes pages for the questions you can win after each run." },
    "not-written": { title: "Every page was written", body: "Pages that fail Pentra's checks (a number its source doesn't support, for example) are listed here, never published." },
  }[tab];
  return (
    <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
      <p className="text-[14px] font-medium text-text">{text.title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-[22px] text-text-3">{text.body}</p>
      {tab === "published" && overview.access === "free" && <div className="mt-5 flex justify-center"><ButtonLink href={href("/dashboard/billing")} size="sm">Publish with Pentra</ButtonLink></div>}
    </div>
  );
}

/** One page, inside the dashboard. */
export function AnswersPageScreen({ siteId, pageId }: { siteId: string; pageId: string }) {
  const overview = useAnswersQuery("overview", { siteId });
  const destination = useDestination(siteId, overview ? overview.site.publishing : undefined);
  if (overview === undefined) return <PanelSkeleton lines={12} />;
  if (overview === null) return <Notice>This page isn&apos;t available.</Notice>;
  const label = destination.kind === "site" || destination.kind === "hosted" ? destination.label : null;
  const liveAt = overview.pages.find((p) => p.pageId === pageId)?.liveAt;
  return <AnswerPageDetail pageId={pageId} access={overview.access} destination={label} liveAt={liveAt} back={{ href: "/dashboard/pages", label: "Answer pages" }} />;
}
