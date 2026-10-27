export type EvidenceSourceTier = "primary" | "official-doc" | "secondary" | "invalid";

export type EvidenceSourceQuality = {
  url?: string;
  tier: EvidenceSourceTier;
  strictEligible: boolean;
  reason: string;
};

const TRACKING_PARAMETERS = new Set([
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
]);

const PRIMARY_HOSTS = [
  "arxiv.org",
  "doi.org",
  "dl.acm.org",
  "ieeexplore.ieee.org",
  "ncbi.nlm.nih.gov",
  "nber.org",
  "oecd.org",
  "pubmed.ncbi.nlm.nih.gov",
  "researchgate.net",
  "sciencedirect.com",
  "ssrn.com",
  "worldbank.org",
];

const STANDARDS_AND_OFFICIAL_HOSTS = [
  "developers.google.com",
  "ietf.org",
  "iso.org",
  "support.google.com",
  "w3.org",
];

export const STRICT_EVIDENCE_SEARCH_DOMAINS = [
  ...PRIMARY_HOSTS,
  ...STANDARDS_AND_OFFICIAL_HOSTS,
];

const LOW_AUTHORITY_HOSTS = [
  "blogspot.com",
  "linkedin.com",
  "medium.com",
  "reddit.com",
  "substack.com",
  "wordpress.com",
  "x.com",
  "youtube.com",
];

function matchesHost(host: string, expected: string): boolean {
  return host === expected || host.endsWith(`.${expected}`);
}

function matchesAnyHost(host: string, expected: string[]): boolean {
  return expected.some((candidate) => matchesHost(host, candidate));
}

