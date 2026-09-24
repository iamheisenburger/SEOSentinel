"use client";

import { useEffect, useRef, useState } from "react";

type Line = { mark: string; tone: "ok" | "run" | "dim" | "warn"; text: string; indent?: boolean };

/** One Autopilot run, as Pentra's own log shows it. Example site; lines appear
 * in order when the panel scrolls into view (instantly with reduced motion). */
const LINES: Line[] = [
  { mark: "✓", tone: "ok", text: "Read northside-dental.com · 14 pages, services and booking page" },
  { mark: "✓", tone: "ok", text: "Found 32 searches your patients make that you don't answer yet" },
  { mark: "●", tone: "run", text: "Writing “How long does teeth whitening last?”" },
  { mark: "├─", tone: "dim", text: "Researched on the live web · 7 sources cited", indent: true },
  { mark: "├─", tone: "dim", text: "Fact check passed · every claim matched to a source", indent: true },
  { mark: "├─", tone: "dim", text: "FAQ and structured data added · links to Book a visit", indent: true },
  { mark: "└─", tone: "dim", text: "Published to WordPress at 9:00 AM", indent: true },
  { mark: "✓", tone: "ok", text: "Live page confirmed · title, text and schema match" },
  { mark: "!", tone: "warn", text: "“Invisalign cost” sits at position 8 · improving it next" },
  { mark: "✓", tone: "ok", text: "Search Console synced · next article Fri 9:00 AM" },
];

const TONE = { ok: "text-[#4CB782]", run: "text-[#0EA5E9]", dim: "text-[#62666D]", warn: "text-[#F2994A]" };

export function RunLog() {
  const ref = useRef<HTMLDivElement>(null);
  // Server HTML shows every line (readable without JavaScript). Once hydrated,
  // a log still below the fold is hidden and replays line by line on arrival.
  const [phase, setPhase] = useState<"static" | "armed" | "shown">("static");
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (node.getBoundingClientRect().top < window.innerHeight) return;
    setPhase("armed");
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setPhase("shown"); observer.disconnect(); } }, { threshold: 0.35 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const shown = phase === "shown";
  return (
    <div ref={ref} className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0B0C0E] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <span className="font-mono text-[11px] text-[#62666D]">autopilot · northside-dental.com</span>
        <span className="flex items-center gap-1.5 text-[11px] text-[#4CB782]"><span className="h-1.5 w-1.5 rounded-full bg-[#4CB782]" />running</span>
      </div>
      <ol className="space-y-1 p-4 font-mono text-[12px] leading-[1.75] md:p-5 md:text-[12.5px]">
        {LINES.map((line, n) => (
          <li key={n} className={`flex gap-2.5 ${line.indent ? "pl-5" : ""} ${shown ? "animate-fade-in-up" : phase === "armed" ? "opacity-0" : ""}`}
            style={shown ? { animationDelay: `${n * 0.28}s` } : undefined}>
            <span className={`w-4 shrink-0 text-center ${TONE[line.tone]}`}>{line.mark}</span>
            <span className={line.tone === "dim" ? "text-[#8A8F98]" : "text-[#D0D6E0]"}>{line.text}</span>
          </li>
        ))}
        <li className={`flex gap-2.5 pt-1 ${shown ? "animate-fade-in-up" : phase === "armed" ? "opacity-0" : ""}`} style={shown ? { animationDelay: `${LINES.length * 0.28}s` } : undefined}>
          <span className="w-4 text-center text-[#62666D]">$</span><span className="inline-block h-4 w-2 animate-pulse bg-[#0EA5E9]" />
        </li>
      </ol>
    </div>
  );
}
