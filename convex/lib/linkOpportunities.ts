/** Phase 4 (Nov 2026), earned links: which competitors' links to mine. The weekly diagnosis knows who holds page one for the
 * site's main searches (its page-one check); the pages that link to the strongest-but-reachable of them, and not to the
 * site, are the likeliest to link to it too (convex/lib/linkOutreach.ts finds them with one DataForSEO page-intersection
 * request, ~$0.025). Nothing runs until the owner turns link building on (site.linkOutreach). Pure. */
import { isEntrenchedHost } from "./serpAttainability.ts";

export const LINK_COMPETITORS = 3;
/** A competitor this strong still has a link profile worth mining; a mega-site's links are mostly unreachable. */
export const LINK_COMPETITOR_MAX_RANK = 80;

const host = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/:?#].*$/, "");

/** The competitors whose links to mine: the domains most often on page one for the site's main searches (the diagnosis's
 * page-one checks), never a big publisher, the site itself, or one far stronger than LINK_COMPETITOR_MAX_RANK. */
export function linkCompetitors(pageOne: ReadonlyArray<{ domains?: ReadonlyArray<{ domain: string; rank: number | null }> }>, siteDomain: string,
  max = LINK_COMPETITORS): string[] {
  const own = host(siteDomain), seen = new Map<string, { count: number; rank: number }>();
  for (const check of pageOne) for (const d of check.domains ?? []) {
    const domain = host(d.domain);
    if (!domain || domain === own || domain.endsWith(`.${own}`) || isEntrenchedHost(domain) || d.rank === null || d.rank > LINK_COMPETITOR_MAX_RANK) continue;
    const entry = seen.get(domain) ?? { count: 0, rank: d.rank };
    entry.count++; seen.set(domain, entry);
  }
  return [...seen].sort((a, b) => b[1].count - a[1].count || a[1].rank - b[1].rank || a[0].localeCompare(b[0])).slice(0, max).map(([domain]) => domain);
}
