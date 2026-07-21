import { classifyEvidenceSource } from "./sourceQuality.ts";
import { sha256Hex } from "./publicationArtifact.ts";

export type PublicationQualityMode = "standard" | "strict";

export type PublicationSource = {
  url: string;
  title?: string;
  excerpt?: string;
  contentHash?: string;
  capturedAt?: number;
};

export type PublicationArticle = {
  title: string;
  markdown: string;
  articleType?: string;
  metaTitle?: string;
  metaDescription?: string;
  featuredImage?: string;
  reviewedMediaUrls?: string[];
  wordCount?: number;
  factCheckScore?: number;
  editorialQualityScore?: number;
  editorialQualityNotes?: string[];
  mediaQualityStatus?: string;
  mediaQualityNotes?: string[];
  productEvidenceStatus?: string;
  claimEvidenceStatus?: string;
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
    strictEvidenceSourceCount: number;
    quantifiedClaimCount: number;
    youtubeEmbedCount: number;
    malformedTableCount: number;
  };
};

export type ClaimEvidenceEntry = {
  claim: string;
  citationNumbers: number[];
  supported: boolean;
  reason: string;
};

const FACTUAL_CLAIM_PATTERN =
  /\b(?:according to|research|study|studies|survey|report|data|evidence|shows?|found|indicates?|average|majority)\b/i;

/**
 * Pentra publishes plain Markdown, never executable MDX.  Keep this deliberately
 * fail-closed: braces and JSX/HTML-like constructs are not required by the
 * supported Markdown contract, and accepting them would let a multiline MDX
 * expression survive a line-oriented regular expression.
 */
export function containsExecutableMdx(markdown: string): boolean {
  return (
    /[{}]/.test(markdown) ||
    /^\s*(?:import|export)\b/m.test(markdown) ||
    /<\/?[A-Za-z!][\s\S]*?>/.test(markdown) ||
    /<>|<\/>/.test(markdown)
  );
}

function evidenceTokens(value: string): Set<string> {
  const stop = new Set([
    "about", "after", "also", "because", "before", "being", "between",
    "could", "does", "from", "have", "into", "more", "most", "other",
    "should", "than", "that", "their", "there", "these", "they", "this",
    "through", "when", "where", "which", "with", "would", "your",
  ]);
  return new Set(
    value
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !stop.has(token)),
  );
}

function overlapRatio(left: string, right: string): number {
  const a = evidenceTokens(left);
  const b = evidenceTokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / Math.min(a.size, b.size);
}

function normalizedEvidenceNumbers(value: string): Set<string> {
  return new Set(
    [...value.matchAll(/(?:\$\s*)?\b\d[\d,]*(?:\.\d+)?(?:\s*%)?/g)].map(
      (match) => match[0].toLowerCase().replace(/[\s,]/g, ""),
    ),
  );
}

function namedEntities(value: string): string[] {
  return [
    ...value.matchAll(
      /\b[A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){1,3}\b/g,
    ),
  ].map((match) => match[0].toLowerCase());
}

function exactClaimDetailsPresent(claim: string, evidence: string): boolean {
  const evidenceNumbers = normalizedEvidenceNumbers(evidence);
  for (const number of normalizedEvidenceNumbers(claim)) {
    if (!evidenceNumbers.has(number)) return false;
  }
  const normalizedEvidence = evidence.toLowerCase();
  return namedEntities(claim).every((entity) => normalizedEvidence.includes(entity));
}

export function inlineCitationNumbers(value: string): number[] {
  const numbers: number[] = [];
  for (const match of value.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const raw of match[1].split(",")) {
      const citation = Number(raw.trim());
      if (Number.isInteger(citation) && citation > 0 && !numbers.includes(citation)) {
        numbers.push(citation);
      }
    }
  }
  return numbers;
}

/**
 * Deterministic coverage around the model-produced ledger.  The model may
 * identify claims, but it cannot certify its own empty answer or cite a source
 * that is absent from the preserved evidence snapshot.
 */
