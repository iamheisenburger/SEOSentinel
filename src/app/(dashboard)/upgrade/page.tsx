"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  CheckoutButton,
  SubscriptionDetailsButton,
  usePlans,
  useSubscription,
} from "@clerk/nextjs/experimental";
import type {
  BillingPlanResource,
  BillingSubscriptionItemResource,
  BillingSubscriptionPlanPeriod,
} from "@clerk/nextjs/types";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckoutSoonNote, PentraPlanBlock } from "@/components/billing/pentra-plan-block";
import { usePlanLimits } from "@/hooks/usePlanLimits";
import {
  PENTRA_PLAN,
  billingTerms,
  isPentraPlan,
  planDisplayName,
  type BillingInterval,
} from "@/lib/pricing";
import { SUPPORT_EMAIL } from "@/lib/product-facts";

// One plan, defined in src/lib/pricing.ts and matched to its Clerk plan by slug or name ("pentra").
// Checkout starts only from the explicit plan button below (Clerk's CheckoutButton). If Clerk has no "pentra" plan yet
// (or it can't be read), the same plan block shows with a calm note and an email address, never Clerk's own table,
// which would list the old tiers (coordinator, Nov 7 2026).

/** After checkout: the dashboard says the plan is active and that the free hour's drafts publish within the hour. */
const AFTER_CHECKOUT = "/dashboard?upgraded=1";

