"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@clerk/nextjs";

const tiers = [
  {
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    desc: "Try it out with 3 articles a month on 1 site.",
    features: [
      "1 site",
      "3 articles / month",
      "Full AI pipeline",
      "Fact-checking",
      "Manual publishing",
    ],
    cta: "Get started free",
    plan: "free",
    featured: false,
  },
  {
    name: "Starter",
    monthlyPrice: 49,
    annualPrice: 39,
    desc: "For new sites getting started with content.",
    features: [
      "1 site",
      "10 articles / month",
      "All publish methods",
      "Autopilot mode",
      "Internal linking",
    ],
    cta: "Get started",
    plan: "starter",
    featured: false,
  },
  {
    name: "Pro",
    monthlyPrice: 99,
    annualPrice: 79,
    desc: "For growing sites that need more content.",
    features: [
      "3 sites",
      "25 articles / month",
      "Everything in Starter",
      "Approval workflow",
      "Priority support",
    ],
    cta: "Get started",
    plan: "pro",
    featured: true,
  },
  {
    name: "Scale",
    monthlyPrice: 199,
    annualPrice: 159,
    desc: "For content teams and agencies.",
    features: [
      "10 sites",
      "60 articles / month",
      "Everything in Pro",
      "API access",
      "Priority queue",
    ],
    cta: "Get started",
    plan: "scale",
    featured: false,
  },
  {
    name: "Enterprise",
    monthlyPrice: 499,
    annualPrice: 399,
    desc: "Unlimited scale for large operations.",
    features: [
      "Unlimited sites",
      "150 articles / month",
      "Everything in Scale",
      "White-label option",
      "Dedicated support",
    ],
    cta: "Get started",
    plan: "enterprise",
    featured: false,
  },
];

export function PricingSection() {
  const [annual, setAnnual] = useState(false);
  const { isSignedIn } = useAuth();

  function getHref(plan: string) {
    if (isSignedIn) {
      return plan === "free" ? "/dashboard" : "/settings/billing";
    }
    return plan === "free" ? "/sign-up" : `/sign-up?plan=${plan}`;
  }

  return (
    <section id="pricing" className="relative py-24 md:py-32 scroll-mt-20">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/2 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-[#0EA5E9]/[0.03] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold tracking-[-0.03em] md:text-4xl">
            Simple, transparent pricing
          </h2>
          <p className="mt-3 text-[15px] text-[#8B8FA3]">
            All features included on every plan. Just pick your volume.
          </p>

          {/* Billing toggle */}
          <div className="mt-8 inline-flex items-center gap-3 rounded-full border border-white/[0.06] bg-[#0A0B10] p-1">
            <button
              onClick={() => setAnnual(false)}
              className={`rounded-full px-5 py-2 text-[13px] font-medium transition cursor-pointer ${
                !annual
                  ? "bg-[#0EA5E9] text-white"
                  : "text-[#8B8FA3] hover:text-white"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`rounded-full px-5 py-2 text-[13px] font-medium transition cursor-pointer flex items-center gap-2 ${
                annual
                  ? "bg-[#0EA5E9] text-white"
                  : "text-[#8B8FA3] hover:text-white"
              }`}
            >
              Annual
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                annual
                  ? "bg-white/20 text-white"
                  : "bg-[#22C55E]/10 text-[#22C55E]"
              }`}>
                Save 20%
              </span>
            </button>
          </div>
        </div>

        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-5">
          {tiers.map((tier) => {
            const price = annual ? tier.annualPrice : tier.monthlyPrice;
            const href = getHref(tier.plan);

            return (
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
                      ${price}
                    </span>
                    <span className="text-[13px] text-[#565A6E]">/mo</span>
                  </div>
                  {annual && tier.annualPrice > 0 && (
                    <p className="mt-0.5 text-[11px] text-[#22C55E]">
                      ${tier.annualPrice * 12}/yr · Save ${(tier.monthlyPrice - tier.annualPrice) * 12}/yr
                    </p>
                  )}
                  <p className="mt-1 text-[13px] text-[#8B8FA3]">
                    {tier.desc}
                  </p>

                  <Link
                    href={href}
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
            );
          })}
        </div>

        {/* Bottom note */}
        <div className="mt-12 text-center">
          <p className="text-[14px] text-[#8B8FA3]">
            All plans include the full AI pipeline: web research,
            fact-checking, hero images, internal linking, and multi-platform
            publishing.
          </p>
          <p className="mt-2 text-[13px] text-[#565A6E]">
            Need a custom plan?{" "}
            <a
              href="mailto:pentrahelp@gmail.com"
              className="text-[#0EA5E9] hover:underline"
            >
              Get in touch
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
