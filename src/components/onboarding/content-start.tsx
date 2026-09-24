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
    } catch { setError("Setup could not be saved. Verify your existing plan and site allowance in Billing, and check that this domain belongs to you. No paid preparation or outreach was started."); }
    finally { setBusy(false); }
  }
  if (siteId) return <div className="mx-auto max-w-3xl space-y-4"><h1 className="text-xl font-semibold">Finish your content setup</h1>
    <p>Your profile is saved. Connect and verify your GitHub publishing destination, then enable drafts for your review. Nothing publishes automatically.</p>
    <Link className="underline" href={`/sites/${siteId}?tab=settings`}>Connect GitHub in website settings</Link>
    <ContentWorkService key={siteId} siteId={siteId} />
  </div>;
  return <section className="mx-auto max-w-2xl space-y-4 rounded-xl border border-white/10 p-5"><h1 className="text-xl font-semibold">Start your content service</h1>
    <p>Tell Pentra what your business does and who it serves. Connect GitHub, request a draft, review or edit it, then approve publication. No automatic schedule or outreach setup is required.</p>
    <Input label="Website domain" value={domain} onChange={e => { setDomain(e.target.value); setConfirmed(false); }} placeholder="yourbusiness.com" />
    <Input label="Business name" value={name} onChange={e => { setName(e.target.value); setConfirmed(false); }} />
    <Textarea label="Confirmed business facts" value={summary} onChange={e => { setSummary(e.target.value); setConfirmed(false); }} />
    <Textarea label="Who you serve" value={audience} onChange={e => { setAudience(e.target.value); setConfirmed(false); }} />
    <Textarea label="What your product or service does" value={product} onChange={e => { setProduct(e.target.value); setConfirmed(false); }} />
    <Textarea label="Real customer questions (one per line)" value={questions} onChange={e => { setQuestions(e.target.value); setConfirmed(false); }} />
    <label className="block">Publishing destination<select className="block w-full rounded-lg border border-white/15 bg-[#0F1117] p-2" aria-label="Content publishing destination" value={adapter} onChange={e => { setAdapter(e.target.value); setConfirmed(false); }}><option value="github">GitHub · plain Markdown/MDX</option><option value="wordpress" disabled>WordPress · not part of this owner-reviewed release</option></select></label>
    {adapter === "wordpress" && <a className="underline" href="https://github.com/iamheisenburger/SEOSentinel/blob/main/connectors/wordpress/README.md" target="_blank" rel="noreferrer">Install the WordPress connector</a>}
    <p className="text-sm">Unsupported layouts cannot be edited automatically. Pricing, checkout, legal text and unselected pages stay protected. This does not purchase a plan or credits.</p>
    <label className="block text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> These are accurate business facts, not capabilities or results Pentra should invent.</label>
    <Button disabled={busy || !isLoaded || !userId || !confirmed || !domain.trim() || !summary.trim() || !audience.trim() || !product.trim()} onClick={save}>{busy ? "Verifying plan and saving…" : "Verify existing plan and save profile"}</Button>
    <p><Link className="underline text-sm" href="/settings/billing">Review existing billing</Link></p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
