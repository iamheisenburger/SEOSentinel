/** P249 (Oct 30 2026): the first article on a new user's Next.js blog kept one source and named no API ("check the
 * current Next.js documentation"): each source kept only 300 characters around its cited quote, so the API names,
 * options and steps next to it never reached the writer. Official documentation now keeps a wider passage. */
export const EVIDENCE_EXCERPT_MAX_CHARS = 6000;
const DOC_WINDOW_CHARS = 1200, QUOTE_WINDOW_CHARS = 300, QUOTE_EXCERPT_MAX_CHARS = 2500;

/** The most evidence one source contributes. */
export function excerptLimit(docs: boolean): number {
  return docs ? EVIDENCE_EXCERPT_MAX_CHARS : QUOTE_EXCERPT_MAX_CHARS;
}

/** P263 (Oct 31 2026): where a cited quote is on the page. The API's cited text keeps the page's markdown ("- **Converting
 * from one type of water heater…**"), typographic quotes and line breaks, and the fetched page text has none of them, so a
 * quote is also found by its first words in order with any punctuation, markup or spacing between them. Live trial: a
 * local-service article kept 2 sources because quotes like that never matched, their excerpts stayed under 160 characters
 * and their sources were dropped; the next run of the same search, whose quotes happened to match, kept 4. */
export function quoteAt(page: string, quote: string): { at: number; length: number } | null {
  const exact = page.toLowerCase().indexOf(quote.slice(0, 60).toLowerCase());
  if (exact >= 0) return { at: exact, length: quote.length };
  const words = quote.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length < 4) return null;
  const probe = words.slice(0, 8).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^\\p{L}\\p{N}]+");
  const match = new RegExp(probe, "iu").exec(page);
  return match ? { at: match.index, length: Math.max(match[0].length, quote.length) } : null;
}

/** The passage of a fetched page kept as evidence: the text around each cited quote, wider for documentation; null
 * when no quote is found on the page. */
export function pageExcerpt(page: string, quotes: string[], docs: boolean): string | null {
  const reach = docs ? DOC_WINDOW_CHARS : QUOTE_WINDOW_CHARS, windows: string[] = [];
  for (const quote of quotes) {
    const found = quoteAt(page, quote);
    if (found) windows.push(page.slice(Math.max(0, found.at - reach), Math.min(page.length, found.at + found.length + reach)).trim());
  }
  return windows.length ? windows.join(" … ").slice(0, excerptLimit(docs)) : null;
}
