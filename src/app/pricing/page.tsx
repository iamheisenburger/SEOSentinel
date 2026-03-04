import type { Metadata } from "next";
import Link from "next/link";
import { Radar, CheckCircle2, ArrowRight } from "lucide-react";
import { LandingNav } from "@/components/layout/landing-nav";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, transparent pricing for Pentra. Start free, scale when you rank.",
};

const tiers = [
  {
    name: "Free",
    price: "$0",
    period: "/mo",
    desc: "Try it out with 3 articles a month on 1 site.",
    features: [
      "1 site",
      "3 articles / month",
      "Full AI pipeline",
      "Fact-checking",
      "Manual publishing",
    ],
    cta: "Get started free",
    featured: false,
  },
  {
    name: "Starter",
    price: "$49",
    period: "/mo",
    desc: "For new sites getting started with content.",
    features: [
      "1 site",
      "10 articles / month",
      "All publish methods",
      "Autopilot mode",
      "Internal linking",
    ],
    cta: "Start free trial",
    featured: false,
  },
  {
    name: "Pro",
    price: "$99",
    period: "/mo",
    desc: "For growing sites that need more content.",
    features: [
      "3 sites",
      "25 articles / month",
      "Everything in Starter",
      "Approval workflow",
      "Priority support",
    ],
    cta: "Start free trial",
    featured: true,
  },
  {
    name: "Scale",
    price: "$199",
    period: "/mo",
    desc: "For content teams and agencies.",
    features: [
      "10 sites",
      "60 articles / month",
      "Everything in Pro",
      "API access",
      "Priority queue",
    ],
    cta: "Start free trial",
    featured: false,
  },
  {
    name: "Enterprise",
    price: "$499",
    period: "/mo",
    desc: "Unlimited scale for large operations.",
    features: [
      "Unlimited sites",
      "150 articles / month",
      "Everything in Scale",
      "White-label option",
      "Dedicated support",
    ],
    cta: "Contact us",
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <LandingNav />

      <section className="relative pt-28 pb-24 md:pt-36 md:pb-32">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.03] blur-[120px]" />
        </div>

        <div className="relative mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <h1 className="text-3xl font-bold tracking-[-0.03em] md:text-4xl">
              Simple, transparent pricing
            </h1>
            <p className="mt-3 text-[15px] text-[#8B8FA3]">
              All features included on every plan. Just pick your volume.
            </p>
          </div>

          <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-5">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative rounded-xl overflow-hidden ${
                  tier.featured
                    ? "border border-[#0EA5E9]/20 bg-[#0EA5E9]/[0.02]"
                    : "border border-white/[0.06] bg-[#0A0B10]"
                }`}
              >
                {tier.featured && (
                  <div className="bg-[#0EA5E9] py-1.5 text-center text-[11px] font-semibold text-white tracking-wide">
                    MOST POPULAR
                  </div>
                )}
                <div className="p-6">
                  <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-[#565A6E]">
                    {tier.name}
                  </p>
                  <div className="mt-2 flex items-baseline gap-0.5">
                    <span className="text-3xl font-bold tracking-tight">
                      {tier.price}
                    </span>
                    <span className="text-[13px] text-[#565A6E]">
                      {tier.period}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] text-[#8B8FA3]">
                    {tier.desc}
                  </p>

                  <Link
                    href="/sign-up"
                    className={`mt-5 block rounded-lg py-2.5 text-center text-[13px] font-medium transition ${
                      tier.featured
                        ? "bg-[#0EA5E9] text-white hover:bg-[#38BDF8]"
                        : "border border-white/[0.08] text-[#8B8FA3] hover:border-white/[0.15] hover:text-white"
                    }`}
                  >
                    {tier.cta}
                  </Link>

                  <ul className="mt-5 space-y-2">
                    {tier.features.map((f) => (
                      <li
                        key={f}
                        className="flex items-center gap-2 text-[13px] text-[#8B8FA3]"
                      >
                        <CheckCircle2
                          className={`h-3 w-3 shrink-0 ${
                            tier.featured ? "text-[#0EA5E9]" : "text-[#565A6E]"
                          }`}
                        />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>

          {/* FAQ / Bottom note */}
          <div className="mt-16 text-center">
            <p className="text-[14px] text-[#8B8FA3]">
              All plans include the full AI pipeline: web research,
              fact-checking, hero images, internal linking, and multi-platform
              publishing.
            </p>
            <p className="mt-2 text-[13px] text-[#565A6E]">
              Need a custom plan?{" "}
              <a
                href="mailto:hello@pentra.dev"
                className="text-[#0EA5E9] hover:underline"
              >
                Get in touch
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2">
            <Radar className="h-3.5 w-3.5 text-[#0EA5E9]" />
            <span className="text-[12px] font-medium text-[#565A6E]">
              Pentra
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/legal/privacy" className="text-[11px] text-[#565A6E] hover:text-[#8B8FA3]">
              Privacy
            </Link>
            <Link href="/legal/terms" className="text-[11px] text-[#565A6E] hover:text-[#8B8FA3]">
              Terms
            </Link>
            <p className="text-[11px] text-[#565A6E]">
              &copy; {new Date().getFullYear()} Pentra
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
