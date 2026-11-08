"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, PencilLine, RotateCw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { AssistantMark } from "@/components/ui/assistant-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { FactsRail, PagePreview, SourcesList } from "@/components/answers/page-preview";
import { useEvidence } from "@/components/answers/evidence-sheet";
import { InlineError, LiveDot, Notice, Panel } from "@/components/answers/ui";
import { useAnswersActions, useAnswersQuery, useAppHref, useNow } from "@/lib/answers/backend";
import { displayUrl, indexingState, isAssistantId, pageStatus, plural, shortDate, shortStamp, timeAgo } from "@/lib/answers/format";
import type { AnswerPage, AnswersAccess } from "@/lib/answers/types";
import { userErrorMessage } from "@/lib/user-error";
import { PENTRA_PLAN, formatUsd } from "@/lib/pricing";

const MIN_TEXT = 200;

/**
 * One answer page: the preview with numbered source markers, the facts it states and where each came from, its
 * sources, where it published and what happened after, the citations it won, and its versions. Drafts can be edited
 * (the owner's words are kept exactly) and, on the plan, published.
 */
export function AnswerPageDetail({ pageId, access, destination, back }: {
  pageId: string;
  access: AnswersAccess;
  /** Where pages publish now, e.g. "kettlewood/kettlewooddecks.com on GitHub" (null: nowhere yet). */
  destination: string | null;
  back: { href: string; label: string };
}) {
  const page = useAnswersQuery("page", { pageId });
  const [editing, setEditing] = useState(false);
  const href = useAppHref();
  if (page === undefined) return <DetailSkeleton back={back} />;
  if (page === null) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink back={back} />
        <Notice actions={<ButtonLink href={href(back.href)} variant="secondary" size="sm">{back.label}</ButtonLink>}>
          This page isn&apos;t in your account any more.
        </Notice>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <BackLink back={back} />
      <PageHeaderRow page={page} access={access} editing={editing} onEdit={() => setEditing(true)} />
      <PageNotices page={page} access={access} destination={destination} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px] xl:gap-12">
        <div className="min-w-0">
          {editing ? (
            <EditDraft page={page} onDone={() => setEditing(false)} />
          ) : page.status === "writing" ? (
            <WritingPreview question={page.question} />
          ) : page.status === "not_written" ? (
            <p className="rounded-card border border-dashed border-border-strong px-5 py-10 text-center text-[14px] leading-[22px] text-text-3">
              No text was kept for this page.
            </p>
          ) : (
            <div className="rounded-card border border-border bg-surface-1 px-5 py-7 sm:px-10 sm:py-10">
              {page.metaDescription && (
                <p className="mono-label mb-4 text-text-3">
                  <span className="text-text-4">Search description · </span>{page.metaDescription}
                </p>
              )}
              <PagePreview title={page.title} markdown={page.markdown} sources={page.sources} idPrefix={`${page.pageId}-`} />
            </div>
          )}
        </div>
        <PageRail page={page} />
      </div>
    </div>
  );
}

function BackLink({ back }: { back: { href: string; label: string } }) {
  const href = useAppHref();
  return (
    <Link href={href(back.href)} className="inline-flex w-fit items-center gap-1.5 rounded-control text-[13px] font-medium text-text-3 transition-colors duration-[var(--d-instant)] hover:text-text">
      <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
      {back.label}
    </Link>
  );
}

function DetailSkeleton({ back }: { back: { href: string; label: string } }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading the page">
      <BackLink back={back} />
      <Skeleton className="h-6 w-2/3" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-card border border-border p-10">
          <Skeleton className="h-8 w-3/4" />
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className={i % 4 === 3 ? "mt-4 h-3 w-1/2" : "mt-4 h-3 w-full"} />)}
        </div>
        <div className="flex flex-col gap-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-32 w-full" /></div>
      </div>
    </div>
  );
}

