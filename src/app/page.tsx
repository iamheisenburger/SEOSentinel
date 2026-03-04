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
} from "lucide-react";
import { LandingNav } from "@/components/layout/landing-nav";

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
                Autonomous SEO pipeline
              </span>
            </div>

            <h1 className="text-[clamp(2rem,4.5vw,3.5rem)] font-bold leading-[1.08] tracking-[-0.03em]">
              Your site writes its
              <br />
              own blog.{" "}
              <span className="text-[#565A6E]">Seriously.</span>
            </h1>

            <p className="mt-5 max-w-md text-[16px] leading-relaxed text-[#8B8FA3]">
              Point Pentra at your domain. It crawls your niche, plans
              keyword strategy, writes fact-checked articles from real web
              research, and publishes them to your repo. On autopilot.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href="/sign-up"
                className="group inline-flex items-center justify-center gap-2 rounded-lg bg-[#0EA5E9] px-6 py-3 text-[14px] font-medium text-white transition-all hover:bg-[#38BDF8] hover:shadow-[0_0_24px_rgba(14,165,233,0.2)]"
              >
                Start generating
                <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <span className="text-[13px] text-[#565A6E]">
                Free plan available · No credit card required
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
                  pentra — pipeline
                </span>
              </div>

              {/* Terminal content */}
              <div className="p-5 font-mono text-[12.5px] leading-[1.8] space-y-0.5">
                <TerminalLine delay={0} icon="✓" color="#22C55E">
                  Crawled 47 pages on leadpilot.chat
                </TerminalLine>
                <TerminalLine delay={1} icon="✓" color="#22C55E">
                  Detected niche: AI SaaS, lead capture tools
                </TerminalLine>
                <TerminalLine delay={2} icon="✓" color="#22C55E">
                  Generated 12 topic clusters
                </TerminalLine>
                <div className="pt-2" />
                <TerminalLine delay={3} icon="●" color="#0EA5E9">
                  Writing: &quot;How to Increase B2B Conversion Rates&quot;
                </TerminalLine>
                <div className="pl-5 space-y-0.5">
                  <TerminalLine delay={4} icon="├─" color="#565A6E" sub>
                    Web research... 8 sources found
                  </TerminalLine>
                  <TerminalLine delay={5} icon="├─" color="#565A6E" sub>
                    Drafting... 2,847 words
                  </TerminalLine>
                  <TerminalLine delay={6} icon="├─" color="#565A6E" sub>
                    Fact-check... 94% confidence
                  </TerminalLine>
                  <TerminalLine delay={7} icon="├─" color="#565A6E" sub>
                    Internal links... 5 added
                  </TerminalLine>
                  <TerminalLine delay={8} icon="└─" color="#565A6E" sub>
                    Publishing to GitHub...
                  </TerminalLine>
                </div>
                <div className="pt-1" />
                <TerminalLine delay={9} icon="✓" color="#22C55E">
                  Published → /blog/b2b-conversion-rates
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

/* ─── Social proof / stats ────────────────────── */

