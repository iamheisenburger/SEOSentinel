"use client";
import { useAction, useConvex, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { contentServiceStatus, fundingMessage } from "../lib/content-service-status";
import { AdoptAutopilot, AutopilotSwitch } from "./pentra-setup-choice";
export const money = (value: number | null) => value === null ? "Unknown" : `$${(value / 1_000_000).toFixed(4)}`;
export const shownTime = (value: number, zone = "UTC") => new Intl.DateTimeFormat("en", { timeZone: zone, dateStyle: "medium", timeStyle: "long" }).format(value);
export const fundingCopy = { available: "Internal capacity currently available; every paid admission rechecks it.", blocked: "Admission blocked by the existing spending or entitlement guards.", unknown: "Funding readiness unknown. No extra spending is authorized.", unconfigured: "Provider pricing is not configured. Preparation is not funded." };
export const workLabel = (w: { intent: string; operation?: string }) => w.operation === "rollback" ? "Rollback" : w.operation === "factual_correction" ? "Factual correction" : w.operation === "technical_repair" ? "Broken-link repair" : w.intent === "improve" ? "Page improvement" : "New article";
export const stageLabel = (stage: string) => ({ prepare: "Preparing", review: "Quality review", review_failed: "Revision needed", ready: "Reviewed and ready", publish: "Publishing", verify: "Checking the live page", verified: "Live and verified", failed: "Needs your review" }[stage] ?? "State needs review");

/** Friendly date for customers: "Thu, Sep 25, 6:19 PM". */
export const friendlyTime = (value: number, zone = "UTC") =>
  new Intl.DateTimeFormat("en", { timeZone: zone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(value);
const CARD = "rounded-xl border border-white/[0.06] bg-[#0F1117] p-5 space-y-3";
const H2 = "text-[15px] font-semibold text-[#EDEEF1]";
const BODY = "text-[14px] leading-relaxed text-[#8B8FA3]";

export function ContentWorkOverview({ siteId }: { siteId: Id<"sites"> }) {
  const state = useQuery(api.contentWork.readiness, { siteId });
  if (!state || state.siteId !== siteId) return <p className={BODY}>Loading your content service…</p>;
  const s = state.schedule, zone = s?.timezone ?? "UTC";
  const delivery = contentServiceStatus(state);
  // Customers who set up through the new flow see plain language, not delivery-window internals.
  const simple = Boolean(state.autopilot?.selectable && s?.autopilotSelected);
  // Both new-setup choices (Autopilot and Review first) get plain language.
  const plain = Boolean(state.autopilot?.selectable && (s?.autopilotSelected || s?.ownerReviewedOnly));
  const when = (value: number) => plain ? friendlyTime(value, zone) : shownTime(value, zone);
  const upcoming = state.work.filter(w => !["verified", "failed"].includes(w.stage)).sort((a, b) => a.deadlineAt - b.deadlineAt).slice(0, 5);
  const verified = state.work.filter(w => w.stage === "verified").sort((a, b) => (b.verifiedAt ?? 0) - (a.verifiedAt ?? 0)).slice(0, 5);
  const published = state.published ?? [];
  const attention = state.work.filter(w => w.failure && !w.retiredAt && !w.superseded && !w.parked && !published.some(a => a.articleId === w.articleId));
  const tone = delivery.status === "failed" || delivery.status === "changed" ? "bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20"
    : delivery.status === "paused" ? "bg-white/[0.04] text-[#8B8FA3] border-white/10" : "bg-[#22C55E]/10 text-[#22C55E] border-[#22C55E]/20";
  return <div className="space-y-5" aria-label="Content service overview">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-[#EDEEF1]">Pentra for {state.destination.domain}</h1>
        <p className="mt-1 text-[13px] text-[#8B8FA3]">{state.profile.name}</p>
      </div>
      <div className="flex items-center gap-3">
        <span className={`rounded-full border px-2.5 py-1 text-[12px] font-medium ${tone}`}>{delivery.label}</span>
        <Link className="text-[13px] text-[#0EA5E9] hover:underline" href="/settings#content-service-heading">Service settings</Link>
      </div>
    </header>
    {state.autopilot?.selectable && state.plan && (s?.ownerReviewedOnly || s?.autopilotSelected) &&
      <AutopilotSwitch siteId={siteId} reviewToken={state.reviewToken} on={Boolean(state.autopilot.on)} intervalMs={state.plan.autopilotIntervalMs}
        reviewAvailable={state.autopilot.reviewAvailable ?? true} paused={Boolean(s?.paused)}
        cadencePerWeek={state.plan.cadencePerWeek ?? null} articlesPerMonth={state.plan.articlesPerMonth} />}
    {state.autopilot?.adoptable && state.plan && state.bindingCurrent && state.destination.verified && state.entitlement &&
      <AdoptAutopilot siteId={siteId} reviewToken={state.reviewToken} intervalMs={state.plan.autopilotIntervalMs} articlesPerMonth={state.plan.articlesPerMonth} />}
    {state.autopilot?.on && s && !s.paused && s.nextDeadlineAt > state.funding.checkedAt &&
      <p className="text-[14px] text-[#EDEEF1]">Next article is scheduled for <span className="font-medium">{when(s.nextDeadlineAt)}</span>.</p>}
    {plain && state.results && <ResultsStrip siteId={siteId} live={state.results.live} liveThisMonth={state.results.liveThisMonth}
      planPerMonth={state.plan?.articlesPerMonth ?? null} planUsed={state.results.planUsedThisMonth ?? 0} />}
    <div className="grid gap-4 md:grid-cols-2">
      <section className={CARD}><h2 className={H2}>Upcoming work</h2>
        {s?.ownerReviewedOnly ? <p className={BODY}>Request, review and publish from <Link className="text-[#0EA5E9] hover:underline" href="/articles">Articles</Link>. Nothing publishes automatically.</p>
          : simple ? <p className={BODY}>{upcoming.length ? "Pentra is preparing your next articles." : "Pentra will start preparing your next article shortly."}</p>
          : <p className={BODY}>{delivery.label}. Articles ready to publish: {state.complete ? `${state.ready} of 2` : "unknown (history incomplete)"}.</p>}
        {s && !s.ownerReviewedOnly && !simple && <p className={BODY}>Next delivery due: {shownTime(s.nextDeadlineAt, zone)} ({zone}). {s.nextDeadlineAt < state.funding.checkedAt && <span role="alert" className="text-[#F59E0B]">Overdue. The missed deadline stays on record.</span>}</p>}
        {!upcoming.length && !s?.ownerReviewedOnly && !simple && <p className={BODY}>No upcoming item is prepared yet.</p>}
        {upcoming.length > 0 && <ul className="divide-y divide-white/[0.06] text-[14px]">{upcoming.map(w => <li key={w.jobId} className="flex items-center justify-between gap-3 py-2">
          <span className="text-[#EDEEF1]">{workLabel(w)}</span>
          <span className="text-[12px] text-[#8B8FA3]">{stageLabel(w.stage)}{simple ? (w.stage === "ready" ? ` · goes live ${friendlyTime(w.deadlineAt, zone)}` : "") : ` · due ${shownTime(w.deadlineAt, zone)}`}</span></li>)}</ul>}
      </section>
      <section className={CARD}><h2 className={H2}>{plain ? "Published articles" : "Verified changes"}</h2>
        {published.length > 0 && <ul className="divide-y divide-white/[0.06] text-[14px]" aria-label="Recently published">{published.map(a => <li key={a.articleId} className="space-y-1 py-2">
          <Link className="font-medium text-[#EDEEF1] hover:text-[#0EA5E9]" href={`/articles/${a.articleId}`}>{a.title}</Link>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#8B8FA3]">
            {a.publishedAt && <span>{when(a.publishedAt)}</span>}
            <span className={a.verified ? "rounded-full bg-[#22C55E]/10 px-2 py-0.5 text-[#22C55E]" : "rounded-full bg-white/[0.04] px-2 py-0.5"}>{a.verified ? "live" : "checking the live page"}</span>
            {a.url && <a className="text-[#0EA5E9] hover:underline" href={a.url} target="_blank" rel="noreferrer">View on your site</a>}
          </div></li>)}</ul>}
        {published.length === 0 && (plain ? !verified.length && <p className={BODY}>Your first published article will appear here once Pentra confirms it&apos;s live.</p> : s?.ownerReviewedOnly ? <p className={BODY}><Link className="text-[#0EA5E9] hover:underline" href="/articles">View reviewed drafts and publication status</Link>. A page counts as delivered only after live verification.</p> : !verified.length && <p className={BODY}>No live changes verified yet. Preparation and monitoring are not publications.</p>)}
        <ul className="space-y-2 text-[14px]">{verified.filter(w => !published.some(a => a.articleId === w.articleId)).map(w => <li key={w.jobId}>{workLabel(w)}{w.articleId && <> · <Link className="text-[#0EA5E9] hover:underline" href={`/articles/${w.articleId}`}>View article</Link></>}{w.publishedAt && <p className="text-[12px] text-[#8B8FA3]">Published {shownTime(w.publishedAt, zone)}</p>}{w.verifiedAt && <p className="text-[12px] text-[#8B8FA3]">Verified {shownTime(w.verifiedAt, zone)}</p>}</li>)}</ul>
      </section>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      {plain && <UpcomingTopics siteId={siteId} />}
      <SiteHealth siteId={siteId} />
    </div>
    <OrganicOutcome key={siteId} siteId={siteId} simple={plain} />
    {(!plain || !state.entitlement || !state.destination.verified || !state.bindingCurrent || state.funding.status !== "available" || attention.length > 0) &&
    <section className={`${CARD} border-[#F59E0B]/20`}><h2 className={H2}>Needs attention</h2>
      <div className="space-y-2 text-[14px] text-[#EDEEF1]">
      {!state.entitlement && <p role="alert">Verify your existing plan in <Link href="/settings/billing" className="text-[#0EA5E9] hover:underline">Billing</Link>.</p>}
      {!state.destination.verified && <p role="alert">Publishing destination verification required.</p>}
      {!state.bindingCurrent && <p role="alert">Business or destination changed. <Link className="text-[#0EA5E9] hover:underline" href="/settings#changed-content-setup">Review changed setup</Link> to replace stale unstarted work safely. Existing costs and deadlines remain.</p>}
      {state.approvalRequired && !s?.ownerReviewedOnly && <p role="alert">Automatic publication consent is not active.</p>}
      {state.funding.status !== "available" && !delivery.systemFailure && <p role="alert">{plain
        ? fundingMessage(state.funding, zone)
        : state.funding.reason ?? fundingCopy[state.funding.status]}</p>}
      {!state.complete && !plain && <p role="alert">Work history is incomplete. No clean-health claim is possible.</p>}
      {attention.map(w => plain
        ? <p role="alert" key={w.jobId}>{workLabel(w)}: {w.failure} {w.articleId && <Link className="text-[#0EA5E9] hover:underline" href={`/articles/${w.articleId}`}>Open draft</Link>}</p>
        : <div role="alert" key={w.jobId}>{workLabel(w)}: {w.failure} <details className="text-[12px] text-[#8B8FA3]"><summary>Technical details</summary>{w.jobId}{w.technicalReason && <p>{w.technicalReason}</p>}</details></div>)}
      {!plain && <p className="text-[13px] text-[#8B8FA3]">Delivery acceptance and organic growth are separate. A successful API response alone is not verification.</p>}
      </div>
    </section>}
  </div>;
}
const clicks = (n: number) => `${n} click${n === 1 ? "" : "s"}`;
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
  const delta = result?.current && result.previous ? result.current.clicks - result.previous.clicks : null;
  return <section className={CARD}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className={H2}>Organic clicks</h2>
      <button type="button" className="text-[13px] text-[#0EA5E9] hover:underline disabled:opacity-50" disabled={pending} onClick={() => setRefresh(value => value + 1)}>Refresh measurements</button></div>
    <p className="text-[12px] text-[#565A6E]">Loaded when you open this page. Refresh to check for newer Search Console data.</p>
    {error ? <p role="alert" className={BODY}>Measurements could not be loaded. Refresh to retry; this is not a zero-click result.</p> : !result ? <p className={BODY}>Loading measurements…</p> : result.status !== "available" || !result.current ? <p className={BODY}>{result.status === "not_connected" ? <>Connect Google Search Console to see clicks, rankings and what Pentra&apos;s work changed. <a className="font-medium text-[#0EA5E9] hover:underline" href={`/api/gsc/auth?siteId=${siteId}`} target="gsc-oauth">Connect Search Console</a></> : result.status === "incomplete" ? "The measurement window is incomplete. Clicks are unavailable, not zero." : "No finalized measurements yet. Google data can arrive late."}</p> : <>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-semibold tracking-tight text-[#EDEEF1]">{result.current.clicks}</span>{" "}
        <span className="text-[13px] text-[#8B8FA3]">{result.current.clicks === 1 ? "click" : "clicks"} · {result.current.start}–{result.current.end}</span>
        {delta !== null && <span className={`rounded-full px-2 py-0.5 text-[12px] ${delta >= 0 ? "bg-[#22C55E]/10 text-[#22C55E]" : "bg-[#F59E0B]/10 text-[#F59E0B]"}`}>{delta >= 0 ? "+" : ""}{delta} vs previous</span>}
        {result.delayed && <span className="text-[12px] text-[#8B8FA3]">Data is delayed.</span>}
      </div>
      <p className={BODY}>{result.previous ? `Previous complete window: ${clicks(result.previous.clicks)} (${result.previous.start}–${result.previous.end}); change ${result.current.clicks - result.previous.clicks >= 0 ? "+" : ""}${result.current.clicks - result.previous.clicks}.` : "No complete previous window; no comparison is shown."}</p>
      {!simple && <p className="text-[13px] text-[#8B8FA3]">Property: {result.property}. Search Console calendar dates. New-page cohorts start on the first full day after publication.</p>}
      {result.cohorts === null ? <p className={BODY}>New-page inventory is incomplete.</p> : !result.cohorts.length ? <p className={BODY}>No newly published pages in this window.</p> : <>
        <ul className="divide-y divide-white/[0.06] text-[14px]">{[...result.cohorts].sort((a, b) => (b.clicks ?? -1) - (a.clicks ?? -1)).slice(0, simple ? 5 : 10).map(p => <li key={p.articleId} className="flex justify-between gap-3 py-2"><span className="text-[#EDEEF1]">{p.title}</span><span className="shrink-0 text-[12px] text-[#8B8FA3]">{p.clicks === null ? "Awaiting a complete post-publication day" : `${clicks(p.clicks)} since ${p.start}`}</span></li>)}</ul>
        {result.cohorts.length > (simple ? 5 : 10) && <p className="text-[12px] text-[#565A6E]">and {result.cohorts.length - (simple ? 5 : 10)} more new pages · see Analytics</p>}</>}
    </>}
    {!simple && <p className="text-[13px] text-[#8B8FA3]">Observed clicks do not prove Pentra caused the change. Monitoring without an edit is not a completed improvement.</p>}
  </section>;
}

/** The result at a glance: what is live, how much of the plan is used, how healthy the site is. */
function ResultsStrip({ siteId, live, liveThisMonth, planPerMonth, planUsed }: { siteId: Id<"sites">; live: number; liveThisMonth: number; planPerMonth: number | null; planUsed: number }) {
  const check = useQuery(api.siteHealth.latest, { siteId });
  const tile = (label: string, value: string, hint?: string) => <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] px-4 py-3">
    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#565A6E]">{label}</p>
    <p className="mt-1 text-2xl font-semibold tracking-tight text-[#EDEEF1]">{value}</p>
    {hint && <p className="text-[12px] text-[#8B8FA3]">{hint}</p>}
  </div>;
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3" aria-label="Results at a glance">
    {tile("Articles live", String(live), "published and confirmed on your site")}
    {tile("This month", String(liveThisMonth), planPerMonth ? `published on this site · Autopilot has used ${planUsed} of your ${planPerMonth} monthly articles (all sites)` : "articles published on this site")}
    {tile("Site health", check ? `${check.score}/100` : "—", check ? "latest weekly check" : "first check pending")}
  </div>;
}

/** What Autopilot will write next, so a hands-off customer can see and steer it. */
function UpcomingTopics({ siteId }: { siteId: Id<"sites"> }) {
  const topics = useQuery(api.topics.listBySite, { siteId });
  const next = (topics ?? []).filter(t => !["used", "queued", "cannibalizing", "disqualified"].includes(t.status ?? ""))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).slice(0, 3);
  return <section className={CARD} aria-labelledby="upcoming-topics-heading">
    <h2 id="upcoming-topics-heading" className={H2}>Coming up next</h2>
    {topics === undefined ? <p className={BODY}>Loading…</p> : next.length === 0
      ? <p className={BODY}>Pentra is researching topics your customers search for. They&apos;ll appear here.</p>
      : <ol className="space-y-2 text-[14px]">{next.map((t, n) => <li key={t._id} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0EA5E9]/10 text-[12px] font-semibold text-[#0EA5E9]">{n + 1}</span>
          <span><span className="text-[#EDEEF1]">{t.label.replace(/^./, c => c.toUpperCase())}</span> <span className="text-[12px] text-[#8B8FA3]">“{t.primaryKeyword}”</span></span></li>)}</ol>}
    <Link className="text-[13px] text-[#0EA5E9] hover:underline" href="/plan">See or change all topics</Link>
  </section>;
}

function SiteHealth({ siteId }: { siteId: Id<"sites"> }) {
  const check = useQuery(api.siteHealth.latest, { siteId });
  const run = useAction(api.actions.siteHealth.run);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const issues = (check?.pages ?? []).flatMap(p => p.issues.map(i => ({ ...i, url: p.url })))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1)).slice(0, 8);
  const scoreTone = !check ? "" : check.score >= 90 ? "text-[#22C55E]" : check.score >= 70 ? "text-[#F59E0B]" : "text-red-400";
  return <section className={CARD} aria-labelledby="site-health-heading">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="site-health-heading" className={H2}>Site health</h2>
      <button type="button" className="text-[13px] text-[#0EA5E9] hover:underline disabled:opacity-50" disabled={busy} onClick={async () => {
        setBusy(true); setMessage("");
        try { const result = await run({ siteId }); setMessage(result.skipped ? "Checked in the last 10 minutes; showing the latest result." : "Check complete."); }
        catch { setMessage("The check couldn't run. Try again in a few minutes."); }
        finally { setBusy(false); }
      }}>{busy ? "Checking…" : "Check now"}</button></div>
    {check === undefined ? <p className={BODY}>Loading…</p> : check === null ? <p className={BODY}>Pentra checks your important pages weekly: can Google reach them, are titles and descriptions right, is anything hidden from search, and does every page lead to your next step.</p> : <>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className={`text-3xl font-semibold tracking-tight ${scoreTone}`}>{check.score}</span>{" "}
        <span className="text-[13px] text-[#8B8FA3]">Score {check.score}/100 across {check.pages.length} page{check.pages.length === 1 ? "" : "s"} · checked {shownTime(check.checkedAt)}</span>
      </div>
      {check.error && <p role="alert" className="text-[14px] text-[#F59E0B]">{check.error}</p>}
      {issues.length === 0 ? <p className={BODY}>No problems found on the pages checked.</p> :
        <ul className="space-y-2 text-[14px]">{issues.map((i, n) => <li key={n} className="flex gap-2">
          <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${i.severity === "critical" ? "bg-red-500/10 text-red-400" : "bg-[#F59E0B]/10 text-[#F59E0B]"}`}>{i.severity === "critical" ? "Fix now" : "Improve"}</span>
          <span className="text-[#EDEEF1]">{i.message} <span className="text-[12px] text-[#8B8FA3]">({new URL(i.url).pathname})</span></span></li>)}</ul>}
    </>}
    {message && <p className="text-[13px] text-[#8B8FA3]" role="status">{message}</p>}
  </section>;
}
