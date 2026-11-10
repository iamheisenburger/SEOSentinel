"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fieldStyles } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useEvidence } from "@/components/answers/evidence-sheet";
import { useRunLog } from "@/components/answers/snapshot";
import { ChipScroller, InlineError, Notice, Panel, PanelSkeleton, ScreenHeader, ScrollX } from "@/components/answers/ui";
import { parseCompetitor, useCompetitorLookup } from "@/components/answers/onboarding/understood";
import { useAnswersActions, useAnswersQuery } from "@/lib/answers/backend";
import { latestFullRun, rivalOnlyQuestions } from "@/lib/answers/derive";
import { assistantLabel, num, plural, shortDate } from "@/lib/answers/format";
import type { Check, Competitor, Overview } from "@/lib/answers/types";
import { ASSISTANTS } from "@/lib/product-facts";
import { userErrorMessage } from "@/lib/user-error";
import { recommendedRows } from "@/lib/answers/business-key";
import { cx } from "@/lib/cx";

export function AnswersCompetitors({ siteId }: { siteId: string }) {
  const overview = useAnswersQuery("overview", { siteId });
  if (overview === undefined) return <><ScreenHeader title="Competitors" /><PanelSkeleton lines={8} /></>;
  if (overview === null) return <Notice>This site&apos;s competitors aren&apos;t available.</Notice>;
  return <CompetitorsBody overview={overview} />;
}

