import Link from "next/link";
import {
  Radar,
  ArrowRight,
  CheckCircle2,
  Search,
  ShieldCheck,
  GitBranch,
  PencilLine,
  BarChart3,
  Building2,
  Globe,
  XCircle,
} from "lucide-react";
import { LandingNav } from "@/components/layout/landing-nav";
import { PricingSection } from "@/components/landing/pricing-section";

/* ─── Hero ─────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative pt-28 pb-16 md:pt-40 md:pb-24">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.04] blur-[120px]" />
      </div>
      <div className="relative mx-auto max-w-4xl px-6 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#0EA5E9]/[0.15] bg-[#0EA5E9]/[0.05] px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[#0EA5E9]" />
          <span className="text-[12px] font-medium text-[#0EA5E9]">Autopilot SEO for your website</span>
        </div>
        <h1 className="text-[clamp(2.2rem,5vw,3.75rem)] font-bold leading-[1.06] tracking-[-0.03em]">
          More customers from Google.
          <br />
          <span className="text-[#8B8FA3]">On autopilot.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-[#8B8FA3]">
          Add your website and Pentra takes it from there. It learns what you sell, finds what your customers
          search for, publishes researched, fact-checked articles to your site on a steady schedule, improves the
          pages that are close to page one, and shows you the clicks in your own Search Console data.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/sign-up"
            className="group inline-flex items-center justify-center gap-2 rounded-lg bg-[#0EA5E9] px-6 py-3 text-[15px] font-medium text-white transition-all hover:bg-[#38BDF8]"
          >
            Start free
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a href="#pricing" className="text-[14px] font-medium text-[#8B8FA3] hover:text-white">
            See pricing
          </a>
        </div>
        <p className="mt-4 text-[13px] text-[#565A6E]">1 free article · No credit card · Autopilot or review-first · Cancel anytime</p>
      </div>
    </section>
  );
}

/* ─── How it works ─────────────────────────────── */

const steps = [
  {
    icon: Globe,
    title: "Add your website",
    desc: "Enter your site and confirm what you sell and who buys. Pentra writes only from what you confirm and never invents features, statistics, testimonials or case studies.",
  },
  {
    icon: GitBranch,
    title: "Connect it once",
    desc: "Connect WordPress (with the Pentra plugin) or a GitHub-based site, plus Google Search Console. Pentra verifies the connection before anything publishes.",
  },
  {
    icon: ShieldCheck,
    title: "Choose Autopilot or Review first",
    desc: "On Autopilot, Pentra publishes on your plan's schedule and holds back any draft with a factual concern for you. On Review first, every article waits for your approval.",
  },
  {
    icon: Search,
    title: "Pentra researches, writes and publishes",
    desc: "Each article is researched on the live web, written with sources, checked by a separate fact-check review, published to your site and confirmed live.",
  },
  {
    icon: BarChart3,
    title: "It keeps improving what works",
    desc: "Pentra updates the pages it wrote (and any you select) to answer the searches they already appear for, and reports clicks, rankings and every change it made.",
  },
];

