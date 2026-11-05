/** Phase 4 (Nov 2026), earned links, step one: the sites that link to a site's page-one competitors but not to the site.
 * They already link to pages like the site's, on its subject, so they are the likeliest to link to it too. The weekly
 * diagnosis already knows who holds page one for the site's main searches (its page-one check); one DataForSEO "domain
 * intersection" request (about $0.025) returns the referring domains that link to all the chosen competitors and not to the
 * site. Nothing runs, and nobody is contacted, until the owner turns it on (site.linkOutreach): Arshad's rule is that Pentra
 * never contacts real people without his yes (plan: ops/PHASE-4-EARNED-LINKS.md). Pure. */
import { isEntrenchedHost } from "./serpAttainability.ts";

export const LINK_COMPETITORS = 3;
/** A competitor this strong still has a link profile worth mining; a mega-site's links are mostly unreachable. */
export const LINK_COMPETITOR_MAX_RANK = 80;
/** Referring domains worth an approach: not spam (rank 5+, spam score 30 or less), not a giant (rank 85 or less). */
export const OPPORTUNITY_MIN_RANK = 5, OPPORTUNITY_MAX_RANK = 85, OPPORTUNITY_MAX_SPAM = 30;
export const OPPORTUNITIES_PER_RUN = 50;

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

/** One DataForSEO request: the referring domains linking to every competitor (live links) and not to the site. */
export function domainIntersectionRequest(competitors: readonly string[], siteDomain: string) {
  return [{ targets: Object.fromEntries(competitors.map((c, i) => [String(i + 1), c])), exclude_targets: [host(siteDomain)],
    intersection_mode: "all", include_subdomains: true, exclude_internal_backlinks: true, backlinks_status_type: "live", rank_scale: "one_hundred",
    limit: OPPORTUNITIES_PER_RUN, order_by: ["1.rank,desc"] }];
}

export type LinkOpportunity = { domain: string; rank: number; linksTo: string[] };

/** The answer's referring domains worth an approach (DataForSEO: tasks[0].result[0].items[].domain_intersection["1".."n"]). */
export function parseDomainIntersection(data: unknown, competitors: readonly string[], siteDomain: string): LinkOpportunity[] {
  const own = host(siteDomain);
  const items = ((data as { tasks?: Array<{ result?: Array<{ items?: unknown[] }> }> } | null)?.tasks?.[0]?.result?.[0]?.items ?? []) as unknown[];
  const out = new Map<string, LinkOpportunity>();
  for (const item of items) {
    const byTarget = (item as { domain_intersection?: Record<string, { target?: unknown; rank?: unknown; backlinks_spam_score?: unknown }> } | null)?.domain_intersection;
    if (!byTarget || typeof byTarget !== "object") continue;
    const entries = Object.entries(byTarget);
    const first = entries[0]?.[1];
    const domain = typeof first?.target === "string" ? host(first.target) : "";
    if (!domain || domain === own || domain.endsWith(`.${own}`) || /^\d+\.\d+\.\d+\.\d+$/.test(domain) || isEntrenchedHost(domain)) continue;
    const rank = Math.max(...entries.map(([, v]) => typeof v?.rank === "number" ? v.rank : -1));
    const spam = Math.max(...entries.map(([, v]) => typeof v?.backlinks_spam_score === "number" ? v.backlinks_spam_score : 0));
    if (rank < OPPORTUNITY_MIN_RANK || rank > OPPORTUNITY_MAX_RANK || spam > OPPORTUNITY_MAX_SPAM) continue;
    const linksTo = entries.map(([key]) => competitors[Number(key) - 1]).filter((c): c is string => Boolean(c));
    if (!out.has(domain)) out.set(domain, { domain, rank, linksTo });
  }
  return [...out.values()].sort((a, b) => b.rank - a.rank || a.domain.localeCompare(b.domain));
}
