/**
 * Authority-relative keyword discovery.
 *
 * Pentra's purpose is to turn a weak domain into a strong one. That only works
 * if discovery hunts queries the tenant can win *at its current authority*,
 * then widens as authority grows.
 *
 * Discovery previously seeded from the tenant's own product vocabulary and
 * ranked candidates by search volume, so it surfaced head terms in competitive
 * niches. Measured against leadpilot.chat (authority 4): all 20 eligible topics
 * sat on page ones with a median authority of 34-87, none below 20, and every
 * rank probability pinned to the 1% floor for a total of 1.64 expected clicks
 * per month. The ranking model was doing correct arithmetic on an input set
 * that contained nothing winnable.
 *
 * The expected-click model is already a ladder — rank probability is a sigmoid
 * on (tenantAuthority - medianSerpAuthority), so every point of authority the
 * tenant gains widens the band on its own. This module supplies the missing
 * bottom rungs by making authority the primary discovery filter and volume the
 * tie-breaker, never the reverse.
 *
 * Pure and deterministic.
 */

export const WINNABLE_DISCOVERY_VERSION = 1;

/**
 * Mirrors expectedClickPortfolio: a 12-point authority gap is the scale at
 * which ranking odds change materially. Keep them in step; a discovery filter
 * looser than the scoring model just refills the inventory with topics the
 * portfolio will reject.
 */
const AUTHORITY_GAP_SCALE = 12;

/** Below this, a SERP is effectively open to anyone with better content. */
export const OPEN_SERP_AUTHORITY = 20;

export type WinnableBand = {
  /** Ideal page-one median authority to hunt for right now. */
  target: number;
  /** Hard ceiling; beyond this the tenant cannot realistically compete yet. */
  ceiling: number;
  /** Everything at or below this is winnable regardless of tenant authority. */
  floor: number;
  version: number;
};

/**
 * The page-one authority band worth discovering for a tenant right now.
 *
 * A brand-new domain must be pointed at genuinely open SERPs. A tenant that has
 * already climbed can reach higher, so the ceiling tracks its measured
 * authority rather than a fixed constant — this is what makes the same engine
 * serve a rank-4 startup and a rank-60 incumbent without reconfiguration.
 */
export function winnableAuthorityBand(tenantAuthority: number): WinnableBand {
  const authority = Number.isFinite(tenantAuthority)
    ? Math.max(0, tenantAuthority)
    : 0;
  // One sigmoid scale above the tenant keeps rank probability near or above
  // ~0.27, which is a real chance rather than the 1% floor.
  const ceiling = Math.max(OPEN_SERP_AUTHORITY, authority + AUTHORITY_GAP_SCALE);
  return {
    floor: OPEN_SERP_AUTHORITY,
    target: Math.max(OPEN_SERP_AUTHORITY / 2, authority),
    ceiling,
    version: WINNABLE_DISCOVERY_VERSION,
  };
}

/**
 * Is this observed SERP worth spending a generation on today?
 *
 * Fails closed: without observed page-one authority there is no evidence the
 * SERP is winnable, and guessing is what produced 86 articles that earned a
 * single click.
 */
export function serpIsWinnableNow(args: {
  tenantAuthority: number;
  medianSerpAuthority?: number | null;
  observedCompetitors?: number;
  minimumObservations?: number;
}): boolean {
  const minimum = Math.max(1, args.minimumObservations ?? 5);
  if ((args.observedCompetitors ?? 0) < minimum) return false;
  const median = args.medianSerpAuthority;
  if (typeof median !== "number" || !Number.isFinite(median)) return false;
  return median <= winnableAuthorityBand(args.tenantAuthority).ceiling;
}

/**
 * Rank discovery candidates by winnable traffic rather than raw demand.
 *
 * Deliberately the same shape as the portfolio's estimate so discovery and
 * scoring cannot disagree: a keyword that scores well here must also survive
 * the expected-click gate. Volume only ever breaks ties between keywords the
 * tenant can actually reach.
 */
