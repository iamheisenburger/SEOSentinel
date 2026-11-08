"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Pause, Play, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useEvidence } from "@/components/answers/evidence-sheet";
import { InlineError, Notice, PanelSkeleton, ScreenHeader } from "@/components/answers/ui";
import { useAnswersActions, useAnswersQuery, useAppHref, useNow } from "@/lib/answers/backend";
import { questionMatches, topCompetitor, WEEK_MS, type QuestionFilter } from "@/lib/answers/derive";
import { intentLabel, plural, shortDate } from "@/lib/answers/format";
import type { Overview, OverviewQuestion } from "@/lib/answers/types";
import { ASSISTANTS } from "@/lib/product-facts";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

const MAX_ACTIVE = 40;

const FILTERS: { id: QuestionFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "winnable", label: "Winnable" },
  { id: "not_named", label: "Not named" },
  { id: "named", label: "Named you" },
  { id: "covered", label: "Covered" },
  { id: "monitoring", label: "Monitoring" },
  { id: "new", label: "New this week" },
  { id: "paused", label: "Paused" },
];

const OPPORTUNITY: Record<string, { label: string; pill: "named" | "you" | "none" }> = {
  winnable: { label: "Winnable", pill: "you" },
  covered: { label: "Covered", pill: "named" },
  monitoring: { label: "Monitoring", pill: "none" },
};

export function AnswersQuestions({ siteId }: { siteId: string }) {
  const overview = useAnswersQuery("overview", { siteId });
  if (overview === undefined) {
    return <><ScreenHeader title="Questions" /><PanelSkeleton lines={10} /></>;
  }
  if (overview === null) return <Notice>This site&apos;s questions aren&apos;t available.</Notice>;
  return <QuestionsBody overview={overview} />;
}

function QuestionsBody({ overview }: { overview: Overview }) {
  const now = useNow(60_000);
  const [filter, setFilter] = useState<QuestionFilter>("all");
  const [query, setQuery] = useState("");
  const active = overview.questions.filter((q) => q.status === "active").length;
  const latestAt = overview.questions.reduce((max, q) => Math.max(max, q.latest?.at ?? 0), 0);
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    return overview.questions
      .filter((q) => questionMatches(q, filter, now) && (!text || q.question.toLowerCase().includes(text)))
      .sort((a, b) => Number(a.status === "paused") - Number(b.status === "paused") || (b.opportunity?.score ?? -1) - (a.opportunity?.score ?? -1) || b.createdAt - a.createdAt);
  }, [overview.questions, filter, query, now]);

  return (
    <>
      <ScreenHeader title="Questions" meta={`${active} of ${MAX_ACTIVE} tracked${latestAt ? ` · latest run ${shortDate(latestAt)}` : ""}`} />
      <AddQuestion siteId={overview.site.siteId} full={active >= MAX_ACTIVE} />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div role="radiogroup" aria-label="Filter questions" className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {FILTERS.map((f) => {
              const count = overview.questions.filter((q) => questionMatches(q, f.id, now)).length;
              if (f.id !== "all" && count === 0 && filter !== f.id) return null;
              return (
                <button key={f.id} type="button" role="radio" aria-checked={filter === f.id} onClick={() => setFilter(f.id)}
                  className={cx("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-[var(--d-instant)]",
                    filter === f.id ? "border-border-strong bg-surface-3 text-text" : "border-border text-text-3 hover:bg-surface-2 hover:text-text")}>
                  {f.label}<span className="tabular-nums text-text-4">{count}</span>
                </button>
              );
            })}
          </div>
          <div className="relative lg:w-64">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-4" strokeWidth={1.5} />
            <label htmlFor="question-search" className="sr-only">Search questions</label>
            <input id="question-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search questions"
              className="h-8 w-full rounded-control border border-border bg-surface-1 pl-8 pr-2 text-[13px] text-text placeholder:text-text-4 outline-none hover:border-border-strong focus:border-[var(--border-focus)]" />
          </div>
        </div>
        <QuestionTable rows={rows} now={now}
          empty={overview.questions.length === 0 ? "No questions yet. They're written in the first hour, from what your site sells." : "No questions match this filter and search."}
          onClear={overview.questions.length && (filter !== "all" || query) ? () => { setFilter("all"); setQuery(""); } : undefined} />
      </div>
    </>
  );
}