export function validateClaimEvidenceLedger(args: {
  markdown: string;
  sources: PublicationSource[];
  researchEvidence: string;
  productEvidence: string;
  productEvidenceHash?: string;
  claimEvidence: ClaimEvidenceEntry[];
}): { passed: boolean; issues: string[]; requiredClaimCount: number } {
  const issues: string[] = [];
  const paragraphs = args.markdown
    .replace(/```[\s\S]*?```/g, "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(
      (paragraph) =>
        paragraph.length >= 40 &&
        !paragraph.startsWith("#") &&
        !/^[-*]\s+https?:\/\//i.test(paragraph) &&
        (INLINE_CITATION_PATTERN.test(paragraph) ||
          EVIDENCE_REQUIRED_NUMBER_PATTERN.test(paragraph) ||
          FACTUAL_CLAIM_PATTERN.test(paragraph)),
    );

  if (args.claimEvidence.length === 0) {
    issues.push("Claim-to-evidence ledger is empty.");
  }

  for (const [index, entry] of args.claimEvidence.entries()) {
    if (entry.claim.trim().length < 12 || entry.reason.trim().length < 12) {
      issues.push(`Claim ledger entry ${index + 1} is not specific enough to audit.`);
    }
    if (!entry.supported) continue;
    if (entry.citationNumbers.length > 0) {
      for (const citation of entry.citationNumbers) {
        const source = args.sources[citation - 1];
        if (!source) {
          issues.push(`Claim ledger entry ${index + 1} cites missing source [${citation}].`);
          continue;
        }
        const sourceHost = safeHttpsUrl(source.url)?.hostname ?? "";
        if (!source.excerpt || source.excerpt.trim().length < 160) {
          issues.push(
            `Claim ledger entry ${index + 1} cites [${citation}] without a preserved source excerpt.`,
          );
          continue;
        }
        if (!source.contentHash || sha256Hex(source.excerpt) !== source.contentHash) {
          issues.push(
            `Claim ledger entry ${index + 1} cites [${citation}] whose preserved content hash is missing or invalid.`,
          );
          continue;
        }
        const evidenceOverlap = overlapRatio(entry.claim, source.excerpt);
        if (
          evidenceOverlap < 0.3 ||
          !exactClaimDetailsPresent(entry.claim, source.excerpt)
        ) {
          issues.push(
            `Claim ledger entry ${index + 1} does not deterministically match preserved excerpt [${citation}] (${sourceHost || source.url}).`,
          );
        }
      }
    } else {
      const productSnapshotValid =
        !!args.productEvidenceHash &&
        sha256Hex(args.productEvidence) === args.productEvidenceHash;
      if (
        !productSnapshotValid ||
        overlapRatio(entry.claim, args.productEvidence) < 0.3 ||
        !exactClaimDetailsPresent(entry.claim, args.productEvidence)
      ) {
        issues.push(
          `Supported claim ledger entry ${index + 1} has neither a matched source excerpt nor a valid matched first-party evidence snapshot.`,
        );
      }
    }
  }

  for (const [index, paragraph] of paragraphs.entries()) {
    const matchingEntries = args.claimEvidence.filter(
      (entry) => entry.supported && overlapRatio(paragraph, entry.claim) >= 0.3,
    );
    if (matchingEntries.length === 0) {
      issues.push(
        `Evidence-required paragraph ${index + 1} is absent from the claim ledger: ${paragraph.slice(0, 180)}`,
      );
      continue;
    }

    const paragraphCitations = inlineCitationNumbers(paragraph);
    for (const citation of paragraphCitations) {
      const source = args.sources[citation - 1];
      const snapshotIsValid =
        !!source?.excerpt &&
        source.excerpt.trim().length >= 160 &&
        !!source.contentHash &&
        sha256Hex(source.excerpt) === source.contentHash;
      if (!snapshotIsValid) {
        issues.push(
          `Evidence-required paragraph ${index + 1} cites [${citation}] without an exact preserved source snapshot.`,
        );
        continue;
      }
      if (!matchingEntries.some((entry) => entry.citationNumbers.includes(citation))) {
        issues.push(
          `Evidence-required paragraph ${index + 1} cites [${citation}] without a matching supported claim-ledger entry.`,
        );
      }
    }

    const matchedLedgerCitations = new Set(
      matchingEntries.flatMap((entry) => entry.citationNumbers),
    );
    if (
      matchedLedgerCitations.size > 0 &&
      paragraphCitations.length === 0
    ) {
      issues.push(
        `Evidence-required paragraph ${index + 1} omits the inline citation bound by its claim-ledger entry.`,
      );
    }
  }

  return {
    passed: issues.length === 0,
    issues,
    requiredClaimCount: paragraphs.length,
  };
}

const HYPE_PATTERN =
  /\b(?:guaranteed|proven(?:\s+results?)?|skyrocket|game[- ]changing|transformational|staggering|revolutionary)\b/i;