function formatDate(value: Date | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function periodLabel(period: BillingSubscriptionPlanPeriod) {
  return period === "annual" ? "billed yearly" : "billed monthly";
}

type CurrentPlan =
  | { kind: "unknown" }
  | { kind: "free" }
  | { kind: "pentra"; item: BillingSubscriptionItemResource }
  /** A plan bought before the single plan (or set up by hand in billing): kept as it is until they switch. */
  | { kind: "legacy"; item: BillingSubscriptionItemResource };

function resolveCurrentPlan(items: BillingSubscriptionItemResource[] | undefined): CurrentPlan {
  if (!items) return { kind: "free" };
  const active = items
    .filter((item) => item.status === "active" || item.status === "past_due")
    .sort((a, b) => Number(b.plan.hasBaseFee) - Number(a.plan.hasBaseFee));
  const item = active[0];
  if (!item) return { kind: "free" };
  if (isPentraPlan(item.plan)) return { kind: "pentra", item };
  if (!item.plan.hasBaseFee) return { kind: "free" };
  return { kind: "legacy", item };
}

function PlansSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading plans">
      <Skeleton className="h-16 w-full" />
      <div className="mx-auto w-full max-w-[640px] rounded-hero border border-border bg-surface-1 p-8">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-6 h-14 w-48" />
        <Skeleton className="mt-3 h-3 w-64" />
        <Skeleton className="mt-8 h-11 w-56" />
        <div className="mt-8 grid gap-3 border-t border-border pt-7 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** No checkout to open yet: the plan as it will be sold, and a person to email meanwhile. */
function PlanWithoutCheckout({ period, onPeriodChange }: { period: BillingSubscriptionPlanPeriod; onPeriodChange: (period: BillingSubscriptionPlanPeriod) => void }) {
  const interval: BillingInterval = period === "annual" ? "annual" : "monthly";
  return (
    <PentraPlanBlock
      period={period}
      onPeriodChange={onPeriodChange}
      interval={interval}
      action={null}
      note={<CheckoutSoonNote email={SUPPORT_EMAIL} />}
    />
  );
}

export default function UpgradePage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [period, setPeriod] = useState<BillingSubscriptionPlanPeriod>("month");
  const plans = usePlans({ for: "user", pageSize: 50 });
  const subscription = useSubscription({ for: "user" });
  // Accounts Pentra put on a custom plan directly are not Clerk subscriptions.
  const entitlement = usePlanLimits();

  const header = (
    <PageHeader
      title="Plans & billing"
      subtitle="One plan: Pentra publishes your answer pages and keeps tracking every answer. Cancel anytime."
    />
  );

  const plansPending = !isLoaded || plans.isLoading || (plans.isFetching && plans.data.length === 0);

  if (plansPending) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <PlansSkeleton />
      </div>
    );
  }

  const pentraPlan: BillingPlanResource | undefined = plans.data.find((plan) => isPentraPlan(plan));

  if (!isSignedIn || plans.error || !pentraPlan) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <PlanWithoutCheckout period={period} onPeriodChange={setPeriod} />
      </div>
    );
  }

  const subscriptionLoading = subscription.isLoading;
  const clerkCurrent: CurrentPlan =
    subscriptionLoading || subscription.error ? { kind: "unknown" } : resolveCurrentPlan(subscription.data?.subscriptionItems);
  const entitlementName = entitlement.isPlanLoaded ? planDisplayName(entitlement.tier) : null;
  // Set up by Pentra by hand, with no Clerk subscription behind it.
  const managedByPentra = entitlementName === "Custom" && clerkCurrent.kind === "free";
  // Paid limits granted by Pentra at no charge (beta testers), while Clerk says free.
  const grantedAccess = !managedByPentra && entitlementName !== null && entitlementName !== "Free" && clerkCurrent.kind === "free";
  const current: CurrentPlan = managedByPentra ? { kind: "unknown" } : clerkCurrent;
  const onPaidPlan = current.kind === "pentra" || current.kind === "legacy";
  const upcomingItem = subscription.data?.subscriptionItems.find((item) => item.status === "upcoming");
  const refresh = () => {
    void subscription.revalidate();
  };

  const annualOffered = Boolean(pentraPlan.annualMonthlyFee && pentraPlan.annualMonthlyFee.amount > 0);
  const checkoutPeriod: BillingSubscriptionPlanPeriod = period === "annual" && annualOffered ? "annual" : "month";
  const interval: BillingInterval = checkoutPeriod === "annual" ? "annual" : "monthly";
  const samePeriod = current.kind === "pentra" && current.item.planPeriod === checkoutPeriod;

  let action: ReactNode;
  if (current.kind === "pentra" && samePeriod && !current.item.canceledAt) {
    action = (
      <Button variant="secondary" size="lg" disabled className="w-full sm:w-auto">
        Current plan
      </Button>
    );
  } else {
    const label =
      current.kind === "pentra"
        ? current.item.canceledAt && samePeriod
          ? `Keep ${PENTRA_PLAN.name}`
          : checkoutPeriod === "annual"
            ? "Switch to annual billing"
            : "Switch to monthly billing"
        : current.kind === "legacy"
          ? `Switch to ${PENTRA_PLAN.name}`
          : `Upgrade to ${PENTRA_PLAN.name}`;
    action = (
      <CheckoutButton
        planId={pentraPlan.id}
        planPeriod={checkoutPeriod}
        for="user"
        newSubscriptionRedirectUrl={AFTER_CHECKOUT}
        onSubscriptionComplete={refresh}
      >
        <Button variant="primary" size="lg" className="w-full sm:w-auto">
          {label}
        </Button>
      </CheckoutButton>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}

      {/* Current plan */}
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface-1 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-[14px] leading-[22px] text-text-2">
          {managedByPentra ? (
            <p>
              You&apos;re on a <span className="font-semibold text-text">custom plan</span> set up by Pentra. Email us to change it.
            </p>
          ) : grantedAccess ? (
            <p>Pentra gave your account paid access at no charge. You won&apos;t be billed unless you choose a plan.</p>
          ) : current.kind === "unknown" ? (
            subscriptionLoading ? (
              <Skeleton className="h-4 w-64" />
            ) : (
              <p>We couldn&apos;t load your current plan. You can still choose the plan below.</p>
            )
          ) : current.kind === "free" ? (
            <p>
              You&apos;re on the <span className="font-semibold text-text">free plan</span>.
            </p>
          ) : (
            <>
              <p>
                You&apos;re on{" "}
                <span className="font-semibold text-text">{current.kind === "pentra" ? PENTRA_PLAN.name : `the ${current.item.plan.name} plan`}</span>,{" "}
                {periodLabel(current.item.planPeriod)}.
                {current.kind === "legacy" && " It stays as it is until you switch."}
              </p>
              {current.item.status === "past_due" && (
                <p className="mt-1 text-wrong">Your last payment didn&apos;t go through. Update your card in Manage subscription.</p>
              )}
              {upcomingItem && formatDate(upcomingItem.periodStart) ? (
                <p className="mt-1">
                  Changes to {isPentraPlan(upcomingItem.plan) ? PENTRA_PLAN.name : upcomingItem.plan.name} on {formatDate(upcomingItem.periodStart)}.
                </p>
              ) : current.item.canceledAt ? (
                <p className="mt-1">
                  {formatDate(current.item.periodEnd)
                    ? `It ends on ${formatDate(current.item.periodEnd)}. After that you'll be on the free plan.`
                    : "It won't renew. After this period you'll be on the free plan."}
                </p>
              ) : formatDate(current.item.periodEnd) ? (
                <p className="mt-1">Renews on {formatDate(current.item.periodEnd)}.</p>
              ) : null}
            </>
          )}
        </div>
        {onPaidPlan && (
          <SubscriptionDetailsButton for="user" onSubscriptionCancel={refresh}>
            <Button variant="secondary" size="sm" className="shrink-0">
              Manage subscription
            </Button>
          </SubscriptionDetailsButton>
        )}
      </div>

      {/* The plan */}
      <PentraPlanBlock
        period={period}
        onPeriodChange={setPeriod}
        interval={interval}
        annualUnavailable={!annualOffered}
        action={action}
        terms={!(current.kind === "pentra" && samePeriod && !current.item.canceledAt) ? billingTerms(interval) : null}
      />

      <div className="mt-2 text-center text-[13px] leading-5 text-text-3">
        <p>Prices are in US dollars. No usage charges. If you cancel, your plan stays active until the end of the period you&apos;ve paid for.</p>
        <p className="mt-1">
          Questions about billing?{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-text-2 underline decoration-border-strong underline-offset-2 hover:text-text">
            Email us
          </a>
        </p>
      </div>
    </div>
  );
}
