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
 * the page cannot be fetched at all (an error status, a timeout), the check keeps going every 6 hours for a week, so the
 * site picks up again within hours of coming back.
 */
export const PUBLIC_URL_OUTAGE_RETRY_DELAYS_MS: readonly number[] = [...PUBLIC_URL_RETRY_DELAYS_MS,
  ...Array.from({ length: 22 }, () => 6 * 3_600_000)];
