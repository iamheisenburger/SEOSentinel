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
  return <section aria-labelledby="pentra-setup-heading" className="space-y-5 rounded-xl border border-white/[0.06] bg-[#0F1117] p-6">
    <div>
      <h2 id="pentra-setup-heading" className="text-lg font-semibold text-[#EDEEF1]">Turn on Pentra</h2>
      <p className="text-sm text-[#8B8FA3]">Your plan includes {state.plan.articlesPerMonth} new article{state.plan.articlesPerMonth === 1 ? "" : "s"} a month for {state.destination.domain}.</p>
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
        <span className="font-medium text-[#EDEEF1]">Autopilot (recommended)</span>
        <p className="mt-1 text-sm text-[#8B8FA3]">{paste ? "Needs a WordPress or GitHub connection, so Pentra can publish for you. " : ""}Pentra researches, writes and publishes on its own, {rhythm(state.plan.autopilotIntervalMs)}. Drafts it isn&apos;t confident about are held back, never published; everything else goes live automatically.</p>
      </label>
      <label className={`rounded-xl border p-4 transition ${reviewAvailable ? "cursor-pointer hover:border-white/20" : "opacity-50"} ${choice === "review" ? "border-[#0EA5E9] bg-[#0EA5E9]/[0.06]" : "border-white/10"}`}>
        <input type="radio" name="pentra-mode" className="mr-2" disabled={!reviewAvailable} checked={choice === "review"} onChange={() => setChoice("review")} />
        <span className="font-medium text-[#EDEEF1]">Review first</span>
        <p className="mt-1 text-sm text-[#8B8FA3]">{paste ? "Pentra researches and writes each article; you read it, then paste it into your site's blog." : reviewAvailable ? "Pentra drafts; you read, edit and approve every article before it goes live." : "Connect GitHub or WordPress to choose this."}</p>
      </label>
    </fieldset>
    {(choice === "autopilot" || !reviewAvailable) && <p className="text-xs text-[#8B8FA3]">{PUBLISHER_AUTOPUBLISH_CONSENT_TEXT}</p>}
    <label className="block text-sm"><input type="checkbox" className="mr-2" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
      My business details are accurate. Pentra writes only from these facts and its cited research.</label>
    <Button disabled={!ready || !confirmed || busy} loading={busy} onClick={start}>Start Pentra</Button>
    {!ready && <p className="text-sm text-[#8B8FA3]">Finish the steps above to start.</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
  </section>;
}

/** Autopilot on/off for sites set up through the new flow. */
export function AutopilotSwitch({ siteId, reviewToken, on, intervalMs, reviewAvailable = true, paused = false }:
  { siteId: Id<"sites">; reviewToken: string; on: boolean; intervalMs: number; reviewAvailable?: boolean; paused?: boolean }) {
  const setAutopilot = useMutation(api.contentWork.setAutopilot);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-[#0F1117] p-4">
    <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${on && !paused ? "bg-[#22C55E] shadow-[0_0_8px_#22C55E]" : on ? "bg-[#F59E0B]" : "bg-[#8B8FA3]"}`} />
    <div className="flex-1">
      <p className="font-medium text-[#EDEEF1]">Autopilot is {on ? (paused ? "paused" : "on") : "off"}</p>
      <p className="text-sm text-[#8B8FA3]">{on ? paused ? "No new articles start while paused. Resume from Service settings."
        : `Pentra publishes ${rhythm(intervalMs)}. Drafts it isn't confident about are held back and never published.`
        : "Every article waits for your approval in Articles."}</p>
    </div>
    {(!on || reviewAvailable) && <Button size="sm" variant={on ? "secondary" : "primary"} loading={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await setAutopilot({ siteId, enabled: !on, reviewToken }); }
      catch (err) { setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Couldn't change Autopilot. Refresh and try again."); }
      finally { setBusy(false); }
    }}>{on ? "Switch to review first" : "Turn on Autopilot"}</Button>}
    {error && <p role="alert" className="w-full text-sm text-red-400">{error}</p>}
  </div>;
}

/** Don't want to wait a day for the first article? Bring the next one forward. */
export function StartNow({ siteId, reviewToken }: { siteId: Id<"sites">; reviewToken: string }) {
  const start = useMutation(api.contentWork.startAutopilotNow);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <span className="inline-flex flex-wrap items-center gap-2">
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true); setError("");
      try { await start({ siteId, reviewToken }); }
      catch (err) { setError(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Couldn't bring it forward. Refresh and try again."); }
      finally { setBusy(false); }
    }}>Publish the next one in about 2 hours</Button>
    {error && <span role="alert" className="text-sm text-red-400">{error}</span>}
  </span>;
}

/** Existing contracts (set up before Autopilot) can move onto Autopilot. */
export function AdoptAutopilot({ siteId, reviewToken, intervalMs, articlesPerMonth }: { siteId: Id<"sites">; reviewToken: string; intervalMs: number; articlesPerMonth: number }) {
  const adopt = useMutation(api.contentWork.adoptAutopilot);
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <section aria-labelledby="adopt-autopilot-heading" className="space-y-3 rounded-xl border border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.04] p-5">
    <h2 id="adopt-autopilot-heading" className="font-semibold text-[#EDEEF1]">Move this site to Autopilot</h2>
    <p className="text-sm text-[#8B8FA3]">Pentra researches, writes and publishes {rhythm(intervalMs)} ({articlesPerMonth} a month on your plan), starting
      24 hours from now. Drafts that don&apos;t pass the fact check are held back and never published. Your past history, missed dates and costs stay on record.</p>
    <p className="text-xs text-[#8B8FA3]">{PUBLISHER_AUTOPUBLISH_CONSENT_TEXT}</p>
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
