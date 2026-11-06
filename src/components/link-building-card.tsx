"use client";
/** Phase 4 (Nov 2026): links from other sites, the owner's view. What Pentra found (pages that link to the site's
 * competitors but not to it), the emails it wrote, what was sent, who replied, and which links went live; the mode
 * (off, find, drafts the owner sends, or sending for them) and the mailbox Pentra sends from. */
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const CARD = "rounded-xl border border-white/[0.06] bg-[#0E0F11] p-5 space-y-3";
const BODY = "text-[14px] leading-relaxed text-[#8A8F98]";
const INPUT = "w-full rounded-lg border border-white/[0.08] bg-[#08090E] px-3 py-2 text-[14px] text-[#F7F8F8] placeholder:text-[#62666D]";
const BUTTON = "rounded-lg border border-white/[0.08] px-3 py-1.5 text-[13px] font-medium text-[#F7F8F8] hover:bg-white/[0.04] disabled:opacity-40";
const MODES: Array<[mode: "off" | "find" | "draft" | "send", label: string, hint: string]> = [
  ["off", "Off", "Pentra doesn't look for links."],
  ["find", "Find only", "Pentra lists the pages that link to your competitors but not to you."],
  ["draft", "Write, I send", "Pentra writes each email; you press Send and it goes from your mailbox."],
  ["send", "Send for me", "Pentra sends up to 10 emails a week from your mailbox, with one follow-up, and stops when someone replies."]];
const STATUS: Record<string, [label: string, tone: string]> = {
  new: ["Found", "bg-white/[0.04] text-[#8A8F98]"], ready: ["Email ready", "bg-[#0EA5E9]/10 text-[#0EA5E9]"],
  sent: ["Emailed", "bg-[#0EA5E9]/10 text-[#0EA5E9]"], replied: ["Replied: answer in your inbox", "bg-[#F59E0B]/10 text-[#F59E0B]"],
  won: ["Links to you", "bg-[#22C55E]/10 text-[#22C55E]"], lost: ["Link removed", "bg-[#EF4444]/10 text-[#EF4444]"],
  no_contact: ["No email found", "bg-white/[0.04] text-[#8A8F98]"], skipped: ["Set aside", "bg-white/[0.04] text-[#62666D]"],
  dismissed: ["Set aside", "bg-white/[0.04] text-[#62666D]"], opted_out: ["Asked not to be emailed", "bg-white/[0.04] text-[#62666D]"],
  bounced: ["Email bounced", "bg-white/[0.04] text-[#62666D]"] };
const PROVIDERS: Array<[id: "gmail" | "outlook" | "zoho" | "fastmail" | "other", label: string]> = [
  ["gmail", "Gmail or Google Workspace"], ["outlook", "Outlook or Microsoft 365"], ["zoho", "Zoho Mail"], ["fastmail", "Fastmail"], ["other", "Another provider"]];
const message = (error: unknown) => error instanceof ConvexError ? String(error.data) : error instanceof Error ? error.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Something went wrong";

export function LinkBuildingCard({ siteId }: { siteId: Id<"sites"> }) {
  const data = useQuery(api.linkOpportunities.listForSite, { siteId });
  const mailbox = useQuery(api.linkOpportunities.mailbox, { siteId });
  const setMode = useMutation(api.linkOpportunities.setMode);
  const approve = useMutation(api.linkOpportunities.approve);
  const dismiss = useMutation(api.linkOpportunities.dismiss);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editingMailbox, setEditingMailbox] = useState(false);
  if (!data) return null;
  const run = (work: () => Promise<unknown>) => { setError(null); work().catch((e) => setError(message(e))); };
  const c = data.counts;
  return <section className={CARD} aria-labelledby="link-building-heading">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="link-building-heading" className="text-[15px] font-semibold text-[#F7F8F8]">Links from other sites</h2>
      {c.found > 0 && <span className="text-[12px] text-[#62666D]">{c.found} found · {c.contacted} emailed · {c.replied} replied · {c.won} linking to you</span>}
    </div>
    <p className={BODY}>Google trusts a site more when relevant sites link to it. Each week Pentra finds pages that link to your competitors but not to you,
      writes to the people who run them from your own mailbox, and checks whether the link goes live.</p>
    <div role="radiogroup" aria-label="Link building" className="flex flex-wrap gap-2">
      {MODES.map(([mode, label, hint]) => <button key={mode} type="button" role="radio" aria-checked={data.mode === mode} title={hint}
        disabled={mode === "send" && mailbox?.status !== "ready"}
        className={`${BUTTON} ${data.mode === mode ? "border-[#0EA5E9]/60 bg-[#0EA5E9]/10" : ""}`}
        onClick={() => run(() => setMode({ siteId, mode }))}>{label}</button>)}
    </div>
    <p className="text-[13px] text-[#62666D]">{MODES.find(([mode]) => mode === data.mode)?.[2]}</p>
    {data.mode !== "off" && data.mode !== "find" && (editingMailbox || !mailbox || mailbox.status === "failed"
      ? <MailboxForm siteId={siteId} failed={mailbox?.status === "failed" ? mailbox.note : null} onDone={() => setEditingMailbox(false)} />
      : <p className="text-[13px] text-[#8A8F98]">{mailbox.status === "checking" ? "Checking your mailbox (Pentra logs in; nothing is sent)…"
          : <>Sending from <span className="text-[#F7F8F8]">{mailbox.email}</span>, signed {mailbox.senderName}. </>}
        <button type="button" className="underline decoration-white/20 underline-offset-2 hover:text-[#F7F8F8]" onClick={() => setEditingMailbox(true)}>Change</button></p>)}
    {error && <p role="alert" className="text-[13px] text-[#EF4444]">{error}</p>}
    {data.items.length > 0 && <ul className="divide-y divide-white/[0.06]">
      {data.items.slice(0, 25).map((o) => { const [label, tone] = STATUS[o.status] ?? STATUS.new;
        return <li key={o.id} className="py-2.5 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href={o.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-[14px] text-[#F7F8F8] hover:underline">{o.title}</a>
            <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}>{label}</span>
          </div>
          <p className="text-[12px] text-[#62666D]">{o.domain} · {o.source === "ai_answer" ? "cited by AI assistants" : `strength ${o.rank}`} · links to {o.linksTo.join(", ")}
            {o.contact ? ` · ${o.contact}` : ""}{o.uncertain ? " · sending was interrupted; Pentra won't send it again" : ""}
            {o.target ? ` · suggests ${o.target.as === "product" ? "adding your site" : o.target.title}` : ""}{o.note && ["skipped", "no_contact"].includes(o.status) ? ` · ${o.note}` : ""}</p>
          {o.pitch && <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? "Hide email" : "Read email"}</button>
            {o.status === "ready" && data.mode === "draft" && !o.approved && <button type="button" className={BUTTON} disabled={mailbox?.status !== "ready"}
              onClick={() => run(() => approve({ siteId, id: o.id }))}>Send</button>}
            {o.status === "ready" && o.approved && <span className="text-[12px] text-[#8A8F98]">Sending at the next allowed time</span>}
            {["ready", "new", "no_contact"].includes(o.status) && <button type="button" className={BUTTON} onClick={() => run(() => dismiss({ siteId, id: o.id }))}>Set aside</button>}
          </div>}
          {open === o.id && o.pitch && <div className="rounded-lg border border-white/[0.06] bg-[#08090E] p-3 text-[13px] leading-relaxed">
            <p className="text-[#F7F8F8]">Subject: {o.pitch.subject}</p>
            <p className="mt-2 whitespace-pre-line text-[#8A8F98]">{o.pitch.body}</p>
          </div>}
        </li>; })}
    </ul>}
    {data.mode !== "off" && data.items.length === 0 && <p className={BODY}>Pentra looks for these pages in its weekly check-up; they will appear here.</p>}
  </section>;
}

