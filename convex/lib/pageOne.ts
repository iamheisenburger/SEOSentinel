/** Phase 2 (Nov 2026), topic choice: Pentra writes only for searches a site can win, judged on Google's real page one,
 * that buyers make, one page per search intent, and not in a group of searches Google already ignores for this site.
 *
 * Why (measured by the weekly diagnosis, Nov 5 2026): LeadPilot (authority 4 of 100) had 0 reachable results on page one
 * for each of its five main searches (page one's median authority 40-75); pentra.dev (authority 0) got 85% of its
 * impressions past page 2; 55 of LeadPilot's 104 articles and 15 of pentra.dev's 18 got no impressions in 28 days. Topics
 * were judged by keyword difficulty against a ceiling, never against the sites actually on page one, and no planned topic
 * carried its page one, so the result-overlap duplicate check never ran.
 *
 * The rule (ported from the redesign's rankability step): page one must already hold at least MIN_REACHABLE results from
 * domains within RANK_MARGIN points of the site's authority that are not entrenched publishers, and entrenched publishers
 * may hold at most half of page one. An unmeasured authority is never assumed weak. A search the site already appears for
 * at PROVEN_POSITION or better is winnable on Google's own evidence. Pure. */
import { getDomain } from "tldts";
import { evaluateSerpAttainability, isEntrenchedHost } from "./serpAttainability.ts";
import { PAGE_ONE_CHECK_VERSION, type PageOneVerdict } from "./topicVerdict.ts";
export * from "./topicVerdict.ts";

export const RANK_MARGIN = 10;
export const MIN_REACHABLE = 2;
const MIN_MEASURED = 5;
/** Searches checked per run: each is one live results page ($0.002) plus authorities for its new domains. */
export const PAGE_ONE_CHECKS_PER_RUN = 12;

export function hostOf(value: string): string {
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}
/** The registrable domain ("blog.hubspot.com" → "hubspot.com", "shop.example.co.uk" → "example.co.uk"). */
export function registrableDomain(value: string): string {
  const host = hostOf(value);
  return host ? (getDomain(host) ?? host).replace(/^www\./, "") : "";
}

export type PageOneResult = { url: string; domain: string; authority: number | null; entrenched: boolean; reachable: boolean };
export type Rankability = {
  rankable: boolean; reason: string; siteAuthority: number | null; pageOne: PageOneResult[]; reachable: number; measured: number;
  entrenchedRatio: number; medianAuthority: number | null;
  /** Where this site would land on today's authority alone: 1 + the page-one results stronger than it (not capped at 10). */
  projectedPosition: number | null;
};

/** Authorities are keyed by host or registrable domain (DataForSEO answers per host; a subdomain carries its domain's rank). */
const authorityOf = (authorities: ReadonlyMap<string, number>, url: string) =>
  authorities.get(hostOf(url)) ?? authorities.get(registrableDomain(url)) ?? null;

