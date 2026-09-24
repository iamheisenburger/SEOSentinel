/** Deterministic on-page health checks for a customer's important pages.
 * Pure: the action fetches HTML; this only reads it. Findings are phrased for
 * a site owner, not an SEO specialist. */

export type PageHealthInput = {
  url: string;
  status: number;
  finalUrl?: string;
  html: string;
  robotsHeader?: string | null;
  /** The site's next-step page (signup, booking, quote), if the owner set one. */
  ctaUrl?: string | null;
};

export type PageHealthIssue = { code: string; severity: "critical" | "warning"; message: string };
export type PageHealthResult = {
  url: string;
  status: number;
  title: string | null;
  metaDescription: string | null;
  h1Count: number;
  wordCount: number;
  internalLinkCount: number;
  issues: PageHealthIssue[];
};

const safeCodePoint = (code: number) => Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
const decode = (value: string) => value.replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d{1,7});/g, (_, code) => safeCodePoint(Number(code))).replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

function metaContent(html: string, name: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (key === name) return decode(/\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "");
  }
  return null;
}

function canonicalHref(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel\s*=\s*["'][^"']*\bcanonical\b[^"']*["']/i.test(tag)) {
      return /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
    }
  }
  return null;
}

function normalized(url: string) {
  try { const u = new URL(url); return `${u.protocol}//${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "") || "/"}`; }
  catch { return url; }
}

export function analyzePageHealth(page: PageHealthInput): PageHealthResult {
  const issues: PageHealthIssue[] = [];
  const add = (code: string, severity: PageHealthIssue["severity"], message: string) => issues.push({ code, severity, message });
  const html = page.html ?? "";
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const cleanTitle = title === undefined ? null : decode(title);
  const description = metaContent(html, "description");
  const robots = `${metaContent(html, "robots") ?? ""} ${page.robotsHeader ?? ""}`.toLowerCase();
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const wordCount = decode(body).split(" ").filter(word => /[\p{L}\p{N}]/u.test(word)).length;
  const h1Count = (html.match(/<h1\b/gi) ?? []).length;
  let host = "";
  try { host = new URL(page.finalUrl ?? page.url).host.replace(/^www\./, ""); } catch { /* invalid URL reported below */ }
  const internalLinkCount = (html.match(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi) ?? []).filter(tag => {
    const href = /href\s*=\s*["']([^"'#]+)["']/i.exec(tag)?.[1] ?? "";
    if (href.startsWith("/") && !href.startsWith("//")) return true;
    try { return new URL(href).host.replace(/^www\./, "") === host; } catch { return false; }
  }).length;

  if (page.status >= 400 || page.status === 0) {
    add("unreachable", "critical", `This page returns an error (HTTP ${page.status || "no response"}), so Google can't show it.`);
  }
  if (/\bnoindex\b/.test(robots)) add("noindex", "critical", "This page tells search engines not to index it (noindex).");
  if (page.status < 400 && page.status > 0) {
    if (!cleanTitle) add("title_missing", "critical", "The page has no title, which is the headline Google shows in results.");
    else if (cleanTitle.length < 15) add("title_short", "warning", `The title is very short (${cleanTitle.length} characters). Describe what the page offers.`);
    else if (cleanTitle.length > 65) add("title_long", "warning", `The title is ${cleanTitle.length} characters; Google usually cuts titles after about 60.`);
    if (!description) add("description_missing", "warning", "There's no meta description, so Google picks its own snippet.");
    else if (description.length < 70) add("description_short", "warning", `The meta description is short (${description.length} characters). Aim for 120–155.`);
    else if (description.length > 165) add("description_long", "warning", `The meta description is ${description.length} characters; it will be cut off in results.`);
    if (h1Count === 0) add("h1_missing", "warning", "The page has no main heading (H1).");
    else if (h1Count > 1) add("h1_multiple", "warning", `The page has ${h1Count} main headings (H1); one is clearer.`);
    if (wordCount < 150) add("thin_text", "warning", `Only about ${wordCount} words of readable text; search engines may see little to rank.`);
    const canonical = canonicalHref(html);
    if (canonical) {
      let absolute = canonical;
      try { absolute = new URL(canonical, page.finalUrl ?? page.url).toString(); } catch { /* keep raw */ }
      if (normalized(absolute) !== normalized(page.finalUrl ?? page.url)) {
        add("canonical_other", "warning", `The canonical tag points to a different URL (${absolute}), so Google may index that page instead.`);
      }
    }
    if (internalLinkCount === 0) add("no_internal_links", "warning", "No links to other pages on your site; visitors and Google hit a dead end.");
    // AI-answer readability: structured data tells Google and AI assistants what the page is.
    if (!/<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html)) {
      add("schema_missing", "warning", "No structured data (schema.org) on this page. Google rich results and AI answers rely on it.");
    }
    // Conversion path: every page should offer the next step to becoming a customer.
    if (page.ctaUrl) {
      let target: URL | null = null;
      try { target = new URL(page.ctaUrl); } catch { target = null; }
      const here = normalized(page.finalUrl ?? page.url);
      if (target && normalized(target.toString()) !== here) {
        const path = target.pathname.replace(/\/+$/, "") || "/";
        const linksToCta = (html.match(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi) ?? []).some(tag => {
          const href = /href\s*=\s*["']([^"'#]+)["']/i.exec(tag)?.[1] ?? "";
          try { const u = new URL(href, page.finalUrl ?? page.url); return u.host.replace(/^www\./, "") === target!.host.replace(/^www\./, "") && (u.pathname.replace(/\/+$/, "") || "/") === path; }
          catch { return false; }
        });
        if (!linksToCta) add("no_next_step", "warning", `No link to your next-step page (${target.pathname}), so readers have no clear way to become customers.`);
      }
    }
  }
  return { url: page.url, status: page.status, title: cleanTitle, metaDescription: description, h1Count, wordCount, internalLinkCount, issues };
}

