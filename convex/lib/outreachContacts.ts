/**
 * Contact discovery from public pages.
 *
 * The only acceptable source of an outreach address is one that was actually
 * observed on a public page belonging to the target domain. Guessing
 * `info@domain` or `firstname.lastname@domain` produces bounces, which destroy
 * inbox reputation faster than any volume limit protects it — so this module
 * only ever extracts, never constructs.
 *
 * Pure and deterministic: it takes fetched HTML in and returns candidates out.
 */

/** Bump when extraction or ranking rules change. */
export const CONTACT_DISCOVERY_VERSION = 1;

export type ContactCandidate = {
  email: string;
  domain: string;
  name?: string;
  role?: string;
  discoveryMethod: "mailto" | "page_scan" | "author_byline";
  /** Higher is a better person to contact about a link. */
  score: number;
};

/**
 * Addresses that exist on a page but are never a human editor: automated
 * senders, vendor tracking addresses, and legal/abuse desks that will treat
 * outreach as spam.
 */
const NON_CONTACT_LOCAL_PARTS = new Set([
  "abuse",
  "postmaster",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "bounce",
  "bounces",
  "unsubscribe",
  "privacy",
  "legal",
  "dpo",
  "security",
  "dmca",
  "billing",
  "invoices",
  "careers",
  "jobs",
  "recruiting",
  "sentry",
]);

/** Hosts that appear in page source but never belong to the site's own team. */
const NON_CONTACT_DOMAINS = [
  "example.com",
  "example.org",
  "domain.com",
  "yourdomain.com",
  "email.com",
  "sentry.io",
  "wixpress.com",
  "squarespace.com",
  "godaddy.com",
  "cloudflare.com",
  "w3.org",
  "schema.org",
  "sentry.wixpress.com",
];

/**
 * Local parts that indicate the right desk for a link request. Ranked above
 * generic company addresses because they reach someone who can edit a page.
 */
const PREFERRED_LOCAL_PARTS: Array<{ match: RegExp; role: string; bonus: number }> = [
  { match: /^editor|^editorial|^content|^blog/, role: "editorial", bonus: 40 },
  { match: /^press|^media|^pr$/, role: "press", bonus: 25 },
  { match: /^web(master)?$/, role: "webmaster", bonus: 25 },
  { match: /^marketing|^growth/, role: "marketing", bonus: 20 },
  { match: /^hello|^hi$|^contact|^info|^team|^support/, role: "general", bonus: 10 },
];

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}/g;

export function normalizeEmail(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).replace(/^www\./, "");
}

function normalizeHost(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .replace(/\.$/, "");
}

/** Exact apex/subdomain relationship; never a naive shared public suffix. */
export function isSameOrganisationHost(left: string, right: string): boolean {
  const a = normalizeHost(left);
  const b = normalizeHost(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** True when the address belongs to the target site rather than a third party. */
export function isSameOrganisation(email: string, siteDomain: string): boolean {
  const target = normalizeHost(siteDomain);
  const host = emailDomain(email);
  if (!host || !target) return false;
  return isSameOrganisationHost(host, target);
}

/**
 * Reject addresses that are technically valid but are not a person who could
 * act on a link request.
 */
export function isContactableAddress(email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/i.test(normalized)) return false;
  // Image and asset filenames routinely match the email pattern inside markup.
  if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?)$/i.test(normalized)) return false;
  const [localPart, host] = normalized.split("@");
  if (NON_CONTACT_LOCAL_PARTS.has(localPart)) return false;
  if (NON_CONTACT_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  // Hashed or tracking-style local parts are machine addresses.
  if (/^[0-9a-f]{16,}$/.test(localPart)) return false;
  return true;
}

function roleFor(localPart: string): { role?: string; bonus: number } {
  for (const entry of PREFERRED_LOCAL_PARTS) {
    if (entry.match.test(localPart)) return { role: entry.role, bonus: entry.bonus };
  }
  // A personal-looking address (first.last, firstname) reaches a human.
  if (/^[a-z]+([._-][a-z]+)?$/.test(localPart)) return { role: "individual", bonus: 30 };
  return { bonus: 0 };
}

/**
 * Extract every usable contact address from one public page.
 *
 * `siteDomain` is the domain we want a link from; addresses belonging to
 * anyone else on the page (advertisers, embedded widgets, quoted sources) are
 * dropped so outreach never lands on an uninvolved third party.
 */
export function extractContactCandidates(args: {
  html: string;
  siteDomain: string;
}): ContactCandidate[] {
  const html = String(args.html || "");
  const siteDomain = String(args.siteDomain || "").toLowerCase().replace(/^www\./, "");
  const found = new Map<string, ContactCandidate>();

  const consider = (
    rawEmail: string,
    discoveryMethod: ContactCandidate["discoveryMethod"],
    methodBonus: number,
  ) => {
    const email = normalizeEmail(rawEmail);
    if (!isContactableAddress(email)) return;
    if (!isSameOrganisation(email, siteDomain)) return;
    const localPart = email.split("@")[0];
    const { role, bonus } = roleFor(localPart);
    const score = bonus + methodBonus;
    const existing = found.get(email);
    if (existing && existing.score >= score) return;
    found.set(email, {
      email,
      domain: emailDomain(email),
      role,
      discoveryMethod,
      score,
    });
  };

  // A mailto link is an address the site deliberately published.
  for (const match of html.matchAll(/mailto:([^"'\s>?]+)/gi)) {
    consider(match[1], "mailto", 20);
  }
  // Anything else visible in the page body.
  for (const match of html.matchAll(EMAIL_PATTERN)) {
    consider(match[0], "page_scan", 0);
  }

  return Array.from(found.values()).sort((a, b) => b.score - a.score);
}

/**
 * The single best address to contact, or null when the page yielded none.
 * Returning null is the expected outcome for many domains and must leave the
 * opportunity un-contacted rather than trigger a guessed address.
 */
export function selectBestContact(
  candidates: ContactCandidate[],
): ContactCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.slice().sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))[0];
}

/**
 * Pages worth fetching when hunting for a contact address, in priority order.
 * The page carrying the opportunity comes first: whoever published it is the
 * person who can edit it.
 */
export function contactDiscoveryUrls(args: {
  sourceUrl: string;
  siteDomain: string;
  limit?: number;
}): string[] {
  const urls: string[] = [];
  const push = (url: string) => {
    if (!urls.includes(url)) urls.push(url);
  };
  if (/^https:\/\//i.test(args.sourceUrl)) push(args.sourceUrl);
  const host = String(args.siteDomain || "").toLowerCase().replace(/^www\./, "");
  if (host) {
    for (const path of ["/contact", "/about", "/contact-us", "/about-us", "/team", "/"]) {
      push(`https://${host}${path}`);
    }
  }
  return urls.slice(0, Math.max(1, args.limit ?? 4));
}
