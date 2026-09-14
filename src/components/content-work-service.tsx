"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";

/** Minimal Stage 1 consent/readiness interface; improvement and WordPress are
 * deliberately not offered as implemented capabilities. */
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
    <p>Current contract: {state.serviceMode === "growth_first" ? "Growth-first · GitHub creation preview" : "Existing fixed-article delivery"}.</p>
    <p className="text-sm">Growth-first prepares two reviewed, distinct items and refills after delivery. Each delivery has a five-minute window ending at a fixed deadline. Existing-page improvements and WordPress are not included in this preview. Publication is not evidence of SEO growth.</p>
    <label className="block">Choose service mode
      <select aria-label="Service mode" value={mode} onChange={e => setMode(e.target.value as typeof mode)} className="block bg-[#0F1117] border rounded p-2">
        <option value="legacy_articles">Keep fixed-article delivery</option><option value="growth_first">Explicitly switch to growth-first</option>
      </select>
    </label>
    {mode === "growth_first" && <>
      <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I confirm the saved business facts, offerings, audience and GitHub publishing destination.</label>
      <label className="block">First deadline (your local time)<input aria-label="First delivery deadline" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="block bg-[#0F1117] border rounded p-2" /></label>
      <label className="block">Hours between deadlines<input aria-label="Delivery interval hours" type="number" min="1" value={hours} onChange={e => setHours(e.target.value)} className="block bg-[#0F1117] border rounded p-2" /></label>
      <p className="text-sm">Selection does not purchase credits or increase spending limits. Preparation must be funded and two items ready before automatic schedule activation. Switching engines requires reconciliation of in-flight work.</p>
    </>}
    <Button onClick={save} disabled={saving || mode === state.serviceMode || (mode === "growth_first" && (!confirmed || !deadline))}>{saving ? "Saving…" : "Confirm service selection"}</Button>
    {error && <p role="alert">{error}</p>}
    {state.serviceMode === "growth_first" && <div className="space-y-2 text-sm">
      <p>Preparation: {state.complete ? `${state.ready}/2 ready` : "Inventory incomplete"}. Funding: {state.funding === "pricing_not_configured" ? "Not configured — no paid work authorized" : "Priced; every job still requires available budget"}.</p>
      <p>Schedule: {state.schedule?.active ? "Active" : "Preparing, not active"}. Next fixed deadline: {state.schedule ? new Date(state.schedule.nextDeadlineAt).toISOString() : "Not selected"}.</p>
      <ul>{state.work.slice(-5).map(work => <li key={work.jobId}>{work.stage.replaceAll("_", " ")} · {new Date(work.windowStartAt).toISOString()}–{new Date(work.deadlineAt).toISOString()}{work.publishedAt ? ` · published ${new Date(work.publishedAt).toISOString()}` : ""}{work.verifiedAt ? ` · verified ${new Date(work.verifiedAt).toISOString()}` : ""}{work.failure ? ` · ${work.failure}` : ""}</li>)}</ul>
    </div>}
  </section>;
}
