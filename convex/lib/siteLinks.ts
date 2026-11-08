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

/** The pages about a question's subject: links whose words share the question's meaningful words, best match first. */
export function relevantLinks(links: readonly SiteLink[], question: string, limit = 2): SiteLink[] {
  const wanted = new Set(meaningfulWords(question));
  if (!wanted.size) return [];
  return links.map((l) => {
    const words = new Set([...meaningfulWords(l.text), ...meaningfulWords(decodeURIComponent(new URL(l.url).pathname))]);
    return { l, hits: [...wanted].filter((w) => words.has(w)).length };
  }).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits || a.l.url.length - b.l.url.length).slice(0, limit).map((x) => x.l);
}

/** A host's hidden bot check (SiteGround's sgcaptcha, a meta-refresh challenge): a page with no business text at all. */
export function challengePage(html: string): boolean {
  return /\/\.well-known\/sgcaptcha|sgcaptcha|<meta[^>]+http-equiv=["']refresh["'][^>]+captcha/i.test(html);
}
