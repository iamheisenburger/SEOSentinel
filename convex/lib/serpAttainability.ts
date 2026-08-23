/**
 * SERP attainability: can this tenant realistically rank for a keyword?
 *
 * Keyword difficulty is the usual answer, but it is only trustworthy when it
 * has actually been measured. Unmeasured difficulty defaulting to zero has
 * repeatedly authorised keywords whose live SERP is owned by Salesforce,
 * HubSpot, Zendesk and Reddit. A young tenant then publishes a genuinely good
 * article, lands near position 40, and earns no clicks.
 *
 * The live SERP is stronger evidence than a difficulty score because it is
 * observed rather than modelled: it names the exact pages the tenant would have
 * to displace. This module scores that evidence and is deliberately
 * tenant-generic — it encodes no customer's product, only the structural fact
 * that entrenched publishers are hard to outrank from a standing start.
 */

/** Bump when the scoring contract changes so stale audits are recomputed. */
export const SERP_ATTAINABILITY_VERSION = 1;

/**
 * Hosts that dominate commercial SERPs through domain authority rather than
 * page relevance. Displacing them requires authority a new or mid-sized tenant
 * does not have, regardless of article quality. Kept intentionally broad and
 * industry-neutral: aggregators, encyclopedias, mega-vendors, forums, and
 * job/course marketplaces behave the same way in every vertical.
 */
export const ENTRENCHED_HOSTS: readonly string[] = [
  // Encyclopedic / UGC / forum
  "wikipedia.org", "reddit.com", "quora.com", "medium.com", "youtube.com",
  "linkedin.com", "facebook.com", "x.com", "twitter.com", "pinterest.com",
  "stackoverflow.com", "github.com",
  // Marketplaces / directories / review aggregators
  "g2.com", "capterra.com", "trustpilot.com", "getapp.com", "softwareadvice.com",
  "crunchbase.com", "glassdoor.com", "indeed.com", "yelp.com", "amazon.com",
  // Course / education marketplaces
  "coursera.org", "udemy.com", "edx.org", "skillshare.com", "linkedin-learning.com",
  // Mega-vendors and enterprise suites
  "salesforce.com", "hubspot.com", "zendesk.com", "microsoft.com", "google.com",
  "ibm.com", "oracle.com", "sap.com", "adobe.com", "atlassian.com", "shopify.com",
  "wix.com", "squarespace.com", "wordpress.com", "intercom.com", "drift.com",
  "zoho.com", "freshworks.com", "monday.com", "pipedrive.com", "zoominfo.com",
  "mailchimp.com", "twilio.com", "stripe.com", "notion.so", "slack.com",
  // Major publishers / research
  "forbes.com", "gartner.com", "hbr.org", "techtarget.com", "investopedia.com",
  "businessinsider.com", "nytimes.com", "wsj.com", "cnbc.com", "entrepreneur.com",
  "inc.com", "fastcompany.com", "wired.com", "techcrunch.com",
  // SEO/marketing incumbents that blanket marketing SERPs
  "semrush.com", "ahrefs.com", "moz.com", "backlinko.com", "searchenginejournal.com",
  "neilpatel.com", "wordstream.com",
];

export type SerpAttainabilityEvaluation = {
  /** False when the SERP is too entrenched for this tenant to realistically enter. */
  attainable: boolean;
  /** Share of the observed top results held by entrenched hosts (0-1). */
  entrenchedRatio: number;
  /** Count of observed results actually classified. */
  observedResults: number;
  /** 0-100; higher means a more winnable SERP for a non-authority tenant. */
  score: number;
  version: number;
  reasons: string[];
};

export type SerpBusinessIntentEvaluation = {
  aligned: boolean;
  classifiedResults: number;
  reasons: string[];
};