export function rankability(args: { results: readonly { url: string }[]; siteDomain: string; siteAuthority: number | null;
  authorities: ReadonlyMap<string, number>; margin?: number; minReachable?: number }): Rankability {
  const margin = args.margin ?? RANK_MARGIN, minReachable = args.minReachable ?? MIN_REACHABLE;
  const site = registrableDomain(args.siteDomain);
  const top = args.results.filter((r) => registrableDomain(r.url) !== site).slice(0, 10);
  const attainability = evaluateSerpAttainability({ serpTopUrls: top.map((r) => r.url), siteHost: site });
  const pageOne: PageOneResult[] = top.map((r) => {
    const domain = registrableDomain(r.url);
    const authority = authorityOf(args.authorities, r.url);
    const entrenched = isEntrenchedHost(hostOf(r.url)) || isEntrenchedHost(domain);
    const reachable = args.siteAuthority !== null && authority !== null && !entrenched && authority <= args.siteAuthority + margin;
    return { url: r.url, domain, authority, entrenched, reachable };
  });
  const measuredRanks = pageOne.map((p) => p.authority).filter((a): a is number => a !== null).sort((a, b) => a - b);
  const medianAuthority = measuredRanks.length ? measuredRanks[Math.floor(measuredRanks.length / 2)] : null;
  const reachable = pageOne.filter((p) => p.reachable).length;
  const projectedPosition = args.siteAuthority === null ? null : 1 + pageOne.filter((p) => !p.reachable).length;
  const base = { siteAuthority: args.siteAuthority, pageOne, reachable, measured: measuredRanks.length, entrenchedRatio: attainability.entrenchedRatio,
    medianAuthority, projectedPosition };
  if (!top.length) return { ...base, rankable: false, reason: "no live results page to judge" };
  if (args.siteAuthority === null) return { ...base, rankable: false, reason: "the site's own authority is not measured" };
  if (measuredRanks.length < Math.min(MIN_MEASURED, top.length)) return { ...base, rankable: false, reason: `only ${measuredRanks.length} of ${top.length} page-one authorities measured` };
  if (!attainability.attainable) return { ...base, rankable: false, reason: attainability.reasons[0] ?? "entrenched publishers hold page one" };
  if (reachable < minReachable) {
    return { ...base, rankable: false, reason: `page one is held by sites far stronger than this one: ${reachable} of ${top.length} results within ${margin} points of its authority ${args.siteAuthority} (median ${medianAuthority})` };
  }
  return { ...base, rankable: true, reason: `${reachable} of ${top.length} page-one results come from sites within ${margin} points of its authority ${args.siteAuthority} (median ${medianAuthority})` };
}

export function pageOneVerdict(r: Rankability, checkedAt: number): PageOneVerdict {
  return { version: PAGE_ONE_CHECK_VERSION, checkedAt, rankable: r.rankable, reason: r.reason.slice(0, 300), siteAuthority: r.siteAuthority,
    reachable: r.reachable, measured: r.measured, results: r.pageOne.length, medianAuthority: r.medianAuthority };
}

// ── Groups of searches Google already ignores for this site (the brake) ──

const STOP = new Set(["a", "an", "and", "are", "as", "at", "best", "by", "can", "do", "does", "for", "free", "from", "guide", "how", "in", "is", "it",
  "of", "on", "or", "the", "to", "top", "vs", "what", "when", "where", "which", "who", "why", "with", "your", "you", "2024", "2025", "2026"]);
/** The words that say what a search is about (lowercase, no filler, plurals folded). */
export function subjectWords(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => w.length > 4 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !/(?:ss|us|is|os|as)$/.test(w) ? w.slice(0, -1) : w))];
}

/** Two searches are in one group when they share at least two subject words and those cover most of the shorter one. */
export function sameGroup(a: string, b: string): boolean {
  const left = subjectWords(a), right = new Set(subjectWords(b));
  if (left.length === 0 || right.size === 0) return false;
  const shared = left.filter((w) => right.has(w)).length;
  return shared >= 2 && shared / Math.min(left.length, right.size) >= 0.6;
}

export const BRAKE_MIN_ARTICLES = 3;
export const BRAKE_MIN_AGE_MS = 28 * 86_400_000;
export type BrakeArticle = { subject: string; publishedAt: number; impressions: number };

/** The brake: a search is not written while the site already has BRAKE_MIN_ARTICLES or more settled articles in its
 * group and Google showed none of them in 28 days. Another article on the same subject would join them; the group gets
 * new articles again once one of them is shown (the next check sees it). */
export function groupBrake(keyword: string, articles: readonly BrakeArticle[], now: number): { braked: boolean; reason: string; group: number } {
  const group = articles.filter((a) => sameGroup(keyword, a.subject));
  const settled = group.filter((a) => now - a.publishedAt >= BRAKE_MIN_AGE_MS);
  const shown = settled.reduce((sum, a) => sum + a.impressions, 0);
  if (settled.length >= BRAKE_MIN_ARTICLES && shown === 0) {
    return { braked: true, group: group.length, reason: `${settled.length} articles on this subject got no impressions in 28 days` };
  }
  return { braked: false, group: group.length, reason: "" };
}
