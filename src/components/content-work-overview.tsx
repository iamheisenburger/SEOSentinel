"use client";
import { useAction, useConvex, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { contentServiceStatus } from "../lib/content-service-status";
import { AdoptAutopilot, AutopilotSwitch } from "./pentra-setup-choice";
export const money = (value: number | null) => value === null ? "Unknown" : `$${(value / 1_000_000).toFixed(4)}`;
export const shownTime = (value: number, zone = "UTC") => new Intl.DateTimeFormat("en", { timeZone: zone, dateStyle: "medium", timeStyle: "long" }).format(value);
export const fundingCopy = { available: "Internal capacity currently available; every paid admission rechecks it.", blocked: "Admission blocked by the existing spending or entitlement guards.", unknown: "Funding readiness unknown. No extra spending is authorized.", unconfigured: "Provider pricing is not configured. Preparation is not funded." };
export const workLabel = (w: { intent: string; operation?: string }) => w.operation === "rollback" ? "Rollback" : w.operation === "factual_correction" ? "Factual correction" : w.operation === "technical_repair" ? "Broken-link repair" : w.intent === "improve" ? "Page improvement" : "New article";
export const stageLabel = (stage: string) => ({ prepare: "Preparing", review: "Quality review", review_failed: "Revision needed", ready: "Reviewed and ready", publish: "Publishing", verify: "Checking the live page", verified: "Live and verified", failed: "Needs your review" }[stage] ?? "State needs review");

export function ContentWorkOverview({ siteId }: { siteId: Id<"sites"> }) {
  const state = useQuery(api.contentWork.readiness, { siteId });
  if (!state || state.siteId !== siteId) return <p>Loading your content service…</p>;
  const s = state.schedule, zone = s?.timezone ?? "UTC";
  const delivery = contentServiceStatus(state);
  // Customers who set up through the new flow see plain language, not delivery-window internals.
  const simple = Boolean(state.autopilot?.selectable && s?.autopilotSelected);
  // Both new-setup choices (Autopilot and Review first) get plain language.
  const plain = Boolean(state.autopilot?.selectable && (s?.autopilotSelected || s?.ownerReviewedOnly));
  const upcoming = state.work.filter(w => !["verified", "failed"].includes(w.stage)).sort((a, b) => a.deadlineAt - b.deadlineAt).slice(0, 5);
  const verified = state.work.filter(w => w.stage === "verified").sort((a, b) => (b.verifiedAt ?? 0) - (a.verifiedAt ?? 0)).slice(0, 5);
  return <div className="space-y-5" aria-label="Content service overview">
    <header><h1 className="text-xl font-semibold">Pentra for {state.destination.domain}</h1><p>{state.profile.name}</p><Link className="underline text-sm" href="/settings#content-service-heading">Service settings</Link></header>
    {state.autopilot?.selectable && state.plan && (s?.ownerReviewedOnly || s?.autopilotSelected) &&
      <AutopilotSwitch siteId={siteId} reviewToken={state.reviewToken} on={Boolean(state.autopilot.on)} intervalMs={state.plan.autopilotIntervalMs}
        reviewAvailable={state.autopilot.reviewAvailable ?? true} paused={Boolean(s?.paused)} />}
    {state.autopilot?.adoptable && state.plan && state.bindingCurrent && state.destination.verified && state.entitlement &&
      <AdoptAutopilot siteId={siteId} reviewToken={state.reviewToken} intervalMs={state.plan.autopilotIntervalMs} articlesPerMonth={state.plan.articlesPerMonth} />}
    {state.autopilot?.on && s && !s.paused && s.nextDeadlineAt > state.funding.checkedAt &&
      <p className="text-sm">Next article is scheduled for {shownTime(s.nextDeadlineAt, zone)}.</p>}
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-xl border border-white/10 p-5 space-y-2"><h2 className="font-medium">Upcoming work</h2>
        {s?.ownerReviewedOnly ? <p>Request, review and publish from <Link className="underline" href="/articles">Articles</Link>. Nothing publishes automatically.</p>
          : simple ? <p>{upcoming.length ? "Pentra is preparing your next articles." : "Pentra will start preparing your next article shortly."}</p>
          : <p>{delivery.label}. Articles ready to publish: {state.complete ? `${state.ready} of 2` : "unknown (history incomplete)"}.</p>}
        {s && !s.ownerReviewedOnly && !simple && <p>Next delivery due: {shownTime(s.nextDeadlineAt, zone)} ({zone}). {s.nextDeadlineAt < state.funding.checkedAt && <span role="alert">Overdue. The missed deadline stays on record.</span>}</p>}
        {!upcoming.length && !s?.ownerReviewedOnly && !simple && <p>No upcoming item is prepared yet.</p>}
        <ul className="space-y-2 text-sm">{upcoming.map(w => <li key={w.jobId}>{workLabel(w)} · {stageLabel(w.stage)}{simple ? "" : ` · due ${shownTime(w.deadlineAt, zone)}`}</li>)}</ul>
      </section>
      <section className="rounded-xl border border-white/10 p-5 space-y-2"><h2 className="font-medium">{plain ? "Published articles" : "Verified changes"}</h2>
        {(state.published ?? []).length > 0 && <ul className="space-y-1 text-sm" aria-label="Recently published">{(state.published ?? []).map(a => <li key={a.articleId}>
          <Link className="underline" href={`/articles/${a.articleId}`}>{a.title}</Link>{a.publishedAt && <> · {shownTime(a.publishedAt, zone)}</>}{a.verified ? " · live" : " · checking the live page"}
          {a.url && <> · <a className="underline" href={a.url} target="_blank" rel="noreferrer">View on your site</a></>}</li>)}</ul>}
        {(state.published ?? []).length === 0 && (plain ? !verified.length && <p>Your first published article will appear here once Pentra confirms it&apos;s live.</p> : s?.ownerReviewedOnly ? <p><Link className="underline" href="/articles">View reviewed drafts and publication status</Link>. A page counts as delivered only after live verification.</p> : !verified.length && <p>No live changes verified yet. Preparation and monitoring are not publications.</p>)}
        <ul className="space-y-2 text-sm">{verified.filter(w => !(state.published ?? []).some(a => a.articleId === w.articleId)).map(w => <li key={w.jobId}>{workLabel(w)}{w.articleId && <> · <Link className="underline" href={`/articles/${w.articleId}`}>View article</Link></>}{w.publishedAt && <p>Published {shownTime(w.publishedAt, zone)}</p>}{w.verifiedAt && <p>Verified {shownTime(w.verifiedAt, zone)}</p>}</li>)}</ul>
      </section>
    </div>
    {plain && <UpcomingTopics siteId={siteId} />}
    <OrganicOutcome key={siteId} siteId={siteId} simple={plain} />
    <SiteHealth siteId={siteId} />
    {(!plain || !state.entitlement || !state.destination.verified || !state.bindingCurrent || state.funding.status !== "available" || state.work.some(w => w.failure && !w.retiredAt && !w.superseded && !w.parked && !(state.published ?? []).some(a => a.articleId === w.articleId))) &&
    <section className="rounded-xl border border-white/10 p-5 space-y-2"><h2 className="font-medium">Needs attention</h2>
      {!state.entitlement && <p role="alert">Verify your existing plan in <Link href="/settings/billing" className="underline">Billing</Link>.</p>}
      {!state.destination.verified && <p role="alert">Publishing destination verification required.</p>}
      {!state.bindingCurrent && <p role="alert">Business or destination changed. <Link className="underline" href="/settings#changed-content-setup">Review changed setup</Link> to replace stale unstarted work safely. Existing costs and deadlines remain.</p>}
      {state.approvalRequired && !s?.ownerReviewedOnly && <p role="alert">Automatic publication consent is not active.</p>}
      {state.funding.status !== "available" && !delivery.systemFailure && <p role="alert">{plain
        ? state.funding.status === "blocked" ? "Pentra has used this month's writing capacity for your plan. New articles resume next month, or upgrade in Plans & billing for more."
          : "Pentra can't start new articles right now. Your published articles are not affected."
        : state.funding.reason ?? fundingCopy[state.funding.status]}</p>}
      {!state.complete && !plain && <p role="alert">Work history is incomplete. No clean-health claim is possible.</p>}
      {state.work.filter(w => w.failure && !w.retiredAt && !w.superseded && !w.parked && !(state.published ?? []).some(a => a.articleId === w.articleId)).map(w => plain
        ? <p role="alert" key={w.jobId}>{workLabel(w)}: {w.failure} {w.articleId && <Link className="underline" href={`/articles/${w.articleId}`}>Open draft</Link>}</p>
        : <div role="alert" key={w.jobId}>{workLabel(w)}: {w.failure} <details><summary>Technical details</summary>{w.jobId}{w.technicalReason && <p>{w.technicalReason}</p>}</details></div>)}
      {!plain && <p className="text-sm">Delivery acceptance and organic growth are separate. A successful API response alone is not verification.</p>}
    </section>}
  </div>;
}
function OrganicOutcome({ siteId, simple = false }: { siteId: Id<"sites">; simple?: boolean }) {
  // Daily Search Console data does not need a live subscription to every site
  // update. This query reads two complete windows; refreshing it on unrelated
  // scheduler writes repeatedly rereads those rows while the dashboard is open.
  const convex = useConvex();
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{ siteId: string; refresh: number; result?: FunctionReturnType<typeof api.searchPerformance.contentOutcome>; error?: boolean }>();
  const current = snapshot?.siteId === siteId && snapshot.refresh === refresh ? snapshot : undefined;
  const result = current?.result, error = current?.error, pending = !current;
  useEffect(() => {
    let active = true;
    void convex.query(api.searchPerformance.contentOutcome, { siteId }).then(
      value => { if (active) setSnapshot({ siteId, refresh, result: value }); },
      () => { if (active) setSnapshot({ siteId, refresh, error: true }); },
    );
    return () => { active = false; };
  }, [convex, siteId, refresh]);
  return <section className="rounded-xl border border-white/10 p-5 space-y-2"><h2 className="font-medium">Organic clicks</h2>
    <button type="button" className="text-sm underline disabled:opacity-50" disabled={pending} onClick={() => setRefresh(value => value + 1)}>Refresh measurements</button>
    <p className="text-sm">Loaded when you open this page. Refresh to check for newer Search Console data.</p>
    {error ? <p role="alert">Measurements could not be loaded. Refresh to retry; this is not a zero-click result.</p> : !result ? <p>Loading measurements…</p> : result.status !== "available" || !result.current ? <p>{result.status === "not_connected" ? <>Connect Google Search Console to see clicks, rankings and what Pentra&apos;s work changed. <a className="underline" href={`/api/gsc/auth?siteId=${siteId}`} target="gsc-oauth">Connect Search Console</a></> : result.status === "incomplete" ? "The measurement window is incomplete. Clicks are unavailable, not zero." : "No finalized measurements yet. Google data can arrive late."}</p> : <>
      <p>{result.current.clicks} clicks · {result.current.start}–{result.current.end}. {result.delayed && "Data is delayed."}</p>
      <p>{result.previous ? `Previous complete window: ${result.previous.clicks} clicks (${result.previous.start}–${result.previous.end}); change ${result.current.clicks - result.previous.clicks} clicks.` : "No complete previous window; no comparison is shown."}</p>
      {!simple && <p className="text-sm">Property: {result.property}. Search Console calendar dates. New-page cohorts start on the first full day after publication.</p>}
      {result.cohorts === null ? <p>New-page inventory is incomplete.</p> : !result.cohorts.length ? <p>No newly published pages in this window.</p> : <ul>{result.cohorts.map(p => <li key={p.articleId}>{p.title}: {p.clicks === null ? "Awaiting a complete post-publication day" : `${p.clicks} clicks since ${p.start}`}</li>)}</ul>}
    </>}
    {!simple && <p className="text-sm">Observed clicks do not prove Pentra caused the change. Monitoring without an edit is not a completed improvement.</p>}
  </section>;
}

/** What Autopilot will write next, so a hands-off customer can see and steer it. */
function UpcomingTopics({ siteId }: { siteId: Id<"sites"> }) {
  const topics = useQuery(api.topics.listBySite, { siteId });
  const next = (topics ?? []).filter(t => !["used", "queued", "cannibalizing", "disqualified"].includes(t.status ?? ""))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 3);
  return <section className="rounded-xl border border-white/10 p-5 space-y-2" aria-labelledby="upcoming-topics-heading">
    <h2 id="upcoming-topics-heading" className="font-medium">Coming up next</h2>
    {topics === undefined ? <p className="text-sm">Loading…</p> : next.length === 0
      ? <p className="text-sm">Pentra is researching topics your customers search for. They&apos;ll appear here.</p>
      : <ol className="list-decimal space-y-1 pl-5 text-sm">{next.map(t => <li key={t._id}>{t.label} <span className="text-[#8B8FA3]">· “{t.primaryKeyword}”</span></li>)}</ol>}
    <Link className="text-sm underline" href="/plan">See or change all topics</Link>
  </section>;
}

