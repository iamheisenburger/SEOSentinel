import type { Doc } from "../_generated/dataModel";
import { publicationAdapterConfigHash, publicationDeliveryConfig, sha256Hex } from "./publicationArtifact.ts";
import { siteCanonicalDomain, siteCanonicalDomainRevision } from "./siteDomainBinding.ts";
import { containsExecutableMdx } from "./articleQuality.ts";
import { publishedArticlePublicUrl } from "./publicationLive.ts";

export const CONTENT_PAGE_REVIEW_MS = 7 * 86_400_000;
export const CONTENT_PAGE_COOLDOWN_MS = 14 * 86_400_000;
function assertSafePublishableMarkdown(markdown: string) {
  if (containsExecutableMdx(markdown)) throw new Error("Executable/custom MDX is unsupported");
}
export function contentConnectionHash(site: Doc<"sites">): string {
  return sha256Hex(JSON.stringify([publicationDeliveryConfig(site), publicationAdapterConfigHash(site),
    site.githubToken ? sha256Hex(site.githubToken) : undefined, site.publisherConnectionGeneration ?? 0]));
}
export function confirmedContentProfileHash(site: Doc<"sites">): string {
  return sha256Hex(JSON.stringify([siteCanonicalDomain(site), siteCanonicalDomainRevision(site), site.siteSummary,
    site.targetAudienceSummary, site.anchorKeywords, site.keyFeatures, site.painPoints, site.productUsage,
    site.pricingInfo, site.founders]));
}
export function contentConnectionComplete(site: Doc<"sites">) {
  return site.publishMethod === "github" ? Boolean(site.repoOwner && site.repoName && site.repoDefaultBranch && site.githubToken)
    : site.publishMethod === "wordpress" && Boolean(site.wpUrl && site.wpUsername && site.wpAppPassword);
}
export function selectedUrl(site: Pick<Doc<"sites">, "domain" | "urlStructure">, slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Unsupported selected page slug");
  return publishedArticlePublicUrl({ domain: site.domain, urlStructure: site.urlStructure, slug });
}
export function selectedUrlMatches(site: Doc<"sites">, slug: string, url: string) {
  if (site.publishMethod === "github") return selectedUrl(site, slug) === url;
  try {
    const parsed = new URL(url), origin = new URL(selectedUrl(site, slug)).origin;
    return parsed.origin === origin && !parsed.search && !parsed.hash && !parsed.username && !parsed.password && parsed.pathname !== "/";
  } catch { return false; }
}
export function assertUnprotectedPage(slug: string, title: string, content: string) {
  if (/(?:^|[\s/_-])(pricing|checkout|cart|legal|privacy|terms|refund|billing)(?:$|[\s/_-])/i.test(slug + " " + title) ||
    /pentra[-_]protected\s*[:=]\s*(?:true|1)/i.test(content)) throw new Error("Protected page cannot be selected for autonomous editing");
}
export function selectedGitHubPath(site: Doc<"sites">, path: string) {
  const root = publicationDeliveryConfig(site).contentDir;
  if (!root || !/^content\/[A-Za-z0-9][A-Za-z0-9_/-]*$/.test(root) || root.includes("..") ||
    !path.startsWith(root + "/") || path.includes("..") || !/\.(md|mdx)$/.test(path)) throw new Error("Unsupported selected Markdown path");
  const relative = path.slice(root.length + 1);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.(md|mdx)$/.test(relative)) throw new Error("Unsupported nested page layout");
  return relative.replace(/\.(md|mdx)$/, "");
}
export function parseSelectedMarkdown(raw: string, expectedUrl: string) {
  if (new TextEncoder().encode(raw).length > 350_000) throw new Error("Selected page exceeds supported size");
  const match = /^(---\r?\n([\s\S]*?)\r?\n---\r?\n)([\s\S]*)$/.exec(raw);
  if (!match) throw new Error("Selected Markdown requires supported frontmatter");
  const fields: Record<string, string> = {};
  const allowed = new Set(["title","metaTitle","description","date","canonicalUrl","generator","pentraDeliveryKey","status",
    "qualityGateVersion","auditedContentHash","featuredImage","readingTime","wordCount","factCheckScore","contentScore",
    "editorialQualityScore","mediaQualityStatus","language","sources","internalLinks"]);
  for (const line of match[2].split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s/.test(line)) {
      if (!/^\s+(?:-\s+)?(?:url|title|href|anchor):\s+"(?:[^"\\]|\\.)*"$/.test(line)) throw new Error("Unsupported frontmatter layout");
      continue;
    }
    const entry = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!entry || !allowed.has(entry[1]) || entry[1] in fields) throw new Error("Unsupported or duplicate frontmatter field");
    const value = entry[2];
    if (/^[!&*{\[>|]/.test(value)) throw new Error("Executable or custom frontmatter is unsupported");
    fields[entry[1]] = value.startsWith('"') ? JSON.parse(value) : value.replace(/^'(.*)'$/, "$1");
  }
  if (!fields.title || (fields.canonicalUrl && fields.canonicalUrl !== expectedUrl) || (fields.status && fields.status !== "published")) {
    throw new Error("Selected page title, canonical or publication status is unsupported");
  }
  const markdown = match[3].trim();
  assertSafePublishableMarkdown(markdown);
  // Reject MDX execution/custom components before consent is accepted.
  if (/[{}]|^\s*(?:import|export)\s/m.test(markdown) || /<\/?[A-Za-z]/.test(markdown)) throw new Error("Executable/custom MDX is unsupported");
  return { header: match[1], markdown, title: fields.title, metaTitle: fields.metaTitle ?? fields.title,
    description: fields.description ?? "", content: raw };
}
/** Small explicit classic subset. No silent HTML/layout conversion. The raw
 * source remains the conditional-write base and its text is kept verbatim. */
