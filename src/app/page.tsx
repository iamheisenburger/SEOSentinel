import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { Hero } from "@/components/marketing/hero";
import { ProblemCount } from "@/components/marketing/problem-count";
import { FirstHour } from "@/components/marketing/first-hour";
import { Proof } from "@/components/marketing/proof";
import { AfterHour } from "@/components/marketing/after-hour";
import { PublishTargets } from "@/components/marketing/publish-targets";
import { PricingPlan } from "@/components/marketing/pricing-plan";
import { Faq } from "@/components/marketing/faq";
import { LANDING_FAQ } from "@/components/marketing/faq-data";
import { FinalCta } from "@/components/marketing/final-cta";
import { Section, SectionHeading } from "@/components/marketing/section";
import { cachedPublishedListing } from "@/lib/published-listing";
import { servedOnItsOwnUrl } from "@/lib/pentra-consolidation";
import { PENTRA_PLAN } from "@/lib/pricing";
import { ASSISTANTS } from "@/lib/product-facts";

// The latest guides are linked from the homepage so search engines find new articles quickly.
export const revalidate = 3600;

// Declared so Google indexes https://pentra.dev/ rather than choosing the www host.
export const metadata: Metadata = { alternates: { canonical: "https://pentra.dev/" } };

/* Design (ops/design/pentra-redesign-research.md §7a): proof before features. The hero is a real AI answer built
 * in code; the order is the problem as one count, the free first hour, proof not scores, what the plan does next,
 * where it publishes, the one plan, questions, and the domain field again. */

const organizationSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Pentra",
  url: "https://pentra.dev",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Pentra asks AI assistants the questions your buyers ask, shows how often each one names your business against your competitors with every answer as proof, and writes and publishes the pages that answer those questions.",
  offers: {
    "@type": "Offer",
    name: PENTRA_PLAN.name,
    price: String(PENTRA_PLAN.monthly),
    priceCurrency: "USD",
    category: "subscription",
  },
  featureList: [
    `Answers from ${ASSISTANTS.map((assistant) => assistant.name).join(", ")}`,
    "Every count opens to the full recorded answers",
    "Who gets named instead of you, and the sources each assistant cites",
    "Answer pages written from your site's facts, with sources",
    "Publishing to WordPress, Webflow, Shopify, Ghost, GitHub, a signed webhook, or a hosted subdomain",
    "Tells search engines when each page goes live: IndexNow, and the sitemap to Google Search Console when connected",
    "Weekly email with what changed",
  ],
};

const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: LANDING_FAQ.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
};

/* ─── Latest guides (crawlable links to new articles) ───────────── */

async function LatestGuides() {
  let articles: { _id: string; title: string; slug: string; createdAt: number }[] = [];
  try {
    // The listing cache /blog and every article page share (P182): one Convex read per 6 hours, not one per page.
    articles = (await cachedPublishedListing("pentra.dev"))
      .filter(article => article.slug && servedOnItsOwnUrl("pentra.dev", article.slug)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  } catch { articles = []; }
  if (articles.length === 0) return null;
  return (
    <section aria-labelledby="guides-title" className="border-t border-border py-16 md:py-20">
      <div className="container-page">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 id="guides-title" className="type-h3 text-text">From the Pentra blog</h2>
          <Link href="/blog" className="inline-flex items-center gap-1.5 text-[14px] font-medium text-text-2 transition-colors hover:text-text">
            All guides
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Link>
        </div>
        <ul className="mt-8 grid grid-cols-1 gap-x-12 border-t border-border md:grid-cols-2">
          {articles.map(article => (
            <li key={article._id} className="border-b border-border">
              <Link href={`/blog/${article.slug}`} className="group flex items-baseline justify-between gap-6 py-4">
                <span className="text-[15px] leading-6 text-text-2 transition-colors group-hover:text-text">{article.title}</span>
                <span className="mono-label shrink-0 text-text-3">
                  {new Date(article.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function LandingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }} />
      <MarketingShell>
        <Hero />
        <ProblemCount />
        <FirstHour />
        <Proof />
        <AfterHour />
        <PublishTargets />
        <Section id="pricing" labelledBy="pricing-title">
          <SectionHeading
            id="pricing-title"
            align="center"
            title="One plan. Everything included."
            lead="Start with a free snapshot of how AI assistants describe your business."
          />
          <PricingPlan className="mt-12" />
          <p className="mt-8 text-center text-[14px] text-text-3">
            <Link href="/pricing" className="inline-flex items-center gap-1.5 font-medium text-text-2 transition-colors hover:text-text">
              Pricing details and billing questions
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.5} />
            </Link>
          </p>
        </Section>
        <Faq items={LANDING_FAQ} />
        <FinalCta />
        <LatestGuides />
      </MarketingShell>
    </>
  );
}
