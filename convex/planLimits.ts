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
const FREE_LIMITS: PlanLimits = { maxSites: 1, maxArticles: 3 };

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
