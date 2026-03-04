"use client";

import { PricingTable } from "@clerk/nextjs";

export function PricingTableSection() {
  return (
    <div className="mt-16">
      <div className="mb-8 text-center">
        <h2 className="text-xl font-semibold text-[#EDEEF1]">
          Subscribe
        </h2>
        <p className="mt-1 text-[13px] text-[#8B8FA3]">
          Pick a plan and start generating articles today.
        </p>
      </div>
      <div className="mx-auto max-w-4xl">
        <PricingTable
          for="user"
          newSubscriptionRedirectUrl="/dashboard"
        />
      </div>
    </div>
  );
}
