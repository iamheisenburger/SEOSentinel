export type PublicationQualityMode = "standard" | "strict";

export type PublicationSource = {
  url: string;
  title?: string;
};

export type PublicationArticle = {
  title: string;
  markdown: string;
  metaDescription?: string;
  featuredImage?: string;
  wordCount?: number;
  factCheckScore?: number;
  sources?: PublicationSource[];
};

export type PublicationQualityResult = {
  passed: boolean;
  issues: string[];
  warnings: string[];
  metrics: {
    wordCount: number;
    sourceCount: number;
    sourceHostCount: number;
    quantifiedClaimCount: number;
  };
};

const HYPE_PATTERN =
  /\b(?:guaranteed|proven(?:\s+results?)?|skyrocket|game[- ]changing|transformational|staggering|revolutionary)\b/i;
const QUANTIFIED_OUTCOME_PATTERN =
  /(?:\b(?:increase|improve|boost|grow|lift|raise|reduce|decrease|cut|save|recover|free up)\w*\b[^\n.!?]{0,70}\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:%|x\b|hours?\b|minutes?\b|days?\b|\$))|(?:\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:%|x\b|hours?\s*(?:\/|per)\s*week)\b)/i;
const INLINE_CITATION_PATTERN = /\[\d+(?:\s*,\s*\d+)*\]/;
const EXTERNAL_LINK_PATTERN = /\[[^\]]+\]\(https:\/\/[^)]+\)|https:\/\/\S+/;

function countWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_`\[\]()|-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function safeHttpsUrl(value: string): URL | null {
  if (/https?:\/\/https?:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function normalizeSiteOrigin(domain: string): string {
  const trimmed = domain.trim().replace(/\/+$/, "");
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported site protocol: ${parsed.protocol}`);
  }
  return parsed.origin;
}

function quantifiedParagraphs(markdown: string): string[] {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(
      (paragraph) =>
        paragraph.length > 0 &&
        !paragraph.startsWith("#") &&
        QUANTIFIED_OUTCOME_PATTERN.test(paragraph),
    );
}

export function evaluatePublicationQuality(
  article: PublicationArticle,
  mode: PublicationQualityMode = "standard",
): PublicationQualityResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const markdown = article.markdown.trim();
  const measuredWordCount = countWords(markdown);
  const sources = article.sources ?? [];
  const validSources: URL[] = [];
  const sourceUrls = new Set<string>();

  if (!article.title.trim()) issues.push("Article title is missing.");
  if (!markdown) issues.push("Article body is missing.");
  if (measuredWordCount < (mode === "strict" ? 900 : 500)) {
    issues.push(
      `Article is too thin (${measuredWordCount} words; minimum ${mode === "strict" ? 900 : 500}).`,
    );
  }
  if (article.wordCount && Math.abs(article.wordCount - measuredWordCount) > 150) {
    warnings.push(
      `Stored word count (${article.wordCount}) differs from measured content (${measuredWordCount}).`,
    );
  }

  if (!article.metaDescription?.trim()) {
    issues.push("Meta description is missing.");
  } else if (article.metaDescription.length > 160) {
    issues.push(`Meta description is ${article.metaDescription.length} characters; maximum is 160.`);
  }

  if (/<script\b/i.test(markdown)) {
    issues.push("Article contains a script tag; structured data belongs in the renderer.");
  }
  if (/javascript\s*:/i.test(markdown)) {
    issues.push("Article contains a javascript URL.");
  }
  if (/https?:\/\/https?:\/\//i.test(markdown)) {
    issues.push("Article contains a malformed duplicated URL scheme.");
  }

  for (const source of sources) {
    const parsed = safeHttpsUrl(source.url);
    if (!parsed) {
      issues.push(`Invalid or unsafe source URL: ${source.url}`);
      continue;
    }
    if (sourceUrls.has(parsed.href)) {
      warnings.push(`Duplicate source URL: ${parsed.href}`);
      continue;
    }
    sourceUrls.add(parsed.href);
    validSources.push(parsed);
  }

  const sourceHosts = new Set(validSources.map((source) => source.hostname));
  const paragraphsWithClaims = quantifiedParagraphs(markdown);
  const uncitedClaims = paragraphsWithClaims.filter(
    (paragraph) =>
      !INLINE_CITATION_PATTERN.test(paragraph) &&
      !EXTERNAL_LINK_PATTERN.test(paragraph),
  );
  if (uncitedClaims.length > 0) {
    const message = `${uncitedClaims.length} quantified outcome claim(s) lack an inline citation.`;
    if (mode === "strict") issues.push(message);
    else warnings.push(message);
  }

  const citationNumbers = [...markdown.matchAll(/\[(\d+)\]/g)].map((match) =>
    Number(match[1]),
  );
  const highestCitation = citationNumbers.length
    ? Math.max(...citationNumbers)
    : 0;
  if (highestCitation > validSources.length) {
    issues.push(
      `Inline citation [${highestCitation}] has no matching source entry (${validSources.length} source(s)).`,
    );
  }

  const youtubeEmbeds = [...markdown.matchAll(/youtube\.com\/embed\/([^"?\s<]+)/gi)];
  for (const embed of youtubeEmbeds) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(embed[1])) {
      issues.push(`Invalid YouTube embed identifier: ${embed[1]}`);
    }
  }
  const unsupportedIframes = [
    ...markdown.matchAll(/<iframe\b[^>]*src=["']([^"']+)["'][^>]*>/gi),
  ].filter(
    (match) =>
      !/^https:\/\/(?:www\.)?youtube\.com\/embed\/[A-Za-z0-9_-]{11}(?:[?"']|$)/i.test(
        match[1],
      ),
  );
  if (unsupportedIframes.length > 0) {
    issues.push("Article contains an unsupported iframe source.");
  }

  if (mode === "strict") {
    if (!article.featuredImage || !safeHttpsUrl(article.featuredImage)) {
      issues.push("Strict publication requires a valid HTTPS featured image.");
    }
    if (article.factCheckScore === undefined) {
      issues.push("Strict publication requires a completed fact check.");
    } else if (article.factCheckScore < 80) {
      issues.push(`Fact-check score is ${article.factCheckScore}; strict minimum is 80.`);
    }
    if (paragraphsWithClaims.length > 0 && validSources.length < 2) {
      issues.push("Quantified outcome claims require at least two valid sources.");
    }
    if (
      QUANTIFIED_OUTCOME_PATTERN.test(article.title) ||
      QUANTIFIED_OUTCOME_PATTERN.test(article.metaDescription ?? "")
    ) {
      issues.push("Title or meta description makes a quantified outcome claim without room for evidence.");
    }
    if (HYPE_PATTERN.test(article.title) || HYPE_PATTERN.test(article.metaDescription ?? "")) {
      issues.push("Title or meta description uses unsupported promotional language.");
    }
    if (validSources.length > 0 && sourceHosts.size < 2) {
      warnings.push("All external evidence comes from one source domain.");
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    warnings,
    metrics: {
      wordCount: measuredWordCount,
      sourceCount: validSources.length,
      sourceHostCount: sourceHosts.size,
      quantifiedClaimCount: paragraphsWithClaims.length,
    },
  };
}
