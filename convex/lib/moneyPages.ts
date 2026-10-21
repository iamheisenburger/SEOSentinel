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
