"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Mail } from "lucide-react";
import { AssistantMark } from "@/components/ui/assistant-mark";
import { Button, ButtonAnchor } from "@/components/ui/button";
import { EvidenceCard } from "@/components/ui/evidence-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useEvidence } from "@/components/answers/evidence-sheet";
import { AnswerLog, useRunLog } from "@/components/answers/snapshot";
import { CountButton, InlineError, LiveDot, Notice, Panel } from "@/components/answers/ui";
import { useAnswersActions, useAnswersQuery, useNow } from "@/lib/answers/backend";
import { checkToEvidence } from "@/lib/answers/evidence";
import { assistantLabel, elapsed, intentLabel, isAssistantId, num, plural, shortStamp } from "@/lib/answers/format";
import type { RunProgress, SetupState } from "@/lib/answers/types";
import { ASSISTANTS, SNAPSHOT, SUPPORT_EMAIL } from "@/lib/product-facts";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

type StepState = "waiting" | "running" | "done" | "failed";

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-named-tint text-named"><Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} /></span>;
  if (state === "running") return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-you-tint"><LiveDot /></span>;
  if (state === "failed") return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-wrong-tint"><span className="h-2 w-2 rounded-full bg-wrong" /></span>;
  return <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border-strong"><span className="h-1.5 w-1.5 rounded-full bg-text-4" /></span>;
}

function Step({ state, title, meta, children, last }: { state: StepState; title: ReactNode; meta?: ReactNode; children?: ReactNode; last?: boolean }) {
  const label = { waiting: "Waiting", running: "Running", done: "Done", failed: "Stopped" }[state];
  return (
    <li className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-x-4">
      {!last && <span aria-hidden="true" className="absolute left-[11.5px] top-7 bottom-0 w-px bg-border" />}
      <StepIcon state={state} />
      <div className={cx("min-w-0", !last && "pb-7")}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
          <p className={cx("text-[15px] font-medium leading-6", state === "waiting" ? "text-text-3" : "text-text")}>
            {title}<span className="sr-only"> · {label}</span>
          </p>
          {meta && <span className="mono-label text-text-3">{meta}</span>}
        </div>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </li>
  );
}

/**
 * The live first hour: a step list (never a fake-precise percentage), an honest elapsed time, per-assistant progress,
 * and answers streaming in as compact evidence. Partial failures are said with what Pentra has.
 */
