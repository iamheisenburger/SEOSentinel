"use client";
import { useAuth } from "@clerk/nextjs";
import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { ContentWorkService } from "@/components/content-work-service";

/** Content-only onboarding reuses the owner-authenticated site writer, trusted
 * billing sync and existing connection UI. It launches no paid legacy bootstrap
 * or outreach workflow. Service choice and publication consent come afterwards. */
export function ContentStart() {
  const { isLoaded, userId } = useAuth(), upsert = useMutation(api.sites.upsert);
  const [siteId, setSiteId] = useState<Id<"sites"> | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [domain, setDomain] = useState(""), [name, setName] = useState(""), [summary, setSummary] = useState(""), [audience, setAudience] = useState(""), [product, setProduct] = useState(""), [questions, setQuestions] = useState("");
  const [adapter, setAdapter] = useState("github"), [confirmed, setConfirmed] = useState(false);
  const [ctaUrl, setCtaUrl] = useState(""), [ctaText, setCtaText] = useState("");
  const ctaValid = !ctaUrl.trim() || /^https:\/\/[^\s<>"'()[\]]{3,300}$/.test(ctaUrl.trim());
  const prefillSite = useAction(api.actions.onboardingPrefill.prefill);
  const [filling, setFilling] = useState(false), [fillNote, setFillNote] = useState("");
  async function fillFromWebsite() {
    if (!domain.trim()) return;
    setFilling(true); setFillNote("");
    try {
      const found = await prefillSite({ domain: domain.trim() });
      const keep = (current: string, next: string) => current.trim() ? current : next;
      setName(v => keep(v, found.name)); setSummary(v => keep(v, found.summary)); setProduct(v => keep(v, found.product));
      setAudience(v => keep(v, found.audience)); setQuestions(v => keep(v, found.questions.join("\n")));
      setCtaUrl(v => keep(v, found.ctaUrl)); setCtaText(v => keep(v, found.ctaText));
      setConfirmed(false);
      setFillNote(`Filled in from ${found.host}. Check every detail and correct anything that isn't right before saving.`);
    } catch (err) {
      setFillNote(err instanceof ConvexError && typeof err.data === "string" ? err.data : "Pentra couldn't read that website. Fill in the details yourself.");
    } finally { setFilling(false); }
  }
  async function save() {
    if (!userId || !confirmed) return;
    setBusy(true); setError("");
    try {
      const billing = await fetch("/api/billing/sync-plan", { method: "POST", cache: "no-store" });
      if (!billing.ok) throw new Error("billing");
      const id = await upsert({ createOnly: true, contentSetup: true, domain: domain.trim(), clerkUserId: userId,
        siteName: name.trim(), siteSummary: summary.trim(), niche: summary.trim(), blogTheme: product.trim(),
        targetAudienceSummary: audience.trim(), productUsage: product.trim(), painPoints: questions.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 12),
        anchorKeywords: questions.split("\n").map(s => s.trim()).filter(Boolean).slice(0, 12), publishMethod: adapter,
        ...(ctaUrl.trim() ? { ctaUrl: ctaUrl.trim(), ctaText: ctaText.trim().slice(0, 60) || "Get started" } : {}),
        autopilotEnabled: false, approvalRequired: true, inferToneNiche: false, language: "en" });
      setSiteId(id);
    } catch { setError("We couldn't save your setup. Check that your plan allows another website (Plans & billing) and that this domain is yours. Nothing was charged."); }
    finally { setBusy(false); }
  }
  const steps = (active: number) => <ol className="flex flex-wrap gap-2 text-[12px]" aria-label="Setup steps">
    {["Your business", "Connect your website", "Autopilot or Review first"].map((step, n) => <li key={step}
      className={`flex items-center gap-2 rounded-full border px-3 py-1 ${n === active ? "border-white/20 bg-white/[0.06] text-[#F7F8F8]" : n < active ? "border-[#4CB782]/30 text-[#4CB782]" : "border-white/[0.08] text-[#8A8F98]"}`}>
      <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ${n === active ? "bg-[#F7F8F8] text-[#08090A]" : n < active ? "bg-[#4CB782]/20" : "bg-white/[0.06]"}`}>{n < active ? "✓" : n + 1}</span>{step}</li>)}
  </ol>;
  if (siteId) return <div className="mx-auto max-w-3xl space-y-5">
    <header className="space-y-3"><h1 className="text-2xl font-semibold tracking-tight text-[#F7F8F8]">Finish setting up Pentra</h1>{steps(adapter === "manual" ? 2 : 1)}</header>
    {adapter === "manual" ? <p className="text-[14px] text-[#8A8F98]">Your profile is saved. Start Pentra below: it researches and writes each article, and you paste it into your site.</p> : <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#0EA5E9]/30 bg-[#0EA5E9]/[0.04] p-4">
      <p className="flex-1 text-[14px] text-[#F7F8F8]">Your profile is saved. Connect and verify your website, then choose Autopilot or Review first.</p>
      <Link className="rounded-lg bg-[#F7F8F8] px-4 py-2 text-[13px] font-medium text-[#08090A] hover:bg-white" href={`/sites/${siteId}?tab=settings`}>Connect your website in settings</Link></div>}
    <ContentWorkService key={siteId} siteId={siteId} />
  </div>;
  const PANEL = "space-y-4 rounded-xl border border-white/[0.06] bg-[#0E0F11] p-5", H2 = "text-[15px] font-semibold text-[#F7F8F8]", HELP = "text-[13px] leading-relaxed text-[#8A8F98]";
  const edit = (set: (value: string) => void) => (e: { target: { value: string } }) => { set(e.target.value); setConfirmed(false); };
  return <div className="mx-auto max-w-2xl space-y-5">
    <header className="space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight text-[#F7F8F8]">Set up Pentra for your website</h1>
      <p className="text-[14px] leading-relaxed text-[#8A8F98]">Tell Pentra about your business, connect your website, and choose Autopilot or Review first. Then Pentra researches, writes, publishes and checks every article for you.</p>
      {steps(0)}
    </header>
    <section className={PANEL} aria-labelledby="setup-website">
      <h2 id="setup-website" className={H2}>Your website</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1"><Input label="Website domain" value={domain} onChange={edit(setDomain)} placeholder="yourbusiness.com" /></div>
        <Button disabled={!domain.trim() || filling} loading={filling} onClick={fillFromWebsite}>Fill in from my website</Button>
      </div>
      <p className={HELP} role="status">{fillNote || "Pentra reads your homepage and suggests the details below. You check them before anything is written."}</p>
    </section>
    <section className={PANEL} aria-labelledby="setup-business">
      <div className="space-y-1"><h2 id="setup-business" className={H2}>About your business</h2>
        <p className={HELP}>Pentra writes only from these facts, so keep them accurate and specific.</p></div>
      <Input label="Business name" value={name} onChange={edit(setName)} placeholder="Northside Dental" />
      <Textarea label="Confirmed business facts" value={summary} onChange={edit(setSummary)} placeholder="Family dental practice in Leeds since 2009. General, cosmetic and emergency dentistry. Open Saturdays." />
      <Textarea label="Who you serve" value={audience} onChange={edit(setAudience)} placeholder="Families and working adults in north Leeds who want a dentist they can reach quickly." />
      <Textarea label="What your product or service does" value={product} onChange={edit(setProduct)} placeholder="Check-ups, cleaning, whitening, Invisalign and same-day emergency appointments." />
      <Textarea label="Real customer questions (one per line)" value={questions} onChange={edit(setQuestions)} placeholder={"How long does teeth whitening last?\nDo you take emergency patients on weekends?"} />
    </section>
    <section className={PANEL} aria-labelledby="setup-next-step">
      <div className="space-y-1"><h2 id="setup-next-step" className={H2}>Turning readers into customers</h2>
        <p className={HELP}>Each article ends with one clear next step to this page. Leave it empty to link to your homepage.</p></div>
      <Input label="Where should readers go to become customers? (optional)" value={ctaUrl} onChange={edit(setCtaUrl)} placeholder="https://yourbusiness.com/book" />
      {ctaUrl.trim() && <Input label="Button text" value={ctaText} onChange={e => setCtaText(e.target.value)} placeholder="Book a visit" />}
      {!ctaValid && <p role="alert" className="text-[13px] text-[#F59E0B]">Use a full link that starts with https://</p>}
    </section>
    <section className={PANEL} aria-labelledby="setup-destination">
      <h2 id="setup-destination" className={H2}>Where Pentra publishes</h2>
      <label className="block space-y-1.5"><span className="text-[13px] font-medium text-[#8A8F98]">Publishing destination</span>
        <select className="block w-full rounded-lg border border-white/[0.1] bg-[#08090A] px-3 py-2.5 text-[14px] text-[#F7F8F8] focus:border-white/30 focus:outline-none"
          aria-label="Content publishing destination" value={adapter} onChange={e => { setAdapter(e.target.value); setConfirmed(false); }}>
          <option value="github">GitHub · plain Markdown/MDX</option>
          <option value="wordpress">WordPress · install the Pentra publisher plugin</option>
          <option value="manual">Another platform (Shopify, Webflow, Wix, Squarespace…) · you paste articles in</option>
        </select></label>
      {adapter === "github" && <p className={HELP}>Pentra commits each article as a Markdown/MDX file to your site&apos;s repository. You&apos;ll connect GitHub in the next step.</p>}
      {adapter === "manual" && <p className={HELP}>Pentra researches, writes and fact-checks every article for you to review; you paste each one into your site&apos;s blog and Pentra confirms it&apos;s live. Automatic publishing for these platforms is coming soon.</p>}
      {adapter === "wordpress" && <p className={HELP}><a className="font-medium text-[#0EA5E9] hover:underline" href="/pentra-wordpress-plugin.zip" download>Download the Pentra WordPress plugin (ZIP)</a>. In WordPress go to Plugins → Add New → Upload Plugin, choose the ZIP and activate it. You&apos;ll connect it in the next step.</p>}
    </section>
    <section className={PANEL}>
      <label className="flex items-start gap-3 text-[14px] text-[#F7F8F8]"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#F7F8F8]" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        <span>These facts are accurate. Pentra writes only from them.</span></label>
      <div className="flex flex-wrap items-center gap-4">
        <Button disabled={busy || !isLoaded || !userId || !confirmed || !ctaValid || !domain.trim() || !summary.trim() || !audience.trim() || !product.trim()} onClick={save}>{busy ? "Saving…" : "Save and continue"}</Button>
        <Link className="text-[13px] text-[#8A8F98] underline-offset-2 hover:text-[#F7F8F8] hover:underline" href="/upgrade">Plans &amp; billing</Link>
      </div>
      <p className={HELP}>Saving doesn&apos;t charge you. Pentra only adds new articles; it never changes your pricing, checkout or legal pages.</p>
      {error && <p role="alert" className="text-[13px] text-red-400">{error}</p>}
    </section>
  </div>;
}
