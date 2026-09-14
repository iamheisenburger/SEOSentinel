"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

/** Minimal service and exact-page consent controls; full journey is separate. */
export function ContentWorkService({ siteId }: { siteId: Id<"sites"> }) {
  const state = useQuery(api.contentWork.readiness, { siteId });
  const select = useMutation(api.contentWork.selectServiceMode);
  const [mode, setMode] = useState<"legacy_articles" | "growth_first">("legacy_articles");
  const [confirmed, setConfirmed] = useState(false), [deadline, setDeadline] = useState("");
  const [hours, setHours] = useState("24"), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      await select({ siteId, mode, confirmBusinessProfile: confirmed,
        ...(mode === "growth_first" ? { firstDeadlineAt: new Date(deadline).getTime(), intervalMs: Number(hours) * 3_600_000 } : {}) });
    } catch (e) { setError(e instanceof Error ? e.message : "Service selection failed"); }
    finally { setSaving(false); }
  };
  if (!state) return <p>Loading delivery readiness…</p>;
  return <section className="rounded-xl border border-white/10 p-5 space-y-4" aria-labelledby="content-service-heading">
    <h2 id="content-service-heading" className="font-semibold">Content delivery service</h2>
    <p>Current contract: {state.serviceMode === "growth_first" ? "Growth-first content work" : "Existing fixed-article delivery"}.</p>
    <p className="text-sm">Growth-first prepares two reviewed, distinct items and refills after verified delivery. Each delivery has a five-minute window ending at a fixed deadline. WordPress requires the Pentra conditional publisher connector. Existing pages require separate exact-page permission below. Publication is not evidence of SEO growth.</p>
    <label className="block">Choose service mode
      <select aria-label="Service mode" value={mode} onChange={e => setMode(e.target.value as typeof mode)} className="block bg-[#0F1117] border rounded p-2">
        <option value="legacy_articles">Keep fixed-article delivery</option><option value="growth_first">Explicitly switch to growth-first</option>
      </select>
    </label>
    {mode === "growth_first" && <>
      <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I confirm the saved business facts, offerings, audience and publishing destination.</label>
      <label className="block">First deadline (your local time)<input aria-label="First delivery deadline" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="block bg-[#0F1117] border rounded p-2" /></label>
      <label className="block">Hours between deadlines<input aria-label="Delivery interval hours" type="number" min="1" value={hours} onChange={e => setHours(e.target.value)} className="block bg-[#0F1117] border rounded p-2" /></label>
      <p className="text-sm">Selection does not purchase credits or increase spending limits. Preparation must be funded and two items ready before automatic schedule activation. Switching engines requires reconciliation of in-flight work.</p>
    </>}
    <Button onClick={save} disabled={saving || mode === state.serviceMode || (mode === "growth_first" && (!confirmed || !deadline))}>{saving ? "Saving…" : "Confirm service selection"}</Button>
    {error && <p role="alert">{error}</p>}
    {state.serviceMode === "growth_first" && <div className="space-y-2 text-sm">
      <p>Preparation: {state.complete ? `${state.ready}/2 ready` : "Inventory incomplete"}. Funding: {state.funding === "pricing_not_configured" ? "Not configured — no paid work authorized" : "Priced; every job still requires available budget"}.</p>
      <p>Schedule: {state.schedule?.active ? "Active" : "Preparing, not active"}. Next fixed deadline: {state.schedule ? new Date(state.schedule.nextDeadlineAt).toISOString() : "Not selected"}.</p>
      <ul>{state.work.slice(-5).map(work => <li key={work.jobId}>{work.operation === "rollback" ? "Owner-requested restoration (not scheduled SEO delivery)" : work.intent === "improve" ? "Selected-page improvement" : "New article"} · {work.stage.replaceAll("_", " ")} · {new Date(work.windowStartAt).toISOString()}–{new Date(work.deadlineAt).toISOString()}{work.publishedAt ? ` · published ${new Date(work.publishedAt).toISOString()}` : ""}{work.verifiedAt ? ` · verified ${new Date(work.verifiedAt).toISOString()}` : ""}{work.failure ? ` · ${work.failure}` : ""}</li>)}</ul>
    </div>}
    <EditablePageSelection key={siteId} siteId={siteId} />
  </section>;
}

