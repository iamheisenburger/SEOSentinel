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

export function ContentWorkService({ siteId }: { siteId: Id<"sites"> }) {
  const state = useQuery(api.contentWork.readiness, { siteId });
  const select = useMutation(api.contentWork.selectServiceMode);
  const control = useMutation(api.contentWork.control);
  const [chosenMode, setMode] = useState<"legacy_articles" | "growth_first" | null>(null);
  const mode = chosenMode ?? (state?.setupPending ? "growth_first" : state?.serviceMode ?? "legacy_articles");
  const [confirmed, setConfirmed] = useState(false), [deadline, setDeadline] = useState("");
  const [confirmedReview, setConfirmedReview] = useState("");
  const [hours, setHours] = useState("24"), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const save = async () => {
    if (mode === "growth_first" && confirmedReview !== state?.reviewToken) return;
    setSaving(true); setError("");
    try {
      await select({ siteId, mode, confirmBusinessProfile: confirmed, authorizeAutomaticPublication: mode === "growth_first" && confirmed, reviewToken: state!.reviewToken, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(mode === "growth_first" ? { firstDeadlineAt: new Date(deadline).getTime(), intervalMs: Number(hours) * 3_600_000 } : {}) });
    } catch { setError("Service selection could not be accepted. Review the saved business, destination, billing and unresolved work. No existing deadline or spending commitment was reset."); }
    finally { setSaving(false); }
  };
  if (!state || state.siteId !== siteId) return <p>Loading delivery readiness…</p>;
  const operate = async (action: "pause" | "resume" | "retry") => {
    setSaving(true); setError("");
    try { await control({ siteId, action, reviewToken: state.reviewToken }); }
    catch { setError("The service could not continue. Review the current billing, publication consent and destination. Changed facts or unresolved work need reconciliation; attempts and deadlines remain unchanged."); }
    finally { setSaving(false); }
  };
  return <section className="rounded-xl border border-white/10 p-5 space-y-4" aria-labelledby="content-service-heading">
    <h2 id="content-service-heading" className="font-semibold">Content delivery service</h2>
    <p>Current contract: {state.setupPending ? "Not selected — setup is stopped" : state.serviceMode === "growth_first" ? "Growth-first content work" : "Existing fixed-article delivery"}.</p>
    <p className="text-sm">Growth-first prepares two reviewed, distinct items and refills after verified delivery. Each delivery has a five-minute window ending at a fixed deadline. WordPress requires the Pentra conditional publisher connector. Existing pages require separate exact-page permission below. Publication is not evidence of SEO growth.</p>
    <div key={state.reviewToken} className="space-y-2 text-sm">
      <h3 className="font-medium">Review your saved setup</h3>
      <p>Business: {state.profile.summary || "Missing"}</p><p>Audience: {state.profile.audience || "Missing"}</p><p>Product or service: {state.profile.productUsage || "Missing"}</p>
      <p>Offerings: {state.profile.offerings.join("; ") || "Not specified"}</p>
      <p>Exact destination: {state.destination.domain} · {state.destination.kind === "github" ? `${state.destination.repository}, branch ${state.destination.branch}, ${state.destination.contentDirectory}` : state.destination.kind === "wordpress" ? "WordPress with conditional publisher" : "Unsupported for growth-first"}. {state.destination.verified ? "Verified" : "Verification required"}.</p>
      <p>Existing plan entitlement: {state.entitlement ? "Verified" : "Unavailable — verify Billing"}.</p>
      <Link className="underline" href={`/sites/${siteId}?tab=settings`}>Review business and publishing settings</Link> · <Link className="underline" href="/settings/billing">Billing</Link>
      {!state.bindingCurrent && <p role="alert">Business or destination changed. Existing work is held for reconciliation; resume cannot silently accept these changes.</p>}
      {state.approvalRequired && <p role="alert">Automatic publication consent is not active. Review the saved publishing setup before activation.</p>}
      <h3 className="font-medium">Funding readiness</h3><p>{fundingCopy[state.funding.status]}</p>
      <p>Account monthly limit {money(state.funding.monthlyLimitMicroUsd)} · settled actual spend {money(state.funding.settledActualMicroUsd)} · retained reservations / conservative ceilings {money(state.funding.heldCeilingMicroUsd)}.</p>
      <p>Available account headroom {money(state.funding.accountAvailableMicroUsd)} · next work ceiling {money(state.funding.requestedMicroUsd)}. Fleet limits also apply.</p>
      <p>Daily reset {shownTime(state.funding.dailyResetAt)}; monthly reset {shownTime(state.funding.monthlyResetAt)}. {state.funding.incrementalLimitMicroUsd !== null && `Existing incremental allowance ${money(state.funding.incrementalLimitMicroUsd)} is not renewed.`}</p>
      <p>Provider credit balance is unverified. Internal headroom is not provider credit, a purchase or a reservation. Every paid call requires valid authorization.</p>
    </div>
    <label className="block">Choose service mode
      <select aria-label="Service mode" value={mode} onChange={e => { setMode(e.target.value as typeof mode); setConfirmed(false); }} className="block bg-[#0F1117] border rounded p-2">
        <option value="legacy_articles">Keep fixed-article delivery</option><option value="growth_first">Explicitly switch to growth-first</option>
      </select>
    </label>
    {mode === "growth_first" && state.serviceMode !== "growth_first" && <>
      <label className="block"><input type="checkbox" checked={confirmed && confirmedReview === state.reviewToken} onChange={e => { setConfirmed(e.target.checked); setConfirmedReview(state.reviewToken); }} /> I confirm these saved business facts, offerings, audience and exact publishing destination.</label>
      <p className="text-sm">{PUBLISHER_AUTOPUBLISH_CONSENT_TEXT} Selecting growth-first authorizes this scheduled creation/improvement service, not backlinks or a spending increase.</p>
      <label className="block">First deadline ({Intl.DateTimeFormat().resolvedOptions().timeZone})<input aria-label="First delivery deadline" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="block bg-[#0F1117] border rounded p-2" /></label>
      <label className="block">Hours between deadlines<input aria-label="Delivery interval hours" type="number" min="1" value={hours} onChange={e => setHours(e.target.value)} className="block bg-[#0F1117] border rounded p-2" /></label>
      <p className="text-sm">Selection does not purchase credits or increase spending limits. Preparation must be funded and two items ready before automatic schedule activation. Switching engines requires reconciliation of in-flight work.</p>
    </>}
    {mode !== state.serviceMode && <Button onClick={save} disabled={saving || (mode === "growth_first" && (!confirmed || confirmedReview !== state.reviewToken || !deadline || !state.entitlement || !state.destination.verified))}>{saving ? "Saving…" : "Confirm service selection"}</Button>}
    {error && <p role="alert">{error}</p>}
    {state.serviceMode === "growth_first" && <div className="space-y-2 text-sm">
      <p>Preparation: {state.complete ? `${state.ready}/2 ready` : "Inventory incomplete"}.</p>
      <p>Schedule: {state.schedule?.paused ? "Paused" : state.schedule?.active ? "Active" : "Preparing, not active"}. Next fixed deadline: {state.schedule ? shownTime(state.schedule.nextDeadlineAt, state.schedule.timezone) : "Not selected"}.</p>
      <p>Pausing stops admissions and unstarted writes. Ready work and reservations remain; already-started writes are reconciled. Resume and recheck never reset attempts, costs or deadlines.</p>
      <div className="flex flex-wrap gap-2"><Button disabled={saving} onClick={() => operate("pause")}>Pause new work</Button><Button disabled={saving || !state.bindingCurrent || !state.entitlement || state.approvalRequired} onClick={() => operate("resume")}>Resume preparation and schedule</Button><Button disabled={saving || state.schedule?.paused} onClick={() => operate("retry")}>Recheck existing work</Button></div>
      <ul>{state.work.slice(-5).map(work => <li key={work.jobId}>{workLabel(work)} · {stageLabel(work.stage)} · {shownTime(work.windowStartAt)}–{shownTime(work.deadlineAt)}{work.publishedAt ? ` · published ${shownTime(work.publishedAt)}` : ""}{work.verifiedAt ? ` · verified ${shownTime(work.verifiedAt)}` : ""}{work.failure ? ` · ${work.failure}` : ""}</li>)}</ul>
    </div>}
    <EditablePageSelection key={siteId} siteId={siteId} />
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
