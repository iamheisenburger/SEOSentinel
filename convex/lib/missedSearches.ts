/**
 * The free Missed Searches Checker (P122, Oct 20 2026): for any website, the
 * real Google searches its likely customers make that it has no page for and
 * isn't on Google's first two pages for, plus the searches it is close on and
 * the basics Google needs. Pure and deterministic: the action fetches and
 * pays; this decides what is shown. No keyword is ever invented: every search
 * has measured Google demand and difficulty, and a buyer-fit verdict.
 */
import type { BusinessPrefill } from "./sitePrefill.ts";
import { normalizePrefillHost } from "./sitePrefill.ts";
import { contentIntentConflicts, tenantDiscoveryAnchors } from "./autopilotBuffer.ts";
import { normalizeResearchKeyword, searchLikePhrase } from "./researchSeeds.ts";
import type { PageHealthIssue } from "./siteHealth.ts";
import type { BuyerFitBusiness, BuyerFitVerdict } from "./topicFit.ts";

/** A finished check is reused for a week, so a shared link costs nothing. */
export const FREE_CHECK_CACHE_MS = 7 * 86_400_000;
/** A check still running after this is treated as lost and may start again. */
export const FREE_CHECK_RUNNING_MS = 10 * 60_000;
/** A failed check is retried at most hourly. */
export const FREE_CHECK_FAILED_RETRY_MS = 60 * 60_000;
/** New checks per visitor (hashed IP) per day; cached results don't count. */
export const FREE_CHECK_IP_DAILY_LIMIT = 3;
/** Tracking events per visitor per day. */
export const FREE_CHECK_EVENT_DAILY_LIMIT = 30;
/** Hard daily cap on provider spend for all free checks together. */
export const FREE_CHECK_DAILY_CAP_MICRO_USD = 3_000_000;
/** Held per check before any paid call: above its worst case (~$0.10). */
export const FREE_CHECK_RESERVATION_MICRO_USD = 150_000;
/** Searches a site without authority evidence can realistically rank for. */
export const FREE_CHECK_MAX_DIFFICULTY = 30;
export const FREE_CHECK_MAX_MISSED = 20;
export const FREE_CHECK_MAX_ALMOST = 5;
/** Missed searches shown before signup; the rest are counted, not sent. */
export const FREE_CHECK_VISIBLE = 5;

export type MissedSearch = { keyword: string; searchVolume: number; difficulty: number };
export type AlmostSearch = { keyword: string; searchVolume: number; position: number; url: string };
export type RankedKeyword = { keyword: string; searchVolume: number; position: number; url: string };
export type DiscoveredKeyword = { keyword: string; searchVolume: number; difficulty: number; difficultyMeasured?: boolean };

/** The checked website as a bare domain (no www), or null. */
export function freeCheckDomain(input: string): string | null {
  const host = normalizePrefillHost(input);
  return host ? host.replace(/^www\./, "") : null;
}

/** UTC day, used for the daily limits. */
export function freeCheckDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

const TLD_COUNTRY: Record<string, string> = {
  uk: "uk", ca: "ca", au: "au", de: "de", fr: "fr", in: "in", br: "br", jp: "jp", es: "es", it: "it",
  nl: "nl", se: "se", sg: "sg", ae: "ae", mx: "mx",
};
const COUNTRY_NAMES: Record<string, string> = {
  us: "the US", uk: "the UK", ca: "Canada", au: "Australia", de: "Germany", fr: "France", in: "India", br: "Brazil",
  jp: "Japan", es: "Spain", it: "Italy", nl: "the Netherlands", se: "Sweden", sg: "Singapore", ae: "the UAE", mx: "Mexico",
};

/** Where and in which language to measure searches: the country of a
 * country-code domain or of the page's `lang` region, else the US; the
 * page's language, else English. */
export function freeCheckLocale(host: string, htmlLang: string | null): { country: string; countryName: string; language: string } {
  const tld = host.toLowerCase().split(".").pop() ?? "";
  const [base, region] = (htmlLang ?? "").trim().toLowerCase().split(/[-_]/);
  const fromRegion = region === "gb" ? "uk" : region;
  const country = TLD_COUNTRY[tld] ?? (fromRegion && COUNTRY_NAMES[fromRegion] ? fromRegion : "us");
  const language = /^[a-z]{2}$/.test(base ?? "") ? base : "en";
  return { country, countryName: COUNTRY_NAMES[country] ?? "the US", language };
}