function PageHeaderRow({ page, access, editing, onEdit }: { page: AnswerPage; access: AnswersAccess; editing: boolean; onEdit: () => void }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const href = useAppHref();
  const now = useNow(60_000);
  const openEvidence = useEvidence();
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = pageStatus(page.status);
  const editable = page.status === "draft" || page.status === "publish_failed";
  const canPublish = access !== "free";
  const publish = async () => {
    setPublishing(true);
    setError(null);
    try {
      await actions.publishDraft({ pageId: page.pageId });
      toast("Publishing. This page updates when it's live.", "info");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't start publishing this page. Try again."));
    } finally {
      setPublishing(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusPill kind={status.pill}>{access === "free" && page.status === "draft" ? "Draft · not published" : status.label}</StatusPill>
            <span className="mono-label text-text-3">
              v{page.version} · updated {timeAgo(page.updatedAt, now)}
              {page.status !== "writing" && page.status !== "not_written" && ` · ${plural(page.markdown.split(/\s+/).filter(Boolean).length, "word")}`}
            </span>
          </div>
          <p className="mono-caps mt-4 text-text-3">Answers the question</p>
          <p className="mt-1 text-[18px] font-medium leading-7 tracking-[-0.01em] text-text [text-wrap:balance]">{page.question}</p>
          <button type="button" onClick={() => openEvidence({ kind: "question", questionId: page.questionId })}
            className="mt-1.5 text-[13px] font-medium text-text-3 underline decoration-border-strong underline-offset-2 transition-colors hover:text-text">
            See every answer to this question
          </button>
        </div>
        {!editing && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {editable && (
              <Button variant="secondary" onClick={onEdit} icon={<PencilLine className="h-4 w-4" strokeWidth={1.5} />}>Edit</Button>
            )}
            {editable && canPublish && (
              <Button onClick={publish} loading={publishing} loadingLabel="Publishing…" icon={page.status === "publish_failed" ? <RotateCw className="h-4 w-4" strokeWidth={1.5} /> : undefined}>
                {page.status === "publish_failed" ? "Retry publish" : "Publish"}
              </Button>
            )}
            {editable && !canPublish && (
              <ButtonLink href={href("/upgrade")}>Publish with Pentra · {formatUsd(PENTRA_PLAN.monthly)}/mo</ButtonLink>
            )}
            {page.status === "published" && page.publishedUrl && (
              <a href={page.publishedUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex h-10 items-center gap-1.5 rounded-control border border-border-strong px-4 text-[14px] font-semibold text-text transition-colors duration-[var(--d-instant)] hover:bg-surface-2">
                View live page
                <ArrowUpRight aria-hidden="true" className="h-4 w-4" strokeWidth={1.5} />
              </a>
            )}
          </div>
        )}
      </div>
      {error && <InlineError title="Couldn't publish">{error}</InlineError>}
    </div>
  );
}

function PageNotices({ page, access, destination }: { page: AnswerPage; access: AnswersAccess; destination: string | null }) {
  const href = useAppHref();
  const notices: ReactNode[] = [];
  if (page.status === "publish_failed") {
    notices.push(
      <InlineError key="failed" title="This page didn't publish"
        actions={<ButtonLink href={href("/dashboard/settings#publishing")} variant="secondary" size="sm">Publishing settings</ButtonLink>}>
        {page.publishError ?? "The publisher didn't say why."} Fix it, then retry. The draft is safe.
      </InlineError>,
    );
  }
  if (page.status === "publishing") {
    notices.push(<Notice key="publishing" tone="you"><span className="inline-flex items-center gap-2"><LiveDot />Publishing{destination ? ` to ${destination}` : ""}. This page updates by itself.</span></Notice>);
  }
  if (page.status === "not_written") {
    notices.push(<Notice key="nw">{page.notWrittenReason ?? "This page didn't pass Pentra's checks."} Pentra never publishes a page with a number its source doesn&apos;t support.</Notice>);
  }
  if (page.status === "retired") {
    notices.push(<Notice key="retired">A newer version replaced this one{page.rewriteReason ? ` (${page.rewriteReason.toLowerCase()})` : ""}. It is kept here as a record.</Notice>);
  }
  if (page.status === "draft" && access === "free") {
    notices.push(
      <Notice key="free" actions={<ButtonLink href={href("/upgrade")} size="sm">Publish with Pentra</ButtonLink>}>
        Draft · not published. On the plan, Pentra publishes it {destination ? `to ${destination}` : "to your site or answers.yourdomain.com"} and keeps checking whether assistants cite it.
      </Notice>,
    );
  }
  if (page.status === "draft" && access !== "free" && !destination) {
    notices.push(
      <Notice key="dest" actions={<ButtonLink href={href("/dashboard/settings#publishing")} variant="secondary" size="sm">Choose where pages publish</ButtonLink>}>
        Pages have nowhere to publish yet. Connect your blog or use your answers address, then publish.
      </Notice>,
    );
  }
  for (const issue of page.issues.filter((i) => i !== "Edited by you")) notices.push(<Notice key={issue}>{issue}</Notice>);
  return notices.length ? <div className="flex flex-col gap-3">{notices}</div> : null;
}

function WritingPreview({ question }: { question: string }) {
  return (
    <div className="rounded-card border border-border bg-surface-1 px-5 py-7 sm:px-10 sm:py-10" aria-busy="true">
      <p className="flex items-center gap-2 text-[14px] leading-[22px] text-text-2"><LiveDot />Writing a page that answers &ldquo;{question}&rdquo;</p>
      <p className="mt-1 text-[13px] leading-5 text-text-3">From your business facts and the sources assistants cite for it. Every number is checked against its source.</p>
      <Skeleton className="mt-8 h-8 w-3/4" />
      {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className={i % 3 === 2 ? "mt-4 h-3 w-1/2" : "mt-4 h-3 w-full"} />)}
    </div>
  );
}

function PageRail({ page }: { page: AnswerPage }) {
  const openEvidence = useEvidence();
  const now = useNow(60_000);
  const indexing = indexingState(page, now);
  return (
    <aside className="flex min-w-0 flex-col gap-4" aria-label="About this page">
      {page.status === "published" && page.publishedUrl && (
        <Panel title="Live">
          <a href={page.publishedUrl} target="_blank" rel="noopener noreferrer" className="block break-all font-mono text-[12px] leading-[18px] text-text-2 underline decoration-border-strong underline-offset-2 hover:text-text">
            {displayUrl(page.publishedUrl)}
          </a>
          {page.publishedAt && <p className="mt-2 text-[12px] leading-4 text-text-3">Published {shortStamp(page.publishedAt)}</p>}
          {indexing && (
            <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
              <StatusPill kind={indexing.pill} className="w-fit">{indexing.label}</StatusPill>
              <p className="text-[12px] leading-[18px] text-text-3">{indexing.detail}</p>
            </div>
          )}
        </Panel>
      )}
      {(page.status === "published" || page.citations > 0) && (
        <Panel title={`Citations · ${page.citations}`} description={page.citations ? undefined : "No assistant has cited this page yet. Pages usually need to be found by search engines first."}>
          {page.citationList.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {page.citationList.map((c) => (
                <li key={c.checkId}>
                  <button type="button" onClick={() => openEvidence({ kind: "check", checkId: c.checkId })}
                    className="-mx-2 flex w-[calc(100%+16px)] items-center justify-between gap-3 rounded-control px-2 py-2 text-left transition-colors duration-[var(--d-instant)] hover:bg-surface-2">
                    {isAssistantId(c.assistant) ? <AssistantMark assistant={c.assistant} size="sm" showLabel labelClassName="text-[13px]" /> : <span className="text-[13px]">{c.assistant}</span>}
                    <span className="mono-label text-text-3">{shortDate(c.at)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      {page.facts.length > 0 && (
        <Panel title={`Facts used · ${page.facts.length}`}>
          <FactsRail facts={page.facts} sources={page.sources} />
        </Panel>
      )}
      {page.sources.length > 0 && (
        <Panel title={`Sources · ${page.sources.length}`}>
          <SourcesList sources={page.sources} idPrefix={`${page.pageId}-`} />
        </Panel>
      )}
      {page.history.length > 0 && (
        <Panel title="Versions">
          <ol className="flex flex-col gap-2.5 text-[13px] leading-5">
            <li className="text-text">v{page.version} · this version{page.rewriteReason ? ` · rewritten: ${page.rewriteReason.toLowerCase()}` : ""}</li>
            {page.history.map((h) => (
              <li key={h.pageId} className="text-text-3">
                v{h.version} · {pageStatus(h.status).label.toLowerCase()} · {shortDate(h.updatedAt)}{h.rewriteReason ? ` · ${h.rewriteReason.toLowerCase()}` : ""}
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </aside>
  );
}

function EditDraft({ page, onDone }: { page: AnswerPage; onDone: () => void }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const [title, setTitle] = useState(page.title);
  const [meta, setMeta] = useState(page.metaDescription);
  const [markdown, setMarkdown] = useState(page.markdown);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const titleError = touched && !title.trim() ? "Give the page a title." : undefined;
  const textError = touched && markdown.trim().length < MIN_TEXT ? `A page needs its text: at least ${MIN_TEXT} characters (now ${markdown.trim().length}).` : undefined;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!title.trim() || markdown.trim().length < MIN_TEXT) return;
    setSaving(true);
    setError(null);
    try {
      await actions.editDraft({ pageId: page.pageId, title, metaDescription: meta, markdown });
      toast("Saved. Your words are kept exactly as written.", "success");
      onDone();
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't save your edit. Try again."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={save} className="flex flex-col gap-4 rounded-card border border-border bg-surface-1 p-5 sm:p-6" noValidate>
      <p className="text-[13px] leading-5 text-text-3">
        Your edit is kept exactly as you write it and published as written. Keep the [1] markers next to the sentences their sources support.
      </p>
      <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={90} error={titleError} />
      <div className="flex flex-col gap-1.5">
        <Textarea label="Search description" value={meta} onChange={(e) => setMeta(e.target.value)} maxLength={170} rows={2} className="min-h-[64px]" />
        <p className="text-right text-[12px] tabular-nums text-text-4">{meta.length}/170</p>
      </div>
      <Textarea label="Page text (Markdown)" value={markdown} onChange={(e) => setMarkdown(e.target.value)} rows={18}
        className="min-h-[420px] font-mono text-[13px] leading-[22px]" error={textError} spellCheck />
      {error && <InlineError title="Not saved">{error}</InlineError>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving} loadingLabel="Saving…">Save draft</Button>
        <Button variant="ghost" onClick={onDone} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}
