"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { fundingCopy, money, workLabel, stageLabel, shownTime } from "./content-work-overview";
import { ExactPageControls } from "./content-work-corrections";
import { PUBLISHER_AUTOPUBLISH_CONSENT_TEXT } from "../../convex/lib/publisherProvisioning";
import { contentServiceStatus, fundingMessage } from "../lib/content-service-status";
import { AutopilotSwitch, PentraSetupChoice } from "./pentra-setup-choice";

export function ContentWorkService({ siteId }: { siteId: Id<"sites"> }) {
  const state = useQuery(api.contentWork.readiness, { siteId });
  const select = useMutation(api.contentWork.selectServiceMode);
  const control = useMutation(api.contentWork.control);
  const reconfirm = useMutation(api.contentWork.reconfirm);
  const [chosenMode, setMode] = useState<"legacy_articles" | "growth_first" | null>(null);
  const mode = chosenMode ?? (state?.setupPending ? "growth_first" : state?.serviceMode ?? "legacy_articles");
  const ownerSetup = Boolean(state?.setupPending && (state.destination.kind === "github" || state.destination.kind === "wordpress"));
  const [confirmed, setConfirmed] = useState(false), [deadline, setDeadline] = useState("");
  const [confirmedReview, setConfirmedReview] = useState("");
  const [hours, setHours] = useState("24"), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [switchResult, setSwitchResult] = useState<{ status: string; issues: { action: string; articleId?: string; until?: number }[] } | null>(null);
  const save = async () => {
    if (mode === "growth_first" && confirmedReview !== state?.reviewToken) return;
    setSaving(true); setError("");
    try {
      const result = await select({ siteId, mode, confirmBusinessProfile: confirmed, ownerReviewedOnly: ownerSetup && mode === "growth_first", authorizeAutomaticPublication: !ownerSetup && mode === "growth_first" && confirmed, reviewToken: state!.reviewToken, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(mode === "growth_first" && !ownerSetup ? { firstDeadlineAt: new Date(deadline).getTime(), intervalMs: Number(hours) * 3_600_000 } : {}) });
      setSwitchResult(result.status ? { status: result.status, issues: "issues" in result ? result.issues ?? [] : [] } : null);
      if (result.changed) setMode(null);
    } catch { setError("Service selection could not be accepted. Review the saved business, destination, billing and unresolved work. No existing deadline or spending commitment was reset."); }
    finally { setSaving(false); }
  };
  if (!state || state.siteId !== siteId) return <p>Loading delivery readiness…</p>;
  const interruptedRetry = state.work.find(w => w.creditRetry)?.creditRetry;
  const delivery = contentServiceStatus(state);
  const operate = async (action: "pause" | "resume" | "retry") => {
    setSaving(true); setError("");
    try { await control({ siteId, action, reviewToken: state.reviewToken,
      ...(action === "retry" && interruptedRetry ? { creditRetry: interruptedRetry } : {}) }); }
    catch { setError(interruptedRetry ? "The interrupted work could not resume safely. Pentra support must check the retained attempt. Your spending limit and original deadline remain unchanged; you do not need to fund a provider."
      : "The service could not continue. Review the current billing, publication consent and destination. Changed facts or unresolved work need reconciliation; attempts and deadlines remain unchanged."); }
    finally { setSaving(false); }
  };
  const confirmChangedSetup = async () => {
    if (!confirmed || confirmedReview !== state.reviewToken) return;
    setSaving(true); setError("");
    try {
      const result = await reconfirm({ siteId, reviewToken: confirmedReview, confirm: true });
      if (result.status === "waiting") setError(result.issues.map(issue => issue.action).join(" "));
      else { setConfirmed(false); setConfirmedReview(""); }
    } catch { setError("The saved setup changed again. Review its current facts and exact destination before confirming. No deadline or spending history was reset."); }
    finally { setSaving(false); }
  };
  if (state.setupPending && state.autopilot?.selectable && state.plan) return <PentraSetupChoice state={state} />;
  const newFlow = state.serviceMode === "growth_first" && Boolean(state.autopilot?.selectable) && Boolean(state.plan) && Boolean(state.schedule?.ownerReviewedOnly || state.schedule?.autopilotSelected);
  const setupDetails = <>
    <details id="changed-content-setup" open={!state.bindingCurrent || state.serviceMode !== "growth_first"} key={state.reviewToken} className="space-y-2 text-sm">
      <summary className="cursor-pointer font-medium">{state.bindingCurrent ? "Saved business and exact destination" : "Review changed setup"}</summary>
      <h3 className="font-medium">Review your saved setup</h3>
      <p>Business: {state.profile.summary || "Missing"}</p><p>Audience: {state.profile.audience || "Missing"}</p><p>Product or service: {state.profile.productUsage || "Missing"}</p>
      <p>Offerings: {state.profile.offerings.join("; ") || "Not specified"}</p>
      <p>Exact destination: {state.destination.domain} · {state.destination.kind === "github" ? `${state.destination.repository}, branch ${state.destination.branch}, ${state.destination.contentDirectory}` : state.destination.kind === "wordpress" ? "WordPress with conditional publisher" : "Unsupported for growth-first"}. {state.destination.verified ? "Verified" : "Verification required"}.</p>
      <p>Existing plan entitlement: {state.entitlement ? "Verified" : "Unavailable — verify Billing"}.</p>
      <Link className="underline" href={`/sites/${siteId}?tab=settings`}>Review business and publishing settings</Link> · <Link className="underline" href="/settings/billing">Billing</Link>
      {!state.bindingCurrent && <>
        <p role="alert">Business or destination changed. {state.reconciliation?.staleItems ?? "Existing"} stale work items need review. Old drafts will be kept, never relabelled as newly approved.</p>
        <ul>{state.reconciliation?.issues.map((issue, index) => <li key={index} role="alert">{issue.action} {issue.until && <>Check after {shownTime(issue.until)}. </>}{issue.articleId && <Link href={`/articles/${issue.articleId}`} className="underline">Open retained delivery and owner review</Link>}</li>)}</ul>
        <p>Confirming safely retires stale unstarted work and prepares newly reviewed content under the existing remaining budget. Prior costs, uncertain charges and missed deadlines remain. Existing page permissions are not renewed; inspect and authorize changed pages separately.</p>
        <label className="block"><input type="checkbox" checked={confirmed && confirmedReview === state.reviewToken} onChange={e => { setConfirmed(e.target.checked); setConfirmedReview(state.reviewToken); }} /> I confirm the changed facts, audience and exact destination above, and authorize newly reviewed work within the existing spending limits.</label>
        <p>{state.schedule?.ownerReviewedOnly ? "Drafts still require your explicit publication approval. This does not enable an automatic schedule." : PUBLISHER_AUTOPUBLISH_CONSENT_TEXT}</p>
        <Button disabled={saving || !confirmed || confirmedReview !== state.reviewToken} onClick={confirmChangedSetup}>{state.schedule?.ownerReviewedOnly ? "Confirm changed setup" : "Confirm changed setup and prepare fresh work"}</Button>
      </>}
      {state.approvalRequired && !state.schedule?.ownerReviewedOnly && <p role="alert">Automatic publication consent is not active. Review the saved publishing setup before activation.</p>}
    </details>
  </>;
  // Sites set up through the Autopilot / Review-first choice get a plain summary.
  if (newFlow) {
    const needsReview = state.work.filter(w => !w.retiredAt && (w.stage === "failed" || w.stage === "review_failed") && !w.superseded && !w.parked && !(state.published ?? []).some(a => a.articleId === w.articleId));
    return <section className="rounded-xl border border-white/10 p-5 space-y-4" aria-labelledby="content-service-heading" data-content-site-id={state.siteId}>
      <AutopilotSwitch siteId={siteId} reviewToken={state.reviewToken} on={Boolean(state.autopilot?.on)} intervalMs={state.plan?.autopilotIntervalMs ?? 86_400_000}
        reviewAvailable={state.autopilot?.reviewAvailable ?? true} paused={Boolean(state.schedule?.paused)} />
      <h2 id="content-service-heading" className="font-semibold">Your Pentra service</h2>
      <p className="text-sm">Website: <Link className="underline" href={`/sites/${state.siteId}?tab=settings`}>{state.destination.domain}</Link> · {state.destination.kind === "wordpress" ? "WordPress" : "GitHub"} · {state.destination.verified ? "connected" : "not connected yet"}</p>
      <p className="text-sm">Status: {delivery.label}. {state.plan && `Your plan includes ${state.plan.articlesPerMonth} new article${state.plan.articlesPerMonth === 1 ? "" : "s"} a month.`}</p>
      {!state.entitlement && <p role="alert" className="text-sm">Your plan isn&apos;t active. <Link href="/upgrade" className="underline">Plans &amp; billing</Link></p>}
      {!state.destination.verified && <p role="alert" className="text-sm">Connect and verify your website in <Link href={`/sites/${siteId}?tab=settings`} className="underline">website settings</Link>.</p>}
      {needsReview.length > 0 && <p role="alert" className="text-sm">{needsReview.length === 1 ? "A draft needs" : `${needsReview.length} drafts need`} your review in <Link href="/articles" className="underline">Articles</Link>. Nothing was published.</p>}
      {state.funding.status !== "available" && <p className="text-sm">{fundingMessage(state.funding, state.schedule?.timezone ?? "UTC")}{" "}
        {state.funding.status === "blocked" && <Link href="/upgrade" className="underline">Plans &amp; billing</Link>}</p>}
      {(delivery.canPause || delivery.canResume) && <div className="flex flex-wrap gap-2">
        {delivery.canPause && <Button size="sm" variant="secondary" disabled={saving} onClick={() => operate("pause")}>Pause Pentra</Button>}
        {delivery.canResume && <Button size="sm" disabled={saving} onClick={() => operate("resume")}>Resume Pentra</Button>}
      </div>}
      {setupDetails}
      {error && <p role="alert">{error}</p>}
    </section>;
  }
  return <section className="rounded-xl border border-white/10 p-5 space-y-4" aria-labelledby="content-service-heading" data-content-site-id={state.siteId}>
    {newFlow && <AutopilotSwitch siteId={siteId} reviewToken={state.reviewToken} on={Boolean(state.autopilot?.on)} intervalMs={state.plan?.autopilotIntervalMs ?? 86_400_000}
      reviewAvailable={state.autopilot?.reviewAvailable ?? true} paused={Boolean(state.schedule?.paused)} />}
    <h2 id="content-service-heading" className="font-semibold">Content delivery service</h2>
    <p>Website: <Link className="underline" href={`/sites/${state.siteId}?tab=settings`}>{state.destination.domain}</Link></p>
    <p>Current contract: {state.setupPending ? "Not selected — setup is stopped" : state.schedule?.ownerReviewedOnly ? "Review first: you approve every article" : state.serviceMode === "growth_first" ? "Growth-first content work" : "Existing fixed-article delivery"}.</p>
    {state.schedule?.ownerReviewedOnly && <p>Request a draft in <Link className="underline" href="/articles">Articles</Link>, review it, then explicitly publish. No automatic schedule or publication is enabled.</p>}
    {state.serviceMode === "growth_first" && !state.schedule?.ownerReviewedOnly && <div className="space-y-2 text-sm" aria-label="Preparation and next action">
      <p>Preparation: {state.complete ? `${state.ready}/2 ready` : "Inventory incomplete"}.</p>
      <p>Schedule: {delivery.label}.</p>
      <p>Next fixed deadline: {state.schedule ? shownTime(state.schedule.nextDeadlineAt, state.schedule.timezone) : "Not selected"}. {state.schedule && state.schedule.nextDeadlineAt < state.funding.checkedAt && <span role="alert">Overdue; the original deadline remains.</span>}</p>
      {state.work.filter(w => w.failure && !w.retiredAt).map(w => <p key={w.jobId} role="alert">{w.failure}</p>)}
      <div className="flex flex-wrap gap-2">{delivery.canPause && <Button disabled={saving} onClick={() => operate("pause")}>Pause new work</Button>}
        {!state.bindingCurrent ? <a className="underline self-center" href="#changed-content-setup">Review changed setup</a> : delivery.canResume && <Button disabled={saving} onClick={() => operate("resume")}>Resume preparation and schedule</Button>}
        {delivery.canRetry && <Button disabled={saving} onClick={() => operate("retry")}>{interruptedRetry ? "Retry interrupted preparation" : "Recheck existing work"}</Button>}</div>
      <p>Pause retains ready work and spending history. A write already started must be checked before anything replaces it.</p>
    </div>}
    {state.funding.status !== "available" && !delivery.systemFailure && <p role="alert" className="text-sm">{fundingCopy[state.funding.status]} Available internal headroom: {money(state.funding.accountAvailableMicroUsd)}. {state.funding.independentAllowance && "Ordinary capacity cannot extend this separate validation allowance. "}This is not provider credit. <a href="#content-funding-details" className="underline">Review funding details</a>.</p>}
    {!state.entitlement && <p role="alert">Verify your existing plan in <Link href="/settings/billing" className="underline">Billing</Link>.</p>}
    {!state.destination.verified && <p role="alert">Verify the exact publisher in <Link href={`/sites/${siteId}?tab=settings`} className="underline">website settings</Link>.</p>}
    {!ownerSetup && !state.schedule?.ownerReviewedOnly && <p className="text-sm">Two reviewed, distinct items prepare ahead of fixed five-minute delivery windows and replenish after delivery. Pricing, checkout, legal text and unselected pages stay protected. Publication is not evidence of SEO growth.</p>}
    {setupDetails}
    <details id="content-funding-details" className="space-y-2 text-sm"><summary className="cursor-pointer font-medium">Funding readiness and retained spending</summary><p>{fundingCopy[state.funding.status]}</p>
      {state.funding.pricingScope === "validation_run" && <p>Model execution is enabled only for this saved validation run, not other sites. Each work item retains its original pricing and spending ceiling.</p>}
      {state.funding.pricingScope === "unavailable" && <p>Model pricing is not enabled for this site&apos;s current scope. Already prepared delivery and verification do not require new model calls.</p>}
      <p>Account monthly limit {money(state.funding.monthlyLimitMicroUsd)} · settled actual spend {money(state.funding.settledActualMicroUsd)} · retained reservations / conservative ceilings {money(state.funding.heldCeilingMicroUsd)}.</p>
      <p>Available ordinary account headroom {money(state.funding.accountAvailableMicroUsd)} · next work ceiling {money(state.funding.requestedMicroUsd)}. {state.funding.independentAllowance
        ? `This work uses a separately approved, non-renewing ${money(state.funding.independentAllowance.totalMicroUsd)} validation allowance (${state.funding.independentAllowance.state}); ordinary account and fleet capacity is unchanged.`
        : "Fleet limits also apply."}</p>
      <p>Daily reset {shownTime(state.funding.dailyResetAt)}; monthly reset {shownTime(state.funding.monthlyResetAt)}. {state.funding.incrementalLimitMicroUsd !== null && `Existing incremental allowance ${money(state.funding.incrementalLimitMicroUsd)} is not renewed.`}</p>
      <p>Provider credit balance is unverified. Internal headroom is not provider credit, a purchase or a reservation. Every paid call requires valid authorization.</p>
    </details>
    <details open={state.serviceMode !== "growth_first"} className="space-y-3"><summary className="cursor-pointer font-medium">Service mode and publication consent</summary>
    <label className="block">Choose service mode
      <select aria-label="Service mode" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setConfirmed(false); setSwitchResult(null); }} className="block bg-[#0F1117] border rounded p-2">
        <option value="legacy_articles">Keep fixed-article delivery</option><option value="growth_first">{ownerSetup || state.schedule?.ownerReviewedOnly ? "Review first: you approve every article" : "Explicitly switch to growth-first"}</option>
      </select>
    </label>
    {mode === "legacy_articles" && state.serviceMode === "growth_first" && <p className="text-sm">Switching back pauses new work and retires safe, unstarted work. Reviewed drafts, published content, original deadlines and spending history stay recorded. Active workers and uncertain deliveries must reconcile first. If pending, keep the service paused and check this switch again; resuming keeps growth-first selected.</p>}
    {mode === "growth_first" && state.serviceMode !== "growth_first" && <>
      <label className="block"><input type="checkbox" checked={confirmed && confirmedReview === state.reviewToken} onChange={e => { setConfirmed(e.target.checked); setConfirmedReview(state.reviewToken); }} /> I confirm these saved business facts, offerings, audience and exact publishing destination.</label>
      {ownerSetup ? <p className="text-sm">Enable drafts for your review. Each publication requires your explicit approval. This does not enable a schedule, backlinks, a purchase or an increase in spending.</p> : <>
      <p className="text-sm">{PUBLISHER_AUTOPUBLISH_CONSENT_TEXT} Selecting growth-first authorizes this scheduled creation/improvement service, not backlinks or a spending increase.</p>
      <label className="block">First deadline ({Intl.DateTimeFormat().resolvedOptions().timeZone})<input aria-label="First delivery deadline" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="block bg-[#0F1117] border rounded p-2" /></label>
      <label className="block">Hours between deadlines<input aria-label="Delivery interval hours" type="number" min="1" value={hours} onChange={e => setHours(e.target.value)} className="block bg-[#0F1117] border rounded p-2" /></label>
      <p className="text-sm">Selection does not purchase credits or increase spending limits. Preparation must be funded and two items ready before automatic schedule activation. Switching engines requires reconciliation of in-flight work.</p>
      </>}
    </>}
    {mode !== state.serviceMode && <Button onClick={save} disabled={saving || (mode === "growth_first" && (!confirmed || confirmedReview !== state.reviewToken || (!ownerSetup && !deadline) || !state.entitlement || !state.destination.verified))}>{saving ? "Saving…" : mode === "legacy_articles" ? switchResult ? "Check service switch again" : "Switch back safely" : ownerSetup ? "Enable owner-reviewed drafts" : "Confirm service selection"}</Button>}
    {switchResult && <div role="status"><p>{switchResult.status === "completed" ? "Service selection completed. Retained delivery and spending history is unchanged." : switchResult.status === "pending" ? "Switch pending — new work is paused while existing work reconciles." : "Switch needs action — new work remains paused."}</p><ul>{switchResult.issues.map((issue, index) => <li key={index}>{issue.action} {issue.until && <>Check after {shownTime(issue.until)}. </>}{issue.articleId && <Link href={`/articles/${issue.articleId}`} className="underline">Open retained delivery and owner review</Link>}</li>)}</ul></div>}
    </details>
    {error && <p role="alert">{error}</p>}
    {state.work.length > 0 && <details className="space-y-2 text-sm"><summary className="cursor-pointer font-medium">Work history and technical references</summary>
      <ul>{state.work.slice(-10).map(work => <li key={work.jobId}>{workLabel(work)} · {work.retiredAt ? "Retired after owner request; retained for history" : stageLabel(work.stage)} · {shownTime(work.windowStartAt)}–{shownTime(work.deadlineAt)}{work.publishedAt ? ` · published ${shownTime(work.publishedAt)}` : ""}{work.verifiedAt ? ` · verified ${shownTime(work.verifiedAt)}` : ""}{work.failure ? ` · ${work.failure}` : ""}{work.technicalReason ? ` · Technical reason: ${work.technicalReason}` : ""}<span> · Reference: {work.jobId}</span></li>)}</ul>
    </details>}
    {!ownerSetup && !state.schedule?.ownerReviewedOnly && <EditablePageSelection key={siteId} siteId={siteId} />}
  </section>;
}