export function normalizeEvidenceUrl(value: string): string | null {
  if (/https?:\/\/https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return null;
    }

    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMETERS.has(key.toLowerCase())) {
        parsed.searchParams.delete(key);
      }
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * P231 (Oct 27 2026): a search that asks for a kind of product ("free ai tools for seo optimization", "lead scoring
 * solutions", "best crm for realtors", "blog publishing services"). Its reader wants the products named, so the article
 * names them, with facts only from cited sources. P162 (Oct 22) let an article name another company only when the
 * search named it: pentra.dev's Oct 27 article for "free ai tools for seo optimization" named no tool at all, while its
 * one growing page (25 → 72 impressions a week, written in July) has a section for each of five tools it names.
 */
const PRODUCT_KINDS = /\b(?:tools?|software|apps?|applications|platforms?|solutions|services|providers?|vendors?|plugins?|extensions|generators?|crms?)\b/i;
export function searchAsksForProducts(search: string | undefined): boolean {
  return PRODUCT_KINDS.test(search ?? "");
}

/** The writer's rule for naming other companies and products, for this search. */
export function otherCompaniesRule(search: string | undefined): string {
  return searchAsksForProducts(search)
    ? `- OTHER COMPANIES: This search asks for a kind of product (“${(search ?? "").trim()}”), so name the specific products a reader would compare, with a clear section or table row for each that says what it is for. Every fact about a product must come from a supplied source, cited (its own documentation or help pages are the authority on it); never state another product's prices, plans, editions, limits or rankings unless a supplied source states them, and never call one better without a source. Never name the banned companies above.`
    : `- OTHER COMPANIES: Name another company or product only when the primary keyword names it. When a cited source is another company's documentation, state the fact itself as plain guidance with its citation and leave the company out (never "that documentation says" or "the same guide states"); never describe another company's plans, editions or prices unless the primary keyword names that company.`;
}

/** The products a comparison search names, by the name their websites go by:
 * "seobot alternatives" → seobot, "seobot vs outrank" → seobot and outrank,
 * "compare surfer seo and frase" → surferseo and frase. A side of more than
 * two words is a category, not a product ("keyword research tool
 * alternatives" names none). P160, Oct 22 2026. */
export function productNamesInSearch(search: string): string[] {
  const text = search.toLowerCase().replace(/[^a-z0-9 .]+/g, " ").replace(/\s+/g, " ").trim();
  const versus = text.split(/ (?:vs\.?|versus) /);
  const compare = /^compare (.+)$/.exec(text);
  const alternatives = /^(.+?) (?:alternatives?|competitors?)\b/.exec(text);
  const sides = versus.length >= 2 ? versus : compare ? compare[1].split(/ (?:and|with|to|vs\.?) /) : alternatives ? [alternatives[1]] : [];
  return [...new Set(sides
    .map((side) => side.replace(/^(?:the )?(?:best |top |free |cheaper |cheap )*/, "").replace(/ (?:pricing|price|plans|review|reviews)$/, "").trim())
    .filter((side) => side && side.split(" ").length <= 2)
    .map((side) => side.replace(/[ .]/g, ""))
    .filter((name) => name.length >= 3))];
}

/** The name a website goes by: its registrable label ("help.seobot.ai" →
 * "seobot", "outrank.so" → "outrank", "example.co.uk" → "example"). */
function websiteName(host: string): string {
  const labels = host.replace(/^www\./, "").split(".");
  const twoPartSuffix = /^(?:co|com|org|net|ac|gov)\.[a-z]{2}$/.test(labels.slice(-2).join("."));
  return labels[labels.length - (twoPartSuffix ? 3 : 2)] ?? "";
}

/** The company behind a cited page that is neither primary research nor a
 * curated official/standards source ("help.salesforce.com" → salesforce),
 * for the rule that an article names another company only when its search
 * does (V1; P162). Google, the search engine every article is written for,
 * is never counted. */
export function citedCompanyName(url: string): string | null {
  const normalized = normalizeEvidenceUrl(url);
  if (!normalized) return null;
  const host = new URL(normalized).hostname.toLowerCase();
  if (host.endsWith(".gov") || host.endsWith(".gov.uk") || host.endsWith(".edu") || host.endsWith(".ac.uk") ||
    matchesAnyHost(host, PRIMARY_HOSTS) || matchesAnyHost(host, STANDARDS_AND_OFFICIAL_HOSTS)) return null;
  const name = websiteName(host);
  return name.length >= 3 && name !== "google" ? name : null;
}

/** A page from the website of a product the search names: the authoritative
 * source for that product's own features, plans and prices (a comparison's
 * fairness bar), never for general claims; outcome claims still need two
 * primary or official sources (articleQuality). */
export function firstPartyProductPage(url: string, products: readonly string[]): boolean {
  if (products.length === 0) return false;
  const normalized = normalizeEvidenceUrl(url);
  if (!normalized) return false;
  const host = new URL(normalized).hostname.toLowerCase();
  return !matchesAnyHost(host, LOW_AUTHORITY_HOSTS) && products.includes(websiteName(host));
}

/** A source's title as readers see it in the Sources list. Web search often
 * titles a PDF with its file name ("C 1097 2" for a University of Georgia
 * Extension circular on the Compost Notes test site, Oct 21 2026); a title
 * without two real words becomes the site it comes from (P153). */
export function readableSourceTitle(title: string | undefined, url: string): string {
  const clean = (title ?? "").replace(/\s+/g, " ").trim();
  if ((clean.match(/\p{L}{3,}/gu) ?? []).length >= 2) return clean;
  let host: string;
  try { host = new URL(url).hostname.replace(/^(?:www|secure)\d*\./i, ""); } catch { return clean || url; }
  return `${host}${/\.pdf(?:$|[?#])/i.test(url) ? " (PDF)" : ""}`;
}

/** One line on a draft saying what its live research produced and why the
 * rest was dropped (kept in the review's notes). */
export function researchOutcomeNote(counts: { searches: number; cited: number; competitor: number; secondary: number; unreadable: number; kept: number }): string {
  const dropped = [
    counts.competitor ? `${counts.competitor} competitor` : "",
    counts.secondary ? `${counts.secondary} secondary or vendor` : "",
    counts.unreadable ? `${counts.unreadable} without a readable excerpt` : "",
  ].filter(Boolean);
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return `Research: ${count(counts.searches, "search", "searches")}, ${count(counts.cited, "cited page", "cited pages")}; kept ${counts.kept}${dropped.length ? ` (${dropped.join(", ")})` : ""}.`;
}

export function classifyEvidenceSource(value: string): EvidenceSourceQuality {
  const normalized = normalizeEvidenceUrl(value);
  if (!normalized) {
    return {
      tier: "invalid",
      strictEligible: false,
      reason: "The URL is invalid, unsafe, or not HTTPS.",
    };
  }

  const parsed = new URL(normalized);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (
    host.endsWith(".gov") ||
    host.endsWith(".gov.uk") ||
    host.endsWith(".edu") ||
    host.endsWith(".ac.uk") ||
    matchesAnyHost(host, PRIMARY_HOSTS)
  ) {
    return {
      url: normalized,
      tier: "primary",
      strictEligible: true,
      reason: "Primary research, public data, academic, or government source.",
    };
  }

  if (matchesAnyHost(host, STANDARDS_AND_OFFICIAL_HOSTS)) {
    return {
      url: normalized,
      tier: "official-doc",
      strictEligible: true,
      reason: "Official documentation or standards source.",
    };
  }

  const looksLikeDocumentation =
    /\/(?:docs?|documentation|developers?|support|help|reference|api)(?:\/|$)/.test(path) ||
    // Many vendors host the same first-party documentation at docs.vendor or
    // help.vendor rather than vendor/docs. This is a documentation candidate,
    // not an academic tier or proof of any claim: capture and exact-proposition
    // review still apply. Known community/blog hosts remain excluded below.
    // learn.microsoft.com (formerly docs.microsoft.com), knowledge.hubspot.com,
    // faq.whatsapp.com and kb.* are the same first-party help documentation
    // under another subdomain name (Oct 18 2026: lead-scoring and chat-widget
    // research found only these and kept zero sources).
    /^(?:www\.)?(?:docs?|documentation|developers?|support|help|helpcenter|help-center|reference|api|learn|knowledge|kb|faq)\.[^.]+\./.test(host);
  if (looksLikeDocumentation && !matchesAnyHost(host, LOW_AUTHORITY_HOSTS)) {
    return {
      url: normalized,
      tier: "official-doc",
      strictEligible: true,
      reason: "First-party documentation suitable for product or mechanism facts, not universal outcomes.",
    };
  }

  return {
    url: normalized,
    tier: "secondary",
    strictEligible: false,
    reason:
      "Secondary, vendor-authored, or otherwise non-primary evidence; unsuitable for strict numerical outcome claims.",
  };
}

export function strictEvidenceSources<T extends { url: string }>(sources: T[], options: { firstPartyProducts?: readonly string[] } = {}): {
  accepted: T[];
  rejected: Array<{ source: T; reason: string }>;
} {
  const accepted: T[] = [];
  const rejected: Array<{ source: T; reason: string }> = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const quality = classifyEvidenceSource(source.url);
    // A comparison may cite a named product's own website for that product (P160).
    if (!quality.strictEligible && quality.url && firstPartyProductPage(source.url, options.firstPartyProducts ?? [])) {
      quality.strictEligible = true;
    }
    if (!quality.strictEligible || !quality.url) {
      rejected.push({ source, reason: quality.reason });
      continue;
    }
    if (seen.has(quality.url)) continue;
    seen.add(quality.url);
    accepted.push({ ...source, url: quality.url });
  }

  return { accepted, rejected };
}