export function FirstHour({ state }: { state: SetupState }) {
  const run = state.run;
  const progress = useAnswersQuery("runProgress", run ? { runId: run.runId } : "skip");
  const now = useNow(1000);
  const live = progress ?? null;
  const asking = run?.status === "asking";
  const failed = run?.status === "failed";
  const name = state.name ?? state.domain;

  const questionsState: StepState = state.questions.length > 0 ? "done" : state.setupError ? "failed" : "running";
  const askingState: StepState = !run ? "waiting" : failed ? "failed" : asking ? "running" : "done";

  return (
    <section aria-labelledby="first-hour-title" className="mx-auto max-w-[1080px] px-[var(--gutter)] py-12 sm:py-16">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-text-3">Free snapshot · step 4 of 5</p>
          <h1 id="first-hour-title" className="type-h1 mt-3 text-text [overflow-wrap:anywhere]">Asking the assistants about {name}</h1>
          <p className="mono-label mt-3 text-text-3">
            {run ? <>Started {shortStamp(run.createdAt)} · running for {elapsed(Math.max(0, (run.finishedAt ?? now) - run.createdAt))}</> : state.confirmedAt ? <>Confirmed {shortStamp(state.confirmedAt)}</> : null}
          </p>
        </div>
        <Notice className="lg:max-w-[360px]">
          <span className="inline-flex items-start gap-2"><Mail aria-hidden="true" className="mt-[3px] h-4 w-4 shrink-0 text-text-3" strokeWidth={1.5} />Safe to close this tab. We&apos;ll email you when it&apos;s ready.</span>
        </Notice>
      </div>

      {state.setupError && !run && <SetupErrorNotice state={state} />}
      {failed && run && (
        <InlineError className="mt-8" title="The run stopped before it finished" actions={<ButtonAnchor href={`mailto:${SUPPORT_EMAIL}`} variant="secondary" size="sm">Email us</ButtonAnchor>}>
          {run.error ?? "The assistants stopped answering."} {plural(run.answered, "answer")} {run.answered === 1 ? "was" : "were"} saved and {run.answered === 1 ? "is" : "are"} below.
        </InlineError>
      )}

      <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] lg:gap-12">
        <Panel className="h-fit lg:sticky lg:top-24">
          <ol aria-label="Progress" className="flex flex-col">
            <Step state="done" title="Read your site" meta={state.readAt ? shortStamp(state.readAt).split(", ")[1] : undefined} />
            <Step state={questionsState} title={state.questions.length ? `Found ${plural(state.questions.length, "question")} buyers ask` : "Finding the questions buyers ask"}>
              {state.questions.length > 0 && <QuestionList questions={state.questions} />}
            </Step>
            <Step state={askingState} title={`Asking ${ASSISTANTS.length} assistants`}
              meta={run ? `${num(run.done)} of ${num(run.total)} · since ${shortStamp(run.createdAt).split(", ")[1]}` : undefined}>
              {run && <AskingDetail run={live ?? { ...run, perAssistant: [], feed: [] }} />}
            </Step>
            <Step state="waiting" title={`Writing your first ${SNAPSHOT.draftPages} pages`} last />
          </ol>
        </Panel>
        <div className="min-w-0">
          {failed && run ? (
            <FailedLog runId={run.runId} />
          ) : (
            <Feed progress={live} waiting={!run} business={{ name, domain: state.domain }} />
          )}
        </div>
      </div>
    </section>
  );
}

