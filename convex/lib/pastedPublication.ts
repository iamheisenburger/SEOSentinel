/** "I pasted it": owners on other platforms (Shopify, Webflow, Squarespace…)
 * publish Pentra's article themselves. Pentra then checks the public page for
 * the article's title and its own paragraphs before counting it as live. Pure:
 * no network, no model call. The page is evidence; the owner's word is not. */

const norm = (value: string) => value.toLowerCase()
  .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;|&rsquo;|&lsquo;|’|‘/g, "'")
  .replace(/&ldquo;|&rdquo;|“|”/g, '"').replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, " ")
  .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export function pageText(html: string) {
  return norm(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

/** Body paragraphs of the article (no headings, lists, tables, code, images, links-only lines). */
export function articleParagraphs(markdown: string, max = 12) {
  return markdown.split(/\n\s*\n/).map(block => block.trim())
    .filter(block => block && !/^(?:#|[-*+] |\d+\. |\||```|!\[|<|>)/.test(block))
    .map(block => norm(block.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "")))
    .filter(text => text.length >= 80).slice(0, max);
}

export type PastedMatch = { titleFound: boolean; matched: number; total: number; live: boolean };

/** Live when the title is on the page and at least half of the article's
 * paragraphs are recognisably there (a probe from each paragraph, so light
 * edits while pasting still count). */
export function matchPastedArticle(html: string, article: { title?: string; markdown?: string }): PastedMatch {
  const page = pageText(html), title = norm(article.title ?? "");
  const paragraphs = articleParagraphs(article.markdown ?? "");
  const matched = paragraphs.filter(p => {
    const probes = [p.slice(0, 60), p.slice(Math.max(0, Math.floor(p.length / 2) - 30), Math.floor(p.length / 2) + 30), p.slice(-60)];
    return probes.some(probe => probe.length >= 40 && page.includes(probe));
  }).length;
  const titleFound = title.length >= 8 && page.includes(title);
  return { titleFound, matched, total: paragraphs.length, live: titleFound && paragraphs.length > 0 && matched * 2 >= paragraphs.length };
}

/** A public HTTPS page on the owner's own website (the domain, www, or a subdomain). */
export function pastedUrlForSite(input: string, siteDomain: string): string | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  const bare = siteDomain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username || url.password || url.port || !bare ||
    !(host === bare || host.endsWith(`.${bare}`)) || url.href.length > 500) return null;
  url.hash = "";
  return url.href;
}
