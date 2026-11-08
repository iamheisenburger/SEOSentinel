import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { PricingPlan } from "@/components/marketing/pricing-plan";
import { Faq } from "@/components/marketing/faq";
import { FinalCta } from "@/components/marketing/final-cta";
import { Section, SectionHeading } from "@/components/marketing/section";
import { Reveal } from "@/components/ui/reveal";
import { StatusPill } from "@/components/ui/status-pill";
import { pageSocial } from "@/lib/page-social";
import { ANNUAL_MONTHS_FREE, PENTRA_PLAN, formatUsd } from "@/lib/pricing";
import { HONESTY_LINE, SNAPSHOT, SUPPORT_EMAIL } from "@/lib/product-facts";

const DESCRIPTION = `One plan: ${formatUsd(PENTRA_PLAN.monthly)} a month or ${formatUsd(PENTRA_PLAN.annual)} a year. Start with a free snapshot of how ChatGPT, Perplexity, Gemini and Google's AI describe your business.`;

export const metadata: Metadata = {
  title: "Pricing",
  description: DESCRIPTION,
  alternates: { canonical: "https://pentra.dev/pricing" },
  ...pageSocial("Pentra pricing: one plan, everything included", DESCRIPTION, "https://pentra.dev/pricing"),
};

const SNAPSHOT_ITEMS: { prefix: string | null; value: string | null; label: string }[] = [
  { prefix: "about", value: String(SNAPSHOT.questions), label: "questions your buyers ask AI assistants" },
  { prefix: null, value: String(SNAPSHOT.assistants), label: "assistants asked every question" },
  { prefix: "about", value: String(SNAPSHOT.answers), label: "answers, each stored in full" },
  { prefix: null, value: null, label: "what they get wrong about you, with the source each assistant used" },
  { prefix: null, value: String(SNAPSHOT.draftPages), label: "draft answer pages for questions you can win" },
];

const WONT = [
  { title: "No visibility score", body: "Counts only, and every count opens to the answers behind it." },
  { title: "No guarantees", body: "No one can promise an assistant will recommend you, so we don't." },
  { title: "No rounding away", body: "Answers vary between runs, so every count shows both numbers, like 23 of 150." },
];

const BILLING_FAQ = [
  {
    id: "how",
    question: "How does billing work?",
    answer: `One plan at ${formatUsd(PENTRA_PLAN.monthly)} a month, or ${formatUsd(PENTRA_PLAN.annual)} a year (${ANNUAL_MONTHS_FREE} months free), charged to your card through Stripe. Prices are in US dollars, and there are no usage charges.`,
  },
  {
    id: "switch",
    question: "Can I switch between monthly and annual?",
    answer: "Yes, from Billing in your dashboard. Checkout shows exactly what you'll be charged, and when, before you confirm.",
  },
  {
    id: "cancel-timing",
    question: "When does cancelling take effect?",
    answer: "At the end of the period you've paid for. Until then Pentra keeps working, and the pages it published stay yours afterwards.",
  },
  {
    id: "annual",
    question: "What happens if I cancel an annual plan?",
    answer: `It doesn't renew, and it stays active until the end of the year you paid for. For anything else about a charge, email ${SUPPORT_EMAIL}.`,
  },
  {
    id: "domain",
    question: "Can I move Pentra to a different domain?",
    answer: `Email ${SUPPORT_EMAIL} with the new domain and we'll sort it out.`,
  },
  {
    id: "free",
    question: "Is the snapshot really free?",
    answer: `Yes, and it needs no card: about ${SNAPSHOT.questions} questions, ${SNAPSHOT.assistants} assistants, about ${SNAPSHOT.answers} answers and ${SNAPSHOT.draftPages} draft pages. You only pay if you want Pentra to publish the pages and keep tracking.`,
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <section aria-labelledby="pricing-title" className="pb-24 pt-[124px] sm:pt-[140px] lg:pb-32 lg:pt-[164px]">
        <div className="container-page">
          <div className="mx-auto max-w-[720px] text-center">
            <h1 id="pricing-title" className="type-h1 text-text">
              One plan. Everything included.
            </h1>
            <p className="type-lead mx-auto mt-5 max-w-[540px] [text-wrap:balance]">
              Start with a free snapshot of how AI assistants describe your business.
            </p>
          </div>
          <PricingPlan className="mt-12" />
        </div>
      </section>

      <Section labelledBy="snapshot-title">
        <SectionHeading id="snapshot-title" title="What the free snapshot includes" lead="Enter your domain and in about an hour you have:" />
        <Reveal as="ul" className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-5">
          {SNAPSHOT_ITEMS.map((item) => (
            <li key={item.label} data-reveal className="flex flex-col bg-bg p-6">
              <span className="h-5 text-[13px] leading-5 text-text-3">{item.prefix}</span>
              {item.value ? (
                <span className="type-number text-text">{item.value}</span>
              ) : (
                <span className="flex h-11 items-center">
                  <StatusPill kind="wrong">Wrong fact</StatusPill>
                </span>
              )}
              <span className="mt-3 text-[14px] leading-[22px] text-text-2 [text-wrap:pretty]">{item.label}</span>
            </li>
          ))}
          <li aria-hidden="true" className="hidden bg-bg sm:block lg:hidden" />
        </Reveal>
      </Section>

      <Section labelledBy="claims-title">
        <Reveal className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:gap-16">
          <h2 id="claims-title" data-reveal className="type-h2 text-text">
            What we won&apos;t claim
          </h2>
          <div>
            <p data-reveal className="type-h3 text-text [text-wrap:pretty]">
              {HONESTY_LINE}
            </p>
            <ul className="mt-10 grid grid-cols-1 gap-8 border-t border-border pt-8 sm:grid-cols-3 sm:gap-6">
              {WONT.map((item) => (
                <li key={item.title} data-reveal>
                  <h3 className="text-[15px] font-semibold leading-6 text-text">{item.title}</h3>
                  <p className="mt-1.5 text-[14px] leading-[22px] text-text-2 [text-wrap:pretty]">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </Section>

      <Faq id="billing" title="Billing questions" items={BILLING_FAQ} />
      <FinalCta />
    </MarketingShell>
  );
}
