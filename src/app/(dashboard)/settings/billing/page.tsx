"use client";

import { PageHeader } from "@/components/layout/page-header";
import { PricingTable } from "@clerk/nextjs";

export default function BillingPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Manage Subscription"
        subtitle="Upgrade, downgrade, or manage your billing"
      />

      <div className="rounded-xl border border-white/[0.06] bg-[#0F1117] overflow-hidden p-6">
        <PricingTable
          for="user"
          newSubscriptionRedirectUrl="/settings"
        />
      </div>
    </div>
  );
}
