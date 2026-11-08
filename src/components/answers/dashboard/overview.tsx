"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ArrowRight, CheckCircle2, RotateCw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { EvidenceCard } from "@/components/ui/evidence-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { TrendChart } from "@/components/answers/charts";
import { useEvidence } from "@/components/answers/evidence-sheet";
import { AssistantPanel, CountHeadline } from "@/components/answers/snapshot";
import { InlineError, LiveDot, Notice, Panel, PanelSkeleton, ScreenHeader } from "@/components/answers/ui";
import { useDestination } from "@/components/answers/dashboard/destination";
import { useAnswersActions, useAnswersQuery, useAppHref, useNow } from "@/lib/answers/backend";
import { checkToEvidence } from "@/lib/answers/evidence";
import { deltaText, latestFullRun, nextFullRunAt, weekLog, weeklyDelta } from "@/lib/answers/derive";
import { plural, shortDate, shortStamp, timeAgo, timeUntil } from "@/lib/answers/format";
import type { Overview, OverviewCitation } from "@/lib/answers/types";
import { userErrorMessage } from "@/lib/user-error";
import { cx } from "@/lib/cx";

export function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading the overview">
      <div><Skeleton className="h-8 w-64" /><Skeleton className="mt-3 h-3 w-80" /></div>
      <div><Skeleton className="h-10 w-3/4" /><Skeleton className="mt-3 h-4 w-1/2" /></div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2"><PanelSkeleton lines={6} /><PanelSkeleton lines={6} /></div>
      <PanelSkeleton lines={4} />
    </div>
  );
}

/**
 * The overview: the count sentence with the change since the last run said plainly, each assistant beside the trend,
 * the latest citations as evidence, and a factual log of the week. Every number opens its answers.
 */
export function AnswersOverview({ siteId }: { siteId: string }) {
  const overview = useAnswersQuery("overview", { siteId });
  if (overview === undefined) return <OverviewSkeleton />;
  if (overview === null) {
    return <Notice>This site&apos;s answers aren&apos;t available. It may belong to another account, or it no longer runs Pentra Answers.</Notice>;
  }
  return <OverviewBody overview={overview} />;
}

