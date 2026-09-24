"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@clerk/nextjs";

const allFeatures = [
  "Autopilot or review-first publishing",
  "Written from your confirmed facts",
  "Independent fact-check review",
  "Improves pages near page one",
  "WordPress and GitHub publishing",
  "Search Console reporting",
  "Weekly site health check",
];

// Fixed plans billed through Clerk. Article allowance counts new drafts;
// edits and re-reviews of a draft never use another article.
const tiers = [
  {
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    desc: "See the quality on your own site, free.",
    sites: "1 site",
    articles: "1 article / month",
    cta: "Start free",
    plan: "free",
    featured: false,
  },
  {
    name: "Starter",
    monthlyPrice: 49,
    annualPrice: 39,
    desc: "Autopilot for one site: an article about every 3 days.",
    sites: "1 site",
    articles: "10 articles / month",
    cta: "Choose Starter",
    plan: "starter",
    featured: false,
  },
  {
    name: "Pro",
    monthlyPrice: 99,
    annualPrice: 79,
    desc: "Grow up to 3 sites, almost an article a day.",
    sites: "3 sites",
    articles: "25 articles / month",
    cta: "Choose Pro",
    plan: "pro",
    featured: true,
  },
  {
    name: "Scale",
    monthlyPrice: 199,
    annualPrice: 159,
    desc: "For agencies and content teams running many sites.",
    sites: "10 sites",
    articles: "60 articles / month",
    cta: "Choose Scale",
    plan: "scale",
    featured: false,
  },
];

export function PricingSection() {
  const [annual, setAnnual] = useState(false);
  const { isSignedIn } = useAuth();

  function getHref(plan: string) {
    const billing = annual ? "annual" : "monthly";
    if (isSignedIn) {
      return plan === "free" ? "/dashboard" : `/upgrade?plan=${plan}&billing=${billing}`;
    }
    return plan === "free" ? "/sign-up" : `/sign-up?plan=${plan}&billing=${billing}`;
  }

  return (
    <section id="pricing" className="relative scroll-mt-20 border-t border-white/[0.06] py-24 md:py-32">
      <div className="relative mx-auto max-w-[1200px] px-6">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-[#62666D]">Pricing</p>
            <h2 className="mt-4 text-[clamp(1.75rem,3.4vw,2.6rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
              One fixed price. No usage charges.
            </h2>
            <p className="mt-3 max-w-[32rem] text-[15px] text-[#8A8F98]">
              Pick how many new articles you want each month. Every plan includes everything Pentra does.
            </p>
          </div>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-1 self-start rounded-full border border-white/[0.08] p-1 md:self-auto">
            <button
              onClick={() => setAnnual(false)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition cursor-pointer ${
                !annual ? "bg-[#F7F8F8] text-[#08090A]" : "text-[#8A8F98] hover:text-white"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`flex items-center gap-2 rounded-full px-4 py-1.5 text-[13px] font-medium transition cursor-pointer ${
                annual ? "bg-[#F7F8F8] text-[#08090A]" : "text-[#8A8F98] hover:text-white"
              }`}
            >
              Annual
              <span className={`text-[11px] font-semibold ${annual ? "text-[#2F9E6A]" : "text-[#4CB782]"}`}>−20%</span>
            </button>
          </div>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.08] md:grid-cols-2 lg:grid-cols-4">
          {tiers.map((tier) => {
            const price = annual ? tier.annualPrice : tier.monthlyPrice;
            const href = getHref(tier.plan);

            return (
              <div key={tier.name} className={`relative flex flex-col p-6 ${tier.featured ? "bg-[#0D0F12]" : "bg-[#08090A]"}`}>
                {tier.featured && <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#0EA5E9] to-transparent" />}
                <div className="flex items-center justify-between">
                  <p className="text-[14px] font-medium text-[#F7F8F8]">{tier.name}</p>
                  {tier.featured && <span className="rounded-full bg-[#0EA5E9]/10 px-2 py-0.5 text-[11px] font-medium text-[#0EA5E9]">Most popular</span>}
                </div>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-[40px] font-semibold leading-none tracking-[-0.03em]">${price}</span>
                  <span className="text-[13px] text-[#62666D]">/ month</span>
                </div>
                <p className="mt-2 h-4 text-[12px] text-[#4CB782]">
                  {annual && tier.annualPrice > 0 ? `$${tier.annualPrice * 12} a year · save $${(tier.monthlyPrice - tier.annualPrice) * 12}` : ""}
                </p>
                <p className="mt-3 min-h-[2.75rem] text-[14px] leading-relaxed text-[#8A8F98]">{tier.desc}</p>

                <div className="mt-5 space-y-2 border-t border-white/[0.06] pt-5">
                  <div className="flex items-center gap-2.5 text-[14px] text-[#F7F8F8]"><CheckCircle2 className="h-4 w-4 shrink-0 text-[#4CB782]" />{tier.sites}</div>
                  <div className="flex items-center gap-2.5 text-[14px] text-[#F7F8F8]"><CheckCircle2 className="h-4 w-4 shrink-0 text-[#4CB782]" />{tier.articles}</div>
                </div>

                <Link
                  href={href}
                  className={`mt-6 block rounded-full py-2.5 text-center text-[14px] font-medium transition ${
                    tier.featured
                      ? "bg-[#F7F8F8] text-[#08090A] hover:bg-white"
                      : "border border-white/[0.1] text-[#D0D6E0] hover:border-white/[0.2] hover:text-white"
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            );
          })}
        </div>

        {/* Everything included */}
        <div className="mt-10 grid gap-8 md:grid-cols-[1fr_2fr]">
          <p className="text-[14px] font-medium text-[#F7F8F8]">Included on every plan</p>
          <ul className="grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {allFeatures.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-[14px] text-[#8A8F98]"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#62666D]" />{f}</li>
            ))}
          </ul>
        </div>
        <p className="mt-10 text-[13px] text-[#62666D]">
          Need more websites or articles?{" "}
          <a href="mailto:pentrahelp@gmail.com" className="text-[#D0D6E0] underline decoration-white/20 underline-offset-4 hover:text-white">Get in touch</a>
          {" "}for a custom plan.
        </p>
      </div>
    </section>
  );
}
