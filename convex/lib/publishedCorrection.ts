import { evaluatePublicationQuality, validateClaimEvidenceLedger } from "./articleQuality.ts";
import { publicationArtifactHash, sha256Hex } from "./publicationArtifact.ts";
import { assertSafePublishableMarkdown } from "./safeMarkdownHtml.ts";
import type { PublishedRevisionArtifact } from "./publishedRevision.ts";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import type { Root } from "hast";

export const PUBLISHED_CORRECTION_VERSION = 1;
export const MAX_CORRECTION_AUDITS_PER_SITE_DAY = 3;
export const CORRECTION_AUDIT_TIMEOUT_MS = 9 * 60_000;

export type CorrectionProposal = {
  title: string;
  metaTitle: string;
  metaDescription: string;
  markdown: string;
};

export function correctionInputHash(args: {
  siteId: string; articleId: string; baseArtifactHash: string;
  productEvidenceHash: string; reason: string; proposal: CorrectionProposal;
}): string {
  return sha256Hex(JSON.stringify({ version: PUBLISHED_CORRECTION_VERSION,
    siteId: args.siteId, articleId: args.articleId,
    baseArtifactHash: args.baseArtifactHash, productEvidenceHash: args.productEvidenceHash,
    reason: args.reason, proposal: {
      title: args.proposal.title, metaTitle: args.proposal.metaTitle,
      metaDescription: args.proposal.metaDescription, markdown: args.proposal.markdown,
    },
  }));
}

function destinations(markdown: string): Set<string> {
  assertSafePublishableMarkdown(markdown);
  const result = new Set<string>();
  type Node = { type: string; url?: string; children?: Node[] };
  const visit = (node: Node) => {
    if (["definition", "imageReference", "linkReference"].includes(node.type)) {
      throw new Error("Editorial correction requires explicit inline destinations");
    }
    if (node.type === "link" || node.type === "image") result.add(`${node.type}:${node.url}`);
    node.children?.forEach(visit);
  };
  visit(unified().use(remarkParse).use(remarkGfm).parse(markdown));
  return result;
}

export function validateCorrectionDestinations(base: string, next: string): void {
  const allowed = destinations(base);
  for (const target of destinations(next)) {
    if (!allowed.has(target)) throw new Error("Editorial correction introduced an unaudited link or media destination");
  }
}

/** A correction can change prose and its description, never its publication
 * identity, evidence corpus, reviewed media, or destination configuration. */
export function validatePublishedCorrection(args: {
  base: PublishedRevisionArtifact; next: PublishedRevisionArtifact;
  productEvidence: string;
}): PublishedRevisionArtifact {
  const { base, next } = args;
  for (const field of ["slug", "articleType", "language", "publicationConfigHash",
    "featuredImage", "reviewedMediaUrls", "sources", "internalLinks", "metaKeywords",
    "productEvidenceHash", "researchEvidenceSummary", "mediaQualityStatus",
    "productEvidenceStatus"] as const) {
    if (JSON.stringify(base[field] ?? null) !== JSON.stringify(next[field] ?? null)) {
      throw new Error(`Editorial correction cannot change sealed ${field}`);
    }
  }
  if (sha256Hex(args.productEvidence) !== next.productEvidenceHash) {
    throw new Error("Editorial correction lost its exact first-party evidence snapshot");
  }
  if (![next.editorialQualityScore, next.factCheckScore].every(score =>
    typeof score === "number" && Number.isFinite(score) && score >= 85 && score <= 100) ||
    next.contentScore !== undefined) {
    throw new Error("Editorial correction requires fresh finite audit scores and cannot reuse an old SEO score");
  }
  validateCorrectionDestinations(base.markdown, next.markdown);
  if (next.markdown === base.markdown || publicationArtifactHash(base) === publicationArtifactHash(next)) {
    throw new Error("Editorial correction requires an actual prose correction");
  }
  const quality = evaluatePublicationQuality(next, "strict");
  const ledger = validateClaimEvidenceLedger({ markdown: next.markdown,
    sources: next.sources ?? [], researchEvidence: next.researchEvidenceSummary ?? "",
    productEvidence: args.productEvidence, productEvidenceHash: next.productEvidenceHash,
    claimEvidence: next.claimEvidence ?? [],
  });
  if (!quality.passed || !ledger.passed) {
    throw new Error(`Editorial correction failed quality: ${[...quality.issues, ...ledger.issues].join(" ")}`);
  }
  return next;
}

export function correctionVisibleText(html: string): string {
  // Parse the same way HTML is parsed, including entities and nested hidden
  // nodes. A matching string inside hydration data is not a live article.
  type Node = { type: string; value?: string; tagName?: string;
    properties?: Record<string, unknown>; children?: Node[] };
  const tree = unified().use(rehypeRaw).runSync({ type: "root",
    children: [{ type: "raw", value: html }],
  } as unknown as Root) as Node;
  const text = (node: Node): string => {
    if (node.type === "text") return node.value ?? "";
    const p = node.properties ?? {};
    if (["head", "script", "style", "noscript", "template", "svg"].includes(node.tagName ?? "") ||
      p.hidden === true || p.ariaHidden === "true" || p.ariaHidden === true ||
      /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(String(p.style ?? ""))) return " ";
    const content = (node.children ?? []).map(text).join("");
    return /^(?:p|div|article|section|h[1-6]|li|tr|td|th|br|hr|pre|blockquote)$/.test(node.tagName ?? "")
      ? ` ${content} ` : content;
  };
  return text(tree).normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Verify the complete rendered prose, not just a new title or a delivery ACK.
 * Ignore hydration/script copies and reject retained superseded paragraphs. */
export function verifyLiveCorrectionBody(args: {
  html: string; renderedBaseParagraphs: string[]; renderedNext: string;
}): void {
  const live = correctionVisibleText(args.html);
  const expected = correctionVisibleText(args.renderedNext);
  if (expected.length < 80 || !live.includes(expected)) {
    throw new Error("Live correction does not contain the complete exact audited prose");
  }
  for (const paragraph of args.renderedBaseParagraphs) {
    const previous = correctionVisibleText(paragraph);
    if (previous.length >= 80 && !expected.includes(previous) && live.includes(previous)) {
      throw new Error("Live correction still exposes superseded prose");
    }
  }
}
