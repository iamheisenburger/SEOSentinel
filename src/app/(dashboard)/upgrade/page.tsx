"use client";

import { useState, type ReactNode } from "react";
import { PricingTable, useAuth } from "@clerk/nextjs";
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
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlanLimits } from "@/hooks/usePlanLimits";

type TierKey = "free" | "starter" | "pro" | "scale";

type Tier = {
  key: TierKey;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  desc: string;
  sites: string;
  articles: string;
  featured: boolean;
  /** Clerk plan slugs or names (lowercase) that belong to this tier. */
  aliases: string[];
};

// Mirrors the homepage pricing (src/components/landing/pricing-section.tsx).
// Only these four plans are ever shown here, whatever else exists in billing.
const TIERS: Tier[] = [
  {
    key: "free",
    name: "Free",
    monthlyPrice: 0,
    annualPrice: 0,
    desc: "See the quality on your own site, free.",
    sites: "1 site",
    articles: "3 articles / month",
    featured: false,
    aliases: ["free", "free_user", "free-user", "free plan"],
  },
  {
    key: "starter",
    name: "Starter",
    monthlyPrice: 49,
    annualPrice: 39,
    desc: "Autopilot for one site: an article about every 3 days.",
    sites: "1 site",
    articles: "10 articles / month",
    featured: false,
    aliases: ["starter"],
  },
  {
    key: "pro",
    name: "Pro",
    monthlyPrice: 99,
    annualPrice: 79,
    desc: "Grow up to 3 sites, almost an article a day.",
    sites: "3 sites",
    articles: "25 articles / month",
    featured: true,
    aliases: ["pro", "growth"],
  },
  {
    key: "scale",
    name: "Scale",
    monthlyPrice: 199,
    annualPrice: 159,
    desc: "For agencies and content teams running many sites.",
    sites: "10 sites",
    articles: "60 articles / month",
    featured: false,
    aliases: ["scale"],
  },
];

const FEATURES = [
  "Autopilot or review-first publishing",
  "Written from your confirmed facts",
  "Independent fact-check review",
  "Improves pages near page one",
  "WordPress and GitHub publishing",
  "Search Console reporting",
  "Weekly site health check",
];

function savingPercent(tier: Tier) {
  if (tier.monthlyPrice <= 0) return 0;
  return Math.round((1 - tier.annualPrice / tier.monthlyPrice) * 100);
}

const PAID_SAVINGS = TIERS.filter((t) => t.monthlyPrice > 0).map(savingPercent);
const MAX_SAVING = Math.max(...PAID_SAVINGS);
const SAVING_LABEL =
  Math.min(...PAID_SAVINGS) === MAX_SAVING
    ? `Save ${MAX_SAVING}%`
    : `Save up to ${MAX_SAVING}%`;

