/* Hero media: a faithful, code-native replica of the Pentra dashboard.
 * Example workspace with illustrative data, labelled as such in the window chrome. */

const STAGES = [
  { title: "How long does teeth whitening last?", stage: "Researching", tone: "blue", progress: 38 },
  { title: "Invisalign vs braces for adults", stage: "Fact check", tone: "blue", progress: 72 },
  { title: "What to do about a chipped tooth", stage: "Ready · goes live Fri 9:00 AM", tone: "green", progress: 100 },
] as const;

const PUBLISHED = [
  { title: "Emergency dentist: what counts, and what to do first", when: "Tue 9:00 AM" },
  { title: "Dental implants cost: what's included in the price", when: "Mon 9:00 AM" },
  { title: "How often should you really get a dental cleaning?", when: "Sat 9:00 AM" },
];

function Dot({ tone }: { tone: "green" | "blue" | "amber" }) {
  const color = tone === "green" ? "bg-[#4CB782]" : tone === "amber" ? "bg-[#F2994A]" : "bg-[#0EA5E9]";
  return <span aria-hidden className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
}

/** Search Console clicks, illustrative: a quiet line with a soft fill. */
export function ClicksSpark({ className = "" }: { className?: string }) {
  const points = [12, 14, 13, 17, 16, 19, 22, 21, 25, 24, 28, 31, 30, 34, 37, 36, 41, 44, 43, 48];
  const w = 280, h = 84, max = 50;
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - (p / max) * h] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="pentra-clicks-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill="url(#pentra-clicks-fill)" />
      <path d={line} fill="none" stroke="#0EA5E9" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ProductFrame() {
  return (
    <div className="relative">
      {/* Light falling on the product, as on a lit desk. Decorative only. */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 -top-16 h-40 w-[70%] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.13] blur-[90px]" />
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.1] bg-[#0B0C0E] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.05)]">
        {/* Window chrome */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] bg-[#0E0F11] px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="h-2.5 w-2.5 rounded-full bg-white/[0.12]" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/[0.12]" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/[0.12]" />
          </div>
          <span className="truncate text-[11px] text-[#62666D]">pentra.dev/dashboard · Example workspace, illustrative data</span>
        </div>

        <div className="grid md:grid-cols-[188px_1fr]">
          {/* Sidebar */}
          <aside className="hidden border-r border-white/[0.06] bg-[#0C0D0F] p-3 md:block" aria-hidden>
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[#0EA5E9]/15 text-[10px] font-bold text-[#0EA5E9]">P</span>
              <span className="text-[12px] font-semibold text-[#F7F8F8]">Pentra</span>
            </div>
            <div className="mt-4 space-y-0.5 text-[12px]">
              {["Dashboard", "Topics", "Articles", "Analytics", "Websites", "Settings"].map((item, n) => (
                <div key={item} className={`rounded-md px-2 py-1.5 ${n === 0 ? "bg-white/[0.06] text-[#F7F8F8]" : "text-[#8A8F98]"}`}>{item}</div>
              ))}
            </div>
            <div className="mt-10 rounded-lg border border-white/[0.06] p-2">
              <p className="truncate text-[11px] font-medium text-[#F7F8F8]">Northside Dental</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[#4CB782]"><Dot tone="green" />Autopilot on</p>
            </div>
          </aside>

          {/* Main */}
          <div className="min-w-0 space-y-3 p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-[14px] font-semibold text-[#F7F8F8]">Pentra for northside-dental.com</p>
                <p className="text-[11px] text-[#62666D]">7 articles a week · up to 25 a month on your plan</p>
              </div>
              <span className="flex items-center gap-1.5 rounded-full border border-[#4CB782]/25 bg-[#4CB782]/10 px-2.5 py-1 text-[11px] font-medium text-[#4CB782]"><Dot tone="green" />Autopilot on</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {[["Articles live", "38"], ["This month", "9"], ["Site health", "97/100"]].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/[0.06] bg-[#0E0F11] px-3 py-2.5">
                  <p className="text-[9.5px] font-medium uppercase tracking-[0.08em] text-[#62666D]">{label}</p>
                  <p className="mt-1 text-[18px] font-semibold tracking-tight text-[#F7F8F8] md:text-[20px]">{value}</p>
                </div>
              ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
              <div className="rounded-lg border border-white/[0.06] bg-[#0E0F11] p-3">
                <p className="text-[11px] font-semibold text-[#F7F8F8]">Upcoming work</p>
                <ul className="mt-2 space-y-2.5">
                  {STAGES.map(item => (
                    <li key={item.title} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-3 text-[11px]">
                        <span className="truncate text-[#D0D6E0]">{item.title}</span>
                        <span className={`flex shrink-0 items-center gap-1.5 ${item.tone === "green" ? "text-[#4CB782]" : "text-[#8A8F98]"}`}><Dot tone={item.tone} />{item.stage}</span>
                      </div>
                      <div className="h-[3px] overflow-hidden rounded-full bg-white/[0.06]">
                        <div className={`h-full rounded-full ${item.tone === "green" ? "bg-[#4CB782]" : "bg-[#0EA5E9]"}`} style={{ width: `${item.progress}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-[#0E0F11] p-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-[11px] font-semibold text-[#F7F8F8]">Search clicks</p>
                  <p className="text-[10px] text-[#62666D]">last 28 days</p>
                </div>
                <p className="mt-1 text-[20px] font-semibold tracking-tight text-[#F7F8F8]">412 <span className="text-[11px] font-medium text-[#4CB782]">+96</span></p>
                <ClicksSpark className="mt-1 h-16 w-full" />
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-[#0E0F11] p-3">
              <p className="text-[11px] font-semibold text-[#F7F8F8]">Published and confirmed live</p>
              <ul className="mt-1.5 divide-y divide-white/[0.05]">
                {PUBLISHED.map(item => (
                  <li key={item.title} className="flex items-center justify-between gap-3 py-1.5 text-[11px]">
                    <span className="truncate text-[#D0D6E0]">{item.title}</span>
                    <span className="flex shrink-0 items-center gap-2 text-[#62666D]">{item.when}
                      <span className="rounded-full bg-[#4CB782]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#4CB782]">live</span></span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
      {/* Fade the frame's bottom edge into the page. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 rounded-b-2xl bg-gradient-to-b from-transparent to-[#08090A]" />
    </div>
  );
}
