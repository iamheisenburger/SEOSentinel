"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
const input = "block w-full rounded-lg border border-white/15 bg-[#0E0F11] p-2 text-sm";
export function ExactPageControls({ siteId, pageId, pages }: { siteId: Id<"sites">; pageId: Id<"pages">; pages: FunctionReturnType<typeof api.selectedPages.list>["pages"] }) {
  const detail = useQuery(api.selectedPages.detail, { siteId, pageId });
  const previewChange = useAction(api.actions.contentCorrections.preview), correct = useAction(api.actions.contentCorrections.correct), rollback = useMutation(api.contentImprovements.requestRollback);
  const [kind, setKind] = useState<"factual_correction" | "technical_repair">("factual_correction"), [before, setBefore] = useState(""), [reason, setReason] = useState("");
  const [field, setField] = useState<"siteSummary" | "productUsage">("siteSummary"), [targetPageId, setTargetPageId] = useState<Id<"pages"> | "">("");
  const [preview, setPreview] = useState<(FunctionReturnType<typeof api.actions.contentCorrections.preview> & { baseRevision: string }) | null>(null);
  const [confirmed, setConfirmed] = useState(false), [restore, setRestore] = useState<string | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const invalidate = () => { setPreview(null); setConfirmed(false); };
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setMessage(""); try { await work(); } catch { setMessage("This exact change is not currently safe. Check the current source, supported paragraph format, verified link target, permissions and active work. No arbitrary replacement or attempt reset is allowed."); } finally { setBusy(false); } };
  if (!detail) return <p>Loading exact retained source…</p>;
  const args = { siteId, pageId, baseRevision: detail.baseRevision, kind, before, reason,
    ...(kind === "factual_correction" ? { field } : targetPageId ? { targetPageId } : {}) };
  return <div className="rounded-lg border border-white/15 p-4 space-y-3"><h3 className="font-medium">Exact correction: {detail.title}</h3>
    <p className="text-sm">Only a factual paragraph replaced by a confirmed business quote, or a demonstrated broken link changed to a verified same-site page. These provider-free repairs do not satisfy or move a scheduled delivery.</p>
    <select aria-label="Correction type" className={input} value={kind} onChange={e => { setKind(e.target.value as typeof kind); invalidate(); }}><option value="factual_correction">Correct a factual paragraph</option><option value="technical_repair">Repair one broken link</option></select>
    <select aria-label="Exact paragraph" className={input} value={before} onChange={e => { setBefore(e.target.value); invalidate(); }}><option value="">Select the exact existing paragraph</option>{detail.paragraphs.map((p, i) => <option key={i} value={p}>{p}</option>)}</select>
    {kind === "factual_correction" ? <select aria-label="Confirmed fact source" className={input} value={field} onChange={e => { setField(e.target.value as typeof field); invalidate(); }}><option value="siteSummary">Saved business summary</option><option value="productUsage">Saved product or service description</option></select> : <select aria-label="Verified replacement destination" className={input} value={targetPageId} onChange={e => { setTargetPageId(e.target.value as Id<"pages">); invalidate(); }}><option value="">Select a verified same-site destination</option>{pages.filter(p => p.active && p.bindingCurrent && p.id !== pageId).map(p => <option key={p.id} value={p.id}>{p.url}</option>)}</select>}
    <label className="block">Reason for this correction<textarea aria-label="Correction reason" className={input} maxLength={400} value={reason} onChange={e => { setReason(e.target.value); invalidate(); }} /></label>
    <Button disabled={busy || !before || reason.trim().length < 12 || (kind === "technical_repair" && !targetPageId)} onClick={() => run(async () => { setPreview({ ...await previewChange(args), baseRevision: detail.baseRevision }); setConfirmed(false); })}>Preview exact correction</Button>
    {preview?.baseRevision === detail.baseRevision && <><p>{preview.url}</p><p>Before</p><pre className="whitespace-pre-wrap text-sm">{preview.before}</pre><p>After</p><pre className="whitespace-pre-wrap text-sm">{preview.after}</pre><label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I confirm only this exact replacement. Later source edits must block it.</label><Button disabled={busy || !confirmed} onClick={() => run(async () => { await correct({ ...args, reviewToken: preview.reviewToken, confirm: true }); invalidate(); setMessage("Correction queued for conditional delivery and live verification. It is not yet complete."); })}>Confirm exact correction</Button></>}
    {detail.rollback && <details><summary>Preview conditional rollback</summary><p>Retained current version</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">{detail.rollback.before}</pre><p>Restore this retained version</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-sm">{detail.rollback.after}</pre><label className="block"><input type="checkbox" checked={restore === detail.rollback.revisionId} onChange={e => setRestore(e.target.checked ? detail.rollback!.revisionId : null)} /> Restore only this retained version, provided no later customer edit exists.</label><Button disabled={busy || restore !== detail.rollback.revisionId} onClick={() => run(async () => { await rollback({ siteId, revisionId: detail.rollback!.revisionId, confirm: true }); setRestore(null); setMessage("Rollback queued. Completion requires conditional delivery and live verification."); })}>Request conditional rollback</Button></details>}
    {message && <p role="status">{message}</p>}
  </div>;
}