/** The `lang` attribute of the page's <html> element. */
export function htmlLang(html: string): string | null {
  return /<html\b[^>]*\blang\s*=\s*["']?([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?)/i.exec(html)?.[1] ?? null;
}

/** Page words a title can carry that never name the business. */
const NOT_A_NAME = /^(?:home|homepage|welcome|index|blog|official site|official website|main page|start)$/i;

/** Words that identify the business itself: its name, and its domain label
 * when that is the name (a generic word domain such as plumbing.com is not). */
export function brandTerms(domain: string, name: string): string[] {
  const label = domain.replace(/^www\./, "").split(".")[0]?.toLowerCase() ?? "";
  const phrase = NOT_A_NAME.test(name.trim()) ? "" : normalizeResearchKeyword(name.replace(/[^\p{L}\p{N}\s-]+/gu, " "));
  const squashed = phrase.replace(/[\s-]+/g, "");
  const terms = new Set<string>();
  if (squashed.length >= 4) terms.add(squashed);
  if (phrase.includes(" ")) terms.add(phrase);
  if (label.length >= 4 && squashed.length >= 4 && (label === squashed || label.startsWith(squashed) || label.endsWith(squashed))) terms.add(label);
  if (!squashed && label.length >= 5) terms.add(label);
  return [...terms];
}

/** A search for the business by name, not a search it could win new customers with. */
export function isBrandedKeyword(keyword: string, brands: string[]): boolean {
  const normalized = normalizeResearchKeyword(keyword);
  const squashed = normalized.replace(/[\s-]+/g, "");
  return brands.some(brand => brand.includes(" ")
    ? ` ${normalized} `.includes(` ${brand} `)
    : normalized.split(/[\s-]+/).includes(brand) || (brand.length >= 6 && squashed.includes(brand)));
}

/** The homepage's product lines: its main heading and the sections it lists. */
function productLines(prefill: Pick<BusinessPrefill, "product">): string[] {
  const [lead, includes] = prefill.product.split(/\s*Includes:\s*/);
  return [lead?.replace(/[.…]+$/, "").trim(), ...(includes ?? "").replace(/[.…]+$/, "").split(/\s*;\s*/)]
    .map(line => (line ?? "").trim()).filter(Boolean);
}

/** Search seeds from the homepage's own words: product lines first, then the
 * description, audience and the questions it answers. Never the brand. */
export function checkSeeds(prefill: Pick<BusinessPrefill, "product" | "summary" | "audience" | "questions">, brands: string[], limit = 10): string[] {
  const anchors = tenantDiscoveryAnchors([...productLines(prefill), prefill.summary, prefill.audience, ...prefill.questions], 60);
  return anchors.filter(phrase => searchLikePhrase(phrase) && !isBrandedKeyword(phrase, brands)).slice(0, limit);
}

/** The business as the buyer-fit check sees it, from its homepage. */
export function checkBusiness(domain: string, prefill: BusinessPrefill): BuyerFitBusiness {
  const lines = productLines(prefill);
  return { name: prefill.name || domain, domain, summary: prefill.summary || lines[0] || undefined,
    audience: prefill.audience || undefined, features: lines.slice(0, 12), problems: prefill.questions.slice(0, 10),
    usage: prefill.product || undefined };
}

/** What the site already covers: the topic words of its page addresses and
 * its homepage title. */
export function siteCoverage(pageUrls: string[], homeTitle: string | null): string[] {
  const phrases = new Set<string>();
  for (const url of pageUrls) {
    try {
      const segment = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
      const phrase = normalizeResearchKeyword(decodeURIComponent(segment).replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_+]+/g, " ")
        .replace(/\b\d+\b/g, " "));
      if (phrase.split(" ").length >= 2) phrases.add(phrase);
    } catch { /* malformed address: covers nothing */ }
  }
  for (const part of (homeTitle ?? "").split(/\s+[|–—:·-]\s+/)) {
    const phrase = normalizeResearchKeyword(part.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " "));
    if (phrase.split(" ").length >= 2) phrases.add(phrase);
  }
  return [...phrases];
}

/** One wording per search: "kiln firing schedules" is "kiln firing schedule". */
function intentKey(keyword: string): string {
  return normalizeResearchKeyword(keyword).split(" ").map(word => word.length > 3 && /[^s]s$/.test(word) ? word.slice(0, -1) : word).join(" ");
}
const sameIntent = (a: string, b: string) => intentKey(a) === intentKey(b) ||
  contentIntentConflicts({ primaryKeyword: normalizeResearchKeyword(a) }, { primaryKeyword: normalizeResearchKeyword(b) });

/** Searches that can't be missed: the brand's own, ones the site already has
 * a page for, ones it is on Google's first two pages for, and fragments. */
export function excludedFromMissed(keyword: string, input: { brands: string[]; coverage: string[]; ranked: RankedKeyword[] }): boolean {
  const normalized = normalizeResearchKeyword(keyword);
  const words = normalized.split(" ");
  return words.length < 2 || normalized.length > 80 || isBrandedKeyword(normalized, input.brands) ||
    input.ranked.some(r => r.position <= 20 && intentKey(r.keyword) === intentKey(normalized)) ||
    input.coverage.some(phrase => sameIntent(normalized, phrase));
}

/** Missed searches: measured demand, measured difficulty a site like this can
 * win, and kept by the buyer-fit check. Most searched first, one per wording. */
