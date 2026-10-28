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
const ACKNOWLEDGED = ["verified", "rolled_back", "verification_pending", "unverified", "failed"] as const;
/** The newest delivered improvement of one of Pentra's own published articles
 * (a correction, targeted improvement or refresh of its enrolled page). */
async function latestDeliveredImprovement(ctx: QueryCtx, articleId: Id<"articles">) {
  const groups = await Promise.all(ACKNOWLEDGED.map(status =>
    ctx.db.query("published_article_revisions").withIndex("by_served_article_status_created", q =>
      q.eq("servedArticleId", articleId).eq("status", status)).order("desc").take(status === "unverified" || status === "failed" ? 8 : 1)));
  return groups.flat().filter(row => row.receipt && !(row.status === "failed" && row.ambiguityDispositionAt)).sort((a, b) =>
    b.createdAt - a.createdAt || b._creationTime - a._creationTime)[0];
}

async function latestAcknowledgedRevision(ctx: QueryCtx, articleId: Id<"articles">) {
  // A delivered revision whose live checks failed is still what the
  // destination holds (its receipt is exact), so it is served too: on Oct 20
  // 2026 a wording repair's checks failed against a 404 caused elsewhere, and
  // without being served its bounded re-check could never pass. One set aside
  // by an owner or operator decision (ambiguity disposition) is not.
  const groups = await Promise.all(ACKNOWLEDGED.map(status =>
    ctx.db.query("published_article_revisions").withIndex("by_article_status_created", q =>
      q.eq("articleId", articleId).eq("status", status)).order("desc").take(status === "unverified" || status === "failed" ? 8 : 1)));
  return groups.flat().filter(row => row.receipt && !(row.status === "failed" && row.ambiguityDispositionAt)).sort((a, b) =>
    b.createdAt - a.createdAt || b._creationTime - a._creationTime)[0];
}

/** P235 (Oct 28 2026): the delivery keys Pentra's own file for this article may carry in its frontmatter: its first
 * publication's and, once Pentra delivered a revision or an improvement of it, the newest such delivery's. LeadPilot's
 * articles revised by Pentra carry the revision's key ("Pentra revise pentra:..."), and the daily adoption, checking
 * only the first, refused four of Pentra's own files (Oct 28 04:10Z). */
export async function pentraDeliveryKeys(ctx: QueryCtx, article: Doc<"articles">): Promise<string[]> {
  const [revision, improvement] = await Promise.all([latestAcknowledgedRevision(ctx, article._id), latestDeliveredImprovement(ctx, article._id)]);
  const newest = [revision, improvement].filter((row): row is NonNullable<typeof row> => Boolean(row)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const delivered = (newest?.receipt as { deliveryKey?: unknown } | undefined)?.deliveryKey;
  return [...new Set([...(article.publicationDeliveryHash ? [`pentra:${article.publicationDeliveryHash}`] : []),
    ...(typeof delivered === "string" && delivered.startsWith("pentra:") ? [delivered] : [])])];
}

export async function publicRevisionProjection(ctx: QueryCtx, site: Doc<"sites">, article: Doc<"articles">): Promise<Doc<"articles"> | null> {
  const [revision, improvement] = await Promise.all([latestAcknowledgedRevision(ctx, article._id), latestDeliveredImprovement(ctx, article._id)]);
  if (improvement && (!revision || improvement.createdAt > revision.createdAt)) return projectDeliveredImprovement(site, article, improvement);
  if (!revision) return article;
  return projectAcknowledgedRevision(site, article, revision);
}

const normalizeSlug = (slug: string) => slug.replace(/^\//, "");
const ACKNOWLEDGED_RECEIPT_STATUS = { github: "committed", wordpress: "published", webhook: "accepted", shopify: "published", webflow: "published",
  ghost: "published" } as const;
/** P133 (Oct 20 2026): an improvement of an article whose public page Pentra's
 * own blog serves (pentra.dev) is public once delivered, like an editorial
 * revision: its exact receipt (this revision's delivery key, the next
 * artifact's hash, the article's own destination) and the article's slug.
 * Before this, such a correction committed to GitHub never reached the page,
 * so its live check could never pass. Inconsistent bytes are never served. */
function projectDeliveredImprovement(site: Doc<"sites">, article: Doc<"articles">, revision: Doc<"published_article_revisions">): Doc<"articles"> | null {
  try {
    const next = artifactSnapshot(revision.nextArtifact as PublishedRevisionArtifact);
    const receipt = revision.receipt as { method?: string; status?: string; deliveryKey?: string; contentHash?: string; receivedAt?: number } | undefined;
    const method = article.publicationReceipt ? validatePublicationReceipt(article.publicationReceipt).method : null;
    if (!receipt || !method || revision.siteId !== site._id || revision.servedArticleId !== article._id || article.siteId !== site._id ||
      article.status !== "published" || !articleMatchesCurrentDomain(site, article) || receipt.method !== method ||
      receipt.status !== ACKNOWLEDGED_RECEIPT_STATUS[method as keyof typeof ACKNOWLEDGED_RECEIPT_STATUS] ||
      receipt.deliveryKey !== `pentra:${revision.revisionKey}` || receipt.contentHash !== revision.nextArtifactHash ||
      publicationArtifactHashForAuditVersion(next, revision.nextAuditVersion ?? PUBLICATION_AUDIT_VERSION) !== revision.nextArtifactHash ||
      normalizeSlug(next.slug) !== normalizeSlug(article.slug) || !revision.attemptedAt || !receipt.receivedAt || receipt.receivedAt < revision.attemptedAt) {
      return null;
    }
    // Only the public read changes: the article, its receipts, hashes and
    // publication date stay exactly as published.
    return { ...article, ...next, slug: article.slug, updatedAt: receipt.receivedAt };
  } catch {
    return null;
  }
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
      receipt.status !== ({ github: "committed", wordpress: "published", webhook: "accepted", shopify: "published", webflow: "published", ghost: "published" } as const)[receipt.method] ||
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
    const articleId = "articleId" in row ? row.articleId : row._id;
    const [revision, improvement] = await Promise.all([latestAcknowledgedRevision(ctx, articleId), latestDeliveredImprovement(ctx, articleId)]);
    // Preserve the summary read budget: never load full Markdown for unchanged rows.
    if (!revision && !improvement) return row;
    const article = "articleId" in row ? await ctx.db.get(row.articleId) : row;
    if (!article || article.siteId !== site._id || article.status !== "published" || !articleMatchesCurrentDomain(site, article)) return null;
    if (improvement && (!revision || improvement.createdAt > revision.createdAt)) return projectDeliveredImprovement(site, article, improvement);
    return projectAcknowledgedRevision(site, article, revision!);
  }));
  return projected.filter((row): row is PublicArticleRow => row !== null);
}
