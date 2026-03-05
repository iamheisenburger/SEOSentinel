"use client";

import { PageHeader } from "@/components/layout/page-header";
import { PricingTable } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  scale: "Scale",
  enterprise: "Enterprise",
};

const PLAN_PRICES: Record<string, { monthly: number; annual: number }> = {
  starter: { monthly: 49, annual: 39 },
  pro: { monthly: 99, annual: 79 },
  scale: { monthly: 199, annual: 159 },
  enterprise: { monthly: 499, annual: 399 },
};

function UpgradeContent() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan");
  const billing = searchParams.get("billing") ?? "monthly";
  const label = plan ? PLAN_LABELS[plan] : null;
  const prices = plan ? PLAN_PRICES[plan] : null;
  const price = prices ? (billing === "annual" ? prices.annual : prices.monthly) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Upgrade Plan"
        subtitle={label
          ? `Complete checkout for the ${label} plan`
          : "Choose a plan to unlock more articles and sites"
        }
      />

      {label && price && (
        <div className="flex items-center gap-3 rounded-xl border border-[#0EA5E9]/[0.15] bg-[#0EA5E9]/[0.04] px-5 py-4">
          <div className="flex-1">
            <p className="text-[14px] font-semibold text-[#EDEEF1]">
              {label} Plan — ${price}/mo
              {billing === "annual" && prices && (
                <span className="ml-2 text-[11px] font-medium text-[#22C55E]">
                  billed annually (save ${(prices.monthly - prices.annual) * 12}/yr)
                </span>
              )}
            </p>
            <p className="mt-0.5 text-[12px] text-[#8B8FA3]">
              Select the {label} plan below to complete your subscription.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden p-6">
        <PricingTable
          for="user"
          newSubscriptionRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}

export default function UpgradePage() {
  return (
    <Suspense>
      <UpgradeContent />
    </Suspense>
  );
}
