"use client";

import { PricingTable, useAuth } from "@clerk/nextjs";

export function PricingTableSection() {
  const { isSignedIn } = useAuth();

  return (
    <div className="mt-16">
      <div className="mb-8 text-center">
        <h2 className="text-xl font-semibold text-[#EDEEF1]">
          {isSignedIn ? "Choose your plan" : "Sign up to get started"}
        </h2>
        <p className="mt-1 text-[13px] text-[#8B8FA3]">
          {isSignedIn
            ? "Select a plan below to subscribe or upgrade."
            : "Create a free account, then upgrade anytime from your dashboard."}
        </p>
      </div>
      {isSignedIn ? (
        <div className="mx-auto max-w-4xl [&_.cl-pricingTable-root]:bg-transparent">
          <PricingTable
            for="user"
            newSubscriptionRedirectUrl="/dashboard"
          />
        </div>
      ) : (
        <div className="text-center">
          <a
            href="/sign-up"
            className="inline-flex items-center gap-2 rounded-lg bg-[#0EA5E9] px-6 py-3 text-[14px] font-medium text-white transition hover:bg-[#38BDF8]"
          >
            Get started free
          </a>
        </div>
      )}
    </div>
  );
}