function normalize(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/** Our tier for a Clerk plan, or null for any plan that is not one of ours. */
function tierForPlan(plan: Pick<BillingPlanResource, "slug" | "name">): Tier | null {
  const slug = normalize(plan.slug);
  const name = normalize(plan.name);
  return (
    TIERS.find((tier) =>
      tier.aliases.some((alias) => alias === slug || alias === name),
    ) ?? null
  );
}

function formatDate(value: Date | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function periodLabel(period: BillingSubscriptionPlanPeriod) {
  return period === "annual" ? "billed yearly" : "billed monthly";
}

type CurrentPlan =
  | { kind: "unknown" }
  | { kind: "free" }
  | { kind: "paid"; tier: Tier; item: BillingSubscriptionItemResource }
  | { kind: "custom"; item: BillingSubscriptionItemResource };

function resolveCurrentPlan(
  items: BillingSubscriptionItemResource[] | undefined,
): CurrentPlan {
  if (!items) return { kind: "free" };
  const active = items
    .filter((item) => item.status === "active" || item.status === "past_due")
    .sort((a, b) => Number(b.plan.hasBaseFee) - Number(a.plan.hasBaseFee));
  const item = active[0];
  if (!item) return { kind: "free" };
  const tier = tierForPlan(item.plan);
  if (!tier) return { kind: "custom", item };
  if (tier.key === "free") return { kind: "free" };
  return { kind: "paid", tier, item };
}

function PlansSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading plans">
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="mx-auto h-10 w-56 rounded-full" />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {TIERS.map((tier) => (
          <div
            key={tier.key}
            className="rounded-xl border border-white/[0.06] bg-[#0E0F11] p-6"
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-8 w-24" />
            <Skeleton className="mt-3 h-3 w-full" />
            <Skeleton className="mt-2 h-3 w-3/4" />
            <Skeleton className="mt-6 h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ClerkPricingFallback() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#0E0F11] overflow-hidden p-6">
      <PricingTable for="user" newSubscriptionRedirectUrl="/dashboard" />
    </div>
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
      subtitle="Pick how many articles Pentra writes and publishes for you each month. Change or cancel anytime."
    />
  );

  const plansPending =
    !isLoaded ||
    plans.isLoading ||
    (plans.isFetching && plans.data.length === 0);

  if (plansPending) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <PlansSkeleton />
      </div>
    );
  }

  const clerkPlans = new Map<TierKey, BillingPlanResource>();
  for (const plan of plans.data) {
    const tier = tierForPlan(plan);
    if (tier && !clerkPlans.has(tier.key)) clerkPlans.set(tier.key, plan);
  }
  const hasPaidMatch = TIERS.some(
    (tier) => tier.monthlyPrice > 0 && clerkPlans.has(tier.key),
  );

  // Checkout must always work: if our plans cannot be read or matched, show
  // Clerk's own table instead of cards that could not start a checkout.
  if (!isSignedIn || plans.error || !hasPaidMatch) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <ClerkPricingFallback />
      </div>
    );
  }

  const subscriptionLoading = subscription.isLoading;
  const clerkCurrent: CurrentPlan = subscriptionLoading || subscription.error
    ? { kind: "unknown" }
    : resolveCurrentPlan(subscription.data?.subscriptionItems);
  const managedByPentra = entitlement.isPlanLoaded && !TIERS.some(t => t.key === entitlement.tier) && clerkCurrent.kind !== "paid";
  // Beta testers get a paid plan's limits from Pentra without a Clerk subscription.
  const grantedTier = entitlement.isPlanLoaded && clerkCurrent.kind === "free"
    ? TIERS.find(t => t.key === entitlement.tier && t.key !== "free") ?? null : null;
  const current: CurrentPlan = managedByPentra ? { kind: "unknown" } : clerkCurrent;
  const onPaidPlan = current.kind === "paid" || current.kind === "custom";
  const upcomingItem = subscription.data?.subscriptionItems.find(
    (item) => item.status === "upcoming",
  );
  const upcomingTier = upcomingItem ? tierForPlan(upcomingItem.plan) : null;
  const refresh = () => {
    void subscription.revalidate();
  };

  const visibleTiers = TIERS.filter(
    (tier) => tier.key === "free" || clerkPlans.has(tier.key),
  );

  return (
    <div className="flex flex-col gap-5">
      {header}

      {/* Current plan */}
      <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-[#0E0F11] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-[13px] text-[#8A8F98]">
          {managedByPentra ? (
            <p>You&apos;re on a <span className="font-semibold text-[#F7F8F8]">custom plan</span> set up by Pentra. Email us to change it.</p>
          ) : grantedTier ? (
            <p>
              You have <span className="font-semibold text-[#F7F8F8]">{grantedTier.name}</span> access from Pentra at no charge:{" "}
              {grantedTier.articles.replace(" / month", " a month")} on {grantedTier.sites}. You won&apos;t be billed unless you choose a plan.
            </p>
          ) : current.kind === "unknown" ? (
            subscriptionLoading ? (
              <Skeleton className="h-4 w-64" />
            ) : (
              <p>We couldn&apos;t load your current plan. You can still choose a plan below.</p>
            )
          ) : current.kind === "free" ? (
            <p>
              You&apos;re on the <span className="font-semibold text-[#F7F8F8]">Free</span> plan:
              3 articles a month on 1 site.
            </p>
          ) : (
            <>
              <p>
                You&apos;re on{" "}
                {current.kind === "paid" ? (
                  <>
                    the <span className="font-semibold text-[#F7F8F8]">{current.tier.name}</span> plan
                  </>
                ) : (
                  <span className="font-semibold text-[#F7F8F8]">a custom plan</span>
                )}
                , {periodLabel(current.item.planPeriod)}.
              </p>
              {current.item.status === "past_due" && (
                <p className="mt-1 text-[#FBBF24]">
                  Your last payment didn&apos;t go through. Update your card in Manage subscription.
                </p>
              )}
              {upcomingItem && upcomingTier && upcomingTier.key !== "free" && formatDate(upcomingItem.periodStart) ? (
                <p className="mt-1">
                  Changes to {upcomingTier.name} on {formatDate(upcomingItem.periodStart)}.
                </p>
              ) : current.item.canceledAt ? (
                <p className="mt-1">
                  {formatDate(current.item.periodEnd)
                    ? `It ends on ${formatDate(current.item.periodEnd)}. After that you'll be on Free.`
                    : "It won't renew. After this period you'll be on Free."}
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

      {/* Billing period */}
      <div className="flex justify-center">
        <div
          role="group"
          aria-label="Billing period"
          className="inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-[#0B0C0E] p-1"
        >
          <button
            type="button"
            aria-pressed={period === "month"}
            onClick={() => setPeriod("month")}
            className={`rounded-full px-5 py-2 text-[13px] font-medium transition cursor-pointer ${
              period === "month"
                ? "bg-[#F7F8F8] text-[#08090A]"
                : "text-[#8A8F98] hover:text-white"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            aria-pressed={period === "annual"}
            onClick={() => setPeriod("annual")}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-[13px] font-medium transition cursor-pointer ${
              period === "annual"
                ? "bg-[#F7F8F8] text-[#08090A]"
                : "text-[#8A8F98] hover:text-white"
            }`}
          >
            Annual
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                period === "annual"
                  ? "bg-[#08090A]/10 text-[#08090A]"
                  : "bg-[#22C55E]/10 text-[#22C55E]"
              }`}
            >
              {SAVING_LABEL}
            </span>
          </button>
        </div>
      </div>

      {/* Plans */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {visibleTiers.map((tier) => {
          const plan = clerkPlans.get(tier.key);
          const isFree = tier.key === "free";
          const annualOffered = Boolean(
            plan?.annualMonthlyFee && plan.annualMonthlyFee.amount > 0,
          );
          const cardPeriod: BillingSubscriptionPlanPeriod =
            period === "annual" && (isFree || annualOffered) ? "annual" : "month";
          const showAnnual = !isFree && cardPeriod === "annual";
          const price = showAnnual ? tier.annualPrice : tier.monthlyPrice;
          const isCurrent =
            (isFree && current.kind === "free" && !grantedTier) ||
            (current.kind === "paid" && current.tier.key === tier.key);
          const samePeriod =
            current.kind === "paid" && current.item.planPeriod === cardPeriod;

          let action: ReactNode = null;
          if (isFree) {
            if (current.kind === "free" && !grantedTier) {
              action = (
                <Button variant="secondary" size="md" className="w-full" disabled>
                  Current plan
                </Button>
              );
            } else if (onPaidPlan) {
              action = (
                <p className="text-center text-[12px] leading-relaxed text-[#8A8F98]">
                  To move to Free, cancel from Manage subscription.
                </p>
              );
            }
          } else if (plan) {
            let label = onPaidPlan ? `Switch to ${tier.name}` : `Choose ${tier.name}`;
            let disabled = false;
            if (isCurrent && current.kind === "paid") {
              if (current.item.canceledAt && samePeriod) {
                label = `Keep ${tier.name}`;
              } else if (samePeriod) {
                label = "Current plan";
                disabled = true;
              } else {
                label = cardPeriod === "annual"
                  ? "Switch to annual billing"
                  : "Switch to monthly billing";
              }
            }
            action = disabled ? (
              <Button variant="secondary" size="md" className="w-full" disabled>
                {label}
              </Button>
            ) : (
              <CheckoutButton
                planId={plan.id}
                planPeriod={cardPeriod}
                for="user"
                newSubscriptionRedirectUrl="/dashboard"
                onSubscriptionComplete={refresh}
              >
                <Button
                  variant={tier.featured ? "primary" : "secondary"}
                  size="md"
                  className="w-full"
                >
                  {label}
                </Button>
              </CheckoutButton>
            );
          }

          return (
            <div
              key={tier.key}
              className={`relative flex flex-col overflow-hidden rounded-xl ${
                isCurrent
                  ? "border border-[#4CB782]/30 bg-[#0E0F11]"
                  : tier.featured
                    ? "border border-white/[0.14] bg-[#101113] shadow-[0_24px_48px_-24px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)]"
                    : "border border-white/[0.06] bg-[#0E0F11]"
              }`}
            >
              {tier.featured && (
                <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#0EA5E9] to-transparent" />
              )}
              <div className="flex flex-1 flex-col p-6">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium uppercase tracking-[0.1em] text-[#8A8F98]">
                    {tier.name}
                  </p>
                  {isCurrent ? (
                    <span className="rounded-full bg-[#4CB782]/10 px-2 py-0.5 text-[10px] font-semibold text-[#4CB782]">
                      Current plan
                    </span>
                  ) : tier.featured ? (
                    <span className="rounded-full border border-white/[0.1] px-2 py-0.5 text-[10px] font-medium text-[#D0D6E0]">
                      Most popular
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 flex items-baseline gap-0.5">
                  <span className="text-[32px] font-semibold tracking-[-0.03em] text-[#F7F8F8]">
                    ${price}
                  </span>
                  <span className="text-[13px] text-[#8A8F98]">/mo</span>
                </div>
                <p className="mt-0.5 min-h-[16px] text-[11px] text-[#8A8F98]">
                  {isFree
                    ? "No charge"
                    : showAnnual
                      ? <span className="text-[#4CB782]">${tier.annualPrice}/mo billed annually (${tier.annualPrice * 12} a year) · save {savingPercent(tier)}%</span>
                      : period === "annual"
                        ? "Billed monthly. Annual billing isn't offered on this plan."
                        : "Billed monthly"}
                </p>
                <p className="mt-2 text-[13px] text-[#8A8F98]">{tier.desc}</p>

                <div className="mt-4 space-y-1.5">
                  {[tier.sites, tier.articles].map((line) => (
                    <div
                      key={line}
                      className="flex items-center gap-2 text-[13px] font-semibold text-[#F7F8F8]"
                    >
                      <CheckCircle2
                        className="h-3.5 w-3.5 shrink-0 text-[#4CB782]"
                      />
                      {line}
                    </div>
                  ))}
                </div>

                <div className="mt-5">{action}</div>

                <div className="mt-4 border-t border-white/[0.04] pt-4">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[#62666D]">
                    Everything included
                  </p>
                  <ul className="space-y-1.5">
                    {FEATURES.map((feature) => (
                      <li
                        key={feature}
                        className="flex items-center gap-2 text-[12px] text-[#8A8F98]"
                      >
                        <CheckCircle2
                          className="h-3 w-3 shrink-0 text-[#62666D]"
                        />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-center text-[12px] text-[#8A8F98]">
        <p>
          Prices are in US dollars. No usage charges. If you cancel, your plan
          stays active until the end of the period you&apos;ve paid for.
        </p>
        <p className="mt-1 text-[#62666D]">
          Questions about billing?{" "}
          <a
            href="mailto:pentrahelp@gmail.com"
            className="text-[#D0D6E0] underline-offset-2 hover:underline"
          >
            Email us
          </a>
        </p>
      </div>
    </div>
  );
}
