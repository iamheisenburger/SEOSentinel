/**
 * When a delivered article's exact live URL is checked again (convex/publisher.ts verifyPublicPublicationInternal).
 * Quick checks first, for a site that builds or caches for a few minutes; then a day. A page that loads but shows the
 * wrong article (canonical, title or body) fails on this schedule.
 */
export const PUBLIC_URL_RETRY_DELAYS_MS: readonly number[] = [30_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000,
  3 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];

/**
 * P285 (Nov 3 2026): a whole site can be unreachable for days. pentra.dev and leadpilot.chat answered HTTP 402 for 18+ hours
 * when their hosting account was disabled, and a customer's own host can fail the same way. The check gave up after about
 * 41 hours, and the site's content work then stayed fail-closed ("public_url_failed") with nothing to check it again. When
 * the page cannot be fetched at all (an error status, a timeout), the check keeps going for a week.
 * P286 (Nov 3 2026): every hour after the quick checks, not after gaps of 12 and 24 hours (and then 6), so a site picks up
 * within an hour of coming back: both owner sites' waiting articles were next due 12 to 23 hours after any restore.
 */
export const PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS: readonly number[] = [...PUBLIC_URL_RETRY_DELAYS_MS.slice(0, 6),
  ...Array.from({ length: 167 }, () => 60 * 60_000)];

/**
 * P286: the scheduler's own check of a delivered article still waiting for (or failed) its live check, at most this often
 * per article. It only ever records success, so the retry schedule and its failure keep their meaning, but a page that is
 * live now (the site came back, the owner fixed the build) resumes Autopilot at the next scheduler pass instead of waiting
 * for a check due a day later, or forever once the checks were used up.
 */
export const PUBLIC_URL_PROBE_INTERVAL_MS = 60 * 60_000;

/** P286: how long after its last scheduled check a failed live check is still checked again this way. */
export const PUBLIC_URL_PROBE_AFTER_FAILURE_MS = 30 * 86_400_000;