function MailboxForm({ siteId, failed, onDone }: { siteId: Id<"sites">; failed: string | null; onDone: () => void }) {
  const connect = useMutation(api.linkOpportunities.connectMailbox);
  const [form, setForm] = useState({ provider: "gmail" as (typeof PROVIDERS)[number][0], email: "", password: "", senderName: "", postalAddress: "",
    smtpHost: "", smtpPort: "465", imapHost: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const submit = () => { setBusy(true); setError(null);
    connect({ siteId, provider: form.provider, email: form.email, password: form.password, senderName: form.senderName, postalAddress: form.postalAddress,
      ...(form.provider === "other" ? { smtpHost: form.smtpHost, smtpPort: Number(form.smtpPort), imapHost: form.imapHost, imapPort: 993 } : {}) })
      .then(() => { setForm({ ...form, password: "" }); onDone(); }).catch((e) => setError(message(e))).finally(() => setBusy(false)); };
  return <form className="space-y-2 rounded-lg border border-white/[0.06] p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
    <p className="text-[13px] text-[#F7F8F8]">Connect the mailbox Pentra sends from</p>
    {failed && <p role="alert" className="text-[13px] text-[#EF4444]">{failed}</p>}
    <select className={INPUT} value={form.provider} onChange={set("provider")} aria-label="Mail provider">
      {PROVIDERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
    <input className={INPUT} type="email" autoComplete="email" placeholder="you@yourcompany.com" value={form.email} onChange={set("email")} aria-label="Email address" required />
    <input className={INPUT} type="password" autoComplete="new-password" placeholder={form.provider === "gmail" ? "App password (16 letters)" : "Password or app password"}
      value={form.password} onChange={set("password")} aria-label="Password" required />
    {form.provider === "gmail" && <p className="text-[12px] text-[#62666D]">Gmail needs an app password: turn on 2-Step Verification, then create one at{" "}
      <a className="underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener noreferrer">myaccount.google.com/apppasswords</a>.</p>}
    {form.provider === "other" && <div className="grid gap-2 sm:grid-cols-3">
      <input className={INPUT} placeholder="SMTP server (smtp.example.com)" value={form.smtpHost} onChange={set("smtpHost")} aria-label="SMTP server" />
      <select className={INPUT} value={form.smtpPort} onChange={set("smtpPort")} aria-label="SMTP port"><option value="465">465</option><option value="587">587</option></select>
      <input className={INPUT} placeholder="IMAP server (imap.example.com)" value={form.imapHost} onChange={set("imapHost")} aria-label="IMAP server" />
    </div>}
    <input className={INPUT} placeholder="The name you sign emails with" value={form.senderName} onChange={set("senderName")} aria-label="Your name" required />
    <input className={INPUT} placeholder="Business postal address" value={form.postalAddress} onChange={set("postalAddress")} aria-label="Postal address" required />
    <p className="text-[12px] text-[#62666D]">US anti-spam law asks every business email to show a postal address and a way to opt out; Pentra adds both to each email.
      The password is encrypted; Pentra reads your inbox only for replies to these emails.</p>
    {error && <p role="alert" className="text-[13px] text-[#EF4444]">{error}</p>}
    <button type="submit" className={BUTTON} disabled={busy}>{busy ? "Connecting…" : "Connect mailbox"}</button>
  </form>;
}
