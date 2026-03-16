import Link from "next/link";
import {
  Radar,
  ArrowRight,
  CheckCircle2,
  Globe,
  Search,
  FileText,
  ShieldCheck,
  GitBranch,
  Link2,
  Zap,
  Eye,
  Lock,
  ChevronDown,
  BarChart3,
  Clock,
  Users,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  MousePointerClick,
  Mail,
  Share2,
  Target,
} from "lucide-react";
import { LandingNav } from "@/components/layout/landing-nav";
import { PricingSection } from "@/components/landing/pricing-section";

/* ─── Hero ─────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative pt-28 pb-16 md:pt-40 md:pb-24">
      {/* Subtle gradient */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.04] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
          {/* Left: Copy */}
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#0EA5E9]/[0.15] bg-[#0EA5E9]/[0.05] px-3 py-1">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0EA5E9] opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#0EA5E9]" />
              </span>
              <span className="text-[12px] font-medium text-[#0EA5E9]">
                Autonomous SEO engine
              </span>
            </div>

            <h1 className="text-[clamp(2rem,4.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.03em]">
              Your entire SEO
              <br />
              department.{" "}
              <span className="text-[#565A6E]">Automated.</span>
            </h1>

            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-[#8B8FA3]">
              Pentra creates, publishes, monitors, and maintains your SEO content.
              It tracks your rankings, detects declining articles, refreshes them
              automatically, and builds backlinks — all on autopilot.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href="/sign-up"
                className="group inline-flex items-center justify-center gap-2 rounded-lg bg-[#0EA5E9] px-6 py-3 text-[14px] font-medium text-white transition-all hover:bg-[#38BDF8] hover:shadow-[0_0_24px_rgba(14,165,233,0.2)]"
              >
                Start for free
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <span className="text-[13px] text-[#565A6E]">
                3 articles/month free · No credit card
              </span>
            </div>
          </div>

          {/* Right: Live terminal */}
          <div className="relative">
            <div className="rounded-xl border border-white/[0.06] bg-[#0A0B10] overflow-hidden shadow-2xl shadow-black/40">
              {/* Terminal chrome */}
              <div className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2.5">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-[#EF4444]/40" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[#F59E0B]/40" />
                  <div className="h-2.5 w-2.5 rounded-full bg-[#22C55E]/40" />
                </div>
                <span className="ml-2 text-[11px] text-[#565A6E] font-mono">
                  pentra — seo engine
                </span>
              </div>

              {/* Terminal content */}
              <div className="p-5 font-mono text-[12.5px] leading-[1.8] space-y-0.5">
                <TerminalLine delay={0} icon="✓" color="#22C55E">
                  Crawled 47 pages · niche detected: AI SaaS
                </TerminalLine>
                <TerminalLine delay={1} icon="✓" color="#22C55E">
                  Generated 12 keyword clusters
                </TerminalLine>
                <TerminalLine delay={2} icon="●" color="#0EA5E9">
                  Writing: &quot;How to Increase B2B Conversion Rates&quot;
                </TerminalLine>
                <div className="pl-5 space-y-0.5">
                  <TerminalLine delay={3} icon="├─" color="#565A6E" sub>
                    Web research · 8 sources found
                  </TerminalLine>
                  <TerminalLine delay={4} icon="├─" color="#565A6E" sub>
                    2,847 words · fact-check 94%
                  </TerminalLine>
                  <TerminalLine delay={5} icon="└─" color="#565A6E" sub>
                    Published → GitHub
                  </TerminalLine>
                </div>
                <div className="pt-2" />
                <TerminalLine delay={6} icon="✓" color="#22C55E">
                  GSC sync: 142 keywords tracked
                </TerminalLine>
                <TerminalLine delay={7} icon="⚠" color="#F59E0B">
                  Decay detected: &quot;SEO Strategy Guide&quot; dropped 5 positions
                </TerminalLine>
                <TerminalLine delay={8} icon="●" color="#0EA5E9">
                  Auto-refreshing with latest research...
                </TerminalLine>
                <TerminalLine delay={9} icon="✓" color="#22C55E">
                  Refreshed → republished with updated data
                </TerminalLine>

                {/* Blinking cursor */}
                <div
                  className="mt-2 animate-fade-in-up"
                  style={{ animationDelay: "5.5s" }}
                >
                  <span className="text-[#565A6E]">$</span>
                  <span className="ml-1 inline-block w-2 h-4 bg-[#0EA5E9] animate-pulse" />
                </div>
              </div>
            </div>

            {/* Subtle glow */}
            <div className="pointer-events-none absolute -bottom-8 left-1/2 h-32 w-[70%] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.04] blur-[60px]" />
          </div>
        </div>
      </div>
    </section>
  );
}

