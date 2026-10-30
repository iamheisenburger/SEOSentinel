/** P249 (Oct 30 2026): the first article on a new user's Next.js blog kept one source and named no API ("check the
 * current Next.js documentation"): each source kept only 300 characters around its cited quote, so the API names,
 * options and steps next to it never reached the writer. Official documentation now keeps a wider passage. */
export const EVIDENCE_EXCERPT_MAX_CHARS = 6000;
const DOC_WINDOW_CHARS = 1200, QUOTE_WINDOW_CHARS = 300, QUOTE_EXCERPT_MAX_CHARS = 2500;

/** The most evidence one source contributes. */
export function excerptLimit(docs: boolean): number {
  return docs ? EVIDENCE_EXCERPT_MAX_CHARS : QUOTE_EXCERPT_MAX_CHARS;
}

/** The passage of a fetched page kept as evidence: the text around each cited quote, wider for documentation; null
 * when no quote is found on the page. */
export function pageExcerpt(page: string, quotes: string[], docs: boolean): string | null {
  const reach = docs ? DOC_WINDOW_CHARS : QUOTE_WINDOW_CHARS, windows: string[] = [];
  for (const quote of quotes) {
    const probe = quote.slice(0, 60).toLowerCase(), at = page.toLowerCase().indexOf(probe);
    if (at >= 0) windows.push(page.slice(Math.max(0, at - reach), Math.min(page.length, at + quote.length + reach)).trim());
  }
  return windows.length ? windows.join(" … ").slice(0, excerptLimit(docs)) : null;
}
