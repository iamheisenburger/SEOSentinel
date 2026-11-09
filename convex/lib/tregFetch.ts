"use node";
/** v3.1 (Nov 3 2026, ops/TREG-FOR-PENTRA.md): treg.web.extract renders JavaScript pages ($0.00015 a call) as the FALLBACK
 * when the direct pinned fetch fails or returns too little text — batch 7's brief could read 1 of 8 result pages (Google's
 * goto wrappers and JS-rendered listicles), so a list's seed options were whatever research happened to keep. A treg
 * failure or a missing token never blocks: the caller sees what the direct fetch saw (or nothing, as before).
 *
 * Nov 9 2026 (Cowork's test 2): treg's routed reply wraps the page as `output.pages[].markdown`, which this parser never
 * looked inside, so the fallback returned nothing for every page a host blocked (the Boise dentist's SiteGround check).
 * `fetchReadable` is the Answers engine's fetch: always plain text (the direct fetch returns raw HTML), a host's bot check
 * never taken for the page, and the page's same-site links for finding the business's other pages. */
import { safeFetchPublicText } from "./safeOutbound.ts";
import { siteLinks, type SiteLink } from "./siteLinks.ts";
import { challengeText, htmlToText, looksLikeMarkup, markdownLinks, markdownToText, mergeLinks, preferredSitemaps, sitemapEntries } from "./pageText.ts";

const TEXT_KEYS = ["markdown", "content", "text", "extracted_content", "cleaned_content"];
const CONTAINER_KEYS = ["output", "pages", "data", "result", "items", "raw"];

export function tregExtractedText(payload: unknown): string {
  const dig = (value: unknown, depth = 0): string => {
    if (depth > 6 || value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return "";
    if (Array.isArray(value)) return value.map((v) => dig(v, depth + 1)).filter(Boolean).join("\n");
    const obj = value as Record<string, unknown>;
    for (const key of TEXT_KEYS) {
      if (key in obj) { const got = dig(obj[key], depth + 1); if (got.length > 200) return got; }
    }
    for (const key of CONTAINER_KEYS) {
      if (key in obj) { const got = dig(obj[key], depth + 1); if (got.length > 200) return got; }
    }
    return "";
  };
  return dig(payload);
}

/** The page text in treg's routed reply, however short (a sitemap index is a few addresses); other shapes as above. */
export function tregPageText(payload: unknown): string {
  const pages = (payload as { output?: { pages?: unknown } } | null)?.output?.pages;
  if (Array.isArray(pages)) {
    const text = pages.map((p) => { const page = p as Record<string, unknown>; return [page.markdown, page.content, page.text].find((t): t is string => typeof t === "string") ?? ""; })
      .filter(Boolean).join("\n");
    if (text) return text;
  }
  return tregExtractedText(payload);
}

async function tregRendered(url: string): Promise<string> {
  const token = process.env.TREG_TOKEN;
  if (!token) return "";
  try {
    const response = await fetch("https://treg.to/call/treg.web.extract", { method: "POST",
      headers: { "Content-Type": "application/json", "X-Treg-Token": token, "X-Treg-Route-Max-Cost": "0.01", "X-Treg-Meta": "feature=pentra-page-read" },
      body: JSON.stringify({ url }), signal: AbortSignal.timeout(45_000) });
    return response.ok ? tregPageText(await response.json()) : "";
  } catch { return ""; }
}

/** Sitemaps are XML, which the page fetch refuses by default. */
const SITEMAP_TYPES = [/^(?:text|application)\/(?:xml|html|plain|xhtml\+xml|rss\+xml)(?:;|$)/i];

export async function fetchPublicTextRendered(url: string, minChars = 600): Promise<{ url: string; text: string }> {
  let direct: { url: string; text: string } | null = null;
  try {
    direct = await safeFetchPublicText(url, { sameHostRedirects: true });
    if (direct.text.length >= minChars) return direct;
  } catch { /* the rendered fallback below is the point */ }
  const text = await tregRendered(url);
  if (text.length >= minChars) return { url, text };
  return direct ?? { url, text: "" };
}

export type ReadablePage = { url: string; text: string; html: string; links: SiteLink[]; via: "direct" | "rendered" | "none"; blocked: boolean };

/** A page as a visitor reads it: the direct fetch turned into text, or, when the host blocks Pentra's servers or the page
 * needs JavaScript, treg's rendered copy. `html` is the direct HTML when there was one (titles, headings, meta). */
export async function fetchReadable(url: string, minChars = 400, domain?: string): Promise<ReadablePage> {
  const host = domain ?? new URL(url).hostname;
  let direct: ReadablePage = { url, text: "", html: "", links: [], via: "none", blocked: false };
  try {
    const page = await safeFetchPublicText(url, { sameHostRedirects: true });
    if (challengeText(page.text)) direct = { ...direct, blocked: true };
    else if (looksLikeMarkup(page.text)) direct = { url: page.url, text: htmlToText(page.text), html: page.text, links: siteLinks(page.text, host), via: "direct", blocked: false };
    else direct = { url: page.url, text: markdownToText(page.text), html: "", links: [], via: "direct", blocked: false };
    if (direct.text.length >= minChars) return direct;
  } catch { /* blocked, missing or unreadable: the rendered copy below */ }
  const markdown = await tregRendered(url);
  if (markdown && !challengeText(markdown)) {
    const text = markdownToText(markdown);
    if (text.length > direct.text.length) {
      return { url, text, html: direct.html, links: mergeLinks(direct.links, markdownLinks(markdown, host)), via: "rendered", blocked: false };
    }
  }
  return direct.text ? direct : { ...direct, blocked: direct.blocked || Boolean(markdown) };
}

/** The pages a business's sitemap lists (its service and product pages are often not linked from the homepage text):
 * sitemap.xml, then the WordPress names, then up to three nested sitemaps of an index. Never throws. */
export async function sitemapLinks(domain: string): Promise<SiteLink[]> {
  const raw = async (url: string) => {
    try {
      const page = await safeFetchPublicText(url, { sameHostRedirects: true, allowedContentTypes: SITEMAP_TYPES, maxBytes: 3_000_000 });
      if (!challengeText(page.text)) return page.text;
    } catch (error) {
      // A missing sitemap is missing for every visitor; only a refusal (a host's bot check) is worth the renderer.
      if (/HTTP 404|HTTP 410/.test(String(error))) return "";
    }
    return tregRendered(url);
  };
  for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/wp-sitemap.xml"]) {
    const body = await raw(`https://${domain}${path}`);
    if (!body) continue;
    const { pages, sitemaps } = sitemapEntries(body, domain);
    if (!pages.length && !sitemaps.length) continue;
    const nested = await Promise.all(preferredSitemaps(sitemaps).map(async (url) => sitemapEntries(await raw(url), domain).pages));
    return mergeLinks(pages, ...nested).slice(0, 400);
  }
  return [];
}
