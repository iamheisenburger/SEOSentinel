import type { Doc } from "../_generated/dataModel";
import { publicationAdapterConfigHash, publicationDeliveryConfig, sha256Hex } from "./publicationArtifact.ts";
import { siteCanonicalDomain, siteCanonicalDomainRevision } from "./siteDomainBinding.ts";
import { containsExecutableMdx, evidenceRequiredParagraphs, STRICT_PUBLICATION_MIN_WORDS, articleWordCeiling } from "./articleQuality.ts";
import { publishedArticlePublicUrl } from "./publicationLive.ts";

export const CONTENT_PAGE_REVIEW_MS = 7 * 86_400_000;
export function contentConsentToken(site: Doc<"sites">) {
  let connection: string;
  try { connection = contentConnectionHash(site); }
  catch {
    // An incomplete connection must still have a stable, credential-free review
    // identity. This token does not turn an incomplete destination into authority.
    connection = sha256Hex(JSON.stringify(["incomplete", site.publishMethod, site.domain, site.urlStructure,
      site.repoOwner, site.repoName, site.repoDefaultBranch, site.wpUrl, site.publisherConnectionGeneration]));
  }
  return sha256Hex(JSON.stringify([confirmedContentProfileHash(site), connection]));
}
export const CONTENT_PAGE_COOLDOWN_MS = 14 * 86_400_000;
export type SelectedEditTarget = { before: string; sourceBefore: string; maxWords: number };
export const contentWords = (value: string) => value.trim().split(/\s+/).filter(Boolean).length;
export function preserveWordPressReviewedText(html: string): string {
  return html.split(/(<[^>]*>)/g).map((part, index) => index % 2 ? part : part.split(/(&(?:#[0-9]+|#x[0-9a-f]+|[a-z]+);)/gi)
    .map((text, entity) => entity % 2 ? text.replace(/&#([0-9]+);/g, (_, n) => `&#${String(Number(n)).padStart(3, "0")};`)
      : Array.from(text).map(c => /\s/.test(c) ? c : `&#${String(c.codePointAt(0)).padStart(3, "0")};`).join("")).join("")).join("");
}
const plainParagraphHtml = (text: string) => `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
function explicitGuidance(text: string): boolean {
  // Absence of a detected claim is not proof that arbitrary source prose is
  // nonfactual. Only explicit reader instructions enter this narrow editor.
  const verbs = "write|describe|ask|keep|choose|explain|prefer|consider|draft|record|preserve|name|include|collect|discuss|decide|list|review|treat|invite|use|do not|compare|look|close|identify|separate|propose|let|retain|flag|document|prepare|check|note|avoid|summarize|distinguish|remove|request|seek|save|add|test|examine|walk|give|agree|pause";
  const direct = new RegExp(`^(?:${verbs})\\b`, "i");
  const conditional = new RegExp(`^(?:if|before|where|when|for)\\b[^.!?]*,\\s*(?:${verbs})\\b`, "i");
  return text.split(/(?<=[.!?])\s+/).every(sentence => direct.test(sentence) || conditional.test(sentence));
}
export function exactReplacement(text: string, before: string, after: string): string {
  const at = text.indexOf(before);
  if (!before || at < 0 || text.indexOf(before, at + before.length) >= 0 || before === after) throw new Error("Targeted edit requires one exact changed source span");
  return text.slice(0, at) + after + text.slice(at + before.length);
}
export function targetedImprovement(base: { kind: string; markdown: string; sourceContent: string }, site: Doc<"sites">, question: string): SelectedEditTarget | undefined {
  if (contentWords(base.markdown) < STRICT_PUBLICATION_MIN_WORDS) return;
  const evidence = JSON.stringify([site.siteSummary, site.productUsage, site.keyFeatures, site.pricingInfo, site.founders]);
  const facts = [site.siteSummary, site.productUsage, ...(site.keyFeatures ?? [])].filter((s): s is string => Boolean(s))
    .map(s => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase());
  const terms = question.toLowerCase().split(/\W+/).filter(t => t.length > 3);
  const paragraphs = base.markdown.split(/\n\s*\n/).map(p => p.trim()).filter(p => contentWords(p) >= 40 && contentWords(p) <= 250 &&
    !/[\n\d\[\]`#*<>|]|https?:/i.test(p) && explicitGuidance(p) && !evidenceRequiredParagraphs(p, evidence).length &&
    !facts.some(f => f.length >= 12 && p.normalize("NFC").replace(/\s+/g, " ").toLowerCase().includes(f)));
  paragraphs.sort((a,b) => terms.filter(t => b.toLowerCase().includes(t)).length - terms.filter(t => a.toLowerCase().includes(t)).length);
  for (const before of paragraphs) {
    const sources = base.kind === "github" ? [before] : [plainParagraphHtml(before), preserveWordPressReviewedText(plainParagraphHtml(before))];
    const sourceBefore = sources.find(s => base.sourceContent.includes(s) && base.sourceContent.indexOf(s) === base.sourceContent.lastIndexOf(s));
    if (!sourceBefore) continue;
    const maxWords = Math.min(contentWords(before) + 60, articleWordCeiling() - contentWords(base.markdown) + contentWords(before));
    if (maxWords >= 40) return { before, sourceBefore, maxWords };
  }
}
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
    .replace(/<a (?:rel="nofollow noopener noreferrer" )?href="([^"<>]+)">([^<>\[\]]*)<\/a>/g, (_, href, text) => {
      if (!/^(?:https:\/\/|\/(?!\/))/.test(href) || /[\s()]/.test(href)) throw new Error("Unsupported WordPress link destination");
      return `[${text}](${href})`;
    })
    .replace(/<(strong|em)>([^<>]*)<\/\1>/g, (_, tag, text) => (tag === "strong" ? "**" : "*") + text + (tag === "strong" ? "**" : "*"))
    .replace(/<p>([\s\S]*?)<\/p>/g, "$1\n\n").replace(/<br\s*\/?>(?:\n)?/g, "  \n");
  if (/<\/?[A-Za-z]|&(?!(?:amp|lt|gt|quot|#[0-9]+|#x[0-9a-f]+);)/i.test(markdown)) throw new Error("Unsupported WordPress classic layout");
  markdown = markdown.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
  assertSafePublishableMarkdown(markdown);
  return markdown;
}
export function assertSafeImprovement(base: { title: string; markdown: string }, next: { title: string; markdown: string }, target?: SelectedEditTarget) {
  if (target) {
    if (next.title !== base.title) throw new Error("A targeted improvement cannot change the page title");
    // Markdown transport may add one terminal newline; destination writes use
    // the retained raw source and replace only the exact approved paragraph.
    const original = base.markdown.trimEnd(), proposed = next.markdown.trimEnd();
    const at = original.indexOf(target.before), prefix = original.slice(0, at), suffix = original.slice(at + target.before.length);
    if (at < 0 || !proposed.startsWith(prefix) || !proposed.endsWith(suffix)) throw new Error("Targeted improvement changed unrelated prose");
    const after = proposed.slice(prefix.length, suffix ? -suffix.length : undefined);
    if (exactReplacement(original, target.before, after) !== proposed || contentWords(after) < 40 || contentWords(after) > target.maxWords ||
      /[\n\d\[\]`#*<>|]|https?:/i.test(after) || !explicitGuidance(after) || evidenceRequiredParagraphs(after, "").length) throw new Error("Targeted guidance introduced unsupported claims, formatting or excess length");
    const words = new Set(target.before.toLowerCase().match(/[a-z]{4,}/g));
    const newWords = new Set((after.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(w => !words.has(w)));
    if (newWords.size < 6) throw new Error("Monitoring or cosmetic/no-op edits are not a meaningful improvement");
    assertSafePublishableMarkdown(next.markdown);
    return after;
  }
  const original = base.markdown.trim();
  if (next.title !== base.title || !next.markdown.trim().startsWith(original)) throw new Error("Selected source text and confirmed facts must remain unchanged");
  if (!/^\s*\n\s*\n/.test(next.markdown.trim().slice(original.length))) throw new Error("An improvement must start after the original paragraph boundary");
  const added = next.markdown.trim().slice(original.length).trim();
  if (added.split(/\s+/).length < 40 || original.includes(added)) throw new Error("Monitoring/no-op is not a completed improvement");
  assertSafePublishableMarkdown(next.markdown);
  if (/[{}]|^\s*(?:import|export)\s/m.test(next.markdown) || /<\/?[A-Za-z]/.test(next.markdown)) throw new Error("Unsupported improvement rendering");
  return added;
}
