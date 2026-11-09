/** Pentra Answers (Nov 9 2026, Cowork test 2): a fetched page as the words a visitor reads. The direct fetch returns the
 * page's raw HTML and treg's renderer returns Markdown; the writer, the site read and the sources box all need plain text
 * (test 2 showed "<!DOCTYPE html>…" as a source's quote, and the writer saw a page's <head> instead of its facts). Also:
 * a business's own pages found from its links and its sitemap, and a bot check recognised in either form. Pure. */
import { hostOf } from "./answerEngine.ts";
import type { SiteLink } from "./siteLinks.ts";

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—",
  hellip: "…", copy: "©", reg: "®", trade: "™", dollar: "$", euro: "€", pound: "£", middot: "·", bull: "•", times: "×",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? all;
  });
}

/** Whether a fetched body is HTML or XML markup rather than text. */
export function looksLikeMarkup(text: string): boolean {
  return /^\s*(?:<!doctype\s|<html[\s>]|<head[\s>]|<\?xml|<urlset[\s>]|<sitemapindex[\s>])/i.test(text) ||
    (text.match(/<\/?(?:div|span|p|a|meta|script|link|li|section|loc|url)\b/gi)?.length ?? 0) >= 8;
}

const tidyLines = (text: string) => text.split("\n").map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim()).filter(Boolean).join("\n");

/** The words a visitor reads on an HTML page: no head, scripts, styles, menus, forms or hidden templates; headings,
 * paragraphs and list items on their own lines. The footer stays: a local business's address and hours are often only there. */
export function htmlToText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<head[\s>][\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|svg|template|iframe|form|select|button|nav|aside|dialog)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|header|main|blockquote|ul|ol|table|dd|dt|figcaption)\s*>/gi, "\n")
    .replace(/<(?:h[1-6]|p|div|section|article|header|main|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return dropConsentText(tidyLines(decodeEntities(body)));
}

/** Markdown (treg's renderer) as plain text: images dropped, links kept as their words, escapes and emphasis removed. */
export function markdownToText(markdown: string): string {
  const text = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^)]*\))*\)/g, "$1")
    .replace(/<(https?:\/\/[^>\s]+)>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/^\s*>\s?/gm, "");
  return dropConsentText(tidyLines(decodeEntities(text)));
}

/** A page's text without its cookie banner (treg's renderer keeps the consent dialog: "Cookie Preferences … 30 days"). */
export function dropConsentText(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^(?:cookie (?:consent|preferences|settings|policy)|manage (?:your )?cookie preferences|we use cookies\b)/i.test(line.trim()));
  if (start < 0) return text;
  // The banner runs to the end of the page, except for a contact line (address, phone) the footer prints after it.
  const tail = lines.slice(start).filter((line) => /^(?:address\b|call\b|phone\b|\(?\+?\d[\d\s().-]{7,}\d\)?$)/i.test(line.trim()));
  return [...lines.slice(0, start), ...tail].join("\n").trim();
}

/** Any fetched body (HTML, XML, Markdown or text) as plain text. */
export function readableText(body: string): string {
  return looksLikeMarkup(body) ? htmlToText(body) : markdownToText(body);
}

/** A host's bot check instead of the page (SiteGround's sgcaptcha, Cloudflare, Incapsula, DataDome, PerimeterX), in raw
 * HTML or in the text a renderer returned for it. */
export function challengeText(body: string): boolean {
  if (/\/\.well-known\/sgcaptcha|sgcaptcha|cf-browser-verification|cf_chl_|_Incapsula_Resource|px-captcha|captcha-delivery\.com/i.test(body)) return true;
  const text = looksLikeMarkup(body) ? htmlToText(body) : body;
  return text.length < 1500 && /(?:verify(?:ing)? (?:that )?you are (?:a )?human|checking (?:if the site connection is secure|your browser)|just a moment\.\.\.|attention required!|enable javascript and cookies to continue|access denied|are you a robot|please complete the security check)/i.test(text);
}