const QUANTIFIED_OUTCOME_PATTERN =
  /(?:\b(?:increase|improve|boost|grow|lift|raise|reduce|decrease|cut|save|recover|free up)\w*\b[^\n.!?]{0,70}\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:%|x\b|hours?\b|minutes?\b|days?\b|\$))|(?:\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:%|x\b|hours?\s*(?:\/|per)\s*week)\b)/i;
const EVIDENCE_REQUIRED_NUMBER_PATTERN =
  /(?:\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:[-–]|to)\s*\$?\d[\d,]*(?:\.\d+)?)?|\b\d[\d,]*(?:\.\d+)?(?:\s*(?:[-–]|to)\s*\d[\d,]*(?:\.\d+)?)?\s*\+?\s*(?:%|x|[-‑–— ]?(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|questions?|conversations?|orders?|customers?|users?|visitors?|leads?|calls?|employees?|responses?|messages?|sessions?|articles?|posts?|points?|scores?))|\b\d+(?:\s*\/\s*\d+)+\s*(?:points?|scores?)\b|\b(?:above|below|under|over|at\s+least|at\s+most|more\s+than|fewer\s+than)\s+\d+(?:\.\d+)?\b)(?![\w])/i;
const INLINE_CITATION_PATTERN = /\[\d+(?:\s*,\s*\d+)*\]/;
const EXTERNAL_LINK_PATTERN = /\[[^\]]+\]\(https:\/\/[^)]+\)|https:\/\/\S+/;
const DANGLING_META_END_PATTERN =
  /\b(?:a|an|and|at|by|for|from|in|of|on|or|the|to|with|which|that)$/i;
const INCOMPLETE_META_PHRASE_END_PATTERN =
  /\b(?:with|for|to|of)\s+(?:full|complete|detailed|relevant|useful|better|clear|strong)$/i;

export function articleWordCeiling(articleType?: string): number {
  switch (articleType) {
    case "checklist":
      return 2400;
    case "standard":
    case undefined:
      return 2600;
    case "how-to":
      return 2800;
    case "comparison":
      return 3000;
    case "listicle":
    case "roundup":
      return 3200;
    case "ultimate-guide":
      return 3600;
    default:
      return 2800;
  }
}

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

export function clampMetaDescription(
  value: string | undefined,
  maxLength = 155,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  const candidate = normalized.length <= maxLength
    ? normalized
    : normalized.slice(0, maxLength + 1);
  const lastSpace = candidate.lastIndexOf(" ");
  const cutAt = normalized.length <= maxLength
    ? normalized.length
    : lastSpace >= Math.floor(maxLength * 0.7)
      ? lastSpace
      : maxLength;
  let complete = normalized
    .slice(0, cutAt)
    .replace(/[\s,;:.!?–—-]+$/g, "");
  while (INCOMPLETE_META_PHRASE_END_PATTERN.test(complete)) {
    complete = complete
      .replace(/\s+\S+\s+\S+$/, "")
      .replace(/[\s,;:.!?–—-]+$/g, "");
  }
  while (DANGLING_META_END_PATTERN.test(complete)) {
    complete = complete.replace(/\s+\S+$/, "").replace(/[\s,;:.!?–—-]+$/g, "");
  }
  if (!complete) return undefined;

  // Reserve room for terminal punctuation. Appending a period and then slicing
  // could remove that same period when the prose landed exactly on maxLength,
  // producing metadata that the strict publication gate could never accept.
  if (complete.length >= maxLength) {
    const punctuationBudget = Math.max(1, maxLength - 1);
    const bounded = complete.slice(0, punctuationBudget + 1);
    const boundedSpace = bounded.lastIndexOf(" ");
    complete = complete
      .slice(
        0,
        boundedSpace >= Math.floor(punctuationBudget * 0.7)
          ? boundedSpace
          : punctuationBudget,
      )
      .replace(/[\s,;:.!?–—-]+$/g, "");
  }
  return `${complete}.`;
}

export function clampMetaTitle(value: string | undefined, maxLength = 60): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  const candidate = normalized.slice(0, maxLength + 1);
  const lastSpace = candidate.lastIndexOf(" ");
  const cutAt = lastSpace >= Math.floor(maxLength * 0.7) ? lastSpace : maxLength;
  return normalized.slice(0, cutAt).replace(/[\s,;:.!?–—-]+$/g, "");
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
        (QUANTIFIED_OUTCOME_PATTERN.test(paragraph) ||
          EVIDENCE_REQUIRED_NUMBER_PATTERN.test(paragraph)),
    );
}

export function uncitedEvidenceRequiredParagraphs(markdown: string): string[] {
  return quantifiedParagraphs(markdown).filter(
    (paragraph) =>
      !INLINE_CITATION_PATTERN.test(paragraph) &&
      !EXTERNAL_LINK_PATTERN.test(paragraph),
  );
}