function SetupErrorNotice({ state }: { state: SetupState }) {
  const actions = useAnswersActions();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const retry = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await actions.confirmSetup({ siteId: state.siteId, competitors: state.competitors, ...(state.country ? { country: state.country } : {}) });
      setMessage("Asked again. If the questions still don't appear in a few minutes, Pentra retries by itself.");
    } catch (e) {
      setMessage(userErrorMessage(e, "Pentra couldn't restart the setup. Try again in a minute."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <InlineError className="mt-8" title="The first hour couldn't start"
      actions={<><Button variant="secondary" size="sm" onClick={retry} loading={busy} loadingLabel="Trying…">Try again</Button>
        <ButtonAnchor href={`mailto:${SUPPORT_EMAIL}`} variant="ghost" size="sm">Email us</ButtonAnchor></>}>
      {state.setupError} Pentra also tries again by itself within six hours.{message && <span className="mt-1 block text-text">{message}</span>}
    </InlineError>
  );
}

function QuestionList({ questions }: { questions: SetupState["questions"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-control text-[13px] font-medium text-text-3 transition-colors duration-[var(--d-instant)] hover:text-text">
        {open ? "Hide the questions" : "Show the questions"}
        <ChevronDown aria-hidden="true" className={cx("h-3.5 w-3.5 transition-[rotate] duration-[var(--d-state)]", open && "rotate-180")} strokeWidth={1.5} />
      </button>
      {open && (
        <ol className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1">
          {questions.map((q, i) => (
            <li key={q.questionId} className="grid grid-cols-[28px_minmax(0,1fr)] text-[13px] leading-5 text-text-2">
              <span className="mono-label text-text-4">{String(i + 1).padStart(2, "0")}</span>
              <span>{q.question} <span className="text-text-4">· {intentLabel(q.intent)}</span></span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The counts as they arrive, and each assistant's share of the run. */
function AskingDetail({ run }: { run: RunProgress }) {
  const open = useEvidence();
  const pct = run.total ? (run.done / run.total) * 100 : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        <div className="h-full rounded-full bg-you transition-[width] duration-[var(--d-state)] ease-out" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[13px] leading-5 text-text-2" aria-live="polite">
        <CountButton onClick={() => open({ kind: "run", runId: run.runId, title: "Answers so far" })} label={`${run.done} asked so far. Open them.`} className="font-medium text-text">{num(run.done)}</CountButton>
        {" "}of {num(run.total)} asked ·{" "}
        named in{" "}
        <CountButton onClick={() => open({ kind: "run", runId: run.runId, title: "Answers naming you", outcome: "named" })} label={`${run.named} answers named you so far. Open them.`} className="font-medium text-text">{run.named}</CountButton>
        {" "}of {plural(run.answered, "answer")}
        {run.noAnswer > 0 && <> · {run.noAnswer} with no AI Overview</>}
        {run.failed > 0 && <> · {run.failed} failed</>}
      </p>
      {run.failed > 0 && (
        <p className="text-[12px] leading-[18px] text-text-3">
          {plural(run.failed, "answer")} failed; counts show what Pentra has ({num(run.answered)} answered of {num(run.done)} asked so far).
        </p>
      )}
      {run.perAssistant.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Questions per assistant">
          {run.perAssistant.map((a) => {
            const done = typeof a.done === "number" ? a.done : null;
            return (
              <li key={a.assistant} className={cx("grid items-center gap-3", done !== null ? "grid-cols-[minmax(0,1fr)_72px_56px]" : "grid-cols-[minmax(0,1fr)_auto]")}>
                {isAssistantId(a.assistant) ? <AssistantMark assistant={a.assistant} size="sm" showLabel labelClassName="truncate text-[12px] text-text-2" /> : <span className="text-[12px]">{assistantLabel(a.assistant)}</span>}
                {done !== null && (
                  <span className="block h-1 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                    <span className="block h-full rounded-full bg-text-3 transition-[width] duration-[var(--d-state)]" style={{ width: `${(done / Math.max(1, a.total)) * 100}%` }} />
                  </span>
                )}
                <span className="text-right font-mono text-[11px] tabular-nums text-text-3">{done !== null ? `${done}/${a.total}` : plural(a.total, "question")}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Finished answers stream in here, newest on top, each as compact evidence. */
function Feed({ progress, waiting, business }: { progress: RunProgress | null; waiting: boolean; business: { name: string; domain: string } }) {
  const open = useEvidence();
  if (waiting || !progress) {
    return (
      <div className="flex flex-col gap-3">
        <p className="mono-caps text-text-3">Answers as they arrive</p>
        <div className="rounded-card border border-dashed border-border-strong px-5 py-10 text-center">
          <p className="text-[14px] text-text-2">The first answers appear here within a few minutes.</p>
          <p className="mt-1 text-[13px] text-text-3">Each one is kept in full, with the sources the assistant cited.</p>
        </div>
        {[0, 1].map((i) => <Skeleton key={i} className="h-36 w-full rounded-card" />)}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="mono-caps text-text-3">Answers as they arrive · newest first</p>
      {progress.feed.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-5 py-10 text-center text-[14px] text-text-2">Asking now. The first answers appear here in a moment.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {progress.feed.map((check) => (
            <li key={check.checkId} className="feed-in">
              <EvidenceCard answer={checkToEvidence(check, business)} variant="compact" showSources={false} showFooter={false}
                onRaw={check.status === "answered" ? () => open({ kind: "check", checkId: check.checkId }) : undefined} />
            </li>
          ))}
        </ul>
      )}
      {progress.done > progress.feed.length && (
        <p className="text-[13px] text-text-3">Showing the newest {progress.feed.length} of {num(progress.done)}. All of them are in your snapshot when it&apos;s ready.</p>
      )}
    </div>
  );
}

function FailedLog({ runId }: { runId: string }) {
  const log = useRunLog(runId);
  return (
    <div className="flex flex-col gap-3">
      <p className="mono-caps text-text-3">The answers Pentra saved</p>
      <AnswerLog runId={runId} log={log} />
    </div>
  );
}
