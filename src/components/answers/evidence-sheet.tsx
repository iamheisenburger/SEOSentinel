"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Check as CheckIcon, Copy } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { EvidenceCard } from "@/components/ui/evidence-card";
import { AssistantMark } from "@/components/ui/assistant-mark";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useAnswersQuery } from "@/lib/answers/backend";
import { checkToEvidence, type Business } from "@/lib/answers/evidence";
import { assistantLabel, isAssistantId, plural, shortDate, utcStamp } from "@/lib/answers/format";
import type { Check } from "@/lib/answers/types";
import { ASSISTANTS } from "@/lib/product-facts";
import { cx } from "@/lib/cx";
import { ChipScroller } from "@/components/answers/ui";

/* ─── What a count opens ───────────────────────────────────────────────── */

export type RunOutcome = "answered" | "named" | "not_named" | "cited" | "no_answer" | "failed";

export type EvidenceTarget =
  | { kind: "question"; questionId: string; assistant?: string }
  | { kind: "check"; checkId: string }
  | { kind: "run"; runId: string; title: string; assistant?: string; outcome?: RunOutcome; competitor?: string };

type OpenEvidence = (target: EvidenceTarget) => void;

const EvidenceContext = createContext<OpenEvidence | null>(null);

/** Opens the evidence sheet from anywhere inside an EvidenceProvider. */
export function useEvidence(): OpenEvidence {
  const open = useContext(EvidenceContext);
  if (!open) throw new Error("useEvidence needs an EvidenceProvider");
  return open;
}

