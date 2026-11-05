"use node";
/** Reading one published address the way Google first meets it (Nov 2026, the site diagnosis's crawl). A redirect is
 * recorded with its destination and never followed blindly: a crawler that follows redirects mistakes a deliberate
 * permanent redirect for a page that names another page as the real one (the diagnosis's first run did exactly that).
 * A page that loads is read for what ranking needs: title, description, main heading, words, images, the site's own
 * pages it links to, canonical, noindex, structured data, load time. The site's sitemap is read for the addresses it
 * lists.
 */
import { fetchPage } from "./fetchPage";
import { safeFetchPublicText, safePublicRedirectStatus } from "./safeOutbound";
import { analyzePageHealth, canonicalHref, robotsTxtFindings, sitemapIndexChildren, sitemapUrls } from "./siteHealth";
import { normalize, type CrawledPage, type SpeedCheck } from "./siteDiagnosis";

export type CrawlDeps = {
  redirectStatus: (url: string) => Promise<{ status: number; location: string | null }>;
  fetch: (url: string, options?: { maxBytes?: number }) => Promise<{ status: number; finalUrl: string; html: string; robots: string | null }>;
  clock?: () => number;
};
const live: CrawlDeps = { redirectStatus: safePublicRedirectStatus, fetch: fetchPage };
/** Links kept per page: enough for any article, bounded for a page that links everywhere. */
const MAX_LINKS = 400;

/** The site's own addresses a page links to (normalized, same host with or without www, no fragments). */
export function sameSiteLinks(html: string, pageUrl: string): string[] {
  let base: URL;
  try { base = new URL(pageUrl); } catch { return []; }
  const host = base.host.replace(/^www\./, "").toLowerCase();
  const out = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1].trim();
    if (!href || href.startsWith("#") || /^(?:mailto|tel|javascript):/i.test(href)) continue;
    try {
      const url = new URL(href, base);
      if (!/^https?:$/.test(url.protocol) || url.host.replace(/^www\./, "").toLowerCase() !== host) continue;
      out.add(normalize(url.toString()));
    } catch { /* not an address */ }
    if (out.size >= MAX_LINKS) break;
  }
  return [...out];
}

export async function crawlPage(url: string, deps: CrawlDeps = live): Promise<CrawledPage> {
  try {
    const first = await deps.redirectStatus(url);
    if (first.status >= 300 && first.status < 400) {
      let location: string | null = null;
      try { location = first.location ? new URL(first.location, url).toString() : null; } catch { location = null; }
      return { url, status: first.status, location };
    }
    if (first.status >= 400) return { url, status: first.status };
  } catch { /* a page the redirect check can't read (not HTML, too large) is read in full below */ }
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const page = await deps.fetch(url);
  const loadMs = clock() - started;
  if (page.status !== 200) return { url, status: page.status };
  const health = analyzePageHealth({ url, status: 200, finalUrl: page.finalUrl, html: page.html, robotsHeader: page.robots });
  let canonical: string | null = canonicalHref(page.html);
  try { canonical = canonical ? new URL(canonical, page.finalUrl).toString() : null; } catch { /* keep the raw value */ }
  return { url, status: 200, title: health.title, description: !health.issues.some((i) => i.code === "description_missing"),
    h1: (page.html.match(/<h1\b/gi) ?? []).length, words: health.wordCount, images: (page.html.match(/<img\b/gi) ?? []).length,
    links: sameSiteLinks(page.html, page.finalUrl), canonical, noindex: health.issues.some((i) => i.code === "noindex"),
    structuredData: !health.issues.some((i) => i.code === "schema_missing"), loadMs };
}

/** Several addresses, a few at a time, each read once. */
export async function crawlPages(urls: readonly string[], concurrency = 4, deps: CrawlDeps = live): Promise<Map<string, CrawledPage>> {
  const out = new Map<string, CrawledPage>();
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      const key = normalize(url);
      if (out.has(key)) continue;
      out.set(key, { url, status: 0 });
      try { out.set(key, await crawlPage(url, deps)); } catch { /* recorded as unreachable */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out;
}

const SITEMAP_MAX_BYTES = 5_000_000;

/** The addresses the site's sitemaps list: /sitemap.xml and every sitemap robots.txt declares, one level of sitemap
 * index below them. Bounded; "found" says whether any sitemap answered. */
export async function readSitemap(domain: string, deps: Pick<CrawlDeps, "fetch"> = live, limit = 2_000): Promise<{ found: boolean; urls: string[] }> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const home = `https://${host}/`;
  const robots = await deps.fetch(`${home}robots.txt`).catch(() => null);
  const declared = robots?.status === 200 ? robotsTxtFindings(robots.html).sitemaps : [];
  const urls = new Set<string>(), children: string[] = [];
  let found = false;
  const read = async (files: string[], index: boolean) => {
    for (const file of files) {
      if (urls.size >= limit) return;
      const page = await deps.fetch(file, { maxBytes: SITEMAP_MAX_BYTES }).catch(() => null);
      if (!page || page.status !== 200) continue;
      found = true;
      if (index) for (const child of sitemapIndexChildren(page.html, host, 8)) if (!children.includes(child)) children.push(child);
      for (const url of sitemapUrls(page.html, host, limit)) urls.add(url);
    }
  };
  await read([...new Set([`${home}sitemap.xml`, ...declared])].slice(0, 4), true);
  await read(children.slice(0, 8), false);
  return { found, urls: [...urls].slice(0, limit) };
}

/** Google's mobile speed test (PageSpeed Insights) as a speed check, or null when its answer has neither number. */
export function parsePageSpeed(url: string, psi: unknown): SpeedCheck | null {
  const result = (psi as { lighthouseResult?: { categories?: { performance?: { score?: unknown } };
    audits?: Record<string, { numericValue?: unknown } | undefined> } } | null)?.lighthouseResult;
  const score = typeof result?.categories?.performance?.score === "number" ? Math.round(result.categories.performance.score * 100) : null;
  const lcp = result?.audits?.["largest-contentful-paint"]?.numericValue;
  const lcpMs = typeof lcp === "number" && Number.isFinite(lcp) ? Math.round(lcp) : null;
  return score === null && lcpMs === null ? null : { url, score, lcpMs };
}

const PSI_FIELDS = "lighthouseResult.categories.performance.score,lighthouseResult.audits.largest-contentful-paint.numericValue";

/** One page through Google's mobile speed test; free (an optional key raises its quota). Any error or quota limit means
 * no speed check for that page, never a guess. */
export async function pageSpeedCheck(url: string, fetchJson: (url: string) => Promise<unknown> = async (target) =>
  JSON.parse((await safeFetchPublicText(target, { expectedHost: "www.googleapis.com", maxRedirects: 0, maxBytes: 200_000, timeoutMs: 60_000,
    headers: { Accept: "application/json" } })).text)): Promise<SpeedCheck | null> {
  const params = new URLSearchParams({ url, strategy: "mobile", category: "performance", fields: PSI_FIELDS });
  if (process.env.PAGESPEED_API_KEY) params.set("key", process.env.PAGESPEED_API_KEY);
  try { return parsePageSpeed(url, await fetchJson(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`)); }
  catch { return null; }
}
