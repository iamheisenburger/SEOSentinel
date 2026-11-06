/** Phase 4 (Nov 2026), earned links: which competitors' links to mine. The weekly diagnosis knows who holds page one for the
 * site's main searches (its page-one check); the pages that link to the strongest-but-reachable of them, and not to the
 * site, are the likeliest to link to it too (convex/lib/linkOutreach.ts finds them with one DataForSEO page-intersection
 * request, ~$0.025). Nothing runs until the owner turns link building on (site.linkOutreach). Pure. */
import { isEntrenchedHost } from "./serpAttainability.ts";

export const LINK_COMPETITORS = 3;
/** A competitor this strong still has a link profile worth mining; a mega-site's links are mostly unreachable. */
export const LINK_COMPETITOR_MAX_RANK = 80;

const host = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/:?#].*$/, "");

/** Forums, social networks, marketplaces and wikis: never a competitor whose links are worth mining. */
export const NOT_A_COMPETITOR = /(^|\.)(reddit|quora|facebook|instagram|linkedin|x|twitter|youtube|tiktok|pinterest|medium|substack|wikipedia|github|stackoverflow|stackexchange|producthunt|g2|capterra|trustpilot|getapp|softwareadvice|amazon|ebay|etsy|blackhatworld|warriorforum|indiehackers|ycombinator)\.[a-z.]+$/;

/** The competitors whose links to mine. First the competitors the owner confirmed in the site's profile (the businesses
 * buyers compare it with), then the domains most often on page one for the site's main searches, strongest first (a
 * stronger site has more links to mine): never a big publisher, a forum or platform, the site itself, or one far
 * stronger than LINK_COMPETITOR_MAX_RANK. P374: the weakest-first order picked sites with almost no links (LeadPilot's
 * search found nothing), and a forum was picked as a competitor (pentra.dev). */
export function linkCompetitors(pageOne: ReadonlyArray<{ domains?: ReadonlyArray<{ domain: string; rank: number | null }> }>, siteDomain: string,
  max = LINK_COMPETITORS, profile: readonly string[] = []): string[] {
  const own = host(siteDomain), out: string[] = [];
  const usable = (domain: string) => domain && /\.[a-z]{2,}$/.test(domain) && domain !== own && !domain.endsWith(`.${own}`) && !isEntrenchedHost(domain) &&
    !NOT_A_COMPETITOR.test(domain) && !out.includes(domain);
  for (const raw of profile) { const domain = host(raw); if (usable(domain)) out.push(domain); }
  const seen = new Map<string, { count: number; rank: number }>();
  for (const check of pageOne) for (const d of check.domains ?? []) {
    const domain = host(d.domain);
    if (!usable(domain) || d.rank === null || d.rank > LINK_COMPETITOR_MAX_RANK) continue;
    const entry = seen.get(domain) ?? { count: 0, rank: d.rank };
    entry.count++; seen.set(domain, entry);
  }
  out.push(...[...seen].sort((a, b) => b[1].count - a[1].count || b[1].rank - a[1].rank || a[0].localeCompare(b[0])).map(([domain]) => domain));
  return out.slice(0, max);
}

/** P374: which pairs of competitors to ask about. Pages linking to two competitors are plentiful; pages linking to all
 * three are rare (LeadPilot's three-way request came back empty). Up to three pairs from the first three. */
export function competitorPairs(competitors: readonly string[]): string[][] {
  const [a, b, c] = competitors;
  return [[a, b], [a, c], [b, c]].filter((pair) => pair.every(Boolean)) as string[][];
}
