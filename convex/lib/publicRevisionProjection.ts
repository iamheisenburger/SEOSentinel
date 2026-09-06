import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { publicationArtifactHashForAuditVersion, PUBLICATION_AUDIT_VERSION } from "./publicationArtifact";
import { publishedArticlePublicUrl } from "./publicationLive";
import { validatePublicationReceipt } from "./publicationReceipts";
import { publishedRevisionKey, validatePublishedRevisionReceipt, type PublishedRevisionArtifact } from "./publishedRevision";
import { articleMatchesCurrentDomain } from "./siteDomainBinding";
import { artifactSnapshot, revisionArtifactRendererVersion } from "./revisionArtifact";

/** Acknowledged bytes must be served BEFORE the independent live verifier can
 * confirm them. Prepared/attempted rows never qualify. Reads stay article-bound. */
async function latestAcknowledgedRevision(ctx: QueryCtx, articleId: Id<"articles">) {
  const groups = await Promise.all((["verified", "rolled_back", "verification_pending", "unverified"] as const).map(status =>
    ctx.db.query("published_article_revisions").withIndex("by_article_status_created", q =>
      q.eq("articleId", articleId).eq("status", status)).order("desc").take(status === "unverified" ? 8 : 1)));
  return groups.flat().filter(row => row.receipt).sort((a, b) =>
    b.createdAt - a.createdAt || b._creationTime - a._creationTime)[0];
}

export async function publicRevisionProjection(ctx: QueryCtx, site: Doc<"sites">, article: Doc<"articles">): Promise<Doc<"articles"> | null> {
  const revision = await latestAcknowledgedRevision(ctx, article._id);
  if (!revision) return article;
  return projectAcknowledgedRevision(site, article, revision);
}

function projectAcknowledgedRevision(site: Doc<"sites">, article: Doc<"articles">, revision: Doc<"published_article_revisions">): Doc<"articles"> | null {
  try {
    revisionArtifactRendererVersion(revision.baseArtifactRendererVersion);
    revisionArtifactRendererVersion(revision.nextArtifactRendererVersion);
    const base = artifactSnapshot(revision.baseArtifact as PublishedRevisionArtifact);
    const next = artifactSnapshot(revision.nextArtifact as PublishedRevisionArtifact);
    if (!article.publicationReceipt) return null;
    const originalReceipt = validatePublicationReceipt(article.publicationReceipt);
    const baseReceipt = validatePublicationReceipt(revision.baseReceipt);
    const receipt = validatePublishedRevisionReceipt({ receipt: revision.receipt!, method: baseReceipt.method,
      revisionKey: revision.revisionKey, baseArtifactHash: revision.baseArtifactHash,
      nextArtifactHash: revision.nextArtifactHash, baseExternalId: baseReceipt.externalId });
    if (article.siteId !== site._id || revision.siteId !== site._id || revision.articleId !== article._id ||
      article.status !== "published" || !articleMatchesCurrentDomain(site, article) ||
      originalReceipt.contentHash !== article.publishedContentHash ||
      publicationArtifactHashForAuditVersion(artifactSnapshot(article), article.publicationAuditVersion ?? PUBLICATION_AUDIT_VERSION) !== article.publishedContentHash ||
      receipt.method !== originalReceipt.method ||
      receipt.status !== ({ github: "committed", wordpress: "published", webhook: "accepted" } as const)[receipt.method] ||
      base.slug !== article.slug || next.slug !== article.slug ||
      JSON.stringify(base.metaKeywords ?? []) !== JSON.stringify(next.metaKeywords ?? []) ||
      JSON.stringify(next.metaKeywords ?? []) !== JSON.stringify(article.metaKeywords ?? []) ||
      revision.publicationDate !== article.publicationDate ||
      revision.publicationConfigHash !== article.publicationConfigHash ||
      base.publicationConfigHash !== revision.publicationConfigHash || next.publicationConfigHash !== revision.publicationConfigHash ||
      revision.expectedPublicUrl !== publishedArticlePublicUrl({ domain: site.domain, urlStructure: site.urlStructure, slug: article.slug }) ||
      !revision.attemptedAt || receipt.receivedAt < revision.attemptedAt ||
      baseReceipt.contentHash !== revision.baseArtifactHash ||
      publicationArtifactHashForAuditVersion(base, revision.baseAuditVersion ?? PUBLICATION_AUDIT_VERSION) !== revision.baseArtifactHash ||
      publicationArtifactHashForAuditVersion(next, revision.nextAuditVersion ?? PUBLICATION_AUDIT_VERSION) !== revision.nextArtifactHash ||
      publishedRevisionKey({ siteId: String(site._id), articleId: String(article._id), actionFingerprint: revision.actionFingerprint,
        kind: revision.kind, baseArtifactHash: revision.baseArtifactHash, nextArtifactHash: revision.nextArtifactHash, baseReceipt,
        baseArtifactRendererVersion: revision.baseArtifactRendererVersion, nextArtifactRendererVersion: revision.nextArtifactRendererVersion }) !== revision.revisionKey) {
      return null;
    }
    // This is only a public read projection. Never patch original publication
    // receipts, publication dates, article counts, or the next cadence deadline.
    return { ...article, ...next, updatedAt: receipt.receivedAt };
  } catch {
    // An inconsistent acknowledged artifact must not silently serve old prose.
    return null;
  }
}

type PublicArticleRow = Doc<"articles"> | Doc<"article_summaries">;
export async function projectPublicArticleRows(ctx: QueryCtx, site: Doc<"sites">,
  rows: PublicArticleRow[]): Promise<PublicArticleRow[]> {
  const projected = await Promise.all(rows.map(async row => {
    const revision = await latestAcknowledgedRevision(ctx, "articleId" in row ? row.articleId : row._id);
    // Preserve the summary read budget: never load full Markdown for unchanged rows.
    if (!revision) return row;
    const article = "articleId" in row ? await ctx.db.get(row.articleId) : row;
    if (!article || article.siteId !== site._id || article.status !== "published" || !articleMatchesCurrentDomain(site, article)) return null;
    return projectAcknowledgedRevision(site, article, revision);
  }));
  return projected.filter((row): row is PublicArticleRow => row !== null);
}
