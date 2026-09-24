import type { Metadata } from "next";
import Link from "next/link";
import { Radar, Mail, ArrowLeft } from "lucide-react";
import { LandingNav } from "@/components/layout/landing-nav";

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about Pentra, your plan or your website? Email the Pentra team at pentrahelp@gmail.com and we'll help.",
};

const contactSchema = {
  "@context": "https://schema.org", "@type": "ContactPage", name: "Contact Pentra", url: "https://pentra.dev/contact",
  mainEntity: { "@type": "Organization", name: "Pentra", url: "https://pentra.dev",
    contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: "pentrahelp@gmail.com", availableLanguage: "English" } },
};

const HELP_ANSWERS = [
  ["What should I include in my email?", "Your website address and, if something looks wrong, the page or article it's about. That lets us check your account straight away."],
  ["Can I change my plan or cancel?", "You can change your plan from Plans & billing in your dashboard. To cancel, or if anything about a charge is unclear, email us and we'll sort it out."],
  ["Do you offer plans for agencies or several websites?", "Pro covers 3 websites and Scale covers 10. If you need more, tell us how many sites and articles a month and we'll set up a custom plan."],
] as const;

export default function ContactPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(contactSchema) }} />
      <LandingNav />

      <section className="relative pt-32 pb-24 md:pt-40 md:pb-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.03] blur-[120px]" />
        </div>

        <div className="relative mx-auto max-w-xl px-6">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 text-[14px] font-medium text-[#8A8F98] transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>

          <div className="rounded-xl border border-white/[0.06] bg-[#0B0C0E] p-8 md:p-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.1] mb-6">
              <Mail className="h-6 w-6 text-[#0EA5E9]" />
            </div>

            <h1 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
              Get in touch
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[#8A8F98]">
              Have a question about Pentra, need help with your account, or want
              to discuss a custom plan? We&apos;d love to hear from you.
            </p>

            <div className="mt-8 space-y-6">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#62666D] mb-2">
                  Email us
                </p>
                <a
                  href="mailto:pentrahelp@gmail.com"
                  className="inline-flex items-center gap-3 rounded-lg border border-white/[0.08] bg-[#0E0F11] px-5 py-3.5 text-[16px] font-semibold text-[#0EA5E9] transition hover:border-[#0EA5E9]/30 hover:bg-[#0EA5E9]/[0.04]"
                >
                  <Mail className="h-5 w-5" />
                  pentrahelp@gmail.com
                </a>
              </div>

              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#62666D] mb-2">
                  What we can help with
                </p>
                <ul className="space-y-2">
                  {[
                    "Account setup and onboarding",
                    "Billing and subscription questions",
                    "Custom enterprise plans",
                    "Technical support and bug reports",
                    "Feature requests and feedback",
                  ].map((item) => (
                    <li
                      key={item}
                      className="flex items-center gap-2.5 text-[14px] text-[#8A8F98]"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-[#0EA5E9]/40 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[13px] text-[#62666D]">
                We typically respond within 24 hours.
              </p>

              <div className="space-y-4 border-t border-white/[0.06] pt-6">
                <h2 className="text-[15px] font-semibold text-[#F7F8F8]">Before you email</h2>
                {HELP_ANSWERS.map(([question, answer]) => (
                  <div key={question}>
                    <h3 className="text-[14px] font-medium text-[#F7F8F8]">{question}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-[#8A8F98]">{answer}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Radar className="h-5 w-5 text-[#0EA5E9]" />
            <span className="text-[16px] font-bold text-[#8A8F98]">
              Pentra
            </span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/legal/privacy" className="text-[14px] font-semibold text-[#62666D] hover:text-[#8A8F98] transition">
              Privacy
            </Link>
            <Link href="/legal/terms" className="text-[14px] font-semibold text-[#62666D] hover:text-[#8A8F98] transition">
              Terms
            </Link>
            <p className="text-[14px] text-[#62666D]">
              &copy; {new Date().getFullYear()} Pentra
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