function Stats() {
  const stats = [
    { value: "2,847", label: "Avg words per article", icon: FileText },
    { value: "94%", label: "Fact-check confidence", icon: ShieldCheck },
    { value: "< 5 min", label: "Article generation time", icon: Clock },
    { value: "5 steps", label: "Fully automated pipeline", icon: Zap },
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

/* ─── Pipeline visual ──────────────────────────── */

const pipelineSteps = [
  {
    icon: Globe,
    label: "Crawl",
    desc: "Scans your entire site. Maps pages, extracts keywords, learns your niche and tone.",
    detail: "47 pages indexed",
    color: "#0EA5E9",
  },
  {
    icon: Search,
    label: "Research",
    desc: "Generates keyword clusters ranked by search intent, competition, and content gaps.",
    detail: "12 topics planned",
    color: "#F59E0B",
  },
  {
    icon: FileText,
    label: "Write",
    desc: "Each article starts with live web research. Real citations. No hallucinated claims.",
    detail: "2,847 words avg",
    color: "#22C55E",
  },
  {
    icon: ShieldCheck,
    label: "Verify",
    desc: "A separate AI pass fact-checks every claim against source material with confidence scores.",
    detail: "94% avg confidence",
    color: "#22D3EE",
  },
  {
    icon: GitBranch,
    label: "Publish",
    desc: "Commits to your GitHub repo as MDX with frontmatter, schema markup, and internal links.",
    detail: "Auto-deploys",
    color: "#A78BFA",
  },
];

function Pipeline() {
  return (
    <section id="pipeline" className="relative py-24 md:py-32 scroll-mt-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-xl">
          <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
            One pipeline. Five steps.
            <br />
            <span className="text-[#565A6E]">Zero manual work.</span>
          </h2>
          <p className="mt-3 text-[15px] text-[#8B8FA3]">
            From the moment you connect your domain to the moment an article
            goes live — fully autonomous.
          </p>
        </div>

        {/* Pipeline flow */}
        <div className="mt-14 relative">
          {/* Connection line */}
          <div className="hidden lg:block absolute top-[28px] left-[28px] right-[28px] h-px bg-gradient-to-r from-[#0EA5E9]/20 via-white/[0.06] to-[#A78BFA]/20" />

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {pipelineSteps.map((step, i) => (
              <div key={step.label} className="relative">
                <div
                  className="relative z-10 mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06]"
                  style={{ backgroundColor: `${step.color}08` }}
                >
                  <step.icon
                    className="h-5 w-5"
                    style={{ color: step.color }}
                  />
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-mono text-[#565A6E]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-[14px] font-semibold">{step.label}</h3>
                </div>
                <p className="text-[13px] leading-relaxed text-[#8B8FA3]">
                  {step.desc}
                </p>
                <p
                  className="mt-2 text-[11px] font-medium"
                  style={{ color: step.color }}
                >
                  {step.detail}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Features grid ───────────────────────────── */

function Features() {
  const items = [
    {
      icon: Search,
      title: "Live web research",
      desc: "Every article backed by real-time search data, not training data.",
    },
    {
      icon: ShieldCheck,
      title: "AI fact-checking",
      desc: "Separate verification pass with per-claim confidence scores.",
    },
    {
      icon: Link2,
      title: "Internal linking",
      desc: "Scans your existing content and weaves in relevant internal links.",
    },
    {
      icon: Zap,
      title: "Schema markup",
      desc: "JSON-LD (Article, FAQ, HowTo) injected automatically for rich results.",
    },
    {
      icon: GitBranch,
      title: "Multi-platform publishing",
      desc: "GitHub, WordPress, webhooks — publish wherever your content lives.",
    },
    {
      icon: Eye,
      title: "Full audit trail",
      desc: "Every pipeline run logged with timing, retries, and error details.",
    },
    {
      icon: BarChart3,
      title: "Keyword strategy",
      desc: "AI-generated topic clusters with search intent and gap analysis.",
    },
    {
      icon: Clock,
      title: "Autopilot scheduling",
      desc: "Set your cadence and let articles publish on schedule automatically.",
    },
    {
      icon: Users,
      title: "Multi-site management",
      desc: "Manage multiple domains from a single dashboard with isolated settings.",
    },
  ];

  return (
    <section id="features" className="relative py-24 md:py-32 border-y border-white/[0.04] scroll-mt-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
            Everything your content team does.
            <br />
            <span className="text-[#565A6E]">Without the team.</span>
          </h2>
          <p className="mt-3 text-[15px] text-[#8B8FA3]">
            Every feature included on every plan. Research, write, verify, and publish — all automated.
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

/* ─── Differentiators (story sections) ─────────── */

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
                ⚠ No source. Stat is fabricated.
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

        {/* 2: Pipeline visibility */}
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          {/* Visual: Mini pipeline UI */}
          <div className="order-2 lg:order-1">
            <div className="rounded-xl border border-white/[0.06] bg-[#0A0B10] overflow-hidden">
              <div className="border-b border-white/[0.04] px-4 py-2.5">
                <span className="text-[12px] font-medium text-[#8B8FA3]">
                  Pipeline · Live
                </span>
              </div>
              <div className="p-4 space-y-0">
                {[
                  { label: "Site crawl", status: "done", time: "2m 14s" },
                  { label: "Topic generation", status: "done", time: "1m 08s" },
                  {
                    label: "Article: B2B Conversion Rates",
                    status: "running",
                    time: "running",
                  },
                  { label: "Fact-check", status: "pending", time: "—" },
                  { label: "Internal linking", status: "pending", time: "—" },
                  { label: "GitHub publish", status: "pending", time: "—" },
                ].map((row, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-2 py-2.5 border-b border-white/[0.03] last:border-0"
                  >
                    <div
                      className={`h-2 w-2 rounded-full shrink-0 ${
                        row.status === "done"
                          ? "bg-[#22C55E]"
                          : row.status === "running"
                            ? "bg-[#0EA5E9] animate-pulse"
                            : "bg-white/[0.08]"
                      }`}
                    />
                    <span
                      className={`flex-1 text-[12px] ${
                        row.status === "pending"
                          ? "text-[#565A6E]"
                          : "text-[#EDEEF1]"
                      }`}
                    >
                      {row.label}
                    </span>
                    <span
                      className={`text-[11px] font-mono ${
                        row.status === "running"
                          ? "text-[#0EA5E9]"
                          : row.status === "done"
                            ? "text-[#565A6E]"
                            : "text-[#3A3D4A]"
                      }`}
                    >
                      {row.time}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="order-1 lg:order-2">
            <div className="mb-3 flex items-center gap-2">
              <Eye className="h-4 w-4 text-[#F59E0B]" />
              <span className="text-[12px] font-medium uppercase tracking-[0.1em] text-[#F59E0B]">
                Visibility
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
              Not a black box.
              <br />
              <span className="text-[#565A6E]">
                Every step, every second.
              </span>
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#8B8FA3]">
              Watch the pipeline in real-time. Every job is logged — status,
              duration, retries. When something fails, you see exactly what went
              wrong, not a vague error.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              {[
                "Real-time pipeline status with reactive updates",
                "Every job logged with duration and retry count",
                "Error messages with full context, not generic failures",
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

        {/* 3: Your control */}
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
              Set your tone, niche, cadence. Review and approve articles, or let
              the pipeline handle everything end-to-end.
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              {[
                "Optional approval gates — review before publish",
                "Custom tone, niche, and publishing cadence",
                "Publishes directly to your GitHub repository",
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
              <SettingRow label="Domain" value="leadpilot.chat" />
              <SettingRow label="Niche" value="AI SaaS, lead capture" />
              <SettingRow
                label="Tone"
                value="Professional, practical"
              />
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
              <SettingRow
                label="Repository"
                value="github.com/user/blog"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
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

/* ─── Pricing ──────────────────────────────────── */

const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "/mo",
    desc: "Try it out with 3 articles a month on 1 site.",
    features: [
      "1 site",
      "3 articles / month",
      "Full AI pipeline",
      "Fact-checking",
      "Manual publishing",
    ],
    cta: "Get started free",
    href: "/sign-up",
    featured: false,
  },
  {
    name: "Starter",
    price: "$49",
    period: "/mo",
    desc: "For new sites getting started with content.",
    features: [
      "1 site",
      "10 articles / month",
      "All publish methods",
      "Autopilot mode",
      "Internal linking",
    ],
    cta: "Get started",
    href: "/sign-up",
    featured: false,
  },
  {
    name: "Pro",
    price: "$99",
    period: "/mo",
    desc: "For growing sites that need more content.",
    features: [
      "3 sites",
      "25 articles / month",
      "Everything in Starter",
      "Approval workflow",
      "Priority support",
    ],
    cta: "Get started",
    href: "/sign-up",
    featured: true,
  },
  {
    name: "Scale",
    price: "$199",
    period: "/mo",
    desc: "For content teams and agencies.",
    features: [
      "10 sites",
      "60 articles / month",
      "Everything in Pro",
      "API access",
      "Priority queue",
    ],
    cta: "Get started",
    href: "/sign-up",
    featured: false,
  },
  {
    name: "Enterprise",
    price: "$499",
    period: "/mo",
    desc: "Unlimited scale for large operations.",
    features: [
      "Unlimited sites",
      "150 articles / month",
      "Everything in Scale",
      "White-label option",
      "Dedicated support",
    ],
    cta: "Contact us",
    href: "mailto:pentrahelp@gmail.com",
    featured: false,
  },
];

function Pricing() {
  return (
    <section id="pricing" className="relative py-24 md:py-32 scroll-mt-20">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.03] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mb-14 text-center">
          <h2 className="text-3xl font-bold tracking-[-0.03em] md:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-3 text-[15px] text-[#8B8FA3]">
            All features included on every plan. Just pick your volume.
          </p>
        </div>

        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-5">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-xl overflow-hidden ${
                tier.featured
                  ? "border border-[#0EA5E9]/20 bg-[#0EA5E9]/[0.02]"
                  : "border border-white/[0.06] bg-[#0A0B10]"
              }`}
            >
              {tier.featured && (
                <div className="bg-[#0EA5E9] py-1.5 text-center text-[11px] font-semibold text-white tracking-wide">
                  MOST POPULAR
                </div>
              )}
              <div className="p-6">
                <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-[#565A6E]">
                  {tier.name}
                </p>
                <div className="mt-2 flex items-baseline gap-0.5">
                  <span className="text-3xl font-bold tracking-tight">
                    {tier.price}
                  </span>
                  <span className="text-[13px] text-[#565A6E]">
                    {tier.period}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-[#8B8FA3]">
                  {tier.desc}
                </p>

                <Link
                  href={tier.href}
                  className={`mt-5 block rounded-lg py-2.5 text-center text-[13px] font-medium transition ${
                    tier.featured
                      ? "bg-[#0EA5E9] text-white hover:bg-[#38BDF8]"
                      : "border border-white/[0.08] text-[#8B8FA3] hover:border-white/[0.15] hover:text-white"
                  }`}
                >
                  {tier.cta}
                </Link>

                <ul className="mt-5 space-y-2">
                  {tier.features.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 text-[13px] text-[#8B8FA3]"
                    >
                      <CheckCircle2
                        className={`h-3 w-3 shrink-0 ${
                          tier.featured ? "text-[#0EA5E9]" : "text-[#565A6E]"
                        }`}
                      />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom note */}
        <div className="mt-12 text-center">
          <p className="text-[14px] text-[#8B8FA3]">
            All plans include the full AI pipeline: web research,
            fact-checking, hero images, internal linking, and multi-platform
            publishing.
          </p>
          <p className="mt-2 text-[13px] text-[#565A6E]">
            Need a custom plan?{" "}
            <a
              href="mailto:pentrahelp@gmail.com"
              className="text-[#0EA5E9] hover:underline"
            >
              Get in touch
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─── FAQ ──────────────────────────────────────── */

const faqs = [
  {
    q: "How does Pentra generate articles?",
    a: "Pentra runs a 5-step pipeline: it crawls your site to understand your niche, generates keyword clusters, writes articles using live web research (not training data), fact-checks every claim with a separate AI pass, then publishes directly to your repo with schema markup and internal links.",
  },
  {
    q: "Is the content actually unique and not just AI slop?",
    a: "Every article starts with live web research — real sources, real data, real citations. A separate fact-checking AI validates every claim with confidence scores. The result is content that reads like it was written by a subject-matter expert, not a language model.",
  },
  {
    q: "What publishing platforms do you support?",
    a: "Pentra supports GitHub (commits MDX with frontmatter directly to your repo), WordPress (via REST API), webhooks (for custom CMS integrations), and manual copy-paste. Most users publish to GitHub for static sites like Next.js, Astro, or Hugo.",
  },
  {
    q: "Can I review articles before they go live?",
    a: "Absolutely. You can run in full autopilot mode or enable approval gates that require your sign-off before anything publishes. You can also edit articles, adjust tone settings, and control your publishing cadence.",
  },
  {
    q: "What happens if I hit my article limit?",
    a: "Article limits are per calendar month and reset automatically. If you need more articles, you can upgrade your plan at any time and the new limit takes effect immediately. Unused articles don't roll over.",
  },
  {
    q: "Do all plans get the same features?",
    a: "Yes. Every plan — including Free — gets the full AI pipeline: web research, fact-checking, hero images, internal linking, schema markup, and multi-platform publishing. The only difference between plans is the number of articles per month and sites you can manage.",
  },
  {
    q: "How long does it take to generate an article?",
    a: "A typical 2,500-3,000 word article takes about 3-5 minutes from start to publish. This includes web research, drafting, fact-checking, image generation, internal linking, and publishing — all fully automated.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. All plans are month-to-month with no contracts or commitments. Cancel anytime from your dashboard and you'll retain access until the end of your billing period.",
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
          Stop writing blog posts.
          <br />
          Start ranking for keywords.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-[15px] text-[#8B8FA3]">
          Connect your domain and let the pipeline handle the rest.
          Start with 3 free articles every month.
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
    <footer className="border-t border-white/[0.06] py-10">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Radar className="h-4 w-4 text-[#0EA5E9]" />
            <span className="text-[14px] font-semibold text-[#8B8FA3]">
              Pentra
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <a href="#features" className="text-[13px] font-medium text-[#565A6E] hover:text-[#8B8FA3] transition">
              Features
            </a>
            <a href="#pricing" className="text-[13px] font-medium text-[#565A6E] hover:text-[#8B8FA3] transition">
              Pricing
            </a>
            <a href="#faq" className="text-[13px] font-medium text-[#565A6E] hover:text-[#8B8FA3] transition">
              FAQ
            </a>
            <Link href="/legal/privacy" className="text-[13px] font-medium text-[#565A6E] hover:text-[#8B8FA3] transition">
              Privacy
            </Link>
            <Link href="/legal/terms" className="text-[13px] font-medium text-[#565A6E] hover:text-[#8B8FA3] transition">
              Terms
            </Link>
            <p className="text-[13px] text-[#565A6E]">
              &copy; {new Date().getFullYear()} Pentra
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ─── Page ─────────────────────────────────────── */

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <LandingNav />
      <Hero />
      <Stats />
      <Pipeline />
      <Features />
      <Differentiators />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  );
}
