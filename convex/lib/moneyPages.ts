/** The weekly "money page" rule: pages already ranking on positions 4-20
 * (bottom of page one / top of page two) are the cheapest to lift, so Pentra
 * looks at them before anything else. Pure so it can be tested directly. */
export const nearPageOne = (row: { position?: number }) =>
  typeof row.position === "number" && row.position >= 4 && row.position <= 20;

export function moneyPagesFirst<P extends { url?: string }, R extends { page?: string; position?: number; impressions: number }>(
  pages: P[], rows: R[]): P[] {
  const score = (page: P) => rows.reduce((sum, r) => sum + (r.page === page.url && nearPageOne(r) ? r.impressions : 0), 0);
  return pages.map((page, index) => ({ page, index, score: score(page) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).map(entry => entry.page);
}
