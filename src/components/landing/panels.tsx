/* Product artifacts for the landing page's feature sections. Each is a compact,
 * code-native crop of what Pentra shows or produces, with example content. */

const PANEL = "overflow-hidden rounded-xl border border-white/[0.08] bg-[#0B0C0E] shadow-[0_4px_12px_rgba(0,0,0,0.25),0_1px_3px_rgba(0,0,0,0.15),inset_0_1px_0_rgba(255,255,255,0.04)]";
const HEAD = "flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5 text-[11px] text-[#62666D]";

export function SourcesPanel() {
  return (
    <div className="space-y-3">
      <div className={`${PANEL} opacity-80`}>
        <div className={HEAD}><span>Typical AI writer</span><span className="text-[#EB5757]">no source</span></div>
        <p className="px-4 py-4 text-[14px] leading-relaxed text-[#8A8F98]">
          &ldquo;Studies show that 73% of patients choose a dentist after reading one blog post, so publishing more
          content is the fastest way to grow.&rdquo;
        </p>
        <p className="border-t border-white/[0.06] px-4 py-2.5 text-[12px] text-[#EB5757]">Invented statistic. Nobody can check it.</p>
      </div>
      <div className={PANEL}>
        <div className={HEAD}><span>Pentra</span><span className="flex items-center gap-1.5 text-[#4CB782]"><span className="h-1.5 w-1.5 rounded-full bg-[#4CB782]" />fact check passed</span></div>
        <p className="px-4 py-4 text-[14px] leading-relaxed text-[#D0D6E0]">
          Professional whitening results usually last from several months to a few years, depending on diet and
          aftercare<sup className="ml-0.5 text-[10px] text-[#0EA5E9]">[1]</sup>. Coffee, tea and red wine are the most
          common causes of new staining<sup className="ml-0.5 text-[10px] text-[#0EA5E9]">[2]</sup>.
        </p>
        <div className="space-y-1 border-t border-white/[0.06] px-4 py-3 text-[12px] text-[#8A8F98]">
          <p><span className="text-[#0EA5E9]">[1]</span> Dental association guidance on tooth whitening</p>
          <p><span className="text-[#0EA5E9]">[2]</span> Peer-reviewed review of extrinsic tooth staining</p>
        </div>
      </div>
    </div>
  );
}

const RANKS = [
  { page: "/invisalign-cost", query: "invisalign cost", pos: 8, status: "Improving now", tone: "blue" },
  { page: "/emergency-dentist", query: "emergency dentist near me", pos: 11, status: "Next", tone: "dim" },
  { page: "/teeth-whitening", query: "teeth whitening price", pos: 14, status: "Next", tone: "dim" },
  { page: "/dental-implants", query: "dental implants cost", pos: 5, status: "Improved · Tue", tone: "green" },
] as const;