function SiteHealth({ siteId }: { siteId: Id<"sites"> }) {
  const check = useQuery(api.siteHealth.latest, { siteId });
  const run = useAction(api.actions.siteHealth.run);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const issues = (check?.pages ?? []).flatMap(p => p.issues.map(i => ({ ...i, url: p.url })))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1)).slice(0, 8);
  return <section className="rounded-xl border border-white/10 p-5 space-y-2" aria-labelledby="site-health-heading">
    <h2 id="site-health-heading" className="font-medium">Site health</h2>
    {check === undefined ? <p>Loading…</p> : check === null ? <p className="text-sm">Pentra checks your important pages weekly: can Google reach them, are titles and descriptions right, is anything hidden from search.</p> : <>
      <p>Score {check.score}/100 across {check.pages.length} page{check.pages.length === 1 ? "" : "s"} · checked {shownTime(check.checkedAt)}</p>
      {check.error && <p role="alert">{check.error}</p>}
      {issues.length === 0 ? <p className="text-sm">No problems found on the pages checked.</p> :
        <ul className="list-disc space-y-1 pl-5 text-sm">{issues.map((i, n) => <li key={n}><span className={i.severity === "critical" ? "text-red-400" : "text-[#F59E0B]"}>{i.severity === "critical" ? "Fix now" : "Improve"}:</span> {i.message} <span className="text-[#8B8FA3]">({new URL(i.url).pathname})</span></li>)}</ul>}
    </>}
    <button type="button" className="text-sm underline disabled:opacity-50" disabled={busy} onClick={async () => {
      setBusy(true); setMessage("");
      try { const result = await run({ siteId }); setMessage(result.skipped ? "Checked in the last 10 minutes; showing the latest result." : "Check complete."); }
      catch { setMessage("The check couldn't run. Try again in a few minutes."); }
      finally { setBusy(false); }
    }}>{busy ? "Checking…" : "Check now"}</button>
    {message && <p className="text-sm" role="status">{message}</p>}
  </section>;
}
