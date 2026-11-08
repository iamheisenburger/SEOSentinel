"use client";

import { useState } from "react";
import type { BillingSubscriptionPlanPeriod } from "@clerk/nextjs/types";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { PentraPlanBlock } from "@/components/billing/pentra-plan-block";
import { PENTRA_PLAN, billingTerms, type BillingInterval } from "@/lib/pricing";
import { SUPPORT_EMAIL } from "@/lib/product-facts";

/**
 * The /upgrade screen as the dev-only harness renders it (no Clerk session there): the same header, plan summary and
 * plan block, with checkout replaced by a stand-in button. Never used in the app, which renders /upgrade itself.
 */
export function BillingPreview({ plan }: { plan: "free" | "pentra" }) {
  const { toast } = useToast();
  const [period, setPeriod] = useState<BillingSubscriptionPlanPeriod>("month");
  const interval: BillingInterval = period === "annual" ? "annual" : "monthly";
  const current = plan === "pentra";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Plans & billing" subtitle="One plan: Pentra publishes your answer pages and keeps tracking every answer. Cancel anytime." />
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-[14px] leading-[22px] text-text-2">
          {current ? (
            <>
              <p>You&apos;re on <span className="font-semibold text-text">{PENTRA_PLAN.name}</span>, billed monthly.</p>
              <p className="mt-1">Renews on December 6, 2026.</p>
            </>
          ) : (
            <p>You&apos;re on the <span className="font-semibold text-text">free plan</span>.</p>
          )}
        </div>
        {current && <Button variant="secondary" size="sm" className="shrink-0" onClick={() => toast("In the app this opens Clerk's subscription details.", "info")}>Manage subscription</Button>}
      </div>
      <PentraPlanBlock
        period={period}
        onPeriodChange={setPeriod}
        interval={interval}
        action={current && period === "month"
          ? <Button variant="secondary" size="lg" disabled className="w-full sm:w-auto">Current plan</Button>
          : <Button size="lg" className="w-full sm:w-auto" onClick={() => toast("In the app this opens Clerk's secure checkout.", "info")}>
              {current ? "Switch to annual billing" : `Upgrade to ${PENTRA_PLAN.name}`}
            </Button>}
        terms={current && period === "month" ? null : billingTerms(interval)}
      />
      <div className="mt-2 text-center text-[13px] leading-5 text-text-3">
        <p>Prices are in US dollars. No usage charges. If you cancel, your plan stays active until the end of the period you&apos;ve paid for.</p>
        <p className="mt-1">Questions about billing? <a href={`mailto:${SUPPORT_EMAIL}`} className="text-text-2 underline decoration-border-strong underline-offset-2 hover:text-text">Email us</a></p>
      </div>
    </div>
  );
}
