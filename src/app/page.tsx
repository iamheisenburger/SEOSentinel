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
          <span className="text-[12px] font-medium text-[#0EA5E9]">SEO articles you approve</span>
        </div>
        <h1 className="text-[clamp(2.2rem,5vw,3.75rem)] font-bold leading-[1.06] tracking-[-0.03em]">
          Accurate SEO articles.
          <br />
          <span className="text-[#8B8FA3]">Published when you say so.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-[#8B8FA3]">
          Pentra researches topics your customers search for, writes fact-checked articles about what your
          business actually does, and publishes them to your site the moment you approve. Then it checks the
          page is live and shows you how it performs in Google.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/sign-up"
            className="group inline-flex items-center justify-center gap-2 rounded-lg bg-[#0EA5E9] px-6 py-3 text-[15px] font-medium text-white transition-all hover:bg-[#38BDF8]"
          >
            Write my first article free
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <a href="#pricing" className="text-[14px] font-medium text-[#8B8FA3] hover:text-white">
            See pricing
          </a>
        </div>
        <p className="mt-4 text-[13px] text-[#565A6E]">1 free article · No credit card · Cancel paid plans anytime</p>
      </div>
    </section>
  );
}

/* ─── How it works ─────────────────────────────── */

const steps = [
  {
    icon: Building2,
    title: "Tell Pentra what you actually offer",
    desc: "Confirm your business facts, audience and product once. Pentra writes only from what you confirm and never invents features, statistics, testimonials or case studies.",
  },
  {
    icon: GitBranch,
    title: "Connect your site",
    desc: "Point Pentra at the GitHub repository your blog builds from (Next.js, Astro, Hugo and other Markdown/MDX sites). The destination is verified before anything can publish.",
  },
  {
    icon: Search,
    title: "Get a researched draft",
    desc: "Pentra picks a topic your buyers search for, researches it on the live web, writes the article with sources, and runs a separate fact-check review.",
  },
  {
    icon: PencilLine,
    title: "Review, edit, approve",
    desc: "Read the draft, edit the text, title and search description, and see exactly what the reviewer flagged. Nothing publishes without your approval.",
  },
  {
    icon: ShieldCheck,
    title: "Published and verified",
    desc: "Pentra commits the approved article to your repository, confirms the live page loads with the right title and canonical URL, and keeps the exact receipt.",
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
  { icon: Search, title: "Live web research", desc: "Every draft is researched on the live web. Factual claims link to the sources they came from." },
  { icon: ShieldCheck, title: "Independent fact-check", desc: "A separate review pass checks each claim against the evidence and flags anything unsupported." },
  { icon: Building2, title: "Written about your business", desc: "Drafts use only the business facts you confirmed. No made-up features, numbers or customer stories." },
  { icon: PencilLine, title: "Edit before anything goes live", desc: "Change the body, headline, search title and description. Your edit is re-reviewed before you approve it." },
  { icon: GitBranch, title: "One-click GitHub publishing", desc: "Approved articles are committed to your repo as Markdown/MDX with the exact commit recorded." },
  { icon: Globe, title: "Live-page verification", desc: "An article only counts as delivered once the public page loads with the right title and canonical URL." },
  { icon: BarChart3, title: "Search Console reporting", desc: "Connect Google Search Console to see clicks, impressions and positions for the pages Pentra published." },
  { icon: CheckCircle2, title: "Clear limits, no surprise bills", desc: "Fixed monthly price with a set number of articles. Edits and re-reviews of a draft do not use extra articles." },
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
              "Publish anything without your approval.",
              "Guarantee rankings or traffic. Search results take time and depend on many factors.",
              "Build backlinks or send outreach emails.",
              "Publish to WordPress, Webflow or other CMSs. GitHub-based sites only for now.",
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
    q: "Which websites does Pentra work with?",
    a: "Sites whose blog is built from Markdown or MDX files in a GitHub repository, such as Next.js, Astro, Hugo, Jekyll and Gatsby sites. Pentra commits each approved article to the folder you choose and verifies the published page.",
  },
  {
    q: "What happens if a draft isn't good enough?",
    a: "The reviewer lists exactly what it flagged, such as an unsupported claim. You edit the draft and request review again. Nothing is published until you approve it, and edits of a draft never use another article from your allowance.",
  },
  {
    q: "Will Pentra make things up about my business?",
    a: "No. Pentra writes from the business facts you confirm and from sources it can cite. It is instructed never to invent product features, statistics, testimonials or case studies, and a separate review checks for unsupported claims.",
  },
  {
    q: "Does Pentra guarantee rankings?",
    a: "No one can honestly guarantee rankings. Pentra helps you publish useful, accurate content consistently and shows you real Search Console data so you can see what is working.",
  },
  {
    q: "How does billing work?",
    a: "Each plan is a fixed monthly or annual price with a set number of new articles per month. There are no usage charges. Monthly and annual plans can be canceled anytime from Billing; your plan remains active through the end of the current billing period.",
  },
  {
    q: "Who owns the content?",
    a: "You do. Articles are committed to your own repository and stay there if you stop using Pentra.",
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
        <h2 className="text-2xl font-bold tracking-[-0.02em] md:text-4xl">Your next article, researched and ready to approve.</h2>
        <p className="mx-auto mt-4 max-w-md text-[15px] text-[#8B8FA3]">
          Set up your business and site in a few minutes. Your first article is free.
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
    "Pentra researches and writes fact-checked SEO articles about your business, publishes them to your GitHub-based site when you approve, and verifies the live page.",
  offers: { "@type": "AggregateOffer", lowPrice: "0", highPrice: "199", priceCurrency: "USD", offerCount: "4" },
  featureList: [
    "Live web research with cited sources",
    "Independent fact-check review",
    "Owner review, editing and approval",
    "GitHub Markdown/MDX publishing with commit receipts",
    "Live-page verification",
    "Google Search Console reporting",
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