export function classicHtmlMarkdown(html: string) {
  if (html.length > 350_000 || /<!--|\[[a-zA-Z_][^\]]*\]|<\?|[{}]/.test(html)) throw new Error("Unsupported WordPress blocks or shortcodes");
  let markdown = html.replace(/<h([234])>([^<>]*)<\/h\1>/g, (_, n, text) => "\n\n" + "#".repeat(Number(n)) + " " + text + "\n\n")
    .replace(/<(strong|em)>([^<>]*)<\/\1>/g, (_, tag, text) => (tag === "strong" ? "**" : "*") + text + (tag === "strong" ? "**" : "*"))
    .replace(/<p>([\s\S]*?)<\/p>/g, "$1\n\n").replace(/<br\s*\/?>(?:\n)?/g, "  \n");
  if (/<\/?[A-Za-z]|&(?!(?:amp|lt|gt|quot|#[0-9]+|#x[0-9a-f]+);)/i.test(markdown)) throw new Error("Unsupported WordPress classic layout");
  markdown = markdown.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
  assertSafePublishableMarkdown(markdown);
  return markdown;
}
export function assertSafeImprovement(base: { title: string; markdown: string }, next: { title: string; markdown: string }) {
  const original = base.markdown.trim();
  if (next.title !== base.title || !next.markdown.trim().startsWith(original)) throw new Error("Selected source text and confirmed facts must remain unchanged");
  if (!/^\s*\n\s*\n/.test(next.markdown.trim().slice(original.length))) throw new Error("An improvement must start after the original paragraph boundary");
  const added = next.markdown.trim().slice(original.length).trim();
  if (added.split(/\s+/).length < 40 || original.includes(added)) throw new Error("Monitoring/no-op is not a completed improvement");
  assertSafePublishableMarkdown(next.markdown);
  if (/[{}]|^\s*(?:import|export)\s/m.test(next.markdown) || /<\/?[A-Za-z]/.test(next.markdown)) throw new Error("Unsupported improvement rendering");
  return added;
}
