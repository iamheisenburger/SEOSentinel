"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { startFreeCheck } from "./check-form";
import { FREE_CHECK_DOMAIN_KEY } from "@/lib/free-check-key";

type View = NonNullable<FunctionReturnType<typeof api.freeCheck.get>>;

const EYEBROW = "font-mono text-[12px] uppercase tracking-[0.12em] text-[#62666D]";
const PANEL = "rounded-xl border border-white/[0.06] bg-[#0B0C0E] p-5 md:p-6";
const STEPS = ["Reading your homepage", "Checking what Google can see", "Finding searches your customers make", "Checking which searches fit your business"];

const number = (value: number) => value.toLocaleString("en-US");
const competition = (difficulty: number) => difficulty < 15 ? "Very low" : "Low";
const pagePath = (url: string) => { try { return decodeURI(new URL(url).pathname); } catch { return url; } };

/** To signup (or, signed in, to a new website's setup) with the checked
 * website remembered for the setup form, and the click counted. */
function SignupCta({ domain, signedIn, children }: { domain: string; signedIn: boolean; children: React.ReactNode }) {
  const remember = () => {
    try { window.localStorage.setItem(FREE_CHECK_DOMAIN_KEY, domain); } catch { /* private browsing: setup starts empty */ }
    try { navigator.sendBeacon?.("/api/check", new Blob([JSON.stringify({ event: "signup_click", domain })], { type: "application/json" })); }
    catch { /* not counted */ }
  };
  return <Link href={signedIn ? "/dashboard?setup=new" : "/sign-up"} onClick={remember}
    className="group inline-flex items-center gap-2 rounded-full bg-[#F7F8F8] px-5 py-2.5 text-[15px] font-medium text-[#08090A] transition hover:bg-white">
    {children}<ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
  </Link>;
}

function StartButton({ domain, label }: { domain: string; label: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div className="space-y-3">
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      const started = await startFreeCheck(domain);
      if ("error" in started) setError(started.error);
      else if (started.status === "failed") setError("This website's last check failed less than an hour ago. Try again later.");
      setBusy(false);
    }} className="inline-flex items-center gap-2 rounded-full bg-[#F7F8F8] px-5 py-2.5 text-[15px] font-medium text-[#08090A] transition hover:bg-white disabled:opacity-60">
      {busy ? "Starting…" : label}
    </button>
    {error && <p role="alert" className="text-[13px] text-[#F59E0B]">{error}</p>}
  </div>;
}

function Running({ view }: { view: View }) {
  const current = Math.max(0, STEPS.indexOf(view.step ?? ""));
  return <section className={PANEL} aria-live="polite">
    <p className={EYEBROW}>Checking {view.domain}</p>
    <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#F7F8F8] md:text-3xl">Finding the searches {view.domain} is missing</h1>
    <ol className="mt-6 space-y-3">
      {STEPS.map((step, i) => <li key={step} className={`flex items-center gap-3 text-[14px] ${i <= current ? "text-[#F7F8F8]" : "text-[#62666D]"}`}>
        {i < current ? <Check className="h-4 w-4 text-[#4CB782]" aria-hidden /> : i === current
          ? <Loader2 className="h-4 w-4 animate-spin text-[#0EA5E9]" aria-hidden /> : <span className="h-4 w-4 rounded-full border border-white/[0.12]" aria-hidden />}
        {step}
      </li>)}
    </ol>
    <p className="mt-6 text-[13px] text-[#8A8F98]">This usually takes under a minute. You can share this page: the result appears here.</p>
  </section>;
}

