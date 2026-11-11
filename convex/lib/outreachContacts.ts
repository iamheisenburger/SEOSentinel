import { getDomain } from "tldts";

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

/** An additive-rollout contact with no proven owner may be replaced only at
 * the fresh public-evidence write boundary. Existing metadata/history is not
 * adopted; a row already bound to any account never crosses ownership. */
export function legacyUnresolvedContactMayBeReplaced(contact: {
  ownerAccountKey?: string;
  ownerLineageUnresolvedAt?: number;
}): boolean {
  return !contact.ownerAccountKey &&
    contact.ownerLineageUnresolvedAt !== undefined;
}

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

/**
 * P406: customer support desks. Their inbox is a ticket queue for customers'
 * problems, so a link request there is never read by anyone who edits a page
 * (pitches went to support desks on Nov 10). Compared with dots, dashes and
 * underscores removed, so "customer.support" and "help-desk" match too.
 */
const SUPPORT_DESKS = new Set([
  "support",
  "help",
  "helpdesk",
  "techsupport",
  "customersupport",
  "customerservice",
  "customercare",
  "customersuccess",
  "care",
  "service",
]);

/** True for an address that reaches a desk rather than a person who edits pages. */
export function isDeskAddress(email: string): boolean {
  const localPart = normalizeEmail(email).split("@")[0] ?? "";
  return NON_CONTACT_LOCAL_PARTS.has(localPart) || SUPPORT_DESKS.has(localPart.replace(/[._-]+/g, ""));
}

/**
 * P406: page source spells characters in escaped forms (JSON `>`, `\x3e`,
 * `&#62;`, `&gt;`, `&commat;`). Scanned raw, an escape glues itself to the
 * address beside it (one such malformed address was emailed on Nov 10), so the
 * source is decoded before any address is read from it.
 */
