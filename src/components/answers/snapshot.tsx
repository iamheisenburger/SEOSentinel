"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { AssistantMark } from "@/components/ui/assistant-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AssistantBars, RivalBars } from "@/components/answers/charts";
import { useEvidence, type RunOutcome } from "@/components/answers/evidence-sheet";
import { ChipScroller, CountButton, Panel } from "@/components/answers/ui";
import { useAnswersQuery } from "@/lib/answers/backend";
import { checkOutcomes } from "@/lib/answers/evidence";
import { assistantRows, rivalsRanked } from "@/lib/answers/derive";
import { assistantLabel, intentLabel, isAssistantId, listSentence, num, plural, shortStamp } from "@/lib/answers/format";
import type { Check, OverviewQuestion, Run } from "@/lib/answers/types";
import { ASSISTANTS } from "@/lib/product-facts";
import { cx } from "@/lib/cx";

/* ─── The count sentence ───────────────────────────────────────────────── */

/**
 * "Named in 3 of 143 answers. Cedar Row Builders: 41." Every number opens the answers behind it; answers with no AI
 * Overview and failed answers are said beside the count, never inside it.
 */
export function CountHeadline({ run, businessName, size = "lg" }: { run: Run; businessName: string; size?: "lg" | "md" }) {
  const open = useEvidence();
  const rivals = [...(run.competitors ?? [])].filter((c) => c.named > 0).sort((a, b) => b.named - a.named).slice(0, 3);
  const openRun = (title: string, outcome?: RunOutcome, competitor?: string) => open({ kind: "run", runId: run.runId, title, outcome, competitor });
  return (
    <div className="flex flex-col gap-2">
      <p className={cx("font-semibold tracking-[-0.02em] text-text [text-wrap:balance]", size === "lg" ? "text-[28px] leading-[36px] sm:text-[34px] sm:leading-[42px]" : "text-[22px] leading-[30px]")}>
        Named in{" "}
        <CountButton onClick={() => openRun(`Answers naming ${businessName}`, "named")} label={`${run.named} answers named ${businessName}. Open them.`}>{num(run.named)}</CountButton>
        {" "}of{" "}
        <CountButton onClick={() => openRun("Every answer", "answered")} label={`${run.answered} answers were given. Open them.`}>{num(run.answered)}</CountButton>
        {" "}answers.
      </p>
      {rivals.length > 0 && (
        <p className="text-[15px] leading-6 text-text-2">
          {rivals.map((rival, i) => (
            <span key={rival.name}>
              {i > 0 && <span className="text-text-4"> · </span>}
              {rival.name}:{" "}
              <CountButton onClick={() => openRun(`Answers naming ${rival.name}`, "answered", rival.name)} label={`${rival.named} answers named ${rival.name}. Open them.`} className="font-medium text-text">
                {num(rival.named)}
              </CountButton>
            </span>
          ))}
        </p>
      )}
      {(run.noAnswer > 0 || run.failed > 0) && (
        <p className="text-[13px] leading-5 text-text-3">
          {run.noAnswer > 0 && (
            <CountButton onClick={() => openRun("Searches with no AI Overview", "no_answer")} label={`${run.noAnswer} searches showed no AI Overview. Open them.`}>
              {plural(run.noAnswer, "search", "searches")} showed no AI Overview
            </CountButton>
          )}
          {run.noAnswer > 0 && run.failed > 0 && " and "}
          {run.failed > 0 && (
            <CountButton onClick={() => openRun("Answers that failed", "failed")} label={`${run.failed} answers failed. Open them.`}>
              {plural(run.failed, "answer")} failed
            </CountButton>
          )}
          ; listed, not counted.
        </p>
      )}
    </div>
  );
}

/* ─── By assistant, and who's named instead ────────────────────────────── */

export function AssistantPanel({ run, log, title = "By assistant", baseline }: { run: Run; log?: Check[] | null; title?: string; baseline?: string | null }) {
  const open = useEvidence();
  const rows = assistantRows(run, log);
  return (
    <Panel title={title} description={baseline ?? "Answers naming you, of the answers each gave. A gray tick marks the most-named competitor."} className="h-full">
      {rows.length ? (
        <AssistantBars rows={rows} onOpen={(assistant) => open({ kind: "run", runId: run.runId, title: `${assistantLabel(assistant)}'s answers`, assistant, outcome: "answered" })} />
      ) : (
        <p className="text-[13px] text-text-3">Counts by assistant appear when the run finishes.</p>
      )}
    </Panel>
  );
}

