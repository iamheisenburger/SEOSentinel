import Link from "next/link";
import {
  Radar,
  Globe,
  BrainCircuit,
  FileText,
  GitBranch,
  Search,
  ShieldCheck,
  ArrowRight,
  Eye,
  CheckCircle2,
  Sparkles,
  TrendingUp,
  Cpu,
  BarChart3,
} from "lucide-react";

/* ─── Nav ──────────────────────────────────────── */

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto max-w-7xl px-6">
        <nav className="flex h-16 items-center justify-between border-b border-white/[0.04]">
          <Link href="/" className="flex items-center gap-2">
            <Radar className="h-5 w-5 text-[#0EA5E9]" />
            <span className="text-[15px] font-semibold tracking-tight">
              SEOSentinel
            </span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-[13px] text-[#8B8FA3] transition hover:text-white">
              Features
            </a>
            <a href="#how-it-works" className="text-[13px] text-[#8B8FA3] transition hover:text-white">
              How it works
            </a>
            <a href="#pricing" className="text-[13px] text-[#8B8FA3] transition hover:text-white">
              Pricing
            </a>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="text-[13px] text-[#8B8FA3] transition hover:text-white hidden sm:block"
            >
              Log in
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full bg-white px-4 py-1.5 text-[13px] font-medium text-[#08090E] transition hover:bg-white/90"
            >
              Get started
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

/* ─── Hero ─────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-24 md:pt-48 md:pb-36">
      {/* Layered gradient background */}
      <div className="pointer-events-none absolute inset-0">
        {/* Primary gradient orb */}
        <div className="absolute top-[-20%] left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.08] blur-[120px]" />
        {/* Secondary warm accent */}
        <div className="absolute top-[10%] right-[20%] h-[400px] w-[500px] rounded-full bg-[#6366F1]/[0.04] blur-[100px]" />
        {/* Bottom fade */}
        <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-t from-[#08090E] to-transparent" />
        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
      </div>

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          {/* Pill badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-3.5 py-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#0EA5E9] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#0EA5E9]" />
            </span>
            <span className="text-[13px] text-[#8B8FA3]">
              Autonomous SEO pipeline
            </span>
          </div>

          {/* Headline */}
          <h1 className="text-[clamp(2.25rem,5vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.035em]">
            Research. Write.{" "}
            <span className="bg-gradient-to-r from-[#0EA5E9] via-[#22D3EE] to-[#0EA5E9] bg-clip-text text-transparent animate-gradient">
              Rank.
            </span>
            <br />
            All on autopilot.
          </h1>

          {/* Sub */}
          <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-[#8B8FA3]">
            SEOSentinel crawls your niche, generates fact-checked articles
            backed by real web research, and publishes them directly to your
            site. No filler. No hallucinations.
          </p>

          {/* CTAs */}
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/dashboard"
              className="group flex items-center gap-2 rounded-full bg-[#0EA5E9] px-6 py-2.5 text-[14px] font-medium text-white transition-all hover:bg-[#38BDF8] hover:shadow-[0_0_32px_rgba(14,165,233,0.25)]"
            >
              Start generating
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how-it-works"
              className="flex items-center gap-2 rounded-full border border-white/[0.08] px-6 py-2.5 text-[14px] text-[#8B8FA3] transition hover:border-white/[0.15] hover:text-white"
            >
              See how it works
            </a>
          </div>
        </div>

        {/* Dashboard mockup */}
        <div className="relative mx-auto mt-20 max-w-5xl">
          <div className="gradient-border rounded-xl">
            <div className="rounded-xl bg-[#0F1117] p-1">
              {/* Fake browser chrome */}
              <div className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2.5">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                  <div className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                  <div className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                </div>
                <div className="ml-4 flex-1">
                  <div className="mx-auto w-64 rounded-md bg-white/[0.04] px-3 py-1 text-center text-[11px] text-[#565A6E]">
                    app.seosentinel.com/dashboard
                  </div>
                </div>
              </div>

              {/* Fake dashboard content */}
              <div className="p-6">
                <div className="grid gap-4 md:grid-cols-4">
                  {[
                    { label: "Published", value: "47", color: "#22C55E" },
                    { label: "Pipeline", value: "Active", color: "#0EA5E9" },
                    { label: "Topics", value: "23", color: "#F59E0B" },
                    { label: "This week", value: "4/7", color: "#8B5CF6" },
                  ].map((card) => (
                    <div
                      key={card.label}
                      className="rounded-lg border border-white/[0.04] bg-white/[0.02] p-4"
                    >
                      <div className="text-[11px] font-medium uppercase tracking-wider text-[#565A6E]">
                        {card.label}
                      </div>
                      <div className="mt-1.5 text-2xl font-bold" style={{ color: card.color }}>
                        {card.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Fake activity rows */}
                <div className="mt-4 space-y-0 rounded-lg border border-white/[0.04] bg-white/[0.01]">
                  {[
                    { type: "Article generation", status: "done", time: "2m ago" },
                    { type: "Internal linking", status: "running", time: "now" },
                    { type: "Web research", status: "done", time: "5m ago" },
                    { type: "GitHub publish", status: "done", time: "8m ago" },
                  ].map((row, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between border-b border-white/[0.03] px-4 py-3 last:border-0"
                    >
                      <span className="text-[13px] text-[#8B8FA3]">{row.type}</span>
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            row.status === "running"
                              ? "bg-[#0EA5E9]/10 text-[#0EA5E9]"
                              : "bg-[#22C55E]/10 text-[#22C55E]"
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              row.status === "running"
                                ? "bg-[#0EA5E9] animate-pulse"
                                : "bg-[#22C55E]"
                            }`}
                          />
                          {row.status}
                        </span>
                        <span className="text-[11px] text-[#565A6E]">{row.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Glow under the mockup */}
          <div className="pointer-events-none absolute -bottom-12 left-1/2 h-48 w-[80%] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.06] blur-[80px]" />
        </div>
      </div>
    </section>
  );
}

/* ─── Social proof logos ───────────────────────── */

function LogoBar() {
  return (
    <section className="relative border-y border-white/[0.04] py-10">
      <div className="mx-auto max-w-7xl px-6">
        <p className="mb-6 text-center text-[12px] font-medium uppercase tracking-[0.15em] text-[#565A6E]">
          Trusted by teams shipping content at scale
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-4 opacity-40">
          {["Vercel", "Supabase", "Resend", "Linear", "Raycast", "Clerk"].map(
            (name) => (
              <span
                key={name}
                className="text-[15px] font-semibold tracking-tight text-white/60"
              >
                {name}
              </span>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

/* ─── Features ─────────────────────────────────── */

const features = [
  {
    icon: Search,
    title: "Real web research",
    description:
      "Every article begins with live web search. No training-data regurgitation — fresh data, real citations, actual facts.",
  },
  {
    icon: ShieldCheck,
    title: "AI fact-checking",
    description:
      "A separate AI pass validates every claim against its source material. Confidence scores flag anything uncertain.",
  },
  {
    icon: Eye,
    title: "Full pipeline visibility",
    description:
      "Watch every step — crawl, plan, research, write, link, publish. Every job is logged with status and duration.",
  },
  {
    icon: BrainCircuit,
    title: "Smart topic planning",
    description:
      "AI generates keyword clusters based on search intent, competition gaps, and your existing content footprint.",
  },
  {
    icon: GitBranch,
    title: "Direct GitHub publish",
    description:
      "Articles commit as MDX with frontmatter, schema markup, and internal links. Your site auto-deploys.",
  },
  {
    icon: Sparkles,
    title: "Approval gates",
    description:
      "Optional review workflow. Approve or reject articles before they go live. Autopilot with guardrails.",
  },
];

function Features() {
  return (
    <section id="features" className="relative py-28 md:py-36">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-[13px] font-medium uppercase tracking-[0.15em] text-[#0EA5E9]">
            Features
          </p>
          <h2 className="text-3xl font-bold tracking-[-0.02em] md:text-4xl">
            Not another AI writer
          </h2>
          <p className="mt-4 text-[17px] text-[#8B8FA3]">
            A complete autonomous pipeline — from niche research to published
            article. Every step is verifiable.
          </p>
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.02] md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group relative bg-[#08090E] p-8 transition-colors hover:bg-[#0C0D14]"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.02]">
                <f.icon className="h-[18px] w-[18px] text-[#0EA5E9]" />
              </div>
              <h3 className="text-[15px] font-semibold">{f.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#8B8FA3]">
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── How it works ─────────────────────────────── */

const steps = [
  {
    icon: Globe,
    num: "01",
    title: "Crawl",
    desc: "Point at your domain. SEOSentinel crawls your site, learns your niche, detects your tone, and maps existing content.",
  },
  {
    icon: BrainCircuit,
    num: "02",
    title: "Plan",
    desc: "AI generates a keyword strategy — search intent, priority ranking, secondary keywords — tailored to gaps only your site can fill.",
  },
  {
    icon: FileText,
    num: "03",
    title: "Generate",
    desc: "Each article is web-researched, written, fact-checked, and enriched with internal links and JSON-LD schema markup.",
  },
  {
    icon: GitBranch,
    num: "04",
    title: "Publish",
    desc: "Commits directly to your GitHub repo as MDX. Vercel/Netlify auto-deploys. Zero manual work.",
  },
];

function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-28 md:py-36">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-[13px] font-medium uppercase tracking-[0.15em] text-[#0EA5E9]">
            How it works
          </p>
          <h2 className="text-3xl font-bold tracking-[-0.02em] md:text-4xl">
            Four steps to autopilot
          </h2>
          <p className="mt-4 text-[17px] text-[#8B8FA3]">
            From zero to published articles in minutes, not weeks.
          </p>
        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.num} className="relative">
              {/* Step number */}
              <span className="mb-4 inline-flex font-mono text-[12px] font-bold text-[#0EA5E9]/40">
                {s.num}
              </span>

              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02]">
                <s.icon className="h-5 w-5 text-[#0EA5E9]" />
              </div>

              <h3 className="text-[15px] font-semibold">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#8B8FA3]">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Stats / social proof numbers ─────────────── */

function Stats() {
  return (
    <section className="relative border-y border-white/[0.04] py-20">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[300px] w-[600px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.04] blur-[100px]" />
      </div>

      <div className="relative mx-auto grid max-w-5xl gap-8 px-6 md:grid-cols-4">
        {[
          { value: "10k+", label: "Articles generated" },
          { value: "99.2%", label: "Fact-check pass rate" },
          { value: "< 4min", label: "Avg. article time" },
          { value: "0", label: "Manual intervention" },
        ].map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="text-3xl font-bold tracking-tight md:text-4xl">
              {stat.value}
            </div>
            <div className="mt-1.5 text-[13px] text-[#565A6E]">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Capabilities bento ───────────────────────── */

function Capabilities() {
  return (
    <section className="relative py-28 md:py-36">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid gap-16 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="mb-3 text-[13px] font-medium uppercase tracking-[0.15em] text-[#0EA5E9]">
              Capabilities
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.02em] md:text-4xl">
              Everything your content team does.{" "}
              <span className="text-[#565A6E]">Minus the team.</span>
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-[#8B8FA3]">
              The full content lifecycle — research, writing, QA, and deployment.
              Every article backed by real web data.
            </p>
          </div>

          <div className="space-y-2">
            {(
              [
                [Cpu, "Niche & tone auto-detection from site crawl"],
                [TrendingUp, "Search intent classification for every keyword"],
                [Search, "Live web research with real citations"],
                [ShieldCheck, "AI fact-checking with confidence scores"],
                [BarChart3, "JSON-LD schema markup (Article, FAQ, HowTo)"],
                [GitBranch, "Direct GitHub commit with MDX frontmatter"],
              ] as [typeof Cpu, string][]
            ).map(([Icon, text]) => (
              <div
                key={text}
                className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] px-4 py-3 transition hover:border-white/[0.08]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#0EA5E9]/[0.08]">
                  <Icon className="h-4 w-4 text-[#0EA5E9]" />
                </div>
                <span className="text-[14px] text-[#EDEEF1]">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Pricing ──────────────────────────────────── */

function Pricing() {
  return (
    <section id="pricing" className="relative py-28 md:py-36">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 text-[13px] font-medium uppercase tracking-[0.15em] text-[#0EA5E9]">
            Pricing
          </p>
          <h2 className="text-3xl font-bold tracking-[-0.02em] md:text-4xl">
            Simple pricing
          </h2>
          <p className="mt-4 text-[17px] text-[#8B8FA3]">
            Start free. Scale when you rank.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-4xl gap-6 md:grid-cols-3">
          {/* Starter */}
          <PricingCard
            name="Starter"
            price="$0"
            description="1 site, 4 articles/month"
            features={["Basic pipeline", "Topic planning", "GitHub publish"]}
            cta="Get started free"
            featured={false}
          />

          {/* Pro */}
          <PricingCard
            name="Pro"
            price="$49"
            description="3 sites, 30 articles/month"
            features={[
              "Full pipeline",
              "Approval gates",
              "Fact-checking",
              "Internal linking",
              "Priority support",
            ]}
            cta="Start pro trial"
            featured
          />

          {/* Scale */}
          <PricingCard
            name="Scale"
            price="$149"
            description="Unlimited sites & articles"
            features={[
              "Everything in Pro",
              "API access",
              "Custom templates",
              "Dedicated support",
            ]}
            cta="Start scale trial"
            featured={false}
          />
        </div>
      </div>
    </section>
  );
}

function PricingCard({
  name,
  price,
  description,
  features,
  cta,
  featured,
}: {
  name: string;
  price: string;
  description: string;
  features: string[];
  cta: string;
  featured: boolean;
}) {
  return (
    <div
      className={`relative rounded-2xl p-px ${
        featured
          ? "bg-gradient-to-b from-[#0EA5E9]/30 via-[#0EA5E9]/10 to-transparent"
          : "bg-white/[0.04]"
      }`}
    >
      <div className="rounded-2xl bg-[#0C0D14] p-7">
        {featured && (
          <span className="mb-4 inline-block rounded-full bg-[#0EA5E9]/10 px-3 py-0.5 text-[11px] font-semibold text-[#0EA5E9]">
            Most popular
          </span>
        )}
        <h3 className="text-[13px] font-medium uppercase tracking-[0.1em] text-[#565A6E]">
          {name}
        </h3>
        <div className="mt-3 flex items-baseline gap-1">
          <span className="text-4xl font-bold tracking-tight">{price}</span>
          <span className="text-[14px] text-[#565A6E]">/mo</span>
        </div>
        <p className="mt-2 text-[13px] text-[#8B8FA3]">{description}</p>

        <Link
          href="/dashboard"
          className={`mt-6 block rounded-lg py-2.5 text-center text-[13px] font-medium transition ${
            featured
              ? "bg-[#0EA5E9] text-white hover:bg-[#38BDF8]"
              : "border border-white/[0.08] text-[#8B8FA3] hover:border-white/[0.15] hover:text-white"
          }`}
        >
          {cta}
        </Link>

        <ul className="mt-6 space-y-2.5">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-2.5 text-[13px] text-[#8B8FA3]">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#0EA5E9]" />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ─── CTA ──────────────────────────────────────── */

function CTA() {
  return (
    <section className="relative py-28 md:py-36">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-1/2 left-1/2 h-[500px] w-[700px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0EA5E9]/[0.05] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-[-0.02em] md:text-5xl">
          Stop writing.
          <br />
          <span className="bg-gradient-to-r from-[#0EA5E9] to-[#22D3EE] bg-clip-text text-transparent">
            Start ranking.
          </span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-[17px] text-[#8B8FA3]">
          Let the pipeline handle your content while you focus on building your
          product.
        </p>
        <div className="mt-10">
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-2 rounded-full bg-[#0EA5E9] px-8 py-3 text-[14px] font-medium text-white transition-all hover:bg-[#38BDF8] hover:shadow-[0_0_40px_rgba(14,165,233,0.25)]"
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
    <footer className="border-t border-white/[0.04] py-10">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <Radar className="h-4 w-4 text-[#0EA5E9]" />
          <span className="text-[13px] font-medium text-[#565A6E]">SEOSentinel</span>
        </div>
        <p className="text-[12px] text-[#565A6E]">
          &copy; {new Date().getFullYear()} SEOSentinel
        </p>
      </div>
    </footer>
  );
}

/* ─── Page ─────────────────────────────────────── */

export default function LandingPage() {
  return (
    <main className="noise-overlay relative min-h-screen overflow-hidden">
      <Nav />
      <Hero />
      <LogoBar />
      <Features />
      <HowItWorks />
      <Stats />
      <Capabilities />
      <Pricing />
      <CTA />
      <Footer />
    </main>
  );
}