export function decodeForScan(html: string): string {
  const char = (code: number) => (Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ");
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", commat: "@", period: ".", sol: "/", colon: ":" };
  return String(html || "")
    .replace(/\\+u([0-9a-fA-F]{4})/g, (_m, hex: string) => char(parseInt(hex, 16)))
    .replace(/\\+x([0-9a-fA-F]{2})/g, (_m, hex: string) => char(parseInt(hex, 16)))
    .replace(/&#x([0-9a-fA-F]{1,6});?/g, (_m, hex: string) => char(parseInt(hex, 16)))
    .replace(/&#(\d{1,7});?/g, (_m, dec: string) => char(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp|commat|period|sol|colon);/gi, (_m, name: string) => named[name.toLowerCase()] ?? " ");
}

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
  { match: /^hello|^hi$|^hey$|^contact|^info|^team|^enquir|^inquir|^office$|^mail$/, role: "general", bonus: 10 },
];

/**
 * P408: the people a page credits, by name: its author in the page's
 * metadata (JSON-LD, meta author, rel=author) or a byline ("By Jane Doe").
 * Each name as lowercased words without accents.
 */
export function peopleNamedIn(html: string): string[][] {
  const source = decodeForScan(String(html || ""));
  const names = new Set<string>();
  const add = (raw: string) => {
    const name = raw.replace(/<[^>]+>/g, " ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['’]/g, "").replace(/\s+/g, " ").trim();
    if (name.length >= 2 && name.length <= 60 && !/^https?:|[/@]/.test(name)) names.add(name.toLowerCase());
  };
  for (const m of source.matchAll(/"@type"\s*:\s*"Person"[^{}]*?"name"\s*:\s*"([^"]+)"/g)) add(m[1]);
  for (const m of source.matchAll(/"name"\s*:\s*"([^"]+)"[^{}]*?"@type"\s*:\s*"Person"/g)) add(m[1]);
  for (const m of source.matchAll(/"author"\s*:\s*\[?\s*\{[^{}]*?"name"\s*:\s*"([^"]+)"/g)) add(m[1]);
  for (const m of source.matchAll(/"author"\s*:\s*"([^"]+)"/g)) add(m[1]);
  for (const m of source.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/\b(?:name|property)=["'](?:author|article:author)["']/i.test(m[0])) continue;
    const content = /\bcontent=["']([^"']+)["']/i.exec(m[0])?.[1];
    if (content) add(content);
  }
  for (const m of source.matchAll(/<a\b[^>]*\brel=["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]{2,120}?)<\/a>/gi)) add(m[1]);
  // A byline is an element of its own that starts with "By" ("By Jane Doe", "By <a>Jane Doe</a> · March 3"), never a
  // title's "... compared by" or a sentence's "by"; a date after the name is not part of it.
  const months = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
  const byline = new RegExp(String.raw`>\s*By:?\s+(?:<[^>]+>\s*)*([A-Z][a-z]+(?:[ \t]+(?!(?:${months})\b)[A-Z][a-zA-Z'-]+){0,2})`, "g");
  const body = source.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<title[\s\S]*?<\/title>/gi, " ");
  for (const m of body.matchAll(byline)) add(m[1]);
  return [...names].map((name) => name.split(/[\s.]+/).filter((word) => word.length >= 2)).filter((words) => words.length > 0);
}

/** P408: whether an address's local part is one of these people's names (jane, doe, jane.doe, j.doe, jdoe, janedoe). */
export function namesPerson(localPart: string, people: readonly string[][]): boolean {
  const parts = localPart.toLowerCase().split(/[._-]+/).filter(Boolean);
  return people.some((words) => {
    const first = words[0], last = words.length > 1 ? words[words.length - 1] : undefined;
    if (parts.length === 1) {
      const p = parts[0];
      return p === first || (last !== undefined && (p === last || p === first + last || p === first[0] + last));
    }
    return parts.length === 2 && last !== undefined && (parts[0] === first || parts[0] === first[0]) && parts[1] === last;
  });
}

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

const SHARED_PUBLISHING_HOSTS = new Set([
  "substack.com",
  "medium.com",
  "wordpress.com",
  "blogspot.com",
  "github.io",
  "pages.dev",
  "vercel.app",
  "netlify.app",
  "webflow.io",
  "wixsite.com",
]);

function sharedPublishingBoundary(host: string): string | undefined {
  return [...SHARED_PUBLISHING_HOSTS].find(
    (root) => host === root || host.endsWith(`.${root}`),
  );
}

/** Canonical recipient-organisation key for cooldowns, thread grouping and
 * STOPs. Ordinary first-party subdomains collapse to their registrable domain;
 * hosted publishing tenants retain the tenant label and never collapse to the
 * shared platform operator. */
export function outreachOrganisationDomain(value: string): string {
  const host = normalizeHost(value);
  if (!host) return "";
  const sharedRoot = sharedPublishingBoundary(host);
  if (sharedRoot) {
    if (host === sharedRoot) return sharedRoot;
    const tenantLabel = host
      .slice(0, -(sharedRoot.length + 1))
      .split(".")
      .filter(Boolean)
      .pop();
    return tenantLabel ? `${tenantLabel}.${sharedRoot}` : host;
  }
  return getDomain(host, { allowPrivateDomains: true }) ?? host;
}

/** Exact apex/subdomain relationship; never a naive shared public suffix. */
export function isSameOrganisationHost(left: string, right: string): boolean {
  const a = normalizeHost(left);
  const b = normalizeHost(right);
  if (!a || !b) return false;
  if (a === b) return true;
  // Different tenants on a hosted publishing platform are never the same
  // organisation, even when the platform is absent from a local PSL build.
  // Nested hosts owned by the same hosted tenant remain usable.
  const aShared = sharedPublishingBoundary(a);
  const bShared = sharedPublishingBoundary(b);
  if (aShared || bShared) {
    if (!aShared || aShared !== bShared) return false;
    const aOrganisation = outreachOrganisationDomain(a);
    const bOrganisation = outreachOrganisationDomain(b);
    return aOrganisation !== aShared && aOrganisation === bOrganisation;
  }
  const aBoundary = getDomain(a, { allowPrivateDomains: true });
  const bBoundary = getDomain(b, { allowPrivateDomains: true });
  return Boolean(aBoundary && bBoundary && aBoundary === bBoundary);
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
  // An escape's leftover ("u003e" from a JSON-escaped ">") is never part of a real address.
  if (/^u00[0-9a-f]{2}/.test(localPart)) return false;
  if (NON_CONTACT_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return false;
  // Hashed or tracking-style local parts are machine addresses.
  if (/^[0-9a-f]{16,}$/.test(localPart)) return false;
  return true;
}

function roleFor(localPart: string, people?: readonly string[][]): { role?: string; bonus: number } {
  for (const entry of PREFERRED_LOCAL_PARTS) {
    if (entry.match.test(localPart)) return { role: entry.role, bonus: entry.bonus };
  }
  // P408: with the site's people known, an address is a person's only when it names one of them. Any one-word address
  // passed for a first name before, so a department's desk outranked the general inbox as a "person".
  if (people) return namesPerson(localPart, people) ? { role: "individual", bonus: 30 } : { bonus: 0 };
  // A personal-looking address (first.last, firstname) reaches a human.
  if (/^[a-z]+([._-][a-z]+)?$/.test(localPart)) return { role: "individual", bonus: 30 };
  return { bonus: 0 };
}

/**
 * P408: who an address reaches for a link request, given the people the
 * site's pages name: "individual" (one of them), an editorial, press,
 * webmaster, marketing or general inbox, or undefined for a department or
 * desk (no one there edits the page).
 */
export function linkContactRole(email: string, people: readonly string[][]): string | undefined {
  const normalized = normalizeEmail(email);
  if (!isContactableAddress(normalized) || isDeskAddress(normalized)) return undefined;
  return roleFor(normalized.split("@")[0], people).role;
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
  /** P408 (link requests): keep only addresses that reach a person the site names or an editorial, press, webmaster,
   * marketing or general inbox; `people` adds names read on the site's other pages. */
  knownRolesOnly?: boolean;
  people?: readonly string[][];
}): ContactCandidate[] {
  const html = decodeForScan(String(args.html || ""));
  const siteDomain = String(args.siteDomain || "").toLowerCase().replace(/^www\./, "");
  const found = new Map<string, ContactCandidate>();
  const people = args.knownRolesOnly ? [...(args.people ?? []), ...peopleNamedIn(String(args.html || ""))] : undefined;

  const consider = (
    rawEmail: string,
    discoveryMethod: ContactCandidate["discoveryMethod"],
    methodBonus: number,
  ) => {
    let decoded = rawEmail;
    try { decoded = decodeURIComponent(rawEmail); } catch { /* not URL-encoded */ }
    const email = normalizeEmail(decoded);
    if (!isContactableAddress(email) || isDeskAddress(email)) return;
    if (!isSameOrganisation(email, siteDomain)) return;
    const localPart = email.split("@")[0];
    const { role, bonus } = roleFor(localPart, people);
    if (people && !role) return;
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
