import type { PublicationArtifact } from "./publicationArtifact.ts";
import type { PublishedRevisionArtifact } from "./publishedRevision.ts";

export const REVISION_ARTIFACT_RENDERER_VERSION = 2;

/** Explicit fields are important: serialized missing values must clear the old
 * article's values, not inherit stale scores, metadata or evidence. */
export function artifactSnapshot(
  article: PublicationArtifact & { title: string; slug: string; markdown: string; metaKeywords?: string[] },
): PublishedRevisionArtifact {
  return {
    title: article.title, slug: article.slug, markdown: article.markdown,
    articleType: article.articleType, metaTitle: article.metaTitle,
    metaDescription: article.metaDescription, metaKeywords: article.metaKeywords,
    language: article.language, featuredImage: article.featuredImage,
    reviewedMediaUrls: article.reviewedMediaUrls, readingTime: article.readingTime,
    wordCount: article.wordCount, factCheckScore: article.factCheckScore,
    contentScore: article.contentScore, editorialQualityScore: article.editorialQualityScore,
    mediaQualityStatus: article.mediaQualityStatus, productEvidenceStatus: article.productEvidenceStatus,
    claimEvidenceStatus: article.claimEvidenceStatus, claimEvidence: article.claimEvidence,
    researchEvidenceSummary: article.researchEvidenceSummary, productEvidenceHash: article.productEvidenceHash,
    publicationConfigHash: article.publicationConfigHash, sources: article.sources,
    internalLinks: article.internalLinks,
  };
}

export function revisionArtifactRendererVersion(version?: number): 1 | 2 {
  if (version === undefined || version === 1) return 1;
  if (version === REVISION_ARTIFACT_RENDERER_VERSION) return 2;
  throw new Error("Unsupported sealed revision artifact renderer");
}

export function revisionArticleRecord<T extends { title: string; slug: string; markdown: string }>(
  article: T,
  artifact: PublishedRevisionArtifact,
  rendererVersion?: number,
  artifactHash?: string,
): T & PublishedRevisionArtifact {
  // Legacy receipts and ambiguous writes must keep their original exact bytes.
  if (revisionArtifactRendererVersion(rendererVersion) === 1) return { ...article, ...artifact };
  if (!artifactHash || !/^[a-f0-9]{64}$/.test(artifactHash)) throw new Error("Revision renderer lost its sealed artifact hash");
  return { ...article, ...artifactSnapshot(artifact), auditedContentHash: artifactHash };
}