function HowItWorks() {
  return (
    <section id="pipeline" className="relative scroll-mt-20 border-t border-white/[0.04] py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-4xl">How it works</h2>
          <p className="mt-3 text-[15px] text-[#8B8FA3]">Five steps. You stay in control of every article.</p>
        </div>
        <ol className="grid gap-4 md:grid-cols-5">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-xl border border-white/[0.06] bg-[#0A0B10] p-5">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold text-[#565A6E]">{index + 1}</span>
                <step.icon className="h-4 w-4 text-[#0EA5E9]" />
              </div>
              <h3 className="mt-3 text-[15px] font-semibold leading-snug">{step.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-[#8B8FA3]">{step.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ─── What you get ─────────────────────────────── */

const features = [
  { icon: ShieldCheck, title: "Set-and-forget publishing", desc: "Autopilot publishes on your plan's schedule. A draft that doesn't pass the fact check is held back and never goes live." },
  { icon: Search, title: "Live web research", desc: "Every article is researched on the live web. Factual claims link to the sources they came from." },
  { icon: CheckCircle2, title: "Independent fact-check", desc: "A separate review checks each claim against the evidence before anything is published." },
  { icon: Building2, title: "Written about your business", desc: "Articles use only the business facts you confirmed, with a clear next step to your signup, booking or checkout page." },
  { icon: BarChart3, title: "Improves pages near page one", desc: "Pentra updates its pages to answer the searches they already appear for in Google, then measures the result." },
  { icon: PencilLine, title: "Written for AI answers too", desc: "Each section answers its question in the first line and stands on its own, the way Google and ChatGPT quote pages." },
  { icon: GitBranch, title: "WordPress and GitHub publishing", desc: "Articles are published to your site and confirmed live, with a receipt for every change." },
  { icon: Globe, title: "Weekly site health + Search Console", desc: "Every week Pentra checks your key pages for what stops Google showing them (blocked or unreachable pages, missing titles and descriptions) and shows your clicks and positions." },
];

function Features() {
  return (
    <section id="features" className="relative scroll-mt-20 border-t border-white/[0.04] py-20 md:py-28">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-4xl">What you get</h2>
          <p className="mt-3 text-[15px] text-[#8B8FA3]">Everything below is included on every plan.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((item) => (
            <div key={item.title} className="rounded-xl border border-white/[0.06] bg-[#0A0B10] p-5">
              <item.icon className="h-4 w-4 text-[#0EA5E9]" />
              <h3 className="mt-3 text-[14px] font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[#8B8FA3]">{item.desc}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-10 max-w-3xl rounded-xl border border-white/[0.06] bg-[#0A0B10] p-6">
          <h3 className="text-[15px] font-semibold">What Pentra does not do (yet)</h3>
          <ul className="mt-3 space-y-2 text-[14px] text-[#8B8FA3]">
            {[
              "Publish a draft that failed its fact check: it waits for you.",
              "Guarantee rankings or traffic. Search results take time and depend on many factors.",
              "Build backlinks or send outreach emails.",
              "Publish to Shopify or Webflow yet (coming soon). WordPress and GitHub-based sites are supported today.",
            ].map((line) => (
              <li key={line} className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#565A6E]" />{line}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* ─── FAQ ──────────────────────────────────────── */

const faqs = [
  {
    q: "What does Pentra do after I add my website?",
    a: "It learns what you sell from the details you confirm, connects to your site and Search Console, and then researches, writes, fact-checks and publishes articles on your plan's schedule. It also improves pages that already appear in Google search, and reports what changed and the clicks that followed.",
  },
  {
    q: "Which websites does Pentra work with?",
    a: "WordPress sites (with the free Pentra publisher plugin) and sites built from Markdown or MDX files in a GitHub repository, such as Next.js, Astro, Hugo, Jekyll and Gatsby. Shopify and Webflow are coming soon.",
  },
  {
    q: "Is Autopilot safe for my brand?",
    a: "Autopilot only publishes articles that pass the fact check. A draft that doesn't pass is held back, never published, and the schedule moves on. You can pause Pentra at any time, or choose Review first so nothing publishes without your approval.",
  },
  {
    q: "Will Pentra make things up about my business?",
    a: "No. Pentra writes from the business facts you confirm and from sources it can cite. It is instructed never to invent product features, statistics, testimonials or case studies, and a separate review checks for unsupported claims.",
  },
  {
    q: "Does Pentra guarantee rankings?",
    a: "No one can honestly guarantee rankings, and search results take weeks to move. Pentra publishes useful, accurate content consistently, improves what is close to page one, and shows you real Search Console data so you can see what is working.",
  },
  {
    q: "How does billing work?",
    a: "Each plan is a fixed monthly or annual price with a set number of new articles per month. There are no usage charges. Monthly and annual plans can be canceled anytime from Billing; your plan remains active through the end of the current billing period.",
  },
];

function FAQ() {
  return (
    <section id="faq" className="relative scroll-mt-20 border-t border-white/[0.04] py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-6">
        <h2 className="mb-10 text-center text-2xl font-bold tracking-[-0.02em] md:text-4xl">Questions</h2>
        <div className="space-y-3">
          {faqs.map((item) => (
            <details key={item.q} className="group rounded-xl border border-white/[0.06] bg-[#0A0B10] p-5">
              <summary className="cursor-pointer list-none text-[15px] font-semibold">{item.q}</summary>
              <p className="mt-3 text-[14px] leading-relaxed text-[#8B8FA3]">{item.a}</p>
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
    <section className="relative border-t border-white/[0.04] py-24 md:py-32">
      <div className="relative mx-auto max-w-2xl px-6 text-center">
        <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-4xl">Add your website. Pentra handles the rest.</h2>
        <p className="mx-auto mt-4 max-w-md text-[15px] text-[#8B8FA3]">
          Set up takes a few minutes. Your first article is free.
        </p>
        <div className="mt-8">
          <Link
            href="/sign-up"
            className="group inline-flex items-center gap-2 rounded-lg bg-[#0EA5E9] px-6 py-3 text-[14px] font-medium text-white transition-all hover:bg-[#38BDF8]"
          >
            Get started free
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
            <span className="text-[18px] font-bold">Pentra</span>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div className="flex flex-col gap-3">
              <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#565A6E]">Product</span>
              <a href="#features" className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white">Features</a>
              <a href="#pricing" className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white">Pricing</a>
              <a href="#faq" className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white">FAQ</a>
              <Link href="/blog" className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white">Blog</Link>
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#565A6E]">Company</span>
              <Link href="/contact" className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white">Contact</Link>
              <Link href="/legal/privacy" className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white">Privacy</Link>
              <Link href="/legal/terms" className="text-[15px] font-semibold text-[#8B8FA3] transition hover:text-white">Terms</Link>
            </div>
          </div>
        </div>
        <div className="mt-10 border-t border-white/[0.06] pt-6">
          <p className="text-[14px] font-medium text-[#565A6E]">&copy; {new Date().getFullYear()} Pentra. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}

/* ─── JSON-LD ──────────────────────────────────── */

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Pentra",
  url: "https://pentra.dev",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Autopilot SEO: Pentra researches, writes, fact-checks and publishes articles to your WordPress or GitHub-based site on a schedule, improves pages near page one, and reports Search Console results.",
  offers: { "@type": "AggregateOffer", lowPrice: "0", highPrice: "199", priceCurrency: "USD", offerCount: "4" },
  featureList: [
    "Live web research with cited sources",
    "Independent fact-check review",
    "Autopilot or review-first publishing",
    "WordPress and GitHub publishing with receipts",
    "Improvement of pages already ranking",
    "Live-page verification",
    "Google Search Console reporting",
    "Weekly site health checks",
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
};

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <LandingNav />
      <Hero />
      <HowItWorks />
      <Features />
      <PricingSection />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  );
}
