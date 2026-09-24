"use client";
import { useAuth } from "@clerk/nextjs";
import { useMutation } from "convex/react";
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
        autopilotEnabled: false, approvalRequired: true, inferToneNiche: false, language: "en" });
      setSiteId(id);
    } catch { setError("We couldn't save your setup. Check that your plan allows another website (Plans & billing) and that this domain is yours. Nothing was charged."); }
    finally { setBusy(false); }
  }
  if (siteId) return <div className="mx-auto max-w-3xl space-y-4"><h1 className="text-xl font-semibold">Finish setting up Pentra</h1>
    <p>Your profile is saved. Connect and verify your website, then choose Autopilot or Review first.</p>
    <Link className="underline" href={`/sites/${siteId}?tab=settings`}>Connect your website in settings</Link>
    <ContentWorkService key={siteId} siteId={siteId} />
  </div>;
  return <section className="mx-auto max-w-2xl space-y-4 rounded-xl border border-white/10 p-5"><h1 className="text-xl font-semibold">Set up Pentra for your website</h1>
    <p>Tell Pentra what your business does and who it serves, connect your website, and choose Autopilot or Review first. Pentra handles the research, writing, publishing and checks.</p>
    <Input label="Website domain" value={domain} onChange={e => { setDomain(e.target.value); setConfirmed(false); }} placeholder="yourbusiness.com" />
    <Input label="Business name" value={name} onChange={e => { setName(e.target.value); setConfirmed(false); }} />
    <Textarea label="Confirmed business facts" value={summary} onChange={e => { setSummary(e.target.value); setConfirmed(false); }} />
    <Textarea label="Who you serve" value={audience} onChange={e => { setAudience(e.target.value); setConfirmed(false); }} />
    <Textarea label="What your product or service does" value={product} onChange={e => { setProduct(e.target.value); setConfirmed(false); }} />
    <Textarea label="Real customer questions (one per line)" value={questions} onChange={e => { setQuestions(e.target.value); setConfirmed(false); }} />
    <label className="block">Publishing destination<select className="block w-full rounded-lg border border-white/15 bg-[#0F1117] p-2" aria-label="Content publishing destination" value={adapter} onChange={e => { setAdapter(e.target.value); setConfirmed(false); }}><option value="github">GitHub · plain Markdown/MDX</option><option value="wordpress">WordPress · install the Pentra publisher plugin</option></select></label>
    {adapter === "wordpress" && <a className="underline" href="https://github.com/iamheisenburger/SEOSentinel/blob/main/connectors/wordpress/README.md" target="_blank" rel="noreferrer">Install the WordPress connector</a>}
    <p className="text-sm text-[#8B8FA3]">Saving doesn&apos;t charge you. Pentra only adds new articles; it never changes your pricing, checkout or legal pages.</p>
    <label className="block text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> These facts are accurate. Pentra writes only from them and from sources it cites.</label>
    <Button disabled={busy || !isLoaded || !userId || !confirmed || !domain.trim() || !summary.trim() || !audience.trim() || !product.trim()} onClick={save}>{busy ? "Saving…" : "Save and continue"}</Button>
    <p><Link className="underline text-sm" href="/upgrade">Plans & billing</Link></p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
