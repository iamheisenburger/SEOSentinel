import { shownPositionWeight } from "./articleRefresh.ts";

/** The weekly "money page" rule: pages already ranking on positions 4-20
 * (bottom of page one / top of page two) are the cheapest to lift, so Pentra
 * looks at them before anything else; pages Google shows at 21-50 follow, their
 * impressions discounted by distance (P142, Oct 21 2026: they were never
 * looked at first, so a refresh of one waited behind any page with a single
 * page-one impression). Pure so it can be tested directly. */
export const nearPageOne = (row: { position?: number }) =>
  typeof row.position === "number" && row.position >= 4 && row.position <= 20;

export function moneyPagesFirst<P extends { url?: string }, R extends { page?: string; position?: number; impressions: number }>(
  pages: P[], rows: R[]): P[] {
  const score = (page: P) => rows.reduce((sum, r) => sum + (r.page === page.url && typeof r.position === "number" ? r.impressions * shownPositionWeight(r.position) : 0), 0);
  return pages.map((page, index) => ({ page, index, score: score(page) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.page);
}

/** Phase 3 (Nov 2026): a page whose readers are mostly not buyers, by the weekly diagnosis's reader labels for its searches
 * (convex/lib/searchIntent.ts): NON_BUYER_MIN_LABELED or more impressions from labeled searches, and NON_BUYER_SHARE or
 * more of them from searches labeled for someone else (learners, job seekers, developers, another product, navigation).
 * LeadPilot's page-one impressions were 86% non-buyers; its improvement slots went to job-title pages. Unlabeled searches
 * count for nothing either way. */
export const NON_BUYER_SHARE = 0.7, NON_BUYER_MIN_LABELED = 20;
export function mostlyNonBuyerReaders(pageUrl: string, rows: readonly { page?: string; query: string; impressions: number }[],
  labels: ReadonlyMap<string, string>): boolean {
  let labeled = 0, other = 0;
  for (const r of rows) {
    if (r.page !== pageUrl) continue;
    const label = labels.get(r.query.trim().toLowerCase());
    if (!label) continue;
    labeled += r.impressions;
    if (label !== "buyer") other += r.impressions;
  }
  return labeled >= NON_BUYER_MIN_LABELED && other / labeled >= NON_BUYER_SHARE;
}
