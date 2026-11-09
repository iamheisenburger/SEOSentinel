/** Pentra Answers (Nov 9 2026): a local business's real competitors, from Google Maps, and a competitor's real name from
 * its own homepage or its Maps listing. The setup read named competitors from the model's memory, which rarely knows the
 * businesses of one city, so a local business often got none and its snapshot counted nobody named instead of it; and a
 * competitor typed as an address kept its run-together domain label as its name when its host refused Pentra. Pure. */
import { brandMatcher, hostOf } from "./answerEngine.ts";
import { decodeEntities } from "./pageText.ts";

/** treg's routed Google Maps search ($0.00015 a call on its first provider; a miss tries the next, up to the bound). */
export const MAPS_ENDPOINT = "treg.google.serp.maps";
export const MAPS_MAX_COST_MICRO_USD = 5_000;
/** Held for one competitor-name lookup: a Maps search at most (the homepage read is free). */
export const LOOKUP_HOLD_MICRO_USD = MAPS_MAX_COST_MICRO_USD;

/** A Maps listing; `domain` only when its website is its own (see parseMapsPlaces). */
export type MapsPlace = { name: string; domain?: string; rating?: number; reviews?: number };

/** A Maps listing's name, its part before a spaced separator ("Name | Area", "Name - Tagline"), as listed otherwise. */
export function cleanPlaceName(raw: string): string {
  const name = decodeEntities(raw).replace(/\s+/g, " ").trim();
  return (name.split(/\s+[|–—•·-]\s+/)[0]?.trim() || name).slice(0, 60);
}

/** Every place in treg's Maps reply (`output.places`, each provider's own rows). A place gets an address only when its
 * website is its own: the front page of an address no differently named listing shares. A profile on a shared platform
 * (a social page, a directory or booking page) has its own path there, so it is never taken for the business's site; the
 * business is still listed, by name, since assistants name businesses with no site of their own too. */
export function parseMapsPlaces(payload: unknown): MapsPlace[] {
  const rows = (payload as { output?: { places?: unknown } } | null)?.output?.places;
  if (!Array.isArray(rows)) return [];
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x) ? x : typeof x === "string" && /^\d+(\.\d+)?$/.test(x) ? Number(x) : undefined;
  const listed = rows.flatMap((row) => {
    const r = (row ?? {}) as Record<string, unknown>;
    const rawName = [r.name, r.title].find((x): x is string => typeof x === "string" && x.trim().length > 1);
    if (!rawName) return [];
    const name = cleanPlaceName(rawName);
    if (name.length < 2) return [];
    const site = [r.website, r.site, r.domain, r.link].find((x): x is string => typeof x === "string" && x.trim().length > 3);
    let homepage: string | undefined;
    if (site) {
      try {
        const path = new URL(/^https?:\/\//i.test(site.trim()) ? site.trim() : `https://${site.trim()}`).pathname;
        const host = hostOf(site);
        if (host && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) && path.replace(/\/+$/, "") === "") homepage = host;
      } catch { /* no usable address: listed by name */ }
    }
    const rating = num(r.rating), reviews = num(r.review_count) ?? num(r.reviews) ?? num(r.reviewsCount) ?? num(r.user_ratings_total);
    return [{ name, ...(homepage ? { domain: homepage } : {}), ...(rating !== undefined ? { rating } : {}), ...(reviews !== undefined ? { reviews } : {}) }];
  });
  const namesAt = new Map<string, Set<string>>();
  for (const p of listed) if (p.domain) namesAt.set(p.domain, (namesAt.get(p.domain) ?? new Set()).add(p.name.toLowerCase()));
  // An address differently named listings share is nobody's own site: those businesses are listed by name.
  return listed.map((p) => !p.domain || (namesAt.get(p.domain)?.size ?? 0) === 1 ? p
    : { name: p.name, ...(p.rating !== undefined ? { rating: p.rating } : {}), ...(p.reviews !== undefined ? { reviews: p.reviews } : {}) });
}

/** The Maps search for a local business's competitors: what a buyer types, then its place ("<search term> <place>", no
 * preposition, so it reads the same in any language), then its country when the place doesn't name it: a city name many
 * countries share (Bristol, Perth) otherwise returns another country's businesses, and providers ignore a country filter. */