export function RankingsPanel() {
  return (
    <div className={PANEL}>
      <div className={HEAD}><span>Pages close to page one</span><span>positions 4–20 · from Search Console</span></div>
      <table className="w-full text-left text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.08em] text-[#62666D]">
            <th className="px-4 py-2 font-medium">Page</th>
            <th className="hidden px-2 py-2 font-medium sm:table-cell">Search</th>
            <th className="px-2 py-2 text-right font-medium">Position</th>
            <th className="px-4 py-2 text-right font-medium">Pentra</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {RANKS.map(row => (
            <tr key={row.page}>
              <td className="px-4 py-2.5 font-mono text-[12px] text-[#D0D6E0]">{row.page}</td>
              <td className="hidden px-2 py-2.5 text-[#8A8F98] sm:table-cell">{row.query}</td>
              <td className="px-2 py-2.5 text-right font-mono text-[#F7F8F8]">{row.pos}</td>
              <td className="px-4 py-2.5 text-right">
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${row.tone === "blue" ? "bg-[#0EA5E9]/10 text-[#0EA5E9]"
                  : row.tone === "green" ? "bg-[#4CB782]/10 text-[#4CB782]" : "bg-white/[0.05] text-[#8A8F98]"}`}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHECKS = [
  { pass: "Access", finding: "Google can reach every page · sitemap found", ok: true },
  { pass: "Speed", finding: "Homepage performance 91/100 on mobile", ok: true },
  { pass: "AI answers", finding: "/pricing has no structured data", ok: false },
  { pass: "Next step", finding: "Every article links to Book a visit", ok: true },
];

export function HealthPanel() {
  return (
    <div className={PANEL}>
      <div className={HEAD}><span>Weekly site health</span><span>checked Mon 7:00 AM</span></div>
      <div className="grid gap-5 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
        <div className="relative mx-auto h-28 w-28" aria-label="Health score 97 out of 100">
          <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.4" />
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="#4CB782" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${0.97 * 97.4} 97.4`} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[28px] font-semibold tracking-tight text-[#F7F8F8]">97</span>
            <span className="text-[10px] text-[#62666D]">of 100</span>
          </div>
        </div>
        <ul className="space-y-2.5">
          {CHECKS.map(check => (
            <li key={check.pass} className="flex items-start gap-3 text-[13px]">
              <span className={`mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${check.ok ? "bg-[#4CB782]/15 text-[#4CB782]" : "bg-[#F2994A]/15 text-[#F2994A]"}`}>{check.ok ? "✓" : "!"}</span>
              <span><span className="font-medium text-[#F7F8F8]">{check.pass}</span> <span className="text-[#8A8F98]">· {check.finding}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AnswerPanel() {
  return (
    <div className="space-y-3">
      <div className={PANEL}>
        <div className={HEAD}><span>Question your customers ask</span><span>answered in the first line</span></div>
        <div className="space-y-2 px-4 py-4">
          <p className="text-[14px] font-medium text-[#F7F8F8]">How long does teeth whitening last?</p>
          <p className="text-[13.5px] leading-relaxed text-[#8A8F98]">
            <span className="text-[#D0D6E0]">Usually from several months to a few years.</span> How long depends on what you
            eat and drink and how you look after your teeth afterwards…
          </p>
        </div>
      </div>
      <div className={PANEL}>
        <div className={HEAD}><span className="font-mono">structured data · FAQPage</span><span>added to every article</span></div>
        <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-[1.7] text-[#8A8F98]"><code>{`{`}
{"\n  "}<span className="text-[#9CDCFE]">&quot;@type&quot;</span>: <span className="text-[#CE9178]">&quot;FAQPage&quot;</span>,
{"\n  "}<span className="text-[#9CDCFE]">&quot;mainEntity&quot;</span>: [{`{`}
{"\n    "}<span className="text-[#9CDCFE]">&quot;name&quot;</span>: <span className="text-[#CE9178]">&quot;How long does teeth whitening last?&quot;</span>,
{"\n    "}<span className="text-[#9CDCFE]">&quot;acceptedAnswer&quot;</span>: {`{ … }`}
{"\n  "}{`}]`}
{"\n"}{`}`}</code></pre>
      </div>
    </div>
  );
}

const PACES = [1, 2, 4, 7, 14, 21];

export function ControlPanel() {
  return (
    <div className={PANEL}>
      <div className={HEAD}><span>Service settings</span><span>change any time</span></div>
      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-[#0EA5E9]/40 bg-[#0EA5E9]/[0.06] p-3">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-[#F7F8F8]"><span className="h-1.5 w-1.5 rounded-full bg-[#4CB782]" />Autopilot</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[#8A8F98]">Publishes on your schedule. Drafts that fail the fact check are held back.</p>
          </div>
          <div className="rounded-lg border border-white/[0.08] p-3">
            <p className="text-[13px] font-semibold text-[#D0D6E0]">Review first</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[#8A8F98]">Every article waits for your approval before it goes live.</p>
          </div>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#62666D]">Pace · articles a week</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PACES.map(n => (
              <span key={n} className={`rounded-md px-3 py-1.5 font-mono text-[12px] ${n === 7 ? "bg-[#F7F8F8] text-[#08090A]" : "border border-white/[0.08] text-[#8A8F98]"}`}>{n}</span>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-[#62666D]">Your plan&apos;s monthly allowance always caps the total.</p>
        </div>
      </div>
    </div>
  );
}
