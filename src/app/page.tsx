import Link from "next/link";
import { ArrowRight, Check, Minus, Radar } from "lucide-react";
import { LandingNav } from "@/components/layout/landing-nav";
import { PricingSection } from "@/components/landing/pricing-section";
import { ProductFrame } from "@/components/landing/product-frame";
import { RunLog } from "@/components/landing/run-log";
import { AnswerPanel, ControlPanel, HealthPanel, RankingsPanel, SourcesPanel } from "@/components/landing/panels";

/* Design: a dark, product-led page. Near-black canvas, precise sans type,
 * hairline structure instead of card grids, the product itself as the imagery.
 * White is the call to action; Pentra blue marks status and links only. */

const WRAP = "mx-auto w-full max-w-[1200px] px-6";
const EYEBROW = "font-mono text-[12px] uppercase tracking-[0.12em] text-[#62666D]";

function PrimaryCta({ children, href = "/sign-up" }: { children: React.ReactNode; href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2 rounded-full bg-[#F7F8F8] px-5 py-2.5 text-[15px] font-medium text-[#08090A] transition hover:bg-white">
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/* ─── Hero ─────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 md:pt-44">
      <div className={WRAP}>
        <p className="animate-fade-in-up flex items-center gap-2 text-[13px] text-[#8A8F98]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4CB782]" />Autopilot SEO for your website
        </p>
        <h1 className="animate-fade-in-up mt-6 max-w-[15ch] text-[clamp(2.6rem,6.4vw,5rem)] font-semibold leading-[1.02] tracking-[-0.04em] [text-wrap:balance]"
          style={{ animationDelay: "0.05s" }}>
          More customers from Google and AI answers.
        </h1>
        <p className="animate-fade-in-up mt-6 max-w-[40rem] text-[17px] leading-relaxed text-[#8A8F98] md:text-[19px] [text-wrap:pretty]" style={{ animationDelay: "0.12s" }}>
          Pentra learns what you sell, researches what your customers search for, and publishes fact-checked
          articles to your site on your schedule. Then it fixes the pages closest to page one and shows the results
          in your own Search Console data.
        </p>
        <div className="animate-fade-in-up mt-9 flex flex-wrap items-center gap-x-6 gap-y-4" style={{ animationDelay: "0.18s" }}>
          <PrimaryCta>Start free</PrimaryCta>
          <a href="#pipeline" className="text-[15px] font-medium text-[#D0D6E0] transition hover:text-white">See how it works <span aria-hidden>→</span></a>
          <span className="text-[13px] text-[#62666D]">1 free article · No credit card</span>
        </div>
      </div>
      <div className={`${WRAP} animate-fade-in-up mt-16 md:mt-20`} style={{ animationDelay: "0.25s" }}>
        <ProductFrame />
      </div>
    </section>
  );
}

/* ─── Proof ─────────────────────────────────────── */

function Proof() {
  return (
    <section className="border-t border-white/[0.06]">
      <div className={`${WRAP} flex flex-col gap-4 py-8 md:flex-row md:items-center md:justify-between`}>
        <p className="text-[15px] text-[#8A8F98]">
          <span className="text-[#F7F8F8]">We run our own marketing on Pentra.</span> The guides on this site are written,
          fact-checked and published by Pentra, now on Autopilot.
        </p>
        <Link href="/blog" className="shrink-0 text-[14px] font-medium text-[#D0D6E0] transition hover:text-white">Read them <span aria-hidden>→</span></Link>
      </div>
    </section>
  );
}

/* ─── Statement + pillars ──────────────────────── */

const PILLARS = [
  { title: "Fact-checked, never invented", desc: "Every article is written from the business facts you confirmed, and a separate review blocks any claim it can't support before it goes live." },
  { title: "Published, then confirmed live", desc: "Pentra publishes to WordPress or your GitHub site, then opens the real page to confirm the exact article is live." },
  { title: "Measured in your own data", desc: "Clicks and positions come from your Google Search Console, before and after every article and every improvement." },
];

function PillarGlyph({ n }: { n: number }) {
  // Thin line drawings: a stacked source ledger, a page with a check, a rising line.
  const common = { fill: "none", stroke: "rgba(247,248,248,0.55)", strokeWidth: 1 } as const;
  return (
    <svg viewBox="0 0 120 72" className="h-16 w-28" aria-hidden>
      {n === 0 && <>{[0, 8, 16, 24].map(d => <rect key={d} x={20 + d / 2} y={14 + d} width="64" height="22" rx="3" {...common} opacity={1 - d / 40} />)}</>}
      {n === 1 && <><rect x="30" y="8" width="48" height="58" rx="4" {...common} />{[20, 28, 36].map(y => <line key={y} x1="38" x2="70" y1={y} y2={y} {...common} opacity="0.6" />)}<circle cx="78" cy="54" r="11" {...common} stroke="#4CB782" /><path d="M73 54l3.5 3.5L83 51" {...common} stroke="#4CB782" /></>}
      {n === 2 && <><line x1="14" x2="106" y1="62" y2="62" {...common} opacity="0.5" /><path d="M14 56 L34 50 L50 52 L66 38 L82 34 L106 14" {...common} stroke="#0EA5E9" /><circle cx="106" cy="14" r="2.5" fill="#0EA5E9" /></>}
    </svg>
  );
}

function Statement() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-white/[0.06] py-24 md:py-36">
      <div className={WRAP}>
        <p className="max-w-[52rem] text-[26px] font-medium leading-[1.25] tracking-[-0.02em] md:text-[40px] [text-wrap:pretty]">
          Pentra is the SEO team your website never had.{" "}
          <span className="text-[#62666D]">It learns what you sell, writes what your customers search for, publishes on your schedule, and keeps fixing what stops you reaching page one.</span>
        </p>
        <div className="mt-16 grid border-t border-white/[0.06] md:mt-24 md:grid-cols-3">
          {PILLARS.map((pillar, n) => (
            <div key={pillar.title} className={`py-10 md:px-8 ${n > 0 ? "border-t border-white/[0.06] md:border-l md:border-t-0" : "md:pl-0"}`}>
              <PillarGlyph n={n} />
              <h3 className="mt-8 text-[16px] font-medium text-[#F7F8F8]">{pillar.title}</h3>
              <p className="mt-2 max-w-[22rem] text-[15px] leading-relaxed text-[#8A8F98]">{pillar.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── How Autopilot runs ───────────────────────── */

const STEPS = [
  ["Add your website", "Pentra reads your homepage and suggests your business facts and your booking or signup page. You confirm them."],
  ["Connect it once", "WordPress with the Pentra plugin, a GitHub-based site, or paste-it-yourself on any other platform. Plus Google Search Console."],
  ["Choose Autopilot or Review first", "Pick a pace from 1 to 21 articles a week, or approve every article yourself."],
  ["Pentra does the work", "Research, writing, fact check, publishing and a live-page check, for every article, on schedule."],
  ["It keeps improving what works", "Pages sitting just off page one are improved first, and a weekly health check catches what stops Google showing you."],
];

function HowItWorks() {
  return (
    <section id="pipeline" className="scroll-mt-20 border-t border-white/[0.06] py-24 md:py-36">
      <div className={WRAP}>
        <p className={EYEBROW}>How Autopilot runs</p>
        <h2 className="mt-4 max-w-[18ch] text-[clamp(2rem,4.2vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.035em] [text-wrap:balance]">
          Set it up once. Pentra keeps going.
        </h2>
        <div className="mt-14 grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <ol className="border-t border-white/[0.06]">
            {STEPS.map(([title, desc], n) => (
              <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-2 border-b border-white/[0.06] py-5">
                <span className="font-mono text-[13px] text-[#62666D]">{String(n + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="text-[16px] font-medium text-[#F7F8F8]">{title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-[#8A8F98]">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="lg:sticky lg:top-28 lg:self-start">
            <RunLog />
            <p className="mt-3 text-[12px] text-[#62666D]">Example run for an example site. Your log shows your real articles.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Feature rows ─────────────────────────────── */

const ROWS = [
  { label: "01 · Accuracy", title: "No invented facts.", body: "Most AI writers make up statistics. Pentra writes from the business facts you confirm and the searches your customers make, and a separate fact check blocks any claim it can't support. A draft that doesn't pass is never published.",
    points: ["Written only from business facts you confirmed", "No invented statistics, quotes or case studies", "Independent fact check before anything goes live"], panel: <SourcesPanel /> },
  { label: "02 · Improve", title: "Pages close to page one come first.", body: "The fastest traffic is on pages Google already shows at positions 4 to 20. Pentra finds them in your Search Console, answers the searches they appear for, and measures what changed.",
    points: ["Uses your own Search Console data", "Answers the exact searches a page appears for", "Before and after clicks for every change"], panel: <RankingsPanel /> },
  { label: "03 · Answers", title: "Written for Google and for AI answers.", body: "Each section answers its question in the first line and stands on its own, the way Google and AI assistants quote pages. Every article ends with a short FAQ built from the questions your customers really ask, and one clear next step to your booking or signup page.",
    points: ["Direct answers, short sections", "A FAQ in your customers' own words", "One natural link to your next-step page"], panel: <AnswerPanel /> },
  { label: "04 · Health", title: "A weekly health check in plain English.", body: "Every week Pentra checks your important pages the way search engines and AI crawlers see them: can they reach the page, is it fast, does it have titles and structured data, and does it lead visitors to your next step.",
    points: ["Access, speed, AI answers and next-step checks", "Findings written in plain English", "Score and history on your dashboard"], panel: <HealthPanel /> },
  { label: "05 · Control", title: "You choose how much control you keep.", body: "Put Pentra on Autopilot and pick a pace, or choose Review first and approve every article. Switch any time. Your plan's monthly allowance always caps the total, so there are no surprise charges.",
    points: ["Autopilot or Review first, per website", "Pace from 1 to 21 articles a week", "Pause any time from your dashboard"], panel: <ControlPanel /> },
];

function FeatureRows() {
  return (
    <section className="border-t border-white/[0.06]">
      {ROWS.map((row, n) => (
        <div key={row.title} className={`${n > 0 ? "border-t border-white/[0.06]" : ""} py-20 md:py-28`}>
          <div className={`${WRAP} grid items-center gap-12 lg:grid-cols-2 lg:gap-20`}>
            <div className={n % 2 ? "lg:order-2" : ""}>
              <p className={EYEBROW}>{row.label}</p>
              <h2 className="mt-4 text-[clamp(1.75rem,3.4vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em] [text-wrap:balance]">{row.title}</h2>
              <p className="mt-5 max-w-[34rem] text-[16px] leading-relaxed text-[#8A8F98]">{row.body}</p>
              <ul className="mt-7 space-y-2.5">
                {row.points.map(point => (
                  <li key={point} className="flex items-center gap-3 text-[14.5px] text-[#D0D6E0]"><Check className="h-4 w-4 shrink-0 text-[#4CB782]" />{point}</li>
                ))}
              </ul>
            </div>
            <div className={n % 2 ? "lg:order-1" : ""}>{row.panel}</div>
          </div>
        </div>
      ))}
    </section>
  );
}

/* ─── Where it publishes ───────────────────────── */

const PLATFORMS = [
  { name: "WordPress", how: "Install the free Pentra plugin. Articles publish automatically and are confirmed live." },
  { name: "GitHub sites", how: "Next.js, Astro, Hugo, Jekyll, Gatsby and other Markdown or MDX sites. Pentra commits each article." },
  { name: "Any other platform", how: "Shopify, Webflow, Wix, Squarespace. Pentra writes, you paste, and Pentra checks the page is live." },
  { name: "Google Search Console", how: "Clicks and positions for every page, so you see what each article and improvement changed." },
];

function Platforms() {
  return (
    <section className="border-t border-white/[0.06] py-24 md:py-32">
      <div className={WRAP}>
        <p className={EYEBROW}>Works where your site lives</p>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
          {PLATFORMS.map(platform => (
            <div key={platform.name} className="bg-[#08090A] p-6 md:p-7">
              <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#F7F8F8]">{platform.name}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[#8A8F98]">{platform.how}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Honesty ──────────────────────────────────── */

const LIMITS = [
  "Publish a draft that failed its fact check. It is held back.",
  "Guarantee rankings or traffic. Search results take time and depend on many factors.",
  "Build backlinks or send outreach emails.",
  "Publish automatically to Shopify or Webflow yet (coming soon). On those sites Pentra writes and you paste each article in.",
];

function Honesty() {
  return (
    <section className="border-t border-white/[0.06] py-24 md:py-32">
      <div className={`${WRAP} grid gap-10 lg:grid-cols-[1fr_1.4fr]`}>
        <div>
          <p className={EYEBROW}>Straight answers</p>
          <h2 className="mt-4 text-[clamp(1.75rem,3.4vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em]">What Pentra does not do (yet)</h2>
        </div>
        <ul className="border-t border-white/[0.06]">
          {LIMITS.map(line => (
            <li key={line} className="flex gap-4 border-b border-white/[0.06] py-5 text-[15px] leading-relaxed text-[#8A8F98]">
              <Minus className="mt-1 h-4 w-4 shrink-0 text-[#62666D]" />{line}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ─── FAQ ──────────────────────────────────────── */

const faqs = [
  {
    q: "What does Pentra do after I add my website?",
    a: "It learns what you sell from the details you confirm, connects to your site and Search Console, and then researches, writes, fact-checks and publishes articles on your schedule. It also improves pages that already appear in Google search, and reports what changed and the clicks that followed.",
  },
  {
    q: "Which websites does Pentra work with?",
    a: "WordPress sites (with the free Pentra publisher plugin) and sites built from Markdown or MDX files in a GitHub repository, such as Next.js, Astro, Hugo, Jekyll and Gatsby. On Shopify, Webflow, Wix, Squarespace or any other platform, Pentra researches and writes each article, you paste it into your blog, and Pentra checks it is live (automatic publishing there is coming soon).",
  },
  {
    q: "Is Autopilot safe for my brand?",
    a: "Autopilot only publishes articles that pass the fact check. A draft that doesn't pass is held back, never published, and the schedule moves on. You can pause Pentra at any time, or choose Review first so nothing publishes without your approval.",
  },
  {
    q: "How many articles will Pentra publish?",
    a: "You choose a pace from 1 to 21 articles a week for each website. Your plan's monthly article allowance caps the total, so Pentra never publishes more than your plan includes.",
  },
  {
    q: "Will Pentra make things up about my business?",
    a: "No. Pentra writes from the business facts you confirm. It is instructed never to invent product features, statistics, testimonials or case studies, and a separate review blocks unsupported claims before anything is published.",
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
    <section id="faq" className="scroll-mt-20 border-t border-white/[0.06] py-24 md:py-32">
      <div className={`${WRAP} grid gap-10 lg:grid-cols-[1fr_1.4fr]`}>
        <div>
          <p className={EYEBROW}>Questions</p>
          <h2 className="mt-4 text-[clamp(1.75rem,3.4vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em]">Before you start</h2>
          <p className="mt-4 text-[15px] text-[#8A8F98]">Anything else? <Link href="/contact" className="text-[#D0D6E0] underline decoration-white/20 underline-offset-4 hover:text-white">Ask us</Link>.</p>
        </div>
        <div className="border-t border-white/[0.06]">
          {faqs.map(item => (
            <details key={item.q} className="group border-b border-white/[0.06] py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16px] font-medium text-[#F7F8F8] [&::-webkit-details-marker]:hidden">
                {item.q}
                <span aria-hidden className="text-[20px] font-light text-[#62666D] transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 max-w-[40rem] text-[15px] leading-relaxed text-[#8A8F98]">{item.a}</p>
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
    <section className="relative overflow-hidden border-t border-white/[0.06] py-28 md:py-40">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-80 bg-[radial-gradient(50%_70%_at_50%_100%,rgba(14,165,233,0.12),transparent_70%)]" />
      <div className={`${WRAP} relative`}>
        <h2 className="max-w-[16ch] text-[clamp(2.2rem,5vw,4rem)] font-semibold leading-[1.02] tracking-[-0.04em] [text-wrap:balance]">
          Add your website. Pentra handles the rest.
        </h2>
        <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-[#8A8F98]">Setup takes a few minutes. Your first article is free, and you can pause or switch to Review first any time.</p>
        <div className="mt-9 flex flex-wrap items-center gap-6">
          <PrimaryCta>Get started free</PrimaryCta>
          <a href="#pricing" className="text-[15px] font-medium text-[#D0D6E0] transition hover:text-white">See pricing <span aria-hidden>→</span></a>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer ───────────────────────────────────── */

function Footer() {
  const link = "text-[14px] text-[#8A8F98] transition hover:text-white";
  return (
    <footer className="border-t border-white/[0.06] py-14">
      <div className={`${WRAP} flex flex-col gap-10 md:flex-row md:items-start md:justify-between`}>
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0EA5E9]/15"><Radar className="h-4 w-4 text-[#0EA5E9]" /></span>
            <span className="text-[16px] font-semibold">Pentra</span>
          </div>
          <p className="max-w-[18rem] text-[13px] leading-relaxed text-[#62666D]">Autopilot SEO for your website. Planned, fact-checked, published and measured.</p>
        </div>
        <div className="grid grid-cols-2 gap-x-16 gap-y-3">
          <div className="flex flex-col gap-3">
            <span className="text-[12px] font-medium text-[#62666D]">Product</span>
            <a href="#features" className={link}>Features</a>
            <a href="#pricing" className={link}>Pricing</a>
            <a href="#faq" className={link}>FAQ</a>
            <Link href="/blog" className={link}>Blog</Link>
          </div>
          <div className="flex flex-col gap-3">
            <span className="text-[12px] font-medium text-[#62666D]">Company</span>
            <Link href="/contact" className={link}>Contact</Link>
            <Link href="/legal/privacy" className={link}>Privacy</Link>
            <Link href="/legal/terms" className={link}>Terms</Link>
          </div>
        </div>
      </div>
      <div className={`${WRAP} mt-12`}>
        <p className="text-[13px] text-[#62666D]">&copy; {new Date().getFullYear()} Pentra. All rights reserved.</p>
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
    "Articles written only from confirmed business facts",
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
    <main className="relative min-h-screen overflow-x-clip bg-[#08090A] text-[#F7F8F8]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <LandingNav />
      <Hero />
      <Proof />
      <Statement />
      <HowItWorks />
      <FeatureRows />
      <Platforms />
      <PricingSection />
      <Honesty />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  );
}
