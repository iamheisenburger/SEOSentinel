"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import Link from "next/link";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PUBLISHER_AUTOPUBLISH_CONSENT_TEXT } from "../../convex/lib/publisherProvisioning";

type SetupState = {
  siteId: Id<"sites">;
  reviewToken: string;
  entitlement: boolean;
  destination: { kind: string; domain: string; verified: boolean };
  plan: { tier: string; articlesPerMonth: number; autopilotIntervalMs: number };
};

function rhythm(intervalMs: number) {
  const days = intervalMs / 86_400_000;
  if (days >= 1.5) return `about one every ${Math.round(days)} days`;
  const hours = Math.round(intervalMs / 3_600_000);
  return hours >= 24 ? "about one a day" : `about one every ${hours} hours`;
}

/** New-customer setup: one clear choice instead of delivery windows. */
export function PentraSetupChoice({ state }: { state: SetupState }) {
  const select = useMutation(api.contentWork.selectServiceMode);
  // Other platforms (paste your own): Pentra writes, the owner publishes — Review first only.
  const paste = state.destination.kind === "manual";
  const [picked, setChoice] = useState<"autopilot" | "review">("autopilot");
  const choice = paste ? "review" : picked;
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const reviewAvailable = state.destination.kind === "github" || state.destination.kind === "wordpress" || paste;
  const ready = state.destination.verified && state.entitlement;
  const start = async () => {
    setBusy(true); setError("");
    try {
      await select({ siteId: state.siteId, mode: "growth_first", confirmBusinessProfile: true, reviewToken: state.reviewToken,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(choice === "autopilot" || !reviewAvailable ? { autopilot: true } : { ownerReviewedOnly: true }) });
    } catch (err) {
      setError(err instanceof ConvexError && typeof err.data === "string" ? err.data
        : "Pentra couldn't start. Check that your website is connected and verified and your plan is active.");
    } finally { setBusy(false); }
  };
  const step = (done: boolean, label: string, action?: React.ReactNode) =>
    <li className="flex items-center gap-2"><span aria-hidden className={done ? "text-[#22C55E]" : "text-[#F59E0B]"}>{done ? "✓" : "•"}</span>
      <span>{label}</span>{!done && action}</li>;
  return <section aria-labelledby="pentra-setup-heading" className="space-y-5 rounded-xl border border-white/[0.06] bg-[#0E0F11] p-6">
    <div>
      <h2 id="pentra-setup-heading" className="text-lg font-semibold text-[#F7F8F8]">Turn on Pentra</h2>
      <p className="text-sm text-[#8A8F98]">Your plan includes {state.plan.articlesPerMonth} new article{state.plan.articlesPerMonth === 1 ? "" : "s"} a month for {state.destination.domain}.</p>
    </div>
    <ul className="space-y-1 text-sm">
      {step(true, "Business profile saved")}
      {step(state.destination.verified, paste ? "Website: you paste each approved article into your site" : "Website connected and verified",
        <Link className="ml-1 underline" href={`/sites/${state.siteId}?tab=settings`}>Connect your website</Link>)}
      {step(state.entitlement, "Plan active", <Link className="ml-1 underline" href="/settings/billing">Check billing</Link>)}
    </ul>
    <fieldset className="grid gap-3 md:grid-cols-2">
      <legend className="sr-only">How should Pentra work?</legend>
      <label className={`cursor-pointer rounded-xl border p-4 transition ${choice === "autopilot" ? "border-[#0EA5E9] bg-[#0EA5E9]/[0.06]" : "border-white/10 hover:border-white/20"}`}>
        <input type="radio" name="pentra-mode" className="mr-2" disabled={paste} checked={choice === "autopilot"} onChange={() => setChoice("autopilot")} />
        <span className="font-medium text-[#F7F8F8]">Autopilot (recommended)</span>
        <p className="mt-1 text-sm text-[#8A8F98]">{paste ? "Needs a WordPress or GitHub connection, so Pentra can publish for you. " : ""}Pentra researches, writes and publishes on its own, {rhythm(state.plan.autopilotIntervalMs)}. Drafts it isn&apos;t confident about are held back, never published; everything else goes live automatically.</p>
      </label>
      <label className={`rounded-xl border p-4 transition ${reviewAvailable ? "cursor-pointer hover:border-white/20" : "opacity-50"} ${choice === "review" ? "border-[#0EA5E9] bg-[#0EA5E9]/[0.06]" : "border-white/10"}`}>
        <input type="radio" name="pentra-mode" className="mr-2" disabled={!reviewAvailable} checked={choice === "review"} onChange={() => setChoice("review")} />
        <span className="font-medium text-[#F7F8F8]">Review first</span>
        <p className="mt-1 text-sm text-[#8A8F98]">{paste ? "Pentra researches and writes each article; you read it, then paste it into your site's blog." : reviewAvailable ? "Pentra drafts; you read, edit and approve every article before it goes live." : "Connect GitHub or WordPress to choose this."}</p>
      </label>
    </fieldset>
    {(choice === "autopilot" || !reviewAvailable) && <p className="text-xs text-[#8A8F98]">{PUBLISHER_AUTOPUBLISH_CONSENT_TEXT}</p>}
    <label className="block text-sm"><input type="checkbox" className="mr-2" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
      My business details are accurate. Pentra writes only from these facts.</label>
    <Button disabled={!ready || !confirmed || busy} loading={busy} onClick={start}>Start Pentra</Button>
    {!ready && <p className="text-sm text-[#8A8F98]">Finish the steps above to start.</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
  </section>;
}

/** Autopilot on/off for sites set up through the new flow. */
const PACES = [1, 2, 4, 7, 14, 21];

export function AutopilotSwitch({ siteId, reviewToken, on, intervalMs, reviewAvailable = true, paused = false, cadencePerWeek = null, articlesPerMonth = null }:
  { siteId: Id<"sites">; reviewToken: string; on: boolean; intervalMs: number; reviewAvailable?: boolean; paused?: boolean;
    cadencePerWeek?: number | null; articlesPerMonth?: number | null }) {
  const setAutopilot = useMutation(api.contentWork.setAutopilot);
  const setCadence = useMutation(api.contentWork.setAutopilotCadence);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pace = cadencePerWeek ? `${cadencePerWeek} article${cadencePerWeek === 1 ? "" : "s"} a week (${rhythm(intervalMs)})` : rhythm(intervalMs);
  return <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${on && !paused ? "bg-[#4CB782] shadow-[0_0_0_3px_rgba(76,183,130,0.15)]" : on ? "bg-[#F2994A]" : "bg-[#62666D]"}`} />
    <div className="min-w-[14rem] flex-1">
      <p className="text-[14px] font-medium text-[#F7F8F8]">Autopilot is {on ? (paused ? "paused" : "on") : "off"}</p>
      <p className="text-[13px] leading-relaxed text-[#8A8F98]">{on ? paused ? "No new articles start while paused. Resume from Service settings."
        : `Pentra publishes ${pace}${articlesPerMonth ? `, up to ${articlesPerMonth} a month on your plan` : ""}. Drafts it isn't confident about are held back and never published.`
        : "Every article waits for your approval in Articles."}</p>
    </div>
    {(!on || reviewAvailable) && <Button size="sm" variant={on ? "secondary" : "primary"} loading={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await setAutopilot({ siteId, enabled: !on, reviewToken }); }
      catch (err) { setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Couldn't change Autopilot. Refresh and try again."); }
      finally { setBusy(false); }
    }}>{on ? "Switch to review first" : "Turn on Autopilot"}</Button>}
    {on && !paused && <label className="flex w-full flex-wrap items-center gap-2 pl-5 text-[13px] text-[#8A8F98]">Pace
      <select aria-label="Articles per week" className="rounded-md border border-white/[0.1] bg-[#08090A] px-2 py-1 text-[13px] text-[#F7F8F8] focus:border-white/30 focus:outline-none"
        value={cadencePerWeek ?? ""} disabled={busy} onChange={async e => {
          setBusy(true); setError("");
          try { await setCadence({ siteId, reviewToken, cadencePerWeek: Number(e.target.value) }); }
          catch (err) { setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Couldn't change the pace. Refresh and try again."); }
          finally { setBusy(false); }
        }}>
        {!cadencePerWeek && <option value="">Plan default</option>}
        {PACES.map(n => <option key={n} value={n}>{n} a week</option>)}
      </select>
      <span className="text-[12px] text-[#62666D]">Applies from the next article not yet prepared.</span>
    </label>}
    {error && <p role="alert" className="w-full text-sm text-red-400">{error}</p>}
  </div>;
}