function CompetitorsBody({ overview }: { overview: Overview }) {
  const run = latestFullRun(overview.runs);
  const log = useRunLog(run?.runId);
  const open = useEvidence();
  const rows = useMemo(() => (run && log ? recommendedRows(log, overview.site.name, overview.site.competitors, ASSISTANTS.map((a) => a.id)) : null),
    [run, log, overview.site.name, overview.site.competitors]);
  const actions = useAnswersActions();
  const { toast } = useToast();
  const track = async (name: string) => {
    try {
      await actions.confirmSetup({ siteId: overview.site.siteId, competitors: [...overview.site.competitors, { name }], country: overview.site.country });
      toast(`Tracking ${name}. Its count joins every answer from the next run.`, "success");
    } catch (e) { toast(userErrorMessage(e, "Pentra couldn't save that. Try again."), "error"); }
  };
  const rivals = rows?.filter((r) => !r.you && r.total > 0) ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const focus = selected ?? rivals[0]?.name ?? null;
  const onlyThem = focus ? rivalOnlyQuestions(overview.questions, focus) : [];

  return (
    <>
      <ScreenHeader title="Competitors" meta={run ? `Who the AI recommends · answers from the run of ${shortDate(run.finishedAt ?? run.createdAt)} · ${plural(overview.site.competitors.length, "competitor")} tracked` : `${plural(overview.site.competitors.length, "competitor")} tracked`} />
      {run ? (
        <Panel title="Who the AI recommends" description="Every business the answers recommend in the latest full run, by assistant, most first. Track one to watch it closely; every count opens its answers.">
          {rows === null ? (
            <PanelSkeleton lines={5} className="border-0 p-0" />
          ) : (
            <ScrollX className="-mx-5 px-5">
              <table className="w-full min-w-[680px] text-left">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="mono-caps py-2.5 pr-4 font-normal text-text-3">Business</th>
                    <th scope="col" className="mono-caps py-2.5 pr-4 text-right font-normal text-text-3">All</th>
                    {ASSISTANTS.map((a) => <th key={a.id} scope="col" className="mono-caps py-2.5 pr-4 text-right font-normal text-text-3">{a.short}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.name}-${row.you}`} className={cx("border-b border-border last:border-b-0", row.you && "bg-you-tint")}>
                      <th scope="row" className={cx("py-2.5 pr-4 text-[14px] font-normal", row.you ? "font-medium text-text" : "text-text-2")}>
                        <span className="pl-2">{row.name}</span>{row.you && <span className="ml-1.5 text-text-3">(you)</span>}
                        {!row.you && !row.tracked && overview.site.competitors.length < 8 && (
                          <button type="button" onClick={() => track(row.name)} className="ml-2 rounded-[4px] border border-border px-1.5 py-0.5 text-[11px] text-text-3 hover:border-border-strong hover:text-text">Track</button>
                        )}
                        {row.tracked && <span className="ml-2 text-[11px] text-text-3">tracked</span>}
                      </th>
                      <td className="py-2.5 pr-4 text-right">
                        <CountCell value={row.total} label={`${row.total} answers named ${row.name}`}
                          onClick={() => open({ kind: "run", runId: run.runId, title: `Answers naming ${row.name}`, outcome: row.you ? "named" : "answered", competitor: row.you ? undefined : row.name })} strong />
                      </td>
                      {ASSISTANTS.map((a) => (
                        <td key={a.id} className="py-2.5 pr-4 text-right">
                          <CountCell value={row.byAssistant[a.id] ?? 0} label={`${assistantLabel(a.id)}: ${row.byAssistant[a.id] ?? 0} answers named ${row.name}`}
                            onClick={() => open({ kind: "run", runId: run.runId, title: `${assistantLabel(a.id)}'s answers naming ${row.name}`, assistant: a.id, outcome: row.you ? "named" : "answered", competitor: row.you ? undefined : row.name })} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          )}
        </Panel>
      ) : (
        <Notice>Counts appear after the first run finishes.</Notice>
      )}

      {rivals.length > 0 && (
        <Panel title="Where they're named and you aren't" description="From each question's latest result. Each opens every answer to that question.">
          <ChipScroller label="Competitor" className="mb-3">
            {rivals.map((r) => (
              <button key={r.name} type="button" role="radio" aria-checked={focus === r.name} onClick={() => setSelected(r.name)}
                className={cx("inline-flex h-7 shrink-0 items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-[var(--d-instant)]",
                  focus === r.name ? "border-border-strong bg-surface-3 text-text" : "border-border text-text-3 hover:bg-surface-2 hover:text-text")}>
                {r.name}
              </button>
            ))}
          </ChipScroller>
          {onlyThem.length ? (
            <ul className="flex flex-col divide-y divide-border">
              {onlyThem.slice(0, 12).map(({ question, answers }) => (
                <li key={question.questionId}>
                  <button type="button" onClick={() => open({ kind: "question", questionId: question.questionId })}
                    className="group -mx-2 grid w-[calc(100%+16px)] grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-control px-2 py-2.5 text-left transition-colors duration-[var(--d-instant)] hover:bg-surface-2">
                    <span className="truncate text-[14px] text-text">{question.question}</span>
                    <span className="text-[12px] tabular-nums text-text-3">named in {answers} of {question.latest?.answered ?? 0}</span>
                    <ChevronRight aria-hidden="true" className="h-4 w-4 text-text-4 group-hover:text-text-2" strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-text-3">No question where only {focus} is named.</p>
          )}
        </Panel>
      )}

      <EditCompetitors overview={overview} />
    </>
  );
}

function CountCell({ value, label, onClick, strong }: { value: number; label: string; onClick: () => void; strong?: boolean }) {
  if (value === 0) return <span className="text-[13px] tabular-nums text-text-4">0</span>;
  return (
    <button type="button" onClick={onClick} aria-label={`${label}. Open them.`}
      className={cx("rounded-[3px] text-[13px] tabular-nums underline decoration-dotted decoration-text-4 underline-offset-[5px] hover:decoration-text-2", strong ? "font-medium text-text" : "text-text-2")}>
      {num(value)}
    </button>
  );
}

/** The competitor list the counts are judged against; changes count from the next run. */
function EditCompetitors({ overview }: { overview: Overview }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const [list, setList] = useState<Competitor[]>(overview.site.competitors);
  const { pending: lookingUp, lookup } = useCompetitorLookup(overview.site.siteId, setList);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = JSON.stringify(list) !== JSON.stringify(overview.site.competitors);
  const add = () => {
    const parsed = parseCompetitor(value);
    if (!parsed || list.length >= 8) return;
    if (!list.some((c) => c.name.toLowerCase() === parsed.name.toLowerCase() || (parsed.domain && c.domain === parsed.domain))) {
      setList((l) => [...l, parsed]);
      lookup(parsed);
    }
    setValue("");
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); add(); } };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.confirmSetup({ siteId: overview.site.siteId, competitors: list, country: overview.site.country });
      toast("Saved. Counts use this list from the next run.", "success");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't save the list. Try again."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Your competitors" description="The businesses answers are checked for. Up to 8. Changes count from the next run; past answers keep the names they were judged with.">
      <div className="flex flex-col gap-3">
        {list.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Competitors">
            {list.map((c) => (
              <li key={c.domain ?? c.name} className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 pl-3 pr-1 text-[13px] text-text">
                {c.domain && lookingUp.includes(c.domain)
                  ? <span className="min-w-0 truncate"><span className="font-mono text-[12px]">{c.domain}</span><span className="ml-1.5 text-text-3">finding the name…</span></span>
                  : <span className="min-w-0 truncate">{c.name}{c.domain && <span className="ml-1.5 font-mono text-[11px] text-text-3">{c.domain}</span>}</span>}
                <button type="button" onClick={() => setList((l) => l.filter((x) => x !== c))} aria-label={`Remove ${c.name}`}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full text-text-3 transition-colors hover:bg-surface-3 hover:text-text">
                  <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-text-3">No competitors. Answers are still recorded; nobody is counted as named instead.</p>}
        <div className="flex max-w-[520px] gap-2">
          <label htmlFor="add-competitor" className="sr-only">Add a competitor</label>
          <input id="add-competitor" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKey} disabled={list.length >= 8}
            placeholder="Name or website" className={cx(fieldStyles, "h-9 min-w-0 flex-1 text-[14px]")} />
          <Button variant="secondary" size="sm" className="h-9" onClick={add} disabled={value.trim().length < 2 || list.length >= 8} icon={<Plus className="h-3.5 w-3.5" strokeWidth={1.5} />}>Add</Button>
        </div>
        {error && <InlineError title="Not saved">{error}</InlineError>}
        <div className="flex gap-2">
          <Button onClick={save} disabled={!changed} loading={busy} loadingLabel="Saving…">Save competitors</Button>
          {changed && <Button variant="ghost" onClick={() => setList(overview.site.competitors)}>Undo changes</Button>}
        </div>
      </div>
    </Panel>
  );
}
