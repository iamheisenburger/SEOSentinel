"use client";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { contentServiceStatus } from "../lib/content-service-status";
export const money = (value: number | null) => value === null ? "Unknown" : `$${(value / 1_000_000).toFixed(4)}`;
export const shownTime = (value: number, zone = "UTC") => new Intl.DateTimeFormat("en", { timeZone: zone, dateStyle: "medium", timeStyle: "long" }).format(value);
export const fundingCopy = { available: "Internal capacity currently available; every paid admission rechecks it.", blocked: "Admission blocked by the existing spending or entitlement guards.", unknown: "Funding readiness unknown. No extra spending is authorized.", unconfigured: "Provider pricing is not configured. Preparation is not funded." };
export const workLabel = (w: { intent: string; operation?: string }) => w.operation === "rollback" ? "Rollback" : w.operation === "factual_correction" ? "Factual correction" : w.operation === "technical_repair" ? "Broken-link repair" : w.intent === "improve" ? "Page improvement" : "New article";
export const stageLabel = (stage: string) => ({ prepare: "Preparing", review: "Quality review", review_failed: "Revision needed", ready: "Reviewed and ready", publish: "Publication pending", verify: "Checking the live page", verified: "Live artifact verified", failed: "Failed — needs attention" }[stage] ?? "State needs review");

export function ContentWorkOverview({ siteId }: { siteId: Id<"sites"> }) {
  const state = useQuery(api.contentWork.readiness, { siteId });
  if (!state || state.siteId !== siteId) return <p>Loading your content service…</p>;
  const s = state.schedule, zone = s?.timezone ?? "UTC";
  const delivery = contentServiceStatus(state);
  const upcoming = state.work.filter(w => !["verified", "failed"].includes(w.stage)).sort((a, b) => a.deadlineAt - b.deadlineAt).slice(0, 5);
  const verified = state.work.filter(w => w.stage === "verified").sort((a, b) => (b.verifiedAt ?? 0) - (a.verifiedAt ?? 0)).slice(0, 5);
  return <div className="space-y-5" aria-label="Content service overview">
    <header><h1 className="text-xl font-semibold">Your content service</h1><p>{state.profile.name} · {state.destination.domain}</p><Link className="underline text-sm" href="/settings#content-service-heading">Setup, funding, schedule and page permissions</Link></header>
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border border-white/10 p-5 space-y-2"><h2 className="font-medium">Upcoming work</h2>
        <p>{delivery.label}. Ready buffer: {state.complete ? `${state.ready}/2` : "Unknown: incomplete inventory"}.</p>
        {s && <p>Fixed window: {shownTime(s.nextDeadlineAt - 300_000, zone)}–{shownTime(s.nextDeadlineAt, zone)} ({zone}). {s.nextDeadlineAt < state.funding.checkedAt && <span role="alert">Overdue. The original deadline is retained.</span>}</p>}
        {!upcoming.length && <p>No upcoming item is prepared yet.</p>}
        <ul className="space-y-2 text-sm">{upcoming.map(w => <li key={w.jobId}>{workLabel(w)} · {stageLabel(w.stage)} · due {shownTime(w.deadlineAt, zone)}</li>)}</ul>
      </section>
      <section className="rounded-xl border border-white/10 p-5 space-y-2"><h2 className="font-medium">Verified changes</h2>
        {!verified.length && <p>No live changes verified yet. Preparation and monitoring are not publications.</p>}
        <ul className="space-y-2 text-sm">{verified.map(w => <li key={w.jobId}>{workLabel(w)}{w.articleId && <> · <Link className="underline" href={`/articles/${w.articleId}`}>View artifact</Link></>}{w.publishedAt && <p>Published {shownTime(w.publishedAt, zone)}</p>}{w.verifiedAt && <p>Verified {shownTime(w.verifiedAt, zone)}</p>}</li>)}</ul>
      </section>
    </div>
    <OrganicOutcome key={siteId} siteId={siteId} />
    <section className="rounded-xl border border-white/10 p-5 space-y-2"><h2 className="font-medium">Needs attention</h2>
      {!state.entitlement && <p role="alert">Verify your existing plan in <Link href="/settings/billing" className="underline">Billing</Link>.</p>}
      {!state.destination.verified && <p role="alert">Publishing destination verification required.</p>}
      {!state.bindingCurrent && <p role="alert">Business or destination changed. <Link className="underline" href="/settings#changed-content-setup">Review changed setup</Link> to replace stale unstarted work safely. Existing costs and deadlines remain.</p>}
      {state.approvalRequired && <p role="alert">Automatic publication consent is not active.</p>}
      {state.funding.status !== "available" && !delivery.systemFailure && <p role="alert">{state.funding.reason ?? fundingCopy[state.funding.status]}</p>}
      {!state.complete && <p role="alert">Work history is incomplete. No clean-health claim is possible.</p>}
      {state.work.filter(w => w.failure && !w.retiredAt).map(w => <div role="alert" key={w.jobId}>{workLabel(w)}: {w.failure} <details><summary>Technical details</summary>{w.jobId}{w.technicalReason && <p>{w.technicalReason}</p>}</details></div>)}
      <p className="text-sm">Delivery acceptance and organic growth are separate. A successful API response alone is not verification.</p>
    </section>
  </div>;
}
function OrganicOutcome({ siteId }: { siteId: Id<"sites"> }) {
  const result = useQuery(api.searchPerformance.contentOutcome, { siteId });
  return <section className="rounded-xl border border-white/10 p-5 space-y-2"><h2 className="font-medium">Organic clicks</h2>
    {!result ? <p>Loading measurements…</p> : result.status !== "available" || !result.current ? <p>{result.status === "not_connected" ? "Connect the current website’s Search Console property to measure results." : result.status === "incomplete" ? "The measurement window is incomplete. Clicks are unavailable, not zero." : "No finalized measurements yet. Google data can arrive late."}</p> : <>
      <p>{result.current.clicks} clicks · {result.current.start}–{result.current.end}. {result.delayed && "Data is delayed."}</p>
      <p>{result.previous ? `Previous complete window: ${result.previous.clicks} clicks (${result.previous.start}–${result.previous.end}); change ${result.current.clicks - result.previous.clicks} clicks.` : "No complete previous window; no comparison is shown."}</p>
      <p className="text-sm">Property: {result.property}. Search Console calendar dates. New-page cohorts start on the first full day after publication.</p>
      {result.cohorts === null ? <p>New-page inventory is incomplete.</p> : !result.cohorts.length ? <p>No newly published pages in this window.</p> : <ul>{result.cohorts.map(p => <li key={p.articleId}>{p.title}: {p.clicks === null ? "Awaiting a complete post-publication day" : `${p.clicks} clicks since ${p.start}`}</li>)}</ul>}
    </>}
    <p className="text-sm">Observed clicks do not prove Pentra caused the change. Monitoring without an edit is not a completed improvement.</p>
  </section>;
}