/** Existing contracts (set up before Autopilot) can move onto Autopilot. */
export function AdoptAutopilot({ siteId, reviewToken, intervalMs, articlesPerMonth }: { siteId: Id<"sites">; reviewToken: string; intervalMs: number; articlesPerMonth: number }) {
  const adopt = useMutation(api.contentWork.adoptAutopilot);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <section aria-labelledby="adopt-autopilot-heading" className="space-y-3 rounded-xl border border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.04] p-5">
    <h2 id="adopt-autopilot-heading" className="font-semibold text-[#F7F8F8]">Move this site to Autopilot</h2>
    <p className="text-sm text-[#8A8F98]">Pentra researches, writes and publishes {rhythm(intervalMs)} ({articlesPerMonth} a month on your plan), starting
      24 hours from now. Drafts that don&apos;t pass the fact check are held back and never published. Your past history, missed dates and costs stay on record.</p>
    <p className="text-xs text-[#8A8F98]">{PUBLISHER_AUTOPUBLISH_CONSENT_TEXT}</p>
    <label className="block text-sm"><input type="checkbox" className="mr-2" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
      Publish to my website automatically on this schedule.</label>
    <Button disabled={!confirmed || busy} loading={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await adopt({ siteId, reviewToken, confirm: true }); }
      catch (err) { setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Couldn't switch to Autopilot. Refresh and try again."); }
      finally { setBusy(false); }
    }}>Switch to Autopilot</Button>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
  </section>;
}