export function selectMissedSearches(found: DiscoveredKeyword[], verdicts: Map<string, BuyerFitVerdict>,
  input: { brands: string[]; coverage: string[]; ranked: RankedKeyword[] }): MissedSearch[] {
  const ordered = found
    .filter(k => k.difficultyMeasured === true && k.difficulty <= FREE_CHECK_MAX_DIFFICULTY && k.searchVolume >= 10)
    .filter(k => verdicts.get(normalizeResearchKeyword(k.keyword))?.keep === true && !excludedFromMissed(k.keyword, input))
    .sort((a, b) => b.searchVolume - a.searchVolume || a.difficulty - b.difficulty);
  // One search per intent: a second wording of a kept search is the same page.
  const kept: MissedSearch[] = [];
  for (const k of ordered) {
    const keyword = normalizeResearchKeyword(k.keyword);
    if (kept.some(prior => sameIntent(prior.keyword, keyword))) continue;
    kept.push({ keyword, searchVolume: Math.round(k.searchVolume), difficulty: Math.round(k.difficulty) });
    if (kept.length >= FREE_CHECK_MAX_MISSED) break;
  }
  return kept;
}

/** Searches the site is close on: positions 4 to 20, where improving the page
 * that ranks can reach the top three. Not the brand; kept by buyer fit. */
export function selectAlmostThere(ranked: RankedKeyword[], verdicts: Map<string, BuyerFitVerdict>, brands: string[]): AlmostSearch[] {
  const seen = new Set<string>();
  return ranked
    .filter(r => r.position >= 4 && r.position <= 20 && r.searchVolume >= 10 && !isBrandedKeyword(r.keyword, brands) &&
      verdicts.get(normalizeResearchKeyword(r.keyword))?.keep === true)
    .sort((a, b) => b.searchVolume - a.searchVolume || a.position - b.position)
    .filter(r => { const key = intentKey(r.keyword); if (seen.has(key)) return false; seen.add(key); return true; })
    .slice(0, FREE_CHECK_MAX_ALMOST)
    .map(r => ({ keyword: normalizeResearchKeyword(r.keyword), searchVolume: Math.round(r.searchVolume), position: Math.round(r.position), url: r.url }));
}

/** The basics Google needs, checked on the homepage. Each finding belongs to
 * one check; the summary counts the checks that passed and lists every
 * finding, most serious first. */
const HEALTH_CHECKS: Record<string, string> = {
  robots_blocks_all: "crawl", ai_answers_blocked: "ai", sitemap_missing: "sitemap", noindex: "index",
  title_missing: "title", title_short: "title", title_long: "title",
  description_missing: "description", description_short: "description", description_long: "description",
  h1_missing: "heading", h1_multiple: "heading", thin_text: "text",
  canonical_other: "canonical", home_canonical_missing: "canonical", no_internal_links: "links",
  schema_missing: "schema", soft_404: "not_found", host_redirect_temporary: "host",
};
export const FREE_CHECK_HEALTH_CHECKS = new Set(Object.values(HEALTH_CHECKS)).size;
export function healthSummary(issues: PageHealthIssue[]): { passed: number; total: number; issues: PageHealthIssue[] } {
  const known = issues.filter((issue, i) => HEALTH_CHECKS[issue.code] && issues.findIndex(other => other.code === issue.code) === i);
  const failed = new Set(known.map(issue => HEALTH_CHECKS[issue.code]));
  const sorted = [...known].sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"));
  return { passed: FREE_CHECK_HEALTH_CHECKS - failed.size, total: FREE_CHECK_HEALTH_CHECKS, issues: sorted };
}

export type FreeCheckRow = {
  domain: string;
  status: "running" | "done" | "failed";
  step?: string;
  error?: string;
  requestedAt: number;
  completedAt?: number;
  businessName?: string;
  countryName?: string;
  missed?: MissedSearch[];
  almost?: AlmostSearch[];
  health?: { passed: number; total: number; issues: PageHealthIssue[] };
  keywordsUnavailable?: boolean;
};

/** What a visitor sees. Signed out: the first missed searches and the count
 * of the rest (their wording is never sent). Signed in: all of them. */
export function freeCheckView(row: FreeCheckRow, signedIn: boolean) {
  const missed = row.missed ?? [];
  const shown = signedIn ? missed : missed.slice(0, FREE_CHECK_VISIBLE);
  return {
    domain: row.domain, status: row.status, step: row.step ?? null, error: row.error ?? null,
    requestedAt: row.requestedAt, completedAt: row.completedAt ?? null,
    businessName: row.businessName ?? null, countryName: row.countryName ?? null,
    missed: shown, hiddenCount: missed.length - shown.length, totalMissed: missed.length,
    monthlySearches: missed.reduce((sum, k) => sum + k.searchVolume, 0),
    almost: row.almost ?? [], health: row.health ?? null, keywordsUnavailable: row.keywordsUnavailable === true,
  };
}
