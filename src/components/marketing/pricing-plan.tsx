"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSubscription } from "@clerk/nextjs/experimental";
import { Check } from "lucide-react";
import { buttonStyles } from "@/components/ui/button";
import { SegmentedToggle } from "@/components/ui/segmented-toggle";
import { focusHeroInput } from "@/components/layout/landing-nav";
import {
  ANNUAL_MONTHS_FREE,
  ANNUAL_PER_MONTH,
  PENTRA_PLAN,
  PLAN_INCLUDES,
  formatUsd,
  isPentraPlan,
  type BillingInterval,
} from "@/lib/pricing";
import { HERO_FORM_ANCHOR } from "@/lib/marketing-ids";
import { cx } from "@/lib/cx";

/** The price, crossfading between monthly and annual (200ms) without the block changing size. */
export function PlanPrice({ interval }: { interval: BillingInterval }) {
  const options = [
    { key: "monthly" as const, amount: formatUsd(PENTRA_PLAN.monthly), unit: "/month", note: "Billed monthly. Cancel anytime." },
    {
      key: "annual" as const,
      amount: formatUsd(PENTRA_PLAN.annual),
      unit: "/year",
      note: `${formatUsd(ANNUAL_PER_MONTH)}/mo, billed yearly. ${ANNUAL_MONTHS_FREE} months free.`,
    },
  ];
  return (
    <div className="grid grid-cols-1" aria-live="polite">
      {options.map((option) => {
        const shown = option.key === interval;
        return (
          <div
            key={option.key}
            aria-hidden={!shown}
            className={cx(
              "col-start-1 row-start-1 transition-[opacity,visibility] duration-[var(--d-state)] ease-in-out",
              shown ? "visible opacity-100" : "invisible opacity-0",
            )}
          >
            <p className="flex items-baseline gap-1.5">
              <span className="text-[48px] font-medium leading-[52px] tracking-[-0.03em] tabular-nums text-text sm:text-[56px] sm:leading-[60px]">
                {option.amount}
              </span>
              <span className="text-[16px] text-text-3">{option.unit}</span>
            </p>
            <p className="mt-1.5 text-[14px] leading-[22px] text-text-3">{option.note}</p>
          </div>
        );
      })}
    </div>
  );
}

/** Everything the plan does, in two columns with quiet check marks. */
export function PlanIncludes({ className }: { className?: string }) {
  return (
    <ul className={cx("grid gap-x-8 gap-y-3 sm:grid-cols-2", className)}>
      {PLAN_INCLUDES.map((item) => (
        <li key={item} className="flex gap-2.5 text-[14px] leading-[22px] text-text-2">
          <Check aria-hidden="true" className="mt-[3px] h-4 w-4 shrink-0 text-text-3" strokeWidth={1.5} />
          <span className="[text-wrap:pretty]">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Signed-in visitors: subscribers see their plan; everyone else can go straight to the upgrade screen. */
function SignedInActions() {
  const subscription = useSubscription({ for: "user" });
  const subscribed = subscription.data?.subscriptionItems.some(
    (item) => (item.status === "active" || item.status === "past_due") && isPentraPlan(item.plan),
  );
  if (subscribed) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="button" disabled className={buttonStyles({ variant: "secondary", size: "lg", className: "w-full sm:w-auto" })}>
          Current plan
        </button>
        <Link href="/upgrade" className="text-[14px] font-medium text-text-2 underline decoration-border-strong underline-offset-4 transition-colors hover:text-text">
          Manage billing
        </Link>
      </div>
    );
  }
  return (
    <Link href="/upgrade" className="text-[14px] font-medium text-text-2 underline decoration-border-strong underline-offset-4 transition-colors hover:text-text">
      Already have a snapshot? Upgrade
    </Link>
  );
}

/**
 * The one plan, shared by the landing section and /pricing: a 36px Monthly | Annual toggle, the price, the white
 * "Start with a free snapshot" action and everything the plan does.
 */
export function PricingPlan({ className }: { className?: string }) {
  const [interval, setBilling] = useState<BillingInterval>("monthly");
  const { isSignedIn } = useAuth();
  const onLanding = usePathname() === "/";

  return (
    <div className={cx("mx-auto w-full max-w-[640px]", className)}>
      <div className="flex justify-center">
        <SegmentedToggle
          label="Billing period"
          value={interval}
          onChange={setBilling}
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "annual", label: "Annual", tag: `${ANNUAL_MONTHS_FREE} months free` },
          ]}
        />
      </div>

      <div className="mt-8 rounded-hero border border-border bg-surface-1 p-6 text-left sm:p-8">
        <h3 className="text-[16px] font-semibold leading-[22px] text-text">{PENTRA_PLAN.name}</h3>
        <p className="mt-1 text-[14px] leading-[22px] text-text-3">Everything Pentra does, after the free snapshot.</p>
        <div className="mt-6">
          <PlanPrice interval={interval} />
        </div>

        <div className="mt-8 flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:gap-6">
          {onLanding ? (
            <a href={`#${HERO_FORM_ANCHOR}`} onClick={focusHeroInput} className={buttonStyles({ size: "lg", className: "w-full sm:w-auto" })}>
              Start with a free snapshot
            </a>
          ) : (
            <Link href="/start" className={buttonStyles({ size: "lg", className: "w-full sm:w-auto" })}>
              Start with a free snapshot
            </Link>
          )}
          {isSignedIn && <SignedInActions />}
        </div>

        <PlanIncludes className="mt-8 border-t border-border pt-7" />
      </div>
    </div>
  );
}