function Done({ view, signedIn }: { view: View; signedIn: boolean }) {
  const [copied, setCopied] = useState(false);
  const checked = view.completedAt ? new Date(view.completedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
  return <div className="space-y-6">
    <section className={PANEL}>
      <p className={EYEBROW}>Missed searches{view.countryName ? ` · Google in ${view.countryName}` : ""}</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#F7F8F8] md:text-3xl [text-wrap:balance]">
        {view.totalMissed > 0 ? `${view.totalMissed} Google searches ${view.domain} is missing` : `No missed searches found for ${view.domain}`}
      </h1>
      {view.totalMissed > 0 ? <p className="mt-3 text-[15px] leading-relaxed text-[#8A8F98]">
        People who could become your customers make these searches about {number(view.monthlySearches)} times a month in total.
        {" "}{view.domain} has no page for them and doesn&apos;t appear on Google&apos;s first two pages. Each has low competition, so a good page has a real chance to rank.
      </p> : <p className="mt-3 text-[15px] leading-relaxed text-[#8A8F98]">
        {view.keywordsUnavailable
          ? `Pentra couldn't find search data for ${view.domain}. This happens when a homepage has little text Pentra can read (for example, a site built entirely in JavaScript) or when the site is very new.`
          : `Pentra didn't find low-competition searches from your customers that ${view.domain} has no page for. Your site may already cover them, or your homepage says little about what you sell.`}
      </p>}
      {view.missed.length > 0 && <div className="mt-5 overflow-hidden rounded-lg border border-white/[0.06]">
        <table className="w-full text-left text-[14px]">
          <thead className="bg-white/[0.02] text-[12px] text-[#8A8F98]"><tr>
            <th scope="col" className="px-4 py-2.5 font-medium">Search</th>
            <th scope="col" className="px-4 py-2.5 text-right font-medium">Searches a month</th>
            <th scope="col" className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Competition</th>
          </tr></thead>
          <tbody>
            {view.missed.map(row => <tr key={row.keyword} className="border-t border-white/[0.06]">
              <td className="px-4 py-3 text-[#F7F8F8]">{row.keyword}</td>
              <td className="px-4 py-3 text-right tabular-nums text-[#D0D6E0]">{number(row.searchVolume)}</td>
              <td className="hidden px-4 py-3 text-right text-[#8A8F98] sm:table-cell">{competition(row.difficulty)} <span className="text-[#62666D]">({row.difficulty}/100)</span></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
      {view.hiddenCount > 0 && <div className="relative mt-3 overflow-hidden rounded-lg border border-white/[0.06]">
        {/* Placeholder bars only: the hidden searches are never sent to a signed-out browser. */}
        <div aria-hidden className="select-none blur-[2px]">
          {Array.from({ length: Math.min(view.hiddenCount, 4) }, (_, i) => <div key={i} className="flex items-center justify-between border-t border-white/[0.06] px-4 py-4 first:border-t-0">
            <span className="h-3 rounded bg-white/[0.08]" style={{ width: `${[56, 44, 62, 38][i]}%` }} /><span className="h-3 w-10 rounded bg-white/[0.08]" />
          </div>)}
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#08090A]/70 px-4 text-center">
          <p className="text-[15px] font-medium text-[#F7F8F8]">{view.hiddenCount} more missed {view.hiddenCount === 1 ? "search" : "searches"}</p>
          <p className="max-w-sm text-[13px] text-[#8A8F98]">Create a free account to see them all. Pentra then writes your first 3 articles free.</p>
          <SignupCta domain={view.domain} signedIn={signedIn}>See all {view.totalMissed}</SignupCta>
        </div>
      </div>}
    </section>

    {view.almost.length > 0 && <section className={PANEL} aria-labelledby="free-check-almost">
      <h2 id="free-check-almost" className="text-[17px] font-semibold text-[#F7F8F8]">Close to page one</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-[#8A8F98]">{view.domain} already shows up for these searches, just below the top three. Improving the page that ranks is usually the quickest win.</p>
      <ul className="mt-4 divide-y divide-white/[0.06]">
        {view.almost.map(row => <li key={row.keyword} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-[14px]">
          <span className="text-[#F7F8F8]">{row.keyword}</span>
          <span className="text-[#8A8F98]"><span className="text-[#D0D6E0]">#{row.position}</span> on Google · {number(row.searchVolume)} a month · <span className="text-[#62666D]">{pagePath(row.url)}</span></span>
        </li>)}
      </ul>
    </section>}

    {view.health && <section className={PANEL} aria-labelledby="free-check-health">
      <h2 id="free-check-health" className="text-[17px] font-semibold text-[#F7F8F8]">Google basics: {view.health.passed} of {view.health.total} pass</h2>
      {view.health.issues.length === 0
        ? <p className="mt-1.5 text-[14px] text-[#8A8F98]">Your homepage passes every basic check.</p>
        : <ul className="mt-4 space-y-2.5">
          {view.health.issues.map(item => <li key={item.code} className="flex gap-3 text-[14px] leading-relaxed text-[#D0D6E0]">
            <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${item.severity === "critical" ? "bg-[#EF4444]" : "bg-[#F59E0B]"}`} aria-hidden />
            <span><span className="sr-only">{item.severity === "critical" ? "Serious: " : "Worth fixing: "}</span>{item.message}</span>
          </li>)}
        </ul>}
    </section>}

    <section className="rounded-xl border border-[#0EA5E9]/25 bg-[#0EA5E9]/[0.05] p-5 md:p-6">
      <h2 className="text-[17px] font-semibold text-[#F7F8F8]">Let Pentra write these pages for you</h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-[#C9CDD6]">
        Pentra learns what you sell, writes a fact-checked article for searches like these, publishes it to your site
        (WordPress, Shopify, Webflow, Ghost or GitHub, or you paste it in), and improves the pages closest to page one.
        You see the results in your own Search Console data.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <SignupCta domain={view.domain} signedIn={signedIn}>{signedIn ? `Set up ${view.domain} in Pentra` : "Start free"}</SignupCta>
        {!signedIn && <span className="text-[13px] text-[#8A8F98]">3 free articles a month · No credit card</span>}
      </div>
    </section>

    <footer className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-[#62666D]">
      <p>{checked ? `Checked ${checked}. ` : ""}Monthly searches and competition are Google data from DataForSEO. Results are kept for 7 days.</p>
      <div className="flex items-center gap-4">
        <button type="button" className="text-[#D0D6E0] hover:text-white" onClick={() => {
          navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true), () => setCopied(false));
        }}>{copied ? "Link copied" : "Copy link"}</button>
        <Link href="/check" className="text-[#D0D6E0] hover:text-white">Check another website</Link>
      </div>
    </footer>
  </div>;
}

/** A free check's live result page (convex/freeCheck.ts get). */
export function FreeCheckResult({ domain }: { domain: string }) {
  const { isSignedIn } = useAuth();
  const view = useQuery(api.freeCheck.get, { domain });
  if (view === undefined) return <section className={PANEL} aria-busy="true">
    <p className={EYEBROW}>Missed searches</p>
    <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#F7F8F8]">Loading the check for {domain}…</h1>
  </section>;
  if (view === null) return <section className={PANEL}>
    <p className={EYEBROW}>Missed searches</p>
    <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#F7F8F8]">Pentra hasn&apos;t checked {domain} yet</h1>
    <p className="mt-2 mb-5 text-[15px] text-[#8A8F98]">Find the Google searches its customers make that it has no page for. Free, about a minute.</p>
    <StartButton domain={domain} label={`Check ${domain} free`} />
  </section>;
  if (view.status === "running") return <Running view={view} />;
  if (view.status === "failed") {
    return <section className={PANEL}>
      <p className={EYEBROW}>Missed searches</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-[#F7F8F8]">The check for {domain} didn&apos;t finish</h1>
      <p className="mt-2 mb-5 text-[15px] text-[#8A8F98]">{view.error ?? "Pentra couldn't finish this check."}</p>
      <div className="flex flex-wrap items-start gap-6">
        <StartButton domain={domain} label="Try again" />
        <Link href="/check" className="mt-2.5 text-[14px] text-[#D0D6E0] hover:text-white">Check another website →</Link>
      </div>
    </section>;
  }
  return <Done view={view} signedIn={isSignedIn === true} />;
}