function EditablePageSelection({ siteId }: { siteId: Id<"sites"> }) {
  const pages = useQuery(api.selectedPages.list, { siteId });
  const inspect = useAction(api.actions.selectedPages.preview), select = useAction(api.actions.selectedPages.select);
  const revoke = useMutation(api.selectedPages.revoke);
  const rollback = useMutation(api.contentImprovements.requestRollback);
  const [rollbackPage, setRollbackPage] = useState<string | null>(null);
  const [kind, setKind] = useState("github"), [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [preview, setPreview] = useState<{ title: string; url: string; revision: string; preview: string; target: string; kind: string } | null>(null);
  const [consent, setConsent] = useState(false);
  const binding = kind === "github" ? { path: target } : { wordpressId: Number(target) };
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(""); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Page selection failed"); }
    finally { setBusy(false); }
  };
  return <div className="border-t border-white/10 pt-4 space-y-3">
    <h3 className="font-medium">Pages Pentra may improve</h3>
    <p className="text-sm">Only supported plain Markdown/MDX and classic WordPress content can be selected. Pricing, checkout, legal pages, unsupported layouts and executable blocks are excluded. Existing text and facts remain unchanged; improvements add reviewed guidance. Discretionary changes have a fourteen-day per-page cooldown.</p>
    <select aria-label="Selected page adapter" value={kind} onChange={e => { setKind(e.target.value); setPreview(null); setConsent(false); }} className="bg-[#0F1117] border rounded p-2">
      <option value="github">GitHub Markdown/MDX path</option><option value="wordpress">WordPress post/page ID</option>
    </select>
    <input aria-label="Exact page to improve" value={target} onChange={e => { setTarget(e.target.value); setPreview(null); setConsent(false); }} placeholder={kind === "github" ? "content/blog/your-page.md" : "Post or page ID"} className="block bg-[#0F1117] border rounded p-2 w-full" />
    <Button disabled={busy || !target} onClick={() => run(async () => { const p = await inspect({ siteId, ...binding }); setPreview({ ...p, target, kind }); })}>Inspect exact source</Button>
    {preview && preview.target === target && preview.kind === kind && <div className="space-y-2">
      <p>{preview.title} · {preview.url}</p><p className="text-xs">Source revision: {preview.revision}</p>
      <pre className="text-sm whitespace-pre-wrap max-h-48 overflow-auto">{preview.preview}</pre>
      <label className="block text-sm"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I authorize Pentra to improve this exact page. I can revoke permission; already-started writes may require reconciliation.</label>
      <Button disabled={busy || !consent} onClick={() => run(async () => { await select({ siteId, ...binding, revision: preview.revision, confirm: true }); setPreview(null); setConsent(false); })}>Authorize this page</Button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {!pages ? <p>Loading selected pages…</p> : <>
      {!pages.complete && <p>Page inventory is incomplete; selection needs review.</p>}
      <ul>{pages.pages.map(page => <li key={page.id} className="flex flex-wrap gap-3 items-center">{page.title} · {page.active ? "Authorized" : "Revoked"}
        {!page.active && page.revocationStatus === "pending" && <span>Remote revocation pending; local writes stopped.</span>}
        {!page.active && page.revocationStatus === "failed" && <span role="alert">Remote revocation unconfirmed. Local writes stopped; reconcile the connector grant.</span>}
        {page.active && <Button disabled={busy} onClick={() => run(() => revoke({ siteId, pageId: page.id }))}>Revoke permission</Button>}
        {page.active && page.latestRevisionId && <>
          <label className="text-sm"><input type="checkbox" checked={rollbackPage === page.id} onChange={e => setRollbackPage(e.target.checked ? page.id : null)} /> Restore the retained version before the latest verified change. Later customer edits must block restoration.</label>
          <Button disabled={busy || rollbackPage !== page.id} onClick={() => run(async () => { await rollback({ siteId, revisionId: page.latestRevisionId!, confirm: true }); setRollbackPage(null); })}>Request conditional rollback</Button>
        </>}
      </li>)}</ul>
    </>}
  </div>;
}