const FILE = /\.(?:pdf|jpe?g|png|gif|webp|svg|avif|ico|zip|docx?|xlsx?|pptx?|mp4|mov|webm|mp3|wav|css|js|json|woff2?|ttf)$/i;

/** A same-site page address in the form links are compared by: https, no query, hash or trailing slash; `null` for another
 * site, a file, or the uploads folder. */
export function sitePageUrl(raw: string, domain: string): string | null {
  const root = hostOf(domain);
  let url: URL;
  try { url = new URL(raw.trim().replace(/[).,;]+$/, ""), `https://${root}/`); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || hostOf(url.href) !== root) return null;
  if (FILE.test(url.pathname) || /\/wp-content\/|\/wp-json\/|\/feed\/?$|\/cdn-cgi\//i.test(url.pathname)) return null;
  return `https://${root}${url.pathname.replace(/\/+$/, "")}`;
}

/** Words for a link that has none (a sitemap entry): its path, "/dental-services/sleep-apnea/" → "dental services sleep apnea". */
export const pathWords = (url: string) => {
  try { return decodeURIComponent(new URL(url).pathname).replace(/[/_-]+/g, " ").replace(/\.\w+$/, "").trim(); } catch { return ""; }
};

/** The same-site links in Markdown (treg's renderer), with their words, once each. */
export function markdownLinks(markdown: string, domain: string): SiteLink[] {
  const seen = new Set<string>([`https://${hostOf(domain)}`]);
  const links: SiteLink[] = [];
  for (const m of markdown.matchAll(/\[([^\]]{0,200})\]\((https?:\/\/[^)\s]+)\)/g)) {
    const url = sitePageUrl(m[2], domain);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ url, text: markdownToText(m[1]).replace(/\s+/g, " ").slice(0, 80) || pathWords(url) });
    if (links.length >= 300) break;
  }
  return links;
}

/** The page addresses a sitemap lists (XML, or the text a renderer made of it), same site only, files left out; the
 * nested sitemaps of a sitemap index are returned separately. */
export function sitemapEntries(body: string, domain: string): { pages: SiteLink[]; sitemaps: string[] } {
  const root = hostOf(domain);
  const pages: SiteLink[] = [];
  const sitemaps: string[] = [];
  const seen = new Set<string>([`https://${root}`]);
  const urls = body.match(/https?:\/\/[^\s<>"')\]]+/g) ?? [];
  for (const raw of urls) {
    const clean = decodeEntities(raw);
    let path = "";
    try { path = new URL(clean).pathname; } catch { continue; }
    if (/\.xml(?:\.gz)?$/i.test(path)) {
      if (hostOf(clean) === root && !sitemaps.includes(clean)) sitemaps.push(clean);
      continue;
    }
    const url = sitePageUrl(clean, domain);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    pages.push({ url, text: pathWords(url) });
    if (pages.length >= 500) break;
  }
  return { pages, sitemaps };
}

/** Which nested sitemaps of an index to read: pages, services and products before posts; never images, authors or tags. */
export function preferredSitemaps(sitemaps: readonly string[], limit = 3): string[] {
  const rank = (url: string) => /image|video|author|tag|category|attachment|media|news/i.test(url) ? -1
    : /page|service|product|treatment|feature|solution|landing|location/i.test(url) ? 3 : /post|blog|article|guide/i.test(url) ? 1 : 2;
  return sitemaps.map((url) => ({ url, r: rank(url) })).filter((x) => x.r >= 0).sort((a, b) => b.r - a.r).slice(0, limit).map((x) => x.url);
}

/** Links from several places (homepage links, the sitemap), once each, the first words kept. */
export function mergeLinks(...lists: ReadonlyArray<readonly SiteLink[]>): SiteLink[] {
  const byUrl = new Map<string, SiteLink>();
  for (const list of lists) for (const link of list) {
    const key = link.url.replace(/\/+$/, "");
    if (!byUrl.has(key)) byUrl.set(key, { url: key, text: link.text });
  }
  return [...byUrl.values()];
}
