/** Onboarding prefill: read a business's own homepage and suggest the setup
 * facts, so a new customer starts from their URL instead of a blank form.
 * Pure and deterministic (no model call, no cost). The owner still reviews
 * and confirms every fact before Pentra writes from it. */

export type BusinessPrefill = { name: string; summary: string; product: string; audience: string; questions: string[]; ctaText: string; ctaUrl: string };

const safeCodePoint = (code: number) => Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
const decode = (value: string) => value
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d{1,7});/g, (_, code) => safeCodePoint(Number(code))).replace(/\s+/g, " ").trim();

const text = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " "));

function meta(html: string, key: string): string {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (name === key) return decode(/\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "");
  }
  return "";
}

const tagTexts = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map(m => text(m[1])).filter(Boolean);

const clip = (value: string, max: number) => value.length <= max ? value : `${value.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;

/** A public website hostname, or null for anything that isn't one. */
export function normalizePrefillHost(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
  if (/\.(?:local|internal|localhost|test|example|invalid)$/.test(host)) return null;
  return host;
}

const CTA_TEXT = /^(?:get started|start (?:free|now|(?:your |a )?free trial)|sign up(?: free)?|try (?:it )?(?:for )?free|book (?:a |an |your )?[a-z ]{0,20}|schedule (?:a |your )?[a-z ]{0,20}|request (?:a )?(?:demo|quote|consultation)|get (?:a )?(?:quote|demo|estimate)|contact us|shop now|buy now|join (?:now|free))$/i;

/** The site's own primary call to action (signup, booking, quote), on the same site, over HTTPS. */
function primaryCta(html: string, host: string): { ctaText: string; ctaUrl: string } {
  const base = `https://${host}/`, bare = host.replace(/^www\./, "");
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const label = text(m[2]).replace(/[→›»]+$/, "").trim();
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1];
    if (!href || !CTA_TEXT.test(label)) continue;
    try {
      const url = new URL(decode(href), base);
      const sameSite = url.hostname === bare || url.hostname.endsWith(`.${bare}`);
      if (url.protocol === "https:" && sameSite && url.href.length <= 300 && !/[\s<>"'()[\]]/.test(url.href)) {
        return { ctaText: label.length <= 40 ? label.replace(/^./, c => c.toUpperCase()) : "Get started", ctaUrl: url.href };
      }
    } catch { /* ignore malformed links */ }
  }
  return { ctaText: "", ctaUrl: "" };
}

