import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { SUPPORT_EMAIL } from "@/lib/product-facts";

export const metadata: Metadata = {
  title: "Contact",
  description: `Questions about Pentra, your snapshot or your plan? Email the Pentra team at ${SUPPORT_EMAIL} and we'll help.`,
  alternates: { canonical: "https://pentra.dev/contact" },
};

const contactSchema = {
  "@context": "https://schema.org", "@type": "ContactPage", name: "Contact Pentra", url: "https://pentra.dev/contact",
  mainEntity: { "@type": "Organization", name: "Pentra", url: "https://pentra.dev",
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: SUPPORT_EMAIL, availableLanguage: "English" } },
};

const HELP_ANSWERS = [
  ["What should I include in my email?", "Your website address and, if something looks wrong, the page, answer or count it's about. That lets us check your account straight away."],
  ["Can I change my plan or cancel?", "Yes, from Billing in your dashboard. If anything about a charge is unclear, email us and we'll sort it out."],
  ["Do you work with agencies or several businesses?", "Pentra has one plan. If you run several businesses or manage them for clients, tell us how many and we'll talk it through."],
] as const;

export default function ContactPage() {
  return (
    <MarketingShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(contactSchema) }} />
      <section aria-labelledby="contact-title" className="pb-24 pt-[124px] sm:pt-[140px] lg:pb-32 lg:pt-[164px]">
        <div className="container-page">
          <div className="grid grid-cols-1 gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-20">
            <div>
              <h1 id="contact-title" className="type-h1 text-text">Contact</h1>
              <p className="type-lead mt-5 max-w-[460px]">
                Questions about your snapshot, your plan or something you saw in Pentra? Email us.
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="lift mt-10 inline-flex max-w-full items-center gap-3 rounded-card border border-border bg-surface-1 px-5 py-4"
              >
                <Mail aria-hidden="true" className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.5} />
                <span className="truncate text-[17px] font-medium text-text">{SUPPORT_EMAIL}</span>
              </a>
              <p className="mt-4 text-[14px] leading-[22px] text-text-3">We typically respond within 24 hours.</p>
            </div>

            <div>
              <h2 className="type-h3 text-text">Before you email</h2>
              <dl className="mt-6 border-t border-border">
                {HELP_ANSWERS.map(([question, answer]) => (
                  <div key={question} className="border-b border-border py-5">
                    <dt className="text-[15px] font-semibold leading-6 text-text">{question}</dt>
                    <dd className="mt-1.5 text-[15px] leading-6 text-text-2 [text-wrap:pretty]">{answer}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-6 text-[14px] leading-[22px] text-text-3">
                How the numbers are collected is on{" "}
                <Link href="/method" className="link">
                  How we measure
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
