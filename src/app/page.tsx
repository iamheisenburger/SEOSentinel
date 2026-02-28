import Link from "next/link";
import {
  Radar,
  Globe,
  BrainCircuit,
  FileText,
  GitBranch,
  Search,
  BarChart3,
  ShieldCheck,
  ArrowRight,
  Zap,
  Eye,
  CheckCircle2,
} from "lucide-react";

function NavBar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#1E293B]/60 bg-[#0B1120]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0EA5E9]/15">
            <Radar className="h-4.5 w-4.5 text-[#0EA5E9]" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-[#F1F5F9]">
            SEOSentinel
          </span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          <a
            href="#features"
            className="text-sm text-[#94A3B8] transition-colors hover:text-[#F1F5F9]"
          >
            Features
          </a>
          <a
            href="#how-it-works"
            className="text-sm text-[#94A3B8] transition-colors hover:text-[#F1F5F9]"
          >
            How It Works
          </a>
          <a
            href="#pricing"
            className="text-sm text-[#94A3B8] transition-colors hover:text-[#F1F5F9]"
          >
            Pricing
          </a>
        </div>
        <Link
          href="/dashboard"
          className="rounded-lg bg-[#0EA5E9] px-4 py-2 text-sm font-medium text-white shadow-[0_0_20px_rgba(14,165,233,0.25)] transition-all hover:bg-[#38BDF8] hover:shadow-[0_0_25px_rgba(14,165,233,0.35)]"
        >
          Get Started
        </Link>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-44 md:pb-32">
      {/* Background glow effects */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-20 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.07] blur-[120px]" />
        <div className="absolute top-40 right-1/4 h-[300px] w-[400px] rounded-full bg-[#22D3EE]/[0.05] blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-[#0EA5E9]/20 bg-[#0EA5E9]/[0.08] px-4 py-1.5">
          <Zap className="h-3.5 w-3.5 text-[#0EA5E9]" />
          <span className="text-xs font-medium tracking-wide text-[#38BDF8]">
            Autonomous SEO Content Engine
          </span>
        </div>

        {/* Headline */}
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-[#F1F5F9] md:text-6xl">
          Your SEO content machine.{" "}
          <span className="bg-gradient-to-r from-[#0EA5E9] to-[#22D3EE] bg-clip-text text-transparent">
            Set it, forget it, rank.
          </span>
        </h1>

        {/* Sub */}
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#94A3B8] md:text-xl">
          SEOSentinel researches your niche, plans topic clusters, writes
          fact-checked articles, and publishes them to your site — all on
          autopilot.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-2 rounded-xl bg-[#0EA5E9] px-6 py-3 text-sm font-semibold text-white shadow-[0_0_30px_rgba(14,165,233,0.3)] transition-all hover:bg-[#38BDF8] hover:shadow-[0_0_40px_rgba(14,165,233,0.4)]"
          >
            Start Generating
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a
            href="#how-it-works"
            className="inline-flex items-center gap-2 rounded-xl border border-[#1E293B] bg-[#111827]/60 px-6 py-3 text-sm font-medium text-[#94A3B8] transition-all hover:border-[#334155] hover:text-[#F1F5F9]"
          >
            See How It Works
          </a>
        </div>

        {/* Social proof hint */}
        <div className="mt-14 flex items-center justify-center gap-6 text-sm text-[#64748B]">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E]" />
            Research-backed content
          </span>
          <span className="hidden h-1 w-1 rounded-full bg-[#334155] sm:block" />
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E]" />
            Fact-checked by AI
          </span>
          <span className="hidden h-1 w-1 rounded-full bg-[#334155] sm:block" />
          <span className="hidden items-center gap-1.5 sm:flex">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#22C55E]" />
            Auto-published to your repo
          </span>
        </div>
      </div>
    </section>
  );
}

const features = [
  {
    icon: Search,
    title: "Web Research First",
    description:
      "Every article starts with real web research. SEOSentinel crawls your niche, analyzes competitors, and gathers fresh data before writing a single word.",
    color: "#0EA5E9",
  },
  {
    icon: Eye,
    title: "Full Pipeline Visibility",
    description:
      "Watch every step in real time — from topic planning to article generation to publishing. No black boxes. Every job logged, every status tracked.",
    color: "#22D3EE",
  },
  {
    icon: ShieldCheck,
    title: "Approval Gates",
    description:
      "Stay in control. Review and approve topics before articles are written. Preview drafts before they go live. Autopilot with guardrails.",
    color: "#22C55E",
  },
];