function TerminalLine({
  delay,
  icon,
  color,
  children,
  sub,
}: {
  delay: number;
  icon: string;
  color: string;
  children: React.ReactNode;
  sub?: boolean;
}) {
  return (
    <div
      className="animate-fade-in-up opacity-0"
      style={{ animationDelay: `${0.3 + delay * 0.5}s`, animationFillMode: "forwards" }}
    >
      <span style={{ color }} className={sub ? "text-[11px]" : ""}>
        {icon}
      </span>{" "}
      <span className={sub ? "text-[#565A6E] text-[11px]" : "text-[#8B8FA3]"}>
        {children}
      </span>
    </div>
  );
}

/* ─── Stats ────────────────────────────────────── */

function Stats() {
  const stats = [
    { value: "8-step", label: "Automated pipeline", icon: Zap },
    { value: "94%", label: "Fact-check confidence", icon: ShieldCheck },
    { value: "24/7", label: "Rank monitoring", icon: BarChart3 },
    { value: "Auto", label: "Content refresh", icon: RefreshCw },
  ];

  return (
    <section className="relative py-16 border-y border-white/[0.04]">
      <div className="mx-auto max-w-6xl px-6">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.06]">
                <stat.icon className="h-4.5 w-4.5 text-[#0EA5E9]" />
              </div>
              <p className="text-2xl font-bold tracking-tight">{stat.value}</p>
              <p className="mt-1 text-[13px] text-[#8B8FA3]">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── The Loop (replaces Pipeline) ────────────── */

function TheLoop() {
  return (
    <section id="pipeline" className="relative py-24 md:py-32 scroll-mt-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-xl">
          <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
            Not just articles.
            <br />
            <span className="text-[#565A6E]">A complete SEO loop.</span>
          </h2>
          <p className="mt-3 text-[15px] text-[#8B8FA3]">
            Most AI tools write and forget. Pentra creates content, monitors its
            performance, and automatically maintains it — a continuous loop that
            compounds traffic over time.
          </p>
        </div>

        {/* The Loop visualization */}
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <LoopPhase
            phase="01"
            title="Create"
            icon={FileText}
            color="#0EA5E9"
            items={[
              "AI crawls your site to learn niche & tone",
              "Generates keyword clusters by intent",
              "Writes research-backed articles with citations",
              "Fact-checks every claim separately",
              "Generates hero images & infographics",
            ]}
          />
          <LoopPhase
            phase="02"
            title="Publish"
            icon={GitBranch}
            color="#22C55E"
            items={[
              "Auto-publishes to GitHub, WordPress, or Webhook",
              "Injects JSON-LD schema markup (Article, FAQ, HowTo)",
              "Weaves in internal links across your content",
              "Syndicates to Medium & LinkedIn",
              "Optimized for AI Overviews & featured snippets",
            ]}
          />
          <LoopPhase
            phase="03"
            title="Monitor"
            icon={BarChart3}
            color="#F59E0B"
            items={[
              "Connects to Google Search Console",
              "Tracks rankings, clicks, impressions daily",
              "Per-article search performance breakdown",
              "Identifies striking distance keywords (11-20)",
              "Detects content decay automatically",
            ]}
          />
          <LoopPhase
            phase="04"
            title="Maintain"
            icon={RefreshCw}
            color="#EF4444"
            items={[
              "Flags articles losing rankings",
              "One-click AI refresh with latest research",
              "Auto-refresh declining content weekly",
              "Analyzes backlink profile & broken links",
              "Generates personalized outreach emails",
            ]}
          />
        </div>

        {/* Arrow loop indicator */}
        <div className="mt-6 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2">
            <RefreshCw className="h-3.5 w-3.5 text-[#0EA5E9]" />
            <span className="text-[12px] text-[#8B8FA3]">Continuous loop — compounds traffic over time</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function LoopPhase({
  phase,
  title,
  icon: Icon,
  color,
  items,
}: {
  phase: string;
  title: string;
  icon: typeof FileText;
  color: string;
  items: string[];
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0A0B10] overflow-hidden">
      <div className="border-b border-white/[0.04] px-5 py-3.5 flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${color}10` }}
        >
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <div>
          <span className="text-[10px] font-mono text-[#565A6E]">{phase}</span>
          <p className="text-[14px] font-semibold text-[#EDEEF1]">{title}</p>
        </div>
      </div>
      <div className="p-5">
        <ul className="space-y-2.5">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2
                className="h-3.5 w-3.5 mt-0.5 shrink-0"
                style={{ color }}
              />
              <span className="text-[12px] leading-relaxed text-[#8B8FA3]">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ─── Features grid ───────────────────────────── */

function Features() {
  const items = [
    {
      icon: Search,
      title: "Live web research",
      desc: "Every article backed by real-time web searches with verified sources and citations.",
    },
    {
      icon: ShieldCheck,
      title: "AI fact-checking",
      desc: "Separate verification pass with per-claim confidence scores. No hallucinated stats.",
    },
    {
      icon: BarChart3,
      title: "Rank tracking",
      desc: "Google Search Console integration. Track keywords, clicks, impressions, and positions daily.",
    },
    {
      icon: TrendingDown,
      title: "Content decay detection",
      desc: "Automatically flags articles losing rankings. One-click or auto-refresh with fresh research.",
    },
    {
      icon: Link2,
      title: "Backlink intelligence",
      desc: "Analyze your link profile, find unlinked mentions and broken link opportunities.",
    },
    {
      icon: Mail,
      title: "Outreach automation",
      desc: "AI-generated personalized outreach emails for link building at scale.",
    },
    {
      icon: Target,
      title: "AI Overview optimization",
      desc: "Articles structured for Google AI Overviews — question patterns, definitive answers, structured data.",
    },
    {
      icon: Share2,
      title: "Content syndication",
      desc: "Auto-distribute to Medium and LinkedIn with canonical URLs. Maximize reach per article.",
    },
    {
      icon: GitBranch,
      title: "Multi-platform publishing",
      desc: "GitHub, WordPress, webhooks — publish wherever your content lives.",
    },
    {
      icon: Zap,
      title: "Schema markup",
      desc: "JSON-LD (Article, FAQ, HowTo) injected automatically for rich results in search.",
    },
    {
      icon: Clock,
      title: "Autopilot scheduling",
      desc: "Set your cadence and let articles publish on schedule. 8x daily processing.",
    },
    {
      icon: Users,
      title: "Multi-site management",
      desc: "Manage multiple domains from a single dashboard. Isolated settings per site.",
    },
  ];

  return (
    <section id="features" className="relative py-24 md:py-32 border-y border-white/[0.04] scroll-mt-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
            Everything your SEO team does.
            <br />
            <span className="text-[#565A6E]">Without the team.</span>
          </h2>
          <p className="mt-3 text-[15px] text-[#8B8FA3]">
            Content creation, rank tracking, decay detection, backlink building,
            and content syndication — all automated, all included on every plan.
          </p>
        </div>

        <div className="grid gap-px overflow-hidden rounded-xl border border-white/[0.04] sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <div
              key={item.title}
              className="bg-[#0A0B10] p-6 transition hover:bg-[#0D0E15]"
            >
              <item.icon className="mb-3 h-4 w-4 text-[#0EA5E9]" />
              <h3 className="text-[14px] font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#8B8FA3]">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Differentiators ─────────────────────────── */

function Differentiators() {
  return (
    <section className="relative py-16 md:py-24">
      <div className="mx-auto max-w-6xl px-6 space-y-24 md:space-y-32">
        {/* 1: Research, not regurgitation */}
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Search className="h-4 w-4 text-[#0EA5E9]" />
              <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-[#0EA5E9]">
                Web Research
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
              Every claim has a source.
              <br />
              <span className="text-[#565A6E]">Every source is real.</span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#8B8FA3]">
              Most AI writers hallucinate sources and regurgitate training data.
              Pentra runs live web searches for every article, extracts real
              data from real URLs, and cites them. A separate fact-checking
              pass validates every claim before publishing.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              {[
                "Live web search per article, not cached data",
                "Separate fact-checking AI with confidence scores",
                "Source URLs verified and cited inline",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2.5 text-[13px] text-[#EDEEF1]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#22C55E]" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Visual: Comparison */}
          <div className="space-y-3">
            <div className="rounded-xl border border-[#EF4444]/[0.1] bg-[#EF4444]/[0.02] p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="rounded-full bg-[#EF4444]/[0.1] px-2 py-0.5 text-[10px] font-medium text-[#EF4444]">
                  Generic AI
                </div>
              </div>
              <p className="text-[13px] leading-relaxed text-[#8B8FA3] italic">
                &ldquo;Studies show that 73% of marketers believe AI will
                transform content creation...&rdquo;
              </p>
              <p className="mt-2 text-[11px] text-[#EF4444]">
                No source. Stat is fabricated.
              </p>
            </div>

            <div className="rounded-xl border border-[#22C55E]/[0.1] bg-[#22C55E]/[0.02] p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="rounded-full bg-[#22C55E]/[0.1] px-2 py-0.5 text-[10px] font-medium text-[#22C55E]">
                  Pentra
                </div>
              </div>
              <p className="text-[13px] leading-relaxed text-[#EDEEF1]">
                &ldquo;According to HubSpot&apos;s 2025 State of Marketing
                report, 64% of B2B teams now use AI for first-draft
                content.&rdquo;
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="rounded bg-[#22C55E]/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-[#22C55E]">
                  94% confidence
                </span>
                <span className="text-[11px] text-[#565A6E]">
                  Source: hubspot.com/marketing-report
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 2: Monitor & Maintain */}
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          {/* Visual: Analytics preview */}
          <div className="order-2 lg:order-1">
            <div className="rounded-xl border border-white/[0.06] bg-[#0A0B10] overflow-hidden">
              <div className="border-b border-white/[0.04] px-4 py-2.5">
                <span className="text-[12px] font-medium text-[#8B8FA3]">
                  SEO Dashboard · Live
                </span>
              </div>
              <div className="p-5 space-y-4">
                {/* Mini stat row */}
                <div className="grid grid-cols-4 gap-3">
                  <MiniStat label="Clicks" value="1,247" color="#0EA5E9" />
                  <MiniStat label="Impressions" value="28.4K" color="#22D3EE" />
                  <MiniStat label="CTR" value="4.4%" color="#22C55E" />
                  <MiniStat label="Avg Pos" value="8.2" color="#F59E0B" />
                </div>

                {/* Mini keyword table */}
                <div className="rounded-lg border border-white/[0.04] overflow-hidden">
                  <div className="px-3 py-2 bg-white/[0.02] text-[10px] font-medium uppercase tracking-wider text-[#565A6E]">
                    Top Keywords
                  </div>
                  {[
                    { kw: "b2b lead generation", pos: "3", trend: "up" },
                    { kw: "ai content strategy", pos: "7", trend: "up" },
                    { kw: "seo automation tools", pos: "12", trend: "down" },
                  ].map((row) => (
                    <div key={row.kw} className="flex items-center gap-3 px-3 py-2 border-t border-white/[0.03]">
                      <span className="flex-1 text-[11px] text-[#EDEEF1]">{row.kw}</span>
                      <span className={`text-[11px] font-mono ${Number(row.pos) <= 3 ? "text-[#22C55E]" : Number(row.pos) <= 10 ? "text-[#0EA5E9]" : "text-[#F59E0B]"}`}>
                        #{row.pos}
                      </span>
                      {row.trend === "up" ? (
                        <TrendingUp className="h-3 w-3 text-[#22C55E]" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-[#EF4444]" />
                      )}
                    </div>
                  ))}
                </div>

                {/* Decay alert */}
                <div className="flex items-center gap-2.5 rounded-lg bg-[#EF4444]/[0.04] border border-[#EF4444]/[0.1] px-3 py-2.5">
                  <TrendingDown className="h-3.5 w-3.5 text-[#EF4444] shrink-0" />
                  <span className="text-[11px] text-[#F87171] flex-1">&ldquo;SEO Strategy Guide&rdquo; dropped 5 positions</span>
                  <span className="text-[10px] text-[#0EA5E9] font-medium shrink-0">Auto-refresh</span>
                </div>
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-[#F59E0B]" />
              <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-[#F59E0B]">
                Monitoring
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
              Content that gets better
              <br />
              <span className="text-[#565A6E]">
                with time, not worse.
              </span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#8B8FA3]">
              Most content starts decaying within 6 months. Pentra connects to
              Google Search Console, tracks every keyword daily, and automatically
              detects when articles start losing rankings. Declining content gets
              refreshed with the latest research — no manual intervention needed.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              {[
                "Google Search Console integration — daily rank tracking",
                "Automated content decay detection with position history",
                "One-click AI refresh with fresh web research",
                "Striking distance alerts for keywords close to page 1",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2.5 text-[13px] text-[#EDEEF1]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#F59E0B]" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 3: Control */}
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#22C55E]" />
              <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-[#22C55E]">
                Control
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
              Autopilot with guardrails.
              <br />
              <span className="text-[#565A6E]">You always have the final say.</span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#8B8FA3]">
              Run fully autonomous or require approval before anything publishes.
              Set your tone, niche, cadence, brand colors, and CTA. Review and
              approve articles, or let the pipeline handle everything end-to-end.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              {[
                "Optional approval gates — review before publish",
                "Custom tone, niche, brand identity, and cadence",
                "Branded article preview matching your site's design",
                "Full audit trail — every pipeline step logged",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2.5 text-[13px] text-[#EDEEF1]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#22C55E]" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Visual: Settings preview */}
          <div className="rounded-xl border border-white/[0.06] bg-[#0A0B10] overflow-hidden">
            <div className="border-b border-white/[0.04] px-4 py-2.5">
              <span className="text-[12px] font-medium text-[#8B8FA3]">
                Settings
              </span>
            </div>
            <div className="p-5 space-y-4">
              <SettingRow label="Domain" value="yoursite.com" />
              <SettingRow label="Niche" value="Auto-detected by AI" />
              <SettingRow label="Tone" value="Professional, practical" />
              <SettingRow label="Cadence" value="4 articles / week" />
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-[#8B8FA3]">Autopilot</span>
                <div className="relative inline-flex h-5 w-9 rounded-full bg-[#0EA5E9]">
                  <span className="inline-block h-4 w-4 rounded-full bg-white shadow-sm mt-0.5 ml-0.5 translate-x-4" />
                </div>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-[12px] text-[#8B8FA3]">
                  Require approval
                </span>
                <div className="relative inline-flex h-5 w-9 rounded-full bg-[#0EA5E9]">
                  <span className="inline-block h-4 w-4 rounded-full bg-white shadow-sm mt-0.5 ml-0.5 translate-x-4" />
                </div>
              </div>
              <SettingRow label="Publish to" value="GitHub / WordPress / Webhook" />
              <SettingRow label="Syndicate to" value="Medium + LinkedIn" />
              <SettingRow label="GSC Connected" value="✓ Daily rank tracking" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-2.5 text-center">
      <p className="text-[10px] text-[#565A6E] uppercase tracking-wider">{label}</p>
      <p className="text-[15px] font-bold mt-0.5" style={{ color }}>{value}</p>
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12px] text-[#8B8FA3]">{label}</span>
      <span className="text-[12px] font-medium text-[#EDEEF1]">{value}</span>
    </div>
  );
}

/* ─── FAQ ──────────────────────────────────────── */

const faqs = [
  {
    q: "How is Pentra different from other AI writing tools?",
    a: "Most AI tools just write and forget. Pentra is a complete SEO loop: it creates content with live web research, publishes it, monitors rankings via Google Search Console, detects when articles start declining, and automatically refreshes them. It also builds backlinks through automated outreach. It's the difference between an AI writer and an AI SEO department.",
  },
  {
    q: "Is the content actually unique and not just AI slop?",
    a: "Every article starts with live web research — real sources, real data, real citations. A separate fact-checking AI validates every claim with confidence scores. Articles are structured for Google AI Overviews with definitive answers, question-pattern headings, and year-dated statistics.",
  },
  {
    q: "How does the rank tracking and content decay detection work?",
    a: "Pentra connects to your Google Search Console account (read-only access). It syncs daily, tracking clicks, impressions, CTR, and position for every keyword. When an article drops 3+ positions or loses 30%+ of clicks, it gets flagged. You can one-click refresh it, or enable auto-refresh for fully autonomous maintenance.",
  },
  {
    q: "What publishing platforms do you support?",
    a: "GitHub (commits MDX with frontmatter and schema markup), WordPress (via REST API), webhooks (for custom CMS), and manual. Plus optional syndication to Medium (as drafts with canonical URL) and LinkedIn (AI-generated posts with article links).",
  },
  {
    q: "Can I review articles before they go live?",
    a: "Absolutely. Enable approval gates and every article goes to 'review' status for your sign-off. You can preview articles in your brand's design (colors, fonts, logo) before approving or rejecting.",
  },
  {
    q: "What happens if I hit my article limit?",
    a: "Article limits are per calendar month across your entire account. If you need more, upgrade anytime — the new limit takes effect immediately. Unused articles don't roll over.",
  },
  {
    q: "Do all plans get the same features?",
    a: "Yes. Every plan — including Free — gets the full platform: web research, fact-checking, hero images, internal linking, schema markup, rank tracking, content decay detection, backlink analysis, outreach emails, content syndication, and multi-platform publishing. The only difference is articles per month and number of sites.",
  },
  {
    q: "How long does it take to generate an article?",
    a: "A typical 2,500-3,000 word article takes about 3-5 minutes from start to publish. This includes web research, drafting, fact-checking, image generation, internal linking, schema markup, and publishing — all fully automated.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. All plans are month-to-month with no contracts. Cancel anytime from your dashboard.",
  },
];

function FAQ() {
  return (
    <section id="faq" className="relative py-24 md:py-32 border-t border-white/[0.04] scroll-mt-20">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
            Frequently asked questions
          </h2>
          <p className="mt-3 text-[15px] text-[#8B8FA3]">
            Everything you need to know about Pentra.
          </p>
        </div>

        <div className="space-y-0 divide-y divide-white/[0.06]">
          {faqs.map((faq) => (
            <details key={faq.q} className="group">
              <summary className="flex cursor-pointer items-center justify-between py-5 text-[15px] font-medium text-[#EDEEF1] transition hover:text-white [&::-webkit-details-marker]:hidden list-none">
                {faq.q}
                <ChevronDown className="h-4 w-4 shrink-0 text-[#565A6E] transition-transform group-open:rotate-180" />
              </summary>
              <p className="pb-5 text-[14px] leading-relaxed text-[#8B8FA3]">
                {faq.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Final CTA ────────────────────────────────── */

function FinalCTA() {
  return (
    <section className="relative py-24 md:py-32 border-t border-white/[0.04]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0EA5E9]/[0.03] blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-4xl">
          Stop managing SEO manually.
          <br />
          Start compounding traffic.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[15px] text-[#8B8FA3]">
          Connect your domain. Pentra handles the content, the monitoring,
          and the maintenance. Start with 3 free articles every month.
        </p>
        <div className="mt-8">
          <Link
            href="/sign-up"
            className="group inline-flex items-center gap-2 rounded-lg bg-[#0EA5E9] px-6 py-3 text-[14px] font-medium text-white transition-all hover:bg-[#38BDF8] hover:shadow-[0_0_32px_rgba(14,165,233,0.2)]"
          >
            Get started for free
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ───────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-14">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0EA5E9]/[0.1]">
              <Radar className="h-5 w-5 text-[#0EA5E9]" />
            </div>
            <span className="text-[18px] font-bold">
              Pentra
            </span>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div className="flex flex-col gap-3">
              <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#565A6E]">Product</span>
              <a href="#features" className="text-[15px] font-semibold text-[#8B8FA3] hover:text-white transition">
                Features
              </a>
              <a href="#pricing" className="text-[15px] font-semibold text-[#8B8FA3] hover:text-white transition">
                Pricing
              </a>
              <a href="#faq" className="text-[15px] font-semibold text-[#8B8FA3] hover:text-white transition">
                FAQ
              </a>
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#565A6E]">Company</span>
              <Link href="/contact" className="text-[15px] font-semibold text-[#8B8FA3] hover:text-white transition">
                Contact
              </Link>
              <Link href="/legal/privacy" className="text-[15px] font-semibold text-[#8B8FA3] hover:text-white transition">
                Privacy
              </Link>
              <Link href="/legal/terms" className="text-[15px] font-semibold text-[#8B8FA3] hover:text-white transition">
                Terms
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-10 border-t border-white/[0.06] pt-6">
          <p className="text-[14px] font-medium text-[#565A6E]">
            &copy; {new Date().getFullYear()} Pentra. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ─── Page ─────────────────────────────────────── */

/* ─── JSON-LD Schema Markup ────────────────────── */

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Pentra",
  url: "https://pentra.dev",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "AI-powered SEO content engine that automates research, writing, fact-checking, optimization, and publishing with built-in rank tracking and content maintenance.",
  offers: {
    "@type": "AggregateOffer",
    lowPrice: "0",
    highPrice: "499",
    priceCurrency: "USD",
    offerCount: "5",
  },
  featureList: [
    "AI article generation with web research",
    "Automated fact-checking with citations",
    "Google Search Console rank tracking",
    "Content decay detection and auto-refresh",
    "Multi-platform publishing (GitHub, WordPress, Webhook)",
    "Backlink analysis and outreach automation",
    "JSON-LD schema markup generation",
    "Internal linking optimization",
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: {
      "@type": "Answer",
      text: f.a,
    },
  })),
};

const breadcrumbSchema = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://pentra.dev",
    },
  ],
};

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(organizationSchema),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqSchema),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbSchema),
        }}
      />
      <LandingNav />
      <Hero />
      <Stats />
      <TheLoop />
      <Features />
      <Differentiators />
      <PricingSection />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  );
}
