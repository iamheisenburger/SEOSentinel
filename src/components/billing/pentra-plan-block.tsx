"use client";

import type { ReactNode } from "react";
import type { BillingSubscriptionPlanPeriod } from "@clerk/nextjs/types";
import { SegmentedToggle } from "@/components/ui/segmented-toggle";
import { PlanIncludes, PlanPrice } from "@/components/marketing/pricing-plan";
import { ANNUAL_MONTHS_FREE, PENTRA_PLAN, type BillingInterval } from "@/lib/pricing";

/**
 * The one plan, as /upgrade and the dashboard's Billing show it: the period toggle, the price, one action and the
 * terms stated before any charge, then everything the plan includes. The caller owns checkout (Clerk) and passes the
 * action; this block never prices anything itself (src/lib/pricing.ts does).
 */
export function PentraPlanBlock({
  period,
  onPeriodChange,
  interval,
  annualUnavailable = false,
  action,
  terms,
  note,
}: {
  period: BillingSubscriptionPlanPeriod;
  onPeriodChange: (period: BillingSubscriptionPlanPeriod) => void;
  /** What checkout will bill (monthly when annual isn't offered yet). */
  interval: BillingInterval;
  annualUnavailable?: boolean;
  action: ReactNode;
  terms?: string | null;
  note?: ReactNode;
}) {
  return (
    <div className="mx-auto mt-4 w-full max-w-[640px]">
      <div className="flex justify-center">
        <SegmentedToggle
          label="Billing period"
          value={period === "annual" ? "annual" : "month"}
          onChange={(value) => onPeriodChange(value)}
          options={[
            { value: "month", label: "Monthly" },
            { value: "annual", label: "Annual", tag: `${ANNUAL_MONTHS_FREE} months free` },
          ]}
        />
      </div>

      <div className="mt-8 rounded-hero border border-border bg-surface-1 p-6 sm:p-8">
        <h2 className="text-[16px] font-semibold leading-[22px] text-text">{PENTRA_PLAN.name}</h2>
        <p className="mt-1 text-[14px] leading-[22px] text-text-3">Everything Pentra does, after the free snapshot.</p>
        <div className="mt-6">
          <PlanPrice interval={interval} />
        </div>
        {period === "annual" && annualUnavailable && (
          <p className="mt-3 text-[13px] leading-5 text-text-3">Annual billing isn&apos;t available yet, so checkout bills monthly.</p>
        )}
        <div className="mt-8 flex flex-col gap-3">
          <div>{action}</div>
          {terms && <p className="text-[13px] leading-5 text-text-3">{terms}</p>}
          {note}
        </div>
        <PlanIncludes className="mt-8 border-t border-border pt-7" />
      </div>
    </div>
  );
}

/** Said under the plan when Clerk has no checkout for it yet (or it couldn't be read): never another plan list. */
export function CheckoutSoonNote({ email }: { email: string }) {
  return (
    <p role="status" className="text-[14px] leading-[22px] text-text-2">
      Checkout opens shortly. Email{" "}
      <a href={`mailto:${email}?subject=${encodeURIComponent("Start Pentra")}`} className="text-text underline decoration-border-strong underline-offset-2 hover:decoration-text-3">
        {email}
      </a>{" "}
      to start now.
    </p>
  );
}
