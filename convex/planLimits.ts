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

// Feature key → numeric limit
const SITE_LIMITS: Record<string, number> = {
  max_sites_1: 1,
  max_sites_3: 3,
  max_sites_10: 10,
  max_sites_unlimited: 9999,
};

const ARTICLE_LIMITS: Record<string, number> = {
  max_articles_3: 3,
  max_articles_10: 10,
  max_articles_25: 25,
  max_articles_60: 60,
  max_articles_150: 150,
};

export type PlanLimits = {
  maxSites: number;
  maxArticles: number;
};

// Default (no plan / free fallback)
export const FREE_LIMITS: PlanLimits = { maxSites: 1, maxArticles: 3 };
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

export type CadenceOption = { value: number; label: string };

/** Every plan gets at least one honest cadence. A three-article free plan is
 * represented as 3/month rather than the impossible 1/week (5 in a 31-day
 * month). Higher plans use the familiar weekly choices that fit their quota. */
export function cadenceOptionsForMonthlyLimit(
  maxArticlesPerMonth: number,
): CadenceOption[] {
  const weekly = STANDARD_WEEKLY_CADENCES
    .filter((value) => cadenceFitsMonthlyLimit(value, maxArticlesPerMonth))
    .map((value) => ({ value, label: `${value}/week` }));
  if (weekly.length > 0) return weekly;
  const monthly = Math.max(1, Math.floor(maxArticlesPerMonth));
  return [
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
    [...options].reverse().find((option) => option.value <= 4)?.value ??
    options[0].value
  );
}

export function maximumSelectableCadenceForMonthlyLimit(
  maxArticlesPerMonth: number,
): number {
  const options = cadenceOptionsForMonthlyLimit(maxArticlesPerMonth);
  return options[options.length - 1].value;
}

export function cadenceLabel(cadencePerWeek: number): string {
  if (cadencePerWeek < 1) {
    return `${requiredMonthlyArticlesForCadence(cadencePerWeek)}/month`;
  }
  return `${Number.isInteger(cadencePerWeek) ? cadencePerWeek : cadencePerWeek.toFixed(2)}/week`;
}

/**
 * Extract numeric limits from a list of Clerk feature keys.
 * Works both client-side (from `has()` checks) and server-side.
 */
export function getLimitsFromFeatures(features: string[]): PlanLimits {
  let maxSites = FREE_LIMITS.maxSites;
  let maxArticles = FREE_LIMITS.maxArticles;

  for (const f of features) {
    if (SITE_LIMITS[f] !== undefined && SITE_LIMITS[f] > maxSites) {
      maxSites = SITE_LIMITS[f];
    }
    if (ARTICLE_LIMITS[f] !== undefined && ARTICLE_LIMITS[f] > maxArticles) {
      maxArticles = ARTICLE_LIMITS[f];
    }
  }

  return { maxSites, maxArticles };
}

/**
 * All known feature keys — used to check which ones the user has.
 */
export const ALL_FEATURE_KEYS = [
  ...Object.keys(SITE_LIMITS),
  ...Object.keys(ARTICLE_LIMITS),
];
