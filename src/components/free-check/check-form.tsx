"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

/** What /api/check answers when no check can start, in the visitor's words. */
export function freeCheckMessage(status: string): string | null {
  if (status === "limited") return "This network has used today's free checks. Come back tomorrow, or create a free account and Pentra researches your site for you.";
  if (status === "paused") return "Today's free checks are used up. Come back tomorrow, or create a free account and Pentra researches your site for you.";
  if (status === "invalid") return "Enter your website address, like yourbusiness.com.";
  return null;
}

/** Start a free check (or open a recent one) and go to its result page. */
export async function startFreeCheck(url: string): Promise<{ domain: string; status: string } | { error: string }> {
  try {
    const response = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
    const body = (await response.json().catch(() => ({}))) as { status?: string; domain?: string | null; error?: string };
    if (!response.ok) return { error: body.error ?? "Pentra couldn't start the check just now. Try again in a minute." };
    const blocked = freeCheckMessage(body.status ?? "");
    if (blocked) return { error: blocked };
    return body.domain ? { domain: body.domain, status: body.status ?? "running" } : { error: "Pentra couldn't start the check just now. Try again in a minute." };
  } catch {
    return { error: "Pentra couldn't start the check just now. Check your connection and try again." };
  }
}

export function FreeCheckForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null), [paused, setPaused] = useState(false);
  // Say up front when this network is low on or out of checks, instead of after a
  // click. The button stays on: a website checked before is shown free.
  useEffect(() => {
    let live = true;
    fetch("/api/check", { cache: "no-store" }).then(r => r.json()).then((body: { remaining?: number | null; paused?: boolean }) => {
      if (!live || typeof body.remaining !== "number") return;
      setRemaining(body.remaining); setPaused(Boolean(body.paused));
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const exhausted = remaining === 0;
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim() || busy) return;
    setBusy(true); setError("");
    const started = await startFreeCheck(url.trim());
    if ("domain" in started) router.push(`/check/${started.domain}`);
    else { setError(started.error); setBusy(false); }
  }
  return <form onSubmit={submit} className="w-full max-w-[34rem]" noValidate>
    <div className="flex flex-col gap-3 sm:flex-row">
      <label htmlFor="free-check-url" className="sr-only">Your website address</label>
      <input id="free-check-url" type="text" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} autoFocus={autoFocus}
        value={url} onChange={e => { setUrl(e.target.value); setError(""); }} placeholder="yourbusiness.com" aria-describedby="free-check-status"
        className="min-w-0 flex-1 rounded-full border border-white/[0.12] bg-white/[0.03] px-5 py-3 text-[16px] text-[#F7F8F8] placeholder:text-[#62666D] focus:border-white/30 focus:outline-none" />
      <button type="submit" disabled={busy || !url.trim()}
        className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#F7F8F8] px-6 py-3 text-[15px] font-medium text-[#08090A] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? "Starting…" : "Check my site"}
        {!busy && <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />}
      </button>
    </div>
    <p id="free-check-status" role="status" className={`mt-3 min-h-[1.25rem] text-[13px] ${error ? "text-[#F59E0B]" : "text-[#62666D]"}`}>
      {error || (exhausted ? freeCheckMessage(paused ? "paused" : "limited")
        : `Free, no signup. Pentra reads only your public pages.${remaining !== null && remaining <= 3 ? ` ${remaining} free check${remaining === 1 ? "" : "s"} left today on this network.` : ""}`)}
    </p>
  </form>;
}
