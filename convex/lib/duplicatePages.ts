/** Duplicate pages, measured (Nov 2026). Two of a site's pages are duplicates when Google shows them for the same
 * searches: they split the clicks and links one page would earn, and Google keeps swapping which one it ranks. The
 * measure is Search Console's own, never a guess from titles (titles share filler words: "A Practical Framework for B2B
 * Teams" would pair a lead scoring guide with a qualification checklist). For each search both pages appeared for, the
 * smaller of their two impression counts is shared; the overlap is the shared total as a share of the smaller page's
 * impressions. On LeadPilot's real data (Nov 5 2026) its three "lead scoring system" articles overlapped 0.47 to 0.53
 * with one another, and every other pair of its 19 measurable pages was at 0.29 or below, most under 0.1.
 *
 * A merge sends the weaker page to the stronger one with a permanent redirect: the page with more clicks, then the one
 * Google ranks higher on the searches they share, then the one with more impressions.
 */

import type { GscRow } from "./siteDiagnosis.ts";
import { isBrandedSearchQuery } from "./searchPerformance.ts";

/** A page's address as one key (no protocol, www, query or trailing slash), as the diagnosis keys pages. */
const normalize = (url: string) => url.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** A slug as Pentra's redirects store it: no leading or trailing slash. */
export const slugKey = (slug: string) => slug.trim().replace(/^\/+|\/+$/g, "");

/** Pages count as duplicates at this overlap or more. */
export const MERGE_MIN_OVERLAP = 0.4;
/** ...and with at least this many shared impressions, so a handful of impressions never decides anything. */
export const MERGE_MIN_SHARED_IMPRESSIONS = 20;
/** A page needs this many impressions in the window before its overlap means anything. */
export const MERGE_MIN_PAGE_IMPRESSIONS = 20;
/** At most this many merges a week, so a site never changes all at once. */
export const MAX_MERGES_PER_RUN = 5;

export type PageSearches = {
  url: string;
  clicks: number;
  impressions: number;
  /** Per search: its impressions on this page and the page's impression-weighted position. */
  queries: ReadonlyMap<string, { impressions: number; position: number }>;
};
export type DuplicatePair = { a: PageSearches; b: PageSearches; overlap: number; shared: number; searches: string[] };
export type Merge = { from: string; to: string; overlap: number; shared: number; searches: string[]; fromPosition: number; toPosition: number };

export function searchOverlap(a: PageSearches, b: PageSearches): { overlap: number; shared: number; searches: string[] } {
  let shared = 0;
  const both: Array<[string, number]> = [];
  for (const [query, x] of a.queries) {
    const y = b.queries.get(query);
    if (!y) continue;
    const common = Math.min(x.impressions, y.impressions);
    shared += common;
    both.push([query, common]);
  }
  const smaller = Math.min(a.impressions, b.impressions);
  return { overlap: smaller > 0 ? shared / smaller : 0, shared,
    searches: both.sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0])).map(([query]) => query) };
}

/** Every pair of pages Google shows for the same searches, most shared first. */
export function duplicatePairs(pages: readonly PageSearches[]): DuplicatePair[] {
  const measurable = pages.filter((p) => p.impressions >= MERGE_MIN_PAGE_IMPRESSIONS);
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < measurable.length; i++) {
    for (let j = i + 1; j < measurable.length; j++) {
      const o = searchOverlap(measurable[i], measurable[j]);
      if (o.overlap >= MERGE_MIN_OVERLAP && o.shared >= MERGE_MIN_SHARED_IMPRESSIONS) pairs.push({ a: measurable[i], b: measurable[j], ...o });
    }
  }
  return pairs.sort((x, y) => y.shared - x.shared || x.a.url.localeCompare(y.a.url));
}

/** Where a page ranks on the given searches (impression-weighted); Infinity when it has none of them. */
export function rankOn(page: PageSearches, searches: Iterable<string>): number {
  let impressions = 0, weighted = 0;
  for (const query of searches) {
    const x = page.queries.get(query);
    if (x) { impressions += x.impressions; weighted += x.position * x.impressions; }
  }
  return impressions ? weighted / impressions : Infinity;
}

/** The merges to make among the pages that may be merged: each group of duplicates goes to its strongest page. A page is
 * merged only into a page it directly duplicates (never through a third page), and two pages that both rank on page one
 * for the searches they share stay: two results on page one is a win, not a split. */
export function planMerges(pages: readonly PageSearches[], mayMerge: (url: string) => boolean, limit = MAX_MERGES_PER_RUN): Merge[] {
  const pairs = duplicatePairs(pages.filter((p) => mayMerge(p.url)));
  const parent = new Map<string, string>();
  const root = (url: string): string => {
    const up = parent.get(url);
    if (!up || up === url) return url;
    const top = root(up);
    parent.set(url, top);
    return top;
  };
  for (const { a, b } of pairs) {
    const ra = root(a.url), rb = root(b.url);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const groups = new Map<string, PageSearches[]>();
  for (const { a, b } of pairs) {
    for (const page of [a, b]) {
      const group = groups.get(root(page.url)) ?? [];
      if (!group.includes(page)) group.push(page);
      groups.set(root(page.url), group);
    }
  }
  const merges: Merge[] = [];
  for (const members of groups.values()) {
    const contested = new Set<string>();
    for (const pair of pairs) if (members.includes(pair.a) && members.includes(pair.b)) for (const query of pair.searches) contested.add(query);
    const strongest = [...members].sort((x, y) => y.clicks - x.clicks || rankOn(x, contested) - rankOn(y, contested) ||
      y.impressions - x.impressions || x.url.localeCompare(y.url))[0];
    for (const page of members) {
      if (page === strongest) continue;
      const pair = pairs.find((p) => (p.a === page && p.b === strongest) || (p.b === page && p.a === strongest));
      if (!pair) continue;
      const fromPosition = rankOn(page, pair.searches), toPosition = rankOn(strongest, pair.searches);
      if (fromPosition <= 10 && toPosition <= 10) continue;
      merges.push({ from: page.url, to: strongest.url, overlap: pair.overlap, shared: pair.shared, searches: pair.searches.slice(0, 3),
        fromPosition, toPosition });
    }
  }
  return merges.sort((x, y) => y.shared - x.shared || x.from.localeCompare(y.from)).slice(0, limit);
}

/** The searches a merged page was shown for that the page it joins was not (at least 5 impressions, most first): the
 * ground the kept page should cover once the merged page redirects to it (Pentra's page improvement writes a section for
 * each, convex/selectedPages.ts). */
export function foldQuestionsFor(gsc: readonly GscRow[], from: string, to: string, domain: string, limit = 3): string[] {
  const shownFor = (url: string) => {
    const totals = new Map<string, number>();
    for (const r of gsc) if (r.page && normalize(r.page) === normalize(url) && !isBrandedSearchQuery(r.query, domain))
      totals.set(r.query, (totals.get(r.query) ?? 0) + r.impressions);
    return totals;
  };
  const kept = shownFor(to);
  return [...shownFor(from)].filter(([query, n]) => n >= 5 && !kept.has(query)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit).map(([query]) => query);
}
