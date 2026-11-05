"use client";
/** What Pentra found and fixed on the site (Nov 2026): the weekly diagnosis in plain words, the five things traffic
 * needs, the biggest problems, the duplicates Pentra merged (and whether each redirect is live), and what it does next.
 * The owner sees the work without asking anyone or reading Search Console. */
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

const CARD = "rounded-xl border border-white/[0.06] bg-[#0E0F11] p-5 space-y-3";
const BODY = "text-[14px] leading-relaxed text-[#8A8F98]";
const FACTORS: Array<[key: "searches" | "pages" | "authority" | "clicks" | "ai", label: string]> = [
  ["searches", "Searches it can win"], ["pages", "Pages worth ranking"], ["authority", "Sites linking to it"],
  ["clicks", "Clicks once it ranks"], ["ai", "Named by AI assistants"]];
const STATE: Record<string, [label: string, tone: string]> = {
  ok: ["Good", "bg-[#22C55E]/10 text-[#22C55E]"], weak: ["Weak", "bg-[#F59E0B]/10 text-[#F59E0B]"],
  failing: ["Failing", "bg-[#EF4444]/10 text-[#EF4444]"], unknown: ["Not measured", "bg-white/[0.04] text-[#8A8F98]"] };
const shown = (value: number) => new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(value);

export function SiteDiagnosisCard({ siteId }: { siteId: Id<"sites"> }) {
  const d = useQuery(api.siteDiagnosis.latest, { siteId });
  const redirects = useQuery(api.siteRedirects.listForSite, { siteId }) ?? [];
  if (!d) return null;
  const [standing, problems, next] = ["", "Biggest problems. ", "What Pentra does next. "].map((prefix, i) =>
    i === 0 ? d.summary.split("\n")[0] : d.summary.split("\n").find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? "");
  return <section className={CARD} aria-labelledby="site-diagnosis-heading">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id="site-diagnosis-heading" className="text-[15px] font-semibold text-[#F7F8F8]">What Pentra found</h2>
      <span className="text-[12px] text-[#62666D]">Checked {shown(d.createdAt)}{d.window ? ` · Search Console ${d.window.from} to ${d.window.to}` : ""}</span>
    </div>
    <p className="text-[14px] leading-relaxed text-[#F7F8F8]">{standing}</p>
    <ul className="grid gap-2 sm:grid-cols-5" aria-label="The five things traffic needs">
      {FACTORS.map(([key, label]) => { const [text, tone] = STATE[d.factors[key]] ?? STATE.unknown;
        return <li key={key} className="rounded-lg border border-white/[0.06] px-3 py-2">
          <p className="text-[12px] text-[#8A8F98]">{label}</p>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[12px] font-medium ${tone}`}>{text}</span>
        </li>; })}
    </ul>
    {d.findings.length > 0 && <div className="space-y-1.5">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#62666D]">Biggest problems</p>
      <ul className="space-y-1.5 text-[14px]">{d.findings.slice(0, 4).map((f) => <li key={f.problem}>
        <span className="text-[#F7F8F8]">{f.problem}</span><span className="text-[#8A8F98]">: {f.evidence}.</span></li>)}</ul>
    </div>}
    {!d.findings.length && problems && <p className={BODY}>{problems}</p>}
    {d.ai && <p className={BODY}>Asked {d.ai.questions.length} buyer {d.ai.questions.length === 1 ? "question" : "questions"} to ChatGPT, Gemini and Google AI Mode: named in {d.ai.named} of {d.ai.asked} answers.</p>}
    {redirects.length > 0 && <div className="space-y-1.5">
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#62666D]">What Pentra fixed</p>
      <ul className="space-y-1.5 text-[14px]">{redirects.slice(0, 6).map((r) => <li key={r.fromSlug} className="text-[#F7F8F8]">
        Merged duplicate <span className="font-mono text-[13px]">/{r.fromSlug}</span> into <span className="font-mono text-[13px]">/{r.toSlug}</span>
        <span className="text-[#8A8F98]"> · {r.verifiedAt ? "permanent redirect, checked live" : r.delivery === "not_delivered" ? r.deliveryNote ?? "needs a redirect on your platform" : "redirect going live"}</span>
      </li>)}</ul>
    </div>}
    {next && <p className={BODY}><span className="text-[#F7F8F8]">What Pentra does next: </span>{next}</p>}
  </section>;
}