export function winnabilityScore(args: {
  tenantAuthority: number;
  medianSerpAuthority?: number | null;
  monthlySearches?: number;
  observedCompetitors?: number;
}): number {
  const volume = Math.max(0, args.monthlySearches ?? 0);
  if (volume === 0) return 0;
  if (!serpIsWinnableNow(args)) return 0;
  const gap = args.tenantAuthority - (args.medianSerpAuthority as number);
  const probability = 1 / (1 + Math.exp(-gap / AUTHORITY_GAP_SCALE));
  return Math.round(volume * probability * 100) / 100;
}

/**
 * How far past its own authority a tenant may shortlist on keyword difficulty
 * alone.
 *
 * Deliberately looser than `winnableAuthorityBand`, which decides publication
 * from measured page-one authority. Difficulty is a noisier proxy, and this
 * stage only chooses which candidates are worth paying to measure — so it
 * admits two sigmoid scales rather than one, and the strict band still applies
 * afterwards.
 */
export function preSerpReachCeiling(tenantAuthority: number): number {
  const authority = Number.isFinite(tenantAuthority)
    ? Math.max(0, tenantAuthority)
    : 0;
  return Math.max(
    OPEN_SERP_AUTHORITY + AUTHORITY_GAP_SCALE,
    authority + 2 * AUTHORITY_GAP_SCALE,
  );
}

/**
 * Pre-SERP winnability, used to order candidates before any SERP is measured.
 *
 * Measuring page-one authority costs a provider call per keyword, so discovery
 * cannot afford it for every candidate. Keyword difficulty is the cheap proxy
 * that already arrives with the candidate, and it tracks the authority a page
 * one demands closely enough to order a shortlist.
 *
 * This exists because discovery previously ordered candidates by raw search
 * volume and truncated, which is precisely the rule that keeps the keywords a
 * weak tenant cannot win and discards the long tail where it could.
 */
export function preSerpWinnability(args: {
  tenantAuthority: number;
  keywordDifficulty?: number | null;
  keywordDifficultyMeasured?: boolean;
  monthlySearches?: number;
}): number {
  const volume = Math.max(0, args.monthlySearches ?? 0);
  if (volume === 0) return 0;
  const difficulty = typeof args.keywordDifficulty === "number" &&
      Number.isFinite(args.keywordDifficulty)
    ? Math.max(0, Math.min(100, args.keywordDifficulty))
    : undefined;
  // Difficulty is roughly the authority a page one demands, so the same
  // sigmoid the portfolio uses keeps discovery and scoring consistent.
  const authority = Number.isFinite(args.tenantAuthority)
    ? Math.max(0, args.tenantAuthority)
    : 0;
  // Unmeasured difficulty is treated as the open-SERP boundary rather than as
  // easy: it must never let an unverified head term outrank a measured
  // long-tail keyword.
  const assumed = difficulty ?? OPEN_SERP_AUTHORITY;
  // Expected value alone is not a strategy for a weak domain: 90,000 searches
  // at a 0.07% chance outscores 140 searches at 36%, which is how the
  // highest-volume unreachable head term wins a shortlist it can never convert.
  // Anything past the reach ceiling scores zero regardless of volume.
  if (assumed > preSerpReachCeiling(authority)) return 0;
  const probability = 1 / (1 + Math.exp(-(authority - assumed) / AUTHORITY_GAP_SCALE));
  // A measured value is worth more than an assumption of the same size.
  const confidence = args.keywordDifficultyMeasured && difficulty !== undefined
    ? 1
    : 0.6;
  return Math.round(volume * probability * confidence * 100) / 100;
}

/**
 * Order raw discovery output so the tenant keeps what it can win.
 *
 * Truncation is unavoidable — providers return far more candidates than can be
 * measured — so the ordering rule decides what a tenant ever gets to publish.
 */