function AddQuestion({ siteId, full }: { siteId: string; full: boolean }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value.trim().length < 8) { setError("Write a full question your buyers would ask."); return; }
    setBusy(true);
    setError(null);
    try {
      await actions.addQuestion({ siteId, question: value });
      setValue("");
      toast("Added. Pentra asks it in the next run.", "success");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't add this question. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="add-question" className="sr-only">A question your buyers ask</label>
        <input id="add-question" value={value} onChange={(e) => { setValue(e.target.value); setError(null); }} disabled={full}
          placeholder={full ? `You're tracking ${MAX_ACTIVE} questions, the most at once. Pause one to add another.` : "Add a question your buyers ask, without your business's name"}
          aria-invalid={error ? true : undefined} aria-describedby={error ? "add-question-error" : undefined}
          className="h-10 min-w-0 flex-1 rounded-control border border-border bg-surface-1 px-3 text-[14px] text-text placeholder:text-text-4 outline-none transition-[border-color,box-shadow] duration-[var(--d-instant)] hover:border-border-strong focus:border-[var(--border-focus)] focus:shadow-[0_0_0_3px_var(--you-tint)] aria-[invalid=true]:border-wrong disabled:opacity-50" />
        <Button type="submit" variant="secondary" loading={busy} loadingLabel="Adding…" disabled={full} icon={<Plus className="h-4 w-4" strokeWidth={1.5} />}>Add question</Button>
      </div>
      {error && <p id="add-question-error" role="alert" className="text-[13px] leading-5 text-wrong">{error}</p>}
    </form>
  );
}

function Dots({ named }: { named: string[] }) {
  const label = named.length ? `Named by ${named.map((id) => ASSISTANTS.find((a) => a.id === id)?.name ?? id).join(", ")}` : "No assistant named you";
  return (
    <span role="img" aria-label={`${label} (${named.length} of ${ASSISTANTS.length} assistants)`} className="inline-flex items-center gap-1" title={label}>
      {ASSISTANTS.map((a) => (
        <span key={a.id} className={cx("h-2 w-2 rounded-full", named.includes(a.id) ? "bg-you" : "border border-border-strong")} />
      ))}
    </span>
  );
}