/** Sitemap <loc> URLs on the same host, first-party only, bounded. */
export function sitemapUrls(xml: string, siteHost: string, limit = 10): string[] {
  const host = siteHost.replace(/^www\./, "").toLowerCase();
  const urls: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    try {
      const url = new URL(decode(match[1]));
      if (url.protocol === "https:" && url.host.replace(/^www\./, "").toLowerCase() === host && !/\.xml$/i.test(url.pathname) &&
        !urls.includes(url.toString())) urls.push(url.toString());
    } catch { /* ignore malformed entries */ }
    if (urls.length >= limit) break;
  }
  return urls;
}

export function healthScore(results: PageHealthResult[]) {
  if (results.length === 0) return 0;
  const penalty = results.reduce((sum, r) => sum + r.issues.reduce((s, i) => s + (i.severity === "critical" ? 25 : 6), 0), 0);
  return Math.max(0, Math.round(100 - penalty / results.length));
}

/** robots.txt: does it block all crawlers from the whole site, and which
 * sitemaps does it declare? Only the `*` and Googlebot groups matter here. */
export function robotsTxtFindings(txt: string): { blocksAll: boolean; sitemaps: string[] } {
  const sitemaps: string[] = [];
  type Group = { agents: string[]; disallowAll: boolean; allowRoot: boolean };
  const groups: Group[] = [];
  let current: Group | null = null, inRules = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), value = m[2].trim();
    if (key === "sitemap") { if (/^https:\/\//i.test(value)) sitemaps.push(value); continue; }
    if (key === "user-agent") {
      if (!current || inRules) { current = { agents: [], disallowAll: false, allowRoot: false }; groups.push(current); inRules = false; }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    inRules = true;
    if (key === "disallow" && value === "/") current.disallowAll = true;
    if (key === "allow" && (value === "/" || value === "/$")) current.allowRoot = true;
  }
  // Google obeys its own group when one exists, otherwise the * group.
  const google = groups.filter(g => g.agents.includes("googlebot"));
  const applicable = google.length ? google : groups.filter(g => g.agents.includes("*"));
  const blocksAll = applicable.length > 0 && applicable.some(g => g.disallowAll) && !applicable.some(g => g.allowRoot);
  return { blocksAll, sitemaps: sitemaps.slice(0, 5) };
}

/** Child sitemaps listed by a sitemap index on the same host. */
export function sitemapIndexChildren(xml: string, siteHost: string, limit = 3): string[] {
  if (!/<sitemapindex\b/i.test(xml)) return [];
  const host = siteHost.replace(/^www\./, "").toLowerCase(), out: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    try {
      const url = new URL(decode(match[1]));
      if (url.protocol === "https:" && url.host.replace(/^www\./, "").toLowerCase() === host && !out.includes(url.toString())) out.push(url.toString());
    } catch { /* ignore */ }
    if (out.length >= limit) break;
  }
  return out;
}

/** Speed pass from a PageSpeed Insights (mobile) response trimmed with
 * `fields`. Missing data yields no findings: never invent a speed problem. */
export function speedFindings(psi: unknown): PageHealthIssue[] {
  const result = (psi as { lighthouseResult?: { categories?: { performance?: { score?: unknown } };
    audits?: Record<string, { numericValue?: unknown } | undefined> } } | null)?.lighthouseResult;
  const issues: PageHealthIssue[] = [];
  const score = typeof result?.categories?.performance?.score === "number" ? Math.round(result.categories.performance.score * 100) : null;
  const lcp = result?.audits?.["largest-contentful-paint"]?.numericValue;
  const cls = result?.audits?.["cumulative-layout-shift"]?.numericValue;
  if (score !== null && score < 50) issues.push({ code: "speed_poor", severity: "critical",
    message: `Your homepage is slow on mobile (Google speed score ${score}/100). Slow pages rank lower and lose visitors.` });
  else if (score !== null && score < 90) issues.push({ code: "speed_fair", severity: "warning",
    message: `Your homepage could be faster on mobile (Google speed score ${score}/100).` });
  if (typeof lcp === "number" && lcp > 2500) issues.push({ code: "lcp_slow", severity: lcp > 4000 ? "critical" : "warning",
    message: `The main content takes ${(lcp / 1000).toFixed(1)}s to appear on mobile; Google recommends under 2.5s.` });
  if (typeof cls === "number" && cls > 0.1) issues.push({ code: "layout_shift", severity: "warning",
    message: `The page jumps around while loading (layout shift ${cls.toFixed(2)}; aim for under 0.1).` });
  return issues;
}
