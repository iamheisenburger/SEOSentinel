/** Onboarding prefill: read a business's own homepage and suggest the setup
 * facts, so a new customer starts from their URL instead of a blank form.
 * Pure and deterministic (no model call, no cost). The owner still reviews
 * and confirms every fact before Pentra writes from it. */

export type BusinessPrefill = { name: string; summary: string; product: string; audience: string; questions: string[] };

const decode = (value: string) => value
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
  .replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/\s+/g, " ").trim();

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

export function extractBusinessPrefill(html: string): BusinessPrefill {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const parts = title.split(/\s+[|–—:·-]\s+/).map(s => s.trim()).filter(Boolean);
  const name = clip(meta(html, "og:site_name") || meta(html, "application-name") ||
    (parts.length > 1 ? [...parts].sort((a, b) => a.length - b.length)[0] : parts[0] ?? ""), 80);
  const paragraphs = tagTexts(html, "p").filter(p => p.length >= 60);
  const summary = clip(meta(html, "description") || meta(html, "og:description") || paragraphs[0] || "", 400);
  const h1 = tagTexts(html, "h1")[0] ?? "";
  const h2s = tagTexts(html, "h2").filter(h => h.length >= 3 && h.length <= 80 && !h.endsWith("?")).slice(0, 4);
  const product = clip([h1 && h1 !== summary ? h1.replace(/[.!]$/, "") + "." : "", h2s.length ? `Includes: ${h2s.join("; ")}.` : ""]
    .filter(Boolean).join(" ") || (paragraphs[1] ?? ""), 400);
  const forMatch = /\bfor ((?:small |local |growing )?[a-z][a-z &,'-]{3,60}?)(?=[.!,;:]|\s+(?:who|that|to|in|with)\b|$)/i
    .exec([h1, summary, title].join(". "));
  const audience = forMatch ? clip(forMatch[1].replace(/^./, c => c.toUpperCase()), 120) : "";
  const seen = new Set<string>();
  const questions = ["h2", "h3", "h4", "summary", "dt", "button"].flatMap(tag => tagTexts(html, tag))
    .filter(q => q.endsWith("?") && q.length >= 12 && q.length <= 160)
    .filter(q => { const key = q.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 8);
  return { name, summary, product, audience, questions };
}