function EditablePageSelection({ siteId }: { siteId: Id<"sites"> }) {
  const pages = useQuery(api.selectedPages.list, { siteId });
  const inspect = useAction(api.actions.selectedPages.preview), select = useAction(api.actions.selectedPages.select);
  const revoke = useMutation(api.selectedPages.revoke);
  const [editingPage, setEditingPage] = useState<Id<"pages"> | null>(null);
  const [kind, setKind] = useState("github"), [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<{ title: string; url: string; revision: string; reviewToken: string; preview: string; target: string; kind: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const binding = kind === "github" ? { path: target } : { wordpressId: Number(target) };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(""); try { await work(); } catch { setError("The current source, layout, permission or destination could not be verified. Inspect the page again; unsupported pages remain excluded."); }
    finally { setBusy(false); }
  };
  return <div className="border-t border-white/10 pt-4 space-y-3">
    <h3 className="font-medium">Pages Pentra may improve</h3>
    <p className="text-sm">Pentra’s verified creations appear automatically. You may also authorize supported plain Markdown/MDX and classic WordPress pages. Reviewed guidance can be added or a bounded instructional paragraph improved; unrelated facts, links and formatting remain unchanged. Pricing, checkout, legal pages, unsupported layouts and executable blocks are excluded. Discretionary revisions are at least fourteen days apart.</p>
    <select aria-label="Selected page adapter" value={kind} onChange={e => { setKind(e.target.value); setPreview(null); setConsent(false); }} className="bg-[#0F1117] border rounded p-2">
      <option value="github">GitHub Markdown/MDX path</option><option value="wordpress">WordPress post/page ID</option>
    </select>
    <input aria-label="Exact page to improve" value={target} onChange={e => { setTarget(e.target.value); setPreview(null); setConsent(false); }} placeholder={kind === "github" ? "content/blog/your-page.md" : "Post or page ID"} className="block bg-[#0F1117] border rounded p-2 w-full" />
    <Button disabled={busy || !target} onClick={() => run(async () => { const p = await inspect({ siteId, ...binding }); setPreview({ ...p, target, kind }); })}>Inspect exact source</Button>
    {preview && preview.target === target && preview.kind === kind && <div className="space-y-2">
      <p>{preview.title} · {preview.url}</p>
      <pre className="text-sm whitespace-pre-wrap max-h-48 overflow-auto">{preview.preview}</pre>
      <label className="block text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I authorize Pentra to improve this exact page. I can revoke permission; already-started writes may require reconciliation.</label>
      <Button disabled={busy || !consent} onClick={() => run(async () => { await select({ siteId, ...binding, revision: preview.revision, reviewToken: preview.reviewToken, confirm: true }); setPreview(null); setConsent(false); })}>Authorize this page</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {!pages ? <p>Loading selected pages…</p> : <>
      {!pages.complete && <p>Page inventory is incomplete; selection needs review.</p>}
      <ul>{pages.pages.map(page => <li key={page.id} className="flex flex-wrap gap-3 items-center">{page.title} · {page.managed ? "Created by Pentra" : "Selected by you"} · {page.active ? page.bindingCurrent ? "Authorized" : "Review changed business / destination" : "Revoked"}
        <span className="break-all text-sm">{page.url}</span>{page.pendingVerification && <span>Live verification pending</span>}{page.issue && <span role="alert">{page.issue}</span>}
        {page.active && <Button disabled={!page.bindingCurrent} onClick={() => setEditingPage(page.id)}>Review correction or rollback</Button>}
        {!page.active && page.revocationStatus === "pending" && <span>Remote revocation pending; local writes stopped.</span>}
        {!page.active && page.revocationStatus === "failed" && <span role="alert">Remote revocation unconfirmed. Local writes stopped; reconcile the connector grant.</span>}
        {page.active && <Button disabled={busy} onClick={() => run(() => revoke({ siteId, pageId: page.id }))}>Revoke permission</Button>}
      </li>)}</ul>
      {editingPage && <ExactPageControls key={editingPage} siteId={siteId} pageId={editingPage} pages={pages.pages} />}
    </>}
  </div>;
}