export function mapsQuery(searchTerm: string, location: string, countryCode = ""): string | null {
  const term = searchTerm.replace(/\s+/g, " ").trim().slice(0, 60), place = location.replace(/\s+/g, " ").trim().slice(0, 80);
  if (term.length < 2 || place.length < 2) return null;
  let country = "";
  try { country = /^[A-Za-z]{2}$/.test(countryCode) ? new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode.toUpperCase()) ?? "" : ""; } catch { country = ""; }
  const named = country && place.toLowerCase().includes(country.toLowerCase());
  return country && !named ? `${term} ${place}, ${country}` : `${term} ${place}`;
}

export type Competitor = { name: string; domain?: string };

/** The businesses Google Maps lists for the search, in Google's order, without the business itself, once each (a practice
 * with two locations shares one website and one name), and without listings almost nobody reviewed while enough others
 * remain. A business with no site of its own is kept by its name. */
export function localCompetitors(places: readonly MapsPlace[], business: { name: string; domain: string }, limit = 5): Competitor[] {
  const own = hostOf(business.domain);
  const self = business.name.trim() ? brandMatcher({ name: business.name }) : null;
  const seen = new Set<string>();
  const unique = places.filter((p) => {
    if (p.domain && (p.domain === own || p.domain.endsWith(`.${own}`) || own.endsWith(`.${p.domain}`))) return false;
    if (self && self.test(p.name) >= 0) return false;
    const name = p.name.toLowerCase();
    if ((p.domain && seen.has(p.domain)) || seen.has(name)) return false;
    if (p.domain) seen.add(p.domain);
    seen.add(name);
    return true;
  });
  const reviewed = unique.filter((p) => p.reviews === undefined || p.reviews >= 10);
  return (reviewed.length >= limit ? reviewed : unique).slice(0, limit).map((p) => ({ name: p.name, ...(p.domain ? { domain: p.domain } : {}) }));
}

/** Competitors found on Maps first, then the read's own (no address twice, no name twice), at most `limit`. */
export function mergeCompetitors(first: readonly Competitor[], then: readonly Competitor[], limit = 5): Competitor[] {
  const out: Competitor[] = [];
  for (const c of [...first, ...then]) {
    if (out.some((o) => (o.domain && o.domain === c.domain) || o.name.toLowerCase() === c.name.toLowerCase())) continue;
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** The name a business's homepage gives itself, when it matches its address: its declared name (og:site_name,
 * application-name), its structured data's or a part of its title. A name that doesn't match the address is never taken
 * (a slogan, or a parent group's or platform's name); the caller asks the business's Maps listing instead. */
export function siteNameFromHtml(html: string, domain: string): string | null {
  const label = (hostOf(domain).split(".")[0] ?? "").replace(/[^a-z0-9]/g, "");
  const clean = (s: string) => decodeEntities(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const usable = (s: string) => s.length >= 2 && s.length <= 60 && /\p{L}/u.test(s);
  // Accents dropped ("Saint-Éloi" is "sainteloi" in an address), so names in any Latin-script language compare.
  const matchesAddress = (s: string) => {
    const compact = s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return compact.length >= 3 && label.length >= 3 && (label.includes(compact) || compact.includes(label));
  };
  const meta = (property: string) => {
    const a = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']{2,120})["']`, "i").exec(html)?.[1];
    const b = new RegExp(`<meta[^>]+content=["']([^"']{2,120})["'][^>]+(?:property|name)=["']${property}["']`, "i").exec(html)?.[1];
    return clean(a ?? b ?? "");
  };
  const declared = [meta("og:site_name"), meta("application-name")].filter(usable);
  const structured: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const visit = (node: unknown, depth = 0): void => {
        if (depth > 5 || !node || typeof node !== "object") return;
        if (Array.isArray(node)) { node.forEach((n) => visit(n, depth + 1)); return; }
        const record = node as Record<string, unknown>;
        if (typeof record.name === "string") { const name = clean(record.name); if (usable(name)) structured.push(name); }
        for (const value of Object.values(record)) if (value && typeof value === "object") visit(value, depth + 1);
      };
      visit(JSON.parse(m[1]));
    } catch { /* a malformed block says nothing */ }
  }
  const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const titleParts = title.split(/\s+[|–—:·•-]\s+|\s*\|\s*/).map((p) => p.trim()).filter(usable);
  return [...declared, ...structured, ...titleParts].find(matchesAddress) ?? null;
}

/** A page's title as text (the Maps search key for a business whose name doesn't match its address). */
export function pageTitle(html: string): string {
  return decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

/** The name of the Maps listing whose website is this address. */
export function nameFromMaps(places: readonly MapsPlace[], domain: string): string | null {
  const host = hostOf(domain);
  return places.find((p) => p.domain && (p.domain === host || p.domain.endsWith(`.${host}`)))?.name ?? null;
}
