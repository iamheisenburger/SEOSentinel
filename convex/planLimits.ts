/**
 * Plan limits lookup — maps Clerk feature keys to numeric values.
 *
 * Clerk features are boolean (has/doesn't have), so the numeric limit
 * is encoded in the feature key itself (e.g. max_articles_25 → 25).
 *
 * Usage in Convex backend: call getPlanLimits(userId) which checks
 * the site's userId and counts usage.
 *
 * Usage on client: call getLimitsFromFeatures(features) where features
 * come from the Clerk session.
 */

export type PlanLimits = {
  maxSites: number;
  maxArticles: number;
};

export type CanonicalPlanTier =
  | "free"
  | "starter"
  | "pro"
  | "scale"
  | "enterprise";

export type CanonicalPlan = PlanLimits & { tier: CanonicalPlanTier };

/**
 * Public billing contract. Limits must always resolve to one complete bundle;
 * independently maximizing site and article flags would create combinations
 * that no customer bought (for example, one site with 150 articles).
 *
 * `9999` is the existing operational sentinel for the public "unlimited"
 * Enterprise allowance. Keeping it stable avoids changing database query
 * bounds as part of entitlement resolution.
 */
export const CANONICAL_PLANS: readonly CanonicalPlan[] = Object.freeze([
  Object.freeze({ tier: "free", maxSites: 1, maxArticles: 3 }),
  Object.freeze({ tier: "starter", maxSites: 1, maxArticles: 10 }),
  Object.freeze({ tier: "pro", maxSites: 3, maxArticles: 25 }),
  Object.freeze({ tier: "scale", maxSites: 10, maxArticles: 60 }),
  Object.freeze({ tier: "enterprise", maxSites: 9999, maxArticles: 150 }),
]);

// Clerk may return the selected plan's features alone or cumulatively include
// lower-tier features. Each recognized flag is therefore a ceiling, and the
// lower of the site/article ceilings is the only bundle that both signals can
// safely authorize. One site is the default and supports both Free and Starter;
// the default three-article ceiling still keeps an unentitled account on Free.
const SITE_TIER_CEILINGS: Record<string, number> = {
  max_sites_1: 1,
  max_sites_3: 2,
  max_sites_10: 3,
  max_sites_unlimited: 4,
};

const ARTICLE_TIER_CEILINGS: Record<string, number> = {
  max_articles_3: 0,
  max_articles_10: 1,
  max_articles_25: 2,
  max_articles_60: 3,
  max_articles_150: 4,
};

// Default (no plan / free fallback)
export const FREE_LIMITS: PlanLimits = {
  maxSites: CANONICAL_PLANS[0].maxSites,
  maxArticles: CANONICAL_PLANS[0].maxArticles,
};
export const LONGEST_MONTH_DAYS = 31;
export const WEEK_DAYS = 7;

const STANDARD_WEEKLY_CADENCES = [1, 2, 4, 7, 14, 21] as const;

export function requiredMonthlyArticlesForCadence(
  cadencePerWeek: number | undefined,
): number {
  if (!Number.isFinite(cadencePerWeek) || (cadencePerWeek ?? 0) <= 0) return 0;
  const raw = ((cadencePerWeek as number) * LONGEST_MONTH_DAYS) / WEEK_DAYS;
  return Math.ceil(raw - 1e-9);
}

export function maximumSustainableCadencePerWeek(
  maxArticlesPerMonth: number,
): number {
  if (!Number.isFinite(maxArticlesPerMonth) || maxArticlesPerMonth <= 0) return 0;
  return (Math.floor(maxArticlesPerMonth) * WEEK_DAYS) / LONGEST_MONTH_DAYS;
}

/** Highest whole-number weekly cadence a customer can choose without
 * over-allocating the 31-day monthly allowance. The runtime deliberately
 * caps publishing at three articles per day (21/week), but does not otherwise
 * force customers into the UI's familiar preset cadences. */
export function maximumWholeCadencePerWeek(
  maxArticlesPerMonth: number,
): number {
  return Math.max(
    0,
    Math.min(
      21,
      Math.floor(maximumSustainableCadencePerWeek(maxArticlesPerMonth) + 1e-9),
    ),
  );
}

export function cadenceFitsMonthlyLimit(
  cadencePerWeek: number,
  maxArticlesPerMonth: number,
): boolean {
  return (
    Number.isFinite(cadencePerWeek) &&
    cadencePerWeek > 0 &&
    cadencePerWeek <= 21 &&
    requiredMonthlyArticlesForCadence(cadencePerWeek) <= maxArticlesPerMonth
  );
}

/** Zero is an explicit paused allocation. Positive cadences retain the strict
 * 31-day monthly conversion used by billing and readiness. */