function hostOf(url: string): string | null {
  try {
    const raw = String(url || "").trim();
    if (!raw) return null;
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const BOOK_HOSTS = [
  "amazon.com", "audible.com", "goodreads.com", "books.google.com",
  "barnesandnoble.com", "kobo.com",
];
const EDUCATION_HOSTS = [
  "coursera.org", "udemy.com", "edx.org", "skillshare.com",
  "masterclass.com",
];
const JOB_HOSTS = [
  "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com",
  "simplyhired.com",
];

function hostMatches(host: string | null, candidates: string[]): boolean {
  if (!host) return false;
  return candidates.some((candidate) =>
    host === candidate || host.endsWith(`.${candidate}`)
  );
}

/**
 * A keyword can share tenant vocabulary while Google means something else.
 * Detect obvious SERP-level intent mismatches (a book title, employment query,
 * or training course) unless the tenant's own business model supplies that
 * exact offering. This is structural and tenant-generic; it does not encode a
 * customer's brand or niche.
 */
export function evaluateSerpBusinessIntent(args: {
  results: Array<{ url: string; title?: string; description?: string }>;
  businessModelSignals: string[];
}): SerpBusinessIntentEvaluation {
  const results = args.results.filter((result) => Boolean(result.url)).slice(0, 10);
  if (results.length === 0) {
    return {
      aligned: false,
      classifiedResults: 0,
      reasons: ["No live SERP results were available to verify search intent."],
    };
  }
  const tenant = args.businessModelSignals.join(" ").toLowerCase();
  const allowsBooks = /\b(?:author|book|bookstore|publish(?:er|ing)?)\b/.test(tenant);
  const allowsEducation = /\b(?:academy|course|education|school|train(?:er|ing)|university)\b/.test(tenant);
  const allowsJobs = /\b(?:career|employment|job board|recruit(?:er|ing|ment)|staffing)\b/.test(tenant);
  let bookResults = 0;
  let educationResults = 0;
  let jobResults = 0;
  for (const result of results) {
    const host = hostOf(result.url);
    const text = `${result.title ?? ""} ${result.description ?? ""}`.toLowerCase();
    if (
      hostMatches(host, BOOK_HOSTS) ||
      /\b(?:audio ?book|book review|book summary|paperback|hardcover)\b/.test(text)
    ) bookResults += 1;
    if (
      hostMatches(host, EDUCATION_HOSTS) ||
      /\b(?:certificate|certification|course|degree|training program)\b/.test(text)
    ) educationResults += 1;
    if (
      hostMatches(host, JOB_HOSTS) ||
      /\b(?:apply now|career|job opening|salary|vacancy)\b/.test(text)
    ) jobResults += 1;
  }
  const threshold = Math.ceil(results.length / 2);
  const reasons: string[] = [];
  if (!allowsBooks && bookResults >= threshold) {
    reasons.push(`${bookResults}/${results.length} top results target a book or audiobook.`);
  }
  if (!allowsEducation && educationResults >= threshold) {
    reasons.push(`${educationResults}/${results.length} top results target courses or training.`);
  }
  if (!allowsJobs && jobResults >= threshold) {
    reasons.push(`${jobResults}/${results.length} top results target employment.`);
  }
  return {
    aligned: reasons.length === 0,
    classifiedResults: results.length,
    reasons,
  };
}

/** True when the host is an entrenched publisher or one of its subdomains. */
export function isEntrenchedHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, "");
  return ENTRENCHED_HOSTS.some(
    (entrenched) =>
      normalized === entrenched || normalized.endsWith(`.${entrenched}`),
  );
}

/**
 * Score how winnable a live SERP is.
 *
 * `maxEntrenchedRatio` is the share of the top results that may be entrenched
 * before the keyword is rejected. Tenants with real authority can raise it;
 * the default suits a young site that must win on relevance alone.
 */
export function evaluateSerpAttainability(args: {
  serpTopUrls?: string[];
  /** Ignore results below this depth; page-one competition is what matters. */
  depth?: number;
  maxEntrenchedRatio?: number;
  /** Skip the tenant's own domain so existing rankings never count against it. */
  siteHost?: string;
}): SerpAttainabilityEvaluation {
  const depth = Math.max(1, args.depth ?? 10);
  const maxRatio = args.maxEntrenchedRatio ?? 0.5;
  const siteHost = (args.siteHost || "").toLowerCase().replace(/^www\./, "");

  const hosts = (args.serpTopUrls ?? [])
    .slice(0, depth)
    .map(hostOf)
    .filter((host): host is string => Boolean(host))
    .filter((host) => !siteHost || host !== siteHost);

  if (hosts.length === 0) {
    // No observed SERP is not evidence of an easy SERP. Fail closed so an
    // unverified keyword can never be promoted as attainable.
    return {
      attainable: false,
      entrenchedRatio: 1,
      observedResults: 0,
      score: 0,
      version: SERP_ATTAINABILITY_VERSION,
      reasons: ["No live SERP evidence was captured for this keyword."],
    };
  }

  const entrenched = hosts.filter(isEntrenchedHost);
  const ratio = entrenched.length / hosts.length;
  const reasons: string[] = [];

  if (ratio > maxRatio) {
    const names = [...new Set(entrenched)].slice(0, 4).join(", ");
    reasons.push(
      `${Math.round(ratio * 100)}% of the top ${hosts.length} results are entrenched publishers (${names}); ` +
        "outranking them requires domain authority rather than better content.",
    );
  } else {
    reasons.push(
      `${Math.round((1 - ratio) * 100)}% of the top ${hosts.length} results are non-entrenched pages, ` +
        "so relevance and depth can realistically win a position.",
    );
  }

  return {
    attainable: ratio <= maxRatio,
    entrenchedRatio: ratio,
    observedResults: hosts.length,
    score: Math.round((1 - ratio) * 100),
    version: SERP_ATTAINABILITY_VERSION,
    reasons,
  };
}

/**
 * Rank candidate topics by expected organic return rather than by raw volume.
 *
 * Expected value multiplies real demand by how winnable the SERP is, so a
 * 1,600/month keyword on an open SERP outranks a 10/month keyword whose page
 * one is owned by mega-vendors. Unmeasured difficulty is treated as a penalty,
 * never as "easy".
 */
export function expectedOrganicValue(args: {
  searchVolume?: number;
  serpTopUrls?: string[];
  keywordDifficulty?: number;
  keywordDifficultyMeasured?: boolean;
  siteHost?: string;
}): number {
  const volume = Math.max(0, args.searchVolume ?? 0);
  if (volume === 0) return 0;
  const serp = evaluateSerpAttainability({
    serpTopUrls: args.serpTopUrls,
    siteHost: args.siteHost,
  });
  // Winnability from observed SERP, then a mild penalty when difficulty was
  // never measured so verified topics outrank assumed-easy ones.
  const winnability = 1 - serp.entrenchedRatio;
  const measuredFactor = args.keywordDifficultyMeasured ? 1 : 0.7;
  const difficultyFactor =
    args.keywordDifficultyMeasured && typeof args.keywordDifficulty === "number"
      ? Math.max(0.1, 1 - args.keywordDifficulty / 100)
      : 1;
  return volume * winnability * measuredFactor * difficultyFactor;
}
