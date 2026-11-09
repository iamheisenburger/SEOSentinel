/** Pentra Answers (Nov 8 2026): a business's own pages, found from its homepage links. The site read takes its about and
 * services pages; a page writer takes the pages about the question's subject (a dentist's "Sleep Apnea" page for a sleep
 * apnea question), so a page never says the business lacks what its own site offers. Pure. */
import { hostOf } from "./answerEngine.ts";

export type SiteLink = { url: string; text: string };

const STOP = new Set(["the", "and", "for", "with", "your", "you", "our", "are", "what", "which", "who", "how", "does", "best", "good", "near",
  "can", "should", "need", "that", "this", "from", "into", "about", "will", "have", "get", "does", "much", "cost", "costs", "price", "is", "a", "an",
  "to", "of", "in", "on", "my", "me", "do", "i", "it", "or", "be", "by", "at", "as", "vs", "than", "more", "most", "there", "any", "find"]);

export const meaningfulWords = (text: string) => text.toLowerCase().replace(/['’®™]/g, "").split(/[^a-z0-9]+/)
  .filter((w) => w.length >= 4 && !STOP.has(w));

/** The internal links of a page: absolute same-site addresses with their visible text, once each, no files or anchors. */
export function siteLinks(html: string, domain: string): SiteLink[] {
  const root = hostOf(domain);
  const seen = new Set<string>();
  const links: SiteLink[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try { url = new URL(m[1].trim(), `https://${root}/`); } catch { continue; }
    if (!/^https?:$/.test(url.protocol) || hostOf(url.href) !== root) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)$/i.test(url.pathname)) continue;
    url.hash = ""; url.search = "";
    const href = url.href.replace(/\/$/, "");
    if (href === `https://${root}` || seen.has(href)) continue;
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#?\w+;/g, " ").replace(/\s+/g, " ").trim();
    seen.add(href);
    links.push({ url: href, text: text.slice(0, 80) });
    if (links.length >= 300) break;
  }
  return links;
}

/** The pages that say what the business does: about, services, treatments, products, solutions, pricing. */
export function profileLinks(links: readonly SiteLink[], limit = 3): SiteLink[] {
  const rank = (l: SiteLink) => {
    const s = `${new URL(l.url).pathname} ${l.text}`.toLowerCase();
    if (/(services?|treatments?|what-we-do|solutions?|products?|offerings?)/.test(s)) return 3;
    if (/(about|who-we-are|our-story|team)/.test(s)) return 2;
    if (/(pricing|prices|plans|fees)/.test(s)) return 1;
    return 0;
  };
  return links.map((l) => ({ l, r: rank(l) })).filter((x) => x.r > 0).sort((a, b) => b.r - a.r).slice(0, limit).map((x) => x.l);
}

/** A business's key pages, one of each kind found (Nov 9 2026: a software company's features page held the "weekly or
 * monthly emails" its page said it didn't mention): what it offers, its prices, who it is, its common questions. The
 * shortest matching address wins (the section page, not one article inside it). */
export function keyLinks(links: readonly SiteLink[], limit = 4): SiteLink[] {
  const kinds = [
    /(^|[\s/-])(services?|treatments?|solutions?|products?|features?|what-we-do|offerings?|menu|shop|collections?|how-it-works)([\s/-]|$)/,
    /(^|[\s/-])(pricing|prices?|plans?|fees|rates|cost)([\s/-]|$)/,
    /(^|[\s/-])(about|about-us|who-we-are|our-story|team|company)([\s/-]|$)/,
    /(^|[\s/-])(faqs?|questions|help|support)([\s/-]|$)/,
  ];
  const chosen: SiteLink[] = [];
  for (const kind of kinds) {
    const match = links.filter((l) => !chosen.includes(l) && kind.test(`${new URL(l.url).pathname.toLowerCase()} ${l.text.toLowerCase()}`))
      .sort((a, b) => new URL(a.url).pathname.split("/").filter(Boolean).length - new URL(b.url).pathname.split("/").filter(Boolean).length || a.url.length - b.url.length)[0];
    if (match) chosen.push(match);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

/** The pages about a question's subject: links whose words share the question's meaningful words, best match first. */
export function relevantLinks(links: readonly SiteLink[], question: string, limit = 2): SiteLink[] {
  const wanted = new Set(meaningfulWords(question));
  if (!wanted.size) return [];
  const wordsOf = links.map((l) => {
    let path = "";
    try { path = decodeURIComponent(new URL(l.url).pathname); } catch { path = l.url; }
    return new Set([...meaningfulWords(l.text), ...meaningfulWords(path)]);
  });
  // Nov 9 2026: words most of a site's addresses share (its own trade: "analytics" on an analytics company's 400 pages)
  // say nothing about one page; and the business's own pages come before its blog's articles about other products.
  const seen = new Map<string, number>();
  for (const words of wordsOf) for (const w of words) seen.set(w, (seen.get(w) ?? 0) + 1);
  const informative = [...wanted].filter((w) => links.length < 12 || (seen.get(w) ?? 0) / links.length <= 0.2);
  const article = (url: string) => /\/(?:blog|learn|news|articles?|posts?|resources|insights|guides?|stories|library)\//i.test(url) ? 1 : 0;
  return links.map((l, i) => ({ l, hits: informative.filter((w) => wordsOf[i].has(w)).length }))
    .filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits || article(a.l.url) - article(b.l.url) || a.l.url.length - b.l.url.length)
    .slice(0, limit).map((x) => x.l);
}

/** A host's hidden bot check (SiteGround's sgcaptcha, a meta-refresh challenge): a page with no business text at all. */
export function challengePage(html: string): boolean {
  return /\/\.well-known\/sgcaptcha|sgcaptcha|<meta[^>]+http-equiv=["']refresh["'][^>]+captcha/i.test(html);
}