export function RivalsPanel({ run, businessName, title = "Named instead" }: { run: Run; businessName: string; title?: string }) {
  const open = useEvidence();
  const rows = rivalsRanked(run, businessName).slice(0, 6);
  return (
    <Panel title={title} description="Answers naming each business in this run. Each opens its answers." className="h-full">
      {rows.length > 1 ? (
        <RivalBars rows={rows} onOpen={(row) => open({ kind: "run", runId: run.runId, title: `Answers naming ${row.name}`, outcome: row.you ? "named" : "answered", competitor: row.you ? undefined : row.name })} />
      ) : (
        <p className="text-[13px] leading-5 text-text-3">No competitor was named in this run&apos;s answers.</p>
      )}
    </Panel>
  );
}

/* ─── Questions you can win now ────────────────────────────────────────── */

export function WinnableQuestions({ questions, limit = 5, emptyText }: { questions: OverviewQuestion[]; limit?: number; emptyText?: string }) {
  const open = useEvidence();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? questions : questions.slice(0, limit);
  if (!questions.length) {
    return <p className="text-[13px] leading-5 text-text-3">{emptyText ?? "None right now: the questions are covered or answered from large sites only."}</p>;
  }
  return (
    <div className="flex flex-col">
      <ol className="flex flex-col divide-y divide-border">
        {shown.map((q, i) => (
          <li key={q.questionId}>
            <button type="button" onClick={() => open({ kind: "question", questionId: q.questionId })}
              className="group -mx-2 grid w-[calc(100%+16px)] grid-cols-[auto_1fr_auto] gap-x-3 rounded-control px-2 py-3 text-left transition-colors duration-[var(--d-instant)] hover:bg-surface-2">
              <span className="mono-label pt-0.5 text-text-4">{String(i + 1).padStart(2, "0")}</span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium leading-[22px] text-text">{q.question}</span>
                {q.opportunity?.reasons.length ? (
                  <span className="mt-1 block text-[13px] leading-5 text-text-3">{q.opportunity.reasons.slice(0, 2).join(" ")}</span>
                ) : null}
              </span>
              <ChevronRight aria-hidden="true" className="mt-1 h-4 w-4 text-text-4 transition-colors group-hover:text-text-2" strokeWidth={1.5} />
            </button>
          </li>
        ))}
      </ol>
      {questions.length > limit && (
        <Button variant="ghost" size="sm" className="mt-2 self-start" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show fewer" : `Show all ${questions.length}`}
        </Button>
      )}
    </div>
  );
}

/* ─── The full answer log ──────────────────────────────────────────────── */

type LogOutcome = "all" | "named" | "not_named" | "rivals" | "no_answer" | "failed";
const LOG_FILTERS: { id: LogOutcome; label: string }[] = [
  { id: "all", label: "All" },
  { id: "named", label: "Named you" },
  { id: "not_named", label: "Not named" },
  { id: "rivals", label: "Competitor named" },
  { id: "no_answer", label: "No AI Overview" },
  { id: "failed", label: "Failed" },
];

function logMatches(check: Check, outcome: LogOutcome): boolean {
  if (outcome === "all") return true;
  if (outcome === "no_answer") return check.status === "no_answer";
  if (outcome === "failed") return check.status === "error";
  if (check.status !== "answered") return false;
  if (outcome === "named") return check.named;
  if (outcome === "not_named") return !check.named;
  return check.competitorsNamed.length > 0;
}

