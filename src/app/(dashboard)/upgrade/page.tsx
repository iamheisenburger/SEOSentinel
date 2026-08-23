"use client";

import { PageHeader } from "@/components/layout/page-header";
import { PricingTable } from "@clerk/nextjs";

export default function UpgradePage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Upgrade Plan"
        subtitle="Choose your plan and billing period in the secure table below"
      />

      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden p-6">
        <PricingTable
          for="user"
          newSubscriptionRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}