export function orderDiscoveryByWinnability<
  T extends {
    keyword: string;
    searchVolume?: number;
    difficulty?: number | null;
    difficultyMeasured?: boolean;
  },
>(tenantAuthority: number, candidates: T[]): T[] {
  return candidates
    .map((candidate) => ({
      candidate,
      score: preSerpWinnability({
        tenantAuthority,
        keywordDifficulty: candidate.difficulty,
        keywordDifficultyMeasured: candidate.difficultyMeasured,
        monthlySearches: candidate.searchVolume,
      }),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.candidate.searchVolume ?? 0) - (left.candidate.searchVolume ?? 0) ||
        left.candidate.keyword.localeCompare(right.candidate.keyword),
    )
    .map((entry) => entry.candidate);
}

export type DiscoveryCandidate = {
  keyword: string;
  monthlySearches?: number;
  medianSerpAuthority?: number | null;
  observedCompetitors?: number;
};

/**
 * Order candidates so the tenant publishes what it can win first.
 *
 * Returns only winnable candidates. An empty result is a truthful statement
 * that nothing measured is reachable yet — the caller should widen discovery
 * or report an honest authority-limited plan, never lower the bar and publish
 * into a SERP the tenant cannot enter.
 */
export function rankWinnableCandidates<T extends DiscoveryCandidate>(
  tenantAuthority: number,
  candidates: T[],
): Array<T & { winnabilityScore: number }> {
  return candidates
    .map((candidate) => ({
      ...candidate,
      winnabilityScore: winnabilityScore({
        tenantAuthority,
        medianSerpAuthority: candidate.medianSerpAuthority,
        monthlySearches: candidate.monthlySearches,
        observedCompetitors: candidate.observedCompetitors,
      }),
    }))
    .filter((candidate) => candidate.winnabilityScore > 0)
    .sort(
      (left, right) =>
        right.winnabilityScore - left.winnabilityScore ||
        left.keyword.localeCompare(right.keyword),
    );
}

/**
 * How much winnable traffic the tenant can currently reach, and therefore
 * whether a configured goal is attainable from measured evidence today.
 *
 * This is the honest alternative to an endless replenishment loop: it states
 * the gap in pages rather than declaring the goal impossible or silently
 * lowering it.
 */
export function authorityLimitedForecast(args: {
  tenantAuthority: number;
  monthlyClickGoal: number;
  winnableCandidates: Array<{ winnabilityScore: number }>;
  /** Planning CTR for the position an equal-authority page can hold. */
  planningCtr?: number;
}): {
  reachableMonthlyClicks: number;
  goalGap: number;
  pagesNeededForGoal: number | null;
  averageClicksPerWinnablePage: number;
  goalAttainableFromCurrentEvidence: boolean;
  version: number;
} {
  const ctr = args.planningCtr ?? 0.1;
  const reachable = args.winnableCandidates.reduce(
    (total, candidate) => total + candidate.winnabilityScore * ctr,
    0,
  );
  const reachableMonthlyClicks = Math.round(reachable * 100) / 100;
  const average = args.winnableCandidates.length > 0
    ? reachableMonthlyClicks / args.winnableCandidates.length
    : 0;
  const goalGap = Math.max(0, args.monthlyClickGoal - reachableMonthlyClicks);
  return {
    reachableMonthlyClicks,
    goalGap: Math.round(goalGap * 100) / 100,
    // How many more comparable pages would close the gap. Null when nothing
    // winnable has been measured, because the honest answer is "unknown until
    // discovery widens", not "impossible".
    pagesNeededForGoal: average > 0 ? Math.ceil(goalGap / average) : null,
    averageClicksPerWinnablePage: Math.round(average * 100) / 100,
    goalAttainableFromCurrentEvidence: goalGap === 0,
    version: WINNABLE_DISCOVERY_VERSION,
  };
}