function quantifiedOutcomeParagraphs(markdown: string): string[] {
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

function markdownTableProblems(markdown: string): string[] {
  const lines = markdown.replace(/```[\s\S]*?```/g, "").split("\n");
  const problems: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (!/^\s*\|/.test(lines[index])) continue;
    const start = index;
    const block: string[] = [];
    while (index < lines.length && /^\s*\|/.test(lines[index])) {
      block.push(lines[index].trim());
      index++;
    }
    index--;

    if (block.length < 2) {
      problems.push(`Table near line ${start + 1} has no header separator row.`);
      continue;
    }
    const cells = (line: string) =>
      line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    const headerCells = cells(block[0]);
    const separatorCells = cells(block[1]);
    const separatorValid =
      separatorCells.length === headerCells.length &&
      separatorCells.every((cell) => /^:?-{3,}:?$/.test(cell));
    if (!separatorValid) {
      problems.push(`Table near line ${start + 1} has an invalid separator row.`);
      continue;
    }
    if (block.some((line) => cells(line).length !== headerCells.length)) {
      problems.push(`Table near line ${start + 1} has inconsistent column counts.`);
    }
  }

  return problems;
}

export function evaluatePublicationQuality(
  article: PublicationArticle,
  mode: PublicationQualityMode = "standard",
): PublicationQualityResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const markdown = article.markdown.trim();
  const measuredWordCount = countWords(markdown);
  const tableProblems = markdownTableProblems(markdown);
  const sources = article.sources ?? [];
  const validSources: URL[] = [];
  let strictEvidenceSourceCount = 0;
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
  if (tableProblems.length > 0) {
    issues.push(...tableProblems);
  }

  if (!article.metaDescription?.trim()) {
    issues.push("Meta description is missing.");
  } else if (article.metaDescription.length > 160) {
    issues.push(`Meta description is ${article.metaDescription.length} characters; maximum is 160.`);
  }

  if (mode === "strict") {
    if (!article.metaTitle?.trim()) {
      issues.push("Meta title is missing.");
    } else if (article.metaTitle.length > 65) {
      issues.push(`Meta title is ${article.metaTitle.length} characters; maximum is 65.`);
    }
    if ((article.metaDescription?.trim().length ?? 0) < 100) {
      issues.push("Meta description is too short for a useful search snippet (minimum 100 characters).");
    } else if (!/[.!?]$/.test(article.metaDescription!.trim())) {
      issues.push("Meta description must end as a complete sentence.");
    } else if (
      DANGLING_META_END_PATTERN.test(
        article.metaDescription!.trim().replace(/[.!?]+$/, "").trim(),
      ) ||
      INCOMPLETE_META_PHRASE_END_PATTERN.test(
        article.metaDescription!.trim().replace(/[.!?]+$/, "").trim(),
      )
    ) {
      issues.push("Meta description ends with a dangling or incomplete phrase.");
    }
    const titleYears = new Set(article.title.match(/\b20\d{2}\b/g) ?? []);
    const metaYears = article.metaTitle?.match(/\b20\d{2}\b/g) ?? [];
    const unsupportedMetaYear = metaYears.find((year) => !titleYears.has(year));
    if (unsupportedMetaYear) {
      issues.push(`Meta title introduces unsupported year ${unsupportedMetaYear}.`);
    }
  }

  if (/<script\b/i.test(markdown)) {
    issues.push("Article contains a script tag; structured data belongs in the renderer.");
  }
  if (containsExecutableMdx(markdown)) {
    issues.push("Raw HTML and executable MDX are disabled in publication content.");
  }
  const markdownImages = [
    ...markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+[^)]*)?\)/g),
  ];
  const reviewedMedia = new Set(article.reviewedMediaUrls ?? []);
  if (markdownImages.length > 2) {
    issues.push(`Article contains ${markdownImages.length} inline images; maximum is two reviewed assets.`);
  }
  for (const image of markdownImages) {
    if (!image[1].trim()) issues.push("Every inline image requires meaningful alt text.");
    if (!safeHttpsUrl(image[2]) || !reviewedMedia.has(image[2])) {
      issues.push("Every inline image must match a persisted, reviewed HTTPS asset.");
    }
  }
  if (article.featuredImage && !reviewedMedia.has(article.featuredImage)) {
    issues.push("Featured image is absent from the persisted reviewed-media allowlist.");
  }
  if (/javascript\s*:/i.test(markdown)) {
    issues.push("Article contains a javascript URL.");
  }
  if (/https?:\/\/https?:\/\//i.test(markdown)) {
    issues.push("Article contains a malformed duplicated URL scheme.");
  }
  if (/https?:\/\/\[[^\]]+\]\([^)]+\)/i.test(markdown)) {
    issues.push("Article contains markdown inserted inside an external URL.");
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
    if (classifyEvidenceSource(parsed.href).strictEligible) {
      strictEvidenceSourceCount++;
    }
  }

  const sourceHosts = new Set(validSources.map((source) => source.hostname));
  const paragraphsWithClaims = quantifiedParagraphs(markdown);
  const paragraphsWithOutcomes = quantifiedOutcomeParagraphs(markdown);
  const uncitedClaims = uncitedEvidenceRequiredParagraphs(markdown);
  if (uncitedClaims.length > 0) {
    const message = `${uncitedClaims.length} quantified outcome or operational claim(s) lack an inline citation.`;
    if (mode === "strict") issues.push(message);
    else warnings.push(message);
  }

  const citationNumbers = inlineCitationNumbers(markdown);
  const highestCitation = citationNumbers.length
    ? Math.max(...citationNumbers)
    : 0;
  if (highestCitation > validSources.length) {
    issues.push(
      `Inline citation [${highestCitation}] has no matching source entry (${validSources.length} source(s)).`,
    );
  }

  const youtubeEmbeds = [
    ...markdown.matchAll(/youtube(?:-nocookie)?\.com\/embed\/([^"?\s<]+)/gi),
  ];
  for (const embed of youtubeEmbeds) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(embed[1])) {
      issues.push(`Invalid YouTube embed identifier: ${embed[1]}`);
    }
  }
  const unsupportedIframes = [
    ...markdown.matchAll(/<iframe\b[^>]*src=["']([^"']+)["'][^>]*>/gi),
  ].filter(
    (match) =>
      !/^https:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/[A-Za-z0-9_-]{11}(?:[?"']|$)/i.test(
        match[1],
      ),
  );
  if (unsupportedIframes.length > 0) {
    issues.push("Article contains an unsupported iframe source.");
  }
  if (youtubeEmbeds.length > 1) {
    issues.push(`Article contains ${youtubeEmbeds.length} YouTube embeds; maximum is one relevant video.`);
  }

  if (mode === "strict") {
    if (article.featuredImage && !safeHttpsUrl(article.featuredImage)) {
      issues.push("Featured image must use a valid HTTPS URL.");
    } else if (!article.featuredImage) {
      warnings.push("No featured image is attached; omission is preferable to an unreviewed asset.");
    }
    if (article.factCheckScore === undefined) {
      issues.push("Strict publication requires a completed fact check.");
    } else if (article.factCheckScore < 85) {
      issues.push(`Fact-check score is ${article.factCheckScore}; strict minimum is 85.`);
    }
    if (article.editorialQualityScore === undefined) {
      issues.push("Strict publication requires a completed people-first editorial review.");
    } else if (article.editorialQualityScore < 85) {
      issues.push(
        `Editorial quality score is ${article.editorialQualityScore}; strict minimum is 85.`,
      );
    }
    if (article.mediaQualityStatus !== "passed") {
      issues.push("Strict publication requires a completed media-quality review.");
    }
    if (!article.featuredImage) {
      issues.push("Strict publication requires a reviewed HTTPS hero image.");
    }
    if (article.productEvidenceStatus === "failed") {
      issues.push(
        "A product-specific section requires validated first-party visual evidence.",
      );
    }
    if (article.claimEvidenceStatus !== "passed") {
      issues.push(
        "Strict publication requires a completed claim-to-evidence audit.",
      );
    }
    const maxWords = articleWordCeiling(article.articleType);
    if (measuredWordCount > maxWords) {
      issues.push(
        `Article is overlong for its format (${measuredWordCount} words; review ceiling ${maxWords}).`,
      );
    }
    if (paragraphsWithOutcomes.length > 0 && validSources.length < 2) {
      issues.push("Quantified outcome claims require at least two valid sources.");
    }
    if (paragraphsWithOutcomes.length > 0 && strictEvidenceSourceCount < 2) {
      issues.push(
        "Quantified outcome claims require at least two primary or authoritative evidence sources.",
      );
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
      strictEvidenceSourceCount,
      quantifiedClaimCount: paragraphsWithClaims.length,
      youtubeEmbedCount: youtubeEmbeds.length,
      malformedTableCount: tableProblems.length,
    },
  };
}