export function cadenceFitsMonthlyAllowance(
  cadencePerWeek: number,
  availableArticlesPerMonth: number,
): boolean {
  return cadencePerWeek === 0
    ? Number.isFinite(availableArticlesPerMonth) &&
        availableArticlesPerMonth >= 0
    : cadenceFitsMonthlyLimit(cadencePerWeek, availableArticlesPerMonth);
}

export type CadenceOption = { value: number; label: string };

/** Every plan gets at least one honest cadence. A three-article free plan is
 * represented as 3/month rather than the impossible 1/week (5 in a 31-day
 * month). Higher plans use the familiar weekly choices that fit their quota. */
export function cadenceOptionsForMonthlyLimit(
  maxArticlesPerMonth: number,
): CadenceOption[] {
  if (!Number.isFinite(maxArticlesPerMonth) || maxArticlesPerMonth <= 0) {
    return [{ value: 0, label: "Paused" }];
  }
  const weekly = STANDARD_WEEKLY_CADENCES
    .filter((value) => cadenceFitsMonthlyLimit(value, maxArticlesPerMonth))
    .map((value) => ({ value, label: `${value}/week` }));
  if (weekly.length > 0) {
    return [{ value: 0, label: "Paused" }, ...weekly];
  }
  const monthly = Math.max(1, Math.floor(maxArticlesPerMonth));
  return [
    { value: 0, label: "Paused" },
    {
      value: maximumSustainableCadencePerWeek(monthly),
      label: `${monthly}/month`,
    },
  ];
}

export function defaultCadenceForMonthlyLimit(
  maxArticlesPerMonth: number,
): number {
  const options = cadenceOptionsForMonthlyLimit(maxArticlesPerMonth);
  return (
    [...options]
      .reverse()
      .find((option) => option.value > 0 && option.value <= 4)?.value ??
    options[0].value
  );
}

export function maximumSelectableCadenceForMonthlyLimit(
  maxArticlesPerMonth: number,
): number {
  const options = cadenceOptionsForMonthlyLimit(maxArticlesPerMonth);
  return options[options.length - 1].value;
}

/** Preserve a customer's requested cadence when capacity permits; otherwise
 * allocate the largest truthful cadence remaining, down to an explicit pause. */
export function allocateCadenceForMonthlyAllowance(
  requestedCadencePerWeek: number,
  availableArticlesPerMonth: number,
): number {
  const available = Math.max(0, Math.floor(availableArticlesPerMonth));
  if (cadenceFitsMonthlyAllowance(requestedCadencePerWeek, available)) {
    return requestedCadencePerWeek;
  }
  return maximumSelectableCadenceForMonthlyLimit(available);
}

export function cadenceLabel(cadencePerWeek: number): string {
  if (cadencePerWeek === 0) return "Paused";
  if (cadencePerWeek < 1) {
    return `${requiredMonthlyArticlesForCadence(cadencePerWeek)}/month`;
  }
  return `${Number.isInteger(cadencePerWeek) ? cadencePerWeek : cadencePerWeek.toFixed(2)}/week`;
}

/** Resolve Clerk features to one canonical purchased tier.
 *
 * Unknown features and legacy non-volume aliases never increase limits.
 * Cumulative lower-tier flags are harmless, while incomplete or mismatched
 * volume flags fail down to the strongest complete bundle supported by both
 * dimensions.
 */
export function resolvePlanFromFeatures(
  features: readonly string[],
): CanonicalPlan {
  let siteTierCeiling = 1;
  let articleTierCeiling = 0;

  for (const feature of features) {
    siteTierCeiling = Math.max(
      siteTierCeiling,
      Object.hasOwn(SITE_TIER_CEILINGS, feature)
        ? SITE_TIER_CEILINGS[feature]
        : 0,
    );
    articleTierCeiling = Math.max(
      articleTierCeiling,
      Object.hasOwn(ARTICLE_TIER_CEILINGS, feature)
        ? ARTICLE_TIER_CEILINGS[feature]
        : 0,
    );
  }

  return CANONICAL_PLANS[Math.min(siteTierCeiling, articleTierCeiling)];
}

/**
 * Extract numeric limits from a list of Clerk feature keys.
 * Works both client-side (from `has()` checks) and server-side.
 */
export function getLimitsFromFeatures(
  features: readonly string[],
): PlanLimits {
  const { maxSites, maxArticles } = resolvePlanFromFeatures(features);
  return { maxSites, maxArticles };
}

/**
 * All known feature keys — used to check which ones the user has.
 */
export const ALL_FEATURE_KEYS = [
  ...Object.keys(SITE_TIER_CEILINGS),
  ...Object.keys(ARTICLE_TIER_CEILINGS),
  "seo_authority_discovery",
  "authority_discovery",
];