function OverviewBody({ overview }: { overview: Overview }) {
  const now = useNow(60_000);
  const upgraded = useSearchParams().get("upgraded") === "1";
  const href = useAppHref();
  const open = useEvidence();
  const { site, access, allows } = overview;
  const run = latestFullRun(overview.runs);
  const asking = overview.runs.find((r) => r.status === "asking") ?? null;
  const delta = weeklyDelta(overview.trend);
  // The backend's own schedule when it says (null: nothing scheduled); otherwise the dispatcher's weekly rule.
  const next = site.nextRunAt !== undefined ? site.nextRunAt : allows.weekly ? nextFullRunAt(overview.trend) : null;
  const fullRuns = overview.runs.filter((r) => r.status === "done" && r.kind !== "recheck").sort((a, b) => a.createdAt - b.createdAt);
  const log = weekLog(overview, now);
  const pageTitle = new Map(overview.pages.map((p) => [p.pageId, p.title]));
  const lastAsked = overview.runs.find((r) => r.status === "done")?.finishedAt ?? null;

  const meta = [
    site.domain,
    lastAsked ? `last asked ${timeAgo(lastAsked, now)}` : null,
    next ? (next - now < 3_600_000 ? "next run within the hour" : `next run around ${shortDate(next)} (${timeUntil(next, now)})`) : access === "free" ? "free snapshot" : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <ScreenHeader title={site.name} meta={meta} actions={allows.recheck ? <AskAgain siteId={site.siteId} /> : null} />
      <UpgradedNotice overview={overview} />
      {!upgraded && <PublishPrompt overview={overview} />}
      {site.setupError && !run && <SetupRetry overview={overview} />}
      {asking && (
        <Notice tone="you" actions={asking.kind === "snapshot" ? <ButtonLink href={href(`/start?site=${encodeURIComponent(site.siteId)}`)} variant="secondary" size="sm">Watch it live</ButtonLink> : undefined}>
          <span className="inline-flex items-center gap-2"><LiveDot />Asking the assistants now: {asking.done} of {plural(asking.total, "answer")} in. Counts update when the run finishes.</span>
        </Notice>
      )}

      {run ? (
        <>
          <div className="flex flex-col gap-3">
            <CountHeadline run={run} businessName={site.name} />
            {delta && (
              <p className={cx("text-[14px] leading-[22px]", delta.kind === "change" && delta.delta > 0 ? "text-named" : "text-text-3")}>
                {deltaText(delta)}
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <AssistantPanel run={run} baseline={fullRuns.length === 1 ? `Baseline · ${shortDate(run.finishedAt ?? run.createdAt)}. Answers naming you, of the answers each gave.` : null} />
            <Panel title="Answers naming you, run by run" description={overview.trend.length > 1 ? "Full runs, oldest to newest. Click a run to open its answers." : undefined} className="h-full">
              <TrendChart
                points={overview.trend}
                businessName={site.name}
                onOpenRun={(i) => { const r = fullRuns[i]; if (r) open({ kind: "run", runId: r.runId, title: `Every answer from ${shortDate(r.finishedAt ?? r.createdAt)}`, outcome: "answered" }); }}
                footnote={overview.trend.length === 1 ? (
                  <p className="text-[13px] leading-5 text-text-3">
                    One run so far.{next ? ` Next measurement around ${shortDate(next)}.` : " Re-asking every week is part of the plan."}
                  </p>
                ) : null}
              />
            </Panel>
          </div>
        </>
      ) : !asking && !site.setupError ? (
        <Notice actions={<ButtonLink href={href(`/start?site=${encodeURIComponent(site.siteId)}`)} size="sm">Open setup</ButtonLink>}>
          No finished run yet. Your snapshot appears here when the first hour is done.
        </Notice>
      ) : null}

      <Panel title="Latest citations" description="Answers that cited one of your pages, each with the full answer."
        action={overview.citations.length ? <Link href={href("/dashboard/citations")} className="text-[13px] font-medium text-text-3 hover:text-text">View all</Link> : null}>
        {overview.citations.length ? (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {overview.citations.slice(0, 4).map((c) => (
              <li key={c.citationId}><CitationCard citation={c} pageTitle={c.pageId ? pageTitle.get(c.pageId) ?? null : null} business={{ name: site.name, domain: site.domain }} /></li>
            ))}
          </ul>
        ) : (
          <EmptyCitations overview={overview} />
        )}
      </Panel>

      <Panel title="This week" description="What Pentra did in the last seven days, from its records.">
        {log.length ? (
          <ol className="flex flex-col">
            {log.slice(0, 10).map((entry, i) => (
              <li key={`${entry.at}-${i}`} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-border py-2.5 text-[14px] leading-[22px] last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)]">
                <time className="mono-label pt-0.5 text-text-3">{shortDate(entry.at)}</time>
                <span className={cx(entry.tone === "named" ? "text-text" : entry.tone === "wrong" ? "text-text" : "text-text-2")}>
                  {entry.tone && entry.tone !== "neutral" && (
                    <span aria-hidden="true" className={cx("mr-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full", entry.tone === "named" ? "bg-named" : "bg-wrong")} />
                  )}
                  {entry.href ? <Link href={href(entry.href)} className="hover:underline hover:decoration-border-strong hover:underline-offset-2">{entry.text}</Link> : entry.text}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[14px] leading-[22px] text-text-3">Nothing new this week. {access === "free" ? "Weekly runs, new questions and published pages are part of the plan." : "The next run is listed above."}</p>
        )}
      </Panel>
    </>
  );
}

/** The first hour couldn't start: what happened, and a Try again that starts it over (confirmSetup). */
function SetupRetry({ overview }: { overview: Overview }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.confirmSetup({ siteId: overview.site.siteId, competitors: overview.site.competitors, country: overview.site.country });
      toast("Started again. The questions appear in a few minutes.", "success");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't start again. Try in a minute."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <InlineError title="The first hour couldn't start"
      actions={<Button variant="secondary" size="sm" onClick={retry} loading={busy} loadingLabel="Starting…">Try again</Button>}>
      {overview.site.setupError}{error && <span className="mt-1 block text-text">{error}</span>}
    </InlineError>
  );
}

function AskAgain({ siteId }: { siteId: string }) {
  const actions = useAnswersActions();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      await actions.runNow({ siteId });
      toast("Asking every question again. Counts update when the run finishes.", "success");
    } catch (e) {
      setError(userErrorMessage(e, "Pentra couldn't start a run. Try again later."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button variant="secondary" onClick={ask} loading={busy} loadingLabel="Starting…" icon={<RotateCw className="h-4 w-4" strokeWidth={1.5} />}>Ask again now</Button>
      {error && <p role="alert" className="max-w-[320px] text-[13px] leading-5 text-wrong sm:text-right">{error}</p>}
    </div>
  );
}

/** Back from checkout: the plan is active (or still activating) and the free hour's drafts publish within the hour. */
function UpgradedNotice({ overview }: { overview: Overview }) {
  const params = useSearchParams();
  const router = useRouter();
  const href = useAppHref();
  const upgraded = params.get("upgraded") === "1";
  // The site's connection is read only when it's needed (it isn't light).
  const destination = useDestination(overview.site.siteId, upgraded && overview.access !== "free" ? overview.site.publishing : undefined);
  if (!upgraded) return null;
  const drafts = overview.pages.filter((p) => p.status === "draft" || p.status === "publish_failed").length;
  const dismiss = () => router.replace(href("/dashboard"), { scroll: false });
  if (overview.access === "free") {
    return (
      <Notice tone="you" actions={<Button variant="ghost" size="sm" onClick={dismiss}>Dismiss</Button>}>
        <span className="inline-flex items-center gap-2"><LiveDot />Activating your plan. This usually takes under a minute; this page updates by itself.</span>
      </Notice>
    );
  }
  const where = destination.kind === "site" || destination.kind === "hosted" ? ` to ${destination.label}` : "";
  return (
    <div role="status" className="flex flex-col gap-4 rounded-card border border-named/30 bg-named-tint px-5 py-4 sm:flex-row sm:items-center">
      <CheckCircle2 aria-hidden="true" className="h-5 w-5 shrink-0 text-named" strokeWidth={1.5} />
      <div className="min-w-0 flex-1 text-[14px] leading-[22px] text-text-2">
        <p className="font-medium text-text">You&apos;re on Pentra.</p>
        <p>
          {drafts > 0 ? `Your ${plural(drafts, "draft page")} from the free hour publish${where} automatically within the hour.` : "New pages publish as they're written."}
          {destination.kind === "none" && " Choose where they publish first."} Pentra asks the assistants again every week.
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {destination.kind === "none" && <ButtonLink href={href("/dashboard/settings#publishing")} size="sm">Choose where pages publish</ButtonLink>}
        <Button variant="ghost" size="sm" onClick={dismiss}>Dismiss</Button>
      </div>
    </div>
  );
}

/** On the plan with nowhere to publish: the one thing to do next. */
function PublishPrompt({ overview }: { overview: Overview }) {
  const href = useAppHref();
  const destination = useDestination(overview.site.siteId, overview.access === "free" ? undefined : overview.site.publishing);
  if (overview.access === "free" || destination.kind !== "none") return null;
  const waiting = overview.pages.filter((p) => p.status === "draft" || p.status === "publish_failed").length;
  return (
    <Notice tone="you" actions={<ButtonLink href={href("/dashboard/settings#publishing")} size="sm" iconRight={<ArrowRight className="h-4 w-4" strokeWidth={1.5} />}>Connect where pages publish</ButtonLink>}>
      <span className="font-medium text-text">Connect where pages publish.</span>{" "}
      {waiting > 0 ? `${plural(waiting, "page")} ${waiting === 1 ? "is" : "are"} ready. ` : ""}
      WordPress, Webflow, Shopify, Ghost, GitHub, a webhook, or answers.{overview.site.domain} with one DNS record.
    </Notice>
  );
}

function EmptyCitations({ overview }: { overview: Overview }) {
  const href = useAppHref();
  const published = overview.pages.filter((p) => p.status === "published").length;
  return (
    <div className="rounded-card border border-dashed border-border-strong px-5 py-8 text-center">
      <p className="text-[14px] font-medium text-text">Citations you win will appear here, each with the exact answer.</p>
      <p className="mx-auto mt-1.5 max-w-md text-[14px] leading-[22px] text-text-3">
        {published > 0
          ? `Pages usually need to be found by search engines first; ${plural(published, "page")} ${published === 1 ? "is" : "are"} live so far.`
          : overview.access === "free" ? "Citations come from published pages, which are part of the plan." : "Your first published page goes live after setup."}
      </p>
      <div className="mt-4 flex justify-center">
        {overview.access === "free" ? (
          <ButtonLink href={href("/dashboard/billing")} size="sm">Publish with Pentra</ButtonLink>
        ) : published === 0 ? (
          <ButtonLink href={href("/dashboard/pages?tab=drafts")} variant="secondary" size="sm">Publish your first page</ButtonLink>
        ) : null}
      </div>
    </div>
  );
}

/** One citation as evidence: the answer that cited the page, its assistant and time, with the page in its sources. */
export function CitationCard({ citation, pageTitle, business, variant = "compact" }: { citation: OverviewCitation; pageTitle: string | null; business: { name: string; domain: string }; variant?: "compact" | "default" }) {
  const answer = useAnswersQuery("answerText", { checkId: citation.checkId });
  const open = useEvidence();
  if (answer === undefined) return <Skeleton className="h-44 w-full rounded-card" />;
  if (answer === null) return <p className="rounded-card border border-border px-4 py-6 text-[13px] text-text-3">This answer is no longer stored.</p>;
  const evidence = checkToEvidence(answer, business);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex flex-wrap items-center gap-x-2 text-[12px] leading-4 text-text-3">
        {citation.first && <span className="font-medium text-named">First citation</span>}
        <span className="truncate">{pageTitle ? `Cited “${pageTitle}”` : `Cited ${citation.url.replace(/^https?:\/\//, "")}`}</span>
        <span className="mono-label text-text-4">{shortStamp(citation.at)}</span>
      </p>
      <EvidenceCard answer={evidence} variant={variant} showFooter={variant === "default"} onRaw={() => open({ kind: "check", checkId: citation.checkId })} />
    </div>
  );
}