function Features() {
  return (
    <section id="features" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#F1F5F9] md:text-4xl">
            Not another AI writer.
          </h2>
          <p className="mt-4 text-lg text-[#94A3B8]">
            A full autonomous pipeline — from research to ranking.
          </p>
        </div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group relative rounded-2xl border border-[#1E293B] bg-[#111827]/60 p-8 transition-all duration-300 hover:border-[#334155] hover:bg-[#111827]"
            >
              {/* Glow on hover */}
              <div
                className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background: `radial-gradient(400px circle at 50% 0%, ${f.color}08, transparent)`,
                }}
              />
              <div
                className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl"
                style={{ backgroundColor: `${f.color}15` }}
              >
                <f.icon className="h-5 w-5" style={{ color: f.color }} />
              </div>
              <h3 className="text-lg font-semibold text-[#F1F5F9]">
                {f.title}
              </h3>
              <p className="mt-3 leading-relaxed text-[#94A3B8]">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const steps = [
  {
    icon: Globe,
    number: "01",
    title: "Crawl",
    description:
      "Point SEOSentinel at your domain. It crawls your site, learns your niche, tone, and existing content structure.",
  },
  {
    icon: BrainCircuit,
    number: "02",
    title: "Plan",
    description:
      "AI generates a topic cluster strategy — target keywords, search intent, priority ranking — tailored to gaps in your content.",
  },
  {
    icon: FileText,
    number: "03",
    title: "Generate",
    description:
      "Each article is web-researched, written, fact-checked, and enriched with internal links and schema markup. No filler content.",
  },
  {
    icon: GitBranch,
    number: "04",
    title: "Publish",
    description:
      "Articles are committed directly to your GitHub repo as MDX files. Your site rebuilds automatically. Zero manual work.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 md:py-32">
      {/* Subtle divider */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#1E293B] to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#F1F5F9] md:text-4xl">
            Four steps to autopilot SEO
          </h2>
          <p className="mt-4 text-lg text-[#94A3B8]">
            From zero to published in minutes, not weeks.
          </p>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-4">
          {steps.map((step, i) => (
            <div key={step.number} className="relative">
              {/* Connector line (desktop) */}
              {i < steps.length - 1 && (
                <div className="absolute top-7 left-[calc(50%+28px)] hidden h-px w-[calc(100%-56px)] bg-gradient-to-r from-[#1E293B] to-[#1E293B]/40 md:block" />
              )}

              <div className="flex flex-col items-center text-center">
                <div className="relative mb-5">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#1E293B] bg-[#111827]">
                    <step.icon className="h-6 w-6 text-[#0EA5E9]" />
                  </div>
                  <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#0EA5E9]/15 font-mono text-[10px] font-bold text-[#0EA5E9]">
                    {step.number}
                  </span>
                </div>
                <h3 className="text-lg font-semibold text-[#F1F5F9]">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#94A3B8]">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const capabilities = [
  "Niche & tone auto-detection from crawl",
  "Keyword research with search intent classification",
  "Web research for every article (real citations)",
  "AI fact-checking with confidence scores",
  "Internal link suggestions based on your existing content",
  "JSON-LD schema markup (Article, FAQ, HowTo)",
  "Direct GitHub commit (MDX frontmatter included)",
  "Configurable publishing cadence",
];

function Capabilities() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#1E293B] to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-16 md:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-[#F1F5F9] md:text-4xl">
              Everything your content team does.{" "}
              <span className="text-[#94A3B8]">Minus the team.</span>
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[#94A3B8]">
              SEOSentinel handles the entire content lifecycle — research,
              writing, quality assurance, and deployment. Every article is backed
              by real web data, not hallucinated fluff.
            </p>
          </div>

          <div className="grid gap-3">
            {capabilities.map((cap) => (
              <div
                key={cap}
                className="flex items-start gap-3 rounded-xl border border-[#1E293B]/60 bg-[#111827]/40 px-5 py-3.5"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#0EA5E9]" />
                <span className="text-sm text-[#CBD5E1]">{cap}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className="relative py-24 md:py-32">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#1E293B] to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#F1F5F9] md:text-4xl">
            Simple pricing, serious results
          </h2>
          <p className="mt-4 text-lg text-[#94A3B8]">
            Start free. Scale when you&apos;re ready.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-4xl gap-6 md:grid-cols-3">
          {/* Free */}
          <div className="rounded-2xl border border-[#1E293B] bg-[#111827]/60 p-8">
            <h3 className="text-sm font-medium tracking-wide text-[#64748B] uppercase">
              Starter
            </h3>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold text-[#F1F5F9]">$0</span>
              <span className="text-[#64748B]">/mo</span>
            </div>
            <p className="mt-3 text-sm text-[#94A3B8]">
              1 site, 4 articles/month. Perfect for testing the waters.
            </p>
            <Link
              href="/dashboard"
              className="mt-8 block rounded-lg border border-[#1E293B] bg-[#1E293B]/40 py-2.5 text-center text-sm font-medium text-[#94A3B8] transition-all hover:border-[#334155] hover:text-[#F1F5F9]"
            >
              Get Started Free
            </Link>
          </div>

          {/* Pro — featured */}
          <div className="relative rounded-2xl border border-[#0EA5E9]/30 bg-[#111827] p-8 shadow-[0_0_40px_rgba(14,165,233,0.08)]">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#0EA5E9] px-3 py-0.5 text-xs font-semibold text-white">
              Popular
            </div>
            <h3 className="text-sm font-medium tracking-wide text-[#0EA5E9] uppercase">
              Pro
            </h3>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold text-[#F1F5F9]">$49</span>
              <span className="text-[#64748B]">/mo</span>
            </div>
            <p className="mt-3 text-sm text-[#94A3B8]">
              3 sites, 30 articles/month. Full pipeline with approval gates.
            </p>
            <Link
              href="/dashboard"
              className="mt-8 block rounded-lg bg-[#0EA5E9] py-2.5 text-center text-sm font-semibold text-white shadow-[0_0_20px_rgba(14,165,233,0.25)] transition-all hover:bg-[#38BDF8]"
            >
              Start Pro Trial
            </Link>
          </div>

          {/* Scale */}
          <div className="rounded-2xl border border-[#1E293B] bg-[#111827]/60 p-8">
            <h3 className="text-sm font-medium tracking-wide text-[#64748B] uppercase">
              Scale
            </h3>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold text-[#F1F5F9]">$149</span>
              <span className="text-[#64748B]">/mo</span>
            </div>
            <p className="mt-3 text-sm text-[#94A3B8]">
              Unlimited sites, 100 articles/month. Priority pipeline & API
              access.
            </p>
            <Link
              href="/dashboard"
              className="mt-8 block rounded-lg border border-[#1E293B] bg-[#1E293B]/40 py-2.5 text-center text-sm font-medium text-[#94A3B8] transition-all hover:border-[#334155] hover:text-[#F1F5F9]"
            >
              Start Scale Trial
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="relative py-24 md:py-32">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#1E293B] to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl border border-[#0EA5E9]/20 bg-[#111827] px-8 py-16 text-center md:px-16">
          {/* Glow */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute top-0 left-1/2 h-[300px] w-[600px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.06] blur-[100px]" />
          </div>

          <div className="relative">
            <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0EA5E9]/15">
              <BarChart3 className="h-6 w-6 text-[#0EA5E9]" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-[#F1F5F9] md:text-4xl">
              Stop writing. Start ranking.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-[#94A3B8]">
              Let SEOSentinel handle your content pipeline while you focus on
              growing your business.
            </p>
            <Link
              href="/dashboard"
              className="group mt-8 inline-flex items-center gap-2 rounded-xl bg-[#0EA5E9] px-8 py-3.5 text-sm font-semibold text-white shadow-[0_0_30px_rgba(14,165,233,0.3)] transition-all hover:bg-[#38BDF8] hover:shadow-[0_0_40px_rgba(14,165,233,0.4)]"
            >
              Get Started for Free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[#1E293B]/60 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 md:flex-row">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0EA5E9]/15">
            <Radar className="h-3.5 w-3.5 text-[#0EA5E9]" />
          </div>
          <span className="text-sm font-semibold text-[#94A3B8]">
            SEOSentinel
          </span>
        </div>
        <p className="text-xs text-[#64748B]">
          &copy; {new Date().getFullYear()} SEOSentinel. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <NavBar />
      <Hero />
      <Features />
      <HowItWorks />
      <Capabilities />
      <Pricing />
      <CTA />
      <Footer />
    </main>
  );
}