export function extractBusinessPrefill(html: string, host = ""): BusinessPrefill {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const parts = title.split(/\s+[|–—:·-]\s+/).map(s => s.trim()).filter(Boolean);
  const name = clip(meta(html, "og:site_name") || meta(html, "application-name") ||
    (parts.length > 1 ? [...parts].sort((a, b) => a.length - b.length)[0] : parts[0] ?? ""), 80);
  const paragraphs = tagTexts(html, "p").filter(p => p.length >= 60);
  const summary = clip(meta(html, "description") || meta(html, "og:description") || paragraphs[0] || "", 400);
  const h1 = tagTexts(html, "h1")[0] ?? "";
  const GENERIC = /^(?:how it works|what you get|features?|pricing|(?:simple,? )?(?:transparent )?pricing|plans?|questions|faqs?|frequently asked questions|testimonials|reviews|about(?: us)?|contact(?: us)?|get started|why (?:choose )?us|blog|latest (?:posts|articles|news)|our (?:team|story)|resources|newsletter|subscribe)\.?$/i;
  const h2s = tagTexts(html, "h2").filter(h => h.length >= 3 && h.length <= 80 && !h.endsWith("?") && !GENERIC.test(h)).slice(0, 4);
  const product = clip([h1 && h1 !== summary ? h1.replace(/[.!]$/, "") + "." : "", h2s.length ? `Includes: ${h2s.map(h => h.replace(/[.!]+$/, "")).join("; ")}.` : ""]
    .filter(Boolean).join(" ") || (paragraphs[1] ?? ""), 400);
  const forMatch = /\bfor ((?:small |local |growing )?[a-z][a-z &,'-]{3,60}?)(?=\s*(?:[.!,;:|–—]|-\s)|\s+(?:who|that|to|in|with)\b|\s*$)/i
    .exec([h1, summary, title].join(". "));
  const who = forMatch?.[1].trim() ?? "";
  // "for your website" / "for the web" describe a thing, not the people served.
  const audience = who && !/^(?:you|your|my|our|the|a|an|this|that|every|all|free|more|less|less than|only|just)\b/i.test(who) &&
    !/\b(?:website|site|web|business(?:es)? like yours|free)$/i.test(who) ? clip(who.replace(/^./, c => c.toUpperCase()), 120) : "";
  const seen = new Set<string>();
  const questions = ["h2", "h3", "h4", "summary", "dt", "button"].flatMap(tag => tagTexts(html, tag))
    .filter(q => q.endsWith("?") && q.length >= 12 && q.length <= 160)
    .filter(q => { const key = q.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 8);
  return { name, summary, product, audience, questions, ...(host ? primaryCta(html, host) : { ctaText: "", ctaUrl: "" }) };
}

/** The homepage's own words for a model to read (the free check's search
 * seeds): title, description, headings and the first paragraphs, bounded. */
export function homepageDigest(html: string): { title: string; description: string; headings: string[]; text: string } {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const seen = new Set<string>();
  const headings = ["h1", "h2", "h3"].flatMap(tag => tagTexts(html, tag)).filter(h => h.length >= 3 && h.length <= 120)
    .filter(h => { const key = h.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 25);
  return { title: clip(title, 160), description: clip(meta(html, "description") || meta(html, "og:description"), 300), headings,
    text: clip(tagTexts(html, "p").filter(p => p.length >= 40).join(" "), 1500) };
}

/** P213 (Oct 26 2026): where a website runs, read from its homepage, so setup suggests the right publishing
 * destination. Setup preselected GitHub, and the first real signups' sites all ended up as GitHub sites; one owner
 * connected GitHub and stopped at the repository picker. Platforms Pentra can't publish to (Wix, Squarespace,
 * Framer, HubSpot...) mean pasting; a site built with a code framework is usually published from a repository.
 * null when the page names nothing: the owner chooses. */
export type SitePlatform = { method: "wordpress" | "shopify" | "webflow" | "ghost" | "github" | "manual"; name: string };
const PLATFORM_SIGNS: Array<[RegExp, SitePlatform]> = [
  // WordPress first: a WordPress site may embed a Shopify buy button.
  [/\/wp-content\/|\/wp-includes\/|<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i, { method: "wordpress", name: "WordPress" }],
  [/cdn\.shopify\.com|shopify\.theme|shopify-section/i, { method: "shopify", name: "Shopify" }],
  [/data-wf-site=|data-wf-page=|website-files\.com|webflow\.com\/css|<meta[^>]+content=["']Webflow["']/i, { method: "webflow", name: "Webflow" }],
  [/<meta[^>]+name=["']generator["'][^>]+content=["']Ghost|ghost-portal|\/ghost\/api\//i, { method: "ghost", name: "Ghost" }],
  [/static\.wixstatic\.com|parastorage\.com|<meta[^>]+content=["']Wix\.com/i, { method: "manual", name: "Wix" }],
  [/static1\.squarespace\.com|squarespace-cdn\.com|<!-- This is Squarespace\. -->/i, { method: "manual", name: "Squarespace" }],
  [/framerusercontent\.com|<meta[^>]+name=["']generator["'][^>]+content=["']Framer/i, { method: "manual", name: "Framer" }],
  // HubSpot's tracking script is on many sites that don't run on its CMS: only the CMS's own signs count.
  [/hs-sites\.com|<meta[^>]+name=["']generator["'][^>]+content=["']HubSpot/i, { method: "manual", name: "HubSpot" }],
  [/__NEXT_DATA__|\/_next\/static\//, { method: "github", name: "Next.js" }],
  [/<meta[^>]+name=["']generator["'][^>]+content=["'](Astro|Hugo|Gatsby|Jekyll|Eleventy|Docusaurus|Hexo)/i, { method: "github", name: "a static site generator" }],
];
export function detectSitePlatform(html: string): SitePlatform | null {
  for (const [sign, platform] of PLATFORM_SIGNS) if (sign.test(html)) return platform;
  return null;
}