function QuestionActions({ q }: { q: OverviewQuestion }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const set = async (status: "active" | "paused" | "removed") => {
    setError(null);
    try {
      await actions.setQuestionStatus({ questionId: q.questionId, status });
      if (status === "removed") {
        toast("Question removed. Its answers are kept.", "info", { action: { label: "Undo", onClick: () => { void actions.setQuestionStatus({ questionId: q.questionId, status: "active" }); } } });
      } else toast(status === "paused" ? "Paused. Pentra stops asking it until you resume." : "Resumed. Pentra asks it in the next run.", "success");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't change this question."));
      toast(userErrorMessage(e, "Pentra couldn't change this question."), "error");
    }
  };
  const paused = q.status === "paused";
  return (
    <span className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()} data-error={error ?? undefined}>
      <Tooltip content={paused ? "Resume asking" : "Pause asking"}>
        <button type="button" onClick={() => set(paused ? "active" : "paused")} aria-label={paused ? `Resume “${q.question}”` : `Pause “${q.question}”`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-control text-text-3 transition-colors duration-[var(--d-instant)] hover:bg-surface-3 hover:text-text">
          {paused ? <Play className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Pause className="h-3.5 w-3.5" strokeWidth={1.5} />}
        </button>
      </Tooltip>
      <Tooltip content="Remove">
        <button type="button" onClick={() => set("removed")} aria-label={`Remove “${q.question}”`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-control text-text-3 transition-colors duration-[var(--d-instant)] hover:bg-surface-3 hover:text-wrong">
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </Tooltip>
    </span>
  );
}

function QuestionTable({ rows, now, empty, onClear }: { rows: OverviewQuestion[]; now: number; empty: string; onClear?: () => void }) {
  const open = useEvidence();
  const href = useAppHref();
  if (!rows.length) {
    return (
      <div className="rounded-card border border-dashed border-border-strong px-5 py-10 text-center">
        <p className="text-[14px] text-text-3">{empty}</p>
        {onClear && <Button variant="secondary" size="sm" className="mt-4" onClick={onClear}>Clear filter and search</Button>}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-card border border-border">
      <div className="sticky top-14 z-10 hidden grid-cols-[minmax(0,1fr)_96px_minmax(0,170px)_minmax(0,150px)_112px_68px] gap-4 border-b border-border bg-surface-1 px-4 py-2.5 lg:top-0 md:grid">
        {["Question", "Named by", "Top competitor", "Your page", "Status", ""].map((h, i) => <span key={i} className="mono-caps text-text-3">{h}</span>)}
      </div>
      <ul className="divide-y divide-border">
        {rows.map((q) => {
          const rival = topCompetitor(q);
          const opp = q.opportunity ? OPPORTUNITY[q.opportunity.status] : null;
          const isNew = now - q.createdAt < WEEK_MS;
          return (
            <li key={q.questionId} onClick={() => open({ kind: "question", questionId: q.questionId })}
              className={cx("grid cursor-pointer grid-cols-1 gap-2 px-4 py-3 transition-colors duration-[var(--d-instant)] hover:bg-surface-2 md:min-h-11 md:grid-cols-[minmax(0,1fr)_96px_minmax(0,170px)_minmax(0,150px)_112px_68px] md:items-center md:gap-4 md:py-2",
                q.status === "paused" && "opacity-60")}>
              <span className="min-w-0">
                <button type="button" onClick={(e) => { e.stopPropagation(); open({ kind: "question", questionId: q.questionId }); }}
                  className="block w-full truncate text-left text-[14px] text-text" title={q.question}>
                  {q.question}
                </button>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-text-4">
                  {intentLabel(q.intent)}
                  {q.source === "owner" && <span>· added by you</span>}
                  {isNew && <span className="font-medium text-text-2">· New this week</span>}
                  {q.latest && <span className="md:hidden">· named in {q.latest.named} of {q.latest.answered}</span>}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {q.latest ? <><Dots named={q.latest.assistantsNamed} /><span className="text-[12px] tabular-nums text-text-3">{q.latest.named}/{q.latest.answered}</span></> : <span className="text-[12px] text-text-4">Not asked yet</span>}
              </span>
              <span className="min-w-0 truncate text-[13px] text-text-2">
                {rival ? <>{rival.name} <span className="tabular-nums text-text-4">· {rival.answers}</span></> : <span className="text-text-4">None named</span>}
              </span>
              <span className="min-w-0 truncate text-[13px]">
                {q.pageId ? (
                  <Link href={href(`/dashboard/pages/${q.pageId}`)} onClick={(e) => e.stopPropagation()} className="text-text-2 underline decoration-border-strong underline-offset-2 hover:text-text">Open page</Link>
                ) : <span className="text-text-4">None yet</span>}
              </span>
              <span>
                {q.status === "paused" ? <StatusPill kind="neutral">Paused</StatusPill> : opp ? <StatusPill kind={opp.pill}>{opp.label}</StatusPill> : <span className="text-[12px] text-text-4">Asked next run</span>}
              </span>
              <QuestionActions q={q} />
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-[12px] text-text-3">{plural(rows.length, "question")} · a row opens every answer to it</p>
    </div>
  );
}

export function QuestionsError({ message }: { message: string }) {
  return <InlineError title="Couldn't load the questions">{message}</InlineError>;
}
