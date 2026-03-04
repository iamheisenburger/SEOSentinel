import type { Metadata } from "next";
import Link from "next/link";
import { Radar, Mail, ArrowLeft } from "lucide-react";
import { LandingNav } from "@/components/layout/landing-nav";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the Pentra team.",
};

export default function ContactPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <LandingNav />

      <section className="relative pt-32 pb-24 md:pt-40 md:pb-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.03] blur-[120px]" />
        </div>

        <div className="relative mx-auto max-w-xl px-6">
          <Link
            href="/"
            className="mb-8 inline-flex items-center gap-2 text-[14px] font-medium text-[#8B8FA3] transition hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to home
          </Link>

          <div className="rounded-xl border border-white/[0.06] bg-[#0A0B10] p-8 md:p-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#0EA5E9]/[0.1] mb-6">
              <Mail className="h-6 w-6 text-[#0EA5E9]" />
            </div>

            <h1 className="text-2xl font-bold tracking-[-0.02em] md:text-3xl">
              Get in touch
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[#8B8FA3]">
              Have a question about Pentra, need help with your account, or want
              to discuss a custom plan? We&apos;d love to hear from you.
            </p>

            <div className="mt-8 space-y-6">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#565A6E] mb-2">
                  Email us
                </p>
                <a
                  href="mailto:pentrahelp@gmail.com"
                  className="inline-flex items-center gap-3 rounded-lg border border-white/[0.08] bg-[#0F1117] px-5 py-3.5 text-[16px] font-semibold text-[#0EA5E9] transition hover:border-[#0EA5E9]/30 hover:bg-[#0EA5E9]/[0.04]"
                >
                  <Mail className="h-5 w-5" />
                  pentrahelp@gmail.com
                </a>
              </div>

              <div>
                <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#565A6E] mb-2">
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
                      className="flex items-center gap-2.5 text-[14px] text-[#8B8FA3]"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-[#0EA5E9]/40 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[13px] text-[#565A6E]">
                We typically respond within 24 hours.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <Radar className="h-5 w-5 text-[#0EA5E9]" />
            <span className="text-[16px] font-bold text-[#8B8FA3]">
              Pentra
            </span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/legal/privacy" className="text-[14px] font-semibold text-[#565A6E] hover:text-[#8B8FA3] transition">
              Privacy
            </Link>
            <Link href="/legal/terms" className="text-[14px] font-semibold text-[#565A6E] hover:text-[#8B8FA3] transition">
              Terms
            </Link>
            <p className="text-[14px] text-[#565A6E]">
              &copy; {new Date().getFullYear()} Pentra
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