/** Every answer of one run, filterable and searchable; each row opens the answer in full. */
export function AnswerLog({ runId, log }: { runId: string; log: Check[] | null | undefined }) {
  const open = useEvidence();
  const [assistant, setAssistant] = useState("all");
  const [outcome, setOutcome] = useState<LogOutcome>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(25);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (log ?? []).filter((c) => (assistant === "all" || c.assistant === assistant) && logMatches(c, outcome) && (!q || c.question.toLowerCase().includes(q)));
  }, [log, assistant, outcome, query]);
  if (log === undefined) {
    return <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the answer log">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-11 w-full" />)}</div>;
  }
  if (log === null) return <p className="text-[13px] text-text-3">This run&apos;s answers aren&apos;t available.</p>;
  return (
    <div className="flex flex-col gap-3" data-run={runId}>
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <ChipScroller label="Outcome">
          {LOG_FILTERS.map((f) => {
            const count = (log ?? []).filter((c) => (assistant === "all" || c.assistant === assistant) && logMatches(c, f.id)).length;
            return (
              <button key={f.id} type="button" role="radio" aria-checked={outcome === f.id} onClick={() => { setOutcome(f.id); setShown(25); }}
                className={cx("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-[var(--d-instant)]",
                  outcome === f.id ? "border-border-strong bg-surface-3 text-text" : "border-border text-text-3 hover:bg-surface-2 hover:text-text")}>
                {f.label}<span className="tabular-nums text-text-4">{count}</span>
              </button>
            );
          })}
        </ChipScroller>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor={`log-assistant-${runId}`}>Assistant</label>
          <select id={`log-assistant-${runId}`} value={assistant} onChange={(e) => { setAssistant(e.target.value); setShown(25); }}
            className="select-field h-8 rounded-control border border-border bg-surface-1 px-2 text-[13px] text-text outline-none hover:border-border-strong focus:border-[var(--border-focus)]">
            <option value="all">All assistants</option>
            {ASSISTANTS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="relative min-w-0 flex-1 lg:w-56 lg:flex-none">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-4" strokeWidth={1.5} />
            <label className="sr-only" htmlFor={`log-search-${runId}`}>Search questions</label>
            <input id={`log-search-${runId}`} type="search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(25); }} placeholder="Search questions"
              className="h-8 w-full rounded-control border border-border bg-surface-1 pl-8 pr-2 text-[13px] text-text placeholder:text-text-4 outline-none hover:border-border-strong focus:border-[var(--border-focus)]" />
          </div>
        </div>
      </div>
      <div className="overflow-hidden rounded-card border border-border">
        <div className="hidden grid-cols-[minmax(0,1fr)_150px_minmax(0,220px)_130px] gap-4 border-b border-border bg-surface-1 px-4 py-2.5 md:grid">
          {["Question", "Assistant", "Outcome", "Asked"].map((h) => <span key={h} className="mono-caps text-text-3">{h}</span>)}
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[14px] text-text-3">No answers match these filters.</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => { setAssistant("all"); setOutcome("all"); setQuery(""); setShown(25); }}>
              Show all {plural(log.length, "answer")}
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.slice(0, shown).map((c) => {
              const result = checkOutcomes(c)[0]!;
              return (
                <li key={c.checkId}>
                  <button type="button" onClick={() => open({ kind: "check", checkId: c.checkId })}
                    className="grid w-full grid-cols-1 gap-1.5 px-4 py-3 text-left transition-colors duration-[var(--d-instant)] hover:bg-surface-2 md:min-h-11 md:grid-cols-[minmax(0,1fr)_150px_minmax(0,220px)_130px] md:items-center md:gap-4 md:py-2">
                    <span className="truncate text-[14px] text-text" title={c.question}>{c.question}</span>
                    <span className="flex items-center gap-3 md:contents">
                      {isAssistantId(c.assistant) ? <AssistantMark assistant={c.assistant} size="sm" showLabel labelClassName="text-[13px] text-text-2" /> : <span className="text-[13px]">{c.assistant}</span>}
                      <StatusPill kind={result.kind === "cited" ? "named" : result.kind} className="max-w-[220px]">{result.label}</StatusPill>
                      <span className="mono-label ml-auto text-text-3 md:ml-0">{shortStamp(c.askedAt)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {rows.length > shown && (
        <Button variant="secondary" size="sm" className="self-center" onClick={() => setShown((n) => n + 25)}>
          Show 25 more of {rows.length - shown}
        </Button>
      )}
    </div>
  );
}

/** The answer log for a run, loaded once (shared by the per-assistant ticks and the table). */
export function useRunLog(runId: string | null | undefined) {
  return useAnswersQuery("runAnswers", runId ? { runId } : "skip");
}

/** "ChatGPT, Perplexity and Gemini" for the assistants that named the business in a question's latest run. */
export function assistantsSentence(ids: readonly string[]): string {
  return listSentence(ids.map(assistantLabel));
}

export { intentLabel };