export function EvidenceProvider({ business, children }: { business: Business; children: ReactNode }) {
  // The stack stays after closing, so the sheet's content doesn't vanish while it animates out.
  const [stack, setStack] = useState<EvidenceTarget[]>([]);
  const [isOpen, setOpen] = useState(false);
  const shown = stack[stack.length - 1] ?? null;
  const open = useCallback<OpenEvidence>((next) => { setStack([next]); setOpen(true); }, []);
  const push = useCallback((next: EvidenceTarget) => setStack((s) => [...s, next]), []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const close = useCallback(() => setOpen(false), []);

  return (
    <EvidenceContext.Provider value={open}>
      {children}
      <Sheet open={isOpen && Boolean(shown)} onClose={close} {...(shown ? sheetHeading(shown) : { title: "Answers" })}>
        {shown && (
          <EvidenceBody key={JSON.stringify(shown)} target={shown} business={business} onPush={push} onBack={stack.length > 1 ? back : undefined} />
        )}
      </Sheet>
    </EvidenceContext.Provider>
  );
}

function sheetHeading(target: EvidenceTarget): { title: ReactNode; eyebrow: ReactNode; description?: ReactNode } {
  if (target.kind === "question") return { eyebrow: "Every answer to this question", title: <QuestionTitle questionId={target.questionId} /> };
  if (target.kind === "check") return { eyebrow: "One answer, in full", title: <CheckTitle checkId={target.checkId} /> };
  return { eyebrow: "From one run", title: target.title };
}

function QuestionTitle({ questionId }: { questionId: string }) {
  const data = useAnswersQuery("questionEvidence", { questionId, limit: 60 });
  if (data === undefined) return <Skeleton className="h-5 w-3/4" />;
  return <>{data?.question ?? "Question not found"}</>;
}

function CheckTitle({ checkId }: { checkId: string }) {
  const data = useAnswersQuery("answerText", { checkId });
  if (data === undefined) return <Skeleton className="h-5 w-3/4" />;
  return <>{data?.question ?? "Answer not found"}</>;
}

/* ─── Body ─────────────────────────────────────────────────────────────── */

function EvidenceBody({ target, business, onPush, onBack }: { target: EvidenceTarget; business: Business; onPush: (t: EvidenceTarget) => void; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // A new view in the sheet starts at its top (the sheet keeps one scroll area).
  useEffect(() => { ref.current?.parentElement?.scrollTo({ top: 0 }); }, []);
  return (
    <div ref={ref} className="flex flex-col gap-4">
      {onBack && (
        <button type="button" onClick={onBack} className="-ml-1 inline-flex h-7 w-fit items-center gap-1.5 rounded-control px-1 text-[13px] font-medium text-text-3 transition-colors duration-[var(--d-instant)] hover:text-text">
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
          Back
        </button>
      )}
      {target.kind === "question" && <QuestionAnswers target={target} business={business} onPush={onPush} />}
      {target.kind === "check" && <FullAnswer checkId={target.checkId} business={business} onPush={onPush} />}
      {target.kind === "run" && <RunAnswers target={target} business={business} onPush={onPush} />}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading answers">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-card border border-border p-5">
          <div className="flex justify-between"><Skeleton className="h-5 w-28" /><Skeleton className="h-4 w-32" /></div>
          <Skeleton className="mt-5 h-4 w-3/4" />
          <Skeleton className="mt-4 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function NotFound({ what }: { what: string }) {
  return <p className="rounded-card border border-border px-4 py-6 text-center text-[14px] text-text-3">This {what} isn&apos;t in your account any more.</p>;
}

type Chip = { id: string; label: ReactNode; count: number };

function ChipRow({ label, chips, value, onChange }: { label: string; chips: Chip[]; value: string; onChange: (id: string) => void }) {
  return (
    <ChipScroller label={label} className="pb-0.5">
      {chips.map((chip) => {
        const active = chip.id === value;
        return (
          <button
            key={chip.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={chip.count === 0 && !active}
            onClick={() => onChange(chip.id)}
            className={cx(
              "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-[var(--d-instant)] disabled:opacity-40",
              active ? "border-border-strong bg-surface-3 text-text" : "border-border text-text-3 hover:bg-surface-2 hover:text-text",
            )}
          >
            {chip.label}
            <span className="tabular-nums text-text-4">{chip.count}</span>
          </button>
        );
      })}
    </ChipScroller>
  );
}

function assistantChips(checks: readonly Check[]): Chip[] {
  return [
    { id: "all", label: "All", count: checks.length },
    ...ASSISTANTS.map((a) => ({ id: a.id as string, label: a.short, count: checks.filter((c) => c.assistant === a.id).length })),
  ];
}

const OUTCOME_LABELS: Record<RunOutcome, string> = {
  answered: "Answered",
  named: "Named you",
  not_named: "Not named",
  cited: "Cited your page",
  no_answer: "No AI Overview",
  failed: "Failed",
};

function matchesOutcome(check: Check, outcome: RunOutcome | "all"): boolean {
  switch (outcome) {
    case "all": return true;
    case "answered": return check.status === "answered";
    case "named": return check.status === "answered" && check.named;
    case "not_named": return check.status === "answered" && !check.named;
    case "cited": return check.status === "answered" && check.cited;
    case "no_answer": return check.status === "no_answer";
    case "failed": return check.status === "error";
  }
}

function outcomeChips(checks: readonly Check[]): Chip[] {
  const ids: (RunOutcome | "all")[] = ["all", "named", "not_named", "cited", "no_answer", "failed"];
  return ids.map((id) => ({ id, label: id === "all" ? "Any outcome" : OUTCOME_LABELS[id], count: checks.filter((c) => matchesOutcome(c, id)).length }))
    .filter((chip) => chip.id === "all" || chip.count > 0);
}

/** Answers as evidence cards, newest first, a page at a time so a long log stays quick. */
function AnswerCards({ checks, business, onPush, empty }: { checks: Check[]; business: Business; onPush: (t: EvidenceTarget) => void; empty: string }) {
  const [shown, setShown] = useState(12);
  if (!checks.length) return <p className="rounded-card border border-dashed border-border-strong px-4 py-8 text-center text-[14px] text-text-3">{empty}</p>;
  return (
    <div className="flex flex-col gap-3">
      {checks.slice(0, shown).map((check) => (
        <EvidenceCard
          key={check.checkId}
          answer={checkToEvidence(check, business)}
          showFooter={false}
          onRaw={check.status === "answered" ? () => onPush({ kind: "check", checkId: check.checkId }) : undefined}
        />
      ))}
      {checks.length > shown && (
        <Button variant="secondary" onClick={() => setShown((n) => n + 12)} className="self-center">
          Show {Math.min(12, checks.length - shown)} more of {checks.length - shown}
        </Button>
      )}
    </div>
  );
}

function QuestionAnswers({ target, business, onPush }: { target: Extract<EvidenceTarget, { kind: "question" }>; business: Business; onPush: (t: EvidenceTarget) => void }) {
  const data = useAnswersQuery("questionEvidence", { questionId: target.questionId, limit: 60 });
  const [assistant, setAssistant] = useState(target.assistant ?? "all");
  const filtered = useMemo(() => (data?.checks ?? []).filter((c) => assistant === "all" || c.assistant === assistant), [data, assistant]);
  if (data === undefined) return <ListSkeleton />;
  if (data === null) return <NotFound what="question" />;
  const latest = data.latest;
  return (
    <>
      <div className="rounded-card border border-border bg-surface-2/40 px-4 py-3.5 text-[14px] leading-[22px] text-text-2">
        {latest ? (
          <p>
            Latest run ({shortDate(latest.at)}): named in <span className="font-medium tabular-nums text-text">{latest.named} of {plural(latest.answered, "answer")}</span>
            {latest.assistantsNamed.length > 0 && <> by {latest.assistantsNamed.map(assistantLabel).join(", ")}</>}.
            {latest.competitorsNamed[0] && <> {latest.competitorsNamed[0].name} was named in {latest.competitorsNamed[0].answers}.</>}
          </p>
        ) : (
          <p>Not asked yet. Pentra asks it in the next run.</p>
        )}
        {data.opportunity && data.opportunity.reasons.length > 0 && (
          <ul className="mt-2 space-y-1 text-[13px] leading-5 text-text-3">
            {data.opportunity.reasons.map((reason) => (
              <li key={reason} className="flex gap-2"><span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-text-4" />{reason}</li>
            ))}
          </ul>
        )}
      </div>
      <ChipRow label="Assistant" chips={assistantChips(data.checks)} value={assistant} onChange={setAssistant} />
      <p className="mono-caps text-text-3">
        {plural(filtered.length, "answer")} · newest first{data.checks.length >= 60 ? " · the latest 60" : ""}
      </p>
      <AnswerCards checks={filtered} business={business} onPush={onPush} empty="No answers from this assistant yet." />
    </>
  );
}

function RunAnswers({ target, business, onPush }: { target: Extract<EvidenceTarget, { kind: "run" }>; business: Business; onPush: (t: EvidenceTarget) => void }) {
  const data = useAnswersQuery("runAnswers", { runId: target.runId });
  const [assistant, setAssistant] = useState(target.assistant ?? "all");
  const [outcome, setOutcome] = useState<RunOutcome | "all">(target.outcome ?? "all");
  const scoped = useMemo(() => (data ?? []).filter((c) => !target.competitor || c.competitorsNamed.includes(target.competitor)), [data, target.competitor]);
  const filtered = useMemo(() => scoped.filter((c) => (assistant === "all" || c.assistant === assistant) && matchesOutcome(c, outcome))
    .sort((a, b) => b.askedAt - a.askedAt), [scoped, assistant, outcome]);
  if (data === undefined) return <ListSkeleton />;
  if (data === null) return <NotFound what="run" />;
  return (
    <>
      <ChipRow label="Assistant" chips={assistantChips(scoped.filter((c) => matchesOutcome(c, outcome)))} value={assistant} onChange={setAssistant} />
      <ChipRow label="Outcome" chips={outcomeChips(scoped.filter((c) => assistant === "all" || c.assistant === assistant))} value={outcome} onChange={(id) => setOutcome(id as RunOutcome | "all")} />
      <p className="mono-caps text-text-3">{plural(filtered.length, "answer")} · newest first</p>
      <AnswerCards checks={filtered} business={business} onPush={onPush} empty="No answers match these filters." />
    </>
  );
}

function FullAnswer({ checkId, business, onPush }: { checkId: string; business: Business; onPush: (t: EvidenceTarget) => void }) {
  const data = useAnswersQuery("answerText", { checkId });
  const [copied, setCopied] = useState(false);
  if (data === undefined) return <ListSkeleton />;
  if (data === null) return <NotFound what="answer" />;
  const copy = async () => {
    if (!data.text) return;
    try {
      await navigator.clipboard.writeText(data.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-3">
        {isAssistantId(data.assistant) && <AssistantMark assistant={data.assistant} size="sm" showLabel labelClassName="text-[13px]" />}
        <time className="mono-label">{utcStamp(data.askedAt)}</time>
        <span>{plural(data.textChars, "character")}</span>
      </div>
      <EvidenceCard answer={checkToEvidence(data, business, { full: true })} clampLines={400} />
      <div className="flex flex-wrap gap-2">
        {data.text && (
          <Button variant="secondary" size="sm" onClick={copy} icon={copied ? <CheckIcon className="h-3.5 w-3.5" strokeWidth={1.5} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />}>
            {copied ? "Copied" : "Copy the answer as given"}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => onPush({ kind: "question", questionId: data.questionId })}>
          Every answer to this question
        </Button>
      </div>
      {!data.text && <p className="text-[13px] leading-5 text-text-3">Pentra keeps the full text of answered questions; this one has the recorded excerpt only.</p>}
    </>
  );
}
