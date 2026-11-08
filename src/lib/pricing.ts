/**
 * Pentra's one plan, defined once (Nov 2026). Every price on the site (landing, /pricing, /upgrade, the
 * Terms) reads from here; no other file states a price.
 *
 * Billing runs through Clerk Billing. The Clerk plan is matched by slug or name "pentra" (see isPentraPlan).
 * TODO(backend): convex/planLimits.ts still knows only the old tiers (free/starter/pro/scale/enterprise);
 * it must add the "pentra" tier ($249/month, $2,490/year) before this plan can be bought.
 */
export const PENTRA_PLAN = {
  key: "pentra",
  name: "Pentra",
  monthly: 249,
  annual: 2490,
} as const;

export type BillingInterval = "monthly" | "annual";

/** Annual price as a monthly figure: $2,490 / 12 = $207.50. */
export const ANNUAL_PER_MONTH = PENTRA_PLAN.annual / 12;

/** What annual saves against twelve monthly payments: 12 × $249 − $2,490 = $498. */
export const ANNUAL_SAVINGS = PENTRA_PLAN.monthly * 12 - PENTRA_PLAN.annual;

/** Whole months the annual price gives back: $498 / $249 = 2. */
export const ANNUAL_MONTHS_FREE = Math.round(ANNUAL_SAVINGS / PENTRA_PLAN.monthly);

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** $249, $2,490, $207.50: cents only when there are any. */
export function formatUsd(amount: number): string {
  const formatted = usd.format(amount);
  return /\.\d$/.test(formatted) ? `${formatted}0` : formatted;
}

export function planPrice(interval: BillingInterval): number {
  return interval === "annual" ? PENTRA_PLAN.annual : PENTRA_PLAN.monthly;
}

/** "$249/month" or "$2,490/year". */
export function planPriceLabel(interval: BillingInterval): string {
  return interval === "annual"
    ? `${formatUsd(PENTRA_PLAN.annual)}/year`
    : `${formatUsd(PENTRA_PLAN.monthly)}/month`;
}

/** Terms stated before any charge, in the words the checkout uses. */
export function billingTerms(interval: BillingInterval): string {
  return interval === "annual"
    ? `Billed ${formatUsd(PENTRA_PLAN.annual)} today, renews yearly. Cancel anytime.`
    : `Billed ${formatUsd(PENTRA_PLAN.monthly)} today, renews monthly. Cancel anytime.`;
}

/** What the plan does after the free snapshot. The pricing block, /pricing and /upgrade list exactly this. */
export const PLAN_INCLUDES = [
  "Publishes your answer pages, or hosts them on answers.yourdomain.com",
  "IndexNow for hosted pages; your sitemap to Google through your Search Console",
  "Keeps re-asking the assistants and records every citation in full",
  "Adds new questions your buyers ask, every week",
  "Rewrites pages the assistants don't cite",
  "Keeps your facts current on every page",
  "A weekly email with what changed",
  "Cancel anytime. Your pages stay yours",
] as const;

/** Clerk plan resources that are the Pentra plan. */
export function isPentraPlan(plan: { slug?: string | null; name?: string | null }): boolean {
  const slug = (plan.slug ?? "").trim().toLowerCase();
  const name = (plan.name ?? "").trim().toLowerCase();
  return slug === PENTRA_PLAN.key || name === PENTRA_PLAN.name.toLowerCase();
}

const LEGACY_TIERS = new Set(["starter", "pro", "growth", "scale"]);

/**
 * Display name for the plan tier the backend resolves (usePlanLimits). Accounts that subscribed before the
 * single plan keep what they bought until they switch; those tiers show as "Legacy", never priced or sold.
 */
export function planDisplayName(tier: string | null | undefined): string {
  const key = (tier ?? "").trim().toLowerCase();
  if (key === "" || key === "free") return "Free";
  if (key === PENTRA_PLAN.key) return PENTRA_PLAN.name;
  if (LEGACY_TIERS.has(key)) return "Legacy";
  return "Custom";
}
